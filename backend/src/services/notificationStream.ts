import { Response } from 'express';
import { userRepository } from '../repositories';
import { AppNotification } from '../repositories/interfaces';
import { verifyAuthSessionToken } from './authSessionService';

type NotificationClient = {
  userId: string;
  token: string;
  res: Response;
  heartbeat: NodeJS.Timeout | null;
  closed: boolean;
};

const clients = new Map<string, Set<NotificationClient>>();

const boundedInteger = (raw: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

const MAX_NOTIFICATION_CLIENTS = boundedInteger(process.env.MAX_NOTIFICATION_CLIENTS, 2000, 100, 10_000);
const MAX_NOTIFICATION_CLIENTS_PER_USER = boundedInteger(process.env.MAX_NOTIFICATION_CLIENTS_PER_USER, 3, 1, 10);
const NOTIFICATION_SESSION_REVALIDATE_MS = boundedInteger(
  process.env.NOTIFICATION_SESSION_REVALIDATE_MS,
  25_000,
  5_000,
  60_000
);
const NOTIFICATION_SESSION_REVALIDATE_TIMEOUT_MS = boundedInteger(
  process.env.NOTIFICATION_SESSION_REVALIDATE_TIMEOUT_MS,
  3_000,
  500,
  10_000
);
const MAX_NOTIFICATION_BUFFERED_BYTES = boundedInteger(
  process.env.MAX_NOTIFICATION_BUFFERED_BYTES,
  256 * 1024,
  16 * 1024,
  1024 * 1024
);

const writeEvent = (res: Response, event: string, data: unknown): boolean => {
  try {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const bufferedBytes = Number(res.writableLength || 0);
    if (!Number.isFinite(bufferedBytes) || bufferedBytes + Buffer.byteLength(payload) > MAX_NOTIFICATION_BUFFERED_BYTES) {
      res.destroy();
      return false;
    }
    if (!res.write(payload)) {
      res.destroy();
      return false;
    }
    return true;
  } catch {
    res.destroy();
    return false;
  }
};

const removeClient = (client: NotificationClient, destroy = false) => {
  if (client.closed) return;
  client.closed = true;
  if (client.heartbeat) {
    clearTimeout(client.heartbeat);
    client.heartbeat = null;
  }
  const current = clients.get(client.userId);
  current?.delete(client);
  if (current?.size === 0) clients.delete(client.userId);
  if (destroy && !client.res.destroyed) client.res.destroy();
};

const isCurrentlyBanned = (user: { banned_until?: string | null }) => {
  if (!user.banned_until) return false;
  const expiresAt = new Date(user.banned_until).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
};

const revalidateClient = async (client: NotificationClient) => {
  let timeout: NodeJS.Timeout | null = null;
  try {
    const validation = (async () => {
      const decoded = await verifyAuthSessionToken(client.token);
      if (decoded.id !== client.userId) return false;
      const user = await userRepository.findById(client.userId);
      return Boolean(user) && !isCurrentlyBanned(user as { banned_until?: string | null });
    })().catch(() => false);
    const timedOut = new Promise<false>((resolve) => {
      timeout = setTimeout(() => resolve(false), NOTIFICATION_SESSION_REVALIDATE_TIMEOUT_MS);
      timeout.unref?.();
    });
    return await Promise.race([validation, timedOut]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const scheduleHeartbeat = (client: NotificationClient) => {
  client.heartbeat = setTimeout(async () => {
    client.heartbeat = null;
    if (client.closed || client.res.destroyed || !(await revalidateClient(client))) {
      removeClient(client, true);
      return;
    }
    if (!writeEvent(client.res, 'heartbeat', { ts: Date.now() })) {
      removeClient(client, true);
      return;
    }
    scheduleHeartbeat(client);
  }, NOTIFICATION_SESSION_REVALIDATE_MS);
  client.heartbeat.unref?.();
};

export const subscribeNotificationStream = (userId: string, token: string, res: Response) => {
  if (getNotificationClientCount() >= MAX_NOTIFICATION_CLIENTS) {
    res.status(503).json({ error: 'NotificationStreamBusy', message: '알림 실시간 연결이 많아 잠시 후 다시 연결해 주세요.' });
    return;
  }
  const userClients = clients.get(userId) ?? new Set<NotificationClient>();
  if (userClients.size >= MAX_NOTIFICATION_CLIENTS_PER_USER) {
    res.status(429).json({ error: 'NotificationStreamLimit', message: '계정당 알림 실시간 연결 한도를 초과했습니다.' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();

  const client: NotificationClient = { userId, token, res, heartbeat: null, closed: false };
  userClients.add(client);
  clients.set(userId, userClients);

  if (!writeEvent(res, 'connected', { ok: true, ts: Date.now() })) {
    removeClient(client, true);
    return;
  }
  scheduleHeartbeat(client);

  res.on('close', () => removeClient(client));
};

const getNotificationClientCount = () => {
  let count = 0;
  for (const userClients of clients.values()) count += userClients.size;
  return count;
};

export const getNotificationStreamStats = () => ({
  users: clients.size,
  clients: getNotificationClientCount(),
  maxClients: MAX_NOTIFICATION_CLIENTS,
  maxClientsPerUser: MAX_NOTIFICATION_CLIENTS_PER_USER,
  maxBufferedBytes: MAX_NOTIFICATION_BUFFERED_BYTES
});

export const publishNotification = (notification: AppNotification) => {
  const userId = notification.user_id;
  const userClients = clients.get(userId);
  if (!userClients?.size) return;

  for (const client of userClients) {
    if (client.closed || client.res.destroyed) {
      removeClient(client);
      continue;
    }
    if (!writeEvent(client.res, 'notification', notification)) {
      removeClient(client, true);
    }
  }
};

export const __resetNotificationStreamsForTest = () => {
  for (const userClients of clients.values()) {
    for (const client of userClients) removeClient(client, true);
  }
  clients.clear();
};
