import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tx: {
    all: vi.fn(),
    run: vi.fn()
  },
  db: {
    transaction: vi.fn()
  }
}));

vi.mock('../services/db', () => ({
  getMysqlDb: () => mocks.db,
  getSqlDialect: () => 'postgres'
}));

import { MysqlUserCardRepository } from '../repositories/mysql/userCard.repository';

describe('MysqlUserCardRepository.updateSettingsBulk query bounds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.run.mockResolvedValue({ changes: 1 });
    mocks.db.transaction.mockImplementation(async (task: (tx: typeof mocks.tx) => Promise<unknown>) => task(mocks.tx));
  });

  it('200장 mixed visibility를 소유권 SELECT 1회와 UPDATE 최대 2회로 처리한다', async () => {
    const updates = Array.from({ length: 200 }, (_, index) => ({ card_id: index + 1, value: index % 2 === 0 }));
    mocks.tx.all.mockResolvedValue(updates.map((update) => ({ id: update.card_id, favorite_order: null })));
    const repository = new MysqlUserCardRepository();

    const succeeded = await repository.updateSettingsBulk('user-1', 'hidden', updates);

    expect(succeeded).toEqual(updates.map((update) => update.card_id));
    expect(mocks.db.transaction).toHaveBeenCalledOnce();
    expect(mocks.tx.all).toHaveBeenCalledOnce();
    expect(mocks.tx.run).toHaveBeenCalledTimes(2);
    expect(mocks.tx.all.mock.calls.length + mocks.tx.run.mock.calls.length).toBeLessThanOrEqual(3);
    expect(mocks.tx.run.mock.calls.every(([sql]) => String(sql).includes('user_id = ?'))).toBe(true);
  });

  it('favorite 해제 뒤 현재 MAX를 다시 반영하고 입력순으로 CASE 값을 배정한다', async () => {
    mocks.tx.all
      .mockResolvedValueOnce([
        { id: 2, favorite_order: 10 },
        { id: 3, favorite_order: null },
        { id: 4, favorite_order: null }
      ])
      .mockResolvedValueOnce([
        { id: 2, favorite_order: 10 },
        { id: 1, favorite_order: 5 }
      ]);
    const repository = new MysqlUserCardRepository();

    const succeeded = await repository.updateSettingsBulk('user-1', 'favorite', [
      { card_id: 2, value: false },
      { card_id: 3, value: true },
      { card_id: 4, value: true }
    ]);

    expect(succeeded).toEqual([2, 3, 4]);
    expect(mocks.tx.all).toHaveBeenCalledTimes(2);
    expect(mocks.tx.run).toHaveBeenCalledTimes(2);
    expect(mocks.tx.all.mock.calls.length + mocks.tx.run.mock.calls.length).toBeLessThanOrEqual(4);
    const favoriteCaseCall = mocks.tx.run.mock.calls.find(([sql]) => String(sql).includes('CASE id'));
    expect(favoriteCaseCall).toBeDefined();
    expect(favoriteCaseCall?.slice(1)).toEqual([3, 6, 4, 7, 'user-1', 3, 4]);
  });

  it('잠금 SELECT에 pending market 재검사를 포함한다', async () => {
    mocks.tx.all.mockResolvedValue([
      { id: 1, favorite_order: null, pending_market: 0 },
      { id: 2, favorite_order: null, pending_market: 1 }
    ]);
    const repository = new MysqlUserCardRepository();

    const succeeded = await repository.updateSettingsBulk('user-1', 'locked', [
      { card_id: 1, value: true },
      { card_id: 2, value: true }
    ]);

    expect(succeeded).toEqual([1]);
    expect(String(mocks.tx.all.mock.calls[0][0])).toContain("ml.status = 'PENDING'");
    expect(mocks.tx.run).toHaveBeenCalledTimes(1);
  });
});
