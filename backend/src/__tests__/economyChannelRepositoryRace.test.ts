import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    transaction: vi.fn(),
    get: vi.fn(),
    all: vi.fn(),
    run: vi.fn()
  },
  tx: {
    get: vi.fn(),
    all: vi.fn(),
    run: vi.fn()
  },
  lockEconomyChannels: vi.fn(),
  events: [] as string[]
}));

vi.mock('../services/db', () => ({
  getMysqlDb: () => mocks.db,
  getSqlDialect: () => 'postgres'
}));

vi.mock('../services/economyChannelLock', () => ({
  lockEconomyChannels: mocks.lockEconomyChannels
}));

vi.mock('../services/pointLedger', () => ({
  recordMysqlPointLedger: vi.fn()
}));

vi.mock('../services/assetEventLog', () => ({
  ensureMysqlAssetEventLogReady: vi.fn(),
  recordMysqlAssetEvent: vi.fn(),
  recordMysqlAssetEvents: vi.fn()
}));

import { MysqlMarketRepository } from '../repositories/mysql/market.repository';
import { MysqlStreamerRepository } from '../repositories/mysql/streamer.repository';
import { MysqlTradeRepository } from '../repositories/mysql/trade.repository';

const normalizeSql = (sql: unknown) => String(sql).replace(/\s+/g, ' ').trim();

const offeredTrade = () => ({
  sender_id: 'sender',
  receiver_id: 'receiver',
  sender_offer: {
    cards: [
      { channel_id: 'channel-z', star: 0, count: 1 },
      { channel_id: 'channel-a', star: 1, count: 1 }
    ],
    point: 0
  },
  receiver_offer: {
    cards: [
      { channel_id: 'channel-b', star: 0, count: 1 },
      { channel_id: 'channel-a', star: 2, count: 1 }
    ],
    point: 0
  }
});

const streamerToRegister = () => ({
  channel_id: 'register-channel',
  name: '원자 등록 테스트',
  logo_url: 'https://example.com/logo.png',
  custom_image_url: null,
  custom_images: [],
  is_image_banned: false,
  follower_count: 1000,
  activity_score: 0,
  base_value: 1000,
  is_active: false,
  registered_by: 'registrar'
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.events.length = 0;
  mocks.db.transaction.mockImplementation(async (task: (tx: typeof mocks.tx) => Promise<unknown>) => task(mocks.tx));
  mocks.db.all.mockResolvedValue([]);
  mocks.tx.all.mockResolvedValue([]);
  mocks.db.run.mockResolvedValue({ insertId: 41, changes: 1, affectedRows: 1 });
  mocks.tx.run.mockResolvedValue({ insertId: 41, changes: 1, affectedRows: 1 });
  mocks.lockEconomyChannels.mockImplementation(async (_tx: unknown, channelIds: string[]) => {
    const normalized = [...new Set(channelIds)].sort();
    mocks.events.push(`streamer-lock:${normalized.join(',')}`);
    return normalized;
  });
});

describe('direct SQL repository economy-channel race guards', () => {
  it('locks every unique offered channel and revalidates it before creating a trade', async () => {
    const repository = new MysqlTradeRepository();

    await expect(repository.create(offeredTrade())).resolves.toMatchObject({
      id: 41,
      status: 'PENDING'
    });

    expect(mocks.db.transaction).toHaveBeenCalledOnce();
    expect(mocks.lockEconomyChannels).toHaveBeenCalledWith(
      mocks.tx,
      expect.arrayContaining(['channel-a', 'channel-b', 'channel-z'])
    );
    const lockedChannels = mocks.lockEconomyChannels.mock.calls[0][1] as string[];
    expect([...new Set(lockedChannels)].sort()).toEqual(['channel-a', 'channel-b', 'channel-z']);

    const insert = mocks.tx.run.mock.calls.find(([sql]) => /INSERT\s+INTO\s+trades/i.test(String(sql)));
    expect(insert).toBeDefined();
    expect(mocks.lockEconomyChannels.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.tx.run.mock.invocationCallOrder[0]);
  });

  it('does not insert a trade when a referenced streamer disappeared while the request was in flight', async () => {
    const repository = new MysqlTradeRepository();
    mocks.lockEconomyChannels.mockResolvedValue(['channel-a', 'channel-z']);

    await expect(repository.create(offeredTrade())).rejects.toBeDefined();

    expect(mocks.tx.run.mock.calls.some(([sql]) => /INSERT\s+INTO\s+trades/i.test(String(sql)))).toBe(false);
  });

  it('uses a status-and-receiver CAS so a concurrent deletion cancellation cannot be revived as CONFIRMED', async () => {
    const repository = new MysqlTradeRepository();
    const row = {
      id: 7,
      sender_id: 'sender',
      receiver_id: 'receiver',
      sender_offer: JSON.stringify({ cards: [], point: 0 }),
      receiver_offer: JSON.stringify({ cards: [], point: 0 }),
      status: 'PENDING'
    };
    mocks.db.get.mockResolvedValue(row);
    mocks.tx.get.mockResolvedValue(row);
    mocks.db.run.mockResolvedValue({ changes: 0, affectedRows: 0, insertId: 0 });
    mocks.tx.run.mockResolvedValue({ changes: 0, affectedRows: 0, insertId: 0 });

    const result = await repository.confirm(7, 'receiver', { receiverWithCosmetics: true });

    const updateCalls = [...mocks.db.run.mock.calls, ...mocks.tx.run.mock.calls]
      .filter(([sql]) => /UPDATE\s+trades/i.test(String(sql)));
    expect(updateCalls).toHaveLength(1);
    expect(normalizeSql(updateCalls[0][0])).toMatch(
      /WHERE id = \? AND status = 'PENDING' AND receiver_id = \?/i
    );
    expect(result.ok).toBe(false);
  });

  it('locks the streamer before taking the market card row lock', async () => {
    const repository = new MysqlMarketRepository();
    const card = {
      channel_id: 'market-channel',
      serial_number: 12,
      star: 2,
      border_item_id: null,
      name_effect_item_id: null
    };
    const routeCardRead = async (sql: unknown) => {
      const normalized = normalizeSql(sql);
      if (/FROM user_cards/i.test(normalized) && /FOR UPDATE/i.test(normalized)) {
        mocks.events.push('card-lock');
        return card;
      }
      if (/SELECT channel_id/i.test(normalized) && /FROM user_cards/i.test(normalized)) {
        mocks.events.push('card-channel-probe');
        return { channel_id: card.channel_id };
      }
      return undefined;
    };
    mocks.db.get.mockImplementation(routeCardRead);
    mocks.tx.get.mockImplementation(routeCardRead);
    mocks.lockEconomyChannels.mockImplementation(async (_tx: unknown, channelIds: string[]) => {
      mocks.events.push('streamer-lock');
      return [...new Set(channelIds)].sort();
    });
    mocks.tx.run.mockImplementation(async (sql: unknown) => {
      if (/INSERT\s+INTO\s+market_listings/i.test(String(sql))) {
        return { insertId: 55, changes: 1, affectedRows: 1 };
      }
      return { insertId: 0, changes: 1, affectedRows: 1 };
    });
    vi.spyOn(repository, 'findById').mockResolvedValue({
      id: 55,
      seller_id: 'seller',
      user_card_id: 9,
      price: 1_000,
      status: 'PENDING',
      buyer_id: null,
      fee: 0,
      settled_amount: 0
    });

    await repository.create({
      seller_id: 'seller',
      user_card_id: 9,
      price: 1_000,
      with_cosmetics: true
    });

    const streamerLockIndex = mocks.events.indexOf('streamer-lock');
    const cardLockIndex = mocks.events.indexOf('card-lock');
    expect(mocks.events).toContain('card-channel-probe');
    expect(streamerLockIndex).toBeGreaterThanOrEqual(0);
    expect(cardLockIndex).toBeGreaterThan(streamerLockIndex);
    expect(mocks.lockEconomyChannels).toHaveBeenCalledWith(mocks.tx, ['market-channel']);
  });

  it('does not insert a duplicate streamer after the economy lock revalidation finds the channel', async () => {
    const repository = new MysqlStreamerRepository();
    mocks.lockEconomyChannels.mockImplementation(async (_tx: unknown, channelIds: string[]) => {
      mocks.events.push('streamer-lock-and-exists-recheck');
      return [...channelIds];
    });

    await expect(repository.save(streamerToRegister()))
      .rejects.toThrow('STREAMER_ALREADY_EXISTS');

    expect(mocks.db.transaction).toHaveBeenCalledOnce();
    expect(mocks.lockEconomyChannels).toHaveBeenCalledWith(mocks.tx, ['register-channel']);
    expect(mocks.tx.run.mock.calls.some(([sql]) => /INSERT\s+INTO\s+streamers/i.test(String(sql))))
      .toBe(false);
  });

  it('rechecks the registration block after the economy lock and does not insert a blocked streamer', async () => {
    const repository = new MysqlStreamerRepository();
    mocks.lockEconomyChannels.mockImplementation(async () => {
      mocks.events.push('streamer-lock');
      return [];
    });
    mocks.tx.get.mockImplementation(async (sql: unknown) => {
      if (/FROM\s+streamer_registration_blocks/i.test(normalizeSql(sql))) {
        mocks.events.push('registration-block-recheck');
        return { blocked: 1 };
      }
      return undefined;
    });

    await expect(repository.save(streamerToRegister()))
      .rejects.toThrow('STREAMER_REGISTRATION_BLOCKED');

    expect(mocks.events).toEqual(['streamer-lock', 'registration-block-recheck']);
    expect(mocks.lockEconomyChannels.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.tx.get.mock.invocationCallOrder[0]);
    expect(mocks.tx.run.mock.calls.some(([sql]) => /INSERT\s+INTO\s+streamers/i.test(String(sql))))
      .toBe(false);
  });
});
