import { Response } from 'express';
import { tradeRepository, userRepository, userCardRepository } from '../repositories';
import { TradeOffer } from '../repositories/interfaces';
import { AuthenticatedRequest } from '../middlewares/admin';
import { IS_PRODUCTION } from '../config';

/**
 * 거래 오퍼 형식을 검증하고 정규화합니다.
 */
const normalizeOffer = (raw: any): TradeOffer => {
  const cards = Array.isArray(raw?.cards)
    ? raw.cards
        .map((c: any) => ({ channel_id: String(c.channel_id), count: Math.floor(Number(c.count)) }))
        .filter((c: any) => c.channel_id && c.count > 0)
    : [];
  const point = Math.max(0, Math.floor(Number(raw?.point) || 0));
  return { cards, point };
};

const isEmptyOffer = (offer: TradeOffer): boolean => offer.cards.length === 0 && offer.point === 0;

/**
 * 특정 유저의 channel_id별 보유 카드 수량 맵을 구합니다.
 */
const getOwnedCountMap = async (userId: string): Promise<Record<string, number>> => {
  const cards = await userCardRepository.findByUserId(userId);
  const map: Record<string, number> = {};
  for (const c of cards) {
    map[c.channel_id] = (map[c.channel_id] || 0) + 1;
  }
  return map;
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

  const { receiver_username } = req.body;
  if (!receiver_username || !String(receiver_username).trim()) {
    return res.status(400).json({ error: 'BadRequest', message: '교환 상대방의 닉네임을 입력해 주세요.' });
  }

  const senderOffer = normalizeOffer(req.body.sender_offer);
  const receiverOffer = normalizeOffer(req.body.receiver_offer);

  if (isEmptyOffer(senderOffer) && isEmptyOffer(receiverOffer)) {
    return res.status(400).json({ error: 'BadRequest', message: '교환할 카드나 포인트를 최소 한 가지 이상 지정해 주세요.' });
  }

  try {
    const receiver = await userRepository.findByUsername(String(receiver_username).trim());
    if (!receiver) {
      return res.status(404).json({ error: 'NotFound', message: '해당 닉네임의 사용자를 찾을 수 없습니다.' });
    }
    if (receiver.id === sender.id) {
      return res.status(400).json({ error: 'BadRequest', message: '자기 자신과는 교환할 수 없습니다.' });
    }

    // 제안자가 실제로 제시한 카드/포인트를 보유 중인지 사전 검증 (체결 시 원자적으로 재검증됨)
    const ownedMap = await getOwnedCountMap(sender.id);
    for (const c of senderOffer.cards) {
      if ((ownedMap[c.channel_id] || 0) < c.count) {
        return res.status(400).json({ error: 'InsufficientCards', message: '제안하려는 카드를 충분히 보유하고 있지 않습니다.' });
      }
    }
    const freshSender = await userRepository.findById(sender.id);
    if (!freshSender || freshSender.point < senderOffer.point) {
      return res.status(400).json({ error: 'InsufficientPoint', message: '제안하려는 포인트가 보유 포인트를 초과합니다.' });
    }

    const trade = await tradeRepository.create({
      sender_id: sender.id,
      receiver_id: receiver.id,
      sender_offer: senderOffer,
      receiver_offer: receiverOffer
    });

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
    const result = await tradeRepository.confirm(tradeId, user.id);
    if (!result.ok) {
      return res.status(reasonToStatus(result.reason)).json({
        error: 'TradeFailed', reason: result.reason, message: REASON_MESSAGES[result.reason] || '거래 동의 처리에 실패했습니다.'
      });
    }
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
    const result = await tradeRepository.finalize(tradeId, user.id);
    if (!result.ok) {
      return res.status(reasonToStatus(result.reason)).json({
        error: 'TradeFailed', reason: result.reason, message: REASON_MESSAGES[result.reason] || '거래 체결에 실패했습니다.'
      });
    }
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
