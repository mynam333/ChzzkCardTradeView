import type { Request, Response } from 'express';
import { getOwnedStreamerProfiles } from '../services/ownedStreamerProfilesService';

export const getMyOwnedStreamerProfiles = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  try {
    const profiles = await getOwnedStreamerProfiles(userId);
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json(profiles);
  } catch (err: any) {
    console.error('[OwnedStreamerProfilesController] 소유 카드 프로필 조회 실패:', err?.message || err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: '보유 카드의 최신 프로필을 불러오지 못했습니다.'
    });
  }
};

