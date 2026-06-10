import { getSupabaseClient } from "../../services/db";
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
import { parseCouponRewards, rewardsToJson, couponToRewards } from '../../utils/couponRewards';

export class SupabaseCouponRepository implements ICouponRepository {
  private getClient() {
    return getSupabaseClient();
  }

  async findByCode(code: string): Promise<Coupon | null> {
    const escapedCode = code.replace(/[\\%_]/g, '\\$&');
    const { data, error } = await this.getClient()
      .from('coupons')
      .select('*')
      .ilike('code', escapedCode)
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return { ...(data as Coupon), rewards: parseCouponRewards((data as any).rewards) };
  }

  async create(coupon: Coupon): Promise<Coupon> {
    const rewards = couponToRewards(coupon);
    const { data, error } = await this.getClient()
      .from('coupons')
      .insert([{ ...coupon, rewards: JSON.parse(rewardsToJson(rewards)) }])
      .select()
      .single();

    if (error) throw error;
    return { ...(data as Coupon), rewards: parseCouponRewards((data as any).rewards ?? rewardsToJson(rewards)) };
  }

  async incrementUsedCount(couponId: number): Promise<void> {
    const { data } = await this.getClient()
      .from('coupons')
      .select('used_count')
      .eq('id', couponId)
      .single();

    const nextCount = ((data?.used_count || 0) as number) + 1;

    const { error } = await this.getClient()
      .from('coupons')
      .update({ used_count: nextCount })
      .eq('id', couponId);

    if (error) throw error;
  }

  async findAll(): Promise<Coupon[]> {
    const { data, error } = await this.getClient()
      .from('coupons')
      .select('*')
      .order('id', { ascending: false });
    if (error) throw error;
    return ((data || []) as Coupon[]).map((coupon) => ({
      ...coupon,
      rewards: parseCouponRewards((coupon as any).rewards)
    }));
  }

  async checkCouponRedeemed(couponId: number, userId: string): Promise<boolean> {
    const { data, error } = await this.getClient()
      .from('coupon_logs')
      .select('id')
      .eq('coupon_id', couponId)
      .eq('user_id', userId)
      .maybeSingle();

    return !error && data !== null;
  }

  async logCouponRedeem(couponId: number, userId: string): Promise<boolean> {
    const { error } = await this.getClient()
      .from('coupon_logs')
      .insert([{ coupon_id: couponId, user_id: userId }]);

    if (error) {
      // 23505 = unique_violation (이미 사용한 쿠폰, 동시 요청 포함)
      if ((error as any).code === '23505') return false;
      throw error;
    }
    return true;
  }

  async redeemAtomic(couponId: number, userId: string): Promise<CouponRedeemResult> {
    const { data, error } = await this.getClient().rpc('redeem_coupon_atomic', {
      p_coupon_id: couponId,
      p_user_id: userId
    });

    if (error) {
      console.error('[SupabaseCouponRepository] redeem_coupon_atomic RPC 에러:', error.message);
      return { ok: false, reason: 'RPC_ERROR' };
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.ok) return { ok: false, reason: row?.reason || 'FAILED' };
    return {
      ok: true,
      reason: 'OK',
      reward_type: row.reward_type,
      points_added: Number(row.points_added) || 0,
      new_points: row.new_points === null || row.new_points === undefined ? undefined : Number(row.new_points),
      reward_channel_id: row.reward_channel_id ?? null,
      reward_item_id: row.reward_item_id ?? null,
      reward_quantity: Number(row.reward_quantity) || 0,
      rewards: parseCouponRewards(row.rewards)
    };
  }
}

// 4. Supabase 신고 레포지토리
