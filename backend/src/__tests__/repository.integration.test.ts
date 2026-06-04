import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { __setSqliteDbForTest } from '../services/db';
import { initRepositories, reportRepository, userRepository, streamerRepository } from '../repositories';
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
