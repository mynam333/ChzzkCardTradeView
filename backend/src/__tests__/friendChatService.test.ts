import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresDb } from '../services/postgresDb';

const mocks = vi.hoisted(() => ({
  db: null as PostgresDb | null,
  unsafe: vi.fn(),
  deleteLocalUploadByUrl: vi.fn()
}));

vi.mock('../services/db', () => ({
  getDbMode: () => 'MYSQL',
  getMysqlDb: () => mocks.db,
  getSqliteDb: vi.fn(),
  getSupabaseClient: vi.fn()
}));

vi.mock('../repositories', () => ({
  notificationRepository: {
    create: vi.fn()
  }
}));

vi.mock('../services/imageService', () => ({
  deleteLocalUploadByUrl: mocks.deleteLocalUploadByUrl,
  formatUploadUrl: (url: string | null | undefined) => url || null
}));

vi.mock('../services/linkPreviewService', () => ({
  extractFirstUrl: vi.fn(),
  getLinkPreviewForText: vi.fn(),
  sanitizeChatLinkPreviewForDelivery: (preview: any) => (
    preview?.kind === 'link' ? { ...preview, image_url: null } : preview
  )
}));

import {
  deleteExpiredChatAttachments,
  findReusableChatAttachment,
  getChatMessageForRoom,
  getReusableChatAttachmentById,
  removeFriend,
  sendChatAttachmentMessage,
  sendChatMessage
} from '../services/friendChatService';

const roomRow = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  user_a_id: 'friend-a',
  user_b_id: 'friend-b',
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
  created_at: '2026-07-23T00:00:00.000Z',
  updated_at: '2026-07-23T00:00:00.000Z',
  other_id: 'friend-b',
  other_username: '친구',
  other_avatar_url: null,
  other_role: 'USER',
  other_last_seen_at: null,
  unread_count: 0,
  ...overrides
});

const messageRow = (overrides: Record<string, unknown> = {}) => ({
  id: 71,
  room_id: 7,
  sender_id: 'friend-b',
  body: '안녕하세요',
  message_type: 'text',
  created_at: '2026-07-23T00:00:01.000Z',
  read_at: null,
  ...overrides
});

const pgResult = (rows: any[] = [], count = rows.length) => Object.assign(rows, { count });

describe('friendChatService PostgreSQL compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const connection: any = {
      unsafe: mocks.unsafe,
      begin: async (task: (tx: any) => Promise<unknown>) => task(connection)
    };
    mocks.unsafe.mockImplementation(async (sql: string) => {
      if (/CASE\s+WHEN[\s\S]+THEN\s+1\s+ELSE\s+deleted_for_[ab]\s+END/i.test(sql)) {
        throw Object.assign(new Error('CASE types boolean and integer cannot be matched'), {
          code: '42804'
        });
      }
      if (/FROM\s+chat_rooms\s+cr/i.test(sql)) {
        return [roomRow()];
      }
      return [];
    });
    mocks.db = new PostgresDb(connection);
  });

  it('친구 삭제의 채팅방 숨김 상태를 PostgreSQL BOOLEAN으로 갱신한다', async () => {
    await expect(removeFriend('friend-a', 'friend-b')).resolves.toBeUndefined();

    const statements = mocks.unsafe.mock.calls.map(([sql]) => String(sql));
    const chatRoomUpdate = statements.find((sql) => /UPDATE\s+chat_rooms/i.test(sql));
    expect(chatRoomUpdate).toBeDefined();
    expect(chatRoomUpdate).toMatch(/THEN\s+TRUE\s+ELSE\s+deleted_for_a\s+END/i);
    expect(chatRoomUpdate).toMatch(/THEN\s+TRUE\s+ELSE\s+deleted_for_b\s+END/i);
    expect(chatRoomUpdate).not.toMatch(/THEN\s+1\s+ELSE\s+deleted_for_[ab]/i);
  });

  it('현재 친구 관계가 없으면 일반 텍스트와 첨부 메시지를 저장하지 않는다', async () => {
    await expect(sendChatMessage(7, 'friend-b', '삭제 뒤 전송', false)).rejects.toThrow('FriendsOnly');
    await expect(sendChatAttachmentMessage(7, 'friend-b', {
      url: '/uploads/chat/image.webp',
      mime: 'image/webp',
      sizeBytes: 128,
      expiresAt: new Date('2026-08-01T00:00:00.000Z')
    }, false)).rejects.toThrow('FriendsOnly');

    const statements = mocks.unsafe.mock.calls.map(([sql]) => String(sql));
    expect(statements.filter((sql) => /INSERT\s+INTO\s+chat_messages/i.test(sql))).toHaveLength(0);
    expect(statements.some((sql) => /UPDATE\s+chat_rooms[\s\S]+deleted_for_a\s*=\s*FALSE[\s\S]+deleted_for_b\s*=\s*FALSE/i.test(sql))).toBe(false);
  });

  it('기존 메시지에 저장된 generic preview image도 수신자 응답에서 제거한다', async () => {
    mocks.unsafe.mockImplementation(async (sql: string) => {
      if (/FROM\s+chat_rooms\s+cr/i.test(sql)) return [roomRow()];
      if (/FROM\s+chat_messages\s+m/i.test(sql)) {
        return [messageRow({
          link_preview_json: JSON.stringify({
            url: 'https://public.example/article',
            normalized_url: 'https://public.example/article',
            kind: 'link',
            title: 'cached',
            image_url: 'https://tracker.example/pixel.gif',
            fetched_at: '2026-08-01T00:00:00.000Z'
          })
        })];
      }
      return [];
    });

    await expect(getChatMessageForRoom(7, 71, 'friend-a')).resolves.toMatchObject({
      link_preview: { image_url: null }
    });
  });

  it('현재 친구는 트랜잭션 잠금 뒤 전송하고 상대방 숨김 상태만 복구한다', async () => {
    mocks.unsafe.mockImplementation(async (sql: string) => {
      if (/FROM\s+chat_rooms\s+cr/i.test(sql)) return [roomRow({ other_id: 'friend-a' })];
      if (/FROM\s+friendships[\s\S]+FOR\s+UPDATE/i.test(sql)) return [{ present: 1 }];
      if (/INSERT\s+INTO\s+chat_messages/i.test(sql)) return [{ id: 71 }];
      if (/SELECT\s+\*\s+FROM\s+chat_messages/i.test(sql)) return [messageRow()];
      return [];
    });

    await expect(sendChatMessage(7, 'friend-b', '안녕하세요', false)).resolves.toMatchObject({
      receiverId: 'friend-a',
      message: { id: 71, sender_id: 'friend-b' }
    });

    const statements = mocks.unsafe.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => /FROM\s+friendships[\s\S]+FOR\s+UPDATE/i.test(sql))).toBe(true);
    const roomUpdate = statements.find((sql) => /UPDATE\s+chat_rooms/i.test(sql));
    expect(roomUpdate).toMatch(/deleted_for_a\s*=\s*FALSE/i);
    expect(roomUpdate).not.toMatch(/deleted_for_b\s*=\s*FALSE/i);
  });

  it('명시적인 관리자 방 옵션은 비친구 open_send 저장을 유지한다', async () => {
    mocks.unsafe.mockImplementation(async (sql: string) => {
      if (/FROM\s+chat_rooms\s+cr/i.test(sql)) return [roomRow({ is_admin_room: true })];
      if (/INSERT\s+INTO\s+chat_messages/i.test(sql)) return [{ id: 72 }];
      if (/SELECT\s+\*\s+FROM\s+chat_messages/i.test(sql)) {
        return [messageRow({ id: 72, sender_id: 'friend-a', body: '관리자 안내' })];
      }
      return [];
    });

    await expect(sendChatMessage(7, 'friend-a', '관리자 안내', false, { allowNonFriend: true })).resolves.toMatchObject({
      receiverId: 'friend-b',
      message: { id: 72, sender_id: 'friend-a' }
    });

    const statements = mocks.unsafe.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => /FROM\s+friendships/i.test(sql))).toBe(false);
    expect(statements.some((sql) => /INSERT\s+INTO\s+chat_messages/i.test(sql))).toBe(true);
  });

  it('재사용 조회는 첨부 행을 잠그고 만료 연장 뒤 최신 저장 메타데이터를 반환한다', async () => {
    const latestExpiresAt = '2026-08-08T12:00:00.000Z';
    let latestReadCount = 0;
    mocks.unsafe.mockImplementation(async (sql: string) => {
      if (/FROM\s+chat_attachments[\s\S]+FOR\s+UPDATE/i.test(sql)) {
        return [{
          id: 44,
          url: '/uploads/chat/old.webp',
          mime: 'image/webp',
          size_bytes: 100,
          width: 10,
          height: 10,
          expires_at: '2026-08-02T00:00:00.000Z'
        }];
      }
      if (/UPDATE\s+chat_attachments[\s\S]+last_used_at/i.test(sql)) return pgResult([], 1);
      if (/FROM\s+chat_attachments/i.test(sql)) {
        latestReadCount += 1;
        return [{
          id: 44,
          url: '/uploads/chat/latest.webp',
          mime: 'image/avif',
          size_bytes: 222,
          width: 20,
          height: 30,
          expires_at: latestExpiresAt
        }];
      }
      return [];
    });

    await expect(findReusableChatAttachment('friend-a', 'source-hash')).resolves.toMatchObject({
      attachmentId: 44,
      url: '/uploads/chat/latest.webp',
      mime: 'image/avif',
      sizeBytes: 222,
      width: 20,
      height: 30,
      expiresAt: new Date(latestExpiresAt)
    });
    await expect(getReusableChatAttachmentById('friend-a', 44)).resolves.toMatchObject({
      attachmentId: 44,
      url: '/uploads/chat/latest.webp',
      sizeBytes: 222
    });

    const statements = mocks.unsafe.mock.calls.map(([sql]) => String(sql));
    expect(statements.filter((sql) => /FROM\s+chat_attachments[\s\S]+FOR\s+UPDATE/i.test(sql))).toHaveLength(2);
    expect(statements.filter((sql) => /UPDATE\s+chat_attachments[\s\S]+deleted_at\s+IS\s+NULL[\s\S]+expires_at\s*>/i.test(sql))).toHaveLength(2);
    expect(latestReadCount).toBe(2);
  });

  it('첨부 전송은 잠근 저장 행의 최신 메타데이터만 메시지에 기록한다', async () => {
    mocks.unsafe.mockImplementation(async (sql: string) => {
      if (/FROM\s+chat_rooms\s+cr/i.test(sql)) return [roomRow()];
      if (/FROM\s+friendships[\s\S]+FOR\s+UPDATE/i.test(sql)) return [{ present: 1 }];
      if (/FROM\s+chat_attachments[\s\S]+FOR\s+UPDATE/i.test(sql)) {
        return [{
          id: 44,
          url: '/uploads/chat/persisted.webp',
          mime: 'image/webp',
          size_bytes: 345,
          width: 40,
          height: 50,
          expires_at: '2026-08-08T00:00:00.000Z'
        }];
      }
      if (/INSERT\s+INTO\s+chat_messages/i.test(sql)) return [{ id: 73 }];
      if (/SELECT\s+\*\s+FROM\s+chat_messages/i.test(sql)) {
        return [messageRow({ id: 73, sender_id: 'friend-a', body: '이미지', message_type: 'image' })];
      }
      return pgResult([], 1);
    });

    await expect(sendChatAttachmentMessage(7, 'friend-a', {
      attachmentId: 44,
      url: '/uploads/chat/stale.webp',
      mime: 'image/png',
      sizeBytes: 999,
      width: 1,
      height: 2,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      reused: true
    }, false)).resolves.toMatchObject({ message: { id: 73 } });

    const insertCall = mocks.unsafe.mock.calls.find(([sql]) => /INSERT\s+INTO\s+chat_messages/i.test(String(sql)));
    expect(insertCall).toBeDefined();
    const params = insertCall?.[1] as unknown[];
    expect(params.slice(3, 10)).toEqual([
      44,
      '/uploads/chat/persisted.webp',
      'image/webp',
      345,
      40,
      50,
      '2026-08-08 09:00:00'
    ]);
    expect(params).not.toContain('/uploads/chat/stale.webp');
  });

  it('정리 후보가 잠금 시점에 갱신됐으면 파일과 행을 건드리지 않는다', async () => {
    mocks.unsafe.mockImplementation(async (sql: string) => {
      if (/SELECT\s+id[\s\S]+FROM\s+chat_attachments/i.test(sql) && !/FOR\s+UPDATE/i.test(sql)) return [{ id: 44 }];
      if (/FROM\s+chat_attachments[\s\S]+FOR\s+UPDATE/i.test(sql)) return [];
      if (/SELECT\s+id[\s\S]+FROM\s+chat_messages/i.test(sql) && !/FOR\s+UPDATE/i.test(sql)) return [];
      return [];
    });

    await expect(deleteExpiredChatAttachments()).resolves.toBe(0);
    expect(mocks.deleteLocalUploadByUrl).not.toHaveBeenCalled();
    const statements = mocks.unsafe.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => /FROM\s+chat_attachments[\s\S]+deleted_at\s+IS\s+NULL[\s\S]+expires_at\s*<=\s*NOW\(\)[\s\S]+FOR\s+UPDATE/i.test(sql))).toBe(true);
    expect(statements.some((sql) => /UPDATE\s+chat_attachments[\s\S]+SET\s+deleted_at/i.test(sql))).toBe(false);
  });

  it('정리는 잠긴 최신 URL을 DB에서 먼저 삭제 표시한 뒤 파일을 해제한다', async () => {
    const events: string[] = [];
    mocks.deleteLocalUploadByUrl.mockImplementation((url?: string | null) => {
      events.push(`unlink:${url}`);
      return true;
    });
    mocks.unsafe.mockImplementation(async (sql: string) => {
      if (/SELECT\s+id[\s\S]+FROM\s+chat_attachments/i.test(sql) && !/FOR\s+UPDATE/i.test(sql)) return [{ id: 44 }];
      if (/FROM\s+chat_attachments[\s\S]+FOR\s+UPDATE/i.test(sql)) {
        return [{ id: 44, url: '/uploads/chat/latest-expired.webp' }];
      }
      if (/UPDATE\s+chat_attachments[\s\S]+SET\s+deleted_at/i.test(sql)) {
        events.push('mark:attachment');
        return pgResult([], 1);
      }
      if (/SELECT\s+id[\s\S]+FROM\s+chat_messages/i.test(sql) && !/FOR\s+UPDATE/i.test(sql)) return [{ id: 45 }];
      if (/FROM\s+chat_messages[\s\S]+FOR\s+UPDATE/i.test(sql)) {
        return [{ id: 45, attachment_url: '/uploads/chat/latest-legacy.webp' }];
      }
      if (/UPDATE\s+chat_messages[\s\S]+attachment_deleted_at/i.test(sql)) {
        events.push('mark:legacy');
        return pgResult([], 1);
      }
      return [];
    });

    await expect(deleteExpiredChatAttachments()).resolves.toBe(2);
    expect(events).toEqual([
      'mark:attachment',
      'unlink:/uploads/chat/latest-expired.webp',
      'mark:legacy',
      'unlink:/uploads/chat/latest-legacy.webp'
    ]);
  });
});
