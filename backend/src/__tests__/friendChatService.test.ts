import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresDb } from '../services/postgresDb';

const mocks = vi.hoisted(() => ({
  db: null as PostgresDb | null,
  unsafe: vi.fn()
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
  deleteLocalUploadByUrl: vi.fn(),
  formatUploadUrl: (url: string | null | undefined) => url || null
}));

vi.mock('../services/linkPreviewService', () => ({
  extractFirstUrl: vi.fn(),
  getLinkPreviewForText: vi.fn()
}));

import { removeFriend } from '../services/friendChatService';

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
        return [{
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
          unread_count: 0
        }];
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
});
