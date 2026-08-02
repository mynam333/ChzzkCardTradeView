import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import type { Streamer } from '../repositories/interfaces';
import { PostgresDb } from '../services/postgresDb';

const mocks = vi.hoisted(() => ({
  db: null as PostgresDb | null,
  unsafe: vi.fn(),
  decodedJsonArrays: [] as unknown[][]
}));

vi.mock('../services/db', () => ({
  getDbMode: () => 'MYSQL',
  getMysqlDb: () => mocks.db,
  getSqlDialect: () => 'postgres',
  getSqliteDb: vi.fn(),
  getSupabaseClient: vi.fn()
}));

import { settleStreamerCardDeletion } from '../services/cardDeletionSettlement';

const postgresTypeProbe = postgres({ max: 1 });
const serializePostgresJson = (postgresTypeProbe.options as any).serializers[3802] as
  (value: unknown) => string;

const scalarSenderOffer = JSON.parse(serializePostgresJson(JSON.stringify({
  cards: [{ channel_id: 'channel-delete' }],
  point: 0
}))) as string;

const pgRows = <T>(rows: T[] = [], count = rows.length) => Object.assign(rows, { count });

const targetStreamer: Streamer = {
  channel_id: 'channel-delete',
  name: '삭제 대상',
  logo_url: null,
  custom_image_url: null,
  custom_images: [],
  is_image_banned: false,
  follower_count: 0,
  activity_score: 0,
  base_value: 120,
  is_active: false,
  lifecycle_id: 'lifecycle-delete'
};

const normalizesPostgresTradeOffer = (sql: string, column: 'sender_offer' | 'receiver_offer') => {
  const escapedColumn = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `CASE\\s+WHEN\\s+jsonb_typeof\\(\\s*${escapedColumn}\\s*\\)\\s*=\\s*'string'` +
      `\\s+THEN\\s*\\(\\s*${escapedColumn}\\s*#>>\\s*'\\{\\}'\\s*\\)\\s*::\\s*jsonb` +
      `\\s+ELSE\\s+${escapedColumn}\\s+END`,
    'i'
  ).test(sql);
};

const serializeServerInferredJsonbParams = (sql: string, params: unknown[]) =>
  params.map((value, index) => {
    const placeholder = `\\$${index + 1}`;
    const directlyCastToJsonb = new RegExp(`${placeholder}\\s*::\\s*jsonb\\b`, 'i').test(sql);
    return directlyCastToJsonb ? serializePostgresJson(value) : value;
  });

const decodeStructuredJsonInput = (sql: string, params: unknown[]): unknown[] | null => {
  if (!/jsonb_(?:array_elements_text|to_recordset)\s*\(/i.test(sql)) return null;

  const serializedParams = serializeServerInferredJsonbParams(sql, params);
  const decoded = JSON.parse(String(serializedParams[0]));
  if (!Array.isArray(decoded)) {
    throw Object.assign(new Error('cannot extract elements from a scalar'), { code: '22023' });
  }
  mocks.decodedJsonArrays.push(decoded);
  return decoded;
};

describe('settleStreamerCardDeletion PostgreSQL JSONB serialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decodedJsonArrays = [];

    const connection: any = {
      unsafe: mocks.unsafe,
      begin: async (task: (tx: any) => Promise<unknown>) => task(connection)
    };
    mocks.db = new PostgresDb(connection);

    mocks.unsafe.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const decodedJson = decodeStructuredJsonInput(sql, params);
      if (/jsonb_array_elements_text\s*\(/i.test(sql)) {
        return pgRows((decodedJson || []).map((id) => ({ id: String(id) })));
      }

      if (/^SELECT\s+value\s+FROM\s+system_configs/i.test(sql.trim())) {
        return pgRows([{ value: '10000' }]);
      }
      if (/^SELECT\s+channel_id\s+FROM\s+streamers/i.test(sql.trim())) {
        return pgRows([{ channel_id: targetStreamer.channel_id }]);
      }
      if (/^SELECT\s+channel_id,\s*name,\s*base_value,\s*lifecycle_id\s+FROM\s+streamers/i.test(sql.trim())) {
        return pgRows([{
          channel_id: targetStreamer.channel_id,
          name: targetStreamer.name,
          base_value: targetStreamer.base_value,
          lifecycle_id: targetStreamer.lifecycle_id
        }]);
      }
      if (/^SELECT[\s\S]+FROM\s+market_listings\s+ml[\s\S]+FOR\s+UPDATE\s+OF\s+ml/i.test(sql.trim())) {
        return pgRows([{
          id: 91,
          seller_id: 'owner',
          buyer_id: null,
          current_bidder_id: 'bidder',
          user_card_id: 41,
          channel_id: targetStreamer.channel_id,
          serial_number: 1,
          star: 0,
          price: 1000,
          status: 'PENDING',
          listing_type: 'auction',
          current_bid: 1500,
          bid_reserved: 1500,
          fee: 0,
          settled_amount: 0,
          created_at: '2026-08-03T00:00:00.000Z',
          updated_at: '2026-08-03T00:00:00.000Z'
        }]);
      }
      if (/^SELECT[\s\S]+FROM\s+trades\b/i.test(sql.trim())) {
        if (
          !normalizesPostgresTradeOffer(sql, 'sender_offer') ||
          !normalizesPostgresTradeOffer(sql, 'receiver_offer')
        ) {
          return pgRows([]);
        }
        return pgRows([{
          id: 73,
          sender_id: 'trade-sender',
          receiver_id: 'trade-receiver',
          // postgres.js parses a JSONB string scalar back into the original JSON text.
          sender_offer: scalarSenderOffer,
          receiver_offer: { cards: [], point: 0 },
          status: 'PENDING'
        }]);
      }
      if (/^SELECT[\s\S]+FROM\s+user_cards\b[\s\S]+FOR\s+UPDATE/i.test(sql.trim())) {
        return pgRows([{
          id: 41,
          user_id: 'owner',
          channel_id: targetStreamer.channel_id,
          serial_number: 1,
          star: 0,
          border_item_id: null,
          name_effect_item_id: null
        }]);
      }
      if (/^SELECT[\s\S]+FROM\s+market_bids\s+mb/i.test(sql.trim())) {
        return pgRows([{ listing_id: 91, user_id: 'bidder', amount: 1500 }]);
      }
      if (/^DELETE\s+FROM\s+(?:user_cards|streamers)\b/i.test(sql.trim())) return pgRows([], 1);
      return pgRows([]);
    });
  });

  afterAll(async () => {
    await postgresTypeProbe.end({ timeout: 0 });
  });

  it('reproduces postgres.js JSONB double serialization through the PostgresDb adapter', async () => {
    const alreadyStringified = JSON.stringify(['owner']);

    expect(JSON.parse(serializePostgresJson(alreadyStringified))).toBe(alreadyStringified);
    await expect(mocks.db!.all(
      'SELECT jsonb_array_elements_text(?::jsonb) AS id',
      alreadyStringified
    )).rejects.toMatchObject({
      code: '22023',
      message: 'cannot extract elements from a scalar'
    });
    const fixedRows = await mocks.db!.all(
      'SELECT jsonb_array_elements_text(CAST(? AS TEXT)::jsonb) AS id',
      alreadyStringified
    );
    expect([...fixedRows]).toEqual([{ id: 'owner' }]);
  });

  it('casts structured inputs through TEXT and normalizes legacy scalar trade offers', async () => {
    await expect(settleStreamerCardDeletion(targetStreamer)).resolves.toMatchObject({
      cards_removed: 1,
      cancelled_trades: 1,
      cancelled_listings: 1,
      refunded_market_bid_points: 1500,
      total_free_draw_tickets_granted: 1,
      cancelled_trade_participant_ids: ['trade-sender', 'trade-receiver']
    });

    const tradeSelectCall = mocks.unsafe.mock.calls.find(([sql]) =>
      /^SELECT[\s\S]+FROM\s+trades\b/i.test(String(sql).trim())
    );
    expect(tradeSelectCall).toBeDefined();
    expect(normalizesPostgresTradeOffer(String(tradeSelectCall![0]), 'sender_offer')).toBe(true);
    expect(normalizesPostgresTradeOffer(String(tradeSelectCall![0]), 'receiver_offer')).toBe(true);

    const tradeUpdateCall = mocks.unsafe.mock.calls.find(([sql]) =>
      /^UPDATE\s+trades\b/i.test(String(sql).trim())
    );
    expect(tradeUpdateCall).toBeDefined();
    expect(String(tradeUpdateCall![0])).toMatch(/WHERE\s+id\s+IN\s*\(\s*\$1\s*\)/i);
    expect(String(tradeUpdateCall![0])).not.toMatch(/jsonb_typeof|sender_offer|receiver_offer|@>/i);
    expect(tradeUpdateCall![1]).toEqual([73]);

    const structuredJsonCalls = mocks.unsafe.mock.calls.filter(([sql]) =>
      /jsonb_(?:array_elements_text|to_recordset)\s*\(/i.test(String(sql))
    );
    expect(structuredJsonCalls).toHaveLength(8);
    for (const [sql] of structuredJsonCalls) {
      expect(String(sql)).toMatch(/CAST\(\s*\$\d+\s+AS\s+TEXT\s*\)\s*::\s*jsonb/i);
      expect(String(sql)).not.toMatch(/\$\d+\s*::\s*jsonb/i);
    }

    expect(mocks.decodedJsonArrays).toContainEqual(['bidder', 'owner']);
    expect(mocks.decodedJsonArrays).toContainEqual([
      { listing_id: 91, user_id: 'bidder', amount: 1500 }
    ]);
    expect(mocks.decodedJsonArrays).toContainEqual([
      expect.objectContaining({
        user_id: 'owner',
        deleted_count: 1,
        free_draw_tickets: 1
      })
    ]);
  });
});
