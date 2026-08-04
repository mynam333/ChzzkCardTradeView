import Database from 'better-sqlite3';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { ensureParentDirectory, getSqliteDbPath } from './storagePaths';
import { createMysqlDb, MysqlDb } from './mysqlDb';
import { createPostgresDb, PostgresDb } from './postgresDb';
import { ensureArenaV2MysqlSchema, ensureArenaV2SqliteSchema } from './arenaV2SchemaMigration';

let sqliteDb: Database.Database | null = null;
let supabaseClient: SupabaseClient | null = null;
let mysqlDb: MysqlDb | PostgresDb | null = null;
export type DbMode = 'LOCAL_SQL' | 'SUPABASE' | 'MYSQL';
let dbMode: DbMode = 'LOCAL_SQL';
let sqlDialect: 'mysql' | 'postgres' | null = null;

type ConfiguredDbMode = 'sqlite' | 'supabase' | 'mysql' | 'postgres' | null;

const normalizeConfiguredDbMode = (value: string | undefined): ConfiguredDbMode => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (['sqlite', 'local_sql', 'local-sql', 'local', 'file'].includes(normalized)) return 'sqlite';
  if (['mysql', 'mariadb'].includes(normalized)) return 'mysql';
  if (['postgres', 'postgresql', 'pg'].includes(normalized)) return 'postgres';
  if (['supabase'].includes(normalized)) return 'supabase';
  throw new Error(`[DB] DB_MODE 값이 올바르지 않습니다: ${value}. 허용값: sqlite, mysql, postgres, supabase`);
};

const getConfiguredDbMode = (): ConfiguredDbMode => {
  const explicit = normalizeConfiguredDbMode(process.env.DB_MODE);
  if (explicit) return explicit;
  const legacyClient = normalizeConfiguredDbMode(process.env.DB_CLIENT || process.env.DATABASE_CLIENT);
  if (legacyClient) return legacyClient;
  if (process.env.MYSQL_REQUIRED === 'true') return 'mysql';
  if (process.env.SUPABASE_REQUIRED === 'true') return 'supabase';
  if (process.env.POSTGRES_REQUIRED === 'true' || process.env.POSTGRESQL_REQUIRED === 'true') return 'postgres';
  return null;
};

/**
 * Supabase(PostgREST) 호출용 fetch 래퍼.
 * Node(undici)의 keep-alive 소켓이 서버측에서 끊기거나 일시적 네트워크
 * 오류가 발생하면 fetch가 'TypeError: fetch failed'로 거부됩니다. 이런 일시
 * 오류에 한해 짧은 백오프로 재시도하여 간헐적 조회 실패를 흡수합니다.
 * (HTTP 4xx/5xx 응답은 throw가 아니라 정상 반환되므로 재시도 대상이 아닙니다.)
 */
const SUPABASE_FETCH_MAX_RETRIES = 3;
const SUPABASE_FETCH_BACKOFF_MS = [250, 600, 1200];
const SUPABASE_FETCH_TIMEOUT_MS = Math.max(1000, Number(process.env.SUPABASE_FETCH_TIMEOUT_MS || 15_000));

const decodeJwtPayload = (token: string): Record<string, any> | null => {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
};

const assertServerSupabaseKey = (key: string) => {
  if (key.startsWith('sb_publishable_')) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY에 publishable key가 설정되어 있습니다. 서버 전용 secret/service_role key를 사용하세요.');
  }
  if (key.startsWith('sb_secret_')) return;

  const payload = decodeJwtPayload(key);
  if (payload && payload.role !== 'service_role') {
    throw new Error(`SUPABASE_SERVICE_ROLE_KEY가 service_role이 아닙니다. 감지된 role=${payload.role || 'unknown'}`);
  }
};

const isAbortError = (err: any) =>
  err?.name === 'AbortError' ||
  err?.code === 'ABORT_ERR' ||
  err?.message === 'This operation was aborted';

const fetchWithTimeout = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  if (init?.signal?.aborted) {
    throw new DOMException('This operation was aborted', 'AbortError');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUPABASE_FETCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  init?.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
    init?.signal?.removeEventListener('abort', onAbort);
  }
};

const fetchWithRetry: typeof fetch = async (input, init) => {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= SUPABASE_FETCH_MAX_RETRIES; attempt++) {
    try {
      return await fetchWithTimeout(input, init);
    } catch (err: any) {
      lastErr = err;
      // 네트워크 계층 오류(TypeError: fetch failed)와 타임아웃 abort만 짧게 재시도합니다.
      const isRetryableFetchError = err instanceof TypeError || isAbortError(err);
      if (!isRetryableFetchError || attempt === SUPABASE_FETCH_MAX_RETRIES) break;
      // 지수 백오프로 일시적 끊김이 회복될 시간을 줍니다.
      await new Promise((resolve) => setTimeout(resolve, SUPABASE_FETCH_BACKOFF_MS[attempt] ?? 1200));
    }
  }
  throw lastErr;
};

const createSqliteIdBackfillTrigger = (db: Database.Database, table: string) => {
  if (!sqliteColumnExists(db, table, 'id')) return;
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_${table}_id_after_insert
    AFTER INSERT ON ${table}
    WHEN NEW.id IS NULL
    BEGIN
      UPDATE ${table} SET id = NEW.rowid WHERE rowid = NEW.rowid;
    END;
  `);
};

const backfillNullIdFromRowId = (db: Database.Database, table: string) => {
  if (!sqliteColumnExists(db, table, 'id')) return;
  db.exec(`UPDATE ${table} SET id = rowid WHERE id IS NULL;`);
};

const ensureUniqueIndex = (db: Database.Database, table: string, columns: string[], indexName: string) => {
  if (!sqliteTableExists(db, table)) return;
  const missingColumns = columns.filter((column) => !sqliteColumnExists(db, table, column));
  if (missingColumns.length > 0) {
    console.warn(`[DB Migration] SQLite ${table}.${indexName} 인덱스 생성을 건너뜁니다. 누락 컬럼: ${missingColumns.join(', ')}`);
    return;
  }
  const quotedColumns = columns.map((column) => `"${column}"`).join(', ');
  const partition = columns.map((column) => `"${column}"`).join(', ');
  db.exec(`
    DELETE FROM ${table}
     WHERE rowid NOT IN (
       SELECT rowid
         FROM (
           SELECT rowid,
                  ROW_NUMBER() OVER (PARTITION BY ${partition} ORDER BY rowid DESC) AS rn
             FROM ${table}
            WHERE ${columns.map((column) => `"${column}" IS NOT NULL`).join(' AND ')}
         )
        WHERE rn = 1
     )
       AND ${columns.map((column) => `"${column}" IS NOT NULL`).join(' AND ')};
    CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${table}(${quotedColumns});
  `);
};

const sqliteTableExists = (db: Database.Database, table: string): boolean => {
  const row = db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(table);
  return Boolean(row);
};

const sqliteColumnExists = (db: Database.Database, table: string, column: string): boolean => {
  if (!sqliteTableExists(db, table)) return false;
  const columns = db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all() as Array<{ name: string }>;
  return columns.some((entry) => entry.name === column);
};

const ensureSqliteColumn = (db: Database.Database, table: string, column: string, ddl: string): void => {
  if (!sqliteTableExists(db, table) || sqliteColumnExists(db, table, column)) return;
  console.log(`[DB Migration] SQLite ${table}.${column} 컬럼이 없어 추가합니다.`);
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`);
};

const ensureSqlitePreSchemaCompatibility = (db: Database.Database): void => {
  // init-db.sql은 CREATE TABLE IF NOT EXISTS 뒤 곧바로 최신 인덱스를 생성합니다.
  // 이미 존재하는 구형 SQLite 테이블은 CREATE TABLE로 컬럼이 갱신되지 않으므로,
  // 인덱스가 참조하는 신규 컬럼을 먼저 보강해야 초기 스키마 재실행이 멱등성을 가집니다.
  const indexedColumnBackfills: Array<[string, string, string]> = [
    ['user_titles', 'is_equipped', 'is_equipped INTEGER NOT NULL DEFAULT 0'],
    ['user_titles', 'grant_source', "grant_source TEXT NOT NULL DEFAULT 'manual'"],
    ['subscription_title_states', 'checked_until', 'checked_until TEXT'],
    ['user_cards', 'star', 'star INTEGER DEFAULT 0'],
    ['user_cards', 'is_hidden', 'is_hidden INTEGER NOT NULL DEFAULT 0'],
    ['user_cards', 'favorite_order', 'favorite_order INTEGER'],
    ['user_cards', 'favorite_at', 'favorite_at TEXT'],
    ['user_cards', 'is_locked', 'is_locked INTEGER NOT NULL DEFAULT 0'],
    ['notifications', 'deleted_at', 'deleted_at TEXT'],
    ['notifications', 'group_key', 'group_key TEXT'],
    ['shop_items', 'listed_at', 'listed_at TEXT'],
    ['shop_items', 'sale_start_at', 'sale_start_at TEXT'],
    ['shop_items', 'sale_end_at', 'sale_end_at TEXT'],
    ['shop_items', 'limited_total_quantity', 'limited_total_quantity INTEGER NOT NULL DEFAULT 0'],
    ['shop_items', 'sold_quantity', 'sold_quantity INTEGER NOT NULL DEFAULT 0'],
    ['chat_messages', 'message_type', "message_type TEXT NOT NULL DEFAULT 'text'"],
    ['chat_messages', 'attachment_expires_at', 'attachment_expires_at TEXT'],
    ['chat_messages', 'attachment_deleted_at', 'attachment_deleted_at TEXT'],
    ['market_listings', 'listing_type', "listing_type TEXT NOT NULL DEFAULT 'fixed'"],
    ['market_listings', 'current_bidder_id', 'current_bidder_id TEXT'],
    ['market_listings', 'bid_reserved', 'bid_reserved INTEGER DEFAULT 0'],
    ['market_transaction_audit_logs', 'current_bidder_id', 'current_bidder_id TEXT']
  ];
  for (const [table, column, ddl] of indexedColumnBackfills) {
    ensureSqliteColumn(db, table, column, ddl);
  }
};

const ensureSqliteCompatibilityConstraints = (db: Database.Database) => {
  // Supabase export로 만든 SQLite 파일은 컬럼만 있고 PK/UNIQUE 제약이 빠질 수 있습니다.
  // SQLite upsert(ON CONFLICT)와 FK parent key는 실제 UNIQUE/PRIMARY KEY가 있어야 하므로 운영 시작 시 보정합니다.
  const fk = db.pragma('foreign_keys', { simple: true }) as number;
  db.pragma('foreign_keys = OFF');
  try {
    for (const table of [
      'titles',
      'user_cards',
      'trades',
      'value_history',
      'coupons',
      'coupon_logs',
      'announcements',
      'push_subscriptions',
      'push_notifications',
      'card_reports',
      'puzzle_excluded_images',
      'notifications',
      'shop_items',
      'user_cosmetics',
      'point_ledger_entries',
      'asset_event_logs',
      'subscription_title_rules',
      'subscription_title_states',
      'friend_requests',
      'friendships',
      'chat_rooms',
      'chat_messages',
      'market_listings',
      'market_transaction_audit_logs',
      'market_bids',
      'market_watches'
    ]) {
      backfillNullIdFromRowId(db, table);
      ensureUniqueIndex(db, table, ['id'], `idx_${table}_id_unique`);
      createSqliteIdBackfillTrigger(db, table);
    }

    ensureUniqueIndex(db, 'users', ['id'], 'idx_users_id_unique');
    ensureUniqueIndex(db, 'deleted_user_accounts', ['user_id'], 'idx_deleted_user_accounts_user_id_unique');
    ensureUniqueIndex(db, 'streamers', ['channel_id'], 'idx_streamers_channel_id_unique');
    ensureUniqueIndex(db, 'titles', ['id'], 'idx_titles_id_unique');
    ensureUniqueIndex(db, 'shop_items', ['id'], 'idx_shop_items_id_unique');
    ensureUniqueIndex(db, 'coupons', ['id'], 'idx_coupons_id_unique');
    ensureUniqueIndex(db, 'user_cards', ['id'], 'idx_user_cards_id_unique');
    ensureUniqueIndex(db, 'puzzle_excluded_images', ['id'], 'idx_puzzle_excluded_images_id_unique');
    ensureUniqueIndex(db, 'puzzle_excluded_images', ['image_key'], 'idx_puzzle_excluded_images_key_unique');
    ensureUniqueIndex(db, 'point_ledger_entries', ['id'], 'idx_point_ledger_entries_id_unique');
    ensureUniqueIndex(db, 'asset_event_logs', ['id'], 'idx_asset_event_logs_id_unique');
    ensureUniqueIndex(db, 'subscription_title_rules', ['id'], 'idx_subscription_title_rules_id_unique');
    ensureUniqueIndex(db, 'subscription_title_states', ['user_id', 'rule_id'], 'idx_subscription_title_states_user_rule_unique');
    ensureUniqueIndex(db, 'market_listings', ['id'], 'idx_market_listings_id_unique');
    ensureUniqueIndex(db, 'market_transaction_audit_logs', ['audit_key'], 'idx_market_audit_key_unique');
    ensureUniqueIndex(db, 'system_configs', ['key'], 'idx_system_configs_key_unique');
    ensureUniqueIndex(db, 'streamer_registration_blocks', ['channel_id'], 'idx_streamer_registration_blocks_channel_id_unique');
    ensureUniqueIndex(db, 'tutorial_rewards', ['user_id', 'reward_key'], 'idx_tutorial_rewards_user_reward_unique');
    ensureUniqueIndex(db, 'user_titles', ['user_id', 'title_id'], 'idx_user_titles_user_title_unique');
    ensureUniqueIndex(db, 'user_cosmetics', ['user_id', 'item_id'], 'idx_user_cosmetics_user_item_unique');
    ensureUniqueIndex(db, 'shop_purchases', ['user_id', 'item_id'], 'idx_shop_purchases_user_item_unique');
    ensureUniqueIndex(db, 'user_blocks', ['blocker_id', 'blocked_id'], 'idx_user_blocks_pair_unique');
    ensureUniqueIndex(db, 'user_image_blinds', ['user_id', 'image_key'], 'idx_user_image_blinds_user_key_unique');
    ensureUniqueIndex(db, 'friend_requests', ['id'], 'idx_friend_requests_id_unique');
    ensureUniqueIndex(db, 'friendships', ['user_a_id', 'user_b_id'], 'idx_friendships_pair_unique');
    ensureUniqueIndex(db, 'chat_rooms', ['id'], 'idx_chat_rooms_id_unique');
    ensureUniqueIndex(db, 'chat_rooms', ['user_a_id', 'user_b_id'], 'idx_chat_rooms_pair_unique');
    ensureUniqueIndex(db, 'chat_messages', ['id'], 'idx_chat_messages_id_unique');
    ensureUniqueIndex(db, 'user_minigame_tickets', ['user_id'], 'idx_user_minigame_tickets_user_unique');
    ensureUniqueIndex(db, 'push_subscriptions', ['endpoint'], 'idx_push_subscriptions_endpoint');
    ensureUniqueIndex(db, 'coupon_logs', ['coupon_id', 'user_id'], 'idx_coupon_logs_coupon_user_unique');
    ensureUniqueIndex(db, 'minigame_sessions', ['id'], 'idx_minigame_sessions_id_unique');
  } finally {
    db.pragma(`foreign_keys = ${fk ? 'ON' : 'OFF'}`);
  }
};

const ensureMysqlColumn = async (db: MysqlDb, table: string, column: string, ddl: string) => {
  const existing = await db.get<{ present: number }>(
    `SELECT 1 AS present
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1`,
    table,
    column
  );
  if (existing) return;

  console.log(`[DB Migration] MySQL ${table}.${column} 컬럼이 없어 추가합니다.`);
  await db.run(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
};

export const ensureMysqlLongTextColumn = async (
  db: Pick<MysqlDb, 'get' | 'run'>,
  table: string,
  column: string
): Promise<void> => {
  const existing = await db.get<{ data_type: string }>(
    `SELECT data_type
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1`,
    table,
    column
  );
  if (!existing || String(existing.data_type).toLowerCase() === 'longtext') return;

  console.log(`[DB Migration] MySQL ${table}.${column}을 LONGTEXT로 확장합니다. (현재: ${existing.data_type})`);
  await db.run(`ALTER TABLE ${table} MODIFY COLUMN ${column} LONGTEXT NULL`);
};

const ensureMysqlIndex = async (db: MysqlDb, table: string, indexName: string, ddl: string) => {
  const existing = await db.get<{ present: number }>(
    `SELECT 1 AS present
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND index_name = ?
      LIMIT 1`,
    table,
    indexName
  );
  if (existing) return;

  console.log(`[DB Migration] MySQL ${table}.${indexName} 인덱스가 없어 추가합니다.`);
  await db.run(`ALTER TABLE ${table} ADD INDEX ${indexName} ${ddl}`);
};

const ensureMysqlUniqueIndex = async (db: MysqlDb, table: string, indexName: string, ddl: string) => {
  const existing = await db.get<{ present: number }>(
    `SELECT 1 AS present
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND index_name = ?
      LIMIT 1`,
    table,
    indexName
  );
  if (existing) return;

  console.log(`[DB Migration] MySQL ${table}.${indexName} 유니크 인덱스가 없어 추가합니다.`);
  await db.run(`ALTER TABLE ${table} ADD UNIQUE INDEX ${indexName} ${ddl}`);
};

const dropMysqlSingleColumnUniqueIndexes = async (db: MysqlDb, table: string, column: string, keepIndexNames: string[] = []) => {
  const indexes = await db.all<{ index_name: string }>(
    `SELECT s.index_name
       FROM information_schema.statistics s
       JOIN (
         SELECT index_name, COUNT(*) AS column_count
           FROM information_schema.statistics
          WHERE table_schema = DATABASE()
            AND table_name = ?
          GROUP BY index_name
       ) grouped ON grouped.index_name = s.index_name
      WHERE s.table_schema = DATABASE()
        AND s.table_name = ?
        AND s.column_name = ?
        AND s.non_unique = 0
        AND grouped.column_count = 1`,
    table,
    table,
    column
  );
  const keep = new Set(keepIndexNames);
  for (const { index_name: indexName } of indexes) {
    if (!indexName || indexName === 'PRIMARY' || keep.has(indexName)) continue;
    console.log(`[DB Migration] MySQL ${table}.${indexName} 전역 UNIQUE 인덱스를 제거합니다.`);
    await db.run(`ALTER TABLE ${table} DROP INDEX ${indexName}`);
  }
};

const ensureMysqlTableCollation = async (db: MysqlDb, table: string, collation = 'utf8mb4_unicode_ci') => {
  const existing = await db.get<{ table_collation: string }>(
    `SELECT table_collation
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = ?
      LIMIT 1`,
    table
  );
  if (!existing || existing.table_collation === collation) return;

  console.log(`[DB Migration] MySQL ${table} collation을 ${collation}로 보정합니다. (현재: ${existing.table_collation})`);
  await db.run(`ALTER TABLE ${table} CONVERT TO CHARACTER SET utf8mb4 COLLATE ${collation}`);
};

const normalizeMysqlIsoDateColumn = async (db: MysqlDb, table: string, column: string) => {
  try {
    await db.run(`
      UPDATE ${table}
         SET ${column} = STR_TO_DATE(SUBSTRING_INDEX(REPLACE(${column}, 'T', ' '), '.', 1), '%Y-%m-%d %H:%i:%s')
       WHERE ${column} LIKE '%T%Z'
    `);
  } catch (err: any) {
    console.warn(`[DB Migration] MySQL ${table}.${column} ISO 날짜 보정 실패:`, err?.message || err);
  }
};

const ensureMysqlCompatibilityMigrations = async (db: MysqlDb) => {
  await ensureMysqlColumn(db, 'streamers', 'lifecycle_id', 'lifecycle_id VARCHAR(64) NULL AFTER registered_by');
  await db.run("UPDATE streamers SET lifecycle_id = UUID() WHERE lifecycle_id IS NULL OR lifecycle_id = ''");
  await ensureMysqlColumn(db, 'coupons', 'rewards', 'rewards JSON NULL AFTER reward_quantity');
  await ensureMysqlLongTextColumn(db, 'shop_items', 'style_json');
  await ensureMysqlColumn(db, 'shop_items', 'sale_start_at', 'sale_start_at DATETIME NULL AFTER purchase_limit');
  await ensureMysqlColumn(db, 'shop_items', 'sale_end_at', 'sale_end_at DATETIME NULL AFTER sale_start_at');
  await ensureMysqlColumn(db, 'shop_items', 'limited_total_quantity', 'limited_total_quantity INT NOT NULL DEFAULT 0 AFTER sale_end_at');
  await ensureMysqlColumn(db, 'shop_items', 'sold_quantity', 'sold_quantity INT NOT NULL DEFAULT 0 AFTER limited_total_quantity');
  await ensureMysqlColumn(db, 'shop_items', 'listed_at', 'listed_at DATETIME NULL AFTER purchase_limit');
  await db.run("UPDATE shop_items SET listed_at = COALESCE(created_at, UTC_TIMESTAMP()) WHERE active = 1 AND listed_at IS NULL");
  await ensureMysqlIndex(db, 'shop_items', 'idx_shop_items_active_listed', '(active, listed_at, id)');
  await ensureMysqlIndex(db, 'shop_items', 'idx_shop_items_limited_sale', '(active, sale_start_at, sale_end_at, limited_total_quantity, sold_quantity)');
  await ensureMysqlColumn(db, 'user_cards', 'is_locked', 'is_locked TINYINT NOT NULL DEFAULT 0');
  await ensureMysqlIndex(db, 'user_cards', 'idx_user_cards_user_locked', '(user_id, is_locked)');
  await ensureMysqlIndex(db, 'user_cards', 'idx_user_cards_channel_serial', '(channel_id, serial_number)');
  await db.run(`
    CREATE TABLE IF NOT EXISTS user_card_serials (
      channel_id VARCHAR(191) PRIMARY KEY,
      last_serial BIGINT NOT NULL DEFAULT 0,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_user_card_serials_streamer FOREIGN KEY(channel_id) REFERENCES streamers(channel_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureMysqlColumn(db, 'users', 'last_seen_at', 'last_seen_at DATETIME NULL AFTER token_expires_at');
  await normalizeMysqlIsoDateColumn(db, 'users', 'last_free_draw');
  await normalizeMysqlIsoDateColumn(db, 'users', 'banned_until');
  await normalizeMysqlIsoDateColumn(db, 'users', 'token_expires_at');
  await normalizeMysqlIsoDateColumn(db, 'users', 'last_seen_at');
  await db.run(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id VARCHAR(128) PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      expires_at DATETIME NOT NULL,
      revoked_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_auth_sessions_user_active (user_id, revoked_at, expires_at),
      INDEX idx_auth_sessions_expires_at (expires_at),
      CONSTRAINT fk_auth_sessions_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureMysqlTableCollation(db, 'auth_sessions');
  await ensureMysqlIndex(db, 'auth_sessions', 'idx_auth_sessions_user_active', '(user_id, revoked_at, expires_at)');
  await ensureMysqlIndex(db, 'auth_sessions', 'idx_auth_sessions_expires_at', '(expires_at)');
  await db.run(`
    CREATE TABLE IF NOT EXISTS chat_attachment_quota_locks (
      user_id VARCHAR(191) PRIMARY KEY,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_chat_attachment_quota_locks_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS chat_attachment_quota_reservations (
      id VARCHAR(128) PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      reserved_bytes BIGINT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_chat_attachment_quota_reservations_user (user_id, expires_at),
      INDEX idx_chat_attachment_quota_reservations_expiry (expires_at),
      CONSTRAINT fk_chat_attachment_quota_reservations_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT chk_chat_attachment_quota_reserved_bytes CHECK (reserved_bytes > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureMysqlIndex(db, 'chat_attachment_quota_reservations', 'idx_chat_attachment_quota_reservations_user', '(user_id, expires_at)');
  await ensureMysqlIndex(db, 'chat_attachment_quota_reservations', 'idx_chat_attachment_quota_reservations_expiry', '(expires_at)');
  await db.run(`
    CREATE TABLE IF NOT EXISTS puzzle_excluded_images (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      image_key VARCHAR(512) NOT NULL,
      image_url TEXT NOT NULL,
      source_report_id BIGINT NULL,
      channel_id VARCHAR(191) NULL,
      star INT NULL,
      reason VARCHAR(500) NULL,
      created_by VARCHAR(191) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_puzzle_excluded_images_key (image_key),
      INDEX idx_puzzle_excluded_images_channel_star (channel_id, star),
      INDEX idx_puzzle_excluded_images_report (source_report_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS user_image_blinds (
      user_id VARCHAR(191) NOT NULL,
      image_key VARCHAR(512) NOT NULL,
      image_url TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, image_key),
      INDEX idx_user_image_blinds_user_created (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureMysqlTableCollation(db, 'user_image_blinds');
  await ensureMysqlColumn(db, 'user_titles', 'grant_source', "grant_source VARCHAR(64) NOT NULL DEFAULT 'manual' AFTER is_equipped");
  await ensureMysqlIndex(db, 'user_titles', 'idx_user_titles_grant_source', '(grant_source, title_id)');
  await db.run(`
    CREATE TABLE IF NOT EXISTS deleted_user_accounts (
      user_id VARCHAR(191) PRIMARY KEY,
      deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      username_snapshot VARCHAR(191) NULL,
      avatar_url_snapshot TEXT NULL,
      point_at_deletion BIGINT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureMysqlTableCollation(db, 'deleted_user_accounts');
  await ensureMysqlColumn(db, 'deleted_user_accounts', 'username_snapshot', 'username_snapshot VARCHAR(191) NULL AFTER deleted_at');
  await ensureMysqlColumn(db, 'deleted_user_accounts', 'avatar_url_snapshot', 'avatar_url_snapshot TEXT NULL AFTER username_snapshot');
  await ensureMysqlColumn(db, 'deleted_user_accounts', 'point_at_deletion', 'point_at_deletion BIGINT NULL AFTER avatar_url_snapshot');
  await db.run(`
    CREATE TABLE IF NOT EXISTS point_ledger_entries (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      counterparty_user_id VARCHAR(191) NULL,
      amount BIGINT NOT NULL,
      balance_after BIGINT NULL,
      source_type VARCHAR(64) NOT NULL,
      source_id VARCHAR(191) NULL,
      reason VARCHAR(120) NOT NULL,
      description VARCHAR(500) NULL,
      metadata JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_point_ledger_user_id (user_id, id),
      INDEX idx_point_ledger_counterparty (counterparty_user_id, id),
      INDEX idx_point_ledger_source (source_type, source_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureMysqlTableCollation(db, 'point_ledger_entries');
  await db.run(`
    CREATE TABLE IF NOT EXISTS asset_event_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      event_key VARCHAR(255) NULL,
      user_id VARCHAR(191) NULL,
      counterparty_user_id VARCHAR(191) NULL,
      from_user_id VARCHAR(191) NULL,
      to_user_id VARCHAR(191) NULL,
      asset_type VARCHAR(32) NOT NULL,
      action VARCHAR(32) NOT NULL,
      amount BIGINT NULL,
      quantity BIGINT NULL,
      balance_after BIGINT NULL,
      source_type VARCHAR(64) NOT NULL DEFAULT 'unknown',
      source_id VARCHAR(191) NULL,
      reason VARCHAR(120) NOT NULL,
      description VARCHAR(500) NULL,
      card_id BIGINT NULL,
      channel_id VARCHAR(191) NULL,
      serial_number BIGINT NULL,
      star INT NULL,
      item_id BIGINT NULL,
      item_type VARCHAR(64) NULL,
      metadata JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_asset_event_key (event_key),
      INDEX idx_asset_event_user (user_id, id),
      INDEX idx_asset_event_counterparty (counterparty_user_id, id),
      INDEX idx_asset_event_from_to (from_user_id, to_user_id, id),
      INDEX idx_asset_event_asset_action (asset_type, action, id),
      INDEX idx_asset_event_source (source_type, source_id),
      INDEX idx_asset_event_card (card_id, id),
      INDEX idx_asset_event_item (item_id, id),
      INDEX idx_asset_event_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureMysqlTableCollation(db, 'asset_event_logs');
  await db.run(`
    CREATE TABLE IF NOT EXISTS user_asset_rankings (
      user_id VARCHAR(191) PRIMARY KEY,
      username VARCHAR(191) NOT NULL,
      avatar_url TEXT NULL,
      role VARCHAR(24) NOT NULL DEFAULT 'USER',
      point BIGINT NOT NULL DEFAULT 0,
      last_free_draw DATETIME NULL,
      banned_until DATETIME NULL,
      ban_reason VARCHAR(255) NULL,
      status_message VARCHAR(160) NULL,
      last_seen_at DATETIME NULL,
      created_at DATETIME NULL,
      card_count BIGINT NOT NULL DEFAULT 0,
      cards_value BIGINT NOT NULL DEFAULT 0,
      total_asset BIGINT NOT NULL DEFAULT 0,
      total_rank BIGINT NOT NULL,
      cards_rank BIGINT NOT NULL,
      snapshot_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_asset_rankings_total (total_rank, user_id),
      INDEX idx_user_asset_rankings_cards (cards_rank, user_id),
      INDEX idx_user_asset_rankings_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureMysqlTableCollation(db, 'user_asset_rankings');
  await ensureMysqlColumn(db, 'user_asset_rankings', 'last_seen_at', 'last_seen_at DATETIME NULL AFTER status_message');
  await db.run(`
    CREATE TABLE IF NOT EXISTS user_asset_ranking_cards (
      user_id VARCHAR(191) NOT NULL,
      channel_id VARCHAR(191) NOT NULL,
      star INT NOT NULL DEFAULT 0,
      card_count BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, channel_id, star),
      INDEX idx_user_asset_ranking_cards_channel_star_user (channel_id, star, user_id),
      INDEX idx_user_asset_ranking_cards_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureMysqlTableCollation(db, 'user_asset_ranking_cards');
  await db.run(`
    CREATE TABLE IF NOT EXISTS subscription_title_rules (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      broadcaster_channel_id VARCHAR(191) NOT NULL,
      broadcaster_name VARCHAR(191) NULL,
      title_id BIGINT NOT NULL,
      active TINYINT NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_subscription_title_rules_active (active, title_id),
      INDEX idx_subscription_title_rules_broadcaster (broadcaster_channel_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS subscription_title_states (
      user_id VARCHAR(191) NOT NULL,
      rule_id BIGINT NOT NULL,
      is_subscribed TINYINT NOT NULL DEFAULT 0,
      checked_at DATETIME NULL,
      checked_until DATETIME NULL,
      last_error VARCHAR(191) NULL,
      PRIMARY KEY (user_id, rule_id),
      INDEX idx_subscription_title_states_valid (rule_id, is_subscribed, checked_until),
      INDEX idx_subscription_title_states_user (user_id, checked_until)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureMysqlTableCollation(db, 'subscription_title_rules');
  await ensureMysqlTableCollation(db, 'subscription_title_states');
  await db.run(`
    CREATE TABLE IF NOT EXISTS trades (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      sender_id VARCHAR(191) NOT NULL,
      receiver_id VARCHAR(191) NOT NULL,
      sender_offer JSON NOT NULL,
      receiver_offer JSON NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      completed_at DATETIME NULL,
      INDEX idx_trades_sender_id (sender_id, id),
      INDEX idx_trades_receiver_id (receiver_id, id),
      INDEX idx_trades_status_id (status, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureMysqlColumn(db, 'trades', 'updated_at', 'updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at');
  await ensureMysqlColumn(db, 'trades', 'completed_at', 'completed_at DATETIME NULL AFTER updated_at');
  await ensureMysqlIndex(db, 'users', 'idx_users_username', '(username)');
  await ensureMysqlIndex(db, 'trades', 'idx_trades_sender_id', '(sender_id, id)');
  await ensureMysqlIndex(db, 'trades', 'idx_trades_receiver_id', '(receiver_id, id)');
  await ensureMysqlIndex(db, 'trades', 'idx_trades_status_id', '(status, id)');
  await db.run(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      requester_id VARCHAR(191) NOT NULL,
      receiver_id VARCHAR(191) NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'pending',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      responded_at DATETIME NULL,
      INDEX idx_friend_requests_receiver (receiver_id, status, id),
      INDEX idx_friend_requests_requester (requester_id, status, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureMysqlIndex(db, 'friend_requests', 'idx_friend_requests_receiver', '(receiver_id, status, id)');
  await ensureMysqlIndex(db, 'friend_requests', 'idx_friend_requests_requester', '(requester_id, status, id)');
  await db.run(`
    CREATE TABLE IF NOT EXISTS friendships (
      user_a_id VARCHAR(191) NOT NULL,
      user_b_id VARCHAR(191) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_a_id, user_b_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS chat_rooms (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_a_id VARCHAR(191) NOT NULL,
      user_b_id VARCHAR(191) NOT NULL,
      is_admin_room TINYINT NOT NULL DEFAULT 0,
      closed_at DATETIME NULL,
      closed_by_user_id VARCHAR(191) NULL,
      deleted_for_a TINYINT NOT NULL DEFAULT 0,
      deleted_for_b TINYINT NOT NULL DEFAULT 0,
      hidden_after_a DATETIME NULL,
      hidden_after_b DATETIME NULL,
      muted_for_a TINYINT NOT NULL DEFAULT 0,
      muted_for_b TINYINT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY idx_chat_rooms_pair_unique (user_a_id, user_b_id),
      INDEX idx_chat_rooms_user_a (user_a_id, updated_at),
      INDEX idx_chat_rooms_user_b (user_b_id, updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureMysqlColumn(db, 'chat_rooms', 'hidden_after_a', 'hidden_after_a DATETIME NULL AFTER deleted_for_b');
  await ensureMysqlColumn(db, 'chat_rooms', 'hidden_after_b', 'hidden_after_b DATETIME NULL AFTER hidden_after_a');
  await ensureMysqlColumn(db, 'chat_rooms', 'muted_for_a', 'muted_for_a TINYINT NOT NULL DEFAULT 0 AFTER hidden_after_b');
  await ensureMysqlColumn(db, 'chat_rooms', 'muted_for_b', 'muted_for_b TINYINT NOT NULL DEFAULT 0 AFTER muted_for_a');
  await ensureMysqlIndex(db, 'chat_rooms', 'idx_chat_rooms_user_a', '(user_a_id, updated_at)');
  await ensureMysqlIndex(db, 'chat_rooms', 'idx_chat_rooms_user_b', '(user_b_id, updated_at)');
  await db.run(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      room_id BIGINT NOT NULL,
      sender_id VARCHAR(191) NOT NULL,
      body TEXT NOT NULL,
      message_type VARCHAR(16) NOT NULL DEFAULT 'text',
      attachment_id BIGINT NULL,
      attachment_url VARCHAR(512) NULL,
      attachment_mime VARCHAR(64) NULL,
      attachment_size_bytes BIGINT NULL,
      attachment_width INT NULL,
      attachment_height INT NULL,
      attachment_expires_at DATETIME NULL,
      attachment_deleted_at DATETIME NULL,
      link_preview_json JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      read_at DATETIME NULL,
      INDEX idx_chat_messages_room (room_id, id),
      INDEX idx_chat_messages_unread (room_id, sender_id, read_at),
      INDEX idx_chat_messages_attachment_expiry (message_type, attachment_expires_at, attachment_deleted_at),
      INDEX idx_chat_messages_attachment_id (attachment_id),
      INDEX idx_chat_messages_sender_attachments (sender_id, message_type, attachment_deleted_at, attachment_expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureMysqlColumn(db, 'chat_messages', 'message_type', "message_type VARCHAR(16) NOT NULL DEFAULT 'text' AFTER body");
  await ensureMysqlColumn(db, 'chat_messages', 'attachment_id', 'attachment_id BIGINT NULL AFTER message_type');
  await ensureMysqlColumn(db, 'chat_messages', 'attachment_url', 'attachment_url VARCHAR(512) NULL AFTER message_type');
  await ensureMysqlColumn(db, 'chat_messages', 'attachment_mime', 'attachment_mime VARCHAR(64) NULL AFTER attachment_url');
  await ensureMysqlColumn(db, 'chat_messages', 'attachment_size_bytes', 'attachment_size_bytes BIGINT NULL AFTER attachment_mime');
  await ensureMysqlColumn(db, 'chat_messages', 'attachment_width', 'attachment_width INT NULL AFTER attachment_size_bytes');
  await ensureMysqlColumn(db, 'chat_messages', 'attachment_height', 'attachment_height INT NULL AFTER attachment_width');
  await ensureMysqlColumn(db, 'chat_messages', 'attachment_expires_at', 'attachment_expires_at DATETIME NULL AFTER attachment_height');
  await ensureMysqlColumn(db, 'chat_messages', 'attachment_deleted_at', 'attachment_deleted_at DATETIME NULL AFTER attachment_expires_at');
  await ensureMysqlColumn(db, 'chat_messages', 'link_preview_json', 'link_preview_json JSON NULL AFTER attachment_deleted_at');
  await ensureMysqlIndex(db, 'chat_messages', 'idx_chat_messages_room', '(room_id, id)');
  await ensureMysqlIndex(db, 'chat_messages', 'idx_chat_messages_unread', '(room_id, sender_id, read_at)');
  await ensureMysqlIndex(db, 'chat_messages', 'idx_chat_messages_attachment_expiry', '(message_type, attachment_expires_at, attachment_deleted_at)');
  await ensureMysqlIndex(db, 'chat_messages', 'idx_chat_messages_attachment_id', '(attachment_id)');
  await ensureMysqlIndex(db, 'chat_messages', 'idx_chat_messages_sender_attachments', '(sender_id, message_type, attachment_deleted_at, attachment_expires_at)');
  await ensureMysqlColumn(db, 'notifications', 'group_key', 'group_key VARCHAR(191) NULL AFTER link');
  await ensureMysqlIndex(db, 'notifications', 'idx_notifications_group_key', '(user_id, group_key, deleted_at)');
  await db.run(`
    CREATE TABLE IF NOT EXISTS market_listings (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      seller_id VARCHAR(191) NOT NULL,
      user_card_id BIGINT NOT NULL,
      pending_user_card_id BIGINT NULL,
      price BIGINT NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
      listing_type VARCHAR(32) NOT NULL DEFAULT 'fixed',
      buy_now_price BIGINT NULL,
      starting_bid BIGINT NULL,
      current_bid BIGINT NULL,
      current_bidder_id VARCHAR(191) NULL,
      auction_ends_at VARCHAR(64) NULL,
      bid_reserved BIGINT DEFAULT 0,
      buyer_id VARCHAR(191) NULL,
      fee BIGINT DEFAULT 0,
      fee_rate INT DEFAULT 5,
      settled_amount BIGINT DEFAULT 0,
      with_cosmetics TINYINT DEFAULT 0,
      seller_hidden_at VARCHAR(64) NULL,
      created_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP()),
      updated_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP()),
      UNIQUE KEY idx_market_listings_pending_card (pending_user_card_id),
      KEY idx_market_listings_status (status),
      KEY idx_market_listings_seller (seller_id),
      KEY idx_market_listings_card (user_card_id),
      KEY idx_market_listings_buyer (buyer_id),
      KEY idx_market_listings_current_bidder (current_bidder_id),
      CONSTRAINT fk_market_listings_seller FOREIGN KEY(seller_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_market_listings_card FOREIGN KEY(user_card_id) REFERENCES user_cards(id) ON DELETE CASCADE,
      CONSTRAINT fk_market_listings_current_bidder FOREIGN KEY(current_bidder_id) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_market_listings_buyer FOREIGN KEY(buyer_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureMysqlColumn(db, 'market_listings', 'listing_type', "listing_type VARCHAR(32) NOT NULL DEFAULT 'fixed' AFTER status");
  await ensureMysqlColumn(db, 'market_listings', 'buy_now_price', 'buy_now_price BIGINT NULL AFTER listing_type');
  await ensureMysqlColumn(db, 'market_listings', 'starting_bid', 'starting_bid BIGINT NULL AFTER buy_now_price');
  await ensureMysqlColumn(db, 'market_listings', 'current_bid', 'current_bid BIGINT NULL AFTER starting_bid');
  await ensureMysqlColumn(db, 'market_listings', 'current_bidder_id', 'current_bidder_id VARCHAR(191) NULL AFTER current_bid');
  await ensureMysqlColumn(db, 'market_listings', 'auction_ends_at', 'auction_ends_at VARCHAR(64) NULL AFTER current_bidder_id');
  await ensureMysqlColumn(db, 'market_listings', 'bid_reserved', 'bid_reserved BIGINT DEFAULT 0 AFTER auction_ends_at');
  await ensureMysqlColumn(db, 'market_listings', 'fee_rate', 'fee_rate INT DEFAULT 5 AFTER fee');
  await ensureMysqlColumn(db, 'market_listings', 'settled_amount', 'settled_amount BIGINT DEFAULT 0 AFTER fee_rate');
  await ensureMysqlColumn(db, 'market_listings', 'with_cosmetics', 'with_cosmetics TINYINT DEFAULT 0 AFTER settled_amount');
  await ensureMysqlColumn(db, 'market_listings', 'seller_hidden_at', 'seller_hidden_at VARCHAR(64) NULL AFTER with_cosmetics');
  await ensureMysqlColumn(db, 'market_listings', 'pending_user_card_id', 'pending_user_card_id BIGINT NULL AFTER updated_at');
  await db.run(`
    UPDATE market_listings
       SET listing_type = COALESCE(listing_type, 'fixed'),
           bid_reserved = COALESCE(bid_reserved, 0),
           fee_rate = COALESCE(fee_rate, 5),
           settled_amount = COALESCE(settled_amount, 0),
           with_cosmetics = COALESCE(with_cosmetics, 0),
           pending_user_card_id = CASE WHEN status = 'PENDING' THEN COALESCE(pending_user_card_id, user_card_id) ELSE NULL END
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS market_bids (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      listing_id BIGINT NOT NULL,
      bidder_id VARCHAR(191) NOT NULL,
      amount BIGINT NOT NULL,
      created_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP()),
      KEY idx_market_bids_listing (listing_id, amount),
      KEY idx_market_bids_bidder (bidder_id),
      CONSTRAINT fk_market_bids_listing FOREIGN KEY(listing_id) REFERENCES market_listings(id) ON DELETE CASCADE,
      CONSTRAINT fk_market_bids_bidder FOREIGN KEY(bidder_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureMysqlColumn(db, 'minigame_sessions', 'validation_version', 'validation_version INT NOT NULL DEFAULT 0 AFTER earned_points');
  await ensureMysqlColumn(db, 'minigame_sessions', 'progress_data', "progress_data MEDIUMTEXT NOT NULL DEFAULT ('{}') AFTER validation_version");
  await ensureMysqlColumn(db, 'minigame_sessions', 'progress_revision', 'progress_revision INT NOT NULL DEFAULT 0 AFTER progress_data');
  await ensureMysqlColumn(db, 'minigame_sessions', 'expires_at', 'expires_at VARCHAR(64) NULL AFTER progress_revision');
  await ensureMysqlColumn(db, 'minigame_sessions', 'result_data', 'result_data MEDIUMTEXT NULL AFTER expires_at');
  await ensureMysqlIndex(db, 'streamers', 'idx_streamers_base_value', '(base_value DESC, channel_id)');
  await ensureMysqlIndex(db, 'value_history', 'idx_value_history_channel_recorded', '(channel_id, recorded_at DESC)');
  await ensureMysqlIndex(db, 'value_history', 'idx_value_history_recorded_channel', '(recorded_at DESC, channel_id)');
  await ensureMysqlIndex(db, 'minigame_sessions', 'idx_minigame_sessions_status_created', '(status, created_at, id)');
  await ensureMysqlIndex(db, 'minigame_sessions', 'idx_minigame_sessions_user_game_status_created', '(user_id, game_type, status, created_at DESC)');
  await ensureMysqlIndex(db, 'minigame_sessions', 'idx_minigame_sessions_user_status_paid_created', '(user_id, status, ticket_spent_type, created_at DESC)');
  await ensureMysqlIndex(db, 'user_cards', 'idx_user_cards_user_visible', '(user_id, is_hidden)');
  await ensureMysqlIndex(db, 'user_cards', 'idx_user_cards_user_visible_channel_star', '(user_id, is_hidden, channel_id, star)');
  await ensureMysqlIndex(db, 'user_cards', 'idx_user_cards_channel_star_visible', '(channel_id, star, is_hidden)');
  await ensureMysqlIndex(db, 'market_listings', 'idx_market_listings_status_updated', '(status, updated_at DESC, id DESC)');
  await ensureMysqlIndex(db, 'market_listings', 'idx_market_listings_status_created_latest', '(status, created_at DESC, id DESC)');
  await ensureMysqlIndex(db, 'market_listings', 'idx_market_listings_status_type_updated', '(status, listing_type, updated_at DESC, id DESC)');
  await ensureMysqlIndex(db, 'market_listings', 'idx_market_listings_status_type_created', '(status, listing_type, created_at, id)');
  await ensureMysqlIndex(db, 'market_listings', 'idx_market_listings_status_price', '(status, price, id)');
  await ensureMysqlIndex(db, 'market_listings', 'idx_market_listings_status_auction_end', '(status, auction_ends_at, id)');
  await ensureMysqlIndex(db, 'market_listings', 'idx_market_listings_bidder_active', '(status, listing_type, current_bidder_id, bid_reserved)');
  await ensureMysqlIndex(db, 'market_listings', 'idx_market_listings_status_type_auction_end', '(status, listing_type, auction_ends_at, id)');
  await dropMysqlSingleColumnUniqueIndexes(db, 'market_listings', 'user_card_id');
  await ensureMysqlUniqueIndex(db, 'market_listings', 'idx_market_listings_pending_card', '(pending_user_card_id)');
  await normalizeMysqlIsoDateColumn(db, 'market_listings', 'auction_ends_at');
  const marketBidsTable = await db.get<{ present: number }>(
    `SELECT 1 AS present
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = 'market_bids'
      LIMIT 1`
  );
  if (marketBidsTable) {
    await ensureMysqlIndex(db, 'market_bids', 'idx_market_bids_bidder_listing', '(bidder_id, listing_id)');
  }
  await db.run(`
    DELETE n1 FROM notifications n1
    JOIN notifications n2
      ON n1.user_id = n2.user_id
     AND n1.group_key = n2.group_key
     AND n1.group_key IS NOT NULL
     AND n1.id < n2.id
  `);
  await ensureMysqlUniqueIndex(db, 'notifications', 'uniq_notifications_group_key', '(user_id, group_key)');
  await db.run(`
    CREATE TABLE IF NOT EXISTS chat_attachments (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      owner_user_id VARCHAR(191) NOT NULL,
      source_hash CHAR(64) NOT NULL,
      url VARCHAR(512) NOT NULL,
      mime VARCHAR(64) NOT NULL,
      size_bytes BIGINT NOT NULL,
      width INT NULL,
      height INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      deleted_at DATETIME NULL,
      UNIQUE KEY idx_chat_attachments_owner_hash (owner_user_id, source_hash),
      INDEX idx_chat_attachments_owner_active (owner_user_id, deleted_at, expires_at),
      INDEX idx_chat_attachments_expiry (expires_at, deleted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS link_previews (
      url_hash CHAR(64) PRIMARY KEY,
      normalized_url TEXT NOT NULL,
      preview_json JSON NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'success',
      fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      INDEX idx_link_previews_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS market_transaction_audit_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      audit_key VARCHAR(255) NOT NULL UNIQUE,
      listing_id BIGINT NULL,
      event_type VARCHAR(64) NOT NULL,
      related_user_id VARCHAR(191) NULL,
      seller_id VARCHAR(191) NULL,
      buyer_id VARCHAR(191) NULL,
      current_bidder_id VARCHAR(191) NULL,
      user_card_id BIGINT NULL,
      channel_id VARCHAR(191) NULL,
      serial_number BIGINT NULL,
      star INT NULL,
      price BIGINT NULL,
      status VARCHAR(32) NULL,
      listing_type VARCHAR(32) NULL,
      current_bid BIGINT NULL,
      bid_reserved BIGINT NULL,
      fee BIGINT NULL,
      settled_amount BIGINT NULL,
      listing_created_at DATETIME NULL,
      listing_updated_at DATETIME NULL,
      recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_market_audit_listing (listing_id, event_type),
      INDEX idx_market_audit_user (related_user_id, recorded_at),
      INDEX idx_market_audit_seller (seller_id, recorded_at),
      INDEX idx_market_audit_buyer (buyer_id, recorded_at),
      INDEX idx_market_audit_bidder (current_bidder_id, recorded_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
};

export const ensurePostgresCompatibilityMigrations = async (db: PostgresDb) => {
  const ensureIndex = async (sql: string) => {
    try {
      await db.run(sql);
    } catch (err: any) {
      if (err?.code === '42P01' || err?.code === '42703' || err?.code === '42704' || err?.code === '42P07' || String(err?.message || '').includes('does not exist')) return;
      throw err;
    }
  };
  const dedupeRows = async (table: string, partitionBy: string, orderBy: string, where = 'TRUE') => {
    try {
      await db.run(`
        DELETE FROM ${table}
         WHERE ctid IN (
           SELECT ctid
             FROM (
               SELECT ctid,
                      ROW_NUMBER() OVER (
                        PARTITION BY ${partitionBy}
                        ORDER BY ${orderBy}
                      ) AS rn
                 FROM ${table}
                WHERE ${where}
             ) ranked
            WHERE rn > 1
         )
      `);
    } catch (err: any) {
      if (err?.code === '42P01' || err?.code === '42703' || String(err?.message || '').includes('does not exist')) return;
      throw err;
    }
  };

  // Keep this hot-path function in sync with init-db-postgres.sql. The live worker
  // calls it every cycle, so it must update the whole batch with one set-based SQL
  // statement instead of issuing one UPDATE per streamer inside PL/pgSQL.
  try {
    await db.run('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  } catch (err: any) {
    console.warn('[DB] pg_trgm 확장 보정 실패, trigram 검색 인덱스는 건너뜁니다:', err?.message || err);
  }
  await db.run('ALTER TABLE streamers ADD COLUMN IF NOT EXISTS lifecycle_id TEXT');
  await db.run("UPDATE streamers SET lifecycle_id = md5(random()::text || clock_timestamp()::text || channel_id) WHERE lifecycle_id IS NULL OR lifecycle_id = ''");
  await db.run("ALTER TABLE streamers ALTER COLUMN lifecycle_id SET DEFAULT md5(random()::text || clock_timestamp()::text)");
  await db.run('ALTER TABLE streamers ALTER COLUMN lifecycle_id SET NOT NULL');
  await db.run(`
    ALTER TABLE shop_items
      ADD COLUMN IF NOT EXISTS listed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS sale_start_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS sale_end_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS limited_total_quantity INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS sold_quantity INTEGER NOT NULL DEFAULT 0
  `);
  await db.run('UPDATE shop_items SET listed_at = COALESCE(created_at, NOW()) WHERE active = TRUE AND listed_at IS NULL');
  await db.run(`
    ALTER TABLE minigame_sessions
      ADD COLUMN IF NOT EXISTS validation_version INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS progress_data TEXT NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS progress_revision INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS result_data TEXT
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS deleted_user_accounts (
      user_id TEXT PRIMARY KEY,
      deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      username_snapshot TEXT,
      avatar_url_snapshot TEXT,
      point_at_deletion BIGINT
    )
  `);
  await db.run(`
    ALTER TABLE deleted_user_accounts
      ADD COLUMN IF NOT EXISTS username_snapshot TEXT,
      ADD COLUMN IF NOT EXISTS avatar_url_snapshot TEXT,
      ADD COLUMN IF NOT EXISTS point_at_deletion BIGINT
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS chat_attachment_quota_locks (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS chat_attachment_quota_reservations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reserved_bytes BIGINT NOT NULL CHECK (reserved_bytes > 0),
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS market_transaction_audit_logs (
      id BIGSERIAL PRIMARY KEY,
      audit_key TEXT NOT NULL,
      listing_id BIGINT,
      event_type TEXT NOT NULL,
      related_user_id TEXT,
      seller_id TEXT,
      buyer_id TEXT,
      current_bidder_id TEXT,
      user_card_id BIGINT,
      channel_id TEXT,
      serial_number BIGINT,
      star INTEGER,
      price BIGINT,
      status TEXT,
      listing_type TEXT,
      current_bid BIGINT,
      bid_reserved BIGINT,
      fee BIGINT,
      settled_amount BIGINT,
      listing_created_at TIMESTAMPTZ,
      listing_updated_at TIMESTAMPTZ,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.run(`
    ALTER TABLE market_transaction_audit_logs
      ADD COLUMN IF NOT EXISTS audit_key TEXT,
      ADD COLUMN IF NOT EXISTS listing_id BIGINT,
      ADD COLUMN IF NOT EXISTS event_type TEXT,
      ADD COLUMN IF NOT EXISTS related_user_id TEXT,
      ADD COLUMN IF NOT EXISTS seller_id TEXT,
      ADD COLUMN IF NOT EXISTS buyer_id TEXT,
      ADD COLUMN IF NOT EXISTS current_bidder_id TEXT,
      ADD COLUMN IF NOT EXISTS user_card_id BIGINT,
      ADD COLUMN IF NOT EXISTS channel_id TEXT,
      ADD COLUMN IF NOT EXISTS serial_number BIGINT,
      ADD COLUMN IF NOT EXISTS star INTEGER,
      ADD COLUMN IF NOT EXISTS price BIGINT,
      ADD COLUMN IF NOT EXISTS status TEXT,
      ADD COLUMN IF NOT EXISTS listing_type TEXT,
      ADD COLUMN IF NOT EXISTS current_bid BIGINT,
      ADD COLUMN IF NOT EXISTS bid_reserved BIGINT,
      ADD COLUMN IF NOT EXISTS fee BIGINT,
      ADD COLUMN IF NOT EXISTS settled_amount BIGINT,
      ADD COLUMN IF NOT EXISTS listing_created_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS listing_updated_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS market_listings (
      id BIGSERIAL PRIMARY KEY,
      seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_card_id INTEGER NOT NULL REFERENCES user_cards(id) ON DELETE CASCADE,
      pending_user_card_id INTEGER,
      price BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      listing_type TEXT NOT NULL DEFAULT 'fixed',
      buy_now_price BIGINT,
      starting_bid BIGINT,
      current_bid BIGINT,
      current_bidder_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      auction_ends_at TIMESTAMPTZ,
      bid_reserved BIGINT DEFAULT 0,
      buyer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      fee BIGINT DEFAULT 0,
      fee_rate INTEGER DEFAULT 5,
      settled_amount BIGINT DEFAULT 0,
      with_cosmetics BOOLEAN DEFAULT FALSE,
      seller_hidden_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )
  `);
  await db.run(`
    ALTER TABLE market_listings
      ADD COLUMN IF NOT EXISTS pending_user_card_id INTEGER,
      ADD COLUMN IF NOT EXISTS listing_type TEXT NOT NULL DEFAULT 'fixed',
      ADD COLUMN IF NOT EXISTS buy_now_price BIGINT,
      ADD COLUMN IF NOT EXISTS starting_bid BIGINT,
      ADD COLUMN IF NOT EXISTS current_bid BIGINT,
      ADD COLUMN IF NOT EXISTS current_bidder_id TEXT,
      ADD COLUMN IF NOT EXISTS auction_ends_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS bid_reserved BIGINT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS fee_rate INTEGER DEFAULT 5,
      ADD COLUMN IF NOT EXISTS settled_amount BIGINT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS with_cosmetics BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS seller_hidden_at TIMESTAMPTZ
  `);
  await db.run(`
    UPDATE market_listings
       SET listing_type = COALESCE(listing_type, 'fixed'),
           bid_reserved = COALESCE(bid_reserved, 0),
           fee_rate = COALESCE(fee_rate, 5),
           settled_amount = COALESCE(settled_amount, 0),
           with_cosmetics = COALESCE(with_cosmetics, FALSE),
           pending_user_card_id = CASE WHEN status = 'PENDING' THEN COALESCE(pending_user_card_id, user_card_id) ELSE NULL END
  `);
  await db.run('ALTER TABLE market_listings DROP CONSTRAINT IF EXISTS market_listings_user_card_id_key');
  await db.run(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
          FROM pg_indexes
         WHERE schemaname = current_schema()
           AND indexname = 'idx_market_listings_pending_card'
           AND indexdef NOT ILIKE '%(pending_user_card_id)%'
      ) THEN
        DROP INDEX idx_market_listings_pending_card;
      END IF;
    END $$;
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS market_bids (
      id BIGSERIAL PRIMARY KEY,
      listing_id INTEGER NOT NULL REFERENCES market_listings(id) ON DELETE CASCADE,
      bidder_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount BIGINT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.run(`
    CREATE OR REPLACE FUNCTION bulk_apply_streamer_schedule(p_updates JSONB)
    RETURNS VOID AS $$
      WITH updates AS (
        SELECT *
          FROM jsonb_to_recordset(p_updates) AS u(
            channel_id TEXT,
            prev_value INTEGER,
            base_value INTEGER,
            activity_score INTEGER,
            broadcast_multiplier REAL,
            add_minutes INTEGER,
            add_broadcast_count INTEGER,
            consumed_chats INTEGER,
            polled BOOLEAN,
            is_active BOOLEAN,
            follower_count INTEGER,
            logo_url TEXT,
            last_broadcast_at TEXT
          )
      )
      UPDATE streamers s
         SET prev_value           = u.prev_value,
             base_value           = u.base_value,
             activity_score       = u.activity_score,
             broadcast_multiplier = u.broadcast_multiplier,
             broadcast_minutes    = s.broadcast_minutes + COALESCE(u.add_minutes, 0),
             broadcast_count      = s.broadcast_count + COALESCE(u.add_broadcast_count, 0),
             chat_count           = GREATEST(s.chat_count - COALESCE(u.consumed_chats, 0), 0),
             is_active            = CASE WHEN COALESCE(u.polled, FALSE) THEN COALESCE(u.is_active, FALSE) ELSE s.is_active END,
             follower_count       = CASE WHEN COALESCE(u.polled, FALSE) THEN COALESCE(u.follower_count, s.follower_count) ELSE s.follower_count END,
             logo_url             = CASE WHEN COALESCE(u.polled, FALSE) THEN COALESCE(u.logo_url, s.logo_url) ELSE s.logo_url END,
             last_broadcast_at    = CASE
                                      WHEN COALESCE(u.polled, FALSE)
                                      THEN COALESCE(NULLIF(u.last_broadcast_at, '')::TIMESTAMPTZ, s.last_broadcast_at)
                                      ELSE s.last_broadcast_at
                                    END,
             updated_at           = NOW()
        FROM updates u
      WHERE s.channel_id = u.channel_id;
    $$ LANGUAGE sql;
  `);

  await dedupeRows(
    'user_achievements',
    'user_id, achievement_id, repeat_key',
    `CASE status WHEN 'claimed' THEN 0 WHEN 'completed' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END,
     progress_current DESC,
     claimed_at DESC NULLS LAST,
     completed_at DESC NULLS LAST,
     last_evaluated_at DESC NULLS LAST,
     id DESC`
  );
  await dedupeRows(
    'user_achievement_stats',
    'user_id, stat_key',
    'stat_value DESC, updated_at DESC NULLS LAST'
  );
  await dedupeRows(
    'achievement_grant_logs',
    'user_id, achievement_id, repeat_key',
    `CASE status WHEN 'success' THEN 0 WHEN 'pending' THEN 1 WHEN 'revoked' THEN 2 ELSE 3 END,
     created_at DESC NULLS LAST,
     id DESC`
  );
  await dedupeRows('achievement_events', 'event_key', 'occurred_at DESC NULLS LAST, id DESC');
  await dedupeRows('achievement_evaluation_queue', 'dedupe_key', 'priority DESC, created_at ASC NULLS LAST, id ASC');
  await dedupeRows('achievements', 'code', 'is_active DESC, sort_order ASC, id DESC');
  await dedupeRows('streamers', 'channel_id', 'updated_at DESC NULLS LAST');
  await dedupeRows('system_configs', 'key', 'ctid DESC');
  await dedupeRows('user_card_serials', 'channel_id', 'last_serial DESC, updated_at DESC NULLS LAST');
  await dedupeRows('push_subscriptions', 'endpoint', 'created_at DESC NULLS LAST, id DESC');
  await dedupeRows('streamer_registration_blocks', 'channel_id', 'created_at DESC NULLS LAST');
  await dedupeRows('chat_attachments', 'owner_user_id, source_hash', 'last_used_at DESC NULLS LAST, id DESC');
  await dedupeRows('user_cosmetics', 'user_id, item_id', 'quantity DESC, id DESC');
  await dedupeRows('shop_purchases', 'user_id, item_id', 'count DESC');
  await dedupeRows('user_minigame_tickets', 'user_id', 'updated_at DESC NULLS LAST');
  await dedupeRows('user_titles', 'user_id, title_id', 'is_equipped DESC, awarded_at DESC NULLS LAST');
  await dedupeRows('subscription_title_states', 'user_id, rule_id', 'checked_at DESC NULLS LAST');
  await dedupeRows('user_image_blinds', 'user_id, image_key', 'created_at DESC NULLS LAST');
  await dedupeRows('link_previews', 'url_hash', 'fetched_at DESC NULLS LAST');
  await dedupeRows('puzzle_excluded_images', 'image_key', 'id DESC');
  await dedupeRows('arena_worker_heartbeats', 'worker_id', 'heartbeat_at DESC NULLS LAST');
  await dedupeRows('arena_user_cosmetic_loadouts', 'user_id', 'updated_at DESC NULLS LAST');
  await dedupeRows('arena_cup_replays', 'cup_id', 'updated_at DESC NULLS LAST');
  await dedupeRows('arena_match_replays', 'match_id', 'updated_at DESC NULLS LAST');
  await dedupeRows('arena_player_ratings', 'season_id, user_id', 'rating_points DESC, mmr DESC, updated_at DESC NULLS LAST');
  await dedupeRows('notifications', 'user_id, group_key', 'created_at DESC NULLS LAST, id DESC', 'group_key IS NOT NULL');
  await dedupeRows('market_watches', 'user_id, channel_id, star', 'created_at DESC NULLS LAST, id DESC');
  await dedupeRows('market_transaction_audit_logs', 'audit_key', 'recorded_at DESC NULLS LAST, id DESC');
  await dedupeRows('asset_event_logs', 'event_key', 'created_at DESC NULLS LAST, id DESC');
  await dedupeRows('tutorial_rewards', 'user_id, reward_key', 'created_at DESC NULLS LAST');
  await dedupeRows('coupon_logs', 'coupon_id, user_id', 'used_at DESC NULLS LAST, id DESC');
  await dedupeRows('coupons', 'code', 'created_at DESC NULLS LAST, id DESC');
  await dedupeRows('friendships', 'user_a_id, user_b_id', 'created_at DESC NULLS LAST');
  await dedupeRows('user_blocks', 'blocker_id, blocked_id', 'created_at DESC NULLS LAST');
  await dedupeRows('deleted_user_accounts', 'user_id', 'deleted_at DESC NULLS LAST');

  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_achievement_repeat ON user_achievements (user_id, achievement_id, repeat_key)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_achievement_stats_key ON user_achievement_stats (user_id, stat_key)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_achievement_grant ON achievement_grant_logs (user_id, achievement_id, repeat_key)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_achievement_event_key ON achievement_events (event_key)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_achievement_queue_dedupe ON achievement_evaluation_queue (dedupe_key)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_achievements_code ON achievements (code)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_streamers_channel ON streamers (channel_id)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_system_configs_key ON system_configs (key)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_card_serials_channel ON user_card_serials (channel_id)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_push_subscriptions_endpoint ON push_subscriptions (endpoint)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_streamer_registration_blocks_channel ON streamer_registration_blocks (channel_id)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_chat_attachments_owner_hash ON chat_attachments (owner_user_id, source_hash)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_cosmetics_item ON user_cosmetics (user_id, item_id)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_shop_purchases_item ON shop_purchases (user_id, item_id)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_minigame_tickets_user ON user_minigame_tickets (user_id)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_titles_user_title ON user_titles (user_id, title_id)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_subscription_title_states_rule ON subscription_title_states (user_id, rule_id)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_image_blinds_key ON user_image_blinds (user_id, image_key)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_link_previews_hash ON link_previews (url_hash)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_puzzle_excluded_images_key ON puzzle_excluded_images (image_key)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_arena_worker_heartbeats_worker ON arena_worker_heartbeats (worker_id)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_arena_user_cosmetic_loadouts_user ON arena_user_cosmetic_loadouts (user_id)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_arena_cup_replays_cup ON arena_cup_replays (cup_id)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_arena_match_replays_match ON arena_match_replays (match_id)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_arena_player_ratings_user ON arena_player_ratings (season_id, user_id)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_notifications_group_key ON notifications (user_id, group_key) WHERE group_key IS NOT NULL');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_market_watches_user_channel_star ON market_watches (user_id, channel_id, star)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_market_audit_key ON market_transaction_audit_logs (audit_key)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_audit_listing ON market_transaction_audit_logs (listing_id, event_type)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_audit_user ON market_transaction_audit_logs (related_user_id, recorded_at DESC)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_audit_seller ON market_transaction_audit_logs (seller_id, recorded_at DESC)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_audit_buyer ON market_transaction_audit_logs (buyer_id, recorded_at DESC)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_audit_bidder ON market_transaction_audit_logs (current_bidder_id, recorded_at DESC)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_asset_event_logs_key ON asset_event_logs (event_key)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_tutorial_rewards_key ON tutorial_rewards (user_id, reward_key)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_coupon_logs_user ON coupon_logs (coupon_id, user_id)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_coupons_code ON coupons (code)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_friendships_pair ON friendships (user_a_id, user_b_id)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_blocks_pair ON user_blocks (blocker_id, blocked_id)');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS uniq_deleted_user_accounts_user ON deleted_user_accounts (user_id)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auth_sessions_user_active ON auth_sessions (user_id, revoked_at, expires_at)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions (expires_at)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_attachment_quota_reservations_user ON chat_attachment_quota_reservations (user_id, expires_at)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_attachment_quota_reservations_expiry ON chat_attachment_quota_reservations (expires_at)');

  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_username_trgm ON users USING GIN (username gin_trgm_ops)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_id_trgm ON users USING GIN (id gin_trgm_ops)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_banned_until ON users (banned_until) WHERE banned_until IS NOT NULL');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_streamers_name_trgm ON streamers USING GIN (name gin_trgm_ops)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_streamers_active_value ON streamers (is_active, base_value DESC)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_streamers_base_value ON streamers (base_value DESC, channel_id)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shop_items_active_listed ON shop_items (active, listed_at DESC, id DESC)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shop_items_limited_sale ON shop_items (active, sale_start_at, sale_end_at, limited_total_quantity, sold_quantity)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_cards_user_visible ON user_cards (user_id, is_hidden)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_cards_user_visible_channel_star ON user_cards (user_id, is_hidden, channel_id, star)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_cards_user_locked ON user_cards (user_id, is_locked)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_cards_channel_star_visible ON user_cards (channel_id, star, is_hidden)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_cards_channel_serial ON user_cards (channel_id, serial_number)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_cards_unlocked_user_channel_id ON user_cards (user_id, channel_id, id) WHERE is_locked IS NOT TRUE');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_cards_user_inventory_order ON user_cards (user_id, favorite_order, id DESC)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_cards_user_favorite_max ON user_cards (user_id, favorite_order DESC) WHERE favorite_order IS NOT NULL');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_value_history_channel_recorded ON value_history (channel_id, recorded_at DESC)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_value_history_recorded_channel ON value_history (recorded_at DESC, channel_id)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_asset_rankings_total ON user_asset_rankings (total_rank, user_id)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_asset_rankings_cards ON user_asset_rankings (cards_rank, user_id)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_asset_rankings_username_trgm ON user_asset_rankings USING GIN (username gin_trgm_ops)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_asset_ranking_cards_channel_star_user ON user_asset_ranking_cards (channel_id, star, user_id)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_asset_ranking_cards_user ON user_asset_ranking_cards (user_id)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_listings_status_updated ON market_listings (status, updated_at DESC, id DESC)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_listings_status_created_latest ON market_listings (status, created_at DESC, id DESC)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_listings_status_type_updated ON market_listings (status, listing_type, updated_at DESC, id DESC)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_listings_status_type_created ON market_listings (status, listing_type, created_at, id)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_listings_status_price ON market_listings (status, price, id)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_listings_status_auction_end ON market_listings (status, auction_ends_at, id)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_listings_bidder_active ON market_listings (status, listing_type, current_bidder_id, bid_reserved)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_listings_pending_created_latest ON market_listings (created_at DESC, id DESC) WHERE status = \'PENDING\'');
  await ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS idx_market_listings_pending_card ON market_listings (pending_user_card_id)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_bids_listing ON market_bids (listing_id, amount DESC)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_bids_bidder_listing ON market_bids (bidder_id, listing_id)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_rooms_user_a_active ON chat_rooms (user_a_id, updated_at DESC) WHERE deleted_for_a = FALSE');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_rooms_user_b_active ON chat_rooms (user_b_id, updated_at DESC) WHERE deleted_for_b = FALSE');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_messages_room_id ON chat_messages (room_id, id)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_messages_room_visible_latest ON chat_messages (room_id, id DESC) WHERE attachment_deleted_at IS NULL OR message_type <> \'image\'');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_messages_unread ON chat_messages (room_id, sender_id, read_at)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_attachments_owner_active ON chat_attachments (owner_user_id, deleted_at, expires_at)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_attachments_expiry ON chat_attachments (expires_at, deleted_at)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_active_latest ON notifications (user_id, created_at DESC, id DESC) WHERE deleted_at IS NULL');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_unread_active ON notifications (user_id, created_at DESC) WHERE deleted_at IS NULL AND is_read = FALSE');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_friend_requests_receiver ON friend_requests (receiver_id, status, id)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_friend_requests_requester ON friend_requests (requester_id, status, id)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_friendships_user_b ON friendships (user_b_id)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscription_title_rules_active ON subscription_title_rules (active, title_id)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscription_title_states_valid ON subscription_title_states (rule_id, is_subscribed, checked_until)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscription_title_states_user ON subscription_title_states (user_id, checked_until)');
  await db.run(`
    WITH ranked_paid_sessions AS (
      SELECT id,
             ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC NULLS LAST, id DESC) AS rn
        FROM minigame_sessions
       WHERE status = 'STARTED'
         AND ticket_spent_type IN ('BASE', 'BONUS')
    )
    UPDATE minigame_sessions AS session
       SET status = 'EXPIRED',
           completed_at = COALESCE(session.completed_at, NOW())
      FROM ranked_paid_sessions AS ranked
     WHERE session.id = ranked.id
       AND ranked.rn > 1
  `);
  await ensureIndex("CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uniq_minigame_sessions_paid_started_user ON minigame_sessions (user_id) WHERE status = 'STARTED' AND ticket_spent_type IN ('BASE', 'BONUS')");
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_minigame_sessions_status_created ON minigame_sessions (status, created_at, id)');
  await ensureIndex('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_minigame_sessions_user_game_status_created ON minigame_sessions (user_id, game_type, status, created_at DESC)');
};

/**
 * 데이터베이스 연결 상태를 감지하고 모드를 초기화합니다.
 */
export const initDatabaseConnection = async (
  options: { runCompatibilityMigrations?: boolean } = {}
): Promise<void> => {
  const runCompatibilityMigrations = options.runCompatibilityMigrations !== false;
  const configuredDbMode = getConfiguredDbMode();
  if (configuredDbMode === 'mysql') {
    const db = createMysqlDb();
    mysqlDb = db;
    await db.get('SELECT 1 AS ok');
    if (runCompatibilityMigrations) {
      await ensureMysqlCompatibilityMigrations(db);
      await ensureArenaV2MysqlSchema(db);
    }
    dbMode = 'MYSQL';
    sqlDialect = 'mysql';
    console.log('[DB] MySQL 데이터베이스와 연동되었습니다. (MYSQL MODE)');
    return;
  }

  if (configuredDbMode === 'postgres') {
    mysqlDb = createPostgresDb();
    await mysqlDb.get('SELECT 1 AS ok');
    if (runCompatibilityMigrations) {
      await ensurePostgresCompatibilityMigrations(mysqlDb as PostgresDb);
      await ensureArenaV2MysqlSchema(mysqlDb as PostgresDb);
    }
    dbMode = 'MYSQL';
    sqlDialect = 'postgres';
    console.log('[DB] PostgreSQL 데이터베이스와 연동되었습니다. (POSTGRES MODE, SQL repository layer)');
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (configuredDbMode === 'supabase') {
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('[DB] DB_MODE=supabase 이지만 SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 누락되었습니다.');
    }
    try {
      assertServerSupabaseKey(supabaseKey);
      // Supabase 클라이언트 인스턴스화 (일시 네트워크 오류 재시도 fetch 주입)
      supabaseClient = createClient(supabaseUrl, supabaseKey, {
        global: { fetch: fetchWithRetry }
      });
      
      // 실제 원격 서버 연결이 유효한지 1건 조회 시도 (연결 감지)
      const { error } = await supabaseClient.from('users').select('id').limit(1);
      
      if (error) {
        throw new Error(error.message);
      }
      
      dbMode = 'SUPABASE';
      sqlDialect = null;
      console.log('[DB] Supabase 클라우드 데이터베이스와 연동되었습니다. (SUPABASE MODE)');
      return;
    } catch (err: any) {
      throw new Error(`[DB] Supabase 모드 초기화 실패: ${err.message || err}`);
    }
  }

  // 로컬 SQLite로 Fallback 처리
  try {
    dbMode = 'LOCAL_SQL';
    sqlDialect = null;
    if (configuredDbMode === 'sqlite') {
      console.log('[DB] DB_MODE=sqlite 설정에 따라 SQLite 모드로 동작합니다.');
    } else {
      console.log('[DB] DB_MODE가 지정되지 않아 SQLite 모드로 동작합니다. (legacy fallback)');
    }
    const dbPath = getSqliteDbPath();
    if (process.env.SQLITE_REQUIRE_PERSISTENT_PATH === 'true' && !process.env.SQLITE_DB_PATH?.trim()) {
      throw new Error('[DB] SQLITE_REQUIRE_PERSISTENT_PATH=true 이지만 SQLITE_DB_PATH가 설정되지 않았습니다.');
    }
    ensureParentDirectory(dbPath);
    sqliteDb = new Database(dbPath);
    
    // SQLite3 기본 설정 변경 (성능 향상 및 락 방지)
    sqliteDb.pragma('busy_timeout = 5000');
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.pragma('synchronous = NORMAL');
    // Supabase export SQLite는 PK/UNIQUE 제약이 빠질 수 있어 초기 호환 마이그레이션 전까지 FK 검사를 잠시 끕니다.
    sqliteDb.pragma('foreign_keys = OFF');
    
    // init-db.sql 초기 스키마 및 더미 로드
    const sqlPath = path.join(__dirname, '../../../init-db.sql');
    if (fs.existsSync(sqlPath)) {
      const sqlSchema = fs.readFileSync(sqlPath, 'utf8');
      ensureSqlitePreSchemaCompatibility(sqliteDb);
      sqliteDb.exec(sqlSchema);
      console.log(`[DB] 로컬 SQLite3 데이터베이스 연결 및 초기 스키마 적재가 완료되었습니다. (LOCAL MODE: ${dbPath})`);
      
      // 테이블 컬럼 자동 마이그레이션 방어 장치
      try {
        sqliteDb.prepare("SELECT broadcast_count FROM streamers LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] streamers 테이블에 broadcast_count 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE streamers ADD COLUMN broadcast_count INTEGER DEFAULT 0;");
      }
      try {
        sqliteDb.prepare("SELECT chat_count FROM streamers LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] streamers 테이블에 chat_count 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE streamers ADD COLUMN chat_count INTEGER DEFAULT 0;");
      }
      try {
        sqliteDb.prepare("SELECT broadcast_multiplier FROM streamers LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] streamers 테이블에 broadcast_multiplier 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE streamers ADD COLUMN broadcast_multiplier REAL DEFAULT 1.0;");
      }
      try {
        sqliteDb.prepare("SELECT prev_value FROM streamers LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] streamers 테이블에 prev_value 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE streamers ADD COLUMN prev_value INTEGER DEFAULT 1000;");
      }
      try {
        sqliteDb.prepare("SELECT broadcast_minutes FROM streamers LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] streamers 테이블에 broadcast_minutes 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE streamers ADD COLUMN broadcast_minutes INTEGER DEFAULT 0;");
      }
      try {
        sqliteDb.prepare("SELECT registered_by FROM streamers LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] streamers 테이블에 registered_by 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE streamers ADD COLUMN registered_by TEXT;");
      }
      try {
        sqliteDb.prepare("SELECT lifecycle_id FROM streamers LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] streamers 테이블에 lifecycle_id 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE streamers ADD COLUMN lifecycle_id TEXT;");
      }
      sqliteDb.exec("UPDATE streamers SET lifecycle_id = lower(hex(randomblob(16))) WHERE lifecycle_id IS NULL OR lifecycle_id = '';");
      try {
        sqliteDb.prepare("SELECT serial_number FROM streamers LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] streamers 테이블에 serial_number 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE streamers ADD COLUMN serial_number INTEGER;");
      }
      try {
        sqliteDb.prepare("SELECT last_broadcast_at FROM streamers LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] streamers 테이블에 last_broadcast_at 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE streamers ADD COLUMN last_broadcast_at TEXT;");
      }
      // 별(1~5성)별 커스텀 카드 이미지 컬럼 (0성은 기존 custom_image_url 사용)
      for (let st = 1; st <= 5; st++) {
        try {
          sqliteDb.prepare(`SELECT custom_image_url_${st} FROM streamers LIMIT 1`).get();
        } catch (e) {
          console.log(`[DB Migration] streamers 테이블에 custom_image_url_${st} 컬럼이 없어 추가합니다.`);
          sqliteDb.exec(`ALTER TABLE streamers ADD COLUMN custom_image_url_${st} TEXT;`);
        }
      }
      try {
        sqliteDb.prepare("SELECT representative_card_channel_id FROM users LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] users 테이블에 representative_card_channel_id 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE users ADD COLUMN representative_card_channel_id TEXT;");
      }
      try {
        sqliteDb.prepare("SELECT representative_card_star FROM users LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] users 테이블에 representative_card_star 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE users ADD COLUMN representative_card_star INTEGER;");
      }
      try {
        sqliteDb.prepare("SELECT status_message FROM users LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] users 테이블에 status_message 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE users ADD COLUMN status_message TEXT;");
      }
      try {
        sqliteDb.prepare("SELECT ban_reason FROM users LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] users 테이블에 ban_reason 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE users ADD COLUMN ban_reason TEXT;");
      }
      try {
        sqliteDb.prepare("SELECT access_token FROM users LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] users 테이블에 access_token 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE users ADD COLUMN access_token TEXT;");
      }
      try {
        sqliteDb.prepare("SELECT refresh_token FROM users LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] users 테이블에 refresh_token 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE users ADD COLUMN refresh_token TEXT;");
      }
      try {
        sqliteDb.prepare("SELECT token_expires_at FROM users LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] users 테이블에 token_expires_at 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE users ADD COLUMN token_expires_at TEXT;");
      }
      try {
        sqliteDb.prepare("SELECT last_seen_at FROM users LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] users 테이블에 last_seen_at 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE users ADD COLUMN last_seen_at TEXT;");
      }
      try {
        sqliteDb.prepare("SELECT free_draw_tickets FROM users LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] users 테이블에 free_draw_tickets 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE users ADD COLUMN free_draw_tickets INTEGER NOT NULL DEFAULT 0;");
      }
      try {
        sqliteDb.prepare("SELECT bonus_free_draw_tickets FROM users LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] users 테이블에 bonus_free_draw_tickets 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE users ADD COLUMN bonus_free_draw_tickets INTEGER NOT NULL DEFAULT 0;");
      }
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS deleted_user_accounts (
        user_id TEXT PRIMARY KEY,
        deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
        username_snapshot TEXT,
        avatar_url_snapshot TEXT,
        point_at_deletion INTEGER
      );`);
      try {
        sqliteDb.prepare("SELECT username_snapshot FROM deleted_user_accounts LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] deleted_user_accounts 테이블에 username_snapshot 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE deleted_user_accounts ADD COLUMN username_snapshot TEXT;");
      }
      try {
        sqliteDb.prepare("SELECT avatar_url_snapshot FROM deleted_user_accounts LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] deleted_user_accounts 테이블에 avatar_url_snapshot 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE deleted_user_accounts ADD COLUMN avatar_url_snapshot TEXT;");
      }
      try {
        sqliteDb.prepare("SELECT point_at_deletion FROM deleted_user_accounts LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] deleted_user_accounts 테이블에 point_at_deletion 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE deleted_user_accounts ADD COLUMN point_at_deletion INTEGER;");
      }
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS point_ledger_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        counterparty_user_id TEXT,
        amount INTEGER NOT NULL,
        balance_after INTEGER,
        source_type TEXT NOT NULL,
        source_id TEXT,
        reason TEXT NOT NULL,
        description TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now'))
      );`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_point_ledger_user_id ON point_ledger_entries(user_id, id DESC);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_point_ledger_counterparty ON point_ledger_entries(counterparty_user_id, id DESC);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_point_ledger_source ON point_ledger_entries(source_type, source_id);`);
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS asset_event_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_key TEXT UNIQUE,
        user_id TEXT,
        counterparty_user_id TEXT,
        from_user_id TEXT,
        to_user_id TEXT,
        asset_type TEXT NOT NULL,
        action TEXT NOT NULL,
        amount INTEGER,
        quantity INTEGER,
        balance_after INTEGER,
        source_type TEXT NOT NULL DEFAULT 'unknown',
        source_id TEXT,
        reason TEXT NOT NULL,
        description TEXT,
        card_id INTEGER,
        channel_id TEXT,
        serial_number INTEGER,
        star INTEGER,
        item_id INTEGER,
        item_type TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now'))
      );`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_asset_event_user ON asset_event_logs(user_id, id DESC);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_asset_event_counterparty ON asset_event_logs(counterparty_user_id, id DESC);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_asset_event_from_to ON asset_event_logs(from_user_id, to_user_id, id DESC);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_asset_event_asset_action ON asset_event_logs(asset_type, action, id DESC);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_asset_event_source ON asset_event_logs(source_type, source_id);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_asset_event_card ON asset_event_logs(card_id, id DESC);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_asset_event_item ON asset_event_logs(item_id, id DESC);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_asset_event_created ON asset_event_logs(created_at);`);
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS tutorial_rewards (
        user_id TEXT NOT NULL,
        reward_key TEXT NOT NULL,
        reward_type TEXT NOT NULL,
        reward_amount INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(user_id, reward_key),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );`);
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS subscription_title_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        broadcaster_channel_id TEXT NOT NULL,
        broadcaster_name TEXT,
        title_id INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY(title_id) REFERENCES titles(id) ON DELETE CASCADE
      );`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_subscription_title_rules_active ON subscription_title_rules(active, title_id);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_subscription_title_rules_broadcaster ON subscription_title_rules(broadcaster_channel_id);`);
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS subscription_title_states (
        user_id TEXT NOT NULL,
        rule_id INTEGER NOT NULL,
        is_subscribed INTEGER NOT NULL DEFAULT 0,
        checked_at TEXT,
        checked_until TEXT,
        last_error TEXT,
        PRIMARY KEY(user_id, rule_id),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(rule_id) REFERENCES subscription_title_rules(id) ON DELETE CASCADE
      );`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_subscription_title_states_valid ON subscription_title_states(rule_id, is_subscribed, checked_until);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_subscription_title_states_user ON subscription_title_states(user_id, checked_until);`);
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id TEXT NOT NULL,
        receiver_id TEXT NOT NULL,
        sender_offer TEXT NOT NULL,
        receiver_offer TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT,
        FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE
      );`);
      try {
        sqliteDb.prepare("SELECT updated_at FROM trades LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] trades 테이블에 updated_at 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE trades ADD COLUMN updated_at TEXT;");
        sqliteDb.exec("UPDATE trades SET updated_at = COALESCE(created_at, datetime('now')) WHERE updated_at IS NULL;");
      }
      try {
        sqliteDb.prepare("SELECT completed_at FROM trades LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] trades 테이블에 completed_at 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE trades ADD COLUMN completed_at TEXT;");
      }
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_trades_sender_id ON trades(sender_id, id DESC);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_trades_receiver_id ON trades(receiver_id, id DESC);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_trades_status_id ON trades(status, id DESC);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver ON friend_requests(receiver_id, status, id);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_friend_requests_requester ON friend_requests(requester_id, status, id);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_chat_rooms_user_a ON chat_rooms(user_a_id, updated_at);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_chat_rooms_user_b ON chat_rooms(user_b_id, updated_at);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id, id);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_chat_messages_unread ON chat_messages(room_id, sender_id, read_at);");
      try {
        sqliteDb.prepare("SELECT hidden_after_a FROM chat_rooms LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] chat_rooms 테이블에 사용자별 숨김 기준 컬럼을 추가합니다.');
        sqliteDb.exec("ALTER TABLE chat_rooms ADD COLUMN hidden_after_a TEXT;");
        sqliteDb.exec("ALTER TABLE chat_rooms ADD COLUMN hidden_after_b TEXT;");
      }
      try {
        sqliteDb.prepare("SELECT muted_for_a FROM chat_rooms LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] chat_rooms 테이블에 사용자별 알림 끄기 컬럼을 추가합니다.');
        sqliteDb.exec("ALTER TABLE chat_rooms ADD COLUMN muted_for_a INTEGER NOT NULL DEFAULT 0;");
        sqliteDb.exec("ALTER TABLE chat_rooms ADD COLUMN muted_for_b INTEGER NOT NULL DEFAULT 0;");
      }
      try {
        sqliteDb.prepare("SELECT message_type FROM chat_messages LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] chat_messages 테이블에 이미지 첨부 컬럼을 추가합니다.');
        sqliteDb.exec("ALTER TABLE chat_messages ADD COLUMN message_type TEXT NOT NULL DEFAULT 'text';");
        sqliteDb.exec("ALTER TABLE chat_messages ADD COLUMN attachment_id INTEGER;");
        sqliteDb.exec("ALTER TABLE chat_messages ADD COLUMN attachment_url TEXT;");
        sqliteDb.exec("ALTER TABLE chat_messages ADD COLUMN attachment_mime TEXT;");
        sqliteDb.exec("ALTER TABLE chat_messages ADD COLUMN attachment_size_bytes INTEGER;");
        sqliteDb.exec("ALTER TABLE chat_messages ADD COLUMN attachment_width INTEGER;");
        sqliteDb.exec("ALTER TABLE chat_messages ADD COLUMN attachment_height INTEGER;");
        sqliteDb.exec("ALTER TABLE chat_messages ADD COLUMN attachment_expires_at TEXT;");
        sqliteDb.exec("ALTER TABLE chat_messages ADD COLUMN attachment_deleted_at TEXT;");
      }
      try {
        sqliteDb.prepare("SELECT attachment_id FROM chat_messages LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] chat_messages 테이블에 첨부 캐시 참조 컬럼을 추가합니다.');
        sqliteDb.exec("ALTER TABLE chat_messages ADD COLUMN attachment_id INTEGER;");
      }
      try {
        sqliteDb.prepare("SELECT link_preview_json FROM chat_messages LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] chat_messages 테이블에 링크 프리뷰 컬럼을 추가합니다.');
        sqliteDb.exec("ALTER TABLE chat_messages ADD COLUMN link_preview_json TEXT;");
      }
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_chat_messages_attachment_expiry ON chat_messages(message_type, attachment_expires_at, attachment_deleted_at);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_chat_messages_attachment_id ON chat_messages(attachment_id);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_chat_messages_sender_attachments ON chat_messages(sender_id, message_type, attachment_deleted_at, attachment_expires_at);");
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS chat_attachments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_user_id TEXT NOT NULL,
          source_hash TEXT NOT NULL,
          url TEXT NOT NULL,
          mime TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          width INTEGER,
          height INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at TEXT NOT NULL,
          deleted_at TEXT,
          UNIQUE(owner_user_id, source_hash)
        );
      `);
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_chat_attachments_owner_active ON chat_attachments(owner_user_id, deleted_at, expires_at);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_chat_attachments_expiry ON chat_attachments(expires_at, deleted_at);");
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS link_previews (
          url_hash TEXT PRIMARY KEY,
          normalized_url TEXT NOT NULL,
          preview_json TEXT,
          status TEXT NOT NULL DEFAULT 'success',
          fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at TEXT NOT NULL
        );
      `);
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_link_previews_expires ON link_previews(expires_at);");
      try {
        sqliteDb.prepare("SELECT star FROM user_cards LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] user_cards 테이블에 star 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE user_cards ADD COLUMN star INTEGER DEFAULT 0;");
      }
      try {
        sqliteDb.prepare("SELECT border_item_id FROM user_cards LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] user_cards 테이블에 코스메틱 장착 컬럼을 추가합니다.');
        sqliteDb.exec("ALTER TABLE user_cards ADD COLUMN border_item_id INTEGER;");
        sqliteDb.exec("ALTER TABLE user_cards ADD COLUMN name_effect_item_id INTEGER;");
      }
      try {
        sqliteDb.prepare("SELECT is_hidden FROM user_cards LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] user_cards 테이블에 숨김/즐겨찾기 컬럼을 추가합니다.');
        sqliteDb.exec("ALTER TABLE user_cards ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;");
        sqliteDb.exec("ALTER TABLE user_cards ADD COLUMN favorite_order INTEGER;");
        sqliteDb.exec("ALTER TABLE user_cards ADD COLUMN favorite_at TEXT;");
      }
      try {
        sqliteDb.prepare("SELECT is_locked FROM user_cards LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] user_cards 테이블에 카드 잠금 컬럼을 추가합니다.');
        sqliteDb.exec("ALTER TABLE user_cards ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0;");
      }
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_user_cards_user_visible ON user_cards(user_id, is_hidden);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_user_cards_user_visible_channel_star ON user_cards(user_id, is_hidden, channel_id, star);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_user_cards_user_locked ON user_cards(user_id, is_locked);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_user_cards_channel_id ON user_cards(channel_id, id);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_user_cards_channel_star_visible ON user_cards(channel_id, star, is_hidden);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_user_cards_user_inventory_order ON user_cards(user_id, favorite_order, id DESC);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_user_cards_user_favorite_max ON user_cards(user_id, favorite_order DESC) WHERE favorite_order IS NOT NULL;");
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS user_asset_rankings (
          user_id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          avatar_url TEXT,
          role TEXT DEFAULT 'USER',
          point INTEGER NOT NULL DEFAULT 0,
          last_free_draw TEXT,
          banned_until TEXT,
          ban_reason TEXT,
          status_message TEXT,
          last_seen_at TEXT,
          created_at TEXT,
          card_count INTEGER NOT NULL DEFAULT 0,
          cards_value INTEGER NOT NULL DEFAULT 0,
          total_asset INTEGER NOT NULL DEFAULT 0,
          total_rank INTEGER NOT NULL,
          cards_rank INTEGER NOT NULL,
          snapshot_at TEXT DEFAULT (datetime('now'))
        );
      `);
      try {
        sqliteDb.prepare("SELECT last_seen_at FROM user_asset_rankings LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] user_asset_rankings 테이블에 last_seen_at 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE user_asset_rankings ADD COLUMN last_seen_at TEXT;");
      }
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_user_asset_rankings_total ON user_asset_rankings(total_rank, user_id);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_user_asset_rankings_cards ON user_asset_rankings(cards_rank, user_id);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_user_asset_rankings_username ON user_asset_rankings(username);");
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS user_asset_ranking_cards (
          user_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          star INTEGER NOT NULL DEFAULT 0,
          card_count INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, channel_id, star)
        );
      `);
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_user_asset_ranking_cards_channel_star_user ON user_asset_ranking_cards(channel_id, star, user_id);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_user_asset_ranking_cards_user ON user_asset_ranking_cards(user_id);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_streamers_base_value ON streamers(base_value DESC, channel_id);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_value_history_channel_recorded ON value_history(channel_id, recorded_at DESC);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_value_history_recorded_channel ON value_history(recorded_at DESC, channel_id);");
      try {
        sqliteDb.prepare("SELECT reward_type FROM coupons LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] coupons 테이블에 보상(reward) 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE coupons ADD COLUMN reward_type TEXT NOT NULL DEFAULT 'point';");
        sqliteDb.exec("ALTER TABLE coupons ADD COLUMN reward_channel_id TEXT;");
        sqliteDb.exec("ALTER TABLE coupons ADD COLUMN reward_quantity INTEGER DEFAULT 0;");
      }
      try {
        sqliteDb.prepare("SELECT reward_item_id FROM coupons LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] coupons 테이블에 reward_item_id(코스메틱 보상) 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE coupons ADD COLUMN reward_item_id INTEGER;");
      }
      try {
        sqliteDb.prepare("SELECT rewards FROM coupons LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] coupons 테이블에 rewards(다중 보상) 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE coupons ADD COLUMN rewards TEXT NOT NULL DEFAULT '[]';");
      }
      try {
        sqliteDb.prepare("SELECT coupon_code FROM push_notifications LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] push_notifications 테이블에 coupon_code 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE push_notifications ADD COLUMN coupon_code TEXT;");
      }
      try {
        sqliteDb.prepare("SELECT sent_at FROM push_notifications LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] push_notifications 테이블에 sent_at(발송 시각) 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE push_notifications ADD COLUMN sent_at TEXT;");
      }
      try {
        sqliteDb.prepare("SELECT origin FROM push_subscriptions LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] push_subscriptions 테이블에 origin 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE push_subscriptions ADD COLUMN origin TEXT;");
      }
      try {
        sqliteDb.exec(`
          DELETE FROM push_subscriptions
           WHERE id NOT IN (
             SELECT MAX(id)
               FROM push_subscriptions
              GROUP BY endpoint
           );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);
        `);
      } catch (e) {
        console.warn('[DB Migration] push_subscriptions endpoint 중복 정리/인덱스 생성 경고:', e);
      }
      try {
        sqliteDb.prepare("SELECT purchase_limit FROM shop_items LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] shop_items 테이블에 purchase_limit(1인 구매 제한) 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE shop_items ADD COLUMN purchase_limit INTEGER DEFAULT 0;");
      }
      try {
        sqliteDb.prepare("SELECT listed_at FROM shop_items LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] shop_items 테이블에 상점 등록 시각(listed_at) 컬럼을 추가합니다.');
        sqliteDb.exec("ALTER TABLE shop_items ADD COLUMN listed_at TEXT;");
      }
      sqliteDb.exec("UPDATE shop_items SET listed_at = COALESCE(created_at, datetime('now')) WHERE active = 1 AND listed_at IS NULL;");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_shop_items_active_listed ON shop_items(active, listed_at, id);");
      try {
        sqliteDb.prepare("SELECT sale_start_at FROM shop_items LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] shop_items 테이블에 한정판매 컬럼을 추가합니다.');
        sqliteDb.exec("ALTER TABLE shop_items ADD COLUMN sale_start_at TEXT;");
        sqliteDb.exec("ALTER TABLE shop_items ADD COLUMN sale_end_at TEXT;");
        sqliteDb.exec("ALTER TABLE shop_items ADD COLUMN limited_total_quantity INTEGER NOT NULL DEFAULT 0;");
        sqliteDb.exec("ALTER TABLE shop_items ADD COLUMN sold_quantity INTEGER NOT NULL DEFAULT 0;");
      }
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_shop_items_limited_sale ON shop_items(active, sale_start_at, sale_end_at, limited_total_quantity, sold_quantity);");
      try {
        sqliteDb.prepare("SELECT is_equipped FROM user_titles LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] user_titles 테이블에 is_equipped 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE user_titles ADD COLUMN is_equipped INTEGER NOT NULL DEFAULT 0;");
      }
      try {
        sqliteDb.prepare("SELECT grant_source FROM user_titles LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] user_titles 테이블에 grant_source 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE user_titles ADD COLUMN grant_source TEXT NOT NULL DEFAULT 'manual';");
      }
      try {
        sqliteDb.prepare("SELECT description FROM titles LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] titles 테이블에 description 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE titles ADD COLUMN description TEXT;");
      }
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_user_titles_grant_source ON user_titles(grant_source, title_id);");
      sqliteDb.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_titles_equipped ON user_titles(user_id) WHERE is_equipped = 1;");
      try {
        sqliteDb.prepare("SELECT star FROM card_reports LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] card_reports 테이블에 star(신고 카드 별) 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE card_reports ADD COLUMN star INTEGER DEFAULT 0;");
      }
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS puzzle_excluded_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        image_key TEXT NOT NULL UNIQUE,
        image_url TEXT NOT NULL,
        source_report_id INTEGER,
        channel_id TEXT,
        star INTEGER,
        reason TEXT,
        created_by TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );`);
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_puzzle_excluded_images_channel_star ON puzzle_excluded_images(channel_id, star);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_puzzle_excluded_images_report ON puzzle_excluded_images(source_report_id);");
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS user_image_blinds (
        user_id TEXT NOT NULL,
        image_key TEXT NOT NULL,
        image_url TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY(user_id, image_key)
      );`);
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_user_image_blinds_user_created ON user_image_blinds(user_id, created_at);");
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS streamer_registration_blocks (
        channel_id TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        blocked_by TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );`);
      try {
        sqliteDb.prepare("SELECT deleted_at FROM notifications LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] notifications 테이블에 deleted_at 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE notifications ADD COLUMN deleted_at TEXT;");
      }
      try {
        sqliteDb.prepare("SELECT group_key FROM notifications LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] notifications 테이블에 묶음 키 컬럼을 추가합니다.');
        sqliteDb.exec("ALTER TABLE notifications ADD COLUMN group_key TEXT;");
      }
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_notifications_group_key ON notifications(user_id, group_key, deleted_at);");
      sqliteDb.exec(`
        DELETE FROM notifications
         WHERE group_key IS NOT NULL
           AND id NOT IN (
             SELECT MAX(id)
               FROM notifications
              WHERE group_key IS NOT NULL
              GROUP BY user_id, group_key
           );
      `);
      sqliteDb.exec("CREATE UNIQUE INDEX IF NOT EXISTS uniq_notifications_group_key ON notifications(user_id, group_key);");
      try {
        sqliteDb.prepare("SELECT is_pinned FROM announcements LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] announcements 테이블에 is_pinned(상단 고정) 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE announcements ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;");
      }
      // 상점 구매 횟수 테이블 (구매 제한 추적) — 신규 배포 호환
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS shop_purchases (
        user_id TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        count INTEGER DEFAULT 0,
        PRIMARY KEY(user_id, item_id)
      );`);

      // 오픈마켓 매물 테이블 생성 — 신규 배포 호환
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS market_listings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seller_id TEXT NOT NULL,
        user_card_id INTEGER NOT NULL,
        price INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        buyer_id TEXT,
        bid_reserved INTEGER DEFAULT 0,
        fee INTEGER DEFAULT 0,
        fee_rate INTEGER DEFAULT 5,
        settled_amount INTEGER DEFAULT 0,
        with_cosmetics INTEGER DEFAULT 0,
        seller_hidden_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY(seller_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(user_card_id) REFERENCES user_cards(id) ON DELETE CASCADE,
        FOREIGN KEY(buyer_id) REFERENCES users(id) ON DELETE SET NULL
      );`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_market_listings_status ON market_listings(status);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_market_listings_created ON market_listings(created_at);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_market_listings_status_updated ON market_listings(status, updated_at DESC, id DESC);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_market_listings_status_type_updated ON market_listings(status, listing_type, updated_at DESC, id DESC);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_market_listings_status_type_created ON market_listings(status, listing_type, created_at, id);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_market_listings_status_price ON market_listings(status, price, id);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_market_listings_status_auction_end ON market_listings(status, auction_ends_at, id);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_market_listings_bidder_active ON market_listings(status, listing_type, current_bidder_id, bid_reserved);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_market_listings_sold_updated_card ON market_listings(status, updated_at DESC, user_card_id, price);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_market_listings_participants ON market_listings(seller_id, buyer_id, current_bidder_id);`);
      try {
        const db = sqliteDb;
        if (!db) throw new Error('SQLITE_DB_NOT_READY');
        const indexes = db.prepare("PRAGMA index_list('market_listings')").all() as any[];
        const hasGlobalCardUnique = indexes.some((idx) => {
          if (idx.partial) return false;
          if (!idx.unique) return false;
          const cols = db.prepare(`PRAGMA index_info(${JSON.stringify(idx.name)})`).all() as any[];
          return cols.length === 1 && cols[0]?.name === 'user_card_id';
        });
        if (hasGlobalCardUnique) {
          console.log('[DB Migration] market_listings.user_card_id 전역 UNIQUE 제약을 PENDING 부분 UNIQUE 인덱스로 변경합니다.');
          const fk = db.pragma('foreign_keys', { simple: true }) as number;
          db.pragma('foreign_keys = OFF');
          try {
            db.exec(`
              DROP TABLE IF EXISTS market_listings_new;
              CREATE TABLE IF NOT EXISTS market_listings_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                seller_id TEXT NOT NULL,
                user_card_id INTEGER NOT NULL,
                price INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'PENDING',
                buyer_id TEXT,
                bid_reserved INTEGER DEFAULT 0,
                fee INTEGER DEFAULT 0,
                fee_rate INTEGER DEFAULT 5,
                settled_amount INTEGER DEFAULT 0,
                with_cosmetics INTEGER DEFAULT 0,
                seller_hidden_at TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY(seller_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(user_card_id) REFERENCES user_cards(id) ON DELETE CASCADE,
                FOREIGN KEY(buyer_id) REFERENCES users(id) ON DELETE SET NULL
              );
              INSERT INTO market_listings_new
                (id, seller_id, user_card_id, price, status, buyer_id, bid_reserved, fee, fee_rate, settled_amount, with_cosmetics, seller_hidden_at, created_at, updated_at)
              SELECT id, seller_id, user_card_id, price, status, buyer_id, 0, fee, 5, settled_amount,
                     COALESCE(with_cosmetics, 0), NULL, created_at, updated_at
                FROM market_listings;
              DROP TABLE market_listings;
              ALTER TABLE market_listings_new RENAME TO market_listings;
            `);
          } finally {
            db.pragma(`foreign_keys = ${fk ? 'ON' : 'OFF'}`);
          }
        }
      } catch (e) {
        console.error('[DB Migration] market_listings UNIQUE 제약 변경 실패:', e);
      }
      sqliteDb.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_market_listings_pending_card ON market_listings(user_card_id) WHERE status = 'PENDING';`);
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS market_transaction_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        audit_key TEXT NOT NULL UNIQUE,
        listing_id INTEGER,
        event_type TEXT NOT NULL,
        related_user_id TEXT,
        seller_id TEXT,
        buyer_id TEXT,
        current_bidder_id TEXT,
        user_card_id INTEGER,
        channel_id TEXT,
        serial_number INTEGER,
        star INTEGER,
        price INTEGER,
        status TEXT,
        listing_type TEXT,
        current_bid INTEGER,
        bid_reserved INTEGER,
        fee INTEGER,
        settled_amount INTEGER,
        listing_created_at TEXT,
        listing_updated_at TEXT,
        recorded_at TEXT DEFAULT (datetime('now'))
      );`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_market_audit_listing ON market_transaction_audit_logs(listing_id, event_type);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_market_audit_user ON market_transaction_audit_logs(related_user_id, recorded_at);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_market_audit_participants ON market_transaction_audit_logs(seller_id, buyer_id, current_bidder_id);`);

      // 미니게임 티켓 및 세션 테이블 생성
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS user_minigame_tickets (
        user_id TEXT PRIMARY KEY,
        current_tickets INTEGER NOT NULL DEFAULT 5,
        bonus_tickets INTEGER NOT NULL DEFAULT 0,
        last_charged_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );`);

      try {
        sqliteDb.prepare("SELECT bonus_tickets FROM user_minigame_tickets LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] user_minigame_tickets 테이블에 bonus_tickets 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE user_minigame_tickets ADD COLUMN bonus_tickets INTEGER NOT NULL DEFAULT 0;");
      }

      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS minigame_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        game_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'STARTED',
        target_data TEXT,
        ticket_spent_type TEXT DEFAULT 'NONE',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        earned_points INTEGER DEFAULT 0,
        validation_version INTEGER NOT NULL DEFAULT 0,
        progress_data TEXT NOT NULL DEFAULT '{}',
        progress_revision INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT,
        result_data TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );`);
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_minigame_sessions_status_created ON minigame_sessions(status, created_at, id);");
      sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_minigame_sessions_user_game_status_created ON minigame_sessions(user_id, game_type, status, created_at DESC);");

      try {
        sqliteDb.prepare("SELECT ticket_spent_type FROM minigame_sessions LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] minigame_sessions 테이블에 ticket_spent_type 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE minigame_sessions ADD COLUMN ticket_spent_type TEXT DEFAULT 'NONE';");
      }

      for (const [column, ddl] of [
        ['validation_version', 'ALTER TABLE minigame_sessions ADD COLUMN validation_version INTEGER NOT NULL DEFAULT 0;'],
        ['progress_data', "ALTER TABLE minigame_sessions ADD COLUMN progress_data TEXT NOT NULL DEFAULT '{}';"],
        ['progress_revision', 'ALTER TABLE minigame_sessions ADD COLUMN progress_revision INTEGER NOT NULL DEFAULT 0;'],
        ['expires_at', 'ALTER TABLE minigame_sessions ADD COLUMN expires_at TEXT;'],
        ['result_data', 'ALTER TABLE minigame_sessions ADD COLUMN result_data TEXT;']
      ] as const) {
        try {
          sqliteDb.prepare(`SELECT ${column} FROM minigame_sessions LIMIT 1`).get();
        } catch {
          console.log(`[DB Migration] minigame_sessions 테이블에 ${column} 컬럼이 없어 추가합니다.`);
          sqliteDb.exec(ddl);
        }
      }

      sqliteDb.exec(`
        UPDATE minigame_sessions
           SET status = 'EXPIRED',
               completed_at = COALESCE(completed_at, datetime('now'))
         WHERE id IN (
           SELECT id
             FROM (
               SELECT id,
                      ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY datetime(created_at) DESC, id DESC) AS rn
                 FROM minigame_sessions
                WHERE status = 'STARTED'
                  AND ticket_spent_type IN ('BASE', 'BONUS')
             ) ranked_paid_sessions
            WHERE rn > 1
         );
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_minigame_sessions_paid_started_user
          ON minigame_sessions(user_id)
         WHERE status = 'STARTED'
           AND ticket_spent_type IN ('BASE', 'BONUS');
      `);

      try {
        sqliteDb.prepare("SELECT with_cosmetics FROM market_listings LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] market_listings 테이블에 with_cosmetics 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE market_listings ADD COLUMN with_cosmetics INTEGER DEFAULT 0;");
      }
      for (const [column, ddl] of [
        ['listing_type', "ALTER TABLE market_listings ADD COLUMN listing_type TEXT NOT NULL DEFAULT 'fixed';"],
        ['buy_now_price', 'ALTER TABLE market_listings ADD COLUMN buy_now_price INTEGER;'],
        ['starting_bid', 'ALTER TABLE market_listings ADD COLUMN starting_bid INTEGER;'],
        ['current_bid', 'ALTER TABLE market_listings ADD COLUMN current_bid INTEGER;'],
        ['current_bidder_id', 'ALTER TABLE market_listings ADD COLUMN current_bidder_id TEXT;'],
        ['auction_ends_at', 'ALTER TABLE market_listings ADD COLUMN auction_ends_at TEXT;'],
        ['bid_reserved', 'ALTER TABLE market_listings ADD COLUMN bid_reserved INTEGER DEFAULT 0;'],
        ['fee_rate', 'ALTER TABLE market_listings ADD COLUMN fee_rate INTEGER DEFAULT 5;'],
        ['seller_hidden_at', 'ALTER TABLE market_listings ADD COLUMN seller_hidden_at TEXT;']
      ] as const) {
        try {
          sqliteDb.prepare(`SELECT ${column} FROM market_listings LIMIT 1`).get();
        } catch (e) {
          console.log(`[DB Migration] market_listings 테이블에 ${column} 컬럼이 없어 추가합니다.`);
          sqliteDb.exec(ddl);
        }
      }
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS market_bids (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        listing_id INTEGER NOT NULL,
        bidder_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY(listing_id) REFERENCES market_listings(id) ON DELETE CASCADE,
        FOREIGN KEY(bidder_id) REFERENCES users(id) ON DELETE CASCADE
      );`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_market_bids_listing ON market_bids(listing_id, amount DESC);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_market_bids_bidder_listing ON market_bids(bidder_id, listing_id);`);
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS market_watches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        star INTEGER,
        max_price INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, channel_id, star),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(channel_id) REFERENCES streamers(channel_id) ON DELETE CASCADE
      );`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_market_watches_card ON market_watches(channel_id, star);`);

      // 시스템 설정 테이블 (무료 뽑기 간격 등)
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS system_configs (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );`);
      sqliteDb.prepare("INSERT OR IGNORE INTO system_configs (key, value) VALUES ('free_draw_interval', '24')").run();
      sqliteDb.prepare("INSERT OR IGNORE INTO system_configs (key, value) VALUES ('free_draw_max_stack', '1')").run();
      // 뽑기 비용 기본값 (하드코딩 제거, DB 관리)
      sqliteDb.prepare("INSERT OR IGNORE INTO system_configs (key, value) VALUES ('draw_cost', '10000')").run();
      // 가챠 추첨 목표 기댓값(원하는 1회 뽑기 평균 카드 가치). 가중 지수를 이 값에 맞춰 적응 조정.
      sqliteDb.prepare("INSERT OR IGNORE INTO system_configs (key, value) VALUES ('draw_target_value', '2500')").run();
      sqliteDb.prepare("INSERT OR IGNORE INTO system_configs (key, value) VALUES ('minigame_ticket_charge_interval_minutes', '240')").run();
      sqliteDb.prepare("INSERT OR IGNORE INTO system_configs (key, value) VALUES ('maintenance_active', 'false')").run();
      sqliteDb.prepare("INSERT OR IGNORE INTO system_configs (key, value) VALUES ('maintenance_start_at', '')").run();
      sqliteDb.prepare("INSERT OR IGNORE INTO system_configs (key, value) VALUES ('maintenance_end_at', '')").run();
      ensureArenaV2SqliteSchema(sqliteDb);

      try {
        ensureSqliteCompatibilityConstraints(sqliteDb);
        sqliteDb.pragma('foreign_keys = ON');
        console.log('[DB Migration] SQLite UNIQUE/ID 호환 제약 보정 완료했습니다.');
      } catch (constraintErr: any) {
        console.error('[DB Migration] SQLite UNIQUE/ID 호환 제약 보정 실패:', constraintErr?.message || constraintErr);
        throw constraintErr;
      }

      // 이미지 URL 자동 상대경로 마이그레이션 (호스트/포트 변경 방어 장치)
      try {
        const columns = [
          'custom_image_url', 'custom_image_url_1', 'custom_image_url_2',
          'custom_image_url_3', 'custom_image_url_4', 'custom_image_url_5'
        ];
        for (const col of columns) {
          sqliteDb.prepare(`
            UPDATE streamers
            SET ${col} = '/' || SUBSTR(${col}, INSTR(${col}, 'uploads/'))
            WHERE ${col} LIKE '%/uploads/%'
          `).run();
        }
        console.log('[DB Migration] SQLite 이미지 절대경로를 상대경로로 변환 완료했습니다.');
      } catch (migrateErr: any) {
        console.warn('[DB Migration] SQLite 이미지 경로 마이그레이션 경고:', migrateErr?.message);
      }
    } else {
      console.warn(`[DB] 초기화 SQL 파일(${sqlPath})을 찾을 수 없어 테이블 생성 단계를 건너뜁니다.`);
      sqliteDb.pragma('foreign_keys = ON');
    }
  } catch (sqliteErr) {
    console.error('[DB] 로컬 SQLite3 데이터베이스 로딩 실패:', sqliteErr);
    throw sqliteErr;
  }
};

/**
 * 현재 활성화된 데이터베이스 모드를 반환합니다.
 */
export const getDbMode = (): DbMode => {
  return dbMode;
};

export const getSqlDialect = (): 'mysql' | 'postgres' | null => {
  return sqlDialect;
};

/**
 * 로컬 SQLite3 데이터베이스 커넥션을 반환합니다.
 */
export const getSqliteDb = (): Database.Database => {
  if (dbMode !== 'LOCAL_SQL' || !sqliteDb) {
    throw new Error('현재 데이터베이스 모드가 LOCAL_SQL이 아닙니다.');
  }
  return sqliteDb;
};

/**
 * Supabase 클라이언트 인터페이스를 반환합니다.
 */
export const getSupabaseClient = (): SupabaseClient => {
  if (dbMode !== 'SUPABASE' || !supabaseClient) {
    throw new Error('현재 데이터베이스 모드가 SUPABASE가 아닙니다.');
  }
  return supabaseClient;
};

export const getMysqlDb = (): MysqlDb | PostgresDb => {
  if (dbMode !== 'MYSQL' || !mysqlDb) {
    throw new Error('현재 데이터베이스 모드가 MYSQL이 아닙니다.');
  }
  return mysqlDb;
};

/**
 * 테스트 전용: in-memory SQLite 인스턴스를 주입합니다.
 * (운영 코드 경로에서는 호출되지 않습니다)
 */
export const __setSqliteDbForTest = (db: Database.Database | null): void => {
  sqliteDb = db;
  dbMode = 'LOCAL_SQL';
};
