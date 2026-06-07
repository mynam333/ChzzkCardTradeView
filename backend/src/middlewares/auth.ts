import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { userRepository } from '../repositories';
import { AuthenticatedRequest } from './admin';
import { JWT_SECRET, IS_PRODUCTION } from '../config';
import { SESSION_COOKIE_NAMES } from '../services/sessionCookie';

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

  // 2) 없으면 Authorization: Bearer 헤더 폴백
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const [type, headerToken] = authHeader.split(' ');
      if (type === 'Bearer' && headerToken) token = headerToken;
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
    const user = await userRepository.findById(decoded.id);

    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: '해당 토큰의 사용자를 조회할 수 없습니다.'
      });
    }

    req.user = user;
    next();
  } catch (err: any) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: '만료되었거나 손상된 토큰입니다.',
      details: IS_PRODUCTION ? undefined : err.message
    });
  }
};
