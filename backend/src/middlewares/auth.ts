import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { userRepository } from '../repositories';
import { AuthenticatedRequest } from './admin';

const JWT_SECRET = process.env.JWT_SECRET || 'chzzk_secret_key_2026';

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

  // 1. 치지직 개발/오프라인 테스트용 모크 인증 지원 (Mocking)
  if (type === 'Mock' && token) {
    try {
      const user = await userRepository.findById(token);
      if (user) {
        req.user = user;
        return next();
      }

      // 모크 유저가 DB에 없으면 임시 자동 생성
      const mockUser = {
        id: token,
        username: `치지직유저_${token.substring(0, 5)}`,
        avatar_url: `https://api.dicebear.com/7.x/pixel-art/svg?seed=${token}`,
        role: token === 'admin_test_uid' ? 'ADMIN' as const : 'USER' as const,
        point: 0, // 기본 0 포인트 지급 (요구사항: 빈 데이터베이스 및 무자산)
        last_free_draw: null,
        banned_until: null
      };

      await userRepository.create(mockUser);
      req.user = mockUser;
      return next();
    } catch (err) {
      return res.status(500).json({ error: 'InternalServerError', message: '모크 인증 처리 중 오류 발생' });
    }
  }

  // 2. 표준 Bearer JWT 검증
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
      details: err.message
    });
  }
};
