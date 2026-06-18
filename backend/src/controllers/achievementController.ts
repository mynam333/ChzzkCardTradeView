import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/admin';
import { IS_PRODUCTION } from '../config';
import {
  adminListAchievementProgress,
  claimAchievementReward,
  createAchievement,
  evaluateUserAchievements,
  listUserAchievements,
  updateAchievement
} from '../services/achievementService';

export const getMyAchievements = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  try {
    const data = await listUserAchievements(userId, {
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      category: typeof req.query.category === 'string' ? req.query.category : undefined,
      hidden: typeof req.query.hidden === 'string' ? req.query.hidden : undefined,
      sort: typeof req.query.sort === 'string' ? req.query.sort : undefined,
      limit: Number(req.query.limit || 160)
    });
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json(data);
  } catch (err: any) {
    console.error('[AchievementController] getMyAchievements 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '업적 목록을 불러오지 못했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

export const recalculateMyAchievements = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  try {
    await evaluateUserAchievements(userId);
    return res.status(200).json({ message: '업적 진행도를 갱신했습니다.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '업적 진행도 갱신에 실패했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

export const claimMyAchievement = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  const achievementId = Number(req.params.id);
  if (!achievementId) return res.status(400).json({ error: 'BadRequest', message: '업적 ID가 필요합니다.' });
  try {
    const result = await claimAchievementReward(userId, achievementId);
    if (!result.ok) {
      const status = result.reason === 'NOT_FOUND' ? 404
        : result.reason === 'ALREADY_CLAIMED' ? 409
          : result.reason === 'NOT_COMPLETED' ? 400
            : 400;
      const message = result.reason === 'ALREADY_CLAIMED' ? '이미 수령한 업적 보상입니다.'
        : result.reason === 'NOT_COMPLETED' ? '아직 완료하지 않은 업적입니다.'
          : result.reason === 'NOT_FOUND' ? '업적을 찾을 수 없습니다.'
            : '업적 보상 수령에 실패했습니다.';
      return res.status(status).json({ error: 'ClaimFailed', reason: result.reason, message });
    }
    return res.status(200).json({
      message: '업적 보상을 수령했습니다.',
      rewards: result.rewards || [],
      new_points: result.new_points
    });
  } catch (err: any) {
    console.error('[AchievementController] claimMyAchievement 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '업적 보상 수령에 실패했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

export const adminGetAchievements = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    return res.status(200).json({ items: await adminListAchievementProgress() });
  } catch (err: any) {
    console.error('[AchievementController] adminGetAchievements 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '관리자 업적 목록을 불러오지 못했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

export const adminCreateAchievement = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await createAchievement(req.body, req.user?.id || null);
    if (!result.ok) return res.status(400).json({ error: 'BadRequest', message: result.message });
    return res.status(201).json({ message: '업적이 생성되었습니다.', achievement: result.achievement });
  } catch (err: any) {
    if (String(err?.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: 'Conflict', message: '이미 존재하는 업적 코드입니다.' });
    }
    return res.status(500).json({ error: 'InternalServerError', message: '업적 생성에 실패했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

export const adminUpdateAchievement = async (req: AuthenticatedRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'BadRequest', message: '업적 ID가 필요합니다.' });
  try {
    const result = await updateAchievement(id, req.body);
    if (!result.ok) return res.status(400).json({ error: 'BadRequest', message: result.message });
    return res.status(200).json({ message: '업적이 수정되었습니다.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '업적 수정에 실패했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};
