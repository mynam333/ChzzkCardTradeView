#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const getCliValue = (name) => {
  const withEquals = rawArgs.find((arg) => arg.startsWith(`${name}=`));
  if (withEquals) return withEquals.slice(name.length + 1);
  const index = rawArgs.indexOf(name);
  return index >= 0 ? rawArgs[index + 1] : undefined;
};

const hasCliValue = (...names) => names.some((name) => getCliValue(name) !== undefined);
const hasRequiredCliDbConfig = [
  hasCliValue('--mysql-host'),
  hasCliValue('--mysql-port'),
  hasCliValue('--mysql-database'),
  hasCliValue('--mysql-user'),
  hasCliValue('--postgres-host', '--pg-host'),
  hasCliValue('--postgres-port', '--pg-port'),
  hasCliValue('--postgres-database', '--pg-database'),
  hasCliValue('--postgres-user', '--pg-user')
].every(Boolean);

let shouldReset = !args.has('--no-reset') && (args.has('--reset') || process.env.PG_IMPORT_RESET === 'true');
const shouldSchemaOnly = args.has('--schema-only');
const shouldDataOnly = args.has('--data-only');
const shouldVerifyOnly = args.has('--verify-only');
const shouldCreateMissing = !args.has('--no-create-missing') && process.env.PG_IMPORT_CREATE_MISSING !== 'false';
const shouldPrompt = !args.has('--non-interactive') && (args.has('--interactive') || args.has('-i') || !hasRequiredCliDbConfig);
const shouldAutoYes = args.has('--yes') || args.has('-y');
let shouldUpdateEnv = !args.has('--skip-env-update') && process.env.PG_IMPORT_UPDATE_ENV !== 'false' && !shouldSchemaOnly && !shouldVerifyOnly;
let shouldSyncFiles = !args.has('--skip-file-sync') && (args.has('--sync-files') || process.env.PG_IMPORT_SYNC_FILES === 'true');
const batchSize = Math.max(1, Number(getCliValue('--batch-size') || process.env.PG_IMPORT_BATCH_SIZE || 5000));
const maxInsertParams = Math.max(1000, Number(getCliValue('--max-insert-params') || process.env.PG_IMPORT_MAX_INSERT_PARAMS || 60000));

const schemaPath = path.resolve(projectRoot, process.env.POSTGRES_SCHEMA_PATH || 'init-db-postgres.sql');
let envUpdatePath = path.resolve(projectRoot, getCliValue('--env-path') || process.env.PG_IMPORT_ENV_PATH || path.join('backend', '.env'));
let migrationConfig = null;

const SCRIPT_DEFAULTS = {
  mysql: {
    host: '193.123.229.21',
    port: 3306,
    user: 'mynam333',
    database: 'chikapo'
  },
  postgres: {
    host: '127.0.0.1',
    port: 5432,
    user: 'ubuntu',
    database: 'chikapo',
    ssl: false
  }
};

const DEFAULT_FILE_EXCLUDES = [
  'node_modules',
  '*/node_modules',
  '*/node_modules/*',
  '.git',
  '.git/*',
  '.next',
  '.next/*',
  'frontend/.next',
  'frontend/.next/*',
  'frontend/out',
  'frontend/out/*',
  'backend/dist',
  'backend/dist/*',
  'dist',
  'dist/*',
  'coverage',
  'coverage/*',
  '.turbo',
  '.turbo/*',
  '.cache',
  '.cache/*',
  '.pnpm-store',
  '.pnpm-store/*',
  'npm-debug.log*',
  'yarn-debug.log*',
  'yarn-error.log*',
  '*.log',
  'local.sqlite',
  'local.sqlite-*',
  '*.sqlite-shm',
  '*.sqlite-wal',
  'backups',
  'backups/*'
];

const CORE_TABLE_ORDER = [
  'users',
  'deleted_user_accounts',
  'point_ledger_entries',
  'asset_event_logs',
  'tutorial_rewards',
  'titles',
  'user_titles',
  'streamers',
  'shop_items',
  'user_cards',
  'user_card_serials',
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
  'friend_requests',
  'friendships',
  'chat_rooms',
  'chat_messages',
  'link_previews',
  'system_configs',
  'market_listings',
  'market_transaction_audit_logs',
  'market_bids',
  'market_watches',
  'user_minigame_tickets',
  'minigame_sessions',
  'subscription_title_rules',
  'subscription_title_states',
  'puzzle_excluded_images',
  'user_image_blinds',
  'chat_attachments',
  'achievements',
  'achievement_events',
  'achievement_grant_logs',
  'achievement_evaluation_queue',
  'arena_decks',
  'arena_matches',
  'arena_player_ratings',
  'arena_match_replays',
  'arena_rank_snapshots',
  'arena_match_queue',
  'arena_cups',
  'arena_cup_replays',
  'arena_cup_queue',
  'arena_admin_stat_snapshots',
  'arena_admin_jobs',
  'arena_admin_audit_logs',
  'arena_spectator_links',
  'arena_user_cosmetic_loadouts',
  'arena_worker_heartbeats'
];

const PLACEHOLDER_USER_STATUS = '__mysql_to_postgres_placeholder_user__';
const USER_REFERENCE_COLUMNS = {
  tutorial_rewards: ['user_id'],
  user_titles: ['user_id'],
  user_cards: ['user_id'],
  trades: ['sender_id', 'receiver_id'],
  coupon_logs: ['user_id'],
  push_subscriptions: ['user_id'],
  push_notifications: ['user_id'],
  card_reports: ['reporter_id'],
  notifications: ['user_id'],
  user_cosmetics: ['user_id'],
  shop_purchases: ['user_id'],
  user_minigame_tickets: ['user_id'],
  minigame_sessions: ['user_id'],
  user_blocks: ['blocker_id', 'blocked_id'],
  friend_requests: ['requester_id', 'receiver_id'],
  friendships: ['user_a_id', 'user_b_id'],
  chat_rooms: ['user_a_id', 'user_b_id', 'closed_by_user_id'],
  chat_messages: ['sender_id'],
  market_listings: ['seller_id', 'buyer_id', 'current_bidder_id'],
  market_bids: ['bidder_id'],
  market_watches: ['user_id'],
  subscription_title_states: ['user_id'],
  puzzle_excluded_images: ['blocked_by'],
  user_image_blinds: ['user_id'],
  chat_attachments: ['owner_user_id'],
  achievement_events: ['user_id'],
  achievement_grant_logs: ['user_id'],
  achievement_evaluation_queue: ['user_id'],
  arena_decks: ['user_id'],
  arena_matches: ['player_a_id', 'player_b_id', 'winner_user_id'],
  arena_player_ratings: ['user_id'],
  arena_match_queue: ['user_id'],
  arena_cup_queue: ['user_id'],
  arena_admin_audit_logs: ['actor_user_id'],
  arena_spectator_links: ['owner_user_id'],
  arena_user_cosmetic_loadouts: ['user_id']
};

const splitSqlStatements = (sql) => {
  const statements = [];
  let current = '';
  let quote = null;
  let dollarQuote = null;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (!quote && !dollarQuote && ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      current += '\n';
      continue;
    }
    if (!quote && !dollarQuote && ch === '/' && next === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    if (!quote && ch === '$') {
      const match = sql.slice(i).match(/^\$[a-zA-Z0-9_]*\$/);
      if (match) {
        const tag = match[0];
        if (!dollarQuote || dollarQuote === tag) {
          current += tag;
          i += tag.length - 1;
          dollarQuote = dollarQuote === tag ? null : tag;
          continue;
        }
      }
    }

    current += ch;

    if (dollarQuote) continue;
    if (quote) {
      if (ch === quote) {
        if (quote === '\'' && next === '\'') {
          current += next;
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === '\'' || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === ';') {
      const statement = current.trim().replace(/;$/, '').trim();
      if (statement) statements.push(statement);
      current = '';
    }
  }

  if (dollarQuote) {
    throw new Error(`SQL 파일의 dollar quote가 닫히지 않았습니다: ${dollarQuote}`);
  }
  if (quote) {
    throw new Error(`SQL 파일의 문자열 quote가 닫히지 않았습니다: ${quote}`);
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
};

const quoteMysqlIdent = (name) => `\`${String(name).replace(/`/g, '``')}\``;
const quotePgIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

const sqlPreview = (statement, limit = 1200) => statement.replace(/\s+/g, ' ').trim().slice(0, limit);

const parseDbUrl = (url, defaultPort) => {
  if (!url) return {};
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : defaultPort,
    user: decodeURIComponent(parsed.username || ''),
    password: decodeURIComponent(parsed.password || ''),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  };
};

const buildDbUrl = (scheme, config) => {
  const user = encodeURIComponent(config.user || '');
  const password = encodeURIComponent(config.password || '');
  const auth = password ? `${user}:${password}` : user;
  return `${scheme}://${auth}@${config.host}:${config.port}/${encodeURIComponent(config.database)}`;
};

const readConfigDefaults = () => {
  const mysqlUrl = parseDbUrl(process.env.MYSQL_URL, 3306);
  const postgresUrl = parseDbUrl(process.env.POSTGRES_URL || process.env.POSTGRESQL_URL || process.env.DATABASE_URL, 5432);
  const syncSource = getCliValue('--project-source') || process.env.PG_IMPORT_PROJECT_SOURCE || projectRoot;
  const syncTargetHost = getCliValue('--target-host') || getCliValue('--ssh-host') || process.env.PG_IMPORT_TARGET_HOST || postgresUrl.host || process.env.POSTGRES_HOST || process.env.PGHOST || '';
  const syncTargetUser = getCliValue('--target-user') || getCliValue('--ssh-user') || process.env.PG_IMPORT_TARGET_USER || process.env.USER || '';
  return {
    mysql: {
      host: getCliValue('--mysql-host') || mysqlUrl.host || process.env.MYSQL_HOST || SCRIPT_DEFAULTS.mysql.host,
      port: Number(getCliValue('--mysql-port') || mysqlUrl.port || process.env.MYSQL_PORT || SCRIPT_DEFAULTS.mysql.port),
      user: getCliValue('--mysql-user') || mysqlUrl.user || process.env.MYSQL_USER || SCRIPT_DEFAULTS.mysql.user,
      password: getCliValue('--mysql-password') ?? mysqlUrl.password ?? process.env.MYSQL_PASSWORD ?? '',
      database: getCliValue('--mysql-database') || mysqlUrl.database || process.env.MYSQL_DATABASE || SCRIPT_DEFAULTS.mysql.database
    },
    postgres: {
      host: getCliValue('--postgres-host') || getCliValue('--pg-host') || postgresUrl.host || process.env.POSTGRES_HOST || process.env.PGHOST || SCRIPT_DEFAULTS.postgres.host,
      port: Number(getCliValue('--postgres-port') || getCliValue('--pg-port') || postgresUrl.port || process.env.POSTGRES_PORT || process.env.PGPORT || SCRIPT_DEFAULTS.postgres.port),
      user: getCliValue('--postgres-user') || getCliValue('--pg-user') || postgresUrl.user || process.env.POSTGRES_USER || process.env.PGUSER || SCRIPT_DEFAULTS.postgres.user,
      password: getCliValue('--postgres-password') ?? getCliValue('--pg-password') ?? postgresUrl.password ?? process.env.POSTGRES_PASSWORD ?? process.env.PGPASSWORD ?? '',
      database: getCliValue('--postgres-database') || getCliValue('--pg-database') || postgresUrl.database || process.env.POSTGRES_DATABASE || process.env.POSTGRES_DB || process.env.PGDATABASE || SCRIPT_DEFAULTS.postgres.database,
      ssl: String(getCliValue('--postgres-ssl') ?? process.env.POSTGRES_SSL ?? String(SCRIPT_DEFAULTS.postgres.ssl)).toLowerCase() === 'true'
    },
    files: {
      enabled: shouldSyncFiles,
      sourceDir: path.resolve(projectRoot, syncSource),
      targetHost: syncTargetHost,
      targetPort: Number(getCliValue('--target-port') || getCliValue('--ssh-port') || process.env.PG_IMPORT_TARGET_PORT || 22),
      targetUser: syncTargetUser,
      targetPath: getCliValue('--target-path') || process.env.PG_IMPORT_TARGET_PATH || '',
      sshKey: getCliValue('--ssh-key') || process.env.PG_IMPORT_SSH_KEY || '',
      excludes: [
        ...DEFAULT_FILE_EXCLUDES,
        ...(process.env.PG_IMPORT_EXCLUDES || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        ...rawArgs
          .filter((arg) => arg.startsWith('--exclude='))
          .map((arg) => arg.slice('--exclude='.length))
          .filter(Boolean)
      ]
    }
  };
};

const createPrompt = () => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (message, defaultValue = '') =>
    new Promise((resolve) => {
      const suffix = defaultValue === '' ? '' : ` [${defaultValue}]`;
      rl.question(`${message}${suffix}: `, (answer) => resolve(answer.trim() || defaultValue));
    });
  const askSecret = (message, defaultValue = '') => {
    if (!process.stdin.isTTY) return ask(message, defaultValue);
    return new Promise((resolve) => {
      const originalWrite = rl._writeToOutput;
      rl._writeToOutput = function writeMuted(output) {
        if (rl.stdoutMuted) {
          rl.output.write(output.replace(/[^\r\n]/g, '*'));
        } else {
          originalWrite.call(rl, output);
        }
      };
      rl.stdoutMuted = true;
      const suffix = defaultValue ? ' [현재 값 유지]' : '';
      rl.question(`${message}${suffix}: `, (answer) => {
        rl.stdoutMuted = false;
        rl._writeToOutput = originalWrite;
        rl.output.write('\n');
        resolve(answer.trim() || defaultValue);
      });
    });
  };
  const close = () => rl.close();
  return { ask, askSecret, close };
};

const collectMigrationConfig = async () => {
  const defaults = readConfigDefaults();
  if (!shouldPrompt) {
    return defaults;
  }

  const prompt = createPrompt();
  try {
    console.log('[MySQL -> PostgreSQL] 대화형 설정을 시작합니다. Enter를 누르면 대괄호의 기본값을 사용합니다.');
    envUpdatePath = path.resolve(projectRoot, await prompt.ask('갱신할 backend .env 경로', path.relative(projectRoot, envUpdatePath)));

    defaults.mysql.host = await prompt.ask('원본 MySQL 호스트', defaults.mysql.host);
    defaults.mysql.port = Number(await prompt.ask('원본 MySQL 포트', String(defaults.mysql.port || 3306)));
    defaults.mysql.database = await prompt.ask('원본 MySQL DB 이름', defaults.mysql.database);
    defaults.mysql.user = await prompt.ask('원본 MySQL 사용자 ID', defaults.mysql.user);
    defaults.mysql.password = await prompt.askSecret('원본 MySQL 비밀번호', defaults.mysql.password);

    defaults.postgres.host = await prompt.ask('대상 PostgreSQL 호스트', defaults.postgres.host);
    defaults.postgres.port = Number(await prompt.ask('대상 PostgreSQL 포트', String(defaults.postgres.port || 5432)));
    defaults.postgres.database = await prompt.ask('대상 PostgreSQL DB 이름', defaults.postgres.database);
    defaults.postgres.user = await prompt.ask('대상 PostgreSQL 사용자 ID', defaults.postgres.user);
    defaults.postgres.password = await prompt.askSecret('대상 PostgreSQL 비밀번호', defaults.postgres.password);
    defaults.postgres.ssl = /^(y(es)?|true|1)$/i.test(await prompt.ask('대상 PostgreSQL SSL 사용 여부(true/false)', defaults.postgres.ssl ? 'true' : 'false'));

    if (!args.has('--reset') && !args.has('--no-reset') && !shouldSchemaOnly && !shouldVerifyOnly) {
      shouldReset = /^(y(es)?|true|1)$/i.test(await prompt.ask('대상 PostgreSQL 기존 데이터를 비우고 이전할까요? (권장: true)', 'true'));
    }
    if (!args.has('--skip-env-update') && !shouldSchemaOnly && !shouldVerifyOnly) {
      shouldUpdateEnv = /^(y(es)?|true|1)$/i.test(await prompt.ask('검증 성공 후 backend .env를 PostgreSQL로 전환할까요?', shouldUpdateEnv ? 'true' : 'false'));
    }
    if (!args.has('--sync-files') && !args.has('--skip-file-sync') && !shouldSchemaOnly && !shouldVerifyOnly) {
      shouldSyncFiles = /^(y(es)?|true|1)$/i.test(await prompt.ask('검증 성공 후 프로젝트 파일도 대상 Ubuntu로 전송할까요?', shouldSyncFiles ? 'true' : 'false'));
      defaults.files.enabled = shouldSyncFiles;
    }
    if (shouldSyncFiles) {
      defaults.files.sourceDir = path.resolve(projectRoot, await prompt.ask('전송할 프로젝트 폴더', defaults.files.sourceDir));
      defaults.files.targetHost = await prompt.ask('대상 Ubuntu SSH 호스트', defaults.files.targetHost || defaults.postgres.host);
      defaults.files.targetPort = Number(await prompt.ask('대상 Ubuntu SSH 포트', String(defaults.files.targetPort || 22)));
      defaults.files.targetUser = await prompt.ask('대상 Ubuntu SSH 사용자', defaults.files.targetUser);
      defaults.files.targetPath = await prompt.ask('대상 Ubuntu 프로젝트 경로', defaults.files.targetPath || `~/ChzzkCardTradeView`);
      defaults.files.sshKey = await prompt.ask('SSH private key 경로(비우면 기본 ssh 설정 사용)', defaults.files.sshKey);
    }

    if (shouldReset && !shouldAutoYes) {
      const answer = await prompt.ask(`확인: ${defaults.postgres.host}:${defaults.postgres.port}/${defaults.postgres.database} 의 기존 데이터를 TRUNCATE 합니다. 계속하려면 MIGRATE 입력`, '');
      if (answer !== 'MIGRATE') throw new Error('사용자 확인이 없어 마이그레이션을 중단했습니다.');
    }
    return defaults;
  } finally {
    prompt.close();
  }
};

const validateMigrationConfig = (config) => {
  for (const [label, db] of [['MySQL', config.mysql], ['PostgreSQL', config.postgres]]) {
    for (const key of ['host', 'port', 'user', 'database']) {
      if (db[key] === undefined || db[key] === null || String(db[key]).trim() === '') {
        throw new Error(`${label} ${key} 값이 비어 있습니다. --interactive 또는 환경 변수로 값을 입력하세요.`);
      }
    }
    if (!Number.isFinite(Number(db.port))) throw new Error(`${label} port 값이 유효하지 않습니다: ${db.port}`);
  }
  if (config.files.enabled) {
    if (!fs.existsSync(config.files.sourceDir) || !fs.statSync(config.files.sourceDir).isDirectory()) {
      throw new Error(`전송할 프로젝트 폴더를 찾을 수 없습니다: ${config.files.sourceDir}`);
    }
    for (const key of ['targetHost', 'targetPort', 'targetUser', 'targetPath']) {
      if (config.files[key] === undefined || config.files[key] === null || String(config.files[key]).trim() === '') {
        throw new Error(`파일 동기화 ${key} 값이 비어 있습니다. --interactive 또는 --target-* 옵션으로 입력하세요.`);
      }
    }
  }
};

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
const remoteShellPath = (value) => {
  const raw = String(value);
  if (raw === '~') return '$HOME';
  if (raw.startsWith('~/')) return `$HOME/${shellQuote(raw.slice(2))}`;
  return shellQuote(raw);
};

const runShellCommand = (command, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: options.stdio || 'inherit',
      cwd: options.cwd || projectRoot
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${options.label || 'command'} failed with exit code ${code}`));
    });
  });

const syncProjectFiles = async (config) => {
  if (!config.files.enabled) return null;

  const sourceDir = path.resolve(config.files.sourceDir);
  const target = `${config.files.targetUser}@${config.files.targetHost}`;
  const sshOptions = [
    '-p',
    String(config.files.targetPort),
    '-o',
    'StrictHostKeyChecking=accept-new'
  ];
  if (config.files.sshKey) {
    sshOptions.push('-i', path.resolve(projectRoot, config.files.sshKey));
  }

  const tarExcludes = Array.from(new Set(config.files.excludes.filter(Boolean)))
    .map((pattern) => `--exclude=${shellQuote(pattern)}`)
    .join(' ');
  const sshBase = ['ssh', ...sshOptions.map(shellQuote), shellQuote(target)].join(' ');
  const remoteTargetPath = remoteShellPath(config.files.targetPath);
  const remotePrepare = `mkdir -p ${remoteTargetPath} && tar -xzf - -C ${remoteTargetPath}`;
  const command = `tar -C ${shellQuote(sourceDir)} ${tarExcludes} -czf - . | ${sshBase} ${shellQuote(remotePrepare)}`;

  console.log(`[MySQL -> PostgreSQL] project file sync: ${sourceDir} -> ${target}:${config.files.targetPath}`);
  console.log(`[MySQL -> PostgreSQL] excluded: ${Array.from(new Set(config.files.excludes)).join(', ')}`);
  await runShellCommand(command, { label: 'project file sync' });
  return { sourceDir, target: `${target}:${config.files.targetPath}` };
};

const setEnvValue = (content, key, value) => {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(content)) return content.replace(pattern, line);
  const ending = content.endsWith('\n') || content.length === 0 ? '' : '\n';
  return `${content}${ending}${line}\n`;
};

const updateBackendEnv = (config) => {
  if (!shouldUpdateEnv) return null;

  const postgresUrl = buildDbUrl('postgres', config.postgres);
  const dir = path.dirname(envUpdatePath);
  fs.mkdirSync(dir, { recursive: true });

  const exists = fs.existsSync(envUpdatePath);
  const original = exists ? fs.readFileSync(envUpdatePath, 'utf8') : '';
  let next = original;
  next = setEnvValue(next, 'DB_MODE', 'postgres');
  next = setEnvValue(next, 'POSTGRES_URL', postgresUrl);
  next = setEnvValue(next, 'DATABASE_URL', postgresUrl);
  next = setEnvValue(next, 'POSTGRES_HOST', config.postgres.host);
  next = setEnvValue(next, 'POSTGRES_PORT', String(config.postgres.port));
  next = setEnvValue(next, 'POSTGRES_USER', config.postgres.user);
  next = setEnvValue(next, 'POSTGRES_PASSWORD', config.postgres.password);
  next = setEnvValue(next, 'POSTGRES_DATABASE', config.postgres.database);
  next = setEnvValue(next, 'POSTGRES_SSL', config.postgres.ssl ? 'true' : 'false');

  let backupPath = null;
  if (exists) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = `${envUpdatePath}.before-postgres-${stamp}.bak`;
    fs.writeFileSync(backupPath, original);
  }
  fs.writeFileSync(envUpdatePath, next);
  return { envPath: envUpdatePath, backupPath, postgresUrl };
};

const getMysqlConfig = () => {
  const ssl =
    process.env.MYSQL_SSL_CA_PATH
      ? { ca: fs.readFileSync(path.resolve(projectRoot, process.env.MYSQL_SSL_CA_PATH), 'utf8') }
      : process.env.MYSQL_SSL === 'true'
        ? {}
        : undefined;

  return {
    host: migrationConfig.mysql.host,
    port: Number(migrationConfig.mysql.port || 3306),
    user: migrationConfig.mysql.user,
    password: migrationConfig.mysql.password || '',
    database: migrationConfig.mysql.database,
    charset: 'utf8mb4',
    dateStrings: true,
    ssl
  };
};

const getPostgresUrl = () => {
  return buildDbUrl('postgres', migrationConfig.postgres);
};

const mysqlTypeToPostgres = (col) => {
  const type = String(col.DATA_TYPE || '').toLowerCase();
  if (col.COLUMN_KEY === 'PRI' && /auto_increment/i.test(col.EXTRA || '') && ['int', 'integer', 'bigint'].includes(type)) {
    return type === 'bigint' ? 'BIGSERIAL' : 'SERIAL';
  }
  if (['tinyint'].includes(type)) {
    const column = String(col.COLUMN_NAME || '');
    if (/^(is_|has_|deleted_|muted_|with_|active$|is_read$|is_active$|is_popup$|is_pinned$)/i.test(column)) return 'BOOLEAN';
    return 'SMALLINT';
  }
  if (['smallint'].includes(type)) return 'SMALLINT';
  if (['int', 'integer', 'mediumint'].includes(type)) return 'INTEGER';
  if (['bigint'].includes(type)) return 'BIGINT';
  if (['float', 'double', 'decimal', 'numeric'].includes(type)) return 'NUMERIC';
  if (['json'].includes(type)) return 'JSONB';
  if (['datetime', 'timestamp'].includes(type)) return 'TIMESTAMPTZ';
  if (['date'].includes(type)) return 'DATE';
  if (['time'].includes(type)) return 'TIME';
  if (['char', 'varchar', 'text', 'mediumtext', 'longtext', 'tinytext', 'enum'].includes(type)) return 'TEXT';
  if (['blob', 'mediumblob', 'longblob', 'binary', 'varbinary'].includes(type)) return 'BYTEA';
  return 'TEXT';
};

const normalizeDefault = (value, pgType) => {
  if (value === null || value === undefined) return '';
  const raw = String(value).trim();
  if (!raw || /auto_increment/i.test(raw)) return '';
  if (/CURRENT_TIMESTAMP/i.test(raw) || /UTC_TIMESTAMP/i.test(raw)) return ' DEFAULT NOW()';
  if (pgType === 'BOOLEAN') {
    if (raw === '0') return ' DEFAULT FALSE';
    if (raw === '1') return ' DEFAULT TRUE';
  }
  if (pgType === 'JSONB') return ` DEFAULT ${raw === "'[]'" ? "'[]'::jsonb" : "'{}'::jsonb"}`;
  if (/^'.*'$/.test(raw) || /^[0-9.-]+$/.test(raw)) return ` DEFAULT ${raw}`;
  return '';
};

const loadMysqlTables = async (mysql) => {
  const [rows] = await mysql.query(`
    SELECT TABLE_NAME
      FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_type = 'BASE TABLE'
     ORDER BY TABLE_NAME
  `);
  return rows.map((row) => row.TABLE_NAME);
};

const loadMysqlColumns = async (mysql, table) => {
  const [rows] = await mysql.query(`
    SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA
      FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = ?
     ORDER BY ORDINAL_POSITION
  `, [table]);
  return rows;
};

const loadPostgresTables = async (pg) => {
  const rows = await pg`
    SELECT table_name
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_type = 'BASE TABLE'
  `;
  return new Set(rows.map((row) => row.table_name));
};

const loadPostgresColumns = async (pg, table) => {
  const rows = await pg`
    SELECT column_name, data_type, udt_name, column_default, is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = ${table}
     ORDER BY ordinal_position
  `;
  return rows;
};

const createMissingTable = async (pg, table, columns) => {
  const primaryColumns = columns.filter((col) => col.COLUMN_KEY === 'PRI').map((col) => col.COLUMN_NAME);
  const definitions = columns.map((col) => {
    const type = mysqlTypeToPostgres(col);
    const notNull = col.IS_NULLABLE === 'NO' && col.COLUMN_KEY !== 'PRI' ? ' NOT NULL' : '';
    const defaultSql = normalizeDefault(col.COLUMN_DEFAULT, type);
    return `${quotePgIdent(col.COLUMN_NAME)} ${type}${notNull}${defaultSql}`;
  });
  if (primaryColumns.length > 0 && !definitions.some((definition) => /\bPRIMARY KEY\b/i.test(definition))) {
    definitions.push(`PRIMARY KEY (${primaryColumns.map(quotePgIdent).join(', ')})`);
  }
  await pg.unsafe(`CREATE TABLE IF NOT EXISTS ${quotePgIdent(table)} (${definitions.join(', ')})`);
};

const addMissingColumns = async (pg, table, mysqlColumns, pgColumns) => {
  const existing = new Set(pgColumns.map((col) => col.column_name));
  for (const col of mysqlColumns) {
    if (existing.has(col.COLUMN_NAME)) continue;
    const type = mysqlTypeToPostgres(col);
    const defaultSql = normalizeDefault(col.COLUMN_DEFAULT, type);
    await pg.unsafe(`ALTER TABLE ${quotePgIdent(table)} ADD COLUMN IF NOT EXISTS ${quotePgIdent(col.COLUMN_NAME)} ${type}${defaultSql}`);
  }
};

const findReferencedUsers = async (mysql, table, column) => {
  const [rows] = await mysql.query(`
    SELECT DISTINCT ${quoteMysqlIdent(column)} AS id
      FROM ${quoteMysqlIdent(table)}
     WHERE ${quoteMysqlIdent(column)} IS NOT NULL
       AND ${quoteMysqlIdent(column)} <> ''
  `);
  return rows.map((row) => String(row.id || '').trim()).filter(Boolean);
};

const insertPlaceholderUsers = async (pg, userIds, context) => {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueIds.length === 0) return 0;

  const pgUserColumns = await loadPostgresColumns(pg, 'users');
  const userColumnSet = new Set(pgUserColumns.map((col) => col.column_name));
  const insertColumns = ['id', 'username'];
  if (userColumnSet.has('role')) insertColumns.push('role');
  if (userColumnSet.has('point')) insertColumns.push('point');
  if (userColumnSet.has('status_message')) insertColumns.push('status_message');
  if (userColumnSet.has('created_at')) insertColumns.push('created_at');

  let inserted = 0;
  for (let i = 0; i < uniqueIds.length; i += 500) {
    const group = uniqueIds.slice(i, i + 500);
    const params = [];
    const tuples = group.map((id) => {
      const values = insertColumns.map((column) => {
        if (column === 'id') return id;
        if (column === 'username') return `Deleted user ${id.slice(0, 12)}`;
        if (column === 'role') return 'USER';
        if (column === 'point') return 0;
        if (column === 'status_message') return PLACEHOLDER_USER_STATUS;
        if (column === 'created_at') return new Date().toISOString();
        return null;
      });
      const placeholders = values.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    const rows = await pg.unsafe(`
      INSERT INTO users (${insertColumns.map(quotePgIdent).join(', ')})
      VALUES ${tuples.join(', ')}
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `, params);
    inserted += rows.length;
  }

  if (inserted > 0) {
    console.log(`[MySQL -> PostgreSQL] ${context}: 누락 users placeholder ${inserted}개 생성`);
  }
  return inserted;
};

const ensureReferencedUsers = async (mysql, pg, table, mysqlColumns) => {
  if (shouldSchemaOnly || shouldVerifyOnly) return 0;
  const refColumns = USER_REFERENCE_COLUMNS[table];
  if (!refColumns?.length) return 0;
  const mysqlColumnSet = new Set(mysqlColumns.map((col) => col.COLUMN_NAME));
  const missingIds = [];
  for (const column of refColumns) {
    if (!mysqlColumnSet.has(column)) continue;
    const ids = await findReferencedUsers(mysql, table, column);
    missingIds.push(...ids);
  }
  return insertPlaceholderUsers(pg, missingIds, table);
};

const runSchema = async (pg) => {
  if (shouldDataOnly || shouldVerifyOnly) return;
  if (!fs.existsSync(schemaPath)) throw new Error(`PostgreSQL 스키마 파일을 찾을 수 없습니다: ${schemaPath}`);
  const schema = fs.readFileSync(schemaPath, 'utf8');
  for (const statement of splitSqlStatements(schema)) {
    try {
      await pg.unsafe(statement);
    } catch (err) {
      err.message = `${err.message}\n[SQL] ${sqlPreview(statement)}`;
      throw err;
    }
  }
};

const resetTarget = async (pg, targetTables) => {
  if (!shouldReset || shouldSchemaOnly || shouldVerifyOnly) return;
  const tables = [...targetTables].reverse();
  if (tables.length === 0) return;
  await pg.unsafe(`TRUNCATE TABLE ${tables.map(quotePgIdent).join(', ')} RESTART IDENTITY CASCADE`);
};

const prepareTargetSchema = async (mysql, pg, sourceTables) => {
  if (shouldVerifyOnly) return;
  let targetTables = await loadPostgresTables(pg);
  for (const table of sourceTables) {
    const columns = await loadMysqlColumns(mysql, table);
    if (!targetTables.has(table)) {
      if (!shouldCreateMissing) continue;
      await createMissingTable(pg, table, columns);
      targetTables = await loadPostgresTables(pg);
    }
    const pgColumns = await loadPostgresColumns(pg, table);
    await addMissingColumns(pg, table, columns, pgColumns);
  }
};

const tableOrder = (sourceTables) => {
  const seen = new Set();
  const ordered = [];
  for (const table of CORE_TABLE_ORDER) {
    if (sourceTables.includes(table)) {
      seen.add(table);
      ordered.push(table);
    }
  }
  for (const table of sourceTables.sort()) {
    if (!seen.has(table)) ordered.push(table);
  }
  return ordered;
};

const isNumericMysqlType = (type) => ['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint'].includes(String(type || '').toLowerCase());

const canUseKeysetImport = (mysqlColumns, columns) => {
  const idColumn = mysqlColumns.find((col) => col.COLUMN_NAME === 'id');
  return columns.includes('id') && idColumn && isNumericMysqlType(idColumn.DATA_TYPE);
};

const fastRebuildIndexes = {
  value_history: {
    drop: [
      'DROP INDEX IF EXISTS idx_value_history_channel_id',
      'DROP INDEX IF EXISTS idx_value_history_recorded_at',
      'DROP INDEX IF EXISTS idx_value_history_channel_recorded'
    ],
    create: [
      'CREATE INDEX IF NOT EXISTS idx_value_history_channel_id ON value_history(channel_id)',
      'CREATE INDEX IF NOT EXISTS idx_value_history_recorded_at ON value_history(recorded_at)',
      'CREATE INDEX IF NOT EXISTS idx_value_history_channel_recorded ON value_history(channel_id, recorded_at DESC)'
    ]
  }
};

const prepareFastImportForTable = async (pg, table) => {
  if (!shouldReset || shouldSchemaOnly || shouldVerifyOnly || args.has('--keep-import-indexes')) return;
  const plan = fastRebuildIndexes[table];
  if (!plan) return;
  for (const statement of plan.drop) {
    await pg.unsafe(statement);
  }
};

const finalizeFastImportForTable = async (pg, table) => {
  if (!shouldReset || shouldSchemaOnly || shouldVerifyOnly || args.has('--keep-import-indexes')) return;
  const plan = fastRebuildIndexes[table];
  if (!plan) return;
  for (const statement of plan.create) {
    await pg.unsafe(statement);
  }
};

const normalizeDateCell = (value, pgColumn) => {
  const type = String(pgColumn?.data_type || pgColumn?.udt_name || '').toLowerCase();
  const isDateOnly = type === 'date';

  if (value instanceof Date) {
    const time = value.getTime();
    if (!Number.isFinite(time)) return null;
    const iso = value.toISOString();
    return isDateOnly ? iso.slice(0, 10) : iso;
  }

  if (typeof value !== 'string') return value;
  const raw = value.trim();
  if (!raw || raw.startsWith('0000-00-00') || /^invalid date$/i.test(raw)) return null;
  if (isDateOnly) return raw.slice(0, 10);

  const normalized = raw.replace(' ', 'T');
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)) return normalized;
  return `${normalized}Z`;
};

const postgresDefaultValue = (pgColumn) => {
  const defaultSql = String(pgColumn?.column_default || '').trim();
  const type = String(pgColumn?.data_type || pgColumn?.udt_name || '').toLowerCase();
  if (!defaultSql) return undefined;

  if (type === 'jsonb' || type === 'json') {
    if (/^'\[\]'::jsonb/i.test(defaultSql) || /^'\[\]'::json/i.test(defaultSql)) return [];
    if (/^'\{\}'::jsonb/i.test(defaultSql) || /^'\{\}'::json/i.test(defaultSql)) return {};
  }
  if (type === 'boolean' || pgColumn?.udt_name === 'bool') {
    if (/^(false|'0'::|0\b)/i.test(defaultSql)) return false;
    if (/^(true|'1'::|1\b)/i.test(defaultSql)) return true;
  }
  if (['integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision'].includes(type)) {
    const numeric = Number(defaultSql);
    if (Number.isFinite(numeric)) return numeric;
  }
  if (type === 'text' || type.includes('character')) {
    const stringMatch = defaultSql.match(/^'(.*)'::/);
    if (stringMatch) return stringMatch[1].replace(/''/g, "'");
  }
  return undefined;
};

const normalizeNullCell = (pgColumn) => {
  if (pgColumn?.is_nullable === 'NO') {
    const defaultValue = postgresDefaultValue(pgColumn);
    if (defaultValue !== undefined) return defaultValue;
  }
  return null;
};

const normalizeCell = (value, pgColumn, context = {}) => {
  if (value === undefined) return normalizeNullCell(pgColumn);
  if (value === null) return normalizeNullCell(pgColumn);
  const type = String(pgColumn?.data_type || pgColumn?.udt_name || '').toLowerCase();
  try {
    if (type === 'boolean' || pgColumn?.udt_name === 'bool') {
      if (value === true || value === false) return value;
      if (value === 1 || value === '1') return true;
      if (value === 0 || value === '0') return false;
    }
    if ((type === 'jsonb' || type === 'json') && typeof value === 'string') {
      if (!value.trim()) return type === 'jsonb' ? {} : null;
      return JSON.parse(value);
    }
    if (type.includes('timestamp') || pgColumn?.udt_name === 'timestamptz' || type === 'date') {
      return normalizeDateCell(value, pgColumn);
    }
    return value;
  } catch (err) {
    const location = [context.table, context.column].filter(Boolean).join('.');
    const suffix = location ? ` (${location}, offset=${context.offset ?? 'unknown'})` : '';
    throw new Error(`값 변환 실패${suffix}: ${err.message}; value=${JSON.stringify(value)}`);
  }
};

const importTable = async (mysql, pg, table) => {
  if (shouldSchemaOnly || shouldVerifyOnly) return 0;
  const pgColumns = await loadPostgresColumns(pg, table);
  if (pgColumns.length === 0) return 0;
  const pgColumnMap = new Map(pgColumns.map((col) => [col.column_name, col]));
  const mysqlColumns = await loadMysqlColumns(mysql, table);
  const columns = mysqlColumns
    .map((col) => col.COLUMN_NAME)
    .filter((name) => pgColumnMap.has(name));
  if (columns.length === 0) return 0;
  await ensureReferencedUsers(mysql, pg, table, mysqlColumns);

  const effectiveBatchSize = Math.max(1, Math.min(batchSize, Math.floor(maxInsertParams / Math.max(columns.length, 1))));
  const useKeyset = canUseKeysetImport(mysqlColumns, columns);
  const [[highWaterRow]] = useKeyset
    ? await mysql.query(`SELECT COALESCE(MAX(${quoteMysqlIdent('id')}), 0) AS max_id FROM ${quoteMysqlIdent(table)}`)
    : [[{ max_id: null }]];
  const highWaterId = Number(highWaterRow?.max_id || 0);
  const [[countRow]] = useKeyset
    ? await mysql.query(`SELECT COUNT(*) AS count FROM ${quoteMysqlIdent(table)} WHERE ${quoteMysqlIdent('id')} <= ?`, [highWaterId])
    : await mysql.query(`SELECT COUNT(*) AS count FROM ${quoteMysqlIdent(table)}`);
  const total = Number(countRow?.count || 0);
  if (total === 0) return 0;

  const selectSql = useKeyset
    ? `SELECT ${columns.map(quoteMysqlIdent).join(', ')} FROM ${quoteMysqlIdent(table)} WHERE ${quoteMysqlIdent('id')} > ? AND ${quoteMysqlIdent('id')} <= ? ORDER BY ${quoteMysqlIdent('id')} ASC LIMIT ?`
    : `SELECT ${columns.map(quoteMysqlIdent).join(', ')} FROM ${quoteMysqlIdent(table)} LIMIT ? OFFSET ?`;
  let imported = 0;
  let lastId = 0;
  await prepareFastImportForTable(pg, table);
  try {
    for (let offset = 0; offset < total;) {
      const limit = useKeyset ? Math.min(effectiveBatchSize, total - imported) : effectiveBatchSize;
      const [rows] = useKeyset
        ? await mysql.query(selectSql, [lastId, highWaterId, limit])
        : await mysql.query(selectSql, [limit, offset]);
      if (rows.length === 0) break;
      const params = [];
      const tuples = rows.map((row, rowIndex) => {
        const placeholders = columns.map((column) => {
          params.push(normalizeCell(row[column], pgColumnMap.get(column), { table, column, offset: offset + rowIndex }));
          return `$${params.length}`;
        });
        return `(${placeholders.join(', ')})`;
      });
      const insertSql = `
        INSERT INTO ${quotePgIdent(table)} (${columns.map(quotePgIdent).join(', ')})
        VALUES ${tuples.join(', ')}
        ON CONFLICT DO NOTHING
      `;
      try {
        await pg.unsafe(insertSql, params);
      } catch (err) {
        err.message = `${err.message}\n[table] ${table}\n[offset] ${offset}\n[columns] ${columns.join(', ')}`;
        throw err;
      }
      imported += rows.length;
      if (useKeyset) {
        const nextLastId = Number(rows[rows.length - 1]?.id);
        if (!Number.isFinite(nextLastId) || nextLastId <= lastId) {
          throw new Error(`${table} keyset import id 순서가 올바르지 않습니다. lastId=${lastId}, next=${nextLastId}`);
        }
        lastId = nextLastId;
      }
      process.stdout.write(`\r[MySQL -> PostgreSQL] ${table}: ${imported}/${total}`);
      offset += rows.length;
      if (useKeyset && rows.length < effectiveBatchSize) break;
    }
  } finally {
    await finalizeFastImportForTable(pg, table);
  }
  process.stdout.write('\n');
  return imported;
};

const resetSequences = async (pg) => {
  if (shouldSchemaOnly || shouldVerifyOnly) return;
  const rows = await pg`
    SELECT table_name, column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND column_default LIKE 'nextval(%'
  `;
  for (const row of rows) {
    await pg.unsafe(`
      SELECT setval(
        pg_get_serial_sequence($1, $2),
        COALESCE((SELECT MAX(${quotePgIdent(row.column_name)}) FROM ${quotePgIdent(row.table_name)}), 0) + 1,
        false
      )
    `, [row.table_name, row.column_name]);
  }
};

const verifyCounts = async (mysql, pg, tables) => {
  const failures = [];
  for (const table of tables) {
    const pgColumns = await loadPostgresColumns(pg, table);
    if (pgColumns.length === 0) continue;
    const [[source]] = await mysql.query(`SELECT COUNT(*) AS count FROM ${quoteMysqlIdent(table)}`);
    const [target] = await pg.unsafe(`SELECT COUNT(*)::BIGINT AS count FROM ${quotePgIdent(table)}`);
    const sourceCount = Number(source?.count || 0);
    let targetCount = Number(target?.count || 0);
    if (table === 'users') {
      const [placeholder] = await pg.unsafe(
        `SELECT COUNT(*)::BIGINT AS count FROM users WHERE status_message = $1`,
        [PLACEHOLDER_USER_STATUS]
      );
      targetCount -= Number(placeholder?.count || 0);
    }
    if (sourceCount !== targetCount) failures.push(`${table}: mysql=${sourceCount}, postgres=${targetCount}`);
  }
  if (failures.length > 0) {
    throw new Error(`마이그레이션 검증 실패(row count 불일치)\n${failures.join('\n')}`);
  }
};

const main = async () => {
  migrationConfig = await collectMigrationConfig();
  validateMigrationConfig(migrationConfig);

  let mysql2;
  let postgres;
  try {
    mysql2 = require('mysql2/promise');
    postgres = require('postgres');
  } catch {
    throw new Error('mysql2/postgres 패키지가 필요합니다. 먼저 `npm install`을 실행하세요.');
  }

  const mysql = await mysql2.createConnection(getMysqlConfig());
  const pg = postgres(getPostgresUrl(), {
    max: 1,
    ssl: migrationConfig.postgres.ssl ? 'require' : undefined
  });

  try {
    await mysql.query('SELECT 1');
    await pg`SELECT 1`;
    const sourceTables = await loadMysqlTables(mysql);
    const orderedTables = tableOrder(sourceTables);

    await runSchema(pg);
    await prepareTargetSchema(mysql, pg, orderedTables);
    const targetTables = await loadPostgresTables(pg);
    await resetTarget(pg, orderedTables.filter((table) => targetTables.has(table)));

    let total = 0;
    for (const table of orderedTables) {
      total += await importTable(mysql, pg, table);
    }
    await resetSequences(pg);
    await verifyCounts(mysql, pg, orderedTables);

    const envUpdate = updateBackendEnv(migrationConfig);
    if (envUpdate) {
      console.log(`[MySQL -> PostgreSQL] env updated: ${envUpdate.envPath}`);
      if (envUpdate.backupPath) console.log(`[MySQL -> PostgreSQL] env backup: ${envUpdate.backupPath}`);
    }
    const fileSync = await syncProjectFiles(migrationConfig);
    if (fileSync) {
      console.log(`[MySQL -> PostgreSQL] files synced: ${fileSync.sourceDir} -> ${fileSync.target}`);
    }
    console.log(`[MySQL -> PostgreSQL] 완료: ${total} rows imported, ${orderedTables.length} tables verified`);
  } finally {
    await mysql.end();
    await pg.end({ timeout: 5 });
  }
};

main().catch((err) => {
  console.error('[MySQL -> PostgreSQL] 실패:', err.message || err);
  process.exitCode = 1;
});
