import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findByUserId: vi.fn()
}));

vi.mock('../repositories', () => ({
  userCardRepository: { findByUserId: mocks.findByUserId },
  userRepository: {},
  streamerRepository: {},
  systemConfigRepository: {},
  marketRepository: {},
  titleRepository: {}
}));
vi.mock('../controllers/tradeController', () => ({ getUserReservations: vi.fn() }));
vi.mock('../services/achievementService', () => ({ recordAchievementEvent: vi.fn() }));

import { clearUserCardsInFlight, getUserCards } from '../controllers/playController';

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

const legacyCards = [{
  id: 1,
  user_id: 'user-a',
  channel_id: 'channel-a',
  serial_number: 7,
  star: 2,
  border_item_id: null,
  name_effect_item_id: null,
  is_hidden: false,
  is_locked: true,
  favorite_order: null,
  favorite_at: null,
  acquired_at: '2026-11-06T01:02:03.000Z',
  streamer: { channel_id: 'channel-a', name: 'A', custom_images: [null] },
  border: null,
  name_effect: null
}];

describe('getUserCards compact opt-in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearUserCardsInFlight('user-a');
  });

  it('keeps the legacy array response byte-contract by default', async () => {
    mocks.findByUserId.mockResolvedValue(legacyCards);
    const res = response();

    await getUserCards({ user: { id: 'user-a' }, query: {} } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(legacyCards);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.headers['Cache-Control']).toBe('private, no-store');
  });

  it('returns version 1 only when format=compact is requested', async () => {
    mocks.findByUserId.mockResolvedValue(legacyCards);
    const res = response();

    await getUserCards({ user: { id: 'user-a' }, query: { format: 'compact' } } as any, res);

    expect(res.body).toMatchObject({
      version: 1,
      cards: [expect.objectContaining({ id: 1, channel_id: 'channel-a' })],
      streamers: [legacyCards[0].streamer],
      cosmetics: []
    });
    expect(res.body.cards[0]).not.toHaveProperty('streamer');
    expect(res.body.cards[0]).not.toHaveProperty('border');
    expect(res.body.cards[0]).not.toHaveProperty('name_effect');
    expect(res.headers['Cache-Control']).toBe('private, no-store');
  });

  it('coalesces concurrent legacy and compact requests onto one repository read', async () => {
    let release!: (cards: typeof legacyCards) => void;
    mocks.findByUserId.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const legacyRes = response();
    const compactRes = response();

    const legacyRequest = getUserCards({ user: { id: 'user-a' }, query: {} } as any, legacyRes);
    const compactRequest = getUserCards({ user: { id: 'user-a' }, query: { format: 'compact' } } as any, compactRes);
    expect(mocks.findByUserId).toHaveBeenCalledTimes(1);
    release(legacyCards);
    await Promise.all([legacyRequest, compactRequest]);

    expect(legacyRes.body).toBe(legacyCards);
    expect(compactRes.body.version).toBe(1);
  });

  it('authenticates before loading either response format', async () => {
    const res = response();
    await getUserCards({ query: { format: 'compact' } } as any, res);
    expect(res.statusCode).toBe(401);
    expect(mocks.findByUserId).not.toHaveBeenCalled();
  });
});
