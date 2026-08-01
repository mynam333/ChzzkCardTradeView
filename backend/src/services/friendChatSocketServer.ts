import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { isConfiguredCorsOriginAllowed } from '../config';
import { createRealtimeNotification } from './notificationDelivery';
import { sendPushToUser } from '../controllers/pushController';
import { userRepository } from '../repositories';
import { SESSION_COOKIE_NAMES } from './sessionCookie';
import { verifyAuthSessionToken, verifyAuthSessionTokens } from './authSessionService';
import {
  getOrCreateChatRoom,
  getChatMessageForRoom,
  getRoomForUser,
  listFriends,
  listMessages,
  markRoomMessagesRead,
  registerChatMessageUpdateNotifier,
  sendChatMessage,
  type ChatSendOptions,
  type ChatMessageRow,
  type ChatRoomRow
} from './friendChatService';
import { clearChatRoomViewing, isChatRoomViewing, markChatRoomViewing } from './chatPresence';

type ChatSocketUser = {
  id: string;
  username: string;
  role: 'USER' | 'ADMIN';
};

type TokenBucket = {
  tokens: number;
  refilledAt: number;
};

type RetainedUserTokenBucket = TokenBucket & {
  lastSeenAt: number;
};

type ChatSocket = WebSocket & {
  user?: ChatSocketUser;
  sessionToken?: string;
  currentRoomId?: number | null;
  isAlive?: boolean;
  isRegistered?: boolean;
  authValid?: boolean;
  inFlightMessages?: number;
  businessMessageBucket?: TokenBucket;
  pingBucket?: TokenBucket;
  controlFrameBucket?: TokenBucket;
  policyCloseStarted?: boolean;
};

type ClientMessage =
  | { type: 'join'; room_id: number }
  | { type: 'leave'; room_id?: number }
  | { type: 'announce'; room_id: number; message_id: number }
  | { type: 'open_send'; user_id: string; body: string }
  | { type: 'read'; room_id: number }
  | { type: 'send'; room_id: number; body: string }
  | { type: 'ping' };

const clientsByUser = new Map<string, Set<ChatSocket>>();
const clientsByRoom = new Map<number, Set<ChatSocket>>();

const readPositiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const CHAT_WS_MAX_CONNECTIONS = readPositiveInteger(process.env.CHAT_WS_MAX_CONNECTIONS, 5_000);
const CHAT_WS_MAX_CONNECTIONS_PER_USER = Math.min(
  CHAT_WS_MAX_CONNECTIONS,
  readPositiveInteger(process.env.CHAT_WS_MAX_CONNECTIONS_PER_USER, 5)
);
const CHAT_WS_MAX_IN_FLIGHT_MESSAGES = readPositiveInteger(process.env.CHAT_WS_MAX_IN_FLIGHT_MESSAGES, 4);
const CHAT_WS_MAX_PAYLOAD_BYTES = Math.min(
  64 * 1024,
  Math.max(1024, readPositiveInteger(process.env.CHAT_WS_MAX_PAYLOAD_BYTES, 16 * 1024))
);
const CHAT_WS_AUTH_REVALIDATE_TIMEOUT_MS = Math.max(
  250,
  readPositiveInteger(process.env.CHAT_WS_AUTH_REVALIDATE_TIMEOUT_MS, 3_000)
);
const CHAT_WS_SOCKET_MESSAGE_RATE_PER_SECOND = Math.min(
  100,
  readPositiveInteger(process.env.CHAT_WS_SOCKET_MESSAGE_RATE_PER_SECOND, 10)
);
const CHAT_WS_SOCKET_MESSAGE_BURST = Math.min(
  500,
  readPositiveInteger(process.env.CHAT_WS_SOCKET_MESSAGE_BURST, 20)
);
const CHAT_WS_USER_MESSAGE_RATE_PER_SECOND = Math.min(
  500,
  readPositiveInteger(process.env.CHAT_WS_USER_MESSAGE_RATE_PER_SECOND, 50)
);
const CHAT_WS_USER_MESSAGE_BURST = Math.min(
  1_000,
  readPositiveInteger(process.env.CHAT_WS_USER_MESSAGE_BURST, 100)
);
const CHAT_WS_PING_RATE_PER_SECOND = Math.min(
  10,
  readPositiveInteger(process.env.CHAT_WS_PING_RATE_PER_SECOND, 2)
);
const CHAT_WS_PING_BURST = Math.min(
  20,
  readPositiveInteger(process.env.CHAT_WS_PING_BURST, 4)
);
const CHAT_WS_CONTROL_FRAME_RATE_PER_SECOND = Math.min(
  10,
  readPositiveInteger(process.env.CHAT_WS_CONTROL_FRAME_RATE_PER_SECOND, 2)
);
const CHAT_WS_CONTROL_FRAME_BURST = Math.min(
  32,
  readPositiveInteger(process.env.CHAT_WS_CONTROL_FRAME_BURST, 8)
);
const CHAT_WS_MAX_BUFFERED_BYTES = Math.min(
  16 * 1024 * 1024,
  Math.max(1_024, readPositiveInteger(process.env.CHAT_WS_MAX_BUFFERED_BYTES, 1024 * 1024))
);
const CHAT_WS_USER_BUCKET_TTL_MS = Math.min(
  10 * 60_000,
  Math.max(5_000, readPositiveInteger(process.env.CHAT_WS_USER_BUCKET_TTL_MS, 60_000))
);
const CHAT_WS_MAX_TRACKED_USER_BUCKETS = Math.min(
  100_000,
  Math.max(
    CHAT_WS_MAX_CONNECTIONS,
    readPositiveInteger(process.env.CHAT_WS_MAX_TRACKED_USER_BUCKETS, 20_000)
  )
);

let registeredClientCount = 0;
let pendingUpgradeCount = 0;
const pendingUpgradesByUser = new Map<string, number>();
const userMessageBuckets = new Map<string, RetainedUserTokenBucket>();
let lastUserMessageBucketPruneAt = 0;

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

const schedulePolicyClose = (socket: ChatSocket, closeCode: number, reason: string) => {
  if (socket.policyCloseStarted) return;
  socket.policyCloseStarted = true;
  socket.authValid = false;
  if (socket.readyState === WebSocket.OPEN) socket.close(closeCode, reason.slice(0, 123));
  const terminateTimer = setTimeout(() => {
    if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
  }, 1_000);
  terminateTimer.unref();
};

const sendJson = (socket: ChatSocket, payload: unknown) => {
  if (socket.readyState !== WebSocket.OPEN) return false;
  const serialized = JSON.stringify(payload);
  const serializedBytes = Buffer.byteLength(serialized, 'utf8');
  if (socket.bufferedAmount + serializedBytes > CHAT_WS_MAX_BUFFERED_BYTES) {
    schedulePolicyClose(socket, 1013, 'BackpressureExceeded');
    return false;
  }
  try {
    socket.send(serialized, (err) => {
      if (err && socket.readyState !== WebSocket.CLOSED) socket.terminate();
    });
    return true;
  } catch {
    const currentReadyState: number = socket.readyState;
    if (currentReadyState !== WebSocket.CLOSED) socket.terminate();
    return false;
  }
};

const createTokenBucket = (capacity: number, now = Date.now()): TokenBucket => ({
  tokens: capacity,
  refilledAt: now
});

const pruneUserMessageBuckets = (now: number, requiredSpace = 0) => {
  if (
    now < lastUserMessageBucketPruneAt
    || now - lastUserMessageBucketPruneAt >= Math.min(1_000, CHAT_WS_USER_BUCKET_TTL_MS)
  ) {
    lastUserMessageBucketPruneAt = now;
    for (const [userId, bucket] of userMessageBuckets) {
      if (!clientsByUser.has(userId) && now - bucket.lastSeenAt >= CHAT_WS_USER_BUCKET_TTL_MS) {
        userMessageBuckets.delete(userId);
      }
    }
  }
  if (userMessageBuckets.size + requiredSpace <= CHAT_WS_MAX_TRACKED_USER_BUCKETS) return true;

  // Map insertion order is maintained as an LRU order by get/touch. Evicting
  // from the front avoids an attacker forcing an O(n log n) sort per account.
  for (const [userId] of userMessageBuckets) {
    if (clientsByUser.has(userId)) continue;
    userMessageBuckets.delete(userId);
    if (userMessageBuckets.size + requiredSpace <= CHAT_WS_MAX_TRACKED_USER_BUCKETS) return true;
  }
  return userMessageBuckets.size + requiredSpace <= CHAT_WS_MAX_TRACKED_USER_BUCKETS;
};

const touchRetainedUserBucket = (userId: string, bucket: RetainedUserTokenBucket, now: number) => {
  bucket.lastSeenAt = now;
  userMessageBuckets.delete(userId);
  userMessageBuckets.set(userId, bucket);
};

const getRetainedUserBucket = (userId: string, now: number) => {
  const existing = userMessageBuckets.get(userId);
  if (existing) {
    touchRetainedUserBucket(userId, existing, now);
    return existing;
  }
  if (!pruneUserMessageBuckets(now, 1)) return null;
  const created: RetainedUserTokenBucket = {
    ...createTokenBucket(CHAT_WS_USER_MESSAGE_BURST, now),
    lastSeenAt: now
  };
  userMessageBuckets.set(userId, created);
  return created;
};

const refillTokenBucket = (
  bucket: TokenBucket,
  capacity: number,
  ratePerSecond: number,
  now: number
) => {
  const elapsedMs = Math.max(0, now - bucket.refilledAt);
  bucket.tokens = Math.min(capacity, bucket.tokens + ((elapsedMs / 1_000) * ratePerSecond));
  bucket.refilledAt = now;
};

const consumePingToken = (socket: ChatSocket) => {
  const now = Date.now();
  const bucket = socket.pingBucket || createTokenBucket(CHAT_WS_PING_BURST, now);
  socket.pingBucket = bucket;
  refillTokenBucket(bucket, CHAT_WS_PING_BURST, CHAT_WS_PING_RATE_PER_SECOND, now);
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
};

const consumeControlFrameToken = (socket: ChatSocket) => {
  const now = Date.now();
  const bucket = socket.controlFrameBucket || createTokenBucket(CHAT_WS_CONTROL_FRAME_BURST, now);
  socket.controlFrameBucket = bucket;
  refillTokenBucket(
    bucket,
    CHAT_WS_CONTROL_FRAME_BURST,
    CHAT_WS_CONTROL_FRAME_RATE_PER_SECOND,
    now
  );
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
};

const consumeBusinessMessageTokens = (socket: ChatSocket) => {
  const userId = socket.user?.id;
  if (!userId) return false;
  const now = Date.now();
  const socketBucket = socket.businessMessageBucket
    || createTokenBucket(CHAT_WS_SOCKET_MESSAGE_BURST, now);
  const userBucket = getRetainedUserBucket(userId, now);
  if (!userBucket) return false;
  socket.businessMessageBucket = socketBucket;
  refillTokenBucket(
    socketBucket,
    CHAT_WS_SOCKET_MESSAGE_BURST,
    CHAT_WS_SOCKET_MESSAGE_RATE_PER_SECOND,
    now
  );
  refillTokenBucket(
    userBucket,
    CHAT_WS_USER_MESSAGE_BURST,
    CHAT_WS_USER_MESSAGE_RATE_PER_SECOND,
    now
  );
  if (socketBucket.tokens < 1 || userBucket.tokens < 1) return false;
  socketBucket.tokens -= 1;
  userBucket.tokens -= 1;
  return true;
};

const closeRateLimitedSocket = (
  socket: ChatSocket,
  code: 'MessageRateExceeded' | 'PingRateExceeded' | 'ControlFrameRateExceeded'
) => {
  if (socket.policyCloseStarted) return;
  sendJson(socket, { type: 'error', code, message: code });
  schedulePolicyClose(socket, 1008, code);
};

const broadcastRoom = (roomId: number, payload: unknown) => {
  const clients = clientsByRoom.get(roomId);
  if (!clients) return;
  for (const client of clients) sendJson(client, payload);
};

const sendUser = (userId: string, payload: unknown) => {
  const clients = clientsByUser.get(userId);
  if (!clients) return;
  for (const client of clients) sendJson(client, payload);
};

const sendRoomState = async (userId: string, roomId: number) => {
  const clients = clientsByUser.get(userId);
  if (!clients?.size) return;
  const needsRoomState = Array.from(clients).some((client) => (
    client.readyState === WebSocket.OPEN && client.currentRoomId !== roomId
  ));
  if (!needsRoomState) return;
  const room = await getRoomForUser(roomId, userId);
  if (room) sendUser(userId, { type: 'room_state', room });
};

registerChatMessageUpdateNotifier((roomId, message) => {
  broadcastRoom(roomId, { type: 'message_updated', room_id: roomId, message });
});

const addClient = (socket: ChatSocket, userId: string) => {
  if (socket.isRegistered) return;
  const set = clientsByUser.get(userId) || new Set<ChatSocket>();
  set.add(socket);
  clientsByUser.set(userId, set);
  socket.isRegistered = true;
  registeredClientCount += 1;
};

const leaveRoom = (socket: ChatSocket) => {
  if (socket.currentRoomId) {
    const roomSet = clientsByRoom.get(socket.currentRoomId);
    roomSet?.delete(socket);
    if (roomSet && roomSet.size === 0) clientsByRoom.delete(socket.currentRoomId);
    if (socket.user) clearChatRoomViewing(socket.currentRoomId, socket.user.id);
  }
  socket.currentRoomId = null;
};

const removeClient = (socket: ChatSocket) => {
  leaveRoom(socket);
  if (!socket.isRegistered) return;
  if (socket.user) {
    const userSet = clientsByUser.get(socket.user.id);
    userSet?.delete(socket);
    if (userSet && userSet.size === 0) {
      clientsByUser.delete(socket.user.id);
      const retainedBucket = userMessageBuckets.get(socket.user.id);
      if (retainedBucket) touchRetainedUserBucket(socket.user.id, retainedBucket, Date.now());
    }
  }
  socket.isRegistered = false;
  registeredClientCount = Math.max(0, registeredClientCount - 1);
};

const rejectUpgrade = (socket: NodeJS.WritableStream & { destroy: () => void }, status: string) => {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
};

const reserveGlobalUpgrade = () => {
  if (registeredClientCount + pendingUpgradeCount >= CHAT_WS_MAX_CONNECTIONS) return false;
  pendingUpgradeCount += 1;
  return true;
};

const releaseGlobalUpgrade = () => {
  pendingUpgradeCount = Math.max(0, pendingUpgradeCount - 1);
};

const reserveUserUpgrade = (userId: string) => {
  const pending = pendingUpgradesByUser.get(userId) || 0;
  const connected = clientsByUser.get(userId)?.size || 0;
  if (connected + pending >= CHAT_WS_MAX_CONNECTIONS_PER_USER) return false;
  pendingUpgradesByUser.set(userId, pending + 1);
  return true;
};

const releaseUserUpgrade = (userId: string) => {
  const remaining = (pendingUpgradesByUser.get(userId) || 1) - 1;
  if (remaining > 0) pendingUpgradesByUser.set(userId, remaining);
  else pendingUpgradesByUser.delete(userId);
};

class SocketAuthorizationError extends Error {}

const isActiveBan = (bannedUntil: string | null | undefined) => {
  if (!bannedUntil) return false;
  const expiresAt = new Date(bannedUntil).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
};

// Keep token verification behind one async boundary so the session implementation can
// add server-side revocation checks without changing the WebSocket call sites.
const verifySessionToken = async (token: string): Promise<{ userId: string }> => {
  const decoded = await verifyAuthSessionToken(token);
  const userId = decoded.id.trim();
  if (!userId) throw new SocketAuthorizationError('Unauthorized');
  return { userId };
};

const withAuthorizationTimeout = async <T>(task: Promise<T>): Promise<T> => {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new SocketAuthorizationError('AuthLookupTimeout')),
          CHAT_WS_AUTH_REVALIDATE_TIMEOUT_MS
        );
        timeout.unref();
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const loadAuthorizedUser = async (token: string): Promise<ChatSocketUser> => {
  try {
    return await withAuthorizationTimeout((async () => {
      const { userId } = await verifySessionToken(token);
      const user = await userRepository.findById(userId);
      if (!user) throw new SocketAuthorizationError('Unauthorized');
      if (isActiveBan(user.banned_until)) throw new SocketAuthorizationError('BannedUser');
      return {
        id: user.id,
        username: user.username,
        role: user.role
      };
    })());
  } catch (err) {
    if (err instanceof SocketAuthorizationError) throw err;
    throw new SocketAuthorizationError('Unauthorized');
  }
};

const authenticateSocket = async (req: http.IncomingMessage): Promise<{ user: ChatSocketUser; token: string } | null> => {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = SESSION_COOKIE_NAMES
    .map((cookieName) => cookies.get(cookieName))
    .find(Boolean);
  if (!token) return null;

  return { user: await loadAuthorizedUser(token), token };
};

const revalidateSocketAuthorization = async (socket: ChatSocket) => {
  if (!socket.sessionToken || !socket.user || socket.authValid === false) {
    throw new SocketAuthorizationError('Unauthorized');
  }
  const currentUser = await loadAuthorizedUser(socket.sessionToken);
  if (currentUser.id !== socket.user.id) throw new SocketAuthorizationError('Unauthorized');
  socket.user = currentUser;
  return currentUser;
};

const closeUnauthorizedSocket = (socket: ChatSocket, code: string) => {
  if (socket.authValid === false || socket.policyCloseStarted) return;
  leaveRoom(socket);
  sendJson(socket, { type: 'error', code, message: code });
  schedulePolicyClose(socket, 1008, code);
};

const revalidateIdleSockets = async (sockets: ChatSocket[]) => {
  const socketsByUser = new Map<string, ChatSocket[]>();
  const socketsToValidate: ChatSocket[] = [];
  for (const socket of sockets) {
    if (socket.authValid === false || socket.isAlive === false) {
      removeClient(socket);
      socket.terminate();
      continue;
    }
    if (!socket.sessionToken || !socket.user) {
      closeUnauthorizedSocket(socket, 'Unauthorized');
      continue;
    }
    socketsToValidate.push(socket);
  }

  let verifiedSessions: Map<string, Awaited<ReturnType<typeof verifyAuthSessionToken>>>;
  try {
    verifiedSessions = await withAuthorizationTimeout(
      verifyAuthSessionTokens(socketsToValidate.map((socket) => socket.sessionToken!))
    );
  } catch (err: any) {
    for (const socket of socketsToValidate) {
      closeUnauthorizedSocket(socket, err?.message || 'AuthLookupTimeout');
    }
    return;
  }

  for (const socket of socketsToValidate) {
    const session = verifiedSessions.get(socket.sessionToken!);
    if (!session || session.id !== socket.user!.id) {
      closeUnauthorizedSocket(socket, 'Unauthorized');
      continue;
    }
    const userSockets = socketsByUser.get(session.id) || [];
    userSockets.push(socket);
    socketsByUser.set(session.id, userSockets);
  }

  const userIds = Array.from(socketsByUser.keys());
  const batches: string[][] = [];
  for (let index = 0; index < userIds.length; index += 200) {
    batches.push(userIds.slice(index, index + 200));
  }

  await Promise.all(batches.map(async (batch) => {
    let currentUsers: Awaited<ReturnType<typeof userRepository.findByIds>>;
    try {
      currentUsers = await withAuthorizationTimeout(userRepository.findByIds(batch));
    } catch (err: any) {
      for (const userId of batch) {
        for (const socket of socketsByUser.get(userId) || []) {
          closeUnauthorizedSocket(socket, err?.message || 'AuthLookupTimeout');
        }
      }
      return;
    }

    const usersById = new Map(currentUsers.map((user) => [user.id, user]));
    for (const userId of batch) {
      const user = usersById.get(userId);
      for (const socket of socketsByUser.get(userId) || []) {
        if (!user) {
          closeUnauthorizedSocket(socket, 'Unauthorized');
          continue;
        }
        if (isActiveBan(user.banned_until)) {
          closeUnauthorizedSocket(socket, 'BannedUser');
          continue;
        }
        socket.user = { id: user.id, username: user.username, role: user.role };
        if (socket.readyState !== WebSocket.OPEN) continue;
        socket.isAlive = false;
        socket.ping();
      }
    }
  }));
};

const assertRoomAccess = async (socket: ChatSocket, roomId: number): Promise<ChatRoomRow> => {
  if (!socket.user) throw new Error('Unauthorized');
  const room = await getRoomForUser(roomId, socket.user.id);
  if (!room) throw new Error('RoomNotFound');
  return room;
};

const joinRoom = async (socket: ChatSocket, roomId: number) => {
  if (!socket.user) throw new Error('Unauthorized');
  const room = await assertRoomAccess(socket, roomId);

  if (socket.currentRoomId && socket.currentRoomId !== roomId) {
    leaveRoom(socket);
  }

  socket.currentRoomId = roomId;
  const roomSet = clientsByRoom.get(roomId) || new Set<ChatSocket>();
  roomSet.add(socket);
  clientsByRoom.set(roomId, roomSet);
  markChatRoomViewing(roomId, socket.user.id);

  const messages = await listMessages(roomId, socket.user.id);
  sendJson(socket, { type: 'joined', room, messages });
  broadcastRoom(roomId, { type: 'read', room_id: roomId, reader_id: socket.user.id });
  await Promise.all([
    sendRoomState(room.user_a_id, roomId),
    sendRoomState(room.user_b_id, roomId)
  ]);
};

const notifyIfNeeded = async (
  receiverId: string,
  senderId: string,
  senderName: string,
  roomId: number,
  body: string,
  receiverViewing: boolean,
  receiverMuted: boolean
) => {
  if (receiverViewing || receiverMuted) return;
  const preview = body.length > 80 ? `${body.slice(0, 80)}...` : body;
  await createRealtimeNotification({
    user_id: receiverId,
    title: `${senderName}님의 1:1 톡`,
    body: preview,
    link: `friends?room=${roomId}`,
    group_key: `friend-chat:${senderId}`
  });
  sendPushToUser(receiverId, `${senderName}님의 1:1 톡`, preview, `/friends?room=${roomId}`).catch(() => {
    // 푸시 실패는 채팅 전송을 막지 않습니다.
  });
};

const handleSend = async (
  socket: ChatSocket,
  roomId: number,
  body: string,
  options: ChatSendOptions = {}
) => {
  if (!socket.user) throw new Error('Unauthorized');
  const text = String(body || '').trim();
  if (!text || text.length > 1000) throw new Error('InvalidMessage');

  const room = await assertRoomAccess(socket, roomId);
  const receiverId = room.user_a_id === socket.user.id ? room.user_b_id : room.user_a_id;
  const receiverInWorkerRoom = Array.from(clientsByRoom.get(roomId) || [])
    .some((client) => client.user?.id === receiverId && client.readyState === WebSocket.OPEN);
  const receiverViewing = receiverInWorkerRoom || isChatRoomViewing(roomId, receiverId);
  const receiverMuted = room.user_a_id === receiverId ? room.muted_for_a : room.muted_for_b;

  const result = await sendChatMessage(roomId, socket.user.id, text, receiverViewing, options);
  await notifyIfNeeded(result.receiverId, socket.user.id, socket.user.username, roomId, text, receiverViewing, receiverMuted);

  const payload = { type: 'message', room_id: roomId, message: result.message };
  const delivered = new Set<ChatSocket>();
  sendJson(socket, payload);
  delivered.add(socket);
  for (const client of clientsByRoom.get(roomId) || []) {
    if (delivered.has(client)) continue;
    sendJson(client, payload);
    delivered.add(client);
  }
  const receiverClients = clientsByUser.get(receiverId);
  receiverClients?.forEach((client) => {
    if (!delivered.has(client)) sendJson(client, payload);
  });
  await Promise.all([
    sendRoomState(socket.user.id, roomId),
    sendRoomState(receiverId, roomId)
  ]);
};

const broadcastMessage = async (socket: ChatSocket, roomId: number, message: ChatMessageRow, receiverId: string, echoSource = true) => {
  if (!socket.user) throw new Error('Unauthorized');
  const payload = { type: 'message', room_id: roomId, message };
  const delivered = new Set<ChatSocket>();
  if (echoSource) sendJson(socket, payload);
  delivered.add(socket);
  for (const client of clientsByRoom.get(roomId) || []) {
    if (delivered.has(client)) continue;
    sendJson(client, payload);
    delivered.add(client);
  }
  const receiverClients = clientsByUser.get(receiverId);
  receiverClients?.forEach((client) => {
    if (!delivered.has(client)) sendJson(client, payload);
  });
  await Promise.all([
    sendRoomState(socket.user.id, roomId),
    sendRoomState(receiverId, roomId)
  ]);
};

const handleAnnounce = async (socket: ChatSocket, roomId: number, messageId: number) => {
  if (!socket.user) throw new Error('Unauthorized');
  const room = await assertRoomAccess(socket, roomId);
  const message = await getChatMessageForRoom(roomId, messageId, socket.user.id);
  if (!message || message.sender_id !== socket.user.id) throw new Error('MessageNotFound');
  const receiverId = room.user_a_id === socket.user.id ? room.user_b_id : room.user_a_id;
  await broadcastMessage(socket, roomId, message, receiverId, false);
};

const handleOpenAndSend = async (socket: ChatSocket, targetUserId: string, body: string) => {
  if (!socket.user) throw new Error('Unauthorized');
  const targetId = String(targetUserId || '').trim();
  if (!targetId || targetId === socket.user.id) throw new Error('InvalidTarget');
  const text = String(body || '').trim();
  if (!text || text.length > 1000) throw new Error('InvalidMessage');

  const isAdminOpen = socket.user.role === 'ADMIN';
  if (!isAdminOpen) {
    const friends = await listFriends(socket.user.id);
    if (!friends.some((friend) => friend.id === targetId)) throw new Error('FriendsOnly');
  }

  const room = await getOrCreateChatRoom(socket.user.id, targetId, isAdminOpen);
  await joinRoom(socket, room.id);
  await handleSend(socket, room.id, text, { allowNonFriend: isAdminOpen });
};

const handleRead = async (socket: ChatSocket, roomId: number) => {
  if (!socket.user) throw new Error('Unauthorized');
  const room = await markRoomMessagesRead(roomId, socket.user.id);
  markChatRoomViewing(roomId, socket.user.id);
  broadcastRoom(roomId, { type: 'read', room_id: roomId, reader_id: socket.user.id });
  await Promise.all([
    sendRoomState(room.user_a_id, roomId),
    sendRoomState(room.user_b_id, roomId)
  ]);
};

const parseClientMessage = (raw: WebSocket.RawData): ClientMessage => {
  try {
    const message = JSON.parse(raw.toString());
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('InvalidJson');
    return message as ClientMessage;
  } catch {
    throw new Error('InvalidJson');
  }
};

const handleClientMessage = async (socket: ChatSocket, message: ClientMessage) => {
  await revalidateSocketAuthorization(socket);
  if (message.type === 'join') {
    await joinRoom(socket, Number(message.room_id));
    return;
  }
  if (message.type === 'leave') {
    leaveRoom(socket);
    sendJson(socket, { type: 'left' });
    return;
  }
  if (message.type === 'read') {
    await handleRead(socket, Number(message.room_id));
    return;
  }
  if (message.type === 'announce') {
    await handleAnnounce(socket, Number(message.room_id), Number(message.message_id));
    return;
  }
  if (message.type === 'open_send') {
    await handleOpenAndSend(socket, message.user_id, message.body);
    return;
  }
  if (message.type === 'send') {
    await handleSend(socket, Number(message.room_id), message.body);
    return;
  }

  throw new Error('UnknownMessageType');
};

export const attachFriendChatSocketServer = (server: http.Server, path = '/chat') => {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: CHAT_WS_MAX_PAYLOAD_BYTES,
    autoPong: false
  });

  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== path) return;

    const origin = req.headers.origin;
    if (origin && !isConfiguredCorsOriginAllowed(origin)) {
      rejectUpgrade(socket, '403 Forbidden');
      return;
    }

    if (!reserveGlobalUpgrade()) {
      rejectUpgrade(socket, '503 Service Unavailable');
      return;
    }

    let reservedUserId: string | null = null;
    try {
      const session = await authenticateSocket(req);
      if (!session) {
        rejectUpgrade(socket, '401 Unauthorized');
        return;
      }
      if (!reserveUserUpgrade(session.user.id)) {
        rejectUpgrade(socket, '429 Too Many Requests');
        return;
      }
      reservedUserId = session.user.id;
      wss.handleUpgrade(req, socket, head, (ws) => {
        const chatSocket = ws as ChatSocket;
        chatSocket.user = session.user;
        chatSocket.sessionToken = session.token;
        chatSocket.isAlive = true;
        chatSocket.authValid = true;
        chatSocket.inFlightMessages = 0;
        addClient(chatSocket, session.user.id);
        wss.emit('connection', chatSocket, req);
      });
    } catch (err: any) {
      console.warn('[FriendChatSocket] 인증 실패:', err?.message || err);
      rejectUpgrade(socket, '401 Unauthorized');
    } finally {
      if (reservedUserId) releaseUserUpgrade(reservedUserId);
      releaseGlobalUpgrade();
    }
  });

  wss.on('connection', (socket: ChatSocket) => {
    sendJson(socket, { type: 'ready', user_id: socket.user?.id });

    socket.on('ping', (data) => {
      if (socket.authValid === false) return;
      if (!consumeControlFrameToken(socket)) {
        closeRateLimitedSocket(socket, 'ControlFrameRateExceeded');
        return;
      }
      if (socket.bufferedAmount + data.byteLength > CHAT_WS_MAX_BUFFERED_BYTES) {
        schedulePolicyClose(socket, 1013, 'BackpressureExceeded');
        return;
      }
      try {
        socket.pong(data, false, (err?: Error) => {
          if (err && socket.readyState !== WebSocket.CLOSED) socket.terminate();
        });
      } catch {
        socket.terminate();
      }
    });

    socket.on('pong', () => {
      if (socket.authValid === false) return;
      if (!consumeControlFrameToken(socket)) {
        closeRateLimitedSocket(socket, 'ControlFrameRateExceeded');
        return;
      }
      socket.isAlive = true;
    });

    socket.on('message', (raw) => {
      if (socket.authValid === false) return;
      let message: ClientMessage;
      try {
        message = parseClientMessage(raw);
      } catch (err: any) {
        if (!consumeBusinessMessageTokens(socket)) {
          closeRateLimitedSocket(socket, 'MessageRateExceeded');
          return;
        }
        const code = err?.message || 'InvalidJson';
        sendJson(socket, { type: 'error', code, message: code });
        return;
      }
      if (message.type === 'ping') {
        if (!consumePingToken(socket)) {
          closeRateLimitedSocket(socket, 'PingRateExceeded');
          return;
        }
        sendJson(socket, { type: 'pong' });
        return;
      }
      if (!consumeBusinessMessageTokens(socket)) {
        closeRateLimitedSocket(socket, 'MessageRateExceeded');
        return;
      }
      const inFlight = socket.inFlightMessages || 0;
      if (inFlight >= CHAT_WS_MAX_IN_FLIGHT_MESSAGES) {
        sendJson(socket, {
          type: 'error',
          code: 'TooManyInFlightMessages',
          message: 'TooManyInFlightMessages'
        });
        return;
      }
      socket.inFlightMessages = inFlight + 1;
      handleClientMessage(socket, message)
        .catch((err: any) => {
          const code = err?.message || 'ChatSocketError';
          if (err instanceof SocketAuthorizationError) {
            closeUnauthorizedSocket(socket, code);
            return;
          }
          sendJson(socket, { type: 'error', code, message: code });
        })
        .finally(() => {
          socket.inFlightMessages = Math.max(0, (socket.inFlightMessages || 1) - 1);
        });
    });

    socket.on('close', () => removeClient(socket));
    socket.on('error', () => {
      socket.authValid = false;
      removeClient(socket);
      if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
    });
  });

  let heartbeatRunning = false;
  const runHeartbeat = async () => {
    if (heartbeatRunning) return;
    heartbeatRunning = true;
    try {
      await revalidateIdleSockets(Array.from(wss.clients as Set<ChatSocket>));
    } finally {
      heartbeatRunning = false;
    }
  };

  const heartbeat = setInterval(
    () => { void runHeartbeat(); },
    Math.max(10_000, readPositiveInteger(process.env.CHAT_WS_HEARTBEAT_MS, 30_000))
  );
  heartbeat.unref();

  wss.on('close', () => {
    clearInterval(heartbeat);
    if (registeredClientCount === 0) {
      userMessageBuckets.clear();
      lastUserMessageBucketPruneAt = 0;
    }
  });
  return wss;
};
