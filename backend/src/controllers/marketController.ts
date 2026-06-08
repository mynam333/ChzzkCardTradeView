import { Response } from 'express';
import { marketRepository, userRepository, userCardRepository, notificationRepository } from '../repositories';
import { AuthenticatedRequest } from '../middlewares/admin';
import { sendPushToUser } from './pushController';
import { getUserReservations } from './tradeController';

// 푸시 + 인앱 알림 동시 전송 헬퍼
const notify = (userId: string, title: string, body: string) => {
  // 오픈마켓 매물/낙찰 알림은 카드가 오가는 보관함(오픈마켓 탭)으로 이동시킵니다.
  sendPushToUser(userId, title, body, '/inventory');
  notificationRepository.create({ user_id: userId, title, body, link: 'inventory' }).catch(() => { /* 무시 */ });
};

/**
 * 1. 오픈마켓 활성 매물 목록 조회 (검색, 정렬, 페이지네이션)
 * GET /api/market/listings
 */
export const listActiveListings = async (req: AuthenticatedRequest, res: Response) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.max(1, Number(req.query.limit || 12));
  const search = req.query.search ? String(req.query.search) : undefined;
  const sort = (req.query.sort || 'latest') as 'latest' | 'oldest' | 'price_desc' | 'price_asc' | 'ending_soon' | 'bid_desc';
  const type = (req.query.type || 'all') as 'all' | 'fixed' | 'auction';

  try {
    await settleExpiredAuctions();
    const result = await marketRepository.listActive({ page, limit, search, sort, type });
    return res.json(result);
  } catch (err: any) {
    console.error('[MarketController] listActiveListings 에러:', err);
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

  try {
    // 1) 내 소유 카드인지 검사
    const myCards = await userCardRepository.findByUserId(user.id);
    const targetCard = myCards.find(c => c.id === cardId);
    if (!targetCard) {
      return res.status(404).json({ error: 'NotFound', message: '소유하고 있지 않은 카드입니다.' });
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
    const ownedCount = myCards.filter(c => c.channel_id === targetCard.channel_id && (c.star ?? 0) === (targetCard.star ?? 0)).length;
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
        : null
    });
    await notifyMatchingWatches(listing);

    return res.json({ ok: true, listing });
  } catch (err: any) {
    console.error('[MarketController] createListing 에러:', err);
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

    await marketRepository.updateStatus(id, 'CANCELLED');
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[MarketController] cancelListing 에러:', err);
    return res.status(500).json({ error: 'ServerError', message: '등록 취소 중 오류가 발생했습니다.' });
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
    const settledAmount = result.settled_amount ?? Math.floor(price * 0.95);

    const title = '[오픈마켓] 카드 판매 완료';
    const body = `등록하신 [${streamerName}] ${star}성 카드가 판매되었습니다. 대금 ${price}P에서 수수료 5%를 제한 ${settledAmount}P가 계정으로 정산되었습니다.`;
    notify(listing.seller_id, title, body);

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
    const messageMap: Record<string, string> = {
      NOT_FOUND_OR_NOT_AUCTION: '진행 중인 경매 매물을 찾을 수 없습니다.',
      CANNOT_BID_OWN_ITEM: '본인의 경매에는 입찰할 수 없습니다.',
      AUCTION_ENDED: '이미 종료된 경매입니다.',
      BID_TOO_LOW: '현재가보다 100P 이상 높은 금액으로 입찰해 주세요.',
      INSUFFICIENT_POINT: '보유 포인트가 부족합니다.'
    };
    return res.status(400).json({ error: result.reason, message: messageMap[result.reason] || '입찰에 실패했습니다.' });
  }
  return res.status(200).json(result);
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
    const history = await marketRepository.listHistory(user.id);
    return res.json(history);
  } catch (err: any) {
    console.error('[MarketController] listMarketHistory 에러:', err);
    return res.status(500).json({ error: 'ServerError', message: '거래 내역을 가져오는 중 오류가 발생했습니다.' });
  }
};

const settleExpiredAuctions = async () => {
  const soldListings = await marketRepository.finishExpiredAuctions(new Date().toISOString());
  for (const listing of soldListings) {
    const streamerName = listing.card?.streamer?.name || '스트리머';
    const star = listing.card?.star ?? 0;
    const price = listing.price;
    notify(listing.seller_id, '[오픈마켓] 경매 낙찰 완료', `[${streamerName}] ${star}성 카드 경매가 ${price}P에 낙찰되었습니다.`);
    if (listing.buyer_id) {
      notify(listing.buyer_id, '[오픈마켓] 경매 낙찰', `[${streamerName}] ${star}성 카드 경매에 낙찰되어 카드가 보관함으로 이동했습니다.`);
    }
  }
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
      `${streamerName} ${star}성 카드가 ${price.toLocaleString()}P 조건으로 오픈마켓에 등록되었습니다.`
    );
  }
};
