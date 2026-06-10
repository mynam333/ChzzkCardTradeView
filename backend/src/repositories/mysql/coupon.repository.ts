import { getMysqlDb } from '../../services/db';
import { ICouponRepository, Coupon, CouponRedeemResult } from '../interfaces';

export class MysqlCouponRepository implements ICouponRepository {
  private getDb() {
    return getMysqlDb();
  }

  private mapCoupon(row: any): Coupon {
    return {
      id: row.id,
      code: row.code,
      coupon_type: row.coupon_type as 'single' | 'multi',
      reward_type: (row.reward_type || 'point') as Coupon['reward_type'],
      points: Number(row.points || 0),
      reward_channel_id: row.reward_channel_id ?? null,
      reward_item_id: row.reward_item_id ?? null,
      reward_quantity: Number(row.reward_quantity || 0),
      max_uses: Number(row.max_uses || 0),
      used_count: Number(row.used_count || 0),
      expires_at: row.expires_at,
      created_at: row.created_at
    };
  }

  async findByCode(code: string): Promise<Coupon | null> {
    const row = await this.getDb().get('SELECT * FROM coupons WHERE LOWER(code) = LOWER(?)', code);
    return row ? this.mapCoupon(row) : null;
  }

  async create(coupon: Coupon): Promise<Coupon> {
    const result = await this.getDb().run(
      `INSERT INTO coupons (code, coupon_type, reward_type, points, reward_channel_id, reward_item_id, reward_quantity, max_uses, used_count, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    coupon.id = Number(result.insertId);
    return coupon;
  }

  async incrementUsedCount(couponId: number): Promise<void> {
    await this.getDb().run('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', couponId);
  }

  async findAll(): Promise<Coupon[]> {
    const rows = await this.getDb().all('SELECT * FROM coupons ORDER BY id DESC');
    return rows.map((row) => this.mapCoupon(row));
  }

  async checkCouponRedeemed(couponId: number, userId: string): Promise<boolean> {
    const row = await this.getDb().get('SELECT 1 FROM coupon_logs WHERE coupon_id = ? AND user_id = ?', couponId, userId);
    return !!row;
  }

  async logCouponRedeem(couponId: number, userId: string): Promise<boolean> {
    try {
      await this.getDb().run('INSERT INTO coupon_logs (coupon_id, user_id) VALUES (?, ?)', couponId, userId);
      return true;
    } catch (err: any) {
      if (err?.code === 'ER_DUP_ENTRY') return false;
      throw err;
    }
  }

  async redeemAtomic(couponId: number, userId: string): Promise<CouponRedeemResult> {
    return this.getDb().transaction(async (tx) => {
      const couponRow = await tx.get('SELECT * FROM coupons WHERE id = ? FOR UPDATE', couponId);
      if (!couponRow) return { ok: false, reason: 'NOT_FOUND' };
      const coupon = this.mapCoupon(couponRow);
      if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) return { ok: false, reason: 'EXPIRED' };
      if (coupon.coupon_type === 'single' && coupon.used_count >= coupon.max_uses) return { ok: false, reason: 'SOLD_OUT' };
      if (coupon.reward_type === 'card' && !coupon.reward_channel_id) return { ok: false, reason: 'INVALID_REWARD' };
      if (coupon.reward_type === 'cosmetic' && !coupon.reward_item_id) return { ok: false, reason: 'INVALID_REWARD' };
      if ((coupon.reward_type === 'minigame_ticket' || coupon.reward_type === 'free_draw_ticket') && coupon.reward_quantity <= 0) {
        return { ok: false, reason: 'INVALID_REWARD' };
      }

      try {
        await tx.run('INSERT INTO coupon_logs (coupon_id, user_id) VALUES (?, ?)', couponId, userId);
      } catch (err: any) {
        if (err?.code === 'ER_DUP_ENTRY') return { ok: false, reason: 'DUPLICATE' };
        throw err;
      }

      await tx.run('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', couponId);

      if (coupon.reward_type === 'card') {
        const latest = await tx.get('SELECT COALESCE(MAX(serial_number), 0) AS max_sn FROM user_cards WHERE channel_id = ? FOR UPDATE', coupon.reward_channel_id);
        const baseSn = Number(latest?.max_sn || 0);
        for (let i = 1; i <= coupon.reward_quantity; i++) {
          await tx.run('INSERT INTO user_cards (user_id, channel_id, serial_number, star) VALUES (?, ?, ?, 0)', userId, coupon.reward_channel_id, baseSn + i);
        }
        return { ok: true, reason: 'OK', reward_type: 'card', reward_channel_id: coupon.reward_channel_id, reward_quantity: coupon.reward_quantity, points_added: 0 };
      }

      if (coupon.reward_type === 'cosmetic') {
        await tx.run(`
          INSERT INTO user_cosmetics (user_id, item_id, quantity) VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)
        `, userId, coupon.reward_item_id, coupon.reward_quantity);
        return { ok: true, reason: 'OK', reward_type: 'cosmetic', reward_item_id: coupon.reward_item_id, reward_quantity: coupon.reward_quantity, points_added: 0 };
      }

      if (coupon.reward_type === 'minigame_ticket') {
        const now = new Date().toISOString();
        await tx.run(`
          INSERT INTO user_minigame_tickets (user_id, current_tickets, bonus_tickets, last_charged_at, updated_at)
          VALUES (?, 5, ?, ?, ?)
          ON DUPLICATE KEY UPDATE bonus_tickets = bonus_tickets + VALUES(bonus_tickets), updated_at = VALUES(updated_at)
        `, userId, coupon.reward_quantity, now, now);
        return { ok: true, reason: 'OK', reward_type: 'minigame_ticket', reward_quantity: coupon.reward_quantity, points_added: 0 };
      }

      if (coupon.reward_type === 'free_draw_ticket') {
        await tx.run('UPDATE users SET bonus_free_draw_tickets = COALESCE(bonus_free_draw_tickets, 0) + ? WHERE id = ?', coupon.reward_quantity, userId);
        return { ok: true, reason: 'OK', reward_type: 'free_draw_ticket', reward_quantity: coupon.reward_quantity, points_added: 0 };
      }

      await tx.run('UPDATE users SET point = point + ? WHERE id = ?', coupon.points, userId);
      const updated = await tx.get('SELECT point FROM users WHERE id = ?', userId);
      return { ok: true, reason: 'OK', reward_type: 'point', points_added: coupon.points, new_points: updated?.point ?? coupon.points };
    });
  }
}
