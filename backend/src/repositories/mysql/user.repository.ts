import { getMysqlDb, getSqlDialect } from '../../services/db';
import { MysqlTx } from '../../services/mysqlDb';
import { fuzzyScore, isExactSearchMatch } from '../../utils/search';
import { recordMysqlPointLedger } from '../../services/pointLedger';
import { DeletedUserAccount, IUserRepository, User, UserRanking } from '../interfaces';
import { parseMysqlDateTimeMs, toMysqlDateTime } from './dateUtils';

const mysqlDateValueSql = (column: string) => `
  CASE
    WHEN ${column} LIKE '%T%Z' THEN STR_TO_DATE(SUBSTRING_INDEX(REPLACE(${column}, 'T', ' '), '.', 1), '%Y-%m-%d %H:%i:%s')
    ELSE ${column}
  END
`;

export class MysqlUserRepository implements IUserRepository {
  private static readonly SEARCH_POOL_CACHE_TTL_MS = Math.max(1_000, Number(process.env.USER_SEARCH_POOL_CACHE_TTL_MS || 30_000));
  private searchPoolCache: { rows: any[]; expiresAt: number } | null = null;
  private searchPoolInFlight: Promise<any[]> | null = null;

  private getDb() {
    return getMysqlDb();
  }

  private async loadSearchPool(): Promise<any[]> {
    if (this.searchPoolCache && this.searchPoolCache.expiresAt > Date.now()) return this.searchPoolCache.rows;
    if (this.searchPoolInFlight) return this.searchPoolInFlight;
    this.searchPoolInFlight = this.getDb().all(
      'SELECT id, username, avatar_url, role, point, last_free_draw, free_draw_tickets, bonus_free_draw_tickets, banned_until, ban_reason, representative_card_channel_id, representative_card_star, status_message, token_expires_at, last_seen_at, created_at FROM users'
    )
      .then((rows) => {
        this.searchPoolCache = { rows, expiresAt: Date.now() + MysqlUserRepository.SEARCH_POOL_CACHE_TTL_MS };
        return rows;
      })
      .finally(() => {
        this.searchPoolInFlight = null;
      });
    return this.searchPoolInFlight;
  }

  private mapUser(row: any): User {
    return {
      id: row.id,
      username: row.username,
      avatar_url: row.avatar_url,
      role: row.role as 'USER' | 'ADMIN',
      point: Number(row.point || 0),
      last_free_draw: row.last_free_draw,
      free_draw_tickets: row.free_draw_tickets ?? 0,
      bonus_free_draw_tickets: row.bonus_free_draw_tickets ?? 0,
      banned_until: row.banned_until,
      ban_reason: row.ban_reason ?? null,
      representative_card_channel_id: row.representative_card_channel_id ?? null,
      representative_card_star: row.representative_card_star ?? null,
      status_message: row.status_message ?? null,
      access_token: row.access_token,
      refresh_token: row.refresh_token,
      token_expires_at: row.token_expires_at ?? null,
      last_seen_at: row.last_seen_at ?? null,
      created_at: row.created_at,
      is_deleted: row.is_deleted === 1 || row.is_deleted === true,
      deleted_at: row.deleted_at ?? null,
      identity_source: row.identity_source ?? (row.is_deleted ? 'deleted_snapshot' : 'current')
    };
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.getDb().get('SELECT * FROM users WHERE id = ?', id);
    return row ? this.mapUser(row) : null;
  }

  async findByIds(ids: string[]): Promise<User[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = await this.getDb().all(`SELECT * FROM users WHERE id IN (${placeholders})`, ids);
    return rows.map((row) => this.mapUser(row));
  }

  async findByUsername(username: string): Promise<User | null> {
    const row = await this.getDb().get('SELECT * FROM users WHERE username = ? ORDER BY created_at ASC LIMIT 1', username);
    return row ? this.mapUser(row) : null;
  }

  async searchByUsername(keyword: string, limit: number): Promise<User[]> {
    const kw = (keyword || '').trim();
    if (!kw) return [];
    if (getSqlDialect() === 'postgres') {
      const rows = await this.getDb().all(
        `SELECT * FROM users
          WHERE username ILIKE ?
          ORDER BY CASE WHEN lower(username) = lower(?) THEN 0 ELSE 1 END,
                   username ASC,
                   created_at ASC
          LIMIT ?`,
        `%${kw}%`,
        kw,
        Math.max(limit * 5, 50)
      );
      const ranked = rows
        .map((r) => ({ r, score: fuzzyScore(r.username || '', kw) }))
        .filter((x): x is { r: any; score: number } => x.score !== null)
        .sort((a, b) => a.score - b.score || String(a.r.username).localeCompare(String(b.r.username)))
        .slice(0, limit)
        .map((x) => this.mapUser(x.r));
      if (ranked.length > 0) return ranked;
      return (await this.loadSearchPool())
        .map((r) => ({ r, score: fuzzyScore(r.username || '', kw) }))
        .filter((x): x is { r: any; score: number } => x.score !== null)
        .sort((a, b) => a.score - b.score || String(a.r.username).localeCompare(String(b.r.username)))
        .slice(0, limit)
        .map((x) => this.mapUser(x.r));
    }
    const exactRows = await this.getDb().all('SELECT * FROM users WHERE username = ? ORDER BY created_at ASC LIMIT ?', kw, limit);
    if (exactRows.length > 0) return exactRows.map((r) => this.mapUser(r));

    const sqlCandidates = await this.getDb().all(
      'SELECT * FROM users WHERE username LIKE ? ORDER BY username ASC, created_at ASC LIMIT ?',
      `%${kw}%`,
      Math.max(limit * 5, 50)
    );
    const exactLikeRows = sqlCandidates
      .filter((r) => isExactSearchMatch(r.username || '', kw))
      .sort((a, b) => String(a.username).localeCompare(String(b.username)) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
    if (exactLikeRows.length > 0) return exactLikeRows.slice(0, limit).map((r) => this.mapUser(r));

    const rows = sqlCandidates.length > 0 ? sqlCandidates : await this.loadSearchPool();
    return rows
      .map((r) => ({ r, score: fuzzyScore(r.username || '', kw) }))
      .filter((x): x is { r: any; score: number } => x.score !== null)
      .sort((a, b) => a.score - b.score || String(a.r.username).localeCompare(String(b.r.username)))
      .slice(0, limit)
      .map((x) => this.mapUser(x.r));
  }

  async create(user: User): Promise<User> {
    await this.getDb().run(
      'INSERT INTO users (id, username, avatar_url, role, point, access_token, refresh_token, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      user.id, user.username, user.avatar_url, user.role, user.point, user.access_token || null, user.refresh_token || null, toMysqlDateTime(user.last_seen_at || new Date().toISOString())
    );
    return user;
  }

  async updatePoint(id: string, point: number): Promise<void> {
    const before = await this.getDb().get('SELECT point FROM users WHERE id = ?', id);
    await this.getDb().run('UPDATE users SET point = ? WHERE id = ?', point, id);
    if (before) {
      await recordMysqlPointLedger(this.getDb(), {
        userId: id,
        amount: Number(point || 0) - Number(before.point || 0),
        balanceAfter: Number(point || 0),
        sourceType: 'manual_adjustment',
        reason: 'point_set',
        description: '관리/시스템에 의해 포인트가 특정 값으로 변경되었습니다.'
      });
    }
  }

  async incrementPoint(id: string, delta: number): Promise<void> {
    await this.getDb().run('UPDATE users SET point = point + ? WHERE id = ?', delta, id);
    await recordMysqlPointLedger(this.getDb(), {
      userId: id,
      amount: delta,
      sourceType: 'manual_adjustment',
      reason: 'point_increment',
      description: '관리/시스템에 의해 포인트가 증감되었습니다.'
    });
  }

  async tryDeductPoint(id: string, amount: number): Promise<boolean> {
    const result = await this.getDb().run('UPDATE users SET point = point - ? WHERE id = ? AND point >= ?', amount, id, amount);
    if (result.changes > 0) {
      await recordMysqlPointLedger(this.getDb(), {
        userId: id,
        amount: -amount,
        sourceType: 'manual_adjustment',
        reason: 'point_deduct',
        description: '관리/시스템에 의해 포인트가 차감되었습니다.'
      });
    }
    return result.changes > 0;
  }

  async updateBanStatus(id: string, bannedUntil: string | null, reason?: string | null): Promise<void> {
    await this.getDb().run('UPDATE users SET banned_until = ?, ban_reason = ? WHERE id = ?', toMysqlDateTime(bannedUntil), bannedUntil === null ? null : (reason || null), id);
  }

  async claimFreeDrawIfEligible(id: string, nowIso: string, segmentStartIso: string | null): Promise<boolean> {
    const now = toMysqlDateTime(nowIso);
    const segmentStart = toMysqlDateTime(segmentStartIso);
    if (segmentStartIso === null) {
      await this.getDb().run('UPDATE users SET last_free_draw = ? WHERE id = ?', now, id);
      return true;
    }
    const result = await this.getDb().run(
      `UPDATE users SET last_free_draw = ?
       WHERE id = ?
         AND (last_free_draw IS NULL OR last_free_draw < ?)`,
      now, id, segmentStart
    );
    return result.changes > 0;
  }

  async syncFreeDrawTickets(id: string, segmentStartIso: string | null, maxStack: number, intervalHours: number): Promise<User | null> {
    const safeMaxStack = Math.max(1, Math.floor(maxStack || 1));
    return this.getDb().transaction(async (tx) => {
      const row = await tx.get('SELECT * FROM users WHERE id = ? FOR UPDATE', id);
      if (!row) return null;
      if (segmentStartIso === null) return this.mapUser(row);

      const lastFreeDrawMs = parseMysqlDateTimeMs(row.last_free_draw);
      const segmentStartMs = parseMysqlDateTimeMs(segmentStartIso);
      const shouldGrant = !row.last_free_draw || (
        Number.isFinite(lastFreeDrawMs) &&
        Number.isFinite(segmentStartMs) &&
        lastFreeDrawMs < segmentStartMs
      );
      if (!shouldGrant) return this.mapUser(row);

      const currentTickets = Number(row.free_draw_tickets || 0);
      const diffMs = row.last_free_draw && Number.isFinite(lastFreeDrawMs) && Number.isFinite(segmentStartMs)
        ? segmentStartMs - lastFreeDrawMs
        : 0;
      const intervalMs = Math.max(1, Number(intervalHours || 1)) * 60 * 60 * 1000;
      const grantCount = row.last_free_draw ? Math.max(1, Math.floor(diffMs / intervalMs)) : 1;
      const nextTickets = Math.min(safeMaxStack, currentTickets + grantCount);
      await tx.run('UPDATE users SET free_draw_tickets = ?, last_free_draw = ? WHERE id = ?', nextTickets, toMysqlDateTime(segmentStartIso), id);
      return this.mapUser({ ...row, free_draw_tickets: nextTickets, last_free_draw: segmentStartIso });
    });
  }

  async addBonusFreeDrawTickets(id: string, amount: number): Promise<void> {
    const qty = Math.max(0, Math.floor(amount || 0));
    if (qty <= 0) return;
    await this.getDb().run('UPDATE users SET bonus_free_draw_tickets = COALESCE(bonus_free_draw_tickets, 0) + ? WHERE id = ?', qty, id);
  }

  async deleteAccount(id: string): Promise<void> {
    await this.getDb().transaction(async (tx) => {
      const deletingUser = await tx.get<{
        username?: string | null;
        avatar_url?: string | null;
        point?: number | null;
      }>('SELECT username, avatar_url, point FROM users WHERE id = ?', id);
      await tx.run(`
        INSERT IGNORE INTO market_transaction_audit_logs
          (audit_key, listing_id, event_type, related_user_id, seller_id, buyer_id, current_bidder_id,
           user_card_id, channel_id, serial_number, star, price, status, listing_type, current_bid,
           bid_reserved, fee, settled_amount, listing_created_at, listing_updated_at)
        SELECT
          CONCAT('account_deleted:', ml.id, ':', ?),
          ml.id,
          'account_deleted',
          ?,
          ml.seller_id,
          ml.buyer_id,
          ml.current_bidder_id,
          ml.user_card_id,
          uc.channel_id,
          uc.serial_number,
          uc.star,
          ml.price,
          ml.status,
          ml.listing_type,
          ml.current_bid,
          ml.bid_reserved,
          ml.fee,
          ml.settled_amount,
          ml.created_at,
          ml.updated_at
        FROM market_listings ml
        LEFT JOIN user_cards uc ON uc.id = ml.user_card_id
        WHERE ml.seller_id = ? OR ml.buyer_id = ? OR ml.current_bidder_id = ?
      `, id, id, id, id, id);
      await tx.run(`
        INSERT INTO deleted_user_accounts
          (user_id, deleted_at, username_snapshot, avatar_url_snapshot, point_at_deletion)
        VALUES (?, UTC_TIMESTAMP(), ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          deleted_at = VALUES(deleted_at),
          username_snapshot = VALUES(username_snapshot),
          avatar_url_snapshot = VALUES(avatar_url_snapshot),
          point_at_deletion = VALUES(point_at_deletion)
      `, id, deletingUser?.username || null, deletingUser?.avatar_url || null, deletingUser?.point ?? null);
      const pendingBidRefunds = await tx.all<{ listing_id: number; user_id: string; amount: number }>(`
        SELECT ml.id AS listing_id, mb.bidder_id AS user_id, mb.amount AS amount
          FROM market_listings ml
          JOIN market_bids mb ON mb.listing_id = ml.id
          JOIN (
            SELECT listing_id, bidder_id, MAX(id) AS id
              FROM market_bids
             GROUP BY listing_id, bidder_id
          ) latest ON latest.id = mb.id
         WHERE ml.seller_id = ?
           AND ml.status = 'PENDING'
        UNION ALL
        SELECT ml.id AS listing_id, ml.current_bidder_id AS user_id, ml.bid_reserved AS amount
          FROM market_listings ml
         WHERE ml.seller_id = ?
           AND ml.status = 'PENDING'
           AND ml.current_bidder_id IS NOT NULL
           AND ml.bid_reserved > 0
           AND NOT EXISTS (SELECT 1 FROM market_bids mb WHERE mb.listing_id = ml.id)
      `, id, id);
      for (const refund of pendingBidRefunds) {
        const amount = Number(refund.amount || 0);
        if (amount <= 0) continue;
        await tx.run('UPDATE users SET point = point + ? WHERE id = ?', amount, refund.user_id);
        await recordMysqlPointLedger(tx, {
          userId: refund.user_id,
          counterpartyUserId: id,
          amount,
          sourceType: 'market_bid_refund',
          sourceId: refund.listing_id,
          reason: 'seller_account_deleted_refund',
          description: `판매자 ${id} 탈퇴로 진행 중 경매 예약금 환불`,
          metadata: { deleted_seller_id: id, listing_id: refund.listing_id }
        });
      }
      await tx.run(`
        UPDATE market_listings
           SET current_bidder_id = NULL,
               bid_reserved = 0,
               current_bid = COALESCE(starting_bid, current_bid),
               updated_at = UTC_TIMESTAMP()
         WHERE current_bidder_id = ?
           AND status = 'PENDING'
      `, id);
      await tx.run('UPDATE market_listings SET buyer_id = NULL WHERE buyer_id = ?', id);
      await tx.run('DELETE FROM market_listings WHERE seller_id = ?', id);
      await tx.run('DELETE FROM trades WHERE sender_id = ? OR receiver_id = ?', id, id);
      await tx.run('DELETE FROM user_blocks WHERE blocker_id = ? OR blocked_id = ?', id, id);
      await tx.run('DELETE FROM friend_requests WHERE requester_id = ? OR receiver_id = ?', id, id);
      await tx.run('DELETE FROM friendships WHERE user_a_id = ? OR user_b_id = ?', id, id);
      await tx.run(`
        UPDATE chat_rooms
           SET closed_at = COALESCE(closed_at, UTC_TIMESTAMP()),
               closed_by_user_id = ?,
               deleted_for_a = CASE WHEN user_a_id = ? THEN 1 ELSE deleted_for_a END,
               deleted_for_b = CASE WHEN user_b_id = ? THEN 1 ELSE deleted_for_b END,
               updated_at = UTC_TIMESTAMP()
         WHERE user_a_id = ? OR user_b_id = ?
      `, id, id, id, id, id);
      await tx.run('DELETE FROM notifications WHERE user_id = ?', id);
      await tx.run('DELETE FROM push_subscriptions WHERE user_id = ?', id);
      await tx.run('DELETE FROM coupon_logs WHERE user_id = ?', id);
      await tx.run('DELETE FROM card_reports WHERE reporter_id = ?', id);
      await tx.run('DELETE FROM user_titles WHERE user_id = ?', id);
      await tx.run('DELETE FROM user_cosmetics WHERE user_id = ?', id);
      await tx.run('DELETE FROM shop_purchases WHERE user_id = ?', id);
      await tx.run('DELETE FROM user_minigame_tickets WHERE user_id = ?', id);
      await tx.run('DELETE FROM minigame_sessions WHERE user_id = ?', id);
      await tx.run('DELETE FROM user_cards WHERE user_id = ?', id);
      await tx.run('UPDATE streamers SET registered_by = NULL WHERE registered_by = ?', id);
      await tx.run('DELETE FROM users WHERE id = ?', id);
    });
  }

  async findDeletedAccount(id: string): Promise<DeletedUserAccount | null> {
    const row = await this.getDb().get<DeletedUserAccount>(
      'SELECT user_id, deleted_at, username_snapshot, avatar_url_snapshot, point_at_deletion FROM deleted_user_accounts WHERE user_id = ?',
      id
    );
    return row || null;
  }

  async updateLastFreeDraw(id: string, time: string): Promise<void> {
    await this.getDb().run('UPDATE users SET last_free_draw = ? WHERE id = ?', toMysqlDateTime(time), id);
  }

  async updateProfile(id: string, username: string, avatarUrl: string | null, accessToken?: string | null, refreshToken?: string | null): Promise<void> {
    if (accessToken !== undefined && refreshToken !== undefined) {
      await this.getDb().run('UPDATE users SET username = ?, avatar_url = ?, access_token = ?, refresh_token = ? WHERE id = ?', username, avatarUrl, accessToken, refreshToken, id);
    } else if (accessToken !== undefined) {
      await this.getDb().run('UPDATE users SET username = ?, avatar_url = ?, access_token = ? WHERE id = ?', username, avatarUrl, accessToken, id);
    } else {
      await this.getDb().run('UPDATE users SET username = ?, avatar_url = ? WHERE id = ?', username, avatarUrl, id);
    }
  }

  async updateTokens(id: string, accessToken: string | null, refreshToken: string | null, tokenExpiresAt: string | null): Promise<void> {
    await this.getDb().run('UPDATE users SET access_token = ?, refresh_token = ?, token_expires_at = ? WHERE id = ?', accessToken, refreshToken, toMysqlDateTime(tokenExpiresAt), id);
  }

  async updateLastSeen(id: string, seenAt: string): Promise<void> {
    await this.getDb().run('UPDATE users SET last_seen_at = ? WHERE id = ?', toMysqlDateTime(seenAt), id);
  }

  async updateRepresentativeCard(id: string, channelId: string | null, star: number | null): Promise<void> {
    await this.getDb().run('UPDATE users SET representative_card_channel_id = ?, representative_card_star = ? WHERE id = ?', channelId, star, id);
  }

  async updateStatusMessage(id: string, message: string | null): Promise<void> {
    const normalized = message && message.trim() ? message.trim().slice(0, 80) : null;
    await this.getDb().run('UPDATE users SET status_message = ? WHERE id = ?', normalized, id);
  }

  async count(): Promise<number> {
    const row = await this.getDb().get('SELECT COUNT(*) AS c FROM users');
    return row?.c || 0;
  }

  async listUsers(keyword: string, limit: number, offset: number): Promise<{ users: User[]; total: number }> {
    const kw = (keyword || '').trim();
    const like = `%${kw}%`;
    const likeOp = getSqlDialect() === 'postgres' ? 'ILIKE' : 'LIKE';
    const total = kw
      ? (await this.getDb().get(`SELECT COUNT(*) AS c FROM users WHERE username ${likeOp} ? OR id ${likeOp} ?`, like, like))?.c || 0
      : (await this.getDb().get('SELECT COUNT(*) AS c FROM users'))?.c || 0;
    const activeWhere = kw ? `WHERE u.username ${likeOp} ? OR u.id ${likeOp} ?` : '';
    const deletedWhere = kw ? `AND (du.username_snapshot ${likeOp} ? OR du.user_id ${likeOp} ?)` : '';
    const params = kw ? [like, like, like, like, limit, offset] : [limit, offset];
    const rows = await this.getDb().all(`
      SELECT * FROM (
        SELECT u.id, u.username, u.avatar_url, u.role, u.point, u.last_free_draw,
               u.free_draw_tickets, u.bonus_free_draw_tickets, u.banned_until, u.ban_reason,
               u.representative_card_channel_id, u.representative_card_star, u.status_message,
               u.access_token, u.refresh_token, u.token_expires_at, u.created_at,
               du.deleted_at,
               CASE WHEN du.user_id IS NULL THEN 'current' ELSE 'rejoined' END AS identity_source,
               0 AS is_deleted,
               COALESCE(u.created_at, '') AS sort_at
          FROM users u
          LEFT JOIN deleted_user_accounts du ON du.user_id = u.id
          ${activeWhere}
        UNION ALL
        SELECT du.user_id AS id,
               COALESCE(du.username_snapshot, '탈퇴 유저') AS username,
               du.avatar_url_snapshot AS avatar_url,
               'USER' AS role,
               COALESCE(du.point_at_deletion, 0) AS point,
               NULL AS last_free_draw,
               0 AS free_draw_tickets,
               0 AS bonus_free_draw_tickets,
               NULL AS banned_until,
               NULL AS ban_reason,
               NULL AS representative_card_channel_id,
               NULL AS representative_card_star,
               NULL AS status_message,
               NULL AS access_token,
               NULL AS refresh_token,
               NULL AS token_expires_at,
               du.deleted_at AS created_at,
               du.deleted_at,
               'deleted_snapshot' AS identity_source,
               1 AS is_deleted,
               COALESCE(du.deleted_at, '') AS sort_at
          FROM deleted_user_accounts du
          LEFT JOIN users u ON u.id = du.user_id
         WHERE u.id IS NULL
          ${deletedWhere}
      ) combined
      ORDER BY sort_at DESC, id ASC
      LIMIT ? OFFSET ?
    `, params);
    return { users: rows.map((row) => this.mapUser(row)), total };
  }

  async listBannedUsers(keyword: string, sortBy: string, sortOrder: 'asc' | 'desc', limit: number, offset: number): Promise<{ users: User[]; total: number }> {
    const validSortColumns = ['banned_until', 'username', 'id', 'created_at'];
    const orderCol = validSortColumns.includes(sortBy) ? sortBy : 'banned_until';
    const orderDir = sortOrder === 'asc' ? 'ASC' : 'DESC';
    const params: any[] = [];
    let where = 'banned_until IS NOT NULL AND banned_until > UTC_TIMESTAMP()';
    const kw = (keyword || '').trim();
    if (kw) {
      const likeOp = getSqlDialect() === 'postgres' ? 'ILIKE' : 'LIKE';
      where += ` AND (username ${likeOp} ? OR id ${likeOp} ?)`;
      params.push(`%${kw}%`, `%${kw}%`);
    }
    const total = (await this.getDb().get(`SELECT COUNT(*) AS c FROM users WHERE ${where}`, params))?.c || 0;
    const rows = await this.getDb().all(`SELECT * FROM users WHERE ${where} ORDER BY ${orderCol} ${orderDir} LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return { users: rows.map((row) => this.mapUser(row)), total };
  }

  async blockUser(blockerId: string, blockedId: string): Promise<void> {
    await this.getDb().run(
      'INSERT IGNORE INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, UTC_TIMESTAMP())',
      blockerId,
      blockedId
    );
  }

  async unblockUser(blockerId: string, blockedId: string): Promise<void> {
    await this.getDb().run('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?', blockerId, blockedId);
  }

  async getBlockedUsers(blockerId: string): Promise<User[]> {
    const rows = await this.getDb().all(`
      SELECT u.* FROM user_blocks b JOIN users u ON u.id = b.blocked_id
      WHERE b.blocker_id = ? ORDER BY b.created_at DESC
    `, blockerId);
    return rows.map((row) => this.mapUser(row));
  }

  async isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
    const row = await this.getDb().get('SELECT 1 AS x FROM user_blocks WHERE blocker_id = ? AND blocked_id = ? LIMIT 1', blockerId, blockedId);
    return !!row;
  }

  async findRankings(
    limit: number,
    keyword: string = '',
    options: { mode?: 'total' | 'cards'; channelId?: string; star?: number | null } = {}
  ): Promise<UserRanking[]> {
    const mode = options.mode === 'cards' ? 'cards' : 'total';
    const channelId = (options.channelId || '').trim();
    const star = options.star == null || Number.isNaN(Number(options.star)) ? null : Number(options.star);
    const orderExpr = mode === 'cards' ? 'cards_value' : '(point + cards_value)';
    if (getSqlDialect() === 'postgres') {
      const params: any[] = [keyword, `%${keyword}%`, channelId, channelId, star, star, limit];
      const rows = await this.getDb().all(`
        WITH UserCardValues AS (
          SELECT u.id, u.username, u.avatar_url, u.role, u.point, u.last_free_draw, u.banned_until,
                 u.ban_reason, u.status_message, u.last_seen_at, u.created_at,
                 COUNT(uc.id) AS card_count,
                 COALESCE(SUM(s.base_value * (1 + COALESCE(uc.star, 0) * 0.8)), 0) AS cards_value
            FROM users u
            LEFT JOIN user_cards uc ON uc.user_id = u.id AND uc.is_hidden IS NOT TRUE
            LEFT JOIN streamers s ON s.channel_id = uc.channel_id
           WHERE u.banned_until IS NULL OR u.banned_until <= NOW()
           GROUP BY u.id, u.username, u.avatar_url, u.role, u.point, u.last_free_draw, u.banned_until,
                    u.ban_reason, u.status_message, u.last_seen_at, u.created_at
        ),
        RankedUsers AS (
          SELECT *,
                 ROW_NUMBER() OVER (ORDER BY ${orderExpr} DESC, id ASC) AS user_rank
            FROM UserCardValues
        )
        SELECT *, (point + cards_value) AS total_asset FROM RankedUsers
         WHERE (? = '' OR username ILIKE ?)
           AND (
             ? = ''
             OR EXISTS (
               SELECT 1
                 FROM user_cards fc
                WHERE fc.user_id = RankedUsers.id
                  AND fc.is_hidden IS NOT TRUE
                  AND fc.channel_id = ?
                  AND (? IS NULL OR COALESCE(fc.star, 0) = ?)
             )
           )
         LIMIT ?
      `, params);
      return rows.map((row: any) => ({
        id: row.id,
        username: row.username,
        avatar_url: row.avatar_url,
        role: row.role as 'USER' | 'ADMIN',
        point: Number(row.point || 0),
        last_free_draw: row.last_free_draw,
        banned_until: row.banned_until,
        ban_reason: row.ban_reason ?? null,
        status_message: row.status_message ?? null,
        last_seen_at: row.last_seen_at ?? null,
        created_at: row.created_at,
        card_count: Number(row.card_count || 0),
        cards_value: Math.round(Number(row.cards_value || 0)),
        total_asset: Number(row.point || 0) + Math.round(Number(row.cards_value || 0)),
        rank: Number(row.user_rank || 0)
      }));
    }
    const params: any[] = [keyword, `%${keyword}%`, channelId, channelId, star, star, limit];
    const rows = await this.getDb().all(`
      WITH NormalizedUsers AS (
        SELECT u.id, u.username, u.avatar_url, u.role, u.point,
               ${mysqlDateValueSql('u.last_free_draw')} AS last_free_draw,
               ${mysqlDateValueSql('u.banned_until')} AS banned_until,
               u.ban_reason, u.status_message,
               ${mysqlDateValueSql('u.last_seen_at')} AS last_seen_at,
               ${mysqlDateValueSql('u.created_at')} AS created_at
          FROM users u
      ),
      UserCardValues AS (
        SELECT u.id, u.username, u.avatar_url, u.role, u.point, u.last_free_draw, u.banned_until, u.ban_reason,
               u.status_message, u.last_seen_at, u.created_at,
               COUNT(uc.id) AS card_count,
               COALESCE(SUM(s.base_value * (1 + COALESCE(uc.star, 0) * 0.8)), 0) AS cards_value
        FROM NormalizedUsers u
        LEFT JOIN user_cards uc ON uc.user_id COLLATE utf8mb4_unicode_ci = u.id COLLATE utf8mb4_unicode_ci AND COALESCE(uc.is_hidden, 0) = 0
        LEFT JOIN streamers s ON s.channel_id COLLATE utf8mb4_unicode_ci = uc.channel_id COLLATE utf8mb4_unicode_ci
        WHERE u.banned_until IS NULL OR u.banned_until <= UTC_TIMESTAMP()
        GROUP BY u.id, u.username, u.avatar_url, u.role, u.point, u.last_free_draw, u.banned_until, u.ban_reason, u.status_message, u.last_seen_at, u.created_at
      ),
      RankedUsers AS (
        SELECT *,
               ROW_NUMBER() OVER (ORDER BY ${orderExpr} DESC, id ASC) AS user_rank
        FROM UserCardValues
      )
      SELECT *, (point + cards_value) AS total_asset FROM RankedUsers
      WHERE (? = '' OR username COLLATE utf8mb4_unicode_ci LIKE ? COLLATE utf8mb4_unicode_ci)
        AND (
          ? = ''
          OR EXISTS (
            SELECT 1
              FROM user_cards fc
             WHERE fc.user_id COLLATE utf8mb4_unicode_ci = RankedUsers.id COLLATE utf8mb4_unicode_ci
               AND COALESCE(fc.is_hidden, 0) = 0
               AND fc.channel_id COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci
               AND (? IS NULL OR COALESCE(fc.star, 0) = ?)
          )
        )
      LIMIT ?
    `, params);

    return rows.map((row: any) => ({
      id: row.id,
      username: row.username,
      avatar_url: row.avatar_url,
      role: row.role as 'USER' | 'ADMIN',
      point: Number(row.point || 0),
      last_free_draw: row.last_free_draw,
      banned_until: row.banned_until,
      ban_reason: row.ban_reason ?? null,
      status_message: row.status_message ?? null,
      last_seen_at: row.last_seen_at ?? null,
      created_at: row.created_at,
      card_count: Number(row.card_count || 0),
      cards_value: Math.round(Number(row.cards_value || 0)),
      total_asset: Number(row.point || 0) + Math.round(Number(row.cards_value || 0)),
      rank: Number(row.user_rank || 0)
    }));
  }
}
