import { getMysqlDb } from '../../services/db';
import { MysqlTx } from '../../services/mysqlDb';
import { fuzzyScore } from '../../utils/search';
import { IUserRepository, User, UserRanking } from '../interfaces';

export class MysqlUserRepository implements IUserRepository {
  private getDb() {
    return getMysqlDb();
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
      created_at: row.created_at
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
    const rows = await this.getDb().all('SELECT * FROM users');
    return rows
      .map((r) => ({ r, score: fuzzyScore(r.username || '', kw) }))
      .filter((x): x is { r: any; score: number } => x.score !== null)
      .sort((a, b) => a.score - b.score || String(a.r.username).localeCompare(String(b.r.username)))
      .slice(0, limit)
      .map((x) => this.mapUser(x.r));
  }

  async create(user: User): Promise<User> {
    await this.getDb().run(
      'INSERT INTO users (id, username, avatar_url, role, point, access_token, refresh_token) VALUES (?, ?, ?, ?, ?, ?, ?)',
      user.id, user.username, user.avatar_url, user.role, user.point, user.access_token || null, user.refresh_token || null
    );
    return user;
  }

  async updatePoint(id: string, point: number): Promise<void> {
    await this.getDb().run('UPDATE users SET point = ? WHERE id = ?', point, id);
  }

  async incrementPoint(id: string, delta: number): Promise<void> {
    await this.getDb().run('UPDATE users SET point = point + ? WHERE id = ?', delta, id);
  }

  async tryDeductPoint(id: string, amount: number): Promise<boolean> {
    const result = await this.getDb().run('UPDATE users SET point = point - ? WHERE id = ? AND point >= ?', amount, id, amount);
    return result.changes > 0;
  }

  async updateBanStatus(id: string, bannedUntil: string | null, reason?: string | null): Promise<void> {
    await this.getDb().run('UPDATE users SET banned_until = ?, ban_reason = ? WHERE id = ?', bannedUntil, bannedUntil === null ? null : (reason || null), id);
  }

  async claimFreeDrawIfEligible(id: string, nowIso: string, segmentStartIso: string | null): Promise<boolean> {
    if (segmentStartIso === null) {
      await this.getDb().run('UPDATE users SET last_free_draw = ? WHERE id = ?', nowIso, id);
      return true;
    }
    const result = await this.getDb().run(
      `UPDATE users SET last_free_draw = ?
       WHERE id = ?
         AND (last_free_draw IS NULL OR last_free_draw < ?)`,
      nowIso, id, segmentStartIso
    );
    return result.changes > 0;
  }

  async syncFreeDrawTickets(id: string, segmentStartIso: string | null, maxStack: number, intervalHours: number): Promise<User | null> {
    const safeMaxStack = Math.max(1, Math.floor(maxStack || 1));
    return this.getDb().transaction(async (tx) => {
      const row = await tx.get('SELECT * FROM users WHERE id = ? FOR UPDATE', id);
      if (!row) return null;
      if (segmentStartIso === null) return this.mapUser(row);

      const shouldGrant = !row.last_free_draw || new Date(row.last_free_draw).getTime() < new Date(segmentStartIso).getTime();
      if (!shouldGrant) return this.mapUser(row);

      const currentTickets = Number(row.free_draw_tickets || 0);
      const diffMs = row.last_free_draw ? new Date(segmentStartIso).getTime() - new Date(row.last_free_draw).getTime() : 0;
      const intervalMs = Math.max(1, Number(intervalHours || 1)) * 60 * 60 * 1000;
      const grantCount = row.last_free_draw ? Math.max(1, Math.floor(diffMs / intervalMs)) : 1;
      const nextTickets = Math.min(safeMaxStack, currentTickets + grantCount);
      await tx.run('UPDATE users SET free_draw_tickets = ?, last_free_draw = ? WHERE id = ?', nextTickets, segmentStartIso, id);
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
      await tx.run('UPDATE market_listings SET buyer_id = NULL WHERE buyer_id = ?', id);
      await tx.run('DELETE FROM market_listings WHERE seller_id = ?', id);
      await tx.run('DELETE FROM trades WHERE sender_id = ? OR receiver_id = ?', id, id);
      await tx.run('DELETE FROM user_blocks WHERE blocker_id = ? OR blocked_id = ?', id, id);
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

  async updateLastFreeDraw(id: string, time: string): Promise<void> {
    await this.getDb().run('UPDATE users SET last_free_draw = ? WHERE id = ?', time, id);
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
    await this.getDb().run('UPDATE users SET access_token = ?, refresh_token = ?, token_expires_at = ? WHERE id = ?', accessToken, refreshToken, tokenExpiresAt, id);
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
    if (kw) {
      const like = `%${kw}%`;
      const total = (await this.getDb().get('SELECT COUNT(*) AS c FROM users WHERE username LIKE ? OR id LIKE ?', like, like))?.c || 0;
      const rows = await this.getDb().all('SELECT * FROM users WHERE username LIKE ? OR id LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?', like, like, limit, offset);
      return { users: rows.map((row) => this.mapUser(row)), total };
    }
    const total = (await this.getDb().get('SELECT COUNT(*) AS c FROM users'))?.c || 0;
    const rows = await this.getDb().all('SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?', limit, offset);
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
      where += ' AND (username LIKE ? OR id LIKE ?)';
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
    const params: any[] = [keyword, `%${keyword}%`, channelId, channelId, star, star, limit];
    const rows = await this.getDb().all(`
      WITH UserCardValues AS (
        SELECT u.id, u.username, u.avatar_url, u.role, u.point, u.last_free_draw, u.banned_until, u.ban_reason,
               u.status_message, u.created_at,
               COUNT(uc.id) AS card_count,
               COALESCE(SUM(s.base_value * (1 + COALESCE(uc.star, 0) * 0.8)), 0) AS cards_value
        FROM users u
        LEFT JOIN user_cards uc ON uc.user_id = u.id AND COALESCE(uc.is_hidden, 0) = 0
        LEFT JOIN streamers s ON s.channel_id = uc.channel_id
        GROUP BY u.id, u.username, u.avatar_url, u.role, u.point, u.last_free_draw, u.banned_until, u.ban_reason, u.status_message, u.created_at
      ),
      RankedUsers AS (
        SELECT *,
               ROW_NUMBER() OVER (ORDER BY ${orderExpr} DESC, id ASC) AS user_rank
        FROM UserCardValues
      )
      SELECT *, (point + cards_value) AS total_asset FROM RankedUsers
      WHERE (? = '' OR username LIKE ?)
        AND (
          ? = ''
          OR EXISTS (
            SELECT 1
              FROM user_cards fc
             WHERE fc.user_id = RankedUsers.id
               AND COALESCE(fc.is_hidden, 0) = 0
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
      created_at: row.created_at,
      card_count: Number(row.card_count || 0),
      cards_value: Math.round(Number(row.cards_value || 0)),
      total_asset: Number(row.point || 0) + Math.round(Number(row.cards_value || 0)),
      rank: Number(row.user_rank || 0)
    }));
  }
}
