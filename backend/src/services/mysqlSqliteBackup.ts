import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import Database from 'better-sqlite3';
import { getDbMode, getMysqlDb } from './db';
import { ensureDirectory } from './storagePaths';
import { getRuntimeStats } from './runtimeStats';
import { acquireSchedulerLock } from './schedulerLock';

const projectRoot = path.resolve(__dirname, '../../..');

const BACKUP_TABLES = [
  'users',
  'titles',
  'streamers',
  'shop_items',
  'tutorial_rewards',
  'user_titles',
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
  'streamer_registration_blocks',
  'notifications',
  'user_cosmetics',
  'shop_purchases',
  'user_blocks',
  'friend_requests',
  'friendships',
  'chat_rooms',
  'chat_messages',
  'link_previews',
  'system_configs',
  'market_listings',
  'market_bids',
  'market_watches',
  'user_minigame_tickets',
  'minigame_sessions'
] as const;

type ColumnInfo = {
  name: string;
  isPrimary: boolean;
  isGenerated: boolean;
};

const pad = (value: number) => String(value).padStart(2, '0');

const dateStamp = (date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const timeStamp = (date = new Date()) =>
  `${dateStamp(date)}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;

const resolveProjectPath = (value: string | undefined, fallback: string): string => {
  const raw = value?.trim();
  if (!raw) return fallback;
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(projectRoot, raw);
};

const quoteMysqlIdent = (name: string) => `\`${name.replace(/`/g, '``')}\``;
const quoteSqliteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

const getBackupDir = () =>
  resolveProjectPath(process.env.MYSQL_SQLITE_BACKUP_DIR, path.join(projectRoot, 'backups', 'mysql-sqlite'));

const getSchemaPath = () =>
  resolveProjectPath(process.env.MYSQL_SQLITE_BACKUP_SCHEMA_PATH, path.join(projectRoot, 'init-db.sql'));

const getNumberEnv = (name: string, fallback: number, min: number) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.max(min, parsed) : fallback;
};

const getBackupFiles = (backupDir: string) => {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter((name) => /^mysql-backup-\d{4}-\d{2}-\d{2}-\d{6}\.sqlite$/.test(name))
    .map((name) => {
      const fullPath = path.join(backupDir, name);
      return { name, fullPath, stat: fs.statSync(fullPath) };
    })
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
};

const hasBackupForToday = (backupDir: string) => {
  const today = dateStamp();
  return getBackupFiles(backupDir).some((file) => file.name.startsWith(`mysql-backup-${today}-`));
};

const pruneOldBackups = (backupDir: string) => {
  const retentionDays = getNumberEnv('MYSQL_SQLITE_BACKUP_RETENTION_DAYS', 7, 1);
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let deleted = 0;

  if (!fs.existsSync(backupDir)) return deleted;

  for (const entry of fs.readdirSync(backupDir)) {
    const fullPath = path.join(backupDir, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    const isBackup = /^mysql-backup-\d{4}-\d{2}-\d{2}-\d{6}\.sqlite$/.test(entry);
    const isStaleTmp = /^\.mysql-backup-.*\.tmp$/.test(entry);
    if ((isBackup && stat.mtimeMs < cutoff) || (isStaleTmp && stat.mtimeMs < Date.now() - 24 * 60 * 60 * 1000)) {
      try {
        fs.unlinkSync(fullPath);
        deleted++;
      } catch (err: any) {
        console.warn('[MySQLBackup] 오래된 백업 삭제 실패:', fullPath, err?.message || err);
      }
    }
  }
  return deleted;
};

const shouldSkipForLoad = (): string | null => {
  const stats = getRuntimeStats() as any;
  const minUptimeSeconds = getNumberEnv('MYSQL_SQLITE_BACKUP_MIN_UPTIME_SECONDS', 300, 0);
  const maxRssMb = getNumberEnv('MYSQL_SQLITE_BACKUP_MAX_RSS_MB', 700, 128);
  const maxHeapUsedMb = getNumberEnv('MYSQL_SQLITE_BACKUP_MAX_HEAP_USED_MB', 450, 64);
  const maxRealtimeClients = getNumberEnv('MYSQL_SQLITE_BACKUP_MAX_REALTIME_CLIENTS', 100, 0);
  const maxNotificationClients = getNumberEnv('MYSQL_SQLITE_BACKUP_MAX_NOTIFICATION_CLIENTS', 100, 0);
  const maxChatConnections = getNumberEnv('MYSQL_SQLITE_BACKUP_MAX_CHAT_CONNECTIONS', 20, 0);
  const maxDesiredChatConnections = getNumberEnv('MYSQL_SQLITE_BACKUP_MAX_DESIRED_CHAT_CONNECTIONS', 20, 0);
  const maxChatPending = getNumberEnv('MYSQL_SQLITE_BACKUP_MAX_CHAT_PENDING', 200, 0);
  const maxReconnectTimers = getNumberEnv('MYSQL_SQLITE_BACKUP_MAX_RECONNECT_TIMERS', 30, 0);

  if (stats.uptime_seconds < minUptimeSeconds) return `uptime ${stats.uptime_seconds}s < ${minUptimeSeconds}s`;
  if (stats.memory?.rss_mb > maxRssMb) return `rss ${stats.memory.rss_mb}MB > ${maxRssMb}MB`;
  if (stats.memory?.heap_used_mb > maxHeapUsedMb) return `heap ${stats.memory.heap_used_mb}MB > ${maxHeapUsedMb}MB`;
  if ((stats.streams?.realtime?.clients || 0) > maxRealtimeClients) {
    return `realtime clients ${stats.streams.realtime.clients} > ${maxRealtimeClients}`;
  }
  if ((stats.streams?.notifications?.clients || 0) > maxNotificationClients) {
    return `notification clients ${stats.streams.notifications.clients} > ${maxNotificationClients}`;
  }
  if ((stats.chat?.connections || 0) > maxChatConnections) {
    return `chat connections ${stats.chat.connections} > ${maxChatConnections}`;
  }
  if ((stats.chat?.desired || 0) > maxDesiredChatConnections) {
    return `desired chat connections ${stats.chat.desired} > ${maxDesiredChatConnections}`;
  }
  if ((stats.chat?.pendingChatTotal || 0) > maxChatPending) return `pending chat ${stats.chat.pendingChatTotal} > ${maxChatPending}`;
  if ((stats.chat?.reconnectTimers || 0) > maxReconnectTimers) {
    return `chat reconnect timers ${stats.chat.reconnectTimers} > ${maxReconnectTimers}`;
  }
  if (stats.chat?.isFlushing) return 'chat flush in progress';
  return null;
};

const getSqliteColumns = (db: Database.Database, table: string) =>
  db.prepare(`PRAGMA table_info(${quoteSqliteIdent(table)})`).all().map((column: any) => String(column.name));

const getMysqlColumns = async (table: string): Promise<ColumnInfo[]> => {
  const rows = await getMysqlDb().all<any>(`
    SELECT COLUMN_NAME AS Field, COLUMN_KEY AS \`Key\`, EXTRA AS Extra
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION
  `, table);
  return rows.map((row) => ({
    name: String(row.Field),
    isPrimary: row.Key === 'PRI',
    isGenerated: /generated/i.test(String(row.Extra || ''))
  }));
};

const buildMysqlKeysetWhere = (orderColumns: string[], lastRow: any | null) => {
  if (!lastRow) return { clause: '', params: [] as any[] };
  const parts: string[] = [];
  const params: any[] = [];

  orderColumns.forEach((column, index) => {
    const previousColumns = orderColumns.slice(0, index);
    const equalPrefix = previousColumns.map((prevColumn) => `${quoteMysqlIdent(prevColumn)} <=> ?`).join(' AND ');
    previousColumns.forEach((prevColumn) => params.push(lastRow[prevColumn]));
    params.push(lastRow[column]);
    parts.push(equalPrefix
      ? `(${equalPrefix} AND ${quoteMysqlIdent(column)} > ?)`
      : `(${quoteMysqlIdent(column)} > ?)`);
  });

  return { clause: `WHERE ${parts.join(' OR ')}`, params };
};

const copyTable = async (sqlite: Database.Database, table: string, batchSize: number) => {
  const sqliteColumns = getSqliteColumns(sqlite, table);
  const mysqlColumns = await getMysqlColumns(table).catch((err) => {
    console.warn(`[MySQLBackup] ${table} 컬럼 조회 실패, 건너뜁니다:`, err?.message || err);
    return [] as ColumnInfo[];
  });
  const mysqlColumnNames = new Set(mysqlColumns.filter((col) => !col.isGenerated).map((col) => col.name));
  const columns = sqliteColumns.filter((column) => mysqlColumnNames.has(column));
  if (columns.length === 0) return 0;

  const primaryColumns = mysqlColumns.filter((column) => column.isPrimary && columns.includes(column.name)).map((column) => column.name);
  const orderColumns = primaryColumns.length > 0 ? primaryColumns : [columns[0]];
  const orderBySql = orderColumns.map(quoteMysqlIdent).join(', ');
  const insertSql = `
    INSERT INTO ${quoteSqliteIdent(table)} (${columns.map(quoteSqliteIdent).join(', ')})
    VALUES (${columns.map(() => '?').join(', ')})
  `;
  const insertMany = sqlite.transaction((rows: any[]) => {
    const stmt = sqlite.prepare(insertSql);
    for (const row of rows) {
      stmt.run(columns.map((column) => row[column]));
    }
  });

  let copied = 0;
  let lastRow: any | null = null;
  while (true) {
    const keyset = buildMysqlKeysetWhere(orderColumns, lastRow);
    const rows = await getMysqlDb().all(`
      SELECT ${columns.map(quoteMysqlIdent).join(', ')}
        FROM ${quoteMysqlIdent(table)}
        ${keyset.clause}
       ORDER BY ${orderBySql}
       LIMIT ?
    `, [...keyset.params, batchSize]);
    if (rows.length === 0) break;
    insertMany(rows);
    copied += rows.length;
    lastRow = rows[rows.length - 1];
    if (rows.length < batchSize) break;
  }

  return copied;
};

export const runMysqlToSqliteBackupOnce = async (): Promise<{ ok: boolean; path?: string; reason?: string; rows?: number }> => {
  if (getDbMode() !== 'MYSQL') return { ok: false, reason: 'MYSQL_MODE_ONLY' };

  const backupDir = getBackupDir();
  ensureDirectory(backupDir);
  pruneOldBackups(backupDir);

  if (hasBackupForToday(backupDir)) {
    return { ok: false, reason: 'ALREADY_BACKED_UP_TODAY' };
  }

  const loadReason = shouldSkipForLoad();
  if (loadReason) return { ok: false, reason: `BUSY:${loadReason}` };

  const lockTtlMs = getNumberEnv('MYSQL_SQLITE_BACKUP_LOCK_TTL_MS', 30 * 60_000, 60_000);
  const release = await acquireSchedulerLock('scheduler:mysql_sqlite_backup', lockTtlMs);
  if (!release) return { ok: false, reason: 'LOCKED' };

  const schemaPath = getSchemaPath();
  const batchSize = Math.max(1, Math.floor(getNumberEnv('MYSQL_SQLITE_BACKUP_BATCH_SIZE', 1000, 1)));
  const finalPath = path.join(backupDir, `mysql-backup-${timeStamp()}.sqlite`);
  const tmpPath = path.join(backupDir, `.mysql-backup-${process.pid}-${Date.now()}.tmp`);

  let sqlite: Database.Database | null = null;
  try {
    if (hasBackupForToday(backupDir)) {
      return { ok: false, reason: 'ALREADY_BACKED_UP_TODAY' };
    }
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`SQLite schema file not found: ${schemaPath}`);
    }

    sqlite = new Database(tmpPath);
    sqlite.pragma('foreign_keys = OFF');
    sqlite.pragma('journal_mode = OFF');
    sqlite.pragma('synchronous = OFF');
    sqlite.exec(fs.readFileSync(schemaPath, 'utf8'));
    for (const table of [...BACKUP_TABLES].reverse()) {
      sqlite.prepare(`DELETE FROM ${quoteSqliteIdent(table)}`).run();
    }

    let rows = 0;
    for (const table of BACKUP_TABLES) {
      rows += await copyTable(sqlite, table, batchSize);
    }
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('wal_checkpoint(TRUNCATE)');
    sqlite.close();
    sqlite = null;

    fs.renameSync(tmpPath, finalPath);
    const deleted = pruneOldBackups(backupDir);
    console.log(`[MySQLBackup] SQLite 백업 완료: ${finalPath} (${rows} rows, 삭제 ${deleted}개)`);
    return { ok: true, path: finalPath, rows };
  } catch (err: any) {
    console.error('[MySQLBackup] SQLite 백업 실패:', err?.message || err);
    try { sqlite?.close(); } catch { /* noop */ }
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch { /* noop */ }
    return { ok: false, reason: err?.message || 'FAILED' };
  } finally {
    await release().catch(() => undefined);
  }
};

let backupTask: cron.ScheduledTask | null = null;
let backupRunning = false;
let lastSkipLogAt = 0;

export const startMysqlSqliteBackupScheduler = () => {
  if (backupTask || process.env.MYSQL_SQLITE_BACKUP_ENABLED === 'false') return;
  if (getDbMode() !== 'MYSQL') return;

  const expression = process.env.MYSQL_SQLITE_BACKUP_CRON || '*/30 * * * *';
  backupTask = cron.schedule(expression, async () => {
    if (backupRunning || getDbMode() !== 'MYSQL') return;
    backupRunning = true;
    try {
      const result = await runMysqlToSqliteBackupOnce();
      if (!result.ok && result.reason && result.reason !== 'ALREADY_BACKED_UP_TODAY' && result.reason !== 'LOCKED') {
        const now = Date.now();
        if (now - lastSkipLogAt > 60 * 60_000) {
          console.log(`[MySQLBackup] 이번 백업 시도를 건너뜁니다: ${result.reason}`);
          lastSkipLogAt = now;
        }
      }
    } finally {
      backupRunning = false;
    }
  });

  console.log(`[MySQLBackup] MySQL -> SQLite 일일 백업 스케줄러가 가동되었습니다. (${expression}, 보관 ${getNumberEnv('MYSQL_SQLITE_BACKUP_RETENTION_DAYS', 7, 1)}일)`);
};

export const stopMysqlSqliteBackupScheduler = () => {
  backupTask?.stop();
  backupTask = null;
};
