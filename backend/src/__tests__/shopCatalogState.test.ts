import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    all: vi.fn(),
    get: vi.fn(),
    run: vi.fn(),
    transaction: vi.fn()
  }
}));

vi.mock('../services/db', () => ({
  getDbMode: () => 'MYSQL',
  getMysqlDb: () => mocks.db,
  getSqlDialect: () => 'postgres',
  getSqliteDb: vi.fn(),
  getSupabaseClient: vi.fn()
}));

vi.mock('../services/pointLedger', () => ({
  recordMysqlPointLedger: vi.fn(),
  recordSqlitePointLedger: vi.fn()
}));

vi.mock('../services/assetEventLog', () => ({
  recordMysqlAssetEvent: vi.fn(),
  recordSqliteAssetEvent: vi.fn()
}));

import {
  buyItem,
  getActiveItems,
  getAllItems,
  getItem,
  updateItem
} from '../services/shopService';

const shopItemRow = (active: unknown, id = 1) => ({
  id,
  type: 'border',
  name: `item-${id}`,
  description: null,
  price: 1000,
  style_json: null,
  font_url: null,
  font_family: null,
  active,
  purchase_limit: 0,
  listed_at: null,
  sale_start_at: null,
  sale_end_at: null,
  limited_total_quantity: 0,
  sold_quantity: 0,
  created_at: null
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

describe('shop catalog active state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.all.mockResolvedValue([]);
    mocks.db.get.mockResolvedValue(shopItemRow(false));
    mocks.db.run.mockResolvedValue({ changes: 1, affectedRows: 1, insertId: 0, lastInsertRowid: 0 });
    mocks.db.transaction.mockImplementation(async (callback: (tx: typeof mocks.db) => unknown) => callback(mocks.db));
  });

  it.each([
    [true, true],
    [false, false],
    [1, true],
    [0, false],
    ['1', true],
    ['0', false]
  ])('normalizes database active value %j to %s', async (databaseValue, expected) => {
    mocks.db.all.mockResolvedValueOnce([shopItemRow(databaseValue)]);

    const [item] = await getAllItems();

    expect(item.active).toBe(expected);
  });

  it('normalizes PostgreSQL bigint-backed catalog fields to the numeric API contract', async () => {
    mocks.db.all.mockResolvedValueOnce([{
      ...shopItemRow(true),
      id: '42',
      price: '123456789',
      purchase_limit: '3',
      limited_total_quantity: '250',
      sold_quantity: '17'
    }]);

    const [item] = await getAllItems();

    expect(item).toMatchObject({
      id: 42,
      price: 123456789,
      purchase_limit: 3,
      limited_total_quantity: 250,
      sold_quantity: 17,
      active: true
    });
  });

  it('normalizes a single PostgreSQL item response', async () => {
    mocks.db.get.mockResolvedValueOnce({ ...shopItemRow(true, 9), price: '2500' });

    await expect(getItem(9)).resolves.toMatchObject({ id: 9, price: 2500, active: true });
  });

  it('rejects a purchase before a PostgreSQL Date sale start', async () => {
    mocks.db.get.mockResolvedValueOnce({
      ...shopItemRow(true),
      sale_start_at: new Date('2999-01-01T00:00:00+09:00')
    });

    await expect(buyItem('user-1', 1)).resolves.toMatchObject({
      ok: false,
      reason: 'SALE_NOT_STARTED'
    });
    expect(mocks.db.run).not.toHaveBeenCalled();
  });

  it('rejects a purchase after a PostgreSQL Date sale end', async () => {
    mocks.db.get.mockResolvedValueOnce({
      ...shopItemRow(true),
      sale_end_at: new Date('2000-01-01T00:00:00+09:00')
    });

    await expect(buyItem('user-1', 1)).resolves.toMatchObject({
      ok: false,
      reason: 'SALE_ENDED'
    });
    expect(mocks.db.run).not.toHaveBeenCalled();
  });

  it('raises a typed error instead of silently succeeding for a missing update target', async () => {
    mocks.db.get.mockResolvedValueOnce(undefined);

    await expect(updateItem(404, { active: true })).rejects.toMatchObject({
      code: 'SHOP_ITEM_NOT_FOUND'
    });
    expect(mocks.db.run).not.toHaveBeenCalled();
  });

  it('reads the database again after an update instead of reusing process-local catalog state', async () => {
    const staleQuery = deferred<any[]>();
    mocks.db.all
      .mockImplementationOnce(() => staleQuery.promise)
      .mockResolvedValueOnce([shopItemRow(true, 2)]);

    const staleRead = getActiveItems();
    await updateItem(2, { active: true });
    const freshRead = getActiveItems();

    staleQuery.resolve([]);
    const [staleItems, freshItems] = await Promise.all([staleRead, freshRead]);

    expect(staleItems).toEqual([]);
    expect(mocks.db.all).toHaveBeenCalledTimes(2);
    expect(freshItems.map((item) => item.id)).toEqual([2]);
    mocks.db.all.mockResolvedValueOnce([shopItemRow(true, 3)]);
    await expect(getActiveItems()).resolves.toMatchObject([{ id: 3, active: true }]);
    expect(mocks.db.all).toHaveBeenCalledTimes(3);
  });
});
