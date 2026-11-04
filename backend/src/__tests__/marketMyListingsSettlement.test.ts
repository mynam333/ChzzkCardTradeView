import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  marketRepository: {
    listByUser: vi.fn(),
    getListingBidPresence: vi.fn(),
    getHighestBids: vi.fn(),
    finishExpiredAuctions: vi.fn(),
    cancelStaleListings: vi.fn()
  }
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

const fixedListing = () => ({
  id: 1,
  seller_id: 'seller',
  user_card_id: 11,
  price: 1000,
  status: 'PENDING' as const,
  buyer_id: null,
  listing_type: 'fixed' as const,
  fee: 0,
  settled_amount: 0
});

const expiredAuction = () => ({
  ...fixedListing(),
  id: 2,
  listing_type: 'auction' as const,
  starting_bid: 1000,
  auction_ends_at: '2020-01-01T00:00:00.000Z'
});

const endedAuction = () => ({
  ...expiredAuction(),
  status: 'AUCTION_ENDED' as const
});

const loadController = async () => {
  vi.resetModules();
  return import('../controllers/marketController');
};

describe('seller market list settlement admission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.marketRepository.finishExpiredAuctions.mockResolvedValue([]);
    mocks.marketRepository.cancelStaleListings.mockResolvedValue([]);
    mocks.marketRepository.getListingBidPresence.mockResolvedValue({});
    mocks.marketRepository.getHighestBids.mockResolvedValue({});
  });

  it('does not run global settlement for ordinary repeated seller-list GETs', async () => {
    mocks.marketRepository.listByUser.mockResolvedValue([fixedListing()]);
    const { listMyListings } = await loadController();

    await listMyListings({ user: { id: 'seller' } } as any, response());
    await listMyListings({ user: { id: 'seller' } } as any, response());

    expect(mocks.marketRepository.listByUser).toHaveBeenCalledTimes(2);
    expect(mocks.marketRepository.finishExpiredAuctions).not.toHaveBeenCalled();
    expect(mocks.marketRepository.cancelStaleListings).not.toHaveBeenCalled();
  });

  it('settles and reloads immediately when the seller response contains an expired auction', async () => {
    mocks.marketRepository.listByUser
      .mockResolvedValueOnce([expiredAuction()])
      .mockResolvedValueOnce([endedAuction()]);
    const { listMyListings } = await loadController();
    const res = response();

    await listMyListings({ user: { id: 'seller' } } as any, res);

    expect(mocks.marketRepository.finishExpiredAuctions).toHaveBeenCalledTimes(1);
    expect(mocks.marketRepository.cancelStaleListings).toHaveBeenCalledTimes(1);
    expect(mocks.marketRepository.listByUser).toHaveBeenCalledTimes(2);
    expect(res.body[0]).toMatchObject({ id: 2, status: 'AUCTION_ENDED' });
  });

  it('joins one in-flight settlement when concurrent seller requests observe expiration', async () => {
    let releaseSettlement!: (value: any[]) => void;
    mocks.marketRepository.finishExpiredAuctions.mockImplementation(() => new Promise((resolve) => {
      releaseSettlement = resolve;
    }));
    mocks.marketRepository.listByUser
      .mockResolvedValueOnce([expiredAuction()])
      .mockResolvedValueOnce([expiredAuction()])
      .mockResolvedValueOnce([endedAuction()])
      .mockResolvedValueOnce([endedAuction()]);
    const { listMyListings } = await loadController();

    const first = listMyListings({ user: { id: 'seller' } } as any, response());
    const second = listMyListings({ user: { id: 'seller' } } as any, response());
    await vi.waitFor(() => expect(mocks.marketRepository.finishExpiredAuctions).toHaveBeenCalledTimes(1));
    releaseSettlement([]);
    await Promise.all([first, second]);

    expect(mocks.marketRepository.finishExpiredAuctions).toHaveBeenCalledTimes(1);
    expect(mocks.marketRepository.cancelStaleListings).toHaveBeenCalledTimes(1);
    expect(mocks.marketRepository.listByUser).toHaveBeenCalledTimes(4);
  });
});
