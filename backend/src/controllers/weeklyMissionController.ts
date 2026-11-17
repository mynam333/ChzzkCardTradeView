import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/admin';
import { IS_PRODUCTION } from '../config';
import { claimWeeklyMission, getWeeklyMissions } from '../services/weeklyMissionService';

export const getMyWeeklyMissions = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  try {
    const payload = await getWeeklyMissions(userId);
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json(payload);
  } catch (err: any) {
    console.error('[WeeklyMissionController] getMyWeeklyMissions 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '주간 미션을 불러오지 못했습니다.', details: IS_PRODUCTION ? undefined : err?.message });
  }
};

export const claimMyWeeklyMission = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  const assignmentId = Number(req.params.id);
  const weekKey = typeof req.body?.week_key === 'string' ? req.body.week_key.trim() : '';
  if (!Number.isSafeInteger(assignmentId) || assignmentId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(weekKey)) {
    return res.status(400).json({ error: 'BadRequest', code: 'INVALID_REQUEST', message: '미션 ID와 주차 정보가 필요합니다.' });
  }
  try {
    const result = await claimWeeklyMission(userId, assignmentId, weekKey);
    if (!result.ok) {
      const status = result.reason === 'NOT_FOUND' ? 404 : 409;
      const message = result.reason === 'WEEK_CHANGED'
        ? '주간 미션이 갱신되었습니다. 새 미션을 확인해 주세요.'
        : result.reason === 'NOT_COMPLETED'
          ? '아직 완료하지 않은 주간 미션입니다.'
          : '주간 미션을 찾을 수 없습니다.';
      return res.status(status).json({ error: 'WeeklyMissionNotClaimable', code: result.reason, message });
    }
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json(result.payload);
  } catch (err: any) {
    console.error('[WeeklyMissionController] claimMyWeeklyMission 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '주간 미션 보상을 수령하지 못했습니다.', details: IS_PRODUCTION ? undefined : err?.message });
  }
};
