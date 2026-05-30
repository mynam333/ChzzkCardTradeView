import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';

export const banCheckMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const user = req.user;

  if (!user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: '인증 정보가 필요한 요청입니다.'
    });
  }

  // 밴(차단) 상태 검증
  if (user.banned_until) {
    const banExpiration = new Date(user.banned_until);
    const now = new Date();

    if (banExpiration > now) {
      // 한국어 시간 형식으로 가독성 있게 변환
      const formattedDate = banExpiration.toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul'
      });

      // 만일 서기 9999년 근처라면 영구 정지로 표시
      const isPermanent = banExpiration.getFullYear() > 2099;

      return res.status(403).json({
        error: 'BannedUser',
        message: isPermanent 
          ? '해당 계정은 규정 위반으로 인해 서비스 영구 이용 정지 상태입니다.'
          : `해당 계정은 서비스 이용이 일시 제한되었습니다. (제한 만료: ${formattedDate})`,
        banned_until: user.banned_until
      });
    }
  }

  next();
};
