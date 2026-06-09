import { Response } from 'express';
import { AppNotification } from '../repositories/interfaces';

const clients = new Map<string, Set<Response>>();

const writeEvent = (res: Response, event: string, data: unknown) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

export const subscribeNotificationStream = (userId: string, res: Response) => {
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
    if (!res.destroyed) writeEvent(res, 'heartbeat', { ts: Date.now() });
  }, 25_000);

  res.on('close', () => {
    clearInterval(heartbeat);
    const current = clients.get(userId);
    if (!current) return;
    current.delete(res);
    if (current.size === 0) clients.delete(userId);
  });
};

export const publishNotification = (notification: AppNotification) => {
  const userId = notification.user_id;
  const userClients = clients.get(userId);
  if (!userClients?.size) return;

  for (const res of userClients) {
    if (res.destroyed) {
      userClients.delete(res);
      continue;
    }
    writeEvent(res, 'notification', notification);
  }
  if (userClients.size === 0) clients.delete(userId);
};
