import { getDbMode, getMysqlDb, getSqliteDb } from './db';
import { systemConfigRepository } from '../repositories';

export type ArenaAdminRestrictionType = 'skill' | 'tag' | 'battlefield' | 'card';

export type ArenaAdminControlConfig = {
  disabled_skill_ids: string[];
  disabled_tag_ids: string[];
  disabled_battlefield_rule_ids: string[];
  disabled_card_ids: string[];
  updated_at: string;
};

const CONFIG_KEY = 'arena_admin_control_config_v1';
const CACHE_TTL_MS = Math.max(5_000, Number(process.env.ARENA_ADMIN_CONTROL_CACHE_TTL_MS || 30_000));

const defaultConfig = (): ArenaAdminControlConfig => ({
  disabled_skill_ids: [],
  disabled_tag_ids: [],
  disabled_battlefield_rule_ids: [],
  disabled_card_ids: [],
  updated_at: new Date().toISOString()
});

let cache: { config: ArenaAdminControlConfig; expiresAt: number } | null = null;
let inFlight: Promise<ArenaAdminControlConfig> | null = null;
let ensureAuditPromise: Promise<void> | null = null;

const normalizeIds = (value: unknown) => Array.isArray(value)
  ? Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean))).slice(0, 500)
  : [];

const normalizeConfig = (raw: any): ArenaAdminControlConfig => ({
  disabled_skill_ids: normalizeIds(raw?.disabled_skill_ids),
  disabled_tag_ids: normalizeIds(raw?.disabled_tag_ids),
  disabled_battlefield_rule_ids: normalizeIds(raw?.disabled_battlefield_rule_ids),
  disabled_card_ids: normalizeIds(raw?.disabled_card_ids),
  updated_at: String(raw?.updated_at || new Date().toISOString())
});

export const getArenaAdminControlConfigSync = (): ArenaAdminControlConfig => cache?.config || defaultConfig();

export const loadArenaAdminControlConfig = async (force = false): Promise<ArenaAdminControlConfig> => {
  const now = Date.now();
  if (!force && cache && cache.expiresAt > now) return cache.config;
  if (!force && inFlight) return inFlight;

  inFlight = systemConfigRepository.get(CONFIG_KEY, '')
    .then((raw) => {
      const parsed = raw ? JSON.parse(raw) : null;
      const config = normalizeConfig(parsed || {});
      cache = { config, expiresAt: Date.now() + CACHE_TTL_MS };
      return config;
    })
    .catch(() => {
      const config = defaultConfig();
      cache = { config, expiresAt: Date.now() + Math.min(CACHE_TTL_MS, 10_000) };
      return config;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
};

const keyForType = (type: ArenaAdminRestrictionType): keyof Pick<ArenaAdminControlConfig, 'disabled_skill_ids' | 'disabled_tag_ids' | 'disabled_battlefield_rule_ids' | 'disabled_card_ids'> => {
  if (type === 'skill') return 'disabled_skill_ids';
  if (type === 'tag') return 'disabled_tag_ids';
  if (type === 'battlefield') return 'disabled_battlefield_rule_ids';
  return 'disabled_card_ids';
};

export const setArenaAdminRestriction = async (type: ArenaAdminRestrictionType, id: string, disabled: boolean): Promise<ArenaAdminControlConfig> => {
  const cleanId = String(id || '').trim();
  if (!cleanId) throw new Error('ArenaRestrictionIdInvalid');
  const current = await loadArenaAdminControlConfig(true);
  const key = keyForType(type);
  const set = new Set(current[key]);
  if (disabled) set.add(cleanId);
  else set.delete(cleanId);
  const next: ArenaAdminControlConfig = {
    ...current,
    [key]: Array.from(set).sort(),
    updated_at: new Date().toISOString()
  };
  await systemConfigRepository.set(CONFIG_KEY, JSON.stringify(next));
  cache = { config: next, expiresAt: Date.now() + CACHE_TTL_MS };
  return next;
};

export const ensureArenaAdminAuditLogTable = async () => {
  if (ensureAuditPromise) return ensureAuditPromise;
  ensureAuditPromise = (async () => {
    if (getDbMode() === 'MYSQL') {
      await getMysqlDb().run(`
        CREATE TABLE IF NOT EXISTS arena_admin_audit_logs (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          admin_user_id VARCHAR(191) NOT NULL,
          action_type VARCHAR(80) NOT NULL,
          target_type VARCHAR(80) NOT NULL,
          target_id VARCHAR(191) NULL,
          reason VARCHAR(500) NULL,
          payload_json JSON NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_arena_admin_audit_created (created_at),
          INDEX idx_arena_admin_audit_target (target_type, target_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      return;
    }
    if (getDbMode() === 'LOCAL_SQL') {
      getSqliteDb().exec(`
        CREATE TABLE IF NOT EXISTS arena_admin_audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          admin_user_id TEXT NOT NULL,
          action_type TEXT NOT NULL,
          target_type TEXT NOT NULL,
          target_id TEXT,
          reason TEXT,
          payload_json TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_arena_admin_audit_created ON arena_admin_audit_logs (created_at);
        CREATE INDEX IF NOT EXISTS idx_arena_admin_audit_target ON arena_admin_audit_logs (target_type, target_id, created_at);
      `);
      return;
    }
    throw new Error('ArenaAdminAuditStorageUnsupported');
  })().catch((err) => {
    ensureAuditPromise = null;
    throw err;
  });
  return ensureAuditPromise;
};

export const recordArenaAdminAuditLog = async (input: {
  adminUserId: string;
  actionType: string;
  targetType: string;
  targetId?: string | null;
  reason?: string | null;
  payload?: unknown;
}) => {
  await ensureArenaAdminAuditLogTable();
  const payloadJson = input.payload == null ? null : JSON.stringify(input.payload);
  if (getDbMode() === 'MYSQL') {
    await getMysqlDb().run(
      `INSERT INTO arena_admin_audit_logs
        (admin_user_id, action_type, target_type, target_id, reason, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      input.adminUserId,
      input.actionType,
      input.targetType,
      input.targetId || null,
      input.reason || null,
      payloadJson
    );
    return;
  }
  getSqliteDb()
    .prepare(
      `INSERT INTO arena_admin_audit_logs
        (admin_user_id, action_type, target_type, target_id, reason, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(input.adminUserId, input.actionType, input.targetType, input.targetId || null, input.reason || null, payloadJson);
};

export const listArenaAdminAuditLogs = async (limitInput?: unknown) => {
  await ensureArenaAdminAuditLogTable();
  const limit = Math.max(1, Math.min(100, Number.parseInt(String(limitInput || '50'), 10) || 50));
  const query = `SELECT id, admin_user_id, action_type, target_type, target_id, reason, payload_json, created_at
    FROM arena_admin_audit_logs
    ORDER BY id DESC
    LIMIT ?`;
  const rows = getDbMode() === 'MYSQL'
    ? await getMysqlDb().all<any>(query, limit)
    : getSqliteDb().prepare(query).all(limit) as any[];
  return {
    items: rows.map((row) => ({
      id: String(row.id),
      admin_user_id: String(row.admin_user_id || ''),
      action_type: String(row.action_type || ''),
      target_type: String(row.target_type || ''),
      target_id: row.target_id || null,
      reason: row.reason || null,
      payload: row.payload_json ? JSON.parse(row.payload_json) : null,
      created_at: row.created_at
    })),
    source: 'arena_admin_audit_logs'
  };
};
