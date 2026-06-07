import { getSqliteDb } from "../../services/db";
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
      banned_until: row.banned_until,
      ban_reason: row.ban_reason ?? null,
      representative_card_channel_id: row.representative_card_channel_id ?? null,
      representative_card_star: row.representative_card_star ?? null,
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
    const rows = this.getDb().prepare(
      'SELECT * FROM users WHERE username LIKE ? ORDER BY username ASC LIMIT ?'
    ).all(`%${keyword}%`, limit) as any[];
    return rows.map((r) => this.mapUser(r));
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
    this.getDb().prepare('UPDATE users SET point = ? WHERE id = ?').run(point, id);
  }

  async incrementPoint(id: string, delta: number): Promise<void> {
    this.getDb().prepare('UPDATE users SET point = point + ? WHERE id = ?').run(delta, id);
  }

  async tryDeductPoint(id: string, amount: number): Promise<boolean> {
    const result = this.getDb()
      .prepare('UPDATE users SET point = point - ? WHERE id = ? AND point >= ?')
      .run(amount, id, amount);
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

  async findRankings(limit: number, keyword: string = ''): Promise<UserRanking[]> {
    // 윈도우 함수 ROW_NUMBER()를 사용하여 전체 유저에 대한 순위(rank)를 우선 매긴 후 검색어로 필터링
    const rows = this.getDb().prepare(`
      WITH RankedUsers AS (
        SELECT u.id, u.username, u.avatar_url, u.role, u.point, u.last_free_draw, u.banned_until, u.ban_reason, u.created_at,
               COUNT(uc.id) AS card_count,
               COALESCE(SUM(s.base_value * (1 + COALESCE(uc.star, 0) * 0.8)), 0) AS cards_value,
               ROW_NUMBER() OVER (
                 ORDER BY (u.point + COALESCE(SUM(s.base_value * (1 + COALESCE(uc.star, 0) * 0.8)), 0)) DESC
               ) AS rank
        FROM users u
        LEFT JOIN user_cards uc ON uc.user_id = u.id
        LEFT JOIN streamers s ON s.channel_id = uc.channel_id
        GROUP BY u.id
      )
      SELECT *, (point + cards_value) AS total_asset FROM RankedUsers
      WHERE (? = '' OR username LIKE ?)
      LIMIT ?
    `).all(keyword, `%${keyword}%`, limit);

    return rows.map((row: any) => ({
      id: row.id,
      username: row.username,
      avatar_url: row.avatar_url,
      role: row.role as 'USER' | 'ADMIN',
      point: row.point,
      last_free_draw: row.last_free_draw,
      banned_until: row.banned_until,
      ban_reason: row.ban_reason ?? null,
      created_at: row.created_at,
      card_count: row.card_count,
      total_asset: row.point + Math.round(row.cards_value),
      rank: row.rank
    }));
  }
}

// 별(0~5성)별 커스텀 이미지 컬럼명 (인덱스 0 = 0성 = custom_image_url)
