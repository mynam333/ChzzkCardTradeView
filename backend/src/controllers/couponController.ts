import { Request, Response } from 'express';
import { couponRepository, streamerRepository, titleRepository } from '../repositories';
import crypto from 'crypto';
import { AuthenticatedRequest } from '../middlewares/admin';
import { IS_PRODUCTION } from '../config';
import { getItem as getShopItem } from '../services/shopService';
import { normalizeCouponCode } from '../utils/couponCode';
import { CouponReward } from '../repositories/interfaces';
import { COUPON_REWARD_TYPES, couponToRewards } from '../utils/couponRewards';
import { recordAchievementEvent } from '../services/achievementService';

const normalizePositiveInt = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : 0;
};

const normalizeRewardsFromBody = (body: any): { rewards?: CouponReward[]; message?: string } => {
  const rawRewards = Array.isArray(body.rewards) && body.rewards.length > 0
    ? body.rewards
    : [{
        type: body.reward_type || 'point',
        points: body.points,
        channel_id: body.reward_channel_id,
        item_id: body.reward_item_id,
        title_id: body.reward_title_id,
        quantity: body.reward_quantity
  }];

  if (rawRewards.length === 0) return { message: '쿠폰 보상을 1개 이상 설정해 주세요.' };

  const rewards: CouponReward[] = [];
  for (const rawReward of rawRewards) {
    const type = rawReward?.type;
    if (!COUPON_REWARD_TYPES.includes(type)) {
      return { message: '보상 종류는 point · card · cosmetic · minigame_ticket · free_draw_ticket · title만 가능합니다.' };
    }

    if (type === 'point') {
      const points = normalizePositiveInt(rawReward.points);
      if (points <= 0) return { message: '재화 보상은 0보다 큰 지급 포인트가 필요합니다.' };
      rewards.push({ type, points });
    } else if (type === 'card') {
      const channelId = String(rawReward.channel_id || '').trim();
      const quantity = normalizePositiveInt(rawReward.quantity);
      if (!channelId) return { message: '카드 보상은 지급할 스트리머 채널 ID가 필요합니다.' };
      if (quantity <= 0) return { message: '카드 보상은 0보다 큰 지급 수량이 필요합니다.' };
      rewards.push({ type, channel_id: channelId, quantity });
    } else if (type === 'cosmetic') {
      const itemId = normalizePositiveInt(rawReward.item_id);
      const quantity = normalizePositiveInt(rawReward.quantity);
      if (!itemId) return { message: '코스메틱 보상은 지급할 상점 아이템을 선택해야 합니다.' };
      if (quantity <= 0) return { message: '코스메틱 보상은 0보다 큰 지급 수량이 필요합니다.' };
      rewards.push({ type, item_id: itemId, quantity });
    } else if (type === 'title') {
      const titleId = normalizePositiveInt(rawReward.title_id ?? rawReward.item_id);
      if (!titleId) return { message: '칭호 보상은 지급할 칭호를 선택해야 합니다.' };
      rewards.push({ type, title_id: titleId });
    } else {
      const quantity = normalizePositiveInt(rawReward.quantity);
      if (quantity <= 0) {
        return { message: type === 'free_draw_ticket' ? '무료 소환 티켓 보상은 0보다 큰 지급 수량이 필요합니다.' : '미니게임 티켓 보상은 0보다 큰 지급 수량이 필요합니다.' };
      }
      rewards.push({ type, quantity });
    }
  }

  return { rewards };
};

const legacyFieldsFromReward = (reward: CouponReward) => ({
  reward_type: reward.type,
  points: reward.type === 'point' ? Number(reward.points || 0) : 0,
  reward_channel_id: reward.type === 'card' ? reward.channel_id || null : null,
  reward_item_id: reward.type === 'cosmetic' ? Number(reward.item_id || 0) : reward.type === 'title' ? Number(reward.title_id || 0) : null,
  reward_quantity: reward.type === 'point' || reward.type === 'title' ? 0 : Number(reward.quantity || 0)
});

const rewardSummary = (reward: CouponReward) => {
  if (reward.type === 'point') return `${Number(reward.points || 0).toLocaleString()}P`;
  if (reward.type === 'card') return `${reward.label || reward.channel_id || '스트리머'} 카드 ×${Number(reward.quantity || 0).toLocaleString()}`;
  if (reward.type === 'cosmetic') return `${reward.label || `아이템#${reward.item_id}`} ×${Number(reward.quantity || 0).toLocaleString()}`;
  if (reward.type === 'title') return `${reward.label || `칭호#${reward.title_id}`} 칭호`;
  if (reward.type === 'minigame_ticket') return `추가 미니게임 티켓 ×${Number(reward.quantity || 0).toLocaleString()}`;
  return `추가 무료 소환 티켓 ×${Number(reward.quantity || 0).toLocaleString()}`;
};

const enrichRewards = async (rewards: CouponReward[]): Promise<{ rewards?: CouponReward[]; status?: number; message?: string }> => {
  const streamerNames = new Map<string, string>();
  const itemNames = new Map<number, string>();
  const titleNames = new Map<number, string>();
  const enriched: CouponReward[] = [];

  for (const reward of rewards) {
    if (reward.type === 'card') {
      const channelId = reward.channel_id || '';
      if (!streamerNames.has(channelId)) {
        const streamer = await streamerRepository.findById(channelId);
        if (!streamer) return { status: 404, message: '지급할 스트리머 카드를 찾을 수 없습니다.' };
        streamerNames.set(channelId, streamer.name);
      }
      enriched.push({ ...reward, label: streamerNames.get(channelId) });
    } else if (reward.type === 'cosmetic') {
      const itemId = Number(reward.item_id || 0);
      if (!itemNames.has(itemId)) {
        const item = await getShopItem(itemId);
        if (!item) return { status: 404, message: '지급할 상점 아이템을 찾을 수 없습니다.' };
        itemNames.set(itemId, item.name);
      }
      enriched.push({ ...reward, label: itemNames.get(itemId) });
    } else if (reward.type === 'title') {
      const titleId = Number(reward.title_id || 0);
      if (!titleNames.has(titleId)) {
        const title = await titleRepository.findById(titleId);
        if (!title) return { status: 404, message: '지급할 칭호를 찾을 수 없습니다.' };
        titleNames.set(titleId, title.name);
      }
      enriched.push({ ...reward, label: titleNames.get(titleId) });
    } else {
      enriched.push(reward);
    }
  }

  return { rewards: enriched };
};

/**
 * 1. 쿠폰 생성 (ADMIN 전용)
 *
 * 지원 옵션:
 *  - code: 미입력 시 랜덤 생성
 *  - coupon_type: 'single'(선착순 발급 갯수 제한) | 'multi'(기간 내 1인 1회·총량 무제한)
 *  - reward_type: 'point'(재화) | 'card'(스트리머 카드) | 'cosmetic'(코스메틱) | 'minigame_ticket'(추가 미니게임 티켓) | 'free_draw_ticket'(추가 무료 소환 티켓) | 'title'(칭호)
 *  - points: reward_type='point' 지급 재화량
 *  - reward_channel_id / reward_quantity: reward_type='card' 스트리머 채널과 수량
 *  - max_uses: single 발급 갯수 (multi는 0=무제한)
 *  - expires_at: 사용 가능 만료 일시
 */
export const createCoupon = async (req: Request, res: Response) => {
  const {
    code,
    coupon_type,
    max_uses,
    expires_at
  } = req.body;

  if (!['single', 'multi'].includes(coupon_type)) {
    return res.status(400).json({ error: 'BadRequest', message: '쿠폰 타입은 single 또는 multi만 가능합니다.' });
  }
  const normalized = normalizeRewardsFromBody(req.body);
  if (!normalized.rewards) {
    return res.status(400).json({ error: 'BadRequest', message: normalized.message || '쿠폰 보상 정보가 올바르지 않습니다.' });
  }

  try {
    const enriched = await enrichRewards(normalized.rewards);
    if (!enriched.rewards) {
      return res.status(enriched.status || 400).json({ error: enriched.status === 404 ? 'NotFound' : 'BadRequest', message: enriched.message || '쿠폰 보상 정보가 올바르지 않습니다.' });
    }

    let finalCode = normalizeCouponCode(code);
    if (!finalCode) {
      const randomPart = crypto.randomBytes(6).toString('hex').toUpperCase();
      finalCode = `C-${randomPart.slice(0, 4)}-${randomPart.slice(4, 8)}-${randomPart.slice(8, 12)}`;
    }

    const existing = await couponRepository.findByCode(finalCode);
    if (existing) {
      return res.status(409).json({ error: 'Conflict', message: '이미 존재하는 쿠폰 코드입니다.' });
    }

    // single: 발급 갯수(>=1), multi: 0(무제한)
    const maxUsesCount = coupon_type === 'single' ? Math.max(1, Number(max_uses) || 1) : 0;
    const legacy = legacyFieldsFromReward(enriched.rewards[0]);

    const coupon = await couponRepository.create({
      code: finalCode,
      coupon_type,
      reward_type: legacy.reward_type,
      points: legacy.points,
      reward_channel_id: legacy.reward_channel_id,
      reward_item_id: legacy.reward_item_id,
      reward_quantity: legacy.reward_quantity,
      rewards: enriched.rewards,
      max_uses: maxUsesCount,
      used_count: 0,
      expires_at: expires_at || null,
    });

    return res.status(201).json(coupon);
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '쿠폰 생성 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 2. 쿠폰 사용 (Claim / Redeem)
 */
export const claimCoupon = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  const { code } = req.body;
  const normalizedCode = normalizeCouponCode(code);

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }
  if (!normalizedCode) {
    return res.status(400).json({ error: 'BadRequest', message: '쿠폰 코드를 입력해주세요.' });
  }

  try {
    const coupon = await couponRepository.findByCode(normalizedCode);
    if (!coupon) {
      return res.status(404).json({ error: 'NotFound', message: '유효하지 않거나 존재하지 않는 쿠폰 코드입니다.' });
    }

    // 만료 기한 확인
    if (coupon.expires_at) {
      if (new Date(coupon.expires_at).getTime() < Date.now()) {
        return res.status(410).json({ error: 'Gone', message: '사용 기간이 만료된 쿠폰입니다.' });
      }
    }

    // 일회성(single)만 발급 갯수 초과 확인 (multi는 기간 내 무제한)
    if (coupon.coupon_type === 'single' && coupon.used_count >= coupon.max_uses) {
      return res.status(410).json({ error: 'Gone', message: '선착순 발급 수량이 모두 소진된 쿠폰입니다.' });
    }

    if (coupon.id === undefined) {
      return res.status(500).json({ error: 'InternalServerError', message: '올바르지 않은 쿠폰 상태입니다.' });
    }

    // 이미 사용한 쿠폰의 반복 요청은 쿠폰 행 잠금을 잡는 트랜잭션까지 보내지 않습니다.
    // 동시 요청 경쟁은 redeemAtomic의 INSERT IGNORE가 최종적으로 차단합니다.
    if (await couponRepository.checkCouponRedeemed(coupon.id, userId)) {
      return res.status(409).json({ error: 'Conflict', message: '이미 사용하신 쿠폰입니다.' });
    }

    const rewards = couponToRewards(coupon);
    const enriched = await enrichRewards(rewards);
    if (!enriched.rewards) {
      return res.status(enriched.status || 500).json({
        error: enriched.status === 404 ? 'NotFound' : 'InternalServerError',
        message: enriched.message || '쿠폰 보상 정보가 올바르지 않습니다.'
      });
    }

    const redeem = await couponRepository.redeemAtomic(coupon.id, userId);
    if (!redeem.ok) {
      if (redeem.reason === 'DUPLICATE') {
        return res.status(409).json({ error: 'Conflict', message: '이미 사용하신 쿠폰입니다.' });
      }
      if (redeem.reason === 'EXPIRED') {
        return res.status(410).json({ error: 'Gone', message: '사용 기간이 만료된 쿠폰입니다.' });
      }
      if (redeem.reason === 'SOLD_OUT') {
        return res.status(410).json({ error: 'Gone', message: '선착순 발급 수량이 모두 소진된 쿠폰입니다.' });
      }
      return res.status(500).json({ error: 'InternalServerError', message: '쿠폰 보상 지급에 실패했습니다.' });
    }

    const rewardList = enriched.rewards;
    const pointsAdded = redeem.points_added ?? rewardList.reduce((sum, reward) => sum + (reward.type === 'point' ? Number(reward.points || 0) : 0), 0);
    const message = rewardList.length === 1
      ? `쿠폰이 등록되어 ${rewardSummary(rewardList[0])} 보상이 지급되었습니다.`
      : `쿠폰이 등록되어 ${rewardList.length}개의 보상이 지급되었습니다: ${rewardList.map(rewardSummary).join(', ')}`;
    recordAchievementEvent({
      userId,
      eventType: 'coupon.claim',
      eventKey: `coupon:claim:${userId}:${coupon.id}`,
      metadata: { coupon_id: coupon.id, reward_count: rewardList.length, reward_types: rewardList.map((reward) => reward.type) },
      stats: { 'coupon.claim.count': 1 },
      refreshSnapshots: true
    }).catch(() => undefined);

    return res.status(200).json({
      message,
      reward_type: rewardList.length === 1 ? rewardList[0].type : 'multiple',
      rewards: rewardList,
      points_added: pointsAdded,
      new_points: redeem.new_points ?? pointsAdded
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '쿠폰 사용 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};
