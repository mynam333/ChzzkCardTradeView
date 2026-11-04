import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseClient: vi.fn()
}));

vi.mock('../services/db', () => ({
  getSupabaseClient: mocks.getSupabaseClient
}));

vi.mock('../services/imageService', () => ({
  formatUploadUrl: (value: string | null | undefined) => value || null
}));

import { SupabaseUserCardRepository } from '../repositories/supabase/userCard.repository';

const makeCard = (id: number) => ({
  id,
  user_id: 'large-inventory-user',
  channel_id: `channel-${id % 2}`,
  serial_number: id,
  star: id % 3,
  border_item_id: null,
  name_effect_item_id: null,
  is_hidden: false,
  is_locked: false,
  favorite_order: null,
  favorite_at: null,
  acquired_at: null,
  streamer: {
    channel_id: `channel-${id % 2}`,
    name: `streamer-${id % 2}`,
    logo_url: null,
    custom_image_url: null,
    custom_image_url_1: null,
    custom_image_url_2: null,
    custom_image_url_3: null,
    custom_image_url_4: null,
    custom_image_url_5: null,
    base_value: 1000,
    follower_count: 0,
    is_active: false,
    is_image_banned: false,
    serial_number: id % 2
  }
});

const pagedBuilder = (rows: any[], ranges: Array<[number, number]>) => {
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn((from: number, to: number) => {
      ranges.push([from, to]);
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    })
  };
  return builder;
};

describe('SupabaseUserCardRepository large inventories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads every user card across the PostgREST row limit', async () => {
    const cards = Array.from({ length: 1201 }, (_, index) => makeCard(index + 1));
    const ranges: Array<[number, number]> = [];
    const userCards = pagedBuilder(cards, ranges);
    const from = vi.fn((table: string) => {
      if (table === 'user_cards') return userCards;
      throw new Error(`unexpected table: ${table}`);
    });
    mocks.getSupabaseClient.mockReturnValue({ from });

    const result = await new SupabaseUserCardRepository().findByUserId('large-inventory-user');

    expect(result).toHaveLength(1201);
    expect(ranges).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  });

  it('builds inventory groups from lightweight paged cards and one streamer batch', async () => {
    const cards = Array.from({ length: 601 }, (_, index) => ({
      id: index + 1,
      channel_id: `channel-${index % 2}`,
      star: index % 3,
      border_item_id: null,
      name_effect_item_id: null,
      is_hidden: index % 10 === 0,
      is_locked: index % 11 === 0,
      favorite_order: null
    }));
    const ranges: Array<[number, number]> = [];
    const userCards = pagedBuilder(cards, ranges);
    const streamerRows = [0, 1].map((id) => ({
      channel_id: `channel-${id}`,
      name: `streamer-${id}`,
      logo_url: null,
      custom_image_url: null,
      custom_image_url_1: null,
      custom_image_url_2: null,
      custom_image_url_3: null,
      custom_image_url_4: null,
      custom_image_url_5: null,
      base_value: 1000,
      follower_count: 0,
      is_active: false,
      is_image_banned: false,
      serial_number: id
    }));
    const streamers: any = {
      select: vi.fn(() => streamers),
      in: vi.fn().mockResolvedValue({ data: streamerRows, error: null })
    };
    const from = vi.fn((table: string) => table === 'user_cards' ? userCards : streamers);
    mocks.getSupabaseClient.mockReturnValue({ from });

    const result = await new SupabaseUserCardRepository().findInventoryGroupsByUserId('large-inventory-user');

    expect(result).toHaveLength(6);
    expect(result.reduce((sum, group) => sum + group.count, 0)).toBe(601);
    expect(ranges).toEqual([[0, 499], [500, 999]]);
    expect(streamers.in).toHaveBeenCalledTimes(1);
    expect(userCards.select).toHaveBeenCalledWith('id, channel_id, star, border_item_id, name_effect_item_id, is_hidden, is_locked, favorite_order');
  });
});
