import { Response, NextFunction } from 'express';
import { userRepository } from '../repositories';
import { AuthenticatedRequest } from './admin';
import { IS_PRODUCTION } from '../config';
import {
  AuthSessionLookupTimeoutError,
  getRequestSessionToken,
  verifyAuthSessionToken
} from '../services/authSessionService';

const AUTH_USER_CACHE_TTL_MS = Math.max(1000, Number(process.env.AUTH_USER_CACHE_TTL_MS || 15_000));
const AUTH_USER_LOOKUP_TIMEOUT_MS = Math.max(500, Number(process.env.AUTH_USER_LOOKUP_TIMEOUT_MS || 3000));
const AUTH_USER_CACHE_MAX_ENTRIES = Math.max(100, Number(process.env.AUTH_USER_CACHE_MAX_ENTRIES || 5000));
const LAST_SEEN_TOUCH_INTERVAL_MS = Math.max(60_000, Number(process.env.LAST_SEEN_TOUCH_INTERVAL_MS || 600_000));
const LAST_SEEN_TOUCH_MAX_ENTRIES = Math.max(100, Number(process.env.LAST_SEEN_TOUCH_MAX_ENTRIES || 10000));
const LAST_SEEN_TOUCH_RETENTION_MS = Math.max(
  LAST_SEEN_TOUCH_INTERVAL_MS,
  Number(process.env.LAST_SEEN_TOUCH_RETENTION_MS || 24 * 60 * 60_000)
);
const userCache = new Map<string, { user: any; expiresAt: number }>();
const userLookups = new Map<string, Promise<any>>();
const lastSeenTouches = new Map<string, number>();
let lastCachePruneAt = 0;

const deleteOldestEntry = <T>(map: Map<string, T>) => {
  const oldestKey = map.keys().next().value;
  if (oldestKey !== undefined) map.delete(oldestKey);
};

const pruneAuthCaches = (now = Date.now(), force = false) => {
  if (!force && now - lastCachePruneAt < 60_000) return;
  lastCachePruneAt = now;

  for (const [userId, cached] of userCache) {
    if (cached.expiresAt <= now) userCache.delete(userId);
  }
  while (userCache.size > AUTH_USER_CACHE_MAX_ENTRIES) deleteOldestEntry(userCache);

  for (const [userId, touchedAt] of lastSeenTouches) {
    if (now - touchedAt > LAST_SEEN_TOUCH_RETENTION_MS) lastSeenTouches.delete(userId);
  }
  while (lastSeenTouches.size > LAST_SEEN_TOUCH_MAX_ENTRIES) deleteOldestEntry(lastSeenTouches);
};

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('AuthUserLookupTimeout')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

const findUserCached = async (userId: string) => {
  const now = Date.now();
  const cached = userCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.user;
  if (cached) userCache.delete(userId);

  let lookup = userLookups.get(userId);
  if (!lookup) {
    lookup = userRepository.findById(userId)
      .then((user) => {
        if (user) {
          userCache.set(userId, { user, expiresAt: Date.now() + AUTH_USER_CACHE_TTL_MS });
          pruneAuthCaches(Date.now(), userCache.size > AUTH_USER_CACHE_MAX_ENTRIES);
        } else {
          userCache.delete(userId);
        }
        return user;
      })
      .finally(() => {
        userLookups.delete(userId);
      });
    userLookups.set(userId, lookup);
  }

  return withTimeout(lookup, AUTH_USER_LOOKUP_TIMEOUT_MS);
};

const touchLastSeen = (userId: string) => {
  const now = Date.now();
  const lastTouchedAt = lastSeenTouches.get(userId) || 0;
  if (now - lastTouchedAt < LAST_SEEN_TOUCH_INTERVAL_MS) return;
  lastSeenTouches.delete(userId);
  lastSeenTouches.set(userId, now);
  pruneAuthCaches(now, lastSeenTouches.size > LAST_SEEN_TOUCH_MAX_ENTRIES);
  const seenAt = new Date(now).toISOString();
  userRepository.updateLastSeen(userId, seenAt)
    .then(() => {
      const cached = userCache.get(userId);
      if (cached?.user) cached.user.last_seen_at = seenAt;
    })
    .catch((err: any) => {
      console.warn('[Auth] 최근 접속일 갱신 실패:', err?.message || err);
    });
};

/**
 * 사용자 JWT 토큰 검증 및 req.user 할당 미들웨어.
 * 우선순위: httpOnly 세션 쿠키 → Authorization: Bearer 헤더 (둘 다 지원하여 점진적 전환).
 */
export const authMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const token = getRequestSessionToken(req);

  if (!token) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: '인증 정보가 제공되지 않았습니다. (세션 쿠키 또는 Bearer 토큰 필요)'
    });
  }

  try {
    const decoded = await verifyAuthSessionToken(token);
    const user = await findUserCached(decoded.id);

    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: '해당 토큰의 사용자를 조회할 수 없습니다.'
      });
    }

    req.user = user;
    touchLastSeen(decoded.id);
    next();
  } catch (err: any) {
    if (err?.message === 'AuthUserLookupTimeout' || err instanceof AuthSessionLookupTimeoutError) {
      res.setHeader('Retry-After', '3');
      return res.status(503).json({
        error: 'AuthServiceBusy',
        message: '인증 정보를 확인하는 데 시간이 오래 걸리고 있습니다. 잠시 후 다시 시도해 주세요.'
      });
    }
    return res.status(401).json({
      error: 'Unauthorized',
      message: '만료되었거나 손상된 토큰입니다.',
      details: IS_PRODUCTION ? undefined : err.message
    });
  }
};

/** 테스트 격리용 캐시 초기화. 운영 코드에서는 호출하지 않습니다. */
export const __resetAuthCachesForTest = (): void => {
  userCache.clear();
  userLookups.clear();
  lastSeenTouches.clear();
  lastCachePruneAt = 0;
};
