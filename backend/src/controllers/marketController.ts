import { Response } from 'express';
import { marketRepository } from '../repositories';
import { AuthenticatedRequest } from '../middlewares/admin';
import { sendPushToUser } from './pushController';
import { getUserReservations } from './tradeController';
import { createRealtimeNotification } from '../services/notificationDelivery';
import { FIXED_MARKET_FEE_RATE, calculateMarketFee, getAuctionFeeRate } from '../utils/marketFee';
import { publishRealtimeEvent } from '../services/realtimeStream';
import { scheduleUserRankingRefresh } from './playController';
import type { MarketListing } from '../repositories/interfaces';
import { recordAchievementEvent } from '../services/achievementService';
import { getDbMode, getMysqlDb, getSqliteDb, getSupabaseClient } from '../services/db';

type MarketNotificationTarget = 'inventory' | 'shop:market';
const MARKET_LIST_CACHE_TTL_MS = Math.min(5000, Math.max(1000, Number(process.env.MARKET_LIST_CACHE_TTL_MS || 5000)));
const MARKET_SETTLE_MIN_INTERVAL_MS = Math.max(1000, Number(process.env.MARKET_SETTLE_MIN_INTERVAL_MS || 15_000));
const MARKET_STALE_LISTING_DAYS = Math.max(1, Number(process.env.MARKET_STALE_LISTING_DAYS || 7));
const MARKET_STALE_CANCEL_BATCH = Math.max(1, Math.min(500, Number(process.env.MARKET_STALE_CANCEL_BATCH || 200)));
const MARKET_HISTORY_DEFAULT_LIMIT = Math.max(100, Number(process.env.MARKET_HISTORY_DEFAULT_LIMIT || 1000));
const MARKET_HISTORY_MAX_LIMIT = Math.max(MARKET_HISTORY_DEFAULT_LIMIT, Number(process.env.MARKET_HISTORY_MAX_LIMIT || 5000));
export const MAX_MARKET_PRICE = 999_999_999;

const marketListCache = new Map<string, { data: any; expiresAt: number }>();
const marketListInFlight = new Map<string, Promise<any>>();
let marketSettleInFlight: Promise<void> | null = null;
let lastMarketSettleAt = 0;

const clearMarketListCache = () => {
  marketListCache.clear();
  marketListInFlight.clear();
};

const setMarketListCacheHeaders = (res: Response) => {
  // Browser-level caching can replay a stale listing immediately after a bid.
  // Keep the short server-side cache above for DB protection, but force clients
  // to revalidate through the API so mutation-triggered cache clears take effect.
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
};

const hasExpiredAuctionListing = (data: any) => {
  const listings = Array.isArray(data?.listings) ? data.listings : [];
  const now = Date.now();
  return listings.some((listing: any) => {
    if (listing?.status !== 'PENDING' || listing?.listing_type !== 'auction' || !listing?.auction_ends_at) return false;
    const endsAt = new Date(listing.auction_ends_at).getTime();
    return Number.isFinite(endsAt) && endsAt <= now;
  });
};

const maskBidderUsername = (username: string | null | undefined): string | null => {
  const value = String(username || '').trim();
  if (!value) return null;
  return `${Array.from(value)[0]}***`;
};

const bidderUsernameForViewer = (listing: MarketListing, viewerId?: string): string | null => {
  if (!listing.current_bidder_id || !listing.current_bidder_username) return null;
  return listing.current_bidder_id === viewerId
    ? listing.current_bidder_username
    : maskBidderUsername(listing.current_bidder_username);
};

const marketListingForViewer = (listing: MarketListing, viewerId?: string): MarketListing => {
  if (listing.status === 'PENDING' && listing.listing_type === 'auction') {
    return {
      ...listing,
      current_bid: listing.starting_bid ?? listing.price,
      current_bidder_id: null,
      current_bidder_username: undefined,
      bid_reserved: 0
    };
  }
  return {
    ...listing,
    current_bidder_username: bidderUsernameForViewer(listing, viewerId) ?? undefined
  };
};

const marketListingsForViewer = (listings: MarketListing[], viewerId?: string): MarketListing[] =>
  listings.map((listing) => marketListingForViewer(listing, viewerId));

const publicHistoryListingForViewer = (listing: MarketListing, viewerId?: string): MarketListing => {
  const sanitized: MarketListing = { ...marketListingForViewer(listing, viewerId) };
  delete sanitized.highest_bid;
  delete sanitized.winning_price;
  delete sanitized.auction_result;
  delete sanitized.my_bid;
  delete sanitized.current_bid;
  delete sanitized.current_bidder_id;
  delete sanitized.current_bidder_username;
  delete sanitized.bid_reserved;
  return sanitized;
};

const privateAuctionListingsForViewer = async (listings: MarketListing[], viewerId: string): Promise<MarketListing[]> => {
  const listingIds = listings
    .filter((listing) => listing.listing_type === 'auction' && Number.isFinite(Number(listing.id)))
    .map((listing) => Number(listing.id));
  const highestBids = await marketRepository.getHighestBids(listingIds);
  return listings.map((listing) => {
    const privateListing: MarketListing = { ...marketListingForViewer(listing, viewerId) };
    delete privateListing.auction_result;
    if (listing.listing_type !== 'auction' || listing.id == null) return privateListing;
    privateListing.highest_bid = highestBids[Number(listing.id)] || null;
    privateListing.winning_price = listing.status === 'SOLD' ? Number(listing.price || 0) : null;
    return privateListing;
  });
};

const marketListResultForViewer = (
  result: { listings: MarketListing[]; total: number },
  viewerId?: string
) => ({
  ...result,
  listings: marketListingsForViewer(result.listings || [], viewerId)
});

// 푸시 + 인앱 알림 동시 전송 헬퍼
const notify = (
  userId: string,
  title: string,
  body: string,
  target: MarketNotificationTarget = 'inventory',
  groupKey?: string
) => {
  const pushUrl = target === 'shop:market' ? '/shop?tab=market' : '/inventory';
  sendPushToUser(userId, title, body, pushUrl, groupKey);
  createRealtimeNotification({ user_id: userId, title, body, link: target, group_key: groupKey }).catch(() => { /* 무시 */ });
};

const notifySiteOnly = (
  userId: string,
  title: string,
  body: string,
  target: MarketNotificationTarget = 'shop:market',
  groupKey?: string
) => {
  createRealtimeNotification({ user_id: userId, title, body, link: target, group_key: groupKey }).catch(() => { /* 무시 */ });
};

const displayAuctionUser = (username: string | null | undefined, userId: string) => {
  const name = String(username || '').trim();
  return name || `유저 ${userId.slice(0, 6)}`;
};

const realtimeListingPatch = (listing: MarketListing | null | undefined, viewerId?: string) => {
  if (!listing?.id) return null;
  const publicListing = marketListingForViewer(listing, viewerId);
  const patch: Record<string, unknown> = {
    id: publicListing.id,
    status: publicListing.status,
    price: publicListing.price,
    listing_type: publicListing.listing_type,
    buy_now_price: publicListing.buy_now_price ?? null,
    starting_bid: publicListing.starting_bid ?? null,
    current_bid: publicListing.current_bid ?? null,
    current_bidder_id: publicListing.current_bidder_id ?? null,
    current_bidder_username: publicListing.current_bidder_username ?? null,
    auction_ends_at: publicListing.auction_ends_at ?? null,
    updated_at: publicListing.updated_at ?? new Date().toISOString()
  };
  if (viewerId && publicListing.my_bid != null) {
    patch.my_bid = publicListing.my_bid;
  }
  return patch;
};

const publishMarketUpdated = (reason: string, listing?: MarketListing | null, extra: Record<string, unknown> = {}) => {
  clearMarketListCache();
  publishRealtimeEvent('market', {
    reason,
    listingId: listing?.id,
    listing: realtimeListingPatch(listing),
    ...extra
  });
};

const publishRankingUpdated = (reason: string) => {
  scheduleUserRankingRefresh(reason);
};

type MarketOwnedCard = {
  id: number;
  user_id: string;
  channel_id: string;
  star: number;
  is_locked: boolean;
};

const toBooleanFlag = (value: unknown): boolean =>
  value === true || value === 1 || value === '1';

const normalizeOwnedCard = (row: any): MarketOwnedCard => ({
  id: Number(row.id),
  user_id: String(row.user_id),
  channel_id: String(row.channel_id),
  star: Number(row.star ?? 0),
  is_locked: toBooleanFlag(row.is_locked)
});

const findMarketOwnedCard = async (userId: string, cardId: number): Promise<MarketOwnedCard | null> => {
  if (getDbMode() === 'MYSQL') {
    const row = await getMysqlDb().get(
      'SELECT id, user_id, channel_id, COALESCE(star, 0) AS star, COALESCE(is_locked, 0) AS is_locked FROM user_cards WHERE id = ? AND user_id = ?',
      cardId,
      userId
    );
    return row ? normalizeOwnedCard(row) : null;
  }

  if (getDbMode() === 'SUPABASE') {
    const { data, error } = await getSupabaseClient()
      .from('user_cards')
      .select('id,user_id,channel_id,star,is_locked')
      .eq('id', cardId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data ? normalizeOwnedCard(data) : null;
  }

  const row = getSqliteDb().prepare(
    'SELECT id, user_id, channel_id, COALESCE(star, 0) AS star, COALESCE(is_locked, 0) AS is_locked FROM user_cards WHERE id = ? AND user_id = ?'
  ).get(cardId, userId);
  return row ? normalizeOwnedCard(row) : null;
};

const countUnlockedOwnedCardsForMarket = async (userId: string, channelId: string, star: number): Promise<number> => {
  if (getDbMode() === 'MYSQL') {
    const row = await getMysqlDb().get(
      'SELECT COUNT(*) AS count FROM user_cards WHERE user_id = ? AND channel_id = ? AND COALESCE(star, 0) = ? AND COALESCE(is_locked, 0) = 0',
      userId,
      channelId,
      star
    );
    return Number(row?.count || 0);
  }

  if (getDbMode() === 'SUPABASE') {
    const { data, error } = await getSupabaseClient()
      .from('user_cards')
      .select('id,star,is_locked')
      .eq('user_id', userId)
      .eq('channel_id', channelId);
    if (error) throw error;
    return (data || []).filter((card: any) =>
      Number(card.star ?? 0) === star && !toBooleanFlag(card.is_locked)
    ).length;
  }

  const row = getSqliteDb().prepare(
    'SELECT COUNT(*) AS count FROM user_cards WHERE user_id = ? AND channel_id = ? AND COALESCE(star, 0) = ? AND COALESCE(is_locked, 0) = 0'
  ).get(userId, channelId, star) as any;
  return Number(row?.count || 0);
};

/**
 * 1. 오픈마켓 활성 매물 목록 조회 (검색, 정렬, 페이지네이션)
 * GET /api/market/listings
 */
export const listActiveListings = async (req: AuthenticatedRequest, res: Response) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 12)));
  const search = req.query.search ? String(req.query.search) : undefined;
  const sort = (req.query.sort || 'latest') as 'latest' | 'oldest' | 'price_desc' | 'price_asc' | 'ending_soon' | 'bid_desc';
  const rawType = String(req.query.type || 'all');
  const type = (['all', 'fixed', 'auction', 'bidding'].includes(rawType) ? rawType : 'all') as 'all' | 'fixed' | 'auction' | 'bidding';
  const bidderId = req.user?.id;
  const cacheKey = JSON.stringify({ page, limit, search: search || '', sort, type, bidderId: bidderId || '' });
  const cacheEnabled = sort !== 'latest';
  const now = Date.now();
  const cached = cacheEnabled ? marketListCache.get(cacheKey) : undefined;
  if (cacheEnabled && cached && cached.expiresAt > now && !hasExpiredAuctionListing(cached.data)) {
    setMarketListCacheHeaders(res);
    return res.json(marketListResultForViewer(cached.data, req.user?.id));
  }
  if (cacheEnabled && cached) {
    marketListCache.delete(cacheKey);
  }
  const inFlight = cacheEnabled ? marketListInFlight.get(cacheKey) : undefined;
  if (inFlight) {
    try {
      const result = await inFlight;
      setMarketListCacheHeaders(res);
      return res.json(marketListResultForViewer(result, req.user?.id));
    } catch (err: any) {
      if (cached) {
        setMarketListCacheHeaders(res);
        return res.json(marketListResultForViewer(cached.data, req.user?.id));
      }
      console.error('[MarketController] listActiveListings 공유 요청 에러:', err);
      return res.status(500).json({ error: 'ServerError', message: '마켓 목록을 가져오는 중 오류가 발생했습니다.' });
    }
  }

  try {
    const request = (async () => {
      await settleExpiredAuctions({ force: true }).catch((err: any) => {
        console.warn('[MarketController] 목록 조회 전 만료 경매 정리 실패:', err?.message || err);
      });
      return marketRepository.listActive({ page, limit, search, sort, type, bidderId });
    })().finally(() => {
      marketListInFlight.delete(cacheKey);
    });
    if (cacheEnabled) {
      marketListInFlight.set(cacheKey, request);
    }
    const result = await request;
    if (cacheEnabled) {
      marketListCache.set(cacheKey, { data: result, expiresAt: Date.now() + MARKET_LIST_CACHE_TTL_MS });
      if (marketListCache.size > 200) {
        for (const [key, value] of marketListCache) {
          if (value.expiresAt <= Date.now()) marketListCache.delete(key);
        }
      }
    }
    setMarketListCacheHeaders(res);
    return res.json(marketListResultForViewer(result, req.user?.id));
  } catch (err: any) {
    console.error('[MarketController] listActiveListings 에러:', err);
    if (cached) {
      setMarketListCacheHeaders(res);
      return res.json(marketListResultForViewer(cached.data, req.user?.id));
    }
    return res.status(500).json({ error: 'ServerError', message: '마켓 목록을 가져오는 중 오류가 발생했습니다.' });
  }
};

/**
 * 2. 내 판매 목록 조회
 * GET /api/market/my
 */
export const listMyListings = async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  try {
    await settleExpiredAuctions({ force: true }).catch((err: any) => {
      console.warn('[MarketController] 내 판매 목록 조회 전 만료 경매 정리 실패:', err?.message || err);
    });
    const listings = await marketRepository.listByUser(user.id);
    return res.json(await privateAuctionListingsForViewer(listings, user.id));
  } catch (err: any) {
    console.error('[MarketController] listMyListings 에러:', err);
    return res.status(500).json({ error: 'ServerError', message: '내 판매 목록을 가져오는 중 오류가 발생했습니다.' });
  }
};

/**
 * 3. 오픈마켓 판매 매물 등록
 * POST /api/market/list
 * Body: { user_card_id, price, with_cosmetics, listing_type, buy_now_price, starting_bid, auction_hours }
 */
export const createListing = async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  const { user_card_id, price, with_cosmetics, listing_type, buy_now_price, starting_bid, auction_hours } = req.body;
  const cardId = Number(user_card_id);
  const listingType = listing_type === 'auction' ? 'auction' : 'fixed';
  const rawBuyNowPrice = buy_now_price === '' || buy_now_price == null ? null : Number(buy_now_price);
  const startBid = Number(starting_bid || price);
  const listingPrice = Number(listingType === 'auction' ? (rawBuyNowPrice ?? startBid) : price);

  if (isNaN(cardId) || isNaN(listingPrice) || (listingType === 'auction' && isNaN(startBid))) {
    return res.status(400).json({ error: 'BadRequest', message: '올바른 카드 ID와 가격을 지정해 주세요.' });
  }

  if (listingPrice < 100 || (listingType === 'auction' && startBid < 100)) {
    return res.status(400).json({ error: 'BadRequest', message: '최소 판매 가격은 100P 이상이어야 합니다.' });
  }
  const submittedPrices = listingType === 'auction'
    ? [startBid, ...(rawBuyNowPrice === null ? [] : [rawBuyNowPrice])]
    : [listingPrice];
  if (submittedPrices.some((value) => !Number.isInteger(value) || value > MAX_MARKET_PRICE)) {
    return res.status(400).json({
      error: 'PriceTooHigh',
      message: `판매 금액은 최대 ${MAX_MARKET_PRICE.toLocaleString('ko-KR')} P까지 입력할 수 있습니다.`
    });
  }
  if (listingType === 'auction' && rawBuyNowPrice !== null && rawBuyNowPrice < startBid) {
    return res.status(400).json({ error: 'BadRequest', message: '즉시 구매가는 경매 시작가보다 낮을 수 없습니다.' });
  }
  const allowedAuctionHours = [1, 2, 3, 6, 12, 24, 48, 72];
  const auctionHours = Math.floor(Number(auction_hours || 24));
  if (listingType === 'auction' && !allowedAuctionHours.includes(auctionHours)) {
    return res.status(400).json({ error: 'BadRequest', message: '경매 진행 시간은 1, 2, 3, 6, 12, 24, 48, 72시간 중 하나여야 합니다.' });
  }
  const feeRate = listingType === 'auction' ? getAuctionFeeRate(auctionHours) : FIXED_MARKET_FEE_RATE;

  try {
    // 1) 내 소유 카드인지 검사. 보관함 목록 조회는 streamer 조인 결과에 의존하므로
    // 마켓 등록 검증은 user_cards 원본을 직접 확인한다.
    const targetCard = await findMarketOwnedCard(user.id, cardId);
    if (!targetCard) {
      return res.status(404).json({ error: 'NotFound', message: '소유하고 있지 않은 카드입니다.' });
    }
    if (targetCard.is_locked) {
      return res.status(400).json({ error: 'CardLocked', message: '잠금된 카드는 오픈마켓에 등록할 수 없습니다.' });
    }

    // 2) 이미 이 카드가 마켓에 PENDING 상태로 올라가 있는지 중복 확인 및 등록 한도 체크 (최대 5개)
    const pendingCardIds = await marketRepository.findPendingCardIdsByUser(user.id);
    if (pendingCardIds.includes(cardId)) {
      return res.status(400).json({ error: 'DuplicateListing', message: '이미 마켓에 판매 등록된 카드입니다.' });
    }
    if (pendingCardIds.length >= 5) {
      return res.status(400).json({ error: 'MaxListingsReached', message: '최대 5개의 카드만 동시에 오픈마켓에 등록할 수 있습니다.' });
    }

    // 3) 에스크로(교환 예약 등) 검증
    const reservations = await getUserReservations(user.id);
    const key = `${targetCard.channel_id}#${targetCard.star ?? 0}`;
    const ownedCount = await countUnlockedOwnedCardsForMarket(user.id, targetCard.channel_id, targetCard.star ?? 0);
    const reservedCount = reservations.cardsByStar[key] || 0;

    if (ownedCount - reservedCount <= 0) {
      return res.status(400).json({ 
        error: 'EscrowError', 
        message: '이 카드는 현재 1:1 교환 제안이나 다른 거래 대기건에 묶여 있어 등록할 수 없습니다.' 
      });
    }

    // 4) 매물 등록 실행
    const listing = await marketRepository.create({
      seller_id: user.id,
      user_card_id: cardId,
      price: listingPrice,
      with_cosmetics: !!with_cosmetics,
      listing_type: listingType,
      buy_now_price: listingType === 'auction' ? rawBuyNowPrice : listingPrice,
      starting_bid: listingType === 'auction' ? startBid : null,
      auction_ends_at: listingType === 'auction'
        ? new Date(Date.now() + auctionHours * 60 * 60 * 1000).toISOString()
        : null,
      fee_rate: feeRate
    });
    await notifyMatchingWatches(listing);
    publishMarketUpdated('listing_created', listing);
    recordAchievementEvent({
      eventKey: `market:list:${user.id}:${listing.id || cardId}`,
      userId: user.id,
      eventType: 'market.listed',
      sourceType: 'market_listing',
      sourceId: listing.id || cardId,
      value: 1,
      metadata: { listing_type: listingType, price: listingPrice, with_cosmetics: !!with_cosmetics },
      stats: { 'market.listed.count': 1 }
    }).catch(() => undefined);

    return res.json({ ok: true, listing });
  } catch (err: any) {
    console.error('[MarketController] createListing 에러:', err);
    if (err?.message === 'CARD_LOCKED_OR_NOT_FOUND') {
      return res.status(400).json({ error: 'CardLocked', message: '잠금되었거나 소유하지 않은 카드는 오픈마켓에 등록할 수 없습니다.' });
    }
    return res.status(500).json({ error: 'ServerError', message: '매물 등록 중 오류가 발생했습니다.' });
  }
};

/**
 * 4. 판매 등록 취소
 * POST /api/market/cancel/:id
 */
export const cancelListing = async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  const id = Number(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'BadRequest', message: '올바른 매물 ID를 지정해 주세요.' });
  }

  try {
    const listing = await marketRepository.findById(id);
    const result = await marketRepository.cancelBySeller(id, user.id);
    if (!result.ok) {
      const responses = {
        NOT_FOUND: { status: 404, error: 'NotFound', message: '존재하지 않는 매물입니다.' },
        FORBIDDEN: { status: 403, error: 'Forbidden', message: '본인의 매물만 취소할 수 있습니다.' },
        NOT_PENDING: { status: 400, error: 'BadRequest', message: '판매 중인 매물만 취소할 수 있습니다.' },
        AUCTION_HAS_BIDS: { status: 409, error: 'AuctionHasBids', message: '입찰이 시작된 경매는 등록자가 취소할 수 없습니다.' }
      } as const;
      const response = responses[result.reason as keyof typeof responses] || responses.NOT_PENDING;
      return res.status(response.status).json({ error: response.error, message: response.message });
    }

    publishMarketUpdated('listing_cancelled', listing ? { ...listing, status: 'CANCELLED' } : undefined);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[MarketController] cancelListing 에러:', err);
    return res.status(500).json({ error: 'ServerError', message: '등록 취소 중 오류가 발생했습니다.' });
  }
};

/**
 * 완료/취소된 내 등록 매물을 내 관리 화면에서 숨김 처리합니다. DB 레코드는 유지됩니다.
 * DELETE /api/market/my/:id
 */
export const hideMyListing = async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'BadRequest', message: '올바른 매물 ID를 지정해 주세요.' });
  }

  try {
    const listing = await marketRepository.findById(id);
    if (!listing) {
      return res.status(404).json({ error: 'NotFound', message: '존재하지 않는 매물입니다.' });
    }
    if (listing.seller_id !== user.id) {
      return res.status(403).json({ error: 'Forbidden', message: '본인의 매물만 삭제할 수 있습니다.' });
    }
    if (listing.status === 'PENDING') {
      return res.status(400).json({ error: 'BadRequest', message: '판매 중인 매물은 먼저 등록 취소해야 삭제할 수 있습니다.' });
    }

    const ok = await marketRepository.hideForSeller(id, user.id);
    return res.status(ok ? 200 : 400).json({
      ok,
      message: ok ? '내 등록 매물 관리에서 삭제했습니다.' : '이미 삭제되었거나 삭제할 수 없는 매물입니다.'
    });
  } catch (err: any) {
    console.error('[MarketController] hideMyListing 에러:', err);
    return res.status(500).json({ error: 'ServerError', message: '매물 삭제 처리 중 오류가 발생했습니다.' });
  }
};

/**
 * 5. 매물 구매 및 정산
 * POST /api/market/buy/:id
 */
export const purchaseListing = async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  const id = Number(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'BadRequest', message: '올바른 매물 ID를 지정해 주세요.' });
  }

  try {
    const listing = await marketRepository.findById(id);
    if (!listing) {
      return res.status(404).json({ error: 'NotFound', message: '존재하지 않는 매물입니다.' });
    }

    if (listing.seller_id === user.id) {
      return res.status(400).json({ error: 'BadRequest', message: '본인의 매물은 구매할 수 없습니다.' });
    }

    if (listing.status !== 'PENDING') {
      return res.status(400).json({ error: 'BadRequest', message: '이미 판매 완료되었거나 취소된 매물입니다.' });
    }

    if (listing.listing_type === 'auction' && !listing.buy_now_price) {
      return res.status(400).json({ error: 'BadRequest', message: '즉시 구매가 없는 경매 매물입니다. 입찰을 이용해 주세요.' });
    }

    // 원자적 구매 트랜잭션 수행
    const result = await marketRepository.buyAtomic(id, user.id);
    if (!result.ok) {
      const errMsg = result.reason === 'INSUFFICIENT_POINT'
        ? '보유 포인트가 부족합니다.'
        : '구매 처리에 실패했습니다. (사유: ' + result.reason + ')';
      return res.status(400).json({ error: 'PurchaseFailed', message: errMsg });
    }

    // 알림 발송 처리
    const streamerName = listing.card?.streamer?.name || '스트리머';
    const star = listing.card?.star ?? 0;
    const price = result.price ?? listing.buy_now_price ?? listing.price;
    const feeRate = listing.fee_rate ?? FIXED_MARKET_FEE_RATE;
    const settledAmount = result.settled_amount ?? calculateMarketFee(price, feeRate).settledAmount;

    const title = '[오픈마켓] 카드 판매 완료';
    const body = `등록하신 [${streamerName}] ${star}성 카드가 판매되었습니다. 대금 ${price}P에서 수수료 ${feeRate}%를 제한 ${settledAmount}P가 계정으로 정산되었습니다.`;
    notify(listing.seller_id, title, body);
    const updatedListing = await marketRepository.findById(id).catch(() => null);
    publishMarketUpdated('listing_purchased', updatedListing || { ...listing, status: 'SOLD', price });
    publishRankingUpdated('market_purchase');
    recordAchievementEvent({
      eventKey: `market:purchase:${user.id}:${id}`,
      userId: user.id,
      eventType: 'market.purchase',
      sourceType: 'market_listing',
      sourceId: id,
      value: 1,
      metadata: { price, seller_id: listing.seller_id, listing_type: listing.listing_type || 'fixed' },
      stats: { 'market.purchase.count': 1 },
      refreshSnapshots: true
    }).catch(() => undefined);
    recordAchievementEvent({
      eventKey: `market:sale:${listing.seller_id}:${id}`,
      userId: listing.seller_id,
      eventType: 'market.sale',
      sourceType: 'market_listing',
      sourceId: id,
      value: 1,
      metadata: { price, buyer_id: user.id, listing_type: listing.listing_type || 'fixed' },
      stats: { 'market.sale.count': 1 },
      refreshSnapshots: true
    }).catch(() => undefined);

    return res.json({ ok: true, settledAmount });
  } catch (err: any) {
    console.error('[MarketController] purchaseListing 에러:', err);
    return res.status(500).json({ error: 'ServerError', message: '구매 처리 중 오류가 발생했습니다.' });
  }
};

export const placeBid = async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  const id = Number(req.params.id);
  const amount = Math.floor(Number(req.body?.amount));
  if (!Number.isFinite(id) || !Number.isFinite(amount)) {
    return res.status(400).json({ error: 'BadRequest', message: '입찰 매물과 금액을 확인해 주세요.' });
  }
  if (amount > MAX_MARKET_PRICE) {
    return res.status(400).json({
      error: 'PriceTooHigh',
      message: `입찰 금액은 최대 ${MAX_MARKET_PRICE.toLocaleString('ko-KR')} P까지 입력할 수 있습니다.`
    });
  }
  const result = await marketRepository.placeBid(id, user.id, amount);
  if (!result.ok) {
    if (result.reason === 'AUCTION_ENDED') {
      settleExpiredAuctions({ force: true }).catch((err: any) => {
        console.warn('[MarketController] 종료 경매 즉시 정리 실패:', err?.message || err);
      });
    }
    const messageMap: Record<string, string> = {
      NOT_FOUND_OR_NOT_AUCTION: '진행 중인 경매 매물을 찾을 수 없습니다.',
      CANNOT_BID_OWN_ITEM: '본인의 경매에는 입찰할 수 없습니다.',
      AUCTION_ENDED: '이미 종료된 경매입니다.',
      BID_TOO_LOW: '시작가 이상으로 입찰해 주세요.',
      INSUFFICIENT_POINT: '보유 포인트가 부족합니다.'
    };
    return res.status(400).json({ error: result.reason, message: messageMap[result.reason] || '입찰에 실패했습니다.' });
  }
  const updatedListing = await marketRepository.findById(id).catch(() => null);
  const listingPatch = realtimeListingPatch(
    updatedListing ? { ...updatedListing, my_bid: amount } : updatedListing,
    user.id
  );
  publishMarketUpdated('auction_bid', updatedListing, {
    listingId: id,
    auction_ends_at: result.auction_ends_at ?? null
  });
  recordAchievementEvent({
    eventKey: `market:bid:${user.id}:${id}:${amount}`,
    userId: user.id,
    eventType: 'market.bid',
    sourceType: 'market_listing',
    sourceId: id,
    value: 1,
    metadata: { amount },
    stats: { 'market.bid.count': 1 }
  }).catch(() => undefined);
  return res.status(200).json({ ...result, listing: listingPatch });
};

export const listMarketWatches = async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  try {
    return res.json(await marketRepository.listWatches(user.id));
  } catch (err: any) {
    console.error('[MarketController] listMarketWatches 에러:', err?.message || err);
    return res.status(500).json({ error: 'ServerError', message: '관심 매물 목록을 가져오는 중 오류가 발생했습니다.' });
  }
};

export const upsertMarketWatch = async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  const channelId = String(req.body?.channel_id || '').trim();
  const rawStar = req.body?.star === '' || req.body?.star == null ? null : Math.floor(Number(req.body.star));
  if (rawStar !== null && !Number.isFinite(rawStar)) {
    return res.status(400).json({ error: 'BadRequest', message: '등급 값이 올바르지 않습니다.' });
  }
  const star = rawStar === null ? null : Math.max(0, Math.min(5, rawStar));
  const rawMaxPrice = req.body?.max_price === '' || req.body?.max_price == null ? null : Math.floor(Number(req.body.max_price));
  if (rawMaxPrice !== null && !Number.isFinite(rawMaxPrice)) {
    return res.status(400).json({ error: 'BadRequest', message: '최대 가격은 숫자로 입력해 주세요.' });
  }
  const maxPrice = rawMaxPrice === null ? null : Math.max(100, rawMaxPrice);
  if (!channelId) return res.status(400).json({ error: 'BadRequest', message: '스트리머를 선택해 주세요.' });
  try {
    const watch = await marketRepository.upsertWatch({ user_id: user.id, channel_id: channelId, star, max_price: maxPrice });
    recordAchievementEvent({
      eventKey: `market:watch:${user.id}:${channelId}:${star ?? 'all'}`,
      userId: user.id,
      eventType: 'market.watch',
      sourceType: 'market_watch',
      sourceId: channelId,
      value: 1,
      metadata: { channel_id: channelId, star: star ?? -1, max_price: maxPrice ?? 0 }
    }).catch(() => undefined);
    return res.status(200).json({ ok: true, watch });
  } catch (err: any) {
    console.error('[MarketController] upsertMarketWatch 에러:', err?.message || err);
    return res.status(500).json({ error: 'ServerError', message: '관심 매물 저장 중 오류가 발생했습니다.' });
  }
};

export const deleteMarketWatch = async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'BadRequest', message: '관심상품 ID가 올바르지 않습니다.' });
  try {
    const ok = await marketRepository.deleteWatch(user.id, id);
    return res.status(ok ? 200 : 404).json({ ok });
  } catch (err: any) {
    console.error('[MarketController] deleteMarketWatch 에러:', err?.message || err);
    return res.status(500).json({ error: 'ServerError', message: '관심 매물 삭제 중 오류가 발생했습니다.' });
  }
};

/**
 * 6. 내 거래 내역 (영수증) 조회
 * GET /api/market/history
 */
export const listMarketHistory = async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  try {
    // scope=all → 전체 공개 거래 장부(완료된 SOLD 거래), 그 외 → 내 거래 이력
    const scope = req.query.scope === 'all' ? 'all' : 'mine';
    const requestedLimit = Math.floor(Number(req.query.limit || MARKET_HISTORY_DEFAULT_LIMIT));
    const historyLimit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(MARKET_HISTORY_MAX_LIMIT, requestedLimit))
      : MARKET_HISTORY_DEFAULT_LIMIT;
    const history = scope === 'all'
      ? await marketRepository.listAllHistory(historyLimit)
      : await marketRepository.listHistory(user.id);
    if (scope === 'all') {
      return res.json(history.map((listing) => publicHistoryListingForViewer(listing, user.id)));
    }
    return res.json(await privateAuctionListingsForViewer(history, user.id));
  } catch (err: any) {
    console.error('[MarketController] listMarketHistory 에러:', err);
    return res.status(500).json({ error: 'ServerError', message: '거래 내역을 가져오는 중 오류가 발생했습니다.' });
  }
};

export const settleExpiredAuctions = async (options: { force?: boolean } = {}) => {
  const now = Date.now();
  if (marketSettleInFlight) return marketSettleInFlight;
  if (!options.force && now - lastMarketSettleAt < MARKET_SETTLE_MIN_INTERVAL_MS) return;

  marketSettleInFlight = (async () => {
    lastMarketSettleAt = now;
    const settledAuctionListings = await marketRepository.finishExpiredAuctions(new Date().toISOString());
    const soldListings = settledAuctionListings.filter((listing) => listing.status === 'SOLD');
    const endedListings = settledAuctionListings.filter((listing) => listing.status === 'AUCTION_ENDED');
    const staleCutoffIso = new Date(Date.now() - MARKET_STALE_LISTING_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const cancelledListings = await marketRepository.cancelStaleListings(staleCutoffIso, MARKET_STALE_CANCEL_BATCH);
    if (settledAuctionListings.length > 0 || cancelledListings.length > 0) {
      console.log(`[MarketScheduler] 정리 완료: 만료 경매 ${settledAuctionListings.length}건(낙찰 ${soldListings.length}건), 오래된 고정가 매물 자동 취소 ${cancelledListings.length}건`);
    }
    for (const listing of soldListings) {
      const streamerName = listing.card?.streamer?.name || '스트리머';
      const star = listing.card?.star ?? 0;
      const price = listing.price;
      const auctionResult = listing.auction_result;
      const winner = auctionResult?.bidders.find((bidder) => bidder.is_winner);
      const winnerName = winner
        ? displayAuctionUser(winner.username, winner.user_id)
        : displayAuctionUser(listing.current_bidder_username, listing.buyer_id || '');
      const winningBid = auctionResult?.winning_bid ?? listing.current_bid ?? price;
      const secondBid = auctionResult?.second_bid ?? null;
      const winnerDetail = secondBid && secondBid > 0
        ? `최고 입찰가 ${winningBid.toLocaleString()}P 중 2번째 높은 입찰가 ${secondBid.toLocaleString()}P 기준으로 ${price.toLocaleString()}P에 낙찰되었습니다.`
        : `단독 입찰 또는 경쟁 입찰이 없어 시작가 기준 ${price.toLocaleString()}P에 낙찰되었습니다.`;
      notify(
        listing.seller_id,
        '[오픈마켓] 경매 낙찰 완료',
        `[${streamerName}] ${star}성 카드 경매가 ${winnerName}님에게 ${price.toLocaleString()}P에 낙찰되었습니다.`,
        'shop:market',
        `market-auction-seller:${listing.id}`
      );
      if (listing.buyer_id) {
        notify(
          listing.buyer_id,
          '[오픈마켓] 경매 낙찰',
          `[${streamerName}] ${star}성 카드 경매에 낙찰되었습니다. ${winnerDetail} 카드는 보관함으로 이동했습니다.`,
          'inventory',
          `market-auction-winner:${listing.id}`
        );
      }
      for (const bidder of auctionResult?.bidders || []) {
        if (bidder.is_winner) continue;
        notifySiteOnly(
          bidder.user_id,
          '[오픈마켓] 경매 미낙찰',
          `[${streamerName}] ${star}성 카드 경매는 낙찰되지 않았습니다. 내 입찰가 ${bidder.amount.toLocaleString()}P, 최고 입찰자는 ${winnerName}님(${winningBid.toLocaleString()}P 입찰)입니다. 예약된 포인트는 환불되었습니다.`,
          'shop:market',
          `market-auction-lost:${listing.id}:${bidder.user_id}`
        );
      }
    }
    for (const listing of endedListings) {
      const bidders = listing.auction_result?.bidders || [];
      if (bidders.length === 0) continue;
      const streamerName = listing.card?.streamer?.name || '스트리머';
      const star = listing.card?.star ?? 0;
      for (const bidder of bidders) {
        notifySiteOnly(
          bidder.user_id,
          '[오픈마켓] 경매 유찰',
          `[${streamerName}] ${star}성 카드 경매가 낙찰 없이 종료되었습니다. 내 입찰가 ${bidder.amount.toLocaleString()}P는 환불되었습니다.`,
          'shop:market',
          `market-auction-ended:${listing.id}:${bidder.user_id}`
        );
      }
    }
    for (const listing of cancelledListings) {
      const streamerName = listing.card?.streamer?.name || '스트리머';
      const star = listing.card?.star ?? 0;
      notify(
        listing.seller_id,
        '[오픈마켓] 판매 등록 자동 취소',
        `[${streamerName}] ${star}성 카드가 ${MARKET_STALE_LISTING_DAYS}일 동안 판매되지 않아 자동으로 등록 취소되었습니다.`,
        'shop:market',
        `market-stale:${listing.id}`
      );
    }
    if (settledAuctionListings.length > 0 || cancelledListings.length > 0) {
      const changedListings = [...settledAuctionListings, ...cancelledListings];
      publishMarketUpdated('market_scheduled_cleanup', null, {
        listingIds: changedListings.map((listing) => listing.id).filter(Boolean),
        listings: changedListings.map((listing) => realtimeListingPatch(listing)).filter(Boolean)
      });
    }
    if (soldListings.length > 0) {
      publishRankingUpdated('auction_settled');
    }
  })().finally(() => {
    marketSettleInFlight = null;
  });
  return marketSettleInFlight;
};

const notifyMatchingWatches = async (listing: any) => {
  const watches = await marketRepository.findMatchingWatches(listing);
  if (!watches.length) return;
  const streamerName = listing.card?.streamer?.name || '관심 카드';
  const star = listing.card?.star ?? 0;
  const price = listing.listing_type === 'auction'
    ? (listing.buy_now_price ?? listing.starting_bid ?? listing.price)
    : listing.price;
  for (const watch of watches) {
    notify(
      watch.user_id,
      '[오픈마켓] 관심 카드 등록 알림',
      `${streamerName} ${star}성 카드가 ${price.toLocaleString()}P 조건으로 오픈마켓에 등록되었습니다.`,
      'shop:market'
    );
  }
};
