#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const postgres = require('postgres');

const projectRoot = path.resolve(__dirname, '..');
const args = process.argv.slice(2);

const getArg = (name, fallback = '') => {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  if (index >= 0 && index + 1 < args.length) return args[index + 1];
  return fallback;
};

const hasArg = (name) => args.includes(name);

const prompt = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ask = (question, defaultValue = '') =>
  new Promise((resolve) => {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    prompt.question(`${question}${suffix}: `, (answer) => resolve(answer.trim() || defaultValue));
  });

const askSecret = (question, defaultValue = '') =>
  new Promise((resolve) => {
    const output = prompt.output;
    const originalWrite = output.write;
    output.write = function masked(chunk, encoding, callback) {
      if (String(chunk).includes(question)) return originalWrite.call(output, chunk, encoding, callback);
      return originalWrite.call(output, '*'.repeat(String(chunk).replace(/\r?\n$/, '').length), encoding, callback);
    };
    prompt.question(`${question}${defaultValue ? ' [(set)]' : ''}: `, (answer) => {
      output.write = originalWrite;
      output.write('\n');
      resolve(answer.trim() || defaultValue);
    });
  });

const buildUrl = (config) => {
  if (config.url) return config.url;
  const user = encodeURIComponent(config.user);
  const password = encodeURIComponent(config.password || '');
  const host = config.host || '127.0.0.1';
  const port = Number(config.port || 5432);
  const db = encodeURIComponent(config.database);
  const ssl = config.ssl ? '?sslmode=require' : '';
  return `postgres://${user}:${password}@${host}:${port}/${db}${ssl}`;
};

const loadConfig = async () => {
  const nonInteractive = hasArg('--non-interactive');
  const config = {
    url: getArg('--url', process.env.POSTGRES_URL || process.env.DATABASE_URL || ''),
    host: getArg('--host', process.env.POSTGRES_HOST || process.env.PGHOST || '127.0.0.1'),
    port: Number(getArg('--port', process.env.POSTGRES_PORT || process.env.PGPORT || '5432')),
    database: getArg('--database', process.env.POSTGRES_DATABASE || process.env.POSTGRES_DB || process.env.PGDATABASE || ''),
    user: getArg('--user', process.env.POSTGRES_USER || process.env.PGUSER || ''),
    password: getArg('--password', process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD || ''),
    ssl: /^(1|true|yes)$/i.test(getArg('--ssl', process.env.POSTGRES_SSL || 'false')),
    sampleKeyword: getArg('--sample-keyword', ''),
    reportPath: getArg('--report', ''),
    statementTimeoutMs: Math.max(0, Number(getArg('--statement-timeout-ms', '0'))),
    lockTimeoutMs: Math.max(0, Number(getArg('--lock-timeout-ms', '10000'))),
    skipAnalyze: hasArg('--skip-analyze'),
    skipExplain: hasArg('--skip-explain'),
    vacuum: hasArg('--vacuum'),
    yes: hasArg('--yes')
  };

  const needsPrompt = !nonInteractive && !config.url && (!config.host || !config.database || !config.user);
  if (needsPrompt) {
    config.host = await ask('PostgreSQL host', config.host);
    config.port = Number(await ask('PostgreSQL port', String(config.port || 5432)));
    config.database = await ask('PostgreSQL database', config.database);
    config.user = await ask('PostgreSQL user', config.user);
    config.password = await askSecret('PostgreSQL password', config.password);
    config.ssl = /^(1|true|yes|y)$/i.test(await ask('Use SSL? true/false', config.ssl ? 'true' : 'false'));
  }
  prompt.close();

  if (!config.url && (!config.host || !config.database || !config.user)) {
    throw new Error('PostgreSQL connection info is incomplete. Use --interactive input, --url, or --host/--database/--user.');
  }
  return config;
};

const tuningStatements = [
  'CREATE EXTENSION IF NOT EXISTS pg_trgm',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_username_trgm ON users USING GIN (username gin_trgm_ops)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_id_trgm ON users USING GIN (id gin_trgm_ops)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_banned_until ON users(banned_until) WHERE banned_until IS NOT NULL',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deleted_user_accounts_username_trgm ON deleted_user_accounts USING GIN (username_snapshot gin_trgm_ops)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_streamers_name_trgm ON streamers USING GIN (name gin_trgm_ops)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_streamers_active_value ON streamers(is_active, base_value DESC)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_cards_visible_user_channel_star ON user_cards(user_id, channel_id, star) WHERE is_hidden = FALSE',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_cards_channel_serial ON user_cards(channel_id, serial_number)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_cards_unlocked_user_channel_id ON user_cards(user_id, channel_id, id) WHERE is_locked = FALSE',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_active_latest ON notifications(user_id, created_at DESC, id DESC) WHERE deleted_at IS NULL',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_unread_active ON notifications(user_id) WHERE is_read = FALSE AND deleted_at IS NULL',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_listings_pending_latest ON market_listings(updated_at DESC, id DESC) WHERE status = \'PENDING\'',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_listings_pending_oldest ON market_listings(created_at ASC, id ASC) WHERE status = \'PENDING\'',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_listings_pending_seller ON market_listings(seller_id, id DESC) WHERE status = \'PENDING\'',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_listings_fixed_price ON market_listings(price, id) WHERE status = \'PENDING\' AND listing_type = \'fixed\'',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_listings_auction_price ON market_listings((COALESCE(starting_bid, price, 0)), id) WHERE status = \'PENDING\' AND listing_type = \'auction\'',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_bids_bidder_listing ON market_bids(bidder_id, listing_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_rooms_user_a_active ON chat_rooms(user_a_id, updated_at DESC) WHERE deleted_for_a = FALSE',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_rooms_user_b_active ON chat_rooms(user_b_id, updated_at DESC) WHERE deleted_for_b = FALSE',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_messages_room_visible_latest ON chat_messages(room_id, id DESC) WHERE attachment_deleted_at IS NULL OR message_type <> \'image\''
];

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS user_asset_rankings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'USER',
    point INTEGER NOT NULL DEFAULT 0,
    last_free_draw TIMESTAMPTZ,
    banned_until TIMESTAMPTZ,
    ban_reason TEXT,
    status_message TEXT,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    card_count BIGINT NOT NULL DEFAULT 0,
    cards_value BIGINT NOT NULL DEFAULT 0,
    total_asset BIGINT NOT NULL DEFAULT 0,
    total_rank BIGINT NOT NULL,
    cards_rank BIGINT NOT NULL,
    snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS user_asset_ranking_cards (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL,
    star INTEGER NOT NULL DEFAULT 0,
    card_count BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id, channel_id, star)
  )`,
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_asset_rankings_total ON user_asset_rankings(total_rank, user_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_asset_rankings_cards ON user_asset_rankings(cards_rank, user_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_asset_rankings_username_trgm ON user_asset_rankings USING GIN (username gin_trgm_ops)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_asset_ranking_cards_channel_star_user ON user_asset_ranking_cards(channel_id, star, user_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_asset_ranking_cards_user ON user_asset_ranking_cards(user_id)'
];

const analyzeTables = [
  'users',
  'deleted_user_accounts',
  'streamers',
  'user_cards',
  'market_listings',
  'market_bids',
  'notifications',
  'chat_rooms',
  'chat_messages',
  'user_asset_rankings',
  'user_asset_ranking_cards'
];

const quoteIdent = (value) => `"${String(value).replace(/"/g, '""')}"`;

const runStatement = async (sql, statement, report) => {
  const startedAt = Date.now();
  try {
    await sql.unsafe(statement);
    report.applied.push({ ok: true, duration_ms: Date.now() - startedAt, sql: statement });
  } catch (err) {
    report.applied.push({ ok: false, duration_ms: Date.now() - startedAt, sql: statement, error: err.message, code: err.code });
    throw err;
  }
};

const tableExists = async (sql, table) => {
  const rows = await sql`
    SELECT 1 AS present
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ${table}
     LIMIT 1
  `;
  return rows.length > 0;
};

const getOne = async (sql, query, params = []) => {
  const rows = await sql.unsafe(query, params);
  return rows[0] || null;
};

const planSummary = (plan) => {
  const root = plan?.[0];
  const result = {
    planning_ms: root?.['Planning Time'] ?? null,
    execution_ms: root?.['Execution Time'] ?? null,
    node_types: [],
    indexes: []
  };
  const walk = (node) => {
    if (!node) return;
    if (node['Node Type']) result.node_types.push(node['Node Type']);
    if (node['Index Name']) result.indexes.push(node['Index Name']);
    for (const child of node.Plans || []) walk(child);
  };
  walk(root?.Plan);
  result.node_types = Array.from(new Set(result.node_types));
  result.indexes = Array.from(new Set(result.indexes));
  return result;
};

const explain = async (sql, name, query, params, report) => {
  const rows = await sql.unsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`, params);
  const plan = rows[0]?.['QUERY PLAN'];
  report.explain.push({ name, query, params: params.map((value) => String(value).slice(0, 120)), summary: planSummary(plan), plan });
};

const runExplains = async (sql, config, report) => {
  const sampleUser = await getOne(sql, 'SELECT id, username FROM users ORDER BY created_at DESC NULLS LAST LIMIT 1');
  const sampleKeyword = config.sampleKeyword || String(sampleUser?.username || 'a').slice(0, 12) || 'a';
  const sampleChannel = await getOne(sql, 'SELECT channel_id FROM user_cards GROUP BY channel_id ORDER BY COUNT(*) DESC LIMIT 1');

  if (await tableExists(sql, 'users')) {
    await explain(sql, 'users_search_trgm', `
      SELECT id, username, avatar_url, role, point
        FROM users
       WHERE username ILIKE $1
       ORDER BY CASE WHEN lower(username) = lower($2) THEN 0 ELSE 1 END, username ASC, created_at ASC
       LIMIT 20
    `, [`%${sampleKeyword}%`, sampleKeyword], report);
  }

  if (await tableExists(sql, 'market_listings')) {
    await explain(sql, 'market_active_latest', `
      SELECT ml.id, ml.price, ml.updated_at
        FROM market_listings ml
       WHERE ml.status = 'PENDING'
         AND (COALESCE(ml.listing_type, 'fixed') <> 'auction' OR ml.auction_ends_at IS NULL OR ml.auction_ends_at > NOW())
       ORDER BY ml.updated_at DESC, ml.id DESC
       LIMIT 30
    `, [], report);

    await explain(sql, 'market_search', `
      SELECT ml.id
        FROM market_listings ml
        JOIN users u ON u.id = ml.seller_id
        JOIN user_cards uc ON uc.id = ml.user_card_id
        JOIN streamers s ON s.channel_id = uc.channel_id
       WHERE ml.status = 'PENDING'
         AND (s.name ILIKE $1 OR u.username ILIKE $1)
       ORDER BY ml.updated_at DESC, ml.id DESC
       LIMIT 30
    `, [`%${sampleKeyword}%`], report);
  }

  if (sampleUser?.id && await tableExists(sql, 'user_cards')) {
    await explain(sql, 'user_inventory_groups', `
      SELECT uc.channel_id, COALESCE(uc.star, 0) AS star, COUNT(*) AS count
        FROM user_cards uc
       WHERE uc.user_id = $1
       GROUP BY uc.channel_id, COALESCE(uc.star, 0)
       ORDER BY MAX(uc.id) DESC
       LIMIT 60
    `, [sampleUser.id], report);
  }

  if (sampleUser?.id && await tableExists(sql, 'notifications')) {
    await explain(sql, 'notifications_unread_count', `
      SELECT COUNT(*) AS c
        FROM notifications
       WHERE user_id = $1
         AND is_read = FALSE
         AND deleted_at IS NULL
    `, [sampleUser.id], report);
  }

  if (await tableExists(sql, 'user_asset_rankings')) {
    await explain(sql, 'ranking_snapshot_total', `
      SELECT user_id, username, total_rank
        FROM user_asset_rankings
       WHERE ($1 = '' OR username ILIKE $2)
       ORDER BY total_rank ASC, user_id ASC
       LIMIT 100
    `, [sampleKeyword, `%${sampleKeyword}%`], report);
  }

  if (sampleChannel?.channel_id && await tableExists(sql, 'value_history')) {
    await explain(sql, 'streamer_value_history', `
      SELECT recorded_at, value
        FROM value_history
       WHERE channel_id = $1
       ORDER BY recorded_at DESC
       LIMIT 200
    `, [sampleChannel.channel_id], report);
  }
};

const saveReport = (config, report) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = config.reportPath
    ? path.resolve(projectRoot, config.reportPath)
    : path.resolve(projectRoot, 'logs', `postgres-tuning-report-${stamp}.json`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(report, null, 2));
  return target;
};

const main = async () => {
  const config = await loadConfig();
  if (!config.yes) {
    console.log('[postgres-tune] This will create indexes, run ANALYZE, and execute read-only EXPLAIN ANALYZE queries.');
  }

  const sql = postgres(buildUrl(config), {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    ssl: config.ssl ? 'require' : undefined,
    transform: { undefined: null }
  });

  const report = {
    started_at: new Date().toISOString(),
    database: config.url ? '(url)' : `${config.host}:${config.port}/${config.database}`,
    applied: [],
    analyze: [],
    explain: [],
    errors: []
  };

  try {
    await sql`SELECT 1`;
    await sql.unsafe(`SET statement_timeout = '${config.statementTimeoutMs}ms'`);
    await sql.unsafe(`SET lock_timeout = '${config.lockTimeoutMs}ms'`);

    for (const statement of [...schemaStatements, ...tuningStatements]) {
      await runStatement(sql, statement, report);
    }

    if (!config.skipAnalyze) {
      for (const table of analyzeTables) {
        if (!(await tableExists(sql, table))) continue;
        const startedAt = Date.now();
        await sql.unsafe(`ANALYZE ${quoteIdent(table)}`);
        report.analyze.push({ table, duration_ms: Date.now() - startedAt });
      }
    }

    if (config.vacuum) {
      for (const table of analyzeTables) {
        if (!(await tableExists(sql, table))) continue;
        const startedAt = Date.now();
        await sql.unsafe(`VACUUM (ANALYZE) ${quoteIdent(table)}`);
        report.analyze.push({ table, vacuum: true, duration_ms: Date.now() - startedAt });
      }
    }

    if (!config.skipExplain) {
      await runExplains(sql, config, report);
    }

    report.finished_at = new Date().toISOString();
    const reportPath = saveReport(config, report);
    console.log(`[postgres-tune] done. report=${reportPath}`);
    for (const item of report.explain) {
      console.log(`[postgres-tune] ${item.name}: ${item.summary.execution_ms}ms indexes=${item.summary.indexes.join(', ') || '(none)'}`);
    }
  } catch (err) {
    report.errors.push({ message: err.message, code: err.code, detail: err.detail });
    const reportPath = saveReport(config, report);
    console.error(`[postgres-tune] failed. report=${reportPath}`);
    throw err;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
};

main().catch((err) => {
  console.error(`[postgres-tune] ${err.message || err}`);
  process.exit(1);
});
