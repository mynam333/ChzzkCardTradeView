import { getSqliteDb } from '../services/db';
import { 
  IUserRepository, 
  IStreamerRepository, 
  ICouponRepository, 
  IReportRepository,
  IAnnouncementRepository,
  IUserCardRepository,
  User,
  Streamer,
  Coupon,
  CardReport,
  Announcement
} from './interfaces';

// 1. SQLite 유저 레포지토리
export class SqliteUserRepository implements IUserRepository {
  private getDb() {
    return getSqliteDb();
  }

  async findById(id: string): Promise<User | null> {
    const row = this.getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      avatar_url: row.avatar_url,
      role: row.role as 'USER' | 'ADMIN',
      point: row.point,
      last_free_draw: row.last_free_draw,
      banned_until: row.banned_until,
      access_token: row.access_token,
      refresh_token: row.refresh_token,
      created_at: row.created_at
    };
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

  async updateBanStatus(id: string, bannedUntil: string | null): Promise<void> {
    this.getDb().prepare('UPDATE users SET banned_until = ? WHERE id = ?').run(bannedUntil, id);
  }

  async updateLastFreeDraw(id: string, time: string): Promise<void> {
    this.getDb().prepare('UPDATE users SET last_free_draw = ? WHERE id = ?').run(time, id);
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

  async findRankings(limit: number): Promise<User[]> {
    const rows = this.getDb().prepare('SELECT * FROM users ORDER BY point DESC LIMIT ?').all(limit);
    return rows.map((row: any) => ({
      id: row.id,
      username: row.username,
      avatar_url: row.avatar_url,
      role: row.role as 'USER' | 'ADMIN',
      point: row.point,
      last_free_draw: row.last_free_draw,
      banned_until: row.banned_until,
      created_at: row.created_at
    }));
  }
}

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
      is_image_banned: row.is_image_banned === 1,
      follower_count: row.follower_count,
      activity_score: row.activity_score,
      base_value: row.base_value,
      is_active: row.is_active === 1,
      serial_number: row.serial_number || undefined,
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
      is_image_banned: row.is_image_banned === 1,
      follower_count: row.follower_count,
      activity_score: row.activity_score,
      base_value: row.base_value,
      is_active: row.is_active === 1,
      serial_number: row.serial_number || undefined,
      updated_at: row.updated_at
    };
  }

  async save(streamer: Streamer): Promise<void> {
    this.getDb().prepare(`
      INSERT INTO streamers (channel_id, name, logo_url, follower_count, activity_score, base_value, is_active, serial_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET
        name = excluded.name,
        logo_url = excluded.logo_url,
        follower_count = excluded.follower_count,
        activity_score = excluded.activity_score,
        base_value = excluded.base_value,
        is_active = excluded.is_active,
        serial_number = COALESCE(excluded.serial_number, streamers.serial_number),
        updated_at = datetime('now')
    `).run(
      streamer.channel_id,
      streamer.name,
      streamer.logo_url,
      streamer.follower_count,
      streamer.activity_score,
      streamer.base_value,
      streamer.is_active ? 1 : 0,
      streamer.serial_number || null
    );
  }

  async updateCustomImage(channelId: string, imageUrl: string | null): Promise<void> {
    this.getDb().prepare('UPDATE streamers SET custom_image_url = ?, updated_at = datetime(\'now\') WHERE channel_id = ?')
      .run(imageUrl, channelId);
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
}
// 3. SQLite 쿠폰 레포지토리
export class SqliteCouponRepository implements ICouponRepository {
  private getDb() {
    return getSqliteDb();
  }

  async findByCode(code: string): Promise<Coupon | null> {
    const row = this.getDb().prepare('SELECT * FROM coupons WHERE code = ?').get(code) as any;
    if (!row) return null;
    return {
      id: row.id,
      code: row.code,
      coupon_type: row.coupon_type as 'single' | 'multi',
      points: row.points,
      max_uses: row.max_uses,
      used_count: row.used_count,
      expires_at: row.expires_at,
      created_at: row.created_at
    };
  }

  async create(coupon: Coupon): Promise<Coupon> {
    const result = this.getDb().prepare(
      'INSERT INTO coupons (code, coupon_type, points, max_uses, used_count, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(coupon.code, coupon.coupon_type, coupon.points, coupon.max_uses, coupon.used_count, coupon.expires_at);
    
    coupon.id = Number(result.lastInsertRowid);
    return coupon;
  }

  async incrementUsedCount(couponId: number): Promise<void> {
    this.getDb().prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(couponId);
  }

  async checkCouponRedeemed(couponId: number, userId: string): Promise<boolean> {
    const row = this.getDb().prepare('SELECT 1 FROM coupon_logs WHERE coupon_id = ? AND user_id = ?').get(couponId, userId);
    return !!row;
  }

  async logCouponRedeem(couponId: number, userId: string): Promise<void> {
    this.getDb().prepare('INSERT INTO coupon_logs (coupon_id, user_id) VALUES (?, ?)').run(couponId, userId);
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
      'INSERT INTO user_cards (user_id, channel_id, serial_number) VALUES (?, ?, ?)'
    ).run(card.user_id, card.channel_id, card.serial_number);
    card.id = Number(result.lastInsertRowid);
    return card;
  }

  async findByUserId(userId: string): Promise<any[]> {
    const rows = this.getDb().prepare(`
      SELECT uc.*, s.name as streamer_name, s.logo_url as streamer_logo, s.custom_image_url as streamer_custom_image, s.base_value as streamer_base_value, s.follower_count as streamer_follower
      FROM user_cards uc
      JOIN streamers s ON uc.channel_id = s.channel_id
      WHERE uc.user_id = ?
      ORDER BY uc.id DESC
    `).all(userId);

    return rows.map((row: any) => ({
      id: row.id,
      user_id: row.user_id,
      channel_id: row.channel_id,
      serial_number: row.serial_number,
      acquired_at: row.acquired_at,
      streamer: {
        channel_id: row.channel_id,
        name: row.streamer_name,
        logo_url: row.streamer_logo,
        custom_image_url: row.streamer_custom_image,
        base_value: row.streamer_base_value,
        follower_count: row.streamer_follower,
        is_image_banned: false,
        activity_score: 0,
        is_active: false
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
}
