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
  CouponRedeemResult,
  CardReport,
  Announcement,
  Trade,
  AppNotification
} from '../interfaces';

export class SqliteCouponRepository implements ICouponRepository {
  private getDb() {
    return getSqliteDb();
  }

  private mapCoupon(row: any): Coupon {
    return {
      id: row.id,
      code: row.code,
      coupon_type: row.coupon_type as 'single' | 'multi',
      reward_type: (row.reward_type || 'point') as 'point' | 'card' | 'cosmetic' | 'minigame_ticket' | 'free_draw_ticket',
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
    const row = this.getDb()
      .prepare('SELECT * FROM coupons WHERE code = ? COLLATE NOCASE')
      .get(code) as any;
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

  async redeemAtomic(couponId: number, userId: string): Promise<CouponRedeemResult> {
    const db = this.getDb();
    const txn = db.transaction((): CouponRedeemResult => {
      const couponRow = db.prepare('SELECT * FROM coupons WHERE id = ?').get(couponId) as any;
      if (!couponRow) return { ok: false, reason: 'NOT_FOUND' };
      const coupon = this.mapCoupon(couponRow);

      if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) {
        return { ok: false, reason: 'EXPIRED' };
      }
      if (coupon.coupon_type === 'single' && coupon.used_count >= coupon.max_uses) {
        return { ok: false, reason: 'SOLD_OUT' };
      }
      if (coupon.reward_type === 'card' && !coupon.reward_channel_id) {
        return { ok: false, reason: 'INVALID_REWARD' };
      }
      if (coupon.reward_type === 'cosmetic' && !coupon.reward_item_id) {
        return { ok: false, reason: 'INVALID_REWARD' };
      }
      if ((coupon.reward_type === 'minigame_ticket' || coupon.reward_type === 'free_draw_ticket') && coupon.reward_quantity <= 0) {
        return { ok: false, reason: 'INVALID_REWARD' };
      }

      try {
        db.prepare('INSERT INTO coupon_logs (coupon_id, user_id) VALUES (?, ?)').run(couponId, userId);
      } catch (err: any) {
        if (err && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
          return { ok: false, reason: 'DUPLICATE' };
        }
        throw err;
      }

      db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(couponId);

      if (coupon.reward_type === 'card') {
        const latest = db.prepare('SELECT COALESCE(MAX(serial_number), 0) AS max_sn FROM user_cards WHERE channel_id = ?')
          .get(coupon.reward_channel_id) as any;
        const baseSn = Number(latest?.max_sn || 0);
        for (let i = 1; i <= coupon.reward_quantity; i++) {
          db.prepare('INSERT INTO user_cards (user_id, channel_id, serial_number, star) VALUES (?, ?, ?, 0)')
            .run(userId, coupon.reward_channel_id, baseSn + i);
        }
        return {
          ok: true,
          reason: 'OK',
          reward_type: 'card',
          reward_channel_id: coupon.reward_channel_id,
          reward_quantity: coupon.reward_quantity,
          points_added: 0
        };
      }

      if (coupon.reward_type === 'cosmetic') {
        db.prepare(`
          INSERT INTO user_cosmetics (user_id, item_id, quantity) VALUES (?, ?, ?)
          ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity
        `).run(userId, coupon.reward_item_id, coupon.reward_quantity);
        return {
          ok: true,
          reason: 'OK',
          reward_type: 'cosmetic',
          reward_item_id: coupon.reward_item_id,
          reward_quantity: coupon.reward_quantity,
          points_added: 0
        };
      }

      if (coupon.reward_type === 'minigame_ticket') {
        const now = new Date().toISOString();
        db.prepare(`
          INSERT INTO user_minigame_tickets (user_id, current_tickets, bonus_tickets, last_charged_at, updated_at)
          VALUES (?, 5, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            bonus_tickets = bonus_tickets + excluded.bonus_tickets,
            updated_at = excluded.updated_at
        `).run(userId, coupon.reward_quantity, now, now);
        return {
          ok: true,
          reason: 'OK',
          reward_type: 'minigame_ticket',
          reward_quantity: coupon.reward_quantity,
          points_added: 0
        };
      }

      if (coupon.reward_type === 'free_draw_ticket') {
        db.prepare(`
          UPDATE users
             SET bonus_free_draw_tickets = COALESCE(bonus_free_draw_tickets, 0) + ?
           WHERE id = ?
        `).run(coupon.reward_quantity, userId);
        return {
          ok: true,
          reason: 'OK',
          reward_type: 'free_draw_ticket',
          reward_quantity: coupon.reward_quantity,
          points_added: 0
        };
      }

      db.prepare('UPDATE users SET point = point + ? WHERE id = ?').run(coupon.points, userId);
      const updated = db.prepare('SELECT point FROM users WHERE id = ?').get(userId) as any;
      return {
        ok: true,
        reason: 'OK',
        reward_type: 'point',
        points_added: coupon.points,
        new_points: updated?.point ?? coupon.points
      };
    });

    return txn();
  }
}

// 4. SQLite 신고 레포지토리
