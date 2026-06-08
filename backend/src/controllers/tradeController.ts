import { Response } from 'express';
import { tradeRepository, userRepository, userCardRepository, notificationRepository, marketRepository } from '../repositories';
import { TradeOffer } from '../repositories/interfaces';
import { AuthenticatedRequest } from '../middlewares/admin';
import { IS_PRODUCTION } from '../config';
import { sendPushToUser } from './pushController';

/** 푸시 + 인앱 알림함 동시 기록 (실패해도 무시) */
const notify = (userId: string, title: string, body: string) => {
  // 교환 신청/수락/거절 알림은 교환을 관리하는 보관함으로 이동시킵니다.
  sendPushToUser(userId, title, body, '/inventory');
  notificationRepository.create({ user_id: userId, title, body, link: 'inventory' }).catch(() => { /* 무시 */ });
};

/**
 * 거래 오퍼 형식을 검증하고 정규화합니다.
 */
const normalizeOffer = (raw: any): TradeOffer => {
  const cards = Array.isArray(raw?.cards)
    ? raw.cards
        .map((c: any) => ({
          channel_id: String(c.channel_id),
          star: Math.max(0, Math.min(5, Math.floor(Number(c.star) || 0))),
          count: Math.floor(Number(c.count))
        }))
        .filter((c: any) => c.channel_id && c.count > 0)
    : [];
  const point = Math.max(0, Math.floor(Number(raw?.point) || 0));
  return { cards, point };
};

const isEmptyOffer = (offer: TradeOffer): boolean => offer.cards.length === 0 && offer.point === 0;

// 카드 식별 복합키: 채널 + 별
const cardKey = (channelId: string, star?: number) => `${channelId}#${star ?? 0}`;

/**
 * 특정 유저의 (채널+별)별 보유 카드 수량 맵을 구합니다.
 */
const getOwnedByStarMap = async (userId: string): Promise<Record<string, number>> => {
  const cards = await userCardRepository.findByUserId(userId);
  const map: Record<string, number> = {};
  for (const c of cards) {
    map[cardKey(c.channel_id, c.star)] = (map[cardKey(c.channel_id, c.star)] || 0) + 1;
  }
  return map;
};

/**
 * 진행 중인 거래에 묶여(에스크로) 있는 유저의 카드/포인트 예약량을 계산합니다.
 * - 제안자 측: PENDING/CONFIRMED 모두 제시품(sender_offer)이 예약됨
 * - 수신자 측: CONFIRMED(동의 완료)일 때 요청받은 품목(receiver_offer)이 예약됨
 * 다른 곳(판매/신규 제안)에서 available = 보유 - 예약 으로 검증해 이중 지출을 막습니다.
 */
export const getUserReservations = async (userId: string): Promise<{ cards: Record<string, number>; cardsByStar: Record<string, number>; points: number }> => {
  const active = await tradeRepository.findActiveByUser(userId);
  const cards: Record<string, number> = {};        // 채널 단위 합산(판매 가드용 하위호환)
  const cardsByStar: Record<string, number> = {};  // 채널+별 복합키(교환 검증용)
  let points = 0;

  const reserve = (offer: TradeOffer | undefined) => {
    if (!offer) return;
    for (const c of offer.cards || []) {
      cards[c.channel_id] = (cards[c.channel_id] || 0) + c.count;
      cardsByStar[cardKey(c.channel_id, c.star)] = (cardsByStar[cardKey(c.channel_id, c.star)] || 0) + c.count;
    }
    points += offer.point || 0;
  };

  for (const t of active) {
    if (t.sender_id === userId) reserve(t.sender_offer);
    if (t.receiver_id === userId && t.status === 'CONFIRMED') reserve(t.receiver_offer);
  }

  // 오픈마켓 PENDING 매물 카드들 예약량에 가산
  try {
    const myListings = await marketRepository.listByUser(userId);
    const pendingListings = myListings.filter(l => l.status === 'PENDING');
    for (const l of pendingListings) {
      if (l.card) {
        const cid = l.card.channel_id;
        const star = l.card.star ?? 0;
        cards[cid] = (cards[cid] || 0) + 1;
        cardsByStar[cardKey(cid, star)] = (cardsByStar[cardKey(cid, star)] || 0) + 1;
      }
    }
  } catch (err) {
    console.error('[Escrow] 오픈마켓 예약 로드 실패:', err);
  }

  return { cards, cardsByStar, points };
};

/**
 * 1. 새로운 1:1 교환 제안 생성
 * Body: { receiver_username, sender_offer, receiver_offer }
 */
export const createTrade = async (req: AuthenticatedRequest, res: Response) => {
  const sender = req.user;
  if (!sender) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  const { receiver_id, receiver_username } = req.body;
  if (!receiver_id && !(receiver_username && String(receiver_username).trim())) {
    return res.status(400).json({ error: 'BadRequest', message: '교환 상대방을 지정해 주세요.' });
  }

  const senderOffer = normalizeOffer(req.body.sender_offer);
  const receiverOffer = normalizeOffer(req.body.receiver_offer);

  if (isEmptyOffer(senderOffer) && isEmptyOffer(receiverOffer)) {
    return res.status(400).json({ error: 'BadRequest', message: '교환할 카드나 포인트를 최소 한 가지 이상 지정해 주세요.' });
  }

  try {
    // 검색 선택 시 receiver_id 우선, 없으면 닉네임으로 조회
    const receiver = receiver_id
      ? await userRepository.findById(String(receiver_id))
      : await userRepository.findByUsername(String(receiver_username).trim());
    if (!receiver) {
      return res.status(404).json({ error: 'NotFound', message: '해당 사용자를 찾을 수 없습니다.' });
    }
    if (receiver.id === sender.id) {
      return res.status(400).json({ error: 'BadRequest', message: '자기 자신과는 교환할 수 없습니다.' });
    }

    // 수신자가 제안자를 차단한 경우 교환 제안 불가
    if (await userRepository.isBlocked(receiver.id, sender.id)) {
      return res.status(403).json({ error: 'Blocked', message: '상대방에게 교환을 제안할 수 없습니다. (차단됨)' });
    }

    // 제안자가 제시한 카드/포인트가 "사용 가능"한지 검증
    // (보유량에서 이미 다른 진행 중 거래에 묶인 예약량을 뺀 값 기준 → 이중 지출 방지)
    const ownedByStar = await getOwnedByStarMap(sender.id);
    const reservations = await getUserReservations(sender.id);
    for (const c of senderOffer.cards) {
      const key = cardKey(c.channel_id, c.star);
      const available = (ownedByStar[key] || 0) - (reservations.cardsByStar[key] || 0);
      if (available < c.count) {
        return res.status(400).json({ error: 'InsufficientCards', message: '제안하려는 카드가 부족합니다. (이미 다른 거래에 묶여 있을 수 있어요)' });
      }
    }
    const freshSender = await userRepository.findById(sender.id);
    const availablePoint = (freshSender?.point ?? 0) - reservations.points;
    if (!freshSender || availablePoint < senderOffer.point) {
      return res.status(400).json({ error: 'InsufficientPoint', message: '제안하려는 포인트가 부족합니다. (다른 거래에 묶인 포인트 제외)' });
    }

    const trade = await tradeRepository.create({
      sender_id: sender.id,
      receiver_id: receiver.id,
      sender_offer: senderOffer,
      receiver_offer: receiverOffer
    });

    // 수신자에게 새 교환 제안 알림
    notify(receiver.id, '새 교환 제안 📩', `${sender.username}님이 카드 교환을 제안했어요.`);

    return res.status(201).json({
      message: `${receiver.username}님에게 교환을 제안했습니다.`,
      trade
    });
  } catch (err: any) {
    console.error('[TradeController] createTrade 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '교환 제안 생성에 실패했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 2. 내가 보내거나 받은 진행 중(PENDING) 교환 목록 조회
 */
export const getActiveTrades = async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  try {
    const trades = await tradeRepository.findActiveByUser(user.id);
    // 방향 표시 정보를 덧붙여 프론트가 받은/보낸 거래를 구분하기 쉽게 함
    const mapped = trades.map((t) => ({
      ...t,
      direction: t.sender_id === user.id ? 'outgoing' : 'incoming'
    }));
    return res.status(200).json(mapped);
  } catch (err: any) {
    console.error('[TradeController] getActiveTrades 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '교환 목록 조회에 실패했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

const REASON_MESSAGES: Record<string, string> = {
  NOT_FOUND: '존재하지 않는 거래입니다.',
  NOT_PENDING: '이미 처리되었거나 취소된 거래입니다.',
  NOT_CONFIRMED: '수신자 동의가 완료되지 않았거나 이미 처리된 거래입니다.',
  FORBIDDEN: '이 거래를 처리할 권한이 없습니다.',
  CARD_SHORTAGE: '거래 당사자 중 한쪽의 카드 보유 수량이 부족하여 체결할 수 없습니다.',
  SENDER_POINT_SHORT: '제안자의 포인트가 부족하여 체결할 수 없습니다.',
  RECEIVER_POINT_SHORT: '수락자의 포인트가 부족하여 체결할 수 없습니다.',
  USER_NOT_FOUND: '거래 당사자 정보를 찾을 수 없습니다.'
};

const reasonToStatus = (reason: string): number =>
  reason === 'NOT_FOUND' ? 404 : reason === 'FORBIDDEN' ? 403 : 400;

/**
 * 3-1. 교환 1단계: 수신자가 조건에 동의 (PENDING → CONFIRMED)
 */
export const confirmTrade = async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });

  const tradeId = Number(req.params.trade_id);
  if (!tradeId) return res.status(400).json({ error: 'BadRequest', message: '유효한 거래 ID가 필요합니다.' });

  try {
    const trade = await tradeRepository.findById(tradeId);
    const result = await tradeRepository.confirm(tradeId, user.id);
    if (!result.ok) {
      return res.status(reasonToStatus(result.reason)).json({
        error: 'TradeFailed', reason: result.reason, message: REASON_MESSAGES[result.reason] || '거래 동의 처리에 실패했습니다.'
      });
    }
    // 제안자에게 최종 승인 요청 알림
    if (trade) notify(trade.sender_id, '교환 동의됨 ✅', `${user.username}님이 교환에 동의했어요. 최종 승인이 필요합니다.`);
    return res.status(200).json({ message: '교환 조건에 동의했습니다. 제안자의 최종 승인을 기다립니다.' });
  } catch (err: any) {
    console.error('[TradeController] confirmTrade 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '교환 동의 처리에 실패했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 3-2. 교환 2단계: 제안자가 최종 승인하여 원자적 체결 (CONFIRMED → ACCEPTED)
 */
export const finalizeTrade = async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });

  const tradeId = Number(req.params.trade_id);
  if (!tradeId) return res.status(400).json({ error: 'BadRequest', message: '유효한 거래 ID가 필요합니다.' });

  try {
    const trade = await tradeRepository.findById(tradeId);
    const result = await tradeRepository.finalize(tradeId, user.id);
    if (!result.ok) {
      return res.status(reasonToStatus(result.reason)).json({
        error: 'TradeFailed', reason: result.reason, message: REASON_MESSAGES[result.reason] || '거래 체결에 실패했습니다.'
      });
    }
    // 수신자에게 체결 완료 알림
    if (trade) notify(trade.receiver_id, '교환 체결 🤝', `${user.username}님과의 카드 교환이 완료되었어요!`);
    return res.status(200).json({ message: '교환이 성공적으로 체결되었습니다.' });
  } catch (err: any) {
    console.error('[TradeController] finalizeTrade 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '교환 체결 처리에 실패했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 4. 교환 거절(수신자) 또는 취소(제안자) — PENDING/CONFIRMED 모두 가능
 */
export const rejectTrade = async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  const tradeId = Number(req.params.trade_id);
  if (!tradeId) {
    return res.status(400).json({ error: 'BadRequest', message: '유효한 거래 ID가 필요합니다.' });
  }

  try {
    const trade = await tradeRepository.findById(tradeId);
    if (!trade) {
      return res.status(404).json({ error: 'NotFound', message: '존재하지 않는 거래입니다.' });
    }
    if (trade.status !== 'PENDING' && trade.status !== 'CONFIRMED') {
      return res.status(400).json({ error: 'BadRequest', message: '이미 처리된 거래입니다.' });
    }
    if (trade.sender_id !== user.id && trade.receiver_id !== user.id) {
      return res.status(403).json({ error: 'Forbidden', message: '이 거래를 처리할 권한이 없습니다.' });
    }

    // 제안자가 취소하면 CANCELLED, 수신자가 거절하면 REJECTED
    const nextStatus = trade.sender_id === user.id ? 'CANCELLED' : 'REJECTED';
    await tradeRepository.updateStatus(tradeId, nextStatus);

    // 상대방에게 결과 푸시
    const counterpartId = trade.sender_id === user.id ? trade.receiver_id : trade.sender_id;
    notify(
      counterpartId,
      nextStatus === 'CANCELLED' ? '교환 취소됨' : '교환 거절됨',
      nextStatus === 'CANCELLED' ? `${user.username}님이 교환 제안을 취소했어요.` : `${user.username}님이 교환 제안을 거절했어요.`
    );

    return res.status(200).json({
      message: nextStatus === 'CANCELLED' ? '교환 제안을 취소했습니다.' : '교환 제안을 거절했습니다.'
    });
  } catch (err: any) {
    console.error('[TradeController] rejectTrade 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '교환 거절 처리에 실패했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 5. 종료된 교환 이력 조회 (체결/거절/취소)
 */
export const getTradeHistory = async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });

  try {
    const trades = await tradeRepository.findHistoryByUser(user.id, 50);
    const mapped = trades.map((t) => ({
      ...t,
      direction: t.sender_id === user.id ? 'outgoing' : 'incoming'
    }));
    return res.status(200).json(mapped);
  } catch (err: any) {
    console.error('[TradeController] getTradeHistory 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '교환 이력 조회에 실패했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};
