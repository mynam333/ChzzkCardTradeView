import { Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { streamerRepository, userCardRepository } from '../repositories';
import { AuthenticatedRequest } from '../middlewares/admin';
import {
  ARENA_CLASSES,
  ARENA_FORBIDDEN_COMBAT_FIELDS,
  ARENA_SKILLS,
  ArenaGeneratedCard,
  generateArenaCardFromStreamer,
  getArenaCardConfigOptions,
  normalizeArenaCardConfig
} from '../services/arenaCatalog';
import {
  getArenaStreamerCardState,
  listArenaStreamerCardStates,
  listDisabledArenaStreamerIds,
  setArenaStreamerCardConfig,
  setArenaStreamerCardEnabled
} from '../services/arenaStreamerCardState';
import {
  createArenaDeck,
  deleteArenaDeck,
  listArenaDecks,
  revalidateArenaDeck,
  updateArenaDeck,
  validateArenaDeckInput
} from '../services/arenaDeckService';
import {
  clearArenaMatchCaches,
  commitArenaMatchRound,
  createArenaBotMatch,
  getArenaMatchForUser,
  listRecentArenaMatchesForUser,
  getArenaProfile,
  getArenaUserProfile,
  getArenaReplayForUser,
  getArenaReplayStoragePolicy,
  listArenaRankings,
  rebuildArenaRankingSnapshot
} from '../services/arenaMatchService';
import {
  ARENA_BATTLEFIELD_RULES,
  ARENA_MATCH_FORMAT,
  ARENA_ROUNDS_TO_WIN,
  ARENA_TACTIC_CHIPS,
  ARENA_TARGET_CLIENT_PLAY_TIME_SECONDS
} from '../services/arenaRules';
import { listArenaAdminStatsSnapshot, rebuildArenaAdminStatsSnapshot } from '../services/arenaAdminStatsService';
import { getArenaAbuseAudit } from '../services/arenaAbuseAuditService';
import { getArenaWorkerHeartbeatStatus, listArenaAdminJobs, startArenaAdminJob } from '../services/arenaAdminJobService';
import { createArenaSpectatorShareLink, getArenaSpectatorReplayByToken } from '../services/arenaSpectatorLinkService';
import {
  cancelArenaCupQueue,
  getArenaCupAdminOverview,
  getArenaCupDetail,
  getArenaCupQueueStatus,
  isArenaCupEnabled,
  joinArenaCupQueue,
  recoverArenaCupQueue,
  subscribeArenaCupQueueEvents
} from '../services/arenaCupService';
import {
  cancelArenaQuickMatch,
  getArenaQuickMatchAdminOverview,
  getArenaQuickMatchStatus,
  isArenaQuickMatchEnabled,
  joinArenaQuickMatch,
  recoverArenaQuickMatchQueue,
  subscribeArenaQuickMatchEvents
} from '../services/arenaMatchmakingService';
import {
  buyArenaCosmeticItem,
  getArenaCosmeticInventoryCounts,
  getArenaCosmeticLoadout,
  getArenaCosmeticPurchases,
  listArenaCosmeticShopItems,
  updateArenaCosmeticLoadout
} from '../services/arenaCosmeticService';
import { ArenaOpsFlag, loadArenaOpsConfig, setArenaOpsFlag } from '../services/arenaOpsConfig';
import {
  ArenaAdminRestrictionType,
  listArenaAdminAuditLogs,
  loadArenaAdminControlConfig,
  recordArenaAdminAuditLog,
  setArenaAdminRestriction
} from '../services/arenaAdminControlService';
import { ensureDirectory, getUploadsDir } from '../services/storagePaths';

const CARD_LIST_CACHE_TTL_MS = Math.max(60_000, Number(process.env.ARENA_CARD_LIST_CACHE_TTL_MS || 300_000));
const CARD_LIST_MAX_LIMIT = Math.max(12, Number(process.env.ARENA_CARD_LIST_MAX_LIMIT || 96));

let cardListCache: { cards: ArenaGeneratedCard[]; expiresAt: number } | null = null;
let cardListInFlight: Promise<ArenaGeneratedCard[]> | null = null;
const cardDetailCache = new Map<string, { card: ArenaGeneratedCard; expiresAt: number }>();

export const clearArenaCardCaches = () => {
  cardListCache = null;
  cardListInFlight = null;
  cardDetailCache.clear();
};

const setPublicCache = (res: Response, maxAgeSeconds: number) => {
  res.set('Cache-Control', `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds * 4}`);
};

const loadArenaCards = async (): Promise<ArenaGeneratedCard[]> => {
  const now = Date.now();
  if (cardListCache && cardListCache.expiresAt > now) return cardListCache.cards;
  if (cardListInFlight) return cardListInFlight;

  cardListInFlight = Promise.all([
    streamerRepository.findAll(),
    listArenaStreamerCardStates()
  ])
    .then(([streamers, streamerCardStates]) => {
      const cards = streamers
        .filter((streamer) => {
          const state = streamerCardStates[streamer.channel_id];
          return streamer.channel_id && streamer.name && state?.is_enabled !== false;
        })
        .map((streamer) => generateArenaCardFromStreamer(streamer, {
          arenaEnabled: true,
          config: streamerCardStates[streamer.channel_id]?.config || null
        }));
      cardListCache = { cards, expiresAt: Date.now() + CARD_LIST_CACHE_TTL_MS };
      return cards;
    })
    .finally(() => {
      cardListInFlight = null;
    });

  return cardListInFlight;
};

const getCardIdChannel = (cardId: string): string => {
  const trimmed = String(cardId || '').trim();
  return trimmed.startsWith('arena_streamer_') ? trimmed.replace(/^arena_streamer_/, '') : trimmed;
};

const requireArenaStreamerOwner = async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
    return null;
  }

  const streamer = await streamerRepository.findById(user.id);
  if (!streamer) {
    res.status(404).json({
      error: 'ArenaStreamerCardNotFound',
      message: '본인 채널의 치카포 스트리머 카드가 아직 등록되어 있지 않습니다.'
    });
    return null;
  }

  return { user, streamer };
};

export const getArenaSystemStatus = async (_req: Request, res: Response) => {
  await loadArenaOpsConfig();
  setPublicCache(res, 60);
  return res.status(200).json({
    status: 'preseason_setup',
    quick_match_enabled: isArenaQuickMatchEnabled(),
    service_name: '치카포 아레나',
    match_format: {
      set_rule: ARENA_MATCH_FORMAT,
      target_client_play_time_seconds: ARENA_TARGET_CLIENT_PLAY_TIME_SECONDS,
      server_simulation: 'round_commit_seeded_result'
    },
    low_load_policy: {
      realtime_rooms: 'cosmetic_emotes_only',
      bot_replay_saved: false,
      battle_writes: 'one_match_create_plus_one_write_per_committed_round',
      ranked_workers: '1-2',
      ranking_source: 'snapshot_only',
      ranking_snapshot_limit: 1000,
      card_catalog_cache_ttl_ms: CARD_LIST_CACHE_TTL_MS
    },
    disconnect_policy: {
      queue_disconnect: 'queue_expires_or_user_cancels_without_opponent_penalty',
      after_match_finalized: 'server_result_persists_and_replay_can_resume',
      between_round_exit: 'match_can_resume_from_next_uncommitted_round',
      absent_round_submitter: 'auto_commit_saved_default_round_plan',
      mid_replay_exit: 'local_only_no_opponent_impact',
      surrender_supported: false,
      abandon_penalty_scope: 'queue_abuse_only'
    },
    fair_play_policy: {
      combat_uses_chikapo_market_or_live_data: false,
      chikapo_source_data_scope: 'image_and_cosmetic_only',
      forbidden_combat_fields: ARENA_FORBIDDEN_COMBAT_FIELDS
    },
    cup_mode: {
      mode_id: 'eight_player_strategy_cup',
      enabled: isArenaCupEnabled(),
      participants: 8,
      mmr_reflected: false,
      server_policy: 'bracket_results_are_seeded_and_persisted_after_join_window',
      realtime_rooms: false
    },
    streamer_controls: {
      opt_out_supported: true,
      disable_effective_policy: 'immediate_cache_invalidation',
      enable_effective_policy: 'next_card_pool_refresh',
      default_unconfigured_cards: 'deterministic_template_by_channel_id'
    }
  });
};


export const getArenaCupStatus = async (_req: Request, res: Response) => {
  await loadArenaOpsConfig();
  setPublicCache(res, 60);
  return res.status(200).json({
    ok: true,
    data: {
      mode_id: 'eight_player_strategy_cup',
      enabled: isArenaCupEnabled(),
      participants: 8,
      ranked_mmr_reflected: false,
      match_format: ARENA_MATCH_FORMAT,
      rounds_to_win: ARENA_ROUNDS_TO_WIN,
      strategy_scope: ['5-round plan reuse', 'deck composition', 'formation per round'],
      low_load_policy: {
        realtime_rooms: false,
        queue_status_transport: 'sse_while_queued_with_http_fallback',
        bracket_generation: 'single_seeded_commit',
        spectator: 'token_link_completed_replay_only'
      }
    }
  });
};
export const getArenaCurrentSeason = async (_req: Request, res: Response) => {
  await loadArenaOpsConfig();
  setPublicCache(res, 120);
  return res.status(200).json({
    season: {
      id: 'arena-preseason-0',
      name: '프리시즌 준비',
      phase: 'setup',
      ranked_enabled: isArenaQuickMatchEnabled(),
      quick_match_enabled: isArenaQuickMatchEnabled(),
      bot_practice_enabled: true,
      mmr_enabled: true,
      ranking_enabled: true,
      cup_enabled: isArenaCupEnabled()
    }
  });
};

export const getArenaRulesCatalog = async (_req: Request, res: Response) => {
  setPublicCache(res, 300);
  return res.status(200).json({
    version: 'arena-rules-v1',
    classes: ARENA_CLASSES,
    skills: ARENA_SKILLS,
    tactic_chips: ARENA_TACTIC_CHIPS,
    battlefield_rules: ARENA_BATTLEFIELD_RULES,
    forbidden_combat_fields: ARENA_FORBIDDEN_COMBAT_FIELDS
  });
};

const arenaCosmeticPolicy = {
  combat_effect: false,
  allowed_types: ['border', 'name_effect', 'emote'],
  forbidden_links: ['stats', 'class', 'skill', 'matchmaking', 'mmr', 'ranking', 'rewards'],
  source: 'chikapo_shop_cosmetics',
  equip_scope: 'arena_profile_and_replay_visual_only',
  realtime_scope: 'ephemeral_emote_broadcast_without_match_result_effect'
};

export const getArenaCosmeticShopItems = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const items = await listArenaCosmeticShopItems();
    res.set('Cache-Control', 'private, no-cache');
    return res.status(200).json({ items, policy: arenaCosmeticPolicy });
  } catch (err) {
    console.error('[ArenaController] getArenaCosmeticShopItems 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '아레나 스타일 상점 목록을 불러오지 못했습니다.' });
  }
};

export const getMyArenaCosmeticInventoryCounts = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  try {
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json(await getArenaCosmeticInventoryCounts(userId));
  } catch (err) {
    console.error('[ArenaController] getMyArenaCosmeticInventoryCounts 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '아레나 코스메틱 보유 수량을 불러오지 못했습니다.' });
  }
};

export const getMyArenaCosmeticPurchases = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  try {
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json(await getArenaCosmeticPurchases(userId));
  } catch (err) {
    console.error('[ArenaController] getMyArenaCosmeticPurchases 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '아레나 코스메틱 구매 내역을 불러오지 못했습니다.' });
  }
};

export const buyMyArenaCosmeticItem = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  const itemId = Number(req.body?.item_id);
  if (!itemId) return res.status(400).json({ error: 'BadRequest', message: '구매할 아레나 아이템 ID가 필요합니다.' });
  try {
    const result = await buyArenaCosmeticItem(userId, itemId);
    if (!result.ok) {
      const message = result.reason === 'INSUFFICIENT_POINT' ? '포인트가 부족합니다.'
        : result.reason === 'NOT_FOUND' ? '판매 중인 아레나 아이템이 아닙니다.'
        : result.reason === 'LIMIT_REACHED' ? '이 아이템의 최대 구매 횟수에 도달했습니다.'
        : result.reason === 'SALE_NOT_STARTED' ? '아직 판매가 시작되지 않은 아레나 아이템입니다.'
        : result.reason === 'SALE_ENDED' ? '판매 기간이 종료된 아레나 아이템입니다.'
        : result.reason === 'SOLD_OUT' ? '준비된 한정 수량이 모두 판매되었습니다.'
        : '아레나 아이템 구매에 실패했습니다.';
      return res.status(400).json({ error: 'ArenaCosmeticBuyFailed', reason: result.reason, message });
    }
    return res.status(200).json({
      message: '아레나 아이템 구매가 완료되었습니다.',
      catalogChanged: Boolean(result.catalogChanged),
      policy: arenaCosmeticPolicy
    });
  } catch (err) {
    console.error('[ArenaController] buyMyArenaCosmeticItem 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '아레나 아이템 구매 처리에 실패했습니다.' });
  }
};

export const getMyArenaCosmeticLoadout = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  try {
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ data: await getArenaCosmeticLoadout(userId), policy: arenaCosmeticPolicy });
  } catch (err) {
    console.error('[ArenaController] getMyArenaCosmeticLoadout 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '아레나 스타일 장착 정보를 불러오지 못했습니다.' });
  }
};

export const updateMyArenaCosmeticLoadout = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  try {
    const patch = {
      ...(Object.prototype.hasOwnProperty.call(req.body || {}, 'border_item_id') ? { border_item_id: req.body.border_item_id == null ? null : Number(req.body.border_item_id) } : {}),
      ...(Object.prototype.hasOwnProperty.call(req.body || {}, 'name_effect_item_id') ? { name_effect_item_id: req.body.name_effect_item_id == null ? null : Number(req.body.name_effect_item_id) } : {}),
      ...(Object.prototype.hasOwnProperty.call(req.body || {}, 'emote_slot_1_item_id') ? { emote_slot_1_item_id: req.body.emote_slot_1_item_id == null ? null : Number(req.body.emote_slot_1_item_id) } : {}),
      ...(Object.prototype.hasOwnProperty.call(req.body || {}, 'emote_slot_2_item_id') ? { emote_slot_2_item_id: req.body.emote_slot_2_item_id == null ? null : Number(req.body.emote_slot_2_item_id) } : {}),
      ...(Object.prototype.hasOwnProperty.call(req.body || {}, 'emote_slot_3_item_id') ? { emote_slot_3_item_id: req.body.emote_slot_3_item_id == null ? null : Number(req.body.emote_slot_3_item_id) } : {}),
      ...(Object.prototype.hasOwnProperty.call(req.body || {}, 'emote_slot_4_item_id') ? { emote_slot_4_item_id: req.body.emote_slot_4_item_id == null ? null : Number(req.body.emote_slot_4_item_id) } : {})
    };
    const result = await updateArenaCosmeticLoadout(userId, patch);
    if (!result.ok) {
      const message = result.reason === 'NOT_OWNED' ? '보유 중인 아레나 아이템만 장착할 수 있습니다.'
        : result.reason === 'ITEM_TYPE_MISMATCH' ? '아레나 장착 슬롯과 아이템 종류가 맞지 않습니다.'
        : result.reason === 'DUPLICATE_EMOTE_SLOT' ? '같은 이모트는 한 슬롯에만 장착할 수 있습니다.'
        : '아레나 스타일 장착에 실패했습니다.';
      return res.status(400).json({ error: 'ArenaCosmeticEquipFailed', reason: result.reason, message });
    }
    return res.status(200).json({ data: result.loadout, policy: arenaCosmeticPolicy });
  } catch (err) {
    console.error('[ArenaController] updateMyArenaCosmeticLoadout 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '아레나 스타일 장착 처리에 실패했습니다.' });
  }
};

const getArenaEmoteAssetExtension = (mimeType: string) => {
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/avif') return 'avif';
  return 'jpg';
};

export const adminUploadArenaEmoteAsset = async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Forbidden', message: '관리자 권한이 필요합니다.' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'BadRequest', message: '업로드할 이모트 이미지가 필요합니다.' });
  }

  try {
    const uploadDir = path.join(getUploadsDir(), 'arena-emotes');
    ensureDirectory(uploadDir);
    const ext = getArenaEmoteAssetExtension(req.file.mimetype);
    const fileName = `arena_emote_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
    const filePath = path.join(uploadDir, fileName);
    fs.writeFileSync(filePath, req.file.buffer);
    const imageUrl = `/uploads/arena-emotes/${encodeURIComponent(fileName)}`;
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({
      ok: true,
      data: {
        image_url: imageUrl,
        mime_type: req.file.mimetype,
        animated: req.file.mimetype === 'image/gif'
      }
    });
  } catch (err: any) {
    console.error('[ArenaController] adminUploadArenaEmoteAsset 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '아레나 이모트 이미지를 업로드하지 못했습니다.' });
  }
};

export const getArenaCards = async (req: Request, res: Response) => {
  try {
    const limit = Math.min(
      CARD_LIST_MAX_LIMIT,
      Math.max(1, Number.parseInt(String(req.query.limit || '36'), 10) || 36)
    );
    const cursor = Math.max(0, Number.parseInt(String(req.query.cursor || '0'), 10) || 0);
    const cards = await loadArenaCards();
    const items = cards.slice(cursor, cursor + limit);
    const nextCursor = cursor + items.length < cards.length ? cursor + items.length : null;

    setPublicCache(res, Math.max(60, Math.floor(CARD_LIST_CACHE_TTL_MS / 1000)));
    return res.status(200).json({
      items,
      next_cursor: nextCursor,
      total_estimate: cards.length,
      policy: {
        ability_seed: 'channel_id_hash_v1',
        same_streamer_same_ability: true,
        disabled_cards_excluded: true,
        combat_uses_market_or_live_data: false
      }
    });
  } catch (err) {
    console.error('[ArenaController] getArenaCards 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '아레나 카드 목록을 불러오지 못했습니다.' });
  }
};

export const getArenaCardDetail = async (req: Request, res: Response) => {
  try {
    const channelId = getCardIdChannel(req.params.card_id);
    if (!channelId) {
      return res.status(400).json({ error: 'BadRequest', message: '카드 ID가 필요합니다.' });
    }

    const state = await getArenaStreamerCardState(channelId);
    const now = Date.now();
    const cacheKey = `${channelId}:${state.is_enabled ? 'enabled' : 'disabled'}:${state.updated_at || 'default'}`;
    const cached = cardDetailCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      setPublicCache(res, 300);
      return res.status(200).json({ card: cached.card, state });
    }

    if (state.is_enabled) {
      const listCachedCard = cardListCache?.cards.find((card) => card.channel_id === channelId);
      if (listCachedCard) {
        cardDetailCache.set(cacheKey, { card: listCachedCard, expiresAt: now + CARD_LIST_CACHE_TTL_MS });
        setPublicCache(res, 300);
        return res.status(200).json({ card: listCachedCard, state });
      }
    }

    const streamer = await streamerRepository.findById(channelId);
    if (!streamer) {
      return res.status(404).json({ error: 'NotFound', message: '아레나 카드를 찾을 수 없습니다.' });
    }

    const card = generateArenaCardFromStreamer(streamer, { arenaEnabled: state.is_enabled, config: state.config });
    cardDetailCache.set(cacheKey, { card, expiresAt: Date.now() + CARD_LIST_CACHE_TTL_MS });
    setPublicCache(res, 300);
    return res.status(200).json({ card, state });
  } catch (err) {
    console.error('[ArenaController] getArenaCardDetail 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '아레나 카드 정보를 불러오지 못했습니다.' });
  }
};

export const getMyArenaOwnedCards = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
    }
    const limit = Math.min(80, Math.max(1, Number.parseInt(String(req.query.limit || '40'), 10) || 40));
    const ownedCards = await userCardRepository.findByUserId(req.user.id);
    const streamerCardStates = await listArenaStreamerCardStates();
    const byChannel = new Map<string, { streamer: any; owned_count: number; max_star: number }>();

    for (const owned of ownedCards) {
      if (!owned.channel_id || !owned.streamer || streamerCardStates[owned.channel_id]?.is_enabled === false) continue;
      const current = byChannel.get(owned.channel_id) || { streamer: owned.streamer, owned_count: 0, max_star: 0 };
      current.owned_count += 1;
      current.max_star = Math.max(current.max_star, Number(owned.star || 0));
      byChannel.set(owned.channel_id, current);
    }

    const items = Array.from(byChannel.values()).slice(0, limit).map((item) => ({
      ...generateArenaCardFromStreamer(item.streamer, {
        config: streamerCardStates[item.streamer.channel_id]?.config || null
      }),
      owned_count: item.owned_count,
      max_star: item.max_star
    }));

    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, data: { items, total_owned_streamers: byChannel.size } });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '보유 아레나 카드를 불러오지 못했습니다.');
  }
};

export const getMyArenaRecentMatches = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
    }

    const matches = await listRecentArenaMatchesForUser(req.user.id, req.query.limit);
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, data: { items: matches } });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '최근 아레나 매치를 불러오지 못했습니다.');
  }
};

export const validateArenaDeck = async (req: Request, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
    }

    const deckId = String(req.params.deck_id || '').trim();
    if (deckId && deckId !== 'draft') {
      const deck = await revalidateArenaDeck(user.id, deckId);
      if (!deck) {
        return res.status(404).json({ error: 'NotFound', message: '아레나 덱을 찾을 수 없습니다.' });
      }
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({ ok: true, data: { deck, validation: deck.validation_result } });
    }

    const validation = await validateArenaDeckInput(req.body || {});
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, data: { validation }, ...validation });
  } catch (err: any) {
    if (err?.message === 'ArenaDeckStorageUnsupported') {
      return res.status(503).json({ error: 'ArenaDeckStorageUnsupported', message: '현재 DB 모드에서는 아레나 덱 저장소를 사용할 수 없습니다.' });
    }
    console.error('[ArenaController] validateArenaDeck 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '아레나 덱 검증에 실패했습니다.' });
  }
};

const handleArenaDeckError = (res: Response, err: any, fallbackMessage: string) => {
  if (err?.message === 'ArenaDeckValidationFailed' && err.validation) {
    return res.status(400).json({
      error: 'ArenaDeckValidationFailed',
      message: '아레나 덱 규칙을 만족하지 못했습니다.',
      validation: err.validation
    });
  }
  if (err?.message === 'ArenaDeckLimitExceeded') {
    return res.status(400).json({
      error: 'ArenaDeckLimitExceeded',
      message: '저장 가능한 아레나 덱 개수를 초과했습니다.'
    });
  }
  if (err?.message === 'ArenaDeckStorageUnsupported') {
    return res.status(503).json({
      error: 'ArenaDeckStorageUnsupported',
      message: '현재 DB 모드에서는 아레나 덱 저장소를 사용할 수 없습니다.'
    });
  }

  console.error('[ArenaController] deck error:', err);
  return res.status(500).json({ error: 'InternalServerError', message: fallbackMessage });
};

export const listMyArenaDecks = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
    }

    const decks = await listArenaDecks(req.user.id);
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, data: { items: decks, max_decks: Number(process.env.ARENA_MAX_DECKS_PER_USER || 12) } });
  } catch (err: any) {
    return handleArenaDeckError(res, err, '아레나 덱 목록을 불러오지 못했습니다.');
  }
};

export const createMyArenaDeck = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
    }

    const deck = await createArenaDeck(req.user.id, req.body || {});
    res.set('Cache-Control', 'private, no-store');
    return res.status(201).json({ ok: true, data: { deck } });
  } catch (err: any) {
    return handleArenaDeckError(res, err, '아레나 덱을 저장하지 못했습니다.');
  }
};

export const updateMyArenaDeck = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
    }

    const deck = await updateArenaDeck(req.user.id, String(req.params.deck_id || ''), req.body || {});
    if (!deck) {
      return res.status(404).json({ error: 'NotFound', message: '아레나 덱을 찾을 수 없습니다.' });
    }
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, data: { deck } });
  } catch (err: any) {
    return handleArenaDeckError(res, err, '아레나 덱을 수정하지 못했습니다.');
  }
};

export const deleteMyArenaDeck = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
    }

    const deleted = await deleteArenaDeck(req.user.id, String(req.params.deck_id || ''));
    if (!deleted) {
      return res.status(404).json({ error: 'NotFound', message: '아레나 덱을 찾을 수 없습니다.' });
    }
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, data: { deleted: true } });
  } catch (err: any) {
    return handleArenaDeckError(res, err, '아레나 덱을 삭제하지 못했습니다.');
  }
};

const writeArenaSse = (res: Response, event: string, data: unknown) => {
  res.write(`event: ${event}
`);
  res.write(`data: ${JSON.stringify(data)}

`);
};

const prepareArenaSse = (res: Response) => {
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, private, max-age=0, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();
};

const ARENA_SSE_HEARTBEAT_INTERVAL_MS = Math.max(10_000, Number(process.env.ARENA_SSE_HEARTBEAT_INTERVAL_MS || 15_000));
const ARENA_QUICK_SSE_VERIFY_INTERVAL_MS = Math.max(15_000, Number(process.env.ARENA_QUICK_SSE_VERIFY_INTERVAL_MS || 30_000));
const ARENA_CUP_SSE_VERIFY_INTERVAL_MS = Math.max(20_000, Number(process.env.ARENA_CUP_SSE_VERIFY_INTERVAL_MS || 45_000));

const handleArenaMatchError = (res: Response, err: any, fallbackMessage: string) => {
  if (err?.message === 'ArenaDeckNotFound') {
    return res.status(404).json({ error: 'ArenaDeckNotFound', message: '아레나 덱을 찾을 수 없습니다.' });
  }
  if (err?.message === 'ArenaDeckValidationFailed' && err.validation) {
    return res.status(400).json({
      error: 'ArenaDeckValidationFailed',
      message: '아레나 덱 규칙을 만족하지 못했습니다.',
      validation: err.validation
    });
  }
  if (err?.message === 'ArenaBotPoolInsufficient') {
    return res.status(503).json({ error: 'ArenaBotPoolInsufficient', message: '봇 연습전에 사용할 아레나 카드 풀이 부족합니다.' });
  }
  if (err?.message === 'ArenaCupDisabled') {
    return res.status(503).json({ error: 'ArenaCupDisabled', message: '8인 컵은 현재 프리시즌 준비 상태입니다.', policy: 'set ARENA_8_PLAYER_CUP_ENABLED=true only after load testing' });
  }
  if (err?.message === 'ArenaCupStorageUnsupported') {
    return res.status(503).json({ error: 'ArenaCupStorageUnsupported', message: '현재 DB 모드에서는 아레나 컵 저장소를 사용할 수 없습니다.' });
  }
  if (err?.message === 'ArenaAdminStatsStorageUnsupported') {
    return res.status(503).json({ error: 'ArenaAdminStatsStorageUnsupported', message: '현재 DB 모드에서는 아레나 관리자 통계를 사용할 수 없습니다.' });
  }
  if (err?.message === 'ArenaMatchStorageUnsupported') {
    return res.status(503).json({ error: 'ArenaMatchStorageUnsupported', message: '현재 DB 모드에서는 아레나 매치 저장소를 사용할 수 없습니다.' });
  }
  if (err?.message === 'ArenaAdminStatsRebuildAlreadyRunning' || err?.message === 'ArenaRankingRebuildAlreadyRunning' || err?.message === 'ArenaAdminJobAlreadyRunning') {
    return res.status(409).json({ error: err.message, message: '이미 같은 관리자 재생성 작업이 실행 중입니다. 잠시 후 다시 시도해 주세요.' });
  }
  if (err?.message === 'ArenaQuickMatchDisabled') {
    return res.status(503).json({
      error: 'ArenaQuickMatchDisabled',
      message: '빠른대전은 현재 프리시즌 준비 상태입니다.',
      policy: 'set ARENA_QUICK_MATCH_ENABLED=true only after load testing'
    });
  }

  console.error('[ArenaController] match error:', err);
  return res.status(500).json({ error: 'InternalServerError', message: fallbackMessage });
};


export const joinArenaQuickMatchQueue = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
    }

    if (!isArenaQuickMatchEnabled()) {
      return res.status(503).json({
        error: 'ArenaQuickMatchDisabled',
        message: '빠른대전은 현재 프리시즌 준비 상태입니다.',
        policy: 'load_test_required_before_enable'
      });
    }

    const deckId = String(req.body?.deck_id || '').trim();
    if (!deckId) {
      return res.status(400).json({ error: 'BadRequest', message: 'deck_id가 필요합니다.' });
    }

    const status = await joinArenaQuickMatch(req.user.id, deckId);
    res.set('Cache-Control', 'private, no-store');
    return res.status(status.status === 'matched' ? 201 : 202).json({ ok: true, data: status });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '빠른대전 큐 등록에 실패했습니다.');
  }
};


export const streamMyArenaQuickMatchStatus = async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }
  if (!isArenaQuickMatchEnabled()) {
    return res.status(200).json({ ok: true, data: { status: 'none', queue_ticket_id: null, match_id: null, elapsed_sec: 0, poll_after_sec: null, resume_available: false, quick_match_enabled: false } });
  }

  prepareArenaSse(res);
  let closed = false;
  let unsubscribe = () => {};
  let heartbeat: NodeJS.Timeout | null = null;
  let verify: NodeJS.Timeout | null = null;
  const close = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    if (heartbeat) clearInterval(heartbeat);
    if (verify) clearInterval(verify);
    if (!res.destroyed && !res.writableEnded) res.end();
  };
  const sendStatus = (payload: unknown) => {
    if (closed || res.destroyed) return;
    writeArenaSse(res, 'arena_queue_status', payload);
  };
  unsubscribe = subscribeArenaQuickMatchEvents(req.user.id, sendStatus);
  heartbeat = setInterval(() => {
    if (!closed && !res.destroyed) res.write(`: heartbeat ${Date.now()}

`);
  }, ARENA_SSE_HEARTBEAT_INTERVAL_MS);
  verify = setInterval(async () => {
    if (closed || res.destroyed) return;
    try {
      const status = await getArenaQuickMatchStatus(req.user!.id);
      sendStatus(status);
      if (status.status !== 'queued') close();
    } catch (err: any) {
      writeArenaSse(res, 'arena_queue_error', { message: err?.message || 'ArenaQuickMatchStatusStreamError' });
    }
  }, ARENA_QUICK_SSE_VERIFY_INTERVAL_MS);
  heartbeat?.unref?.();
  verify?.unref?.();
  req.on('close', close);

  try {
    const status = await getArenaQuickMatchStatus(req.user.id);
    sendStatus(status);
    if (status.status !== 'queued') close();
  } catch (err: any) {
    writeArenaSse(res, 'arena_queue_error', { message: err?.message || 'ArenaQuickMatchStatusStreamError' });
    close();
  }
};

export const getMyArenaQuickMatchStatus = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
    }

    if (!isArenaQuickMatchEnabled()) {
      return res.status(200).json({
        ok: true,
        data: {
          status: 'none',
          queue_ticket_id: null,
          match_id: null,
          elapsed_sec: 0,
          poll_after_sec: null,
          resume_available: false,
          quick_match_enabled: false
        }
      });
    }

    const status = await getArenaQuickMatchStatus(req.user.id);
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, data: status });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '빠른대전 상태 조회에 실패했습니다.');
  }
};

export const cancelMyArenaQuickMatch = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
    }

    if (!isArenaQuickMatchEnabled()) {
      return res.status(200).json({
        ok: true,
        data: {
          status: 'none',
          queue_ticket_id: null,
          match_id: null,
          elapsed_sec: 0,
          poll_after_sec: null,
          resume_available: false,
          quick_match_enabled: false
        }
      });
    }

    const status = await cancelArenaQuickMatch(req.user.id);
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, data: status });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '빠른대전 취소에 실패했습니다.');
  }
};
export const createArenaBotPracticeMatch = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
    }

    const deckId = String(req.body?.deck_id || '').trim();
    if (!deckId) {
      return res.status(400).json({ error: 'BadRequest', message: 'deck_id가 필요합니다.' });
    }

    const match = await createArenaBotMatch(req.user.id, deckId, req.body?.difficulty);
    res.set('Cache-Control', 'private, no-store');
    return res.status(201).json({
      ok: true,
      data: {
        match_id: match.id,
        result: match.result,
        round_count: match.round_count,
        match
      }
    });
  } catch (err: any) {
    return handleArenaMatchError(res, err, 'AI 연습게임 생성에 실패했습니다.');
  }
};

export const commitMyArenaMatchRound = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
    }

    const matchId = String(req.params.match_id || '').trim();
    if (!matchId) {
      return res.status(400).json({ error: 'BadRequest', message: 'match_id가 필요합니다.' });
    }

    const result = await commitArenaMatchRound(req.user.id, matchId, req.body || {});
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, data: result });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '아레나 라운드 확정에 실패했습니다.');
  }
};


export const joinArenaCup = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
    }
    const deckId = String(req.body?.deck_id || '').trim();
    if (!deckId) {
      return res.status(400).json({ error: 'BadRequest', message: 'deck_id가 필요합니다.' });
    }
    const status = await joinArenaCupQueue(req.user.id, deckId);
    res.set('Cache-Control', 'private, no-store');
    return res.status(status.status === 'matched' ? 201 : 202).json({ ok: true, data: status });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '8인 컵 큐 등록에 실패했습니다.');
  }
};


export const streamMyArenaCupStatus = async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }
  if (!isArenaCupEnabled()) {
    return res.status(200).json({ ok: true, data: { status: 'none', queue_ticket_id: null, cup_id: null, queued_count: 0, required_count: 8, elapsed_sec: 0, poll_after_sec: null, resume_available: false, cup_enabled: false } });
  }

  prepareArenaSse(res);
  let closed = false;
  let unsubscribe = () => {};
  let heartbeat: NodeJS.Timeout | null = null;
  let verify: NodeJS.Timeout | null = null;
  const close = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    if (heartbeat) clearInterval(heartbeat);
    if (verify) clearInterval(verify);
    if (!res.destroyed && !res.writableEnded) res.end();
  };
  const sendStatus = (payload: unknown) => {
    if (closed || res.destroyed) return;
    writeArenaSse(res, 'arena_cup_status', payload);
  };
  unsubscribe = subscribeArenaCupQueueEvents(req.user.id, sendStatus);
  heartbeat = setInterval(() => {
    if (!closed && !res.destroyed) res.write(`: heartbeat ${Date.now()}

`);
  }, ARENA_SSE_HEARTBEAT_INTERVAL_MS);
  verify = setInterval(async () => {
    if (closed || res.destroyed) return;
    try {
      const status = await getArenaCupQueueStatus(req.user!.id);
      sendStatus(status);
      if (status.status !== 'queued') close();
    } catch (err: any) {
      writeArenaSse(res, 'arena_queue_error', { message: err?.message || 'ArenaCupStatusStreamError' });
    }
  }, ARENA_CUP_SSE_VERIFY_INTERVAL_MS);
  heartbeat?.unref?.();
  verify?.unref?.();
  req.on('close', close);

  try {
    const status = await getArenaCupQueueStatus(req.user.id);
    sendStatus(status);
    if (status.status !== 'queued') close();
  } catch (err: any) {
    writeArenaSse(res, 'arena_queue_error', { message: err?.message || 'ArenaCupStatusStreamError' });
    close();
  }
};

export const getMyArenaCupStatus = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
    }
    if (!isArenaCupEnabled()) {
      return res.status(200).json({
        ok: true,
        data: {
          status: 'none',
          queue_ticket_id: null,
          cup_id: null,
          queued_count: 0,
          required_count: 8,
          elapsed_sec: 0,
          poll_after_sec: null,
          resume_available: false,
          cup_enabled: false
        }
      });
    }
    const status = await getArenaCupQueueStatus(req.user.id);
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, data: status });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '8인 컵 상태 조회에 실패했습니다.');
  }
};

export const cancelMyArenaCup = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
    }
    if (!isArenaCupEnabled()) {
      return res.status(200).json({ ok: true, data: { status: 'none', cup_enabled: false } });
    }
    const status = await cancelArenaCupQueue(req.user.id);
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, data: status });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '8인 컵 대기 취소에 실패했습니다.');
  }
};

export const getArenaCup = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
    }
    const cup = await getArenaCupDetail(String(req.params.cup_id || ''), { userId: req.user.id, role: req.user.role });
    if (!cup) {
      return res.status(404).json({ error: 'ArenaCupNotFound', message: '아레나 컵을 찾을 수 없습니다.' });
    }
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, data: cup });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '아레나 컵 상세 정보를 불러오지 못했습니다.');
  }
};
export const getArenaMatch = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
    }

    const match = await getArenaMatchForUser(req.user.id, String(req.params.match_id || ''));
    if (!match) {
      return res.status(404).json({ error: 'ArenaMatchNotFound', message: '아레나 매치를 찾을 수 없습니다.' });
    }
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, data: { match } });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '아레나 매치 정보를 불러오지 못했습니다.');
  }
};

export const getArenaMatchReplay = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
    }

    const replay = await getArenaReplayForUser(req.user.id, String(req.params.match_id || ''));
    if (!replay) {
      return res.status(404).json({ error: 'ArenaReplayNotFound', message: '아레나 리플레이를 찾을 수 없습니다.' });
    }
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, data: replay });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '아레나 리플레이를 불러오지 못했습니다.');
  }
};


export const getMyArenaProfile = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
    }

    const profile = await getArenaProfile(req.user.id);
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, data: profile });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '아레나 프로필을 불러오지 못했습니다.');
  }
};

export const createMyArenaSpectatorShareLink = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
    }
    const result = await createArenaSpectatorShareLink(req.user.id, String(req.params.match_id || req.body?.match_id || ''));
    res.set('Cache-Control', 'private, no-store');
    return res.status(201).json({ ok: true, data: result });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '아레나 관전 공유 링크를 만들지 못했습니다.');
  }
};

export const getArenaSpectatorShareReplay = async (req: Request, res: Response) => {
  try {
    const replay = await getArenaSpectatorReplayByToken(String(req.params.token || ''));
    if (!replay) {
      return res.status(404).json({ error: 'ArenaSpectatorReplayNotFound', message: '관전 리플레이를 찾을 수 없습니다.' });
    }
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, data: replay });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '아레나 관전 리플레이를 불러오지 못했습니다.');
  }
};

export const getArenaPublicUserProfile = async (req: Request, res: Response) => {
  try {
    const userId = String(req.params.user_id || '').trim();
    if (!userId) {
      return res.status(400).json({ error: 'BadRequest', message: 'user_id가 필요합니다.' });
    }
    const profile = await getArenaUserProfile(userId);
    res.set('Cache-Control', 'public, max-age=20, stale-while-revalidate=120');
    return res.status(200).json({ ok: true, data: profile });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '아레나 유저 전적을 불러오지 못했습니다.');
  }
};

export const getArenaRankings = async (req: Request, res: Response) => {
  try {
    const rankings = await listArenaRankings(req.query.limit);
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, data: rankings });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '아레나 랭킹을 불러오지 못했습니다.');
  }
};

export const adminGetArenaOpsStatus = async (_req: AuthenticatedRequest, res: Response) => {
  const opsConfig = await loadArenaOpsConfig();
  const adminControl = await loadArenaAdminControlConfig();
  res.set('Cache-Control', 'private, no-store');
  return res.status(200).json({
    ok: true,
    data: {
      quick_match_enabled: isArenaQuickMatchEnabled(),
      transport_policy: {
        battle_transport: 'http_result_with_client_replay',
        queue_status_transport: 'sse_while_queued_with_http_fallback',
        sse_scope: 'current_api_process_memory_events',
        multi_process_note: 'use sticky routing or external pubsub before PM2 cluster mode',
        websocket_recommended_now: false,
        websocket_future_use: ['live_draft', 'spectator_lobby', 'social_presence']
      },
      ranking_policy: {
        source: 'arena_rank_snapshots',
        rebuild: 'async_admin_job',
        request_time_sorting: false,
        profile_rank_fallback: false
      },
      replay_policy: {
        prune: 'async_admin_job',
        prune_targets: ['arena_match_replays', 'arena_cup_replays', 'arena_spectator_links', 'legacy_inline_replay_json'],
        ...getArenaReplayStoragePolicy()
      },
      worker_health: await getArenaWorkerHeartbeatStatus(),
      load_policy: {
        queue_poll_after_sec: 3,
        queue_ttl_sec: Number(process.env.ARENA_QUICK_QUEUE_TTL_SECONDS || 60),
        queue_cleanup_limit: Number(process.env.ARENA_QUICK_QUEUE_CLEANUP_LIMIT || 100),
        ranking_cache_ttl_ms: Number(process.env.ARENA_RANKING_CACHE_TTL_MS || 30000)
      },
      kill_switches: {
        quick_match_enabled: opsConfig.quick_match_enabled,
        cup_enabled: opsConfig.cup_enabled,
        ranked_rating_writes: opsConfig.ranked_rating_writes,
        replay_writes: opsConfig.replay_writes,
        spectator_public_enabled: opsConfig.spectator_public_enabled,
        spectator_link_enabled: opsConfig.spectator_public_enabled,
        spectator_link_visibility: 'token_link_only',
        source: opsConfig.source,
        loaded_at: opsConfig.loaded_at
      },
      admin_control: {
        ...adminControl,
        audit_log_source: 'arena_admin_audit_logs'
      }
    }
  });
};

export const adminUpdateArenaOpsFlag = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
    }
    const flag = String(req.params.flag || '') as ArenaOpsFlag;
    if (!['quick_match_enabled', 'cup_enabled', 'ranked_rating_writes', 'replay_writes', 'spectator_public_enabled'].includes(flag)) {
      return res.status(400).json({ error: 'ArenaOpsFlagInvalid', message: '알 수 없는 아레나 운영 설정입니다.' });
    }
    const enabled = req.body?.enabled === true;
    const config = await setArenaOpsFlag(flag, enabled);
    await recordArenaAdminAuditLog({
      adminUserId: req.user.id,
      actionType: 'ops_flag_update',
      targetType: 'ops_flag',
      targetId: flag,
      reason: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : null,
      payload: { enabled }
    });
    return res.status(200).json({ ok: true, data: { config } });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '아레나 운영 설정을 변경하지 못했습니다.');
  }
};

export const adminUpdateArenaRestriction = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
    }
    const type = String(req.params.type || '') as ArenaAdminRestrictionType;
    if (!['skill', 'tag', 'battlefield', 'card'].includes(type)) {
      return res.status(400).json({ error: 'ArenaRestrictionTypeInvalid', message: '알 수 없는 아레나 제한 유형입니다.' });
    }
    const id = String(req.params.id || req.body?.id || '').trim();
    const disabled = req.body?.disabled !== false;
    const config = await setArenaAdminRestriction(type, id, disabled);
    clearArenaCardCaches();
    clearArenaMatchCaches();
    await recordArenaAdminAuditLog({
      adminUserId: req.user.id,
      actionType: disabled ? 'restriction_disable' : 'restriction_enable',
      targetType: type,
      targetId: id,
      reason: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : null,
      payload: { disabled }
    });
    return res.status(200).json({ ok: true, data: { config } });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '아레나 제한 설정을 변경하지 못했습니다.');
  }
};

export const adminGetArenaAuditLogs = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const logs = await listArenaAdminAuditLogs(req.query.limit);
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, data: logs });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '아레나 관리자 감사 로그를 불러오지 못했습니다.');
  }
};


export const adminGetArenaQuickMatch = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const overview = await getArenaQuickMatchAdminOverview();
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, data: overview });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '아레나 빠른대전 운영 현황을 불러오지 못했습니다.');
  }
};

export const adminRecoverArenaQuickMatchQueue = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await recoverArenaQuickMatchQueue();
    const overview = await getArenaQuickMatchAdminOverview();
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, data: { ...result, overview } });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '아레나 빠른대전 큐 복구에 실패했습니다.');
  }
};

export const adminGetArenaCups = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const overview = await getArenaCupAdminOverview();
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, data: overview });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '아레나 컵 운영 현황을 불러오지 못했습니다.');
  }
};

export const adminRecoverArenaCupQueue = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await recoverArenaCupQueue();
    const overview = await getArenaCupAdminOverview();
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, data: { ...result, overview } });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '아레나 컵 큐 복구에 실패했습니다.');
  }
};
export const adminGetArenaJobs = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const jobs = await listArenaAdminJobs(req.query.limit);
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, data: jobs });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '아레나 관리자 작업 목록을 불러오지 못했습니다.');
  }
};

export const adminGetArenaStats = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const stats = await listArenaAdminStatsSnapshot(req.query.limit);
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, data: stats });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '아레나 관리자 통계 스냅샷을 불러오지 못했습니다.');
  }
};

export const adminGetArenaAbuseAudit = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const audit = await getArenaAbuseAudit(req.query.limit);
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, data: audit });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '아레나 어뷰징 감사 데이터를 불러오지 못했습니다.');
  }
};

export const adminRebuildArenaStats = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const payload = { limit: req.body?.limit ?? req.query.limit ?? 1000 };
    const job = await startArenaAdminJob('stats_rebuild', payload);
    res.set('Cache-Control', 'private, no-store');
    return res.status(202).json({ ok: true, data: job });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '아레나 관리자 통계 스냅샷 재생성 작업을 등록하지 못했습니다.');
  }
};
export const adminRebuildArenaRankings = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const payload = { limit: req.body?.limit ?? req.query.limit ?? 1000 };
    const job = await startArenaAdminJob('rankings_rebuild', payload);
    res.set('Cache-Control', 'private, no-store');
    return res.status(202).json({ ok: true, data: job });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '아레나 랭킹 스냅샷 재생성 작업을 등록하지 못했습니다.');
  }
};

export const adminPruneArenaReplays = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const payload = {
      retention_days: req.body?.retention_days ?? req.query.retention_days,
      limit: req.body?.limit ?? req.query.limit
    };
    const job = await startArenaAdminJob('replay_prune', payload);
    res.set('Cache-Control', 'private, no-store');
    return res.status(202).json({ ok: true, data: job });
  } catch (err: any) {
    return handleArenaMatchError(res, err, '아레나 리플레이 로그 정리 작업을 등록하지 못했습니다.');
  }
};

export const getMyArenaStreamerCard = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const owner = await requireArenaStreamerOwner(req, res);
    if (!owner) return;

    const state = await getArenaStreamerCardState(owner.streamer.channel_id);
    const card = generateArenaCardFromStreamer(owner.streamer, {
      arenaEnabled: state.is_enabled,
      maskDisabled: false,
      config: state.config
    });

    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({
      ok: true,
      data: {
        channel_id: owner.streamer.channel_id,
        is_enabled: state.is_enabled,
        config_status: state.config_status,
        state,
        card,
        config_options: getArenaCardConfigOptions()
      }
    });
  } catch (err) {
    console.error('[ArenaController] getMyArenaStreamerCard 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '내 아레나 카드 정보를 불러오지 못했습니다.' });
  }
};

export const updateMyArenaStreamerCard = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const owner = await requireArenaStreamerOwner(req, res);
    if (!owner) return;

    const body = req.body || {};
    const isEnabled = typeof body.is_enabled === 'boolean' ? body.is_enabled : undefined;
    const incomingConfig = {
      class_id: body.class_id,
      stat_focus: body.stat_focus ?? body.stat_profile_id,
      combat_style: body.combat_style,
      skill_ids: body.skill_ids,
      active_skill_id: body.active_skill_id,
      passive_skill_ids: body.passive_skill_ids,
      tag_ids: body.tag_ids ?? body.tags,
      flavor_text: body.flavor_text
    };
    const hasConfigFields = [
      'class_id',
      'stat_focus',
      'stat_profile_id',
      'combat_style',
      'skill_ids',
      'active_skill_id',
      'passive_skill_ids',
      'tag_ids',
      'tags',
      'flavor_text'
    ].some((key) => Object.prototype.hasOwnProperty.call(body, key));
    const config = normalizeArenaCardConfig(incomingConfig);

    if (isEnabled === undefined && !hasConfigFields && body.reset_config !== true) {
      return res.status(400).json({
        error: 'BadRequest',
        message: '수정할 아레나 카드 설정값이 없습니다.'
      });
    }

    const state = body.reset_config === true || hasConfigFields
      ? await setArenaStreamerCardConfig(owner.streamer.channel_id, owner.user.id, body.reset_config === true ? null : config, isEnabled, body.reason)
      : await setArenaStreamerCardEnabled(owner.streamer.channel_id, owner.user.id, Boolean(isEnabled), body.reason);
    const card = generateArenaCardFromStreamer(owner.streamer, {
      arenaEnabled: state.is_enabled,
      maskDisabled: false,
      config: state.config
    });
    
    clearArenaCardCaches();
    clearArenaMatchCaches();

    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({
      ok: true,
      data: {
        channel_id: owner.streamer.channel_id,
        is_enabled: state.is_enabled,
        config_status: state.config_status,
        state,
        card,
        config_options: getArenaCardConfigOptions()
      }
    });
  } catch (err) {
    console.error('[ArenaController] updateMyArenaStreamerCard 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '내 아레나 카드 설정 저장에 실패했습니다.' });
  }
};

export const disableMyArenaStreamerCard = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const owner = await requireArenaStreamerOwner(req, res);
    if (!owner) return;

    const state = await setArenaStreamerCardEnabled(owner.streamer.channel_id, owner.user.id, false, req.body?.reason || 'streamer_self_disable');
    
    clearArenaCardCaches();
    clearArenaMatchCaches();
    return res.status(200).json({
      ok: true,
      data: {
        is_enabled: false,
        effective_at: state.disabled_at || state.updated_at,
        state
      }
    });
  } catch (err) {
    console.error('[ArenaController] disableMyArenaStreamerCard 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '아레나 카드 비활성화에 실패했습니다.' });
  }
};

export const enableMyArenaStreamerCard = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const owner = await requireArenaStreamerOwner(req, res);
    if (!owner) return;

    const state = await setArenaStreamerCardEnabled(owner.streamer.channel_id, owner.user.id, true, req.body?.reason || 'streamer_self_enable');

    clearArenaCardCaches();
    clearArenaMatchCaches();
    return res.status(200).json({
      ok: true,
      data: {
        is_enabled: true,
        effective_policy: 'next_card_pool_refresh',
        state
      }
    });
  } catch (err) {
    console.error('[ArenaController] enableMyArenaStreamerCard 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '아레나 카드 재활성화에 실패했습니다.' });
  }
};















