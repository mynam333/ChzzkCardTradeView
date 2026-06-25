import { getDbMode, getMysqlDb, getSqliteDb } from './db';
import { ensureArenaMatchTables, loadArenaMatchReplayJson } from './arenaMatchService';
import { ARENA_MATCH_FORMAT, ARENA_ROUNDS_TO_WIN } from './arenaRules';
import { getArenaOpsConfigSync } from './arenaOpsConfig';

type RawSpectatorMatchRow = {
  id: number | string | bigint;
  match_type: string;
  round_count: number;
  player_a_round_wins: number;
  player_b_round_wins: number;
  draw_rounds: number;
  summary_json: string;
  replay_json: string | null;
  created_at: string;
};

const SPECTATOR_REPLAY_CACHE_TTL_MS = Math.max(5_000, Math.min(120_000, Number(process.env.ARENA_SPECTATOR_REPLAY_CACHE_TTL_MS || 30_000)));
const spectatorReplayCache = new Map<string, { expiresAt: number; data: any }>();

const parseJson = <T>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const compactDeck = (deck: any) => ({
  deck_id: String(deck?.deck_id || ''),
  name: String(deck?.name || ''),
  cards: Array.isArray(deck?.cards)
    ? deck.cards.slice(0, 10).map((card: any) => ({
        card_id: String(card?.card_id || ''),
        channel_id: String(card?.channel_id || ''),
        name: String(card?.name || ''),
        image_url: card?.image_url || null,
        class_id: String(card?.class_id || ''),
        class_name: String(card?.class_name || '')
      }))
    : [],
  round_plans: Array.isArray(deck?.round_plans) ? deck.round_plans.slice(0, 5) : []
});

export const getArenaSpectatorReplay = async (matchId: string) => {
  if (!getArenaOpsConfigSync().spectator_public_enabled) throw new Error('ArenaSpectatorDisabled');
  const cacheKey = String(matchId || '').trim();
  const cached = spectatorReplayCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  await ensureArenaMatchTables();
  const query = `SELECT id, match_type, round_count, player_a_round_wins, player_b_round_wins, draw_rounds,
      summary_json, replay_json, created_at
    FROM arena_matches
    WHERE id = ?
    LIMIT 1`;
  const row = getDbMode() === 'MYSQL'
    ? await getMysqlDb().get<RawSpectatorMatchRow>(query, matchId)
    : getSqliteDb().prepare(query).get(matchId) as RawSpectatorMatchRow | undefined;

  if (!row) return null;
  const completed = Number(row.player_a_round_wins || 0) >= ARENA_ROUNDS_TO_WIN
    || Number(row.player_b_round_wins || 0) >= ARENA_ROUNDS_TO_WIN
    || Number(row.round_count || 0) >= 5;
  if (!completed) return null;
  const summary = parseJson<any>(row.summary_json, {});
  const replay = parseJson<any>(await loadArenaMatchReplayJson(String(row.id), row.replay_json), null);
  if (!replay) return null;

  const payload = {
    match: {
      match_id: String(row.id),
      match_type: row.match_type === 'RANKED' ? 'RANKED' : 'BOT_PRACTICE',
      match_format: ARENA_MATCH_FORMAT,
      rounds_to_win: ARENA_ROUNDS_TO_WIN,
      round_count: Number(row.round_count || 0),
      player_a_round_wins: Number(row.player_a_round_wins || 0),
      player_b_round_wins: Number(row.player_b_round_wins || 0),
      draw_rounds: Number(row.draw_rounds || 0),
      created_at: row.created_at,
      player_deck: compactDeck(summary.player_deck),
      opponent_deck: compactDeck(summary.opponent_deck || summary.bot_deck)
    },
    replay: {
      ...replay,
      match_id: String(row.id),
      match_format: ARENA_MATCH_FORMAT,
      rounds_to_win: ARENA_ROUNDS_TO_WIN
    },
    spectator_policy: {
      realtime_tick_stream: false,
      source: 'completed_replay',
      db_access_pattern: 'single_match_primary_key_lookup'
    }
  };
  spectatorReplayCache.set(cacheKey, { data: payload, expiresAt: Date.now() + SPECTATOR_REPLAY_CACHE_TTL_MS });
  if (spectatorReplayCache.size > 500) {
    for (const [key, value] of spectatorReplayCache) {
      if (value.expiresAt <= Date.now()) spectatorReplayCache.delete(key);
    }
    if (spectatorReplayCache.size > 500) {
      const oldestKey = spectatorReplayCache.keys().next().value;
      if (oldestKey) spectatorReplayCache.delete(oldestKey);
    }
  }
  return payload;
};
