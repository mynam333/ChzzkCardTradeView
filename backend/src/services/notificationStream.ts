import { Response } from 'express';
import { AppNotification } from '../repositories/interfaces';

const clients = new Map<string, Set<Response>>();
const MAX_NOTIFICATION_CLIENTS = Math.max(100, Number(process.env.MAX_NOTIFICATION_CLIENTS || 2000));

const writeEvent = (res: Response, event: string, data: unknown): boolean => {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    res.destroy();
    return false;
  }
};

export const subscribeNotificationStream = (userId: string, res: Response) => {
  if (getNotificationClientCount() >= MAX_NOTIFICATION_CLIENTS) {
    res.status(503).json({ error: 'NotificationStreamBusy', message: '알림 실시간 연결이 많아 잠시 후 다시 연결해 주세요.' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();

  const userClients = clients.get(userId) ?? new Set<Response>();
  userClients.add(res);
  clients.set(userId, userClients);

  writeEvent(res, 'connected', { ok: true, ts: Date.now() });
  const heartbeat = setInterval(() => {
    if (res.destroyed || !writeEvent(res, 'heartbeat', { ts: Date.now() })) {
      clearInterval(heartbeat);
      const current = clients.get(userId);
      if (!current) return;
      current.delete(res);
      if (current.size === 0) clients.delete(userId);
    }
  }, 25_000);

  res.on('close', () => {
    clearInterval(heartbeat);
    const current = clients.get(userId);
    if (!current) return;
    current.delete(res);
    if (current.size === 0) clients.delete(userId);
  });
};

const getNotificationClientCount = () => {
  let count = 0;
  for (const userClients of clients.values()) count += userClients.size;
  return count;
};

export const getNotificationStreamStats = () => ({
  users: clients.size,
  clients: getNotificationClientCount(),
  maxClients: MAX_NOTIFICATION_CLIENTS
});

export const publishNotification = (notification: AppNotification) => {
  const userId = notification.user_id;
  const userClients = clients.get(userId);
  if (!userClients?.size) return;

  for (const res of userClients) {
    if (res.destroyed) {
      userClients.delete(res);
      continue;
    }
    if (!writeEvent(res, 'notification', notification)) {
      userClients.delete(res);
    }
  }
  if (userClients.size === 0) clients.delete(userId);
};
