import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { __setSqliteDbForTest } from '../services/db';
import {
  initRepositories,
  marketRepository,
  minigameRepository,
  notificationRepository,
  reportRepository,
  streamerRepository,
  titleRepository,
  userCardRepository,
  userRepository
} from '../repositories';
import { buyItem, createItem, getAllItems, getUserPurchases } from '../services/shopService';

/**
 * 실제 in-memory SQLite( better-sqlite3 )에 init-db.sql 스키마를 적재하여
 * 리포지토리·서비스 로직을 모킹 없이 통합 검증합니다.
 */
const loadSchema = (db: Database.Database) => {
  const sqlPath = path.join(__dirname, '../../../init-db.sql');
  db.exec(fs.readFileSync(sqlPath, 'utf8'));
};

const seedUser = (db: Database.Database, id: string, point = 0) => {
  db.prepare("INSERT INTO users (id, username, avatar_url, role, point) VALUES (?, ?, ?, 'USER', ?)")
    .run(id, `user_${id}`, null, point);
};

const seedStreamer = (db: Database.Database, channelId: string, name: string) => {
  db.prepare("INSERT INTO streamers (channel_id, name, logo_url, follower_count, activity_score, base_value, is_active) VALUES (?, ?, ?, 1000, 0, 1000, 0)")
    .run(channelId, name, 'https://example.com/logo.png');
};

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  loadSchema(db);
  __setSqliteDbForTest(db);
  initRepositories();
});

describe('ReportRepository (신고 중복 방지 / 배치 조회)', () => {
  it('hasPendingReport는 동일 신고자·스트리머·별 조합의 pending 신고를 감지한다', async () => {
    seedUser(db, 'reporter1');
    seedStreamer(db, 'ch1', '스트리머1');

    expect(await reportRepository.hasPendingReport('reporter1', 'ch1', 2)).toBe(false);

    await reportRepository.create({
      reporter_id: 'reporter1', channel_id: 'ch1', reported_image_url: 'http://img/a.png',
      star: 2, reason: '부적절', status: 'pending'
    });

    // 같은 별(2성) → 중복 감지
    expect(await reportRepository.hasPendingReport('reporter1', 'ch1', 2)).toBe(true);
    // 다른 별(3성) → 중복 아님
    expect(await reportRepository.hasPendingReport('reporter1', 'ch1', 3)).toBe(false);
    // 다른 신고자 → 중복 아님
    expect(await reportRepository.hasPendingReport('reporter2', 'ch1', 2)).toBe(false);
  });

  it('resolved 처리된 신고는 중복으로 보지 않는다(재신고 허용)', async () => {
    seedUser(db, 'reporter1');
    seedStreamer(db, 'ch1', '스트리머1');
    const r = await reportRepository.create({
      reporter_id: 'reporter1', channel_id: 'ch1', reported_image_url: 'http://img/a.png',
      star: 0, reason: '부적절', status: 'pending'
    });
    await reportRepository.updateStatus(r.id as number, 'resolved');
    expect(await reportRepository.hasPendingReport('reporter1', 'ch1', 0)).toBe(false);
  });
});

describe('findByIds 배치 조회', () => {
  it('userRepository.findByIds는 ID 배열로 사용자들을 한 번에 반환한다', async () => {
    seedUser(db, 'u1');
    seedUser(db, 'u2');
    seedUser(db, 'u3');
    const users = await userRepository.findByIds(['u1', 'u3', 'unknown']);
    expect(users.map((u) => u.id).sort()).toEqual(['u1', 'u3']);
    expect(await userRepository.findByIds([])).toEqual([]);
  });

  it('streamerRepository.findByIds는 channel_id 배열로 스트리머들을 한 번에 반환한다', async () => {
    seedStreamer(db, 'c1', 'A');
    seedStreamer(db, 'c2', 'B');
    const streamers = await streamerRepository.findByIds(['c2', 'c1']);
    expect(streamers.map((s) => s.channel_id).sort()).toEqual(['c1', 'c2']);
  });
});

describe('StreamerRepository registration blocks', () => {
  it('blocks a deleted streamer channel from being registered again', async () => {
    seedUser(db, 'admin-user');
    expect(await streamerRepository.isRegistrationBlocked('blocked-channel')).toBe(false);

    await streamerRepository.blockRegistration(
      'blocked-channel',
      '[본인 카드 삭제 요청] 권리자 요청에 따라 카드 재등록 금지',
      'admin-user'
    );

    expect(await streamerRepository.isRegistrationBlocked('blocked-channel')).toBe(true);
  });
});

describe('TitleRepository descriptions', () => {
  it('칭호 설명을 생성, 수정, 수여 조회까지 보존한다', async () => {
    seedUser(db, 'title-user');

    const created = await titleRepository.create({
      name: '친절한 안내자',
      description: '튜토리얼을 끝까지 도와준 유저에게 지급됩니다.',
      css: 'color: #2563eb;',
      icon_name: 'Award',
      icon_color: '#60a5fa'
    });

    expect(created.description).toBe('튜토리얼을 끝까지 도와준 유저에게 지급됩니다.');

    const updated = await titleRepository.update(created.id, {
      description: '처음 방문한 유저를 따뜻하게 도와준 칭호입니다.'
    });
    expect(updated?.description).toBe('처음 방문한 유저를 따뜻하게 도와준 칭호입니다.');

    await titleRepository.award('title-user', created.id);
    const owned = await titleRepository.findByUserId('title-user');
    expect(owned[0]).toMatchObject({
      id: created.id,
      description: '처음 방문한 유저를 따뜻하게 도와준 칭호입니다.'
    });
  });
});

describe('MinigameRepository practice mode', () => {
  it('creates a practice session without deducting tickets even when the balance is zero', async () => {
    seedUser(db, 'practice-user');
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO user_minigame_tickets
        (user_id, current_tickets, bonus_tickets, last_charged_at, updated_at)
      VALUES (?, 0, 0, ?, ?)
    `).run('practice-user', now, now);

    const result = await minigameRepository.startSession({
      id: 'practice-session',
      user_id: 'practice-user',
      game_type: 'puzzle',
      status: 'STARTED',
      target_data: JSON.stringify({ practice_mode: true })
    });

    expect(result).toEqual({ ok: true });
    expect(db.prepare(`
      SELECT current_tickets, bonus_tickets
      FROM user_minigame_tickets
      WHERE user_id = ?
    `).get('practice-user')).toEqual({
      current_tickets: 0,
      bonus_tickets: 0
    });
    expect(db.prepare('SELECT game_type, status FROM minigame_sessions WHERE id = ?').get('practice-session')).toEqual({
      game_type: 'puzzle',
      status: 'STARTED'
    });
  });

  it('spends charged base tickets before bonus tickets for normal sessions', async () => {
    seedUser(db, 'ticket-priority-user');
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO user_minigame_tickets
        (user_id, current_tickets, bonus_tickets, last_charged_at, updated_at)
      VALUES (?, 2, 3, ?, ?)
    `).run('ticket-priority-user', now, now);

    const result = await minigameRepository.startSession({
      id: 'ticket-priority-session',
      user_id: 'ticket-priority-user',
      game_type: 'quiz',
      status: 'STARTED',
      target_data: JSON.stringify({ practice_mode: false })
    });

    expect(result).toEqual({ ok: true });
    expect(db.prepare(`
      SELECT current_tickets, bonus_tickets
      FROM user_minigame_tickets
      WHERE user_id = ?
    `).get('ticket-priority-user')).toEqual({
      current_tickets: 1,
      bonus_tickets: 3
    });
    expect(db.prepare('SELECT ticket_spent_type FROM minigame_sessions WHERE id = ?').get('ticket-priority-session')).toEqual({
      ticket_spent_type: 'BASE'
    });
  });
});

describe('MinigameRepository stale started session recovery', () => {
  it('expires old paid sessions and refunds the consumed base ticket', async () => {
    seedUser(db, 'refund-base');
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO user_minigame_tickets
        (user_id, current_tickets, bonus_tickets, last_charged_at, updated_at)
      VALUES (?, 4, 0, ?, ?)
    `).run('refund-base', now, now);
    db.prepare(`
      INSERT INTO minigame_sessions
        (id, user_id, game_type, status, target_data, ticket_spent_type, created_at)
      VALUES ('expired-base-session', 'refund-base', 'quiz', 'STARTED', ?, 'BASE', datetime('now', '-11 minutes'))
    `).run(JSON.stringify({ practice_mode: false }));

    await minigameRepository.expireSessions(10);

    expect(db.prepare(`
      SELECT current_tickets, bonus_tickets
      FROM user_minigame_tickets
      WHERE user_id = ?
    `).get('refund-base')).toEqual({
      current_tickets: 5,
      bonus_tickets: 0
    });
    expect(db.prepare('SELECT status FROM minigame_sessions WHERE id = ?').get('expired-base-session')).toEqual({
      status: 'EXPIRED'
    });
  });

  it('returns an active paid session so reconnects do not spend another ticket', async () => {
    seedUser(db, 'resume-user');
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO user_minigame_tickets
        (user_id, current_tickets, bonus_tickets, last_charged_at, updated_at)
      VALUES (?, 4, 0, ?, ?)
    `).run('resume-user', now, now);
    db.prepare(`
      INSERT INTO minigame_sessions
        (id, user_id, game_type, status, target_data, ticket_spent_type, created_at)
      VALUES ('resume-session', 'resume-user', 'puzzle', 'STARTED', ?, 'BASE', datetime('now'))
    `).run(JSON.stringify({ practice_mode: false, image_url: 'https://example.com/card.png' }));

    const active = await minigameRepository.findActiveStartedSession('resume-user', 'puzzle');

    expect(active).toEqual(expect.objectContaining({
      id: 'resume-session',
      ticket_spent_type: 'BASE',
      status: 'STARTED'
    }));
  });
});

describe('UserCardRepository 별 등급 분리', () => {
  it('시스템 판매는 요청한 별 등급의 카드만 삭제하고 해당 배율로 지급한다', async () => {
    seedUser(db, 'seller');
    seedStreamer(db, 'card-channel', '카드 스트리머');
    db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES ('seller', 'card-channel', 1, 0),
             ('seller', 'card-channel', 2, 2)
    `).run();

    const gained = await userCardRepository.sellCardsAtomic('seller', [{
      channelId: 'card-channel',
      star: 2,
      count: 1,
      baseValue: 1000
    }]);

    expect(gained).toBe(2600);
    expect(db.prepare(
      'SELECT serial_number, star FROM user_cards WHERE user_id = ? ORDER BY serial_number'
    ).all('seller')).toEqual([{ serial_number: 1, star: 0 }]);
    expect((await userRepository.findById('seller'))?.point).toBe(2600);
  });

  it('한계돌파는 대상과 같은 별 카드가 아니라 0성 카드만 재료로 소모한다', async () => {
    seedUser(db, 'fuser');
    seedStreamer(db, 'fuse-channel', '한계돌파 스트리머');
    db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES ('fuser', 'fuse-channel', 1, 3),
             ('fuser', 'fuse-channel', 2, 3),
             ('fuser', 'fuse-channel', 3, 0)
    `).run();

    expect(await userCardRepository.fuse('fuser', 'fuse-channel', 3)).toEqual({
      ok: true,
      reason: 'OK',
      newStar: 4
    });
    expect(db.prepare(
      'SELECT serial_number, star FROM user_cards WHERE user_id = ? ORDER BY serial_number'
    ).all('fuser')).toEqual([
      { serial_number: 1, star: 4 },
      { serial_number: 2, star: 3 }
    ]);
  });
});

describe('MarketRepository 재등록 제약', () => {
  it('취소된 매물 이력이 있어도 같은 카드를 다시 등록할 수 있다', async () => {
    seedUser(db, 'market-seller');
    seedStreamer(db, 'market-channel', '마켓 스트리머');
    const cardId = Number(db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES ('market-seller', 'market-channel', 1, 0)
    `).run().lastInsertRowid);

    const first = await marketRepository.create({
      seller_id: 'market-seller',
      user_card_id: cardId,
      price: 1000
    });
    await marketRepository.updateStatus(first.id as number, 'CANCELLED');

    const second = await marketRepository.create({
      seller_id: 'market-seller',
      user_card_id: cardId,
      price: 1200
    });

    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('PENDING');
    expect(db.prepare(`
      SELECT COUNT(*) AS c
        FROM market_listings
       WHERE user_card_id = ? AND status = 'PENDING'
    `).get(cardId)).toEqual({ c: 1 });
  });

  it('마켓에서 구매한 카드도 구매자가 다시 판매 등록할 수 있다', async () => {
    seedUser(db, 'old-seller');
    seedUser(db, 'new-buyer', 10000);
    seedStreamer(db, 'sold-channel', '구매 카드 스트리머');
    const cardId = Number(db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES ('old-seller', 'sold-channel', 1, 1)
    `).run().lastInsertRowid);

    const first = await marketRepository.create({
      seller_id: 'old-seller',
      user_card_id: cardId,
      price: 1000
    });
    expect(await marketRepository.buyAtomic(first.id as number, 'new-buyer')).toMatchObject({
      ok: true,
      reason: 'OK'
    });

    const relisted = await marketRepository.create({
      seller_id: 'new-buyer',
      user_card_id: cardId,
      price: 1500
    });

    expect(relisted.status).toBe('PENDING');
    expect(relisted.seller_id).toBe('new-buyer');
    expect(db.prepare('SELECT user_id FROM user_cards WHERE id = ?').get(cardId)).toEqual({ user_id: 'new-buyer' });
  });

  it('경매 입찰금은 입찰 시 예약되고 낙찰 정산 때 이중 차감되지 않는다', async () => {
    seedUser(db, 'auction-seller');
    seedUser(db, 'auction-bidder-a', 5000);
    seedUser(db, 'auction-bidder-b', 7000);
    seedStreamer(db, 'auction-channel', '경매 스트리머');
    const cardId = Number(db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES ('auction-seller', 'auction-channel', 1, 0)
    `).run().lastInsertRowid);

    const listing = await marketRepository.create({
      seller_id: 'auction-seller',
      user_card_id: cardId,
      price: 1000,
      listing_type: 'auction',
      starting_bid: 1000,
      auction_ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      fee_rate: 5
    });

    expect(await marketRepository.placeBid(listing.id as number, 'auction-bidder-a', 1500)).toMatchObject({
      ok: true,
      reason: 'OK'
    });
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('auction-bidder-a')).toEqual({ point: 3500 });
    expect(db.prepare('SELECT current_bidder_id, current_bid, bid_reserved FROM market_listings WHERE id = ?').get(listing.id)).toEqual({
      current_bidder_id: 'auction-bidder-a',
      current_bid: 1500,
      bid_reserved: 1500
    });

    expect(await marketRepository.placeBid(listing.id as number, 'auction-bidder-b', 2000)).toMatchObject({
      ok: true,
      reason: 'OK',
      previous_bidder_id: 'auction-bidder-a'
    });
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('auction-bidder-a')).toEqual({ point: 5000 });
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('auction-bidder-b')).toEqual({ point: 5000 });
    expect(db.prepare('SELECT current_bidder_id, current_bid, bid_reserved FROM market_listings WHERE id = ?').get(listing.id)).toEqual({
      current_bidder_id: 'auction-bidder-b',
      current_bid: 2000,
      bid_reserved: 2000
    });

    db.prepare("UPDATE market_listings SET auction_ends_at = datetime('now', '-1 minute') WHERE id = ?").run(listing.id);
    const soldListings = await marketRepository.finishExpiredAuctions(new Date().toISOString());

    expect(soldListings).toHaveLength(1);
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('auction-bidder-b')).toEqual({ point: 5000 });
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('auction-seller')).toEqual({ point: 1900 });
    expect(db.prepare('SELECT status, buyer_id, price, fee, bid_reserved, settled_amount FROM market_listings WHERE id = ?').get(listing.id)).toEqual({
      status: 'SOLD',
      buyer_id: 'auction-bidder-b',
      price: 2000,
      fee: 100,
      bid_reserved: 0,
      settled_amount: 1900
    });
    expect(db.prepare('SELECT user_id FROM user_cards WHERE id = ?').get(cardId)).toEqual({ user_id: 'auction-bidder-b' });
  });

  it('완료/취소된 내 등록 매물은 화면에서만 숨기고 DB 기록은 유지한다', async () => {
    seedUser(db, 'hide-seller');
    seedUser(db, 'hide-buyer', 10000);
    seedStreamer(db, 'hide-channel', '숨김 스트리머');
    const cardId = Number(db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES ('hide-seller', 'hide-channel', 1, 0)
    `).run().lastInsertRowid);

    const listing = await marketRepository.create({
      seller_id: 'hide-seller',
      user_card_id: cardId,
      price: 1000
    });
    expect(await marketRepository.buyAtomic(listing.id as number, 'hide-buyer')).toMatchObject({ ok: true });

    expect(await marketRepository.hideForSeller(listing.id as number, 'hide-seller')).toBe(true);
    expect(await marketRepository.listByUser('hide-seller')).toEqual([]);
    expect(db.prepare('SELECT status, seller_hidden_at FROM market_listings WHERE id = ?').get(listing.id)).toEqual({
      status: 'SOLD',
      seller_hidden_at: expect.any(String)
    });
  });
});

describe('NotificationRepository hidden read notifications', () => {
  it('읽은 알림은 알림함에서만 숨기고 DB 기록은 유지한다', async () => {
    seedUser(db, 'notification-user');
    const notification = await notificationRepository.create({
      user_id: 'notification-user',
      title: '알림',
      body: '본문',
      link: 'inventory'
    });

    expect(await notificationRepository.hideRead(notification.id as number, 'notification-user')).toBe(false);
    await notificationRepository.markRead(notification.id as number, 'notification-user');
    expect(await notificationRepository.hideRead(notification.id as number, 'notification-user')).toBe(true);

    expect(await notificationRepository.findByUser('notification-user', 50)).toEqual([]);
    expect(await notificationRepository.countUnread('notification-user')).toBe(0);
    expect(db.prepare('SELECT title, deleted_at FROM notifications WHERE id = ?').get(notification.id)).toEqual({
      title: '알림',
      deleted_at: expect.any(String)
    });
  });
});

describe('shopService 1인 구매 제한', () => {
  it('purchase_limit를 넘는 구매는 LIMIT_REACHED로 거부된다', async () => {
    seedUser(db, 'buyer', 100000);
    await createItem({
      type: 'border', name: '한정 테두리', description: null, price: 1000,
      style_json: null, font_url: null, font_family: null, purchase_limit: 1
    });
    const items = await getAllItems();
    const itemId = items[0].id;

    const first = await buyItem('buyer', itemId);
    expect(first.ok).toBe(true);

    const second = await buyItem('buyer', itemId);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('LIMIT_REACHED');

    // 구매 횟수는 1로 집계
    const purchases = await getUserPurchases('buyer');
    expect(purchases[itemId]).toBe(1);
  });

  it('purchase_limit=0(무제한)은 반복 구매가 가능하다', async () => {
    seedUser(db, 'buyer', 100000);
    await createItem({
      type: 'name_effect', name: '무제한 효과', description: null, price: 100,
      style_json: null, font_url: null, font_family: null, purchase_limit: 0
    });
    const itemId = (await getAllItems())[0].id;
    expect((await buyItem('buyer', itemId)).ok).toBe(true);
    expect((await buyItem('buyer', itemId)).ok).toBe(true);
  });

  it('포인트가 부족하면 INSUFFICIENT_POINT로 거부된다', async () => {
    seedUser(db, 'poor', 50);
    await createItem({
      type: 'border', name: '비싼 테두리', description: null, price: 1000,
      style_json: null, font_url: null, font_family: null, purchase_limit: 0
    });
    const itemId = (await getAllItems())[0].id;
    const res = await buyItem('poor', itemId);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('INSUFFICIENT_POINT');
  });
});
