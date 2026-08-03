import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setArenaV2ExecutorForTest,
  acceptArenaV2QuickQueue,
  arenaV2TargetExists,
  cancelArenaV2BattleRoyaleQueue,
  cancelArenaV2QuickQueue,
  createArenaV2Match,
  createArenaV2Report,
  createArenaV2SeasonAdmin,
  deleteArenaV2DeckForUser,
  enableMyArenaV2StreamerCard,
  getActiveArenaV2MatchForUser,
  getArenaV2BattleRoyaleQueueStatus,
  getArenaV2BattleRoyale,
  getArenaV2CardVersion,
  getArenaV2CurrentSeason,
  getArenaV2MatchForUser,
  getArenaV2PreparationSeasonForGeneratedCardSync,
  getArenaV2QuickQueueStatus,
  getArenaV2Replay,
  getMyArenaV2StreamerCard,
  generateArenaV2DefaultCardCombatDefinition,
  grantArenaV2SeasonRewardsAdmin,
  joinArenaV2BattleRoyaleQueue,
  joinArenaV2QuickQueue,
  listArenaV2Cards,
  listArenaV2DecksForUser,
  listArenaV2OwnedCardsForUser,
  pruneArenaV2ExpiredReplayEvents,
  processArenaV2QuickMatchmaking,
  processArenaV2ExpiredTurns,
  processArenaV2ExpiredQueues,
  revalidateArenaV2DeckForUser,
  saveArenaV2Deck,
  submitArenaV2Mulligan,
  surrenderArenaV2MatchForUser,
  submitArenaV2TurnActions,
  syncArenaV2MatchForUser,
  syncArenaV2CardsFromOwnedCards,
  syncArenaV2CardsFromRegisteredStreamers,
  transitionArenaV2SeasonAdmin,
  updateMyArenaV2StreamerCard,
  validateArenaV2DeckForSeason
} from '../services/arenaV2Service';
import { evaluateArenaV2CardBudget, validateArenaV2CardVersionDefinition } from '../services/arenaV2Engine';

type Row = Record<string, any>;

const rows = {
  seasons: [] as Row[],
  cards: [] as Row[],
  streamers: [] as Row[],
  userCards: [] as Row[],
  users: [] as Row[],
  reports: [] as Row[],
  rewardGrants: [] as Row[],
  ratings: [] as Row[],
  decks: [] as Row[],
  matches: [] as Row[],
  matchPlayers: [] as Row[],
  cardInstances: [] as Row[],
  actionSubmissions: [] as Row[],
  quickQueue: [] as Row[],
  quickSlots: [] as Row[],
  quickConduct: [] as Row[],
  quickConductEvents: [] as Row[],
  battleRoyaleQueue: [] as Row[],
  replayEvents: [] as Row[],
  replayHolds: [] as Row[],
  battleRoyales: [] as Row[]
};
let lastCardInstanceSelectSql = '';
const timeoutReadFailures = new Set<string>();

const resetRows = () => {
  for (const key of Object.keys(rows) as Array<keyof typeof rows>) rows[key] = [];
  lastCardInstanceSelectSql = '';
  timeoutReadFailures.clear();
};

const finishTurnIntro = async (matchId: string, userId: string) => {
  const match = rows.matches.find((item) => item.id === matchId);
  if (!match) throw new Error('test match not found');
  const summary = JSON.parse(match.result_summary || '{}');
  if (!summary.phaseTiming) throw new Error('test phase timing not found');
  const nowMs = Date.now();
  summary.phaseTiming.planningStartsAt = new Date(nowMs - 1).toISOString();
  summary.phaseTiming.turnDeadlineAt = new Date(nowMs + 40_000).toISOString();
  match.result_summary = JSON.stringify(summary);
  return getArenaV2MatchForUser(matchId, userId);
};


const cardWithStreamerFields = (card: Row) => {
  const streamer = rows.streamers.find((item) => item.channel_id === card.streamer_id);
  return {
    ...card,
    art_asset_id: card.art_asset_id || streamer?.custom_image_url || streamer?.logo_url || null,
    streamer_name: streamer?.name,
    streamer_logo: streamer?.logo_url || null,
    streamer_custom_image: streamer?.custom_image_url || null,
    streamer_is_image_banned: streamer?.is_image_banned || 0
  };
};

const makeExecutor = () => ({
  all: (sql: string, params: any[] = []) => {
    if (sql.includes('SELECT DISTINCT proposal_id') && sql.includes('FROM arena_v2_match_queue')) {
      const deadline = String(params[0] || '');
      return Array.from(new Set(rows.quickQueue
        .filter((ticket) => ['proposed', 'accepted'].includes(ticket.status) && ticket.accept_deadline_at <= deadline)
        .map((ticket) => ticket.proposal_id)))
        .filter(Boolean)
        .map((proposal_id) => ({ proposal_id }));
    }
    if (sql.includes('WHERE proposal_id = ?') && sql.includes('FROM arena_v2_match_queue')) {
      return rows.quickQueue.filter((ticket) => ticket.proposal_id === params[0] && ['proposed', 'accepted'].includes(ticket.status));
    }
    if (sql.includes('FROM arena_v2_matchmaking_active_slots slot') && sql.includes('JOIN arena_v2_match_queue q')) {
      return rows.quickSlots
        .map((slot) => rows.quickQueue.find((ticket) => ticket.id === slot.ticket_id))
        .filter((ticket): ticket is Row => Boolean(ticket))
        .filter((ticket) => !sql.includes("q.status = 'waiting'") || ticket.status === 'waiting')
        .map((ticket) => ({
          ...ticket,
          priority_penalty: rows.quickConduct.find((conduct) => conduct.season_id === ticket.season_id && conduct.user_id === ticket.user_id)?.priority_penalty || 0
        }));
    }
    if (sql.includes('SELECT q.*') && sql.includes('FROM arena_v2_match_queue q') && sql.includes('NOT EXISTS')) {
      return rows.quickQueue
        .filter((ticket) => ['waiting', 'proposed', 'accepted'].includes(ticket.status))
        .filter((ticket) => !rows.quickSlots.some((slot) => slot.season_id === ticket.season_id && slot.user_id === ticket.user_id));
    }
    if (sql.includes('FROM arena_v2_card_versions')) {
      if (sql.includes('FROM user_cards')) {
        const userId = params[0];
        const seasonId = params[1];
        return rows.cards
          .filter((card) => card.season_id === seasonId && card.status === 'active')
          .map((card) => {
            const owned = rows.userCards.filter((userCard) => userCard.user_id === userId && userCard.channel_id === card.streamer_id);
            if (!owned.length) return null;
            return {
              ...cardWithStreamerFields(card),
              owned_count: owned.length,
              owned_stars: Array.from(new Set(owned.map((userCard) => Number(userCard.star || 0)))).join(',')
            };
          })
          .filter(Boolean)
          .sort((a: any, b: any) => Number(b.owned_count || 0) - Number(a.owned_count || 0) || Number(a.cost) - Number(b.cost) || String(a.display_name).localeCompare(String(b.display_name)))
          .slice(
            Number.isFinite(Number(params[params.length - 1])) ? Number(params[params.length - 1]) : 0,
            (Number.isFinite(Number(params[params.length - 1])) ? Number(params[params.length - 1]) : 0)
              + (Number.isFinite(Number(params[params.length - 2])) ? Number(params[params.length - 2]) : 40)
          );
      }
      if (sql.includes('WHERE id IN')) {
        const ids = new Set(params);
        return rows.cards.filter((card) => ids.has(card.id));
      }
      if (sql.includes('streamer_id IN')) {
        const streamerIds = new Set(params.slice(1).map(String));
        return rows.cards
          .filter((card) => card.season_id === params[0] && card.status === 'active' && streamerIds.has(String(card.streamer_id)))
          .sort((a, b) => String(a.streamer_id).localeCompare(String(b.streamer_id)) || Number(b.version || 0) - Number(a.version || 0));
      }
      if (sql.includes('ORDER BY streamer_id ASC')) {
        return rows.cards
          .filter((card) => card.season_id === params[0] && card.status === 'active')
          .sort((a, b) => String(a.streamer_id).localeCompare(String(b.streamer_id)) || Number(b.version || 0) - Number(a.version || 0));
      }
      const seasonId = params[0];
      return rows.cards
        .filter((card) => card.season_id === seasonId && card.status === 'active')
        .sort((a, b) => a.cost - b.cost || String(a.display_name).localeCompare(String(b.display_name)))
        .map(cardWithStreamerFields)
        .slice(
          Number.isFinite(Number(params[params.length - 1])) ? Number(params[params.length - 1]) : 0,
          (Number.isFinite(Number(params[params.length - 1])) ? Number(params[params.length - 1]) : 0)
            + (Number.isFinite(Number(params[params.length - 2])) ? Number(params[params.length - 2]) : 40)
        );
    }
    if (sql.includes('FROM user_cards uc')) {
      const userId = params[0];
      return rows.streamers
        .reduce<Row[]>((acc, streamer) => {
          const owned = rows.userCards.filter((userCard) => userCard.user_id === userId && userCard.channel_id === streamer.channel_id);
          if (owned.length) acc.push({ ...streamer, owned_count: owned.length });
          return acc;
        }, [])
        .filter((streamer) => Number(streamer.is_image_banned || 0) === 0)
        .sort((a: any, b: any) => Number(b.owned_count || 0) - Number(a.owned_count || 0) || Number(b.base_value || 0) - Number(a.base_value || 0) || String(a.channel_id).localeCompare(String(b.channel_id)))
        .slice(0, 5000);
    }
    if (sql.includes('FROM streamers')) {
      const hasCursor = sql.includes('channel_id > ?');
      const cursorBaseValue = hasCursor ? Number(params[0]) : null;
      const cursorChannelId = hasCursor ? String(params[2]) : '';
      const limit = Math.max(1, Number(params[params.length - 1] || 5000));
      return rows.streamers
        .filter((streamer) => Number(streamer.is_image_banned || 0) === 0)
        .filter((streamer) => !hasCursor
          || Number(streamer.base_value || 0) < Number(cursorBaseValue)
          || (Number(streamer.base_value || 0) === Number(cursorBaseValue) && String(streamer.channel_id).localeCompare(cursorChannelId) > 0))
        .sort((a, b) => Number(b.base_value || 0) - Number(a.base_value || 0) || String(a.channel_id).localeCompare(String(b.channel_id)))
        .slice(0, limit);
    }
    if (sql.includes('FROM arena_v2_decks')) {
      return rows.decks.filter((deck) => deck.user_id === params[0] && (!params[1] || deck.season_id === params[1]));
    }
    if (sql.includes('FROM arena_v2_reports')) {
      return rows.reports.filter((report) => report.reporter_user_id === params[0]);
    }
    if (sql.includes('FROM arena_v2_replay_holds')) {
      return rows.replayHolds
        .filter((hold) => hold.status === 'active' && (!hold.hold_until || hold.hold_until >= params[0]))
        .map((hold) => ({ match_id: hold.match_id }));
    }
    if (sql.includes('FROM arena_v2_ratings')) {
      return rows.ratings
        .filter((rating) => rating.season_id === params[0])
        .sort((a, b) => Number(b.mmr || 0) - Number(a.mmr || 0) || Number(b.peak_mmr || 0) - Number(a.peak_mmr || 0))
        .slice(0, Number(params[1] || 100));
    }
    if (sql.includes('FROM arena_v2_reward_grants')) {
      return rows.rewardGrants.filter((grant) => grant.season_id === params[0]);
    }
    if (sql.includes('FROM arena_v2_matches')) {
      if (sql.includes('battle_royale_id = ?')) {
        return rows.matches
          .filter((match) => match.battle_royale_id === params[0])
          .sort((a, b) => Number(a.round_no || 0) - Number(b.round_no || 0) || String(a.id).localeCompare(String(b.id)));
      }
      if (sql.includes("status IN ('mulligan', 'turn_result', 'turn_planning', 'action_locked')")) {
        const allowed = new Set(['mulligan', 'turn_result', 'turn_planning', 'action_locked']);
        return rows.matches
          .filter((match) => allowed.has(match.status))
          .slice(0, Number(params[0] || 25));
      }
      return [];
    }

    if (sql.includes('FROM arena_v2_match_players')) {
      return rows.matchPlayers
        .filter((player) => player.match_id === params[0])
        .sort((a, b) => Number(a.seat_no) - Number(b.seat_no));
    }
    if (sql.includes('FROM arena_v2_card_instances')) {
      lastCardInstanceSelectSql = sql;
      return rows.cardInstances
        .filter((instance) => instance.match_id === params[0])
        .map((instance) => {
          const card = rows.cards.find((item) => item.id === instance.card_version_id);
          const streamer = rows.streamers.find((item) => item.channel_id === card?.streamer_id);
          const artAssetId = Number(streamer?.is_image_banned || 0)
            ? streamer?.logo_url || null
            : card?.art_asset_id || streamer?.custom_image_url || streamer?.logo_url || null;
          return {
            ...instance,
            streamer_id: card?.streamer_id,
            display_name: card?.display_name,
            season_id: card?.season_id,
            version: card?.version,
            card_class: card?.card_class,
            cost: card?.cost,
            attack: card?.attack,
            health: card?.health,
            keywords: card?.keywords,
            art_asset_id: artAssetId,
            card_status: card?.status
          };
        });
    }
    if (sql.includes('FROM arena_v2_action_submissions')) {
      const finalOnly = sql.includes('is_final = 1');
      return rows.actionSubmissions
        .filter((submission) => submission.match_id === params[0]
          && submission.turn_no === params[1]
          && (!finalOnly || Number(submission.is_final) === 1))
        .sort((a, b) => Number(a.seat_no) - Number(b.seat_no) || Number(b.revision) - Number(a.revision));
    }
    if (sql.includes('FROM arena_v2_match_queue')) {
      return rows.quickQueue.filter((ticket) => ticket.season_id === params[0] && ticket.user_id === params[1]);
    }
    if (sql.includes('FROM arena_v2_battle_royale_queue')) {
      return rows.battleRoyaleQueue.filter((ticket) => ticket.season_id === params[0] && ticket.user_id === params[1]);
    }
    if (sql.includes('FROM arena_v2_replay_events')) {
      return rows.replayEvents
        .filter((event) => event.match_id === params[0])
        .sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0));
    }
    return [];
  },
  get: (sql: string, params: any[] = []) => {
    if (sql.includes('SELECT m.id') && sql.includes('FROM arena_v2_match_players p') && sql.includes('ORDER BY CASE m.mode')) {
      const priority: Record<string, number> = { quick: 0, battle_royale_8: 1, bot: 2 };
      const activeMatches = rows.matchPlayers
        .filter((player) => player.user_id === params[0])
        .map((player) => rows.matches.find((match) => match.id === player.match_id))
        .filter((match): match is Row => match != null && !['completed', 'cancelled'].includes(String(match.status)))
        .sort((left, right) => (
          (priority[String(left.mode)] ?? 3) - (priority[String(right.mode)] ?? 3)
          || String(right.updated_at || '').localeCompare(String(left.updated_at || ''))
          || String(right.created_at || '').localeCompare(String(left.created_at || ''))
          || String(right.id).localeCompare(String(left.id))
        ));
      return activeMatches[0] ? { id: activeMatches[0].id } : undefined;
    }
    if (sql.includes('active_participation')) {
      const userId = params[0];
      const now = String(params[1]);
      const quick = rows.quickQueue.find((ticket) => ticket.user_id === userId
        && ((ticket.status === 'waiting' && ticket.expires_at >= now)
          || ['proposed', 'accepted', 'matching'].includes(ticket.status)
          || (ticket.status === 'matched' && rows.matches.some((match) => match.id === ticket.matched_match_id && !['completed', 'cancelled'].includes(match.status)))));
      if (quick) return { activity_kind: 'quick_queue', reference_id: quick.id };
      const battleRoyale = rows.battleRoyaleQueue.find((ticket) => ticket.user_id === userId
        && ((ticket.status === 'waiting' && ticket.expires_at >= String(params[3]))
          || (ticket.status === 'matched' && rows.battleRoyales.some((battle) => battle.id === ticket.battle_royale_id && battle.status === 'active'))));
      if (battleRoyale) return { activity_kind: 'battle_royale', reference_id: battleRoyale.id };
      const player = rows.matchPlayers.find((candidate) => candidate.user_id === userId
        && rows.matches.some((match) => match.id === candidate.match_id && !['completed', 'cancelled'].includes(match.status)));
      return player ? { activity_kind: 'match', reference_id: player.match_id } : undefined;
    }
    if (sql.includes('active_deck')) {
      const deckId = params[0];
      const now = String(params[1]);
      const quick = rows.quickQueue.find((ticket) => ticket.deck_id === deckId
        && ((ticket.status === 'waiting' && ticket.expires_at >= now)
          || ['proposed', 'accepted', 'matching'].includes(ticket.status)
          || (ticket.status === 'matched' && rows.matches.some((match) => match.id === ticket.matched_match_id && !['completed', 'cancelled'].includes(match.status)))));
      if (quick) return { activity_kind: 'quick_queue' };
      const battleRoyale = rows.battleRoyaleQueue.find((ticket) => ticket.deck_id === deckId
        && ((ticket.status === 'waiting' && ticket.expires_at >= String(params[3]))
          || (ticket.status === 'matched' && rows.battleRoyales.some((battle) => battle.id === ticket.battle_royale_id && battle.status === 'active'))));
      if (battleRoyale) return { activity_kind: 'battle_royale' };
      const player = rows.matchPlayers.find((candidate) => candidate.deck_id === deckId
        && rows.matches.some((match) => match.id === candidate.match_id && !['completed', 'cancelled'].includes(match.status)));
      return player ? { activity_kind: 'match' } : undefined;
    }
    if (sql.includes('FROM arena_v2_matchmaking_active_slots slot') && sql.includes('JOIN arena_v2_match_queue q')) {
      const slot = rows.quickSlots.find((item) => item.season_id === params[0] && item.user_id === params[1]);
      return slot ? rows.quickQueue.find((ticket) => ticket.id === slot.ticket_id) : undefined;
    }
    if (sql.includes('FROM arena_v2_matchmaking_conduct')) {
      return rows.quickConduct.find((conduct) => conduct.season_id === params[0] && conduct.user_id === params[1]);
    }
    if (sql.includes('SELECT status FROM arena_v2_match_queue') && sql.includes('id <> ?')) {
      return rows.quickQueue.find((ticket) => ticket.proposal_id === params[0]
        && ticket.id !== params[1]
        && ['proposed', 'accepted'].includes(ticket.status));
    }
    if (sql.includes('proposal_id = ?') && sql.includes('FROM arena_v2_match_queue')) {
      return rows.quickQueue.find((ticket) => ticket.season_id === params[0] && ticket.user_id === params[1]
        && ticket.proposal_id === params[2] && ['matched', 'accept_timeout', 'declined'].includes(ticket.status));
    }
    if (sql.includes('SELECT 1 AS missing') && sql.includes('FROM streamers s') && sql.includes('FROM arena_v2_card_versions cv')) {
      const missing = rows.streamers.some((streamer) => Number(streamer.is_image_banned || 0) === 0
        && !rows.cards.some((card) => card.season_id === params[0]
          && card.streamer_id === streamer.channel_id
          && card.status === 'active'));
      return missing ? { missing: 1 } : undefined;
    }
    if (sql.includes('FROM arena_v2_seasons')) {
      if (sql.includes('WHERE id = ?')) {
        return rows.seasons.find((season) => season.id === params[0] && (!params[1] || season.status === params[1]));
      }
      if (sql.includes("status IN ('active', 'scheduled', 'draft')")) {
        const statusOrder: Record<string, number> = { active: 0, scheduled: 1, draft: 2 };
        return rows.seasons
          .filter((season) => season.status in statusOrder)
          .sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || String(b.starts_at).localeCompare(String(a.starts_at)))[0];
      }
      if (sql.includes("status IN ('draft', 'scheduled')")) {
        const statusOrder: Record<string, number> = { scheduled: 0, draft: 1 };
        return rows.seasons
          .filter((season) => ['draft', 'scheduled'].includes(String(season.status)))
          .filter((season) => {
            if (!sql.includes('card_pool_version <> ?')) return true;
            const versionPending = season.card_pool_version !== params[0]
              || season.balance_version !== params[1];
            const hasMissingCard = rows.streamers.some((streamer) => Number(streamer.is_image_banned || 0) === 0
              && !rows.cards.some((card) => card.season_id === season.id
                && card.streamer_id === streamer.channel_id
                && card.status === 'active'));
            return versionPending || hasMissingCard;
          })
          .sort((a, b) => statusOrder[a.status] - statusOrder[b.status]
            || String(a.starts_at).localeCompare(String(b.starts_at))
            || String(a.id).localeCompare(String(b.id)))[0];
      }
      return rows.seasons.find((season) => season.status === 'active');
    }
    if (sql.includes('FROM arena_v2_reward_grants')) {
      return rows.rewardGrants.find((grant) => grant.season_id === params[0] && grant.user_id === params[1]);
    }
    if (sql.includes('FROM arena_v2_ratings') && sql.includes('last_match_id = ?')) {
      return rows.ratings.find((rating) => rating.season_id === params[0] && rating.last_match_id === params[1]);
    }
    if (sql.includes('FROM arena_v2_ratings')) {
      return rows.ratings.find((rating) => rating.season_id === params[0] && rating.user_id === params[1]);
    }
    if (sql.includes('COUNT(*) AS count') && sql.includes('FROM arena_v2_card_versions')) {
      return {
        count: rows.cards.filter((card) => card.season_id === params[0] && card.status === params[1]).length
      };
    }
    if (sql.includes('COALESCE(MAX(version), 0) AS max_version')) {
      const maxVersion = rows.cards
        .filter((card) => card.season_id === params[0] && card.streamer_id === params[1])
        .reduce((max, card) => Math.max(max, Number(card.version || 0)), 0);
      return { max_version: maxVersion };
    }
    if (sql.includes('FROM arena_v2_card_versions')) {
      if (sql.includes('cv.season_id = ? AND cv.streamer_id = ?')) {
        const activeOnly = sql.includes("cv.status = 'active'");
        const card = rows.cards
          .filter((item) => item.season_id === params[0] && item.streamer_id === params[1] && (!activeOnly || item.status === 'active'))
          .sort((a, b) => Number(b.version || 0) - Number(a.version || 0))[0];
        return card ? cardWithStreamerFields(card) : undefined;
      }
      if (sql.includes('season_id = ? AND streamer_id = ?')) {
        return rows.cards.find((item) => item.season_id === params[0] && item.streamer_id === params[1] && item.status === 'active');
      }
      const card = rows.cards.find((item) => item.id === params[0]);
      if (!card) return undefined;
      return sql.includes('SELECT id, streamer_id') || sql.includes('SELECT cv.id') ? cardWithStreamerFields(card) : { ok: 1 };
    }
    if (sql.includes('FROM arena_v2_decks')) {
      const deck = rows.decks.find((item) => item.id === params[0]);
      return deck ? {
        id: deck.id,
        user_id: deck.user_id,
        season_id: deck.season_id,
        card_version_ids: deck.card_version_ids,
        is_valid: deck.is_valid
      } : undefined;
    }
    if (sql.includes('FROM arena_v2_match_queue q') && sql.includes('JOIN arena_v2_matches m')) {
      return rows.quickQueue.find((ticket) => ticket.season_id === params[0]
        && ticket.user_id === params[1]
        && ticket.status === 'matched'
        && rows.matches.some((match) => match.id === ticket.matched_match_id && !['completed', 'cancelled'].includes(match.status)));
    }
    if (sql.includes('FROM arena_v2_matches')) {
      if (timeoutReadFailures.has(String(params[0])) && sql.includes('card_pool_version, result_summary, updated_at')) {
        throw new Error('InjectedArenaV2TimeoutReadFailure');
      }
      const match = rows.matches.find((item) => item.id === params[0]);
      if (!match) return undefined;
      if (sql.includes('SELECT status')) return { status: match.status };
      if (sql.includes('SELECT id, season_id') || sql.includes('SELECT id, status, result_summary')) return match;
      if (sql.includes('replay_expires_at')) return { replay_expires_at: match.replay_expires_at, status: match.status };
      return { ok: 1 };
    }
    if (sql.includes('FROM arena_v2_match_players')) {
      if (sql.includes('user_id = ?')) return rows.matchPlayers.find((player) => player.match_id === params[0] && player.user_id === params[1]);
      return rows.matchPlayers.find((player) => player.match_id === params[0] && player.seat_no === params[1]);
    }
    if (sql.includes('SELECT * FROM arena_v2_match_queue WHERE id = ?')) {
      return rows.quickQueue.find((ticket) => ticket.id === params[0]);
    }
    if (sql.includes("last_transition_reason = 'invalid_deck'") && sql.includes('FROM arena_v2_match_queue')) {
      return rows.quickQueue.find((ticket) => ticket.season_id === params[0]
        && ticket.user_id === params[1]
        && (['accept_timeout', 'declined'].includes(ticket.status)
          || (ticket.status === 'cancelled' && ticket.last_transition_reason === 'invalid_deck')));
    }
    if (sql.includes('FROM arena_v2_match_queue')) {
      if (sql.includes("status = 'matched'")) {
        return rows.quickQueue.find((ticket) => (
          ticket.season_id === params[0]
          && ticket.user_id === params[1]
          && ticket.status === 'matched'
        ));
      }
      return rows.quickQueue.find((ticket) => (
        ticket.season_id === params[0]
        && ticket.user_id === params[1]
        && (ticket.status === 'waiting' || ticket.status === 'matched')
      ));
    }
    if (sql.includes('COUNT(*) AS count') && sql.includes('FROM arena_v2_battle_royale_queue')) {
      return {
        count: rows.battleRoyaleQueue.filter((ticket) => (
          ticket.season_id === params[0]
          && ticket.status === 'waiting'
          && ticket.expires_at >= params[1]
        )).length
      };
    }
    if (sql.includes('FROM arena_v2_battle_royale_queue q') && sql.includes('EXISTS') && sql.includes('arena_v2_battle_royales br')) {
      return rows.battleRoyaleQueue.find((ticket) => ticket.season_id === params[0]
        && ticket.user_id === params[1]
        && (ticket.status === 'waiting'
          || (ticket.status === 'matched'
            && rows.battleRoyales.some((battle) => battle.id === ticket.battle_royale_id && battle.status === 'active'))));
    }
    if (sql.includes('FROM arena_v2_battle_royale_queue')) {
      if (sql.includes("status = 'matched'")) {
        return rows.battleRoyaleQueue.find((ticket) => (
          ticket.season_id === params[0]
          && ticket.user_id === params[1]
          && ticket.status === 'matched'
        ));
      }
      return rows.battleRoyaleQueue.find((ticket) => (
        ticket.season_id === params[0]
        && ticket.user_id === params[1]
        && (ticket.status === 'waiting' || ticket.status === 'matched')
      ));
    }
    if (sql.includes('FROM arena_v2_replay_events')) {
      return rows.replayEvents.find((event) => event.match_id === params[0]) ? { ok: 1 } : undefined;
    }
    if (sql.includes('FROM users')) {
      return rows.users.find((user) => user.id === params[0]) ? { ok: 1 } : undefined;
    }
    if (sql.includes('FROM streamers')) {
      return rows.streamers.find((streamer) => streamer.channel_id === params[0] || streamer.registered_by === params[1]);
    }
    if (sql.includes('FROM arena_v2_battle_royales')) {
      return rows.battleRoyales.find((battleRoyale) => battleRoyale.id === params[0]);
    }
    if (sql.includes('MAX(seq)')) {
      const maxSeq = rows.replayEvents
        .filter((event) => event.match_id === params[0])
        .reduce((max, event) => Math.max(max, Number(event.seq || 0)), 0);
      return { max_seq: maxSeq };
    }
    if (sql.includes('MAX(revision)')) {
      const maxRevision = rows.actionSubmissions
        .filter((submission) => submission.match_id === params[0] && submission.seat_no === params[1] && submission.turn_no === params[2])
        .reduce((max, submission) => Math.max(max, Number(submission.revision)), -1);
      return { max_revision: maxRevision < 0 ? null : maxRevision };
    }
    return undefined;
  },
  run: (sql: string, params: any[] = []) => {
    if (sql.includes('INTO arena_v2_matchmaking_conduct_events')) {
      if (rows.quickConductEvents.some((event) => event.event_key === params[0])) return { changes: 0 };
      rows.quickConductEvents.push({
        event_key: params[0],
        season_id: params[1],
        user_id: params[2],
        event_type: params[3]
      });
      return { changes: 1 };
    }
    if (sql.includes('INSERT INTO arena_v2_matchmaking_conduct')) {
      if (rows.quickConduct.some((conduct) => conduct.season_id === params[0] && conduct.user_id === params[1])) {
        return { changes: 0 };
      }
      rows.quickConduct.push({
        season_id: params[0],
        user_id: params[1],
        timeout_strikes: params[2],
        priority_penalty: params[3],
        last_timeout_at: params[4]
      });
      return { changes: 1 };
    }
    if (sql.includes('UPDATE arena_v2_matchmaking_conduct')) {
      const conduct = rows.quickConduct.find((item) => item.season_id === params[3] && item.user_id === params[4]);
      if (!conduct) return { changes: 0 };
      conduct.timeout_strikes = params[0];
      conduct.priority_penalty = params[1];
      conduct.last_timeout_at = params[2];
      return { changes: 1 };
    }
    if (sql.includes('INSERT') && sql.includes('INTO arena_v2_matchmaking_active_slots')) {
      if (!rows.quickSlots.some((slot) => slot.season_id === params[0] && slot.user_id === params[1])) {
        rows.quickSlots.push({ season_id: params[0], user_id: params[1], ticket_id: params[2] });
        return { changes: 1 };
      }
      return { changes: 0 };
    }
    if (sql.includes('DELETE FROM arena_v2_matchmaking_active_slots')) {
      const before = rows.quickSlots.length;
      if (sql.includes('season_id = ? AND user_id = ? AND ticket_id = ?')) {
        rows.quickSlots = rows.quickSlots.filter((slot) => !(slot.season_id === params[0] && slot.user_id === params[1] && slot.ticket_id === params[2]));
      } else if (sql.includes('season_id = ? AND user_id = ?')) {
        rows.quickSlots = rows.quickSlots.filter((slot) => !(slot.season_id === params[0] && slot.user_id === params[1]));
      } else {
        const terminalIds = new Set(rows.quickQueue.filter((ticket) => ['cancelled', 'expired', 'accept_timeout', 'declined'].includes(ticket.status)).map((ticket) => ticket.id));
        rows.quickSlots = rows.quickSlots.filter((slot) => !terminalIds.has(slot.ticket_id));
      }
      return { changes: before - rows.quickSlots.length };
    }
    if (sql.includes('UPDATE arena_v2_seasons') && sql.includes('SET card_pool_version = ?')) {
      const season = rows.seasons.find((item) => item.id === params[2] && ['draft', 'scheduled'].includes(item.status));
      if (!season) return { changes: 0 };
      season.card_pool_version = params[0];
      season.balance_version = params[1];
      season.updated_at = 'now';
      return { changes: 1 };
    }
    if (sql.includes('UPDATE arena_v2_seasons') && sql.includes('SET status = ?')) {
      const season = rows.seasons.find((item) => item.id === params[1] && item.status === params[2]);
      if (!season) return { changes: 0 };
      if (sql.includes('card_pool_version = ?')
        && (season.card_pool_version !== params[3] || season.balance_version !== params[4])) return { changes: 0 };
      if (sql.includes('FROM streamers s')) {
        const hasMissingCard = rows.streamers.some((streamer) => Number(streamer.is_image_banned || 0) === 0
          && !rows.cards.some((card) => card.season_id === params[5]
            && card.streamer_id === streamer.channel_id
            && card.status === 'active'));
        if (hasMissingCard) return { changes: 0 };
      }
      season.status = params[0];
      season.updated_at = 'now';
      return { changes: 1 };
    }
    if (sql.includes('INSERT INTO arena_v2_seasons')) {
      rows.seasons.push({
        id: params[0],
        season_key: params[1],
        name: params[2],
        status: 'draft',
        starts_at: params[3],
        ends_at: params[4],
        modes_enabled: params[5],
        card_pool_version: params[6],
        balance_version: params[7],
        reward_table: params[8],
        mmr_tier_table: params[9],
        replay_retention_days: 7,
        created_by: params[10],
        created_at: 'now',
        updated_at: 'now'
      });
    }
    if (sql.includes('INSERT INTO arena_v2_card_versions')) {
      if (rows.cards.some((card) => card.id === params[0]) && (sql.includes('ON CONFLICT') || sql.includes('ON DUPLICATE KEY'))) {
        return { changes: 0 };
      }
      const hasLiteralVersion = params.length === 12;
      rows.cards.push({
        id: params[0],
        streamer_id: params[1],
        display_name: params[2],
        season_id: params[3],
        version: hasLiteralVersion ? 1 : params[4],
        card_class: hasLiteralVersion ? params[4] : params[5],
        cost: hasLiteralVersion ? params[5] : params[6],
        attack: hasLiteralVersion ? params[6] : params[7],
        health: hasLiteralVersion ? params[7] : params[8],
        keywords: hasLiteralVersion ? params[8] : params[9],
        balance_score: hasLiteralVersion ? params[9] : params[10],
        validation_result: hasLiteralVersion ? params[10] : params[11],
        art_asset_id: hasLiteralVersion ? params[11] : params[12],
        status: 'active',
        updated_at: 'now'
      });
    }
    if (sql.includes('INSERT INTO arena_v2_reports')) {
      rows.reports.push({
        id: params[0],
        reporter_user_id: params[1],
        target_type: params[2],
        target_id: params[3],
        reason: params[4],
        status: 'received'
      });
    }
    if (sql.includes('INSERT INTO arena_v2_reward_grants')) {
      rows.rewardGrants.push({
        id: params[0],
        season_id: params[1],
        user_id: params[2],
        reward_basis: params[3],
        reward_items: params[4],
        status: 'pending',
        hold_reason: null,
        idempotency_key: params[5],
        granted_at: null
      });
    }
    if (sql.includes('INSERT INTO arena_v2_decks')) {
      rows.decks.push({
        id: params[0],
        user_id: params[1],
        season_id: params[2],
        name: params[3],
        mode_scope: params[4],
        card_version_ids: params[5],
        validation_hash: params[6],
        is_valid: params[7],
        validation_result: params[8],
        created_at: 'now',
        updated_at: 'now'
      });
    }
    if (sql.includes('INSERT INTO arena_v2_matches')) {
      if (sql.includes("'bot', 'mulligan'")) {
        rows.matches.push({
          id: params[0],
          season_id: params[1],
          rng_seed: params[2],
          card_pool_version: params[3],
          result_summary: params[4],
          rules_version: 'arena-v2-gdd-1.0.0',
          round_no: 0,
          turn_no: 1,
          battle_royale_id: null,
          started_at: 'now',
          finished_at: null,
          winner_user_id: null,
          mode: 'bot',
          status: 'mulligan'
        });
        return { changes: 1 };
      }
      rows.matches.push({
        id: params[0],
        season_id: params[1],
        mode: params[2],
        status: params[3],
        battle_royale_id: params[4],
        round_no: params[5],
        turn_no: params[6],
        rng_seed: params[7],
        card_pool_version: params[8],
        result_summary: params[9],
        rules_version: 'arena-v2-gdd-1.0.0',
        started_at: 'now',
        finished_at: null,
        winner_user_id: null
      });
    }
    if (sql.includes('INSERT INTO arena_v2_match_players')) {
      rows.matchPlayers.push({
        id: params[0],
        match_id: params[1],
        user_id: params[2],
        seat_no: params[3],
        deck_id: params[4],
        player_health: params[5],
        fatigue_count: params[6],
        initial_deck_order: params[7],
        hand_card_instance_ids: params[8],
        deck_card_instance_ids: params[9],
        graveyard_card_instance_ids: params[10],
        board_state: params[11],
        mulligan_state: params[12]
      });
    }
    if (sql.includes('INSERT INTO arena_v2_card_instances')) {
      rows.cardInstances.push({
        id: params[0],
        match_id: params[1],
        owner_seat_no: params[2],
        card_version_id: params[3],
        zone: params[4],
        position: null,
        current_attack: params[5],
        current_health: params[6],
        damage_taken: 0,
        created_turn: 0,
        status_effects: params[7]
      });
    }
    if (sql.includes('INSERT INTO arena_v2_action_submissions')) {
      if (sql.includes('WHERE EXISTS')) {
        const match = rows.matches.find((item) => item.id === params[9] && item.turn_no === params[10]);
        if (!match || !['turn_planning', 'action_locked'].includes(match.status)) return { changes: 0 };
      }
      const duplicate = rows.actionSubmissions.some((submission) => (
        submission.match_id === params[1]
        && submission.seat_no === params[3]
        && submission.turn_no === params[4]
        && submission.revision === params[5]
      ));
      if (duplicate) {
        const error = Object.assign(new Error('unique constraint failed'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });
        throw error;
      }
      rows.actionSubmissions.push({
        id: params[0],
        match_id: params[1],
        user_id: params[2],
        seat_no: params[3],
        turn_no: params[4],
        revision: params[5],
        action_payload: params[6],
        validation_result: params[7],
        is_final: params[8]
      });
      return { changes: 1 };
    }
    if (sql.includes('INSERT INTO arena_v2_match_queue')) {
      rows.quickQueue.push({
        id: params[0],
        season_id: params[1],
        user_id: params[2],
        deck_id: params[3],
        mmr: params[4],
        status: 'waiting',
        search_min_mmr: params[5],
        search_max_mmr: params[6],
        proposal_id: null,
        accept_deadline_at: null,
        accepted_at: null,
        matched_match_id: null,
        joined_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        expires_at: params[7]
      });
      return { changes: 1 };
    }
    if (sql.includes('INSERT INTO arena_v2_battle_royale_queue')) {
      rows.battleRoyaleQueue.push({
        id: params[0],
        season_id: params[1],
        user_id: params[2],
        deck_id: params[3],
        status: 'waiting',
        battle_royale_id: null,
        joined_at: 'now',
        updated_at: 'now',
        expires_at: params[4]
      });
    }
    if (sql.includes('INSERT INTO arena_v2_replay_events')) {
      rows.replayEvents.push({
        match_id: params[0],
        seq: params[1],
        turn_no: params[2],
        event_type: params[3],
        payload: params[4],
        expires_at: params[5]
      });
    }
    if (sql.includes('INSERT INTO arena_v2_replay_holds')) {
      rows.replayHolds.push({
        id: params[0],
        match_id: params[1],
        reason: params[2],
        status: 'active',
        hold_until: params[3],
        created_by: params[4]
      });
    }
    if (sql.includes('INSERT INTO arena_v2_ratings')) {
      rows.ratings.push({
        id: params[0],
        season_id: params[1],
        user_id: params[2],
        mmr: params[3],
        peak_mmr: params[4],
        tier: params[5],
        peak_tier: params[6],
        wins: params[7],
        losses: params[8],
        draws: params[9],
        last_match_id: params[10],
        updated_at: 'now'
      });
    }
    if (sql.includes('UPDATE arena_v2_decks') && sql.includes('SET validation_hash')) {
      const deck = rows.decks.find((item) => item.id === params[3] && item.user_id === params[4]);
      if (deck) {
        deck.validation_hash = params[0];
        deck.is_valid = params[1];
        deck.validation_result = params[2];
      }
    }
    if (sql.includes('UPDATE arena_v2_decks') && !sql.includes('SET validation_hash')) {
      const deck = rows.decks.find((item) => item.id === params[7] && item.user_id === params[8]);
      if (deck) {
        deck.season_id = params[0];
        deck.name = params[1];
        deck.mode_scope = params[2];
        deck.card_version_ids = params[3];
        deck.validation_hash = params[4];
        deck.is_valid = params[5];
        deck.validation_result = params[6];
      }
    }
    if (sql.includes('DELETE FROM arena_v2_decks')) {
      const index = rows.decks.findIndex((item) => item.id === params[0] && item.user_id === params[1]);
      if (index >= 0) rows.decks.splice(index, 1);
    }
    if (sql.includes('UPDATE arena_v2_match_players')) {
      if (sql.includes('SET final_rank = CASE WHEN seat_no = ?')) {
        const players = rows.matchPlayers.filter((item) => item.match_id === params[2]);
        for (const player of players) {
          const surrendered = Number(player.seat_no) === Number(params[0]);
          player.final_rank = surrendered ? 2 : 1;
          if (surrendered) player.player_health = 0;
        }
        return { changes: players.length };
      } else if (sql.includes('SET mulligan_state = ?')) {
        const player = rows.matchPlayers.find((item) => item.match_id === params[1] && item.seat_no === params[2]);
        if (!player) return { changes: 0 };
        player.mulligan_state = params[0];
        return { changes: 1 };
      } else if (sql.includes('player_health')) {
        const player = rows.matchPlayers.find((item) => item.match_id === params[7] && item.seat_no === params[8]);
        if (player) {
          player.player_health = params[0];
          player.fatigue_count = params[1];
          player.hand_card_instance_ids = params[2];
          player.deck_card_instance_ids = params[3];
          player.graveyard_card_instance_ids = params[4];
          player.board_state = params[5];
          player.mulligan_state = params[6];
        }
      } else {
        const player = rows.matchPlayers.find((item) => item.match_id === params[3] && item.seat_no === params[4]);
        const match = rows.matches.find((item) => item.id === params[3]);
        if (!player || (sql.includes('EXISTS') && match?.status !== 'mulligan')) return { changes: 0 };
        player.hand_card_instance_ids = params[0];
        player.deck_card_instance_ids = params[1];
        player.mulligan_state = params[2];
        return { changes: 1 };
      }
    }
    if (sql.includes('UPDATE arena_v2_card_instances')) {
      if (sql.includes("SET zone = 'hand'")) {
        const instance = rows.cardInstances.find((item) => item.id === params[0]);
        if (instance) {
          instance.zone = 'hand';
          instance.position = null;
        }
      } else if (sql.includes("SET zone = 'deck'")) {
        const instance = rows.cardInstances.find((item) => item.id === params[0]);
        if (instance) {
          instance.zone = 'deck';
          instance.position = null;
        }
      } else {
        const instance = rows.cardInstances.find((item) => item.id === params[7]);
        if (instance) {
          instance.zone = params[0];
          instance.position = params[1];
          instance.current_attack = params[2];
          instance.current_health = params[3];
          instance.damage_taken = params[4];
          instance.status_effects = params[5];
          instance.created_turn = params[6];
        }
      }
    }
    if (sql.includes('UPDATE arena_v2_matches')) {
      if (sql.includes("status = 'turn_planning'")) {
        const match = rows.matches.find((item) => item.id === params[1] && item.status === 'turn_result');
        if (match) {
          match.status = 'turn_planning';
          match.result_summary = params[0];
          return { changes: 1 };
        }
        return { changes: 0 };
      } else if (sql.includes("status = 'turn_result'")) {
        const match = rows.matches.find((item) => item.id === params[1] && item.status === 'mulligan');
        if (match) {
          match.status = 'turn_result';
          match.result_summary = params[0];
          return { changes: 1 };
        }
        return { changes: 0 };
      } else if (sql.includes("status = 'combat_resolving'")) {
        const match = rows.matches.find((item) => item.id === params[0]
          && item.turn_no === params[1]
          && ['turn_planning', 'action_locked'].includes(item.status));
        if (!match) return { changes: 0 };
        match.status = 'combat_resolving';
        return { changes: 1 };
      } else if (sql.includes("status = 'action_locked'")) {
        const match = rows.matches.find((item) => item.id === params[1] && item.turn_no === params[2]);
        if (match) {
          match.status = 'action_locked';
          match.result_summary = params[0];
        }
      } else if (sql.includes("SET status = 'completed'") && sql.includes('winner_user_id = ?')) {
        const match = rows.matches.find((item) => item.id === params[4] && !['completed', 'cancelled'].includes(item.status));
        if (!match) return { changes: 0 };
        match.status = 'completed';
        match.winner_user_id = params[0];
        match.finished_at = params[1];
        match.replay_expires_at = params[2];
        match.result_summary = params[3];
        match.updated_at = 'now';
        return { changes: 1 };
      } else if (sql.includes('finished_at')) {
        const match = rows.matches.find((item) => item.id === params[6]);
        if (match) {
          match.status = params[0];
          match.turn_no = params[1];
          match.winner_user_id = params[2];
          match.finished_at = params[3];
          match.replay_expires_at = params[4];
          match.result_summary = params[5];
        }
      } else if (sql.includes('SET result_summary = ?')) {
        const match = rows.matches.find((item) => item.id === params[1] && item.status === 'mulligan');
        if (match) {
          match.result_summary = params[0];
        }
      } else {
        const match = rows.matches.find((item) => item.id === params[3]);
        if (match) {
          match.status = params[0];
          match.turn_no = params[1];
          match.winner_user_id = null;
          match.result_summary = params[2];
        }
      }
    }
    if (sql.includes('UPDATE arena_v2_ratings')) {
      const rating = rows.ratings.find((item) => item.id === params[8]);
      if (rating) {
        rating.mmr = params[0];
        rating.peak_mmr = params[1];
        rating.tier = params[2];
        rating.peak_tier = params[3];
        rating.wins = Number(rating.wins || 0) + Number(params[4] || 0);
        rating.losses = Number(rating.losses || 0) + Number(params[5] || 0);
        rating.draws = Number(rating.draws || 0) + Number(params[6] || 0);
        rating.last_match_id = params[7];
      }
    }
    if (sql.includes('UPDATE arena_v2_card_versions') && sql.includes("SET status = 'disabled'")) {
      rows.cards
        .filter((card) => card.season_id === params[0] && card.streamer_id === params[1] && card.status === 'active')
        .forEach((card) => {
          card.status = 'disabled';
          card.updated_at = 'now';
        });
    }
    if (sql.includes('UPDATE arena_v2_card_versions') && sql.includes("SET status = 'active'")) {
      const card = rows.cards.find((item) => item.id === params[0]);
      if (card) {
        card.status = 'active';
        card.updated_at = 'now';
      }
    }
    if (sql.includes('UPDATE arena_v2_card_versions') && sql.includes('SET card_class = ?')) {
      const card = rows.cards.find((item) => item.id === params[7] && item.season_id === params[8] && item.status === 'active');
      if (card) {
        card.card_class = params[0];
        card.cost = params[1];
        card.attack = params[2];
        card.health = params[3];
        card.keywords = params[4];
        card.balance_score = params[5];
        card.validation_result = params[6];
        card.updated_at = 'now';
      }
    }
    if (sql.includes('UPDATE arena_v2_match_queue')) {
      if (sql.includes("SET status = 'proposed'")) {
        const ticket = rows.quickQueue.find((item) => item.id === params[2] && item.status === 'waiting');
        if (!ticket) return { changes: 0 };
        ticket.status = 'proposed';
        ticket.proposal_id = params[0];
        ticket.accept_deadline_at = params[1];
        ticket.accepted_at = null;
        ticket.last_transition_reason = null;
        ticket.updated_at = new Date().toISOString();
        return { changes: 1 };
      }
      if (sql.includes("SET status = 'accepted'")) {
        const ticket = rows.quickQueue.find((item) => item.id === params[1]
          && item.status === 'proposed'
          && String(item.accept_deadline_at) > String(params[2]));
        if (!ticket) return { changes: 0 };
        ticket.status = 'accepted';
        ticket.accepted_at = params[0];
        ticket.updated_at = new Date().toISOString();
        return { changes: 1 };
      }
      if (sql.includes("SET status = 'matching'")) {
        const ticket = rows.quickQueue.find((item) => item.id === params[1]
          && item.proposal_id === params[2]
          && item.status === 'accepted');
        if (!ticket) return { changes: 0 };
        ticket.status = 'matching';
        ticket.matched_match_id = params[0];
        ticket.updated_at = new Date().toISOString();
        return { changes: 1 };
      }
      if (sql.includes("SET status = 'matched'")) {
        const ticket = rows.quickQueue.find((item) => item.id === params[1]
          && item.proposal_id === params[2]
          && item.status === 'matching');
        if (!ticket) return { changes: 0 };
        ticket.status = 'matched';
        ticket.matched_match_id = params[0];
        ticket.updated_at = new Date().toISOString();
        return { changes: 1 };
      }
      if (sql.includes("SET status = 'waiting', proposal_id = NULL")) {
        const ticket = rows.quickQueue.find((item) => item.id === params[4] && ['proposed', 'accepted'].includes(item.status));
        if (!ticket) return { changes: 0 };
        ticket.status = 'waiting';
        ticket.proposal_id = null;
        ticket.accept_deadline_at = null;
        ticket.accepted_at = null;
        ticket.search_min_mmr = params[0];
        ticket.search_max_mmr = params[1];
        ticket.last_transition_reason = params[2];
        ticket.expires_at = params[3];
        ticket.updated_at = new Date().toISOString();
        return { changes: 1 };
      }
      if (sql.includes("SET status = 'accept_timeout'")) {
        const ticket = rows.quickQueue.find((item) => item.id === params[0] && item.status === 'proposed');
        if (!ticket) return { changes: 0 };
        ticket.status = 'accept_timeout';
        ticket.last_transition_reason = 'proposal_expired';
        ticket.updated_at = new Date().toISOString();
        return { changes: 1 };
      }
      if (sql.includes("SET status = 'declined'")) {
        const ticket = rows.quickQueue.find((item) => item.id === params[0] && ['proposed', 'accepted'].includes(item.status));
        if (!ticket) return { changes: 0 };
        ticket.status = 'declined';
        ticket.last_transition_reason = 'cancelled_proposal';
        ticket.updated_at = new Date().toISOString();
        return { changes: 1 };
      }
      if (sql.includes("last_transition_reason = 'invalid_deck'")) {
        const ticket = rows.quickQueue.find((item) => item.id === params[0]
          && item.proposal_id === params[1]
          && item.status === 'accepted');
        if (!ticket) return { changes: 0 };
        ticket.status = 'cancelled';
        ticket.last_transition_reason = 'invalid_deck';
        ticket.updated_at = new Date().toISOString();
        return { changes: 1 };
      }
      if (sql.includes('SET search_min_mmr = ?')) {
        const ticket = rows.quickQueue.find((item) => item.id === params[2] && item.status === 'waiting');
        if (!ticket) return { changes: 0 };
        ticket.search_min_mmr = params[0];
        ticket.search_max_mmr = params[1];
        return { changes: 1 };
      }
      if (sql.includes("SET status = 'cancelled'") && sql.includes('WHERE id = ?')) {
        const ticketId = params[params.length - 1];
        const ticket = rows.quickQueue.find((item) => item.id === ticketId && ['waiting', 'proposed', 'accepted'].includes(item.status));
        if (!ticket) return { changes: 0 };
        ticket.status = 'cancelled';
        ticket.updated_at = new Date().toISOString();
        return { changes: 1 };
      }
      if (sql.includes("status = 'expired'")) {
        const before = rows.quickQueue.filter((ticket) => ticket.status === 'waiting').length;
        rows.quickQueue
          .filter((ticket) => ticket.status === 'waiting' && ticket.expires_at < params[0] && (!params[1] || ticket.season_id === params[1]) && (!params[2] || ticket.user_id === params[2]))
          .forEach((ticket) => {
            ticket.status = 'expired';
          });
        const after = rows.quickQueue.filter((ticket) => ticket.status === 'waiting').length;
        return { changes: before - after };
      }
      rows.quickQueue
        .filter((ticket) => ticket.season_id === params[0] && ticket.user_id === params[1] && ticket.status === 'waiting')
        .forEach((ticket) => {
          ticket.status = 'cancelled';
        });
    }
    if (sql.includes('UPDATE arena_v2_battle_royale_queue')) {
      if (sql.includes("status = 'expired'")) {
        const before = rows.battleRoyaleQueue.filter((ticket) => ticket.status === 'waiting').length;
        rows.battleRoyaleQueue
          .filter((ticket) => ticket.status === 'waiting' && ticket.expires_at < params[0] && (!params[1] || ticket.season_id === params[1]) && (!params[2] || ticket.user_id === params[2]))
          .forEach((ticket) => {
            ticket.status = 'expired';
          });
        const after = rows.battleRoyaleQueue.filter((ticket) => ticket.status === 'waiting').length;
        return { changes: before - after };
      }
      rows.battleRoyaleQueue
        .filter((ticket) => ticket.season_id === params[0] && ticket.user_id === params[1] && ticket.status === 'waiting')
        .forEach((ticket) => {
          ticket.status = 'cancelled';
        });
    }
    if (sql.includes('DELETE FROM arena_v2_replay_events')) {
      const before = rows.replayEvents.length;
      const activeHoldMatchIds = new Set(rows.replayHolds
        .filter((hold) => hold.status === 'active' && (!hold.hold_until || hold.hold_until >= params[1]))
        .map((hold) => hold.match_id));
      rows.replayEvents = rows.replayEvents.filter((event) => !(event.expires_at < params[0] && !activeHoldMatchIds.has(event.match_id)));
      return { changes: before - rows.replayEvents.length };
    }
    return { changes: 1 };
  }
});

const insertSeason = (overrides: Row = {}) => {
  rows.seasons.push({
    id: 'season-v2',
    season_key: '2026_s1',
    name: '시즌 1',
    status: 'active',
    starts_at: '2026-07-01T00:00:00Z',
    ends_at: '2026-08-01T00:00:00Z',
    modes_enabled: '{"quick":true,"bot":true,"battle_royale_8":true}',
    card_pool_version: 'cards-v2',
    balance_version: 'balance-v2',
    reward_table: '[]',
    mmr_tier_table: '[]',
    replay_retention_days: 7,
    ...overrides
  });
};

const insertCards = (count: number) => {
  for (let index = 0; index < count; index += 1) {
    rows.cards.push({
      id: `card-${index + 1}`,
      streamer_id: `streamer-${index + 1}`,
      display_name: `카드 ${index + 1}`,
      season_id: 'season-v2',
      version: 1,
      card_class: 'charge',
      cost: (index % 9) + 1,
      attack: 1,
      health: 2,
      keywords: '[]',
      balance_score: 0,
      validation_result: '{"valid":true}',
      art_asset_id: null,
      status: 'active'
    });
  }
};

const insertQuickDeck = (userId: string) => saveArenaV2Deck({
  userId,
  seasonId: 'season-v2',
  name: `${userId} 빠른 대전 덱`,
  modeScope: 'quick',
  cardVersionIds: Array.from({ length: 14 }, (_, index) => `card-${index + 1}`)
});

const insertQuickRating = (userId: string, mmr: number) => {
  rows.ratings.push({ season_id: 'season-v2', user_id: userId, mmr });
};

beforeEach(() => {
  resetRows();
  __setArenaV2ExecutorForTest(makeExecutor() as any);
});

afterEach(() => {
  vi.useRealTimers();
  __setArenaV2ExecutorForTest(null);
});

describe('arena v2 service', () => {
  it('reads the active v2 season', async () => {
    insertSeason();

    const season = await getArenaV2CurrentSeason();

    expect(season?.id).toBe('season-v2');
    expect(season?.modesEnabled).toEqual({ quick: true, bot: true, battle_royale_8: true });
  });

  it('uses a preparation season when no active season is running', async () => {
    insertSeason({ id: 'season-draft', season_key: '2026_draft', status: 'draft', starts_at: '2026-09-01T00:00:00Z' });

    const season = await getArenaV2CurrentSeason();

    expect(season?.id).toBe('season-draft');
    expect(season?.status).toBe('draft');
  });

  it('creates a default preparation season when no arena season exists', async () => {
    const season = await getArenaV2CurrentSeason();

    expect(season?.id).toBe('arena_v2_default_preseason');
    expect(season?.status).toBe('draft');
    expect(rows.seasons[0].created_by).toBe('system');
  });

  it('creates seasons with the required admin creator for the SQL schema', async () => {
    const season = await createArenaV2SeasonAdmin({
      seasonKey: '2026_s2',
      name: '시즌 2',
      startsAt: '2026-08-01T00:00:00Z',
      endsAt: '2026-09-01T00:00:00Z',
      modesEnabled: { quick: true, bot: true, battle_royale_8: true },
      cardPoolVersion: 'cards-v1',
      balanceVersion: 'balance-v1',
      rewardTable: [],
      mmrTierTable: [],
      createdBy: 'admin-user'
    });

    expect(season?.seasonKey).toBe('2026_s2');
    expect(rows.seasons[0].created_by).toBe('admin-user');
  });

  it('validates a deck using card versions loaded from arena_v2_card_versions', async () => {
    insertCards(14);

    const validation = await validateArenaV2DeckForSeason('season-v2', Array.from({ length: 14 }, (_, index) => `card-${index + 1}`));

    expect(validation.valid).toBe(true);
  });

  it('rejects active card versions whose stored combat data violates the GDD validator', async () => {
    insertCards(14);
    rows.cards[0].keywords = JSON.stringify([{ type: 'direct_pressure', value: 1 }]);
    rows.cards[1].card_class = 'legacy';
    rows.cards[2].validation_result = JSON.stringify({ valid: false, errors: [{ code: 'manual', message: 'failed' }], warnings: [] });

    const validation = await validateArenaV2DeckForSeason('season-v2', Array.from({ length: 14 }, (_, index) => `card-${index + 1}`));
    const codes = validation.errors.map((error) => error.code);

    expect(codes).toContain('ArenaV2CardForbiddenCombo');
    expect(codes).toContain('ArenaV2CardInvalidClass');
    expect(codes).toContain('ArenaV2CardStoredValidationFailed');
  });

  it('lists active cards for the current season', async () => {
    insertSeason();
    insertCards(3);
    rows.cards[1].status = 'disabled';

    const cards = await listArenaV2Cards();

    expect(cards.map((card) => card.id)).toEqual(['card-1', 'card-3']);
    expect(cards[0].keywords).toEqual([]);
  });

  it('paginates active card lists with offset', async () => {
    insertSeason();
    insertCards(5);

    const firstPage = await listArenaV2Cards({ seasonId: 'season-v2', limit: 2, offset: 0 });
    const secondPage = await listArenaV2Cards({ seasonId: 'season-v2', limit: 2, offset: 2 });

    expect(firstPage.map((card) => card.id)).toEqual(['card-1', 'card-2', 'card-3']);
    expect(secondPage.map((card) => card.id)).toEqual(['card-3', 'card-4', 'card-5']);
  });

  it('syncs active arena cards from registered chikapo streamers instead of mock data', async () => {
    insertSeason();
    rows.streamers.push({
      channel_id: 'streamer-real-1',
      name: '실제 스트리머',
      logo_url: 'https://img.example/logo.png',
      custom_image_url: 'https://img.example/card.png',
      follower_count: 2400,
      base_value: 900,
      is_image_banned: 0,
      registered_by: 'streamer-real-1'
    });

    const sync = await syncArenaV2CardsFromRegisteredStreamers('season-v2');
    const cards = await listArenaV2Cards({ seasonId: 'season-v2' });

    expect(sync.created).toBe(1);
    expect(cards).toHaveLength(1);
    expect(cards[0].streamerId).toBe('streamer-real-1');
    expect(cards[0].displayName).toBe('실제 스트리머');
    expect(cards[0].artAssetId).toBe('https://img.example/card.png');
    expect(cards[0].validationResult?.valid).toBe(true);
  });

  it('coalesces concurrent default-card inserts without creating duplicate primary keys', async () => {
    insertSeason();
    rows.streamers.push({
      channel_id: 'concurrent-generated-streamer',
      name: '동시 생성 스트리머',
      logo_url: null,
      custom_image_url: null,
      follower_count: 2400,
      base_value: 900,
      is_image_banned: 0,
      registered_by: 'concurrent-generated-streamer'
    });

    const results = await Promise.all([
      syncArenaV2CardsFromRegisteredStreamers('season-v2'),
      syncArenaV2CardsFromRegisteredStreamers('season-v2')
    ]);

    expect(rows.cards).toHaveLength(1);
    expect(results.reduce((sum, result) => sum + result.created, 0)).toBe(1);
  });

  it('paginates through every registered streamer when synchronizing generated cards', async () => {
    insertSeason();
    rows.streamers.push(...Array.from({ length: 1001 }, (_, index) => {
      const channelId = `paged-streamer-${String(index).padStart(4, '0')}`;
      return {
        channel_id: channelId,
        name: `페이지 스트리머 ${index}`,
        logo_url: null,
        custom_image_url: null,
        follower_count: 1000 + index,
        base_value: 1000 - (index % 11),
        is_image_banned: 0,
        registered_by: channelId
      };
    }));

    const sync = await syncArenaV2CardsFromRegisteredStreamers('season-v2');

    expect(sync).toMatchObject({ scanned: 1001, created: 1001, updated: 0, skipped: 0 });
    expect(rows.cards).toHaveLength(1001);
    for (const card of rows.cards) {
      const budget = evaluateArenaV2CardBudget({
        id: card.id,
        streamerId: card.streamer_id,
        seasonId: card.season_id,
        status: card.status,
        cardClass: card.card_class,
        cost: card.cost,
        attack: card.attack,
        health: card.health,
        keywords: JSON.parse(card.keywords),
        validationResult: JSON.parse(card.validation_result)
      });
      expect(budget.remaining).toBe(0);
      expect(card.balance_score).toBe(budget.budgetLimit);
    }

    const repeated = await syncArenaV2CardsFromRegisteredStreamers('season-v2');
    expect(repeated).toMatchObject({ scanned: 1001, created: 0, updated: 0, skipped: 1001 });
  });

  it('rebuilds an existing active generated card in place with the current generation rules', async () => {
    insertSeason({ status: 'draft' });
    rows.streamers.push({
      channel_id: 'existing-generated-streamer',
      name: '기존 자동 생성 스트리머',
      logo_url: null,
      custom_image_url: null,
      follower_count: 2400,
      base_value: 900,
      is_image_banned: 0,
      registered_by: 'existing-generated-streamer'
    });

    await syncArenaV2CardsFromRegisteredStreamers('season-v2');
    const existing = rows.cards[0];
    const originalId = existing.id;
    const originalVersion = existing.version;
    existing.card_class = 'charge';
    existing.cost = 2;
    existing.attack = 1;
    existing.health = 4;
    existing.keywords = '[]';
    existing.balance_score = 7;
    existing.validation_result = JSON.stringify({ valid: true, issues: [] });

    const cards = await listArenaV2Cards({ seasonId: 'season-v2' });
    const generated = generateArenaV2DefaultCardCombatDefinition('existing-generated-streamer');

    expect(cards).toHaveLength(1);
    expect(existing.id).toBe(originalId);
    expect(existing.version).toBe(originalVersion);
    expect(existing.card_class).toBe(generated.cardClass);
    expect(existing.cost).toBe(generated.cost);
    expect(existing.attack).toBe(generated.attack);
    expect(existing.health).toBe(generated.health);
    expect(JSON.parse(existing.keywords)).toEqual(generated.keywords);
    expect(evaluateArenaV2CardBudget({
      id: existing.id,
      streamerId: existing.streamer_id,
      seasonId: existing.season_id,
      status: existing.status,
      cardClass: existing.card_class,
      cost: existing.cost,
      attack: existing.attack,
      health: existing.health,
      keywords: JSON.parse(existing.keywords),
      validationResult: JSON.parse(existing.validation_result)
    })).toMatchObject({
      totalCost: existing.balance_score,
      remaining: 0,
      isOverBudget: false
    });
  });

  it('rebuilds a legacy generated card in place without changing its referenced id', async () => {
    insertSeason({ status: 'draft' });
    const streamerId = 'legacy-generated-streamer';
    rows.streamers.push({
      channel_id: streamerId,
      name: '구형 자동 카드 스트리머',
      logo_url: null,
      custom_image_url: null,
      follower_count: 2400,
      base_value: 900,
      is_image_banned: 0,
      registered_by: streamerId
    });
    const legacyId = `arena_v2_card_season-v2_${streamerId}`;
    rows.cards.push({
      id: legacyId,
      streamer_id: streamerId,
      display_name: '구형 자동 카드 스트리머',
      season_id: 'season-v2',
      version: 1,
      card_class: 'charge',
      cost: 2,
      attack: 1,
      health: 4,
      keywords: '[]',
      balance_score: 7,
      validation_result: JSON.stringify({ valid: true, issues: [] }),
      art_asset_id: null,
      status: 'active'
    });

    const sync = await syncArenaV2CardsFromRegisteredStreamers('season-v2');
    const existing = rows.cards[0];
    const budget = evaluateArenaV2CardBudget({
      id: existing.id,
      streamerId: existing.streamer_id,
      seasonId: existing.season_id,
      status: existing.status,
      cardClass: existing.card_class,
      cost: existing.cost,
      attack: existing.attack,
      health: existing.health,
      keywords: JSON.parse(existing.keywords),
      validationResult: JSON.parse(existing.validation_result)
    });

    expect(sync).toMatchObject({ created: 0, updated: 1, skipped: 0 });
    expect(existing.id).toBe(legacyId);
    expect(existing.version).toBe(1);
    expect(budget).toMatchObject({ totalCost: budget.budgetLimit, remaining: 0, isOverBudget: false });
  });

  it('upgrades a preparation season to v2 before rebuilding its generated cards', async () => {
    insertSeason({ status: 'draft', card_pool_version: 'cards-v1', balance_version: 'balance-v1' });
    const streamerId = 'preseason-rebalance-streamer';
    rows.streamers.push({
      channel_id: streamerId,
      name: '프리시즌 리밸런싱 스트리머',
      logo_url: null,
      custom_image_url: null,
      follower_count: 2400,
      base_value: 900,
      is_image_banned: 0,
      registered_by: streamerId
    });

    const sync = await syncArenaV2CardsFromRegisteredStreamers('season-v2');
    const generated = rows.cards[0];
    const budget = evaluateArenaV2CardBudget({
      id: generated.id,
      streamerId: generated.streamer_id,
      seasonId: generated.season_id,
      status: generated.status,
      cardClass: generated.card_class,
      cost: generated.cost,
      attack: generated.attack,
      health: generated.health,
      keywords: JSON.parse(generated.keywords),
      validationResult: JSON.parse(generated.validation_result)
    });

    expect(sync).toMatchObject({ created: 1, updated: 0 });
    expect(rows.seasons[0]).toMatchObject({ card_pool_version: 'cards-v2', balance_version: 'balance-v2' });
    expect(budget).toMatchObject({ totalCost: budget.budgetLimit, remaining: 0, isOverBudget: false });
  });

  it('selects only an unfinished preparation season for worker card synchronization', async () => {
    insertSeason({
      id: 'season-synced',
      status: 'scheduled',
      starts_at: '2026-07-01T00:00:00Z',
      card_pool_version: 'cards-v2',
      balance_version: 'balance-v2'
    });
    insertSeason({
      id: 'season-pending',
      status: 'draft',
      starts_at: '2026-08-01T00:00:00Z',
      card_pool_version: 'cards-v1',
      balance_version: 'balance-v1'
    });

    expect(await getArenaV2PreparationSeasonForGeneratedCardSync()).toMatchObject({ id: 'season-pending' });

    rows.seasons.find((season) => season.id === 'season-pending')!.card_pool_version = 'cards-v2';
    rows.seasons.find((season) => season.id === 'season-pending')!.balance_version = 'balance-v2';
    expect(await getArenaV2PreparationSeasonForGeneratedCardSync()).toBeNull();
  });

  it('selects a v2 preparation season when an eligible streamer card is still missing', async () => {
    insertSeason({ status: 'draft' });
    rows.streamers.push({
      channel_id: 'v2-empty-season-streamer',
      name: '빈 시즌 동기화 스트리머',
      logo_url: null,
      custom_image_url: null,
      follower_count: 2400,
      base_value: 900,
      is_image_banned: 0,
      registered_by: 'v2-empty-season-streamer'
    });

    expect(await getArenaV2PreparationSeasonForGeneratedCardSync()).toMatchObject({ id: 'season-v2' });

    await syncArenaV2CardsFromRegisteredStreamers('season-v2');

    expect(rows.cards).toHaveLength(1);
    expect(await getArenaV2PreparationSeasonForGeneratedCardSync()).toBeNull();
  });

  it('rejects season activation until every eligible streamer has a synchronized v2 card', async () => {
    insertSeason({
      status: 'scheduled',
      card_pool_version: 'cards-v1',
      balance_version: 'balance-v1'
    });
    rows.streamers.push(
      {
        channel_id: 'season-activation-streamer-a',
        name: '시즌 활성화 스트리머 A',
        logo_url: null,
        custom_image_url: null,
        follower_count: 2400,
        base_value: 900,
        is_image_banned: 0,
        registered_by: 'season-activation-streamer-a'
      },
      {
        channel_id: 'season-activation-streamer-b',
        name: '시즌 활성화 스트리머 B',
        logo_url: null,
        custom_image_url: null,
        follower_count: 4200,
        base_value: 1200,
        is_image_banned: 0,
        registered_by: 'season-activation-streamer-b'
      }
    );

    await expect(transitionArenaV2SeasonAdmin('season-v2', 'active', 'season-open'))
      .rejects.toThrow('ArenaV2SeasonCardSyncRequired');
    expect(rows.seasons[0].status).toBe('scheduled');

    rows.seasons[0].card_pool_version = 'cards-v2';
    rows.seasons[0].balance_version = 'balance-v2';

    await expect(transitionArenaV2SeasonAdmin('season-v2', 'active', 'season-open'))
      .rejects.toThrow('ArenaV2SeasonCardSyncRequired');

    await syncArenaV2CardsFromRegisteredStreamers('season-v2');
    rows.cards = rows.cards.filter((card) => card.streamer_id !== 'season-activation-streamer-b');

    await expect(transitionArenaV2SeasonAdmin('season-v2', 'active', 'season-open'))
      .rejects.toThrow('ArenaV2SeasonCardSyncRequired');

    await syncArenaV2CardsFromRegisteredStreamers('season-v2');
    const transition = await transitionArenaV2SeasonAdmin('season-v2', 'active', 'season-open');

    expect(rows.cards.filter((card) => card.status === 'active')).toHaveLength(2);
    expect(transition.season?.status).toBe('active');
    expect(rows.seasons[0].status).toBe('active');
  });

  it('keeps existing generated rows immutable after a v2 season becomes active', async () => {
    insertSeason({ status: 'draft', card_pool_version: 'cards-v1', balance_version: 'balance-v1' });
    const streamerId = 'active-v2-immutable-streamer';
    rows.streamers.push({
      channel_id: streamerId,
      name: '활성 시즌 자동 카드 스트리머',
      logo_url: null,
      custom_image_url: null,
      follower_count: 2400,
      base_value: 900,
      is_image_banned: 0,
      registered_by: streamerId
    });

    await syncArenaV2CardsFromRegisteredStreamers('season-v2');
    rows.seasons[0].status = 'active';
    const generated = rows.cards[0];
    generated.attack = Math.max(0, Number(generated.attack) - 1);
    generated.balance_score = Number(generated.balance_score) - 2;
    const before = { ...generated };

    const sync = await syncArenaV2CardsFromRegisteredStreamers('season-v2');

    expect(sync).toMatchObject({ scanned: 1, created: 0, updated: 0, skipped: 1 });
    expect(rows.cards[0]).toEqual(before);
    expect(rows.seasons[0]).toMatchObject({
      status: 'active',
      card_pool_version: 'cards-v2',
      balance_version: 'balance-v2'
    });
  });

  it('does not rewrite generated cards from locked or completed historical seasons', async () => {
    insertSeason({ status: 'closed', card_pool_version: 'cards-v1', balance_version: 'balance-v1' });
    const streamerId = 'historical-generated-streamer';
    rows.streamers.push({
      channel_id: streamerId,
      name: '과거 시즌 스트리머',
      logo_url: null,
      custom_image_url: null,
      follower_count: 2400,
      base_value: 900,
      is_image_banned: 0,
      registered_by: streamerId
    });
    rows.cards.push({
      id: `arena_v2_card_season-v2_${streamerId}`,
      streamer_id: streamerId,
      display_name: '과거 시즌 스트리머',
      season_id: 'season-v2',
      version: 1,
      card_class: 'charge',
      cost: 2,
      attack: 1,
      health: 4,
      keywords: '[]',
      balance_score: 7,
      validation_result: JSON.stringify({ valid: true, issues: [] }),
      art_asset_id: null,
      status: 'active'
    });
    const before = { ...rows.cards[0] };

    const sync = await syncArenaV2CardsFromRegisteredStreamers('season-v2');

    expect(sync).toMatchObject({ scanned: 0, created: 0, updated: 0, skipped: 0 });
    expect(rows.cards[0]).toEqual(before);
    expect(rows.seasons[0]).toMatchObject({ card_pool_version: 'cards-v1', balance_version: 'balance-v1' });
  });

  it('keeps a streamer-authored active version unchanged during generated-card refresh', async () => {
    insertSeason();
    rows.streamers.push({
      channel_id: 'authored-streamer',
      name: '직접 설정 스트리머',
      logo_url: null,
      custom_image_url: null,
      follower_count: 2400,
      base_value: 900,
      is_image_banned: 0,
      registered_by: 'authored-streamer'
    });
    rows.cards.push({
      id: 'arena_v2_card_manual-version',
      streamer_id: 'authored-streamer',
      display_name: '직접 설정 스트리머',
      season_id: 'season-v2',
      version: 2,
      card_class: 'guardian',
      cost: 4,
      attack: 2,
      health: 6,
      keywords: JSON.stringify([{ type: 'taunt' }]),
      balance_score: 20,
      validation_result: JSON.stringify({ valid: true, issues: [] }),
      art_asset_id: null,
      status: 'active'
    });

    const before = { ...rows.cards[0] };
    const sync = await syncArenaV2CardsFromRegisteredStreamers('season-v2');

    expect(sync).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    expect(rows.cards[0]).toEqual(before);
  });

  it('fully spends the budget before re-enabling a disabled generated card', async () => {
    insertSeason({ status: 'draft' });
    const streamerId = 'disabled-generated-streamer';
    rows.streamers.push({
      channel_id: streamerId,
      name: '비활성 자동 카드 스트리머',
      logo_url: null,
      custom_image_url: null,
      follower_count: 2400,
      base_value: 900,
      is_image_banned: 0,
      registered_by: streamerId
    });
    await syncArenaV2CardsFromRegisteredStreamers('season-v2');
    const generated = rows.cards[0];
    generated.status = 'disabled';
    generated.health = Math.max(1, Number(generated.health) - 1);
    generated.balance_score = Number(generated.balance_score) - 1;

    const result = await enableMyArenaV2StreamerCard(streamerId);
    const budget = evaluateArenaV2CardBudget(result.card!);

    expect(result.enabled).toBe(true);
    expect(result.card?.id).toBe(generated.id);
    expect(result.card?.status).toBe('active');
    expect(budget).toMatchObject({ totalCost: budget.budgetLimit, remaining: 0, isOverBudget: false });
  });

  it('creates only the requested streamer card when enabling without card history', async () => {
    insertSeason({ status: 'active', card_pool_version: 'cards-v2', balance_version: 'balance-v2' });
    rows.streamers.push(
      {
        channel_id: 'enable-target-streamer',
        name: '활성화 대상 스트리머',
        logo_url: null,
        custom_image_url: null,
        follower_count: 2400,
        base_value: 900,
        is_image_banned: 0,
        registered_by: 'enable-target-streamer'
      },
      ...Array.from({ length: 20 }, (_, index) => ({
        channel_id: `unrelated-enable-streamer-${index}`,
        name: `무관한 스트리머 ${index}`,
        logo_url: null,
        custom_image_url: null,
        follower_count: 1000,
        base_value: 500 - index,
        is_image_banned: 0,
        registered_by: `unrelated-enable-streamer-${index}`
      }))
    );

    const result = await enableMyArenaV2StreamerCard('enable-target-streamer');

    expect(result.card?.streamerId).toBe('enable-target-streamer');
    expect(rows.cards).toHaveLength(1);
    expect(rows.cards[0].streamer_id).toBe('enable-target-streamer');
  });

  it('does not rewrite a disabled streamer-authored card when re-enabling it', async () => {
    insertSeason();
    const streamerId = 'disabled-authored-streamer';
    rows.streamers.push({
      channel_id: streamerId,
      name: '비활성 수동 카드 스트리머',
      logo_url: null,
      custom_image_url: null,
      follower_count: 2400,
      base_value: 900,
      is_image_banned: 0,
      registered_by: streamerId
    });
    rows.cards.push({
      id: 'arena_v2_card_manual-disabled-version',
      streamer_id: streamerId,
      display_name: '비활성 수동 카드 스트리머',
      season_id: 'season-v2',
      version: 2,
      card_class: 'guardian',
      cost: 4,
      attack: 1,
      health: 5,
      keywords: JSON.stringify([{ type: 'taunt' }]),
      balance_score: 12,
      validation_result: JSON.stringify({ valid: true, issues: [] }),
      art_asset_id: null,
      status: 'disabled'
    });
    const before = { ...rows.cards[0] };

    const result = await enableMyArenaV2StreamerCard(streamerId);

    expect(result.enabled).toBe(true);
    expect(result.card?.id).toBe(before.id);
    expect(rows.cards[0]).toMatchObject({ ...before, status: 'active', updated_at: 'now' });
  });

  it('generates deterministic and diverse 1~9 cost cards within every cost budget', () => {
    const sampleSize = 5000;
    const costCounts = new Map<number, number>();
    const classes = new Set<string>();
    const profiles = new Set<string>();
    const keywordCounts = new Set<number>();
    const signatures = new Set<string>();
    const signaturesByCost = new Map<number, Set<string>>();
    const costClassPairs = new Set<string>();

    for (let index = 0; index < sampleSize; index += 1) {
      const streamerId = `generated-streamer-${index}`;
      const generated = generateArenaV2DefaultCardCombatDefinition(streamerId);
      const repeated = generateArenaV2DefaultCardCombatDefinition(streamerId);
      expect(repeated).toEqual(generated);
      const candidate = {
        id: `generated-card-${index}`,
        streamerId,
        seasonId: 'generated-season',
        status: 'active' as const,
        cardClass: generated.cardClass,
        cost: generated.cost,
        attack: generated.attack,
        health: generated.health,
        keywords: generated.keywords,
        validationResult: null
      };
      const validation = validateArenaV2CardVersionDefinition(candidate);
      const budget = evaluateArenaV2CardBudget(candidate);

      expect(validation.valid).toBe(true);
      expect(budget.isOverBudget).toBe(false);
      expect(budget.totalCost).toBe(budget.budgetLimit);
      expect(budget.remaining).toBe(0);
      expect(generated.keywords.every((keyword) => !['pursuit', 'grave_buff'].includes(keyword.type))).toBe(true);
      costCounts.set(generated.cost, (costCounts.get(generated.cost) || 0) + 1);
      costClassPairs.add(`${generated.cost}:${generated.cardClass}`);
      classes.add(generated.cardClass);
      profiles.add(generated.profile);
      keywordCounts.add(generated.keywords.length);
      const signature = `${generated.cardClass}:${generated.cost}:${generated.attack}:${generated.health}:${JSON.stringify(generated.keywords)}`;
      signatures.add(signature);
      const costSignatures = signaturesByCost.get(generated.cost) || new Set<string>();
      costSignatures.add(signature);
      signaturesByCost.set(generated.cost, costSignatures);
    }

    const expectedPercentages: Record<number, number> = { 1: 9, 2: 13, 3: 15, 4: 15, 5: 14, 6: 12, 7: 10, 8: 7, 9: 5 };
    for (const [costText, expectedPercentage] of Object.entries(expectedPercentages)) {
      const percentage = ((costCounts.get(Number(costText)) || 0) / sampleSize) * 100;
      expect(Math.abs(percentage - expectedPercentage)).toBeLessThanOrEqual(2);
    }
    expect(classes.size).toBe(7);
    expect(costClassPairs.size).toBe(63);
    expect(profiles).toEqual(new Set(['aggressive', 'durable', 'tactical', 'balanced']));
    expect(keywordCounts).toEqual(new Set([0, 1, 2, 3]));
    const minimumSignaturesByCost: Record<number, number> = {
      1: 50, 2: 100, 3: 170, 4: 230, 5: 220, 6: 230, 7: 190, 8: 130, 9: 110
    };
    for (const [costText, minimum] of Object.entries(minimumSignaturesByCost)) {
      expect(signaturesByCost.get(Number(costText))?.size || 0).toBeGreaterThanOrEqual(minimum);
    }
    expect(signatures.size).toBeGreaterThan(1700);
  });

  it('syncs arena owned cards from the user chikapo inventory', async () => {
    insertSeason();
    rows.streamers.push(
      {
        channel_id: 'owned-streamer',
        name: '보유 스트리머',
        logo_url: 'https://img.example/owned-logo.png',
        custom_image_url: 'https://img.example/owned-card.png',
        follower_count: 3000,
        base_value: 1200,
        is_image_banned: 0,
        registered_by: 'owned-streamer'
      },
      {
        channel_id: 'unowned-streamer',
        name: '미보유 스트리머',
        logo_url: null,
        custom_image_url: null,
        follower_count: 3000,
        base_value: 1200,
        is_image_banned: 0,
        registered_by: 'unowned-streamer'
      }
    );
    rows.userCards.push(
      { id: 1, user_id: 'user-1', channel_id: 'owned-streamer', serial_number: 1, star: 0 },
      { id: 2, user_id: 'user-1', channel_id: 'owned-streamer', serial_number: 2, star: 2 },
      { id: 3, user_id: 'user-2', channel_id: 'unowned-streamer', serial_number: 1, star: 0 }
    );

    const sync = await syncArenaV2CardsFromOwnedCards('user-1', 'season-v2');
    const ownedCards = await listArenaV2OwnedCardsForUser('user-1', { seasonId: 'season-v2' });

    expect(sync.scanned).toBe(1);
    expect(sync.created).toBe(1);
    expect(ownedCards).toHaveLength(1);
    expect(ownedCards[0].streamerId).toBe('owned-streamer');
    expect(ownedCards[0].ownedCount).toBe(2);
    expect(ownedCards[0].ownedStars).toEqual([0, 2]);
  });

  it('lists owned cards through the default preparation season without an active season', async () => {
    rows.streamers.push({
      channel_id: 'owned-preseason-streamer',
      name: '준비 시즌 스트리머',
      logo_url: null,
      custom_image_url: 'https://img.example/preseason-card.png',
      follower_count: 1000,
      base_value: 800,
      is_image_banned: 0,
      registered_by: 'owned-preseason-streamer'
    });
    rows.userCards.push({ id: 1, user_id: 'user-1', channel_id: 'owned-preseason-streamer', serial_number: 1, star: 1 });

    const ownedCards = await listArenaV2OwnedCardsForUser('user-1');

    expect(rows.seasons[0].id).toBe('arena_v2_default_preseason');
    expect(ownedCards).toHaveLength(1);
    expect(ownedCards[0].seasonId).toBe('arena_v2_default_preseason');
    expect(ownedCards[0].streamerId).toBe('owned-preseason-streamer');
  });

  it('keeps generated arena card ids within the SQL varchar limit', async () => {
    rows.streamers.push({
      channel_id: '387c808edb5995772719d7d63fbf6eb0',
      name: '긴 ID 스트리머',
      logo_url: null,
      custom_image_url: null,
      follower_count: 1000,
      base_value: 800,
      is_image_banned: 0,
      registered_by: '387c808edb5995772719d7d63fbf6eb0'
    });
    rows.userCards.push({ id: 1, user_id: 'user-1', channel_id: '387c808edb5995772719d7d63fbf6eb0', serial_number: 1, star: 0 });

    const ownedCards = await listArenaV2OwnedCardsForUser('user-1');

    expect(ownedCards[0].id.length).toBeLessThanOrEqual(64);
    expect(ownedCards[0].id).toMatch(/^arena_v2_card_[a-f0-9]{32}$/);
  });

  it('preserves long card art urls for SQL TEXT storage', async () => {
    const longArtUrl = `https://cdn.example.com/uploads/${'long-card-art-path-'.repeat(16)}image.png`;
    rows.streamers.push({
      channel_id: 'long-art-streamer',
      name: '긴 이미지 스트리머',
      logo_url: null,
      custom_image_url: longArtUrl,
      follower_count: 1000,
      base_value: 800,
      is_image_banned: 0,
      registered_by: 'long-art-streamer'
    });
    rows.userCards.push({ id: 1, user_id: 'user-1', channel_id: 'long-art-streamer', serial_number: 1, star: 0 });

    const ownedCards = await listArenaV2OwnedCardsForUser('user-1');

    expect(longArtUrl.length).toBeGreaterThan(191);
    expect(ownedCards[0].artAssetId?.length).toBeGreaterThan(191);
    expect(ownedCards[0].artAssetId).toMatch(/^\/uploads\/long-card-art-path-/);
  });

  it('lets a registered streamer customize combat settings while keeping the registered streamer name', async () => {
    insertSeason();
    rows.streamers.push({
      channel_id: 'streamer-owner',
      name: '오너 스트리머',
      logo_url: 'https://img.example/owner-logo.png',
      custom_image_url: 'https://img.example/owner-card.png',
      follower_count: 1200,
      base_value: 500,
      is_image_banned: 0,
      registered_by: 'streamer-owner'
    });
    await syncArenaV2CardsFromRegisteredStreamers('season-v2');

    const result = await updateMyArenaV2StreamerCard({
      requesterUserId: 'streamer-owner',
      displayName: '오너 커스텀',
      cardClass: 'guardian',
      cost: 4,
      attack: 1,
      health: 5,
      keywords: [{ type: 'taunt', value: 1 }]
    } as Parameters<typeof updateMyArenaV2StreamerCard>[0] & { displayName: string });
    const mine = await getMyArenaV2StreamerCard('streamer-owner');

    expect(result.accepted).toBe(true);
    expect(result.card?.displayName).toBe('오너 스트리머');
    expect(result.card?.cardClass).toBe('guardian');
    expect(mine.card?.id).toBe(result.card?.id);
    expect(rows.cards.filter((card) => card.streamer_id === 'streamer-owner' && card.status === 'active')).toHaveLength(1);
    expect(rows.cards.filter((card) => card.streamer_id === 'streamer-owner' && card.status === 'disabled')).toHaveLength(1);
  });

  it('rejects streamer card customization that exceeds the GDD cost budget', async () => {
    insertSeason();
    rows.streamers.push({
      channel_id: 'streamer-owner',
      name: '오너 스트리머',
      logo_url: null,
      custom_image_url: null,
      follower_count: 0,
      base_value: 0,
      is_image_banned: 0,
      registered_by: 'streamer-owner'
    });

    const result = await updateMyArenaV2StreamerCard({
      requesterUserId: 'streamer-owner',
      cardClass: 'charge',
      cost: 1,
      attack: 9,
      health: 9,
      keywords: [{ type: 'direct_pressure', value: 9 }]
    });

    expect(result.accepted).toBe(false);
    expect(result.validation.valid).toBe(false);
    expect(rows.cards).toHaveLength(0);
  });

  it('saves and lists a GDD-valid deck', async () => {
    insertCards(14);
    const cardVersionIds = Array.from({ length: 14 }, (_, index) => `card-${index + 1}`);

    const deck = await saveArenaV2Deck({
      userId: 'user-1',
      seasonId: 'season-v2',
      name: 'v2 시작 덱',
      modeScope: 'quick',
      cardVersionIds
    });
    const decks = await listArenaV2DecksForUser('user-1', 'season-v2');

    expect(deck.isValid).toBe(true);
    expect(decks).toHaveLength(1);
    expect(decks[0].cardVersionIds).toEqual(cardVersionIds);
  });

  it('reads a v2 card detail and revalidates and deletes a v2 deck', async () => {
    insertCards(14);
    const cardVersionIds = Array.from({ length: 14 }, (_, index) => `card-${index + 1}`);
    const deck = await saveArenaV2Deck({
      userId: 'user-1',
      seasonId: 'season-v2',
      name: '관리 덱',
      modeScope: 'all',
      cardVersionIds
    });

    const card = await getArenaV2CardVersion('card-1');
    const revalidated = await revalidateArenaV2DeckForUser('user-1', deck.id);
    const deleted = await deleteArenaV2DeckForUser('user-1', deck.id);

    expect(card?.displayName).toBe('카드 1');
    expect(revalidated.isValid).toBe(true);
    expect(deleted.deleted).toBe(true);
    expect(rows.decks).toHaveLength(0);
  });

  it('joins, reads, and cancels a v2 quick queue ticket', async () => {
    insertSeason();
    insertCards(14);
    const cardVersionIds = Array.from({ length: 14 }, (_, index) => `card-${index + 1}`);
    const deck = await saveArenaV2Deck({
      userId: 'user-1',
      seasonId: 'season-v2',
      name: '빠른 대전 덱',
      modeScope: 'quick',
      cardVersionIds
    });

    const joined = await joinArenaV2QuickQueue({ userId: 'user-1', deckId: deck.id });
    const status = await getArenaV2QuickQueueStatus('user-1', 'season-v2');
    const cancelled = await cancelArenaV2QuickQueue('user-1', 'season-v2');
    const afterCancel = await getArenaV2QuickQueueStatus('user-1', 'season-v2');

    expect(joined.status).toBe('waiting');
    expect(joined.serverNow).toBeTruthy();
    expect(joined.estimatedRange).toEqual({ minMmr: 900, maxMmr: 1100 });
    expect(joined.ticket?.searchMinMmr).toBe(900);
    expect(status.ticket?.id).toBe(joined.ticket?.id);
    expect(cancelled.cancelled).toBe(true);
    expect(afterCancel.status).toBe('none');
  });

  it('snapshots the persisted rating MMR when joining quick matchmaking', async () => {
    insertSeason();
    insertCards(14);
    const deck = await insertQuickDeck('rated-user');
    insertQuickRating('rated-user', 1375);

    const joined = await joinArenaV2QuickQueue({ userId: 'rated-user', deckId: deck.id });

    expect(joined.ticket).toMatchObject({
      mmr: 1375,
      searchMinMmr: 1275,
      searchMaxMmr: 1475
    });
    expect(joined.estimatedRange).toEqual({ minMmr: 1275, maxMmr: 1475 });
  });

  it('allows a proposal at the absolute 500 MMR boundary after both ranges expand', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T12:00:00.000Z'));
    insertSeason();
    insertCards(14);
    const leftDeck = await insertQuickDeck('mmr-left');
    const rightDeck = await insertQuickDeck('mmr-right');
    insertQuickRating('mmr-left', 1000);
    insertQuickRating('mmr-right', 1500);
    await joinArenaV2QuickQueue({ userId: 'mmr-left', deckId: leftDeck.id });
    await joinArenaV2QuickQueue({ userId: 'mmr-right', deckId: rightDeck.id });
    const agedJoinedAt = new Date(Date.now() - 120_000).toISOString();
    rows.quickQueue.forEach((ticket) => { ticket.joined_at = agedJoinedAt; });

    const processed = await processArenaV2QuickMatchmaking(32);

    expect(processed.proposed).toBe(1);
    expect(rows.quickQueue.map((ticket) => ticket.status)).toEqual(['proposed', 'proposed']);
    expect(rows.quickQueue[0].proposal_id).toBeTruthy();
    expect(rows.quickQueue[1].proposal_id).toBe(rows.quickQueue[0].proposal_id);
  });

  it('never proposes opponents whose MMR differs by more than 500', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T12:00:00.000Z'));
    insertSeason();
    insertCards(14);
    const leftDeck = await insertQuickDeck('mmr-left');
    const rightDeck = await insertQuickDeck('mmr-right');
    insertQuickRating('mmr-left', 1000);
    insertQuickRating('mmr-right', 1501);
    await joinArenaV2QuickQueue({ userId: 'mmr-left', deckId: leftDeck.id });
    await joinArenaV2QuickQueue({ userId: 'mmr-right', deckId: rightDeck.id });
    const agedJoinedAt = new Date(Date.now() - 10 * 60_000).toISOString();
    rows.quickQueue.forEach((ticket) => { ticket.joined_at = agedJoinedAt; });

    const processed = await processArenaV2QuickMatchmaking(32);

    expect(processed.proposed).toBe(0);
    expect(rows.quickQueue.map((ticket) => ticket.status)).toEqual(['waiting', 'waiting']);
  });

  it('creates exactly one match only after both users accept the same proposal', async () => {
    insertSeason();
    insertCards(14);
    const leftDeck = await insertQuickDeck('accept-left');
    const rightDeck = await insertQuickDeck('accept-right');
    await joinArenaV2QuickQueue({ userId: 'accept-left', deckId: leftDeck.id });
    const proposal = await joinArenaV2QuickQueue({ userId: 'accept-right', deckId: rightDeck.id });
    const proposalId = proposal.proposalId!;
    expect(proposalId).toBeTruthy();
    expect(rows.matches).toHaveLength(0);

    const leftAccepted = await acceptArenaV2QuickQueue('accept-left', 'season-v2', proposalId);
    expect(leftAccepted.status).toBe('accepted');
    expect(rows.matches).toHaveLength(0);

    const matched = await acceptArenaV2QuickQueue('accept-right', 'season-v2', proposalId);
    expect(matched.status).toBe('matched');
    expect(matched.matchId).toBeTruthy();
    expect(rows.matches).toHaveLength(1);

    await processArenaV2QuickMatchmaking(32);
    expect(rows.matches).toHaveLength(1);
  });

  it('rejects accepting a stale or unrelated proposal id without changing state', async () => {
    insertSeason();
    insertCards(14);
    const leftDeck = await insertQuickDeck('stale-left');
    const rightDeck = await insertQuickDeck('stale-right');
    await joinArenaV2QuickQueue({ userId: 'stale-left', deckId: leftDeck.id });
    await joinArenaV2QuickQueue({ userId: 'stale-right', deckId: rightDeck.id });

    await expect(acceptArenaV2QuickQueue('stale-left', 'season-v2', 'stale-proposal'))
      .rejects.toThrow('ArenaV2QuickProposalStale');
    expect(rows.quickQueue.map((ticket) => ticket.status)).toEqual(['proposed', 'proposed']);
    expect(rows.matches).toHaveLength(0);
  });

  it('requeues an accepter unchanged and records one strike for the non-accepter after timeout', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T12:00:00.000Z'));
    insertSeason();
    insertCards(14);
    const accepterDeck = await insertQuickDeck('timeout-accepter');
    const silentDeck = await insertQuickDeck('timeout-silent');
    await joinArenaV2QuickQueue({ userId: 'timeout-accepter', deckId: accepterDeck.id });
    const proposal = await joinArenaV2QuickQueue({ userId: 'timeout-silent', deckId: silentDeck.id });
    const proposalId = proposal.proposalId!;
    const before = rows.quickQueue.find((ticket) => ticket.user_id === 'timeout-accepter')!;
    const snapshot = { id: before.id, joinedAt: before.joined_at, mmr: before.mmr };
    await acceptArenaV2QuickQueue('timeout-accepter', 'season-v2', proposalId);

    vi.advanceTimersByTime(10_001);
    const recovered = await getArenaV2QuickQueueStatus('timeout-accepter', 'season-v2');

    expect(recovered.status).toBe('waiting');
    expect(recovered.transitionReason).toBe('opponent_timeout');
    expect(recovered.ticket).toMatchObject({
      id: snapshot.id,
      joinedAt: snapshot.joinedAt,
      mmr: snapshot.mmr,
      timeoutStrikes: 0
    });
    expect(rows.quickQueue.find((ticket) => ticket.user_id === 'timeout-silent')?.status).toBe('accept_timeout');
    expect(rows.quickConduct.find((conduct) => conduct.user_id === 'timeout-silent')).toMatchObject({
      timeout_strikes: 1,
      priority_penalty: 1
    });
    expect(rows.quickConductEvents.filter((event) => event.user_id === 'timeout-silent')).toHaveLength(1);
  });

  it('does not add a conduct strike when cancelling a waiting ticket', async () => {
    insertSeason();
    insertCards(14);
    const deck = await insertQuickDeck('waiting-cancel');
    await joinArenaV2QuickQueue({ userId: 'waiting-cancel', deckId: deck.id });

    const cancelled = await cancelArenaV2QuickQueue('waiting-cancel', 'season-v2');

    expect(cancelled.cancelled).toBe(true);
    expect(rows.quickConduct).toHaveLength(0);
    expect(rows.quickConductEvents).toHaveLength(0);
  });

  it('delays matchmaking eligibility by 15 seconds per repeated ready-check timeout strike', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T12:00:00.000Z'));
    insertSeason();
    insertCards(14);
    const penalizedDeck = await insertQuickDeck('penalized-user');
    const firstOpponentDeck = await insertQuickDeck('first-opponent');
    const secondOpponentDeck = await insertQuickDeck('second-opponent');
    const finalOpponentDeck = await insertQuickDeck('final-opponent');

    await joinArenaV2QuickQueue({ userId: 'penalized-user', deckId: penalizedDeck.id });
    const firstProposal = await joinArenaV2QuickQueue({ userId: 'first-opponent', deckId: firstOpponentDeck.id });
    await acceptArenaV2QuickQueue('first-opponent', 'season-v2', firstProposal.proposalId!);
    vi.advanceTimersByTime(10_001);
    await getArenaV2QuickQueueStatus('first-opponent', 'season-v2');
    await cancelArenaV2QuickQueue('first-opponent', 'season-v2');
    expect(rows.quickConduct.find((conduct) => conduct.user_id === 'penalized-user')).toMatchObject({
      timeout_strikes: 1,
      priority_penalty: 1
    });

    await joinArenaV2QuickQueue({ userId: 'penalized-user', deckId: penalizedDeck.id });
    vi.advanceTimersByTime(1);
    await joinArenaV2QuickQueue({ userId: 'second-opponent', deckId: secondOpponentDeck.id });
    expect(rows.quickQueue.filter((ticket) => ['proposed', 'accepted'].includes(ticket.status))).toHaveLength(0);
    vi.advanceTimersByTime(15_000);
    await processArenaV2QuickMatchmaking(32);
    const secondProposal = rows.quickQueue.find((ticket) => ticket.user_id === 'second-opponent' && ticket.status === 'proposed');
    expect(secondProposal?.proposal_id).toBeTruthy();
    await acceptArenaV2QuickQueue('second-opponent', 'season-v2', secondProposal!.proposal_id);
    vi.advanceTimersByTime(10_001);
    await getArenaV2QuickQueueStatus('second-opponent', 'season-v2');
    await cancelArenaV2QuickQueue('second-opponent', 'season-v2');
    expect(rows.quickConduct.find((conduct) => conduct.user_id === 'penalized-user')).toMatchObject({
      timeout_strikes: 2,
      priority_penalty: 2
    });

    await joinArenaV2QuickQueue({ userId: 'penalized-user', deckId: penalizedDeck.id });
    vi.advanceTimersByTime(1);
    await joinArenaV2QuickQueue({ userId: 'final-opponent', deckId: finalOpponentDeck.id });
    vi.advanceTimersByTime(29_998);
    const beforeEligible = await processArenaV2QuickMatchmaking(32);
    expect(beforeEligible.proposed).toBe(0);
    vi.advanceTimersByTime(1);
    const atEligible = await processArenaV2QuickMatchmaking(32);
    expect(atEligible.proposed).toBe(1);
  });

  it('accepts a ready check one millisecond before its deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T12:00:00.000Z'));
    insertSeason();
    insertCards(14);
    const leftDeck = await insertQuickDeck('deadline-left');
    const rightDeck = await insertQuickDeck('deadline-right');
    await joinArenaV2QuickQueue({ userId: 'deadline-left', deckId: leftDeck.id });
    const proposal = await joinArenaV2QuickQueue({ userId: 'deadline-right', deckId: rightDeck.id });

    vi.advanceTimersByTime(9_999);
    const accepted = await acceptArenaV2QuickQueue('deadline-left', 'season-v2', proposal.proposalId!);

    expect(accepted.status).toBe('accepted');
    expect(accepted.acceptedBySelf).toBe(true);
    expect(rows.matches).toHaveLength(0);
  });

  it('treats an accept at the exact deadline as timed out', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T12:00:00.000Z'));
    insertSeason();
    insertCards(14);
    const leftDeck = await insertQuickDeck('deadline-left');
    const rightDeck = await insertQuickDeck('deadline-right');
    await joinArenaV2QuickQueue({ userId: 'deadline-left', deckId: leftDeck.id });
    const proposal = await joinArenaV2QuickQueue({ userId: 'deadline-right', deckId: rightDeck.id });

    vi.advanceTimersByTime(10_000);
    const timedOut = await acceptArenaV2QuickQueue('deadline-left', 'season-v2', proposal.proposalId!);

    expect(timedOut.status).toBe('accept_timeout');
    expect(timedOut.transitionReason).toBe('proposal_expired');
    expect(rows.matches).toHaveLength(0);
  });

  it('serializes quick, battle royale, and bot participation for one user', async () => {
    insertSeason();
    insertCards(14);
    const deck = await insertQuickDeck('cross-mode-user');
    await joinArenaV2QuickQueue({ userId: 'cross-mode-user', deckId: deck.id });

    await expect(createArenaV2Match({
      userId: 'cross-mode-user',
      mode: 'bot',
      deckId: deck.id,
      seasonId: 'season-v2'
    })).rejects.toThrow('ArenaV2AlreadyActive');
    await expect(joinArenaV2BattleRoyaleQueue({
      userId: 'cross-mode-user',
      deckId: deck.id,
      seasonId: 'season-v2'
    })).rejects.toThrow('ArenaV2AlreadyActive');

    await cancelArenaV2QuickQueue('cross-mode-user', 'season-v2');
    const botMatch = await createArenaV2Match({
      userId: 'cross-mode-user',
      mode: 'bot',
      deckId: deck.id,
      seasonId: 'season-v2'
    });
    expect(botMatch.matchId).toBeTruthy();
    await expect(joinArenaV2QuickQueue({
      userId: 'cross-mode-user',
      deckId: deck.id,
      seasonId: 'season-v2'
    })).rejects.toThrow('ArenaV2AlreadyActive');
  });

  it('blocks update, revalidation, and deletion of a queued or active deck', async () => {
    insertSeason();
    insertCards(14);
    const deck = await insertQuickDeck('deck-lock-user');
    await joinArenaV2QuickQueue({ userId: 'deck-lock-user', deckId: deck.id });

    await expect(saveArenaV2Deck({
      userId: 'deck-lock-user',
      deckId: deck.id,
      seasonId: 'season-v2',
      name: '변경 시도',
      modeScope: 'quick',
      cardVersionIds: deck.cardVersionIds
    })).rejects.toThrow('ArenaV2DeckInUse');
    await expect(revalidateArenaV2DeckForUser('deck-lock-user', deck.id)).rejects.toThrow('ArenaV2DeckInUse');
    await expect(deleteArenaV2DeckForUser('deck-lock-user', deck.id)).rejects.toThrow('ArenaV2DeckInUse');

    await cancelArenaV2QuickQueue('deck-lock-user', 'season-v2');
    await expect(revalidateArenaV2DeckForUser('deck-lock-user', deck.id)).resolves.toMatchObject({ id: deck.id });
    await expect(deleteArenaV2DeckForUser('deck-lock-user', deck.id)).resolves.toEqual({ deleted: true });
  });

  it('returns an active matched battle royale ticket idempotently and blocks other modes', async () => {
    insertSeason();
    insertCards(14);
    const deck = await insertQuickDeck('br-active-user');
    const first = await joinArenaV2BattleRoyaleQueue({ userId: 'br-active-user', deckId: deck.id });
    const ticket = rows.battleRoyaleQueue.find((item) => item.id === first.id)!;
    ticket.status = 'matched';
    ticket.battle_royale_id = 'battle-active';
    rows.battleRoyales.push({ id: 'battle-active', season_id: 'season-v2', status: 'active' });

    const repeated = await joinArenaV2BattleRoyaleQueue({ userId: 'br-active-user', deckId: deck.id });

    expect(repeated.id).toBe(first.id);
    expect(repeated.status).toBe('matched');
    await expect(joinArenaV2QuickQueue({ userId: 'br-active-user', deckId: deck.id }))
      .rejects.toThrow('ArenaV2AlreadyActive');
  });

  it('isolates an administratively invalidated ready-check deck without penalizing its owner', async () => {
    insertSeason();
    insertCards(14);
    const validDeck = await insertQuickDeck('valid-opponent');
    const invalidDeck = await insertQuickDeck('invalid-owner');
    await joinArenaV2QuickQueue({ userId: 'valid-opponent', deckId: validDeck.id });
    const proposal = await joinArenaV2QuickQueue({ userId: 'invalid-owner', deckId: invalidDeck.id });
    const proposalId = proposal.proposalId!;
    const validTicketBefore = rows.quickQueue.find((ticket) => ticket.user_id === 'valid-opponent')!;
    const validSnapshot = { id: validTicketBefore.id, joinedAt: validTicketBefore.joined_at };
    await acceptArenaV2QuickQueue('valid-opponent', 'season-v2', proposalId);
    rows.decks.find((item) => item.id === invalidDeck.id)!.is_valid = 0;

    const invalidResult = await acceptArenaV2QuickQueue('invalid-owner', 'season-v2', proposalId);
    const validResult = await getArenaV2QuickQueueStatus('valid-opponent', 'season-v2');
    const invalidPoll = await getArenaV2QuickQueueStatus('invalid-owner', 'season-v2');

    expect(invalidResult.status).toBe('cancelled');
    expect(invalidResult.transitionReason).toBe('invalid_deck');
    expect(invalidPoll).toMatchObject({ status: 'cancelled', transitionReason: 'invalid_deck' });
    expect(validResult).toMatchObject({ status: 'waiting', transitionReason: 'opponent_invalid_deck' });
    expect(validResult.ticket).toMatchObject({ id: validSnapshot.id, joinedAt: validSnapshot.joinedAt });
    expect(rows.quickConduct.filter((conduct) => ['valid-opponent', 'invalid-owner'].includes(conduct.user_id))).toHaveLength(0);
    expect(rows.matches).toHaveLength(0);
  });

  it('joins, reads, and cancels a v2 battle royale queue ticket', async () => {
    insertSeason();
    insertCards(14);
    const cardVersionIds = Array.from({ length: 14 }, (_, index) => `card-${index + 1}`);
    const deck = await saveArenaV2Deck({
      userId: 'user-1',
      seasonId: 'season-v2',
      name: '8인전 덱',
      modeScope: 'battle_royale_8',
      cardVersionIds
    });

    const joined = await joinArenaV2BattleRoyaleQueue({ userId: 'user-1', deckId: deck.id });
    const status = await getArenaV2BattleRoyaleQueueStatus('user-1', 'season-v2');
    const cancelled = await cancelArenaV2BattleRoyaleQueue('user-1', 'season-v2');
    const afterCancel = await getArenaV2BattleRoyaleQueueStatus('user-1', 'season-v2');

    expect(joined.status).toBe('waiting');
    expect(joined.battleRoyaleId).toBeNull();
    expect(status.ticket?.id).toBe(joined.id);
    expect(cancelled.cancelled).toBe(true);
    expect(afterCancel.status).toBe('none');
  });

  it('creates a server-authoritative bot match in mulligan state', async () => {
    insertSeason();
    insertCards(14);
    const cardVersionIds = Array.from({ length: 14 }, (_, index) => `card-${index + 1}`);
    const deck = await saveArenaV2Deck({
      userId: 'user-1',
      seasonId: 'season-v2',
      name: '봇전 덱',
      modeScope: 'bot',
      cardVersionIds
    });

    const match = await createArenaV2Match({
      userId: 'user-1',
      mode: 'bot',
      deckId: deck.id,
      botDifficulty: 'easy'
    });

    expect(match.status).toBe('mulligan');
    expect(rows.matches).toHaveLength(1);
    expect(rows.matchPlayers).toHaveLength(2);
    expect(rows.cardInstances).toHaveLength(28);
    expect(match.self.handCardInstanceIds).toHaveLength(5);
    expect(match.self.deckCount).toBe(9);
    expect(match.opponent.handCount).toBe(5);
  });

  it('finds an active match without depending on a current-season request', async () => {
    insertSeason();
    insertCards(14);
    const deck = await saveArenaV2Deck({
      userId: 'active-user',
      seasonId: 'season-v2',
      name: '재접속 덱',
      modeScope: 'bot',
      cardVersionIds: Array.from({ length: 14 }, (_, index) => `card-${index + 1}`)
    });
    const created = await createArenaV2Match({ userId: 'active-user', mode: 'bot', deckId: deck.id });
    rows.seasons[0].status = 'ended';

    const active = await getActiveArenaV2MatchForUser('active-user');
    expect(active?.id).toBe(created.matchId);

    rows.matches.find((match) => match.id === created.matchId)!.status = 'completed';
    expect(await getActiveArenaV2MatchForUser('active-user')).toBeNull();
  });

  it('finishes a surrendered bot match as a player loss', async () => {
    insertSeason();
    insertCards(14);
    const deck = await saveArenaV2Deck({
      userId: 'bot-surrender-user',
      seasonId: 'season-v2',
      name: '연습전 항복 덱',
      modeScope: 'bot',
      cardVersionIds: Array.from({ length: 14 }, (_, index) => `card-${index + 1}`)
    });
    const created = await createArenaV2Match({ userId: 'bot-surrender-user', mode: 'bot', deckId: deck.id });

    const completed = await surrenderArenaV2MatchForUser(created.matchId, 'bot-surrender-user');
    const self = completed?.players.find((player) => player.userId === 'bot-surrender-user');

    expect(completed?.status).toBe('completed');
    expect(completed?.viewerResult?.outcome).toBe('loss');
    expect(self).toMatchObject({ playerHealth: 0, finalRank: 2 });
    expect(completed?.resultSummary).toMatchObject({
      completedReason: 'player_surrendered',
      surrenderedBySeatNo: self?.seatNo
    });
  });

  it('rejects surrender requests from users who did not join the match', async () => {
    insertSeason();
    insertCards(14);
    const deck = await saveArenaV2Deck({
      userId: 'surrender-owner',
      seasonId: 'season-v2',
      name: '참가자 확인 덱',
      modeScope: 'bot',
      cardVersionIds: Array.from({ length: 14 }, (_, index) => `card-${index + 1}`)
    });
    const created = await createArenaV2Match({ userId: 'surrender-owner', mode: 'bot', deckId: deck.id });

    await expect(surrenderArenaV2MatchForUser(created.matchId, 'surrender-outsider'))
      .rejects.toThrow('ArenaV2MatchForbidden');
    expect(rows.matches.find((match) => match.id === created.matchId)?.status).not.toBe('completed');
  });

  it('applies a quick-match surrender rating exactly once', async () => {
    insertSeason();
    insertCards(14);
    const deck = await saveArenaV2Deck({
      userId: 'quick-loser',
      seasonId: 'season-v2',
      name: '빠른대전 항복 덱',
      modeScope: 'bot',
      cardVersionIds: Array.from({ length: 14 }, (_, index) => `card-${index + 1}`)
    });
    const created = await createArenaV2Match({ userId: 'quick-loser', mode: 'bot', deckId: deck.id });
    const storedMatch = rows.matches.find((match) => match.id === created.matchId)!;
    const opponent = rows.matchPlayers.find((player) => player.match_id === created.matchId && player.seat_no === 1)!;
    storedMatch.mode = 'quick';
    opponent.user_id = 'quick-winner';

    const first = await surrenderArenaV2MatchForUser(created.matchId, 'quick-loser');
    const ratingsAfterFirst = rows.ratings.map((rating) => ({ ...rating }));
    const second = await surrenderArenaV2MatchForUser(created.matchId, 'quick-loser');

    expect(first?.winnerUserId).toBe('quick-winner');
    expect(first?.viewerResult).toMatchObject({ outcome: 'loss', mmrBefore: 1000, mmrAfter: 975, mmrDelta: -25 });
    expect(rows.ratings.find((rating) => rating.user_id === 'quick-loser')).toMatchObject({ mmr: 975, wins: 0, losses: 1 });
    expect(rows.ratings.find((rating) => rating.user_id === 'quick-winner')).toMatchObject({ mmr: 1025, wins: 1, losses: 0 });
    expect(rows.ratings).toEqual(ratingsAfterFirst);
    expect(second?.viewerResult).toMatchObject({ outcome: 'loss', mmrAfter: 975 });
  });

  it('keeps battle royale surrender unavailable until tournament withdrawal is defined', async () => {
    insertSeason();
    insertCards(14);
    const deck = await saveArenaV2Deck({
      userId: 'battle-user',
      seasonId: 'season-v2',
      name: '8인전 재접속 덱',
      modeScope: 'bot',
      cardVersionIds: Array.from({ length: 14 }, (_, index) => `card-${index + 1}`)
    });
    const created = await createArenaV2Match({ userId: 'battle-user', mode: 'bot', deckId: deck.id });
    rows.matches.find((match) => match.id === created.matchId)!.mode = 'battle_royale_8';

    await expect(surrenderArenaV2MatchForUser(created.matchId, 'battle-user'))
      .rejects.toThrow('ArenaV2MatchSurrenderUnavailable');
  });

  it('reads a v2 match snapshot and resolves a valid bot turn after mulligan', async () => {
    insertSeason();
    insertCards(14);
    rows.streamers.push({
      channel_id: 'streamer-1',
      name: '이미지 스트리머',
      logo_url: '/uploads/streamers/streamer-1-logo.webp',
      custom_image_url: '/uploads/streamers/streamer-1-custom.webp',
      is_image_banned: 0
    }, {
      channel_id: 'streamer-2',
      name: '이미지 차단 스트리머',
      logo_url: '/uploads/streamers/streamer-2-logo.webp',
      custom_image_url: '/uploads/streamers/streamer-2-hidden.webp',
      is_image_banned: 1
    });
    rows.cards[0].art_asset_id = '';
    rows.cards[1].art_asset_id = '/uploads/streamers/streamer-2-card-hidden.webp';
    const cardVersionIds = Array.from({ length: 14 }, (_, index) => `card-${index + 1}`);
    const deck = await saveArenaV2Deck({
      userId: 'user-1',
      seasonId: 'season-v2',
      name: '액션 덱',
      modeScope: 'bot',
      cardVersionIds
    });
    const created = await createArenaV2Match({
      userId: 'user-1',
      mode: 'bot',
      deckId: deck.id
    });

    const view = await getArenaV2MatchForUser(created.matchId, 'user-1');
    await submitArenaV2Mulligan({
      userId: 'user-1',
      matchId: created.matchId,
      replaceCardInstanceIds: []
    });
    const introView = await getArenaV2MatchForUser(created.matchId, 'user-1');
    expect(introView?.status).toBe('turn_result');
    expect(introView?.phaseTiming?.introDurationMs).toBe(1_400);
    expect(introView?.phaseTiming?.replayDurationMs).toBe(2_400);
    expect(Date.parse(introView?.phaseTiming?.planningStartsAt || '') - Date.parse(introView?.phaseTiming?.replayEndsAt || '')).toBe(1_400);
    expect(Date.parse(introView?.phaseTiming?.turnDeadlineAt || '') - Date.parse(introView?.phaseTiming?.planningStartsAt || '')).toBe(40_000);
    const planningView = await finishTurnIntro(created.matchId, 'user-1');
    expect(planningView?.status).toBe('turn_planning');

    const result = await submitArenaV2TurnActions({
      userId: 'user-1',
      matchId: created.matchId,
      turnNo: 1,
      revision: 0,
      isFinal: true,
      actions: [{ type: 'end' }]
    });

    expect(view?.id).toBe(created.matchId);
    expect(view?.players).toHaveLength(2);
    expect(view?.cardInstances).toHaveLength(14);
    expect(
      view?.cardInstances.find((instance) => instance.cardVersionId === 'card-1')?.card?.artAssetId
    ).toMatch(/\/uploads\/streamers\/streamer-1-custom\.webp$/);
    expect(
      view?.cardInstances.find((instance) => instance.cardVersionId === 'card-2')?.card?.artAssetId
    ).toMatch(/\/uploads\/streamers\/streamer-2-logo\.webp$/);
    expect(lastCardInstanceSelectSql).toContain("NULLIF(cv.art_asset_id, '')");
    expect(lastCardInstanceSelectSql).toContain('s.is_image_banned');
    expect(result.accepted).toBe(true);
    expect(result.match?.status).toBe('turn_result');
    expect(result.match?.turnNo).toBe(2);
    expect(rows.actionSubmissions).toHaveLength(2);
    expect(rows.replayEvents.length).toBeGreaterThan(0);
  });


  it('promotes turn_result at planningStartsAt and expires actions only at turnDeadlineAt', async () => {
    insertSeason();
    insertCards(14);
    const cardVersionIds = Array.from({ length: 14 }, (_, index) => `card-${index + 1}`);
    const deck = await saveArenaV2Deck({
      userId: 'user-1',
      seasonId: 'season-v2',
      name: '서버 타이밍 덱',
      modeScope: 'bot',
      cardVersionIds
    });
    const created = await createArenaV2Match({
      userId: 'user-1',
      mode: 'bot',
      deckId: deck.id
    });
    await submitArenaV2Mulligan({
      userId: 'user-1',
      matchId: created.matchId,
      replaceCardInstanceIds: []
    });

    const match = rows.matches.find((item) => item.id === created.matchId)!;
    const readySummary = JSON.parse(match.result_summary);
    readySummary.phaseTiming.planningStartsAt = new Date(Date.now() - 1).toISOString();
    readySummary.phaseTiming.turnDeadlineAt = new Date(Date.now() + 40_000).toISOString();
    match.result_summary = JSON.stringify(readySummary);

    const promoted = await processArenaV2ExpiredTurns();
    expect(promoted).toMatchObject({ promoted: 1, resolved: 0 });
    expect(match.status).toBe('turn_planning');

    const expiredSummary = JSON.parse(match.result_summary);
    expiredSummary.phaseTiming.turnDeadlineAt = new Date(Date.now() - 1).toISOString();
    match.result_summary = JSON.stringify(expiredSummary);

    const expired = await processArenaV2ExpiredTurns();
    expect(expired.resolved).toBe(1);
    expect(match.status).toBe('turn_result');
    expect(rows.actionSubmissions).toHaveLength(2);
  });

  it('participant polling resolves an expired turn once and returns the next turn without a button submit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T00:00:00.000Z'));
    insertSeason();
    insertCards(14);
    const deck = await saveArenaV2Deck({
      userId: 'user-1',
      seasonId: 'season-v2',
      name: '자동 진행 덱',
      modeScope: 'bot',
      cardVersionIds: Array.from({ length: 14 }, (_, index) => `card-${index + 1}`)
    });
    const created = await createArenaV2Match({ userId: 'user-1', mode: 'bot', deckId: deck.id });
    await submitArenaV2Mulligan({
      userId: 'user-1',
      matchId: created.matchId,
      replaceCardInstanceIds: []
    });
    await finishTurnIntro(created.matchId, 'user-1');

    const storedMatch = rows.matches.find((item) => item.id === created.matchId)!;
    const beforeDeadlineSummary = JSON.parse(storedMatch.result_summary);
    beforeDeadlineSummary.phaseTiming.turnDeadlineAt = new Date(Date.now() + 1_000).toISOString();
    storedMatch.result_summary = JSON.stringify(beforeDeadlineSummary);
    await submitArenaV2TurnActions({
      userId: 'user-1',
      matchId: created.matchId,
      turnNo: 1,
      revision: 1_000_001,
      isFinal: false,
      actions: [{ type: 'end' }]
    });

    const beforeDeadline = await syncArenaV2MatchForUser(created.matchId, 'user-1');
    expect(beforeDeadline?.status).toBe('turn_planning');
    expect(beforeDeadline?.turnNo).toBe(1);
    expect(rows.actionSubmissions).toHaveLength(1);

    vi.advanceTimersByTime(1_001);
    await Promise.all([
      syncArenaV2MatchForUser(created.matchId, 'user-1'),
      syncArenaV2MatchForUser(created.matchId, 'user-1')
    ]);

    const latest = await syncArenaV2MatchForUser(created.matchId, 'user-1');
    const timeoutSubmissions = rows.actionSubmissions
      .filter((submission) => submission.turn_no === 1 && Number(submission.is_final) === 1);
    const latestSummary = JSON.parse(storedMatch.result_summary);
    expect(latest?.status).toBe('turn_result');
    expect(latest?.turnNo).toBe(2);
    expect(storedMatch.status).toBe('turn_result');
    expect(storedMatch.turn_no).toBe(2);
    expect(timeoutSubmissions).toHaveLength(2);
    expect(new Set(timeoutSubmissions.map((submission) => submission.seat_no))).toEqual(new Set([0, 1]));
    expect(timeoutSubmissions.every((submission) => Number(submission.revision) < 0)).toBe(true);
    expect(rows.replayEvents.length).toBeGreaterThan(0);
    expect(latestSummary.phaseTiming.replayDurationMs).toBeGreaterThanOrEqual(2_400);
  });

  it('does not mutate a match when an unauthorized user attempts deadline read-repair', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T00:00:00.000Z'));
    insertSeason();
    insertCards(14);
    const deck = await saveArenaV2Deck({
      userId: 'user-1',
      seasonId: 'season-v2',
      name: '권한 검증 덱',
      modeScope: 'bot',
      cardVersionIds: Array.from({ length: 14 }, (_, index) => `card-${index + 1}`)
    });
    const created = await createArenaV2Match({ userId: 'user-1', mode: 'bot', deckId: deck.id });
    await submitArenaV2Mulligan({
      userId: 'user-1',
      matchId: created.matchId,
      replaceCardInstanceIds: []
    });

    const storedMatch = rows.matches.find((item) => item.id === created.matchId)!;
    const expiredSummary = JSON.parse(storedMatch.result_summary);
    expiredSummary.phaseTiming.planningStartsAt = new Date(Date.now() - 2_000).toISOString();
    expiredSummary.phaseTiming.turnDeadlineAt = new Date(Date.now() - 1_000).toISOString();
    storedMatch.result_summary = JSON.stringify(expiredSummary);

    const unauthorized = await syncArenaV2MatchForUser(created.matchId, 'not-a-participant');

    expect(unauthorized).toBeNull();
    expect(storedMatch.status).toBe('turn_result');
    expect(storedMatch.turn_no).toBe(1);
    expect(rows.actionSubmissions).toHaveLength(0);
    expect(rows.replayEvents).toHaveLength(0);
  });

  it('uses updated_at fallback when legacy mulligan and turn deadlines are missing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T00:00:00.000Z'));
    insertSeason();
    insertCards(14);
    const deck = await saveArenaV2Deck({
      userId: 'user-1',
      seasonId: 'season-v2',
      name: '레거시 마감 덱',
      modeScope: 'bot',
      cardVersionIds: Array.from({ length: 14 }, (_, index) => `card-${index + 1}`)
    });
    const created = await createArenaV2Match({ userId: 'user-1', mode: 'bot', deckId: deck.id });
    const storedMatch = rows.matches.find((item) => item.id === created.matchId)!;
    const mulliganSummary = JSON.parse(storedMatch.result_summary);
    delete mulliganSummary.mulliganDeadlineAt;
    storedMatch.result_summary = JSON.stringify(mulliganSummary);
    storedMatch.updated_at = new Date(Date.now() - 41_000).toISOString();

    const afterMulligan = await syncArenaV2MatchForUser(created.matchId, 'user-1');
    expect(afterMulligan?.status).toBe('turn_result');

    await finishTurnIntro(created.matchId, 'user-1');
    const turnSummary = JSON.parse(storedMatch.result_summary);
    delete turnSummary.phaseTiming.turnDeadlineAt;
    storedMatch.result_summary = JSON.stringify(turnSummary);
    storedMatch.updated_at = new Date(Date.now() - 41_000).toISOString();

    const afterTurn = await syncArenaV2MatchForUser(created.matchId, 'user-1');
    expect(afterTurn?.status).toBe('turn_result');
    expect(afterTurn?.turnNo).toBe(2);
  });

  it('isolates a failed timeout candidate so later matches still advance', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T00:00:00.000Z'));
    insertSeason();
    insertCards(14);
    const deck = await saveArenaV2Deck({
      userId: 'user-1',
      seasonId: 'season-v2',
      name: '오류 격리 덱',
      modeScope: 'bot',
      cardVersionIds: Array.from({ length: 14 }, (_, index) => `card-${index + 1}`)
    });
    const secondDeck = await saveArenaV2Deck({
      userId: 'user-2',
      seasonId: 'season-v2',
      name: '오류 격리 덱 2',
      modeScope: 'bot',
      cardVersionIds: Array.from({ length: 14 }, (_, index) => `card-${index + 1}`)
    });
    const createExpiredMatch = async (userId: string, deckId: string) => {
      const created = await createArenaV2Match({ userId, mode: 'bot', deckId });
      await submitArenaV2Mulligan({
        userId,
        matchId: created.matchId,
        replaceCardInstanceIds: []
      });
      await finishTurnIntro(created.matchId, userId);
      const stored = rows.matches.find((item) => item.id === created.matchId)!;
      const summary = JSON.parse(stored.result_summary);
      summary.phaseTiming.turnDeadlineAt = new Date(Date.now() - 1).toISOString();
      stored.result_summary = JSON.stringify(summary);
      return { created, stored };
    };

    const poison = await createExpiredMatch('user-1', deck.id);
    const healthy = await createExpiredMatch('user-2', secondDeck.id);
    timeoutReadFailures.add(poison.created.matchId);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let processed: Awaited<ReturnType<typeof processArenaV2ExpiredTurns>>;
    try {
      processed = await processArenaV2ExpiredTurns(40, 25, false);
    } finally {
      consoleError.mockRestore();
    }

    expect(processed!).toMatchObject({ failed: 1, resolved: 1 });
    expect(poison.stored.status).toBe('turn_planning');
    expect(poison.stored.turn_no).toBe(1);
    expect(healthy.stored.status).toBe('turn_result');
    expect(healthy.stored.turn_no).toBe(2);
  });

  it('hides opponent hand and deck card identities from match snapshots', async () => {
    insertSeason();
    insertCards(14);
    const cardVersionIds = Array.from({ length: 14 }, (_, index) => `card-${index + 1}`);
    const deck = await saveArenaV2Deck({
      userId: 'user-1',
      seasonId: 'season-v2',
      name: '비공개 검증 덱',
      modeScope: 'bot',
      cardVersionIds
    });
    const created = await createArenaV2Match({
      userId: 'user-1',
      mode: 'bot',
      deckId: deck.id
    });

    const view = await getArenaV2MatchForUser(created.matchId, 'user-1');
    const self = view?.players.find((player) => player.seatNo === view.selfSeatNo);
    const opponent = view?.players.find((player) => player.seatNo !== view.selfSeatNo);
    const opponentPrivateInstances = view?.cardInstances.filter((instance) => instance.ownerSeatNo === opponent?.seatNo && (instance.zone === 'hand' || instance.zone === 'deck')) || [];

    expect(self?.handCardInstanceIds).toHaveLength(5);
    expect(self?.handCount).toBe(5);
    expect(opponent?.handCardInstanceIds).toHaveLength(0);
    expect(opponent?.handCount).toBe(5);
    expect(opponentPrivateInstances).toHaveLength(0);
  });


  it('allows spectator snapshots only to participants of the exact battle royale and hides every private zone', async () => {
    insertSeason();
    insertCards(14);
    const cardVersionIds = Array.from({ length: 14 }, (_, index) => `card-${index + 1}`);
    const deck = await saveArenaV2Deck({
      userId: 'user-1',
      seasonId: 'season-v2',
      name: '관전 보안 덱',
      modeScope: 'bot',
      cardVersionIds
    });
    const created = await createArenaV2Match({
      userId: 'user-1',
      mode: 'bot',
      deckId: deck.id
    });

    expect(await getArenaV2MatchForUser(created.matchId, 'outsider')).toBeNull();

    const match = rows.matches.find((item) => item.id === created.matchId)!;
    match.mode = 'battle_royale_8';
    match.battle_royale_id = 'br-security';
    const opponent = rows.matchPlayers.find((player) => player.match_id === created.matchId && player.seat_no === 1)!;
    opponent.user_id = 'user-2';
    rows.battleRoyales.push({
      id: 'br-security',
      season_id: 'season-v2',
      status: 'active',
      current_round_no: 1,
      participant_state: JSON.stringify([
        { seedNo: 1, userId: 'user-1', deckId: deck.id, status: 'active', finalRank: null },
        { seedNo: 2, userId: 'user-2', deckId: deck.id, status: 'active', finalRank: null },
        { seedNo: 3, userId: 'spectator-1', deckId: 'secret-deck', status: 'active', finalRank: null }
      ]),
      match_ids: JSON.stringify([created.matchId]),
      winner_user_id: null,
      created_at: 'now',
      updated_at: 'now',
      finished_at: null
    });

    expect(await getArenaV2MatchForUser(created.matchId, 'spectator-1')).toBeNull();
    expect(await getArenaV2MatchForUser(created.matchId, 'spectator-1', 'wrong-br')).toBeNull();
    expect(await getArenaV2MatchForUser(created.matchId, 'outsider', 'br-security')).toBeNull();

    const spectatorView = await getArenaV2MatchForUser(created.matchId, 'spectator-1', 'br-security');
    expect(spectatorView?.viewerRole).toBe('spectator');
    expect(spectatorView?.selfSeatNo).toBeNull();
    expect(spectatorView?.players.every((player) => player.deckId == null)).toBe(true);
    expect(spectatorView?.players.every((player) => player.handCardInstanceIds.length === 0)).toBe(true);
    expect(spectatorView?.players.every((player) => Object.keys(player.mulliganState as object).length === 0)).toBe(true);
    expect(spectatorView?.cardInstances.every((instance) => !['deck', 'hand'].includes(instance.zone))).toBe(true);

    const battleRoyale = await getArenaV2BattleRoyale('br-security', 'spectator-1');
    expect(battleRoyale?.spectatableMatchIds).toContain(created.matchId);
    expect(battleRoyale?.participantState.every((participant: Row) => !('deckId' in participant) && !('deck_id' in participant))).toBe(true);
  });

  it('exposes only the current participant rating result and preserves zero health', async () => {
    insertSeason();
    insertCards(14);
    const cardVersionIds = Array.from({ length: 14 }, (_, index) => `card-${index + 1}`);
    const deck = await saveArenaV2Deck({
      userId: 'user-1',
      seasonId: 'season-v2',
      name: '결과 보안 덱',
      modeScope: 'bot',
      cardVersionIds
    });
    const created = await createArenaV2Match({
      userId: 'user-1',
      mode: 'bot',
      deckId: deck.id
    });
    const match = rows.matches.find((item) => item.id === created.matchId)!;
    match.mode = 'quick';
    match.status = 'completed';
    match.winner_user_id = 'user-1';
    match.finished_at = 'now';
    match.result_summary = JSON.stringify({
      status: 'completed',
      result: 'win',
      viewerResultsByUser: {
        'user-1': { mmrBefore: 0, mmrAfter: 25, mmrDelta: 25, tierBefore: 'bronze', tierAfter: 'bronze' },
        'user-2': { mmrBefore: 1000, mmrAfter: 975, mmrDelta: -25, tierBefore: 'bronze', tierAfter: 'bronze' }
      }
    });
    const firstPlayer = rows.matchPlayers.find((player) => player.match_id === created.matchId && player.seat_no === 0)!;
    const secondPlayer = rows.matchPlayers.find((player) => player.match_id === created.matchId && player.seat_no === 1)!;
    firstPlayer.player_health = 0;
    firstPlayer.final_rank = 1;
    secondPlayer.user_id = 'user-2';
    secondPlayer.final_rank = 2;
    secondPlayer.player_health = -3;

    const winnerView = await getArenaV2MatchForUser(created.matchId, 'user-1');
    const loserView = await getArenaV2MatchForUser(created.matchId, 'user-2');
    secondPlayer.player_health = null;
    const nullHealthView = await getArenaV2MatchForUser(created.matchId, 'user-2');


    expect((winnerView?.resultSummary as Row).viewerResultsByUser).toBeUndefined();
    expect((loserView?.resultSummary as Row).viewerResultsByUser).toBeUndefined();
    expect(winnerView?.viewerResult).toMatchObject({ outcome: 'win', mmrBefore: 0, mmrAfter: 25, mmrDelta: 25 });
    expect(loserView?.viewerResult).toMatchObject({ outcome: 'loss', mmrBefore: 1000, mmrAfter: 975, mmrDelta: -25 });
    expect(winnerView?.players.find((player) => player.userId === 'user-1')?.playerHealth).toBe(0);
    expect(loserView?.players.find((player) => player.userId === 'user-2')?.playerHealth).toBe(0);
    expect(nullHealthView?.players.find((player) => player.userId === 'user-2')?.playerHealth).toBe(30);
    expect(winnerView?.players.find((player) => player.userId === 'user-1')?.finalRank).toBe(1);
    expect(winnerView?.players.find((player) => player.userId === 'user-2')?.deckId).toBeNull();
  });


  it('stores quick MMR before/after/delta per user and publishes only each viewer result', async () => {
    insertSeason();
    insertCards(14);
    const cardVersionIds = Array.from({ length: 14 }, (_, index) => `card-${index + 1}`);
    const deck = await saveArenaV2Deck({
      userId: 'user-1',
      seasonId: 'season-v2',
      name: '퀵 결과 덱',
      modeScope: 'bot',
      cardVersionIds
    });
    const created = await createArenaV2Match({
      userId: 'user-1',
      mode: 'bot',
      deckId: deck.id
    });
    const match = rows.matches.find((item) => item.id === created.matchId)!;
    match.mode = 'quick';
    const opponent = rows.matchPlayers.find((player) => player.match_id === created.matchId && player.seat_no === 1)!;
    opponent.user_id = 'user-2';

    await submitArenaV2Mulligan({ userId: 'user-1', matchId: created.matchId, replaceCardInstanceIds: [] });
    await submitArenaV2Mulligan({ userId: 'user-2', matchId: created.matchId, replaceCardInstanceIds: [] });
    await finishTurnIntro(created.matchId, 'user-1');
    opponent.player_health = 0;

    await submitArenaV2TurnActions({
      userId: 'user-1',
      matchId: created.matchId,
      turnNo: 1,
      revision: 0,
      isFinal: true,
      actions: [{ type: 'end' }]
    });
    const completed = await submitArenaV2TurnActions({
      userId: 'user-2',
      matchId: created.matchId,
      turnNo: 1,
      revision: 0,
      isFinal: true,
      actions: [{ type: 'end' }]
    });

    const storedSummary = JSON.parse(match.result_summary);
    expect(match.status).toBe('completed');
    expect(storedSummary.viewerResultsByUser['user-1']).toMatchObject({ mmrBefore: 1000, mmrAfter: 1025, mmrDelta: 25 });
    expect(storedSummary.viewerResultsByUser['user-2']).toMatchObject({ mmrBefore: 1000, mmrAfter: 975, mmrDelta: -25 });
    expect(rows.ratings).toHaveLength(2);
    expect((completed.match?.resultSummary as Row).viewerResultsByUser).toBeUndefined();
    expect(completed.match?.viewerResult).toMatchObject({ outcome: 'loss', mmrBefore: 1000, mmrAfter: 975, mmrDelta: -25 });
    const winnerView = await getArenaV2MatchForUser(created.matchId, 'user-1');
    expect(winnerView?.viewerResult).toMatchObject({ outcome: 'win', mmrBefore: 1000, mmrAfter: 1025, mmrDelta: 25 });
  });

  it('rejects stale or duplicate turn action revisions before storing them', async () => {
    insertSeason();
    insertCards(14);
    const cardVersionIds = Array.from({ length: 14 }, (_, index) => `card-${index + 1}`);
    const deck = await saveArenaV2Deck({
      userId: 'user-1',
      seasonId: 'season-v2',
      name: '리비전 검증 덱',
      modeScope: 'bot',
      cardVersionIds
    });
    const created = await createArenaV2Match({
      userId: 'user-1',
      mode: 'bot',
      deckId: deck.id
    });
    await submitArenaV2Mulligan({
      userId: 'user-1',
      matchId: created.matchId,
      replaceCardInstanceIds: []
    });
    await finishTurnIntro(created.matchId, 'user-1');

    const first = await submitArenaV2TurnActions({
      userId: 'user-1',
      matchId: created.matchId,
      turnNo: 1,
      revision: 0,
      isFinal: false,
      actions: [{ type: 'end' }]
    });

    await expect(submitArenaV2TurnActions({
      userId: 'user-1',
      matchId: created.matchId,
      turnNo: 1,
      revision: 0,
      isFinal: false,
      actions: [{ type: 'end' }]
    })).rejects.toThrow('ArenaV2RevisionNotIncreasing');

    expect(first.accepted).toBe(true);
    expect(rows.actionSubmissions.filter((submission) => submission.user_id === 'user-1')).toHaveLength(1);
  });

  it('rejects duplicate streamer cards from persisted card data', async () => {
    insertCards(14);
    rows.cards[1].streamer_id = 'streamer-1';

    const validation = await validateArenaV2DeckForSeason('season-v2', Array.from({ length: 14 }, (_, index) => `card-${index + 1}`));

    expect(validation.errors.map((error) => error.code)).toContain('ArenaV2DuplicateStreamerCard');
  });

  it('checks report target existence and stores reports', async () => {
    insertCards(1);
    rows.users.push({ id: 'user-1', username: '유저' });

    expect(await arenaV2TargetExists('card', 'card-1')).toBe(true);
    expect(await arenaV2TargetExists('card', 'missing-card')).toBe(false);

    const report = await createArenaV2Report({
      reporterUserId: 'user-1',
      targetType: 'card',
      targetId: 'card-1',
      reason: '문구 검토 필요'
    });

    expect(rows.reports.find((row) => row.id === report.id)?.status).toBe('received');
  });

  it('previews and creates idempotent season reward grants', async () => {
    insertSeason({
      reward_table: JSON.stringify([
        { tier: 'gold', items: [{ type: 'point', amount: 1000 }] },
        { rankMin: 1, rankMax: 1, items: [{ type: 'badge', code: 'arena_top_1' }] }
      ])
    });
    rows.ratings.push(
      { season_id: 'season-v2', user_id: 'user-1', mmr: 1600, peak_mmr: 1700, tier: 'gold', peak_tier: 'gold', wins: 10, losses: 2, draws: 1, updated_at: 'now-1' },
      { season_id: 'season-v2', user_id: 'user-2', mmr: 1300, peak_mmr: 1400, tier: 'silver', peak_tier: 'silver', wins: 5, losses: 5, draws: 0, updated_at: 'now-2' }
    );

    const preview = await grantArenaV2SeasonRewardsAdmin('season-v2', true, 'season-close');
    expect(preview.status).toBe('preview');
    expect(preview.granted).toBe(0);
    expect(rows.rewardGrants).toHaveLength(0);
    expect(preview.preview.grants[0].rewardItems).toEqual([{ type: 'point', amount: 1000 }, { type: 'badge', code: 'arena_top_1' }]);

    const created = await grantArenaV2SeasonRewardsAdmin('season-v2', false, 'season-close');
    const repeated = await grantArenaV2SeasonRewardsAdmin('season-v2', false, 'season-close');

    expect(created.status).toBe('grants_created');
    expect(created.granted).toBe(2);
    expect(repeated.granted).toBe(0);
    expect(repeated.skipped).toBe(2);
    expect(rows.rewardGrants).toHaveLength(2);
    expect(JSON.parse(rows.rewardGrants[0].reward_items)).toEqual([{ type: 'point', amount: 1000 }, { type: 'badge', code: 'arena_top_1' }]);
  });

  it('expires stale quick and battle royale queue tickets without matching them', async () => {
    insertSeason();
    rows.quickQueue.push({
      id: 'quick-old',
      season_id: 'season-v2',
      user_id: 'user-1',
      deck_id: 'deck-1',
      mmr: 1000,
      status: 'waiting',
      search_min_mmr: 850,
      search_max_mmr: 1150,
      matched_match_id: null,
      joined_at: 'old',
      updated_at: 'old',
      expires_at: '2000-01-01T00:00:00.000Z'
    });
    rows.battleRoyaleQueue.push({
      id: 'br-old',
      season_id: 'season-v2',
      user_id: 'user-2',
      deck_id: 'deck-2',
      status: 'waiting',
      battle_royale_id: null,
      joined_at: 'old',
      updated_at: 'old',
      expires_at: '2000-01-01T00:00:00.000Z'
    });

    const result = await processArenaV2ExpiredQueues();
    const quickStatus = await getArenaV2QuickQueueStatus('user-1', 'season-v2');
    const battleRoyaleStatus = await getArenaV2BattleRoyaleQueueStatus('user-2', 'season-v2');

    expect(result.quickExpired).toBe(1);
    expect(result.battleRoyaleExpired).toBe(1);
    expect(quickStatus.status).toBe('none');
    expect(battleRoyaleStatus.status).toBe('none');
  });

  it('prunes expired replay events while preserving active replay holds', async () => {
    rows.replayEvents.push(
      { match_id: 'match-expired', seq: 1, turn_no: 1, event_type: 'turn_start', payload: '{}', expires_at: '2000-01-01T00:00:00.000Z' },
      { match_id: 'match-held', seq: 1, turn_no: 1, event_type: 'turn_start', payload: '{}', expires_at: '2000-01-01T00:00:00.000Z' }
    );
    rows.replayHolds.push({
      id: 'hold-1',
      match_id: 'match-held',
      reason: 'report',
      status: 'active',
      hold_until: null
    });

    const result = await pruneArenaV2ExpiredReplayEvents();

    expect(result.pruned).toBe(1);
    expect(rows.replayEvents.map((event) => event.match_id)).toEqual(['match-held']);
  });

  it('returns ArenaReplayExpired when a completed match summary remains but detailed events were pruned', async () => {
    insertSeason();
    insertCards(14);
    const deck = await saveArenaV2Deck({
      userId: 'user-1',
      seasonId: 'season-v2',
      name: '리플레이 만료 덱',
      modeScope: 'bot',
      cardVersionIds: Array.from({ length: 14 }, (_, index) => `card-${index + 1}`)
    });
    const created = await createArenaV2Match({
      userId: 'user-1',
      mode: 'bot',
      deckId: deck.id
    });
    const match = rows.matches.find((item) => item.id === created.matchId);
    if (match) {
      match.status = 'completed';
      match.finished_at = '2000-01-01T00:00:00.000Z';
      match.replay_expires_at = '2000-01-08T00:00:00.000Z';
    }
    rows.replayEvents = rows.replayEvents.filter((event) => event.match_id !== created.matchId);

    await expect(getArenaV2Replay(created.matchId, 'user-1')).rejects.toThrow('ArenaReplayExpired');
  });

  it('keeps one waiting battle-royale ticket per user', async () => {
    insertSeason();
    insertCards(14);
    const deck = await saveArenaV2Deck({
      userId: 'user-1',
      seasonId: 'season-v2',
      name: '중복 방지 덱',
      modeScope: 'battle_royale_8',
      cardVersionIds: Array.from({ length: 14 }, (_, index) => `card-${index + 1}`)
    });

    const first = await joinArenaV2BattleRoyaleQueue({ userId: 'user-1', deckId: deck.id });
    const second = await joinArenaV2BattleRoyaleQueue({ userId: 'user-1', deckId: deck.id });

    expect(second.id).toBe(first.id);
    expect(rows.battleRoyaleQueue.filter((ticket) => ticket.user_id === 'user-1' && ticket.status === 'waiting')).toHaveLength(1);
  });

  it('preserves the absolute mulligan deadline and auto-keeps only the missing player at expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T00:00:00.000Z'));
    insertSeason();
    insertCards(14);
    const deck = await saveArenaV2Deck({
      userId: 'user-1',
      seasonId: 'season-v2',
      name: '멀리건 타이머 덱',
      modeScope: 'quick',
      cardVersionIds: Array.from({ length: 14 }, (_, index) => `card-${index + 1}`)
    });
    const created = await createArenaV2Match({ userId: 'user-1', mode: 'bot', deckId: deck.id });
    const match = rows.matches.find((item) => item.id === created.matchId)!;
    match.mode = 'quick';
    const opponent = rows.matchPlayers.find((player) => player.match_id === created.matchId && player.seat_no === 1)!;
    opponent.user_id = 'user-2';
    const originalDeadline = JSON.parse(match.result_summary).mulliganDeadlineAt;

    await submitArenaV2Mulligan({ userId: 'user-1', matchId: created.matchId, replaceCardInstanceIds: [] });
    expect(match.status).toBe('mulligan');
    expect(JSON.parse(match.result_summary).mulliganDeadlineAt).toBe(originalDeadline);

    vi.advanceTimersByTime(40_001);
    const processed = await processArenaV2ExpiredTurns();
    const selfState = JSON.parse(rows.matchPlayers.find((player) => player.match_id === created.matchId && player.seat_no === 0)!.mulligan_state);
    const opponentState = JSON.parse(opponent.mulligan_state);

    expect(processed).toMatchObject({ mulligansAutoConfirmed: 1 });
    expect(match.status).toBe('turn_result');
    expect(selfState.autoConfirmed).not.toBe(true);
    expect(opponentState).toMatchObject({ done: true, replaced: [], autoConfirmed: true });
    expect(opponentState.kept).toEqual(JSON.parse(opponent.hand_card_instance_ids));
  });

  it('rejects mulligan and turn submissions after their authoritative deadlines', async () => {
    insertSeason();
    insertCards(14);
    const deck = await saveArenaV2Deck({
      userId: 'user-1',
      seasonId: 'season-v2',
      name: '마감 거절 덱',
      modeScope: 'bot',
      cardVersionIds: Array.from({ length: 14 }, (_, index) => `card-${index + 1}`)
    });
    const created = await createArenaV2Match({ userId: 'user-1', mode: 'bot', deckId: deck.id });
    const match = rows.matches.find((item) => item.id === created.matchId)!;
    const expiredMulliganSummary = JSON.parse(match.result_summary);
    expiredMulliganSummary.mulliganDeadlineAt = new Date(Date.now() - 1).toISOString();
    match.result_summary = JSON.stringify(expiredMulliganSummary);

    await expect(submitArenaV2Mulligan({
      userId: 'user-1', matchId: created.matchId, replaceCardInstanceIds: []
    })).rejects.toThrow('ArenaV2MulliganDeadlineExpired');

    match.status = 'turn_planning';
    match.result_summary = JSON.stringify({
      status: 'turn_planning',
      phaseTiming: {
        replayDurationMs: 0,
        replayEndsAt: new Date(Date.now() - 5_000).toISOString(),
        introDurationMs: 1_400,
        planningStartsAt: new Date(Date.now() - 4_000).toISOString(),
        turnDeadlineAt: new Date(Date.now() - 1).toISOString(),
        serverNow: new Date().toISOString()
      }
    });
    await expect(submitArenaV2TurnActions({
      userId: 'user-1', matchId: created.matchId, turnNo: 1, revision: 0, isFinal: true, actions: [{ type: 'end' }]
    })).rejects.toThrow('ArenaV2TurnDeadlineExpired');
    expect(rows.actionSubmissions).toHaveLength(0);
  });

  it('uses final battle-royale placement for outcome and exposes only an ongoing next match', async () => {
    insertSeason();
    insertCards(14);
    const deck = await saveArenaV2Deck({
      userId: 'user-1',
      seasonId: 'season-v2',
      name: '최종 결과 덱',
      modeScope: 'battle_royale_8',
      cardVersionIds: Array.from({ length: 14 }, (_, index) => `card-${index + 1}`)
    });
    const created = await createArenaV2Match({ userId: 'user-1', mode: 'bot', deckId: deck.id });
    const match = rows.matches.find((item) => item.id === created.matchId)!;
    const self = rows.matchPlayers.find((player) => player.match_id === created.matchId && player.seat_no === 0)!;
    const opponent = rows.matchPlayers.find((player) => player.match_id === created.matchId && player.seat_no === 1)!;
    match.mode = 'battle_royale_8';
    match.status = 'completed';
    match.battle_royale_id = 'br-result';
    match.winner_user_id = null;
    match.result_summary = JSON.stringify({ status: 'completed', result: 'draw' });
    self.final_rank = 1;
    opponent.user_id = 'user-2';
    opponent.final_rank = 2;
    rows.battleRoyales.push({
      id: 'br-result', season_id: 'season-v2', status: 'finished', current_round_no: 2,
      participant_state: JSON.stringify([
        { seedNo: 1, userId: 'user-1', status: 'winner', health: 0, finalRank: 1, currentMatchId: created.matchId, nextMatchId: null },
        { seedNo: 2, userId: 'user-2', status: 'eliminated', health: 0, finalRank: 2, currentMatchId: created.matchId, nextMatchId: null }
      ]),
      match_ids: JSON.stringify([created.matchId]), winner_user_id: 'user-1', created_at: 'now', updated_at: 'now', finished_at: 'now'
    });

    const championView = await getArenaV2MatchForUser(created.matchId, 'user-1');
    expect(championView?.viewerResult).toMatchObject({ outcome: 'win', placement: 1, nextMatchId: null });

    const nextMatchId = 'br-result-round-2';
    const battleRoyale = rows.battleRoyales[0];
    battleRoyale.status = 'active';
    battleRoyale.finished_at = null;
    battleRoyale.participant_state = JSON.stringify([
      { seedNo: 1, userId: 'user-1', status: 'active', health: 20, finalRank: null, currentMatchId: nextMatchId, nextMatchId },
      { seedNo: 2, userId: 'user-2', status: 'active', health: 20, finalRank: null, currentMatchId: nextMatchId, nextMatchId }
    ]);
    battleRoyale.match_ids = JSON.stringify([created.matchId, nextMatchId]);
    self.final_rank = null;
    opponent.final_rank = null;
    rows.matches.push({
      id: nextMatchId, season_id: 'season-v2', mode: 'battle_royale_8', status: 'turn_planning', battle_royale_id: 'br-result',
      round_no: 2, turn_no: 2, winner_user_id: null, finished_at: null, result_summary: '{}', created_at: 'later'
    });
    rows.matchPlayers.push(
      { match_id: nextMatchId, seat_no: 0, user_id: 'user-1', final_rank: null },
      { match_id: nextMatchId, seat_no: 1, user_id: 'user-2', final_rank: null }
    );

    const previousView = await getArenaV2MatchForUser(created.matchId, 'user-1');
    const snapshot = await getArenaV2BattleRoyale('br-result', 'user-1');
    expect(previousView?.viewerResult?.nextMatchId).toBe(nextMatchId);
    expect(snapshot?.currentMatchId).toBe(nextMatchId);
    expect(snapshot?.participantState.find((participant: Row) => participant.userId === 'user-1')).toMatchObject({
      health: 20, alive: true, currentMatchId: nextMatchId, nextMatchId
    });
  });
});
