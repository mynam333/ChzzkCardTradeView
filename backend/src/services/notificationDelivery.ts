import { notificationRepository } from '../repositories';
import { AppNotification } from '../repositories/interfaces';
import { publishNotification } from './notificationStream';

export const createRealtimeNotification = async (
  n: Pick<AppNotification, 'user_id' | 'title' | 'body' | 'link'> & { group_key?: string | null }
): Promise<AppNotification> => {
  const notification = n.group_key
    ? await notificationRepository.upsertByGroupKey({ ...n, group_key: n.group_key })
    : await notificationRepository.create(n);
  publishNotification(notification);
  return notification;
};
