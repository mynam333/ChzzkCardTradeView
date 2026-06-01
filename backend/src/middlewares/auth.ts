import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { userRepository } from '../repositories';
import { AuthenticatedRequest } from './admin';
import { JWT_SECRET, IS_PRODUCTION } from '../config';

/**
 * 사용자 JWT 토큰 검증 및 req.user 할당 미들웨어
 */
export const authMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: '인증 헤더(Authorization)가 제공되지 않았습니다.'
    });
  }

  const [type, token] = authHeader.split(' ');

  // 오직 표준 Bearer JWT 검증만 수행
  if (type !== 'Bearer' || !token) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: '유효한 Bearer 토큰 형식이 아닙니다.'
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
