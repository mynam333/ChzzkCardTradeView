import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateItem: vi.fn(),
  createItem: vi.fn(),
  getItem: vi.fn(),
  buyItem: vi.fn(),
  getAllItems: vi.fn(),
  getUserCosmetics: vi.fn(),
  getUserCosmeticCounts: vi.fn(),
  getUserPurchases: vi.fn(),
  publishRealtimeEvent: vi.fn()
}));

vi.mock('../services/shopService', () => ({
  isCardCosmeticType: (value: unknown) => value === 'border' || value === 'name_effect',
  updateItem: mocks.updateItem,
  createItem: mocks.createItem,
  getItem: mocks.getItem,
  buyItem: mocks.buyItem,
  getAllItems: mocks.getAllItems,
  getUserCosmetics: mocks.getUserCosmetics,
  getUserCosmeticCounts: mocks.getUserCosmeticCounts,
  getUserPurchases: mocks.getUserPurchases
}));

vi.mock('../services/realtimeStream', () => ({
  publishRealtimeEvent: mocks.publishRealtimeEvent
}));

vi.mock('../services/achievementService', () => ({
  recordAchievementEvent: vi.fn()
}));

import {
  adminCreateShopItem,
  adminGetShopItems,
  adminUpdateShopItem,
  buyShopItem,
  getMyCosmeticCounts,
  getMyCosmetics,
  getMyPurchases
} from '../controllers/shopController';

const response = () => {
  const res: any = {
    statusCode: 200,
    body: undefined,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    set(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    }
  };
  return res;
};

describe('admin shop item active-state contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateItem.mockResolvedValue(undefined);
    mocks.createItem.mockResolvedValue(undefined);
    mocks.getItem.mockResolvedValue({ id: 7, type: 'border' });
    mocks.buyItem.mockResolvedValue({ ok: true, reason: 'OK' });
    mocks.getAllItems.mockResolvedValue([{ id: 1, type: 'border' }, { id: 2, type: 'emote' }]);
    mocks.getUserCosmetics.mockResolvedValue([{ id: 1, type: 'border', quantity: 2 }, { id: 2, type: 'emote', quantity: 4 }]);
    mocks.getUserCosmeticCounts.mockResolvedValue({ 1: 2, 2: 4 });
    mocks.getUserPurchases.mockResolvedValue({ 1: 1, 2: 3 });
  });

  it.each(['false', '0', 0, 1, null])('rejects non-boolean active update value %j', async (active) => {
    const res = response();

    await adminUpdateShopItem({ params: { id: '7' }, body: { active } } as any, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain('boolean');
    expect(mocks.updateItem).not.toHaveBeenCalled();
  });

  it('rejects misspelled update fields instead of reporting a false success', async () => {
    const res = response();

    await adminUpdateShopItem({ params: { id: '7' }, body: { is_active: true } } as any, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain('is_active');
    expect(mocks.updateItem).not.toHaveBeenCalled();
  });

  it.each([true, false])('persists boolean active=%s and publishes only after success', async (active) => {
    const res = response();

    await adminUpdateShopItem({ params: { id: '7' }, body: { active } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(mocks.updateItem).toHaveBeenCalledWith(7, { active });
    expect(mocks.publishRealtimeEvent).toHaveBeenCalledWith('shop', { reason: 'item_updated', itemId: 7 });
  });

  it('returns 404 and does not publish when the item no longer exists', async () => {
    const error = Object.assign(new Error('missing'), { code: 'SHOP_ITEM_NOT_FOUND' });
    mocks.updateItem.mockRejectedValueOnce(error);
    const res = response();

    await adminUpdateShopItem({ params: { id: '404' }, body: { active: true } } as any, res);

    expect(res.statusCode).toBe(404);
    expect(mocks.publishRealtimeEvent).not.toHaveBeenCalled();
  });

  it('rejects non-boolean active values when creating an item', async () => {
    const res = response();

    await adminCreateShopItem({
      body: { type: 'border', name: '테스트', price: 1000, active: 'false' }
    } as any, res);

    expect(res.statusCode).toBe(400);
    expect(mocks.createItem).not.toHaveBeenCalled();
  });

  it('does not recreate or update a removed legacy cosmetic kind', async () => {
    const createRes = response();
    await adminCreateShopItem({ body: { type: 'emote', name: 'legacy', price: 0 } } as any, createRes);
    expect(createRes.statusCode).toBe(400);
    expect(mocks.createItem).not.toHaveBeenCalled();

    mocks.getItem.mockResolvedValueOnce({ id: 7, type: 'card_frame' });
    const updateRes = response();
    await adminUpdateShopItem({ params: { id: '7' }, body: { active: false } } as any, updateRes);
    expect(updateRes.statusCode).toBe(404);
    expect(mocks.updateItem).not.toHaveBeenCalled();
  });

  it('does not sell a preserved legacy cosmetic through the generic shop endpoint', async () => {
    mocks.getItem.mockResolvedValueOnce({ id: 7, type: 'emote' });
    const res = response();
    await buyShopItem({ user: { id: 'user' }, body: { item_id: 7 } } as any, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.reason).toBe('NOT_FOUND');
    expect(mocks.buyItem).not.toHaveBeenCalled();
  });

  it('preserves but hides legacy cosmetics from every generic shop read endpoint', async () => {
    const req = { user: { id: 'user' } } as any;
    const ownedRes = response();
    await getMyCosmetics(req, ownedRes);
    expect(ownedRes.body).toEqual([{ id: 1, type: 'border', quantity: 2 }]);

    const countRes = response();
    await getMyCosmeticCounts(req, countRes);
    expect(countRes.body).toEqual({ 1: 2 });

    const purchaseRes = response();
    await getMyPurchases(req, purchaseRes);
    expect(purchaseRes.body).toEqual({ 1: 1 });

    const adminRes = response();
    await adminGetShopItems({} as any, adminRes);
    expect(adminRes.body).toEqual([{ id: 1, type: 'border' }]);
    expect(mocks.getAllItems).toHaveBeenCalled();
  });
});
