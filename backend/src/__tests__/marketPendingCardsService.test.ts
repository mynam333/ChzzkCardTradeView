import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state = { mode: 'MYSQL' as 'MYSQL' | 'SQLITE' | 'SUPABASE' };
  const mysql = { all: vi.fn() };
  const sqliteStatement = { all: vi.fn() };
  const sqlite = { prepare: vi.fn((_sql: string) => sqliteStatement) };
  const supabaseRange = vi.fn();
  const supabaseChain: any = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    range: supabaseRange
  };
  supabaseChain.select.mockReturnValue(supabaseChain);
  supabaseChain.eq.mockReturnValue(supabaseChain);
  supabaseChain.order.mockReturnValue(supabaseChain);
  const supabase = { from: vi.fn(() => supabaseChain) };
  return { state, mysql, sqlite, sqliteStatement, supabase, supabaseChain, supabaseRange };
});

vi.mock('../services/db', () => ({
  getDbMode: () => mocks.state.mode,
  getMysqlDb: () => mocks.mysql,
  getSqliteDb: () => mocks.sqlite,
  getSupabaseClient: () => mocks.supabase
}));

import { listPendingMarketCardsBySeller } from '../services/marketPendingCardsService';

describe('pending market card query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.mode = 'MYSQL';
    mocks.supabaseChain.select.mockReturnValue(mocks.supabaseChain);
    mocks.supabaseChain.eq.mockReturnValue(mocks.supabaseChain);
    mocks.supabaseChain.order.mockReturnValue(mocks.supabaseChain);
  });

  it('selects only cancellation and expiry-admission fields for a pending seller listing', async () => {
    mocks.mysql.all.mockResolvedValue([{
      id: '17',
      user_card_id: '91',
      listing_type: 'auction',
      auction_ends_at: '2099-01-01T00:00:00.000Z',
      price: 999999,
      current_bid: 888888
    }]);

    const result = await listPendingMarketCardsBySeller('seller');
    const sql = String(mocks.mysql.all.mock.calls[0][0]).replace(/\s+/g, ' ').trim();

    expect(sql).toContain('SELECT id, user_card_id, listing_type, auction_ends_at FROM market_listings');
    expect(sql).toContain("WHERE seller_id = ? AND status = 'PENDING'");
    expect(sql).not.toContain('price');
    expect(sql).not.toContain('current_bid');
    expect(mocks.mysql.all).toHaveBeenCalledWith(expect.any(String), 'seller');
    expect(result).toEqual([{
      id: 17,
      user_card_id: 91,
      status: 'PENDING',
      listing_type: 'auction',
      auction_ends_at: '2099-01-01T00:00:00.000Z'
    }]);
  });

  it('uses the same narrow contract for SQLite', async () => {
    mocks.state.mode = 'SQLITE';
    mocks.sqliteStatement.all.mockReturnValue([{
      id: 5,
      user_card_id: 6,
      listing_type: null,
      auction_ends_at: null
    }]);

    await expect(listPendingMarketCardsBySeller('seller')).resolves.toEqual([{
      id: 5,
      user_card_id: 6,
      status: 'PENDING',
      listing_type: 'fixed',
      auction_ends_at: null
    }]);
    const sql = String(mocks.sqlite.prepare.mock.calls[0][0]).replace(/\s+/g, ' ').trim();
    expect(sql).toContain('SELECT id, user_card_id, listing_type, auction_ends_at FROM market_listings');
    expect(sql).not.toContain('price');
    expect(mocks.sqliteStatement.all).toHaveBeenCalledWith('seller');
  });

  it('paginates Supabase results past the default 1000-row cap', async () => {
    mocks.state.mode = 'SUPABASE';
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      id: index + 1,
      user_card_id: index + 10,
      listing_type: 'fixed',
      auction_ends_at: null
    }));
    mocks.supabaseRange
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: [{ id: 1001, user_card_id: 1010, listing_type: 'auction', auction_ends_at: '2099-01-01' }], error: null });

    const result = await listPendingMarketCardsBySeller('seller');

    expect(result).toHaveLength(1001);
    expect(mocks.supabase.from).toHaveBeenCalledWith('market_listings');
    expect(mocks.supabaseChain.select).toHaveBeenCalledWith('id,user_card_id,listing_type,auction_ends_at');
    expect(mocks.supabaseChain.eq).toHaveBeenNthCalledWith(1, 'seller_id', 'seller');
    expect(mocks.supabaseChain.eq).toHaveBeenNthCalledWith(2, 'status', 'PENDING');
    expect(mocks.supabaseRange).toHaveBeenNthCalledWith(1, 0, 999);
    expect(mocks.supabaseRange).toHaveBeenNthCalledWith(2, 1000, 1999);
  });
});
