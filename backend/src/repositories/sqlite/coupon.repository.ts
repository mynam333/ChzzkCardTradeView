import { getSqliteDb } from "../../services/db";
import { recordSqlitePointLedger } from "../../services/pointLedger";
import { recordSqliteAssetEvent } from "../../services/assetEventLog";
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
import { couponToRewards, parseCouponRewards, rewardsToJson } from '../../utils/couponRewards';

export class SqliteCouponRepository implements ICouponRepository {
  private getDb() {
    return getSqliteDb();
  }

  private mapCoupon(row: any): Coupon {
    return {
      id: row.id,
      code: row.code,
      coupon_type: row.coupon_type as 'single' | 'multi',
      reward_type: (row.reward_type || 'point') as Coupon['reward_type'],
      points: row.points,
      reward_channel_id: row.reward_channel_id ?? null,
      reward_item_id: row.reward_item_id ?? null,
      reward_quantity: row.reward_quantity ?? 0,
      rewards: parseCouponRewards(row.rewards),
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
    const rewards = couponToRewards(coupon);
    const result = this.getDb().prepare(
      `INSERT INTO coupons (code, coupon_type, reward_type, points, reward_channel_id, reward_item_id, reward_quantity, rewards, max_uses, used_count, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      coupon.code,
      coupon.coupon_type,
      coupon.reward_type,
      coupon.points,
      coupon.reward_channel_id,
      coupon.reward_item_id ?? null,
      coupon.reward_quantity,
      rewardsToJson(rewards),
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
      const rewards = couponToRewards(coupon);
      if (rewards.length === 0) return { ok: false, reason: 'INVALID_REWARD' };
      for (const reward of rewards) {
        const quantity = Number(reward.quantity || 0);
        if (reward.type === 'point' && Number(reward.points || 0) <= 0) return { ok: false, reason: 'INVALID_REWARD' };
        if (reward.type === 'card' && (!reward.channel_id || quantity <= 0)) return { ok: false, reason: 'INVALID_REWARD' };
        if (reward.type === 'cosmetic' && (!reward.item_id || quantity <= 0)) return { ok: false, reason: 'INVALID_REWARD' };
        if (reward.type === 'title' && !reward.title_id) return { ok: false, reason: 'INVALID_REWARD' };
        if ((reward.type === 'minigame_ticket' || reward.type === 'free_draw_ticket') && quantity <= 0) return { ok: false, reason: 'INVALID_REWARD' };
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

      let pointsAdded = 0;
      for (const reward of rewards) {
        if (reward.type === 'point') {
          const points = Number(reward.points || 0);
          db.prepare('UPDATE users SET point = point + ? WHERE id = ?').run(points, userId);
          pointsAdded += points;
          recordSqlitePointLedger(db, {
            userId,
            amount: points,
            sourceType: 'coupon',
            sourceId: couponId,
            reason: 'coupon_redeem',
            description: `쿠폰 ${coupon.code} 사용 보상`,
            metadata: { coupon_id: couponId, coupon_code: coupon.code }
          });
        } else if (reward.type === 'card') {
          const quantity = Number(reward.quantity || 0);
          const latest = db.prepare('SELECT COALESCE(MAX(serial_number), 0) AS max_sn FROM user_cards WHERE channel_id = ?')
            .get(reward.channel_id) as any;
          const baseSn = Number(latest?.max_sn || 0);
          for (let i = 1; i <= quantity; i++) {
            const result = db.prepare('INSERT INTO user_cards (user_id, channel_id, serial_number, star) VALUES (?, ?, ?, 0)')
              .run(userId, reward.channel_id, baseSn + i);
            recordSqliteAssetEvent(db, {
              userId,
              assetType: 'card',
              action: 'add',
              quantity: 1,
              sourceType: 'coupon',
              sourceId: couponId,
              reason: 'coupon_card_reward',
              description: `쿠폰 ${coupon.code} 카드 보상`,
              cardId: Number(result.lastInsertRowid),
              channelId: reward.channel_id,
              serialNumber: baseSn + i,
              star: 0,
              metadata: { coupon_id: couponId, coupon_code: coupon.code, reward_quantity: quantity }
            });
          }
        } else if (reward.type === 'cosmetic') {
          const quantity = Number(reward.quantity || 0);
          db.prepare(`
            INSERT INTO user_cosmetics (user_id, item_id, quantity) VALUES (?, ?, ?)
            ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity
          `).run(userId, reward.item_id, quantity);
          recordSqliteAssetEvent(db, {
            userId,
            assetType: 'cosmetic',
            action: 'add',
            quantity,
            sourceType: 'coupon',
            sourceId: couponId,
            reason: 'coupon_cosmetic_reward',
            description: `쿠폰 ${coupon.code} 코스메틱 보상`,
            itemId: Number(reward.item_id),
            metadata: { coupon_id: couponId, coupon_code: coupon.code }
          });
        } else if (reward.type === 'minigame_ticket') {
          const quantity = Number(reward.quantity || 0);
          const now = new Date().toISOString();
          db.prepare(`
            INSERT INTO user_minigame_tickets (user_id, current_tickets, bonus_tickets, last_charged_at, updated_at)
            VALUES (?, 5, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              bonus_tickets = bonus_tickets + excluded.bonus_tickets,
              updated_at = excluded.updated_at
          `).run(userId, quantity, now, now);
          recordSqliteAssetEvent(db, {
            userId,
            assetType: 'ticket',
            action: 'add',
            quantity,
            sourceType: 'coupon',
            sourceId: couponId,
            reason: 'coupon_minigame_ticket_reward',
            description: `쿠폰 ${coupon.code} 미니게임 티켓 보상`,
            itemType: 'minigame_ticket',
            metadata: { coupon_id: couponId, coupon_code: coupon.code }
          });
        } else if (reward.type === 'free_draw_ticket') {
          const quantity = Number(reward.quantity || 0);
          db.prepare(`
            UPDATE users
               SET bonus_free_draw_tickets = COALESCE(bonus_free_draw_tickets, 0) + ?
             WHERE id = ?
          `).run(quantity, userId);
          recordSqliteAssetEvent(db, {
            userId,
            assetType: 'ticket',
            action: 'add',
            quantity,
            sourceType: 'coupon',
            sourceId: couponId,
            reason: 'coupon_free_draw_ticket_reward',
            description: `쿠폰 ${coupon.code} 추가 무료 소환 티켓 보상`,
            itemType: 'free_draw_ticket',
            metadata: { coupon_id: couponId, coupon_code: coupon.code }
          });
        } else if (reward.type === 'title') {
          const result = db.prepare(`
            INSERT INTO user_titles (user_id, title_id, grant_source)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, title_id) DO NOTHING
          `).run(userId, reward.title_id, 'coupon');
          if (Number(result.changes || 0) > 0) {
            recordSqliteAssetEvent(db, {
              userId,
              assetType: 'title',
              action: 'add',
              quantity: 1,
              sourceType: 'coupon',
              sourceId: couponId,
              reason: 'coupon_title_reward',
              description: `쿠폰 ${coupon.code} 칭호 보상`,
              itemId: Number(reward.title_id),
              metadata: { coupon_id: couponId, coupon_code: coupon.code }
            });
          }
        }
      }
      const updated = db.prepare('SELECT point FROM users WHERE id = ?').get(userId) as any;
      return {
        ok: true,
        reason: 'OK',
        reward_type: rewards[0]?.type,
        points_added: pointsAdded,
        new_points: updated?.point ?? pointsAdded,
        rewards
      };
    });

    return txn();
  }
}

// 4. SQLite 신고 레포지토리
