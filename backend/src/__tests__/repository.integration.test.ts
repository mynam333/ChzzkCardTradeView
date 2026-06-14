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
import { getUserProfile, getUserRankings } from '../controllers/playController';
import { buyItem, createItem, getAllItems, getUserPurchases } from '../services/shopService';
import { accountInteractionRestrictionMiddleware } from '../middlewares/accountInteractionRestriction';

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

const createJsonResponse = () => {
  const res: any = {
    statusCode: 0,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    set() {
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    }
  };
  return res;
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

describe('UserRepository searchByUsername', () => {
  it('닉네임을 정확히 입력하면 유사 닉네임을 제외하고 정확 일치 유저만 반환한다', async () => {
    db.prepare("INSERT INTO users (id, username, avatar_url, role, point) VALUES (?, ?, ?, 'USER', ?)")
      .run('search-exact', '치카포', null, 0);
    db.prepare("INSERT INTO users (id, username, avatar_url, role, point) VALUES (?, ?, ?, 'USER', ?)")
      .run('search-prefix', '치카포팬', null, 0);
    db.prepare("INSERT INTO users (id, username, avatar_url, role, point) VALUES (?, ?, ?, 'USER', ?)")
      .run('search-middle', '슈퍼치카포', null, 0);

    const users = await userRepository.searchByUsername('치카포', 12);

    expect(users.map((u) => u.id)).toEqual(['search-exact']);
  });

  it('정확 일치가 없으면 기존처럼 유사 검색을 반환한다', async () => {
    db.prepare("INSERT INTO users (id, username, avatar_url, role, point) VALUES (?, ?, ?, 'USER', ?)")
      .run('search-prefix', '치카포팬', null, 0);
    db.prepare("INSERT INTO users (id, username, avatar_url, role, point) VALUES (?, ?, ?, 'USER', ?)")
      .run('search-middle', '슈퍼치카포', null, 0);

    const users = await userRepository.searchByUsername('치카포', 12);

    expect(users.map((u) => u.id)).toEqual(['search-prefix', 'search-middle']);
  });
});

describe('UserRepository rankings', () => {
  it('활성 제재 유저는 유저 랭킹에서 제외하고 제재 만료 유저는 포함한다', async () => {
    seedUser(db, 'ranking-active-ban', 999999);
    seedUser(db, 'ranking-normal', 1000);
    seedUser(db, 'ranking-expired-ban', 5000);
    db.prepare("UPDATE users SET banned_until = datetime('now', '+1 day') WHERE id = ?").run('ranking-active-ban');
    db.prepare("UPDATE users SET banned_until = datetime('now', '-1 day') WHERE id = ?").run('ranking-expired-ban');

    const rankings = await userRepository.findRankings(10);

    expect(rankings.map((user) => user.id)).not.toContain('ranking-active-ban');
    expect(rankings.map((user) => user.id)).toContain('ranking-normal');
    expect(rankings.map((user) => user.id)).toContain('ranking-expired-ban');
  });

  it('활성 제재 유저는 카드 가치 랭킹에서도 제외한다', async () => {
    seedUser(db, 'ranking-card-banned', 100);
    seedUser(db, 'ranking-card-normal', 100);
    seedStreamer(db, 'ranking-card-channel', '랭킹 카드 스트리머');
    db.prepare("UPDATE streamers SET base_value = 10000 WHERE channel_id = 'ranking-card-channel'").run();
    db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES ('ranking-card-banned', 'ranking-card-channel', 1, 5),
             ('ranking-card-normal', 'ranking-card-channel', 2, 0)
    `).run();
    db.prepare("UPDATE users SET banned_until = datetime('now', '+1 day') WHERE id = ?").run('ranking-card-banned');

    const rankings = await userRepository.findRankings(10, '', { mode: 'cards' });
    const holderRankings = await userRepository.findRankings(10, '', { mode: 'cards', channelId: 'ranking-card-channel' });

    expect(rankings.map((user) => user.id)).not.toContain('ranking-card-banned');
    expect(holderRankings.map((user) => user.id)).toEqual(['ranking-card-normal']);
  });
});

describe('UserRepository admin listUsers', () => {
  it('관리자 유저 목록에는 탈퇴 유저 스냅샷을 포함하지만 total은 현재 유저만 센다', async () => {
    seedUser(db, 'admin-list-active', 1000);
    seedUser(db, 'admin-list-deleted', 3000);
    await userRepository.deleteAccount('admin-list-deleted');

    const result = await userRepository.listUsers('', 20, 0);

    expect(result.total).toBe(1);
    expect(result.users).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'admin-list-active',
        is_deleted: false
      }),
      expect.objectContaining({
        id: 'admin-list-deleted',
        username: 'user_admin-list-deleted',
        point: 3000,
        is_deleted: true,
        deleted_at: expect.any(String),
        identity_source: 'deleted_snapshot'
      })
    ]));
  });

  it('관리자 유저 목록 검색에서도 탈퇴 유저 스냅샷을 찾을 수 있다', async () => {
    seedUser(db, 'admin-list-search-deleted', 1200);
    await userRepository.deleteAccount('admin-list-search-deleted');

    const result = await userRepository.listUsers('search-deleted', 20, 0);

    expect(result.total).toBe(0);
    expect(result.users).toEqual([
      expect.objectContaining({
        id: 'admin-list-search-deleted',
        is_deleted: true,
        identity_source: 'deleted_snapshot'
      })
    ]);
  });

  it('유저 랭킹 API는 스냅샷 테이블에서 기존과 같은 랭킹 응답을 반환한다', async () => {
    seedUser(db, 'ranking-api-user-a', 1000);
    seedUser(db, 'ranking-api-user-b', 5000);
    seedStreamer(db, 'ranking-api-channel', '랭킹 API 스트리머');
    db.prepare("UPDATE streamers SET base_value = 2000 WHERE channel_id = 'ranking-api-channel'").run();
    db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES ('ranking-api-user-a', 'ranking-api-channel', 1, 0)
    `).run();

    const res = createJsonResponse();
    await getUserRankings({
      query: { mode: 'total' }
    } as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body.map((user: any) => user.id).slice(0, 2)).toEqual(['ranking-api-user-b', 'ranking-api-user-a']);
    expect(res.body.find((user: any) => user.id === 'ranking-api-user-a')).toMatchObject({
      cards_value: 2000,
      total_asset: 3000
    });
  });
});

describe('accountInteractionRestrictionMiddleware', () => {
  it('탈퇴 후 24시간 이내 재가입 계정의 상호작용 요청을 차단한다', async () => {
    seedUser(db, 'recent-rejoin-user');
    db.prepare(`
      INSERT INTO deleted_user_accounts (user_id, deleted_at)
      VALUES ('recent-rejoin-user', datetime('now', '-1 hour'))
    `).run();
    const res = createJsonResponse();
    let nextCalled = false;

    await accountInteractionRestrictionMiddleware(
      { user: { id: 'recent-rejoin-user' } } as any,
      res as any,
      (() => { nextCalled = true; }) as any
    );

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({
      error: 'PostRejoinInteractionRestricted',
      interaction_restricted_until: expect.any(String)
    });
  });

  it('탈퇴 후 24시간이 지난 재가입 계정의 상호작용 요청은 허용한다', async () => {
    seedUser(db, 'old-rejoin-user');
    db.prepare(`
      INSERT INTO deleted_user_accounts (user_id, deleted_at)
      VALUES ('old-rejoin-user', datetime('now', '-25 hours'))
    `).run();
    const res = createJsonResponse();
    let nextCalled = false;

    await accountInteractionRestrictionMiddleware(
      { user: { id: 'old-rejoin-user' } } as any,
      res as any,
      (() => { nextCalled = true; }) as any
    );

    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(0);
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

describe('User profile hidden cards', () => {
  it('본인 프로필에서도 숨김 카드는 통계, 컬렉션, 대표 카드 후보에서 제외된다', async () => {
    seedUser(db, 'profile-user', 100);
    seedStreamer(db, 'visible-channel', '공개 스트리머');
    seedStreamer(db, 'hidden-channel', '숨김 스트리머');
    db.prepare("UPDATE streamers SET base_value = 5000 WHERE channel_id = 'visible-channel'").run();
    db.prepare("UPDATE streamers SET base_value = 9000 WHERE channel_id = 'hidden-channel'").run();
    db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star, is_hidden)
      VALUES ('profile-user', 'visible-channel', 1, 0, 0),
             ('profile-user', 'hidden-channel', 1, 0, 1)
    `).run();
    await userRepository.updateRepresentativeCard('profile-user', 'hidden-channel', 0);

    const req: any = { params: { user_id: 'profile-user' }, user: { id: 'profile-user' } };
    const res = createJsonResponse();
    await getUserProfile(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.card_count).toBe(1);
    expect(res.body.unique_count).toBe(1);
    expect(res.body.total_asset).toBe(5100);
    expect(res.body.collection).toEqual([
      expect.objectContaining({ channel_id: 'visible-channel' })
    ]);
    expect(res.body.representative_card).toEqual(expect.objectContaining({
      channel_id: 'visible-channel'
    }));
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

  it('코스메틱 포함을 해제하고 등록하면 장착 코스메틱을 즉시 회수하고 매물에는 적용하지 않는다', async () => {
    seedUser(db, 'market-cosmetic-seller');
    seedStreamer(db, 'market-cosmetic-channel', '코스메틱 매물 스트리머');
    const borderId = Number(db.prepare(`
      INSERT INTO shop_items (type, name, price, style_json)
      VALUES ('border', '테스트 테두리', 1000, '{"border":"1px solid red"}')
    `).run().lastInsertRowid);
    const nameEffectId = Number(db.prepare(`
      INSERT INTO shop_items (type, name, price, style_json)
      VALUES ('name_effect', '테스트 이름표', 1000, '{"color":"red"}')
    `).run().lastInsertRowid);
    const cardId = Number(db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star, border_item_id, name_effect_item_id)
      VALUES ('market-cosmetic-seller', 'market-cosmetic-channel', 1, 3, ?, ?)
    `).run(borderId, nameEffectId).lastInsertRowid);

    const listing = await marketRepository.create({
      seller_id: 'market-cosmetic-seller',
      user_card_id: cardId,
      price: 1000,
      with_cosmetics: false
    });

    expect(listing.with_cosmetics).toBe(false);
    expect(listing.card?.border_item_id).toBeNull();
    expect(listing.card?.name_effect_item_id).toBeNull();
    expect(listing.card?.border).toBeNull();
    expect(listing.card?.name_effect).toBeNull();
    expect(db.prepare('SELECT border_item_id, name_effect_item_id FROM user_cards WHERE id = ?').get(cardId)).toEqual({
      border_item_id: null,
      name_effect_item_id: null
    });
    expect(db.prepare(`
      SELECT item_id, quantity
        FROM user_cosmetics
       WHERE user_id = ?
       ORDER BY item_id ASC
    `).all('market-cosmetic-seller')).toEqual([
      { item_id: borderId, quantity: 1 },
      { item_id: nameEffectId, quantity: 1 }
    ]);
  });

  it('7일 이상 판매되지 않은 고정가 매물만 자동 취소한다', async () => {
    seedUser(db, 'stale-fixed-seller');
    seedUser(db, 'fresh-fixed-seller');
    seedUser(db, 'stale-auction-seller');
    seedStreamer(db, 'stale-fixed-channel', '오래된 고정가');
    seedStreamer(db, 'fresh-fixed-channel', '최근 고정가');
    seedStreamer(db, 'stale-auction-channel', '오래된 경매');
    const staleFixedCardId = Number(db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES ('stale-fixed-seller', 'stale-fixed-channel', 1, 0)
    `).run().lastInsertRowid);
    const freshFixedCardId = Number(db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES ('fresh-fixed-seller', 'fresh-fixed-channel', 1, 0)
    `).run().lastInsertRowid);
    const staleAuctionCardId = Number(db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES ('stale-auction-seller', 'stale-auction-channel', 1, 0)
    `).run().lastInsertRowid);

    const staleFixed = await marketRepository.create({
      seller_id: 'stale-fixed-seller',
      user_card_id: staleFixedCardId,
      price: 1000
    });
    const freshFixed = await marketRepository.create({
      seller_id: 'fresh-fixed-seller',
      user_card_id: freshFixedCardId,
      price: 1000
    });
    const staleAuction = await marketRepository.create({
      seller_id: 'stale-auction-seller',
      user_card_id: staleAuctionCardId,
      price: 1000,
      listing_type: 'auction',
      starting_bid: 1000,
      auction_ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });
    db.prepare("UPDATE market_listings SET created_at = datetime('now', '-8 day'), updated_at = datetime('now', '-8 day') WHERE id IN (?, ?)")
      .run(staleFixed.id, staleAuction.id);
    db.prepare("UPDATE market_listings SET created_at = datetime('now', '-2 day'), updated_at = datetime('now', '-2 day') WHERE id = ?")
      .run(freshFixed.id);

    const cancelled = await marketRepository.cancelStaleListings(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    expect(cancelled.map((listing) => listing.id)).toEqual([staleFixed.id]);
    expect(db.prepare('SELECT status FROM market_listings WHERE id = ?').get(staleFixed.id)).toEqual({ status: 'CANCELLED' });
    expect(db.prepare('SELECT status FROM market_listings WHERE id = ?').get(freshFixed.id)).toEqual({ status: 'PENDING' });
    expect(db.prepare('SELECT status FROM market_listings WHERE id = ?').get(staleAuction.id)).toEqual({ status: 'PENDING' });
    expect(db.prepare('SELECT id FROM market_listings WHERE user_card_id = ? AND status = ?').get(staleFixedCardId, 'PENDING')).toBeUndefined();
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
    expect(db.prepare(`
      SELECT user_id, counterparty_user_id, amount, source_type, reason, source_id
        FROM point_ledger_entries
       WHERE source_id = ?
       ORDER BY id ASC
    `).all(String(first.id))).toEqual([
      {
        user_id: 'new-buyer',
        counterparty_user_id: 'old-seller',
        amount: -1000,
        source_type: 'market_purchase',
        reason: 'market_buy',
        source_id: String(first.id)
      },
      {
        user_id: 'old-seller',
        counterparty_user_id: 'new-buyer',
        amount: 950,
        source_type: 'market_sale',
        reason: 'market_sale_settlement',
        source_id: String(first.id)
      }
    ]);
  });

  it('판매 체결과 탈퇴 시점의 오픈마켓 감사 로그에는 탈퇴 유저 ID가 유지된다', async () => {
    seedUser(db, 'audit-seller');
    seedUser(db, 'audit-buyer', 10000);
    seedStreamer(db, 'audit-channel', '감사 스트리머');
    const cardId = Number(db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES ('audit-seller', 'audit-channel', 7, 2)
    `).run().lastInsertRowid);

    const listing = await marketRepository.create({
      seller_id: 'audit-seller',
      user_card_id: cardId,
      price: 1500
    });
    expect(await marketRepository.buyAtomic(listing.id as number, 'audit-buyer')).toMatchObject({ ok: true });

    expect(db.prepare(`
      SELECT event_type, seller_id, buyer_id, channel_id, serial_number, star, price, status
        FROM market_transaction_audit_logs
       WHERE audit_key = ?
    `).get(`sold:${listing.id}`)).toEqual({
      event_type: 'sold',
      seller_id: 'audit-seller',
      buyer_id: 'audit-buyer',
      channel_id: 'audit-channel',
      serial_number: 7,
      star: 2,
      price: 1500,
      status: 'SOLD'
    });

    await userRepository.deleteAccount('audit-seller');

    expect(await userRepository.findDeletedAccount('audit-seller')).toEqual({
      user_id: 'audit-seller',
      deleted_at: expect.any(String),
      username_snapshot: 'user_audit-seller',
      avatar_url_snapshot: null,
      point_at_deletion: 1425
    });
    expect(db.prepare('SELECT id FROM users WHERE id = ?').get('audit-seller')).toBeUndefined();
    expect(db.prepare('SELECT id FROM market_listings WHERE id = ?').get(listing.id)).toBeUndefined();
    expect(db.prepare(`
      SELECT event_type, related_user_id, seller_id, buyer_id, channel_id, serial_number, star, price, status
        FROM market_transaction_audit_logs
       WHERE audit_key = ?
    `).get(`account_deleted:${listing.id}:audit-seller`)).toEqual({
      event_type: 'account_deleted',
      related_user_id: 'audit-seller',
      seller_id: 'audit-seller',
      buyer_id: 'audit-buyer',
      channel_id: 'audit-channel',
      serial_number: 7,
      star: 2,
      price: 1500,
      status: 'SOLD'
    });
  });

  it('진행 중인 경매 판매자가 탈퇴하면 입찰자 예약금을 환불한다', async () => {
    seedUser(db, 'delete-auction-seller');
    seedUser(db, 'delete-auction-bidder', 5000);
    seedStreamer(db, 'delete-auction-channel', '탈퇴 경매 스트리머');
    const cardId = Number(db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES ('delete-auction-seller', 'delete-auction-channel', 1, 0)
    `).run().lastInsertRowid);

    const listing = await marketRepository.create({
      seller_id: 'delete-auction-seller',
      user_card_id: cardId,
      price: 1000,
      listing_type: 'auction',
      starting_bid: 1000,
      auction_ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });
    expect(await marketRepository.placeBid(listing.id as number, 'delete-auction-bidder', 1200)).toMatchObject({ ok: true });
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('delete-auction-bidder')).toEqual({ point: 3800 });

    await userRepository.deleteAccount('delete-auction-seller');

    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('delete-auction-bidder')).toEqual({ point: 5000 });
    expect(db.prepare('SELECT id FROM market_listings WHERE id = ?').get(listing.id)).toBeUndefined();
    expect(db.prepare(`
      SELECT user_id, counterparty_user_id, amount, source_type, reason, source_id
        FROM point_ledger_entries
       WHERE user_id = 'delete-auction-bidder'
       ORDER BY id ASC
    `).all()).toEqual([
      {
        user_id: 'delete-auction-bidder',
        counterparty_user_id: 'delete-auction-seller',
        amount: -1200,
        source_type: 'market_bid',
        reason: 'auction_bid_reserved',
        source_id: String(listing.id)
      },
      {
        user_id: 'delete-auction-bidder',
        counterparty_user_id: 'delete-auction-seller',
        amount: 1200,
        source_type: 'market_bid_refund',
        reason: 'seller_account_deleted_refund',
        source_id: String(listing.id)
      }
    ]);
    expect(db.prepare(`
      SELECT event_type, related_user_id, seller_id, current_bidder_id, bid_reserved
        FROM market_transaction_audit_logs
       WHERE audit_key = ?
    `).get(`account_deleted:${listing.id}:delete-auction-seller`)).toEqual({
      event_type: 'account_deleted',
      related_user_id: 'delete-auction-seller',
      seller_id: 'delete-auction-seller',
      current_bidder_id: 'delete-auction-bidder',
      bid_reserved: 1200
    });
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

    expect(await marketRepository.placeBid(listing.id as number, 'auction-bidder-a', 1000)).toMatchObject({
      ok: true,
      reason: 'OK'
    });
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('auction-bidder-a')).toEqual({ point: 4000 });
    expect(db.prepare('SELECT current_bidder_id, current_bid, bid_reserved FROM market_listings WHERE id = ?').get(listing.id)).toEqual({
      current_bidder_id: 'auction-bidder-a',
      current_bid: 1000,
      bid_reserved: 1000
    });

    expect(await marketRepository.placeBid(listing.id as number, 'auction-bidder-b', 2000)).toMatchObject({
      ok: true,
      reason: 'OK',
      previous_bidder_id: 'auction-bidder-a'
    });
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('auction-bidder-a')).toEqual({ point: 5000 });
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('auction-bidder-b')).toEqual({ point: 5000 });
    expect(db.prepare(`
      SELECT user_id, counterparty_user_id, amount, source_type, reason
        FROM point_ledger_entries
       WHERE source_id = ?
       ORDER BY id ASC
    `).all(String(listing.id))).toEqual([
      {
        user_id: 'auction-bidder-a',
        counterparty_user_id: 'auction-seller',
        amount: -1000,
        source_type: 'market_bid',
        reason: 'auction_bid_reserved'
      },
      {
        user_id: 'auction-bidder-b',
        counterparty_user_id: 'auction-seller',
        amount: -2000,
        source_type: 'market_bid',
        reason: 'auction_bid_reserved'
      },
      {
        user_id: 'auction-bidder-a',
        counterparty_user_id: 'auction-seller',
        amount: 1000,
        source_type: 'market_bid_refund',
        reason: 'auction_outbid_refund'
      }
    ]);
    expect(db.prepare('SELECT current_bidder_id, current_bid, bid_reserved FROM market_listings WHERE id = ?').get(listing.id)).toEqual({
      current_bidder_id: 'auction-bidder-b',
      current_bid: 2000,
      bid_reserved: 2000
    });
    const bidderAActive = await marketRepository.listActive({
      page: 1,
      limit: 12,
      sort: 'latest',
      type: 'bidding',
      bidderId: 'auction-bidder-a'
    });
    expect(bidderAActive.total).toBe(1);
    expect(bidderAActive.listings[0]).toMatchObject({
      id: listing.id,
      current_bidder_id: 'auction-bidder-b',
      bid_reserved: 2000
    });
    const bidderBActive = await marketRepository.listActive({
      page: 1,
      limit: 12,
      sort: 'latest',
      type: 'bidding',
      bidderId: 'auction-bidder-b'
    });
    expect(bidderBActive.total).toBe(1);
    expect(bidderBActive.listings[0]).toMatchObject({
      id: listing.id,
      current_bidder_id: 'auction-bidder-b',
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
    expect(db.prepare(`
      SELECT user_id, counterparty_user_id, amount, source_type, reason
        FROM point_ledger_entries
       WHERE source_id = ?
       ORDER BY id ASC
    `).all(String(listing.id))).toEqual([
      {
        user_id: 'auction-bidder-a',
        counterparty_user_id: 'auction-seller',
        amount: -1000,
        source_type: 'market_bid',
        reason: 'auction_bid_reserved'
      },
      {
        user_id: 'auction-bidder-b',
        counterparty_user_id: 'auction-seller',
        amount: -2000,
        source_type: 'market_bid',
        reason: 'auction_bid_reserved'
      },
      {
        user_id: 'auction-bidder-a',
        counterparty_user_id: 'auction-seller',
        amount: 1000,
        source_type: 'market_bid_refund',
        reason: 'auction_outbid_refund'
      },
      {
        user_id: 'auction-seller',
        counterparty_user_id: 'auction-bidder-b',
        amount: 1900,
        source_type: 'market_sale',
        reason: 'auction_sale_settlement'
      }
    ]);
  });

  it('최신순 오픈마켓 목록은 입찰로 갱신된 경매를 앞으로 올린다', async () => {
    seedUser(db, 'activity-seller-a');
    seedUser(db, 'activity-seller-b');
    seedUser(db, 'activity-bidder', 10000);
    seedStreamer(db, 'activity-channel-a', '활동순 A');
    seedStreamer(db, 'activity-channel-b', '활동순 B');
    const cardA = Number(db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES ('activity-seller-a', 'activity-channel-a', 1, 0)
    `).run().lastInsertRowid);
    const cardB = Number(db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES ('activity-seller-b', 'activity-channel-b', 1, 0)
    `).run().lastInsertRowid);

    const older = await marketRepository.create({
      seller_id: 'activity-seller-a',
      user_card_id: cardA,
      price: 1000,
      listing_type: 'auction',
      starting_bid: 1000,
      auction_ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });
    const newer = await marketRepository.create({
      seller_id: 'activity-seller-b',
      user_card_id: cardB,
      price: 1000,
      listing_type: 'auction',
      starting_bid: 1000,
      auction_ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });
    db.prepare("UPDATE market_listings SET created_at = datetime('now', '-2 hour'), updated_at = datetime('now', '-2 hour') WHERE id = ?").run(older.id);
    db.prepare("UPDATE market_listings SET created_at = datetime('now', '-1 hour'), updated_at = datetime('now', '-1 hour') WHERE id = ?").run(newer.id);

    expect((await marketRepository.listActive({ page: 1, limit: 2, sort: 'latest', type: 'all' })).listings[0].id).toBe(newer.id);

    expect(await marketRepository.placeBid(older.id as number, 'activity-bidder', 1200)).toMatchObject({ ok: true });

    expect((await marketRepository.listActive({ page: 1, limit: 2, sort: 'latest', type: 'all' })).listings[0].id).toBe(older.id);
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
    const soldUpdatedAt = '2026-01-01T00:00:00.000Z';
    db.prepare('UPDATE market_listings SET updated_at = ? WHERE id = ?').run(soldUpdatedAt, listing.id);

    expect(await marketRepository.hideForSeller(listing.id as number, 'hide-seller')).toBe(true);
    expect(await marketRepository.listByUser('hide-seller')).toEqual([]);
    expect(db.prepare('SELECT status, seller_hidden_at, updated_at FROM market_listings WHERE id = ?').get(listing.id)).toEqual({
      status: 'SOLD',
      seller_hidden_at: expect.any(String),
      updated_at: soldUpdatedAt
    });
    const sellerHistory = await marketRepository.listHistory('hide-seller');
    const buyerHistory = await marketRepository.listHistory('hide-buyer');
    expect(sellerHistory.map((item) => item.id)).toContain(listing.id);
    expect(buyerHistory.map((item) => item.id)).toContain(listing.id);
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
