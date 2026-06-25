import { createHash } from 'crypto';
import { getDbMode, getMysqlDb, getSqliteDb } from './db';
import { ArenaDeck, getArenaDeck, validateArenaDeckInput } from './arenaDeckService';
import { getArenaCurrentSeasonId } from './arenaSeasonService';
import { ArenaGeneratedCard, generateArenaCardFromStreamer } from './arenaCatalog';
import { listArenaStreamerCardStates } from './arenaStreamerCardState';
import { ArenaBattleEvent, pickArenaBattlefieldRule, simulateArenaRound } from './arenaBattleSimulator';
import { ARENA_MAX_ROUNDS_PER_MATCH, ARENA_MATCH_FORMAT, ARENA_ROUNDS_TO_WIN, ARENA_TACTIC_CHIPS } from './arenaRules';
import { getArenaOpsConfigSync } from './arenaOpsConfig';
import { streamerRepository } from '../repositories';
import type { ArenaCompactMatchSummaryDto, ArenaDeckSnapshotDto, ArenaRoundPlanSlotDto } from '@chikapo/arena-contract';

export type ArenaMatchDifficulty = 'easy' | 'normal' | 'hard';

export interface ArenaMatchSummary {
  id: string;
  season_id: string;
  match_type: 'BOT_PRACTICE' | 'RANKED';
  match_format: typeof ARENA_MATCH_FORMAT;
  rounds_to_win: typeof ARENA_ROUNDS_TO_WIN;
  round_count: number;
  player_a_id: string;
  player_b_id: string | null;
  winner_user_id: string | null;
  player_a_round_wins: number;
  player_b_round_wins: number;
  draw_rounds: number;
  result: 'win' | 'loss' | 'draw' | null;
  difficulty: ArenaMatchDifficulty;
  summary: ArenaCompactMatchSummary;
  created_at: string;
}

export interface ArenaReplayPayload {
  match_id: string;
  match_format: typeof ARENA_MATCH_FORMAT;
  rounds_to_win: typeof ARENA_ROUNDS_TO_WIN;
  replay_storage: 'compact_summary' | 'tick_events';
  rounds: ArenaRoundReplay[];
}

interface ArenaCompactMatchSummary extends ArenaCompactMatchSummaryDto {
  progress_status?: 'in_progress' | 'completed';
  current_round_no?: number;
  rounds_to_win?: number;
  max_rounds?: number;
  match_seed?: string;
  opponent_power_multiplier?: number;
  abandon_policy?: {
    mode: 'auto_default_plan';
    committed_by?: 'player_a' | 'player_b';
    auto_commit?: boolean;
    default_plan_used_for_absent_side?: boolean;
  };
  pending_round_input?: {
    round_no: number;
    deadline_at: string;
    player_a?: ArenaRoundCommitInput;
    player_b?: ArenaRoundCommitInput;
  } | null;
  round_results: ArenaRoundResult[];
  player_deck: ArenaDeckSnapshot;
  bot_deck: ArenaDeckSnapshot;
  opponent_deck?: ArenaDeckSnapshot;
  battlefield_rule?: { id: string; name: string; description: string };
  rating_delta: 0 | { player_a: number; player_b: number };
  mmr_reflected: boolean;
}

interface ArenaRoundReplay {
  round_no: number;
  duration_ms: number;
  winner_side: 'player' | 'bot' | 'draw';
  events: ArenaBattleEvent[];
}

interface ArenaRoundResult {
  round_no: number;
  winner_side: 'player' | 'bot' | 'draw';
  duration_ms: number;
  player_power: number;
  bot_power: number;
  player_remaining_units?: number;
  bot_remaining_units?: number;
  player_total_damage?: number;
  bot_total_damage?: number;
  reason: string;
}

export interface ArenaRoundCommitInput {
  round_no?: unknown;
  tactic_style?: unknown;
  focus_rule?: unknown;
  strategy_chip_id?: unknown;
  auto_commit?: unknown;
  slots?: unknown;
}

export interface ArenaDeckSnapshot extends Omit<ArenaDeckSnapshotDto, 'cards' | 'round_plans'> {
  deck_id: string;
  name: string;
  cards: Array<{
    card_id: string;
    channel_id: string;
    name: string;
    image_url: string | null;
    class_id: string;
    class_name: string;
    class_role?: string;
    stats: ArenaGeneratedCard['stats'];
    skills: Array<{ id: string; name: string; type: string }>;
  }>;
  round_plans: ArenaDeck['round_plans'];
  strategy_chip_id?: string;
}

type RawMatchRow = {
  id: number | string | bigint;
  season_id: string;
  match_type: string;
  match_format: string;
  rounds_to_win: number;
  round_count: number;
  player_a_id: string;
  player_b_id: string | null;
  winner_user_id: string | null;
  player_a_round_wins: number;
  player_b_round_wins: number;
  draw_rounds: number;
  difficulty: string;
  summary_json: string;
  replay_json: string | null;
  progress_status?: string | null;
  pending_round_deadline_at?: string | null;
  created_at: string;
};

type ArenaRankingResponse = {
  items: Array<{
    rank: number;
    user_id: string;
    rating: number;
    rating_points: number;
    tier: string;
    wins: number;
    losses: number;
    draws: number;
  }>;
  updated_at: string;
  source: string;
};

export type ArenaUserProfileResponse = Awaited<ReturnType<typeof getArenaProfile>> & {
  recent_matches: ArenaMatchSummary[];
  win_rate: number;
};

let ensureTablesPromise: Promise<void> | null = null;
let ensureReplayTablePromise: Promise<void> | null = null;
let botPoolCache: { cards: ArenaGeneratedCard[]; expiresAt: number } | null = null;
let botPoolInFlight: Promise<ArenaGeneratedCard[]> | null = null;
let rankingCache = new Map<string, { data: ArenaRankingResponse; expiresAt: number }>();
let rankingSnapshotRebuildInFlight: Promise<any> | null = null;

const BOT_POOL_CACHE_TTL_MS = Math.max(60_000, Number(process.env.ARENA_BOT_POOL_CACHE_TTL_MS || 300_000));
const MAX_RANKING_LIMIT = Math.max(10, Number(process.env.ARENA_RANKING_MAX_LIMIT || 100));
const RANKING_SNAPSHOT_REBUILD_LIMIT = Math.max(10, Math.min(1000, Number(process.env.ARENA_RANKING_SNAPSHOT_REBUILD_LIMIT || 1000)));
const REPLAY_RETENTION_DAYS = Math.max(1, Math.min(90, Number(process.env.ARENA_REPLAY_RETENTION_DAYS || 7)));
const REPLAY_PRUNE_LIMIT = Math.max(10, Math.min(1000, Number(process.env.ARENA_REPLAY_PRUNE_LIMIT || 200)));
const REPLAY_MAX_EVENTS_PER_ROUND = Math.max(20, Math.min(300, Number(process.env.ARENA_REPLAY_MAX_EVENTS_PER_ROUND || 120)));
const REPLAY_MAX_BYTES = Math.max(8_192, Math.min(512_000, Number(process.env.ARENA_REPLAY_MAX_BYTES || 96_000)));
const RANKING_CACHE_TTL_MS = Math.max(5_000, Number(process.env.ARENA_RANKING_CACHE_TTL_MS || 30_000));
const ROUND_SELECTION_TIMEOUT_MS = Math.max(5_000, Math.min(60_000, Number(process.env.ARENA_ROUND_SELECTION_TIMEOUT_MS || 60_000)));
const ROUND_SELECTION_TIMEOUT_SECONDS = Math.ceil(ROUND_SELECTION_TIMEOUT_MS / 1000);
const RANKED_ELO_K = Math.max(8, Math.min(48, Number(process.env.ARENA_QUICK_ELO_K || 24)));
const EXPIRED_ROUND_SCAN_LIMIT = Math.max(5, Math.min(100, Number(process.env.ARENA_EXPIRED_ROUND_SCAN_LIMIT || 25)));
const dbNowPlusRoundSelectionSql = () => getDbMode() === 'MYSQL'
  ? 'DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND)'
  : "datetime('now', '+' || ? || ' seconds')";
const dbNowSql = () => getDbMode() === 'MYSQL' ? 'UTC_TIMESTAMP()' : "datetime('now')";

export const isArenaReplayWriteEnabled = () => getArenaOpsConfigSync().replay_writes;

const ARENA_MATCH_SUMMARY_COLUMNS = `id, season_id, match_type, match_format, rounds_to_win, round_count,
  player_a_id, player_b_id, player_a_deck_id, winner_user_id, player_a_round_wins, player_b_round_wins,
  draw_rounds, difficulty, summary_json, progress_status, pending_round_deadline_at, NULL AS replay_json, created_at`;
const ARENA_MATCH_WITH_REPLAY_COLUMNS = `id, season_id, match_type, match_format, rounds_to_win, round_count,
  player_a_id, player_b_id, player_a_deck_id, winner_user_id, player_a_round_wins, player_b_round_wins,
  draw_rounds, difficulty, summary_json, progress_status, pending_round_deadline_at, replay_json, created_at`;

export const getArenaReplayStoragePolicy = () => ({
  enabled: isArenaReplayWriteEnabled(),
  max_events_per_round: REPLAY_MAX_EVENTS_PER_ROUND,
  max_bytes: REPLAY_MAX_BYTES,
  prune_retention_days: REPLAY_RETENTION_DAYS,
  prune_batch_limit: REPLAY_PRUNE_LIMIT
});

const boundReplayRounds = (rounds: any[]) => rounds.map((round: any) => ({
  ...round,
  events: Array.isArray(round?.events) ? round.events.slice(0, REPLAY_MAX_EVENTS_PER_ROUND) : []
}));

export const buildArenaReplayJsonForStorage = (replay: ArenaReplayPayload | any): string | null => {
  if (!isArenaReplayWriteEnabled()) return null;
  const bounded = {
    ...replay,
    replay_storage: replay?.replay_storage || 'tick_events',
    rounds: Array.isArray(replay?.rounds) ? boundReplayRounds(replay.rounds) : replay?.rounds,
    matches: Array.isArray(replay?.matches)
      ? replay.matches.map((match: any) => ({
          ...match,
          rounds: Array.isArray(match?.rounds) ? boundReplayRounds(match.rounds) : []
        }))
      : replay?.matches
  };
  const encoded = JSON.stringify(bounded);
  return Buffer.byteLength(encoded, 'utf8') <= REPLAY_MAX_BYTES ? encoded : null;
};

const countReplayEvents = (replay: ArenaReplayPayload | any) => {
  const rounds = Array.isArray(replay?.rounds) ? replay.rounds : [];
  return rounds.reduce((total: number, round: any) => total + (Array.isArray(round?.events) ? round.events.length : 0), 0);
};

const replayExpiresAtSql = () => getDbMode() === 'MYSQL'
  ? 'DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY)'
  : "datetime('now', '+' || ? || ' days')";

const saveArenaMatchReplay = async (matchId: string, replay: ArenaReplayPayload | any): Promise<string | null> => {
  const replayJson = buildArenaReplayJsonForStorage(replay);
  if (!replayJson) return null;
  await ensureArenaReplayTable();
  const replayBytes = Buffer.byteLength(replayJson, 'utf8');
  const eventCount = countReplayEvents(replay);
  if (getDbMode() === 'MYSQL') {
    await getMysqlDb().run(
      `INSERT INTO arena_match_replays
        (match_id, replay_json, replay_bytes, event_count, expires_at)
       VALUES (?, ?, ?, ?, ${replayExpiresAtSql()})
       ON DUPLICATE KEY UPDATE
         replay_json = VALUES(replay_json),
         replay_bytes = VALUES(replay_bytes),
         event_count = VALUES(event_count),
         expires_at = VALUES(expires_at),
         updated_at = UTC_TIMESTAMP()`,
      matchId,
      replayJson,
      replayBytes,
      eventCount,
      REPLAY_RETENTION_DAYS
    );
    return replayJson;
  }

  getSqliteDb()
    .prepare(
      `INSERT INTO arena_match_replays
        (match_id, replay_json, replay_bytes, event_count, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ${replayExpiresAtSql()}, CURRENT_TIMESTAMP)
       ON CONFLICT(match_id) DO UPDATE SET
         replay_json = excluded.replay_json,
         replay_bytes = excluded.replay_bytes,
         event_count = excluded.event_count,
         expires_at = excluded.expires_at,
         updated_at = CURRENT_TIMESTAMP`
    )
    .run(matchId, replayJson, replayBytes, eventCount, REPLAY_RETENTION_DAYS);
  return replayJson;
};

export const loadArenaMatchReplayJson = async (matchId: string, legacyReplayJson?: unknown): Promise<unknown | null> => {
  await ensureArenaReplayTable();
  const query = `SELECT replay_json
    FROM arena_match_replays
    WHERE match_id = ?
      AND (expires_at IS NULL OR expires_at > ${getDbMode() === 'MYSQL' ? 'UTC_TIMESTAMP()' : "datetime('now')"})
    LIMIT 1`;
  const row = getDbMode() === 'MYSQL'
    ? await getMysqlDb().get<any>(query, matchId)
    : getSqliteDb().prepare(query).get(matchId) as any;
  return row?.replay_json || legacyReplayJson || null;
};

const parseJson = <T>(raw: unknown, fallback: T): T => {
  if (raw === null || raw === undefined || raw === '') return fallback;
  if (typeof raw === 'object') return raw as T;

  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};

const hashInt = (input: string): number => parseInt(createHash('sha256').update(input).digest('hex').slice(0, 8), 16);

export const clearArenaMatchCaches = () => {
  botPoolCache = null;
  botPoolInFlight = null;
  rankingCache.clear();
};

export const ensureArenaMatchTables = async () => {
  if (ensureTablesPromise) return ensureTablesPromise;

  ensureTablesPromise = (async () => {
    const mode = getDbMode();
    if (mode === 'MYSQL') {
      const db = getMysqlDb();
      await db.run(`
        CREATE TABLE IF NOT EXISTS arena_matches (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          season_id VARCHAR(64) NOT NULL,
          match_type VARCHAR(32) NOT NULL,
          match_format VARCHAR(32) NOT NULL DEFAULT 'best_of_five',
          rounds_to_win TINYINT NOT NULL DEFAULT 3,
          round_count TINYINT NOT NULL,
          player_a_id VARCHAR(191) NOT NULL,
          player_b_id VARCHAR(191) NULL,
          player_a_deck_id BIGINT NULL,
          winner_user_id VARCHAR(191) NULL,
          player_a_round_wins TINYINT NOT NULL DEFAULT 0,
          player_b_round_wins TINYINT NOT NULL DEFAULT 0,
          draw_rounds TINYINT NOT NULL DEFAULT 0,
          difficulty VARCHAR(16) NOT NULL DEFAULT 'normal',
          summary_json JSON NOT NULL,
          progress_status VARCHAR(24) NOT NULL DEFAULT 'COMPLETED',
          pending_round_deadline_at DATETIME NULL,
          replay_json JSON NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_arena_matches_player_a (player_a_id, created_at),
          INDEX idx_arena_matches_player_b (player_b_id, created_at),
          INDEX idx_arena_matches_season_created (season_id, created_at),
          INDEX idx_arena_matches_type_created (match_type, created_at),
          INDEX idx_arena_matches_season_type_id (season_id, match_type, id),
          INDEX idx_arena_matches_pair_a_recent (season_id, match_type, player_a_id, created_at),
          INDEX idx_arena_matches_pair_b_recent (season_id, match_type, player_b_id, created_at),
          INDEX idx_arena_matches_round_recovery (season_id, progress_status, pending_round_deadline_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await db.run(`ALTER TABLE arena_matches ADD INDEX idx_arena_matches_player_b (player_b_id, created_at)`).catch(() => undefined);
      await db.run(`ALTER TABLE arena_matches ADD INDEX idx_arena_matches_season_type_id (season_id, match_type, id)`).catch(() => undefined);
      await db.run(`ALTER TABLE arena_matches ADD INDEX idx_arena_matches_pair_a_recent (season_id, match_type, player_a_id, created_at)`).catch(() => undefined);
      await db.run(`ALTER TABLE arena_matches ADD INDEX idx_arena_matches_pair_b_recent (season_id, match_type, player_b_id, created_at)`).catch(() => undefined);
      await db.run(`ALTER TABLE arena_matches ADD COLUMN progress_status VARCHAR(24) NOT NULL DEFAULT 'COMPLETED'`).catch(() => undefined);
      await db.run(`ALTER TABLE arena_matches ADD COLUMN pending_round_deadline_at DATETIME NULL`).catch(() => undefined);
      await db.run(`ALTER TABLE arena_matches ADD INDEX idx_arena_matches_round_recovery (season_id, progress_status, pending_round_deadline_at)`).catch(() => undefined);
      await db.run(`
        CREATE TABLE IF NOT EXISTS arena_player_ratings (
          season_id VARCHAR(64) NOT NULL,
          user_id VARCHAR(191) NOT NULL,
          mmr INT NOT NULL DEFAULT 1000,
          rating_points INT NOT NULL DEFAULT 0,
          tier VARCHAR(32) NOT NULL DEFAULT 'BRONZE',
          wins INT NOT NULL DEFAULT 0,
          losses INT NOT NULL DEFAULT 0,
          draws INT NOT NULL DEFAULT 0,
          last_played_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (season_id, user_id),
          INDEX idx_arena_rating_points (season_id, rating_points),
          INDEX idx_arena_rating_mmr (season_id, mmr)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await db.run(`
        CREATE TABLE IF NOT EXISTS arena_rank_snapshots (
          season_id VARCHAR(64) NOT NULL,
          rank_type VARCHAR(32) NOT NULL,
          rank_no INT NOT NULL,
          user_id VARCHAR(191) NOT NULL,
          score INT NOT NULL DEFAULT 0,
          payload_json JSON NOT NULL,
          snapshot_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (season_id, rank_type, rank_no),
          UNIQUE KEY uniq_arena_rank_user (season_id, rank_type, user_id),
          INDEX idx_arena_rank_score (season_id, rank_type, score)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      return;
    }

    if (mode === 'LOCAL_SQL') {
      const db = getSqliteDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS arena_matches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          season_id TEXT NOT NULL,
          match_type TEXT NOT NULL,
          match_format TEXT NOT NULL DEFAULT 'best_of_five',
          rounds_to_win INTEGER NOT NULL DEFAULT 3,
          round_count INTEGER NOT NULL,
          player_a_id TEXT NOT NULL,
          player_b_id TEXT,
          player_a_deck_id INTEGER,
          winner_user_id TEXT,
          player_a_round_wins INTEGER NOT NULL DEFAULT 0,
          player_b_round_wins INTEGER NOT NULL DEFAULT 0,
          draw_rounds INTEGER NOT NULL DEFAULT 0,
          difficulty TEXT NOT NULL DEFAULT 'normal',
          summary_json TEXT NOT NULL,
          progress_status TEXT NOT NULL DEFAULT 'COMPLETED',
          pending_round_deadline_at TEXT,
          replay_json TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_arena_matches_player_a ON arena_matches (player_a_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_arena_matches_player_b ON arena_matches (player_b_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_arena_matches_season_created ON arena_matches (season_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_arena_matches_type_created ON arena_matches (match_type, created_at);
        CREATE INDEX IF NOT EXISTS idx_arena_matches_season_type_id ON arena_matches (season_id, match_type, id);
        CREATE INDEX IF NOT EXISTS idx_arena_matches_pair_a_recent ON arena_matches (season_id, match_type, player_a_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_arena_matches_pair_b_recent ON arena_matches (season_id, match_type, player_b_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_arena_matches_round_recovery ON arena_matches (season_id, progress_status, pending_round_deadline_at);

        CREATE TABLE IF NOT EXISTS arena_player_ratings (
          season_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          mmr INTEGER NOT NULL DEFAULT 1000,
          rating_points INTEGER NOT NULL DEFAULT 0,
          tier TEXT NOT NULL DEFAULT 'BRONZE',
          wins INTEGER NOT NULL DEFAULT 0,
          losses INTEGER NOT NULL DEFAULT 0,
          draws INTEGER NOT NULL DEFAULT 0,
          last_played_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (season_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_arena_rating_points ON arena_player_ratings (season_id, rating_points);
        CREATE INDEX IF NOT EXISTS idx_arena_rating_mmr ON arena_player_ratings (season_id, mmr);

        CREATE TABLE IF NOT EXISTS arena_rank_snapshots (
          season_id TEXT NOT NULL,
          rank_type TEXT NOT NULL,
          rank_no INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          score INTEGER NOT NULL DEFAULT 0,
          payload_json TEXT NOT NULL,
          snapshot_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (season_id, rank_type, rank_no)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_arena_rank_user ON arena_rank_snapshots (season_id, rank_type, user_id);
        CREATE INDEX IF NOT EXISTS idx_arena_rank_score ON arena_rank_snapshots (season_id, rank_type, score);
      `);
      const columns = db.prepare(`PRAGMA table_info(arena_matches)`).all() as Array<{ name: string }>;
      if (!columns.some((item) => item.name === 'progress_status')) db.prepare(`ALTER TABLE arena_matches ADD COLUMN progress_status TEXT NOT NULL DEFAULT 'COMPLETED'`).run();
      if (!columns.some((item) => item.name === 'pending_round_deadline_at')) db.prepare(`ALTER TABLE arena_matches ADD COLUMN pending_round_deadline_at TEXT`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_arena_matches_round_recovery ON arena_matches (season_id, progress_status, pending_round_deadline_at)`).run();
      return;
    }

    throw new Error('ArenaMatchStorageUnsupported');
  })().catch((err) => {
    ensureTablesPromise = null;
    throw err;
  });

  return ensureTablesPromise;
};

const ensureArenaReplayTable = async () => {
  if (ensureReplayTablePromise) return ensureReplayTablePromise;
  ensureReplayTablePromise = (async () => {
    await ensureArenaMatchTables();
    if (getDbMode() === 'MYSQL') {
      await getMysqlDb().run(`
        CREATE TABLE IF NOT EXISTS arena_match_replays (
          match_id BIGINT NOT NULL PRIMARY KEY,
          replay_json JSON NOT NULL,
          replay_bytes INT NOT NULL DEFAULT 0,
          event_count INT NOT NULL DEFAULT 0,
          expires_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_arena_match_replays_expire (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      return;
    }
    if (getDbMode() === 'LOCAL_SQL') {
      getSqliteDb().exec(`
        CREATE TABLE IF NOT EXISTS arena_match_replays (
          match_id INTEGER NOT NULL PRIMARY KEY,
          replay_json TEXT NOT NULL,
          replay_bytes INTEGER NOT NULL DEFAULT 0,
          event_count INTEGER NOT NULL DEFAULT 0,
          expires_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_arena_match_replays_expire ON arena_match_replays (expires_at);
      `);
      return;
    }
    throw new Error('ArenaReplayStorageUnsupported');
  })().catch((err) => {
    ensureReplayTablePromise = null;
    throw err;
  });
  return ensureReplayTablePromise;
};

const normalizeDifficulty = (value: unknown): ArenaMatchDifficulty => {
  const normalized = String(value || 'normal').trim().toLowerCase();
  if (normalized === 'easy' || normalized === 'normal' || normalized === 'hard') return normalized;
  return 'normal';
};

const allowedTacticStyles = new Set(['balanced', 'aggressive', 'guard', 'hold', 'tempo', 'counter', 'finisher']);
const allowedFocusRules = new Set(['frontline_first', 'backline_first', 'lowest_hp', 'highest_attack']);

const normalizeTacticStyle = (value: unknown, fallback = 'balanced') => {
  const normalized = String(value || fallback).trim();
  return allowedTacticStyles.has(normalized) ? normalized : fallback;
};

const normalizeFocusRule = (value: unknown, fallback = 'frontline_first') => {
  const normalized = String(value || fallback).trim();
  return allowedFocusRules.has(normalized) ? normalized : fallback;
};

const normalizeStrategyChipId = (value: unknown, fallback = 'none') => {
  const normalized = String(value || fallback).trim();
  return ARENA_TACTIC_CHIPS.some((chip) => chip.id === normalized) ? normalized : fallback;
};

const sanitizeRoundPlanSlots = (value: unknown): ArenaRoundPlanSlotDto[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const slots: ArenaRoundPlanSlotDto[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const cardId = String((raw as any).card_id || '').trim();
    if (!cardId || seen.has(cardId)) continue;
    seen.add(cardId);
    const rowValue = Number((raw as any).row);
    const colValue = Number((raw as any).col);
    slots.push({
      card_id: cardId,
      channel_id: typeof (raw as any).channel_id === 'string' ? String((raw as any).channel_id).trim() : undefined,
      row: (Number.isInteger(rowValue) && rowValue >= 0 && rowValue <= 1 ? rowValue : slots.length < 3 ? 1 : 0) as 0 | 1,
      col: (Number.isInteger(colValue) && colValue >= 0 && colValue <= 2 ? colValue : slots.length % 3) as 0 | 1 | 2
    });
    if (slots.length >= 6) break;
  }
  return slots.length > 0 ? slots : undefined;
};

const sanitizeRoundCommitInput = (input: ArenaRoundCommitInput): ArenaRoundCommitInput => ({
  round_no: input.round_no,
  tactic_style: normalizeTacticStyle(input.tactic_style),
  focus_rule: normalizeFocusRule(input.focus_rule),
  strategy_chip_id: normalizeStrategyChipId(input.strategy_chip_id),
  auto_commit: input.auto_commit === true,
  slots: sanitizeRoundPlanSlots(input.slots)
});

const getSummaryProgressStatus = (summary: ArenaCompactMatchSummary, row?: Pick<RawMatchRow, 'round_count' | 'player_a_round_wins' | 'player_b_round_wins' | 'progress_status'>) => {
  const normalizedRowStatus = String(row?.progress_status || '').trim().toLowerCase();
  if (normalizedRowStatus === 'in_progress' || normalizedRowStatus === 'completed') return normalizedRowStatus;
  const normalizedStatus = String(summary.progress_status || '').trim().toLowerCase();
  if (normalizedStatus === 'in_progress' || normalizedStatus === 'completed') return normalizedStatus;
  const playerWins = Number(row?.player_a_round_wins || 0);
  const opponentWins = Number(row?.player_b_round_wins || 0);
  const roundCount = Number(row?.round_count ?? summary.round_results?.length ?? 0);
  return playerWins >= ARENA_ROUNDS_TO_WIN || opponentWins >= ARENA_ROUNDS_TO_WIN || roundCount >= ARENA_MAX_ROUNDS_PER_MATCH
    ? 'completed'
    : 'in_progress';
};

const getFallbackRoundPlan = (deck: ArenaDeckSnapshot, roundNo: number) => {
  const plans = Array.isArray(deck.round_plans) ? deck.round_plans : [];
  return plans.find((plan) => plan.round_no === roundNo) || plans[Math.min(roundNo - 1, Math.max(0, plans.length - 1))];
};

const withCommittedRoundPlan = (
  deck: ArenaDeckSnapshot,
  roundNo: number,
  input: ArenaRoundCommitInput
): ArenaDeckSnapshot => {
  const fallbackPlan = getFallbackRoundPlan(deck, roundNo);
  const firstPlan = getFallbackRoundPlan(deck, 1);
  const tacticStyle = normalizeTacticStyle(input.tactic_style, fallbackPlan?.tactic_style || 'balanced');
  const focusRule = normalizeFocusRule(input.focus_rule, fallbackPlan?.focus_rule || 'frontline_first');
  const baseSlots = Array.isArray(fallbackPlan?.slots) && fallbackPlan.slots.length > 0
    ? fallbackPlan.slots
    : Array.isArray(firstPlan?.slots)
      ? firstPlan.slots
      : deck.cards.slice(0, 6).map((card, index) => ({
          card_id: card.card_id,
          channel_id: card.channel_id,
          row: (index < 3 ? 1 : 0) as 0 | 1,
          col: (index % 3) as 0 | 1 | 2 | 3
        }));
  const deckCardsById = new Map(deck.cards.map((card) => [card.card_id, card]));
  const committedSlots = sanitizeRoundPlanSlots(input.slots)
    ?.filter((slot) => deckCardsById.has(slot.card_id))
    .slice(0, 6)
    .map((slot, index) => {
      const card = deckCardsById.get(slot.card_id)!;
      return {
        card_id: card.card_id,
        channel_id: card.channel_id,
        row: (Number.isInteger(slot.row) && slot.row >= 0 && slot.row <= 1 ? slot.row : index < 3 ? 1 : 0) as 0 | 1,
        col: (Number.isInteger(slot.col) && slot.col >= 0 && slot.col <= 2 ? slot.col : index % 3) as 0 | 1 | 2
      };
    });
  const roundPlan = {
    round_no: Math.min(ARENA_MAX_ROUNDS_PER_MATCH, Math.max(1, roundNo)) as any,
    formation_id: fallbackPlan?.formation_id || 'round-commit-2x4',
    tactic_style: tacticStyle,
    focus_rule: focusRule,
    slots: committedSlots && committedSlots.length >= 6 ? committedSlots : baseSlots
  };
  const otherPlans = (deck.round_plans || []).filter((plan) => plan.round_no !== roundNo);
  return {
    ...deck,
    strategy_chip_id: normalizeStrategyChipId(input.strategy_chip_id, deck.strategy_chip_id || 'none'),
    round_plans: [...otherPlans, roundPlan].sort((a, b) => a.round_no - b.round_no)
  };
};

const loadBotCardPool = async (): Promise<ArenaGeneratedCard[]> => {
  const now = Date.now();
  if (botPoolCache && botPoolCache.expiresAt > now) return botPoolCache.cards;
  if (botPoolInFlight) return botPoolInFlight;

  botPoolInFlight = Promise.all([streamerRepository.findAll(), listArenaStreamerCardStates()])
    .then(([streamers, streamerCardStates]) => {
      const cards = streamers
        .filter((streamer) => streamer.channel_id && streamer.name && streamerCardStates[streamer.channel_id]?.is_enabled !== false)
        .map((streamer) => generateArenaCardFromStreamer(streamer, {
          arenaEnabled: true,
          config: streamerCardStates[streamer.channel_id]?.config || null
        }));
      botPoolCache = { cards, expiresAt: Date.now() + BOT_POOL_CACHE_TTL_MS };
      return cards;
    })
    .finally(() => {
      botPoolInFlight = null;
    });

  return botPoolInFlight;
};

const toDeckSnapshotCard = (card: ArenaGeneratedCard): ArenaDeckSnapshot['cards'][number] => ({
  card_id: card.card_id,
  channel_id: card.channel_id,
  name: card.name,
  image_url: card.image_url,
  class_id: String(card.class.id),
  class_name: card.class.name,
  class_role: card.class.role,
  stats: card.stats,
  skills: card.skills.map((skill) => ({ id: skill.id, name: skill.name, type: skill.type }))
});

export const loadArenaDeckSnapshot = async (deck: ArenaDeck): Promise<ArenaDeckSnapshot> => {
  const pool = await loadBotCardPool();
  const cardByChannel = new Map(pool.map((card) => [card.channel_id, card]));
  const cards = deck.cards
    .map((card) => cardByChannel.get(card.channel_id))
    .filter((card): card is ArenaGeneratedCard => Boolean(card))
    .map(toDeckSnapshotCard);

  return {
    deck_id: deck.id,
    name: deck.name,
    cards,
    round_plans: deck.round_plans,
    strategy_chip_id: deck.strategy_chip_id
  };
};

const buildBotDeck = async (playerDeck: ArenaDeck, difficulty: ArenaMatchDifficulty): Promise<ArenaDeckSnapshot> => {
  const pool = await loadBotCardPool();
  const excluded = new Set(playerDeck.cards.map((card) => card.channel_id));
  const candidates = pool.filter((card) => !excluded.has(card.channel_id));
  const source = candidates.length >= 6 ? candidates : pool;
  const seed = `${playerDeck.deck_hash}:${difficulty}:${Date.now()}`;
  const sorted = [...source].sort((a, b) => hashInt(`${seed}:${a.channel_id}`) - hashInt(`${seed}:${b.channel_id}`));
  const picked = sorted.slice(0, 6);

  return {
    deck_id: `bot-${difficulty}`,
    name: difficulty === 'easy' ? '연습 봇 쉬움' : difficulty === 'hard' ? '연습 봇 어려움' : '연습 봇 보통',
    cards: picked.map(toDeckSnapshotCard),
    strategy_chip_id: 'none',
    round_plans: [
      {
        round_no: 1,
        formation_id: 'bot-default-2x4',
        tactic_style: 'balanced',
        focus_rule: 'frontline_first',
        slots: picked.slice(0, 6).map((card, index) => ({
          card_id: card.card_id,
          channel_id: card.channel_id,
          row: (index < 3 ? 1 : 0) as 0 | 1,
          col: (index % 3) as 0 | 1 | 2 | 3
        }))
      }
    ]
  };
};

const calcEloDelta = (ratingA: number, ratingB: number, scoreA: number) => {
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  return Math.round(RANKED_ELO_K * (scoreA - expectedA));
};

const ratingPatch = (rating: any, delta: number, result: 'win' | 'loss' | 'draw') => ({
  mmr: Math.max(0, Number(rating?.mmr || 1000) + delta),
  rating_points: Math.max(0, Number(rating?.rating_points || 0) + delta),
  wins: result === 'win' ? 1 : 0,
  losses: result === 'loss' ? 1 : 0,
  draws: result === 'draw' ? 1 : 0
});

const loadArenaRatingRow = async (userId: string) => {
  const fallback = {
    user_id: userId,
    mmr: 1000,
    rating_points: 0,
    tier: 'BRONZE',
    wins: 0,
    losses: 0,
    draws: 0
  };
  const query = `SELECT user_id, mmr, rating_points, tier, wins, losses, draws
    FROM arena_player_ratings
    WHERE season_id = ? AND user_id = ?
    LIMIT 1`;
  const row = getDbMode() === 'MYSQL'
    ? await getMysqlDb().get<any>(query, getArenaCurrentSeasonId(), userId)
    : getSqliteDb().prepare(query).get(getArenaCurrentSeasonId(), userId) as any;
  return row ? { ...fallback, ...row } : fallback;
};

const upsertArenaRatingMysql = async (
  runner: { run: (sql: string, ...args: any[]) => any },
  userId: string,
  patch: ReturnType<typeof ratingPatch>
) => {
  await runner.run(
    `INSERT INTO arena_player_ratings
      (season_id, user_id, mmr, rating_points, tier, wins, losses, draws, last_played_at)
     VALUES (?, ?, ?, ?, 'BRONZE', ?, ?, ?, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       mmr = VALUES(mmr),
       rating_points = VALUES(rating_points),
       wins = wins + VALUES(wins),
       losses = losses + VALUES(losses),
       draws = draws + VALUES(draws),
       last_played_at = UTC_TIMESTAMP()`,
    getArenaCurrentSeasonId(),
    userId,
    patch.mmr,
    patch.rating_points,
    patch.wins,
    patch.losses,
    patch.draws
  );
};

const upsertArenaRatingSqlite = (userId: string, patch: ReturnType<typeof ratingPatch>) => {
  getSqliteDb()
    .prepare(
      `INSERT INTO arena_player_ratings
        (season_id, user_id, mmr, rating_points, tier, wins, losses, draws, last_played_at, updated_at)
       VALUES (?, ?, ?, ?, 'BRONZE', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(season_id, user_id) DO UPDATE SET
         mmr = excluded.mmr,
         rating_points = excluded.rating_points,
         wins = arena_player_ratings.wins + excluded.wins,
         losses = arena_player_ratings.losses + excluded.losses,
         draws = arena_player_ratings.draws + excluded.draws,
         last_played_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`
    )
    .run(
      getArenaCurrentSeasonId(),
      userId,
      patch.mmr,
      patch.rating_points,
      patch.wins,
      patch.losses,
      patch.draws
    );
};

const reflectRankedRatingIfCompleted = async (matchId: string) => {
  await ensureArenaMatchTables();
  const row = getDbMode() === 'MYSQL'
    ? await getMysqlDb().get<RawMatchRow>(`SELECT ${ARENA_MATCH_SUMMARY_COLUMNS} FROM arena_matches WHERE id = ? LIMIT 1`, matchId)
    : getSqliteDb().prepare(`SELECT ${ARENA_MATCH_SUMMARY_COLUMNS} FROM arena_matches WHERE id = ? LIMIT 1`).get(matchId) as RawMatchRow | undefined;
  if (!row || row.match_type !== 'RANKED' || !row.player_b_id) return;

  const summary = parseJson<ArenaCompactMatchSummary>(row.summary_json, {
    round_results: [],
    player_deck: { deck_id: '', name: '', cards: [], round_plans: [] },
    bot_deck: { deck_id: '', name: '', cards: [], round_plans: [] },
    rating_delta: 0,
    mmr_reflected: false
  } as ArenaCompactMatchSummary);
  if (summary.mmr_reflected) return;

  const playerWins = Number(row.player_a_round_wins || 0);
  const opponentWins = Number(row.player_b_round_wins || 0);
  const roundCount = Number(row.round_count || 0);
  const completed = playerWins >= ARENA_ROUNDS_TO_WIN || opponentWins >= ARENA_ROUNDS_TO_WIN || roundCount >= ARENA_MAX_ROUNDS_PER_MATCH;
  if (!completed) return;

  const ratingWritesEnabled = getArenaOpsConfigSync().ranked_rating_writes;
  const [ratingA, ratingB] = await Promise.all([
    loadArenaRatingRow(row.player_a_id),
    loadArenaRatingRow(row.player_b_id)
  ]);
  const winnerUserId = row.winner_user_id;
  const scoreA = winnerUserId === row.player_a_id ? 1 : winnerUserId === row.player_b_id ? 0 : 0.5;
  const deltaA = ratingWritesEnabled ? calcEloDelta(Number(ratingA.mmr || 1000), Number(ratingB.mmr || 1000), scoreA) : 0;
  const deltaB = -deltaA;
  const patchA = ratingPatch(ratingA, deltaA, scoreA === 1 ? 'win' : scoreA === 0 ? 'loss' : 'draw');
  const patchB = ratingPatch(ratingB, deltaB, scoreA === 0 ? 'win' : scoreA === 1 ? 'loss' : 'draw');
  const nextSummary: ArenaCompactMatchSummary = {
    ...summary,
    progress_status: 'completed',
    rating_delta: { player_a: deltaA, player_b: deltaB },
    mmr_reflected: ratingWritesEnabled
  };

  if (getDbMode() === 'MYSQL') {
    await getMysqlDb().transaction(async (tx) => {
      await tx.run(`UPDATE arena_matches SET summary_json = ? WHERE id = ?`, JSON.stringify(nextSummary), matchId);
      if (ratingWritesEnabled) {
        await upsertArenaRatingMysql(tx, row.player_a_id, patchA);
        await upsertArenaRatingMysql(tx, row.player_b_id!, patchB);
      }
    });
  } else {
    const db = getSqliteDb();
    db.transaction(() => {
      db.prepare(`UPDATE arena_matches SET summary_json = ? WHERE id = ?`).run(JSON.stringify(nextSummary), matchId);
      if (ratingWritesEnabled) {
        upsertArenaRatingSqlite(row.player_a_id, patchA);
        upsertArenaRatingSqlite(row.player_b_id!, patchB);
      }
    })();
  }

  rankingCache.clear();
};

export const createPendingRankedArenaMatch = async (input: {
  playerAId: string;
  playerBId: string;
  playerADeckId: string;
  playerADeck: ArenaDeckSnapshot;
  playerBDeck: ArenaDeckSnapshot;
  matchSeed: string;
  battlefieldRule?: { id: string; name: string; description: string };
}) => {
  await ensureArenaMatchTables();
  const battlefieldRule = input.battlefieldRule || pickArenaBattlefieldRule(input.matchSeed);
  const firstRoundDeadlineAt = new Date(Date.now() + ROUND_SELECTION_TIMEOUT_MS).toISOString();
  const summary: ArenaCompactMatchSummary = {
    progress_status: 'in_progress',
    current_round_no: 1,
    rounds_to_win: ARENA_ROUNDS_TO_WIN,
    max_rounds: ARENA_MAX_ROUNDS_PER_MATCH,
    match_seed: input.matchSeed,
    opponent_power_multiplier: 1,
    round_results: [],
    player_deck: input.playerADeck,
    bot_deck: input.playerBDeck,
    opponent_deck: input.playerBDeck,
    battlefield_rule: battlefieldRule,
    pending_round_input: { round_no: 1, deadline_at: firstRoundDeadlineAt },
    rating_delta: { player_a: 0, player_b: 0 },
    mmr_reflected: false
  };
  const summaryJson = JSON.stringify(summary);

  if (getDbMode() === 'MYSQL') {
    const result = await getMysqlDb().run(
      `INSERT INTO arena_matches
        (season_id, match_type, match_format, rounds_to_win, round_count, player_a_id, player_b_id,
         player_a_deck_id, winner_user_id, player_a_round_wins, player_b_round_wins, draw_rounds,
         difficulty, summary_json, progress_status, pending_round_deadline_at, replay_json)
       VALUES (?, 'RANKED', ?, ?, 0, ?, ?, ?, NULL, 0, 0, 0, 'normal', ?, 'IN_PROGRESS', ${dbNowPlusRoundSelectionSql()}, ?)`,
      getArenaCurrentSeasonId(),
      ARENA_MATCH_FORMAT,
      ARENA_ROUNDS_TO_WIN,
      input.playerAId,
      input.playerBId,
      input.playerADeckId,
      summaryJson,
      ROUND_SELECTION_TIMEOUT_SECONDS,
      null
    );
    return String(result.insertId);
  }

  const result = getSqliteDb()
    .prepare(
      `INSERT INTO arena_matches
        (season_id, match_type, match_format, rounds_to_win, round_count, player_a_id, player_b_id,
         player_a_deck_id, winner_user_id, player_a_round_wins, player_b_round_wins, draw_rounds,
         difficulty, summary_json, progress_status, pending_round_deadline_at, replay_json)
       VALUES (?, 'RANKED', ?, ?, 0, ?, ?, ?, NULL, 0, 0, 0, 'normal', ?, 'IN_PROGRESS', ${dbNowPlusRoundSelectionSql()}, ?)`
    )
    .run(
      getArenaCurrentSeasonId(),
      ARENA_MATCH_FORMAT,
      ARENA_ROUNDS_TO_WIN,
      input.playerAId,
      input.playerBId,
      input.playerADeckId,
      summaryJson,
      ROUND_SELECTION_TIMEOUT_SECONDS,
      null
    );
  return String(result.lastInsertRowid);
};

const mapMatchRow = (row: RawMatchRow, viewerUserId?: string): ArenaMatchSummary => {
  const summary = parseJson<ArenaCompactMatchSummary>(row.summary_json, {
    progress_status: 'completed',
    current_round_no: Number(row.round_count || 0) + 1,
    rounds_to_win: ARENA_ROUNDS_TO_WIN,
    max_rounds: ARENA_MAX_ROUNDS_PER_MATCH,
    round_results: [],
    player_deck: { deck_id: '', name: '', cards: [], round_plans: [] },
    bot_deck: { deck_id: '', name: '', cards: [], round_plans: [] },
    rating_delta: 0,
    mmr_reflected: false
  });
  const viewerIsPlayerB = Boolean(viewerUserId && row.player_b_id === viewerUserId);
  if (viewerIsPlayerB && summary.opponent_deck) {
    const originalPlayerDeck = summary.player_deck;
    summary.player_deck = summary.opponent_deck;
    summary.opponent_deck = originalPlayerDeck;
    summary.bot_deck = originalPlayerDeck;
    summary.rating_delta = summary.rating_delta && typeof summary.rating_delta === 'object'
      ? { player_a: summary.rating_delta.player_b, player_b: summary.rating_delta.player_a }
      : summary.rating_delta;
  }
  const viewerWins = viewerIsPlayerB ? Number(row.player_b_round_wins || 0) : Number(row.player_a_round_wins || 0);
  const opponentWins = viewerIsPlayerB ? Number(row.player_a_round_wins || 0) : Number(row.player_b_round_wins || 0);
  const progressStatus = getSummaryProgressStatus(summary, row);
  summary.progress_status = progressStatus;
  summary.current_round_no = progressStatus === 'completed'
    ? Math.min(ARENA_MAX_ROUNDS_PER_MATCH, Number(row.round_count || summary.round_results.length || 0))
    : Math.min(ARENA_MAX_ROUNDS_PER_MATCH, Number(row.round_count || summary.round_results.length || 0) + 1);
  summary.rounds_to_win = summary.rounds_to_win || ARENA_ROUNDS_TO_WIN;
  summary.max_rounds = summary.max_rounds || ARENA_MAX_ROUNDS_PER_MATCH;
  const result = progressStatus === 'in_progress'
    ? null
    : viewerWins > opponentWins ? 'win' : opponentWins > viewerWins ? 'loss' : 'draw';

  return {
    id: String(row.id),
    season_id: row.season_id,
    match_type: row.match_type === 'RANKED' ? 'RANKED' : 'BOT_PRACTICE',
    match_format: ARENA_MATCH_FORMAT,
    rounds_to_win: ARENA_ROUNDS_TO_WIN,
    round_count: Number(row.round_count || 0),
    player_a_id: row.player_a_id,
    player_b_id: row.player_b_id,
    winner_user_id: row.winner_user_id,
    player_a_round_wins: Number(row.player_a_round_wins || 0),
    player_b_round_wins: Number(row.player_b_round_wins || 0),
    draw_rounds: Number(row.draw_rounds || 0),
    result,
    difficulty: normalizeDifficulty(row.difficulty),
    summary,
    created_at: row.created_at
  };
};

export const createArenaBotMatch = async (
  userId: string,
  deckId: string,
  difficultyInput: unknown
): Promise<ArenaMatchSummary> => {
  await ensureArenaMatchTables();
  const difficulty = normalizeDifficulty(difficultyInput);
  const storedDeck = await getArenaDeck(userId, deckId);
  if (!storedDeck) throw new Error('ArenaDeckNotFound');
  const validation = await validateArenaDeckInput(storedDeck, storedDeck.user_id);
  if (!validation.valid) {
    const err = new Error('ArenaDeckValidationFailed') as Error & { validation?: unknown };
    err.validation = validation;
    throw err;
  }
  const deck: ArenaDeck = {
    ...storedDeck,
    validation_status: 'VALID',
    validation_result: validation
  };

  const playerDeck = await loadArenaDeckSnapshot(deck);
  if (playerDeck.cards.length < 6) throw new Error('ArenaDeckSnapshotInvalid');
  const botDeck = await buildBotDeck(deck, difficulty);
  if (botDeck.cards.length < 6) throw new Error('ArenaBotPoolInsufficient');
  const difficultyMultiplier = difficulty === 'easy' ? 0.94 : difficulty === 'hard' ? 1.08 : 1;
  const matchSeed = createHash('sha256')
    .update(`${getArenaCurrentSeasonId()}:${userId}:${deck.id}:${botDeck.deck_id}:${difficulty}:${Date.now()}`)
    .digest('hex');
  const battlefieldRule = pickArenaBattlefieldRule(matchSeed);
  const summary: ArenaCompactMatchSummary = {
    progress_status: 'in_progress',
    current_round_no: 1,
    rounds_to_win: ARENA_ROUNDS_TO_WIN,
    max_rounds: ARENA_MAX_ROUNDS_PER_MATCH,
    match_seed: matchSeed,
    opponent_power_multiplier: difficultyMultiplier,
    round_results: [],
    player_deck: playerDeck,
    bot_deck: botDeck,
    battlefield_rule: battlefieldRule,
    rating_delta: 0,
    mmr_reflected: false
  };
  const summaryJson = JSON.stringify(summary);

  if (getDbMode() === 'MYSQL') {
    const result = await getMysqlDb().run(
      `INSERT INTO arena_matches
        (season_id, match_type, match_format, rounds_to_win, round_count, player_a_id, player_b_id,
         player_a_deck_id, winner_user_id, player_a_round_wins, player_b_round_wins, draw_rounds,
         difficulty, summary_json, progress_status, pending_round_deadline_at, replay_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'IN_PROGRESS', NULL, ?)`,
      getArenaCurrentSeasonId(),
      'BOT_PRACTICE',
      ARENA_MATCH_FORMAT,
      ARENA_ROUNDS_TO_WIN,
      0,
      userId,
      null,
      deck.id,
      null,
      0,
      0,
      0,
      difficulty,
      summaryJson,
      null
    );
    const stored = await getArenaMatchForUser(userId, String(result.insertId));
    if (!stored) throw new Error('ArenaMatchCreateReadbackFailed');
    return stored;
  }

  const result = getSqliteDb()
    .prepare(
      `INSERT INTO arena_matches
        (season_id, match_type, match_format, rounds_to_win, round_count, player_a_id, player_b_id,
         player_a_deck_id, winner_user_id, player_a_round_wins, player_b_round_wins, draw_rounds,
         difficulty, summary_json, progress_status, pending_round_deadline_at, replay_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'IN_PROGRESS', NULL, ?)`
    )
    .run(
      getArenaCurrentSeasonId(),
      'BOT_PRACTICE',
      ARENA_MATCH_FORMAT,
      ARENA_ROUNDS_TO_WIN,
      0,
      userId,
      null,
      deck.id,
      null,
      0,
      0,
      0,
      difficulty,
      summaryJson,
      null
    );
  const stored = await getArenaMatchForUser(userId, String(result.lastInsertRowid));
  if (!stored) throw new Error('ArenaMatchCreateReadbackFailed');
  return stored;
};

const getArenaMatchRowForUser = async (userId: string, matchId: string): Promise<RawMatchRow | null> => {
  await ensureArenaMatchTables();
  if (getDbMode() === 'MYSQL') {
    const row = await getMysqlDb().get<RawMatchRow>(
      `SELECT ${ARENA_MATCH_WITH_REPLAY_COLUMNS} FROM arena_matches WHERE id = ? AND (player_a_id = ? OR player_b_id = ?) LIMIT 1`,
      matchId,
      userId,
      userId
    );
    return row || null;
  }

  const row = getSqliteDb()
    .prepare(`SELECT ${ARENA_MATCH_WITH_REPLAY_COLUMNS} FROM arena_matches WHERE id = ? AND (player_a_id = ? OR player_b_id = ?) LIMIT 1`)
    .get(matchId, userId, userId) as RawMatchRow | undefined;
  return row || null;
};

export const commitArenaMatchRound = async (
  userId: string,
  matchId: string,
  input: ArenaRoundCommitInput
): Promise<{ match: ArenaMatchSummary; replay: ArenaReplayPayload | null; round_status?: { status: 'waiting' | 'committed'; deadline_at?: string; waiting_for?: 'player_a' | 'player_b' } }> => {
  const row = await getArenaMatchRowForUser(userId, matchId);
  if (!row) throw new Error('ArenaMatchNotFound');
  const isPlayerA = row.player_a_id === userId;
  const isPlayerB = row.player_b_id === userId;
  if (!isPlayerA && !isPlayerB) throw new Error('ArenaRoundCommitPlayerSideUnsupported');

  const summary = parseJson<ArenaCompactMatchSummary>(row.summary_json, {
    progress_status: 'completed',
    current_round_no: Number(row.round_count || 0) + 1,
    rounds_to_win: ARENA_ROUNDS_TO_WIN,
    max_rounds: ARENA_MAX_ROUNDS_PER_MATCH,
    round_results: [],
    player_deck: { deck_id: '', name: '', cards: [], round_plans: [] },
    bot_deck: { deck_id: '', name: '', cards: [], round_plans: [] },
    rating_delta: 0,
    mmr_reflected: false
  });
  const progressStatus = getSummaryProgressStatus(summary, row);
  if (progressStatus === 'completed') throw new Error('ArenaMatchAlreadyCompleted');

  const completedRoundCount = Number(row.round_count || summary.round_results.length || 0);
  const nextRoundNo = completedRoundCount + 1;
  if (nextRoundNo > ARENA_MAX_ROUNDS_PER_MATCH) throw new Error('ArenaMatchAlreadyCompleted');
  const requestedRoundNo = input.round_no == null ? nextRoundNo : Number(input.round_no);
  if (!Number.isInteger(requestedRoundNo) || requestedRoundNo !== nextRoundNo) throw new Error('ArenaRoundCommitOutOfOrder');
  if (!summary.player_deck?.cards?.length || !(summary.bot_deck || summary.opponent_deck)?.cards?.length || !summary.match_seed) {
    throw new Error('ArenaMatchRoundCommitStateInvalid');
  }

  const sideKey = isPlayerA ? 'player_a' : 'player_b';
  const opponentSideKey = isPlayerA ? 'player_b' : 'player_a';
  const isTwoPlayerMatch = Boolean(row.player_b_id);
  let effectivePlayerInput = input;
  let effectiveOpponentInput: ArenaRoundCommitInput = {};

  if (isTwoPlayerMatch) {
    const now = Date.now();
    const previousPending = summary.pending_round_input?.round_no === nextRoundNo
      ? summary.pending_round_input
      : row.pending_round_deadline_at
        ? { round_no: nextRoundNo, deadline_at: new Date(row.pending_round_deadline_at).toISOString() }
        : null;
    const deadlineAt = previousPending?.deadline_at || new Date(now + ROUND_SELECTION_TIMEOUT_MS).toISOString();
    const deadlinePassed = now >= new Date(deadlineAt).getTime();
    const nextPending = {
      round_no: nextRoundNo,
      deadline_at: deadlineAt,
      player_a: previousPending?.player_a,
      player_b: previousPending?.player_b,
      [sideKey]: sanitizeRoundCommitInput(input)
    };
    const hasBothInputs = Boolean(nextPending.player_a && nextPending.player_b);

    if (!hasBothInputs && !deadlinePassed) {
      const waitingSummary: ArenaCompactMatchSummary = {
        ...summary,
        progress_status: 'in_progress',
        current_round_no: nextRoundNo,
        pending_round_input: nextPending
      };
      let updated = 0;
      if (getDbMode() === 'MYSQL') {
        const result = await getMysqlDb().run(
          `UPDATE arena_matches
              SET summary_json = ?,
                  progress_status = 'IN_PROGRESS',
                  pending_round_deadline_at = ?
            WHERE id = ? AND (player_a_id = ? OR player_b_id = ?) AND round_count = ?`,
          JSON.stringify(waitingSummary),
          deadlineAt,
          matchId,
          userId,
          userId,
          completedRoundCount
        );
        updated = Number(result.affectedRows || 0);
      } else {
        const result = getSqliteDb()
          .prepare(
            `UPDATE arena_matches
                SET summary_json = ?,
                    progress_status = 'IN_PROGRESS',
                    pending_round_deadline_at = ?
              WHERE id = ? AND (player_a_id = ? OR player_b_id = ?) AND round_count = ?`
          )
          .run(JSON.stringify(waitingSummary), deadlineAt, matchId, userId, userId, completedRoundCount);
        updated = Number(result.changes || 0);
      }
      if (updated < 1) throw new Error('ArenaRoundCommitConflict');
      const match = await getArenaMatchForUser(userId, matchId);
      if (!match) throw new Error('ArenaMatchCommitReadbackFailed');
      return {
        match,
        replay: parseJson<ArenaReplayPayload | null>(await loadArenaMatchReplayJson(matchId, row.replay_json), null),
        round_status: {
          status: 'waiting',
          deadline_at: deadlineAt,
          waiting_for: opponentSideKey
        }
      };
    }

    effectivePlayerInput = nextPending.player_a || { auto_commit: true };
    effectiveOpponentInput = nextPending.player_b || { auto_commit: true };
  }

  const baseOpponentDeck = summary.bot_deck || summary.opponent_deck!;
  const committedPlayerDeck = withCommittedRoundPlan(summary.player_deck, nextRoundNo, effectivePlayerInput);
  const committedOpponentDeck = withCommittedRoundPlan(baseOpponentDeck, nextRoundNo, effectiveOpponentInput);
  const simulatedRound = simulateArenaRound({
    playerDeck: committedPlayerDeck,
    opponentDeck: committedOpponentDeck,
    opponentPowerMultiplier: Number(summary.opponent_power_multiplier || 1),
    matchSeed: summary.match_seed,
    battlefield_rule_id: summary.battlefield_rule?.id,
    roundNo: nextRoundNo
  });

  const roundResults = [...(summary.round_results || []), simulatedRound.result];
  const playerWins = Number(row.player_a_round_wins || 0) + (simulatedRound.result.winner_side === 'player' ? 1 : 0);
  const opponentWins = Number(row.player_b_round_wins || 0) + (simulatedRound.result.winner_side === 'bot' ? 1 : 0);
  const draws = Number(row.draw_rounds || 0) + (simulatedRound.result.winner_side === 'draw' ? 1 : 0);
  const completed = playerWins >= ARENA_ROUNDS_TO_WIN || opponentWins >= ARENA_ROUNDS_TO_WIN || nextRoundNo >= ARENA_MAX_ROUNDS_PER_MATCH;
  const winnerUserId = completed
    ? playerWins > opponentWins
      ? row.player_a_id
      : opponentWins > playerWins
        ? row.player_b_id
        : null
    : null;
  const nextRoundDeadlineAt = !completed && isTwoPlayerMatch ? new Date(Date.now() + ROUND_SELECTION_TIMEOUT_MS).toISOString() : null;
  const nextSummary: ArenaCompactMatchSummary = {
    ...summary,
    progress_status: completed ? 'completed' : 'in_progress',
    current_round_no: completed ? nextRoundNo : nextRoundNo + 1,
    rounds_to_win: ARENA_ROUNDS_TO_WIN,
    max_rounds: ARENA_MAX_ROUNDS_PER_MATCH,
    player_deck: committedPlayerDeck,
    bot_deck: committedOpponentDeck,
    opponent_deck: summary.opponent_deck ? committedOpponentDeck : undefined,
    pending_round_input: nextRoundDeadlineAt ? { round_no: nextRoundNo + 1, deadline_at: nextRoundDeadlineAt } : null,
    abandon_policy: {
      mode: 'auto_default_plan',
      committed_by: isPlayerA ? 'player_a' : 'player_b',
      auto_commit: effectivePlayerInput.auto_commit === true || effectiveOpponentInput.auto_commit === true,
      default_plan_used_for_absent_side: Boolean(effectivePlayerInput.auto_commit === true || effectiveOpponentInput.auto_commit === true)
    } as any,
    round_results: roundResults
  };
  const previousReplay = parseJson<ArenaReplayPayload | null>(await loadArenaMatchReplayJson(matchId, row.replay_json), null);
  const nextReplay: ArenaReplayPayload = {
    match_id: String(row.id),
    match_format: ARENA_MATCH_FORMAT,
    rounds_to_win: ARENA_ROUNDS_TO_WIN,
    replay_storage: 'tick_events',
    rounds: [...(previousReplay?.rounds || []), simulatedRound.replay]
  };
  let updated = 0;
  if (getDbMode() === 'MYSQL') {
    const result = await getMysqlDb().run(
      `UPDATE arena_matches
          SET round_count = ?,
              winner_user_id = ?,
              player_a_round_wins = ?,
              player_b_round_wins = ?,
              draw_rounds = ?,
              summary_json = ?,
              progress_status = ?,
              pending_round_deadline_at = ?,
              replay_json = NULL
        WHERE id = ? AND (player_a_id = ? OR player_b_id = ?) AND round_count = ?`,
      nextRoundNo,
      winnerUserId,
      playerWins,
      opponentWins,
      draws,
      JSON.stringify(nextSummary),
      completed ? 'COMPLETED' : 'IN_PROGRESS',
      nextRoundDeadlineAt,
      matchId,
      userId,
      userId,
      completedRoundCount
    );
    updated = Number(result.affectedRows || 0);
  } else {
    const result = getSqliteDb()
      .prepare(
        `UPDATE arena_matches
            SET round_count = ?,
                winner_user_id = ?,
                player_a_round_wins = ?,
                player_b_round_wins = ?,
                draw_rounds = ?,
                summary_json = ?,
                progress_status = ?,
                pending_round_deadline_at = ?,
                replay_json = NULL
          WHERE id = ? AND (player_a_id = ? OR player_b_id = ?) AND round_count = ?`
      )
      .run(
        nextRoundNo,
        winnerUserId,
        playerWins,
        opponentWins,
        draws,
        JSON.stringify(nextSummary),
        completed ? 'COMPLETED' : 'IN_PROGRESS',
        nextRoundDeadlineAt,
        matchId,
        userId,
        userId,
        completedRoundCount
      );
    updated = Number(result.changes || 0);
  }
  if (updated < 1) throw new Error('ArenaRoundCommitConflict');
  const savedReplayJson = await saveArenaMatchReplay(matchId, nextReplay);

  if (completed && row.match_type === 'RANKED') {
    await reflectRankedRatingIfCompleted(matchId);
  }

  const match = await getArenaMatchForUser(userId, matchId);
  if (!match) throw new Error('ArenaMatchCommitReadbackFailed');
  return { match, replay: savedReplayJson ? { ...nextReplay, match_id: match.id } : null, round_status: { status: 'committed' } };
};

export const getArenaMatchForUser = async (userId: string, matchId: string): Promise<ArenaMatchSummary | null> => {
  await ensureArenaMatchTables();
  if (getDbMode() === 'MYSQL') {
    const row = await getMysqlDb().get<RawMatchRow>(
      `SELECT ${ARENA_MATCH_SUMMARY_COLUMNS} FROM arena_matches WHERE id = ? AND (player_a_id = ? OR player_b_id = ?) LIMIT 1`,
      matchId,
      userId,
      userId
    );
    return row ? mapMatchRow(row, userId) : null;
  }

  const row = getSqliteDb()
    .prepare(`SELECT ${ARENA_MATCH_SUMMARY_COLUMNS} FROM arena_matches WHERE id = ? AND (player_a_id = ? OR player_b_id = ?) LIMIT 1`)
    .get(matchId, userId, userId) as RawMatchRow | undefined;
  return row ? mapMatchRow(row, userId) : null;
};

export const listRecentArenaMatchesForUser = async (userId: string, limitInput?: unknown): Promise<ArenaMatchSummary[]> => {
  await ensureArenaMatchTables();
  const limit = Math.max(1, Math.min(20, Number.parseInt(String(limitInput || '10'), 10) || 10));
  const queryA = `SELECT ${ARENA_MATCH_SUMMARY_COLUMNS} FROM arena_matches WHERE player_a_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`;
  const queryB = `SELECT ${ARENA_MATCH_SUMMARY_COLUMNS} FROM arena_matches WHERE player_b_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`;
  const rows = getDbMode() === 'MYSQL'
    ? [
        ...(await getMysqlDb().all<RawMatchRow>(queryA, userId, limit)),
        ...(await getMysqlDb().all<RawMatchRow>(queryB, userId, limit))
      ]
    : [
        ...(getSqliteDb().prepare(queryA).all(userId, limit) as RawMatchRow[]),
        ...(getSqliteDb().prepare(queryB).all(userId, limit) as RawMatchRow[])
      ];
  return rows
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || Number(b.id) - Number(a.id))
    .slice(0, limit)
    .map((row) => mapMatchRow(row, userId));
};

export const getArenaReplayForUser = async (userId: string, matchId: string): Promise<ArenaReplayPayload | null> => {
  await ensureArenaMatchTables();
  let row: RawMatchRow | undefined;
  if (getDbMode() === 'MYSQL') {
    row = await getMysqlDb().get<RawMatchRow>(
      `SELECT id, replay_json FROM arena_matches WHERE id = ? AND (player_a_id = ? OR player_b_id = ?) LIMIT 1`,
      matchId,
      userId,
      userId
    );
  } else {
    row = getSqliteDb()
      .prepare(`SELECT id, replay_json FROM arena_matches WHERE id = ? AND (player_a_id = ? OR player_b_id = ?) LIMIT 1`)
      .get(matchId, userId, userId) as RawMatchRow | undefined;
  }
  if (!row) return null;
  const replay = parseJson<ArenaReplayPayload | null>(await loadArenaMatchReplayJson(matchId, row.replay_json), null);
  if (!replay) return null;
  return { ...replay, match_id: String(row.id) };
};

export const recoverExpiredArenaRoundCommits = async (limitInput?: unknown) => {
  await ensureArenaMatchTables();
  const limit = Math.max(1, Math.min(EXPIRED_ROUND_SCAN_LIMIT, Number.parseInt(String(limitInput || EXPIRED_ROUND_SCAN_LIMIT), 10) || EXPIRED_ROUND_SCAN_LIMIT));
  const query = `SELECT ${ARENA_MATCH_SUMMARY_COLUMNS}
    FROM arena_matches
    WHERE season_id = ?
      AND progress_status = 'IN_PROGRESS'
      AND winner_user_id IS NULL
      AND round_count < ?
      AND pending_round_deadline_at IS NOT NULL
      AND pending_round_deadline_at <= ${dbNowSql()}
    ORDER BY pending_round_deadline_at ASC, id ASC
    LIMIT ?`;
  const rows = getDbMode() === 'MYSQL'
    ? await getMysqlDb().all<RawMatchRow>(query, getArenaCurrentSeasonId(), ARENA_MAX_ROUNDS_PER_MATCH, limit)
    : getSqliteDb().prepare(query).all(getArenaCurrentSeasonId(), ARENA_MAX_ROUNDS_PER_MATCH, limit) as RawMatchRow[];

  let committed = 0;
  let pending = 0;
  let skipped = 0;
  const errors: Array<{ match_id: string; error: string }> = [];
  const now = Date.now();

  for (const row of rows) {
    const summary = parseJson<ArenaCompactMatchSummary>(row.summary_json, {} as ArenaCompactMatchSummary);
    const pendingInput = summary.pending_round_input?.round_no
      ? summary.pending_round_input
      : {
          round_no: Number(row.round_count || 0) + 1,
          deadline_at: row.pending_round_deadline_at || new Date(now).toISOString()
        };
    const deadlineMs = pendingInput.deadline_at ? Date.parse(pendingInput.deadline_at) : NaN;
    if (!Number.isFinite(deadlineMs)) {
      skipped += 1;
      continue;
    }
    if (deadlineMs > now) {
      pending += 1;
      continue;
    }

    try {
      await commitArenaMatchRound(row.player_a_id, String(row.id), {
        round_no: pendingInput.round_no,
        auto_commit: true
      });
      committed += 1;
    } catch (err: any) {
      errors.push({ match_id: String(row.id), error: String(err?.message || err || 'UnknownArenaRoundRecoverError').slice(0, 180) });
    }
  }

  return {
    scanned: rows.length,
    committed,
    pending,
    skipped,
    errors,
    limit,
    source: 'arena_matches_pending_round_deadline_at'
  };
};

export const getArenaProfile = async (userId: string) => {
  await ensureArenaMatchTables();
  if (getDbMode() === 'MYSQL') {
    const rating = await getMysqlDb().get<any>(
      `SELECT user_id, mmr, rating_points, tier, wins, losses, draws
         FROM arena_player_ratings
        WHERE season_id = ? AND user_id = ?
        LIMIT 1`,
      getArenaCurrentSeasonId(),
      userId
    );
    return buildArenaProfileFromRating(userId, rating || null);
  }

  const rating = getSqliteDb()
    .prepare(`SELECT user_id, mmr, rating_points, tier, wins, losses, draws
      FROM arena_player_ratings
      WHERE season_id = ? AND user_id = ?
      LIMIT 1`)
    .get(getArenaCurrentSeasonId(), userId) as any;
  return buildArenaProfileFromRating(userId, rating || null);
};

const mapPublicRecentArenaMatch = (match: ArenaMatchSummary) => ({
  id: match.id,
  result: match.result,
  match_type: match.match_type,
  round_count: match.round_count,
  player_a_round_wins: match.player_a_round_wins,
  player_b_round_wins: match.player_b_round_wins,
  winner_user_id: match.winner_user_id,
  difficulty: match.difficulty,
  created_at: match.created_at,
  summary: {
    progress_status: String(match.summary?.progress_status || '').toLowerCase() === 'completed' ? 'completed' as const : undefined,
    battlefield_rule: match.summary?.battlefield_rule
      ? {
          id: match.summary.battlefield_rule.id,
          name: match.summary.battlefield_rule.name,
          description: match.summary.battlefield_rule.description
        }
      : undefined,
    round_results: Array.isArray(match.summary?.round_results)
      ? match.summary.round_results.slice(0, ARENA_MAX_ROUNDS_PER_MATCH).map((round) => ({
          round_no: round.round_no,
          winner_side: round.winner_side,
          player_remaining_units: round.player_remaining_units,
          bot_remaining_units: round.bot_remaining_units,
          player_total_damage: round.player_total_damage,
          bot_total_damage: round.bot_total_damage
        }))
      : []
  }
});
export const getArenaUserProfile = async (userId: string): Promise<ArenaUserProfileResponse> => {
  const profile = await getArenaProfile(userId);
  const recentMatches = await listRecentArenaMatchesForUser(userId, 5);
  const decided = profile.wins + profile.losses;
  return {
    ...profile,
    recent_matches: recentMatches
      .filter((match) => match.match_type === 'RANKED' && String(match.summary?.progress_status || '').toLowerCase() === 'completed')
      .slice(0, 5)
      .map(mapPublicRecentArenaMatch) as any,
    win_rate: decided > 0 ? Math.round((profile.wins / decided) * 1000) / 10 : 0
  };
};

const clampRankingLimit = (limitInput: unknown) => Math.min(
  MAX_RANKING_LIMIT,
  Math.max(1, Number.parseInt(String(limitInput || '50'), 10) || 50)
);

const parseRankingPayload = (row: any) => parseJson<{
  mmr?: number;
  rating_points?: number;
  tier?: string;
  wins?: number;
  losses?: number;
  draws?: number;
}>(row.payload_json, {});

const getArenaRankFromSnapshot = async (userId: string): Promise<number | null> => {
  await ensureArenaMatchTables();
  if (getDbMode() === 'MYSQL') {
    const row = await getMysqlDb().get<any>(
      `SELECT rank_no FROM arena_rank_snapshots
        WHERE season_id = ? AND rank_type = 'MMR' AND user_id = ?
        LIMIT 1`,
      getArenaCurrentSeasonId(),
      userId
    );
    return row ? Number(row.rank_no || 0) || null : null;
  }

  const row = getSqliteDb()
    .prepare(
      `SELECT rank_no FROM arena_rank_snapshots
        WHERE season_id = ? AND rank_type = 'MMR' AND user_id = ?
        LIMIT 1`
    )
    .get(getArenaCurrentSeasonId(), userId) as any;
  return row ? Number(row.rank_no || 0) || null : null;
};

const buildArenaProfileFromRating = async (userId: string, rating: any | null) => {
  const rank = await getArenaRankFromSnapshot(userId);
  const fallback = {
    season_id: getArenaCurrentSeasonId(),
    user_id: userId,
    rating: 1000,
    tier: 'BRONZE',
    rank,
    wins: 0,
    losses: 0,
    draws: 0,
    sets_played: 0,
    ranked_enabled: false
  };
  if (!rating) return fallback;
  return {
    ...fallback,
    rating: Number(rating.mmr || 1000),
    tier: rating.tier || 'BRONZE',
    wins: Number(rating.wins || 0),
    losses: Number(rating.losses || 0),
    draws: Number(rating.draws || 0),
    sets_played: Number(rating.wins || 0) + Number(rating.losses || 0) + Number(rating.draws || 0)
  };
};

export const listArenaRankings = async (limitInput: unknown): Promise<ArenaRankingResponse> => {
  const limit = clampRankingLimit(limitInput);
  const cacheKey = `${getArenaCurrentSeasonId()}:snapshot:${limit}`;
  const cached = rankingCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  await ensureArenaMatchTables();
  const query = `SELECT rank_no, user_id, score, payload_json, snapshot_at
    FROM arena_rank_snapshots
    WHERE season_id = ? AND rank_type = 'MMR'
    ORDER BY rank_no ASC
    LIMIT ?`;

  const rows = getDbMode() === 'MYSQL'
    ? await getMysqlDb().all<any>(query, getArenaCurrentSeasonId(), limit)
    : getSqliteDb().prepare(query).all(getArenaCurrentSeasonId(), limit) as any[];

  const sourceRows = rows.map((row) => ({ source: 'rank_snapshot', row }));

  const data: ArenaRankingResponse = {
    items: sourceRows.map(({ row }) => {
      const payload = parseRankingPayload(row);
      return {
        rank: Number(row.rank_no || 0),
        user_id: row.user_id,
        rating: Number(payload.mmr ?? row.score ?? 1000),
        rating_points: Number(payload.rating_points ?? row.score ?? 0),
        tier: String(payload.tier || 'BRONZE'),
        wins: Number(payload.wins || 0),
        losses: Number(payload.losses || 0),
        draws: Number(payload.draws || 0)
      };
    }),
    updated_at: sourceRows[0]?.row?.snapshot_at ? new Date(sourceRows[0].row.snapshot_at).toISOString() : new Date().toISOString(),
    source: rows.length > 0 ? 'rank_snapshot' : 'rank_snapshot_empty'
  };
  rankingCache.set(cacheKey, { data, expiresAt: Date.now() + RANKING_CACHE_TTL_MS });
  if (rankingCache.size > 20) {
    for (const [key, value] of rankingCache) {
      if (value.expiresAt <= Date.now()) rankingCache.delete(key);
    }
  }
  return data;
};

const rebuildArenaRankingSnapshotInternal = async (limitInput?: unknown) => {
  await ensureArenaMatchTables();
  const limit = Math.min(
    RANKING_SNAPSHOT_REBUILD_LIMIT,
    Math.max(10, Number.parseInt(String(limitInput || RANKING_SNAPSHOT_REBUILD_LIMIT), 10) || RANKING_SNAPSHOT_REBUILD_LIMIT)
  );
  const sourceQuery = `SELECT user_id, mmr, rating_points, tier, wins, losses, draws
    FROM arena_player_ratings
    WHERE season_id = ?
    ORDER BY rating_points DESC, mmr DESC, wins DESC
    LIMIT ?`;
  const rows = getDbMode() === 'MYSQL'
    ? await getMysqlDb().all<any>(sourceQuery, getArenaCurrentSeasonId(), limit)
    : getSqliteDb().prepare(sourceQuery).all(getArenaCurrentSeasonId(), limit) as any[];

  if (getDbMode() === 'MYSQL') {
    await getMysqlDb().transaction(async (tx) => {
      await tx.run(`DELETE FROM arena_rank_snapshots WHERE season_id = ? AND rank_type = 'MMR'`, getArenaCurrentSeasonId());
      for (const [index, row] of rows.entries()) {
        await tx.run(
          `INSERT INTO arena_rank_snapshots
            (season_id, rank_type, rank_no, user_id, score, payload_json, snapshot_at)
           VALUES (?, 'MMR', ?, ?, ?, ?, UTC_TIMESTAMP())`,
          getArenaCurrentSeasonId(),
          index + 1,
          row.user_id,
          Number(row.rating_points || 0),
          JSON.stringify(row)
        );
      }
    });
  } else {
    const db = getSqliteDb();
    db.transaction(() => {
      db.prepare(`DELETE FROM arena_rank_snapshots WHERE season_id = ? AND rank_type = 'MMR'`).run(getArenaCurrentSeasonId());
      const stmt = db.prepare(
        `INSERT INTO arena_rank_snapshots
          (season_id, rank_type, rank_no, user_id, score, payload_json, snapshot_at)
         VALUES (?, 'MMR', ?, ?, ?, ?, CURRENT_TIMESTAMP)`
      );
      rows.forEach((row, index) => {
        stmt.run(getArenaCurrentSeasonId(), index + 1, row.user_id, Number(row.rating_points || 0), JSON.stringify(row));
      });
    })();
  }

  rankingCache.clear();
  return {
    season_id: getArenaCurrentSeasonId(),
    rank_type: 'MMR',
    rebuilt: rows.length,
    limit,
    source: 'arena_player_ratings',
    snapshot_at: new Date().toISOString()
  };
};

export const rebuildArenaRankingSnapshot = async (limitInput?: unknown) => {
  if (rankingSnapshotRebuildInFlight) throw new Error('ArenaRankingRebuildAlreadyRunning');
  rankingSnapshotRebuildInFlight = rebuildArenaRankingSnapshotInternal(limitInput);
  try {
    return await rankingSnapshotRebuildInFlight;
  } finally {
    rankingSnapshotRebuildInFlight = null;
  }
};

export const pruneArenaReplayLogs = async (daysInput?: unknown, limitInput?: unknown) => {
  await ensureArenaMatchTables();
  await ensureArenaReplayTable();
  const retentionDays = Math.max(1, Math.min(90, Number.parseInt(String(daysInput || REPLAY_RETENTION_DAYS), 10) || REPLAY_RETENTION_DAYS));
  const limit = Math.max(10, Math.min(REPLAY_PRUNE_LIMIT, Number.parseInt(String(limitInput || REPLAY_PRUNE_LIMIT), 10) || REPLAY_PRUNE_LIMIT));

  if (getDbMode() === 'MYSQL') {
    const replayResult = await getMysqlDb().run(
      `DELETE FROM arena_match_replays
        WHERE expires_at IS NOT NULL
          AND expires_at < UTC_TIMESTAMP()
        LIMIT ?`,
      limit
    );
    const legacyResult = await getMysqlDb().run(
      `UPDATE arena_matches
          SET replay_json = NULL
        WHERE replay_json IS NOT NULL
          AND created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
        LIMIT ?`,
      retentionDays,
      limit
    );
    return {
      pruned: Number(replayResult.affectedRows || 0) + Number(legacyResult.affectedRows || 0),
      replay_rows_pruned: Number(replayResult.affectedRows || 0),
      legacy_rows_pruned: Number(legacyResult.affectedRows || 0),
      retention_days: retentionDays,
      limit
    };
  }

  const replayResult = getSqliteDb()
    .prepare(
      `DELETE FROM arena_match_replays
        WHERE match_id IN (
          SELECT match_id FROM arena_match_replays
           WHERE expires_at IS NOT NULL
             AND expires_at < datetime('now')
           LIMIT ?
        )`
    )
    .run(limit);
  const legacyResult = getSqliteDb()
    .prepare(
      `UPDATE arena_matches
          SET replay_json = NULL
        WHERE id IN (
          SELECT id FROM arena_matches
           WHERE replay_json IS NOT NULL
             AND created_at < datetime('now', '-' || ? || ' days')
           LIMIT ?
        )`
    )
    .run(retentionDays, limit);
  return {
    pruned: Number(replayResult.changes || 0) + Number(legacyResult.changes || 0),
    replay_rows_pruned: Number(replayResult.changes || 0),
    legacy_rows_pruned: Number(legacyResult.changes || 0),
    retention_days: retentionDays,
    limit
  };
};



