import { getDbMode, getMysqlDb, getSqliteDb, getSupabaseClient } from './db';

export type PointLedgerSourceType =
  | 'gacha_draw'
  | 'card_sell'
  | 'coupon'
  | 'minigame'
  | 'shop_purchase'
  | 'market_purchase'
  | 'market_sale'
  | 'market_bid'
  | 'market_bid_refund'
  | 'trade'
  | 'admin_reset'
  | 'manual_adjustment'
  | 'unknown';

export type PointLedgerEntryInput = {
  userId: string;
  amount: number;
  balanceAfter?: number | null;
  counterpartyUserId?: string | null;
  sourceType: PointLedgerSourceType;
  sourceId?: string | number | null;
  reason: string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type PointLedgerEntry = {
  id: number;
  user_id: string;
  username?: string | null;
  user_deleted_at?: string | null;
  counterparty_user_id: string | null;
  counterparty_username?: string | null;
  counterparty_deleted_at?: string | null;
  amount: number;
  balance_after: number | null;
  source_type: PointLedgerSourceType;
  source_id: string | null;
  reason: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const normalizeEntry = (entry: PointLedgerEntryInput) => ({
  userId: entry.userId,
  counterpartyUserId: entry.counterpartyUserId || null,
  amount: Math.trunc(Number(entry.amount || 0)),
  balanceAfter: entry.balanceAfter == null ? null : Math.trunc(Number(entry.balanceAfter)),
  sourceType: entry.sourceType || 'unknown',
  sourceId: entry.sourceId == null ? null : String(entry.sourceId),
  reason: String(entry.reason || entry.sourceType || 'unknown').slice(0, 120),
  description: entry.description ? String(entry.description).slice(0, 500) : null,
  metadata: JSON.stringify(entry.metadata || {})
});

export const recordSqlitePointLedger = (db: any, entry: PointLedgerEntryInput): void => {
  const normalized = normalizeEntry(entry);
  if (!normalized.userId || normalized.amount === 0) return;
  const balanceAfter = normalized.balanceAfter ?? (db.prepare('SELECT point FROM users WHERE id = ?').get(normalized.userId) as any)?.point ?? null;
  db.prepare(`
    INSERT INTO point_ledger_entries
      (user_id, counterparty_user_id, amount, balance_after, source_type, source_id, reason, description, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    normalized.userId,
    normalized.counterpartyUserId,
    normalized.amount,
    balanceAfter,
    normalized.sourceType,
    normalized.sourceId,
    normalized.reason,
    normalized.description,
    normalized.metadata
  );
};

export const recordMysqlPointLedger = async (db: any, entry: PointLedgerEntryInput): Promise<void> => {
  const normalized = normalizeEntry(entry);
  if (!normalized.userId || normalized.amount === 0) return;
  const balanceAfter = normalized.balanceAfter ?? (await db.get('SELECT point FROM users WHERE id = ?', normalized.userId))?.point ?? null;
  await db.run(`
    INSERT INTO point_ledger_entries
      (user_id, counterparty_user_id, amount, balance_after, source_type, source_id, reason, description, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    normalized.userId,
    normalized.counterpartyUserId,
    normalized.amount,
    balanceAfter,
    normalized.sourceType,
    normalized.sourceId,
    normalized.reason,
    normalized.description,
    normalized.metadata
  );
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

const mapLedgerRow = (row: any): PointLedgerEntry => ({
  id: Number(row.id),
  user_id: row.user_id,
  username: row.username ?? null,
  user_deleted_at: row.user_deleted_at ?? null,
  counterparty_user_id: row.counterparty_user_id ?? null,
  counterparty_username: row.counterparty_username ?? null,
  counterparty_deleted_at: row.counterparty_deleted_at ?? null,
  amount: Number(row.amount || 0),
  balance_after: row.balance_after == null ? null : Number(row.balance_after),
  source_type: row.source_type || 'unknown',
  source_id: row.source_id ?? null,
  reason: row.reason || '',
  description: row.description ?? null,
  metadata: parseMetadata(row.metadata),
  created_at: row.created_at
});

export const listPointLedgerForUser = async (
  userId: string,
  options: { limit?: number; beforeId?: number | null } = {}
): Promise<{ entries: PointLedgerEntry[]; next_before_id: number | null }> => {
  const limit = Math.max(1, Math.min(200, Math.floor(Number(options.limit || 80))));
  const beforeId = options.beforeId ? Math.max(0, Math.floor(Number(options.beforeId))) : null;
  const where = beforeId ? 'WHERE ple.user_id = ? AND ple.id < ?' : 'WHERE ple.user_id = ?';
  const params = beforeId ? [userId, beforeId, limit + 1] : [userId, limit + 1];
  const sql = `
    SELECT ple.*,
           COALESCE(u.username, du.username_snapshot) AS username,
           du.deleted_at AS user_deleted_at,
           COALESCE(cu.username, cdu.username_snapshot) AS counterparty_username,
           cdu.deleted_at AS counterparty_deleted_at
      FROM point_ledger_entries ple
      LEFT JOIN users u ON u.id = ple.user_id
      LEFT JOIN deleted_user_accounts du ON du.user_id = ple.user_id
      LEFT JOIN users cu ON cu.id = ple.counterparty_user_id
      LEFT JOIN deleted_user_accounts cdu ON cdu.user_id = ple.counterparty_user_id
      ${where}
     ORDER BY ple.id DESC
     LIMIT ?
  `;

  let rows: any[] = [];
  if (getDbMode() === 'MYSQL') {
    rows = await getMysqlDb().all(sql, params);
  } else if (getDbMode() === 'SUPABASE') {
    let query = getSupabaseClient()
      .from('point_ledger_entries')
      .select('*')
      .eq('user_id', userId)
      .order('id', { ascending: false })
      .limit(limit + 1);
    if (beforeId) query = query.lt('id', beforeId);
    const { data, error } = await query;
    if (error) throw error;
    rows = data || [];
  } else {
    rows = getSqliteDb().prepare(sql).all(...params) as any[];
  }

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  return {
    entries: pageRows.map(mapLedgerRow),
    next_before_id: hasMore ? Number(pageRows[pageRows.length - 1]?.id || 0) || null : null
  };
};
