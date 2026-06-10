import fs from 'fs';
import path from 'path';
import mysql, { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

export type MysqlRunResult = {
  changes: number;
  lastInsertRowid: number | bigint;
  affectedRows: number;
  insertId: number;
};

export type MysqlConnectionLike = Pool | PoolConnection;

const projectRoot = path.resolve(__dirname, '../../..');

const resolveProjectPath = (value: string): string => {
  if (path.isAbsolute(value)) return value;
  return path.resolve(projectRoot, value);
};

const getSslConfig = () => {
  if (process.env.MYSQL_SSL_CA_PATH?.trim()) {
    return { ca: fs.readFileSync(resolveProjectPath(process.env.MYSQL_SSL_CA_PATH.trim()), 'utf8') };
  }
  return process.env.MYSQL_SSL === 'true' ? {} : undefined;
};

export const getMysqlPoolConfig = (): mysql.PoolOptions => {
  const ssl = getSslConfig();
  const common = {
    waitForConnections: true,
    connectionLimit: Math.max(1, Number(process.env.MYSQL_CONNECTION_LIMIT || 10)),
    queueLimit: Math.max(0, Number(process.env.MYSQL_QUEUE_LIMIT || 0)),
    charset: 'utf8mb4',
    dateStrings: true,
    timezone: 'Z',
    ssl
  } satisfies Partial<mysql.PoolOptions>;

  if (process.env.MYSQL_URL?.trim()) {
    const parsed = new URL(process.env.MYSQL_URL.trim());
    return {
      ...common,
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 3306,
      user: decodeURIComponent(parsed.username || ''),
      password: decodeURIComponent(parsed.password || ''),
      database: parsed.pathname.replace(/^\//, '')
    };
  }

  return {
    ...common,
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'chzzk_card_trade_view'
  };
};

const normalizeSystemConfigKey = (sql: string) =>
  sql
    .replace(/\bsystem_configs\s*\(\s*key\s*,/gi, 'system_configs (`key`,')
    .replace(/\bWHERE\s+key\s*=/gi, 'WHERE `key` =')
    .replace(/\bORDER\s+BY\s+key\b/gi, 'ORDER BY `key`')
    .replace(/\bSELECT\s+value\s+FROM\s+system_configs\s+WHERE\s+key\b/gi, 'SELECT value FROM system_configs WHERE `key`');

export const normalizeMysqlSql = (sql: string): string => {
  let out = sql;
  out = out.replace(/\bINSERT\s+OR\s+IGNORE\b/gi, 'INSERT IGNORE');
  out = out.replace(/\bON\s+CONFLICT\s*\([^)]+\)\s+DO\s+UPDATE\s+SET\b/gi, 'ON DUPLICATE KEY UPDATE');
  out = out.replace(/\bexcluded\.([a-zA-Z_][a-zA-Z0-9_]*)\b/g, 'VALUES($1)');
  out = out.replace(/\bCOLLATE\s+NOCASE\b/gi, 'COLLATE utf8mb4_unicode_ci');
  out = out.replace(/datetime\('now'\)/gi, 'UTC_TIMESTAMP()');
  out = out.replace(/datetime\(\s*\?\s*\)/gi, '?');
  out = out.replace(/datetime\(\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\)/gi, '$1');
  out = out.replace(/MAX\(([^,\n()]+),\s*0\)/gi, 'GREATEST($1, 0)');
  out = out.replace(/datetime\('now',\s*'-8 days'\)/gi, "UTC_TIMESTAMP() - INTERVAL 8 DAY");
  out = out.replace(/datetime\('now',\s*'-'\s*\|\|\s*\?\s*\|\|\s*' days'\)/gi, 'UTC_TIMESTAMP() - INTERVAL ? DAY');
  return normalizeSystemConfigKey(out);
};

const toParams = (args: any[]): any[] => {
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args;
};

const coerceLimitOffsetValue = (value: any, keyword: string): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`[MySQL] ${keyword} 값이 유효한 숫자가 아닙니다: ${value}`);
  }
  return Math.max(0, Math.floor(numeric));
};

const normalizeLimitOffsetPlaceholders = (sql: string, params: any[]): { sql: string; params: any[] } => {
  let paramIndex = 0;
  const nextParams: any[] = [];
  const rewritten = sql.replace(/\?/g, (placeholder, offset) => {
    const value = params[paramIndex++];
    const prefix = sql.slice(Math.max(0, offset - 32), offset);
    const match = prefix.match(/\b(LIMIT|OFFSET)\s*$/i);
    if (!match) {
      nextParams.push(value);
      return placeholder;
    }
    return String(coerceLimitOffsetValue(value, match[1].toUpperCase()));
  });

  for (; paramIndex < params.length; paramIndex += 1) {
    nextParams.push(params[paramIndex]);
  }

  return { sql: rewritten, params: nextParams };
};

const prepareMysqlStatement = (sql: string, params: any[]): { sql: string; params: any[] } =>
  normalizeLimitOffsetPlaceholders(normalizeMysqlSql(sql), params);

const MYSQL_TRANSACTION_MAX_ATTEMPTS = Math.max(1, Number(process.env.MYSQL_TRANSACTION_MAX_ATTEMPTS || 3));
const MYSQL_LOCK_WAIT_TIMEOUT_SECONDS = Math.max(1, Number(process.env.MYSQL_LOCK_WAIT_TIMEOUT_SECONDS || 5));

const isRetryableMysqlTransactionError = (err: any): boolean => {
  const code = String(err?.code || '');
  const errno = Number(err?.errno || err?.sqlState || 0);
  return code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT' || errno === 1213 || errno === 1205;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class MysqlDb {
  constructor(private readonly pool: Pool) {}

  async query<T extends RowDataPacket[] = RowDataPacket[]>(sql: string, params: any[] = []): Promise<T> {
    const statement = prepareMysqlStatement(sql, params);
    const [rows] = await this.pool.execute<T>(statement.sql, statement.params);
    return rows;
  }

  async all<T = any>(sql: string, ...args: any[]): Promise<T[]> {
    const statement = prepareMysqlStatement(sql, toParams(args));
    const [rows] = await this.pool.execute<RowDataPacket[]>(statement.sql, statement.params);
    return rows as T[];
  }

  async get<T = any>(sql: string, ...args: any[]): Promise<T | undefined> {
    const rows = await this.all<T>(sql, ...args);
    return rows[0];
  }

  async run(sql: string, ...args: any[]): Promise<MysqlRunResult> {
    const statement = prepareMysqlStatement(sql, toParams(args));
    const [result] = await this.pool.execute<ResultSetHeader>(statement.sql, statement.params);
    return {
      changes: result.affectedRows,
      affectedRows: result.affectedRows,
      insertId: result.insertId,
      lastInsertRowid: result.insertId
    };
  }

  async transaction<T>(task: (tx: MysqlTx) => Promise<T>): Promise<T> {
    let lastError: any;
    for (let attempt = 1; attempt <= MYSQL_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
      const conn = await this.pool.getConnection();
      const tx = new MysqlTx(conn);
      try {
        await conn.query('SET SESSION innodb_lock_wait_timeout = ?', [MYSQL_LOCK_WAIT_TIMEOUT_SECONDS]);
        await conn.beginTransaction();
        const result = await task(tx);
        await conn.commit();
        return result;
      } catch (err: any) {
        lastError = err;
        try {
          await conn.rollback();
        } catch (rollbackErr: any) {
          console.warn('[MySQL] 트랜잭션 rollback 실패:', rollbackErr?.message || rollbackErr);
        }
        if (!isRetryableMysqlTransactionError(err) || attempt >= MYSQL_TRANSACTION_MAX_ATTEMPTS) {
          throw err;
        }
        const delayMs = 25 * attempt * attempt;
        console.warn(`[MySQL] 트랜잭션 deadlock/timeout 감지, 재시도합니다. (${attempt}/${MYSQL_TRANSACTION_MAX_ATTEMPTS})`, err?.message || err);
        await sleep(delayMs);
      } finally {
        conn.release();
      }
    }
    throw lastError;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class MysqlTx {
  constructor(private readonly conn: PoolConnection) {}

  async all<T = any>(sql: string, ...args: any[]): Promise<T[]> {
    const statement = prepareMysqlStatement(sql, toParams(args));
    const [rows] = await this.conn.execute<RowDataPacket[]>(statement.sql, statement.params);
    return rows as T[];
  }

  async get<T = any>(sql: string, ...args: any[]): Promise<T | undefined> {
    const rows = await this.all<T>(sql, ...args);
    return rows[0];
  }

  async run(sql: string, ...args: any[]): Promise<MysqlRunResult> {
    const statement = prepareMysqlStatement(sql, toParams(args));
    const [result] = await this.conn.execute<ResultSetHeader>(statement.sql, statement.params);
    return {
      changes: result.affectedRows,
      affectedRows: result.affectedRows,
      insertId: result.insertId,
      lastInsertRowid: result.insertId
    };
  }
}

export const createMysqlDb = (): MysqlDb => new MysqlDb(mysql.createPool(getMysqlPoolConfig()));
