#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const dotenv = require('dotenv');

const projectRoot = path.resolve(__dirname, '..');

for (const envPath of [
  path.join(projectRoot, 'backend', '.env'),
  path.join(projectRoot, '.env')
]) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

const TABLES = [
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
  'streamer_registration_blocks',
  'notifications',
  'user_cosmetics',
  'shop_purchases',
  'user_blocks',
  'system_configs',
  'market_listings',
  'market_bids',
  'market_watches',
  'user_minigame_tickets',
  'minigame_sessions'
];

const cli = new Set(process.argv.slice(2));
const shouldReset = cli.has('--reset') || process.env.MYSQL_IMPORT_RESET === 'true';
const shouldSchemaOnly = cli.has('--schema-only');
const shouldDataOnly = cli.has('--data-only');
const batchSize = Math.max(1, Number(process.env.MYSQL_IMPORT_BATCH_SIZE || 500));

const resolveProjectPath = (value, fallback) => {
  const raw = value && value.trim() ? value.trim() : fallback;
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(projectRoot, raw);
};

const sqlitePath = resolveProjectPath(process.env.SQLITE_DB_PATH, 'local.sqlite');
const schemaPath = resolveProjectPath(process.env.MYSQL_SCHEMA_PATH, 'init-db-mysql.sql');

const splitSqlStatements = (sql) => {
  const statements = [];
  let current = '';
  let quote = null;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (!quote && ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      current += '\n';
      continue;
    }

    if (!quote && ch === '/' && next === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }

    current += ch;

    if (quote) {
      if (ch === '\\') {
        current += sql[i + 1] || '';
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }

    if (ch === ';') {
      const statement = current.trim().replace(/;$/, '').trim();
      if (statement) statements.push(statement);
      current = '';
    }
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
};

const getMysqlConfig = () => {
  const ssl =
    process.env.MYSQL_SSL_CA_PATH
      ? { ca: fs.readFileSync(resolveProjectPath(process.env.MYSQL_SSL_CA_PATH, ''), 'utf8') }
      : process.env.MYSQL_SSL === 'true'
        ? {}
        : undefined;

  if (process.env.MYSQL_URL) {
    const parsed = new URL(process.env.MYSQL_URL);
    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 3306,
      user: decodeURIComponent(parsed.username || ''),
      password: decodeURIComponent(parsed.password || ''),
      database: parsed.pathname.replace(/^\//, ''),
      multipleStatements: false,
      charset: 'utf8mb4',
      ssl
    };
  }

  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'chzzk_card_trade_view',
    multipleStatements: false,
    charset: 'utf8mb4',
    ssl
  };
};

const quoteIdent = (name) => `\`${String(name).replace(/`/g, '``')}\``;

const getSqliteColumns = (db, table) =>
  db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all().map((col) => col.name);

const getMysqlColumns = async (conn, table) => {
  const [rows] = await conn.query(`SHOW COLUMNS FROM ${quoteIdent(table)}`);
  return rows
    .filter((row) => String(row.Extra || '').toLowerCase().includes('generated') === false)
    .map((row) => row.Field);
};

const sqlPreview = (statement) =>
  statement
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);

const tableExists = (db, table) => {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  return !!row;
};

const dropTables = async (conn) => {
  if (!shouldReset || shouldDataOnly) return;
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of [...TABLES].reverse()) {
    await conn.query(`DROP TABLE IF EXISTS ${quoteIdent(table)}`);
  }
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
};

const runSchema = async (conn) => {
  if (shouldDataOnly) return;
  const schema = fs.readFileSync(schemaPath, 'utf8');
  for (const statement of splitSqlStatements(schema)) {
    try {
      await conn.query(statement);
    } catch (err) {
      err.message = `${err.message}\n[SQL] ${sqlPreview(statement)}`;
      throw err;
    }
  }
};

const resetTables = async (conn) => {
  if (!shouldReset || shouldSchemaOnly || !shouldDataOnly) return;
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of [...TABLES].reverse()) {
    await conn.query(`DELETE FROM ${quoteIdent(table)}`);
  }
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
};

const importTable = async (sqlite, conn, table) => {
  if (shouldSchemaOnly) return 0;
  if (!tableExists(sqlite, table)) return 0;

  const sqliteColumns = getSqliteColumns(sqlite, table);
  const mysqlColumns = await getMysqlColumns(conn, table);
  const columns = sqliteColumns.filter((column) => mysqlColumns.includes(column));
  if (columns.length === 0) return 0;

  const total = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdent(table)}`).get().count || 0;
  if (total === 0) return 0;

  const selectSql = `SELECT ${columns.map(quoteIdent).join(', ')} FROM ${quoteIdent(table)} LIMIT ? OFFSET ?`;
  const insertSql = `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(', ')}) VALUES ?`;
  const select = sqlite.prepare(selectSql);
  let imported = 0;

  for (let offset = 0; offset < total; offset += batchSize) {
    const rows = select.all(batchSize, offset);
    if (rows.length === 0) break;
    const values = rows.map((row) => columns.map((column) => row[column]));
    await conn.query(insertSql, [values]);
    imported += rows.length;
    process.stdout.write(`\r[MySQL Import] ${table}: ${imported}/${total}`);
  }
  process.stdout.write('\n');
  return imported;
};

const runPostImportFixups = async (conn) => {
  if (shouldSchemaOnly) return;
  await conn.query(`
    UPDATE market_listings
       SET pending_user_card_id = CASE WHEN status = 'PENDING' THEN user_card_id ELSE NULL END
  `);
};

const main = async () => {
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite 파일을 찾을 수 없습니다: ${sqlitePath}`);
  }
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`MySQL 스키마 파일을 찾을 수 없습니다: ${schemaPath}`);
  }

  let mysql;
  try {
    mysql = require('mysql2/promise');
  } catch (err) {
    throw new Error('mysql2 패키지가 설치되어 있지 않습니다. 먼저 `npm install`을 실행하세요.');
  }

  const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const conn = await mysql.createConnection(getMysqlConfig());

  try {
    await conn.query('SET NAMES utf8mb4');
    await dropTables(conn);
    await runSchema(conn);
    await resetTables(conn);

    let total = 0;
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of TABLES) {
      total += await importTable(sqlite, conn, table);
    }
    await runPostImportFixups(conn);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    console.log(`[MySQL Import] 완료: ${total} rows imported from ${sqlitePath}`);
  } finally {
    sqlite.close();
    await conn.end();
  }
};

main().catch((err) => {
  console.error('[MySQL Import] 실패:', err.message || err);
  process.exitCode = 1;
});
