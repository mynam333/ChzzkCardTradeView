import { getSqliteDb } from "../../services/db";
import { fuzzyScore } from "../../utils/search";
import { recordSqlitePointLedger } from "../../services/pointLedger";
import {
  IUserRepository,
  IStreamerRepository, 
  ICouponRepository, 
  IReportRepository,
  IAnnouncementRepository,
  IUserCardRepository,
  ITradeRepository,
  INotificationRepository,
  ISystemConfigRepository,
  User,
  DeletedUserAccount,
  UserRanking,
  Streamer,
  StreamerScheduleResult,
  Coupon,
  CardReport,
  Announcement,
  Trade,
  AppNotification
} from '../interfaces';

export class SqliteUserRepository implements IUserRepository {
  private getDb() {
    return getSqliteDb();
  }

  private mapUser(row: any): User {
    return {
      id: row.id,
      username: row.username,
      avatar_url: row.avatar_url,
      role: row.role as 'USER' | 'ADMIN',
      point: row.point,
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
    const row = this.getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    return row ? this.mapUser(row) : null;
  }

  async findByIds(ids: string[]): Promise<User[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.getDb().prepare(`SELECT * FROM users WHERE id IN (${placeholders})`).all(...ids) as any[];
    return rows.map((r) => this.mapUser(r));
  }

  async findByUsername(username: string): Promise<User | null> {
    const row = this.getDb().prepare('SELECT * FROM users WHERE username = ? ORDER BY created_at ASC LIMIT 1').get(username) as any;
    return row ? this.mapUser(row) : null;
  }

  async searchByUsername(keyword: string, limit: number): Promise<User[]> {
    const kw = (keyword || '').trim();
    if (!kw) return [];
    // 초성/띄어쓰기 무시 유사도 검색: 전체 유저를 스캔해 점수순으로 상위 N명 반환
    // (정확한 부분일치를 초성 일치보다 우선 노출)
    const rows = this.getDb().prepare('SELECT * FROM users').all() as any[];
    return rows
      .map((r) => ({ r, score: fuzzyScore(r.username || '', kw) }))
      .filter((x): x is { r: any; score: number } => x.score !== null)
      .sort((a, b) => a.score - b.score || String(a.r.username).localeCompare(String(b.r.username)))
      .slice(0, limit)
      .map((x) => this.mapUser(x.r));
  }

  async listUsers(keyword: string, limit: number, offset: number): Promise<{ users: User[]; total: number }> {
    const db = this.getDb();
    const kw = (keyword || '').trim();
    if (kw) {
      const like = `%${kw}%`;
      const total = (db.prepare('SELECT COUNT(*) AS c FROM users WHERE username LIKE ? OR id LIKE ?').get(like, like) as any)?.c || 0;
      const rows = db.prepare(
        'SELECT * FROM users WHERE username LIKE ? OR id LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).all(like, like, limit, offset) as any[];
      return { users: rows.map((r) => this.mapUser(r)), total };
    }
    const total = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as any)?.c || 0;
    const rows = db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as any[];
    return { users: rows.map((r) => this.mapUser(r)), total };
  }

  async listBannedUsers(keyword: string, sortBy: string, sortOrder: 'asc' | 'desc', limit: number, offset: number): Promise<{ users: User[]; total: number }> {
    const db = this.getDb();
    const kw = (keyword || '').trim();

    // 허용 정렬 컬럼 화이트리스트
    const validSortColumns = ['banned_until', 'username', 'id', 'created_at'];
    const orderCol = validSortColumns.includes(sortBy) ? sortBy : 'banned_until';
    const orderDir = sortOrder === 'asc' ? 'ASC' : 'DESC';

    let countQuery = "SELECT COUNT(*) AS c FROM users WHERE banned_until IS NOT NULL AND datetime(banned_until) > datetime('now')";
    let selectQuery = "SELECT * FROM users WHERE banned_until IS NOT NULL AND datetime(banned_until) > datetime('now')";
    const params: any[] = [];

    if (kw) {
      const like = `%${kw}%`;
      countQuery += ' AND (username LIKE ? OR id LIKE ?)';
      selectQuery += ' AND (username LIKE ? OR id LIKE ?)';
      params.push(like, like);
    }

    selectQuery += ` ORDER BY ${orderCol} ${orderDir} LIMIT ? OFFSET ?`;
    const total = (db.prepare(countQuery).get(...params) as any)?.c || 0;

    params.push(limit, offset);
    const rows = db.prepare(selectQuery).all(...params) as any[];

    return { users: rows.map((r) => this.mapUser(r)), total };
  }

  async create(user: User): Promise<User> {
    this.getDb().prepare(
      'INSERT INTO users (id, username, avatar_url, role, point, access_token, refresh_token) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(user.id, user.username, user.avatar_url, user.role, user.point, user.access_token || null, user.refresh_token || null);
    return user;
  }

  async updatePoint(id: string, point: number): Promise<void> {
    const before = this.getDb().prepare('SELECT point FROM users WHERE id = ?').get(id) as any;
    this.getDb().prepare('UPDATE users SET point = ? WHERE id = ?').run(point, id);
    if (before) {
      recordSqlitePointLedger(this.getDb(), {
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
    this.getDb().prepare('UPDATE users SET point = point + ? WHERE id = ?').run(delta, id);
    recordSqlitePointLedger(this.getDb(), {
      userId: id,
      amount: delta,
      sourceType: 'manual_adjustment',
      reason: 'point_increment',
      description: '관리/시스템에 의해 포인트가 증감되었습니다.'
    });
  }

  async tryDeductPoint(id: string, amount: number): Promise<boolean> {
    const result = this.getDb()
      .prepare('UPDATE users SET point = point - ? WHERE id = ? AND point >= ?')
      .run(amount, id, amount);
    if (result.changes > 0) {
      recordSqlitePointLedger(this.getDb(), {
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
    this.getDb().prepare('UPDATE users SET banned_until = ?, ban_reason = ? WHERE id = ?')
      .run(bannedUntil, bannedUntil === null ? null : (reason || null), id);
  }

  async claimFreeDrawIfEligible(id: string, nowIso: string, segmentStartIso: string | null): Promise<boolean> {
    if (segmentStartIso === null) {
      // 0시간마다 (무한 무료뽑기)
      this.getDb().prepare('UPDATE users SET last_free_draw = ? WHERE id = ?').run(nowIso, id);
      return true;
    }
    const result = this.getDb()
      .prepare(
        `UPDATE users SET last_free_draw = ?
         WHERE id = ?
           AND (last_free_draw IS NULL OR datetime(last_free_draw) < datetime(?))`
      )
      .run(nowIso, id, segmentStartIso);
    return result.changes > 0;
  }

  async syncFreeDrawTickets(id: string, segmentStartIso: string | null, maxStack: number, intervalHours: number): Promise<User | null> {
    const db = this.getDb();
    const safeMaxStack = Math.max(1, Math.floor(maxStack || 1));
    const txn = db.transaction(() => {
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
      if (!row) return null;

      if (segmentStartIso === null) {
        return this.mapUser(row);
      }

      const shouldGrant = !row.last_free_draw || new Date(row.last_free_draw).getTime() < new Date(segmentStartIso).getTime();
      if (!shouldGrant) return this.mapUser(row);

      const currentTickets = Number(row.free_draw_tickets || 0);
      const diffMs = row.last_free_draw
        ? new Date(segmentStartIso).getTime() - new Date(row.last_free_draw).getTime()
        : 0;
      const intervalMs = Math.max(1, Number(intervalHours || 1)) * 60 * 60 * 1000;
      const grantCount = row.last_free_draw ? Math.max(1, Math.floor(diffMs / intervalMs)) : 1;
      const nextTickets = Math.min(safeMaxStack, currentTickets + grantCount);
      db.prepare('UPDATE users SET free_draw_tickets = ?, last_free_draw = ? WHERE id = ?')
        .run(nextTickets, segmentStartIso, id);
      return this.mapUser({
        ...row,
        free_draw_tickets: nextTickets,
        last_free_draw: segmentStartIso
      });
    });

    return txn();
  }

  async addBonusFreeDrawTickets(id: string, amount: number): Promise<void> {
    const qty = Math.max(0, Math.floor(amount || 0));
    if (qty <= 0) return;
    this.getDb()
      .prepare('UPDATE users SET bonus_free_draw_tickets = COALESCE(bonus_free_draw_tickets, 0) + ? WHERE id = ?')
      .run(qty, id);
  }

  async deleteAccount(id: string): Promise<void> {
    const db = this.getDb();
    const txn = db.transaction(() => {
      db.prepare(`
        INSERT OR IGNORE INTO market_transaction_audit_logs
          (audit_key, listing_id, event_type, related_user_id, seller_id, buyer_id, current_bidder_id,
           user_card_id, channel_id, serial_number, star, price, status, listing_type, current_bid,
           bid_reserved, fee, settled_amount, listing_created_at, listing_updated_at)
        SELECT
          'account_deleted:' || ml.id || ':' || ?,
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
      `).run(id, id, id, id, id);
      db.prepare(`
        INSERT INTO deleted_user_accounts (user_id, deleted_at)
        VALUES (?, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET deleted_at = excluded.deleted_at
      `).run(id);
      db.prepare(`
        UPDATE users
           SET point = point + COALESCE((
             SELECT SUM(ml.bid_reserved)
               FROM market_listings ml
              WHERE ml.seller_id = ?
                AND ml.status = 'PENDING'
                AND ml.current_bidder_id = users.id
                AND ml.bid_reserved > 0
           ), 0)
         WHERE id IN (
           SELECT current_bidder_id
             FROM market_listings
            WHERE seller_id = ?
              AND status = 'PENDING'
              AND current_bidder_id IS NOT NULL
              AND bid_reserved > 0
         )
      `).run(id, id);
      const pendingBidRefunds = db.prepare(`
        SELECT id AS listing_id, current_bidder_id AS user_id, bid_reserved AS amount
          FROM market_listings
         WHERE seller_id = ?
           AND status = 'PENDING'
           AND current_bidder_id IS NOT NULL
           AND bid_reserved > 0
      `).all(id) as { listing_id: number; user_id: string; amount: number }[];
      for (const refund of pendingBidRefunds) {
        recordSqlitePointLedger(db, {
          userId: refund.user_id,
          counterpartyUserId: id,
          amount: Number(refund.amount || 0),
          sourceType: 'market_bid_refund',
          sourceId: refund.listing_id,
          reason: 'seller_account_deleted_refund',
          description: `판매자 ${id} 탈퇴로 진행 중 경매 예약금 환불`,
          metadata: { deleted_seller_id: id, listing_id: refund.listing_id }
        });
      }
      db.prepare(`
        UPDATE market_listings
           SET current_bidder_id = NULL,
               bid_reserved = 0,
               current_bid = COALESCE(starting_bid, current_bid),
               updated_at = datetime('now')
         WHERE current_bidder_id = ?
           AND status = 'PENDING'
      `).run(id);
      db.prepare('UPDATE market_listings SET buyer_id = NULL WHERE buyer_id = ?').run(id);
      db.prepare('DELETE FROM market_listings WHERE seller_id = ?').run(id);
      db.prepare('DELETE FROM trades WHERE sender_id = ? OR receiver_id = ?').run(id, id);
      db.prepare('DELETE FROM user_blocks WHERE blocker_id = ? OR blocked_id = ?').run(id, id);
      db.prepare('DELETE FROM notifications WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM coupon_logs WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM card_reports WHERE reporter_id = ?').run(id);
      db.prepare('DELETE FROM user_titles WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM user_cosmetics WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM shop_purchases WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM user_minigame_tickets WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM minigame_sessions WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM user_cards WHERE user_id = ?').run(id);
      db.prepare('UPDATE streamers SET registered_by = NULL WHERE registered_by = ?').run(id);
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    });

    txn();
  }

  async findDeletedAccount(id: string): Promise<DeletedUserAccount | null> {
    const row = this.getDb()
      .prepare('SELECT user_id, deleted_at FROM deleted_user_accounts WHERE user_id = ?')
      .get(id) as DeletedUserAccount | undefined;
    return row || null;
  }

  async updateLastFreeDraw(id: string, time: string): Promise<void> {
    this.getDb().prepare('UPDATE users SET last_free_draw = ? WHERE id = ?').run(time, id);
  }

  async updateTokens(id: string, accessToken: string | null, refreshToken: string | null, tokenExpiresAt: string | null): Promise<void> {
    this.getDb().prepare('UPDATE users SET access_token = ?, refresh_token = ?, token_expires_at = ? WHERE id = ?')
      .run(accessToken, refreshToken, tokenExpiresAt, id);
  }

  async updateRepresentativeCard(id: string, channelId: string | null, star: number | null): Promise<void> {
    this.getDb().prepare(
      'UPDATE users SET representative_card_channel_id = ?, representative_card_star = ? WHERE id = ?'
    ).run(channelId, star, id);
  }

  async updateStatusMessage(id: string, message: string | null): Promise<void> {
    const normalized = message && message.trim() ? message.trim().slice(0, 80) : null;
    this.getDb().prepare('UPDATE users SET status_message = ? WHERE id = ?').run(normalized, id);
  }

  async count(): Promise<number> {
    const row = this.getDb().prepare('SELECT COUNT(*) AS c FROM users').get() as any;
    return row?.c || 0;
  }

  // ---- 유저 차단 ----
  async blockUser(blockerId: string, blockedId: string): Promise<void> {
    this.getDb().prepare(
      "INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, datetime('now'))"
    ).run(blockerId, blockedId);
  }
  async unblockUser(blockerId: string, blockedId: string): Promise<void> {
    this.getDb().prepare('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?').run(blockerId, blockedId);
  }
  async getBlockedUsers(blockerId: string): Promise<User[]> {
    const rows = this.getDb().prepare(`
      SELECT u.* FROM user_blocks b JOIN users u ON u.id = b.blocked_id
      WHERE b.blocker_id = ? ORDER BY b.created_at DESC
    `).all(blockerId) as User[];
    return rows;
  }
  async isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
    const row = this.getDb().prepare(
      'SELECT 1 AS x FROM user_blocks WHERE blocker_id = ? AND blocked_id = ? LIMIT 1'
    ).get(blockerId, blockedId) as any;
    return !!row;
  }

  async updateProfile(id: string, username: string, avatarUrl: string | null, accessToken?: string | null, refreshToken?: string | null): Promise<void> {
    if (accessToken !== undefined && refreshToken !== undefined) {
      this.getDb().prepare('UPDATE users SET username = ?, avatar_url = ?, access_token = ?, refresh_token = ? WHERE id = ?').run(username, avatarUrl, accessToken, refreshToken, id);
    } else if (accessToken !== undefined) {
      this.getDb().prepare('UPDATE users SET username = ?, avatar_url = ?, access_token = ? WHERE id = ?').run(username, avatarUrl, accessToken, id);
    } else {
      this.getDb().prepare('UPDATE users SET username = ?, avatar_url = ? WHERE id = ?').run(username, avatarUrl, id);
    }
  }

  async findRankings(
    limit: number,
    keyword: string = '',
    options: { mode?: 'total' | 'cards'; channelId?: string; star?: number | null } = {}
  ): Promise<UserRanking[]> {
    // 윈도우 함수 ROW_NUMBER()를 사용하여 전체 유저에 대한 순위(rank)를 우선 매긴 후 검색어로 필터링
    const mode = options.mode === 'cards' ? 'cards' : 'total';
    const channelId = (options.channelId || '').trim();
    const star = options.star == null || Number.isNaN(Number(options.star)) ? null : Number(options.star);
    const orderExpr = mode === 'cards' ? 'cards_value' : '(point + cards_value)';
    const params: any[] = [keyword, `%${keyword}%`, channelId, channelId, star, star, limit];

    const rows = this.getDb().prepare(`
      WITH UserCardValues AS (
        SELECT u.id, u.username, u.avatar_url, u.role, u.point, u.last_free_draw, u.banned_until, u.ban_reason,
               u.status_message, u.created_at,
               COUNT(uc.id) AS card_count,
               COALESCE(SUM(s.base_value * (1 + COALESCE(uc.star, 0) * 0.8)), 0) AS cards_value
        FROM users u
        LEFT JOIN user_cards uc ON uc.user_id = u.id AND COALESCE(uc.is_hidden, 0) = 0
        LEFT JOIN streamers s ON s.channel_id = uc.channel_id
        GROUP BY u.id
      ),
      RankedUsers AS (
        SELECT *,
               ROW_NUMBER() OVER (ORDER BY ${orderExpr} DESC, id ASC) AS rank
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
    `).all(...params);

    return rows.map((row: any) => ({
      id: row.id,
      username: row.username,
      avatar_url: row.avatar_url,
      role: row.role as 'USER' | 'ADMIN',
      point: row.point,
      last_free_draw: row.last_free_draw,
      banned_until: row.banned_until,
      ban_reason: row.ban_reason ?? null,
      status_message: row.status_message ?? null,
      created_at: row.created_at,
      card_count: row.card_count,
      cards_value: Math.round(row.cards_value),
      total_asset: row.point + Math.round(row.cards_value),
      rank: row.rank
    }));
  }
}

// 별(0~5성)별 커스텀 이미지 컬럼명 (인덱스 0 = 0성 = custom_image_url)
