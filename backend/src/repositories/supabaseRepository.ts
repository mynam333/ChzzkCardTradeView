import { getSupabaseClient } from '../services/db';
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

// 1. Supabase 유저 레포지토리
export class SupabaseUserRepository implements IUserRepository {
  private getClient() {
    return getSupabaseClient();
  }

  async findById(id: string): Promise<User | null> {
    const { data, error } = await this.getClient()
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) return null;
    return data as User;
  }

  async create(user: User): Promise<User> {
    const { data, error } = await this.getClient()
      .from('users')
      .insert([user])
      .select()
      .single();

    if (error) throw error;
    return data as User;
  }

  async updatePoint(id: string, point: number): Promise<void> {
    const { error } = await this.getClient()
      .from('users')
      .update({ point })
      .eq('id', id);

    if (error) throw error;
  }

  async updateBanStatus(id: string, bannedUntil: string | null): Promise<void> {
    const { error } = await this.getClient()
      .from('users')
      .update({ banned_until: bannedUntil })
      .eq('id', id);

    if (error) throw error;
  }

  async updateLastFreeDraw(id: string, time: string): Promise<void> {
    const { error } = await this.getClient()
      .from('users')
      .update({ last_free_draw: time })
      .eq('id', id);

    if (error) throw error;
  }

  async updateProfile(id: string, username: string, avatarUrl: string | null, accessToken?: string | null, refreshToken?: string | null): Promise<void> {
    const updatePayload: any = { username, avatar_url: avatarUrl };
    if (accessToken !== undefined) updatePayload.access_token = accessToken;
    if (refreshToken !== undefined) updatePayload.refresh_token = refreshToken;

    const { error } = await this.getClient()
      .from('users')
      .update(updatePayload)
      .eq('id', id);

    if (error) throw error;
  }

  async findRankings(limit: number): Promise<User[]> {
    const { data, error } = await this.getClient()
      .from('users')
      .select('*')
      .order('point', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data || []) as User[];
  }
}

// 2. Supabase 스트리머 레포지토리
export class SupabaseStreamerRepository implements IStreamerRepository {
  private getClient() {
    return getSupabaseClient();
  }

  async findAll(): Promise<Streamer[]> {
    const { data, error } = await this.getClient()
      .from('streamers')
      .select('*')
      .order('base_value', { ascending: false });

    if (error) throw error;
    return (data || []) as Streamer[];
  }

  async findById(channelId: string): Promise<Streamer | null> {
    const { data, error } = await this.getClient()
      .from('streamers')
      .select('*')
      .eq('channel_id', channelId)
      .single();

    if (error || !data) return null;
    return data as Streamer;
  }

  async save(streamer: Streamer): Promise<void> {
    const { error } = await this.getClient()
      .from('streamers')
      .upsert(streamer);

    if (error) throw error;
  }

  async updateCustomImage(channelId: string, imageUrl: string | null): Promise<void> {
    const { error } = await this.getClient()
      .from('streamers')
      .update({ custom_image_url: imageUrl, updated_at: new Date().toISOString() })
      .eq('channel_id', channelId);

    if (error) throw error;
  }
  async updateImageBanStatus(channelId: string, isBanned: boolean): Promise<void> {
    const { error } = await this.getClient()
      .from('streamers')
      .update({ is_image_banned: isBanned, updated_at: new Date().toISOString() })
      .eq('channel_id', channelId);

    if (error) throw error;
  }
  async findStreamerIndex(channelId: string): Promise<number> {
    const { data, error } = await this.getClient()
      .from('streamers')
      .select('channel_id')
      .order('channel_id', { ascending: true });

    if (error || !data) return 1;
    const index = data.findIndex(r => r.channel_id === channelId);
    return index !== -1 ? index + 1 : 1;
  }

  async findMaxSerialNumber(): Promise<number> {
    const { data, error } = await this.getClient()
      .from('streamers')
      .select('serial_number')
      .order('serial_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return 0;
    return (data.serial_number as number) || 0;
  }

  async findAllocatedStreamerSerialNumbers(): Promise<number[]> {
    const { data, error } = await this.getClient()
      .from('streamers')
      .select('serial_number')
      .not('serial_number', 'is', null)
      .order('serial_number', { ascending: true });

    if (error || !data) return [];
    return data.map(r => r.serial_number as number);
  }

  async updateLiveStatus(channelId: string, isActive: boolean, followerCount: number): Promise<void> {
    const { error } = await this.getClient()
      .from('streamers')
      .update({
        is_active: isActive,
        follower_count: followerCount,
        updated_at: new Date().toISOString()
      })
      .eq('channel_id', channelId);

    if (error) throw error;
  }
}
// 3. Supabase 쿠폰 레포지토리
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

  async checkCouponRedeemed(couponId: number, userId: string): Promise<boolean> {
    const { data, error } = await this.getClient()
      .from('coupon_logs')
      .select('id')
      .eq('coupon_id', couponId)
      .eq('user_id', userId)
      .maybeSingle();

    return !error && data !== null;
  }

  async logCouponRedeem(couponId: number, userId: string): Promise<void> {
    const { error } = await this.getClient()
      .from('coupon_logs')
      .insert([{ coupon_id: couponId, user_id: userId }]);

    if (error) throw error;
  }
}

// 4. Supabase 신고 레포지토리
export class SupabaseReportRepository implements IReportRepository {
  private getClient() {
    return getSupabaseClient();
  }

  async findAll(): Promise<CardReport[]> {
    const { data, error } = await this.getClient()
      .from('card_reports')
      .select('*')
      .order('id', { ascending: false });

    if (error) throw error;
    return (data || []) as CardReport[];
  }

  async create(report: CardReport): Promise<CardReport> {
    const { data, error } = await this.getClient()
      .from('card_reports')
      .insert([report])
      .select()
      .single();

    if (error) throw error;
    return data as CardReport;
  }

  async updateStatus(reportId: number, status: 'resolved' | 'rejected'): Promise<void> {
    const { error } = await this.getClient()
      .from('card_reports')
      .update({ status })
      .eq('id', reportId);

    if (error) throw error;
  }
}

// 5. Supabase 공지사항 레포지토리
export class SupabaseAnnouncementRepository implements IAnnouncementRepository {
  private getClient() {
    return getSupabaseClient();
  }

  async findAll(): Promise<Announcement[]> {
    const { data, error } = await this.getClient()
      .from('announcements')
      .select('*')
      .order('id', { ascending: false });

    if (error) throw error;
    return (data || []) as Announcement[];
  }

  async findActivePopups(): Promise<Announcement[]> {
    const now = new Date().toISOString();
    const { data, error } = await this.getClient()
      .from('announcements')
      .select('*')
      .eq('is_popup', true)
      .or(`popup_expires_at.is.null,popup_expires_at.gt.${now}`)
      .order('id', { ascending: false });

    if (error) throw error;
    return (data || []) as Announcement[];
  }

  async create(announcement: Announcement): Promise<Announcement> {
    const { data, error } = await this.getClient()
      .from('announcements')
      .insert([announcement])
      .select()
      .single();

    if (error) throw error;
    return data as Announcement;
  }

  async delete(id: number): Promise<void> {
    const { error } = await this.getClient()
      .from('announcements')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
}

// 6. Supabase 유저 보유 카드 레포지토리
export class SupabaseUserCardRepository implements IUserCardRepository {
  private getClient() {
    return getSupabaseClient();
  }

  async create(card: any): Promise<any> {
    const { data, error } = await this.getClient()
      .from('user_cards')
      .insert([card])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async findByUserId(userId: string): Promise<any[]> {
    // Supabase 상에서 user_cards와 streamers를 Inner Join
    const { data, error } = await this.getClient()
      .from('user_cards')
      .select(`
        id,
        user_id,
        channel_id,
        serial_number,
        acquired_at,
        streamer:streamers (
          channel_id,
          name,
          logo_url,
          custom_image_url,
          base_value,
          follower_count
        )
      `)
      .eq('user_id', userId)
      .order('id', { ascending: false });

    if (error) throw error;
    return (data || []) as any[];
  }

  async findLatestSerialNumber(channelId: string): Promise<number> {
    const { data, error } = await this.getClient()
      .from('user_cards')
      .select('serial_number')
      .eq('channel_id', channelId)
      .order('serial_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[SupabaseUserCardRepository] findLatestSerialNumber 에러:', error);
      return 0;
    }
    return data ? (data.serial_number as number) : 0;
  }

  async findAllocatedSerialNumbers(channelId: string): Promise<number[]> {
    const { data, error } = await this.getClient()
      .from('user_cards')
      .select('serial_number')
      .eq('channel_id', channelId)
      .order('serial_number', { ascending: true });

    if (error) {
      console.error('[SupabaseUserCardRepository] findAllocatedSerialNumbers 에러:', error);
      return [];
    }
    return (data || []).map(r => r.serial_number);
  }

  async deleteCards(userId: string, channelId: string, count: number): Promise<number> {
    // 특정 개수만큼만 삭제하기 위해 row를 먼저 조회 후 id로 매칭하여 삭제합니다.
    const { data: rows, error: selectError } = await this.getClient()
      .from('user_cards')
      .select('id')
      .eq('user_id', userId)
      .eq('channel_id', channelId)
      .order('id', { ascending: true })
      .limit(count);

    if (selectError || !rows || rows.length === 0) return 0;

    const ids = rows.map(r => r.id);
    const { error: deleteError, count: deletedCount } = await this.getClient()
      .from('user_cards')
      .delete({ count: 'exact' })
      .in('id', ids);

    if (deleteError) throw deleteError;
    return deletedCount || ids.length;
  }
}
