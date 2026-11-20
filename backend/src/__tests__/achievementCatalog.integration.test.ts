import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { __setSqliteDbForTest } from '../services/db';
import { additionalAchievements } from '../services/achievementCatalog';
import {
  claimAchievementReward, ensureAchievementTables, listAchievements, listUserAchievements, validateAchievementPayload
} from '../services/achievementService';
import { ensureWeeklyMissionTables } from '../services/weeklyMissionSchema';

const owner = 'catalog-test';
describe('expanded permanent achievements', () => {
  let db: Database.Database;
  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(fs.readFileSync(path.join(__dirname, '../../../init-db.sql'), 'utf8'));
    __setSqliteDbForTest(db);
    await ensureAchievementTables();
    db.prepare("INSERT INTO users (id, username, point, bonus_free_draw_tickets) VALUES (?, ?, 1000, 0)").run(owner, owner);
  });
  afterEach(() => { __setSqliteDbForTest(null); db.close(); });

  it('seeds distinct, editable goals and preserves customizations and awarded state across restarts', async () => {
    const catalog = await listAchievements();
    const goals = catalog.map(a => a.criteria_json.type === 'stat' ? [a.criteria_json] : a.criteria_json.conditions);
    expect(new Set(goals.map(conditions => conditions.map(c => c.metric + '=' + c.target).sort().join('|'))).size).toBe(catalog.length);
    expect(new Set(catalog.map(a => a.code)).size).toBe(catalog.length);
    for (const entry of additionalAchievements) {
      expect(validateAchievementPayload(entry), entry.code).toMatchObject({ ok: true });
      expect(catalog.find(a => a.code === entry.code)).toMatchObject(entry);
    }
    const legacy = catalog.find(a => a.code === 'first_card')!;
    db.prepare("UPDATE achievements SET name = '운영자 수정', is_active = 0 WHERE id = ?").run(legacy.id);
    db.prepare("INSERT INTO user_achievements(user_id, achievement_id, status, repeat_key) VALUES (?, ?, 'claimed', 'once')").run(owner, legacy.id);
    db.prepare("DELETE FROM achievements WHERE code = 'mission_full_week'").run();
    const saved = db.serialize();
    db.close();
    db = new Database(saved);
    __setSqliteDbForTest(db);
    const reloaded = await listAchievements({ includeInactive: true });
    expect(reloaded).toHaveLength(catalog.length);
    expect(reloaded.find(a => a.id === legacy.id)).toMatchObject({ name: '운영자 수정', is_active: false });
    expect(reloaded.find(a => a.code === 'mission_full_week')).toBeDefined();
    expect(db.prepare('SELECT status FROM user_achievements WHERE achievement_id = ?').get(legacy.id)).toEqual({ status: 'claimed' });
  });

  it('upgrades only matching legacy titles once, keeping claims and administrator edits', async () => {
    const restart = () => {
      const saved = db.serialize();
      db.close();
      db = new Database(saved);
      __setSqliteDbForTest(db);
    };
    const title = (code: string) => db.prepare('SELECT name FROM achievements WHERE code = ?').pluck().get(code);
    db.exec(`
      DELETE FROM system_configs WHERE key = 'achievement_names_2026_11_20';
      UPDATE achievements SET name = '첫 마켓 구매' WHERE code = 'first_market_purchase';
      UPDATE achievements SET name = '운영자가 정한 이름' WHERE code = 'arcade_guest_spotter';
      INSERT INTO achievements(code, name, category, criteria_json)
        VALUES ('100_minigame_win', '백전백승', 'minigame', '{"type":"stat","metric":"minigame.success.count","target":100}');
    `);
    const id = db.prepare("SELECT id FROM achievements WHERE code = '100_minigame_win'").pluck().get();
    db.prepare(`INSERT INTO user_achievements(user_id, achievement_id, status, progress_current, progress_target, claimed_at)
      VALUES (?, ?, 'claimed', 100, 100, '2026-11-01T00:00:00Z')`).run(owner, id);
    db.prepare("INSERT INTO achievement_grant_logs(user_id, achievement_id, repeat_key, status) VALUES (?, ?, 'once', 'success')").run(owner, id);
    db.exec(`CREATE TRIGGER reject_rename BEFORE UPDATE OF name ON achievements WHEN old.code = '100_minigame_win'
      BEGIN SELECT RAISE(ABORT, 'rename interrupted'); END`);
    restart();
    await expect(ensureAchievementTables()).rejects.toThrow('rename interrupted');
    expect(title('first_market_purchase')).toBe('첫 마켓 구매');
    db.exec('DROP TRIGGER reject_rename');
    await ensureAchievementTables();
    expect(title('first_market_purchase')).toBe('장터에서 산 첫 카드');
    expect(title('arcade_guest_spotter')).toBe('운영자가 정한 이름');
    const view = (await listUserAchievements(owner)).items.find(a => a.achievement_id === id);
    expect(view).toMatchObject({ name: '백 번째 승리', status: 'claimed', progress_current: 100, progress_target: 100,
      claimed_at: '2026-11-01T00:00:00Z' });
    expect(db.prepare('SELECT status FROM achievement_grant_logs WHERE user_id = ? AND achievement_id = ?').pluck().get(owner, id)).toBe('success');
    expect((await claimAchievementReward(owner, Number(id))).reason).toBe('ALREADY_CLAIMED');
    db.exec("UPDATE achievements SET name = '백전백승' WHERE code = '100_minigame_win'");
    restart();
    await ensureAchievementTables();
    expect(title('100_minigame_win')).toBe('백전백승');
  });

  it('credits past game counts, reveals secrets on completion and grants both tickets exactly once', async () => {
    const secretId = (await listAchievements()).find(a => a.code === 'secret_festival_staff')!.id;
    const setCount = db.prepare(`INSERT INTO user_achievement_stats(user_id, stat_key, stat_value) VALUES (?, ?, ?)
      ON CONFLICT(user_id, stat_key) DO UPDATE SET stat_value = excluded.stat_value`);
    for (const game of ['quiz', 'match', 'fan_meeting', 'streamer_catch']) setCount.run(owner, 'minigame.success.' + game + '.count', 10);
    const before = (await listUserAchievements(owner)).items;
    expect(before.find(a => a.code === 'arcade_five_stations')).toMatchObject({ status: 'in_progress', progress_current: 12, progress_target: 15 });
    expect(before.find(a => a.achievement_id === secretId)).toMatchObject({ name: '???', code: null, rewards: null, progress_current: null });
    setCount.run(owner, 'minigame.success.sequence_relay.count', 10);
    const after = (await listUserAchievements(owner)).items;
    const arcade = after.find(a => a.code === 'arcade_five_stations')!;
    expect(arcade.status).toBe('completed');
    expect(after.find(a => a.achievement_id === secretId)).toMatchObject({ code: 'secret_festival_staff', status: 'completed' });
    const claims = await Promise.all([claimAchievementReward(owner, arcade.achievement_id), claimAchievementReward(owner, arcade.achievement_id)]);
    expect(claims.map(c => c.reason).sort()).toEqual(['ALREADY_CLAIMED', 'OK']);
    expect(db.prepare('SELECT bonus_free_draw_tickets FROM users WHERE id=?').get(owner)).toEqual({ bonus_free_draw_tickets: 1 });
    expect(db.prepare('SELECT bonus_tickets FROM user_minigame_tickets WHERE user_id=?').get(owner)).toEqual({ bonus_tickets: 1 });
    expect((await listUserAchievements(owner)).items.find(a => a.code === arcade.code)?.status).toBe('claimed');
  });

  it('requires both collection breadth and size, and counts only cosmetic stock the collector still owns', async () => {
    const addStreamer = db.prepare('INSERT INTO streamers(channel_id, name) VALUES (?, ?)');
    const addCard = db.prepare('INSERT INTO user_cards(user_id, channel_id, serial_number) VALUES (?, ?, ?)');
    db.transaction(() => {
      for (let i = 0; i < 200; i++) addStreamer.run('ch-' + i, '스트리머 ' + i);
      for (let i = 0; i < 2500; i++) addCard.run(owner, 'ch-' + (i % 199), Math.floor(i / 199) + 1);
      for (let id = 1; id <= 5; id++) {
        db.prepare("INSERT INTO shop_items(id, type, name) VALUES (?, 'border', ?)").run(id, '테두리 ' + id);
        db.prepare('INSERT INTO user_cosmetics(user_id, item_id, quantity) VALUES (?, ?, ?)').run(owner, id, id === 5 ? 0 : 1);
      }
    })();
    const before = (await listUserAchievements(owner)).items;
    expect(before.find(a => a.code === 'album_grand_archive')).toMatchObject({ status: 'in_progress', progress_current: 2699 });
    expect(before.find(a => a.code === 'economy_wardrobe')).toMatchObject({ status: 'in_progress', progress_current: 4 });
    db.prepare("UPDATE user_cards SET channel_id = 'ch-199' WHERE id = 2500").run();
    db.prepare('UPDATE user_cosmetics SET quantity=1 WHERE user_id=? AND item_id=5').run(owner);
    const after = (await listUserAchievements(owner)).items;
    expect(after.find(a => a.code === 'album_grand_archive')?.status).toBe('completed');
    expect(after.find(a => a.code === 'economy_wardrobe')?.status).toBe('completed');
  });

  it('counts weekly rewards by owner and week, including retained assignments from earlier weeks', async () => {
    await ensureWeeklyMissionTables();
    const insert = db.prepare(`INSERT INTO weekly_mission_assignments
      (user_id, week_key, slot, mission_code, difficulty, families_json, title, description, conditions_json, reward_points, claimed_at)
      VALUES (?, ?, ?, ?, 'easy', '[]', '미션', '', '[]', 500, ?)`);
    for (let slot = 0; slot < 5; slot++) {
      insert.run(owner, '2026-11-02', slot, 'mission-' + slot, slot < 4 ? '2026-11-07' : null);
      insert.run(owner, '2026-11-09', slot, 'mission-' + slot, slot === 0 ? '2026-11-11' : null);
      insert.run('other', '2026-11-02', slot, 'mission-' + slot, '2026-11-07');
    }
    const before = (await listUserAchievements(owner)).items;
    const first = before.find(a => a.code === 'mission_first_stamp')!;
    expect(first).toMatchObject({ status: 'completed', progress_current: 5 });
    expect(before.find(a => a.code === 'mission_full_week')?.status).toBe('locked');
    expect((await claimAchievementReward(owner, first.achievement_id)).new_points).toBe(1500);
    expect((await claimAchievementReward(owner, first.achievement_id)).reason).toBe('ALREADY_CLAIMED');
    db.prepare("UPDATE weekly_mission_assignments SET claimed_at='2026-11-08' WHERE user_id=? AND week_key='2026-11-02' AND slot=4").run(owner);
    const after = (await listUserAchievements(owner)).items;
    expect(after.find(a => a.code === 'mission_full_week')?.status).toBe('completed');
    expect(after.find(a => a.code === 'mission_four_full_weeks')).toMatchObject({ status: 'in_progress', progress_current: 1, progress_target: 4 });
  });
});
