import { Request, Response, NextFunction } from 'express';

// 커스텀 Request 인터페이스 정의 (JWT 복호화 데이터 보관용)
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
    avatar_url: string | null;
    role: 'USER' | 'ADMIN';
    point: number;
    last_free_draw: string | null;
    banned_until: string | null;
  };
}

/**
 * 어드민(ADMIN) 권한 소유 여부를 검증하는 미들웨어
 */
export const adminMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const user = req.user;

  if (!user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: '인증 헤더가 누락되었거나 식별된 유저가 없습니다.'
    });
  }

  // 관리자 권한 확인
  if (user.role !== 'ADMIN') {
    return res.status(403).json({
      error: 'Forbidden',
      message: '해당 권한으로는 이 요청을 수행할 수 없습니다. (관리자 전용)'
    });
  }

  next();
};
