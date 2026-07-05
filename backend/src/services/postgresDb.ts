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
  'arena_admin_stat_snapshots',
  'arena_cup_queue',
  'arena_cups',
  'arena_decks',
  'arena_match_queue',
  'arena_matches',
  'arena_rank_snapshots',
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
  achievement_grant_logs: '(user_id, achievement_id, repeat_key)',
  achievements: '(code)',
  arena_cup_replays: '(cup_id)',
  arena_match_replays: '(match_id)',
  arena_player_ratings: '(season_id, user_id)',
  arena_user_cosmetic_loadouts: '(user_id)',
  arena_worker_heartbeats: '(worker_id)',
  asset_event_logs: '(event_key)',
  chat_attachments: '(owner_user_id, source_hash)',
  chat_rooms: '(user_a_id, user_b_id)',
  coupon_logs: '(coupon_id, user_id)',
  coupons: '(code)',
  deleted_user_accounts: '(user_id)',
  friendships: '(user_a_id, user_b_id)',
  link_previews: '(url_hash)',
  market_transaction_audit_logs: '(audit_key)',
  market_watches: '(user_id, channel_id, star)',
  notifications: '(user_id, group_key) WHERE group_key IS NOT NULL',
  puzzle_excluded_images: '(image_key)',
  push_subscriptions: '(endpoint)',
  shop_purchases: '(user_id, item_id)',
  streamers: '(channel_id)',
  streamer_registration_blocks: '(channel_id)',
  subscription_title_states: '(user_id, rule_id)',
  system_configs: '(key)',
  tutorial_rewards: '(user_id, reward_key)',
  user_achievements: '(user_id, achievement_id, repeat_key)',
  user_achievement_stats: '(user_id, stat_key)',
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

const splitSqlTopLevel = (value: string): string[] => {
  const items: string[] = [];
  let current = '';
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    const next = value[i + 1];
    if (quote) {
      current += ch;
      if (ch === quote) {
        if (quote === "'" && next === "'") {
          current += next;
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      items.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) items.push(current.trim());
  return items;
};

const extractInsertColumns = (sql: string): string[] => {
  const match = sql.match(/\bINSERT\s+INTO\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\(([^)]+)\)/i);
  if (!match) return [];
  return splitSqlTopLevel(match[1])
    .map((column) => column.replace(/"/g, '').trim())
    .filter(Boolean);
};

const qualifyExistingColumnRefs = (expr: string, table: string, columns: Set<string>): string => {
  let out = '';
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i];
    const next = expr[i + 1];
    if (quote) {
      out += ch;
      if (ch === quote) {
        if (quote === "'" && next === "'") {
          out += next;
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      const match = expr.slice(i).match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
      if (match) {
        const token = match[0];
        const before = expr.slice(0, i).match(/\S\s*$/)?.[0].trim() || '';
        const after = expr.slice(i + token.length).match(/^\s*\S/)?.[0].trim() || '';
        const isQualified = before === '.';
        const isFunction = after === '(';
        const isKeyword = ['AND', 'OR', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'NULL', 'TRUE', 'FALSE'].includes(token.toUpperCase());
        if (columns.has(token) && !isQualified && !isFunction && !isKeyword) {
          out += `${table}.${token}`;
        } else {
          out += token;
        }
        i += token.length - 1;
        continue;
      }
    }
    out += ch;
  }
  return out;
};

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

  const insertColumns = new Set(extractInsertColumns(before));
  const rewrittenUpdate = splitSqlTopLevel(update)
    .map((assignment) => {
      const match = assignment.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([\s\S]+)$/);
      if (!match || !table) return assignment;
      const lhs = match[1];
      const rhs = match[2]
        .replace(/\bVALUES\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/gi, 'EXCLUDED.$1')
        .replace(/\bVALUES\(\s*"([a-zA-Z_][a-zA-Z0-9_]*)"\s*\)/gi, 'EXCLUDED.$1');
      return `${lhs} = ${qualifyExistingColumnRefs(rhs, table, insertColumns)}`;
    })
    .join(', ');
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

const postgresBooleanColumns = [
  'is_hidden',
  'is_locked',
  'is_read',
  'is_popup',
  'is_pinned',
  'is_equipped',
  'is_subscribed',
  'is_admin_room',
  'is_active',
  'is_image_banned',
  'active',
  'with_cosmetics',
  'deleted_for_a',
  'deleted_for_b',
  'is_deleted',
  'is_enabled',
  'muted_for_a',
  'muted_for_b'
];
const postgresBooleanColumnSet = new Set(postgresBooleanColumns);

const normalizeMysqlDdlForPostgres = (sql: string): string => {
  let normalized = sql;

  const addIndexMatch = normalized.match(/^\s*ALTER\s+TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+ADD\s+(UNIQUE\s+)?INDEX\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]+)\)\s*$/i);
  if (addIndexMatch) {
    const [, table, unique, indexName, columns] = addIndexMatch;
    return `CREATE ${unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${indexName} ON ${table} (${columns.trim()})`;
  }

  if (/^\s*ALTER\s+TABLE\s+[a-zA-Z_][a-zA-Z0-9_]*\s+CONVERT\s+TO\s+CHARACTER\s+SET\b/i.test(normalized)) {
    return 'SELECT 1';
  }

  if (/^\s*ALTER\s+TABLE\s+[a-zA-Z_][a-zA-Z0-9_]*\s+MODIFY\s+COLUMN\b/i.test(normalized)) {
    return 'SELECT 1';
  }

  normalized = normalized.replace(
    /^\s*CREATE\s+TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+LIKE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*;?\s*$/i,
    'CREATE TABLE $1 (LIKE $2 INCLUDING ALL)'
  );

  normalized = normalized
    .replace(/\bDATABASE\(\)/gi, 'current_schema()')
    .replace(/\bBIGINT\s+AUTO_INCREMENT\s+PRIMARY\s+KEY\b/gi, 'BIGSERIAL PRIMARY KEY')
    .replace(/\bINT\s+AUTO_INCREMENT\s+PRIMARY\s+KEY\b/gi, 'SERIAL PRIMARY KEY')
    .replace(/\bINTEGER\s+AUTO_INCREMENT\s+PRIMARY\s+KEY\b/gi, 'SERIAL PRIMARY KEY')
    .replace(/\s+ON\s+UPDATE\s+CURRENT_TIMESTAMP\b/gi, '')
    .replace(/\s+AFTER\s+[a-zA-Z_][a-zA-Z0-9_]*\b/gi, '')
    .replace(/\bDATETIME\b/gi, 'TIMESTAMPTZ')
    .replace(/\bDOUBLE(?!\s+PRECISION)\b/gi, 'DOUBLE PRECISION')
    .replace(/\bFLOAT\b/gi, 'REAL')
    .replace(/\bBIGINT\s+UNSIGNED\b/gi, 'NUMERIC(20,0)')
    .replace(/\bINT\s+UNSIGNED\b/gi, 'BIGINT')
    .replace(/\bINTEGER\s+UNSIGNED\b/gi, 'BIGINT')
    .replace(/\bLONGTEXT\b/gi, 'TEXT')
    .replace(/\bMEDIUMTEXT\b/gi, 'TEXT')
    .replace(/\bJSON\b/gi, 'JSONB');

  for (const column of postgresBooleanColumns) {
    normalized = normalized.replace(
      new RegExp(`\\b${column}\\s+TINYINT(\\s+NOT\\s+NULL)?\\s+DEFAULT\\s+([01])`, 'gi'),
      (_match, notNull, value) => `${column} BOOLEAN${notNull || ''} DEFAULT ${value === '1' ? 'TRUE' : 'FALSE'}`
    );
  }

  normalized = normalized
    .replace(/\bTINYINT\b/gi, 'SMALLINT')
    .replace(/,\s*UNIQUE\s+KEY\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]+)\)/gi, ', CONSTRAINT $1 UNIQUE ($2)')
    .replace(/,\s*(?:KEY|INDEX)\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\([^)]+\)/gi, '')
    .replace(/\)\s*ENGINE\s*=\s*[a-zA-Z0-9_]+(?:\s+DEFAULT\s+CHARSET\s*=\s*[a-zA-Z0-9_]+)?(?:\s+COLLATE\s*=\s*[a-zA-Z0-9_]+)?\s*;?\s*$/i, ')')
    .replace(/\)\s*DEFAULT\s+CHARSET\s*=\s*[a-zA-Z0-9_]+(?:\s+COLLATE\s*=\s*[a-zA-Z0-9_]+)?\s*;?\s*$/i, ')');

  return normalized;
};

const toPostgresBooleanParam = (value: any) => {
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  return value;
};

const normalizeBooleanSql = (sql: string): string => {
  let normalized = sql;
  for (const column of postgresBooleanColumns) {
    const ident = `((?:[a-zA-Z_][a-zA-Z0-9_]*\\.)?${column})`;
    normalized = normalized
      .replace(new RegExp(`COALESCE\\(\\s*${ident}\\s*,\\s*0\\s*\\)\\s*=\\s*0`, 'gi'), 'COALESCE($1, FALSE) = FALSE')
      .replace(new RegExp(`COALESCE\\(\\s*${ident}\\s*,\\s*0\\s*\\)\\s*=\\s*1`, 'gi'), 'COALESCE($1, FALSE) = TRUE')
      .replace(new RegExp(`COALESCE\\(\\s*${ident}\\s*,\\s*0\\s*\\)\\s*<>\\s*0`, 'gi'), 'COALESCE($1, FALSE) <> FALSE')
      .replace(new RegExp(`\\b${ident}\\s*=\\s*0\\b`, 'gi'), '$1 = FALSE')
      .replace(new RegExp(`\\b${ident}\\s*=\\s*1\\b`, 'gi'), '$1 = TRUE')
      .replace(new RegExp(`\\b${ident}\\s+IS\\s+0\\b`, 'gi'), '$1 IS FALSE')
      .replace(new RegExp(`\\b${ident}\\s+IS\\s+1\\b`, 'gi'), '$1 IS TRUE');
  }
  return normalized;
};

const splitSqlList = (value: string): string[] => {
  return splitSqlTopLevel(value);
};

const normalizeBooleanParams = (sql: string, params: any[]): any[] => {
  if (params.length === 0) return params;
  const next = [...params];

  const insertMatch = sql.match(/\bINSERT\s+INTO\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
  if (insertMatch) {
    const columns = splitSqlList(insertMatch[1]).map((column) => column.replace(/"/g, '').trim());
    const values = splitSqlList(insertMatch[2]);
    let paramIndex = 0;
    for (let i = 0; i < values.length; i += 1) {
      const placeholders = (values[i].match(/\?/g) || []).length;
      if (placeholders === 1 && values[i].trim() === '?' && postgresBooleanColumnSet.has(columns[i])) {
        next[paramIndex] = toPostgresBooleanParam(next[paramIndex]);
      }
      paramIndex += placeholders;
    }
  }

  const segments = sql.split('?');
  for (let i = 0; i < segments.length - 1 && i < next.length; i += 1) {
    const prefix = segments[i].slice(-120);
    const comparisonMatch = prefix.match(/(?:^|[\s,(])(?:[a-zA-Z_][a-zA-Z0-9_]*\.)?([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:=|<>|IS)\s*$/i);
    const greatestMatch = prefix.match(/\bGREATEST\(\s*(?:[a-zA-Z_][a-zA-Z0-9_]*\.)?([a-zA-Z_][a-zA-Z0-9_]*)\s*,\s*$/i);
    if (
      (comparisonMatch && postgresBooleanColumnSet.has(comparisonMatch[1])) ||
      (greatestMatch && postgresBooleanColumnSet.has(greatestMatch[1]))
    ) {
      next[i] = toPostgresBooleanParam(next[i]);
    }
  }

  return next;
};

export const normalizePostgresSql = (input: string): string => {
  let sql = input.trim().replace(/`/g, '');
  sql = normalizeMysqlDdlForPostgres(sql);
  sql = sql.replace(/\bCOLLATE\s+utf8mb4_unicode_ci\b/gi, '');
  sql = sql.replace(/\s+FORCE\s+INDEX\s*\([^)]+\)/gi, '');
  sql = sql.replace(/\bUTC_TIMESTAMP\(\)/gi, 'NOW()');
  sql = sql.replace(/\bDATE_ADD\(\s*NOW\(\)\s*,\s*INTERVAL\s+\?\s+(SECOND|MINUTE|HOUR|DAY)\s*\)/gi, (_m, unit) => `(NOW() + (? * INTERVAL '1 ${String(unit).toLowerCase()}'))`);
  sql = sql.replace(/\bDATE_SUB\(\s*NOW\(\)\s*,\s*INTERVAL\s+\?\s+(SECOND|MINUTE|HOUR|DAY)\s*\)/gi, (_m, unit) => `(NOW() - (? * INTERVAL '1 ${String(unit).toLowerCase()}'))`);
  sql = sql.replace(/\bDATE_ADD\(\s*NOW\(\)\s*,\s*INTERVAL\s+(\d+)\s+(SECOND|MINUTE|HOUR|DAY)\s*\)/gi, (_m, n, unit) => `NOW() + INTERVAL '${n} ${String(unit).toLowerCase()}'`);
  sql = sql.replace(/\bDATE_SUB\(\s*NOW\(\)\s*,\s*INTERVAL\s+(\d+)\s+(SECOND|MINUTE|HOUR|DAY)\s*\)/gi, (_m, n, unit) => `NOW() - INTERVAL '${n} ${String(unit).toLowerCase()}'`);
  sql = sql.replace(/\bNOW\(\)\s*-\s*INTERVAL\s+\?\s+(DAY|MINUTE|SECOND|HOUR)\b/gi, (_m, unit) => `(NOW() - (? * INTERVAL '1 ${String(unit).toLowerCase()}'))`);
  sql = sql.replace(/\bNOW\(\)\s*\+\s*INTERVAL\s+\?\s+(DAY|MINUTE|SECOND|HOUR)\b/gi, (_m, unit) => `(NOW() + (? * INTERVAL '1 ${String(unit).toLowerCase()}'))`);
  sql = sql.replace(/\bNOW\(\)\s*-\s*INTERVAL\s+(\d+)\s+(DAY|MINUTE|SECOND|HOUR)\b/gi, (_m, n, unit) => `NOW() - INTERVAL '${n} ${String(unit).toLowerCase()}'`);
  sql = sql.replace(/\bNOW\(\)\s*\+\s*INTERVAL\s+(\d+)\s+(DAY|MINUTE|SECOND|HOUR)\b/gi, (_m, n, unit) => `NOW() + INTERVAL '${n} ${String(unit).toLowerCase()}'`);
  sql = sql.replace(/\bTIMESTAMPDIFF\(\s*DAY\s*,\s*COALESCE\(([^,]+),\s*NOW\(\)\)\s*,\s*NOW\(\)\s*\)/gi, 'FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE($1, NOW()))) / 86400)::INTEGER');
  sql = sql.replace(/\bTIMESTAMPDIFF\(\s*DAY\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)/gi, 'FLOOR(EXTRACT(EPOCH FROM ($2 - $1)) / 86400)::INTEGER');
  sql = sql.replace(/\bTIMESTAMPDIFF\(\s*HOUR\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)/gi, 'FLOOR(EXTRACT(EPOCH FROM ($2 - $1)) / 3600)::INTEGER');
  sql = sql.replace(/\bTIMESTAMPDIFF\(\s*MINUTE\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)/gi, 'FLOOR(EXTRACT(EPOCH FROM ($2 - $1)) / 60)::INTEGER');
  sql = sql.replace(/\bTIMESTAMPDIFF\(\s*SECOND\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)/gi, 'FLOOR(EXTRACT(EPOCH FROM ($2 - $1)))::INTEGER');
  sql = sql.replace(/\bSTR_TO_DATE\(\s*SUBSTRING_INDEX\(REPLACE\(([^,]+),\s*'T',\s*' '\),\s*'\.',\s*1\),\s*'%Y-%m-%d %H:%i:%s'\s*\)/gi, "NULLIF($1, '')::timestamptz");
  sql = sql.replace(/\bCONCAT\(/gi, 'CONCAT(');
  sql = sql.replace(/\bJSON_OBJECT\(\)/gi, "'{}'::jsonb");
  sql = normalizeBooleanSql(sql);
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
  return { sql: rewriteQuestionPlaceholders(normalized), params: normalizeBooleanParams(normalized, limitRewritten.params) };
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
    if (err?.code === '42701') err.code = 'ER_DUP_FIELDNAME';
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

const readPositiveInteger = (value: string | undefined): number | null => {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const getRoleDefaultPostgresConnections = () => {
  const role = String(process.env.PROCESS_ROLE || 'api').trim().toLowerCase();
  if (role === 'api') return 3;
  if (role === 'live-worker') return 2;
  if (role === 'scheduler-worker') return 1;
  if (role === 'chat-worker') return 2;
  return 1;
};

const getPostgresConnectionLimit = () => {
  const explicit = readPositiveInteger(process.env.POSTGRES_CONNECTION_LIMIT);
  if (explicit) return explicit;

  const roleDefault = getRoleDefaultPostgresConnections();
  const fallbackCap = readPositiveInteger(process.env.POSTGRES_FALLBACK_CONNECTION_LIMIT_MAX) || roleDefault;
  const mysqlCompat = readPositiveInteger(process.env.MYSQL_CONNECTION_LIMIT);
  if (mysqlCompat) return Math.min(mysqlCompat, fallbackCap);

  return roleDefault;
};

export const createPostgresDb = (): PostgresDb => new PostgresDb(postgres(getPostgresUrl(), {
  max: getPostgresConnectionLimit(),
  idle_timeout: Math.max(1, Number(process.env.POSTGRES_IDLE_TIMEOUT_SECONDS || 20)),
  connect_timeout: Math.max(1, Number(process.env.POSTGRES_CONNECT_TIMEOUT_SECONDS || 10)),
  ssl: getSslConfig() as any,
  connection: {
    TimeZone: 'UTC'
  },
  transform: {
    undefined: null
  }
}));
