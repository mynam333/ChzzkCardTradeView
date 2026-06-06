import { Request, Response } from 'express';
import { announcementRepository } from '../repositories';
import { IS_PRODUCTION } from '../config';

/**
 * 1. 공지사항 및 팝업 작성 (ADMIN 전용)
 */
export const createAnnouncement = async (req: Request, res: Response) => {
  const { title, content, is_popup, is_pinned, popup_expires_at } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: 'BadRequest', message: '공지사항 제목과 내용이 필요합니다.' });
  }

  try {
    const announcement = await announcementRepository.create({
      title,
      content,
      is_popup: !!is_popup,
      is_pinned: !!is_pinned,
      popup_expires_at: popup_expires_at || null
    });
    return res.status(201).json(announcement);
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '공지사항 생성 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 2. 공지사항 전체 목록 조회
 */
export const getAnnouncements = async (req: Request, res: Response) => {
  try {
    const list = await announcementRepository.findAll();
    return res.status(200).json(list);
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '공지사항 목록 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 3. 활성화된 팝업 공지 목록 조회
 */
export const getActivePopups = async (req: Request, res: Response) => {
  try {
    const popups = await announcementRepository.findActivePopups();
    return res.status(200).json(popups);
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '활성 팝업 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 4-1. 공지사항 팝업 노출 여부 토글 (ADMIN 전용)
 */
export const setAnnouncementPopup = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { is_popup, popup_expires_at } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'BadRequest', message: '공지사항 ID가 필요합니다.' });
  }

  try {
    await announcementRepository.updatePopup(Number(id), !!is_popup, popup_expires_at || null);
    return res.status(200).json({
      message: is_popup ? '팝업으로 등록되었습니다.' : '팝업이 해제되었습니다.',
      id: Number(id),
      is_popup: !!is_popup
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '팝업 설정 변경 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 4-2. 공지사항 수정 (ADMIN 전용)
 */
export const updateAnnouncement = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { title, content, is_popup, is_pinned, popup_expires_at } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'BadRequest', message: '공지사항 ID가 필요합니다.' });
  }

  if (title === undefined && content === undefined && is_popup === undefined && is_pinned === undefined && popup_expires_at === undefined) {
    return res.status(400).json({ error: 'BadRequest', message: '수정할 데이터가 존재하지 않습니다.' });
  }

  try {
    const updated = await announcementRepository.update(Number(id), {
      ...(title !== undefined && { title }),
      ...(content !== undefined && { content }),
      ...(is_popup !== undefined && { is_popup: !!is_popup }),
      ...(is_pinned !== undefined && { is_pinned: !!is_pinned }),
      ...(popup_expires_at !== undefined && { popup_expires_at: popup_expires_at || null })
    });
    return res.status(200).json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '공지사항 수정 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 4. 공지사항 삭제 (ADMIN 전용)
 */
export const deleteAnnouncement = async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'BadRequest', message: '공지사항 ID가 필요합니다.' });
  }

  try {
    await announcementRepository.delete(Number(id));
    return res.status(200).json({ message: '공지사항이 성공적으로 삭제되었습니다.', id: Number(id) });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '공지사항 삭제 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};
