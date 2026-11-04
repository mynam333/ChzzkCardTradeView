import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { __setSqliteDbForTest } from '../services/db';
import { SqliteUserCardRepository } from '../repositories/sqlite/userCard.repository';

let db: Database.Database;
let repository: SqliteUserCardRepository;

const seedUser = (id: string) => {
  db.prepare("INSERT INTO users (id, username, avatar_url, role, point) VALUES (?, ?, NULL, 'USER', 0)")
    .run(id, id);
};

const seedCard = (userId: string, serial: number) => Number(db.prepare(
  "INSERT INTO user_cards (user_id, channel_id, serial_number, star) VALUES (?, 'bulk-channel', ?, 0)"
).run(userId, serial).lastInsertRowid);

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(__dirname, '../../../init-db.sql'), 'utf8'));
  __setSqliteDbForTest(db);
  repository = new SqliteUserCardRepository();
  seedUser('owner');
  seedUser('other');
  db.prepare("INSERT INTO streamers (channel_id, name, logo_url, follower_count, activity_score, base_value, is_active) VALUES ('bulk-channel', 'bulk', NULL, 0, 0, 100, 0)").run();
});

afterEach(() => db.close());

describe('SqliteUserCardRepository.updateSettingsBulk', () => {
  it('200장 mixed visibility와 타인 카드 실패를 한 트랜잭션 결과로 반환한다', async () => {
    const ownedIds = Array.from({ length: 200 }, (_, index) => seedCard('owner', index + 1));
    const foreignId = seedCard('other', 1000);
    const updates = [
      ...ownedIds.map((cardId, index) => ({ card_id: cardId, value: index % 2 === 0 })),
      { card_id: foreignId, value: true }
    ];

    const succeeded = await repository.updateSettingsBulk('owner', 'hidden', updates);

    expect(succeeded).toEqual(ownedIds);
    const rows = db.prepare('SELECT id, is_hidden FROM user_cards WHERE user_id = ? ORDER BY id').all('owner') as Array<{ id: number; is_hidden: number }>;
    expect(rows).toHaveLength(200);
    expect(rows.every((row, index) => row.is_hidden === (index % 2 === 0 ? 1 : 0))).toBe(true);
    expect((db.prepare('SELECT is_hidden FROM user_cards WHERE id = ?').get(foreignId) as any).is_hidden).toBe(0);
  });

  it('favorite 중간 해제 후 MAX+1 입력순을 보존하고 pending market 잠금을 재검사한다', async () => {
    const first = seedCard('owner', 1);
    const highest = seedCard('owner', 2);
    const next = seedCard('owner', 3);
    const pending = seedCard('owner', 4);
    db.prepare("UPDATE user_cards SET favorite_order = CASE id WHEN ? THEN 5 WHEN ? THEN 10 END, favorite_at = datetime('now') WHERE id IN (?, ?)")
      .run(first, highest, first, highest);

    expect(await repository.updateSettingsBulk('owner', 'favorite', [
      { card_id: highest, value: false },
      { card_id: next, value: true },
      { card_id: pending, value: true }
    ])).toEqual([highest, next, pending]);
    const favorites = db.prepare('SELECT id, favorite_order FROM user_cards WHERE id IN (?, ?, ?, ?) ORDER BY id')
      .all(first, highest, next, pending) as Array<{ id: number; favorite_order: number | null }>;
    expect(favorites.map((row) => [row.id, row.favorite_order])).toEqual([
      [first, 5],
      [highest, null],
      [next, 6],
      [pending, 7]
    ]);

    db.prepare("INSERT INTO market_listings (seller_id, user_card_id, price, status) VALUES ('owner', ?, 100, 'PENDING')")
      .run(pending);
    expect(await repository.updateSettingsBulk('owner', 'locked', [
      { card_id: next, value: true },
      { card_id: pending, value: true }
    ])).toEqual([next]);
    expect((db.prepare('SELECT is_locked FROM user_cards WHERE id = ?').get(next) as any).is_locked).toBe(1);
    expect((db.prepare('SELECT is_locked FROM user_cards WHERE id = ?').get(pending) as any).is_locked).toBe(0);
  });
});
