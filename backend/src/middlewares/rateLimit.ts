import { Request, Response, NextFunction } from 'express';

/**
 * 의존성 없는 경량 인메모리 레이트 리미터.
 * IP + 라우트 키별로 고정 윈도우(windowMs) 동안 max 회까지 허용합니다.
 * (단일 인스턴스 기준. 다중 인스턴스 배포 시 Redis 등 공유 저장소 권장)
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

// 주기적으로 만료된 버킷 정리 (메모리 누수 방지)
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of store.entries()) {
    if (bucket.resetAt <= now) store.delete(key);
  }
}, 60 * 1000).unref?.();

const getClientIp = (req: Request): string => {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.ip || req.socket.remoteAddress || 'unknown';
};

/**
 * 레이트 리미터 미들웨어 생성기.
 * @param options.windowMs 윈도우 길이(ms)
 * @param options.max 윈도우당 최대 요청 수
 * @param options.key 버킷 구분용 라우트 식별자
 */
export const rateLimit = (options: { windowMs: number; max: number; key: string }) => {
  const { windowMs, max, key } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = getClientIp(req);
    const bucketKey = `${key}:${ip}`;
    const now = Date.now();

    let bucket = store.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      store.set(bucketKey, bucket);
    }

    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (bucket.count > max) {
      const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        error: 'TooManyRequests',
        message: `요청이 너무 잦습니다. ${retryAfterSec}초 후 다시 시도해 주세요.`
      });
    }

    next();
  };
};
