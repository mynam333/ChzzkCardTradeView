import { Request, Response } from 'express';
import { IS_PRODUCTION } from '../config';
import { addUserImageBlind, listUserImageBlinds, removeUserImageBlind } from '../services/userImageBlindService';

export const getMyImageBlinds = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  try {
    const items = await listUserImageBlinds(userId);
    return res.status(200).json({ items });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '이미지 블라인드 목록 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

export const addMyImageBlind = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  const imageUrl = typeof req.body?.image_url === 'string' ? req.body.image_url.trim() : '';
  if (!imageUrl || imageUrl.length > 2048) {
    return res.status(400).json({ error: 'BadRequest', message: '블라인드할 이미지 정보가 올바르지 않습니다.' });
  }
  try {
    const item = await addUserImageBlind(userId, imageUrl);
    return res.status(200).json({ message: '같은 이미지를 개인 블라인드했습니다.', item });
  } catch (err: any) {
    if (err?.message === 'INVALID_IMAGE_URL') {
      return res.status(400).json({ error: 'BadRequest', message: '블라인드할 수 없는 이미지입니다.' });
    }
    if (err?.message === 'BLIND_LIMIT_EXCEEDED') {
      return res.status(400).json({ error: 'BadRequest', message: '개인 이미지 블라인드 개수 제한을 초과했습니다.' });
    }
    return res.status(500).json({ error: 'InternalServerError', message: '이미지 블라인드 저장 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

const readImageBlindDeleteTarget = (req: Request): string => {
  const bodyTarget = typeof req.body?.image_key === 'string'
    ? req.body.image_key
    : typeof req.body?.image_url === 'string'
      ? req.body.image_url
      : '';
  const queryTarget = typeof req.query?.image_key === 'string'
    ? req.query.image_key
    : typeof req.query?.image_url === 'string'
      ? req.query.image_url
      : '';
  const paramTarget = typeof req.params.image_key === 'string' ? req.params.image_key : '';
  return (bodyTarget || queryTarget || paramTarget || '').trim();
};

export const removeMyImageBlind = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  const imageKey = readImageBlindDeleteTarget(req);
  if (!imageKey) return res.status(400).json({ error: 'BadRequest', message: '해제할 이미지 정보가 올바르지 않습니다.' });
  try {
    await removeUserImageBlind(userId, imageKey);
    return res.status(200).json({ message: '이미지 블라인드를 해제했습니다.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '이미지 블라인드 해제 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};
