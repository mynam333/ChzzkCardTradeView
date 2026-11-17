import crypto from 'crypto';
import { getDbMode, getMysqlDb, getSqlDialect, getSqliteDb } from './db';
import { recordMysqlAssetEvent, recordSqliteAssetEvent } from './assetEventLog';
import { recordMysqlPointLedger, recordSqlitePointLedger } from './pointLedger';
import { ensureAchievementTables } from './achievementService';
import { toSqlDateTime } from '../repositories/mysql/dateUtils';
import {
  scheduledMinigameForKstDate,
  WEEKLY_MISSION_CATALOG,
  WEEKLY_MISSION_CATALOG_VERSION,
  weeklyMissionReward,
  type WeeklyMissionCondition,
  type WeeklyMissionDifficulty,
  type WeeklyMissionTemplate
} from './weeklyMissionCatalog';
import { ensureWeeklyMissionTables } from './weeklyMissionSchema';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const RELEVANT_EVENT_TYPES = [
  'login.daily',
  'minigame.success',
  'card.acquired',
  'card.fused',
  'card.sold',
  'trade.completed',
  'market.purchase',
  'market.sale'
] as const;

export type WeeklyMissionWindow = {
  week_key: string;
  starts_at: string;
  ends_at: string;
  server_now: string;
  startMs: number;
  endMs: number;
};

type WeeklyMissionStats = {
  totals: Map<string, { count: number; value: number }>;
  distinctSources: Map<string, Set<string>>;
  distinctMetadata: Map<string, Set<string>>;
  activeDays: Map<string, Set<string>>;
};

type AssignmentRow = {
  id: number;
  user_id: string;
  week_key: string;
  slot: number;
  mission_code: string;
  difficulty: WeeklyMissionDifficulty;
  families_json: unknown;
  title: string;
  description: string;
  conditions_json: unknown;
  reward_points: number;
  reward_minigame_tickets: number;
  reward_free_draw_tickets: number;
  claimed_at: string | Date | null;
};

export type WeeklyMissionView = {
  id: number;
  mission_code: string;
  difficulty: WeeklyMissionDifficulty;
  title: string;
  description: string;
  progress: number;
  target: number;
  conditions: Array<{ label: string; progress: number; target: number }>;
  reward_points: number;
  reward_minigame_tickets: number;
  reward_free_draw_tickets: number;
  status: 'in_progress' | 'claimable' | 'claimed';
  claimed_at: string | null;
};

export type WeeklyMissionPayload = {
  week_key: string;
  starts_at: string;
  ends_at: string;
  server_now: string;
  missions: WeeklyMissionView[];
  summary: { completed: number; claimed: number; total: number };
};

export type WeeklyMissionClaimResult =
  | { ok: true; payload: WeeklyMissionPayload & { claim_result: { mission_id: number; already_claimed: boolean; awarded: { points: number; minigame_tickets: number; free_draw_tickets: number }; new_points: number } } }
  | { ok: false; reason: 'WEEK_CHANGED' | 'NOT_FOUND' | 'NOT_COMPLETED' };

const kstDateKey = (ms: number) => {
  const date = new Date(ms + KST_OFFSET_MS);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};

export const getWeeklyMissionWindow = (now: Date | number = new Date()): WeeklyMissionWindow => {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const kst = new Date(nowMs + KST_OFFSET_MS);
  const daysSinceMonday = (kst.getUTCDay() + 6) % 7;
  const kstMidnightAsUtc = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate());
  const startMs = kstMidnightAsUtc - daysSinceMonday * DAY_MS - KST_OFFSET_MS;
  const endMs = startMs + 7 * DAY_MS;
  return {
    week_key: kstDateKey(startMs),
    starts_at: new Date(startMs).toISOString(),
    ends_at: new Date(endMs).toISOString(),
    server_now: new Date(nowMs).toISOString(),
    startMs,
    endMs
  };
};

const safeJson = <T>(value: unknown, fallback: T): T => {
  if (value == null) return fallback;
  if (typeof value === 'object') return value as T;
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
};

const sqlBounds = (window: WeeklyMissionWindow) => {
  const dialect = getSqlDialect();
  const effectiveEnd = new Date(Math.min(window.endMs, Date.parse(window.server_now)));
  return [
    toSqlDateTime(new Date(window.startMs), dialect) || window.starts_at,
    toSqlDateTime(effectiveEnd, dialect) || effectiveEnd.toISOString()
  ];
};

const loadWeeklyMissionStats = async (userId: string, window: WeeklyMissionWindow): Promise<WeeklyMissionStats> => {
  const totals = new Map<string, { count: number; value: number }>();
  const distinctSources = new Map<string, Set<string>>();
  const distinctMetadata = new Map<string, Set<string>>();
  const activeDays = new Map<string, Set<string>>();
  const placeholders = RELEVANT_EVENT_TYPES.map(() => '?').join(', ');
  let totalRows: any[] = [];
  let sourceRows: any[] = [];
  let metadataRows: any[] = [];
  let activeDayRows: any[] = [];
  const effectiveEndIso = new Date(Math.min(window.endMs, Date.parse(window.server_now))).toISOString();

  if (getDbMode() === 'LOCAL_SQL') {
    const db = getSqliteDb();
    const timeWhere = 'datetime(occurred_at) >= datetime(?) AND datetime(occurred_at) < datetime(?)';
    const params = [userId, window.starts_at, effectiveEndIso, ...RELEVANT_EVENT_TYPES];
    totalRows = db.prepare(`SELECT event_type, COUNT(*) AS event_count, COALESCE(SUM(value), 0) AS value_sum FROM achievement_events WHERE user_id = ? AND ${timeWhere} AND event_type IN (${placeholders}) GROUP BY event_type`).all(...params) as any[];
    sourceRows = db.prepare(`SELECT event_type, source_id AS value FROM achievement_events WHERE user_id = ? AND ${timeWhere} AND event_type = 'login.daily' AND source_id IS NOT NULL GROUP BY event_type, source_id`).all(userId, window.starts_at, effectiveEndIso) as any[];
    metadataRows = db.prepare(`SELECT event_type, 'game_type' AS metadata_key, json_extract(metadata_json, '$.game_type') AS value FROM achievement_events WHERE user_id = ? AND ${timeWhere} AND event_type = 'minigame.success' AND json_extract(metadata_json, '$.game_type') IS NOT NULL GROUP BY event_type, json_extract(metadata_json, '$.game_type')
      UNION ALL SELECT event_type, 'channel_id', json_extract(metadata_json, '$.channel_id') FROM achievement_events WHERE user_id = ? AND ${timeWhere} AND event_type = 'card.fused' AND json_extract(metadata_json, '$.channel_id') IS NOT NULL GROUP BY event_type, json_extract(metadata_json, '$.channel_id')
      UNION ALL SELECT event_type, 'counterparty_user_id', json_extract(metadata_json, '$.counterparty_user_id') FROM achievement_events WHERE user_id = ? AND ${timeWhere} AND event_type = 'trade.completed' AND json_extract(metadata_json, '$.counterparty_user_id') IS NOT NULL GROUP BY event_type, json_extract(metadata_json, '$.counterparty_user_id')
      UNION ALL SELECT event_type, 'seller_id', json_extract(metadata_json, '$.seller_id') FROM achievement_events WHERE user_id = ? AND ${timeWhere} AND event_type = 'market.purchase' AND json_extract(metadata_json, '$.seller_id') IS NOT NULL GROUP BY event_type, json_extract(metadata_json, '$.seller_id')
      UNION ALL SELECT event_type, 'buyer_id', json_extract(metadata_json, '$.buyer_id') FROM achievement_events WHERE user_id = ? AND ${timeWhere} AND event_type = 'market.sale' AND json_extract(metadata_json, '$.buyer_id') IS NOT NULL GROUP BY event_type, json_extract(metadata_json, '$.buyer_id')`).all(...Array(5).fill([userId, window.starts_at, effectiveEndIso]).flat()) as any[];
    activeDayRows = db.prepare(`SELECT event_type, strftime('%Y-%m-%d', datetime(occurred_at, '+9 hours')) AS day_key FROM achievement_events WHERE user_id = ? AND ${timeWhere} AND event_type IN (${placeholders}) GROUP BY event_type, day_key`).all(...params) as any[];
  } else if (getDbMode() === 'MYSQL') {
    const db = getMysqlDb();
    const [start, end] = sqlBounds(window);
    const params = [userId, start, end, ...RELEVANT_EVENT_TYPES];
    totalRows = await db.all(`SELECT event_type, COUNT(*) AS event_count, COALESCE(SUM(value), 0) AS value_sum FROM achievement_events WHERE user_id = ? AND occurred_at >= ? AND occurred_at < ? AND event_type IN (${placeholders}) GROUP BY event_type`, params);
    sourceRows = await db.all("SELECT event_type, source_id AS value FROM achievement_events WHERE user_id = ? AND occurred_at >= ? AND occurred_at < ? AND event_type = 'login.daily' AND source_id IS NOT NULL GROUP BY event_type, source_id", userId, start, end);
    const dialect = getSqlDialect();
    const jsonValue = (key: string) => dialect === 'postgres'
      ? `(metadata_json->>'${key}')`
      : `JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.${key}'))`;
    for (const [eventType, key] of [
      ['minigame.success', 'game_type'],
      ['card.fused', 'channel_id'],
      ['trade.completed', 'counterparty_user_id'],
      ['market.purchase', 'seller_id'],
      ['market.sale', 'buyer_id']
    ]) {
      const expression = jsonValue(key);
      const rows = await db.all(`SELECT event_type, '${key}' AS metadata_key, ${expression} AS value FROM achievement_events WHERE user_id = ? AND occurred_at >= ? AND occurred_at < ? AND event_type = ? AND ${expression} IS NOT NULL GROUP BY event_type, ${expression}`, userId, start, end, eventType);
      metadataRows.push(...rows);
    }
    const dayExpression = dialect === 'postgres'
      ? "TO_CHAR(occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')"
      : "DATE_FORMAT(occurred_at, '%Y-%m-%d')";
    activeDayRows = await db.all(`SELECT event_type, ${dayExpression} AS day_key FROM achievement_events WHERE user_id = ? AND occurred_at >= ? AND occurred_at < ? AND event_type IN (${placeholders}) GROUP BY event_type, ${dayExpression}`, params);
  } else {
    throw new Error('WEEKLY_MISSIONS_UNSUPPORTED_DB_MODE');
  }

  for (const row of totalRows) totals.set(String(row.event_type), { count: Number(row.event_count || 0), value: Number(row.value_sum || 0) });
  for (const row of sourceRows) {
    const key = String(row.event_type);
    if (!distinctSources.has(key)) distinctSources.set(key, new Set());
    if (row.value != null) distinctSources.get(key)!.add(String(row.value));
  }
  for (const row of metadataRows) {
    const key = `${row.event_type}:${row.metadata_key}`;
    if (!distinctMetadata.has(key)) distinctMetadata.set(key, new Set());
    if (row.value != null && String(row.value)) distinctMetadata.get(key)!.add(String(row.value));
  }
  for (const row of activeDayRows) {
    const key = String(row.event_type);
    if (!activeDays.has(key)) activeDays.set(key, new Set());
    if (row.day_key) activeDays.get(key)!.add(String(row.day_key));
  }
  return { totals, distinctSources, distinctMetadata, activeDays };
};

const conditionProgress = (condition: WeeklyMissionCondition, stats: WeeklyMissionStats): number => {
  if (condition.kind === 'event_value') return stats.totals.get(condition.event_type)?.value || 0;
  if (condition.kind === 'event_count') return stats.totals.get(condition.event_type)?.count || 0;
  if (condition.kind === 'distinct_source') return stats.distinctSources.get(condition.event_type)?.size || 0;
  if (condition.kind === 'distinct_metadata') return stats.distinctMetadata.get(`${condition.event_type}:${condition.metadata_key}`)?.size || 0;
  return stats.activeDays.get(condition.event_type)?.size || 0;
};

const kstDateRange = (startMs: number, endMs: number): string[] => {
  const values: string[] = [];
  for (let cursor = startMs; cursor < endMs; cursor += DAY_MS) values.push(kstDateKey(cursor));
  return values;
};

const possibleTimeBoundValues = (stats: WeeklyMissionStats, window: WeeklyMissionWindow, nowMs: number, userCreatedAt: number | null) => {
  const earliestFuture = Math.max(window.startMs, nowMs, userCreatedAt || window.startMs);
  const futureDays = kstDateRange(
    Date.UTC(...(() => { const d = new Date(earliestFuture + KST_OFFSET_MS); return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()] as const; })()) - KST_OFFSET_MS,
    window.endMs
  );
  const attendanceDays = new Set(stats.distinctSources.get('login.daily') || []);
  const minigameDays = new Set(stats.activeDays.get('minigame.success') || []);
  const drawDays = new Set(stats.activeDays.get('card.acquired') || []);
  const minigameTypes = new Set(stats.distinctMetadata.get('minigame.success:game_type') || []);
  for (const dateKey of futureDays) {
    attendanceDays.add(dateKey);
    minigameDays.add(dateKey);
    drawDays.add(dateKey);
    minigameTypes.add(scheduledMinigameForKstDate(dateKey));
  }
  return { attendanceDays: attendanceDays.size, minigameDays: minigameDays.size, drawDays: drawDays.size, minigameTypes: minigameTypes.size };
};

const isTemplateFeasible = (template: WeeklyMissionTemplate, possible: ReturnType<typeof possibleTimeBoundValues>) => template.conditions.every((item) => {
  if (item.kind === 'distinct_source' && item.event_type === 'login.daily') return item.target <= possible.attendanceDays;
  if (item.kind === 'active_days' && item.event_type === 'minigame.success') return item.target <= possible.minigameDays;
  if (item.kind === 'active_days' && item.event_type === 'card.acquired') return item.target <= possible.drawDays;
  if (item.kind === 'distinct_metadata' && item.event_type === 'minigame.success' && item.metadata_key === 'game_type') return item.target <= possible.minigameTypes;
  return true;
});

const deterministicOrder = (seed: string, items: WeeklyMissionTemplate[]) => [...items].sort((a, b) => {
  const score = (code: string) => crypto.createHash('sha256').update(`${seed}:${code}`).digest('hex');
  return score(a.code).localeCompare(score(b.code));
});

const selectTemplates = (userId: string, window: WeeklyMissionWindow, candidates: WeeklyMissionTemplate[]): WeeklyMissionTemplate[] => {
  const seed = `${WEEKLY_MISSION_CATALOG_VERSION}:${window.week_key}:${userId}`;
  const slots: WeeklyMissionDifficulty[] = ['easy', 'easy', 'normal', 'normal', 'hard'];
  const byDifficulty = new Map<WeeklyMissionDifficulty, WeeklyMissionTemplate[]>();
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    byDifficulty.set(difficulty, deterministicOrder(`${seed}:${difficulty}`, candidates.filter((item) => item.difficulty === difficulty)));
  }
  const picked: WeeklyMissionTemplate[] = [];
  const families = new Set<string>();
  const visit = (slot: number): boolean => {
    if (slot >= slots.length) return true;
    for (const item of byDifficulty.get(slots[slot]) || []) {
      if (picked.some((existing) => existing.code === item.code) || item.families.some((family) => families.has(family))) continue;
      picked.push(item);
      item.families.forEach((family) => families.add(family));
      if (visit(slot + 1)) return true;
      picked.pop();
      item.families.forEach((family) => {
        if (!picked.some((existing) => existing.families.includes(family))) families.delete(family);
      });
    }
    return false;
  };
  if (!visit(0)) throw new Error('WEEKLY_MISSION_SELECTION_FAILED');
  return picked;
};

const loadAssignments = async (userId: string, weekKey: string): Promise<AssignmentRow[]> => {
  const sql = 'SELECT * FROM weekly_mission_assignments WHERE user_id = ? AND week_key = ? ORDER BY slot ASC';
  if (getDbMode() === 'LOCAL_SQL') return getSqliteDb().prepare(sql).all(userId, weekKey) as AssignmentRow[];
  return getMysqlDb().all(sql, userId, weekKey) as Promise<AssignmentRow[]>;
};

const loadUserCreatedAt = async (userId: string): Promise<number | null> => {
  const sql = 'SELECT created_at FROM users WHERE id = ?';
  const row: any = getDbMode() === 'LOCAL_SQL'
    ? getSqliteDb().prepare(sql).get(userId)
    : await getMysqlDb().get(sql, userId);
  const value = row?.created_at;
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  const raw = String(value);
  const parsed = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? Date.parse(raw) : Date.parse(`${raw.replace(' ', 'T')}+09:00`);
  return Number.isFinite(parsed) ? parsed : null;
};

const ensureAssignments = async (userId: string, window: WeeklyMissionWindow, stats: WeeklyMissionStats, nowMs: number): Promise<AssignmentRow[]> => {
  const existing = await loadAssignments(userId, window.week_key);
  if (existing.length === 5) return existing;
  if (existing.length > 0) throw new Error('WEEKLY_MISSION_PARTIAL_ASSIGNMENT');
  const createdAt = await loadUserCreatedAt(userId);
  const possible = possibleTimeBoundValues(stats, window, nowMs, createdAt);
  const selected = selectTemplates(userId, window, WEEKLY_MISSION_CATALOG.filter((item) => isTemplateFeasible(item, possible)));
  const insertValues = (item: WeeklyMissionTemplate, slot: number) => {
    const reward = weeklyMissionReward(item.difficulty);
    return [userId, window.week_key, slot, item.code, item.difficulty, JSON.stringify(item.families), item.title, item.description, JSON.stringify(item.conditions), reward.points, reward.minigame_tickets, reward.free_draw_tickets];
  };
  const sql = `INSERT OR IGNORE INTO weekly_mission_assignments
    (user_id, week_key, slot, mission_code, difficulty, families_json, title, description, conditions_json, reward_points, reward_minigame_tickets, reward_free_draw_tickets)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  if (getDbMode() === 'LOCAL_SQL') {
    const db = getSqliteDb();
    db.transaction(() => {
      const insert = db.prepare(sql);
      selected.forEach((item, slot) => insert.run(...insertValues(item, slot)));
    })();
  } else {
    await getMysqlDb().transaction(async (tx: any) => {
      for (let slot = 0; slot < selected.length; slot += 1) {
        await tx.run(sql.replace('INSERT OR IGNORE', 'INSERT IGNORE'), ...insertValues(selected[slot], slot));
      }
    });
  }
  const assigned = await loadAssignments(userId, window.week_key);
  if (assigned.length !== 5) throw new Error('WEEKLY_MISSION_ASSIGNMENT_INCOMPLETE');
  return assigned;
};

const normalizeClaimedAt = (value: unknown): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
};

const toMissionView = (row: AssignmentRow, stats: WeeklyMissionStats): WeeklyMissionView => {
  const definitions = safeJson<WeeklyMissionCondition[]>(row.conditions_json, []);
  const conditions = definitions.map((item) => ({ label: item.label, progress: Math.max(0, conditionProgress(item, stats)), target: item.target }));
  const progress = conditions.reduce((sum, item) => sum + Math.min(item.progress, item.target), 0);
  const target = conditions.reduce((sum, item) => sum + item.target, 0);
  const claimedAt = normalizeClaimedAt(row.claimed_at);
  const complete = conditions.length > 0 && conditions.every((item) => item.progress >= item.target);
  return {
    id: Number(row.id),
    mission_code: row.mission_code,
    difficulty: row.difficulty,
    title: row.title,
    description: row.description,
    progress,
    target,
    conditions,
    reward_points: Number(row.reward_points || 0),
    reward_minigame_tickets: Number(row.reward_minigame_tickets || 0),
    reward_free_draw_tickets: Number(row.reward_free_draw_tickets || 0),
    status: claimedAt ? 'claimed' : complete ? 'claimable' : 'in_progress',
    claimed_at: claimedAt
  };
};

export const getWeeklyMissions = async (userId: string, now: Date | number = new Date()): Promise<WeeklyMissionPayload> => {
  await ensureAchievementTables();
  await ensureWeeklyMissionTables();
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const window = getWeeklyMissionWindow(nowMs);
  const stats = await loadWeeklyMissionStats(userId, window);
  const assignments = await ensureAssignments(userId, window, stats, nowMs);
  const missions = assignments.map((row) => toMissionView(row, stats));
  return {
    week_key: window.week_key,
    starts_at: window.starts_at,
    ends_at: window.ends_at,
    server_now: window.server_now,
    missions,
    summary: {
      completed: missions.filter((item) => item.status !== 'in_progress').length,
      claimed: missions.filter((item) => item.status === 'claimed').length,
      total: missions.length
    }
  };
};

const rewardSourceId = (row: AssignmentRow) => `weekly:${row.week_key}:${row.mission_code}`;

const grantSqlite = (db: any, userId: string, row: AssignmentRow) => {
  const points = Number(row.reward_points || 0);
  const minigameTickets = Number(row.reward_minigame_tickets || 0);
  const freeDrawTickets = Number(row.reward_free_draw_tickets || 0);
  const sourceId = rewardSourceId(row);
  if (points > 0) {
    db.prepare('UPDATE users SET point = point + ? WHERE id = ?').run(points, userId);
    recordSqlitePointLedger(db, { userId, amount: points, sourceType: 'weekly_mission', sourceId, reason: 'weekly_mission_reward', description: `주간 미션 보상: ${row.title}`, metadata: { week_key: row.week_key, mission_code: row.mission_code } });
  }
  if (minigameTickets > 0) {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO user_minigame_tickets (user_id, current_tickets, bonus_tickets, last_charged_at, updated_at) VALUES (?, 5, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET bonus_tickets = bonus_tickets + excluded.bonus_tickets, updated_at = excluded.updated_at`).run(userId, minigameTickets, now, now);
    recordSqliteAssetEvent(db, { userId, assetType: 'ticket', action: 'add', quantity: minigameTickets, sourceType: 'weekly_mission', sourceId, reason: 'weekly_mission_minigame_ticket', description: `주간 미션 보상: ${row.title}`, itemType: 'minigame_ticket' });
  }
  if (freeDrawTickets > 0) {
    db.prepare('UPDATE users SET bonus_free_draw_tickets = COALESCE(bonus_free_draw_tickets, 0) + ? WHERE id = ?').run(freeDrawTickets, userId);
    recordSqliteAssetEvent(db, { userId, assetType: 'ticket', action: 'add', quantity: freeDrawTickets, sourceType: 'weekly_mission', sourceId, reason: 'weekly_mission_free_draw_ticket', description: `주간 미션 보상: ${row.title}`, itemType: 'free_draw_ticket' });
  }
};

const grantMysql = async (tx: any, userId: string, row: AssignmentRow) => {
  const points = Number(row.reward_points || 0);
  const minigameTickets = Number(row.reward_minigame_tickets || 0);
  const freeDrawTickets = Number(row.reward_free_draw_tickets || 0);
  const sourceId = rewardSourceId(row);
  if (points > 0) {
    await tx.run('UPDATE users SET point = point + ? WHERE id = ?', points, userId);
    await recordMysqlPointLedger(tx, { userId, amount: points, sourceType: 'weekly_mission', sourceId, reason: 'weekly_mission_reward', description: `주간 미션 보상: ${row.title}`, metadata: { week_key: row.week_key, mission_code: row.mission_code } });
  }
  if (minigameTickets > 0) {
    await tx.run(`INSERT INTO user_minigame_tickets (user_id, current_tickets, bonus_tickets, last_charged_at, updated_at) VALUES (?, 5, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
      ON DUPLICATE KEY UPDATE bonus_tickets = bonus_tickets + VALUES(bonus_tickets), updated_at = VALUES(updated_at)`, userId, minigameTickets);
    await recordMysqlAssetEvent(tx, { userId, assetType: 'ticket', action: 'add', quantity: minigameTickets, sourceType: 'weekly_mission', sourceId, reason: 'weekly_mission_minigame_ticket', description: `주간 미션 보상: ${row.title}`, itemType: 'minigame_ticket' });
  }
  if (freeDrawTickets > 0) {
    await tx.run('UPDATE users SET bonus_free_draw_tickets = COALESCE(bonus_free_draw_tickets, 0) + ? WHERE id = ?', freeDrawTickets, userId);
    await recordMysqlAssetEvent(tx, { userId, assetType: 'ticket', action: 'add', quantity: freeDrawTickets, sourceType: 'weekly_mission', sourceId, reason: 'weekly_mission_free_draw_ticket', description: `주간 미션 보상: ${row.title}`, itemType: 'free_draw_ticket' });
  }
};

export const claimWeeklyMission = async (userId: string, assignmentId: number, requestedWeekKey: string, now?: Date | number): Promise<WeeklyMissionClaimResult> => {
  const claimClock = now ?? Date.now();
  const current = await getWeeklyMissions(userId, claimClock);
  if (requestedWeekKey !== current.week_key) return { ok: false, reason: 'WEEK_CHANGED' };
  const mission = current.missions.find((item) => item.id === assignmentId);
  if (!mission) return { ok: false, reason: 'NOT_FOUND' };
  if (mission.status === 'in_progress') return { ok: false, reason: 'NOT_COMPLETED' };
  const transactionWindow = getWeeklyMissionWindow(now ?? Date.now());
  if (transactionWindow.week_key !== current.week_key) return { ok: false, reason: 'WEEK_CHANGED' };
  let alreadyClaimed = mission.status === 'claimed';
  let newPoints = 0;

  if (getDbMode() === 'LOCAL_SQL') {
    const db = getSqliteDb();
    const result = db.transaction(() => {
      if (getWeeklyMissionWindow(now ?? Date.now()).week_key !== current.week_key) return { found: true, already: false, points: 0, weekChanged: true };
      const row = db.prepare('SELECT * FROM weekly_mission_assignments WHERE id = ? AND user_id = ? AND week_key = ?').get(assignmentId, userId, current.week_key) as AssignmentRow | undefined;
      if (!row) return { found: false, already: false, points: 0, weekChanged: false };
      if (row.claimed_at) return { found: true, already: true, points: Number((db.prepare('SELECT point FROM users WHERE id = ?').get(userId) as any)?.point || 0), weekChanged: false };
      grantSqlite(db, userId, row);
      db.prepare(`INSERT INTO weekly_mission_claims (assignment_id, user_id, week_key, mission_code, reward_points, reward_minigame_tickets, reward_free_draw_tickets) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(row.id, userId, row.week_key, row.mission_code, row.reward_points, row.reward_minigame_tickets, row.reward_free_draw_tickets);
      db.prepare("UPDATE weekly_mission_assignments SET claimed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(row.id);
      return { found: true, already: false, points: Number((db.prepare('SELECT point FROM users WHERE id = ?').get(userId) as any)?.point || 0), weekChanged: false };
    })();
    if (result.weekChanged) return { ok: false, reason: 'WEEK_CHANGED' };
    if (!result.found) return { ok: false, reason: 'NOT_FOUND' };
    alreadyClaimed = result.already;
    newPoints = result.points;
  } else if (getDbMode() === 'MYSQL') {
    const result = await getMysqlDb().transaction(async (tx: any) => {
      if (getWeeklyMissionWindow(now ?? Date.now()).week_key !== current.week_key) return { found: true, already: false, points: 0, weekChanged: true };
      const row = await tx.get('SELECT * FROM weekly_mission_assignments WHERE id = ? AND user_id = ? AND week_key = ? FOR UPDATE', assignmentId, userId, current.week_key) as AssignmentRow | undefined;
      if (!row) return { found: false, already: false, points: 0, weekChanged: false };
      if (row.claimed_at) return { found: true, already: true, points: Number((await tx.get('SELECT point FROM users WHERE id = ?', userId))?.point || 0), weekChanged: false };
      await grantMysql(tx, userId, row);
      await tx.run(`INSERT INTO weekly_mission_claims (assignment_id, user_id, week_key, mission_code, reward_points, reward_minigame_tickets, reward_free_draw_tickets) VALUES (?, ?, ?, ?, ?, ?, ?)`, row.id, userId, row.week_key, row.mission_code, row.reward_points, row.reward_minigame_tickets, row.reward_free_draw_tickets);
      await tx.run('UPDATE weekly_mission_assignments SET claimed_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE id = ?', row.id);
      return { found: true, already: false, points: Number((await tx.get('SELECT point FROM users WHERE id = ?', userId))?.point || 0), weekChanged: false };
    });
    if (result.weekChanged) return { ok: false, reason: 'WEEK_CHANGED' };
    if (!result.found) return { ok: false, reason: 'NOT_FOUND' };
    alreadyClaimed = result.already;
    newPoints = result.points;
  } else {
    throw new Error('WEEKLY_MISSIONS_UNSUPPORTED_DB_MODE');
  }

  const refreshed = await getWeeklyMissions(userId, now ?? Date.now());
  return {
    ok: true,
    payload: {
      ...refreshed,
      claim_result: {
        mission_id: assignmentId,
        already_claimed: alreadyClaimed,
        awarded: {
          points: alreadyClaimed ? 0 : mission.reward_points,
          minigame_tickets: alreadyClaimed ? 0 : mission.reward_minigame_tickets,
          free_draw_tickets: alreadyClaimed ? 0 : mission.reward_free_draw_tickets
        },
        new_points: newPoints
      }
    }
  };
};
