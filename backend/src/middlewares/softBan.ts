import { Request, Response, NextFunction } from 'express';

interface SoftBanBucket {
  score: number;
  requests: number;
  mutations: number;
  pushSubscribes: number;
  imageProxy: number;
  resetAt: number;
  bannedUntil: number;
  lastReason?: string;
}

const readPositiveNumber = (name: string, fallback: number) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const WINDOW_MS = readPositiveNumber('SOFT_BAN_WINDOW_MS', 60_000);
const BAN_MS = readPositiveNumber('SOFT_BAN_DURATION_MS', 5 * 60_000);
const MAX_SCORE = readPositiveNumber('SOFT_BAN_MAX_SCORE', 240);
const MAX_REQUESTS = readPositiveNumber('SOFT_BAN_MAX_REQUESTS', 180);
const MAX_MUTATIONS = readPositiveNumber('SOFT_BAN_MAX_MUTATIONS', 60);
const MAX_PUSH_SUBSCRIBES = readPositiveNumber('SOFT_BAN_MAX_PUSH_SUBSCRIBES', 6);
const MAX_IMAGE_PROXY = readPositiveNumber('SOFT_BAN_MAX_IMAGE_PROXY', 80);

const buckets = new Map<string, SoftBanBucket>();

const getClientKey = (req: Request) => req.ip || req.socket.remoteAddress || 'unknown';

const isExemptPath = (path: string) =>
  path === '/api/health' ||
  path === '/health' ||
  path === '/api/push/vapid-key' ||
  path.startsWith('/uploads');

const requestWeight = (req: Request) => {
  if (req.method === 'OPTIONS') return 0;
  if (req.path === '/api/realtime/stream' || req.path === '/api/notifications/stream') return 0.25;
  if (req.path === '/api/push/subscribe') return 25;
  if (req.path.startsWith('/api/image-proxy')) return 2;
  if (req.method !== 'GET' && req.method !== 'HEAD') return 3;
  return 1;
};

const newBucket = (now: number): SoftBanBucket => ({
  score: 0,
  requests: 0,
  mutations: 0,
  pushSubscribes: 0,
  imageProxy: 0,
  resetAt: now + WINDOW_MS,
  bannedUntil: 0
});

const ban = (bucket: SoftBanBucket, now: number, reason: string) => {
  bucket.bannedUntil = now + BAN_MS;
  bucket.lastReason = reason;
};

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now && bucket.bannedUntil <= now) {
      buckets.delete(key);
    }
  }
}, 60_000).unref?.();

export const softBanMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (process.env.SOFT_BAN_ENABLED === 'false' || isExemptPath(req.path)) {
    return next();
  }

  const now = Date.now();
  const key = getClientKey(req);
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    const previousBanUntil = bucket?.bannedUntil || 0;
    const previousReason = bucket?.lastReason;
    bucket = newBucket(now);
    bucket.bannedUntil = previousBanUntil > now ? previousBanUntil : 0;
    bucket.lastReason = previousReason;
    buckets.set(key, bucket);
  }

  if (bucket.bannedUntil > now) {
    const retryAfterSec = Math.ceil((bucket.bannedUntil - now) / 1000);
    res.setHeader('Retry-After', String(retryAfterSec));
    return res.status(429).json({
      error: 'SoftBanned',
      message: `요청이 비정상적으로 많아 잠시 제한되었습니다. ${retryAfterSec}초 후 다시 시도해 주세요.`,
      retry_after_seconds: retryAfterSec
    });
  }

  const weight = requestWeight(req);
  bucket.score += weight;
  bucket.requests += 1;
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') bucket.mutations += 1;
  if (req.path === '/api/push/subscribe') bucket.pushSubscribes += 1;
  if (req.path.startsWith('/api/image-proxy')) bucket.imageProxy += 1;

  let reason = '';
  if (bucket.pushSubscribes > MAX_PUSH_SUBSCRIBES) reason = 'push_subscribe_flood';
  else if (bucket.mutations > MAX_MUTATIONS) reason = 'mutation_flood';
  else if (bucket.imageProxy > MAX_IMAGE_PROXY) reason = 'image_proxy_flood';
  else if (bucket.requests > MAX_REQUESTS) reason = 'request_flood';
  else if (bucket.score > MAX_SCORE) reason = 'weighted_flood';

  if (reason) {
    ban(bucket, now, reason);
    console.warn('[SoftBan] 과도 요청 임시 제한:', {
      ip: key,
      reason,
      path: req.path,
      requests: bucket.requests,
      mutations: bucket.mutations,
      push_subscribes: bucket.pushSubscribes,
      image_proxy: bucket.imageProxy,
      score: bucket.score,
      banned_ms: BAN_MS
    });
    const retryAfterSec = Math.ceil(BAN_MS / 1000);
    res.setHeader('Retry-After', String(retryAfterSec));
    return res.status(429).json({
      error: 'SoftBanned',
      message: `요청이 비정상적으로 많아 잠시 제한되었습니다. ${retryAfterSec}초 후 다시 시도해 주세요.`,
      retry_after_seconds: retryAfterSec
    });
  }

  next();
};

export const getSoftBanStats = () => {
  const now = Date.now();
  let banned = 0;
  let activeBuckets = 0;
  for (const bucket of buckets.values()) {
    if (bucket.resetAt > now || bucket.bannedUntil > now) activeBuckets += 1;
    if (bucket.bannedUntil > now) banned += 1;
  }
  return {
    enabled: process.env.SOFT_BAN_ENABLED !== 'false',
    activeBuckets,
    banned,
    windowMs: WINDOW_MS,
    banMs: BAN_MS,
    maxScore: MAX_SCORE,
    maxRequests: MAX_REQUESTS,
    maxMutations: MAX_MUTATIONS,
    maxPushSubscribes: MAX_PUSH_SUBSCRIBES
  };
};
