import { Request, Response } from 'express';
import { notificationRepository, titleRepository, userRepository } from '../repositories';
import { IS_PRODUCTION } from '../config';

const parseTitleId = (value: unknown): number => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 0;
};

const normalizePayload = (body: any) => {
  const name = String(body?.name || '').trim();
  const css = String(body?.css || '').trim();
  const iconName = String(body?.icon_name || '').trim();
  const iconColor = String(body?.icon_color || '#ffffff').trim();

  if (!name || name.length > 40) throw new Error('칭호명은 1~40자로 입력해 주세요.');
  if (css.length > 20000) throw new Error('CSS는 20,000자 이하로 입력해 주세요.');
  if (iconName && !/^[A-Za-z][A-Za-z0-9]*$/.test(iconName)) throw new Error('Lucide 아이콘명이 올바르지 않습니다.');
  if (!/^#[0-9a-fA-F]{6}$/.test(iconColor)) throw new Error('아이콘 색상은 6자리 HEX 값이어야 합니다.');

  return {
    name,
    css,
    icon_name: iconName || null,
    icon_color: iconColor.toLowerCase()
  };
};

export const listTitles = async (_req: Request, res: Response) => {
  try {
    return res.status(200).json(await titleRepository.findAll());
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '칭호 목록 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

export const createTitle = async (req: Request, res: Response) => {
  try {
    const title = await titleRepository.create(normalizePayload(req.body));
    return res.status(201).json(title);
  } catch (err: any) {
    const badRequest = err.message?.includes('입력') || err.message?.includes('올바르지') || err.message?.includes('이하');
    return res.status(badRequest ? 400 : 500).json({ error: badRequest ? 'BadRequest' : 'InternalServerError', message: err.message || '칭호 생성 실패' });
  }
};

export const updateTitle = async (req: Request, res: Response) => {
  const id = parseTitleId(req.params.id);
  if (!id) return res.status(400).json({ error: 'BadRequest', message: '칭호 ID가 올바르지 않습니다.' });
  try {
    const title = await titleRepository.update(id, normalizePayload(req.body));
    if (!title) return res.status(404).json({ error: 'NotFound', message: '칭호를 찾을 수 없습니다.' });
    return res.status(200).json(title);
  } catch (err: any) {
    const badRequest = err.message?.includes('입력') || err.message?.includes('올바르지') || err.message?.includes('이하');
    return res.status(badRequest ? 400 : 500).json({ error: badRequest ? 'BadRequest' : 'InternalServerError', message: err.message || '칭호 수정 실패' });
  }
};

export const deleteTitle = async (req: Request, res: Response) => {
  const id = parseTitleId(req.params.id);
  if (!id) return res.status(400).json({ error: 'BadRequest', message: '칭호 ID가 올바르지 않습니다.' });
  try {
    if (!(await titleRepository.findById(id))) {
      return res.status(404).json({ error: 'NotFound', message: '칭호를 찾을 수 없습니다.' });
    }
    await titleRepository.delete(id);
    return res.status(200).json({ message: '칭호가 삭제되었습니다.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '칭호 삭제 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

export const awardTitle = async (req: Request, res: Response) => {
  const id = parseTitleId(req.params.id);
  const userId = String(req.params.user_id || '');
  try {
    const [title, user] = await Promise.all([titleRepository.findById(id), userRepository.findById(userId)]);
    if (!title || !user) return res.status(404).json({ error: 'NotFound', message: '칭호 또는 유저를 찾을 수 없습니다.' });
    await titleRepository.award(userId, id);
    await notificationRepository.create({
      user_id: userId,
      title: '새 칭호를 획득했습니다',
      body: `[${title.name}] 칭호가 수여되었습니다.`,
      link: '/my-info'
    });
    return res.status(200).json({ message: `${user.username}님에게 ${title.name} 칭호를 수여했습니다.` });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '칭호 수여 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

export const revokeTitle = async (req: Request, res: Response) => {
  const id = parseTitleId(req.params.id);
  const userId = String(req.params.user_id || '');
  try {
    const [title, user] = await Promise.all([titleRepository.findById(id), userRepository.findById(userId)]);
    if (!title || !user) return res.status(404).json({ error: 'NotFound', message: '칭호 또는 유저를 찾을 수 없습니다.' });
    await titleRepository.revoke(userId, id);
    return res.status(200).json({ message: `${user.username}님의 ${title.name} 칭호를 회수했습니다.` });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '칭호 회수 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

export const equipMyTitle = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });

  const rawTitleId = req.body?.title_id;
  const titleId = rawTitleId === null ? null : parseTitleId(rawTitleId);
  if (rawTitleId !== null && !titleId) {
    return res.status(400).json({ error: 'BadRequest', message: '칭호 ID가 올바르지 않습니다.' });
  }

  try {
    const equipped = await titleRepository.equip(userId, titleId);
    if (!equipped) {
      return res.status(404).json({ error: 'NotFound', message: '보유하지 않은 칭호입니다.' });
    }
    const titles = await titleRepository.findByUserId(userId);
    return res.status(200).json({
      message: titleId === null ? '칭호 장착을 해제했습니다.' : '칭호를 장착했습니다.',
      owned_titles: titles,
      titles: titles.filter((title) => title.is_equipped)
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '칭호 장착 변경 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};
