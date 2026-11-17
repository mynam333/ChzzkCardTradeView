import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  finishExpiredAuctions: vi.fn(),
  cancelStaleListings: vi.fn().mockResolvedValue([]),
  recordAchievementEvent: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../repositories', () => ({ marketRepository: mocks }));
vi.mock('../services/realtimeStream', () => ({ publishRealtimeEvent: vi.fn() }));
vi.mock('../services/notificationDelivery', () => ({ createRealtimeNotification: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/achievementService', () => ({ recordAchievementEvent: mocks.recordAchievementEvent }));
vi.mock('../controllers/pushController', () => ({ sendPushToUser: vi.fn() }));
vi.mock('../controllers/tradeController', () => ({ getUserReservations: vi.fn() }));
vi.mock('../controllers/playController', () => ({ clearStreamerDetailCache: vi.fn(), scheduleUserRankingRefresh: vi.fn() }));

describe('auction settlement activity for achievements and weekly missions', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it('records both sides only after an auction actually sells, with retry-stable event keys', async () => {
    const sold = { id: 81, seller_id: 'seller', buyer_id: 'winner', status: 'SOLD', price: 2500 };
    mocks.finishExpiredAuctions.mockResolvedValue([
      sold,
      { id: 82, seller_id: 'seller', status: 'AUCTION_ENDED' }
    ]);
    const { settleExpiredAuctions } = await import('../controllers/marketController');
    await settleExpiredAuctions({ force: true });
    expect(mocks.recordAchievementEvent).toHaveBeenCalledTimes(2);
    expect(mocks.recordAchievementEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: 'market:purchase:winner:81', userId: 'winner', eventType: 'market.purchase',
      metadata: { price: 2500, seller_id: 'seller', listing_type: 'auction' }
    }));
    expect(mocks.recordAchievementEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: 'market:sale:seller:81', userId: 'seller', eventType: 'market.sale',
      metadata: { price: 2500, buyer_id: 'winner', listing_type: 'auction' }
    }));
    const firstKeys = mocks.recordAchievementEvent.mock.calls.map(([event]) => event.eventKey);
    mocks.recordAchievementEvent.mockClear();
    await settleExpiredAuctions({ force: true });
    expect(mocks.recordAchievementEvent.mock.calls.map(([event]) => event.eventKey)).toEqual(firstKeys);
  });

  it('does not count listings without a buyer or failed settlements', async () => {
    mocks.finishExpiredAuctions.mockResolvedValue([{ id: 83, seller_id: 'seller', status: 'SOLD', price: 1 }]);
    const { settleExpiredAuctions } = await import('../controllers/marketController');
    await settleExpiredAuctions({ force: true });
    expect(mocks.recordAchievementEvent).not.toHaveBeenCalled();
    mocks.finishExpiredAuctions.mockRejectedValueOnce(new Error('settlement rolled back'));
    await expect(settleExpiredAuctions({ force: true })).rejects.toThrow('settlement rolled back');
    expect(mocks.recordAchievementEvent).not.toHaveBeenCalled();
  });
});
