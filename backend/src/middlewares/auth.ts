import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { userRepository } from '../repositories';
import { AuthenticatedRequest } from './admin';
import { JWT_SECRET, IS_PRODUCTION } from '../config';
import { SESSION_COOKIE_NAMES } from '../services/sessionCookie';

const AUTH_USER_CACHE_TTL_MS = Math.max(1000, Number(process.env.AUTH_USER_CACHE_TTL_MS || 15_000));
const AUTH_USER_LOOKUP_TIMEOUT_MS = Math.max(500, Number(process.env.AUTH_USER_LOOKUP_TIMEOUT_MS || 3000));
const AUTH_BEARER_ENABLED =
  process.env.AUTH_BEARER_ENABLED === 'true' ||
  (!IS_PRODUCTION && process.env.AUTH_BEARER_ENABLED !== 'false');

const userCache = new Map<string, { user: any; expiresAt: number }>();
const userLookups = new Map<string, Promise<any>>();

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

  let lookup = userLookups.get(userId);
  if (!lookup) {
    lookup = userRepository.findById(userId)
      .then((user) => {
        if (user) {
          userCache.set(userId, { user, expiresAt: Date.now() + AUTH_USER_CACHE_TTL_MS });
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

  try {
    return await withTimeout(lookup, AUTH_USER_LOOKUP_TIMEOUT_MS);
  } catch (err: any) {
    if (cached) return cached.user;
    throw err;
  }
};

/**
 * 사용자 JWT 토큰 검증 및 req.user 할당 미들웨어.
 * 우선순위: httpOnly 세션 쿠키 → Authorization: Bearer 헤더 (둘 다 지원하여 점진적 전환).
 */
export const authMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  // 1) httpOnly 세션 쿠키 우선
  const cookies = (req as any).cookies || {};
  let token: string | undefined = SESSION_COOKIE_NAMES
    .map(cookieName => cookies[cookieName])
    .find(Boolean);

  // 2) 없으면 Authorization: Bearer 헤더 폴백.
  // 운영 프론트는 httpOnly 쿠키만 쓰므로 Bearer는 명시적으로 켠 경우에만 허용합니다.
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const [type, headerToken] = authHeader.split(' ');
      if (type === 'Bearer' && headerToken && AUTH_BEARER_ENABLED) token = headerToken;
    }
  }

  if (!token) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: '인증 정보가 제공되지 않았습니다. (세션 쿠키 또는 Bearer 토큰 필요)'
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string };
    const user = await findUserCached(decoded.id);

    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: '해당 토큰의 사용자를 조회할 수 없습니다.'
      });
    }

    req.user = user;
    next();
  } catch (err: any) {
    if (err?.message === 'AuthUserLookupTimeout') {
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
