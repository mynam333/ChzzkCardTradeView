import { Request, Response, NextFunction } from 'express';
import { CORS_ALLOWED_ORIGINS, normalizeOrigin } from '../config';
import { SESSION_COOKIE_NAMES } from '../services/sessionCookie';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const getRequestOrigin = (req: Request): string => `${req.protocol}://${req.get('host')}`;

const isAllowedOrigin = (origin: string, req: Request): boolean => {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  const allowed = new Set(CORS_ALLOWED_ORIGINS.map((o) => normalizeOrigin(o)).filter(Boolean) as string[]);
  allowed.add(getRequestOrigin(req));
  return allowed.has(normalized);
};

/**
 * 쿠키 인증을 쓰는 상태 변경 요청에 Origin/Referer 검증을 적용합니다.
 * Bearer 토큰 기반 서버간 요청은 쿠키가 없으므로 영향을 받지 않습니다.
 */
export const csrfOriginGuard = (req: Request, res: Response, next: NextFunction) => {
  if (SAFE_METHODS.has(req.method)) return next();

  const cookies = (req as any).cookies || {};
  const hasSessionCookie = SESSION_COOKIE_NAMES.some(cookieName => Boolean(cookies[cookieName]));
  if (!hasSessionCookie) return next();

  const origin = req.get('origin');
  if (origin) {
    if (isAllowedOrigin(origin, req)) return next();
    return res.status(403).json({
      error: 'Forbidden',
      message: '허용되지 않은 출처의 요청입니다.'
    });
  }

  const referer = req.get('referer');
  if (referer && isAllowedOrigin(referer, req)) return next();

  return res.status(403).json({
    error: 'Forbidden',
    message: '출처를 확인할 수 없는 쿠키 기반 상태 변경 요청입니다.'
  });
};
