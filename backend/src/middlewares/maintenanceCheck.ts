import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { systemConfigRepository, userRepository } from '../repositories';
import { JWT_SECRET } from '../config';
import { SESSION_COOKIE_NAME } from '../services/sessionCookie';

// 점검 예외 허용 API 경로 목록 (Prefix 매칭 또는 Exact 매칭)
const MAINTENANCE_BYPASS_PATHS = [
  '/maintenance/status',
  '/auth/chzzk/url',
  '/auth/chzzk/callback',
  '/users/me',
  '/health',
  '/image-proxy'
];

const getSessionToken = (req: Request): string | undefined => {
  const cookieToken = (req as any).cookies?.[SESSION_COOKIE_NAME];
  if (cookieToken) return cookieToken;

  const authHeader = req.headers.authorization;
  if (!authHeader) return undefined;
  const [type, token] = authHeader.split(' ');
  return type === 'Bearer' && token ? token : undefined;
};

/**
 * 점검 상태 점검 미들웨어
 * - 점검 활성화 상태인 경우 ADMIN이 아니면 503 에러를 리턴합니다.
 */
export const maintenanceCheckMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // 1. 요청 패스가 예외 허용 리스트에 들어있는지 확인
    const isBypass = MAINTENANCE_BYPASS_PATHS.some(path => req.path === path || req.path.startsWith(path));
    if (isBypass) {
      return next();
    }

    // 2. DB에서 점검 활성화 여부 확인
    const active = await systemConfigRepository.get('maintenance_active', 'false');
    if (active === 'true') {
      // 3. 세션 쿠키 또는 Authorization 헤더를 디코딩하여 ADMIN 검사
      const token = getSessionToken(req);
      if (token) {
        try {
          const decoded = jwt.verify(token, JWT_SECRET) as { id: string };
          const user = await userRepository.findById(decoded.id);
          if (user && user.role === 'ADMIN') {
            return next();
          }
        } catch (err) {
          // 토큰 에러 시 무시하고 503 반환
        }
      }

      const startAt = await systemConfigRepository.get('maintenance_start_at', '');
      const endAt = await systemConfigRepository.get('maintenance_end_at', '');

      return res.status(503).json({
        error: 'Maintenance',
        message: '현재 서비스 점검 중입니다.',
        startAt: startAt || null,
        endAt: endAt || null
      });
    }

    return next();
  } catch (err) {
    console.error('[MaintenanceCheck] 미들웨어 에러:', err);
    return next();
  }
};
