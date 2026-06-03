import { getSqliteDb } from '../services/db';
import { 
  IUserRepository, 
  IStreamerRepository, 
  ICouponRepository, 
  IReportRepository,
  IAnnouncementRepository,
  IUserCardRepository,
  ITradeRepository,
  INotificationRepository,
  User,
  UserRanking,
  Streamer,
  Coupon,
  CardReport,
  Announcement,
  Trade,
  AppNotification
} from './interfaces';

// 1. SQLite 유저 레포지토리
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
      representative_card_channel_id: row.representative_card_channel_id ?? null,
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

  async updateBanStatus(id: string, bannedUntil: string | null): Promise<void> {
    this.getDb().prepare('UPDATE users SET banned_until = ? WHERE id = ?').run(bannedUntil, id);
  }

  async claimFreeDrawIfEligible(id: string, todayKst: string, nowIso: string): Promise<boolean> {
    // last_free_draw(UTC ISO)를 KST 날짜로 환산하여 오늘과 다를 때만 갱신 → 단일 UPDATE로 원자적 처리
    const result = this.getDb()
      .prepare(
        `UPDATE users SET last_free_draw = ?
         WHERE id = ?
           AND (last_free_draw IS NULL OR date(datetime(last_free_draw, '+9 hours')) <> ?)`
      )
      .run(nowIso, id, todayKst);
    return result.changes > 0;
  }

  async updateLastFreeDraw(id: string, time: string): Promise<void> {
    this.getDb().prepare('UPDATE users SET last_free_draw = ? WHERE id = ?').run(time, id);
  }

  async updateTokens(id: string, accessToken: string | null, refreshToken: string | null, tokenExpiresAt: string | null): Promise<void> {
    this.getDb().prepare('UPDATE users SET access_token = ?, refresh_token = ?, token_expires_at = ? WHERE id = ?')
      .run(accessToken, refreshToken, tokenExpiresAt, id);
  }

  async updateRepresentativeCard(id: string, channelId: string | null): Promise<void> {
    this.getDb().prepare('UPDATE users SET representative_card_channel_id = ? WHERE id = ?').run(channelId, id);
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

  async findRankings(limit: number): Promise<UserRanking[]> {
    // 보유 카드 수와 카드 시세 합산을 조인 집계하여 (포인트 + 카드가치) 총자산 기준 정렬
    // 카드 가치는 별(0~5성) 배수(1 + star*0.6)를 반영하여 합산
    const rows = this.getDb().prepare(`
      SELECT u.*,
             COUNT(uc.id) AS card_count,
             COALESCE(SUM(s.base_value * (1 + COALESCE(uc.star, 0) * 0.6)), 0) AS cards_value
      FROM users u
      LEFT JOIN user_cards uc ON uc.user_id = u.id
      LEFT JOIN streamers s ON s.channel_id = uc.channel_id
      GROUP BY u.id
      ORDER BY (u.point + COALESCE(SUM(s.base_value * (1 + COALESCE(uc.star, 0) * 0.6)), 0)) DESC
      LIMIT ?
    `).all(limit);

    return rows.map((row: any) => ({
      id: row.id,
      username: row.username,
      avatar_url: row.avatar_url,
      role: row.role as 'USER' | 'ADMIN',
      point: row.point,
      last_free_draw: row.last_free_draw,
      banned_until: row.banned_until,
      created_at: row.created_at,
      card_count: row.card_count,
      total_asset: row.point + Math.round(row.cards_value)
    }));
  }
}

// 별(0~5성)별 커스텀 이미지 컬럼명 (인덱스 0 = 0성 = custom_image_url)
export const STAR_IMAGE_COLUMNS = [
  'custom_image_url', 'custom_image_url_1', 'custom_image_url_2',
  'custom_image_url_3', 'custom_image_url_4', 'custom_image_url_5'
];

// row에서 별별 커스텀 이미지 배열을 추출
const extractStarImages = (row: any): (string | null)[] =>
  STAR_IMAGE_COLUMNS.map((col) => row[col] ?? null);

// 2. SQLite 스트리머 레포지토리
export class SqliteStreamerRepository implements IStreamerRepository {
  private getDb() {
    return getSqliteDb();
  }

  async findAll(): Promise<Streamer[]> {
    const rows = this.getDb().prepare('SELECT * FROM streamers ORDER BY base_value DESC').all();
    return rows.map((row: any) => ({
      channel_id: row.channel_id,
      name: row.name,
      logo_url: row.logo_url,
      custom_image_url: row.custom_image_url,
      custom_images: extractStarImages(row),
      is_image_banned: row.is_image_banned === 1,
      follower_count: row.follower_count,
      activity_score: row.activity_score,
      base_value: row.base_value,
      is_active: row.is_active === 1,
      serial_number: row.serial_number || undefined,
      broadcast_count: row.broadcast_count || 0,
      broadcast_minutes: row.broadcast_minutes || 0,
      chat_count: row.chat_count || 0,
      broadcast_multiplier: row.broadcast_multiplier !== undefined ? row.broadcast_multiplier : 1.0,
      prev_value: row.prev_value !== undefined ? row.prev_value : 1000,
      updated_at: row.updated_at
    }));
  }
  async findById(channelId: string): Promise<Streamer | null> {
    const row = this.getDb().prepare('SELECT * FROM streamers WHERE channel_id = ?').get(channelId) as any;
    if (!row) return null;
    return {
      channel_id: row.channel_id,
      name: row.name,
      logo_url: row.logo_url,
      custom_image_url: row.custom_image_url,
      custom_images: extractStarImages(row),
      is_image_banned: row.is_image_banned === 1,
      follower_count: row.follower_count,
      activity_score: row.activity_score,
      base_value: row.base_value,
      is_active: row.is_active === 1,
      serial_number: row.serial_number || undefined,
      broadcast_count: row.broadcast_count || 0,
      broadcast_minutes: row.broadcast_minutes || 0,
      chat_count: row.chat_count || 0,
      broadcast_multiplier: row.broadcast_multiplier !== undefined ? row.broadcast_multiplier : 1.0,
      prev_value: row.prev_value !== undefined ? row.prev_value : 1000,
      updated_at: row.updated_at
    };
  }

  async save(streamer: Streamer): Promise<void> {
    this.getDb().prepare(`
      INSERT INTO streamers (channel_id, name, logo_url, follower_count, activity_score, base_value, is_active, serial_number, broadcast_count, chat_count, broadcast_multiplier, prev_value)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET
        name = excluded.name,
        logo_url = excluded.logo_url,
        follower_count = excluded.follower_count,
        activity_score = excluded.activity_score,
        base_value = excluded.base_value,
        is_active = excluded.is_active,
        serial_number = COALESCE(excluded.serial_number, streamers.serial_number),
        broadcast_count = COALESCE(excluded.broadcast_count, streamers.broadcast_count),
        chat_count = COALESCE(excluded.chat_count, streamers.chat_count),
        broadcast_multiplier = COALESCE(excluded.broadcast_multiplier, streamers.broadcast_multiplier),
        prev_value = COALESCE(excluded.prev_value, streamers.prev_value),
        updated_at = datetime('now')
    `).run(
      streamer.channel_id,
      streamer.name,
      streamer.logo_url,
      streamer.follower_count,
      streamer.activity_score,
      streamer.base_value,
      streamer.is_active ? 1 : 0,
      streamer.serial_number || null,
      streamer.broadcast_count || 0,
      streamer.chat_count || 0,
      streamer.broadcast_multiplier !== undefined ? streamer.broadcast_multiplier : 1.0,
      streamer.prev_value !== undefined ? streamer.prev_value : 1000
    );
  }

  async updateCustomImage(channelId: string, imageUrl: string | null, star: number = 0): Promise<void> {
    const idx = Math.max(0, Math.min(5, Math.floor(star || 0)));
    const col = STAR_IMAGE_COLUMNS[idx];
    this.getDb().prepare(`UPDATE streamers SET ${col} = ?, updated_at = datetime('now') WHERE channel_id = ?`)
      .run(imageUrl, channelId);
  }
  async resetAllCustomImages(channelId: string): Promise<void> {
    const setClause = STAR_IMAGE_COLUMNS.map((c) => `${c} = NULL`).join(', ');
    this.getDb().prepare(`UPDATE streamers SET ${setClause}, updated_at = datetime('now') WHERE channel_id = ?`)
      .run(channelId);
  }
  async delete(channelId: string): Promise<void> {
    // 연관 user_cards/value_history/card_reports 는 FK ON DELETE CASCADE 로 함께 삭제됩니다.
    this.getDb().prepare('DELETE FROM streamers WHERE channel_id = ?').run(channelId);
  }
  async updateImageBanStatus(channelId: string, isBanned: boolean): Promise<void> {
    this.getDb().prepare('UPDATE streamers SET is_image_banned = ?, updated_at = datetime(\'now\') WHERE channel_id = ?')
      .run(isBanned ? 1 : 0, channelId);
  }

  async findStreamerIndex(channelId: string): Promise<number> {
    const rows = this.getDb().prepare('SELECT channel_id FROM streamers ORDER BY channel_id').all() as { channel_id: string }[];
    const index = rows.findIndex(r => r.channel_id === channelId);
    return index !== -1 ? index + 1 : 1;
  }

  async findMaxSerialNumber(): Promise<number> {
    const row = this.getDb().prepare('SELECT MAX(serial_number) as max_sn FROM streamers').get() as any;
    return row && row.max_sn ? row.max_sn : 0;
  }

  async findAllocatedStreamerSerialNumbers(): Promise<number[]> {
    const rows = this.getDb().prepare('SELECT serial_number FROM streamers WHERE serial_number IS NOT NULL ORDER BY serial_number ASC').all() as any[];
    return rows.map(r => r.serial_number);
  }

  async updateLiveStatus(channelId: string, isActive: boolean, followerCount: number): Promise<void> {
    this.getDb().prepare('UPDATE streamers SET is_active = ?, follower_count = ?, updated_at = datetime(\'now\') WHERE channel_id = ?')
      .run(isActive ? 1 : 0, followerCount, channelId);
  }

  async incrementBroadcastCount(channelId: string): Promise<void> {
    this.getDb().prepare('UPDATE streamers SET broadcast_count = broadcast_count + 1, updated_at = datetime(\'now\') WHERE channel_id = ?')
      .run(channelId);
  }

  async incrementBroadcastMinutes(channelId: string, minutes: number): Promise<void> {
    if (minutes <= 0) return;
    this.getDb().prepare('UPDATE streamers SET broadcast_minutes = broadcast_minutes + ? WHERE channel_id = ?')
      .run(minutes, channelId);
  }

  async getValueHistory(channelId: string, sinceIso: string): Promise<{ value: number; recorded_at: string }[]> {
    const rows = this.getDb().prepare(
      `SELECT value, recorded_at FROM value_history
        WHERE channel_id = ? AND datetime(recorded_at) >= datetime(?)
        ORDER BY recorded_at ASC`
    ).all(channelId, sinceIso) as any[];
    return rows.map(r => ({ value: r.value, recorded_at: r.recorded_at }));
  }

  async count(): Promise<number> {
    const row = this.getDb().prepare('SELECT COUNT(*) AS c FROM streamers').get() as any;
    return row?.c || 0;
  }

  async incrementChatCount(channelId: string, count: number = 1): Promise<void> {
    this.getDb().prepare('UPDATE streamers SET chat_count = chat_count + ?, updated_at = datetime(\'now\') WHERE channel_id = ?')
      .run(count, channelId);
  }

  async updateValueMetrics(channelId: string, prevValue: number, baseValue: number, activityScore: number, multiplier: number): Promise<void> {
    this.getDb().prepare(
      `UPDATE streamers
         SET prev_value = ?, base_value = ?, activity_score = ?, broadcast_multiplier = ?, updated_at = datetime('now')
       WHERE channel_id = ?`
    ).run(prevValue, baseValue, activityScore, multiplier, channelId);
  }

  async decrementChatCount(channelId: string, amount: number): Promise<void> {
    if (amount <= 0) return;
    // 집계 도중 새로 들어온 채팅이 음수가 되지 않도록 0 하한 적용
    this.getDb().prepare(
      `UPDATE streamers SET chat_count = MAX(chat_count - ?, 0) WHERE channel_id = ?`
    ).run(amount, channelId);
  }

  async recordValueHistory(channelId: string, value: number): Promise<void> {
    this.getDb().prepare('INSERT INTO value_history (channel_id, value) VALUES (?, ?)').run(channelId, value);
    // 8일(192시간)보다 오래된 이력은 정리하여 테이블 비대화 방지
    this.getDb().prepare(
      `DELETE FROM value_history WHERE channel_id = ? AND datetime(recorded_at) < datetime('now', '-8 days')`
    ).run(channelId);
  }

  // 채널별로 지정한 시간 경계에 가장 근접한(경계 이전 중 가장 최근) 시세를 선택
  private valueAgoMap(modifier: string): Record<string, number> {
    const rows = this.getDb().prepare(
      `SELECT vh.channel_id AS channel_id, vh.value AS value
         FROM value_history vh
         JOIN (
           SELECT channel_id, MAX(recorded_at) AS latest
             FROM value_history
            WHERE datetime(recorded_at) <= datetime('now', ?)
            GROUP BY channel_id
         ) latest_old
           ON vh.channel_id = latest_old.channel_id AND vh.recorded_at = latest_old.latest`
    ).all(modifier) as any[];

    const map: Record<string, number> = {};
    for (const r of rows) {
      map[r.channel_id] = r.value;
    }
    return map;
  }

  async getValue24hAgoMap(): Promise<Record<string, number>> {
    return this.valueAgoMap('-24 hours');
  }

  async getValue1hAgoMap(): Promise<Record<string, number>> {
    return this.valueAgoMap('-1 hours');
  }
}
// 3. SQLite 쿠폰 레포지토리
export class SqliteCouponRepository implements ICouponRepository {
  private getDb() {
    return getSqliteDb();
  }

  private mapCoupon(row: any): Coupon {
    return {
      id: row.id,
      code: row.code,
      coupon_type: row.coupon_type as 'single' | 'multi',
      reward_type: (row.reward_type || 'point') as 'point' | 'card' | 'cosmetic',
      points: row.points,
      reward_channel_id: row.reward_channel_id ?? null,
      reward_item_id: row.reward_item_id ?? null,
      reward_quantity: row.reward_quantity ?? 0,
      max_uses: row.max_uses,
      used_count: row.used_count,
      expires_at: row.expires_at,
      created_at: row.created_at
    };
  }

  async findByCode(code: string): Promise<Coupon | null> {
    const row = this.getDb().prepare('SELECT * FROM coupons WHERE code = ?').get(code) as any;
    return row ? this.mapCoupon(row) : null;
  }

  async create(coupon: Coupon): Promise<Coupon> {
    const result = this.getDb().prepare(
      `INSERT INTO coupons (code, coupon_type, reward_type, points, reward_channel_id, reward_item_id, reward_quantity, max_uses, used_count, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      coupon.code,
      coupon.coupon_type,
      coupon.reward_type,
      coupon.points,
      coupon.reward_channel_id,
      coupon.reward_item_id ?? null,
      coupon.reward_quantity,
      coupon.max_uses,
      coupon.used_count,
      coupon.expires_at
    );

    coupon.id = Number(result.lastInsertRowid);
    return coupon;
  }

  async incrementUsedCount(couponId: number): Promise<void> {
    this.getDb().prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(couponId);
  }

  async findAll(): Promise<Coupon[]> {
    const rows = this.getDb().prepare('SELECT * FROM coupons ORDER BY id DESC').all() as any[];
    return rows.map(row => this.mapCoupon(row));
  }

  async checkCouponRedeemed(couponId: number, userId: string): Promise<boolean> {
    const row = this.getDb().prepare('SELECT 1 FROM coupon_logs WHERE coupon_id = ? AND user_id = ?').get(couponId, userId);
    return !!row;
  }

  async logCouponRedeem(couponId: number, userId: string): Promise<boolean> {
    try {
      this.getDb().prepare('INSERT INTO coupon_logs (coupon_id, user_id) VALUES (?, ?)').run(couponId, userId);
      return true;
    } catch (err: any) {
      // UNIQUE(coupon_id, user_id) 제약 위반 = 이미 사용한 쿠폰 (동시 요청 포함)
      if (err && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
        return false;
      }
      throw err;
    }
  }
}

// 4. SQLite 신고 레포지토리
export class SqliteReportRepository implements IReportRepository {
  private getDb() {
    return getSqliteDb();
  }

  async findAll(): Promise<CardReport[]> {
    const rows = this.getDb().prepare('SELECT * FROM card_reports ORDER BY id DESC').all();
    return rows.map((row: any) => ({
      id: row.id,
      reporter_id: row.reporter_id,
      channel_id: row.channel_id,
      reported_image_url: row.reported_image_url,
      reason: row.reason,
      status: row.status as 'pending' | 'resolved' | 'rejected',
      created_at: row.created_at
    }));
  }

  async create(report: CardReport): Promise<CardReport> {
    const result = this.getDb().prepare(
      'INSERT INTO card_reports (reporter_id, channel_id, reported_image_url, reason, status) VALUES (?, ?, ?, ?, ?)'
    ).run(report.reporter_id, report.channel_id, report.reported_image_url, report.reason, report.status);

    report.id = Number(result.lastInsertRowid);
    return report;
  }

  async updateStatus(reportId: number, status: 'resolved' | 'rejected'): Promise<void> {
    this.getDb().prepare('UPDATE card_reports SET status = ? WHERE id = ?').run(status, reportId);
  }

  async countPending(): Promise<number> {
    const row = this.getDb().prepare("SELECT COUNT(*) AS c FROM card_reports WHERE status = 'pending'").get() as any;
    return row?.c || 0;
  }
}

// 5. SQLite 공지사항 레포지토리
export class SqliteAnnouncementRepository implements IAnnouncementRepository {
  private getDb() {
    return getSqliteDb();
  }

  async findAll(): Promise<Announcement[]> {
    const rows = this.getDb().prepare('SELECT * FROM announcements ORDER BY id DESC').all();
    return rows.map((row: any) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      is_popup: row.is_popup === 1,
      popup_expires_at: row.popup_expires_at,
      created_at: row.created_at
    }));
  }

  async findActivePopups(): Promise<Announcement[]> {
    // 현재 시각 기준으로 유효한 팝업만 추출
    const rows = this.getDb().prepare(`
      SELECT * FROM announcements 
      WHERE is_popup = 1 
        AND (popup_expires_at IS NULL OR datetime(popup_expires_at) > datetime('now')) 
      ORDER BY id DESC
    `).all();

    return rows.map((row: any) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      is_popup: true,
      popup_expires_at: row.popup_expires_at,
      created_at: row.created_at
    }));
  }

  async create(announcement: Announcement): Promise<Announcement> {
    const result = this.getDb().prepare(
      'INSERT INTO announcements (title, content, is_popup, popup_expires_at) VALUES (?, ?, ?, ?)'
    ).run(
      announcement.title, 
      announcement.content, 
      announcement.is_popup ? 1 : 0, 
      announcement.popup_expires_at
    );

    announcement.id = Number(result.lastInsertRowid);
    return announcement;
  }

  async updatePopup(id: number, isPopup: boolean, popupExpiresAt: string | null): Promise<void> {
    this.getDb().prepare('UPDATE announcements SET is_popup = ?, popup_expires_at = ? WHERE id = ?')
      .run(isPopup ? 1 : 0, popupExpiresAt, id);
  }

  async delete(id: number): Promise<void> {
    this.getDb().prepare('DELETE FROM announcements WHERE id = ?').run(id);
  }
}

// 6. SQLite 유저 보유 카드 레포지토리
export class SqliteUserCardRepository implements IUserCardRepository {
  private getDb() {
    return getSqliteDb();
  }

  async create(card: any): Promise<any> {
    const result = this.getDb().prepare(
      'INSERT INTO user_cards (user_id, channel_id, serial_number, star) VALUES (?, ?, ?, ?)'
    ).run(card.user_id, card.channel_id, card.serial_number, card.star ?? 0);
    card.id = Number(result.lastInsertRowid);
    return card;
  }

  // 같은 스트리머·같은 별 카드 2장 → 1장(별+1). better-sqlite3 트랜잭션으로 원자 처리
  async fuse(userId: string, channelId: string, star: number): Promise<{ ok: boolean; reason: string; newStar?: number }> {
    if (star >= 5) return { ok: false, reason: 'MAX_STAR' };
    const db = this.getDb();
    const txn = db.transaction(() => {
      // 1) 업그레이드 대상: 현재 star인 카드 1장
      const target = db.prepare(
        'SELECT id FROM user_cards WHERE user_id = ? AND channel_id = ? AND COALESCE(star,0) = ? ORDER BY id ASC LIMIT 1'
      ).get(userId, channelId, star) as any;
      if (!target) throw new Error('NO_TARGET');
      // 2) 한계돌파 재료: 같은 스트리머의 0성 카드 1장 (대상과 다른 카드)
      const fodder = db.prepare(
        'SELECT id FROM user_cards WHERE user_id = ? AND channel_id = ? AND COALESCE(star,0) = 0 AND id <> ? ORDER BY id ASC LIMIT 1'
      ).get(userId, channelId, target.id) as any;
      if (!fodder) throw new Error('NO_FODDER');
      // 대상 카드의 별을 1 올리고, 재료 0성 카드는 소모(삭제)
      db.prepare('UPDATE user_cards SET star = ? WHERE id = ?').run(star + 1, target.id);
      db.prepare('DELETE FROM user_cards WHERE id = ?').run(fodder.id);
    });
    try {
      txn();
      return { ok: true, reason: 'OK', newStar: star + 1 };
    } catch (e: any) {
      return { ok: false, reason: e.message || 'FAILED' };
    }
  }

  async findByUserId(userId: string): Promise<any[]> {
    const rows = this.getDb().prepare(`
      SELECT uc.*, s.name as streamer_name, s.logo_url as streamer_logo, s.custom_image_url as streamer_custom_image,
             s.custom_image_url_1 as sci1, s.custom_image_url_2 as sci2, s.custom_image_url_3 as sci3,
             s.custom_image_url_4 as sci4, s.custom_image_url_5 as sci5,
             s.base_value as streamer_base_value, s.follower_count as streamer_follower,
             s.is_active as streamer_is_active, s.is_image_banned as streamer_is_image_banned,
             s.serial_number as streamer_serial,
             bi.id as border_id, bi.style_json as border_style,
             ni.id as name_id, ni.style_json as name_style, ni.font_url as name_font_url, ni.font_family as name_font_family
      FROM user_cards uc
      JOIN streamers s ON uc.channel_id = s.channel_id
      LEFT JOIN shop_items bi ON uc.border_item_id = bi.id
      LEFT JOIN shop_items ni ON uc.name_effect_item_id = ni.id
      WHERE uc.user_id = ?
      ORDER BY uc.id DESC
    `).all(userId);

    return rows.map((row: any) => ({
      id: row.id,
      user_id: row.user_id,
      channel_id: row.channel_id,
      serial_number: row.serial_number,
      star: row.star ?? 0,
      border_item_id: row.border_item_id ?? null,
      name_effect_item_id: row.name_effect_item_id ?? null,
      border: row.border_id ? { id: row.border_id, style_json: row.border_style } : null,
      name_effect: row.name_id ? { id: row.name_id, style_json: row.name_style, font_url: row.name_font_url, font_family: row.name_font_family } : null,
      acquired_at: row.acquired_at,
      streamer: {
        channel_id: row.channel_id,
        name: row.streamer_name,
        logo_url: row.streamer_logo,
        custom_image_url: row.streamer_custom_image,
        custom_images: [row.streamer_custom_image ?? null, row.sci1 ?? null, row.sci2 ?? null, row.sci3 ?? null, row.sci4 ?? null, row.sci5 ?? null],
        base_value: row.streamer_base_value,
        follower_count: row.streamer_follower,
        is_image_banned: row.streamer_is_image_banned === 1,
        activity_score: 0,
        is_active: row.streamer_is_active === 1,
        serial_number: row.streamer_serial || undefined
      }
    }));
  }

  async findLatestSerialNumber(channelId: string): Promise<number> {
    const row = this.getDb().prepare(
      'SELECT MAX(serial_number) as max_sn FROM user_cards WHERE channel_id = ?'
    ).get(channelId) as any;
    return row && row.max_sn ? row.max_sn : 0;
  }

  async findAllocatedSerialNumbers(channelId: string): Promise<number[]> {
    const rows = this.getDb().prepare(
      'SELECT serial_number FROM user_cards WHERE channel_id = ? ORDER BY serial_number ASC'
    ).all(channelId) as any[];
    return rows.map(r => r.serial_number);
  }

  async deleteCards(userId: string, channelId: string, count: number): Promise<number> {
    // 특정 개수만큼만 삭제하기 위해 rowid 또는 id를 조회해서 IN 절로 삭제합니다.
    const rows = this.getDb().prepare(
      'SELECT id FROM user_cards WHERE user_id = ? AND channel_id = ? ORDER BY id ASC LIMIT ?'
    ).all(userId, channelId, count) as { id: number }[];
    
    if (rows.length === 0) return 0;
    
    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const result = this.getDb().prepare(
      `DELETE FROM user_cards WHERE id IN (${placeholders})`
    ).run(...ids);

    return result.changes;
  }

  async count(): Promise<number> {
    const row = this.getDb().prepare('SELECT COUNT(*) AS c FROM user_cards').get() as any;
    return row?.c || 0;
  }

  async findByChannel(channelId: string): Promise<{ user_id: string; star: number }[]> {
    const rows = this.getDb().prepare(
      'SELECT user_id, COALESCE(star, 0) AS star FROM user_cards WHERE channel_id = ?'
    ).all(channelId) as any[];
    return rows.map(r => ({ user_id: r.user_id, star: r.star || 0 }));
  }

  async deleteByChannel(channelId: string): Promise<number> {
    const result = this.getDb().prepare('DELETE FROM user_cards WHERE channel_id = ?').run(channelId);
    return result.changes;
  }
}

// 7. SQLite 거래(1:1 교환) 레포지토리
export class SqliteTradeRepository implements ITradeRepository {
  private getDb() {
    return getSqliteDb();
  }

  private mapRow(row: any): Trade {
    return {
      id: row.id,
      sender_id: row.sender_id,
      receiver_id: row.receiver_id,
      sender_offer: JSON.parse(row.sender_offer),
      receiver_offer: JSON.parse(row.receiver_offer),
      status: row.status,
      created_at: row.created_at,
      completed_at: row.completed_at,
      sender_username: row.sender_username,
      receiver_username: row.receiver_username
    };
  }

  async create(trade: Pick<Trade, 'sender_id' | 'receiver_id' | 'sender_offer' | 'receiver_offer'>): Promise<Trade> {
    const result = this.getDb().prepare(
      `INSERT INTO trades (sender_id, receiver_id, sender_offer, receiver_offer, status)
       VALUES (?, ?, ?, ?, 'PENDING')`
    ).run(
      trade.sender_id,
      trade.receiver_id,
      JSON.stringify(trade.sender_offer),
      JSON.stringify(trade.receiver_offer)
    );
    return {
      id: Number(result.lastInsertRowid),
      ...trade,
      status: 'PENDING'
    };
  }

  async findById(id: number): Promise<Trade | null> {
    const row = this.getDb().prepare('SELECT * FROM trades WHERE id = ?').get(id) as any;
    return row ? this.mapRow(row) : null;
  }

  async findActiveByUser(userId: string): Promise<Trade[]> {
    const rows = this.getDb().prepare(`
      SELECT t.*, su.username AS sender_username, ru.username AS receiver_username
        FROM trades t
        LEFT JOIN users su ON su.id = t.sender_id
        LEFT JOIN users ru ON ru.id = t.receiver_id
       WHERE t.status IN ('PENDING','CONFIRMED') AND (t.sender_id = ? OR t.receiver_id = ?)
       ORDER BY t.id DESC
    `).all(userId, userId) as any[];
    return rows.map(r => this.mapRow(r));
  }

  async findHistoryByUser(userId: string, limit: number): Promise<Trade[]> {
    const rows = this.getDb().prepare(`
      SELECT t.*, su.username AS sender_username, ru.username AS receiver_username
        FROM trades t
        LEFT JOIN users su ON su.id = t.sender_id
        LEFT JOIN users ru ON ru.id = t.receiver_id
       WHERE t.status IN ('ACCEPTED','REJECTED','CANCELLED') AND (t.sender_id = ? OR t.receiver_id = ?)
       ORDER BY t.id DESC
       LIMIT ?
    `).all(userId, userId, limit) as any[];
    return rows.map(r => this.mapRow(r));
  }

  async updateStatus(id: number, status: Trade['status']): Promise<void> {
    this.getDb().prepare('UPDATE trades SET status = ? WHERE id = ?').run(status, id);
  }

  async countCompleted(): Promise<number> {
    const row = this.getDb().prepare("SELECT COUNT(*) AS c FROM trades WHERE status = 'ACCEPTED'").get() as any;
    return row?.c || 0;
  }

  // 1단계: 수신자 동의 (PENDING → CONFIRMED)
  async confirm(id: number, actorId: string): Promise<{ ok: boolean; reason: string }> {
    const row = this.getDb().prepare('SELECT * FROM trades WHERE id = ?').get(id) as any;
    if (!row) return { ok: false, reason: 'NOT_FOUND' };
    if (row.status !== 'PENDING') return { ok: false, reason: 'NOT_PENDING' };
    if (row.receiver_id !== actorId) return { ok: false, reason: 'FORBIDDEN' };
    this.getDb().prepare("UPDATE trades SET status = 'CONFIRMED' WHERE id = ?").run(id);
    return { ok: true, reason: 'OK' };
  }

  // 2단계: 제안자 최종 승인 및 원자적 체결 (CONFIRMED → ACCEPTED)
  async finalize(id: number, actorId: string): Promise<{ ok: boolean; reason: string }> {
    const db = this.getDb();

    // 카드 channel_id(+star)+count 만큼 소유자를 from→to로 이전하는 헬퍼 (부족 시 throw)
    const moveCards = (fromId: string, toId: string, cards: { channel_id: string; star?: number; count: number }[]) => {
      for (const c of cards) {
        if (!c.channel_id || !c.count || c.count <= 0) continue;
        const hasStar = c.star !== undefined && c.star !== null;
        const owned = hasStar
          ? db.prepare(
              'SELECT id FROM user_cards WHERE user_id = ? AND channel_id = ? AND star = ? ORDER BY id ASC LIMIT ?'
            ).all(fromId, c.channel_id, c.star, c.count) as { id: number }[]
          : db.prepare(
              'SELECT id FROM user_cards WHERE user_id = ? AND channel_id = ? ORDER BY id ASC LIMIT ?'
            ).all(fromId, c.channel_id, c.count) as { id: number }[];
        if (owned.length < c.count) {
          throw new Error('CARD_SHORTAGE');
        }
        const ids = owned.map(o => o.id);
        const placeholders = ids.map(() => '?').join(',');
        db.prepare(`UPDATE user_cards SET user_id = ? WHERE id IN (${placeholders})`).run(toId, ...ids);
      }
    };

    const txn = db.transaction(() => {
      const row = db.prepare('SELECT * FROM trades WHERE id = ?').get(id) as any;
      if (!row) throw new Error('NOT_FOUND');
      if (row.status !== 'CONFIRMED') throw new Error('NOT_CONFIRMED');
      if (row.sender_id !== actorId) throw new Error('FORBIDDEN');

      const senderOffer = JSON.parse(row.sender_offer);
      const receiverOffer = JSON.parse(row.receiver_offer);
      const senderOut = Number(senderOffer.point || 0);
      const receiverOut = Number(receiverOffer.point || 0);

      // 포인트 잔액 검증
      const sender = db.prepare('SELECT point FROM users WHERE id = ?').get(row.sender_id) as any;
      const receiver = db.prepare('SELECT point FROM users WHERE id = ?').get(row.receiver_id) as any;
      if (!sender || !receiver) throw new Error('USER_NOT_FOUND');
      if (sender.point < senderOut) throw new Error('SENDER_POINT_SHORT');
      if (receiver.point < receiverOut) throw new Error('RECEIVER_POINT_SHORT');

      // 카드 이전 (양방향)
      moveCards(row.sender_id, row.receiver_id, senderOffer.cards || []);
      moveCards(row.receiver_id, row.sender_id, receiverOffer.cards || []);

      // 포인트 정산 (양방향 동시 반영)
      db.prepare('UPDATE users SET point = point - ? + ? WHERE id = ?').run(senderOut, receiverOut, row.sender_id);
      db.prepare('UPDATE users SET point = point - ? + ? WHERE id = ?').run(receiverOut, senderOut, row.receiver_id);

      // 거래 체결 처리
      db.prepare("UPDATE trades SET status = 'ACCEPTED', completed_at = datetime('now') WHERE id = ?").run(id);
    });

    try {
      txn();
      return { ok: true, reason: 'OK' };
    } catch (err: any) {
      return { ok: false, reason: err.message || 'FAILED' };
    }
  }
}

// 8. SQLite 인앱 알림 레포지토리
export class SqliteNotificationRepository implements INotificationRepository {
  private getDb() {
    return getSqliteDb();
  }

  async create(n: Pick<AppNotification, 'user_id' | 'title' | 'body' | 'link'>): Promise<void> {
    this.getDb().prepare(
      'INSERT INTO notifications (user_id, title, body, link) VALUES (?, ?, ?, ?)'
    ).run(n.user_id, n.title, n.body ?? null, n.link ?? null);
  }

  async findByUser(userId: string, limit: number): Promise<AppNotification[]> {
    const rows = this.getDb().prepare(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?'
    ).all(userId, limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      title: r.title,
      body: r.body,
      link: r.link,
      is_read: r.is_read === 1,
      created_at: r.created_at
    }));
  }

  async countUnread(userId: string): Promise<number> {
    const row = this.getDb().prepare(
      'SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0'
    ).get(userId) as any;
    return row?.c || 0;
  }

  async markRead(id: number, userId: string): Promise<void> {
    this.getDb().prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(id, userId);
  }

  async markAllRead(userId: string): Promise<void> {
    this.getDb().prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(userId);
  }
}
