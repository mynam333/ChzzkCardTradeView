import { Request, Response } from 'express';
import { couponRepository, userRepository } from '../repositories';
import crypto from 'crypto';
import { AuthenticatedRequest } from '../middlewares/admin';
import { IS_PRODUCTION } from '../config';

/**
 * 1. 쿠폰 생성 (ADMIN 전용)
 */
export const createCoupon = async (req: Request, res: Response) => {
  const { code, coupon_type, points, max_uses, expires_at } = req.body;

  if (!coupon_type || !points || points <= 0) {
    return res.status(400).json({ error: 'BadRequest', message: '쿠폰 타입과 올바른 포인트 값이 필요합니다.' });
  }

  // coupon_type validation
  if (!['single', 'multi'].includes(coupon_type)) {
    return res.status(400).json({ error: 'BadRequest', message: '쿠폰 타입은 single 또는 multi만 가능합니다.' });
  }

  try {
    let finalCode = code;
    if (!finalCode) {
      // 랜덤 코드 생성 (예: C-XXXX-XXXX-XXXX)
      const randomPart = crypto.randomBytes(6).toString('hex').toUpperCase();
      finalCode = `C-${randomPart.slice(0, 4)}-${randomPart.slice(4, 8)}-${randomPart.slice(8, 12)}`;
    }

    // 중복 코드 검사
    const existing = await couponRepository.findByCode(finalCode);
    if (existing) {
      return res.status(409).json({ error: 'Conflict', message: '이미 존재하는 쿠폰 코드입니다.' });
    }

    const maxUsesCount = coupon_type === 'single' ? 1 : (max_uses || 1);

    const coupon = await couponRepository.create({
      code: finalCode,
      coupon_type,
      points: Number(points),
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
  // authMiddleware 통과 후이므로 req.user가 존재 (AuthenticatedRequest로 캐스팅 가능)
  const userId = req.user?.id;
  const { code } = req.body;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  if (!code) {
    return res.status(400).json({ error: 'BadRequest', message: '쿠폰 코드를 입력해주세요.' });
  }

  try {
    const coupon = await couponRepository.findByCode(code);
    if (!coupon) {
      return res.status(404).json({ error: 'NotFound', message: '유효하지 않거나 존재하지 않는 쿠폰 코드입니다.' });
    }

    // 만료 기한 확인
    if (coupon.expires_at) {
      const expiry = new Date(coupon.expires_at);
      if (expiry.getTime() < Date.now()) {
        return res.status(410).json({ error: 'Gone', message: '사용 기간이 만료된 쿠폰입니다.' });
      }
    }

    // 최대 횟수 초과 확인
    if (coupon.used_count >= coupon.max_uses) {
      return res.status(410).json({ error: 'Gone', message: '이미 모두 사용된 쿠폰입니다.' });
    }

    if (coupon.id === undefined) {
      return res.status(500).json({ error: 'InternalServerError', message: '올바르지 않은 쿠폰 상태입니다.' });
    }

    // 중복 사용 차단을 원자적으로 처리: 로그 INSERT가 UNIQUE 제약에 의해 실패하면
    // 이미 사용한 것으로 간주 (동시 요청에 의한 이중 수령 방지)
    const inserted = await couponRepository.logCouponRedeem(coupon.id, userId);
    if (!inserted) {
      return res.status(409).json({ error: 'Conflict', message: '이미 사용하신 쿠폰입니다.' });
    }

    // 사용 횟수 증가 및 포인트 원자적 가산
    await couponRepository.incrementUsedCount(coupon.id);
    await userRepository.incrementPoint(userId, coupon.points);

    const updated = await userRepository.findById(userId);

    return res.status(200).json({
      message: `쿠폰이 정상적으로 등록되어 ${coupon.points}포인트가 지급되었습니다.`,
      points_added: coupon.points,
      new_points: updated ? updated.point : coupon.points
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '쿠폰 사용 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};
