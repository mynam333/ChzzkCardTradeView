import { getSupabaseClient } from '../services/db';
import { 
  IUserRepository, 
  IStreamerRepository, 
  ICouponRepository, 
  IReportRepository,
  IAnnouncementRepository,
  IUserCardRepository,
  ITradeRepository,
  User,
  UserRanking,
  Streamer,
  Coupon,
  CardReport,
  Announcement,
  Trade
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

  async findByUsername(username: string): Promise<User | null> {
    const { data, error } = await this.getClient()
      .from('users')
      .select('*')
      .eq('username', username)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

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

  async incrementPoint(id: string, delta: number): Promise<void> {
    // 원자적 증감 RPC 우선, 미배포 시 read-modify-write로 폴백
    const { error } = await this.getClient().rpc('increment_user_point', { p_id: id, p_delta: delta });
    if (error) {
      console.warn('[Supabase] increment_user_point RPC 실패, 폴백 사용:', error.message);
      const current = await this.findById(id);
      if (!current) throw new Error('포인트를 증감할 사용자를 찾을 수 없습니다.');
      const { error: updErr } = await this.getClient().from('users').update({ point: current.point + delta }).eq('id', id);
      if (updErr) throw updErr;
    }
  }

  async tryDeductPoint(id: string, amount: number): Promise<boolean> {
    // 잔액 충분 시에만 차감하는 원자적 RPC. boolean 반환.
    const { data, error } = await this.getClient().rpc('deduct_user_point', { p_id: id, p_amount: amount });
    if (error) {
      console.warn('[Supabase] deduct_user_point RPC 실패, 폴백 사용:', error.message);
      const current = await this.findById(id);
      if (!current || current.point < amount) return false;
      const { error: updErr } = await this.getClient().from('users').update({ point: current.point - amount }).eq('id', id).gte('point', amount);
      if (updErr) throw updErr;
      return true;
    }
    return data === true;
  }

  async updateBanStatus(id: string, bannedUntil: string | null): Promise<void> {
    const { error } = await this.getClient()
      .from('users')
      .update({ banned_until: bannedUntil })
      .eq('id', id);

    if (error) throw error;
  }

  async claimFreeDrawIfEligible(id: string, todayKst: string, nowIso: string): Promise<boolean> {
    const { data, error } = await this.getClient().rpc('claim_free_draw', { p_id: id, p_today: todayKst, p_now: nowIso });
    if (error) {
      console.warn('[Supabase] claim_free_draw RPC 실패, 폴백 사용:', error.message);
      const current = await this.findById(id);
      if (!current) return false;
      let eligible = true;
      if (current.last_free_draw) {
        const lastKst = new Date(new Date(current.last_free_draw).getTime() + 9 * 60 * 60 * 1000)
          .toISOString().split('T')[0];
        eligible = lastKst !== todayKst;
      }
      if (!eligible) return false;
      const { error: updErr } = await this.getClient().from('users').update({ last_free_draw: nowIso }).eq('id', id);
      if (updErr) throw updErr;
      return true;
    }
    return data === true;
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

  async updateTokens(id: string, accessToken: string | null, refreshToken: string | null, tokenExpiresAt: string | null): Promise<void> {
    const { error } = await this.getClient()
      .from('users')
      .update({ access_token: accessToken, refresh_token: refreshToken, token_expires_at: tokenExpiresAt })
      .eq('id', id);
    if (error) throw error;
  }

  async updateRepresentativeCard(id: string, channelId: string | null): Promise<void> {
    const { error } = await this.getClient()
      .from('users')
      .update({ representative_card_channel_id: channelId })
      .eq('id', id);
    if (error) throw error;
  }

  async count(): Promise<number> {
    const { count, error } = await this.getClient()
      .from('users')
      .select('*', { count: 'exact', head: true });
    if (error) return 0;
    return count || 0;
  }

  async findRankings(limit: number): Promise<UserRanking[]> {
    // 카드 시세 합산 정렬은 RPC(get_user_rankings) 우선 사용
    const { data, error } = await this.getClient().rpc('get_user_rankings', { p_limit: limit });
    if (!error && Array.isArray(data)) {
      return data.map((row: any) => ({
        id: row.id,
        username: row.username,
        avatar_url: row.avatar_url,
        role: row.role as 'USER' | 'ADMIN',
        point: row.point,
        last_free_draw: row.last_free_draw,
        banned_until: row.banned_until,
        created_at: row.created_at,
        card_count: Number(row.card_count) || 0,
        total_asset: Number(row.total_asset) || row.point
      }));
    }

    // 폴백: 포인트 상위 후보를 가져와 보유 카드 시세를 합산 후 총자산 기준 재정렬
    console.warn('[Supabase] get_user_rankings RPC 실패, 폴백 사용:', error?.message);
    const candidateLimit = Math.min(Math.max(limit * 5, 50), 200);
    const { data: users, error: uErr } = await this.getClient()
      .from('users')
      .select('*')
      .order('point', { ascending: false })
      .limit(candidateLimit);
    if (uErr) throw uErr;

    const enriched: UserRanking[] = [];
    for (const u of users || []) {
      const { data: cards } = await this.getClient()
        .from('user_cards')
        .select('streamer:streamers(base_value)')
        .eq('user_id', u.id);
      const cardsValue = (cards || []).reduce(
        (sum: number, c: any) => sum + (c.streamer?.base_value || 0), 0
      );
      enriched.push({
        ...(u as User),
        card_count: (cards || []).length,
        total_asset: u.point + cardsValue
      });
    }
    enriched.sort((a, b) => b.total_asset - a.total_asset);
    return enriched.slice(0, limit);
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

  async incrementBroadcastCount(channelId: string): Promise<void> {
    const { error } = await this.getClient().rpc('increment_streamer_broadcast', { p_channel_id: channelId });
    if (error) {
      console.warn('[Supabase] increment_streamer_broadcast RPC 실패, 폴백 사용:', error.message);
      const streamer = await this.findById(channelId);
      if (!streamer) return;
      await this.getClient().from('streamers')
        .update({ broadcast_count: (streamer.broadcast_count || 0) + 1, updated_at: new Date().toISOString() })
        .eq('channel_id', channelId);
    }
  }

  async incrementChatCount(channelId: string, count: number = 1): Promise<void> {
    const { error } = await this.getClient().rpc('increment_streamer_chat', { p_channel_id: channelId, p_count: count });
    if (error) {
      console.warn('[Supabase] increment_streamer_chat RPC 실패, 폴백 사용:', error.message);
      const streamer = await this.findById(channelId);
      if (!streamer) return;
      await this.getClient().from('streamers')
        .update({ chat_count: (streamer.chat_count || 0) + count, updated_at: new Date().toISOString() })
        .eq('channel_id', channelId);
    }
  }

  async incrementBroadcastMinutes(channelId: string, minutes: number): Promise<void> {
    if (minutes <= 0) return;
    const { error } = await this.getClient().rpc('increment_streamer_minutes', { p_channel_id: channelId, p_minutes: minutes });
    if (error) {
      const streamer = await this.findById(channelId);
      if (!streamer) return;
      await this.getClient().from('streamers')
        .update({ broadcast_minutes: (streamer.broadcast_minutes || 0) + minutes })
        .eq('channel_id', channelId);
    }
  }

  async getValueHistory(channelId: string, sinceIso: string): Promise<{ value: number; recorded_at: string }[]> {
    const { data, error } = await this.getClient()
      .from('value_history')
      .select('value, recorded_at')
      .eq('channel_id', channelId)
      .gte('recorded_at', sinceIso)
      .order('recorded_at', { ascending: true });
    if (error || !data) return [];
    return data.map((r: any) => ({ value: r.value, recorded_at: r.recorded_at }));
  }

  async count(): Promise<number> {
    const { count, error } = await this.getClient()
      .from('streamers')
      .select('*', { count: 'exact', head: true });
    if (error) return 0;
    return count || 0;
  }

  async updateValueMetrics(channelId: string, prevValue: number, baseValue: number, activityScore: number, multiplier: number): Promise<void> {
    const { error } = await this.getClient()
      .from('streamers')
      .update({
        prev_value: prevValue,
        base_value: baseValue,
        activity_score: activityScore,
        broadcast_multiplier: multiplier,
        updated_at: new Date().toISOString()
      })
      .eq('channel_id', channelId);
    if (error) throw error;
  }

  async decrementChatCount(channelId: string, amount: number): Promise<void> {
    if (amount <= 0) return;
    const { error } = await this.getClient().rpc('decrement_streamer_chat', { p_channel_id: channelId, p_amount: amount });
    if (error) {
      console.warn('[Supabase] decrement_streamer_chat RPC 실패, 폴백 사용:', error.message);
      const streamer = await this.findById(channelId);
      if (!streamer) return;
      const next = Math.max((streamer.chat_count || 0) - amount, 0);
      await this.getClient().from('streamers')
        .update({ chat_count: next, updated_at: new Date().toISOString() })
        .eq('channel_id', channelId);
    }
  }

  async recordValueHistory(channelId: string, value: number): Promise<void> {
    const { error } = await this.getClient()
      .from('value_history')
      .insert([{ channel_id: channelId, value }]);
    if (error) throw error;
    // 오래된 이력 정리 (8일 초과)
    const cutoff = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await this.getClient().from('value_history').delete().eq('channel_id', channelId).lt('recorded_at', cutoff);
  }

  private async valueAgoMap(hours: number): Promise<Record<string, number>> {
    // 경계 시각 이전에 기록된 이력 중 채널별 가장 최근 값을 선택
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const { data, error } = await this.getClient()
      .from('value_history')
      .select('channel_id, value, recorded_at')
      .lte('recorded_at', cutoff)
      .order('recorded_at', { ascending: false });
    if (error || !data) return {};

    const map: Record<string, number> = {};
    for (const row of data as any[]) {
      // 내림차순 정렬이므로 채널별 최초 등장이 경계에 가장 근접한 값
      if (map[row.channel_id] === undefined) {
        map[row.channel_id] = row.value;
      }
    }
    return map;
  }

  async getValue24hAgoMap(): Promise<Record<string, number>> {
    return this.valueAgoMap(24);
  }

  async getValue1hAgoMap(): Promise<Record<string, number>> {
    return this.valueAgoMap(1);
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

  async countPending(): Promise<number> {
    const { count, error } = await this.getClient()
      .from('card_reports')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');
    if (error) return 0;
    return count || 0;
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
          follower_count,
          is_active,
          is_image_banned,
          serial_number
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

  async count(): Promise<number> {
    const { count, error } = await this.getClient()
      .from('user_cards')
      .select('*', { count: 'exact', head: true });
    if (error) return 0;
    return count || 0;
  }
}

// 7. Supabase 거래(1:1 교환) 레포지토리
export class SupabaseTradeRepository implements ITradeRepository {
  private getClient() {
    return getSupabaseClient();
  }

  async create(trade: Pick<Trade, 'sender_id' | 'receiver_id' | 'sender_offer' | 'receiver_offer'>): Promise<Trade> {
    const { data, error } = await this.getClient()
      .from('trades')
      .insert([{
        sender_id: trade.sender_id,
        receiver_id: trade.receiver_id,
        sender_offer: trade.sender_offer,
        receiver_offer: trade.receiver_offer,
        status: 'PENDING'
      }])
      .select()
      .single();

    if (error) throw error;
    return data as Trade;
  }

  async findById(id: number): Promise<Trade | null> {
    const { data, error } = await this.getClient()
      .from('trades')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) return null;
    return data as Trade;
  }

  private async queryTrades(userId: string, statuses: string[]): Promise<Trade[]> {
    const inList = `(${statuses.join(',')})`;
    const { data, error } = await this.getClient()
      .from('trades')
      .select('*, sender:users!trades_sender_id_fkey(username), receiver:users!trades_receiver_id_fkey(username)')
      .filter('status', 'in', inList)
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .order('id', { ascending: false });

    if (error) {
      // 외래키 임베드 조인이 실패하는 환경을 위한 폴백 (사용자명 없이 반환)
      const { data: plain, error: plainErr } = await this.getClient()
        .from('trades')
        .select('*')
        .filter('status', 'in', inList)
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
        .order('id', { ascending: false });
      if (plainErr) throw plainErr;
      return (plain || []) as Trade[];
    }

    return (data || []).map((row: any) => ({
      ...row,
      sender_username: row.sender?.username,
      receiver_username: row.receiver?.username
    })) as Trade[];
  }

  async findActiveByUser(userId: string): Promise<Trade[]> {
    return this.queryTrades(userId, ['PENDING', 'CONFIRMED']);
  }

  async findHistoryByUser(userId: string, limit: number): Promise<Trade[]> {
    const trades = await this.queryTrades(userId, ['ACCEPTED', 'REJECTED', 'CANCELLED']);
    return trades.slice(0, limit);
  }

  async updateStatus(id: number, status: Trade['status']): Promise<void> {
    const { error } = await this.getClient()
      .from('trades')
      .update({ status })
      .eq('id', id);
    if (error) throw error;
  }

  async countCompleted(): Promise<number> {
    const { count, error } = await this.getClient()
      .from('trades')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'ACCEPTED');
    if (error) return 0;
    return count || 0;
  }

  // 1단계: 수신자 동의 (PENDING → CONFIRMED)
  async confirm(id: number, actorId: string): Promise<{ ok: boolean; reason: string }> {
    const trade = await this.findById(id);
    if (!trade) return { ok: false, reason: 'NOT_FOUND' };
    if (trade.status !== 'PENDING') return { ok: false, reason: 'NOT_PENDING' };
    if (trade.receiver_id !== actorId) return { ok: false, reason: 'FORBIDDEN' };
    await this.updateStatus(id, 'CONFIRMED');
    return { ok: true, reason: 'OK' };
  }

  // 2단계: 제안자 최종 승인 및 원자적 체결 (CONFIRMED → ACCEPTED)은 PostgreSQL 함수(finalize_trade)에 위임
  async finalize(id: number, actorId: string): Promise<{ ok: boolean; reason: string }> {
    const { data, error } = await this.getClient().rpc('finalize_trade', { p_trade_id: id, p_actor: actorId });
    if (error) {
      console.error('[SupabaseTradeRepository] finalize_trade RPC 에러:', error.message);
      return { ok: false, reason: 'RPC_ERROR' };
    }
    const result = String(data);
    return { ok: result === 'OK', reason: result };
  }
}
