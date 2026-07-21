import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MysqlNotificationRepository } from '../repositories/mysql/notification.repository';
import { PostgresDb } from '../services/postgresDb';

const dbMock = vi.hoisted(() => ({
  run: vi.fn(),
  get: vi.fn()
}));

vi.mock('../services/db', () => ({
  getMysqlDb: () => dbMock
}));

describe('MysqlNotificationRepository PostgreSQL compatibility', () => {
  beforeEach(() => {
    dbMock.run.mockReset().mockResolvedValue({ changes: 1, insertId: 0 });
    dbMock.get.mockReset().mockResolvedValue({
      id: 42,
      user_id: 'seller-1',
      title: '경매 낙찰 완료',
      body: '판매 대금이 정산되었습니다.',
      link: 'shop:market',
      group_key: 'market-auction-seller:100',
      is_read: false,
      deleted_at: null,
      created_at: '2026-07-22T00:00:00.000Z'
    });
  });

  it('묶음 알림의 읽음 상태를 PostgreSQL BOOLEAN과 호환되는 파라미터로 UPSERT한다', async () => {
    const repository = new MysqlNotificationRepository();

    await repository.upsertByGroupKey({
      user_id: 'seller-1',
      title: '경매 낙찰 완료',
      body: '판매 대금이 정산되었습니다.',
      link: 'shop:market',
      group_key: 'market-auction-seller:100'
    });

    expect(dbMock.run).toHaveBeenCalledTimes(1);
    const [sql, ...params] = dbMock.run.mock.calls[0] as [string, ...unknown[]];
    expect(params[5]).toBe(false);

    const unsafe = vi.fn().mockResolvedValue([{ id: 42 }]);
    const postgresDb = new PostgresDb({ unsafe });
    await postgresDb.run(sql, ...params);

    const [postgresSql, postgresParams] = unsafe.mock.calls[0] as [string, unknown[]];
    expect(postgresSql).toContain('VALUES ($1, $2, $3, $4, $5, $6, NULL, NOW())');
    expect(postgresSql).toContain('ON CONFLICT (user_id, group_key) WHERE group_key IS NOT NULL DO UPDATE SET');
    expect(postgresSql).toContain('is_read = EXCLUDED.is_read');
    expect(postgresParams[5]).toBe(false);
  });
});
