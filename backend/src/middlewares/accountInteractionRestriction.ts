import { Response, NextFunction } from 'express';
import { userRepository } from '../repositories';
import { getActiveAccountInteractionRestriction } from '../services/accountInteractionRestriction';
import { AuthenticatedRequest } from './admin';

export const accountInteractionRestrictionMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: '인증 정보가 필요한 요청입니다.'
    });
  }

  try {
    const deletedAccount = await userRepository.findDeletedAccount(user.id);
    const restrictedUntil = getActiveAccountInteractionRestriction(deletedAccount);
    if (!restrictedUntil) return next();

    const formatted = restrictedUntil.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    return res.status(403).json({
      error: 'PostRejoinInteractionRestricted',
      message: `탈퇴 후 재가입한 계정은 어뷰징 방지를 위해 ${formatted}까지 오픈마켓, 교환, 보상 수령 등 유저·경제 상호작용이 제한됩니다.`,
      interaction_restricted_until: restrictedUntil.toISOString()
    });
  } catch (err) {
    return next(err);
  }
};
