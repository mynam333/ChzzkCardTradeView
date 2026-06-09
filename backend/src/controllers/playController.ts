import { Request, Response } from 'express';
import {
  userRepository,
  streamerRepository,
  userCardRepository,
  systemConfigRepository,
  marketRepository,
  titleRepository
} from '../repositories';
import { IS_PRODUCTION } from '../config';
import { fuzzyScore } from '../utils/search';
import { computeValueDrawWeights } from '../utils/gachaWeights';
import { fetchChzzkChannelProfile, getValidUserAccessToken, fetchChzzkUserProfile } from '../services/chzzkService';
import { getUserReservations } from './tradeController';
import { clearSessionCookie } from '../services/sessionCookie';

const DRAW_LOCKS = new Set<string>();
const userCardsInFlight = new Map<string, Promise<any[]>>();

// getUserMe는 /play/me 호출마다 치지직 외부 API로 프로필을 동기화해 왔습니다(외부 HTTP + DB write).
// 닉네임/프로필 이미지는 실시간성이 낮으므로 유저당 일정 주기에 1회만 동기화해 외부 호출을 절감합니다.
const PROFILE_SYNC_THROTTLE_MS = Math.max(60_000, Number(process.env.PROFILE_SYNC_THROTTLE_MS || 10 * 60_000));
const PROFILE_SYNC_CACHE_RETENTION_MS = Math.max(PROFILE_SYNC_THROTTLE_MS, Number(process.env.PROFILE_SYNC_CACHE_RETENTION_MS || 24 * 60 * 60_000));
const profileSyncAt = new Map<string, number>();
const DRAW_POOL_CACHE_TTL = Math.max(5_000, Number(process.env.DRAW_POOL_CACHE_TTL_MS || 60_000));
let drawPoolCache: { data: any[]; expiresAt: number } | null = null;
let drawPoolInFlight: Promise<any[]> | null = null;

const isDbStatementTimeout = (err: any): boolean => {
  return err?.code === '57014' || /statement timeout/i.test(String(err?.message || ''));
};

const findUserCardsCoalesced = (userId: string): Promise<any[]> => {
  const existing = userCardsInFlight.get(userId);
  if (existing) return existing;

  const request = userCardRepository.findByUserId(userId).finally(() => {
    if (userCardsInFlight.get(userId) === request) {
      userCardsInFlight.delete(userId);
    }
  });
  userCardsInFlight.set(userId, request);
  return request;
};

const clearUserCardsInFlight = (userId: string) => {
  userCardsInFlight.delete(userId);
};

const loadDrawPool = async (): Promise<any[]> => {
  const now = Date.now();
  if (drawPoolCache && drawPoolCache.expiresAt > now) {
    return drawPoolCache.data;
  }
  if (drawPoolInFlight) return drawPoolInFlight;

  drawPoolInFlight = streamerRepository.findAll()
    .then((streamers) => {
      drawPoolCache = { data: streamers, expiresAt: Date.now() + DRAW_POOL_CACHE_TTL };
      return streamers;
    })
    .finally(() => {
      drawPoolInFlight = null;
    });

  return drawPoolInFlight;
};

const clearDrawPoolCache = () => {
  drawPoolCache = null;
};

const pruneProfileSyncCache = (now = Date.now()) => {
  if (profileSyncAt.size < 1000) return;
  for (const [userId, syncedAt] of profileSyncAt) {
    if (now - syncedAt > PROFILE_SYNC_CACHE_RETENTION_MS) {
      profileSyncAt.delete(userId);
    }
  }
};

export const getPlayControllerStats = () => ({
  drawLocks: DRAW_LOCKS.size,
  userCardsInFlight: userCardsInFlight.size,
  profileSyncCache: profileSyncAt.size,
  drawPoolCached: !!drawPoolCache && drawPoolCache.expiresAt > Date.now(),
  drawPoolInFlight: !!drawPoolInFlight
});

const withUserDrawLock = async <T>(userId: string, task: () => Promise<T>): Promise<T> => {
  if (DRAW_LOCKS.has(userId)) {
    throw new Error('DRAW_IN_PROGRESS');
  }
  DRAW_LOCKS.add(userId);
  try {
    return await task();
  } finally {
    DRAW_LOCKS.delete(userId);
  }
};

const computeFreeDrawSegment = (intervalHours: number): { segmentStartIso: string | null; nextFreeDrawAt: string | null } => {
  if (intervalHours <= 0) {
    return { segmentStartIso: null, nextFreeDrawAt: null };
  }

  const now = new Date();
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const kstDate = new Date(now.getTime() + KST_OFFSET_MS);
  const kstYear = kstDate.getUTCFullYear();
  const kstMonth = kstDate.getUTCMonth();
  const kstDay = kstDate.getUTCDate();
  const midnightKstUtcMs = Date.UTC(kstYear, kstMonth, kstDay, 0, 0, 0) - KST_OFFSET_MS;
  const diffMs = now.getTime() - midnightKstUtcMs;
  const intervalMs = intervalHours * 60 * 60 * 1000;
  const count = Math.floor(diffMs / intervalMs);

  return {
    segmentStartIso: new Date(midnightKstUtcMs + count * intervalMs).toISOString(),
    nextFreeDrawAt: new Date(midnightKstUtcMs + (count + 1) * intervalMs).toISOString()
  };
};

const isInactiveForThreeMonths = (lastLiveAt?: string | null): boolean => {
  if (!lastLiveAt) return false;
  const lastLiveMs = new Date(lastLiveAt).getTime();
  if (Number.isNaN(lastLiveMs)) return false;
  return lastLiveMs <= Date.now() - 90 * 24 * 60 * 60 * 1000;
};

const getDrawSettings = async () => {
  const drawCostStr = await systemConfigRepository.get('draw_cost', '10000');
  const drawCost = Math.max(0, parseInt(drawCostStr, 10) || 10000);
  const intervalStr = await systemConfigRepository.get('free_draw_interval', '24');
  const intervalHours = parseFloat(intervalStr);
  const maxStackStr = await systemConfigRepository.get('free_draw_max_stack', '1');
  const freeDrawMaxStack = Math.max(1, parseInt(maxStackStr, 10) || 1);
  const { segmentStartIso } = computeFreeDrawSegment(intervalHours);
  return { drawCost, intervalHours, freeDrawMaxStack, segmentStartIso };
};

const pickWeightedStreamer = (streamers: any[], weights: number[], totalWeight: number) => {
  let randomNum = Math.random() * totalWeight;
  let luckyStreamer = streamers[0];
  for (let i = 0; i < streamers.length; i++) {
    randomNum -= weights[i];
    if (randomNum <= 0) {
      luckyStreamer = streamers[i];
      break;
    }
  }
  return luckyStreamer;
};

const toDrawCardPayload = (draw: any, streamer: any) => ({
  id: draw.card?.id,
  channel_id: streamer.channel_id,
  serial_number: draw.card?.serial_number,
  acquired_at: new Date().toISOString(),
  streamer
});

// 유저당 throttle 주기 내 1회만 치지직 프로필을 동기화합니다(외부 HTTP + DB write 절감).
// user 객체를 제자리에서 갱신하므로 호출 측 응답에 최신 닉네임/이미지가 반영됩니다.
const maybeSyncChzzkProfile = async (userId: string, user: any): Promise<void> => {
  pruneProfileSyncCache();
  const last = profileSyncAt.get(userId) || 0;
  if (Date.now() - last < PROFILE_SYNC_THROTTLE_MS) return;
  // 동시 요청이 중복 동기화하지 않도록 시도 전에 낙관적으로 기록
  profileSyncAt.set(userId, Date.now());
  try {
    const accessToken = await getValidUserAccessToken(userId);
    if (!accessToken) return;
    const profile = await fetchChzzkUserProfile(userId, accessToken);
    if (!profile) return;
    const { nickname, profileImageUrl } = profile;
    if (user.username !== nickname || user.avatar_url !== profileImageUrl) {
      await userRepository.updateProfile(userId, nickname, profileImageUrl);
      user.username = nickname;
      user.avatar_url = profileImageUrl;
      console.log(`[PlayController] 유저 정보 업데이트 완료 (ID: ${userId}, 닉네임: ${nickname})`);
    }
  } catch (syncErr: any) {
    console.warn(`[PlayController] 유저 정보 로그인 동기화 실패 (기존 정보 사용):`, syncErr.message);
  }
};

/**
 * 1. 현재 사용자 최신 세션 정보 반환 (포인트 동기화)
 */
export const getUserMe = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  try {
    const user = await userRepository.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'NotFound', message: '사용자를 찾을 수 없습니다.' });
    }

    // 서로 독립적인 작업(치지직 프로필 동기화 / 설정값 조회 / 보유 타이틀 조회)을 병렬 실행합니다.
    // 치지직 동기화는 throttle되어 대부분의 호출에서는 즉시 반환됩니다.
    const [, [intervalStr, maxStackStr, drawCostStr], ownedTitles] = await Promise.all([
      maybeSyncChzzkProfile(userId, user),
      Promise.all([
        systemConfigRepository.get('free_draw_interval', '24'),
        systemConfigRepository.get('free_draw_max_stack', '1'),
        systemConfigRepository.get('draw_cost', '10000')
      ]),
      titleRepository.findByUserId(userId)
    ]);

    const intervalHours = parseFloat(intervalStr);
    const freeDrawMaxStack = Math.max(1, parseInt(maxStackStr, 10) || 1);
    const drawCost = Math.max(0, parseInt(drawCostStr, 10) || 10000);

    const { segmentStartIso, nextFreeDrawAt } = computeFreeDrawSegment(intervalHours);
    const syncedUser = await userRepository.syncFreeDrawTickets(user.id, segmentStartIso, freeDrawMaxStack, intervalHours);
    const effectiveUser = syncedUser || user;
    const freeDrawTickets = Number(effectiveUser.free_draw_tickets || 0);
    const bonusFreeDrawTickets = Number(effectiveUser.bonus_free_draw_tickets || 0);
    const isFreeDrawEligible = segmentStartIso === null || freeDrawTickets + bonusFreeDrawTickets > 0;

    const titles = ownedTitles.filter((title) => title.is_equipped);

    return res.status(200).json({
      id: user.id,
      username: user.username,
      avatarUrl: user.avatar_url || `https://api.dicebear.com/10.x/fun-emoji/svg?seed=${user.id}`,
      role: user.role,
      statusMessage: user.status_message || null,
      titles,
      ownedTitles,
      point: user.point,
      lastFreeDraw: effectiveUser.last_free_draw,
      freeDrawTickets,
      bonusFreeDrawTickets,
      freeDrawMaxStack,
      representativeCardChannelId: user.representative_card_channel_id || null,
      representativeCardStar: user.representative_card_star ?? null,
      drawCost,
      freeDrawInterval: intervalHours,
      isFreeDrawEligible,
      nextFreeDrawAt
    });
  } catch (err: any) {
    console.error('[PlayController] getUserMe 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '서버 내부 오류가 발생했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

export const deleteMyAccount = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  const user = await userRepository.findById(userId);
  if (!user) {
    clearSessionCookie(res);
    return res.status(404).json({ error: 'NotFound', message: '이미 삭제되었거나 존재하지 않는 계정입니다.' });
  }

  const { confirmationText, userIdConfirm, irreversible } = req.body || {};
  if (confirmationText !== '회원 탈퇴' || userIdConfirm !== user.id || irreversible !== true) {
    return res.status(400).json({
      error: 'BadRequest',
      message: '탈퇴 확인 문구, 계정 ID, 복구 불가 동의를 모두 정확히 입력해야 합니다.'
    });
  }

  try {
    await userRepository.deleteAccount(user.id);
    clearSessionCookie(res);
    return res.status(200).json({ message: '회원 탈퇴가 완료되었습니다. 계정 데이터가 삭제되었습니다.' });
  } catch (err: any) {
    console.error('[PlayController] deleteMyAccount 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '회원 탈퇴 처리 중 오류가 발생했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 닉네임으로 유저 검색 (거래 상대 선택용)
 */
export const searchUsers = async (req: Request, res: Response) => {
  const keyword = String(req.query.keyword || '').trim();
  const selfId = (req as any).user?.id;
  if (keyword.length < 1) {
    return res.status(400).json({ error: 'BadRequest', message: '검색어가 필요합니다.' });
  }
  try {
    const users = await userRepository.searchByUsername(keyword, 12);
    const mapped = users
      .filter((u) => u.id !== selfId) // 자기 자신 제외
      .map((u) => ({
        id: u.id,
        username: u.username,
        avatar_url: u.avatar_url || `https://api.dicebear.com/10.x/fun-emoji/svg?seed=${u.id}`
      }));
    return res.status(200).json(mapped);
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '유저 검색 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 특정 유저의 보유 카드 컬렉션(channel_id별 묶음) 조회 — 거래 시 상대 보유 카드 선택용
 */
export const getUserCollection = async (req: Request, res: Response) => {
  const { user_id } = req.params;
  if (!user_id) {
    return res.status(400).json({ error: 'BadRequest', message: '유저 ID가 필요합니다.' });
  }
  try {
    const cards = await userCardRepository.findByUserId(user_id);
    const requesterId = (req as any).user?.id;
    const visibleCards = requesterId === user_id ? cards : cards.filter((card: any) => !card.is_hidden);
    // 같은 스트리머라도 별(0~5성)별로 분리해 묶음
    const map: { [key: string]: any } = {};
    for (const c of visibleCards) {
      const star = c.star || 0;
      const key = `${c.channel_id}#${star}`;
      if (!map[key]) {
        map[key] = { channel_id: c.channel_id, star, count: 0, streamer: c.streamer };
      }
      map[key].count += 1;
    }
    // 채널명 → 별 오름차순 정렬
    const list = Object.values(map).sort((a: any, b: any) => {
      const an = a.streamer?.name || '', bn = b.streamer?.name || '';
      return an === bn ? a.star - b.star : an.localeCompare(bn);
    });
    return res.status(200).json(list);
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '컬렉션 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 차단 목록 조회
 */
export const getMyBlocks = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  try {
    const users = await userRepository.getBlockedUsers(userId);
    return res.status(200).json(users.map((u) => ({
      id: u.id,
      username: u.username,
      avatar_url: u.avatar_url || `https://api.dicebear.com/10.x/fun-emoji/svg?seed=${u.id}`
    })));
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '차단 목록 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 유저 차단 (닉네임으로 검색하여 차단)
 * Body: { user_id?: string, username?: string }
 */
export const blockUser = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  const { user_id, username } = req.body;
  if (!user_id && !(username && String(username).trim())) {
    return res.status(400).json({ error: 'BadRequest', message: '차단할 사용자를 지정해 주세요.' });
  }
  try {
    const target = user_id
      ? await userRepository.findById(String(user_id))
      : await userRepository.findByUsername(String(username).trim());
    if (!target) {
      return res.status(404).json({ error: 'NotFound', message: '해당 사용자를 찾을 수 없습니다.' });
    }
    if (target.id === userId) {
      return res.status(400).json({ error: 'BadRequest', message: '자기 자신은 차단할 수 없습니다.' });
    }
    await userRepository.blockUser(userId, target.id);
    return res.status(200).json({
      message: `${target.username}님을 차단했습니다. 해당 사용자는 회원님에게 교환을 제안할 수 없습니다.`,
      blocked: { id: target.id, username: target.username }
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '차단 처리 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 유저 차단 해제
 */
export const unblockUser = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  const targetId = req.params.user_id;
  if (!targetId) return res.status(400).json({ error: 'BadRequest', message: '대상 사용자 ID가 필요합니다.' });
  try {
    await userRepository.unblockUser(userId, targetId);
    return res.status(200).json({ message: '차단을 해제했습니다.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '차단 해제 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 유저 공개 프로필 조회 — 프로필 모달(닉네임/포인트/대표 카드/보유 카드 요약/총자산)
 */
export const getUserProfile = async (req: Request, res: Response) => {
  const { user_id } = req.params;
  if (!user_id) {
    return res.status(400).json({ error: 'BadRequest', message: '유저 ID가 필요합니다.' });
  }
  try {
    const user = await userRepository.findById(user_id);
    if (!user) {
      return res.status(404).json({ error: 'NotFound', message: '사용자를 찾을 수 없습니다.' });
    }
    const allCards = await userCardRepository.findByUserId(user_id);
    const cards = allCards.filter((card: any) => !card.is_hidden);

    // 채널+별 등급별 묶음 + 총 자산 계산
    const map: { [key: string]: any } = {};
    let cardAsset = 0;
    for (const c of cards) {
      const star = c.star || 0;
      const key = `${c.channel_id}#${star}`;
      const baseValue = c.streamer?.base_value || 0;
      cardAsset += Math.round(baseValue * starValueMultiplier(star));
      if (!map[key]) {
        map[key] = {
          channel_id: c.channel_id,
          star,
          count: 0,
          streamer: c.streamer
        };
      }
      map[key].count += 1;
    }
    const collection = Object.values(map).sort(
      (a: any, b: any) =>
        (b.streamer?.base_value || 0) * starValueMultiplier(b.star)
        - (a.streamer?.base_value || 0) * starValueMultiplier(a.star)
    );

    // 대표 카드: 채널+별을 함께 식별. 레거시 데이터는 지정 채널 중 가장 높은 별을 사용.
    let repCard: any = null;
    const repChannel = user.representative_card_channel_id;
    const repStar = user.representative_card_star;
    const pool = repChannel
      ? cards.filter((c) =>
          c.channel_id === repChannel
          && (repStar == null || (c.star || 0) === repStar)
        )
      : cards;
    const candidates = (pool.length ? pool : cards).slice();
    candidates.sort((a, b) => {
      const sa = a.star || 0, sb = b.star || 0;
      if (sb !== sa) return sb - sa;
      return (b.streamer?.base_value || 0) - (a.streamer?.base_value || 0);
    });
    if (candidates.length) {
      const c = candidates[0];
      repCard = {
        channel_id: c.channel_id,
        star: c.star || 0,
        serial_number: c.streamer?.serial_number ?? null,
        streamer: c.streamer,
        border: c.border || null,
        name_effect: c.name_effect || null
      };
    }

    const titles = (await titleRepository.findByUserId(user_id)).filter((title) => title.is_equipped);

    return res.status(200).json({
      id: user.id,
      username: user.username,
      role: user.role,
      status_message: user.status_message || null,
      titles,
      avatar_url: user.avatar_url || `https://api.dicebear.com/10.x/fun-emoji/svg?seed=${user.id}`,
      point: user.point,
      card_count: cards.length,
      unique_count: collection.length,
      total_asset: user.point + cardAsset,
      representative_card: repCard,
      collection
    });
  } catch (err: any) {
    console.error('[PlayController] getUserProfile 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '프로필 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

// 랭킹은 모든 유저×보유카드를 매번 집계·정렬하는 무거운 쿼리이고, 동시 접속도 많습니다.
// 프론트는 주로 SSE(ranking 이벤트)로 갱신하고 폴링은 긴 fallback만 돌리지만, 시세는 2분 주기로
// 갱신되므로 실시간일 필요가 없습니다. 동일 파라미터 응답을 짧게 캐싱해 집계 RPC 반복 실행을 막습니다.
const RANKINGS_CACHE_TTL = 60_000; // 60초
const rankingsCache = new Map<string, { data: any[]; expiresAt: number }>();
const streamerRankingsCache = new Map<string, { data: any[]; expiresAt: number }>();

export const clearUserRankingCaches = () => {
  rankingsCache.clear();
  rankingPoolCache.clear();
};

export const clearRankingCaches = () => {
  clearUserRankingCaches();
  streamerRankingsCache.clear();
  clearDrawPoolCache();
};

// 무키워드(전체) 랭킹 풀 캐시. 기본 랭킹 로드와 검색 시 유사도 보강용 풀이 공유합니다.
// (검색은 키워드별 결과 + 동일한 전체 풀이 필요하므로, 풀을 캐싱하면 무거운 집계가 반복되지 않음)
const rankingPoolCache = new Map<string, { data: any[]; expiresAt: number }>();
const loadRankingPool = async (
  mode: 'total' | 'cards',
  channelId: string,
  star: number | null
) => {
  const key = `${mode}|${channelId}|${star ?? ''}`;
  const now = Date.now();
  const hit = rankingPoolCache.get(key);
  if (hit && hit.expiresAt > now) return hit.data;
  const data = await userRepository.findRankings(100, '', { mode, channelId, star });
  rankingPoolCache.set(key, { data, expiresAt: now + RANKINGS_CACHE_TTL });
  if (rankingPoolCache.size > 100) {
    for (const [k, v] of rankingPoolCache) if (v.expiresAt <= now) rankingPoolCache.delete(k);
  }
  return data;
};

/**
 * 2. 자산 랭킹 상위 유저 목록 조회
 */
export const getUserRankings = async (req: Request, res: Response) => {
  try {
    const keyword = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const mode = req.query.mode === 'cards' ? 'cards' : 'total';
    const channelId = typeof req.query.channel_id === 'string' ? req.query.channel_id.trim() : '';
    const starRaw = typeof req.query.star === 'string' && req.query.star !== '' ? Number(req.query.star) : null;
    const star = starRaw == null || Number.isNaN(starRaw) ? null : Math.max(0, Math.min(5, Math.floor(starRaw)));

    const cacheKey = `${mode}|${channelId}|${star ?? ''}|${keyword}`;
    const now = Date.now();
    const cached = rankingsCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      res.set('Cache-Control', 'public, max-age=60');
      return res.status(200).json(cached.data);
    }
    // 검색어가 있으면 초성/띄어쓰기 무시 유사도 검색까지 지원합니다.
    // - 부분일치 결과: 리포지토리 keyword 필터로 순위 무관하게 정확히 포착(기존 동작 유지)
    // - 초성/띄어쓰기 유사 매칭: 상위 랭킹 풀을 따로 받아 유사도로 보강(랭킹 노출 범위 내)
    let rankings;
    if (keyword) {
      const [matched, topPool] = await Promise.all([
        userRepository.findRankings(100, keyword, { mode, channelId, star }),
        loadRankingPool(mode, channelId, star)
      ]);
      const byId = new Map<string, typeof matched[number]>();
      for (const u of matched) byId.set(u.id, u);
      for (const u of topPool) {
        if (!byId.has(u.id) && fuzzyScore(u.username || '', keyword) !== null) byId.set(u.id, u);
      }
      rankings = Array.from(byId.values())
        .map((u) => ({ u, score: fuzzyScore(u.username || '', keyword) ?? Number.MAX_SAFE_INTEGER }))
        .sort((a, b) => a.score - b.score || (a.u.rank ?? 0) - (b.u.rank ?? 0))
        .slice(0, 100)
        .map((x) => x.u);
    } else {
      rankings = await loadRankingPool(mode, channelId, star);
    }
    const userIds = rankings.map((user) => user.id);
    const [titlesByUser, linkedStreamers] = await Promise.all([
      titleRepository.findByUserIds(userIds),
      streamerRepository.findByIds(userIds)
    ]);
    const streamerByChannelId = new Map(linkedStreamers.map((streamer) => [streamer.channel_id, streamer]));
    // 프론트엔드가 요구하는 구조로 매핑 (실제 보유 카드 수 및 포인트+카드가치 총자산 포함, 랭크 순위 추가)
    const mapped = rankings.map((u) => {
      const linkedStreamer = streamerByChannelId.get(u.id);
      return {
        id: u.id,
        username: u.username,
        avatar_url: u.avatar_url || `https://api.dicebear.com/10.x/fun-emoji/svg?seed=${u.id}`,
        point: u.point,
        card_count: u.card_count,
        cards_value: u.cards_value,
        total_asset: u.total_asset,
        rank: u.rank,
        status_message: u.status_message || null,
        titles: (titlesByUser[u.id] || []).filter((title) => title.is_equipped),
        is_streamer: !!linkedStreamer,
        is_live: linkedStreamer?.is_active === true
      };
    });

    rankingsCache.set(cacheKey, { data: mapped, expiresAt: now + RANKINGS_CACHE_TTL });
    // 메모리 보호: 캐시가 커지면 만료된 항목을 정리합니다(검색어 키 누적 방지).
    if (rankingsCache.size > 200) {
      for (const [key, value] of rankingsCache) {
        if (value.expiresAt <= now) rankingsCache.delete(key);
      }
    }
    res.set('Cache-Control', 'public, max-age=60');
    return res.status(200).json(mapped);
  } catch (err: any) {
    console.error('[PlayController] getUserRankings 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '서버 내부 오류가 발생했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

export const getStreamerRankings = async (req: Request, res: Response) => {
  try {
    const mode = req.query.mode === 'change' ? 'change' : 'value';
    const keyword = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const limit = Math.max(1, Math.min(1000, Math.floor(Number(req.query.limit || 100))));
    const cacheKey = `${mode}|${keyword}|${limit}`;
    const now = Date.now();
    const cached = streamerRankingsCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      res.set('Cache-Control', 'public, max-age=60');
      return res.status(200).json(cached.data);
    }

    const streamers = await streamerRepository.findRankingBase();
    const [value24hMap, value1hMap] = await Promise.all([
      mode === 'value' ? streamerRepository.getValue24hAgoMap() : Promise.resolve({} as Record<string, number>),
      mode === 'change' ? streamerRepository.getValue1hAgoMap() : Promise.resolve({} as Record<string, number>)
    ]);

    const scoreChange = (streamer: any) => {
      const current = Number(streamer.base_value || 0);
      const previous = Number(value1hMap[streamer.channel_id] ?? current);
      return previous > 0 ? ((current - previous) / previous) * 100 : 0;
    };

    let ranked = streamers
      .slice()
      .sort((a: any, b: any) => {
        if (mode === 'change') {
          return scoreChange(b) - scoreChange(a) || Number(b.base_value || 0) - Number(a.base_value || 0);
        }
        return Number(b.base_value || 0) - Number(a.base_value || 0);
      })
      .map((streamer: any, index: number) => ({ streamer, rank: index + 1 }));

    if (keyword) {
      ranked = ranked
        .map((item) => ({ ...item, score: fuzzyScore(item.streamer.name || '', keyword) }))
        .filter((item) => item.score !== null)
        .sort((a, b) => (a.score ?? 0) - (b.score ?? 0) || a.rank - b.rank);
    }

    const sliced = ranked.slice(0, limit);
    const channelIds = sliced.map((item) => item.streamer.channel_id);
    const titlesByUser = await titleRepository.findByUserIds(channelIds).catch(() => ({} as Record<string, any[]>));

    const data = sliced.map(({ streamer, rank }) => ({
      channel_id: streamer.channel_id,
      name: streamer.name,
      logo_url: streamer.logo_url,
      custom_image_url: streamer.custom_image_url,
      follower_count: streamer.follower_count,
      base_value: streamer.base_value,
      is_active: streamer.is_active,
      rank,
      titles: (titlesByUser[streamer.channel_id] || []).filter((title) => title.is_equipped),
      prev_value: mode === 'value' ? (value24hMap[streamer.channel_id] ?? streamer.prev_value ?? streamer.base_value) : streamer.prev_value,
      value_1h_ago: mode === 'change' ? (value1hMap[streamer.channel_id] ?? streamer.base_value) : streamer.base_value
    }));

    streamerRankingsCache.set(cacheKey, { data, expiresAt: now + RANKINGS_CACHE_TTL });
    if (streamerRankingsCache.size > 100) {
      for (const [key, value] of streamerRankingsCache) {
        if (value.expiresAt <= now) streamerRankingsCache.delete(key);
      }
    }

    res.set('Cache-Control', 'public, max-age=60');
    return res.status(200).json(data);
  } catch (err: any) {
    console.error('[PlayController] getStreamerRankings 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '스트리머 랭킹을 가져오는 중 오류가 발생했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 3. 현재 사용자가 보유한 포토카드 인벤토리 목록 반환
 */
export const getUserCards = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  try {
    const cards = await findUserCardsCoalesced(userId);
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json(cards);
  } catch (err: any) {
    console.error('[PlayController] getUserCards 에러:', err);
    if (isDbStatementTimeout(err)) {
      res.set('Retry-After', '3');
      return res.status(503).json({
        error: 'DatabaseBusy',
        message: '카드 목록 조회가 지연되고 있습니다. 잠시 후 다시 시도해 주세요.',
        details: IS_PRODUCTION ? undefined : err.message
      });
    }
    return res.status(500).json({ error: 'InternalServerError', message: '서버 내부 오류가 발생했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

export const updateMyStatusMessage = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  const message = typeof req.body?.status_message === 'string' ? req.body.status_message : '';
  if (message.length > 80) {
    return res.status(400).json({ error: 'BadRequest', message: '상태 메시지는 80자 이하로 입력해 주세요.' });
  }
  try {
    await userRepository.updateStatusMessage(userId, message);
    return res.status(200).json({ message: '상태 메시지를 저장했습니다.', status_message: message.trim() || null });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '상태 메시지 저장 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

export const updateMyCardVisibility = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  const cardId = Number(req.params.card_id);
  if (!Number.isFinite(cardId)) return res.status(400).json({ error: 'BadRequest', message: '카드 ID가 올바르지 않습니다.' });
  try {
    clearUserCardsInFlight(userId);
    const ok = await userCardRepository.updateVisibility(userId, cardId, !!req.body?.hidden);
    if (!ok) return res.status(404).json({ error: 'NotFound', message: '보유 중인 카드를 찾을 수 없습니다.' });
    clearUserCardsInFlight(userId);
    return res.status(200).json({ message: req.body?.hidden ? '카드를 외부 공개에서 숨겼습니다.' : '카드 공개 숨김을 해제했습니다.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '카드 숨김 설정 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

export const updateMyCardFavorite = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  const cardId = Number(req.params.card_id);
  if (!Number.isFinite(cardId)) return res.status(400).json({ error: 'BadRequest', message: '카드 ID가 올바르지 않습니다.' });
  try {
    clearUserCardsInFlight(userId);
    const ok = await userCardRepository.setFavorite(userId, cardId, !!req.body?.favorite);
    if (!ok) return res.status(404).json({ error: 'NotFound', message: '보유 중인 카드를 찾을 수 없습니다.' });
    clearUserCardsInFlight(userId);
    return res.status(200).json({ message: req.body?.favorite ? '즐겨찾기에 고정했습니다.' : '즐겨찾기 고정을 해제했습니다.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '즐겨찾기 설정 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 4. 카드 팩 1회 소환 (가챠 뽑기)
 */
export const drawCard = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  try {
    return await withUserDrawLock(userId, async () => {
    const { drawCost, intervalHours, freeDrawMaxStack, segmentStartIso } = await getDrawSettings();
    // A. 가챠 대상 스트리머 목록 추출 (재화 소모 전에 먼저 검증)
    const streamers = await loadDrawPool();
    if (streamers.length === 0) {
      return res.status(400).json({ error: 'BadRequest', message: '소환할 스트리머 정보가 없습니다. DB를 점검해 주세요.' });
    }

    const nowIso = new Date().toISOString();

    const targetExpectedStr = await systemConfigRepository.get('draw_target_value', '2500');
    const targetExpected = Math.max(100, parseInt(targetExpectedStr, 10) || 2500);
    const { weights } = computeValueDrawWeights(streamers.map(s => s.base_value || 100), targetExpected);
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const luckyStreamer = pickWeightedStreamer(streamers, weights, totalWeight);

    // D. 무료권/포인트 차감 + 시리얼 채번 + 카드 생성을 단일 트랜잭션/RPC로 처리
    const draw = await userCardRepository.drawAtomic(userId, luckyStreamer.channel_id, drawCost, nowIso, segmentStartIso, freeDrawMaxStack, intervalHours);
    if (!draw.ok) {
      if (draw.reason === 'USER_NOT_FOUND') {
        return res.status(404).json({ error: 'NotFound', message: '사용자를 찾을 수 없습니다.' });
      }
      if (draw.reason === 'INSUFFICIENT_POINT') {
        return res.status(400).json({ error: 'BadRequest', message: `포인트가 부족합니다. (1회 뽑기: ${drawCost.toLocaleString()} P)` });
      }
      return res.status(500).json({ error: 'InternalServerError', message: '카드 뽑기 처리에 실패했습니다.' });
    }
    clearUserCardsInFlight(userId);

    return res.status(200).json({
      message: draw.is_free
        ? `무료 소환으로 ${luckyStreamer.name} 카드를 획득하였습니다!`
        : `${luckyStreamer.name} 카드를 획득하였습니다!`,
      points_left: draw.points_left,
      is_free: draw.is_free,
      free_draw_source: draw.free_draw_source,
      free_draw_tickets_left: draw.free_draw_tickets_left ?? 0,
      bonus_free_draw_tickets_left: draw.bonus_free_draw_tickets_left ?? 0,
      card: toDrawCardPayload(draw, luckyStreamer)
    });
    });
  } catch (err: any) {
    if (err.message === 'DRAW_IN_PROGRESS') {
      return res.status(429).json({ error: 'DrawInProgress', message: '이미 카드 소환이 진행 중입니다. 잠시 후 다시 시도해 주세요.' });
    }
    console.error('[PlayController] drawCard 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '서버 내부 오류가 발생했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

export const drawCards = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  const count = Math.max(1, Math.min(10, Math.floor(Number(req.body?.count || 10))));
  if (count !== 10) {
    return res.status(400).json({ error: 'BadRequest', message: '10연차는 정확히 10회 소환만 지원합니다.' });
  }

  try {
    return await withUserDrawLock(userId, async () => {
      const { drawCost, intervalHours, freeDrawMaxStack, segmentStartIso } = await getDrawSettings();
      const streamers = await loadDrawPool();
      if (streamers.length === 0) {
        return res.status(400).json({ error: 'BadRequest', message: '소환할 스트리머 정보가 없습니다. DB를 점검해 주세요.' });
      }

      const { segmentStartIso: latestSegmentStartIso } = computeFreeDrawSegment(intervalHours);
      const syncedUser = await userRepository.syncFreeDrawTickets(userId, latestSegmentStartIso, freeDrawMaxStack, intervalHours);
      const user = syncedUser || await userRepository.findById(userId);
      if (!user) {
        return res.status(404).json({ error: 'NotFound', message: '사용자를 찾을 수 없습니다.' });
      }

      const availableTickets = segmentStartIso === null
        ? count
        : Number(user.free_draw_tickets || 0) + Number(user.bonus_free_draw_tickets || 0);
      const paidDraws = segmentStartIso === null ? 0 : Math.max(0, count - availableTickets);
      const requiredPoint = paidDraws * drawCost;
      if (Number(user.point || 0) < requiredPoint) {
        return res.status(400).json({
          error: 'BadRequest',
          message: `10연차에 필요한 재화가 부족합니다. (필요 포인트: ${requiredPoint.toLocaleString()} P 또는 무료 티켓 10장)`
        });
      }

      const targetExpectedStr = await systemConfigRepository.get('draw_target_value', '2500');
      const targetExpected = Math.max(100, parseInt(targetExpectedStr, 10) || 2500);
      const { weights } = computeValueDrawWeights(streamers.map(s => s.base_value || 100), targetExpected);
      const totalWeight = weights.reduce((sum, w) => sum + w, 0);
      const cards: any[] = [];
      let pointsLeft = Number(user.point || 0);
      let freeTicketsLeft = Number(user.free_draw_tickets || 0);
      let bonusTicketsLeft = Number(user.bonus_free_draw_tickets || 0);
      let freeCount = 0;
      let paidCount = 0;

      for (let i = 0; i < count; i++) {
        const luckyStreamer = pickWeightedStreamer(streamers, weights, totalWeight);
        const draw = await userCardRepository.drawAtomic(userId, luckyStreamer.channel_id, drawCost, new Date().toISOString(), segmentStartIso, freeDrawMaxStack, intervalHours);
        if (!draw.ok) {
          throw new Error(draw.reason || 'DRAW_FAILED');
        }
        if (draw.is_free) freeCount += 1;
        else paidCount += 1;
        pointsLeft = draw.points_left ?? pointsLeft;
        freeTicketsLeft = draw.free_draw_tickets_left ?? freeTicketsLeft;
        bonusTicketsLeft = draw.bonus_free_draw_tickets_left ?? bonusTicketsLeft;
        cards.push({
          ...toDrawCardPayload(draw, luckyStreamer),
          is_free: !!draw.is_free,
          free_draw_source: draw.free_draw_source
        });
      }
      clearUserCardsInFlight(userId);

      return res.status(200).json({
        message: `10연차 소환으로 카드 ${cards.length}장을 획득했습니다!`,
        count,
        free_count: freeCount,
        paid_count: paidCount,
        points_spent: paidCount * drawCost,
        points_left: pointsLeft,
        free_draw_tickets_left: freeTicketsLeft,
        bonus_free_draw_tickets_left: bonusTicketsLeft,
        cards
      });
    });
  } catch (err: any) {
    if (err.message === 'DRAW_IN_PROGRESS') {
      return res.status(429).json({ error: 'DrawInProgress', message: '이미 카드 소환이 진행 중입니다. 잠시 후 다시 시도해 주세요.' });
    }
    console.error('[PlayController] drawCards 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '10연차 소환 처리에 실패했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 5. 치지직 스트리머명 검색 API (비공식 치지직 검색 API 연동)
 */
export const searchChzzkStreamer = async (req: Request, res: Response) => {
  const { keyword } = req.query;
  if (!keyword) {
    return res.status(400).json({ error: 'BadRequest', message: '검색 키워드(keyword)가 필요합니다.' });
  }

  try {
    // 치지직 내부 비공식 검색 API 호출
    const response = await fetch(`https://api.chzzk.naver.com/service/v1/search/channels?keyword=${encodeURIComponent(keyword as string)}&size=8`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`치지직 채널 검색 실패: ${response.status}`);
    }

    const data = (await response.json()) as any;
    const channels = data.content?.data || [];

    // 필요한 프사, 이름, 채널 ID 형태만 추출하여 프론트에 전달
    const mapped = channels.map((item: any) => ({
      channelId: item.channel.channelId,
      channelName: item.channel.channelName,
      channelImageUrl: item.channel.channelImageUrl,
      followerCount: item.channel.followerCount || 0
    }));

    return res.status(200).json(mapped);
  } catch (err: any) {
    console.error('[PlayController] searchChzzkStreamer 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '서버 내부 오류가 발생했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 6. 사용자가 수동으로 새로운 스트리머를 카드로 등록
 *
 * 보안: 클라이언트가 보낸 팔로워 수/이름/이미지를 신뢰하지 않고, 서버에서 치지직 API로
 * 직접 재조회한 권위 있는 값으로 검증 및 시세를 산정합니다.
 */
export const registerStreamer = async (req: Request, res: Response) => {
  const { channelId } = req.body;

  if (!channelId) {
    return res.status(400).json({ error: 'BadRequest', message: '스트리머 채널 ID가 필요합니다.' });
  }

  try {
    // 중복 체크
    const exists = await streamerRepository.findById(channelId);
    if (exists) {
      return res.status(400).json({ error: 'Conflict', message: '이미 카드로 등록되어 있는 스트리머입니다.' });
    }

    const registrationBlocked = await streamerRepository.isRegistrationBlocked(channelId);
    if (registrationBlocked) {
      return res.status(403).json({
        error: 'RegistrationBlocked',
        message: '본인 카드 삭제 요청에 따라 재등록이 제한된 스트리머입니다.'
      });
    }

    // 치지직 API로 권위 있는 프로필을 서버측에서 직접 조회 (실패 시 throw)
    let profile;
    try {
      profile = await fetchChzzkChannelProfile(channelId, true);
    } catch {
      return res.status(404).json({
        error: 'ChannelNotFound',
        message: '치지직에서 해당 채널 정보를 확인할 수 없습니다. 채널 ID를 다시 확인해 주세요.'
      });
    }

    const verifiedName = profile.name;
    const verifiedFollowerCount = profile.followerCount;
    const verifiedLogoUrl = profile.logoUrl;

    if (!profile.openLive && isInactiveForThreeMonths(profile.lastLiveAt)) {
      return res.status(400).json({
        error: 'InactiveStreamer',
        message: '마지막 방송일이 3개월 이상 지난 스트리머는 카드로 등록할 수 없습니다.'
      });
    }

    // README 명세 기준 팔로워 150명 이상의 스트리머만 등록 가능하도록 서버 검증값으로 차단 필터 적용
    if (verifiedFollowerCount < 150) {
      return res.status(400).json({
        error: 'InsufficientFollowers',
        message: '치지직 카드 등록 정책에 따라 팔로워 수가 150명 이상인 스트리머만 카드로 등록할 수 있습니다.'
      });
    }

    // 기본 시세 계산 (기본 가치는 팔로워 수와 1:1 매칭하되 하한 100, 상한 500,000 적용)
    const baseValue = Math.min(500000, Math.max(verifiedFollowerCount, 100));
    // 스트리머용 시리얼 넘버 할당 (1 ~ 9999 중 비어있는 가장 작은 번호 자동 매칭)
    const allocatedStreamerSns = await streamerRepository.findAllocatedStreamerSerialNumbers();
    const allocatedSet = new Set(allocatedStreamerSns);
    let serialNumber = 1;
    for (let i = 1; i <= 9999; i++) {
      if (!allocatedSet.has(i)) {
        serialNumber = i;
        break;
      }
    }

    const newStreamer = {
      channel_id: channelId,
      name: verifiedName,
      logo_url: verifiedLogoUrl || null,
      custom_image_url: null,
      is_image_banned: false,
      follower_count: verifiedFollowerCount,
      activity_score: 50, // 기본 활동점수
      base_value: baseValue,
      is_active: profile.openLive,
      last_broadcast_at: profile.openLive ? new Date().toISOString() : (profile.lastLiveAt || null),
      serial_number: serialNumber,
      registered_by: (req as any).user?.id || null // 등록한 유저 ID 기록 (Null 가능)
    };
    await streamerRepository.save(newStreamer);
    clearDrawPoolCache();
    streamerRankingsCache.clear();

    return res.status(200).json({
      message: `${verifiedName} 스트리머가 신규 카드 리스트로 성공적으로 등록되었습니다.`,
      streamer: newStreamer
    });
  } catch (err: any) {
    console.error('[PlayController] registerStreamer 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '서버 내부 오류가 발생했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 7. 카드 판매 및 일괄 판매 처리 API
 * POST /api/cards/sell
 * Body: { items: Array<{ channelId: string, star: number, count: number }> }
 */
export const sellCards = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  const { items } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'BadRequest', message: '판매할 카드 목록(items)이 필요합니다.' });
  }

  try {
    // A. 유저 정보 조회
    const user = await userRepository.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'NotFound', message: '사용자를 찾을 수 없습니다.' });
    }

    // B. 유저 보유 카드 데이터 조회
    const userCards = await userCardRepository.findByUserId(userId);

    const pendingMarketIds = new Set(await marketRepository.findPendingCardIdsByUser(userId));

    // channelId+star별 유저 보유 카드 매핑
    const userCardsByKey: { [key: string]: any[] } = {};
    userCards.forEach(uc => {
      const key = `${uc.channel_id}#${uc.star || 0}`;
      if (!userCardsByKey[key]) {
        userCardsByKey[key] = [];
      }
      userCardsByKey[key].push(uc);
    });

    // 진행 중인 거래에 묶인(에스크로) 카드는 판매 불가하도록 예약량 차감
    const reservations = await getUserReservations(userId);

    const sellActions: { channelId: string, star: number, count: number, baseValue: number }[] = [];

    // C. 판매 항목 수량 및 시세 검증
    for (const item of items) {
      const { channelId, count } = item;
      const star = Number(item.star);
      if (!channelId || !Number.isInteger(star) || star < 0 || star > 5 || !Number.isInteger(count) || count <= 0) {
        return res.status(400).json({ error: 'BadRequest', message: '올바른 channelId, 별 등급(0~5), 수량이 필요합니다.' });
      }

      const key = `${channelId}#${star}`;
      const owned = userCardsByKey[key] || [];
      // reservations.cardsByStar 는 교환 에스크로 + 오픈마켓 PENDING 매물을 모두 포함합니다.
      // 여기서 마켓 매물을 또 빼면 이중 차감이 되어 정상 판매가 막히므로 reservedTotal만 차감합니다.
      const reservedTotal = reservations.cardsByStar[key] || 0;
      const pendingMarket = owned.filter((card) => pendingMarketIds.has(card.id)).length;
      const escrowReserved = Math.max(0, reservedTotal - pendingMarket); // 안내 메시지용 교환 에스크로 추정치
      const sellable = owned.length - reservedTotal;
      if (sellable < count) {
        return res.status(400).json({
          error: 'InsufficientCards',
          message: `${star}성 카드의 판매 가능 수량이 부족합니다. (보유 ${owned.length}장, 교환 중 ${escrowReserved}장, 마켓 판매 중 ${pendingMarket}장, 판매 요청 ${count}장)`
        });
      }

      // 시세 가치 조회
      const streamer = owned[0]?.streamer;
      if (!streamer) {
        return res.status(404).json({ error: 'NotFound', message: `스트리머 정보를 찾을 수 없습니다. (채널 ID: ${channelId})` });
      }

      const baseValue = streamer.base_value || 0;
      sellActions.push({ channelId, star, count, baseValue });
    }

    // D. 판매 처리: 카드 삭제와 포인트 가산을 단일 트랜잭션/RPC로 처리
    clearUserCardsInFlight(userId);
    const actualGainedPoints = await userCardRepository.sellCardsAtomic(userId, sellActions);
    const refreshed = await userRepository.findById(userId);
    const nextPoint = refreshed ? refreshed.point : user.point + actualGainedPoints;
    clearUserCardsInFlight(userId);

    return res.status(200).json({
      message: `성공적으로 카드 판매가 완료되었습니다. 총 ${actualGainedPoints.toLocaleString()} 포인트를 획득하였습니다!`,
      points_gained: actualGainedPoints,
      new_points: nextPoint
    });
  } catch (err: any) {
    // 검증 통과 후에도 보유 현황이 변경(경합/오래된 화면)되어 RPC가 CARD_SHORTAGE를 던질 수 있습니다.
    // 이 경우 500 대신 명확한 409로 안내합니다.
    if (err?.message === 'CARD_SHORTAGE') {
      return res.status(409).json({
        error: 'InsufficientCards',
        message: '판매하려는 카드의 수량이 부족합니다. 보유 현황이 변경되었을 수 있으니 새로고침 후 다시 시도해 주세요.'
      });
    }
    console.error('[PlayController] sellCards 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '서버 내부 오류가 발생했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/** 별 등급에 따른 가치 배율 (0성=1배 ~ 5성=4배) */
export const starValueMultiplier = (star: number): number => 1 + (star || 0) * 0.8;

/**
 * 카드 한계돌파: 대상 카드 별 상승 + 같은 스트리머의 0성 카드 1장 소모
 * POST /api/cards/fuse  Body: { channel_id, star }
 */
export const fuseCards = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });

  const { channel_id, star } = req.body;
  const starNum = Number(star) || 0;
  if (!channel_id) return res.status(400).json({ error: 'BadRequest', message: '합성할 카드(channel_id)가 필요합니다.' });
  if (starNum < 0 || starNum >= 5) return res.status(400).json({ error: 'BadRequest', message: '0~4성 카드만 합성할 수 있습니다.' });

  try {
    // 진행 중 거래에 예약된 카드는 합성 재료로 사용할 수 없도록 차단
    const cards = await userCardRepository.findByUserId(userId);
    const reservations = await getUserReservations(userId);
    const pendingMarketIds = new Set(await marketRepository.findPendingCardIdsByUser(userId));
    const key = (st: number) => `${channel_id}#${st}`;
    const available = (st: number) =>
      cards.filter((c) =>
        c.channel_id === channel_id
        && (c.star || 0) === st
        && c.id != null
        && !pendingMarketIds.has(c.id)
      ).length
      - (reservations.cardsByStar[key(st)] || 0);
    const targetAvailable = available(starNum);
    const fodderAvailable = available(0) - (starNum === 0 ? 1 : 0);
    if (targetAvailable < 1 || fodderAvailable < 1) {
      return res.status(400).json({
        error: 'FuseFailed',
        reason: 'RESERVED_OR_SHORT',
        message: '한계돌파에 사용할 수 있는 카드가 부족합니다. 진행 중인 교환에 묶인 카드는 사용할 수 없습니다.'
      });
    }

    const result = await userCardRepository.fuse(userId, channel_id, starNum);
    if (!result.ok) {
      let msg = '한계돌파에 실패했습니다.';
      if (result.reason === 'MAX_STAR') msg = '이미 최고 등급(5성)입니다.';
      else if (result.reason === 'NO_TARGET') msg = `${starNum}성 카드를 보유하고 있지 않습니다.`;
      else if (result.reason === 'NO_FODDER') {
        msg = starNum === 0
          ? '한계돌파에는 같은 스트리머의 0성 카드가 2장(대상 1장 + 재료 1장) 필요합니다.'
          : '한계돌파에는 재료로 쓸 같은 스트리머의 0성 카드가 1장 더 필요합니다.';
      }
      return res.status(400).json({ error: 'FuseFailed', reason: result.reason, message: msg });
    }
    clearUserCardsInFlight(userId);
    return res.status(200).json({ message: `한계돌파 성공! ${result.newStar}성 카드가 되었습니다. ⭐`, new_star: result.newStar });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '합성 처리 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 8. 특정 스트리머 상세 정보 + 시세 변화 그래프 데이터 조회 (공개)
 * GET /api/streamers/:channel_id?range=24h|7d
 */
type StreamerValueHistoryPoint = { value: number; recorded_at: string };

const MAX_STREAMER_DETAIL_HISTORY_POINTS = 1200;

const downsampleValueHistory = (
  points: StreamerValueHistoryPoint[],
  maxPoints = MAX_STREAMER_DETAIL_HISTORY_POINTS
): StreamerValueHistoryPoint[] => {
  if (points.length <= maxPoints) return points;
  if (maxPoints < 4) return [points[0], points[points.length - 1]];

  const first = points[0];
  const last = points[points.length - 1];
  const bucketCount = Math.max(1, Math.floor((maxPoints - 2) / 2));
  const bucketSize = (points.length - 2) / bucketCount;
  const sampled: StreamerValueHistoryPoint[] = [first];

  for (let i = 0; i < bucketCount; i += 1) {
    const start = 1 + Math.floor(i * bucketSize);
    const end = Math.min(points.length - 1, 1 + Math.floor((i + 1) * bucketSize));
    if (start >= end) continue;

    let minIndex = start;
    let maxIndex = start;
    for (let j = start + 1; j < end; j += 1) {
      if (points[j].value < points[minIndex].value) minIndex = j;
      if (points[j].value > points[maxIndex].value) maxIndex = j;
    }

    if (minIndex === maxIndex) {
      sampled.push(points[minIndex]);
    } else if (minIndex < maxIndex) {
      sampled.push(points[minIndex], points[maxIndex]);
    } else {
      sampled.push(points[maxIndex], points[minIndex]);
    }
  }

  sampled.push(last);
  return sampled.filter((point, index, arr) => index === 0 || point.recorded_at !== arr[index - 1].recorded_at);
};

export const getStreamerDetail = async (req: Request, res: Response) => {
  const { channel_id } = req.params;
  const range = (req.query.range as string) || '7d';

  if (!channel_id) {
    return res.status(400).json({ error: 'BadRequest', message: '스트리머 채널 ID가 필요합니다.' });
  }

  try {
    const streamer = await streamerRepository.findById(channel_id);
    if (!streamer) {
      return res.status(404).json({ error: 'NotFound', message: '스트리머 정보를 찾을 수 없습니다.' });
    }

    const hours = range === '24h' ? 24 : 24 * 7;
    const rangeEndAt = new Date();
    const rangeStartAt = new Date(rangeEndAt.getTime() - hours * 60 * 60 * 1000);
    const sinceIso = rangeStartAt.toISOString();
    const history = (await streamerRepository.getValueHistory(channel_id, sinceIso))
      .slice()
      .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());

    // 차트가 "현재 - 선택 구간" 전체를 항상 표현하도록 양끝 기준점을 보강합니다.
    // 실제 기록이 중간부터 있거나 마지막 기록이 현재보다 이전이어도 선이 중간에서 끊겨 보이지 않습니다.
    const boundedHistory = history.slice();
    const startValue = boundedHistory[0]?.value ?? streamer.base_value;
    const endValue = streamer.base_value;
    if (boundedHistory.length === 0 || new Date(boundedHistory[0].recorded_at).getTime() > rangeStartAt.getTime()) {
      boundedHistory.unshift({ value: startValue, recorded_at: rangeStartAt.toISOString() });
    }
    if (boundedHistory.length === 1 || new Date(boundedHistory[boundedHistory.length - 1].recorded_at).getTime() < rangeEndAt.getTime()) {
      boundedHistory.push({ value: endValue, recorded_at: rangeEndAt.toISOString() });
    }

    // 24h 등락률 계산용 24h 전 시세
    const value24hMap = await streamerRepository.getValue24hAgoMap();
    const prevValue24h = value24hMap[channel_id] ?? streamer.prev_value ?? streamer.base_value;

    // 최근 마켓 거래 체결가 조회
    const recentMarketPrice = await marketRepository.getRecentPrice(channel_id);

    return res.status(200).json({
      streamer: {
        ...streamer,
        prev_value: prevValue24h,
        recent_market_price: recentMarketPrice
      },
      history: downsampleValueHistory(boundedHistory),
      range_start_at: rangeStartAt.toISOString(),
      range_end_at: rangeEndAt.toISOString()
    });
  } catch (err: any) {
    console.error('[PlayController] getStreamerDetail 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '스트리머 상세 조회에 실패했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 9. 대표 카드 설정/해제
 * POST /api/users/me/representative  Body: { channel_id: string | null, star: number | null }
 */
export const setRepresentativeCard = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  const { channel_id } = req.body;
  const star = channel_id ? Number(req.body.star) : null;

  try {
    if (channel_id) {
      if (!Number.isInteger(star) || star! < 0 || star! > 5) {
        return res.status(400).json({ error: 'BadRequest', message: '대표 카드의 별 등급(0~5)이 필요합니다.' });
      }
      // 본인이 해당 스트리머의 해당 별 카드를 1장 이상 보유하고 있는지 검증
      const cards = await userCardRepository.findByUserId(userId);
      const owns = cards.some((c) => c.channel_id === channel_id && (c.star || 0) === star);
      if (!owns) {
        return res.status(400).json({ error: 'BadRequest', message: '보유하지 않은 카드는 대표 카드로 설정할 수 없습니다.' });
      }
      await userRepository.updateRepresentativeCard(userId, channel_id, star);
    } else {
      // null 전달 시 대표 카드 해제
      await userRepository.updateRepresentativeCard(userId, null, null);
    }

    return res.status(200).json({
      message: channel_id ? '대표 카드가 설정되었습니다.' : '대표 카드가 해제되었습니다.',
      representative_card_channel_id: channel_id || null,
      representative_card_star: star
    });
  } catch (err: any) {
    console.error('[PlayController] setRepresentativeCard 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '대표 카드 설정에 실패했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};
