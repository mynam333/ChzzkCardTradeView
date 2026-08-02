import type { Streamer } from '../repositories/interfaces';
import {
  calculateCardDeletionUserCompensations,
  type CardDeletionCompensationResult,
  type CardDeletionUserCompensation
} from './cardDeletionCompensation';
import { getDbMode, getMysqlDb, getSqlDialect, getSqliteDb } from './db';
import { lockEconomyChannels } from './economyChannelLock';
import {
  ensureMysqlAssetEventLogReady,
  recordMysqlAssetEvent,
  recordMysqlAssetEvents,
  recordSqliteAssetEvent,
  recordSqliteAssetEvents
} from './assetEventLog';
import { recordMysqlPointLedger, recordSqlitePointLedger } from './pointLedger';

type CardRow = {
  id: number;
  user_id: string;
  channel_id: string;
  serial_number: number;
  star: number;
  border_item_id: number | null;
  name_effect_item_id: number | null;
};

type TradeRow = {
  id: number;
  sender_id: string;
  receiver_id: string;
  sender_offer: unknown;
  receiver_offer: unknown;
  status: string;
};

type MarketListingRow = {
  id: number;
  seller_id: string;
  buyer_id: string | null;
  current_bidder_id: string | null;
  user_card_id: number;
  channel_id: string;
  serial_number: number;
  star: number;
  price: number;
  status: string;
  listing_type: string;
  current_bid: number | null;
  bid_reserved: number;
  fee: number;
  settled_amount: number;
  created_at: string | null;
  updated_at: string | null;
};

type AsyncSqlTransaction = {
  all: <T = any>(sql: string, ...args: any[]) => Promise<T[]>;
  get: <T = any>(sql: string, ...args: any[]) => Promise<T | undefined>;
  run: (sql: string, ...args: any[]) => Promise<any>;
};

export type StreamerCardDeletionSettlementOptions = {
  preventReregistration?: boolean;
  blockReason?: string;
  blockedBy?: string | null;
};

export type MarketBidDeletionRefund = {
  listing_id: number;
  user_id: string;
  amount: number;
};

export type StreamerCardDeletionSettlementResult = CardDeletionCompensationResult & {
  already_settled: boolean;
  cancelled_trades: number;
  cancelled_listings: number;
  refunded_market_bid_points: number;
  cancelled_trade_participant_ids: string[];
  market_bid_refunds: MarketBidDeletionRefund[];
};

const DEFAULT_DRAW_COST = 10_000;

const parseDrawCost = (raw: unknown): number => {
  const parsed = Math.trunc(Number(raw));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DRAW_COST;
};

const parseJsonObject = (value: unknown): Record<string, any> => {
  if (value && typeof value === 'object') return value as Record<string, any>;
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const tradeReferencesChannel = (trade: TradeRow, channelId: string): boolean => {
  for (const rawOffer of [trade.sender_offer, trade.receiver_offer]) {
    const offer = parseJsonObject(rawOffer);
    if ((Array.isArray(offer.cards) ? offer.cards : []).some((card: any) => String(card?.channel_id || '') === channelId)) {
      return true;
    }
  }
  return false;
};

const compensationTotals = (
  drawCost: number,
  users: CardDeletionUserCompensation[],
  cardsRemoved: number
): CardDeletionCompensationResult => ({
  draw_cost: drawCost,
  affected_users: users.length,
  cards_removed: cardsRemoved,
  total_point_refunded: users.reduce((sum, item) => sum + item.point_refund, 0),
  total_free_draw_tickets_granted: users.reduce((sum, item) => sum + item.free_draw_tickets, 0),
  high_value_cards_refunded: users.reduce((sum, item) => sum + item.high_value_cards, 0),
  ticket_compensated_cards: users.reduce((sum, item) => sum + item.ticket_compensated_cards, 0),
  users
});

const emptySettlement = (drawCost: number): StreamerCardDeletionSettlementResult => ({
  ...compensationTotals(drawCost, [], 0),
  already_settled: true,
  cancelled_trades: 0,
  cancelled_listings: 0,
  refunded_market_bid_points: 0,
  cancelled_trade_participant_ids: [],
  market_bid_refunds: []
});

const placeholdersFor = (values: unknown[]) => values.map(() => '?').join(',');

const collectLatestBidRefunds = async (
  tx: AsyncSqlTransaction,
  listings: MarketListingRow[],
  channelId: string
): Promise<MarketBidDeletionRefund[]> => {
  const listingIds = listings.map((listing) => Number(listing.id));
  if (listingIds.length === 0) return [];
  const isPostgres = getSqlDialect() === 'postgres';
  const placeholders = placeholdersFor(listingIds);
  const rows = await tx.all<MarketBidDeletionRefund>(isPostgres ? `
    SELECT mb.listing_id, mb.bidder_id AS user_id, mb.amount
      FROM market_bids mb
      JOIN (
        SELECT listing_id, bidder_id, MAX(id) AS id
          FROM market_bids
         WHERE listing_id IN (
           SELECT ml.id
             FROM market_listings ml
             JOIN user_cards uc ON uc.id = ml.user_card_id
            WHERE uc.channel_id = ? AND ml.status = 'PENDING'
         )
         GROUP BY listing_id, bidder_id
      ) latest ON latest.id = mb.id
     ORDER BY mb.listing_id, mb.bidder_id
     FOR UPDATE OF mb
  ` : `
    SELECT mb.listing_id, mb.bidder_id AS user_id, mb.amount
      FROM market_bids mb
      JOIN (
        SELECT listing_id, bidder_id, MAX(id) AS id
          FROM market_bids
         WHERE listing_id IN (${placeholders})
         GROUP BY listing_id, bidder_id
      ) latest ON latest.id = mb.id
     ORDER BY mb.listing_id, mb.bidder_id
     FOR UPDATE
  `, ...(isPostgres ? [channelId] : listingIds));
  const listingsWithBids = new Set(rows.map((row) => Number(row.listing_id)));
  const legacy = listings
    .filter((listing) => !listingsWithBids.has(Number(listing.id)))
    .filter((listing) => listing.current_bidder_id && Number(listing.bid_reserved || 0) > 0)
    .map((listing) => ({
      listing_id: Number(listing.id),
      user_id: String(listing.current_bidder_id),
      amount: Number(listing.bid_reserved || 0)
    }));
  return [...rows, ...legacy]
    .map((row) => ({ ...row, listing_id: Number(row.listing_id), amount: Number(row.amount || 0) }))
    .filter((row) => row.user_id && row.amount > 0);
};

const recordPostgresMarketDeletionAudits = async (
  tx: AsyncSqlTransaction,
  channelId: string
) => {
  await tx.run(`
    INSERT INTO market_transaction_audit_logs
      (audit_key, listing_id, event_type, related_user_id, seller_id, buyer_id, current_bidder_id,
       user_card_id, channel_id, serial_number, star, price, status, listing_type, current_bid,
       bid_reserved, fee, settled_amount, listing_created_at, listing_updated_at)
    SELECT CONCAT(CAST(? AS TEXT), ml.id), ml.id, 'streamer_card_deleted', NULL,
           ml.seller_id, ml.buyer_id, ml.current_bidder_id, ml.user_card_id,
           uc.channel_id, uc.serial_number, COALESCE(uc.star, 0), ml.price,
           'CANCELLED', ml.listing_type, ml.current_bid, COALESCE(ml.bid_reserved, 0),
           COALESCE(ml.fee, 0), COALESCE(ml.settled_amount, 0), ml.created_at, ml.updated_at
      FROM market_listings ml
      JOIN user_cards uc ON uc.id = ml.user_card_id
     WHERE uc.channel_id = ? AND ml.status = 'PENDING'
    ON CONFLICT DO NOTHING
  `, `streamer_card_deleted:${channelId}:`, channelId);
};

const grantPostgresBidRefunds = async (
  tx: AsyncSqlTransaction,
  channelId: string,
  settlementKey: string,
  refunds: MarketBidDeletionRefund[]
) => {
  if (refunds.length === 0) return;
  const refundsJson = JSON.stringify(refunds);

  await tx.run(`
    WITH raw_refunds AS (
      SELECT * FROM jsonb_to_recordset(?::jsonb)
        AS r(listing_id BIGINT, user_id TEXT, amount BIGINT)
    ), totals AS (
      SELECT user_id, SUM(amount)::BIGINT AS amount
        FROM raw_refunds
       GROUP BY user_id
    )
    UPDATE users u
       SET point = u.point + totals.amount
      FROM totals
     WHERE u.id = totals.user_id
  `, refundsJson);

  await tx.run(`
    WITH refunds AS (
      SELECT * FROM jsonb_to_recordset(?::jsonb)
        AS r(listing_id BIGINT, user_id TEXT, amount BIGINT)
    )
    INSERT INTO point_ledger_entries
      (user_id, counterparty_user_id, amount, balance_after, source_type, source_id,
       reason, description, metadata)
    SELECT r.user_id, ml.seller_id, r.amount, u.point, 'market_bid_refund', r.listing_id::TEXT,
           'streamer_card_deleted_refund', CONCAT('카드 삭제로 경매 #', r.listing_id, ' 입찰 예약금 환불'),
           jsonb_build_object(
             'channel_id', CAST(? AS TEXT), 'listing_id', r.listing_id,
             'settlement_key', CAST(? AS TEXT)
           )
      FROM refunds r
      JOIN users u ON u.id = r.user_id
      LEFT JOIN market_listings ml ON ml.id = r.listing_id
  `, refundsJson, channelId, settlementKey);

  await tx.run(`
    WITH refunds AS (
      SELECT * FROM jsonb_to_recordset(?::jsonb)
        AS r(listing_id BIGINT, user_id TEXT, amount BIGINT)
    )
    INSERT INTO asset_event_logs
      (event_key, user_id, counterparty_user_id, asset_type, action, amount, balance_after,
       source_type, source_id, reason, description, channel_id, metadata)
    SELECT NULL, r.user_id, ml.seller_id, 'point', 'refund', r.amount, u.point,
           'market_bid_refund', r.listing_id::TEXT, 'streamer_card_deleted_refund',
           CONCAT('카드 삭제로 경매 #', r.listing_id, ' 입찰 예약금 환불'), CAST(? AS TEXT),
           jsonb_build_object(
             'channel_id', CAST(? AS TEXT), 'listing_id', r.listing_id,
             'settlement_key', CAST(? AS TEXT)
           )
      FROM refunds r
      JOIN users u ON u.id = r.user_id
      LEFT JOIN market_listings ml ON ml.id = r.listing_id
  `, refundsJson, channelId, channelId, settlementKey);
};

const grantPostgresCardCompensations = async (
  tx: AsyncSqlTransaction,
  channelId: string,
  streamerName: string,
  drawCost: number,
  settlementKey: string,
  compensations: CardDeletionUserCompensation[]
) => {
  if (compensations.length === 0) return;
  const compensationJson = JSON.stringify(compensations);
  const compensationRows = `
    SELECT * FROM jsonb_to_recordset(?::jsonb)
      AS c(
        user_id TEXT, deleted_count INTEGER, point_refund BIGINT, free_draw_tickets INTEGER,
        high_value_cards INTEGER, ticket_compensated_cards INTEGER
      )
  `;

  await tx.run(`
    WITH compensations AS (${compensationRows})
    UPDATE users u
       SET point = u.point + compensations.point_refund,
           bonus_free_draw_tickets = COALESCE(u.bonus_free_draw_tickets, 0) + compensations.free_draw_tickets
      FROM compensations
     WHERE u.id = compensations.user_id
  `, compensationJson);

  await tx.run(`
    WITH compensations AS (${compensationRows})
    INSERT INTO point_ledger_entries
      (user_id, counterparty_user_id, amount, balance_after, source_type, source_id,
       reason, description, metadata)
    SELECT c.user_id, NULL, c.point_refund, u.point, 'card_delete_refund', CAST(? AS TEXT),
           'card_delete_refund', '카드 삭제 보상 포인트 환불',
           jsonb_build_object(
             'channel_id', CAST(? AS TEXT), 'streamer_name', CAST(? AS TEXT),
             'draw_cost', CAST(? AS BIGINT),
             'deleted_count', c.deleted_count, 'high_value_cards', c.high_value_cards,
             'ticket_compensated_cards', c.ticket_compensated_cards,
             'settlement_key', CAST(? AS TEXT)
           )
      FROM compensations c
      JOIN users u ON u.id = c.user_id
     WHERE c.point_refund > 0
  `, compensationJson, channelId, channelId, streamerName, drawCost, settlementKey);

  await tx.run(`
    WITH compensations AS (${compensationRows})
    INSERT INTO asset_event_logs
      (event_key, user_id, asset_type, action, amount, balance_after, source_type, source_id,
       reason, description, channel_id, metadata)
    SELECT NULL, c.user_id, 'point', 'refund', c.point_refund, u.point,
           'card_delete_refund', CAST(? AS TEXT), 'card_delete_refund',
           '카드 삭제 보상 포인트 환불', CAST(? AS TEXT),
           jsonb_build_object(
             'channel_id', CAST(? AS TEXT), 'streamer_name', CAST(? AS TEXT),
             'draw_cost', CAST(? AS BIGINT),
             'deleted_count', c.deleted_count, 'high_value_cards', c.high_value_cards,
             'ticket_compensated_cards', c.ticket_compensated_cards,
             'settlement_key', CAST(? AS TEXT)
           )
      FROM compensations c
      JOIN users u ON u.id = c.user_id
     WHERE c.point_refund > 0
  `, compensationJson, channelId, channelId, channelId, streamerName, drawCost, settlementKey);

  await tx.run(`
    WITH compensations AS (${compensationRows})
    INSERT INTO asset_event_logs
      (event_key, user_id, asset_type, action, quantity, source_type, source_id,
       reason, description, channel_id, metadata)
    SELECT CONCAT(CAST(? AS TEXT), ':ticket:', c.user_id), c.user_id,
           'ticket', 'add', c.free_draw_tickets,
           'card_delete_refund', CAST(? AS TEXT), 'card_delete_free_draw_ticket_refund',
           '카드 삭제 보상 추가 무료 소환 티켓 지급', CAST(? AS TEXT),
           jsonb_build_object(
             'channel_id', CAST(? AS TEXT), 'streamer_name', CAST(? AS TEXT),
             'deleted_count', c.deleted_count,
             'ticket_compensated_cards', c.ticket_compensated_cards,
             'settlement_key', CAST(? AS TEXT)
           )
      FROM compensations c
     WHERE c.free_draw_tickets > 0
    ON CONFLICT DO NOTHING
  `, compensationJson, settlementKey, channelId, channelId, channelId, streamerName, settlementKey);
};

const recordPostgresCardDeleteEvents = async (
  tx: AsyncSqlTransaction,
  channelId: string,
  settlementKey: string
) => {
  await tx.run(`
    INSERT INTO asset_event_logs
      (event_key, user_id, asset_type, action, quantity, source_type, source_id,
       reason, description, card_id, channel_id, serial_number, star, metadata)
    SELECT CONCAT('streamer-card-delete:', CAST(? AS TEXT), ':card:', uc.id), uc.user_id,
           'card', 'delete', 1, 'admin_streamer_delete', CAST(? AS TEXT), 'streamer_card_delete',
           '스트리머 카드 일괄 삭제 정산', uc.id, uc.channel_id, uc.serial_number,
           COALESCE(uc.star, 0), jsonb_build_object('settlement_key', CAST(? AS TEXT))
      FROM user_cards uc
     WHERE uc.channel_id = ?
    ON CONFLICT DO NOTHING
  `, channelId, channelId, settlementKey, channelId);

  await tx.run(`
    INSERT INTO asset_event_logs
      (event_key, user_id, asset_type, action, quantity, source_type, source_id,
       reason, description, card_id, channel_id, item_id, item_type, metadata)
    SELECT CONCAT('streamer-card-delete:', CAST(? AS TEXT), ':card:', uc.id, ':cosmetic:', item.item_type, ':', item.item_id),
           uc.user_id, 'cosmetic', 'delete', 1, 'admin_streamer_delete', CAST(? AS TEXT),
           'streamer_card_equipped_cosmetic_delete', '스트리머 카드 일괄 삭제로 장착 코스메틱 제거',
           uc.id, uc.channel_id, item.item_id, item.item_type,
           jsonb_build_object('settlement_key', CAST(? AS TEXT))
      FROM user_cards uc
      CROSS JOIN LATERAL (
        VALUES (uc.border_item_id, 'border'::TEXT), (uc.name_effect_item_id, 'name_effect'::TEXT)
      ) AS item(item_id, item_type)
     WHERE uc.channel_id = ? AND item.item_id IS NOT NULL
    ON CONFLICT DO NOTHING
  `, channelId, channelId, settlementKey, channelId);
};

const collectLatestSqliteBidRefunds = (
  db: any,
  listings: MarketListingRow[]
): MarketBidDeletionRefund[] => {
  const listingIds = listings.map((listing) => Number(listing.id));
  if (listingIds.length === 0) return [];
  const placeholders = placeholdersFor(listingIds);
  const rows = db.prepare(`
    SELECT mb.listing_id, mb.bidder_id AS user_id, mb.amount
      FROM market_bids mb
      JOIN (
        SELECT listing_id, bidder_id, MAX(id) AS id
          FROM market_bids
         WHERE listing_id IN (${placeholders})
         GROUP BY listing_id, bidder_id
      ) latest ON latest.id = mb.id
     ORDER BY mb.listing_id, mb.bidder_id
  `).all(...listingIds) as MarketBidDeletionRefund[];
  const listingsWithBids = new Set(rows.map((row) => Number(row.listing_id)));
  const legacy = listings
    .filter((listing) => !listingsWithBids.has(Number(listing.id)))
    .filter((listing) => listing.current_bidder_id && Number(listing.bid_reserved || 0) > 0)
    .map((listing) => ({
      listing_id: Number(listing.id),
      user_id: String(listing.current_bidder_id),
      amount: Number(listing.bid_reserved || 0)
    }));
  return [...rows, ...legacy]
    .map((row) => ({ ...row, listing_id: Number(row.listing_id), amount: Number(row.amount || 0) }))
    .filter((row) => row.user_id && row.amount > 0);
};

const cardDeleteEvents = (channelId: string, settlementKey: string, cards: CardRow[]) => cards.flatMap((card) => {
  const events: any[] = [{
    eventKey: `streamer-card-delete:${channelId}:card:${card.id}`,
    userId: card.user_id,
    assetType: 'card',
    action: 'delete',
    quantity: 1,
    sourceType: 'admin_streamer_delete',
    sourceId: channelId,
    reason: 'streamer_card_delete',
    description: '스트리머 카드 일괄 삭제 정산',
    cardId: Number(card.id),
    channelId: card.channel_id,
    serialNumber: Number(card.serial_number),
    star: Number(card.star || 0),
    metadata: { settlement_key: settlementKey }
  }];
  for (const itemId of [card.border_item_id, card.name_effect_item_id]) {
    if (!itemId) continue;
    events.push({
      eventKey: `streamer-card-delete:${channelId}:card:${card.id}:cosmetic:${itemId}`,
      userId: card.user_id,
      assetType: 'cosmetic',
      action: 'delete',
      quantity: 1,
      sourceType: 'admin_streamer_delete',
      sourceId: channelId,
      reason: 'streamer_card_equipped_cosmetic_delete',
      description: '스트리머 카드 일괄 삭제로 장착 코스메틱 제거',
      cardId: Number(card.id),
      channelId: card.channel_id,
      itemId: Number(itemId),
      metadata: { settlement_key: settlementKey }
    });
  }
  return events;
});

const settleMysql = async (
  streamerSnapshot: Streamer,
  options: StreamerCardDeletionSettlementOptions
): Promise<StreamerCardDeletionSettlementResult> => {
  const db = getMysqlDb();
  await ensureMysqlAssetEventLogReady(db);

  return db.transaction(async (tx) => {
    const drawCostRow = await tx.get<{ value?: string | number }>(
      "SELECT value FROM system_configs WHERE `key` = ?",
      'draw_cost'
    );
    const drawCost = parseDrawCost(drawCostRow?.value);
    const existingChannels = await lockEconomyChannels(tx, [streamerSnapshot.channel_id]);
    if (!existingChannels.includes(streamerSnapshot.channel_id)) return emptySettlement(drawCost);

    const lockedStreamer = await tx.get<Pick<Streamer, 'channel_id' | 'name' | 'base_value' | 'lifecycle_id'>>(
      'SELECT channel_id, name, base_value, lifecycle_id FROM streamers WHERE channel_id = ? FOR UPDATE',
      streamerSnapshot.channel_id
    );
    if (!lockedStreamer) return emptySettlement(drawCost);
    if (
      streamerSnapshot.lifecycle_id
      && lockedStreamer.lifecycle_id
      && streamerSnapshot.lifecycle_id !== lockedStreamer.lifecycle_id
    ) {
      throw new Error('STREAMER_LIFECYCLE_CHANGED');
    }
    const channelId = lockedStreamer.channel_id;
    const isPostgres = getSqlDialect() === 'postgres';

    const listingLockClause = isPostgres ? 'FOR UPDATE OF ml' : 'FOR UPDATE';
    const listings = await tx.all<MarketListingRow>(`
      SELECT ml.id, ml.seller_id, ml.buyer_id, ml.current_bidder_id, ml.user_card_id,
             uc.channel_id, uc.serial_number, COALESCE(uc.star, 0) AS star,
             ml.price, ml.status, ml.listing_type, ml.current_bid, COALESCE(ml.bid_reserved, 0) AS bid_reserved,
             COALESCE(ml.fee, 0) AS fee, COALESCE(ml.settled_amount, 0) AS settled_amount,
             ml.created_at, ml.updated_at
        FROM market_listings ml
        JOIN user_cards uc ON uc.id = ml.user_card_id
       WHERE uc.channel_id = ? AND ml.status = 'PENDING'
       ORDER BY ml.id
       ${listingLockClause}
    `, channelId);

    const tradeChannelFilter = isPostgres
      ? `(
          sender_offer @> jsonb_build_object('cards', jsonb_build_array(jsonb_build_object('channel_id', CAST(? AS TEXT))))
          OR receiver_offer @> jsonb_build_object('cards', jsonb_build_array(jsonb_build_object('channel_id', CAST(? AS TEXT))))
        )`
      : `(
          JSON_SEARCH(sender_offer, 'one', ?, NULL, '$.cards[*].channel_id') IS NOT NULL
          OR JSON_SEARCH(receiver_offer, 'one', ?, NULL, '$.cards[*].channel_id') IS NOT NULL
        )`;
    const cancelledTrades = await tx.all<TradeRow>(`
      SELECT id, sender_id, receiver_id, sender_offer, receiver_offer, status
        FROM trades
       WHERE status IN ('PENDING','CONFIRMED')
         AND ${tradeChannelFilter}
       ORDER BY id
       FOR UPDATE
    `, channelId, channelId);
    if (cancelledTrades.length > 0) {
      if (isPostgres) {
        await tx.run(`
          UPDATE trades
             SET status = 'CANCELLED', completed_at = COALESCE(completed_at, UTC_TIMESTAMP())
           WHERE status IN ('PENDING','CONFIRMED') AND ${tradeChannelFilter}
        `, channelId, channelId);
      } else {
        const ids = cancelledTrades.map((trade) => Number(trade.id));
        await tx.run(`
          UPDATE trades
             SET status = 'CANCELLED', completed_at = COALESCE(completed_at, UTC_TIMESTAMP())
           WHERE id IN (${placeholdersFor(ids)}) AND status IN ('PENDING','CONFIRMED')
        `, ...ids);
      }
    }

    const cards = await tx.all<CardRow>(`
      SELECT id, user_id, channel_id, serial_number, COALESCE(star, 0) AS star,
             border_item_id, name_effect_item_id
        FROM user_cards
       WHERE channel_id = ?
       ORDER BY id
       FOR UPDATE
    `, channelId);
    const firstCardId = cards.length > 0 ? Number(cards[0].id) : 0;
    const lastCardId = cards.length > 0 ? Number(cards[cards.length - 1].id) : 0;
    const settlementKey = `streamer-card-delete:${channelId}:${lockedStreamer.lifecycle_id || `cards:${firstCardId}-${lastCardId}`}`;
    const bidRefunds = await collectLatestBidRefunds(tx, listings, channelId);
    const relatedUserIds = [...new Set([
      ...cards.map((card) => card.user_id),
      ...bidRefunds.map((refund) => refund.user_id)
    ].filter(Boolean))].sort();
    if (relatedUserIds.length > 0) {
      if (isPostgres) {
        await tx.all(`
          SELECT id
            FROM users
           WHERE id IN (SELECT jsonb_array_elements_text(?::jsonb))
           ORDER BY id
           FOR UPDATE
        `, JSON.stringify(relatedUserIds));
      } else {
        await tx.all(
          `SELECT id FROM users WHERE id IN (${placeholdersFor(relatedUserIds)}) ORDER BY id FOR UPDATE`,
          ...relatedUserIds
        );
      }
    }

    if (isPostgres) {
      await recordPostgresMarketDeletionAudits(tx, channelId);
    } else {
      for (const listing of listings) {
        await tx.run(`
          INSERT IGNORE INTO market_transaction_audit_logs
            (audit_key, listing_id, event_type, related_user_id, seller_id, buyer_id, current_bidder_id,
             user_card_id, channel_id, serial_number, star, price, status, listing_type, current_bid,
             bid_reserved, fee, settled_amount, listing_created_at, listing_updated_at)
          VALUES (?, ?, 'streamer_card_deleted', NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'CANCELLED', ?, ?, ?, ?, ?, ?, ?)
        `,
          `streamer_card_deleted:${channelId}:${listing.id}`,
          listing.id,
          listing.seller_id,
          listing.buyer_id,
          listing.current_bidder_id,
          listing.user_card_id,
          channelId,
          listing.serial_number,
          listing.star,
          listing.price,
          listing.listing_type,
          listing.current_bid,
          listing.bid_reserved,
          listing.fee,
          listing.settled_amount,
          listing.created_at,
          listing.updated_at
        );
      }
    }

    if (isPostgres) {
      await grantPostgresBidRefunds(tx, channelId, settlementKey, bidRefunds);
    } else {
      for (const refund of bidRefunds) {
        await tx.run('UPDATE users SET point = point + ? WHERE id = ?', refund.amount, refund.user_id);
        await recordMysqlPointLedger(tx, {
          userId: refund.user_id,
          counterpartyUserId: listings.find((listing) => Number(listing.id) === refund.listing_id)?.seller_id || null,
          amount: refund.amount,
          sourceType: 'market_bid_refund',
          sourceId: refund.listing_id,
          reason: 'streamer_card_deleted_refund',
          description: `카드 삭제로 경매 #${refund.listing_id} 입찰 예약금 환불`,
          metadata: { channel_id: channelId, listing_id: refund.listing_id, settlement_key: settlementKey }
        });
      }
    }

    if (listings.length > 0) {
      if (isPostgres) {
        await tx.run(`
          UPDATE market_listings ml
             SET status = 'CANCELLED', pending_user_card_id = NULL,
                 current_bidder_id = NULL, bid_reserved = 0, updated_at = UTC_TIMESTAMP()
           WHERE ml.status = 'PENDING'
             AND EXISTS (
               SELECT 1 FROM user_cards uc
                WHERE uc.id = ml.user_card_id AND uc.channel_id = ?
             )
        `, channelId);
      } else {
        const ids = listings.map((listing) => Number(listing.id));
        await tx.run(`
          UPDATE market_listings
             SET status = 'CANCELLED', pending_user_card_id = NULL,
                 current_bidder_id = NULL, bid_reserved = 0, updated_at = UTC_TIMESTAMP()
           WHERE id IN (${placeholdersFor(ids)}) AND status = 'PENDING'
        `, ...ids);
      }
    }

    const users = calculateCardDeletionUserCompensations(lockedStreamer, cards, drawCost);
    if (isPostgres) {
      await grantPostgresCardCompensations(
        tx,
        channelId,
        lockedStreamer.name,
        drawCost,
        settlementKey,
        users
      );
    } else {
      for (const compensation of users) {
        if (compensation.free_draw_tickets > 0) {
          await tx.run(
            'UPDATE users SET bonus_free_draw_tickets = COALESCE(bonus_free_draw_tickets, 0) + ? WHERE id = ?',
            compensation.free_draw_tickets,
            compensation.user_id
          );
          await recordMysqlAssetEvent(tx, {
            eventKey: `${settlementKey}:ticket:${compensation.user_id}`,
            userId: compensation.user_id,
            assetType: 'ticket',
            action: 'add',
            quantity: compensation.free_draw_tickets,
            sourceType: 'card_delete_refund',
            sourceId: channelId,
            reason: 'card_delete_free_draw_ticket_refund',
            description: '카드 삭제 보상 추가 무료 소환 티켓 지급',
            channelId,
            metadata: {
              channel_id: channelId,
              streamer_name: lockedStreamer.name,
              deleted_count: compensation.deleted_count,
              ticket_compensated_cards: compensation.ticket_compensated_cards,
              settlement_key: settlementKey
            }
          });
        }
        if (compensation.point_refund > 0) {
          await tx.run('UPDATE users SET point = point + ? WHERE id = ?', compensation.point_refund, compensation.user_id);
          await recordMysqlPointLedger(tx, {
            userId: compensation.user_id,
            amount: compensation.point_refund,
            sourceType: 'card_delete_refund',
            sourceId: channelId,
            reason: 'card_delete_refund',
            description: '카드 삭제 보상 포인트 환불',
            metadata: {
              channel_id: channelId,
              streamer_name: lockedStreamer.name,
              draw_cost: drawCost,
              deleted_count: compensation.deleted_count,
              high_value_cards: compensation.high_value_cards,
              ticket_compensated_cards: compensation.ticket_compensated_cards,
              settlement_key: settlementKey
            }
          });
        }
      }
    }

    if (isPostgres) {
      await recordPostgresCardDeleteEvents(tx, channelId, settlementKey);
    } else {
      await recordMysqlAssetEvents(tx, cardDeleteEvents(channelId, settlementKey, cards));
    }
    const removed = await tx.run('DELETE FROM user_cards WHERE channel_id = ?', channelId);
    if (options.preventReregistration) {
      await tx.run(`
        INSERT INTO streamer_registration_blocks (channel_id, reason, blocked_by, created_at)
        VALUES (?, ?, ?, UTC_TIMESTAMP())
        ON DUPLICATE KEY UPDATE reason = VALUES(reason), blocked_by = VALUES(blocked_by)
      `,
        channelId,
        options.blockReason || '[관리자 삭제] 카드 재등록 금지',
        options.blockedBy || null
      );
    }
    await tx.run('DELETE FROM streamers WHERE channel_id = ?', channelId);

    return {
      ...compensationTotals(drawCost, users, Number(removed.changes || cards.length)),
      already_settled: false,
      cancelled_trades: cancelledTrades.length,
      cancelled_listings: listings.length,
      refunded_market_bid_points: bidRefunds.reduce((sum, refund) => sum + refund.amount, 0),
      cancelled_trade_participant_ids: [...new Set(cancelledTrades.flatMap((trade) => [trade.sender_id, trade.receiver_id]))],
      market_bid_refunds: bidRefunds
    };
  });
};

const settleSqlite = (
  streamerSnapshot: Streamer,
  options: StreamerCardDeletionSettlementOptions
): StreamerCardDeletionSettlementResult => {
  const db = getSqliteDb();
  const transaction = db.transaction(() => {
    const drawCost = parseDrawCost(
      (db.prepare("SELECT value FROM system_configs WHERE key = 'draw_cost'").get() as any)?.value
    );
    const touched = db.prepare('UPDATE streamers SET updated_at = updated_at WHERE channel_id = ?')
      .run(streamerSnapshot.channel_id);
    if (touched.changes !== 1) return emptySettlement(drawCost);
    const lockedStreamer = db.prepare('SELECT channel_id, name, base_value, lifecycle_id FROM streamers WHERE channel_id = ?')
      .get(streamerSnapshot.channel_id) as Pick<Streamer, 'channel_id' | 'name' | 'base_value' | 'lifecycle_id'> | undefined;
    if (!lockedStreamer) return emptySettlement(drawCost);
    if (
      streamerSnapshot.lifecycle_id
      && lockedStreamer.lifecycle_id
      && streamerSnapshot.lifecycle_id !== lockedStreamer.lifecycle_id
    ) {
      throw new Error('STREAMER_LIFECYCLE_CHANGED');
    }
    const channelId = lockedStreamer.channel_id;

    const listings = db.prepare(`
      SELECT ml.id, ml.seller_id, ml.buyer_id, ml.current_bidder_id, ml.user_card_id,
             uc.channel_id, uc.serial_number, COALESCE(uc.star, 0) AS star,
             ml.price, ml.status, ml.listing_type, ml.current_bid, COALESCE(ml.bid_reserved, 0) AS bid_reserved,
             COALESCE(ml.fee, 0) AS fee, COALESCE(ml.settled_amount, 0) AS settled_amount,
             ml.created_at, ml.updated_at
        FROM market_listings ml
        JOIN user_cards uc ON uc.id = ml.user_card_id
       WHERE uc.channel_id = ? AND ml.status = 'PENDING'
       ORDER BY ml.id
    `).all(channelId) as MarketListingRow[];
    const activeTrades = db.prepare(
      "SELECT id, sender_id, receiver_id, sender_offer, receiver_offer, status FROM trades WHERE status IN ('PENDING','CONFIRMED') ORDER BY id"
    ).all() as TradeRow[];
    const cancelledTrades = activeTrades.filter((trade) => tradeReferencesChannel(trade, channelId));
    if (cancelledTrades.length > 0) {
      const ids = cancelledTrades.map((trade) => Number(trade.id));
      db.prepare(`
        UPDATE trades
           SET status = 'CANCELLED', completed_at = COALESCE(completed_at, datetime('now'))
         WHERE id IN (${placeholdersFor(ids)}) AND status IN ('PENDING','CONFIRMED')
      `).run(...ids);
    }

    const cards = db.prepare(`
      SELECT id, user_id, channel_id, serial_number, COALESCE(star, 0) AS star,
             border_item_id, name_effect_item_id
        FROM user_cards
       WHERE channel_id = ?
       ORDER BY id
    `).all(channelId) as CardRow[];
    const firstCardId = cards.length > 0 ? Number(cards[0].id) : 0;
    const lastCardId = cards.length > 0 ? Number(cards[cards.length - 1].id) : 0;
    const settlementKey = `streamer-card-delete:${channelId}:${lockedStreamer.lifecycle_id || `cards:${firstCardId}-${lastCardId}`}`;
    const bidRefunds = collectLatestSqliteBidRefunds(db, listings);

    for (const listing of listings) {
      db.prepare(`
        INSERT OR IGNORE INTO market_transaction_audit_logs
          (audit_key, listing_id, event_type, related_user_id, seller_id, buyer_id, current_bidder_id,
           user_card_id, channel_id, serial_number, star, price, status, listing_type, current_bid,
           bid_reserved, fee, settled_amount, listing_created_at, listing_updated_at)
        VALUES (?, ?, 'streamer_card_deleted', NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'CANCELLED', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `streamer_card_deleted:${channelId}:${listing.id}`,
        listing.id,
        listing.seller_id,
        listing.buyer_id,
        listing.current_bidder_id,
        listing.user_card_id,
        channelId,
        listing.serial_number,
        listing.star,
        listing.price,
        listing.listing_type,
        listing.current_bid,
        listing.bid_reserved,
        listing.fee,
        listing.settled_amount,
        listing.created_at,
        listing.updated_at
      );
    }
    for (const refund of bidRefunds) {
      db.prepare('UPDATE users SET point = point + ? WHERE id = ?').run(refund.amount, refund.user_id);
      recordSqlitePointLedger(db, {
        userId: refund.user_id,
        counterpartyUserId: listings.find((listing) => Number(listing.id) === refund.listing_id)?.seller_id || null,
        amount: refund.amount,
        sourceType: 'market_bid_refund',
        sourceId: refund.listing_id,
        reason: 'streamer_card_deleted_refund',
        description: `카드 삭제로 경매 #${refund.listing_id} 입찰 예약금 환불`,
        metadata: { channel_id: channelId, listing_id: refund.listing_id, settlement_key: settlementKey }
      });
    }
    if (listings.length > 0) {
      const ids = listings.map((listing) => Number(listing.id));
      db.prepare(`
        UPDATE market_listings
           SET status = 'CANCELLED', current_bidder_id = NULL,
               bid_reserved = 0, updated_at = datetime('now')
         WHERE id IN (${placeholdersFor(ids)}) AND status = 'PENDING'
      `).run(...ids);
    }

    const users = calculateCardDeletionUserCompensations(lockedStreamer, cards, drawCost);
    for (const compensation of users) {
      if (compensation.free_draw_tickets > 0) {
        db.prepare(
          'UPDATE users SET bonus_free_draw_tickets = COALESCE(bonus_free_draw_tickets, 0) + ? WHERE id = ?'
        ).run(compensation.free_draw_tickets, compensation.user_id);
        recordSqliteAssetEvent(db, {
          eventKey: `${settlementKey}:ticket:${compensation.user_id}`,
          userId: compensation.user_id,
          assetType: 'ticket',
          action: 'add',
          quantity: compensation.free_draw_tickets,
          sourceType: 'card_delete_refund',
          sourceId: channelId,
          reason: 'card_delete_free_draw_ticket_refund',
          description: '카드 삭제 보상 추가 무료 소환 티켓 지급',
          channelId,
          metadata: {
            channel_id: channelId,
            streamer_name: lockedStreamer.name,
            deleted_count: compensation.deleted_count,
            ticket_compensated_cards: compensation.ticket_compensated_cards,
            settlement_key: settlementKey
          }
        });
      }
      if (compensation.point_refund > 0) {
        db.prepare('UPDATE users SET point = point + ? WHERE id = ?')
          .run(compensation.point_refund, compensation.user_id);
        recordSqlitePointLedger(db, {
          userId: compensation.user_id,
          amount: compensation.point_refund,
          sourceType: 'card_delete_refund',
          sourceId: channelId,
          reason: 'card_delete_refund',
          description: '카드 삭제 보상 포인트 환불',
          metadata: {
            channel_id: channelId,
            streamer_name: lockedStreamer.name,
            draw_cost: drawCost,
            deleted_count: compensation.deleted_count,
            high_value_cards: compensation.high_value_cards,
            ticket_compensated_cards: compensation.ticket_compensated_cards,
            settlement_key: settlementKey
          }
        });
      }
    }

    recordSqliteAssetEvents(db, cardDeleteEvents(channelId, settlementKey, cards));
    const removed = db.prepare('DELETE FROM user_cards WHERE channel_id = ?').run(channelId);
    if (options.preventReregistration) {
      db.prepare(`
        INSERT INTO streamer_registration_blocks (channel_id, reason, blocked_by, created_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(channel_id) DO UPDATE SET reason = excluded.reason, blocked_by = excluded.blocked_by
      `).run(
        channelId,
        options.blockReason || '[관리자 삭제] 카드 재등록 금지',
        options.blockedBy || null
      );
    }
    db.prepare('DELETE FROM streamers WHERE channel_id = ?').run(channelId);

    return {
      ...compensationTotals(drawCost, users, Number(removed.changes || cards.length)),
      already_settled: false,
      cancelled_trades: cancelledTrades.length,
      cancelled_listings: listings.length,
      refunded_market_bid_points: bidRefunds.reduce((sum, refund) => sum + refund.amount, 0),
      cancelled_trade_participant_ids: [...new Set(cancelledTrades.flatMap((trade) => [trade.sender_id, trade.receiver_id]))],
      market_bid_refunds: bidRefunds
    };
  });
  return transaction();
};

export const settleStreamerCardDeletion = async (
  streamer: Streamer,
  options: StreamerCardDeletionSettlementOptions = {}
): Promise<StreamerCardDeletionSettlementResult> => {
  if (!streamer?.channel_id) throw new Error('STREAMER_CHANNEL_ID_REQUIRED');
  if (getDbMode() === 'MYSQL') return settleMysql(streamer, options);
  if (getDbMode() === 'LOCAL_SQL') return settleSqlite(streamer, options);
  throw new Error('ATOMIC_STREAMER_CARD_DELETION_REQUIRES_DIRECT_SQL');
};
