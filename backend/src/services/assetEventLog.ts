import { getDbMode, getMysqlDb, getSqliteDb, getSupabaseClient } from './db';

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

export type AssetEventSuspect = {
  user_id: string;
  username: string | null;
  user_deleted_at: string | null;
  severity: 'high' | 'medium' | 'low';
  reasons: string[];
  total_events: number;
  point_income: number;
  point_expense: number;
  card_moves: number;
  card_adds: number;
  card_deletes: number;
  cosmetic_events: number;
  negative_balance_events: number;
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
  const rows = getDbMode() === 'MYSQL'
    ? await getMysqlDb().all(selectEventSql(whereSql), ...params, limit + 1)
    : getSqliteDb().prepare(selectEventSql(whereSql)).all(...params, limit + 1) as any[];

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

const buildSuspect = (row: any): AssetEventSuspect => {
  const totalEvents = Number(row.total_events || 0);
  const pointIncome = Number(row.point_income || 0);
  const pointExpense = Math.abs(Number(row.point_expense || 0));
  const cardMoves = Number(row.card_moves || 0);
  const cardAdds = Number(row.card_adds || 0);
  const cardDeletes = Number(row.card_deletes || 0);
  const cosmeticEvents = Number(row.cosmetic_events || 0);
  const negativeBalanceEvents = Number(row.negative_balance_events || 0);
  const reasons: string[] = [];

  if (negativeBalanceEvents > 0) reasons.push('포인트 잔액 음수 기록');
  if (pointIncome >= 1_000_000) reasons.push('단기간 대량 포인트 유입');
  if (cardMoves >= 20) reasons.push('카드 이동 과다');
  if (cardAdds >= 80) reasons.push('카드 획득 이벤트 과다');
  if (cardDeletes >= 40) reasons.push('카드 삭제 이벤트 과다');
  if (cosmeticEvents >= 50) reasons.push('코스메틱 장착/이동 과다');
  if (totalEvents >= 120) reasons.push('전체 자산 이벤트 급증');

  const severity: AssetEventSuspect['severity'] = negativeBalanceEvents > 0 || pointIncome >= 5_000_000
    ? 'high'
    : (pointIncome >= 1_000_000 || cardMoves >= 40 || totalEvents >= 200 ? 'medium' : 'low');

  return {
    user_id: row.user_id,
    username: row.username ?? null,
    user_deleted_at: row.user_deleted_at ?? null,
    severity,
    reasons,
    total_events: totalEvents,
    point_income: pointIncome,
    point_expense: pointExpense,
    card_moves: cardMoves,
    card_adds: cardAdds,
    card_deletes: cardDeletes,
    cosmetic_events: cosmeticEvents,
    negative_balance_events: negativeBalanceEvents,
    last_event_at: normalizeDate(row.last_event_at) || null
  };
};

export const listAssetEventSuspects = async (
  options: { days?: number; limit?: number } = {}
): Promise<{ items: AssetEventSuspect[]; days: number }> => {
  const days = Math.max(1, Math.min(90, Math.floor(Number(options.days || 7))));
  const limit = clampLimit(options.limit, 50, 100);
  const since = sinceSqlDate(days);

  if (getDbMode() === 'SUPABASE') {
    const { data, error } = await getSupabaseClient()
      .from('asset_event_logs')
      .select('*')
      .gte('created_at', since)
      .order('id', { ascending: false })
      .limit(2000);
    if (error) throw error;
    const grouped = new Map<string, any>();
    for (const event of data || []) {
      const userId = event.user_id || event.to_user_id || event.from_user_id || event.counterparty_user_id;
      if (!userId) continue;
      const current = grouped.get(userId) || { user_id: userId };
      current.total_events = Number(current.total_events || 0) + 1;
      current.point_income = Number(current.point_income || 0) + (event.asset_type === 'point' && Number(event.amount || 0) > 0 ? Number(event.amount || 0) : 0);
      current.point_expense = Number(current.point_expense || 0) + (event.asset_type === 'point' && Number(event.amount || 0) < 0 ? Number(event.amount || 0) : 0);
      current.card_moves = Number(current.card_moves || 0) + (event.asset_type === 'card' && event.action === 'move' ? 1 : 0);
      current.card_adds = Number(current.card_adds || 0) + (event.asset_type === 'card' && event.action === 'add' ? 1 : 0);
      current.card_deletes = Number(current.card_deletes || 0) + (event.asset_type === 'card' && event.action === 'delete' ? 1 : 0);
      current.cosmetic_events = Number(current.cosmetic_events || 0) + (event.asset_type === 'cosmetic' ? 1 : 0);
      current.negative_balance_events = Number(current.negative_balance_events || 0) + (event.asset_type === 'point' && Number(event.balance_after || 0) < 0 ? 1 : 0);
      current.last_event_at = current.last_event_at || event.created_at;
      grouped.set(userId, current);
    }
    return {
      days,
      items: [...grouped.values()].map(buildSuspect).filter((item) => item.reasons.length > 0).slice(0, limit)
    };
  }

  const sql = `
    SELECT e.user_id,
           COALESCE(u.username, du.username_snapshot) AS username,
           du.deleted_at AS user_deleted_at,
           e.total_events,
           e.point_income,
           e.point_expense,
           e.card_moves,
           e.card_adds,
           e.card_deletes,
           e.cosmetic_events,
           e.negative_balance_events,
           e.last_event_at
      FROM (
        SELECT COALESCE(user_id, to_user_id, from_user_id, counterparty_user_id) AS user_id,
               COUNT(*) AS total_events,
               SUM(CASE WHEN asset_type = 'point' AND amount > 0 THEN amount ELSE 0 END) AS point_income,
               SUM(CASE WHEN asset_type = 'point' AND amount < 0 THEN amount ELSE 0 END) AS point_expense,
               SUM(CASE WHEN asset_type = 'card' AND action = 'move' THEN 1 ELSE 0 END) AS card_moves,
               SUM(CASE WHEN asset_type = 'card' AND action = 'add' THEN 1 ELSE 0 END) AS card_adds,
               SUM(CASE WHEN asset_type = 'card' AND action = 'delete' THEN 1 ELSE 0 END) AS card_deletes,
               SUM(CASE WHEN asset_type = 'cosmetic' THEN 1 ELSE 0 END) AS cosmetic_events,
               SUM(CASE WHEN asset_type = 'point' AND balance_after < 0 THEN 1 ELSE 0 END) AS negative_balance_events,
               MAX(created_at) AS last_event_at
          FROM asset_event_logs
         WHERE created_at >= ?
         GROUP BY COALESCE(user_id, to_user_id, from_user_id, counterparty_user_id)
      ) e
      LEFT JOIN users u ON u.id = e.user_id
      LEFT JOIN deleted_user_accounts du ON du.user_id = e.user_id
     WHERE e.user_id IS NOT NULL
       AND (
         e.negative_balance_events > 0
         OR e.point_income >= 1000000
         OR e.card_moves >= 20
         OR e.card_adds >= 80
         OR e.card_deletes >= 40
         OR e.cosmetic_events >= 50
         OR e.total_events >= 120
       )
     ORDER BY e.negative_balance_events DESC, e.point_income DESC, e.total_events DESC
     LIMIT ?
  `;
  const rows = getDbMode() === 'MYSQL'
    ? await getMysqlDb().all(sql, since, limit)
    : getSqliteDb().prepare(sql).all(since, limit) as any[];
  return { days, items: rows.map(buildSuspect) };
};
