import { getDbMode, getMysqlDb, getSqlDialect, getSqliteDb } from './db';

let sqliteReady: unknown = null;
let mysqlReady = false;
let mysqlInitialization: Promise<void> | null = null;

const initializeWeeklyMissionTables = async (): Promise<void> => {
  if (getDbMode() === 'LOCAL_SQL') {
    const db = getSqliteDb();
    if (sqliteReady === db) return;
    db.exec(`
      CREATE TABLE IF NOT EXISTS weekly_mission_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        week_key TEXT NOT NULL,
        slot INTEGER NOT NULL,
        mission_code TEXT NOT NULL,
        difficulty TEXT NOT NULL,
        families_json TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        conditions_json TEXT NOT NULL,
        reward_points INTEGER NOT NULL,
        reward_minigame_tickets INTEGER NOT NULL DEFAULT 0,
        reward_free_draw_tickets INTEGER NOT NULL DEFAULT 0,
        claimed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, week_key, slot),
        UNIQUE(user_id, week_key, mission_code)
      );
      CREATE TABLE IF NOT EXISTS weekly_mission_claims (
        assignment_id INTEGER PRIMARY KEY,
        user_id TEXT NOT NULL,
        week_key TEXT NOT NULL,
        mission_code TEXT NOT NULL,
        reward_points INTEGER NOT NULL,
        reward_minigame_tickets INTEGER NOT NULL DEFAULT 0,
        reward_free_draw_tickets INTEGER NOT NULL DEFAULT 0,
        claimed_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_weekly_mission_assignments_user_week
        ON weekly_mission_assignments(user_id, week_key, slot);
      CREATE INDEX IF NOT EXISTS idx_achievement_events_user_week_type
        ON achievement_events(user_id, event_type, occurred_at);
    `);
    sqliteReady = db;
    return;
  }

  if (getDbMode() !== 'MYSQL') throw new Error('WEEKLY_MISSIONS_UNSUPPORTED_DB_MODE');
  if (mysqlReady) return;
  const db = getMysqlDb();
  await db.run(`
    CREATE TABLE IF NOT EXISTS weekly_mission_assignments (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      week_key VARCHAR(10) NOT NULL,
      slot SMALLINT NOT NULL,
      mission_code VARCHAR(120) NOT NULL,
      difficulty VARCHAR(16) NOT NULL,
      families_json JSON NOT NULL,
      title VARCHAR(160) NOT NULL,
      description VARCHAR(500) NOT NULL,
      conditions_json JSON NOT NULL,
      reward_points INT NOT NULL,
      reward_minigame_tickets INT NOT NULL DEFAULT 0,
      reward_free_draw_tickets INT NOT NULL DEFAULT 0,
      claimed_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_weekly_mission_slot (user_id, week_key, slot),
      UNIQUE KEY uniq_weekly_mission_code (user_id, week_key, mission_code),
      INDEX idx_weekly_mission_assignments_user_week (user_id, week_key, slot)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS weekly_mission_claims (
      assignment_id BIGINT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      week_key VARCHAR(10) NOT NULL,
      mission_code VARCHAR(120) NOT NULL,
      reward_points INT NOT NULL,
      reward_minigame_tickets INT NOT NULL DEFAULT 0,
      reward_free_draw_tickets INT NOT NULL DEFAULT 0,
      claimed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_weekly_mission_claim (user_id, week_key, assignment_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  try {
    await db.run(getSqlDialect() === 'postgres'
      ? 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_achievement_events_user_week_type ON achievement_events(user_id, event_type, occurred_at)'
      : 'CREATE INDEX idx_achievement_events_user_week_type ON achievement_events(user_id, event_type, occurred_at)');
  } catch (err: any) {
    const message = String(err?.message || '');
    if (err?.code !== 'ER_DUP_KEYNAME' && err?.code !== '42P07' && !/already exists|duplicate key name/i.test(message)) throw err;
  }
  mysqlReady = true;
};

export const ensureWeeklyMissionTables = async (): Promise<void> => {
  if (getDbMode() !== 'MYSQL') return initializeWeeklyMissionTables();
  if (mysqlReady) return;
  if (!mysqlInitialization) {
    mysqlInitialization = initializeWeeklyMissionTables().finally(() => { mysqlInitialization = null; });
  }
  return mysqlInitialization;
};

export const __resetWeeklyMissionSchemaForTest = () => {
  sqliteReady = null;
  mysqlReady = false;
  mysqlInitialization = null;
};
