import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { __setSqliteDbForTest } from '../services/db';
import { createAchievement, listUserAchievements } from '../services/achievementService';

describe('repeating achievement state selection', () => {
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

  it('과거 기간의 미달성 기록 대신 현재 기간의 달성 기록을 표시한다', async () => {
    const userId = 'repeat-achievement-user';
    db.prepare("INSERT INTO users (id, username, avatar_url, role, point) VALUES (?, ?, NULL, 'USER', ?)")
      .run(userId, '반복 업적 유저', 50_000);

    const created = await createAchievement({
      code: 'hidden_daily_point_test',
      name: '오늘의 포인트 업적',
      description: '오늘의 포인트 조건을 달성했습니다.',
      category: 'hidden',
      tier: 'bronze',
      icon: 'Coins',
      is_active: true,
      is_hidden: true,
      hidden_hint: '포인트를 모아 보세요.',
      repeat_policy: 'daily',
      claim_policy: 'manual',
      progress_mode: 'snapshot',
      criteria_json: { type: 'stat', metric: 'user.point_balance', target: 40_000 },
      rewards_json: []
    }, null);
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.message);

    const firstResult = await listUserAchievements(userId, { hidden: 'true' });
    expect(firstResult.items.find((item) => item.achievement_id === created.achievement.id)?.status).toBe('completed');

    // 현재 기록보다 나중에 삽입된 과거 기록이 있어도 현재 반복 기간의 상태만 보여야 합니다.
    db.prepare(`
      INSERT INTO user_achievements
        (user_id, achievement_id, status, progress_current, progress_target, progress_json, repeat_key)
      VALUES (?, ?, 'locked', 0, 40000, '{}', '2000-01-01')
    `).run(userId, created.achievement.id);

    const result = await listUserAchievements(userId, { hidden: 'true' });
    const achievement = result.items.find((item) => item.achievement_id === created.achievement.id);
    expect(achievement).toMatchObject({
      code: 'hidden_daily_point_test',
      name: '오늘의 포인트 업적',
      status: 'completed',
      progress_current: 50_000,
      progress_target: 40_000
    });
    expect(result.summary.completed).toBe(1);
  });
});
