import http from 'http';
import jwt from 'jsonwebtoken';
import WebSocket, { WebSocketServer } from 'ws';
import { JWT_SECRET, isConfiguredCorsOriginAllowed } from '../config';
import { userRepository } from '../repositories';
import { SESSION_COOKIE_NAMES } from './sessionCookie';
import { getEquippedArenaEmoteItem } from './arenaCosmeticService';
import { getDbMode, getMysqlDb, getSqliteDb } from './db';
import { ensureArenaMatchTables } from './arenaMatchService';

type ArenaSocketUser = {
  id: string;
  username: string;
  role: 'USER' | 'ADMIN';
};

type ArenaSocket = WebSocket & {
  user?: ArenaSocketUser;
  currentMatchId?: string | null;
  isAlive?: boolean;
  lastEmoteAt?: number;
  lastJoinAt?: number;
  messageWindowStartedAt?: number;
  messageCountInWindow?: number;
  invalidMessageCount?: number;
};

type ArenaRealtimeMessage =
  | { type: 'join'; match_id: string }
  | { type: 'leave'; match_id?: string }
  | { type: 'emote'; match_id?: string; item_id: number; slot?: number }
  | { type: 'skip_round_reveal'; match_id?: string; round_no: number }
  | { type: 'ping' };

const clientsByMatch = new Map<string, Set<ArenaSocket>>();
const equippedEmoteCache = new Map<string, { item: any | null; expiresAt: number }>();
const matchAccessCache = new Map<string, { allowed: boolean; expiresAt: number }>();
const matchParticipantCache = new Map<string, { userIds: string[]; expiresAt: number }>();
const roundRevealSkipState = new Map<string, { userIds: Set<string>; expiresAt: number }>();

const EMOTE_COOLDOWN_MS = Math.max(750, Number(process.env.ARENA_EMOTE_COOLDOWN_MS || 1500));
const EQUIPPED_EMOTE_CACHE_TTL_MS = Math.max(1000, Number(process.env.ARENA_EMOTE_EQUIP_CACHE_TTL_MS || 10_000));
const MATCH_ACCESS_CACHE_TTL_MS = Math.max(1000, Math.min(60_000, Number(process.env.ARENA_REALTIME_MATCH_ACCESS_CACHE_TTL_MS || 15_000)));
const MAX_MESSAGE_BYTES = Math.max(512, Math.min(8192, Number(process.env.ARENA_REALTIME_WS_MAX_MESSAGE_BYTES || 2048)));
const MESSAGE_WINDOW_MS = Math.max(1000, Math.min(10_000, Number(process.env.ARENA_REALTIME_WS_MESSAGE_WINDOW_MS || 5000)));
const MAX_MESSAGES_PER_WINDOW = Math.max(5, Math.min(60, Number(process.env.ARENA_REALTIME_WS_MAX_MESSAGES_PER_WINDOW || 20)));
const MAX_INVALID_MESSAGES = Math.max(1, Math.min(10, Number(process.env.ARENA_REALTIME_WS_MAX_INVALID_MESSAGES || 3)));
const JOIN_COOLDOWN_MS = Math.max(500, Math.min(10_000, Number(process.env.ARENA_REALTIME_WS_JOIN_COOLDOWN_MS || 1500)));
const MAX_CLIENTS_PER_MATCH = Math.max(2, Math.min(32, Number(process.env.ARENA_REALTIME_WS_MAX_CLIENTS_PER_MATCH || 8)));
const MAX_TOTAL_CLIENTS = Math.max(10, Math.min(2000, Number(process.env.ARENA_REALTIME_WS_MAX_TOTAL_CLIENTS || 500)));
const MAX_ACCESS_CACHE_SIZE = Math.max(100, Math.min(5000, Number(process.env.ARENA_REALTIME_MATCH_ACCESS_CACHE_MAX || 1000)));
const SKIP_REVEAL_TTL_MS = Math.max(30_000, Math.min(10 * 60_000, Number(process.env.ARENA_REALTIME_SKIP_REVEAL_TTL_MS || 3 * 60_000)));

const pruneExpiringMap = <T>(cache: Map<string, { expiresAt: number } & T>, maxSize: number, now = Date.now()) => {
  if (cache.size <= maxSize) return;
  for (const [key, value] of cache) {
    if (value.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > maxSize) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
};

const parseCookies = (cookieHeader = '') => {
  const cookies = new Map<string, string>();
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    cookies.set(key, decodeURIComponent(value));
  }
  return cookies;
};

const sanitizeMatchId = (value: unknown) => {
  const matchId = String(value || '').trim();
  if (!matchId || matchId.length > 80 || !/^[a-zA-Z0-9:_-]+$/.test(matchId)) return null;
  return matchId;
};

const sendJson = (socket: WebSocket, payload: unknown) => {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
};

const broadcastMatch = (matchId: string, payload: unknown) => {
  const clients = clientsByMatch.get(matchId);
  if (!clients) return;
  for (const client of clients) sendJson(client, payload);
};

const removeClient = (socket: ArenaSocket) => {
  if (socket.currentMatchId) {
    const clients = clientsByMatch.get(socket.currentMatchId);
    clients?.delete(socket);
    if (clients && clients.size === 0) clientsByMatch.delete(socket.currentMatchId);
  }
  socket.currentMatchId = null;
};

const authenticateSocket = async (req: http.IncomingMessage): Promise<ArenaSocketUser | null> => {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = SESSION_COOKIE_NAMES
    .map((cookieName) => cookies.get(cookieName))
    .find(Boolean);
  if (!token) return null;

  const decoded = jwt.verify(token, JWT_SECRET) as { id: string };
  const user = await userRepository.findById(decoded.id);
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role
  };
};

const canJoinRealtimeMatch = async (user: ArenaSocketUser, matchId: string): Promise<boolean> => {
  if (user.role === 'ADMIN') return true;
  const cacheKey = `${user.id}:${matchId}`;
  const cached = matchAccessCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.allowed;

  await ensureArenaMatchTables();
  const query = `SELECT id
    FROM arena_matches
    WHERE id = ?
      AND (player_a_id = ? OR player_b_id = ?)
    LIMIT 1`;
  const row = getDbMode() === 'MYSQL'
    ? await getMysqlDb().get<any>(query, matchId, user.id, user.id)
    : getSqliteDb().prepare(query).get(matchId, user.id, user.id) as any;
  const allowed = Boolean(row);
  matchAccessCache.set(cacheKey, { allowed, expiresAt: Date.now() + MATCH_ACCESS_CACHE_TTL_MS });
  pruneExpiringMap(matchAccessCache, MAX_ACCESS_CACHE_SIZE);
  return allowed;
};

const getMatchParticipantUserIds = async (matchId: string): Promise<string[]> => {
  const cached = matchParticipantCache.get(matchId);
  if (cached && cached.expiresAt > Date.now()) return cached.userIds;

  await ensureArenaMatchTables();
  const query = `SELECT player_a_id, player_b_id
    FROM arena_matches
    WHERE id = ?
    LIMIT 1`;
  const row = getDbMode() === 'MYSQL'
    ? await getMysqlDb().get<any>(query, matchId)
    : getSqliteDb().prepare(query).get(matchId) as any;
  const userIds = [row?.player_a_id, row?.player_b_id].filter(Boolean).map(String);
  matchParticipantCache.set(matchId, { userIds, expiresAt: Date.now() + MATCH_ACCESS_CACHE_TTL_MS });
  pruneExpiringMap(matchParticipantCache, MAX_ACCESS_CACHE_SIZE);
  return userIds;
};

const joinMatch = async (socket: ArenaSocket, rawMatchId: unknown) => {
  if (!socket.user) throw new Error('Unauthorized');
  const matchId = sanitizeMatchId(rawMatchId);
  if (!matchId) throw new Error('InvalidMatchId');
  const now = Date.now();
  if (socket.lastJoinAt && now - socket.lastJoinAt < JOIN_COOLDOWN_MS) throw new Error('JoinCooldown');
  socket.lastJoinAt = now;
  if (!(await canJoinRealtimeMatch(socket.user, matchId))) throw new Error('MatchRealtimeForbidden');
  if (socket.currentMatchId && socket.currentMatchId !== matchId) removeClient(socket);

  socket.currentMatchId = matchId;
  const clients = clientsByMatch.get(matchId) || new Set<ArenaSocket>();
  if (!clients.has(socket) && clients.size >= MAX_CLIENTS_PER_MATCH) throw new Error('MatchRealtimeRoomFull');
  clients.add(socket);
  clientsByMatch.set(matchId, clients);
  sendJson(socket, { type: 'joined', match_id: matchId, connected_count: clients.size });
};

const getEquippedEmoteCached = async (userId: string, itemId: number) => {
  const key = `${userId}:${itemId}`;
  const now = Date.now();
  const cached = equippedEmoteCache.get(key);
  if (cached && cached.expiresAt > now) return cached.item;
  const item = await getEquippedArenaEmoteItem(userId, itemId);
  equippedEmoteCache.set(key, { item, expiresAt: now + EQUIPPED_EMOTE_CACHE_TTL_MS });
  pruneExpiringMap(equippedEmoteCache, 5000, now);
  return item;
};

const handleEmote = async (socket: ArenaSocket, message: Extract<ArenaRealtimeMessage, { type: 'emote' }>) => {
  if (!socket.user) throw new Error('Unauthorized');
  const matchId = sanitizeMatchId(message.match_id || socket.currentMatchId);
  if (!matchId || socket.currentMatchId !== matchId) throw new Error('MatchNotJoined');

  const now = Date.now();
  if (socket.lastEmoteAt && now - socket.lastEmoteAt < EMOTE_COOLDOWN_MS) throw new Error('EmoteCooldown');
  const itemId = Number(message.item_id);
  if (!Number.isInteger(itemId) || itemId <= 0) throw new Error('InvalidEmote');

  const item = await getEquippedEmoteCached(socket.user.id, itemId);
  if (!item || item.type !== 'emote') throw new Error('EmoteNotEquipped');
  socket.lastEmoteAt = now;

  broadcastMatch(matchId, {
    type: 'arena_emote',
    match_id: matchId,
    user_id: socket.user.id,
    username: socket.user.username,
    item: {
      id: item.id,
      type: item.type,
      name: item.name,
      description: item.description,
      style_json: item.style_json,
      font_url: item.font_url,
      font_family: item.font_family
    },
    slot: Number.isInteger(Number(message.slot)) ? Number(message.slot) : null,
    sent_at: new Date(now).toISOString()
  });
};

const handleSkipRoundReveal = async (socket: ArenaSocket, message: Extract<ArenaRealtimeMessage, { type: 'skip_round_reveal' }>) => {
  if (!socket.user) throw new Error('Unauthorized');
  const matchId = sanitizeMatchId(message.match_id || socket.currentMatchId);
  if (!matchId || socket.currentMatchId !== matchId) throw new Error('MatchNotJoined');
  const roundNo = Number(message.round_no);
  if (!Number.isInteger(roundNo) || roundNo < 1 || roundNo > 5) throw new Error('InvalidRoundNo');

  const participantIds = await getMatchParticipantUserIds(matchId);
  if (!participantIds.includes(socket.user.id)) throw new Error('MatchRealtimeForbidden');
  const requiredUserIds = participantIds.slice(0, 2);
  const requiredCount = Math.max(1, requiredUserIds.length);
  const key = `${matchId}:${roundNo}`;
  const now = Date.now();
  const state = roundRevealSkipState.get(key) || { userIds: new Set<string>(), expiresAt: now + SKIP_REVEAL_TTL_MS };
  state.userIds.add(socket.user.id);
  state.expiresAt = now + SKIP_REVEAL_TTL_MS;
  roundRevealSkipState.set(key, state);

  for (const [stateKey, value] of roundRevealSkipState) {
    if (value.expiresAt <= now) roundRevealSkipState.delete(stateKey);
  }

  const skippedCount = requiredUserIds.filter((userId) => state.userIds.has(userId)).length;
  const ready = skippedCount >= requiredCount;
  broadcastMatch(matchId, {
    type: 'arena_round_skip_status',
    match_id: matchId,
    round_no: roundNo,
    skipped_count: skippedCount,
    required_count: requiredCount,
    ready,
    sent_at: new Date(now).toISOString()
  });
  if (ready) roundRevealSkipState.delete(key);
};

const guardClientMessage = (socket: ArenaSocket, raw: WebSocket.RawData) => {
  const rawText = raw.toString();
  if (Buffer.byteLength(rawText, 'utf8') > MAX_MESSAGE_BYTES) throw new Error('MessageTooLarge');
  const now = Date.now();
  if (!socket.messageWindowStartedAt || now - socket.messageWindowStartedAt > MESSAGE_WINDOW_MS) {
    socket.messageWindowStartedAt = now;
    socket.messageCountInWindow = 0;
  }
  socket.messageCountInWindow = Number(socket.messageCountInWindow || 0) + 1;
  if (socket.messageCountInWindow > MAX_MESSAGES_PER_WINDOW) throw new Error('MessageRateLimited');
  return rawText;
};

const handleClientMessage = async (socket: ArenaSocket, raw: WebSocket.RawData) => {
  const rawText = guardClientMessage(socket, raw);
  let message: ArenaRealtimeMessage;
  try {
    message = JSON.parse(rawText);
  } catch {
    throw new Error('InvalidJson');
  }

  if (message.type === 'ping') {
    sendJson(socket, { type: 'pong' });
    return;
  }
  if (message.type === 'join') {
    await joinMatch(socket, message.match_id);
    return;
  }
  if (message.type === 'leave') {
    removeClient(socket);
    sendJson(socket, { type: 'left' });
    return;
  }
  if (message.type === 'emote') {
    await handleEmote(socket, message);
    return;
  }
  if (message.type === 'skip_round_reveal') {
    await handleSkipRoundReveal(socket, message);
    return;
  }

  throw new Error('UnknownMessageType');
};

export const attachArenaRealtimeSocketServer = (server: http.Server, path = '/arena/realtime') => {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== path) return;

    const origin = req.headers.origin;
    if (origin && !isConfiguredCorsOriginAllowed(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    try {
      const user = await authenticateSocket(req);
      if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      if (wss.clients.size >= MAX_TOTAL_CLIENTS) {
        socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        const arenaSocket = ws as ArenaSocket;
        arenaSocket.user = user;
        arenaSocket.isAlive = true;
        wss.emit('connection', arenaSocket, req);
      });
    } catch (err: any) {
      console.warn('[ArenaRealtimeSocket] 인증 실패:', err?.message || err);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  });

  wss.on('connection', (socket: ArenaSocket) => {
    sendJson(socket, { type: 'ready', user_id: socket.user?.id, cooldown_ms: EMOTE_COOLDOWN_MS });

    socket.on('pong', () => {
      socket.isAlive = true;
    });

    socket.on('message', (raw) => {
      handleClientMessage(socket, raw).catch((err: any) => {
        const code = err?.message || 'ArenaRealtimeError';
        socket.invalidMessageCount = Number(socket.invalidMessageCount || 0) + 1;
        sendJson(socket, { type: 'error', code, message: code });
        if (['InvalidJson', 'UnknownMessageType', 'MessageTooLarge', 'MessageRateLimited'].includes(code)
          && socket.invalidMessageCount >= MAX_INVALID_MESSAGES) {
          removeClient(socket);
          socket.close(1008, 'ArenaRealtimePolicyViolation');
        }
      });
    });

    socket.on('close', () => removeClient(socket));
    socket.on('error', () => removeClient(socket));
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients as Set<ArenaSocket>) {
      if (socket.isAlive === false) {
        removeClient(socket);
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, Math.max(10_000, Number(process.env.ARENA_REALTIME_WS_HEARTBEAT_MS || 30_000)));
  heartbeat.unref();

  wss.on('close', () => clearInterval(heartbeat));
  return wss;
};
