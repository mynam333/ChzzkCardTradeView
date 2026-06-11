import http from 'http';
import jwt from 'jsonwebtoken';
import WebSocket, { WebSocketServer } from 'ws';
import { CORS_ALLOWED_ORIGINS, JWT_SECRET } from '../config';
import { createRealtimeNotification } from '../controllers/notificationController';
import { sendPushToUser } from '../controllers/pushController';
import { userRepository } from '../repositories';
import { SESSION_COOKIE_NAMES } from './sessionCookie';
import {
  getRoomForUser,
  listMessages,
  sendChatMessage,
  type ChatMessageRow,
  type ChatRoomRow
} from './friendChatService';
import { clearChatRoomViewing, isChatRoomViewing, markChatRoomViewing } from './chatPresence';

type ChatSocketUser = {
  id: string;
  username: string;
  role: 'USER' | 'ADMIN';
};

type ChatSocket = WebSocket & {
  user?: ChatSocketUser;
  currentRoomId?: number | null;
  isAlive?: boolean;
};

type ClientMessage =
  | { type: 'join'; room_id: number }
  | { type: 'leave'; room_id?: number }
  | { type: 'read'; room_id: number }
  | { type: 'send'; room_id: number; body: string }
  | { type: 'ping' };

const clientsByUser = new Map<string, Set<ChatSocket>>();
const clientsByRoom = new Map<number, Set<ChatSocket>>();

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

const sendJson = (socket: WebSocket, payload: unknown) => {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
};

const broadcastRoom = (roomId: number, payload: unknown) => {
  const clients = clientsByRoom.get(roomId);
  if (!clients) return;
  for (const client of clients) sendJson(client, payload);
};

const addClient = (socket: ChatSocket, userId: string) => {
  const set = clientsByUser.get(userId) || new Set<ChatSocket>();
  set.add(socket);
  clientsByUser.set(userId, set);
};

const removeClient = (socket: ChatSocket) => {
  if (socket.user) {
    const userSet = clientsByUser.get(socket.user.id);
    userSet?.delete(socket);
    if (userSet && userSet.size === 0) clientsByUser.delete(socket.user.id);
  }
  if (socket.currentRoomId) {
    const roomSet = clientsByRoom.get(socket.currentRoomId);
    roomSet?.delete(socket);
    if (roomSet && roomSet.size === 0) clientsByRoom.delete(socket.currentRoomId);
    if (socket.user) clearChatRoomViewing(socket.currentRoomId, socket.user.id);
  }
  socket.currentRoomId = null;
};

const authenticateSocket = async (req: http.IncomingMessage): Promise<ChatSocketUser | null> => {
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
    const previousSet = clientsByRoom.get(socket.currentRoomId);
    previousSet?.delete(socket);
    if (previousSet && previousSet.size === 0) clientsByRoom.delete(socket.currentRoomId);
    clearChatRoomViewing(socket.currentRoomId, socket.user.id);
  }

  socket.currentRoomId = roomId;
  const roomSet = clientsByRoom.get(roomId) || new Set<ChatSocket>();
  roomSet.add(socket);
  clientsByRoom.set(roomId, roomSet);
  markChatRoomViewing(roomId, socket.user.id);

  const messages = await listMessages(roomId, socket.user.id);
  sendJson(socket, { type: 'joined', room, messages });
  broadcastRoom(roomId, { type: 'read', room_id: roomId, reader_id: socket.user.id });
};

const notifyIfNeeded = async (
  receiverId: string,
  senderName: string,
  body: string,
  receiverViewing: boolean
) => {
  if (receiverViewing) return;
  const preview = body.length > 80 ? `${body.slice(0, 80)}...` : body;
  await createRealtimeNotification({
    user_id: receiverId,
    title: `${senderName}님의 1:1 톡`,
    body: preview,
    link: 'friends'
  });
  sendPushToUser(receiverId, `${senderName}님의 1:1 톡`, preview, '/friends').catch(() => {
    // 푸시 실패는 채팅 전송을 막지 않습니다.
  });
};

const handleSend = async (socket: ChatSocket, roomId: number, body: string) => {
  if (!socket.user) throw new Error('Unauthorized');
  const text = String(body || '').trim();
  if (!text || text.length > 1000) throw new Error('InvalidMessage');

  const room = await assertRoomAccess(socket, roomId);
  const receiverId = room.user_a_id === socket.user.id ? room.user_b_id : room.user_a_id;
  const receiverInWorkerRoom = Array.from(clientsByRoom.get(roomId) || [])
    .some((client) => client.user?.id === receiverId && client.readyState === WebSocket.OPEN);
  const receiverViewing = receiverInWorkerRoom || isChatRoomViewing(roomId, receiverId);

  const result = await sendChatMessage(roomId, socket.user.id, text, receiverViewing);
  await notifyIfNeeded(result.receiverId, socket.user.username, text, receiverViewing);

  const payload = { type: 'message', room_id: roomId, message: result.message };
  const delivered = new Set<ChatSocket>();
  for (const client of clientsByRoom.get(roomId) || []) {
    sendJson(client, payload);
    delivered.add(client);
  }
  const receiverClients = clientsByUser.get(receiverId);
  receiverClients?.forEach((client) => {
    if (!delivered.has(client)) sendJson(client, payload);
  });
};

const handleRead = async (socket: ChatSocket, roomId: number) => {
  if (!socket.user) throw new Error('Unauthorized');
  await assertRoomAccess(socket, roomId);
  markChatRoomViewing(roomId, socket.user.id);
  const messages = await listMessages(roomId, socket.user.id);
  sendJson(socket, { type: 'messages', room_id: roomId, messages });
  broadcastRoom(roomId, { type: 'read', room_id: roomId, reader_id: socket.user.id });
};

const handleClientMessage = async (socket: ChatSocket, raw: WebSocket.RawData) => {
  let message: ClientMessage;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    throw new Error('InvalidJson');
  }

  if (message.type === 'ping') {
    sendJson(socket, { type: 'pong' });
    return;
  }
  if (message.type === 'join') {
    await joinRoom(socket, Number(message.room_id));
    return;
  }
  if (message.type === 'leave') {
    removeClient(socket);
    sendJson(socket, { type: 'left' });
    return;
  }
  if (message.type === 'read') {
    await handleRead(socket, Number(message.room_id));
    return;
  }
  if (message.type === 'send') {
    await handleSend(socket, Number(message.room_id), message.body);
    return;
  }

  throw new Error('UnknownMessageType');
};

export const attachFriendChatSocketServer = (server: http.Server, path = '/chat') => {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== path) return;

    const origin = req.headers.origin;
    if (origin && !CORS_ALLOWED_ORIGINS.includes(origin)) {
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
      wss.handleUpgrade(req, socket, head, (ws) => {
        const chatSocket = ws as ChatSocket;
        chatSocket.user = user;
        chatSocket.isAlive = true;
        addClient(chatSocket, user.id);
        wss.emit('connection', chatSocket, req);
      });
    } catch (err: any) {
      console.warn('[FriendChatSocket] 인증 실패:', err?.message || err);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  });

  wss.on('connection', (socket: ChatSocket) => {
    sendJson(socket, { type: 'ready', user_id: socket.user?.id });

    socket.on('pong', () => {
      socket.isAlive = true;
    });

    socket.on('message', (raw) => {
      handleClientMessage(socket, raw).catch((err: any) => {
        const code = err?.message || 'ChatSocketError';
        sendJson(socket, { type: 'error', code, message: code });
      });
    });

    socket.on('close', () => removeClient(socket));
    socket.on('error', () => removeClient(socket));
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients as Set<ChatSocket>) {
      if (socket.isAlive === false) {
        removeClient(socket);
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, Math.max(10_000, Number(process.env.CHAT_WS_HEARTBEAT_MS || 30_000)));
  heartbeat.unref();

  wss.on('close', () => clearInterval(heartbeat));
  return wss;
};
