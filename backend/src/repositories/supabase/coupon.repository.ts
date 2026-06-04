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
  CardReport,
  Announcement,
  Trade,
  AppNotification
} from '../interfaces';

export class SupabaseCouponRepository implements ICouponRepository {
  private getClient() {
    return getSupabaseClient();
  }

  async findByCode(code: string): Promise<Coupon | null> {
    const { data, error } = await this.getClient()
      .from('coupons')
      .select('*')
      .eq('code', code)
      .single();

    if (error || !data) return null;
    return data as Coupon;
  }

  async create(coupon: Coupon): Promise<Coupon> {
    const { data, error } = await this.getClient()
      .from('coupons')
      .insert([coupon])
      .select()
      .single();

    if (error) throw error;
    return data as Coupon;
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
    return (data || []) as Coupon[];
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
}

// 4. Supabase 신고 레포지토리
