import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateItem: vi.fn(),
  createItem: vi.fn(),
  publishRealtimeEvent: vi.fn()
}));

vi.mock('../services/shopService', () => ({
  isArenaCosmeticType: (value: unknown) => typeof value === 'string' && [
    'emote', 'card_frame', 'name_flare', 'hit_vfx', 'summon_vfx', 'ready_stamp', 'nameplate', 'ko_text'
  ].includes(value),
  updateItem: mocks.updateItem,
  createItem: mocks.createItem
}));

vi.mock('../services/realtimeStream', () => ({
  publishRealtimeEvent: mocks.publishRealtimeEvent
}));

vi.mock('../services/achievementService', () => ({
  recordAchievementEvent: vi.fn()
}));

vi.mock('../services/arenaV2Service', () => ({
  isArenaV2MatchParticipant: vi.fn()
}));

import { adminCreateShopItem, adminUpdateShopItem } from '../controllers/shopController';

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
});
