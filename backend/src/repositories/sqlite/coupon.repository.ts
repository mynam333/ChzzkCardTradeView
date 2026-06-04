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
