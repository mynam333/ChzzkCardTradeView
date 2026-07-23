import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MysqlStreamerRepository } from '../repositories/mysql/streamer.repository';
import type { StreamerScheduleResult } from '../repositories/interfaces';
import { PostgresDb } from '../services/postgresDb';

const dbMock = vi.hoisted(() => ({
  run: vi.fn()
}));

vi.mock('../services/db', () => ({
  getMysqlDb: () => dbMock,
  getSqlDialect: () => 'postgres'
}));

describe('MysqlStreamerRepository PostgreSQL compatibility', () => {
  beforeEach(() => {
    dbMock.run.mockReset().mockResolvedValue({ changes: 1, insertId: 0 });
  });

  it.each([true, false])('라이브 상태 %s를 PostgreSQL BOOLEAN으로 일괄 반영한다', async (isActive) => {
    const repository = new MysqlStreamerRepository();
    const result: StreamerScheduleResult = {
      channel_id: 'channel-live',
      prev_value: 1000,
      base_value: 1010,
      activity_score: 10,
      broadcast_multiplier: 1,
      add_minutes: isActive ? 2 : 0,
      add_broadcast_count: isActive ? 1 : 0,
      consumed_chats: 0,
      polled: true,
      is_active: isActive,
      follower_count: 1000,
      logo_url: null,
      last_broadcast_at: '2026-07-23T00:00:00.000Z'
    };

    await repository.bulkApplyScheduleResults([result]);

    expect(dbMock.run).toHaveBeenCalledTimes(1);
    const [sql, ...params] = dbMock.run.mock.calls[0] as [string, ...unknown[]];
    const isActiveAssignment = sql.indexOf('is_active = CASE');
    expect(isActiveAssignment).toBeGreaterThan(-1);
    const paramsBeforeAssignment = (sql.slice(0, isActiveAssignment).match(/\?/g) || []).length;
    expect(params[paramsBeforeAssignment]).toBe('channel-live');
    expect(params[paramsBeforeAssignment + 1]).toBe(isActive);
    expect(typeof params[paramsBeforeAssignment + 1]).toBe('boolean');

    // postgres.js는 서버가 CASE 결과 파라미터를 BOOLEAN(OID 16)으로 추론하면
    // `value === true ? 't' : 'f'`로 직렬화합니다. 숫자 1도 'f'가 되므로
    // OPEN 상태가 반드시 't'로 직렬화되는지 함께 고정합니다.
    const serializePostgresBoolean = (value: unknown) => value === true ? 't' : 'f';
    expect(serializePostgresBoolean(params[paramsBeforeAssignment + 1])).toBe(isActive ? 't' : 'f');

    const unsafe = vi.fn().mockResolvedValue([]);
    const postgresDb = new PostgresDb({ unsafe });
    await postgresDb.run(sql, ...params);

    const [postgresSql, postgresParams] = unsafe.mock.calls[0] as [string, unknown[]];
    expect(postgresSql).toMatch(/is_active = CASE channel_id WHEN \$\d+ THEN \$\d+ ELSE is_active END/);
    expect(postgresParams[paramsBeforeAssignment + 1]).toBe(isActive);
  });
});
