import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listPendingMarketCardsBySeller: vi.fn(),
  marketRepository: {
    finishExpiredAuctions: vi.fn(),
    cancelStaleListings: vi.fn()
  }
}));

vi.mock('../services/marketPendingCardsService', () => ({
  listPendingMarketCardsBySeller: mocks.listPendingMarketCardsBySeller
}));
vi.mock('../repositories', () => ({ marketRepository: mocks.marketRepository }));
vi.mock('../services/realtimeStream', () => ({ publishRealtimeEvent: vi.fn() }));
vi.mock('../services/notificationDelivery', () => ({ createRealtimeNotification: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/achievementService', () => ({ recordAchievementEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../controllers/pushController', () => ({ sendPushToUser: vi.fn() }));
vi.mock('../controllers/tradeController', () => ({ getUserReservations: vi.fn().mockResolvedValue({}) }));
vi.mock('../controllers/playController', () => ({
  clearStreamerDetailCache: vi.fn(),
  scheduleUserRankingRefresh: vi.fn()
}));

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

const loadController = async () => {
  vi.resetModules();
  return import('../controllers/marketController');
};

describe('lightweight pending market card endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.marketRepository.finishExpiredAuctions.mockResolvedValue([]);
    mocks.marketRepository.cancelStaleListings.mockResolvedValue([]);
  });

  it('requires authentication before querying seller listings', async () => {
    const { listMyPendingCards } = await loadController();
    const res = response();

    await listMyPendingCards({} as any, res);

    expect(res.statusCode).toBe(401);
    expect(mocks.listPendingMarketCardsBySeller).not.toHaveBeenCalled();
  });

  it('returns only the listing id needed for cancellation and its reserved card id', async () => {
    mocks.listPendingMarketCardsBySeller.mockResolvedValue([{
      id: 41,
      user_card_id: 77,
      status: 'PENDING',
      listing_type: 'auction',
      auction_ends_at: '2099-01-01T00:00:00.000Z',
      seller_id: 'seller',
      price: 9000,
      current_bid: 8000,
      current_bidder_id: 'private-bidder'
    }]);
    const { listMyPendingCards } = await loadController();
    const res = response();

    await listMyPendingCards({ user: { id: 'seller' } } as any, res);

    expect(res.body).toEqual([{ id: 41, user_card_id: 77, status: 'PENDING' }]);
    expect(Object.keys(res.body[0]).sort()).toEqual(['id', 'status', 'user_card_id']);
    expect(res.headers['Cache-Control']).toBe('private, no-store');
  });

  it('settles an expired auction and reloads so a released card is not returned as pending', async () => {
    mocks.listPendingMarketCardsBySeller
      .mockResolvedValueOnce([{
        id: 42,
        user_card_id: 78,
        status: 'PENDING',
        listing_type: 'auction',
        auction_ends_at: '2020-01-01T00:00:00.000Z'
      }])
      .mockResolvedValueOnce([{
        id: 43,
        user_card_id: 79,
        status: 'PENDING',
        listing_type: 'fixed',
        auction_ends_at: null
      }]);
    const { listMyPendingCards } = await loadController();
    const res = response();

    await listMyPendingCards({ user: { id: 'seller' } } as any, res);

    expect(mocks.marketRepository.finishExpiredAuctions).toHaveBeenCalledTimes(1);
    expect(mocks.marketRepository.cancelStaleListings).toHaveBeenCalledTimes(1);
    expect(mocks.listPendingMarketCardsBySeller).toHaveBeenCalledTimes(2);
    expect(res.body).toEqual([{ id: 43, user_card_id: 79, status: 'PENDING' }]);
  });
});
