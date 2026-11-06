import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    all: vi.fn()
  }
}));

vi.mock('../services/db', () => ({
  getMysqlDb: () => mocks.db,
  getSqlDialect: () => 'postgres'
}));

import { MysqlUserCardRepository } from '../repositories/mysql/userCard.repository';
import { compactUserCards } from '../services/userCardsCompactService';

describe('MysqlUserCardRepository PostgreSQL id normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns bigint-style string card ids as numbers and preserves them in compact responses', async () => {
    mocks.db.all.mockResolvedValue([{
      id: '900719',
      user_id: 'user-1',
      channel_id: 'channel-1',
      serial_number: 7,
      star: 2,
      border_item_id: null,
      name_effect_item_id: null,
      is_hidden: false,
      is_locked: false,
      favorite_order: null,
      favorite_at: null,
      acquired_at: '2026-11-07T00:00:00.000Z',
      streamer_name: 'Streamer',
      streamer_logo: null,
      streamer_custom_image: null,
      sci1: null,
      sci2: null,
      sci3: null,
      sci4: null,
      sci5: null,
      streamer_base_value: 100,
      streamer_follower: 200,
      streamer_is_active: true,
      streamer_is_image_banned: false,
      streamer_serial: 1,
      border_id: null,
      name_id: null
    }]);

    const cards = await new MysqlUserCardRepository().findByUserId('user-1');

    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe(900719);
    expect(typeof cards[0].id).toBe('number');

    const compact = compactUserCards(cards);
    expect(compact.cards[0].id).toBe(900719);
    expect(typeof compact.cards[0].id).toBe('number');
  });
});
