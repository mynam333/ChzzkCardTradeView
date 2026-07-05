import { getDbMode, getMysqlDb, getSqlDialect, getSqliteDb, getSupabaseClient } from './db';

export type AssetEventAssetType = 'card' | 'point' | 'cosmetic' | 'ticket' | 'title' | 'unknown';
export type AssetEventAction =
  | 'add'
  | 'remove'
  | 'move'
  | 'delete'
  | 'update'
  | 'spend'
  | 'refund'
  | 'reserve'
  | 'release'
  | 'equip'
  | 'unequip';

export type AssetEventInput = {
  eventKey?: string | null;
  userId?: string | null;
  counterpartyUserId?: string | null;
  fromUserId?: string | null;
  toUserId?: string | null;
  assetType: AssetEventAssetType;
  action: AssetEventAction;
  amount?: number | null;
  quantity?: number | null;
  balanceAfter?: number | null;
  sourceType?: string | null;
  sourceId?: string | number | null;
  reason?: string | null;
  description?: string | null;
  cardId?: number | null;
  channelId?: string | null;
  serialNumber?: number | null;
  star?: number | null;
  itemId?: number | null;
  itemType?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type AssetEventLogEntry = {
  id: number;
  event_key: string | null;
  user_id: string | null;
  username?: string | null;
  user_deleted_at?: string | null;
  counterparty_user_id: string | null;
  counterparty_username?: string | null;
  counterparty_deleted_at?: string | null;
  from_user_id: string | null;
  from_username?: string | null;
  to_user_id: string | null;
  to_username?: string | null;
  asset_type: AssetEventAssetType;
  action: AssetEventAction;
  amount: number | null;
  quantity: number | null;
  balance_after: number | null;
  source_type: string;
  source_id: string | null;
  reason: string;
  description: string | null;
  card_id: number | null;
  channel_id: string | null;
  streamer_name?: string | null;
  serial_number: number | null;
  star: number | null;
  item_id: number | null;
  item_name?: string | null;
  item_type: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type AssetEventListOptions = {
  userId?: string | null;
  limit?: number;
  beforeId?: number | null;
  assetType?: string | null;
  action?: string | null;
  sourceType?: string | null;
  search?: string | null;
};

export type AssetEventSuspicionSeverity = 'critical' | 'high' | 'medium' | 'low';

export type AssetEventSuspicionCategory = {
  id: string;
  label: string;
  score: number;
  severity: AssetEventSuspicionSeverity;
  reasons: string[];
  metrics: Record<string, number | string | null>;
};

export type AssetEventSuspicionCounterparty = {
  user_id: string;
  username: string | null;
  events: number;
  point_in: number;
  point_out: number;
  card_in: number;
  card_out: number;
  score: number;
  last_event_at: string | null;
};

export type AssetEventSuspect = {
  user_id: string;
  username: string | null;
  user_deleted_at: string | null;
  severity: AssetEventSuspicionSeverity;
  risk_score: number;
  reasons: string[];
  categories: AssetEventSuspicionCategory[];
  counterparties: AssetEventSuspicionCounterparty[];
  total_events: number;
  relation_events: number;
  point_income: number;
  point_expense: number;
  point_net: number;
  card_moves: number;
  card_adds: number;
  card_deletes: number;
  cosmetic_events: number;
  negative_balance_events: number;
  manual_adjustment_events: number;
  last_event_at: string | null;
};

const clampLimit = (value: unknown, fallback = 80, max = 200) =>
  Math.max(1, Math.min(max, Math.floor(Number(value || fallback))));

const normalizeDate = (value: any): string => {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
};

const parseMetadata = (value: any): Record<string, unknown> | null => {
  if (!value) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
};

const normalizeEvent = (event: AssetEventInput) => {
  const amount = event.amount == null ? null : Math.trunc(Number(event.amount));
  const quantity = event.quantity == null ? null : Math.trunc(Number(event.quantity));
  const balanceAfter = event.balanceAfter == null ? null : Math.trunc(Number(event.balanceAfter));
  return {
    eventKey: event.eventKey ? String(event.eventKey).slice(0, 255) : null,
    userId: event.userId || null,
    counterpartyUserId: event.counterpartyUserId || null,
    fromUserId: event.fromUserId || null,
    toUserId: event.toUserId || null,
    assetType: event.assetType || 'unknown',
    action: event.action || 'update',
    amount: Number.isFinite(amount as number) ? amount : null,
    quantity: Number.isFinite(quantity as number) ? quantity : null,
    balanceAfter: Number.isFinite(balanceAfter as number) ? balanceAfter : null,
    sourceType: String(event.sourceType || 'unknown').slice(0, 64),
    sourceId: event.sourceId == null ? null : String(event.sourceId).slice(0, 191),
    reason: String(event.reason || event.sourceType || 'unknown').slice(0, 120),
    description: event.description ? String(event.description).slice(0, 500) : null,
    cardId: event.cardId == null ? null : Math.trunc(Number(event.cardId)),
    channelId: event.channelId || null,
    serialNumber: event.serialNumber == null ? null : Math.trunc(Number(event.serialNumber)),
    star: event.star == null ? null : Math.trunc(Number(event.star)),
    itemId: event.itemId == null ? null : Math.trunc(Number(event.itemId)),
    itemType: event.itemType ? String(event.itemType).slice(0, 64) : null,
    metadata: JSON.stringify(event.metadata || {})
  };
};

const insertColumns = `
  (event_key, user_id, counterparty_user_id, from_user_id, to_user_id,
   asset_type, action, amount, quantity, balance_after, source_type, source_id,
   reason, description, card_id, channel_id, serial_number, star, item_id, item_type, metadata)
`;

const insertValues = `
  (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const normalizedParams = (event: ReturnType<typeof normalizeEvent>) => [
  event.eventKey,
  event.userId,
  event.counterpartyUserId,
  event.fromUserId,
  event.toUserId,
  event.assetType,
  event.action,
  event.amount,
  event.quantity,
  event.balanceAfter,
  event.sourceType,
  event.sourceId,
  event.reason,
  event.description,
  event.cardId,
  event.channelId,
  event.serialNumber,
  event.star,
  event.itemId,
  event.itemType,
  event.metadata
];

const sqliteAssetEventTables = new WeakSet<object>();
let mysqlAssetEventTableReady = false;

const ensureSqliteAssetEventTable = (db: any) => {
  if (typeof db !== 'object' || db === null || sqliteAssetEventTables.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS asset_event_logs (
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
    );
    CREATE INDEX IF NOT EXISTS idx_asset_event_user ON asset_event_logs(user_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_asset_event_counterparty ON asset_event_logs(counterparty_user_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_asset_event_from_to ON asset_event_logs(from_user_id, to_user_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_asset_event_asset_action ON asset_event_logs(asset_type, action, id DESC);
    CREATE INDEX IF NOT EXISTS idx_asset_event_source ON asset_event_logs(source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_asset_event_card ON asset_event_logs(card_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_asset_event_item ON asset_event_logs(item_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_asset_event_created ON asset_event_logs(created_at);
  `);
  sqliteAssetEventTables.add(db);
};

const ensureMysqlAssetEventColumn = async (db: any, column: string, ddl: string) => {
  if (getSqlDialect() === 'postgres') return;
  const existing = await db.get(
    `SELECT 1 AS present
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'asset_event_logs'
        AND column_name = ?
      LIMIT 1`,
    column
  );
  if (existing) return;
  await db.run(`ALTER TABLE asset_event_logs ADD COLUMN ${ddl}`);
};

const ensureMysqlAssetEventIndex = async (db: any, indexName: string, ddl: string) => {
  if (getSqlDialect() === 'postgres') return;
  const existing = await db.get(
    `SELECT 1 AS present
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'asset_event_logs'
        AND index_name = ?
      LIMIT 1`,
    indexName
  );
  if (existing) return;
  await db.run(`ALTER TABLE asset_event_logs ADD ${ddl}`);
};

const ensureMysqlAssetEventTable = async (db: any) => {
  if (mysqlAssetEventTableReady) return;
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
  if (getSqlDialect() === 'postgres') {
    mysqlAssetEventTableReady = true;
    return;
  }

  const columns: Array<[string, string]> = [
    ['event_key', 'event_key VARCHAR(255) NULL AFTER id'],
    ['user_id', 'user_id VARCHAR(191) NULL AFTER event_key'],
    ['counterparty_user_id', 'counterparty_user_id VARCHAR(191) NULL AFTER user_id'],
    ['from_user_id', 'from_user_id VARCHAR(191) NULL AFTER counterparty_user_id'],
    ['to_user_id', 'to_user_id VARCHAR(191) NULL AFTER from_user_id'],
    ['asset_type', "asset_type VARCHAR(32) NOT NULL DEFAULT 'unknown' AFTER to_user_id"],
    ['action', "action VARCHAR(32) NOT NULL DEFAULT 'update' AFTER asset_type"],
    ['amount', 'amount BIGINT NULL AFTER action'],
    ['quantity', 'quantity BIGINT NULL AFTER amount'],
    ['balance_after', 'balance_after BIGINT NULL AFTER quantity'],
    ['source_type', "source_type VARCHAR(64) NOT NULL DEFAULT 'unknown' AFTER balance_after"],
    ['source_id', 'source_id VARCHAR(191) NULL AFTER source_type'],
    ['reason', "reason VARCHAR(120) NOT NULL DEFAULT 'unknown' AFTER source_id"],
    ['description', 'description VARCHAR(500) NULL AFTER reason'],
    ['card_id', 'card_id BIGINT NULL AFTER description'],
    ['channel_id', 'channel_id VARCHAR(191) NULL AFTER card_id'],
    ['serial_number', 'serial_number BIGINT NULL AFTER channel_id'],
    ['star', 'star INT NULL AFTER serial_number'],
    ['item_id', 'item_id BIGINT NULL AFTER star'],
    ['item_type', 'item_type VARCHAR(64) NULL AFTER item_id'],
    ['metadata', 'metadata JSON NULL AFTER item_type'],
    ['created_at', 'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER metadata']
  ];
  for (const [column, ddl] of columns) {
    await ensureMysqlAssetEventColumn(db, column, ddl);
  }

  await ensureMysqlAssetEventIndex(db, 'uniq_asset_event_key', 'UNIQUE INDEX uniq_asset_event_key (event_key)');
  await ensureMysqlAssetEventIndex(db, 'idx_asset_event_user', 'INDEX idx_asset_event_user (user_id, id)');
  await ensureMysqlAssetEventIndex(db, 'idx_asset_event_counterparty', 'INDEX idx_asset_event_counterparty (counterparty_user_id, id)');
  await ensureMysqlAssetEventIndex(db, 'idx_asset_event_from_to', 'INDEX idx_asset_event_from_to (from_user_id, to_user_id, id)');
  await ensureMysqlAssetEventIndex(db, 'idx_asset_event_asset_action', 'INDEX idx_asset_event_asset_action (asset_type, action, id)');
  await ensureMysqlAssetEventIndex(db, 'idx_asset_event_source', 'INDEX idx_asset_event_source (source_type, source_id)');
  await ensureMysqlAssetEventIndex(db, 'idx_asset_event_card', 'INDEX idx_asset_event_card (card_id, id)');
  await ensureMysqlAssetEventIndex(db, 'idx_asset_event_item', 'INDEX idx_asset_event_item (item_id, id)');
  await ensureMysqlAssetEventIndex(db, 'idx_asset_event_created', 'INDEX idx_asset_event_created (created_at)');
  mysqlAssetEventTableReady = true;
};

export const recordSqliteAssetEvent = (db: any, event: AssetEventInput): void => {
  const normalized = normalizeEvent(event);
  if (!normalized.userId && !normalized.fromUserId && !normalized.toUserId) return;
  ensureSqliteAssetEventTable(db);
  db.prepare(`INSERT OR IGNORE INTO asset_event_logs ${insertColumns} VALUES ${insertValues}`)
    .run(...normalizedParams(normalized));
};

export const recordSqliteAssetEvents = (db: any, events: AssetEventInput[]): void => {
  for (const event of events) recordSqliteAssetEvent(db, event);
};

export const recordMysqlAssetEvent = async (db: any, event: AssetEventInput): Promise<void> => {
  const normalized = normalizeEvent(event);
  if (!normalized.userId && !normalized.fromUserId && !normalized.toUserId) return;
  await ensureMysqlAssetEventTable(db);
  await db.run(`INSERT IGNORE INTO asset_event_logs ${insertColumns} VALUES ${insertValues}`,
    ...normalizedParams(normalized));
};

export const recordMysqlAssetEvents = async (db: any, events: AssetEventInput[]): Promise<void> => {
  for (const event of events) await recordMysqlAssetEvent(db, event);
};

export const recordAssetEvent = async (event: AssetEventInput): Promise<void> => {
  if (getDbMode() === 'MYSQL') {
    await recordMysqlAssetEvent(getMysqlDb(), event);
    return;
  }
  if (getDbMode() === 'SUPABASE') {
    const normalized = normalizeEvent(event);
    const { error } = await getSupabaseClient().from('asset_event_logs').insert({
      event_key: normalized.eventKey,
      user_id: normalized.userId,
      counterparty_user_id: normalized.counterpartyUserId,
      from_user_id: normalized.fromUserId,
      to_user_id: normalized.toUserId,
      asset_type: normalized.assetType,
      action: normalized.action,
      amount: normalized.amount,
      quantity: normalized.quantity,
      balance_after: normalized.balanceAfter,
      source_type: normalized.sourceType,
      source_id: normalized.sourceId,
      reason: normalized.reason,
      description: normalized.description,
      card_id: normalized.cardId,
      channel_id: normalized.channelId,
      serial_number: normalized.serialNumber,
      star: normalized.star,
      item_id: normalized.itemId,
      item_type: normalized.itemType,
      metadata: parseMetadata(normalized.metadata)
    });
    if (error) throw error;
    return;
  }
  recordSqliteAssetEvent(getSqliteDb(), event);
};

const mapEventRow = (row: any): AssetEventLogEntry => ({
  id: Number(row.id),
  event_key: row.event_key ?? null,
  user_id: row.user_id ?? null,
  username: row.username ?? null,
  user_deleted_at: row.user_deleted_at ?? null,
  counterparty_user_id: row.counterparty_user_id ?? null,
  counterparty_username: row.counterparty_username ?? null,
  counterparty_deleted_at: row.counterparty_deleted_at ?? null,
  from_user_id: row.from_user_id ?? null,
  from_username: row.from_username ?? null,
  to_user_id: row.to_user_id ?? null,
  to_username: row.to_username ?? null,
  asset_type: row.asset_type || 'unknown',
  action: row.action || 'update',
  amount: row.amount == null ? null : Number(row.amount),
  quantity: row.quantity == null ? null : Number(row.quantity),
  balance_after: row.balance_after == null ? null : Number(row.balance_after),
  source_type: row.source_type || 'unknown',
  source_id: row.source_id ?? null,
  reason: row.reason || '',
  description: row.description ?? null,
  card_id: row.card_id == null ? null : Number(row.card_id),
  channel_id: row.channel_id ?? null,
  streamer_name: row.streamer_name ?? null,
  serial_number: row.serial_number == null ? null : Number(row.serial_number),
  star: row.star == null ? null : Number(row.star),
  item_id: row.item_id == null ? null : Number(row.item_id),
  item_name: row.item_name ?? null,
  item_type: row.item_type ?? row.item_type_label ?? null,
  metadata: parseMetadata(row.metadata),
  created_at: normalizeDate(row.created_at)
});

const selectEventSql = (whereSql: string) => `
  SELECT a.*,
         COALESCE(u.username, du.username_snapshot) AS username,
         du.deleted_at AS user_deleted_at,
         COALESCE(cu.username, cdu.username_snapshot) AS counterparty_username,
         cdu.deleted_at AS counterparty_deleted_at,
         COALESCE(fu.username, fdu.username_snapshot) AS from_username,
         COALESCE(tu.username, tdu.username_snapshot) AS to_username,
         s.name AS streamer_name,
         si.name AS item_name,
         si.type AS item_type_label
    FROM asset_event_logs a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN deleted_user_accounts du ON du.user_id = a.user_id
    LEFT JOIN users cu ON cu.id = a.counterparty_user_id
    LEFT JOIN deleted_user_accounts cdu ON cdu.user_id = a.counterparty_user_id
    LEFT JOIN users fu ON fu.id = a.from_user_id
    LEFT JOIN deleted_user_accounts fdu ON fdu.user_id = a.from_user_id
    LEFT JOIN users tu ON tu.id = a.to_user_id
    LEFT JOIN deleted_user_accounts tdu ON tdu.user_id = a.to_user_id
    LEFT JOIN streamers s ON s.channel_id = a.channel_id
    LEFT JOIN shop_items si ON si.id = a.item_id
    ${whereSql}
   ORDER BY a.id DESC
   LIMIT ?
`;

export const listAssetEvents = async (
  options: AssetEventListOptions = {}
): Promise<{ entries: AssetEventLogEntry[]; next_before_id: number | null }> => {
  const limit = clampLimit(options.limit);
  const beforeId = options.beforeId ? Math.max(0, Math.floor(Number(options.beforeId))) : null;
  const where: string[] = [];
  const params: any[] = [];

  if (options.userId) {
    where.push('(a.user_id = ? OR a.counterparty_user_id = ? OR a.from_user_id = ? OR a.to_user_id = ?)');
    params.push(options.userId, options.userId, options.userId, options.userId);
  }
  if (beforeId) {
    where.push('a.id < ?');
    params.push(beforeId);
  }
  if (options.assetType && options.assetType !== 'ALL') {
    where.push('a.asset_type = ?');
    params.push(options.assetType);
  }
  if (options.action && options.action !== 'ALL') {
    where.push('a.action = ?');
    params.push(options.action);
  }
  if (options.sourceType && options.sourceType !== 'ALL') {
    where.push('a.source_type = ?');
    params.push(options.sourceType);
  }
  const search = String(options.search || '').trim();
  if (search) {
    const like = `%${search}%`;
    where.push(`(
      a.user_id LIKE ? OR a.counterparty_user_id LIKE ? OR a.from_user_id LIKE ? OR a.to_user_id LIKE ?
      OR COALESCE(u.username, du.username_snapshot, '') LIKE ?
      OR COALESCE(cu.username, cdu.username_snapshot, '') LIKE ?
      OR COALESCE(fu.username, fdu.username_snapshot, '') LIKE ?
      OR COALESCE(tu.username, tdu.username_snapshot, '') LIKE ?
      OR a.source_id LIKE ? OR a.reason LIKE ? OR COALESCE(a.description, '') LIKE ?
      OR COALESCE(a.channel_id, '') LIKE ? OR COALESCE(s.name, '') LIKE ? OR COALESCE(si.name, '') LIKE ?
      OR CAST(a.card_id AS CHAR) LIKE ?
    )`);
    params.push(like, like, like, like, like, like, like, like, like, like, like, like, like, like, like);
  }

  if (getDbMode() === 'SUPABASE') {
    let query = getSupabaseClient()
      .from('asset_event_logs')
      .select('*')
      .order('id', { ascending: false })
      .limit(limit + 1);
    if (beforeId) query = query.lt('id', beforeId);
    if (options.userId) {
      const userId = String(options.userId).replace(/[,()]/g, '');
      query = query.or(`user_id.eq.${userId},counterparty_user_id.eq.${userId},from_user_id.eq.${userId},to_user_id.eq.${userId}`);
    }
    if (options.assetType && options.assetType !== 'ALL') query = query.eq('asset_type', options.assetType);
    if (options.action && options.action !== 'ALL') query = query.eq('action', options.action);
    if (options.sourceType && options.sourceType !== 'ALL') query = query.eq('source_type', options.sourceType);
    const { data, error } = await query;
    if (error) throw error;
    const rows = data || [];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    return {
      entries: pageRows.map(mapEventRow),
      next_before_id: hasMore ? Number(pageRows[pageRows.length - 1]?.id || 0) || null : null
    };
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  let rows: any[];
  if (getDbMode() === 'MYSQL') {
    const db = getMysqlDb();
    await ensureMysqlAssetEventTable(db);
    rows = await db.all(selectEventSql(whereSql), ...params, limit + 1);
  } else {
    const db = getSqliteDb();
    ensureSqliteAssetEventTable(db);
    rows = db.prepare(selectEventSql(whereSql)).all(...params, limit + 1) as any[];
  }

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  return {
    entries: pageRows.map(mapEventRow),
    next_before_id: hasMore ? Number(pageRows[pageRows.length - 1]?.id || 0) || null : null
  };
};

const sinceSqlDate = (days: number) => {
  const date = new Date(Date.now() - Math.max(1, Math.min(90, days)) * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

type AssetEventSuspectCounterpartyStats = {
  user_id: string;
  username: string | null;
  events: number;
  point_in: number;
  point_out: number;
  card_in: number;
  card_out: number;
  card_weight_in: number;
  card_weight_out: number;
  source_types: Set<string>;
  source_ids: Set<string>;
  last_event_at: string | null;
};

type AssetEventSuspectStats = {
  user_id: string;
  username: string | null;
  user_deleted_at: string | null;
  total_events: number;
  relation_events: number;
  point_income: number;
  point_expense: number;
  relation_point_income: number;
  relation_point_expense: number;
  card_moves: number;
  card_adds: number;
  card_deletes: number;
  cosmetic_events: number;
  negative_balance_events: number;
  manual_adjustment_events: number;
  manual_adjustment_amount: number;
  last_event_at: string | null;
  counterparties: Map<string, AssetEventSuspectCounterpartyStats>;
};

const relationSourceTypes = new Set(['trade', 'market_purchase', 'market_sale']);
const noisyFlowSourceTypes = new Set(['market_bid', 'market_bid_refund', 'market_listing', 'market_watch']);

const suspicionSeverityFromScore = (score: number): AssetEventSuspicionSeverity => {
  if (score >= 85) return 'critical';
  if (score >= 65) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
};

const addSuspicionCategory = (
  categories: AssetEventSuspicionCategory[],
  id: string,
  label: string,
  score: number,
  reasons: string[],
  metrics: Record<string, number | string | null>
) => {
  const normalizedScore = Math.max(0, Math.min(100, Math.round(score)));
  if (normalizedScore <= 0) return;
  categories.push({
    id,
    label,
    score: normalizedScore,
    severity: suspicionSeverityFromScore(normalizedScore),
    reasons,
    metrics
  });
};

const cardSuspicionWeight = (row: any) => {
  const star = Math.max(0, Math.min(5, Number(row.star || 0)));
  return Math.max(1, Number(row.quantity || 1)) * (star + 1) * (star + 1);
};

const getRowUserName = (row: any, userId: string): string | null => {
  if (row.user_id === userId) return row.user_username ?? null;
  if (row.from_user_id === userId) return row.from_username ?? null;
  if (row.to_user_id === userId) return row.to_username ?? null;
  if (row.counterparty_user_id === userId) return row.counterparty_username ?? null;
  return null;
};

const getRowDeletedAt = (row: any, userId: string): string | null => {
  if (row.user_id === userId) return normalizeDate(row.user_deleted_at) || null;
  if (row.from_user_id === userId) return normalizeDate(row.from_deleted_at) || null;
  if (row.to_user_id === userId) return normalizeDate(row.to_deleted_at) || null;
  if (row.counterparty_user_id === userId) return normalizeDate(row.counterparty_deleted_at) || null;
  return null;
};

const getOtherAssetEventUser = (row: any, userId: string): { id: string; username: string | null } | null => {
  if (row.from_user_id === userId && row.to_user_id && row.to_user_id !== userId) {
    return { id: row.to_user_id, username: row.to_username ?? null };
  }
  if (row.to_user_id === userId && row.from_user_id && row.from_user_id !== userId) {
    return { id: row.from_user_id, username: row.from_username ?? null };
  }
  if (row.counterparty_user_id && row.counterparty_user_id !== userId) {
    return { id: row.counterparty_user_id, username: row.counterparty_username ?? null };
  }
  if (row.user_id && row.user_id !== userId) {
    return { id: row.user_id, username: row.user_username ?? null };
  }
  return null;
};

const getOrCreateSuspectStats = (grouped: Map<string, AssetEventSuspectStats>, userId: string, row: any): AssetEventSuspectStats => {
  const current = grouped.get(userId);
  if (current) {
    current.username = current.username || getRowUserName(row, userId);
    current.user_deleted_at = current.user_deleted_at || getRowDeletedAt(row, userId);
    return current;
  }
  const created: AssetEventSuspectStats = {
    user_id: userId,
    username: getRowUserName(row, userId),
    user_deleted_at: getRowDeletedAt(row, userId),
    total_events: 0,
    relation_events: 0,
    point_income: 0,
    point_expense: 0,
    relation_point_income: 0,
    relation_point_expense: 0,
    card_moves: 0,
    card_adds: 0,
    card_deletes: 0,
    cosmetic_events: 0,
    negative_balance_events: 0,
    manual_adjustment_events: 0,
    manual_adjustment_amount: 0,
    last_event_at: null,
    counterparties: new Map()
  };
  grouped.set(userId, created);
  return created;
};

const getOrCreateCounterpartyStats = (
  stats: AssetEventSuspectStats,
  other: { id: string; username: string | null }
): AssetEventSuspectCounterpartyStats => {
  const current = stats.counterparties.get(other.id);
  if (current) {
    current.username = current.username || other.username;
    return current;
  }
  const created: AssetEventSuspectCounterpartyStats = {
    user_id: other.id,
    username: other.username,
    events: 0,
    point_in: 0,
    point_out: 0,
    card_in: 0,
    card_out: 0,
    card_weight_in: 0,
    card_weight_out: 0,
    source_types: new Set(),
    source_ids: new Set(),
    last_event_at: null
  };
  stats.counterparties.set(other.id, created);
  return created;
};

const collectAssetEventSuspectStats = (rows: any[]) => {
  const grouped = new Map<string, AssetEventSuspectStats>();

  for (const row of rows) {
    const involved = new Set<string>();
    if (row.user_id) involved.add(String(row.user_id));
    if (row.from_user_id) involved.add(String(row.from_user_id));
    if (row.to_user_id) involved.add(String(row.to_user_id));

    for (const userId of involved) {
      const stats = getOrCreateSuspectStats(grouped, userId, row);
      stats.total_events += 1;
      const createdAt = normalizeDate(row.created_at) || null;
      if (createdAt && (!stats.last_event_at || createdAt > stats.last_event_at)) stats.last_event_at = createdAt;

      const amount = Number(row.amount || 0);
      if (row.asset_type === 'point' && row.user_id === userId) {
        if (amount > 0) stats.point_income += amount;
        if (amount < 0) stats.point_expense += Math.abs(amount);
        if (Number(row.balance_after || 0) < 0) stats.negative_balance_events += 1;
      }
      if (row.asset_type === 'card') {
        if (row.action === 'move' && (row.from_user_id === userId || row.to_user_id === userId || row.user_id === userId)) stats.card_moves += 1;
        if (row.action === 'add' && row.user_id === userId) stats.card_adds += 1;
        if (row.action === 'delete' && row.user_id === userId) stats.card_deletes += 1;
      }
      if (row.asset_type === 'cosmetic' && row.user_id === userId) stats.cosmetic_events += 1;
      if ((row.source_type === 'manual_adjustment' || row.source_type === 'admin_reset') && row.user_id === userId) {
        stats.manual_adjustment_events += 1;
        stats.manual_adjustment_amount += Math.abs(amount);
      }

      const other = getOtherAssetEventUser(row, userId);
      if (!other || noisyFlowSourceTypes.has(String(row.source_type || ''))) continue;

      const isRelationSource = relationSourceTypes.has(String(row.source_type || '')) || row.from_user_id || row.to_user_id;
      if (!isRelationSource) continue;

      const counterparty = getOrCreateCounterpartyStats(stats, other);
      counterparty.events += 1;
      counterparty.source_types.add(String(row.source_type || 'unknown'));
      if (row.source_id != null) counterparty.source_ids.add(String(row.source_id));
      if (createdAt && (!counterparty.last_event_at || createdAt > counterparty.last_event_at)) counterparty.last_event_at = createdAt;
      stats.relation_events += 1;

      if (row.asset_type === 'point' && row.user_id === userId) {
        if (amount > 0) {
          counterparty.point_in += amount;
          stats.relation_point_income += amount;
        }
        if (amount < 0) {
          counterparty.point_out += Math.abs(amount);
          stats.relation_point_expense += Math.abs(amount);
        }
      }
      if (row.asset_type === 'card' && row.action === 'move') {
        const weight = cardSuspicionWeight(row);
        if (row.to_user_id === userId) {
          counterparty.card_in += 1;
          counterparty.card_weight_in += weight;
        }
        if (row.from_user_id === userId || row.user_id === userId) {
          counterparty.card_out += 1;
          counterparty.card_weight_out += weight;
        }
      }
    }
  }

  return grouped;
};

const buildEnhancedSuspect = (stats: AssetEventSuspectStats): AssetEventSuspect => {
  const counterparties = [...stats.counterparties.values()].map((counterparty) => {
    const pointMoved = counterparty.point_in + counterparty.point_out;
    const cardMoved = counterparty.card_in + counterparty.card_out;
    const pointNetRatio = pointMoved > 0 ? Math.abs(counterparty.point_in - counterparty.point_out) / pointMoved : 0;
    const cardNetRatio = cardMoved > 0 ? Math.abs(counterparty.card_in - counterparty.card_out) / cardMoved : 0;
    const score = Math.round(
      counterparty.events * 3
      + Math.min(35, pointMoved / 50000)
      + Math.min(25, cardMoved * 4)
      + Math.max(pointNetRatio, cardNetRatio) * 20
    );
    return {
      user_id: counterparty.user_id,
      username: counterparty.username,
      events: counterparty.events,
      point_in: Math.round(counterparty.point_in),
      point_out: Math.round(counterparty.point_out),
      card_in: counterparty.card_in,
      card_out: counterparty.card_out,
      score,
      last_event_at: counterparty.last_event_at
    };
  }).sort((a, b) => b.score - a.score).slice(0, 5);

  const categories: AssetEventSuspicionCategory[] = [];
  const topCounterparty = counterparties[0] || null;
  const relationEvents = Math.max(0, stats.relation_events);
  const topEventShare = topCounterparty && relationEvents > 0 ? topCounterparty.events / relationEvents : 0;
  const pointThroughput = stats.relation_point_income + stats.relation_point_expense;
  const pointNet = stats.relation_point_income - stats.relation_point_expense;
  const pointNetRatio = pointThroughput > 0 ? Math.abs(pointNet) / pointThroughput : 0;

  if (topCounterparty && relationEvents >= 4 && topEventShare >= 0.45) {
    const score = Math.min(80, 20 + topEventShare * 45 + Math.min(15, topCounterparty.events * 2));
    addSuspicionCategory(categories, 'counterparty_concentration', '특정 상대 집중', score, [
      `${topCounterparty.username || topCounterparty.user_id} 계정과의 자산 이동이 전체 관계 이벤트의 ${Math.round(topEventShare * 100)}%입니다.`
    ], {
      top_counterparty: topCounterparty.username || topCounterparty.user_id,
      relation_events: relationEvents,
      top_counterparty_events: topCounterparty.events,
      share_percent: Math.round(topEventShare * 100)
    });
  }

  if (topCounterparty) {
    const topPointMoved = topCounterparty.point_in + topCounterparty.point_out;
    const topPointRatio = topPointMoved > 0 ? Math.abs(topCounterparty.point_in - topCounterparty.point_out) / topPointMoved : 0;
    const topCardMoved = topCounterparty.card_in + topCounterparty.card_out;
    const topCardRatio = topCardMoved > 0 ? Math.abs(topCounterparty.card_in - topCounterparty.card_out) / topCardMoved : 0;
    const oneWayPointScore = topCounterparty.events >= 3 && topPointMoved >= 100000 && topPointRatio >= 0.8
      ? 35 + Math.min(25, topPointMoved / 80000) + topPointRatio * 25
      : 0;
    const oneWayCardScore = topCounterparty.events >= 3 && topCardMoved >= 3 && topCardRatio >= 0.75
      ? 32 + Math.min(22, topCardMoved * 4) + topCardRatio * 25
      : 0;
    const score = Math.min(100, Math.max(oneWayPointScore, oneWayCardScore));
    if (score >= 30) {
      const direction = topCounterparty.point_in > topCounterparty.point_out || topCounterparty.card_in > topCounterparty.card_out ? '유입' : '유출';
      addSuspicionCategory(categories, 'one_way_counterparty_flow', '일방향 가치 이동', score, [
        `${topCounterparty.username || topCounterparty.user_id} 계정과 ${direction} 방향으로 치우친 거래가 반복됩니다.`
      ], {
        counterparty: topCounterparty.username || topCounterparty.user_id,
        point_in: topCounterparty.point_in,
        point_out: topCounterparty.point_out,
        card_in: topCounterparty.card_in,
        card_out: topCounterparty.card_out,
        point_one_way_percent: Math.round(topPointRatio * 100),
        card_one_way_percent: Math.round(topCardRatio * 100)
      });
    }
  }

  if (relationEvents >= 5 && pointThroughput >= 200000 && pointNetRatio >= 0.75) {
    const concentrationBoost = topEventShare >= 0.45 ? 18 : 0;
    const score = Math.min(78, 24 + pointNetRatio * 32 + Math.min(18, pointThroughput / 100000) + concentrationBoost);
    addSuspicionCategory(categories, 'trade_value_imbalance', '거래 가치 불균형', score, [
      `관계 거래 포인트 흐름이 한쪽으로 ${Math.round(pointNetRatio * 100)}% 치우쳐 있습니다.`
    ], {
      point_income: Math.round(stats.relation_point_income),
      point_expense: Math.round(stats.relation_point_expense),
      point_net: pointNet,
      relation_events: relationEvents,
      net_ratio_percent: Math.round(pointNetRatio * 100)
    });
  }

  if (stats.negative_balance_events > 0) {
    addSuspicionCategory(categories, 'negative_balance', '잔액 무결성 이상', Math.min(100, 75 + stats.negative_balance_events * 8), [
      `포인트 잔액이 음수로 기록된 이벤트가 ${stats.negative_balance_events}건 있습니다.`
    ], {
      negative_balance_events: stats.negative_balance_events
    });
  }

  if (stats.manual_adjustment_events >= 2 || stats.manual_adjustment_amount >= 500000) {
    addSuspicionCategory(categories, 'manual_adjustment', '관리자 조정 집중', Math.min(70, 20 + stats.manual_adjustment_events * 8 + stats.manual_adjustment_amount / 100000), [
      '관리자 수동 조정 또는 초기화 이벤트가 짧은 기간에 집중되었습니다.'
    ], {
      manual_adjustment_events: stats.manual_adjustment_events,
      manual_adjustment_amount: Math.round(stats.manual_adjustment_amount)
    });
  }

  if (stats.total_events >= 180 || stats.card_moves >= 50 || stats.cosmetic_events >= 80) {
    addSuspicionCategory(categories, 'activity_spike', '활동량 급증', Math.min(24, 8 + stats.total_events / 30 + stats.card_moves / 10), [
      '단순 활동량 신호입니다. 이 항목만으로는 높은 의심도로 보지 않습니다.'
    ], {
      total_events: stats.total_events,
      card_moves: stats.card_moves,
      cosmetic_events: stats.cosmetic_events
    });
  }

  if (stats.card_deletes >= 30) {
    addSuspicionCategory(categories, 'asset_disposal', '카드 처분 집중', Math.min(35, 10 + stats.card_deletes / 2), [
      '카드 삭제가 많습니다. 보상/정리 목적일 수 있으므로 다른 신호와 함께 확인해야 합니다.'
    ], {
      card_deletes: stats.card_deletes
    });
  }

  categories.sort((a, b) => b.score - a.score);
  const strongest = categories[0]?.score || 0;
  const supporting = categories.slice(1).reduce((sum, item) => sum + Math.min(18, Math.round(item.score * 0.28)), 0);
  const relationBonus = categories.some((item) => item.id === 'one_way_counterparty_flow') && categories.some((item) => item.id === 'counterparty_concentration') ? 10 : 0;
  const riskScore = Math.min(100, strongest + supporting + relationBonus);
  const reasons = categories.flatMap((category) => category.reasons).slice(0, 5);

  return {
    user_id: stats.user_id,
    username: stats.username,
    user_deleted_at: stats.user_deleted_at,
    severity: suspicionSeverityFromScore(riskScore),
    risk_score: riskScore,
    reasons,
    categories,
    counterparties,
    total_events: stats.total_events,
    relation_events: stats.relation_events,
    point_income: Math.round(stats.point_income),
    point_expense: Math.round(stats.point_expense),
    point_net: Math.round(pointNet),
    card_moves: stats.card_moves,
    card_adds: stats.card_adds,
    card_deletes: stats.card_deletes,
    cosmetic_events: stats.cosmetic_events,
    negative_balance_events: stats.negative_balance_events,
    manual_adjustment_events: stats.manual_adjustment_events,
    last_event_at: stats.last_event_at
  };
};

const assetSuspectMatchesSearch = (item: AssetEventSuspect, search: string) => {
  const keyword = search.trim().toLowerCase();
  if (!keyword) return true;
  return String(item.user_id || '').toLowerCase().includes(keyword)
    || String(item.username || '').toLowerCase().includes(keyword);
};

const selectAssetEventSuspectRowsSql = (searchSql: string) => `
    SELECT a.id,
           a.user_id,
           COALESCE(u.username, du.username_snapshot) AS user_username,
           du.deleted_at AS user_deleted_at,
           a.counterparty_user_id,
           COALESCE(cu.username, cdu.username_snapshot) AS counterparty_username,
           cdu.deleted_at AS counterparty_deleted_at,
           a.from_user_id,
           COALESCE(fu.username, fdu.username_snapshot) AS from_username,
           fdu.deleted_at AS from_deleted_at,
           a.to_user_id,
           COALESCE(tu.username, tdu.username_snapshot) AS to_username,
           tdu.deleted_at AS to_deleted_at,
           a.asset_type,
           a.action,
           a.amount,
           a.quantity,
           a.balance_after,
           a.source_type,
           a.source_id,
           a.reason,
           a.card_id,
           a.channel_id,
           a.serial_number,
           a.star,
           a.item_id,
           a.created_at
      FROM asset_event_logs a
      LEFT JOIN users u ON u.id = a.user_id
      LEFT JOIN deleted_user_accounts du ON du.user_id = a.user_id
      LEFT JOIN users cu ON cu.id = a.counterparty_user_id
      LEFT JOIN deleted_user_accounts cdu ON cdu.user_id = a.counterparty_user_id
      LEFT JOIN users fu ON fu.id = a.from_user_id
      LEFT JOIN deleted_user_accounts fdu ON fdu.user_id = a.from_user_id
      LEFT JOIN users tu ON tu.id = a.to_user_id
      LEFT JOIN deleted_user_accounts tdu ON tdu.user_id = a.to_user_id
     WHERE a.created_at >= ?
       ${searchSql}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT ?
`;

export const listAssetEventSuspects = async (
  options: { days?: number; limit?: number; search?: string | null } = {}
): Promise<{ items: AssetEventSuspect[]; days: number }> => {
  const days = Math.max(1, Math.min(90, Math.floor(Number(options.days || 7))));
  const limit = clampLimit(options.limit, 50, 100);
  const since = sinceSqlDate(days);
  const search = String(options.search || '').trim();
  const scanLimit = search ? 8000 : Math.max(6000, Math.min(25000, limit * 500));

  if (getDbMode() === 'SUPABASE') {
    const { data, error } = await getSupabaseClient()
      .from('asset_event_logs')
      .select('*')
      .gte('created_at', since)
      .order('id', { ascending: false })
      .limit(scanLimit);
    if (error) throw error;
    const rows = search
      ? (data || []).filter((event: any) => [event.user_id, event.counterparty_user_id, event.from_user_id, event.to_user_id, event.source_id, event.reason, event.description].some((value) => String(value || '').toLowerCase().includes(search.toLowerCase())))
      : (data || []);
    const items = [...collectAssetEventSuspectStats(rows).values()]
      .map(buildEnhancedSuspect)
      .filter((item) => search ? (item.total_events > 0 && assetSuspectMatchesSearch(item, search)) : item.risk_score >= 30)
      .sort((a, b) => b.risk_score - a.risk_score || b.relation_events - a.relation_events)
      .slice(0, limit);
    return { days, items };
  }

  const params: any[] = [since];
  let searchSql = '';
  if (search) {
    const like = `%${search}%`;
    searchSql = `
       AND (
         a.user_id LIKE ? OR a.counterparty_user_id LIKE ? OR a.from_user_id LIKE ? OR a.to_user_id LIKE ?
         OR COALESCE(u.username, du.username_snapshot, '') LIKE ?
         OR COALESCE(cu.username, cdu.username_snapshot, '') LIKE ?
         OR COALESCE(fu.username, fdu.username_snapshot, '') LIKE ?
         OR COALESCE(tu.username, tdu.username_snapshot, '') LIKE ?
       )`;
    params.push(like, like, like, like, like, like, like, like);
  }
  params.push(scanLimit);

  let rows: any[];
  if (getDbMode() === 'MYSQL') {
    const db = getMysqlDb();
    await ensureMysqlAssetEventTable(db);
    rows = await db.all(selectAssetEventSuspectRowsSql(searchSql), ...params);
  } else {
    const db = getSqliteDb();
    ensureSqliteAssetEventTable(db);
    rows = db.prepare(selectAssetEventSuspectRowsSql(searchSql)).all(...params) as any[];
  }

  const items = [...collectAssetEventSuspectStats(rows).values()]
    .map(buildEnhancedSuspect)
    .filter((item) => search ? (item.total_events > 0 && assetSuspectMatchesSearch(item, search)) : item.risk_score >= 30)
    .sort((a, b) => b.risk_score - a.risk_score || b.relation_events - a.relation_events || b.total_events - a.total_events)
    .slice(0, limit);
  return { days, items };
};
