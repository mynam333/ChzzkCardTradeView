import http from 'http';
import { once } from 'events';
import jwt from 'jsonwebtoken';
import WebSocket, { WebSocketServer } from 'ws';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const socketEnv = vi.hoisted(() => {
  const keys = [
    'CHAT_WS_MAX_CONNECTIONS',
    'CHAT_WS_MAX_CONNECTIONS_PER_USER',
    'CHAT_WS_MAX_IN_FLIGHT_MESSAGES',
    'CHAT_WS_MAX_PAYLOAD_BYTES',
    'CHAT_WS_AUTH_REVALIDATE_TIMEOUT_MS',
    'CHAT_WS_SOCKET_MESSAGE_RATE_PER_SECOND',
    'CHAT_WS_SOCKET_MESSAGE_BURST',
    'CHAT_WS_USER_MESSAGE_RATE_PER_SECOND',
    'CHAT_WS_USER_MESSAGE_BURST',
    'CHAT_WS_USER_BUCKET_TTL_MS',
    'CHAT_WS_MAX_TRACKED_USER_BUCKETS',
    'CHAT_WS_PING_RATE_PER_SECOND',
    'CHAT_WS_PING_BURST',
    'CHAT_WS_CONTROL_FRAME_RATE_PER_SECOND',
    'CHAT_WS_CONTROL_FRAME_BURST',
    'CHAT_WS_MAX_BUFFERED_BYTES'
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.CHAT_WS_MAX_CONNECTIONS = '3';
  process.env.CHAT_WS_MAX_CONNECTIONS_PER_USER = '2';
  process.env.CHAT_WS_MAX_IN_FLIGHT_MESSAGES = '1';
  process.env.CHAT_WS_MAX_PAYLOAD_BYTES = '1024';
  process.env.CHAT_WS_AUTH_REVALIDATE_TIMEOUT_MS = '250';
  process.env.CHAT_WS_SOCKET_MESSAGE_RATE_PER_SECOND = '1';
  process.env.CHAT_WS_SOCKET_MESSAGE_BURST = '3';
  process.env.CHAT_WS_USER_MESSAGE_RATE_PER_SECOND = '1';
  process.env.CHAT_WS_USER_MESSAGE_BURST = '4';
  process.env.CHAT_WS_USER_BUCKET_TTL_MS = '60000';
  process.env.CHAT_WS_MAX_TRACKED_USER_BUCKETS = '10';
  process.env.CHAT_WS_PING_RATE_PER_SECOND = '1';
  process.env.CHAT_WS_PING_BURST = '2';
  process.env.CHAT_WS_CONTROL_FRAME_RATE_PER_SECOND = '1';
  process.env.CHAT_WS_CONTROL_FRAME_BURST = '2';
  process.env.CHAT_WS_MAX_BUFFERED_BYTES = '1024';
  return { keys, previous };
});

const mocks = vi.hoisted(() => ({
  users: new Map<string, any>(),
  findUser: vi.fn(),
  findUsers: vi.fn(),
  verifySession: vi.fn(),
  verifySessions: vi.fn(),
  getRoomForUser: vi.fn(),
  getOrCreateChatRoom: vi.fn(),
  getChatMessageForRoom: vi.fn(),
  listFriends: vi.fn(),
  listMessages: vi.fn(),
  markRoomMessagesRead: vi.fn(),
  sendChatMessage: vi.fn()
}));

vi.mock('../config', () => ({
  isConfiguredCorsOriginAllowed: () => true
}));

vi.mock('../repositories', () => ({
  userRepository: { findById: mocks.findUser, findByIds: mocks.findUsers }
}));

vi.mock('../services/authSessionService', () => ({
  verifyAuthSessionToken: mocks.verifySession,
  verifyAuthSessionTokens: mocks.verifySessions
}));

vi.mock('../controllers/pushController', () => ({
  sendPushToUser: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../services/notificationDelivery', () => ({
  createRealtimeNotification: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../services/sessionCookie', () => ({
  SESSION_COOKIE_NAMES: ['chikapo_session']
}));

vi.mock('../services/chatPresence', () => ({
  clearChatRoomViewing: vi.fn(),
  isChatRoomViewing: vi.fn(() => false),
  markChatRoomViewing: vi.fn()
}));

vi.mock('../services/friendChatService', () => ({
  getOrCreateChatRoom: mocks.getOrCreateChatRoom,
  getChatMessageForRoom: mocks.getChatMessageForRoom,
  getRoomForUser: mocks.getRoomForUser,
  listFriends: mocks.listFriends,
  listMessages: mocks.listMessages,
  markRoomMessagesRead: mocks.markRoomMessagesRead,
  registerChatMessageUpdateNotifier: vi.fn(),
  sendChatMessage: mocks.sendChatMessage
}));

import { attachFriendChatSocketServer } from '../services/friendChatSocketServer';

const baseUser = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  username: id,
  avatar_url: null,
  role: 'USER',
  point: 0,
  last_free_draw: null,
  banned_until: null,
  ...overrides
});

const roomRow = {
  id: 7,
  user_a_id: 'user-a',
  user_b_id: 'user-b',
  is_admin_room: false,
  closed_at: null,
  closed_by_user_id: null,
  deleted_for_a: false,
  deleted_for_b: false,
  hidden_after_a: null,
  hidden_after_b: null,
  muted_for_a: false,
  muted_for_b: false,
  is_muted: false,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  other_user: { id: 'user-b', username: 'user-b', avatar_url: null, role: 'USER' },
  unread_count: 0,
  can_send: true
};

const openSocket = (port: number, userId: string): Promise<WebSocket> => new Promise((resolve, reject) => {
  const token = jwt.sign({ id: userId }, 'friend-chat-socket-test-secret', { expiresIn: '1h' });
  const socket = new WebSocket(`ws://127.0.0.1:${port}/chat`, {
    headers: {
      Cookie: `chikapo_session=${token}`,
      Origin: 'https://chikapo.example'
    }
  });
  socket.once('open', () => resolve(socket));
  socket.once('error', reject);
});

const rejectedUpgradeStatus = (port: number, userId: string): Promise<number | undefined> => new Promise((resolve, reject) => {
  const token = jwt.sign({ id: userId }, 'friend-chat-socket-test-secret', { expiresIn: '1h' });
  const socket = new WebSocket(`ws://127.0.0.1:${port}/chat`, {
    headers: {
      Cookie: `chikapo_session=${token}`,
      Origin: 'https://chikapo.example'
    }
  });
  let rejected = false;
  const timer = setTimeout(() => reject(new Error('WebSocket upgrade rejection timed out')), 2_000);
  socket.once('unexpected-response', (_request, response) => {
    rejected = true;
    clearTimeout(timer);
    const status = response.statusCode;
    response.resume();
    resolve(status);
  });
  socket.once('open', () => {
    clearTimeout(timer);
    socket.terminate();
    reject(new Error('WebSocket upgrade unexpectedly succeeded'));
  });
  socket.once('error', (err) => {
    if (!rejected) {
      clearTimeout(timer);
      reject(err);
    }
  });
});

const waitForJson = (socket: WebSocket, predicate: (message: any) => boolean): Promise<any> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('WebSocket message timed out')), 2_000);
  const onMessage = (raw: WebSocket.RawData) => {
    let message: any;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!predicate(message)) return;
    clearTimeout(timer);
    socket.off('message', onMessage);
    resolve(message);
  };
  socket.on('message', onMessage);
});

describe('friend chat WebSocket security boundaries', () => {
  let server: http.Server;
  let wss: WebSocketServer;
  let port: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.users.clear();
    mocks.findUser.mockImplementation(async (id: string) => mocks.users.get(id) || null);
    mocks.findUsers.mockImplementation(async (ids: string[]) => ids.map((id) => mocks.users.get(id)).filter(Boolean));
    mocks.verifySession.mockImplementation(async (token: string) => jwt.verify(token, 'friend-chat-socket-test-secret') as any);
    mocks.verifySessions.mockImplementation(async (tokens: string[]) => new Map(tokens.map((token) => [
      token,
      jwt.verify(token, 'friend-chat-socket-test-secret') as any
    ])));
    mocks.getRoomForUser.mockResolvedValue(roomRow);
    mocks.getOrCreateChatRoom.mockResolvedValue(roomRow);
    mocks.listFriends.mockResolvedValue([]);
    mocks.listMessages.mockResolvedValue([]);
    mocks.markRoomMessagesRead.mockResolvedValue(roomRow);
    mocks.sendChatMessage.mockResolvedValue({
      room: roomRow,
      receiverId: 'user-b',
      message: {
        id: 91,
        room_id: 7,
        sender_id: 'user-a',
        body: 'hello',
        message_type: 'text',
        created_at: '2026-08-01T00:00:01.000Z'
      }
    });

    server = http.createServer();
    wss = attachFriendChatSocketServer(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterAll(() => {
    for (const key of socketEnv.keys) {
      const previous = socketEnv.previous[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  });

  it('활성 밴 사용자의 업그레이드를 거부한다', async () => {
    mocks.users.set('banned-user', baseUser('banned-user', { banned_until: '2099-01-01T00:00:00.000Z' }));

    await expect(rejectedUpgradeStatus(port, 'banned-user')).resolves.toBe(401);
    expect(wss.clients.size).toBe(0);
  });

  it('세션 검증이 응답하지 않아도 업그레이드 예약을 제한 시간 뒤 해제한다', async () => {
    mocks.users.set('user-a', baseUser('user-a'));
    mocks.verifySession.mockImplementation(() => new Promise(() => {}));
    const startedAt = Date.now();

    await expect(rejectedUpgradeStatus(port, 'user-a')).resolves.toBe(401);
    expect(Date.now() - startedAt).toBeLessThan(1_500);

    mocks.verifySession.mockImplementation(async (token: string) => (
      jwt.verify(token, 'friend-chat-socket-test-secret') as any
    ));
    await expect(openSocket(port, 'user-a')).resolves.toBeInstanceOf(WebSocket);
  });

  it('사용자별 연결 상한은 leave 메시지로 우회할 수 없다', async () => {
    mocks.users.set('user-a', baseUser('user-a'));
    const first = await openSocket(port, 'user-a');
    await openSocket(port, 'user-a');

    await expect(rejectedUpgradeStatus(port, 'user-a')).resolves.toBe(429);
    const left = waitForJson(first, (message) => message.type === 'left');
    first.send(JSON.stringify({ type: 'leave' }));
    await left;
    await expect(rejectedUpgradeStatus(port, 'user-a')).resolves.toBe(429);

    const closed = once(first, 'close');
    first.terminate();
    await closed;
    await expect(openSocket(port, 'user-a')).resolves.toBeInstanceOf(WebSocket);
  });

  it('프로세스 전체 연결 상한을 인증 조회 전에 적용한다', async () => {
    mocks.users.set('user-a', baseUser('user-a'));
    mocks.users.set('user-b', baseUser('user-b'));
    mocks.users.set('user-c', baseUser('user-c'));
    mocks.users.set('user-d', baseUser('user-d'));
    await openSocket(port, 'user-a');
    await openSocket(port, 'user-b');
    await openSocket(port, 'user-c');
    const authCallsBeforeRejection = mocks.findUser.mock.calls.length;

    await expect(rejectedUpgradeStatus(port, 'user-d')).resolves.toBe(503);
    expect(mocks.findUser).toHaveBeenCalledTimes(authCallsBeforeRejection);
  });

  it('한 소켓의 진행 중 메시지 한도를 넘는 작업은 디스패치하지 않는다', async () => {
    mocks.users.set('user-a', baseUser('user-a'));
    const roomLookup = (() => {
      let resolve!: (value: typeof roomRow | null) => void;
      const promise = new Promise<typeof roomRow | null>((done) => { resolve = done; });
      return { promise, resolve };
    })();
    mocks.getRoomForUser.mockImplementationOnce(() => roomLookup.promise);
    const socket = await openSocket(port, 'user-a');

    const overloaded = waitForJson(socket, (message) => message.code === 'TooManyInFlightMessages');
    socket.send(JSON.stringify({ type: 'join', room_id: 7 }));
    socket.send(JSON.stringify({ type: 'join', room_id: 7 }));
    await overloaded;
    expect(mocks.getRoomForUser).toHaveBeenCalledTimes(1);
    const firstJoined = waitForJson(socket, (message) => message.type === 'joined');
    roomLookup.resolve(roomRow);
    await firstJoined;

    const nextJoined = waitForJson(socket, (message) => message.type === 'joined');
    socket.send(JSON.stringify({ type: 'join', room_id: 7 }));
    await nextJoined;
    expect(mocks.getRoomForUser).toHaveBeenCalledTimes(2);
  });

  it('빠르게 끝나는 비즈니스 메시지도 소켓 버스트를 넘으면 연결을 닫는다', async () => {
    mocks.users.set('user-a', baseUser('user-a'));
    const socket = await openSocket(port, 'user-a');
    const fixedNow = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(fixedNow);
    try {
      for (let index = 0; index < 3; index += 1) {
        const left = waitForJson(socket, (message) => message.type === 'left');
        socket.send(JSON.stringify({ type: 'leave' }));
        await left;
      }

      const closed = once(socket, 'close');
      socket.send(JSON.stringify({ type: 'leave' }));
      const [code] = await closed;
      expect(code).toBe(1008);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('여러 소켓의 비즈니스 메시지는 사용자 공용 버스트로 합산한다', async () => {
    mocks.users.set('user-a', baseUser('user-a'));
    const first = await openSocket(port, 'user-a');
    const second = await openSocket(port, 'user-a');
    const fixedNow = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(fixedNow);
    try {
      for (const socket of [first, second, first, second]) {
        const left = waitForJson(socket, (message) => message.type === 'left');
        socket.send(JSON.stringify({ type: 'leave' }));
        await left;
      }

      const closed = once(first, 'close');
      first.send(JSON.stringify({ type: 'leave' }));
      const [code] = await closed;
      expect(code).toBe(1008);
      expect(second.readyState).toBe(WebSocket.OPEN);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('연결을 모두 끊고 다시 연결해도 사용자 버킷이 초기화되지 않는다', async () => {
    mocks.users.set('user-a', baseUser('user-a'));
    const first = await openSocket(port, 'user-a');
    const second = await openSocket(port, 'user-a');
    const fixedNow = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(fixedNow);
    try {
      for (const socket of [first, second, first, second]) {
        const left = waitForJson(socket, (message) => message.type === 'left');
        socket.send(JSON.stringify({ type: 'leave' }));
        await left;
      }

      const firstClosed = once(first, 'close');
      const secondClosed = once(second, 'close');
      first.terminate();
      second.terminate();
      await Promise.all([firstClosed, secondClosed]);

      const reconnected = await openSocket(port, 'user-a');
      const reconnectedClosed = once(reconnected, 'close');
      reconnected.send(JSON.stringify({ type: 'leave' }));
      const [code] = await reconnectedClosed;
      expect(code).toBe(1008);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('앱 ping 폭주는 비즈니스 버킷과 분리된 작은 버킷으로 닫는다', async () => {
    mocks.users.set('user-a', baseUser('user-a'));
    const socket = await openSocket(port, 'user-a');
    const fixedNow = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(fixedNow);
    try {
      for (let index = 0; index < 2; index += 1) {
        const pong = waitForJson(socket, (message) => message.type === 'pong');
        socket.send(JSON.stringify({ type: 'ping' }));
        await pong;
      }

      const closed = once(socket, 'close');
      socket.send(JSON.stringify({ type: 'ping' }));
      const [code] = await closed;
      expect(code).toBe(1008);
      expect(mocks.findUser).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('protocol PING과 unsolicited PONG을 하나의 control-frame 버킷으로 제한한다', async () => {
    mocks.users.set('user-a', baseUser('user-a'));
    const socket = await openSocket(port, 'user-a');
    const serverSocket = Array.from(wss.clients)[0];
    const fixedNow = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(fixedNow);
    try {
      const pong = once(socket, 'pong');
      socket.ping('allowed-ping');
      await pong;

      const serverReceivedPong = once(serverSocket, 'pong');
      socket.pong('unsolicited-pong');
      await serverReceivedPong;

      const closed = once(socket, 'close');
      socket.ping('over-limit');
      const [code] = await closed;
      expect(code).toBe(1008);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('느린 클라이언트의 송신 큐가 상한이면 응답을 더 쌓지 않고 종료한다', async () => {
    mocks.users.set('user-a', baseUser('user-a'));
    const socket = await openSocket(port, 'user-a');
    const serverSocket = Array.from(wss.clients)[0];
    Object.defineProperty(serverSocket, 'bufferedAmount', {
      configurable: true,
      get: () => 1024
    });

    const closed = once(socket, 'close');
    socket.send(JSON.stringify({ type: 'ping' }));
    const [code] = await closed;

    expect(code).toBe(1013);
  });

  it('연결 뒤 밴된 사용자는 다음 비즈니스 메시지에서 재검증 후 닫힌다', async () => {
    mocks.users.set('user-a', baseUser('user-a'));
    const socket = await openSocket(port, 'user-a');
    mocks.users.set('user-a', baseUser('user-a', { banned_until: '2099-01-01T00:00:00.000Z' }));

    const closed = once(socket, 'close');
    socket.send(JSON.stringify({ type: 'join', room_id: 7 }));
    const [code] = await closed;

    expect(code).toBe(1008);
    expect(mocks.getRoomForUser).not.toHaveBeenCalled();
    expect(mocks.findUser).toHaveBeenCalledTimes(2);
  });

  it('연결 뒤 서버에서 폐기된 세션은 다음 비즈니스 메시지 전에 닫힌다', async () => {
    mocks.users.set('user-a', baseUser('user-a'));
    const socket = await openSocket(port, 'user-a');
    mocks.verifySession.mockRejectedValue(new Error('InvalidAuthSession'));

    const closed = once(socket, 'close');
    socket.send(JSON.stringify({ type: 'join', room_id: 7 }));
    const [code] = await closed;

    expect(code).toBe(1008);
    expect(mocks.getRoomForUser).not.toHaveBeenCalled();
  });

  it('연결 뒤 세션 재검증이 응답하지 않아도 메시지 처리 슬롯을 제한 시간 뒤 닫는다', async () => {
    mocks.users.set('user-a', baseUser('user-a'));
    const socket = await openSocket(port, 'user-a');
    mocks.verifySession.mockImplementation(() => new Promise(() => {}));
    const startedAt = Date.now();

    const closed = once(socket, 'close');
    socket.send(JSON.stringify({ type: 'join', room_id: 7 }));
    const [code] = await closed;

    expect(code).toBe(1008);
    expect(Date.now() - startedAt).toBeLessThan(1_500);
    expect(mocks.getRoomForUser).not.toHaveBeenCalled();
  });

  it('단일 프레임 크기 상한을 넘는 메시지는 JSON 처리 전에 닫힌다', async () => {
    mocks.users.set('user-a', baseUser('user-a'));
    const socket = await openSocket(port, 'user-a');

    const closed = once(socket, 'close');
    socket.send(Buffer.alloc(2048, 0x61));
    const [code] = await closed;

    expect(code).toBe(1009);
    expect(mocks.getRoomForUser).not.toHaveBeenCalled();
  });
});
