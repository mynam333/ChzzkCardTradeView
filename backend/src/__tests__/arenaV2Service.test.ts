import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __setArenaV2ExecutorForTest,
  arenaV2TargetExists,
  cancelArenaV2BattleRoyaleQueue,
  cancelArenaV2QuickQueue,
  createArenaV2Match,
  createArenaV2Report,
  createArenaV2SeasonAdmin,
  deleteArenaV2DeckForUser,
  getArenaV2BattleRoyaleQueueStatus,
  getArenaV2CardVersion,
  getArenaV2CurrentSeason,
  getArenaV2MatchForUser,
  getArenaV2QuickQueueStatus,
  getArenaV2Replay,
  getMyArenaV2StreamerCard,
  grantArenaV2SeasonRewardsAdmin,
  joinArenaV2BattleRoyaleQueue,
  joinArenaV2QuickQueue,
  listArenaV2Cards,
  listArenaV2DecksForUser,
  listArenaV2OwnedCardsForUser,
  pruneArenaV2ExpiredReplayEvents,
  processArenaV2ExpiredQueues,
  revalidateArenaV2DeckForUser,
  saveArenaV2Deck,
  submitArenaV2Mulligan,
  submitArenaV2TurnActions,
  syncArenaV2CardsFromOwnedCards,
  syncArenaV2CardsFromRegisteredStreamers,
  updateMyArenaV2StreamerCard,
  validateArenaV2DeckForSeason
} from '../services/arenaV2Service';

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
  battleRoyaleQueue: [] as Row[],
  replayEvents: [] as Row[],
  replayHolds: [] as Row[],
  battleRoyales: [] as Row[]
};

const resetRows = () => {
  for (const key of Object.keys(rows) as Array<keyof typeof rows>) rows[key] = [];
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
          .slice(0, Number.isFinite(Number(params[params.length - 1])) ? Number(params[params.length - 1]) : 40);
      }
      if (sql.includes('WHERE id IN')) {
        const ids = new Set(params);
        return rows.cards.filter((card) => ids.has(card.id));
      }
      const seasonId = params[0];
      return rows.cards
        .filter((card) => card.season_id === seasonId && card.status === 'active')
        .sort((a, b) => a.cost - b.cost || String(a.display_name).localeCompare(String(b.display_name)))
        .map(cardWithStreamerFields)
        .slice(0, Number.isFinite(Number(params[params.length - 1])) ? Number(params[params.length - 1]) : 40);
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
      return rows.streamers
        .filter((streamer) => Number(streamer.is_image_banned || 0) === 0)
        .sort((a, b) => Number(b.base_value || 0) - Number(a.base_value || 0) || String(a.channel_id).localeCompare(String(b.channel_id)))
        .slice(0, 5000);
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
    if (sql.includes('FROM arena_v2_match_players')) {
      return rows.matchPlayers
        .filter((player) => player.match_id === params[0])
        .sort((a, b) => Number(a.seat_no) - Number(b.seat_no));
    }
    if (sql.includes('FROM arena_v2_card_instances')) {
      return rows.cardInstances
        .filter((instance) => instance.match_id === params[0])
        .map((instance) => {
          const card = rows.cards.find((item) => item.id === instance.card_version_id);
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
            card_status: card?.status
          };
        });
    }
    if (sql.includes('FROM arena_v2_action_submissions')) {
      return rows.actionSubmissions
        .filter((submission) => submission.match_id === params[0] && submission.turn_no === params[1] && Number(submission.is_final) === 1)
        .sort((a, b) => Number(a.seat_no) - Number(b.seat_no));
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
    if (sql.includes('FROM arena_v2_matches')) {
      const match = rows.matches.find((item) => item.id === params[0]);
      if (!match) return undefined;
      if (sql.includes('SELECT id, season_id')) return match;
      if (sql.includes('replay_expires_at')) return { replay_expires_at: match.replay_expires_at, status: match.status };
      return { ok: 1 };
    }
    if (sql.includes('FROM arena_v2_match_players')) {
      return rows.matchPlayers.find((player) => player.match_id === params[0] && player.seat_no === params[1]);
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
      return rows.battleRoyales.find((battleRoyale) => battleRoyale.id === params[0]) ? { ok: 1 } : undefined;
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
    }
    if (sql.includes('INSERT INTO arena_v2_match_players')) {
      rows.matchPlayers.push({
        id: params[0],
        match_id: params[1],
        user_id: params[2],
        seat_no: params[3],
        deck_id: params[4],
        player_health: 30,
        fatigue_count: 0,
        initial_deck_order: params[5],
        hand_card_instance_ids: params[6],
        deck_card_instance_ids: params[7],
        graveyard_card_instance_ids: params[8],
        board_state: params[9],
        mulligan_state: params[10]
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
        matched_match_id: null,
        joined_at: 'now',
        updated_at: 'now',
        expires_at: params[7]
      });
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
      if (sql.includes('player_health')) {
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
        if (player) {
          player.hand_card_instance_ids = params[0];
          player.deck_card_instance_ids = params[1];
          player.mulligan_state = params[2];
        }
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
        const match = rows.matches.find((item) => item.id === params[1] && item.status === 'mulligan');
        if (match) {
          match.status = 'turn_planning';
          match.result_summary = params[0];
        }
      } else if (sql.includes("status = 'combat_resolving'")) {
        const match = rows.matches.find((item) => item.id === params[0] && item.turn_no === params[1]);
        if (match) match.status = 'combat_resolving';
      } else if (sql.includes("status = 'action_locked'")) {
        const match = rows.matches.find((item) => item.id === params[1] && item.turn_no === params[2]);
        if (match) {
          match.status = 'action_locked';
          match.result_summary = params[0];
        }
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
    if (sql.includes('UPDATE arena_v2_match_queue')) {
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
    card_pool_version: 'cards-v1',
    balance_version: 'balance-v1',
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

beforeEach(() => {
  resetRows();
  __setArenaV2ExecutorForTest(makeExecutor() as any);
});

afterEach(() => {
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
    expect(ownedCards[0].artAssetId).toBe(longArtUrl);
  });

  it('lets a registered streamer customize their own card within the GDD cost budget', async () => {
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
    });
    const mine = await getMyArenaV2StreamerCard('streamer-owner');

    expect(result.accepted).toBe(true);
    expect(result.card?.displayName).toBe('오너 커스텀');
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
      displayName: '예산 초과',
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
    expect(joined.searchMinMmr).toBe(850);
    expect(status.ticket?.id).toBe(joined.id);
    expect(cancelled.cancelled).toBe(true);
    expect(afterCancel.status).toBe('none');
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

  it('reads a v2 match snapshot and resolves a valid bot turn after mulligan', async () => {
    insertSeason();
    insertCards(14);
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
    expect(result.accepted).toBe(true);
    expect(result.match?.status).toBe('turn_planning');
    expect(result.match?.turnNo).toBe(2);
    expect(rows.actionSubmissions).toHaveLength(2);
    expect(rows.replayEvents.length).toBeGreaterThan(0);
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
});
