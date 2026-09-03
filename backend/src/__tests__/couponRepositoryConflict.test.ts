import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    run: vi.fn(),
    transaction: vi.fn()
  }
}));

vi.mock('../services/db', () => ({
  getMysqlDb: () => mocks.db
}));

vi.mock('../services/pointLedger', () => ({
  recordMysqlPointLedger: vi.fn()
}));

vi.mock('../services/assetEventLog', () => ({
  recordMysqlAssetEvent: vi.fn()
}));

import { MysqlCouponRepository } from '../repositories/mysql/coupon.repository';

describe('MysqlCouponRepository duplicate claims', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses a conflict-free insert when recording a duplicate redemption', async () => {
    mocks.db.run.mockResolvedValue({ changes: 0, affectedRows: 0 });
    const repository = new MysqlCouponRepository();

    await expect(repository.logCouponRedeem(24, 'user-1')).resolves.toBe(false);
    expect(mocks.db.run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT IGNORE INTO coupon_logs'),
      24,
      'user-1'
    );
  });

  it('stops an atomic redemption when the coupon log already exists', async () => {
    const tx = {
      get: vi.fn().mockResolvedValue({
        id: 24,
        code: 'WELCOME',
        coupon_type: 'multi',
        reward_type: 'point',
        points: 1000,
        reward_quantity: 0,
        max_uses: 0,
        used_count: 1,
        expires_at: null
      }),
      run: vi.fn().mockResolvedValue({ changes: 0, affectedRows: 0 })
    };
    mocks.db.transaction.mockImplementation(async (task: (value: typeof tx) => Promise<unknown>) => task(tx));
    const repository = new MysqlCouponRepository();

    await expect(repository.redeemAtomic(24, 'user-1')).resolves.toEqual({ ok: false, reason: 'DUPLICATE' });
    expect(tx.run).toHaveBeenCalledTimes(1);
    expect(tx.run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT IGNORE INTO coupon_logs'),
      24,
      'user-1'
    );
  });
});
