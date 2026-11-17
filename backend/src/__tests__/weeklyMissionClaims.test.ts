import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { __setSqliteDbForTest } from '../services/db';
import { ensureAchievementTables } from '../services/achievementService';
import { __resetWeeklyMissionSchemaForTest } from '../services/weeklyMissionSchema';
import { claimWeeklyMission, getWeeklyMissions } from '../services/weeklyMissionService';

const now = Date.parse('2026-11-22T14:59:59.999Z');

describe('weekly reward integrity', () => {
  let db: Database.Database;
  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(fs.readFileSync(path.join(__dirname, '../../../init-db.sql'), 'utf8'));
    __setSqliteDbForTest(db);
    __resetWeeklyMissionSchemaForTest();
    await ensureAchievementTables();
    for (const user of ['claim-owner', 'other-user']) {
      db.prepare("INSERT INTO users(id, username, point, bonus_free_draw_tickets, created_at) VALUES (?, ?, 10000, 0, '2026-01-01 00:00:00')").run(user, user);
    }
    const insert = db.prepare('INSERT INTO achievement_events(event_key,user_id,event_type,source_id,value,metadata_json,occurred_at) VALUES (?,?,?,?,?,?,?)');
    for (let day = 16; day <= 22; day++) {
      const date = `2026-11-${day}`;
      insert.run(`login:${day}`, 'claim-owner', 'login.daily', date, 1, '{}', `${date}T00:00:00Z`);
      for (let index = 0; index < 8; index++) {
        const meta = JSON.stringify({ game_type: ['quiz','match','fan_meeting','streamer_catch','sequence_relay'][index % 5], channel_id: `card-${index}`, counterparty_user_id: `peer-${index}`, seller_id: `seller-${index}`, buyer_id: `buyer-${index}` });
        for (const type of ['minigame.success','card.acquired','card.fused','card.sold','trade.completed','market.purchase','market.sale']) {
          insert.run(`${date}:${index}:${type}`, 'claim-owner', type, `${index}`, 1, meta, `${date}T01:00:00Z`);
        }
      }
    }
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); __setSqliteDbForTest(null); db.close(); });

  it('grants a concurrent claim exactly once', async () => {
    const payload = await getWeeklyMissions('claim-owner', now);
    const mission = payload.missions.find(m => m.difficulty === 'normal')!;
    const results = await Promise.all(Array.from({ length: 8 }, () => claimWeeklyMission('claim-owner', mission.id, payload.week_key, now)));
    expect(results.every(r => r.ok)).toBe(true);
    expect(results.filter(r => r.ok && !r.payload.claim_result.already_claimed)).toHaveLength(1);
    expect(db.prepare('SELECT point FROM users WHERE id=?').get('claim-owner')).toEqual({ point: 11500 });
    expect(db.prepare('SELECT bonus_tickets FROM user_minigame_tickets WHERE user_id=?').get('claim-owner')).toEqual({ bonus_tickets: 1 });
    expect(db.prepare('SELECT count(*) AS n FROM weekly_mission_claims').get()).toEqual({ n: 1 });
  });

  it('rolls back points, tickets, ledgers and completion when the final audit insert fails', async () => {
    const payload = await getWeeklyMissions('claim-owner', now);
    const mission = payload.missions.find(m => m.difficulty === 'normal')!;
    db.exec("CREATE TRIGGER reject_weekly_claim BEFORE INSERT ON weekly_mission_claims BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
    await expect(claimWeeklyMission('claim-owner', mission.id, payload.week_key, now)).rejects.toThrow('audit unavailable');
    expect(db.prepare('SELECT point FROM users WHERE id=?').get('claim-owner')).toEqual({ point: 10000 });
    expect(db.prepare('SELECT * FROM user_minigame_tickets WHERE user_id=?').get('claim-owner')).toBeUndefined();
    expect(db.prepare('SELECT count(*) AS n FROM point_ledger_entries').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT claimed_at FROM weekly_mission_assignments WHERE id=?').get(mission.id)).toEqual({ claimed_at: null });
    db.exec('DROP TRIGGER reject_weekly_claim');
    const retry = await claimWeeklyMission('claim-owner', mission.id, payload.week_key, now);
    expect(retry.ok && retry.payload.claim_result.awarded.points).toBe(1500);
  });

  it('never awards another user mission or an unfinished mission', async () => {
    const owner = await getWeeklyMissions('claim-owner', now);
    expect(await claimWeeklyMission('other-user', owner.missions[0].id, owner.week_key, now)).toEqual({ ok: false, reason: 'NOT_FOUND' });
    const other = await getWeeklyMissions('other-user', now);
    expect(await claimWeeklyMission('other-user', other.missions[0].id, other.week_key, now)).toEqual({ ok: false, reason: 'NOT_COMPLETED' });
    expect(db.prepare('SELECT count(*) AS n FROM weekly_mission_claims').get()).toEqual({ n: 0 });
  });

  it('rejects a claim that waits across Monday midnight before the transaction begins', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const payload = await getWeeklyMissions('claim-owner');
    const transaction = db.transaction.bind(db);
    vi.spyOn(db, 'transaction').mockImplementation(((fn: (...args: any[]) => unknown) => transaction((...args: any[]) => {
      vi.setSystemTime(now + 1);
      return fn(...args);
    })) as typeof db.transaction);
    expect(await claimWeeklyMission('claim-owner', payload.missions[0].id, payload.week_key)).toEqual({ ok: false, reason: 'WEEK_CHANGED' });
    expect(db.prepare('SELECT point FROM users WHERE id=?').get('claim-owner')).toEqual({ point: 10000 });
    expect(db.prepare('SELECT count(*) AS n FROM weekly_mission_claims').get()).toEqual({ n: 0 });
  });
});
