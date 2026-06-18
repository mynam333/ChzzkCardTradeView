import { Response } from 'express';
import { marketRepository, userCardRepository } from '../repositories';
import { AuthenticatedRequest } from '../middlewares/admin';
import { sendPushToUser } from './pushController';
import { getUserReservations } from './tradeController';
import { createRealtimeNotification } from '../services/notificationDelivery';
import { FIXED_MARKET_FEE_RATE, calculateMarketFee, getAuctionFeeRate } from '../utils/marketFee';
import { publishRealtimeEvent } from '../services/realtimeStream';
import { clearUserRankingCaches } from './playController';
import type { MarketListing } from '../repositories/interfaces';
import { recordAchievementEvent } from '../services/achievementService';

type MarketNotificationTarget = 'inventory' | 'shop:market';
const MARKET_LIST_CACHE_TTL_MS = Math.max(1000, Number(process.env.MARKET_LIST_CACHE_TTL_MS || 5000));
const MARKET_SETTLE_MIN_INTERVAL_MS = Math.max(1000, Number(process.env.MARKET_SETTLE_MIN_INTERVAL_MS || 15_000));
const MARKET_STALE_LISTING_DAYS = Math.max(1, Number(process.env.MARKET_STALE_LISTING_DAYS || 7));
const MARKET_STALE_CANCEL_BATCH = Math.max(1, Math.min(500, Number(process.env.MARKET_STALE_CANCEL_BATCH || 200)));
const MARKET_HISTORY_DEFAULT_LIMIT = Math.max(100, Number(process.env.MARKET_HISTORY_DEFAULT_LIMIT || 1000));
const MARKET_HISTORY_MAX_LIMIT = Math.max(MARKET_HISTORY_DEFAULT_LIMIT, Number(process.env.MARKET_HISTORY_MAX_LIMIT || 5000));

const marketListCache = new Map<string, { data: any; expiresAt: number }>();
let marketSettleInFlight: Promise<void> | null = null;
let lastMarketSettleAt = 0;

const clearMarketListCache = () => {
  marketListCache.clear();
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

const realtimeListingPatch = (listing: MarketListing | null | undefined) => {
  if (!listing?.id) return null;
  return {
    id: listing.id,
    status: listing.status,
    price: listing.price,
    listing_type: listing.listing_type,
    buy_now_price: listing.buy_now_price ?? null,
    starting_bid: listing.starting_bid ?? null,
    current_bid: listing.current_bid ?? null,
    current_bidder_id: listing.current_bidder_id ?? null,
    current_bidder_username: listing.current_bidder_username ?? null,
    auction_ends_at: listing.auction_ends_at ?? null,
    updated_at: listing.updated_at ?? new Date().toISOString()
  };
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
  clearUserRankingCaches();
  publishRealtimeEvent('ranking', { reason });
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
  const bidderId = type === 'bidding' ? req.user?.id : undefined;
  const cacheKey = JSON.stringify({ page, limit, search: search || '', sort, type, bidderId: bidderId || '' });
  const now = Date.now();
  const cached = marketListCache.get(cacheKey);
  if (cached && cached.expiresAt > now && !hasExpiredAuctionListing(cached.data)) {
    setMarketListCacheHeaders(res);
    return res.json(cached.data);
  }
  if (cached) {
    marketListCache.delete(cacheKey);
  }

  try {
    await settleExpiredAuctions().catch((err: any) => {
      console.warn('[MarketController] 목록 조회 전 만료 경매 정리 실패:', err?.message || err);
    });
    const result = await marketRepository.listActive({ page, limit, search, sort, type, bidderId });
    marketListCache.set(cacheKey, { data: result, expiresAt: Date.now() + MARKET_LIST_CACHE_TTL_MS });
    if (marketListCache.size > 200) {
      for (const [key, value] of marketListCache) {
        if (value.expiresAt <= Date.now()) marketListCache.delete(key);
      }
    }
    setMarketListCacheHeaders(res);
    return res.json(result);
  } catch (err: any) {
    console.error('[MarketController] listActiveListings 에러:', err);
    if (cached) {
      setMarketListCacheHeaders(res);
      return res.json(cached.data);
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
    const listings = await marketRepository.listByUser(user.id);
    return res.json(listings);
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
  const listingPrice = Number(listingType === 'auction' ? (rawBuyNowPrice ?? price ?? starting_bid) : price);
  const startBid = Number(starting_bid || price);

  if (isNaN(cardId) || isNaN(listingPrice) || (listingType === 'auction' && isNaN(startBid))) {
    return res.status(400).json({ error: 'BadRequest', message: '올바른 카드 ID와 가격을 지정해 주세요.' });
  }

  if (listingPrice < 100 || (listingType === 'auction' && startBid < 100)) {
    return res.status(400).json({ error: 'BadRequest', message: '최소 판매 가격은 100P 이상이어야 합니다.' });
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
    // 1) 내 소유 카드인지 검사
    const myCards = await userCardRepository.findByUserId(user.id);
    const targetCard = myCards.find(c => c.id === cardId);
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
    const ownedCount = myCards.filter(c => !c.is_locked && c.channel_id === targetCard.channel_id && (c.star ?? 0) === (targetCard.star ?? 0)).length;
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
    if (!listing) {
      return res.status(404).json({ error: 'NotFound', message: '존재하지 않는 매물입니다.' });
    }

    if (listing.seller_id !== user.id) {
      return res.status(403).json({ error: 'Forbidden', message: '본인의 매물만 취소할 수 있습니다.' });
    }

    if (listing.status !== 'PENDING') {
      return res.status(400).json({ error: 'BadRequest', message: '판매 중인 매물만 취소할 수 있습니다.' });
    }

    if (listing.listing_type === 'auction' && listing.current_bidder_id && Number(listing.bid_reserved || 0) > 0) {
      return res.status(400).json({
        error: 'BadRequest',
        message: '이미 입찰자가 있는 경매는 등록자가 취소할 수 없습니다.'
      });
    }

    await marketRepository.updateStatus(id, 'CANCELLED');
    publishMarketUpdated('listing_cancelled', { ...listing, status: 'CANCELLED' });
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
  const result = await marketRepository.placeBid(id, user.id, amount);
  if (!result.ok) {
    if (result.reason === 'AUCTION_ENDED') {
      settleExpiredAuctions().catch((err: any) => {
        console.warn('[MarketController] 종료 경매 즉시 정리 실패:', err?.message || err);
      });
    }
    const messageMap: Record<string, string> = {
      NOT_FOUND_OR_NOT_AUCTION: '진행 중인 경매 매물을 찾을 수 없습니다.',
      CANNOT_BID_OWN_ITEM: '본인의 경매에는 입찰할 수 없습니다.',
      AUCTION_ENDED: '이미 종료된 경매입니다.',
      BID_TOO_LOW: '입찰자가 없으면 현재가부터, 이후에는 현재가보다 100P 이상 높은 금액으로 입찰해 주세요.',
      INSUFFICIENT_POINT: '보유 포인트가 부족합니다.'
    };
    return res.status(400).json({ error: result.reason, message: messageMap[result.reason] || '입찰에 실패했습니다.' });
  }
  const previousBidderId = result.previous_bidder_id;
  if (previousBidderId && previousBidderId !== user.id) {
    const listing = await marketRepository.findById(id);
    const streamerName = listing?.card?.streamer?.name || '스트리머';
    const star = listing?.card?.star ?? 0;
    notify(
      previousBidderId,
      '[오픈마켓] 경매 상위 입찰 발생',
      `[${streamerName}] ${star}성 카드 경매에서 다른 유저가 ${amount.toLocaleString()}P로 상위 입찰했습니다.`,
      'shop:market',
      `market-auction:${id}`
    );
  }
  const updatedListing = await marketRepository.findById(id).catch(() => null);
  const listingPatch = realtimeListingPatch(updatedListing);
  publishMarketUpdated('auction_bid', updatedListing, {
    listingId: id,
    current_bid: result.current_bid,
    current_bidder_id: updatedListing?.current_bidder_id ?? user.id,
    current_bidder_username: updatedListing?.current_bidder_username ?? user.username,
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
  return res.json(await marketRepository.listWatches(user.id));
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
};

export const deleteMarketWatch = async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'BadRequest', message: '관심상품 ID가 올바르지 않습니다.' });
  const ok = await marketRepository.deleteWatch(user.id, id);
  return res.status(ok ? 200 : 404).json({ ok });
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
    return res.json(history);
  } catch (err: any) {
    console.error('[MarketController] listMarketHistory 에러:', err);
    return res.status(500).json({ error: 'ServerError', message: '거래 내역을 가져오는 중 오류가 발생했습니다.' });
  }
};

export const settleExpiredAuctions = async () => {
  const now = Date.now();
  if (marketSettleInFlight) return marketSettleInFlight;
  if (now - lastMarketSettleAt < MARKET_SETTLE_MIN_INTERVAL_MS) return;

  marketSettleInFlight = (async () => {
    lastMarketSettleAt = now;
    const settledAuctionListings = await marketRepository.finishExpiredAuctions(new Date().toISOString());
    const soldListings = settledAuctionListings.filter((listing) => listing.status === 'SOLD');
    const staleCutoffIso = new Date(Date.now() - MARKET_STALE_LISTING_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const cancelledListings = await marketRepository.cancelStaleListings(staleCutoffIso, MARKET_STALE_CANCEL_BATCH);
    if (settledAuctionListings.length > 0 || cancelledListings.length > 0) {
      console.log(`[MarketScheduler] 정리 완료: 만료 경매 ${settledAuctionListings.length}건(낙찰 ${soldListings.length}건), 오래된 고정가 매물 자동 취소 ${cancelledListings.length}건`);
    }
    for (const listing of soldListings) {
      const streamerName = listing.card?.streamer?.name || '스트리머';
      const star = listing.card?.star ?? 0;
      const price = listing.price;
      notify(listing.seller_id, '[오픈마켓] 경매 낙찰 완료', `[${streamerName}] ${star}성 카드 경매가 ${price}P에 낙찰되었습니다.`);
      if (listing.buyer_id) {
        notify(listing.buyer_id, '[오픈마켓] 경매 낙찰', `[${streamerName}] ${star}성 카드 경매에 낙찰되어 카드가 보관함으로 이동했습니다.`);
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
        listings: changedListings.map(realtimeListingPatch).filter(Boolean)
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
    ? (listing.buy_now_price ?? listing.current_bid ?? listing.starting_bid ?? listing.price)
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
