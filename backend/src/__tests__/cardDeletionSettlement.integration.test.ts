import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { __setSqliteDbForTest } from '../services/db';
import {
  initRepositories,
  marketRepository,
  streamerRepository,
  tradeRepository
} from '../repositories';
import { settleStreamerCardDeletion } from '../services/cardDeletionSettlement';

const loadSchema = (db: Database.Database) => {
  const sqlPath = path.join(__dirname, '../../../init-db.sql');
  db.exec(fs.readFileSync(sqlPath, 'utf8'));
};

const seedUser = (db: Database.Database, id: string, point = 0) => {
  db.prepare("INSERT INTO users (id, username, avatar_url, role, point) VALUES (?, ?, NULL, 'USER', ?)")
    .run(id, `user_${id}`, point);
};

const seedStreamer = (
  db: Database.Database,
  channelId: string,
  name: string,
  baseValue = 20_000
) => {
  db.prepare(`
    INSERT INTO streamers
      (channel_id, name, logo_url, follower_count, activity_score, base_value, is_active)
    VALUES (?, ?, 'https://example.com/logo.png', 1000, 0, ?, 0)
  `).run(channelId, name, baseValue);
};

const seedCard = (
  db: Database.Database,
  userId: string,
  channelId: string,
  serialNumber: number,
  options: { star?: number; locked?: boolean } = {}
): number => {
  const result = db.prepare(`
    INSERT INTO user_cards (user_id, channel_id, serial_number, star, is_locked)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    userId,
    channelId,
    serialNumber,
    options.star ?? 0,
    options.locked ? 1 : 0
  );
  return Number(result.lastInsertRowid);
};

const emptyOffer = () => ({ cards: [], point: 0 });
const cardOffer = (channelId: string, star = 0, count = 1) => ({
  cards: [{ channel_id: channelId, star, count }],
  point: 0
});

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  loadSchema(db);
  __setSqliteDbForTest(db);
  initRepositories();
  db.prepare("UPDATE system_configs SET value = '10000' WHERE key = 'draw_cost'").run();
});

afterEach(() => {
  __setSqliteDbForTest(null);
  db.close();
});

describe('settleStreamerCardDeletion (SQLite integration)', () => {
  it('대상 카드가 포함된 PENDING/CONFIRMED 교환만 모두 취소한다', async () => {
    seedUser(db, 'sender');
    seedUser(db, 'receiver');
    seedStreamer(db, 'deleted-channel', '삭제 대상');
    seedStreamer(db, 'other-channel', '유지 대상');
    seedCard(db, 'sender', 'deleted-channel', 1);
    seedCard(db, 'receiver', 'deleted-channel', 2);
    seedCard(db, 'sender', 'other-channel', 1);

    const pending = await tradeRepository.create({
      sender_id: 'sender',
      receiver_id: 'receiver',
      sender_offer: cardOffer('deleted-channel'),
      receiver_offer: emptyOffer()
    });
    const confirmed = await tradeRepository.create({
      sender_id: 'sender',
      receiver_id: 'receiver',
      sender_offer: emptyOffer(),
      receiver_offer: cardOffer('deleted-channel')
    });
    expect(await tradeRepository.confirm(confirmed.id!, 'receiver')).toEqual({ ok: true, reason: 'OK' });
    const unrelated = await tradeRepository.create({
      sender_id: 'sender',
      receiver_id: 'receiver',
      sender_offer: cardOffer('other-channel'),
      receiver_offer: emptyOffer()
    });

    const streamer = await streamerRepository.findById('deleted-channel');
    const result = await settleStreamerCardDeletion(streamer!);

    expect(result.cancelled_trades).toBe(2);
    expect((await tradeRepository.findById(pending.id!))?.status).toBe('CANCELLED');
    expect((await tradeRepository.findById(confirmed.id!))?.status).toBe('CANCELLED');
    expect((await tradeRepository.findById(unrelated.id!))?.status).toBe('PENDING');
  });

  it('고정가 매물을 취소하고 잠긴 카드의 DB 현재 소유주에게 보상한다', async () => {
    seedUser(db, 'current-owner', 100);
    seedUser(db, 'listing-owner', 200);
    seedUser(db, 'unrelated-owner', 300);
    seedStreamer(db, 'deleted-channel', '삭제 대상');
    seedStreamer(db, 'other-channel', '유지 대상');

    seedCard(db, 'current-owner', 'deleted-channel', 1, { locked: true });
    const deletedListingCardId = seedCard(db, 'listing-owner', 'deleted-channel', 2);
    const unrelatedCardId = seedCard(db, 'unrelated-owner', 'other-channel', 1);
    const deletedListing = await marketRepository.create({
      seller_id: 'listing-owner',
      user_card_id: deletedListingCardId,
      price: 1000,
      listing_type: 'fixed'
    });
    const unrelatedListing = await marketRepository.create({
      seller_id: 'unrelated-owner',
      user_card_id: unrelatedCardId,
      price: 1200,
      listing_type: 'fixed'
    });

    const streamer = await streamerRepository.findById('deleted-channel');
    const result = await settleStreamerCardDeletion(streamer!);

    expect(result).toMatchObject({
      cards_removed: 2,
      cancelled_listings: 1,
      affected_users: 2,
      total_point_refunded: 40_000
    });
    expect(result.users).toEqual(expect.arrayContaining([
      expect.objectContaining({ user_id: 'current-owner', deleted_count: 1, point_refund: 20_000 }),
      expect.objectContaining({ user_id: 'listing-owner', deleted_count: 1, point_refund: 20_000 })
    ]));
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('current-owner')).toEqual({ point: 20_100 });
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('listing-owner')).toEqual({ point: 20_200 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM user_cards WHERE channel_id = 'deleted-channel'").get())
      .toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM market_listings WHERE id = ? AND status = 'PENDING'").get(deletedListing.id))
      .toEqual({ count: 0 });
    expect(db.prepare("SELECT status FROM market_listings WHERE id = ?").get(unrelatedListing.id))
      .toEqual({ status: 'PENDING' });
  });

  it('스트리머 스냅샷 이후 카드 소유권이 바뀌어도 정산 시점의 현재 소유주만 보상한다', async () => {
    seedUser(db, 'original-owner', 100);
    seedUser(db, 'current-owner', 200);
    seedStreamer(db, 'ownership-channel', '소유권 변경 대상');
    const cardId = seedCard(db, 'original-owner', 'ownership-channel', 1);
    const staleStreamerSnapshot = await streamerRepository.findById('ownership-channel');

    db.prepare('UPDATE user_cards SET user_id = ? WHERE id = ?').run('current-owner', cardId);
    const result = await settleStreamerCardDeletion(staleStreamerSnapshot!);

    expect(result.users).toEqual([
      expect.objectContaining({
        user_id: 'current-owner',
        deleted_count: 1,
        point_refund: 20_000
      })
    ]);
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('original-owner')).toEqual({ point: 100 });
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('current-owner')).toEqual({ point: 20_200 });
  });

  it('경매를 취소할 때 각 입찰자의 최신 예약 입찰금을 전액 환불한다', async () => {
    seedUser(db, 'seller', 0);
    seedUser(db, 'bidder-a', 10_000);
    seedUser(db, 'bidder-b', 10_000);
    seedStreamer(db, 'deleted-channel', '삭제 대상');
    const cardId = seedCard(db, 'seller', 'deleted-channel', 1);
    const listing = await marketRepository.create({
      seller_id: 'seller',
      user_card_id: cardId,
      price: 1000,
      listing_type: 'auction',
      starting_bid: 1000,
      auction_ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });

    expect(await marketRepository.placeBid(listing.id!, 'bidder-a', 1200)).toMatchObject({ ok: true });
    expect(await marketRepository.placeBid(listing.id!, 'bidder-a', 1800)).toMatchObject({ ok: true });
    expect(await marketRepository.placeBid(listing.id!, 'bidder-b', 2200)).toMatchObject({ ok: true });
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('bidder-a')).toEqual({ point: 8200 });
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('bidder-b')).toEqual({ point: 7800 });

    const streamer = await streamerRepository.findById('deleted-channel');
    const result = await settleStreamerCardDeletion(streamer!);

    expect(result.cancelled_listings).toBe(1);
    expect(result.refunded_market_bid_points).toBe(4000);
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('bidder-a')).toEqual({ point: 10_000 });
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('bidder-b')).toEqual({ point: 10_000 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM market_listings WHERE id = ? AND status = 'PENDING'").get(listing.id))
      .toEqual({ count: 0 });
  });

  it('같은 삭제 요청을 재시도해도 보상과 경매 환불을 중복 지급하지 않는다', async () => {
    seedUser(db, 'seller', 0);
    seedUser(db, 'bidder', 5000);
    seedStreamer(db, 'deleted-channel', '삭제 대상');
    const cardId = seedCard(db, 'seller', 'deleted-channel', 1);
    const listing = await marketRepository.create({
      seller_id: 'seller',
      user_card_id: cardId,
      price: 1000,
      listing_type: 'auction',
      starting_bid: 1000,
      auction_ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });
    expect(await marketRepository.placeBid(listing.id!, 'bidder', 1500)).toMatchObject({ ok: true });

    const staleStreamerSnapshot = await streamerRepository.findById('deleted-channel');
    const first = await settleStreamerCardDeletion(staleStreamerSnapshot!);
    const balancesAfterFirst = db.prepare('SELECT id, point FROM users ORDER BY id').all();
    const ledgerCountAfterFirst = db.prepare('SELECT COUNT(*) AS count FROM point_ledger_entries').get();
    const second = await settleStreamerCardDeletion(staleStreamerSnapshot!);

    expect(first).toMatchObject({
      already_settled: false,
      cards_removed: 1,
      cancelled_listings: 1,
      refunded_market_bid_points: 1500,
      total_point_refunded: 20_000
    });
    expect(second).toMatchObject({
      already_settled: true,
      cards_removed: 0,
      cancelled_trades: 0,
      cancelled_listings: 0,
      refunded_market_bid_points: 0,
      total_point_refunded: 0,
      total_free_draw_tickets_granted: 0
    });
    expect(db.prepare('SELECT id, point FROM users ORDER BY id').all()).toEqual(balancesAfterFirst);
    expect(db.prepare('SELECT COUNT(*) AS count FROM point_ledger_entries').get()).toEqual(ledgerCountAfterFirst);
  });

  it('이전 lifecycle 삭제 요청이 같은 채널의 재등록 카드와 새 소유주 잔액을 건드리지 않는다', async () => {
    seedUser(db, 'old-owner', 100);
    seedUser(db, 'new-owner', 200);
    seedStreamer(db, 'reused-channel', '첫 번째 lifecycle');
    seedCard(db, 'old-owner', 'reused-channel', 1);

    const oldLifecycleSnapshot = await streamerRepository.findById('reused-channel');
    expect(oldLifecycleSnapshot?.lifecycle_id).toBeTruthy();
    const first = await settleStreamerCardDeletion(oldLifecycleSnapshot!);
    expect(first).toMatchObject({
      already_settled: false,
      cards_removed: 1,
      total_point_refunded: 20_000
    });

    await streamerRepository.save({
      channel_id: 'reused-channel',
      name: '두 번째 lifecycle',
      logo_url: 'https://example.com/new-logo.png',
      custom_image_url: null,
      custom_images: [],
      is_image_banned: false,
      follower_count: 2000,
      activity_score: 0,
      base_value: 30_000,
      is_active: false,
      registered_by: 'new-owner'
    });
    const newCardId = seedCard(db, 'new-owner', 'reused-channel', 1);
    const newLifecycleSnapshot = await streamerRepository.findById('reused-channel');
    expect(newLifecycleSnapshot?.lifecycle_id).toBeTruthy();
    expect(newLifecycleSnapshot?.lifecycle_id).not.toBe(oldLifecycleSnapshot?.lifecycle_id);

    const stateBeforeStaleRetry = {
      owners: db.prepare('SELECT id, point, bonus_free_draw_tickets FROM users ORDER BY id').all(),
      ledgerCount: db.prepare('SELECT COUNT(*) AS count FROM point_ledger_entries').get(),
      assetEventCount: db.prepare('SELECT COUNT(*) AS count FROM asset_event_logs').get()
    };

    await expect(settleStreamerCardDeletion(oldLifecycleSnapshot!))
      .rejects.toThrow('STREAMER_LIFECYCLE_CHANGED');

    expect(db.prepare(`
      SELECT channel_id, name, lifecycle_id
        FROM streamers
       WHERE channel_id = 'reused-channel'
    `).get()).toEqual({
      channel_id: 'reused-channel',
      name: '두 번째 lifecycle',
      lifecycle_id: newLifecycleSnapshot?.lifecycle_id
    });
    expect(db.prepare(`
      SELECT id, user_id, channel_id, serial_number
        FROM user_cards
       WHERE id = ?
    `).get(newCardId)).toEqual({
      id: newCardId,
      user_id: 'new-owner',
      channel_id: 'reused-channel',
      serial_number: 1
    });
    expect(db.prepare('SELECT id, point, bonus_free_draw_tickets FROM users ORDER BY id').all())
      .toEqual(stateBeforeStaleRetry.owners);
    expect(db.prepare('SELECT COUNT(*) AS count FROM point_ledger_entries').get())
      .toEqual(stateBeforeStaleRetry.ledgerCount);
    expect(db.prepare('SELECT COUNT(*) AS count FROM asset_event_logs').get())
      .toEqual(stateBeforeStaleRetry.assetEventCount);
  });

  it('스트리머 삭제가 실패하면 교환 취소·매물 취소·입찰금 환불·보상을 전부 롤백한다', async () => {
    seedUser(db, 'seller', 500);
    seedUser(db, 'receiver', 700);
    seedUser(db, 'bidder', 5000);
    seedStreamer(db, 'rollback-channel', '롤백 대상');
    const cardId = seedCard(db, 'seller', 'rollback-channel', 1);
    const listing = await marketRepository.create({
      seller_id: 'seller',
      user_card_id: cardId,
      price: 1000,
      listing_type: 'auction',
      starting_bid: 1000,
      auction_ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });
    expect(await marketRepository.placeBid(listing.id!, 'bidder', 1500)).toMatchObject({ ok: true });
    const trade = await tradeRepository.create({
      sender_id: 'seller',
      receiver_id: 'receiver',
      sender_offer: cardOffer('rollback-channel'),
      receiver_offer: emptyOffer()
    });
    const streamer = await streamerRepository.findById('rollback-channel');

    const stateBefore = {
      trade: db.prepare('SELECT status, completed_at FROM trades WHERE id = ?').get(trade.id),
      listing: db.prepare(`
        SELECT status, current_bidder_id, bid_reserved
          FROM market_listings
         WHERE id = ?
      `).get(listing.id),
      users: db.prepare(`
        SELECT id, point, bonus_free_draw_tickets
          FROM users
         WHERE id IN ('seller', 'bidder')
         ORDER BY id
      `).all(),
      card: db.prepare('SELECT id, user_id, channel_id, serial_number, star FROM user_cards WHERE id = ?').get(cardId),
      bids: db.prepare('SELECT listing_id, bidder_id, amount FROM market_bids WHERE listing_id = ? ORDER BY id').all(listing.id),
      ledger: db.prepare('SELECT COUNT(*) AS count FROM point_ledger_entries').get(),
      assetEvents: db.prepare('SELECT COUNT(*) AS count FROM asset_event_logs').get()
    };

    db.exec(`
      CREATE TRIGGER abort_rollback_streamer_delete
      BEFORE DELETE ON streamers
      WHEN OLD.channel_id = 'rollback-channel'
      BEGIN
        SELECT RAISE(ABORT, 'forced streamer delete failure');
      END;
    `);

    await expect(settleStreamerCardDeletion(streamer!, {
      preventReregistration: true,
      blockReason: '롤백되어야 할 차단',
      blockedBy: 'seller'
    })).rejects.toThrow('forced streamer delete failure');

    expect(db.prepare('SELECT status, completed_at FROM trades WHERE id = ?').get(trade.id)).toEqual(stateBefore.trade);
    expect(db.prepare(`
      SELECT status, current_bidder_id, bid_reserved
        FROM market_listings
       WHERE id = ?
    `).get(listing.id)).toEqual(stateBefore.listing);
    expect(db.prepare(`
      SELECT id, point, bonus_free_draw_tickets
        FROM users
       WHERE id IN ('seller', 'bidder')
       ORDER BY id
    `).all()).toEqual(stateBefore.users);
    expect(db.prepare('SELECT id, user_id, channel_id, serial_number, star FROM user_cards WHERE id = ?').get(cardId))
      .toEqual(stateBefore.card);
    expect(db.prepare('SELECT listing_id, bidder_id, amount FROM market_bids WHERE listing_id = ? ORDER BY id').all(listing.id))
      .toEqual(stateBefore.bids);
    expect(db.prepare('SELECT COUNT(*) AS count FROM point_ledger_entries').get()).toEqual(stateBefore.ledger);
    expect(db.prepare('SELECT COUNT(*) AS count FROM asset_event_logs').get()).toEqual(stateBefore.assetEvents);
    expect(db.prepare("SELECT COUNT(*) AS count FROM market_transaction_audit_logs WHERE channel_id = 'rollback-channel'").get())
      .toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM streamer_registration_blocks WHERE channel_id = 'rollback-channel'").get())
      .toEqual({ count: 0 });
    expect(db.prepare("SELECT channel_id FROM streamers WHERE channel_id = 'rollback-channel'").get())
      .toEqual({ channel_id: 'rollback-channel' });
  });

  it('성공한 삭제는 재등록 차단과 삭제된 마켓 매물 감사 스냅샷을 보존한다', async () => {
    seedUser(db, 'seller', 0);
    seedUser(db, 'admin', 0);
    seedStreamer(db, 'blocked-channel', '차단 대상');
    const cardId = seedCard(db, 'seller', 'blocked-channel', 77, { star: 3 });
    const listing = await marketRepository.create({
      seller_id: 'seller',
      user_card_id: cardId,
      price: 4321,
      listing_type: 'fixed'
    });
    const streamer = await streamerRepository.findById('blocked-channel');

    const result = await settleStreamerCardDeletion(streamer!, {
      preventReregistration: true,
      blockReason: '권리자 요청',
      blockedBy: 'admin'
    });

    expect(result).toMatchObject({ already_settled: false, cards_removed: 1, cancelled_listings: 1 });
    expect(db.prepare(`
      SELECT channel_id, reason, blocked_by
        FROM streamer_registration_blocks
       WHERE channel_id = 'blocked-channel'
    `).get()).toEqual({
      channel_id: 'blocked-channel',
      reason: '권리자 요청',
      blocked_by: 'admin'
    });
    expect(db.prepare(`
      SELECT listing_id, event_type, seller_id, user_card_id, channel_id,
             serial_number, star, price, status, listing_type
        FROM market_transaction_audit_logs
       WHERE audit_key = ?
    `).get(`streamer_card_deleted:blocked-channel:${listing.id}`)).toEqual({
      listing_id: listing.id,
      event_type: 'streamer_card_deleted',
      seller_id: 'seller',
      user_card_id: cardId,
      channel_id: 'blocked-channel',
      serial_number: 77,
      star: 3,
      price: 4321,
      status: 'CANCELLED',
      listing_type: 'fixed'
    });
    expect(db.prepare('SELECT id FROM market_listings WHERE id = ?').get(listing.id)).toBeUndefined();
  });
});
