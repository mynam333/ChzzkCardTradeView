import fs from 'fs';
import path from 'path';
import postgres from 'postgres';
import { MysqlRunResult } from './mysqlDb';

type PostgresConnectionLike = any;

const projectRoot = path.resolve(__dirname, '../../..');

const resolveProjectPath = (value: string): string => {
  if (path.isAbsolute(value)) return value;
  return path.resolve(projectRoot, value);
};

const getPostgresUrl = (): string => {
  const url = process.env.POSTGRES_URL || process.env.POSTGRESQL_URL || process.env.DATABASE_URL;
  if (url?.trim()) return url.trim();

  const user = encodeURIComponent(process.env.POSTGRES_USER || process.env.PGUSER || 'postgres');
  const password = encodeURIComponent(process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD || '');
  const host = process.env.POSTGRES_HOST || process.env.PGHOST || '127.0.0.1';
  const port = process.env.POSTGRES_PORT || process.env.PGPORT || '5432';
  const db = process.env.POSTGRES_DATABASE || process.env.POSTGRES_DB || process.env.PGDATABASE || 'chzzk_card_trade_view';
  return `postgres://${user}:${password}@${host}:${port}/${encodeURIComponent(db)}`;
};

const getSslConfig = () => {
  if (process.env.POSTGRES_SSL_CA_PATH?.trim()) {
    return { ca: fs.readFileSync(resolveProjectPath(process.env.POSTGRES_SSL_CA_PATH.trim()), 'utf8') };
  }
  return process.env.POSTGRES_SSL === 'true' ? 'require' : undefined;
};

const toParams = (args: any[]): any[] => {
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args;
};

const autoIdTables = new Set([
  'achievements',
  'achievement_events',
  'achievement_grant_logs',
  'achievement_evaluation_queue',
  'announcements',
  'arena_admin_audit_logs',
  'arena_admin_jobs',
  'arena_cup_queue',
  'arena_cups',
  'arena_decks',
  'arena_match_queue',
  'arena_matches',
  'arena_spectator_links',
  'asset_event_logs',
  'card_reports',
  'chat_messages',
  'chat_rooms',
  'coupon_logs',
  'coupons',
  'friend_requests',
  'market_bids',
  'market_listings',
  'market_transaction_audit_logs',
  'market_watches',
  'notifications',
  'point_ledger_entries',
  'push_notifications',
  'push_subscriptions',
  'shop_items',
  'subscription_title_rules',
  'titles',
  'trades',
  'user_cards',
  'user_cosmetics',
  'value_history'
]);

const conflictTargets: Record<string, string> = {
  achievements: '(code)',
  asset_event_logs: '(event_key)',
  chat_rooms: '(user_a_id, user_b_id)',
  coupon_logs: '(coupon_id, user_id)',
  coupons: '(code)',
  deleted_user_accounts: '(user_id)',
  friendships: '(user_a_id, user_b_id)',
  link_previews: '(url_hash)',
  market_transaction_audit_logs: '(audit_key)',
  market_watches: '(user_id, channel_id, star)',
  notifications: '(user_id, group_key)',
  push_subscriptions: '(endpoint)',
  shop_purchases: '(user_id, item_id)',
  streamers: '(channel_id)',
  streamer_registration_blocks: '(channel_id)',
  subscription_title_states: '(user_id, rule_id)',
  system_configs: '(key)',
  tutorial_rewards: '(user_id, reward_key)',
  user_blocks: '(blocker_id, blocked_id)',
  user_card_serials: '(channel_id)',
  user_cosmetics: '(user_id, item_id)',
  user_image_blinds: '(user_id, image_key)',
  user_minigame_tickets: '(user_id)',
  users: '(id)',
  user_titles: '(user_id, title_id)'
};

const rewriteLimitOffsetParams = (sql: string, params: any[]): { sql: string; params: any[] } => {
  let paramIndex = 0;
  const nextParams: any[] = [];
  const rewritten = sql.replace(/\?/g, (_placeholder, offset) => {
    const value = params[paramIndex++];
    const prefix = sql.slice(Math.max(0, offset - 32), offset);
    const match = prefix.match(/\b(LIMIT|OFFSET)\s*$/i);
    if (!match) {
      nextParams.push(value);
      return '?';
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw new Error(`[PostgreSQL] ${match[1]} 값이 유효하지 않습니다: ${value}`);
    return String(Math.max(0, Math.floor(numeric)));
  });
  for (; paramIndex < params.length; paramIndex += 1) nextParams.push(params[paramIndex]);
  return { sql: rewritten, params: nextParams };
};

const rewriteQuestionPlaceholders = (sql: string): string => {
  let out = '';
  let index = 1;
  let quote: "'" | '"' | null = null;
  let dollarQuote: string | null = null;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (!quote && !dollarQuote && ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i + 2);
      const chunk = end === -1 ? sql.slice(i) : sql.slice(i, end);
      out += chunk;
      i += chunk.length - 1;
      continue;
    }

    if (!quote && !dollarQuote && ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      const chunk = end === -1 ? sql.slice(i) : sql.slice(i, end + 2);
      out += chunk;
      i += chunk.length - 1;
      continue;
    }

    if (!quote && ch === '$') {
      const match = sql.slice(i).match(/^\$[a-zA-Z0-9_]*\$/);
      if (match) {
        const tag = match[0];
        out += tag;
        i += tag.length - 1;
        dollarQuote = dollarQuote === tag ? null : tag;
        continue;
      }
    }

    if (!dollarQuote && (ch === "'" || ch === '"')) {
      out += ch;
      if (quote === ch) {
        if (ch === "'" && next === "'") {
          out += next;
          i += 1;
        } else {
          quote = null;
        }
      } else if (!quote) {
        quote = ch;
      }
      continue;
    }

    if (!quote && !dollarQuote && ch === '?') {
      out += `$${index++}`;
      continue;
    }

    out += ch;
  }

  return out;
};

const rewriteInsertIgnore = (sql: string) =>
  sql.replace(/\bINSERT\s+IGNORE\s+INTO\b/i, 'INSERT INTO').replace(/($|;)\s*$/i, ' ON CONFLICT DO NOTHING');

const rewriteOnDuplicateKey = (sql: string): string => {
  const duplicateMatch = sql.match(/\s+ON\s+DUPLICATE\s+KEY\s+UPDATE\s+/i);
  if (!duplicateMatch || duplicateMatch.index === undefined) return sql;

  const before = sql.slice(0, duplicateMatch.index);
  const update = sql.slice(duplicateMatch.index + duplicateMatch[0].length);
  const table = before.match(/\bINSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)/i)?.[1];
  const target = table ? conflictTargets[table] : undefined;
  if (!target) {
    return `${before} ON CONFLICT DO NOTHING`;
  }

  const rewrittenUpdate = update
    .replace(/\bVALUES\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/gi, 'EXCLUDED.$1')
    .replace(/\bVALUES\(\s*"([a-zA-Z_][a-zA-Z0-9_]*)"\s*\)/gi, 'EXCLUDED.$1');
  return `${before} ON CONFLICT ${target} DO UPDATE SET ${rewrittenUpdate}`;
};

const rewriteDeleteLimit = (sql: string): string => {
  const match = sql.match(/^\s*DELETE\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+WHERE\s+([\s\S]+?)\s+ORDER\s+BY\s+([\s\S]+?)\s+LIMIT\s+(\$?\?|\$\d+|\d+)\s*$/i);
  if (match) {
    return `DELETE FROM ${match[1]} WHERE ctid IN (SELECT ctid FROM ${match[1]} WHERE ${match[2]} ORDER BY ${match[3]} LIMIT ${match[4]})`;
  }
  const noOrder = sql.match(/^\s*DELETE\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+WHERE\s+([\s\S]+?)\s+LIMIT\s+(\$?\?|\$\d+|\d+)\s*$/i);
  if (noOrder) {
    return `DELETE FROM ${noOrder[1]} WHERE ctid IN (SELECT ctid FROM ${noOrder[1]} WHERE ${noOrder[2]} LIMIT ${noOrder[3]})`;
  }
  return sql;
};

export const normalizePostgresSql = (input: string): string => {
  let sql = input.trim().replace(/`/g, '');
  sql = sql.replace(/\bCOLLATE\s+utf8mb4_unicode_ci\b/gi, '');
  sql = sql.replace(/\s+FORCE\s+INDEX\s*\([^)]+\)/gi, '');
  sql = sql.replace(/\bUTC_TIMESTAMP\(\)/gi, 'NOW()');
  sql = sql.replace(/\bDATE_ADD\(\s*NOW\(\)\s*,\s*INTERVAL\s+\?\s+SECOND\s*\)/gi, "(NOW() + (? * INTERVAL '1 second'))");
  sql = sql.replace(/\bDATE_ADD\(\s*NOW\(\)\s*,\s*INTERVAL\s+\?\s+MINUTE\s*\)/gi, "(NOW() + (? * INTERVAL '1 minute'))");
  sql = sql.replace(/\bDATE_ADD\(\s*NOW\(\)\s*,\s*INTERVAL\s+\?\s+DAY\s*\)/gi, "(NOW() + (? * INTERVAL '1 day'))");
  sql = sql.replace(/\bDATE_ADD\(\s*NOW\(\)\s*,\s*INTERVAL\s+(\d+)\s+DAY\s*\)/gi, "NOW() + INTERVAL '$1 day'");
  sql = sql.replace(/\bDATE_SUB\(\s*NOW\(\)\s*,\s*INTERVAL\s+\?\s+MINUTE\s*\)/gi, "(NOW() - (? * INTERVAL '1 minute'))");
  sql = sql.replace(/\bDATE_SUB\(\s*NOW\(\)\s*,\s*INTERVAL\s+\?\s+DAY\s*\)/gi, "(NOW() - (? * INTERVAL '1 day'))");
  sql = sql.replace(/\bDATE_SUB\(\s*NOW\(\)\s*,\s*INTERVAL\s+(\d+)\s+MINUTE\s*\)/gi, "NOW() - INTERVAL '$1 minute'");
  sql = sql.replace(/\bDATE_SUB\(\s*NOW\(\)\s*,\s*INTERVAL\s+(\d+)\s+DAY\s*\)/gi, "NOW() - INTERVAL '$1 day'");
  sql = sql.replace(/\bNOW\(\)\s*-\s*INTERVAL\s+(\d+)\s+(DAY|MINUTE|SECOND)\b/gi, (_m, n, unit) => `NOW() - INTERVAL '${n} ${String(unit).toLowerCase()}'`);
  sql = sql.replace(/\bSTR_TO_DATE\(\s*SUBSTRING_INDEX\(REPLACE\(([^,]+),\s*'T',\s*' '\),\s*'\.',\s*1\),\s*'%Y-%m-%d %H:%i:%s'\s*\)/gi, "NULLIF($1, '')::timestamptz");
  sql = sql.replace(/\bCONCAT\(/gi, 'CONCAT(');
  sql = sql.replace(/\bJSON_OBJECT\(\)/gi, "'{}'::jsonb");
  sql = rewriteDeleteLimit(sql);
  if (/^\s*INSERT\s+IGNORE\s+INTO\b/i.test(sql)) sql = rewriteInsertIgnore(sql);
  sql = rewriteOnDuplicateKey(sql);
  return sql;
};

const appendReturningId = (sql: string): string => {
  if (!/^\s*INSERT\s+INTO\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) return sql;
  const table = sql.match(/\bINSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)/i)?.[1];
  if (!table || !autoIdTables.has(table)) return sql;
  if (/\bON\s+CONFLICT\s+DO\s+NOTHING\b/i.test(sql)) return sql;
  return `${sql} RETURNING id`;
};

const preparePostgresStatement = (sql: string, params: any[], options: { returningId?: boolean } = {}) => {
  const limitRewritten = rewriteLimitOffsetParams(sql, params);
  let normalized = normalizePostgresSql(limitRewritten.sql);
  if (options.returningId) normalized = appendReturningId(normalized);
  return { sql: rewriteQuestionPlaceholders(normalized), params: limitRewritten.params };
};

const PG_TRANSACTION_MAX_ATTEMPTS = Math.max(1, Number(process.env.POSTGRES_TRANSACTION_MAX_ATTEMPTS || 3));
const PG_SLOW_QUERY_LOG_MS = Math.max(50, Number(process.env.POSTGRES_SLOW_QUERY_LOG_MS || process.env.MYSQL_SLOW_QUERY_LOG_MS || 1000));
const PG_SLOW_QUERY_SQL_MAX_LENGTH = Math.max(120, Number(process.env.POSTGRES_SLOW_QUERY_SQL_MAX_LENGTH || 500));

const pgQueryStats = {
  totalQueries: 0,
  slowQueries: 0,
  activeQueries: 0,
  lastSlowQueries: [] as Array<{ duration_ms: number; sql: string; scope: string; at: string }>
};

const compactSql = (sql: string) => {
  const compacted = sql.replace(/\s+/g, ' ').trim();
  if (compacted.length <= PG_SLOW_QUERY_SQL_MAX_LENGTH) return compacted;
  return `${compacted.slice(0, PG_SLOW_QUERY_SQL_MAX_LENGTH)}...<truncated:${compacted.length - PG_SLOW_QUERY_SQL_MAX_LENGTH}>`;
};

const observePostgresQuery = async <T>(scope: string, sql: string, task: () => Promise<T>): Promise<T> => {
  pgQueryStats.totalQueries += 1;
  pgQueryStats.activeQueries += 1;
  const startedAt = Date.now();
  try {
    return await task();
  } catch (err: any) {
    if (err?.code === '23505') err.code = 'ER_DUP_ENTRY';
    throw err;
  } finally {
    const durationMs = Date.now() - startedAt;
    pgQueryStats.activeQueries = Math.max(0, pgQueryStats.activeQueries - 1);
    if (durationMs >= PG_SLOW_QUERY_LOG_MS) {
      pgQueryStats.slowQueries += 1;
      pgQueryStats.lastSlowQueries.unshift({
        duration_ms: durationMs,
        sql: compactSql(sql),
        scope,
        at: new Date().toISOString()
      });
      pgQueryStats.lastSlowQueries.splice(20);
    }
  }
};

const isRetryablePostgresTransactionError = (err: any): boolean =>
  ['40001', '40P01', '55P03'].includes(String(err?.code || ''));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const getPostgresQueryStats = () => ({
  totalQueries: pgQueryStats.totalQueries,
  slowQueries: pgQueryStats.slowQueries,
  activeQueries: pgQueryStats.activeQueries,
  slowQueryThresholdMs: PG_SLOW_QUERY_LOG_MS,
  lastSlowQueries: pgQueryStats.lastSlowQueries
});

export class PostgresDb {
  constructor(private readonly client: PostgresConnectionLike) {}

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const statement = preparePostgresStatement(sql, params);
    const rows = await observePostgresQuery('pool.query', statement.sql, () => this.client.unsafe(statement.sql, statement.params));
    return rows as unknown as T[];
  }

  async all<T = any>(sql: string, ...args: any[]): Promise<T[]> {
    const statement = preparePostgresStatement(sql, toParams(args));
    const rows = await observePostgresQuery('pool.all', statement.sql, () => this.client.unsafe(statement.sql, statement.params));
    return rows as unknown as T[];
  }

  async get<T = any>(sql: string, ...args: any[]): Promise<T | undefined> {
    const rows = await this.all<T>(sql, ...args);
    return rows[0];
  }

  async run(sql: string, ...args: any[]): Promise<MysqlRunResult> {
    const statement = preparePostgresStatement(sql, toParams(args), { returningId: true });
    const rows: any = await observePostgresQuery('pool.run', statement.sql, () => this.client.unsafe(statement.sql, statement.params));
    const insertId = Number(rows?.[0]?.id || 0);
    const changes = Number(rows?.count ?? rows?.length ?? 0);
    return {
      changes,
      affectedRows: changes,
      insertId,
      lastInsertRowid: insertId
    };
  }

  async transaction<T>(task: (tx: PostgresTx) => Promise<T>): Promise<T> {
    let lastError: any;
    for (let attempt = 1; attempt <= PG_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.client.begin(async (sql: PostgresConnectionLike) => task(new PostgresTx(sql))) as T;
      } catch (err: any) {
        lastError = err;
        if (!isRetryablePostgresTransactionError(err) || attempt >= PG_TRANSACTION_MAX_ATTEMPTS) throw err;
        await sleep(25 * attempt * attempt);
      }
    }
    throw lastError;
  }

  async close(): Promise<void> {
    await this.client.end({ timeout: 5 });
  }
}

export class PostgresTx {
  constructor(private readonly client: PostgresConnectionLike) {}

  async all<T = any>(sql: string, ...args: any[]): Promise<T[]> {
    const statement = preparePostgresStatement(sql, toParams(args));
    const rows = await observePostgresQuery('tx.all', statement.sql, () => this.client.unsafe(statement.sql, statement.params));
    return rows as unknown as T[];
  }

  async get<T = any>(sql: string, ...args: any[]): Promise<T | undefined> {
    const rows = await this.all<T>(sql, ...args);
    return rows[0];
  }

  async run(sql: string, ...args: any[]): Promise<MysqlRunResult> {
    const statement = preparePostgresStatement(sql, toParams(args), { returningId: true });
    const rows: any = await observePostgresQuery('tx.run', statement.sql, () => this.client.unsafe(statement.sql, statement.params));
    const insertId = Number(rows?.[0]?.id || 0);
    const changes = Number(rows?.count ?? rows?.length ?? 0);
    return {
      changes,
      affectedRows: changes,
      insertId,
      lastInsertRowid: insertId
    };
  }
}

export const createPostgresDb = (): PostgresDb => new PostgresDb(postgres(getPostgresUrl(), {
  max: Math.max(1, Number(process.env.POSTGRES_CONNECTION_LIMIT || process.env.MYSQL_CONNECTION_LIMIT || 5)),
  idle_timeout: Math.max(1, Number(process.env.POSTGRES_IDLE_TIMEOUT_SECONDS || 20)),
  connect_timeout: Math.max(1, Number(process.env.POSTGRES_CONNECT_TIMEOUT_SECONDS || 10)),
  ssl: getSslConfig() as any,
  transform: {
    undefined: null
  }
}));
