import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { __setSqliteDbForTest } from '../services/db';
import { createAchievement, listUserAchievements } from '../services/achievementService';

describe('point balance achievement snapshot', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(fs.readFileSync(path.join(__dirname, '../../../init-db.sql'), 'utf8'));
    __setSqliteDbForTest(db);
  });

  afterEach(() => {
    __setSqliteDbForTest(null);
    db.close();
  });

  it('부가 스냅샷 조회가 실패해도 현재 포인트로 숨김 업적을 완료한다', async () => {
    db.prepare("INSERT INTO users (id, username, avatar_url, role, point) VALUES (?, ?, NULL, 'USER', ?)")
      .run('point-achievement-user', '포인트 유저', 50_000);
    const created = await createAchievement({
      code: 'hidden_point_balance_test',
      name: '포인트 숨김 업적',
      description: '충분한 포인트를 보유했습니다.',
      category: 'hidden',
      tier: 'bronze',
      icon: 'Coins',
      is_active: true,
      is_hidden: true,
      hidden_hint: '포인트를 모아 보세요.',
      repeat_policy: 'once',
      claim_policy: 'manual',
      progress_mode: 'snapshot',
      criteria_json: { type: 'stat', metric: 'user.point_balance', target: 40_000 },
      rewards_json: []
    }, null);
    expect(created.ok).toBe(true);

    // 기존 구현은 연관 없는 스냅샷 테이블 하나만 없어도 point_balance까지 갱신하지 못했습니다.
    db.exec('DROP TABLE market_watches');

    const result = await listUserAchievements('point-achievement-user', { hidden: 'true' });
    const achievement = result.items.find((item) => item.code === 'hidden_point_balance_test');
    expect(achievement).toMatchObject({
      name: '포인트 숨김 업적',
      status: 'completed',
      progress_current: 50_000,
      progress_target: 40_000
    });
  });
});
