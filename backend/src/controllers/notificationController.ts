import { Response } from 'express';
import { notificationRepository } from '../repositories';
import { AuthenticatedRequest } from '../middlewares/admin';
import { IS_PRODUCTION } from '../config';
import { subscribeNotificationStream } from '../services/notificationStream';
import { getRequestSessionToken } from '../services/authSessionService';

/**
 * 내 인앱 알림 목록 + 미읽음 수 조회
 */
export const getNotifications = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });

  try {
    const [items, unread] = await Promise.all([
      notificationRepository.findByUser(userId, 50),
      notificationRepository.countUnread(userId)
    ]);
    return res.status(200).json({ items, unread });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '알림 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 인앱 알림 실시간 스트림(SSE)
 */
export const streamNotifications = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  const token = getRequestSessionToken(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized', message: '유효한 로그인 세션이 필요합니다.' });
  subscribeNotificationStream(userId, token, res);
};

/**
 * 특정 알림 읽음 처리
 */
export const markNotificationRead = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'BadRequest', message: '유효한 알림 ID가 필요합니다.' });

  try {
    await notificationRepository.markRead(id, userId);
    return res.status(200).json({ message: '읽음 처리되었습니다.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '읽음 처리 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 전체 알림 읽음 처리
 */
export const markAllNotificationsRead = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });

  try {
    await notificationRepository.markAllRead(userId);
    return res.status(200).json({ message: '모든 알림을 읽음 처리했습니다.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '전체 읽음 처리 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 읽은 알림을 내 알림함에서 숨김 처리합니다. DB 레코드는 유지됩니다.
 */
export const hideReadNotification = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'BadRequest', message: '유효한 알림 ID가 필요합니다.' });

  try {
    const ok = await notificationRepository.hideRead(id, userId);
    if (!ok) {
      return res.status(400).json({ error: 'BadRequest', message: '읽은 알림만 삭제할 수 있습니다.' });
    }
    return res.status(200).json({ ok: true, message: '알림을 삭제했습니다.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '알림 삭제 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};
