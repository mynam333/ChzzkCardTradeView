import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { __setSqliteDbForTest } from '../services/db';
import { WEEKLY_MISSION_CATALOG, scheduledMinigameForKstDate, weeklyMissionReward } from '../services/weeklyMissionCatalog';
import { __resetWeeklyMissionSchemaForTest } from '../services/weeklyMissionSchema';
import { claimWeeklyMission, getWeeklyMissionWindow, getWeeklyMissions } from '../services/weeklyMissionService';
import { getDailyMinigame } from '../controllers/minigameController';
import { ensureAchievementTables } from '../services/achievementService';

const TEST_NOW = Date.parse('2026-11-18T03:00:00.000Z'); // Wednesday 12:00 KST
const COMPLETE_NOW = Date.parse('2026-11-22T14:00:00.000Z'); // Sunday 23:00 KST

describe('weekly missions', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(fs.readFileSync(path.join(__dirname, '../../../init-db.sql'), 'utf8'));
    __setSqliteDbForTest(db);
    __resetWeeklyMissionSchemaForTest();
    await ensureAchievementTables();
  });

  afterEach(() => {
    __setSqliteDbForTest(null);
    db.close();
  });

  const createUser = (id: string, createdAt = '2026-01-01 00:00:00') => {
    db.prepare("INSERT INTO users (id, username, avatar_url, role, point, bonus_free_draw_tickets, created_at) VALUES (?, ?, NULL, 'USER', 10000, 0, ?)")
      .run(id, id, createdAt);
  };

  const addEvent = (userId: string, eventKey: string, eventType: string, occurredAt: string, options: { value?: number; sourceId?: string; metadata?: Record<string, unknown> } = {}) => {
    db.prepare(`INSERT INTO achievement_events (event_key, user_id, event_type, source_type, source_id, value, metadata_json, occurred_at)
      VALUES (?, ?, ?, 'test', ?, ?, ?, ?)`).run(eventKey, userId, eventType, options.sourceId ?? null, options.value ?? 1, JSON.stringify(options.metadata || {}), occurredAt);
  };

  const addCompletedWeek = (userId: string) => {
    const days = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];
    days.forEach((day, index) => addEvent(userId, `login:${day}`, 'login.daily', `${day}T00:10:00.000Z`, { sourceId: day }));
    const games = ['quiz', 'match', 'fan_meeting', 'streamer_catch', 'sequence_relay'];
    for (let index = 0; index < 45; index += 1) {
      const occurredAt = `2026-11-${String(16 + (index % 7)).padStart(2, '0')}T0${index % 9}:20:00.000Z`;
      addEvent(userId, `game:${index}`, 'minigame.success', occurredAt, { metadata: { game_type: games[index % games.length] } });
      addEvent(userId, `draw:${index}`, 'card.acquired', occurredAt, { value: 2 });
      addEvent(userId, `fuse:${index}`, 'card.fused', occurredAt, { metadata: { channel_id: `channel-${index % 8}` } });
      addEvent(userId, `sell:${index}`, 'card.sold', occurredAt, { value: 2 });
      addEvent(userId, `trade:${index}`, 'trade.completed', occurredAt, { metadata: { counterparty_user_id: `trader-${index % 8}` } });
      addEvent(userId, `buy:${index}`, 'market.purchase', occurredAt, { metadata: { seller_id: `seller-${index % 8}` } });
      addEvent(userId, `sale:${index}`, 'market.sale', occurredAt, { metadata: { buyer_id: `buyer-${index % 8}` } });
    }
  };

  it('has a large balanced catalog and a weekly reward band of 8,000 points', () => {
    expect(WEEKLY_MISSION_CATALOG).toHaveLength(72);
    expect(WEEKLY_MISSION_CATALOG.filter((item) => item.difficulty === 'easy')).toHaveLength(24);
    expect(WEEKLY_MISSION_CATALOG.filter((item) => item.difficulty === 'normal')).toHaveLength(24);
    expect(WEEKLY_MISSION_CATALOG.filter((item) => item.difficulty === 'hard')).toHaveLength(24);
    expect(weeklyMissionReward('easy').points * 2 + weeklyMissionReward('normal').points * 2 + weeklyMissionReward('hard').points).toBe(8000);
  });

  it('resets exactly at Monday 00:00 KST', () => {
    expect(getWeeklyMissionWindow(Date.parse('2026-11-15T14:59:59.999Z')).week_key).toBe('2026-11-09');
    const monday = getWeeklyMissionWindow(Date.parse('2026-11-15T15:00:00.000Z'));
    expect(monday.week_key).toBe('2026-11-16');
    expect(monday.starts_at).toBe('2026-11-15T15:00:00.000Z');
    expect(monday.ends_at).toBe('2026-11-22T15:00:00.000Z');
  });

  it('matches the public daily minigame schedule algorithm', () => {
    for (let day = 16; day <= 22; day += 1) {
      const key = `2026-11-${day}`;
      const noonKst = Date.parse(`${key}T03:00:00.000Z`);
      expect(scheduledMinigameForKstDate(key)).toBe(getDailyMinigame(noonKst).game_type);
    }
  });

  it('persists deterministic easy2/normal2/hard1 assignments without overlapping families', async () => {
    createUser('deterministic-user');
    const first = await getWeeklyMissions('deterministic-user', TEST_NOW);
    const second = await getWeeklyMissions('deterministic-user', TEST_NOW + 60_000);
    expect(second.missions.map((item) => item.mission_code)).toEqual(first.missions.map((item) => item.mission_code));
    expect(first.missions.filter((item) => item.difficulty === 'easy')).toHaveLength(2);
    expect(first.missions.filter((item) => item.difficulty === 'normal')).toHaveLength(2);
    expect(first.missions.filter((item) => item.difficulty === 'hard')).toHaveLength(1);
    const rows = db.prepare('SELECT families_json FROM weekly_mission_assignments WHERE user_id = ? ORDER BY slot').all('deterministic-user') as Array<{ families_json: string }>;
    const families = rows.flatMap((row) => JSON.parse(row.families_json));
    expect(new Set(families).size).toBe(families.length);
    expect(first.missions.reduce((sum, item) => sum + item.reward_points, 0)).toBe(8000);
    expect(first.missions.reduce((sum, item) => sum + item.reward_minigame_tickets, 0)).toBe(2);
    expect(first.missions.reduce((sum, item) => sum + item.reward_free_draw_tickets, 0)).toBe(1);
  });

  it('counts activity recorded before the achievements tab is first opened, including distinct game metadata', async () => {
    createUser('backfill-user');
    addCompletedWeek('backfill-user');
    const payload = await getWeeklyMissions('backfill-user', COMPLETE_NOW);
    expect(payload.missions).toHaveLength(5);
    expect(payload.missions.every((item) => item.status === 'claimable')).toBe(true);
    const gameVariety = db.prepare(`SELECT COUNT(DISTINCT json_extract(metadata_json, '$.game_type')) AS c FROM achievement_events WHERE user_id = ? AND event_type = 'minigame.success'`).get('backfill-user') as any;
    expect(Number(gameVariety.c)).toBe(5);
    expect(payload.missions.flatMap((item) => item.conditions).every((item) => item.progress >= item.target)).toBe(true);
  });

  it('counts three game types separately even when every event value is one', async () => {
    let matched = false;
    for (let index = 0; index < 80 && !matched; index += 1) {
      const userId = `variety-user-${index}`;
      createUser(userId);
      ['quiz', 'match', 'fan_meeting'].forEach((gameType, gameIndex) => {
        addEvent(userId, `${userId}:game:${gameIndex}`, 'minigame.success', `2026-11-${16 + gameIndex}T01:00:00.000Z`, { value: 1, metadata: { game_type: gameType } });
      });
      const payload = await getWeeklyMissions(userId, TEST_NOW);
      const variety = payload.missions.flatMap((mission) => mission.conditions).find((item) => item.label.includes('서로 다른 미니게임 3종'));
      if (variety) {
        expect(variety).toMatchObject({ progress: 3, target: 3 });
        matched = true;
      }
    }
    expect(matched).toBe(true);
  });

  it('does not count an event whose occurred_at is in the future', async () => {
    createUser('future-event-user');
    const payload = await getWeeklyMissions('future-event-user', TEST_NOW);
    const assignment = db.prepare('SELECT id FROM weekly_mission_assignments WHERE user_id = ? ORDER BY slot LIMIT 1').get('future-event-user') as any;
    db.prepare("UPDATE weekly_mission_assignments SET conditions_json = ? WHERE id = ?")
      .run(JSON.stringify([{ kind: 'event_value', event_type: 'card.acquired', target: 1, label: '카드 1장 소환' }]), assignment.id);
    addEvent('future-event-user', 'future:draw', 'card.acquired', '2026-11-19T03:00:00.000Z', { value: 1 });
    const refreshed = await getWeeklyMissions('future-event-user', TEST_NOW);
    expect(refreshed.missions[0]).toMatchObject({ progress: 0, status: 'in_progress' });
    expect(payload.week_key).toBe(refreshed.week_key);
  });

  it('filters impossible multi-day missions for a user starting late in the week', async () => {
    const sundayNoon = Date.parse('2026-11-22T03:00:00.000Z');
    createUser('late-user', '2026-11-22 11:00:00');
    const payload = await getWeeklyMissions('late-user', sundayNoon);
    const rows = db.prepare('SELECT conditions_json FROM weekly_mission_assignments WHERE user_id = ?').all('late-user') as Array<{ conditions_json: string }>;
    for (const row of rows) {
      for (const item of JSON.parse(row.conditions_json)) {
        if (item.kind === 'distinct_source' && item.event_type === 'login.daily') expect(item.target).toBeLessThanOrEqual(1);
        if (item.kind === 'active_days') expect(item.target).toBeLessThanOrEqual(1);
        if (item.kind === 'distinct_metadata' && item.event_type === 'minigame.success' && item.metadata_key === 'game_type') expect(item.target).toBeLessThanOrEqual(1);
      }
    }
    expect(payload.missions).toHaveLength(5);
  });

  it('claims point and ticket rewards transactionally and makes retries idempotent', async () => {
    createUser('claim-user');
    addCompletedWeek('claim-user');
    const payload = await getWeeklyMissions('claim-user', COMPLETE_NOW);
    const hard = payload.missions.find((item) => item.difficulty === 'hard')!;
    const normal = payload.missions.find((item) => item.difficulty === 'normal')!;

    const hardFirst = await claimWeeklyMission('claim-user', hard.id, payload.week_key, COMPLETE_NOW);
    const hardRetry = await claimWeeklyMission('claim-user', hard.id, payload.week_key, COMPLETE_NOW);
    const normalFirst = await claimWeeklyMission('claim-user', normal.id, payload.week_key, COMPLETE_NOW);
    expect(hardFirst.ok && hardFirst.payload.claim_result).toMatchObject({ already_claimed: false, awarded: { points: 3200, free_draw_tickets: 1 } });
    expect(hardRetry.ok && hardRetry.payload.claim_result).toMatchObject({ already_claimed: true, awarded: { points: 0, free_draw_tickets: 0 } });
    expect(normalFirst.ok && normalFirst.payload.claim_result).toMatchObject({ already_claimed: false, awarded: { points: 1500, minigame_tickets: 1 } });

    const user = db.prepare('SELECT point, bonus_free_draw_tickets FROM users WHERE id = ?').get('claim-user') as any;
    const tickets = db.prepare('SELECT bonus_tickets FROM user_minigame_tickets WHERE user_id = ?').get('claim-user') as any;
    expect(user).toMatchObject({ point: 14700, bonus_free_draw_tickets: 1 });
    expect(tickets.bonus_tickets).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS c FROM point_ledger_entries WHERE user_id = ? AND reason = 'weekly_mission_reward'").get('claim-user') as any).c).toBe(2);
    expect((db.prepare('SELECT COUNT(*) AS c FROM weekly_mission_claims WHERE user_id = ?').get('claim-user') as any).c).toBe(2);
  });

  it('rejects a stale week key before granting anything', async () => {
    createUser('stale-user');
    addCompletedWeek('stale-user');
    const payload = await getWeeklyMissions('stale-user', COMPLETE_NOW);
    const result = await claimWeeklyMission('stale-user', payload.missions[0].id, '2026-11-09', COMPLETE_NOW);
    expect(result).toEqual({ ok: false, reason: 'WEEK_CHANGED' });
    expect((db.prepare('SELECT point FROM users WHERE id = ?').get('stale-user') as any).point).toBe(10000);
  });
});
