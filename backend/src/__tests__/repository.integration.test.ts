import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
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
  tradeRepository,
  userCardRepository,
  userRepository
} from '../repositories';
import {
  clearStreamerLiveStatusCache,
  getStreamerLiveStatuses,
  getUserProfile,
  getUserRankings
} from '../controllers/playController';
import { cancelListing, createListing, listMarketHistory } from '../controllers/marketController';
import { buyItem, createItem, getActiveItems, getAllItems, getUserPurchases, updateItem } from '../services/shopService';
import { accountInteractionRestrictionMiddleware } from '../middlewares/accountInteractionRestriction';
import { grantCardDeletionCompensations } from '../services/cardDeletionCompensation';

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

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  loadSchema(db);
  __setSqliteDbForTest(db);
  initRepositories();
  clearStreamerLiveStatusCache();
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it('streamerRepository.findLiveStatuses는 이미지 없이 채널별 방송 여부만 반환한다', async () => {
    seedStreamer(db, 'live-c1', '라이브 A');
    seedStreamer(db, 'live-c2', '오프라인 B');
    db.prepare("UPDATE streamers SET is_active = 1 WHERE channel_id = 'live-c1'").run();

    await expect(streamerRepository.findLiveStatuses()).resolves.toEqual([
      { channel_id: 'live-c1', is_active: true },
      { channel_id: 'live-c2', is_active: false }
    ]);
  });
});

describe('streamer live-status API', () => {
  it('동시 요청을 합쳐 경량 상태 맵을 반환하고 외부 캐시를 금지한다', async () => {
    seedStreamer(db, 'api-live', '라이브');
    seedStreamer(db, 'api-offline', '오프라인');
    db.prepare("UPDATE streamers SET is_active = 1 WHERE channel_id = 'api-live'").run();
    const findSpy = vi.spyOn(streamerRepository, 'findLiveStatuses');
    const first = createJsonResponse();
    const second = createJsonResponse();

    await Promise.all([
      getStreamerLiveStatuses({} as any, first as any),
      getStreamerLiveStatuses({} as any, second as any)
    ]);

    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(first.statusCode).toBe(200);
    expect(first.headers['Cache-Control']).toBe('no-store');
    expect(first.body).toEqual({
      statuses: {
        'api-live': true,
        'api-offline': false
      },
      updated_at: expect.any(String)
    });
    expect(second.body).toEqual(first.body);
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

describe('MinigameRepository authoritative paid sessions', () => {
  it('serializes concurrent starts so one ticket cannot create two active paid sessions', async () => {
    seedUser(db, 'atomic-minigame-user');
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO user_minigame_tickets
        (user_id, current_tickets, bonus_tickets, last_charged_at, updated_at)
      VALUES (?, 2, 0, ?, ?)
    `).run('atomic-minigame-user', now, now);

    const makeSession = (id: string) => ({
      id,
      user_id: 'atomic-minigame-user',
      game_type: 'quiz' as const,
      status: 'STARTED' as const,
      target_data: JSON.stringify({ practice_mode: false }),
      validation_version: 1,
      progress_data: JSON.stringify({ round_outcomes: [] }),
      progress_revision: 0,
      expires_at: new Date(Date.now() + 180_000).toISOString()
    });

    const results = await Promise.all([
      minigameRepository.startSession(makeSession('atomic-session-a'), 240),
      minigameRepository.startSession(makeSession('atomic-session-b'), 240)
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(db.prepare(`
      SELECT current_tickets, bonus_tickets
        FROM user_minigame_tickets
       WHERE user_id = ?
    `).get('atomic-minigame-user')).toEqual({ current_tickets: 1, bonus_tickets: 0 });
    expect(db.prepare(`
      SELECT COUNT(*) AS count
        FROM minigame_sessions
       WHERE user_id = ? AND status = 'STARTED' AND ticket_spent_type IN ('BASE', 'BONUS')
    `).get('atomic-minigame-user')).toEqual({ count: 1 });
  });

  it('stores only the first sequential round outcome and makes an identical retry idempotent', async () => {
    seedUser(db, 'round-lock-user');
    const firstRoundDeadline = new Date(Date.now() + 60_000).toISOString();
    const secondRoundDeadline = new Date(Date.now() + 120_000).toISOString();
    const start = await minigameRepository.startSession({
      id: 'round-lock-session',
      user_id: 'round-lock-user',
      game_type: 'quiz',
      status: 'STARTED',
      target_data: JSON.stringify({ practice_mode: false }),
      validation_version: 1,
      progress_data: JSON.stringify({ round_outcomes: [], round_deadline_at: firstRoundDeadline }),
      progress_revision: 0,
      expires_at: new Date(Date.now() + 180_000).toISOString()
    }, 240);
    expect(start.ok).toBe(true);

    const first = await minigameRepository.recordRoundOutcome(
      'round-lock-session', 'round-lock-user', 0, 'wrong', secondRoundDeadline
    );
    const retry = await minigameRepository.recordRoundOutcome(
      'round-lock-session', 'round-lock-user', 0, 'wrong', new Date(Date.now() + 300_000).toISOString()
    );
    const afterRetry = await minigameRepository.findSessionById('round-lock-session');
    const alternate = await minigameRepository.recordRoundOutcome(
      'round-lock-session', 'round-lock-user', 0, 'correct', secondRoundDeadline
    );
    const skipped = await minigameRepository.recordRoundOutcome(
      'round-lock-session', 'round-lock-user', 2, 'future', null
    );
    const timeout = await minigameRepository.recordRoundOutcome(
      'round-lock-session', 'round-lock-user', 1, null, null
    );

    expect(first).toEqual(expect.objectContaining({ ok: true, duplicate: false }));
    expect(retry).toEqual(expect.objectContaining({ ok: true, duplicate: true }));
    expect(JSON.parse(afterRetry?.progress_data || '{}')).toMatchObject({
      round_deadline_at: secondRoundDeadline
    });
    expect(afterRetry?.progress_revision).toBe(1);
    expect(alternate.ok).toBe(false);
    expect(skipped.ok).toBe(false);
    expect(timeout).toEqual(expect.objectContaining({ ok: true, duplicate: false }));
    const stored = await minigameRepository.findSessionById('round-lock-session');
    expect(JSON.parse(stored?.progress_data || '{}')).toEqual({
      round_outcomes: [
        { round: 0, selected_channel_id: 'wrong' },
        { round: 1, selected_channel_id: null }
      ],
      round_deadline_at: null
    });
    expect(stored?.progress_revision).toBe(2);
  });

  it('fails closed for elapsed value-duel deadlines and does not resolve an unstarted next round', async () => {
    seedUser(db, 'round-deadline-user');
    const elapsedDeadline = new Date(Date.now() - 1_000).toISOString();
    expect((await minigameRepository.startSession({
      id: 'round-deadline-session',
      user_id: 'round-deadline-user',
      game_type: 'value_duel',
      status: 'STARTED',
      target_data: JSON.stringify({ practice_mode: false }),
      validation_version: 1,
      progress_data: JSON.stringify({ round_outcomes: [], round_deadline_at: elapsedDeadline }),
      progress_revision: 0,
      expires_at: new Date(Date.now() + 180_000).toISOString()
    }, 240)).ok).toBe(true);

    const lateAnswer = await minigameRepository.recordRoundOutcome(
      'round-deadline-session', 'round-deadline-user', 0, 'answer', elapsedDeadline
    );
    expect(lateAnswer).toMatchObject({ ok: false });
    expect(lateAnswer.reason).toMatch(/마감/);

    const timeout = await minigameRepository.recordRoundOutcome(
      'round-deadline-session', 'round-deadline-user', 0, null, elapsedDeadline
    );
    const lateRetry = await minigameRepository.recordRoundOutcome(
      'round-deadline-session', 'round-deadline-user', 0, null, new Date(Date.now() + 60_000).toISOString()
    );
    const nextLateAnswer = await minigameRepository.recordRoundOutcome(
      'round-deadline-session', 'round-deadline-user', 1, 'answer', null
    );
    const nextTimeout = await minigameRepository.recordRoundOutcome(
      'round-deadline-session', 'round-deadline-user', 1, null, null
    );

    expect(timeout).toEqual(expect.objectContaining({ ok: true, duplicate: false }));
    expect(lateRetry).toEqual(expect.objectContaining({ ok: true, duplicate: true }));
    expect(nextLateAnswer).toMatchObject({ ok: false });
    expect(nextTimeout).toMatchObject({ ok: false });
    const stored = await minigameRepository.findSessionById('round-deadline-session');
    expect(stored?.progress_revision).toBe(1);
    expect(JSON.parse(stored?.progress_data || '{}')).toEqual({
      round_outcomes: [
        { round: 0, selected_channel_id: null }
      ],
      round_deadline_at: null,
      round_started_round: null
    });
  });

  it('rejects a new non-timeout answer when authoritative round deadline state is missing', async () => {
    seedUser(db, 'missing-round-deadline-user');
    expect((await minigameRepository.startSession({
      id: 'missing-round-deadline-session',
      user_id: 'missing-round-deadline-user',
      game_type: 'quiz',
      status: 'STARTED',
      target_data: JSON.stringify({ practice_mode: false }),
      validation_version: 1,
      progress_data: JSON.stringify({ round_outcomes: [] }),
      expires_at: new Date(Date.now() + 180_000).toISOString()
    }, 240)).ok).toBe(true);

    const result = await minigameRepository.recordRoundOutcome(
      'missing-round-deadline-session',
      'missing-round-deadline-user',
      0,
      'answer',
      null
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.reason).toMatch(/마감 정보/);
    expect((await minigameRepository.findSessionById('missing-round-deadline-session'))?.progress_revision).toBe(0);
  });

  it('arms a paid value-duel round only when the player continues and never extends it', async () => {
    seedUser(db, 'value-duel-round-arm-user');
    const initialDeadline = new Date(Date.now() + 60_000).toISOString();
    const nextDeadline = new Date(Date.now() + 90_000).toISOString();
    const attemptedExtension = new Date(Date.now() + 120_000).toISOString();
    expect((await minigameRepository.startSession({
      id: 'value-duel-round-arm-session',
      user_id: 'value-duel-round-arm-user',
      game_type: 'value_duel',
      status: 'STARTED',
      target_data: JSON.stringify({
        practice_mode: false,
        rounds: [{ round: 0 }, { round: 1 }]
      }),
      validation_version: 1,
      progress_data: JSON.stringify({
        round_outcomes: [],
        round_deadline_at: initialDeadline,
        round_started_round: 0
      }),
      progress_revision: 0,
      expires_at: new Date(Date.now() + 180_000).toISOString()
    }, 240)).ok).toBe(true);

    const firstOutcome = await minigameRepository.recordRoundOutcome(
      'value-duel-round-arm-session',
      'value-duel-round-arm-user',
      0,
      'left-0',
      attemptedExtension
    );
    expect(firstOutcome).toEqual(expect.objectContaining({ ok: true, duplicate: false }));
    expect(JSON.parse((await minigameRepository.findSessionById(
      'value-duel-round-arm-session'
    ))?.progress_data || '{}')).toEqual({
      round_outcomes: [{ round: 0, selected_channel_id: 'left-0' }],
      round_deadline_at: null,
      round_started_round: null
    });

    const timeoutBeforeContinue = await minigameRepository.recordRoundOutcome(
      'value-duel-round-arm-session', 'value-duel-round-arm-user', 1, null, null
    );
    expect(timeoutBeforeContinue).toMatchObject({ ok: false });

    const firstArm = await minigameRepository.armRoundDeadline(
      'value-duel-round-arm-session', 'value-duel-round-arm-user', 1, nextDeadline
    );
    const repeatedArm = await minigameRepository.armRoundDeadline(
      'value-duel-round-arm-session', 'value-duel-round-arm-user', 1, attemptedExtension
    );
    expect(firstArm).toEqual(expect.objectContaining({ ok: true, armedNow: true }));
    expect(repeatedArm).toEqual(expect.objectContaining({ ok: true, armedNow: false }));
    const armedSession = await minigameRepository.findSessionById('value-duel-round-arm-session');
    expect(JSON.parse(armedSession?.progress_data || '{}')).toEqual({
      round_outcomes: [{ round: 0, selected_channel_id: 'left-0' }],
      round_deadline_at: nextDeadline,
      round_started_round: 1
    });
    expect(armedSession?.progress_revision).toBe(2);
  });

  it('keeps a future markerless legacy value-duel deadline without extending it', async () => {
    seedUser(db, 'legacy-value-duel-arm-user');
    const legacyDeadline = new Date(Date.now() + 60_000).toISOString();
    const attemptedExtension = new Date(Date.now() + 120_000).toISOString();
    expect((await minigameRepository.startSession({
      id: 'legacy-value-duel-arm-session',
      user_id: 'legacy-value-duel-arm-user',
      game_type: 'value_duel',
      status: 'STARTED',
      target_data: JSON.stringify({ practice_mode: false, rounds: [{ round: 0 }] }),
      validation_version: 1,
      progress_data: JSON.stringify({
        round_outcomes: [],
        round_deadline_at: legacyDeadline
      }),
      progress_revision: 0,
      expires_at: new Date(Date.now() + 180_000).toISOString()
    }, 240)).ok).toBe(true);

    const arm = await minigameRepository.armRoundDeadline(
      'legacy-value-duel-arm-session',
      'legacy-value-duel-arm-user',
      0,
      attemptedExtension
    );

    expect(arm).toEqual(expect.objectContaining({ ok: true, armedNow: false }));
    const stored = await minigameRepository.findSessionById('legacy-value-duel-arm-session');
    expect(JSON.parse(stored?.progress_data || '{}')).toEqual({
      round_outcomes: [],
      round_deadline_at: legacyDeadline
    });
    expect(stored?.progress_revision).toBe(0);

    const outcome = await minigameRepository.recordRoundOutcome(
      'legacy-value-duel-arm-session',
      'legacy-value-duel-arm-user',
      0,
      'left-0',
      attemptedExtension
    );
    expect(outcome).toEqual(expect.objectContaining({ ok: true, duplicate: false }));
    const completed = await minigameRepository.findSessionById('legacy-value-duel-arm-session');
    expect(JSON.parse(completed?.progress_data || '{}')).toEqual({
      round_outcomes: [{ round: 0, selected_channel_id: 'left-0' }],
      round_deadline_at: null,
      round_started_round: null
    });
  });

  it('arms each paid crop round once and leaves the following round unarmed until its image is ready', async () => {
    seedUser(db, 'crop-round-arm-user');
    const firstDeadline = new Date(Date.now() + 60_000).toISOString();
    const attemptedExtension = new Date(Date.now() + 120_000).toISOString();
    const secondDeadline = new Date(Date.now() + 90_000).toISOString();
    expect((await minigameRepository.startSession({
      id: 'crop-round-arm-session',
      user_id: 'crop-round-arm-user',
      game_type: 'crop_detective',
      status: 'STARTED',
      target_data: JSON.stringify({
        practice_mode: false,
        rounds: [{ round: 0 }, { round: 1 }]
      }),
      validation_version: 1,
      progress_data: JSON.stringify({
        round_outcomes: [],
        round_deadline_at: null,
        round_image_armed_round: null
      }),
      progress_revision: 0,
      expires_at: new Date(Date.now() + 180_000).toISOString()
    }, 240)).ok).toBe(true);

    const answerBeforeImage = await minigameRepository.recordRoundOutcome(
      'crop-round-arm-session', 'crop-round-arm-user', 0, 'answer-0', null
    );
    const timeoutBeforeImage = await minigameRepository.recordRoundOutcome(
      'crop-round-arm-session', 'crop-round-arm-user', 0, null, null
    );
    expect(answerBeforeImage).toMatchObject({ ok: false });
    expect(timeoutBeforeImage).toMatchObject({ ok: false });
    expect(answerBeforeImage.reason).toMatch(/준비|시작/);
    expect((await minigameRepository.findSessionById('crop-round-arm-session'))?.progress_revision).toBe(0);

    const firstArm = await minigameRepository.armRoundDeadline(
      'crop-round-arm-session', 'crop-round-arm-user', 0, firstDeadline
    );
    const repeatedArm = await minigameRepository.armRoundDeadline(
      'crop-round-arm-session', 'crop-round-arm-user', 0, attemptedExtension
    );
    expect(firstArm).toEqual(expect.objectContaining({ ok: true, armedNow: true }));
    expect(repeatedArm).toEqual(expect.objectContaining({ ok: true, armedNow: false }));

    const afterRepeatedArm = await minigameRepository.findSessionById('crop-round-arm-session');
    expect(JSON.parse(afterRepeatedArm?.progress_data || '{}')).toEqual({
      round_outcomes: [],
      round_deadline_at: firstDeadline,
      round_image_armed_round: 0
    });
    expect(afterRepeatedArm?.progress_revision).toBe(1);

    const firstOutcome = await minigameRepository.recordRoundOutcome(
      'crop-round-arm-session', 'crop-round-arm-user', 0, 'answer-0', null
    );
    expect(firstOutcome).toEqual(expect.objectContaining({ ok: true, duplicate: false }));
    const nextRoundUnarmed = await minigameRepository.findSessionById('crop-round-arm-session');
    expect(JSON.parse(nextRoundUnarmed?.progress_data || '{}')).toEqual({
      round_outcomes: [{ round: 0, selected_channel_id: 'answer-0' }],
      round_deadline_at: null,
      round_image_armed_round: null
    });
    expect(nextRoundUnarmed?.progress_revision).toBe(2);

    const secondArm = await minigameRepository.armRoundDeadline(
      'crop-round-arm-session', 'crop-round-arm-user', 1, secondDeadline
    );
    expect(secondArm).toEqual(expect.objectContaining({ ok: true, armedNow: true }));
    const secondRoundArmed = await minigameRepository.findSessionById('crop-round-arm-session');
    expect(JSON.parse(secondRoundArmed?.progress_data || '{}')).toEqual({
      round_outcomes: [{ round: 0, selected_channel_id: 'answer-0' }],
      round_deadline_at: secondDeadline,
      round_image_armed_round: 1
    });
    expect(secondRoundArmed?.progress_revision).toBe(3);
  });

  it('replaces a legacy markerless crop deadline exactly once when the image becomes ready', async () => {
    seedUser(db, 'legacy-crop-arm-user');
    const staleDeadline = new Date(Date.now() - 30_000).toISOString();
    const armedDeadline = new Date(Date.now() + 60_000).toISOString();
    const attemptedExtension = new Date(Date.now() + 120_000).toISOString();
    expect((await minigameRepository.startSession({
      id: 'legacy-crop-arm-session',
      user_id: 'legacy-crop-arm-user',
      game_type: 'crop_detective',
      status: 'STARTED',
      target_data: JSON.stringify({ practice_mode: false, rounds: [{ round: 0 }] }),
      validation_version: 1,
      progress_data: JSON.stringify({
        round_outcomes: [],
        round_deadline_at: staleDeadline
      }),
      progress_revision: 0,
      expires_at: new Date(Date.now() + 180_000).toISOString()
    }, 240)).ok).toBe(true);

    const firstArm = await minigameRepository.armRoundDeadline(
      'legacy-crop-arm-session', 'legacy-crop-arm-user', 0, armedDeadline
    );
    const repeatedArm = await minigameRepository.armRoundDeadline(
      'legacy-crop-arm-session', 'legacy-crop-arm-user', 0, attemptedExtension
    );

    expect(firstArm).toEqual(expect.objectContaining({ ok: true, armedNow: true }));
    expect(repeatedArm).toEqual(expect.objectContaining({ ok: true, armedNow: false }));
    const stored = await minigameRepository.findSessionById('legacy-crop-arm-session');
    expect(JSON.parse(stored?.progress_data || '{}')).toEqual({
      round_outcomes: [],
      round_deadline_at: armedDeadline,
      round_image_armed_round: 0
    });
    expect(stored?.progress_revision).toBe(1);
  });

  it('rejects arbitrary rewards and credits a versioned paid session only once', async () => {
    seedUser(db, 'reward-lock-user');
    const start = await minigameRepository.startSession({
      id: 'reward-lock-session',
      user_id: 'reward-lock-user',
      game_type: 'puzzle',
      status: 'STARTED',
      target_data: JSON.stringify({ practice_mode: false }),
      validation_version: 1,
      progress_data: '{}',
      progress_revision: 0,
      expires_at: new Date(Date.now() + 120_000).toISOString()
    }, 240);
    expect(start.ok).toBe(true);

    expect((await minigameRepository.completeSession('reward-lock-session', 999)).ok).toBe(false);
    const first = await minigameRepository.completeSession(
      'reward-lock-session',
      1200,
      JSON.stringify({ correct: true, message: 'stored' })
    );
    const retry = await minigameRepository.completeSession('reward-lock-session', 1200, JSON.stringify({ correct: false }));

    expect(first).toEqual(expect.objectContaining({
      ok: true,
      settledNow: true,
      newPoints: 1200,
      earnedPoints: 1200,
      resultData: JSON.stringify({ correct: true, message: 'stored' })
    }));
    expect(retry).toEqual(expect.objectContaining({
      ok: true,
      settledNow: false,
      newPoints: 1200,
      earnedPoints: 1200,
      resultData: JSON.stringify({ correct: true, message: 'stored' })
    }));
    expect((await userRepository.findById('reward-lock-user'))?.point).toBe(1200);
    expect(db.prepare(`
      SELECT COUNT(*) AS count
        FROM point_ledger_entries
       WHERE user_id = ? AND source_type = 'minigame' AND source_id = ?
    `).get('reward-lock-user', 'reward-lock-session')).toEqual({ count: 1 });
  });

  it('never credits a versioned practice session', async () => {
    seedUser(db, 'practice-reward-guard-user');
    expect((await minigameRepository.startSession({
      id: 'practice-reward-guard-session',
      user_id: 'practice-reward-guard-user',
      game_type: 'match',
      status: 'STARTED',
      target_data: JSON.stringify({ practice_mode: true }),
      validation_version: 1,
      progress_data: '{}'
    })).ok).toBe(true);

    const result = await minigameRepository.completeSession('practice-reward-guard-session', 1200);

    expect(result.ok).toBe(false);
    expect((await userRepository.findById('practice-reward-guard-user'))?.point).toBe(0);
    expect((await minigameRepository.findSessionById('practice-reward-guard-session'))?.status).toBe('STARTED');
  });

  it('returns one authoritative winner when completion requests race', async () => {
    seedUser(db, 'completion-race-user');
    expect((await minigameRepository.startSession({
      id: 'completion-race-session',
      user_id: 'completion-race-user',
      game_type: 'quiz',
      status: 'STARTED',
      target_data: JSON.stringify({ practice_mode: false }),
      validation_version: 1,
      progress_data: '{}',
      expires_at: new Date(Date.now() + 120_000).toISOString()
    }, 240)).ok).toBe(true);

    const firstSnapshot = JSON.stringify({ request: 'first', earned_points: 1200 });
    const secondSnapshot = JSON.stringify({ request: 'second', earned_points: 1000 });
    const results = await Promise.all([
      minigameRepository.completeSession('completion-race-session', 1200, firstSnapshot),
      minigameRepository.completeSession('completion-race-session', 1000, secondSnapshot)
    ]);
    const successes = results.filter((result) => result.ok);
    const winner = successes.find((result) => result.ok && result.settledNow);
    const replay = successes.find((result) => result.ok && !result.settledNow);

    expect(successes).toHaveLength(2);
    expect(winner).toBeDefined();
    expect(replay).toBeDefined();
    if (!winner?.ok || !replay?.ok) throw new Error('completion race did not return successful settlements');
    expect(replay.earnedPoints).toBe(winner.earnedPoints);
    expect(replay.resultData).toBe(winner.resultData);
    expect((await userRepository.findById('completion-race-user'))?.point).toBe(winner.earnedPoints);
    expect(db.prepare(`
      SELECT COUNT(*) AS count, SUM(amount) AS amount
        FROM point_ledger_entries
       WHERE user_id = ? AND source_type = 'minigame' AND source_id = ?
    `).get('completion-race-user', 'completion-race-session')).toEqual({
      count: 1,
      amount: winner.earnedPoints
    });
  });

  it('rolls back session and points when settlement ledger persistence fails', async () => {
    seedUser(db, 'completion-rollback-user');
    expect((await minigameRepository.startSession({
      id: 'completion-rollback-session',
      user_id: 'completion-rollback-user',
      game_type: 'puzzle',
      status: 'STARTED',
      target_data: JSON.stringify({ practice_mode: false }),
      validation_version: 1,
      progress_data: '{}',
      expires_at: new Date(Date.now() + 120_000).toISOString()
    }, 240)).ok).toBe(true);
    db.exec(`
      CREATE TRIGGER fail_minigame_ledger
      BEFORE INSERT ON point_ledger_entries
      WHEN NEW.source_type = 'minigame'
      BEGIN
        SELECT RAISE(ABORT, 'forced minigame ledger failure');
      END;
    `);

    await expect(minigameRepository.completeSession(
      'completion-rollback-session',
      1200,
      JSON.stringify({ correct: true })
    )).rejects.toThrow(/forced minigame ledger failure/);

    expect(db.prepare(`
      SELECT status, earned_points, completed_at, result_data
        FROM minigame_sessions
       WHERE id = ?
    `).get('completion-rollback-session')).toEqual({
      status: 'STARTED',
      earned_points: 0,
      completed_at: null,
      result_data: null
    });
    expect((await userRepository.findById('completion-rollback-user'))?.point).toBe(0);
    expect(db.prepare(`
      SELECT COUNT(*) AS count
        FROM point_ledger_entries
       WHERE user_id = ? AND source_type = 'minigame' AND source_id = ?
    `).get('completion-rollback-user', 'completion-rollback-session')).toEqual({ count: 0 });
  });
});

describe('MinigameRepository stale started session cleanup', () => {
  it('expires old paid sessions without refunding the consumed base ticket', async () => {
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
      current_tickets: 4,
      bonus_tickets: 0
    });
    expect(db.prepare('SELECT status FROM minigame_sessions WHERE id = ?').get('expired-base-session')).toEqual({
      status: 'EXPIRED'
    });
  });

  it('returns an active paid session so interrupted attempts can be closed', async () => {
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

  it('카드 삭제 보상은 뽑기비보다 비싼 카드는 포인트로, 그 외 카드는 티켓으로 지급한다', async () => {
    seedUser(db, 'delete-low-holder', 100);
    seedUser(db, 'delete-high-holder', 200);
    seedUser(db, 'delete-mixed-holder', 300);
    seedStreamer(db, 'delete-comp-channel', '삭제 보상 스트리머');
    db.prepare("UPDATE streamers SET base_value = 5000 WHERE channel_id = 'delete-comp-channel'").run();
    db.prepare("UPDATE system_configs SET value = '10000' WHERE key = 'draw_cost'").run();
    db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES ('delete-low-holder', 'delete-comp-channel', 1, 0),
             ('delete-high-holder', 'delete-comp-channel', 2, 5),
             ('delete-mixed-holder', 'delete-comp-channel', 3, 0),
             ('delete-mixed-holder', 'delete-comp-channel', 4, 4)
    `).run();

    const streamer = await streamerRepository.findById('delete-comp-channel');
    const cards = await userCardRepository.findByChannel('delete-comp-channel');
    const result = await grantCardDeletionCompensations(streamer!, cards);

    expect(result).toMatchObject({
      affected_users: 3,
      cards_removed: 4,
      total_point_refunded: 46000,
      total_free_draw_tickets_granted: 2,
      high_value_cards_refunded: 2,
      ticket_compensated_cards: 2
    });
    expect((await userRepository.findById('delete-low-holder'))?.bonus_free_draw_tickets).toBe(1);
    expect((await userRepository.findById('delete-high-holder'))?.point).toBe(25200);
    expect((await userRepository.findById('delete-mixed-holder'))?.point).toBe(21300);
    expect((await userRepository.findById('delete-mixed-holder'))?.bonus_free_draw_tickets).toBe(1);
    expect(db.prepare(`
      SELECT user_id, amount, balance_after, source_type, reason
        FROM point_ledger_entries
       WHERE source_type = 'card_delete_refund'
       ORDER BY user_id
    `).all()).toEqual([
      {
        user_id: 'delete-high-holder',
        amount: 25000,
        balance_after: 25200,
        source_type: 'card_delete_refund',
        reason: 'card_delete_refund'
      },
      {
        user_id: 'delete-mixed-holder',
        amount: 21000,
        balance_after: 21300,
        source_type: 'card_delete_refund',
        reason: 'card_delete_refund'
      }
    ]);
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

  it('한계돌파는 대상과 재료 카드에 장착된 코스메틱을 보유함으로 반환하고 슬롯을 비운다', async () => {
    seedUser(db, 'cosmetic-fuser');
    seedStreamer(db, 'cosmetic-fuse-channel', '코스메틱 한계돌파 스트리머');
    await createItem({
      type: 'border',
      name: '반환 테두리',
      description: null,
      price: 100,
      style_json: null,
      font_url: null,
      font_family: null,
      purchase_limit: 0
    });
    await createItem({
      type: 'name_effect',
      name: '반환 이름표',
      description: null,
      price: 100,
      style_json: null,
      font_url: null,
      font_family: null,
      purchase_limit: 0
    });
    const items = await getAllItems();
    const borderItem = items.find((item) => item.type === 'border')!;
    const nameItem = items.find((item) => item.type === 'name_effect')!;
    db.prepare(`
      INSERT INTO user_cosmetics (user_id, item_id, quantity)
      VALUES ('cosmetic-fuser', ?, 0),
             ('cosmetic-fuser', ?, 0)
    `).run(borderItem.id, nameItem.id);
    const targetId = Number(db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star, border_item_id)
      VALUES ('cosmetic-fuser', 'cosmetic-fuse-channel', 1, 1, ?)
    `).run(borderItem.id).lastInsertRowid);
    const materialId = Number(db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star, name_effect_item_id)
      VALUES ('cosmetic-fuser', 'cosmetic-fuse-channel', 2, 0, ?)
    `).run(nameItem.id).lastInsertRowid);

    expect(await userCardRepository.fuse('cosmetic-fuser', 'cosmetic-fuse-channel', 1)).toEqual({
      ok: true,
      reason: 'OK',
      newStar: 2
    });

    expect(db.prepare(`
      SELECT star, border_item_id, name_effect_item_id
        FROM user_cards
       WHERE id = ?
    `).get(targetId)).toEqual({
      star: 2,
      border_item_id: null,
      name_effect_item_id: null
    });
    expect(db.prepare('SELECT id FROM user_cards WHERE id = ?').get(materialId)).toBeUndefined();
    expect(db.prepare(`
      SELECT item_id, quantity
        FROM user_cosmetics
       WHERE user_id = 'cosmetic-fuser'
       ORDER BY item_id ASC
    `).all()).toEqual([
      { item_id: borderItem.id, quantity: 1 },
      { item_id: nameItem.id, quantity: 1 }
    ]);
  });
});

describe('TradeRepository 코스메틱 포함 옵션', () => {
  it('교환 체결 시 포함하지 않은 코스메틱은 원소유자에게 반환하고 포함한 코스메틱은 카드와 함께 이전한다', async () => {
    seedUser(db, 'trade-sender', 1000);
    seedUser(db, 'trade-receiver', 1000);
    seedStreamer(db, 'trade-sender-channel', '보내는 카드');
    seedStreamer(db, 'trade-receiver-channel', '받는 카드');
    const borderId = Number(db.prepare(`
      INSERT INTO shop_items (type, name, price, style_json)
      VALUES ('border', '교환 테두리', 100, '{"border":"1px solid cyan"}')
    `).run().lastInsertRowid);
    const nameEffectId = Number(db.prepare(`
      INSERT INTO shop_items (type, name, price, style_json)
      VALUES ('name_effect', '교환 이름표', 100, '{"color":"cyan"}')
    `).run().lastInsertRowid);
    db.prepare(`
      INSERT INTO user_cosmetics (user_id, item_id, quantity)
      VALUES ('trade-sender', ?, 0),
             ('trade-receiver', ?, 0)
    `).run(borderId, nameEffectId);
    const senderCardId = Number(db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star, border_item_id)
      VALUES ('trade-sender', 'trade-sender-channel', 1, 2, ?)
    `).run(borderId).lastInsertRowid);
    const receiverCardId = Number(db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star, name_effect_item_id)
      VALUES ('trade-receiver', 'trade-receiver-channel', 1, 1, ?)
    `).run(nameEffectId).lastInsertRowid);

    const trade = await tradeRepository.create({
      sender_id: 'trade-sender',
      receiver_id: 'trade-receiver',
      sender_offer: {
        cards: [{ channel_id: 'trade-sender-channel', star: 2, count: 1 }],
        point: 0,
        with_cosmetics: false
      },
      receiver_offer: {
        cards: [{ channel_id: 'trade-receiver-channel', star: 1, count: 1 }],
        point: 0
      }
    });

    expect(await tradeRepository.confirm(trade.id as number, 'trade-receiver', { receiverWithCosmetics: true }))
      .toEqual({ ok: true, reason: 'OK' });
    expect(await tradeRepository.finalize(trade.id as number, 'trade-sender'))
      .toEqual({ ok: true, reason: 'OK' });

    expect(db.prepare(`
      SELECT user_id, border_item_id, name_effect_item_id
        FROM user_cards
       WHERE id = ?
    `).get(senderCardId)).toEqual({
      user_id: 'trade-receiver',
      border_item_id: null,
      name_effect_item_id: null
    });
    expect(db.prepare(`
      SELECT user_id, border_item_id, name_effect_item_id
        FROM user_cards
       WHERE id = ?
    `).get(receiverCardId)).toEqual({
      user_id: 'trade-sender',
      border_item_id: null,
      name_effect_item_id: nameEffectId
    });
    expect(db.prepare(`
      SELECT item_id, quantity
        FROM user_cosmetics
       WHERE user_id = ?
       ORDER BY item_id ASC
    `).all('trade-sender')).toEqual([{ item_id: borderId, quantity: 1 }]);
    expect(db.prepare(`
      SELECT item_id, quantity
        FROM user_cosmetics
       WHERE user_id = ?
       ORDER BY item_id ASC
    `).all('trade-receiver')).toEqual([{ item_id: nameEffectId, quantity: 0 }]);
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
      current_bidder_id: null,
      bid_reserved: 0
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
      current_bidder_id: null,
      current_bid: 1000,
      bid_reserved: 0
    });

    expect(await marketRepository.placeBid(listing.id as number, 'auction-bidder-b', 2000)).toMatchObject({
      ok: true,
      reason: 'OK'
    });
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('auction-bidder-a')).toEqual({ point: 4000 });
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
      }
    ]);
    expect(db.prepare('SELECT current_bidder_id, current_bid, bid_reserved FROM market_listings WHERE id = ?').get(listing.id)).toEqual({
      current_bidder_id: null,
      current_bid: 1000,
      bid_reserved: 0
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
      current_bidder_id: null,
      bid_reserved: 0
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
      current_bidder_id: null,
      bid_reserved: 0
    });

    db.prepare("UPDATE market_listings SET auction_ends_at = datetime('now', '-1 minute') WHERE id = ?").run(listing.id);
    const soldListings = await marketRepository.finishExpiredAuctions(new Date().toISOString());

    expect(soldListings).toHaveLength(1);
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('auction-bidder-a')).toEqual({ point: 5000 });
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('auction-bidder-b')).toEqual({ point: 6000 });
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('auction-seller')).toEqual({ point: 950 });
    expect(db.prepare('SELECT status, buyer_id, price, fee, bid_reserved, settled_amount FROM market_listings WHERE id = ?').get(listing.id)).toEqual({
      status: 'SOLD',
      buyer_id: 'auction-bidder-b',
      price: 1000,
      fee: 50,
      bid_reserved: 0,
      settled_amount: 950
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
        reason: 'auction_lost_refund'
      },
      {
        user_id: 'auction-bidder-b',
        counterparty_user_id: 'auction-seller',
        amount: 1000,
        source_type: 'market_bid_refund',
        reason: 'auction_vickrey_refund'
      },
      {
        user_id: 'auction-seller',
        counterparty_user_id: 'auction-bidder-b',
        amount: 950,
        source_type: 'market_sale',
        reason: 'auction_sale_settlement'
      }
    ]);
  });

  it('입찰이 시작된 경매는 판매자가 취소할 수 없고 최고 입찰가와 예약금이 유지된다', async () => {
    seedUser(db, 'protected-auction-seller');
    seedUser(db, 'protected-auction-bidder', 5000);
    seedStreamer(db, 'protected-auction-channel', '취소 방지 경매');
    const cardId = Number(db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES ('protected-auction-seller', 'protected-auction-channel', 1, 0)
    `).run().lastInsertRowid);
    const listing = await marketRepository.create({
      seller_id: 'protected-auction-seller',
      user_card_id: cardId,
      price: 1000,
      listing_type: 'auction',
      starting_bid: 1000,
      auction_ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });

    expect(await marketRepository.placeBid(listing.id as number, 'protected-auction-bidder', 1800)).toMatchObject({ ok: true });
    const cancelRes = createJsonResponse();
    await cancelListing({
      user: { id: 'protected-auction-seller' },
      params: { id: String(listing.id) }
    } as any, cancelRes);
    expect(cancelRes.statusCode).toBe(409);
    expect(cancelRes.body).toMatchObject({ error: 'AuctionHasBids' });
    expect(await marketRepository.getHighestBids([listing.id as number])).toEqual({ [listing.id as number]: 1800 });
    expect(db.prepare('SELECT status FROM market_listings WHERE id = ?').get(listing.id)).toEqual({ status: 'PENDING' });
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('protected-auction-bidder')).toEqual({ point: 3200 });
    expect(db.prepare('SELECT user_id FROM user_cards WHERE id = ?').get(cardId)).toEqual({ user_id: 'protected-auction-seller' });
  });

  it('경매 가격 상세는 내 거래 이력에만 포함되고 전체 거래 이력 응답에서는 제거된다', async () => {
    seedUser(db, 'private-history-seller');
    seedUser(db, 'private-history-bidder-a', 5000);
    seedUser(db, 'private-history-bidder-b', 5000);
    seedStreamer(db, 'private-history-channel', '비공개 경매 이력');
    const cardId = Number(db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES ('private-history-seller', 'private-history-channel', 1, 0)
    `).run().lastInsertRowid);
    const listing = await marketRepository.create({
      seller_id: 'private-history-seller',
      user_card_id: cardId,
      price: 1000,
      listing_type: 'auction',
      starting_bid: 1000,
      auction_ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      fee_rate: 5
    });
    await marketRepository.placeBid(listing.id as number, 'private-history-bidder-a', 1600);
    await marketRepository.placeBid(listing.id as number, 'private-history-bidder-b', 2400);
    db.prepare("UPDATE market_listings SET auction_ends_at = datetime('now', '-1 minute') WHERE id = ?").run(listing.id);
    await marketRepository.finishExpiredAuctions(new Date().toISOString());

    const publicRes = createJsonResponse();
    await listMarketHistory({ user: { id: 'private-history-seller' }, query: { scope: 'all' } } as any, publicRes);
    expect(publicRes.body[0]).not.toHaveProperty('highest_bid');
    expect(publicRes.body[0]).not.toHaveProperty('winning_price');
    expect(publicRes.body[0]).not.toHaveProperty('auction_result');
    expect(publicRes.body[0]).not.toHaveProperty('current_bid');

    const privateRes = createJsonResponse();
    await listMarketHistory({ user: { id: 'private-history-seller' }, query: { scope: 'mine' } } as any, privateRes);
    expect(privateRes.body[0]).toMatchObject({
      id: listing.id,
      highest_bid: 2400,
      winning_price: 1600
    });
    expect(privateRes.body[0]).not.toHaveProperty('auction_result');
  });

  it('오픈마켓 등록 API는 9자리를 넘는 판매가와 경매가를 저장 전에 거부한다', async () => {
    const fixedRes = createJsonResponse();
    await createListing({
      user: { id: 'price-limit-user' },
      body: { user_card_id: 1, listing_type: 'fixed', price: 1_000_000_000 }
    } as any, fixedRes);
    expect(fixedRes.statusCode).toBe(400);
    expect(fixedRes.body).toMatchObject({ error: 'PriceTooHigh' });

    const auctionRes = createJsonResponse();
    await createListing({
      user: { id: 'price-limit-user' },
      body: { user_card_id: 1, listing_type: 'auction', starting_bid: 1_000_000_000, auction_hours: 24 }
    } as any, auctionRes);
    expect(auctionRes.statusCode).toBe(400);
    expect(auctionRes.body).toMatchObject({ error: 'PriceTooHigh' });
  });

  it('같은 사용자가 재입찰하면 이전 예약금을 환불한 뒤 새 입찰금 전체를 다시 예약한다', async () => {
    seedUser(db, 'rebid-seller');
    seedUser(db, 'rebid-bidder', 5000);
    seedStreamer(db, 'rebid-channel', '재입찰 스트리머');
    const cardId = Number(db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES ('rebid-seller', 'rebid-channel', 1, 0)
    `).run().lastInsertRowid);

    const listing = await marketRepository.create({
      seller_id: 'rebid-seller',
      user_card_id: cardId,
      price: 1000,
      listing_type: 'auction',
      starting_bid: 1000,
      auction_ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      fee_rate: 5
    });

    expect(await marketRepository.placeBid(listing.id as number, 'rebid-bidder', 3000)).toMatchObject({ ok: true });
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('rebid-bidder')).toEqual({ point: 2000 });

    expect(await marketRepository.placeBid(listing.id as number, 'rebid-bidder', 4500)).toMatchObject({ ok: true });
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('rebid-bidder')).toEqual({ point: 500 });

    expect(await marketRepository.placeBid(listing.id as number, 'rebid-bidder', 1200)).toMatchObject({ ok: true });
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('rebid-bidder')).toEqual({ point: 3800 });

    expect(await marketRepository.placeBid(listing.id as number, 'rebid-bidder', 6000)).toMatchObject({
      ok: false,
      reason: 'INSUFFICIENT_POINT'
    });
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('rebid-bidder')).toEqual({ point: 3800 });
    expect(db.prepare(`
      SELECT amount FROM market_bids
       WHERE listing_id = ? AND bidder_id = ?
       ORDER BY id DESC LIMIT 1
    `).get(listing.id, 'rebid-bidder')).toEqual({ amount: 1200 });

    expect(db.prepare(`
      SELECT amount, source_type, reason
        FROM point_ledger_entries
       WHERE source_id = ?
       ORDER BY id ASC
    `).all(String(listing.id))).toEqual([
      { amount: -3000, source_type: 'market_bid', reason: 'auction_bid_reserved' },
      { amount: 3000, source_type: 'market_bid_refund', reason: 'auction_bid_adjust_refund' },
      { amount: -4500, source_type: 'market_bid', reason: 'auction_bid_reserved' },
      { amount: 4500, source_type: 'market_bid_refund', reason: 'auction_bid_adjust_refund' },
      { amount: -1200, source_type: 'market_bid', reason: 'auction_bid_reserved' }
    ]);

    const active = await marketRepository.listActive({
      page: 1,
      limit: 12,
      sort: 'latest',
      type: 'all',
      bidderId: 'rebid-bidder'
    });
    expect(active.listings.find((item) => item.id === listing.id)).toMatchObject({
      id: listing.id,
      my_bid: 1200,
      current_bidder_id: null,
      bid_reserved: 0
    });
  });

  it('단독 유효 입찰자는 시작가로 낙찰되고 초과 예약금을 환불받는다', async () => {
    seedUser(db, 'single-vickrey-seller');
    seedUser(db, 'single-vickrey-bidder', 5000);
    seedStreamer(db, 'single-vickrey-channel', '단독 빅크리 스트리머');
    const cardId = Number(db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES ('single-vickrey-seller', 'single-vickrey-channel', 1, 0)
    `).run().lastInsertRowid);

    const listing = await marketRepository.create({
      seller_id: 'single-vickrey-seller',
      user_card_id: cardId,
      price: 1000,
      listing_type: 'auction',
      starting_bid: 1000,
      auction_ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      fee_rate: 5
    });

    expect(await marketRepository.placeBid(listing.id as number, 'single-vickrey-bidder', 3000)).toMatchObject({ ok: true });
    db.prepare("UPDATE market_listings SET auction_ends_at = datetime('now', '-1 minute') WHERE id = ?").run(listing.id);
    await marketRepository.finishExpiredAuctions(new Date().toISOString());

    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('single-vickrey-bidder')).toEqual({ point: 4000 });
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('single-vickrey-seller')).toEqual({ point: 950 });
    expect(db.prepare('SELECT status, buyer_id, price, fee, settled_amount FROM market_listings WHERE id = ?').get(listing.id)).toEqual({
      status: 'SOLD',
      buyer_id: 'single-vickrey-bidder',
      price: 1000,
      fee: 50,
      settled_amount: 950
    });
  });

  it('만료 경매 정리는 상세 조인이 불가능한 오류 데이터도 방치하지 않고 다른 경매까지 처리한다', async () => {
    seedUser(db, 'broken-auction-seller');
    seedUser(db, 'healthy-auction-seller');
    seedUser(db, 'healthy-auction-bidder', 5000);
    seedStreamer(db, 'healthy-auction-channel', '정상 경매 스트리머');
    const cardId = Number(db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES ('healthy-auction-seller', 'healthy-auction-channel', 1, 0)
    `).run().lastInsertRowid);

    db.pragma('foreign_keys = OFF');
    const brokenListingId = Number(db.prepare(`
      INSERT INTO market_listings
        (seller_id, user_card_id, price, status, listing_type, starting_bid, current_bid, auction_ends_at, bid_reserved, fee_rate, with_cosmetics)
      VALUES
        ('broken-auction-seller', 999999, 1000, 'PENDING', 'auction', 1000, 1000, datetime('now', '-2 minute'), 0, 5, 0)
    `).run().lastInsertRowid);
    db.pragma('foreign_keys = ON');

    const healthyListing = await marketRepository.create({
      seller_id: 'healthy-auction-seller',
      user_card_id: cardId,
      price: 1000,
      listing_type: 'auction',
      starting_bid: 1000,
      auction_ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });
    expect(await marketRepository.placeBid(healthyListing.id as number, 'healthy-auction-bidder', 1500)).toMatchObject({ ok: true });
    db.prepare("UPDATE market_listings SET auction_ends_at = datetime('now', '-1 minute') WHERE id = ?").run(healthyListing.id);

    const completed = await marketRepository.finishExpiredAuctions(new Date().toISOString());

    expect(completed.map((listing) => ({ id: listing.id, status: listing.status }))).toEqual(
      expect.arrayContaining([
        { id: brokenListingId, status: 'AUCTION_ENDED' },
        { id: healthyListing.id, status: 'SOLD' }
      ])
    );
    expect(db.prepare('SELECT status, bid_reserved FROM market_listings WHERE id = ?').get(brokenListingId)).toEqual({
      status: 'AUCTION_ENDED',
      bid_reserved: 0
    });
    expect(db.prepare('SELECT status, buyer_id, bid_reserved FROM market_listings WHERE id = ?').get(healthyListing.id)).toEqual({
      status: 'SOLD',
      buyer_id: 'healthy-auction-bidder',
      bid_reserved: 0
    });
  });

  it('최신순 오픈마켓 목록은 입찰 활동과 무관하게 등록 시각(created_at)을 유지한다', async () => {
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

    expect((await marketRepository.listActive({ page: 1, limit: 2, sort: 'latest', type: 'all' })).listings[0].id).toBe(newer.id);
  });

  it('오픈마켓 활성 목록은 만료 경매를 제외하고 경매 시작가 기준으로 가격 정렬한다', async () => {
    seedUser(db, 'market-sort-seller-a');
    seedUser(db, 'market-sort-seller-b');
    seedUser(db, 'market-sort-bidder', 10000);
    seedStreamer(db, 'market-sort-channel-a', '정렬 A');
    seedStreamer(db, 'market-sort-channel-b', '정렬 B');
    const cardA = Number(db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES ('market-sort-seller-a', 'market-sort-channel-a', 1, 0)
    `).run().lastInsertRowid);
    const cardB = Number(db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES ('market-sort-seller-b', 'market-sort-channel-b', 1, 0)
    `).run().lastInsertRowid);

    const auction = await marketRepository.create({
      seller_id: 'market-sort-seller-a',
      user_card_id: cardA,
      price: 5000,
      listing_type: 'auction',
      starting_bid: 1000,
      auction_ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });
    const fixed = await marketRepository.create({
      seller_id: 'market-sort-seller-b',
      user_card_id: cardB,
      price: 3000
    });

    expect((await marketRepository.listActive({ page: 1, limit: 2, sort: 'price_desc', type: 'all' })).listings.map((item) => item.id))
      .toEqual([fixed.id, auction.id]);

    expect(await marketRepository.placeBid(auction.id as number, 'market-sort-bidder', 4000)).toMatchObject({ ok: true });
    expect((await marketRepository.listActive({ page: 1, limit: 2, sort: 'price_desc', type: 'all' })).listings.map((item) => item.id))
      .toEqual([fixed.id, auction.id]);

    db.prepare("UPDATE market_listings SET auction_ends_at = datetime('now', '-1 minute') WHERE id = ?").run(auction.id);
    const activeAfterEnd = await marketRepository.listActive({ page: 1, limit: 10, sort: 'ending_soon', type: 'bidding', bidderId: 'market-sort-bidder' });
    expect(activeAfterEnd.total).toBe(0);
  });

  it('완료/취소된 내 등록 매물은 화면에서만 숨기고 DB 기록은 유지한다', async () => {
    seedUser(db, 'hide-seller');
    seedUser(db, 'hide-buyer', 10000);
    seedStreamer(db, 'hide-channel', '숨김 스트리머');
    const cardId = Number(db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES ('hide-seller', 'hide-channel', 1, 0)
    `).run().lastInsertRowid);
    const recentCardId = Number(db.prepare(`
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES ('hide-seller', 'hide-channel', 2, 0)
    `).run().lastInsertRowid);

    const listing = await marketRepository.create({
      seller_id: 'hide-seller',
      user_card_id: cardId,
      price: 1000
    });
    expect(await marketRepository.buyAtomic(listing.id as number, 'hide-buyer')).toMatchObject({ ok: true });
    const soldUpdatedAt = '2026-01-01T00:00:00.000Z';
    db.prepare('UPDATE market_listings SET updated_at = ? WHERE id = ?').run(soldUpdatedAt, listing.id);
    const recentListing = await marketRepository.create({
      seller_id: 'hide-seller',
      user_card_id: recentCardId,
      price: 2000
    });
    expect(await marketRepository.buyAtomic(recentListing.id as number, 'hide-buyer')).toMatchObject({ ok: true });
    db.prepare('UPDATE market_listings SET updated_at = ? WHERE id = ?').run('2026-01-02T00:00:00.000Z', recentListing.id);
    expect(await marketRepository.getRecentPrice('hide-channel')).toBe(2000);

    expect(await marketRepository.hideForSeller(listing.id as number, 'hide-seller')).toBe(true);
    const visibleMyListings = await marketRepository.listByUser('hide-seller');
    expect(visibleMyListings.map((item) => item.id)).not.toContain(listing.id);
    expect(visibleMyListings.map((item) => item.id)).toContain(recentListing.id);
    expect(db.prepare('SELECT status, seller_hidden_at, updated_at FROM market_listings WHERE id = ?').get(listing.id)).toEqual({
      status: 'SOLD',
      seller_hidden_at: expect.any(String),
      updated_at: soldUpdatedAt
    });
    expect(await marketRepository.getRecentPrice('hide-channel')).toBe(2000);
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

describe('shopService 판매 활성 상태', () => {
  it('비활성 상품을 활성화하면 관리자 목록과 판매 목록에 즉시 반영된다', async () => {
    await createItem({
      type: 'border', name: '활성화 테스트 테두리', description: null, price: 1000,
      style_json: null, font_url: null, font_family: null, purchase_limit: 0, active: false
    });
    const [created] = await getAllItems();

    expect(created.active).toBe(false);
    expect(await getActiveItems()).toEqual([]);

    await updateItem(created.id, { active: true });

    expect((await getAllItems())[0].active).toBe(true);
    await expect(getActiveItems()).resolves.toMatchObject([{ id: created.id, active: true }]);
  });
});
