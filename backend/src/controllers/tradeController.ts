import { Response } from 'express';
import { tradeRepository, userRepository, userCardRepository, notificationRepository, marketRepository, streamerRepository } from '../repositories';
import { TradeOffer, User, Trade } from '../repositories/interfaces';
import { AuthenticatedRequest } from '../middlewares/admin';
import { IS_PRODUCTION } from '../config';
import { sendPushToUser } from './pushController';

/** 푸시 + 인앱 알림함 동시 기록 (실패해도 무시) */
const notify = (userId: string, title: string, body: string) => {
  // 교환 신청/수락/거절 알림은 교환을 관리하는 보관함으로 이동시킵니다.
  sendPushToUser(userId, title, body, '/inventory');
  notificationRepository.create({ user_id: userId, title, body, link: 'inventory' }).catch(() => { /* 무시 */ });
};

const normalizeTradeRejectReason = (value: unknown): { ok: true; reason: string } | { ok: false; message: string } => {
  if (value == null) return { ok: true, reason: '' };
  const reason = String(value).trim();
  if (Array.from(reason).length > 30) {
    return { ok: false, message: '거절 사유는 30자 이내로 입력해 주세요.' };
  }
  return { ok: true, reason };
};

const TRADE_ACCOUNT_MIN_AGE_MS = 24 * 60 * 60 * 1000;

const parseUserCreatedAtMs = (createdAt?: string | null): number => {
  if (!createdAt) return NaN;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(createdAt)
    ? `${createdAt.replace(' ', 'T')}Z`
    : createdAt;
  return new Date(normalized).getTime();
};

const findTradeAgeRestriction = (sender: User, receiver: User, nowMs = Date.now()): { message: string; availableAt?: string } | null => {
  const checks = [
    { user: sender, label: '제안자' },
    { user: receiver, label: '상대방' }
  ];

  for (const { user, label } of checks) {
    const createdMs = parseUserCreatedAtMs(user.created_at);
    if (!Number.isFinite(createdMs)) {
      return {
        message: `${label} 계정의 가입 시각을 확인할 수 없어 1:1 교환을 진행할 수 없습니다.`
      };
    }

    const availableMs = createdMs + TRADE_ACCOUNT_MIN_AGE_MS;
    if (nowMs < availableMs) {
      return {
        message: `1:1 교환은 가입 후 24시간이 지난 계정끼리만 가능합니다. ${label} 계정은 아직 교환할 수 없습니다.`,
        availableAt: new Date(availableMs).toISOString()
      };
    }
  }

  return null;
};

const loadTradeParticipants = async (trade: Trade): Promise<{ sender: User; receiver: User } | null> => {
  const [sender, receiver] = await Promise.all([
    userRepository.findById(trade.sender_id),
    userRepository.findById(trade.receiver_id)
  ]);
  if (!sender || !receiver) return null;
  return { sender, receiver };
};

const sendTradeAgeBlocked = (res: Response, restriction: { message: string; availableAt?: string }) =>
  res.status(403).json({
    error: 'TradeAccountTooNew',
    reason: 'ACCOUNT_TOO_NEW',
    message: restriction.message,
    available_at: restriction.availableAt
  });

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
  return { cards, point, with_cosmetics: raw?.with_cosmetics === true };
};

const isEmptyOffer = (offer: TradeOffer): boolean => offer.cards.length === 0 && offer.point === 0;

const collectOfferChannelIds = (trade: Trade) => [
  ...(trade.sender_offer?.cards || []),
  ...(trade.receiver_offer?.cards || [])
].map((card) => card.channel_id).filter(Boolean);

type UserCardForTrade = Awaited<ReturnType<typeof userCardRepository.findByUserId>>[number];

const cosmeticName = (type: 'border' | 'name_effect', item?: { id?: number; name?: string | null } | null) => {
  if (!item?.id) return null;
  return item.name || (type === 'border' ? `테두리 #${item.id}` : `이름 효과 #${item.id}`);
};

const decorateOfferCosmetics = (offer: TradeOffer, ownerCards: UserCardForTrade[] = []): TradeOffer['cards'] => {
  const buckets = new Map<string, UserCardForTrade[]>();
  for (const card of ownerCards) {
    const key = cardKey(card.channel_id, card.star);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(card);
  }

  return (offer.cards || []).map((card) => {
    const star = card.star ?? 0;
    const key = cardKey(card.channel_id, star);
    const selectedCards = (buckets.get(key) || []).splice(0, Math.max(0, Number(card.count || 0)));
    const cosmetics = selectedCards
      .map((ownedCard) => {
        const borderName = cosmeticName('border', ownedCard.border);
        const nameEffectName = cosmeticName('name_effect', ownedCard.name_effect);
        if (!borderName && !nameEffectName) return null;
        return {
          border: ownedCard.border?.id ? { id: ownedCard.border.id, name: borderName } : null,
          name_effect: ownedCard.name_effect?.id ? { id: ownedCard.name_effect.id, name: nameEffectName } : null
        };
      })
      .filter((item): item is NonNullable<typeof item> => !!item);
    return {
      ...card,
      cosmetics
    };
  });
};

const enrichOffer = (
  offer: TradeOffer,
  streamerMap: Map<string, { name: string; logo_url: string | null }>,
  ownerCards: UserCardForTrade[] = []
) => ({
  ...offer,
  with_cosmetics: offer.with_cosmetics === true,
  cards: decorateOfferCosmetics(offer, ownerCards).map((card) => {
    const streamer = streamerMap.get(card.channel_id);
    return {
      ...card,
      streamer_name: streamer?.name || null,
      streamer_logo_url: streamer?.logo_url || null
    };
  })
});

const enrichTradesForUser = async (trades: Trade[], userId: string) => {
  const channelIds = [...new Set(trades.flatMap(collectOfferChannelIds))];
  const streamers = channelIds.length > 0
    ? await streamerRepository.findByIds(channelIds).catch(() => [])
    : [];
  const streamerMap = new Map(streamers.map((streamer) => [
    streamer.channel_id,
    { name: streamer.name, logo_url: streamer.logo_url }
  ]));
  const participantIds = [...new Set(trades.flatMap((trade) => [
    (trade.sender_offer?.cards || []).length > 0 ? trade.sender_id : null,
    (trade.receiver_offer?.cards || []).length > 0 ? trade.receiver_id : null
  ]).filter((id): id is string => !!id))];
  const cardsByUser = new Map<string, UserCardForTrade[]>();
  await Promise.all(participantIds.map(async (participantId) => {
    cardsByUser.set(participantId, await userCardRepository.findByUserId(participantId).catch(() => []));
  }));

  return trades.map((trade) => ({
    ...trade,
    sender_offer: enrichOffer(trade.sender_offer, streamerMap, cardsByUser.get(trade.sender_id)),
    receiver_offer: enrichOffer(trade.receiver_offer, streamerMap, cardsByUser.get(trade.receiver_id)),
    direction: trade.sender_id === userId ? 'outgoing' : 'incoming'
  }));
};

const enrichTradesForAdmin = async (trades: Trade[]) => {
  const channelIds = [...new Set(trades.flatMap(collectOfferChannelIds))];
  const streamers = channelIds.length > 0
    ? await streamerRepository.findByIds(channelIds).catch(() => [])
    : [];
  const streamerMap = new Map(streamers.map((streamer) => [
    streamer.channel_id,
    { name: streamer.name, logo_url: streamer.logo_url }
  ]));
  const participantIds = [...new Set(trades.flatMap((trade) => [
    (trade.sender_offer?.cards || []).length > 0 ? trade.sender_id : null,
    (trade.receiver_offer?.cards || []).length > 0 ? trade.receiver_id : null
  ]).filter((id): id is string => !!id))];
  const cardsByUser = new Map<string, UserCardForTrade[]>();
  await Promise.all(participantIds.map(async (participantId) => {
    cardsByUser.set(participantId, await userCardRepository.findByUserId(participantId).catch(() => []));
  }));

  return trades.map((trade) => ({
    ...trade,
    sender_offer: enrichOffer(trade.sender_offer, streamerMap, cardsByUser.get(trade.sender_id)),
    receiver_offer: enrichOffer(trade.receiver_offer, streamerMap, cardsByUser.get(trade.receiver_id))
  }));
};

// 카드 식별 복합키: 채널 + 별
const cardKey = (channelId: string, star?: number) => `${channelId}#${star ?? 0}`;

const aggregateOfferCardsByStar = (offer: TradeOffer): Record<string, { channel_id: string; star: number; count: number }> => {
  const map: Record<string, { channel_id: string; star: number; count: number }> = {};
  for (const card of offer.cards || []) {
    const star = card.star ?? 0;
    const key = cardKey(card.channel_id, star);
    if (!map[key]) map[key] = { channel_id: card.channel_id, star, count: 0 };
    map[key].count += card.count;
  }
  return map;
};

/**
 * 특정 유저의 (채널+별)별 보유 카드 수량 맵을 구합니다.
 */
const getOwnedByStarMap = async (userId: string): Promise<Record<string, number>> => {
  const cards = await userCardRepository.findByUserId(userId);
  const map: Record<string, number> = {};
  for (const c of cards) {
    if (c.is_locked) continue;
    map[cardKey(c.channel_id, c.star)] = (map[cardKey(c.channel_id, c.star)] || 0) + 1;
  }
  return map;
};

const validateOfferCardAvailability = async (
  userId: string,
  offer: TradeOffer,
  options: { selfReservation?: boolean } = {}
): Promise<{ ok: true } | { ok: false; key: string; requested: number; owned: number; reserved: number }> => {
  const requestedByStar = aggregateOfferCardsByStar(offer);
  const entries = Object.entries(requestedByStar);
  if (entries.length === 0) return { ok: true };

  const [ownedByStar, reservations] = await Promise.all([
    getOwnedByStarMap(userId),
    getUserReservations(userId)
  ]);

  for (const [key, requested] of entries) {
    const owned = ownedByStar[key] || 0;
    const reserved = reservations.cardsByStar[key] || 0;
    const selfReservation = options.selfReservation ? requested.count : 0;
    const available = owned - Math.max(0, reserved - selfReservation);
    if (available < requested.count) {
      return { ok: false, key, requested: requested.count, owned, reserved };
    }
  }

  return { ok: true };
};

const tradeUnavailableMessage = (targetLabel: string) =>
  `${targetLabel} 카드 중 잠금, 마켓 판매 중, 다른 교환에 묶인 카드가 있어 교환할 수 없습니다.`;

/**
 * 진행 중인 거래에 묶여(에스크로) 있는 유저의 카드/포인트 예약량을 계산합니다.
 * - 제안자 측: PENDING/CONFIRMED 모두 제시품(sender_offer)이 예약됨
 * - 수신자 측: CONFIRMED(동의 완료)일 때 요청받은 품목(receiver_offer)이 예약됨
 * 다른 곳(판매/신규 제안)에서 available = 보유 - 예약 으로 검증해 이중 지출을 막습니다.
 */
export const getUserReservations = async (userId: string): Promise<{ cards: Record<string, number>; cardsByStar: Record<string, number>; points: number }> => {
  const active = await Promise.resolve(tradeRepository.findActiveByUser(userId)).catch(() => []);
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

  for (const t of Array.isArray(active) ? active : []) {
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
    const freshSender = await userRepository.findById(sender.id);
    if (!freshSender) {
      return res.status(404).json({ error: 'NotFound', message: '제안자 정보를 찾을 수 없습니다.' });
    }
    const ageRestriction = findTradeAgeRestriction(freshSender, receiver);
    if (ageRestriction) {
      return sendTradeAgeBlocked(res, ageRestriction);
    }

    // 수신자가 제안자를 차단한 경우 교환 제안 불가
    if (await userRepository.isBlocked(receiver.id, sender.id)) {
      return res.status(403).json({ error: 'Blocked', message: '상대방에게 교환을 제안할 수 없습니다. (차단됨)' });
    }

    // 제안자가 제시한 카드와 상대방에게 요청한 카드가 모두 "사용 가능"한지 검증합니다.
    // 마켓 판매 중인 카드도 예약량에 포함되므로 교환 요청 생성 단계에서 차단됩니다.
    const senderCardsAvailable = await validateOfferCardAvailability(sender.id, senderOffer);
    if (!senderCardsAvailable.ok) {
      return res.status(400).json({
        error: 'InsufficientCards',
        reason: 'SENDER_CARDS_UNAVAILABLE',
        message: tradeUnavailableMessage('제안하려는')
      });
    }
    const receiverCardsAvailable = await validateOfferCardAvailability(receiver.id, receiverOffer);
    if (!receiverCardsAvailable.ok) {
      return res.status(400).json({
        error: 'InsufficientCards',
        reason: 'RECEIVER_CARDS_UNAVAILABLE',
        message: tradeUnavailableMessage('상대방에게 요청한')
      });
    }
    const reservations = await getUserReservations(sender.id);
    const availablePoint = (freshSender?.point ?? 0) - reservations.points;
    if (availablePoint < senderOffer.point) {
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
    return res.status(200).json(await enrichTradesForUser(trades, user.id));
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
  SENDER_POINT_SHORT: '제안자가 건네야 할 포인트가 부족하여 체결할 수 없습니다.',
  RECEIVER_POINT_SHORT: '수락자가 건네야 할 포인트가 부족하여 체결할 수 없습니다.',
  USER_NOT_FOUND: '거래 당사자 정보를 찾을 수 없습니다.'
};

const reasonToStatus = (reason: string): number =>
  reason === 'NOT_FOUND' ? 404 : reason === 'FORBIDDEN' ? 403 : 400;

const formatPoint = (point: number) => `${Math.max(0, Math.floor(point)).toLocaleString('ko-KR')}P`;

const pointShortPayload = (
  reason: 'SENDER_POINT_SHORT' | 'RECEIVER_POINT_SHORT',
  label: string,
  required: number,
  owned: number,
  reserved = 0
) => {
  const available = Math.max(0, owned - reserved);
  return {
    error: 'TradeFailed',
    reason,
    message: `${label} 건네야 할 포인트가 부족합니다. 필요 ${formatPoint(required)} / 사용 가능 ${formatPoint(available)} (보유 ${formatPoint(owned)}, 다른 거래 예약 ${formatPoint(reserved)})`,
    required_point: required,
    owned_point: owned,
    reserved_point: reserved,
    available_point: available
  };
};

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
    if (!trade) {
      return res.status(404).json({ error: 'TradeFailed', reason: 'NOT_FOUND', message: REASON_MESSAGES.NOT_FOUND });
    }
    if (trade.status !== 'PENDING') {
      return res.status(400).json({ error: 'TradeFailed', reason: 'NOT_PENDING', message: REASON_MESSAGES.NOT_PENDING });
    }
    if (trade.receiver_id !== user.id) {
      return res.status(403).json({ error: 'TradeFailed', reason: 'FORBIDDEN', message: REASON_MESSAGES.FORBIDDEN });
    }
    const participants = await loadTradeParticipants(trade);
    if (!participants) {
      return res.status(400).json({ error: 'TradeFailed', reason: 'USER_NOT_FOUND', message: REASON_MESSAGES.USER_NOT_FOUND });
    }
    const ageRestriction = findTradeAgeRestriction(participants.sender, participants.receiver);
    if (ageRestriction) {
      return sendTradeAgeBlocked(res, ageRestriction);
    }
    const senderCardsAvailable = await validateOfferCardAvailability(trade.sender_id, trade.sender_offer, { selfReservation: true });
    if (!senderCardsAvailable.ok) {
      return res.status(400).json({
        error: 'TradeFailed',
        reason: 'SENDER_CARDS_UNAVAILABLE',
        message: tradeUnavailableMessage('제안자가 제시한')
      });
    }
    const receiverCardsAvailable = await validateOfferCardAvailability(trade.receiver_id, trade.receiver_offer);
    if (!receiverCardsAvailable.ok) {
      return res.status(400).json({
        error: 'TradeFailed',
        reason: 'RECEIVER_CARDS_UNAVAILABLE',
        message: tradeUnavailableMessage('내가 건네야 할')
      });
    }
    const receiverReservations = await getUserReservations(trade.receiver_id);
    const receiverPointRequired = Number(trade.receiver_offer?.point || 0);
    const receiverPointOwned = Number(participants.receiver.point || 0);
    const receiverPointAvailable = receiverPointOwned - receiverReservations.points;
    if (receiverPointRequired > 0 && receiverPointAvailable < receiverPointRequired) {
      return res.status(400).json(pointShortPayload(
        'RECEIVER_POINT_SHORT',
        '내가',
        receiverPointRequired,
        receiverPointOwned,
        receiverReservations.points
      ));
    }
    const receiverWithCosmeticsProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'with_cosmetics');
    const result = receiverWithCosmeticsProvided
      ? await tradeRepository.confirm(tradeId, user.id, { receiverWithCosmetics: req.body?.with_cosmetics === true })
      : await tradeRepository.confirm(tradeId, user.id);
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
    if (!trade) {
      return res.status(404).json({ error: 'TradeFailed', reason: 'NOT_FOUND', message: REASON_MESSAGES.NOT_FOUND });
    }
    if (trade.status !== 'CONFIRMED') {
      return res.status(400).json({ error: 'TradeFailed', reason: 'NOT_CONFIRMED', message: REASON_MESSAGES.NOT_CONFIRMED });
    }
    if (trade.sender_id !== user.id) {
      return res.status(403).json({ error: 'TradeFailed', reason: 'FORBIDDEN', message: REASON_MESSAGES.FORBIDDEN });
    }
    const participants = await loadTradeParticipants(trade);
    if (!participants) {
      return res.status(400).json({ error: 'TradeFailed', reason: 'USER_NOT_FOUND', message: REASON_MESSAGES.USER_NOT_FOUND });
    }
    const ageRestriction = findTradeAgeRestriction(participants.sender, participants.receiver);
    if (ageRestriction) {
      return sendTradeAgeBlocked(res, ageRestriction);
    }
    const senderCardsAvailable = await validateOfferCardAvailability(trade.sender_id, trade.sender_offer, { selfReservation: true });
    if (!senderCardsAvailable.ok) {
      return res.status(400).json({
        error: 'TradeFailed',
        reason: 'SENDER_CARDS_UNAVAILABLE',
        message: tradeUnavailableMessage('제안자가 제시한')
      });
    }
    const receiverCardsAvailable = await validateOfferCardAvailability(trade.receiver_id, trade.receiver_offer, { selfReservation: true });
    if (!receiverCardsAvailable.ok) {
      return res.status(400).json({
        error: 'TradeFailed',
        reason: 'RECEIVER_CARDS_UNAVAILABLE',
        message: tradeUnavailableMessage('상대방이 건네야 할')
      });
    }
    const senderPointRequired = Number(trade.sender_offer?.point || 0);
    const receiverPointRequired = Number(trade.receiver_offer?.point || 0);
    const senderPointOwned = Number(participants.sender.point || 0);
    const receiverPointOwned = Number(participants.receiver.point || 0);
    if (senderPointOwned < senderPointRequired) {
      return res.status(400).json(pointShortPayload(
        'SENDER_POINT_SHORT',
        '제안자가',
        senderPointRequired,
        senderPointOwned
      ));
    }
    if (receiverPointOwned < receiverPointRequired) {
      return res.status(400).json(pointShortPayload(
        'RECEIVER_POINT_SHORT',
        '수락자가',
        receiverPointRequired,
        receiverPointOwned
      ));
    }
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
    const parsedRejectReason = nextStatus === 'REJECTED'
      ? normalizeTradeRejectReason(req.body?.reason)
      : { ok: true as const, reason: '' };
    if (!parsedRejectReason.ok) {
      return res.status(400).json({ error: 'BadRequest', message: parsedRejectReason.message });
    }
    await tradeRepository.updateStatus(tradeId, nextStatus);

    // 상대방에게 결과 푸시
    const counterpartId = trade.sender_id === user.id ? trade.receiver_id : trade.sender_id;
    const rejectBody = parsedRejectReason.reason
      ? `${user.username}님이 교환 제안을 거절했어요. 사유: ${parsedRejectReason.reason}`
      : `${user.username}님이 교환 제안을 거절했어요.`;
    notify(
      counterpartId,
      nextStatus === 'CANCELLED' ? '교환 취소됨' : '교환 거절됨',
      nextStatus === 'CANCELLED' ? `${user.username}님이 교환 제안을 취소했어요.` : rejectBody
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
    return res.status(200).json(await enrichTradesForUser(trades, user.id));
  } catch (err: any) {
    console.error('[TradeController] getTradeHistory 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '교환 이력 조회에 실패했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

const ADMIN_TRADE_STATUSES = new Set<Trade['status']>(['PENDING', 'CONFIRMED', 'ACCEPTED', 'REJECTED', 'CANCELLED']);

export const getAdminTradeHistory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
    const limit = Math.max(1, Math.min(100, Math.floor(Number(req.query.limit) || 30)));
    const search = String(req.query.search || '').trim().slice(0, 80);
    const rawStatus = String(req.query.status || 'ALL').toUpperCase();
    const status = ADMIN_TRADE_STATUSES.has(rawStatus as Trade['status'])
      ? rawStatus as Trade['status']
      : 'ALL';

    const result = await tradeRepository.listForAdmin({ page, limit, search, status });
    return res.status(200).json({
      ...result,
      items: await enrichTradesForAdmin(result.items)
    });
  } catch (err: any) {
    console.error('[TradeController] getAdminTradeHistory 에러:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: '관리자 교환 이력 조회에 실패했습니다.',
      details: IS_PRODUCTION ? undefined : err.message
    });
  }
};
