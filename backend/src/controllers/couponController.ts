import { Request, Response } from 'express';
import { couponRepository, streamerRepository } from '../repositories';
import crypto from 'crypto';
import { AuthenticatedRequest } from '../middlewares/admin';
import { IS_PRODUCTION } from '../config';
import { getItem as getShopItem } from '../services/shopService';
import { normalizeCouponCode } from '../utils/couponCode';

/**
 * 1. 쿠폰 생성 (ADMIN 전용)
 *
 * 지원 옵션:
 *  - code: 미입력 시 랜덤 생성
 *  - coupon_type: 'single'(선착순 발급 갯수 제한) | 'multi'(기간 내 1인 1회·총량 무제한)
 *  - reward_type: 'point'(재화) | 'card'(스트리머 카드) | 'cosmetic'(코스메틱) | 'minigame_ticket'(추가 미니게임 티켓)
 *  - points: reward_type='point' 지급 재화량
 *  - reward_channel_id / reward_quantity: reward_type='card' 스트리머 채널과 수량
 *  - max_uses: single 발급 갯수 (multi는 0=무제한)
 *  - expires_at: 사용 가능 만료 일시
 */
export const createCoupon = async (req: Request, res: Response) => {
  const {
    code,
    coupon_type,
    reward_type = 'point',
    points,
    reward_channel_id,
    reward_item_id,
    reward_quantity,
    max_uses,
    expires_at
  } = req.body;

  if (!['single', 'multi'].includes(coupon_type)) {
    return res.status(400).json({ error: 'BadRequest', message: '쿠폰 타입은 single 또는 multi만 가능합니다.' });
  }
  if (!['point', 'card', 'cosmetic', 'minigame_ticket'].includes(reward_type)) {
    return res.status(400).json({ error: 'BadRequest', message: '보상 종류는 point · card · cosmetic · minigame_ticket만 가능합니다.' });
  }

  // 보상 종류별 필수값 검증
  let rewardPoints = 0;
  let rewardChannelId: string | null = null;
  let rewardItemId: number | null = null;
  let rewardQuantity = 0;

  if (reward_type === 'point') {
    rewardPoints = Number(points);
    if (!rewardPoints || rewardPoints <= 0) {
      return res.status(400).json({ error: 'BadRequest', message: '재화 쿠폰은 0보다 큰 지급 포인트가 필요합니다.' });
    }
  } else if (reward_type === 'card') {
    rewardChannelId = reward_channel_id;
    rewardQuantity = Number(reward_quantity);
    if (!rewardChannelId) {
      return res.status(400).json({ error: 'BadRequest', message: '카드 쿠폰은 지급할 스트리머 채널 ID가 필요합니다.' });
    }
    if (!rewardQuantity || rewardQuantity <= 0) {
      return res.status(400).json({ error: 'BadRequest', message: '카드 쿠폰은 0보다 큰 지급 수량이 필요합니다.' });
    }
  } else if (reward_type === 'cosmetic') {
    rewardItemId = Number(reward_item_id);
    rewardQuantity = Number(reward_quantity);
    if (!rewardItemId) {
      return res.status(400).json({ error: 'BadRequest', message: '코스메틱 쿠폰은 지급할 상점 아이템을 선택해야 합니다.' });
    }
    if (!rewardQuantity || rewardQuantity <= 0) {
      return res.status(400).json({ error: 'BadRequest', message: '코스메틱 쿠폰은 0보다 큰 지급 수량이 필요합니다.' });
    }
  } else {
    rewardQuantity = Number(reward_quantity);
    if (!rewardQuantity || rewardQuantity <= 0) {
      return res.status(400).json({ error: 'BadRequest', message: '미니게임 티켓 쿠폰은 0보다 큰 지급 수량이 필요합니다.' });
    }
  }

  try {
    // 카드 보상이면 스트리머 실존 여부 확인
    if (reward_type === 'card' && rewardChannelId) {
      const streamer = await streamerRepository.findById(rewardChannelId);
      if (!streamer) {
        return res.status(404).json({ error: 'NotFound', message: '지급할 스트리머 카드를 찾을 수 없습니다.' });
      }
    }
    // 코스메틱 보상이면 상점 아이템 실존 여부 확인
    if (reward_type === 'cosmetic' && rewardItemId) {
      const item = await getShopItem(rewardItemId);
      if (!item) {
        return res.status(404).json({ error: 'NotFound', message: '지급할 상점 아이템을 찾을 수 없습니다.' });
      }
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

    const coupon = await couponRepository.create({
      code: finalCode,
      coupon_type,
      reward_type,
      points: rewardPoints,
      reward_channel_id: rewardChannelId,
      reward_item_id: rewardItemId,
      reward_quantity: rewardQuantity,
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

    // 카드 보상이면 지급 전에 스트리머 실존 여부 확인 (로그 기록 전 사전 검증)
    let rewardStreamer = null;
    if (coupon.reward_type === 'card') {
      if (!coupon.reward_channel_id) {
        return res.status(500).json({ error: 'InternalServerError', message: '카드 쿠폰 정보가 올바르지 않습니다.' });
      }
      rewardStreamer = await streamerRepository.findById(coupon.reward_channel_id);
      if (!rewardStreamer) {
        return res.status(404).json({ error: 'NotFound', message: '지급 대상 스트리머 카드를 더 이상 찾을 수 없습니다.' });
      }
    }
    // 코스메틱 보상이면 지급 전에 아이템 실존 여부 확인
    let rewardItem = null;
    if (coupon.reward_type === 'cosmetic') {
      if (!coupon.reward_item_id) {
        return res.status(500).json({ error: 'InternalServerError', message: '코스메틱 쿠폰 정보가 올바르지 않습니다.' });
      }
      rewardItem = await getShopItem(coupon.reward_item_id);
      if (!rewardItem) {
        return res.status(404).json({ error: 'NotFound', message: '지급 대상 코스메틱 아이템을 더 이상 찾을 수 없습니다.' });
      }
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

    if (coupon.reward_type === 'card' && rewardStreamer) {
      return res.status(200).json({
        message: `쿠폰이 등록되어 '${rewardStreamer.name}' 카드 ${coupon.reward_quantity}장이 지급되었습니다!`,
        reward_type: 'card',
        reward_channel_id: rewardStreamer.channel_id,
        reward_quantity: coupon.reward_quantity,
        points_added: 0
      });
    }

    if (coupon.reward_type === 'cosmetic' && rewardItem) {
      return res.status(200).json({
        message: `쿠폰이 등록되어 '${rewardItem.name}' 코스메틱 ${coupon.reward_quantity}개가 지급되었습니다! (상점 보관함에서 확인)`,
        reward_type: 'cosmetic',
        reward_item_id: rewardItem.id,
        reward_quantity: coupon.reward_quantity,
        points_added: 0
      });
    }

    if (coupon.reward_type === 'minigame_ticket') {
      return res.status(200).json({
        message: `쿠폰이 등록되어 추가 미니게임 티켓 ${coupon.reward_quantity}장이 지급되었습니다!`,
        reward_type: 'minigame_ticket',
        reward_quantity: coupon.reward_quantity,
        points_added: 0
      });
    }

    // 포인트 보상 지급
    return res.status(200).json({
      message: `쿠폰이 정상적으로 등록되어 ${coupon.points}포인트가 지급되었습니다.`,
      reward_type: 'point',
      points_added: coupon.points,
      new_points: redeem.new_points ?? coupon.points
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '쿠폰 사용 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};
