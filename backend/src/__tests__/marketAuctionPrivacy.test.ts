import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  marketRepository: {
    listActive: vi.fn(),
    listByUser: vi.fn(),
    getListingBidPresence: vi.fn(),
    getHighestBids: vi.fn(),
    placeBid: vi.fn(),
    findById: vi.fn(),
    finishExpiredAuctions: vi.fn(),
    cancelStaleListings: vi.fn()
  },
  publishRealtimeEvent: vi.fn()
}));

vi.mock('../repositories', () => ({ marketRepository: mocks.marketRepository }));
vi.mock('../services/realtimeStream', () => ({ publishRealtimeEvent: mocks.publishRealtimeEvent }));
vi.mock('../services/notificationDelivery', () => ({ createRealtimeNotification: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/achievementService', () => ({ recordAchievementEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../controllers/pushController', () => ({ sendPushToUser: vi.fn() }));
vi.mock('../controllers/tradeController', () => ({ getUserReservations: vi.fn().mockResolvedValue([]) }));
vi.mock('../controllers/playController', () => ({
  clearStreamerDetailCache: vi.fn(),
  scheduleUserRankingRefresh: vi.fn()
}));

import { listActiveListings, listMyListings, placeBid } from '../controllers/marketController';

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

const rawPendingAuction = () => ({
  id: 41,
  seller_id: 'seller',
  user_card_id: 7,
  price: 1000,
  status: 'PENDING' as const,
  buyer_id: null,
  listing_type: 'auction' as const,
  buy_now_price: null,
  starting_bid: 1000,
  current_bid: 9000,
  current_bidder_id: 'hidden-bidder',
  current_bidder_username: 'hidden-name',
  my_bid: 7777,
  has_bids: true,
  highest_bid: 9000,
  winning_price: 8000,
  auction_ends_at: '2099-01-01T00:00:00.000Z',
  bid_reserved: 9000,
  fee: 0,
  settled_amount: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  auction_result: {
    winning_bid: 9000,
    winning_price: 8000,
    second_bid: 8000,
    bidders: [{ user_id: 'hidden-bidder', username: 'hidden-name', amount: 9000, is_winner: true }]
  }
});

const expectPendingSecretsRemoved = (listing: Record<string, unknown>) => {
  expect(listing.current_bid).toBe(1000);
  for (const field of [
    'highest_bid',
    'winning_price',
    'auction_result',
    'current_bidder_id',
    'current_bidder_username',
    'bid_reserved'
  ]) {
    expect(listing).not.toHaveProperty(field);
  }
};

describe('sealed auction HTTP boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.marketRepository.finishExpiredAuctions.mockResolvedValue([]);
    mocks.marketRepository.cancelStaleListings.mockResolvedValue([]);
    mocks.marketRepository.getHighestBids.mockResolvedValue({});
    mocks.marketRepository.getListingBidPresence.mockResolvedValue({ 41: true });
  });

  it('removes every raw pending bid secret from the public list', async () => {
    mocks.marketRepository.listActive.mockResolvedValue({ listings: [rawPendingAuction()], total: 1 });
    const res = response();

    await listActiveListings({ query: { page: '1', limit: '12', sort: 'latest', type: 'all' } } as any, res);

    expect(res.body.total).toBe(1);
    expectPendingSecretsRemoved(res.body.listings[0]);
    expect(res.body.listings[0]).not.toHaveProperty('my_bid');
    expect(res.body.listings[0]).not.toHaveProperty('has_bids');
  });

  it('shows only has_bids on the seller pending list', async () => {
    mocks.marketRepository.listByUser.mockResolvedValue([rawPendingAuction()]);
    const res = response();

    await listMyListings({ user: { id: 'seller' } } as any, res);

    expectPendingSecretsRemoved(res.body[0]);
    expect(res.body[0]).toMatchObject({ has_bids: true });
    expect(res.body[0]).not.toHaveProperty('my_bid');
    expect(mocks.marketRepository.getListingBidPresence).toHaveBeenCalledWith([41]);
    expect(mocks.marketRepository.getHighestBids).toHaveBeenCalledWith([]);
  });

  it('allowlists the bidder response and publishes an equally redacted public SSE patch', async () => {
    mocks.marketRepository.placeBid.mockResolvedValue({
      ok: true,
      reason: 'OK',
      auction_ends_at: '2099-01-01T00:00:00.000Z',
      highest_bid: 9000,
      internal_debug: 'must-not-leak'
    });
    mocks.marketRepository.findById.mockResolvedValue(rawPendingAuction());
    const res = response();

    await placeBid({
      user: { id: 'buyer' },
      params: { id: '41' },
      body: { amount: 6500 }
    } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      reason: 'OK',
      auction_ends_at: '2099-01-01T00:00:00.000Z',
      listing: {
        id: 41,
        current_bid: 1000,
        current_bidder_id: null,
        current_bidder_username: null,
        my_bid: 6500
      }
    });
    expect(Object.keys(res.body).sort()).toEqual(['auction_ends_at', 'listing', 'ok', 'reason']);
    expect(res.body.listing).not.toHaveProperty('highest_bid');
    expect(res.body.listing).not.toHaveProperty('winning_price');
    expect(res.body.listing).not.toHaveProperty('auction_result');
    expect(res.body.listing).not.toHaveProperty('bid_reserved');
    expect(res.body.listing).not.toHaveProperty('has_bids');

    expect(mocks.publishRealtimeEvent).toHaveBeenCalledWith('market', expect.objectContaining({
      reason: 'auction_bid',
      listingId: 41,
      listing: expect.objectContaining({
        id: 41,
        current_bid: 1000,
        current_bidder_id: null,
        current_bidder_username: null
      })
    }));
    const realtimeListing = mocks.publishRealtimeEvent.mock.calls[0][1].listing;
    expect(realtimeListing).not.toHaveProperty('my_bid');
    expect(realtimeListing).not.toHaveProperty('highest_bid');
    expect(realtimeListing).not.toHaveProperty('winning_price');
    expect(realtimeListing).not.toHaveProperty('auction_result');
    expect(realtimeListing).not.toHaveProperty('bid_reserved');
    expect(realtimeListing).not.toHaveProperty('has_bids');
  });
});
