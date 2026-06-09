import { Request, Response, NextFunction } from 'express';
import { CORS_ALLOWED_ORIGINS } from '../config';

const normalizeOrigin = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const allowedOrigins = () =>
  new Set(CORS_ALLOWED_ORIGINS.map((origin) => normalizeOrigin(origin)).filter(Boolean) as string[]);

const requestOrigin = (req: Request) => `${req.protocol}://${req.get('host')}`;

const isAllowedOriginValue = (value: string | undefined, req: Request) => {
  if (!value) return false;
  const normalized = normalizeOrigin(value);
  if (!normalized) return false;
  const allowed = allowedOrigins();
  allowed.add(requestOrigin(req));
  return allowed.has(normalized);
};

const isExemptPath = (path: string) => {
  if (path === '/health') return true;
  if (path === '/api/health') return true;
  return false;
};

const isBrowserSameSiteRequest = (req: Request) => {
  const secFetchSite = req.get('sec-fetch-site');
  return secFetchSite === 'same-origin' || secFetchSite === 'same-site';
};

/**
 * API 직접 호출 방어.
 *
 * CORS는 브라우저의 응답 접근만 막으므로 curl/봇/외부 서버의 직접 호출은 막지 못합니다.
 * 이 가드는 /api/health 외 API 요청에 대해 프론트엔드 허용 Origin/Referer 또는
 * 브라우저의 same-site fetch metadata가 없으면 라우터/DB 진입 전에 거절합니다.
 */
export const apiAccessGuard = (req: Request, res: Response, next: NextFunction) => {
  if (process.env.API_ACCESS_GUARD_ENABLED === 'false') return next();
  if (req.method === 'OPTIONS') return next();
  if (isExemptPath(req.path) || isExemptPath(req.originalUrl || req.url)) return next();

  const origin = req.get('origin');
  if (origin && isAllowedOriginValue(origin, req)) return next();

  const referer = req.get('referer');
  if (referer && isAllowedOriginValue(referer, req)) return next();

  if (isBrowserSameSiteRequest(req)) return next();

  console.warn('[ApiAccessGuard] 허용되지 않은 API 직접 호출 차단:', {
    method: req.method,
    path: req.originalUrl || req.url,
    ip: req.ip,
    origin: origin || null,
    referer: referer ? normalizeOrigin(referer) : null,
    sec_fetch_site: req.get('sec-fetch-site') || null,
    user_agent: req.get('user-agent') || null
  });

  return res.status(403).json({
    error: 'ForbiddenApiOrigin',
    message: '허용된 웹 클라이언트에서만 API를 호출할 수 있습니다.'
  });
};
