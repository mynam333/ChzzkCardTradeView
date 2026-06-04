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

  async findByIds(ids: string[]): Promise<User[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.getClient().from('users').select('*').in('id', ids);
    if (error || !data) return [];
    return data as User[];
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

  async searchByUsername(keyword: string, limit: number): Promise<User[]> {
    const { data, error } = await this.getClient()
      .from('users')
      .select('*')
      .ilike('username', `%${keyword}%`)
      .order('username', { ascending: true })
      .limit(limit);
    if (error || !data) return [];
    return data as User[];
  }

  async listUsers(keyword: string, limit: number, offset: number): Promise<{ users: User[]; total: number }> {
    const kw = (keyword || '').trim();
    let query = this.getClient()
      .from('users')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (kw) {
      // 닉네임 또는 ID 부분일치 (특수문자 escape: 콤마/괄호는 or 필터 구문 충돌 방지)
      const safe = kw.replace(/[,()]/g, ' ');
      query = query.or(`username.ilike.%${safe}%,id.ilike.%${safe}%`);
    }
    const { data, error, count } = await query;
    if (error || !data) return { users: [], total: 0 };
    return { users: data as User[], total: count || 0 };
  }

  async listBannedUsers(keyword: string, sortBy: string, sortOrder: 'asc' | 'desc', limit: number, offset: number): Promise<{ users: User[]; total: number }> {
    const kw = (keyword || '').trim();

    // 허용 정렬 컬럼 화이트리스트
    const validSortColumns = ['banned_until', 'username', 'id', 'created_at'];
    const orderCol = validSortColumns.includes(sortBy) ? sortBy : 'banned_until';
    const ascending = sortOrder === 'asc';

    let query = this.getClient()
      .from('users')
      .select('*', { count: 'exact' })
      .not('banned_until', 'is', null)
      .gt('banned_until', new Date().toISOString())
      .order(orderCol, { ascending })
      .range(offset, offset + limit - 1);

    if (kw) {
      const safe = kw.replace(/[,()]/g, ' ');
      query = query.or(`username.ilike.%${safe}%,id.ilike.%${safe}%`);
    }

    const { data, error, count } = await query;
    if (error || !data) return { users: [], total: 0 };
    return { users: data as User[], total: count || 0 };
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

  async updateBanStatus(id: string, bannedUntil: string | null, reason?: string | null): Promise<void> {
    const { error } = await this.getClient()
      .from('users')
      .update({ banned_until: bannedUntil, ban_reason: bannedUntil === null ? null : (reason || null) })
      .eq('id', id);

    if (error) throw error;
  }

  async claimFreeDrawIfEligible(id: string, nowIso: string, segmentStartIso: string | null): Promise<boolean> {
    const { data, error } = await this.getClient().rpc('claim_free_draw', { p_id: id, p_now: nowIso, p_segment_start: segmentStartIso });
    if (error) {
      console.warn('[Supabase] claim_free_draw RPC 실패, 폴백 사용:', error.message);
      const current = await this.findById(id);
      if (!current) return false;
      let eligible = true;
      if (segmentStartIso !== null && current.last_free_draw) {
        eligible = new Date(current.last_free_draw).getTime() < new Date(segmentStartIso).getTime();
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

  // ---- 유저 차단 ----
  async blockUser(blockerId: string, blockedId: string): Promise<void> {
    const { error } = await this.getClient()
      .from('user_blocks')
      .upsert({ blocker_id: blockerId, blocked_id: blockedId }, { onConflict: 'blocker_id,blocked_id' });
    if (error) throw error;
  }
  async unblockUser(blockerId: string, blockedId: string): Promise<void> {
    const { error } = await this.getClient()
      .from('user_blocks')
      .delete()
      .eq('blocker_id', blockerId)
      .eq('blocked_id', blockedId);
    if (error) throw error;
  }
  async getBlockedUsers(blockerId: string): Promise<User[]> {
    const { data, error } = await this.getClient()
      .from('user_blocks')
      .select('created_at, blocked:users!user_blocks_blocked_id_fkey(*)')
      .eq('blocker_id', blockerId)
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return data.map((r: any) => r.blocked).filter(Boolean) as User[];
  }
  async isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
    const { data, error } = await this.getClient()
      .from('user_blocks')
      .select('blocker_id', { head: false })
      .eq('blocker_id', blockerId)
      .eq('blocked_id', blockedId)
      .limit(1);
    if (error || !data) return false;
    return data.length > 0;
  }

  async findRankings(limit: number, keyword: string = ''): Promise<UserRanking[]> {
    // 카드 시세 합산 정렬은 RPC(get_user_rankings) 우선 사용 (keyword 및 rank 포함)
    const { data, error } = await this.getClient().rpc('get_user_rankings', { p_limit: limit, p_keyword: keyword });
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
        total_asset: Number(row.total_asset) || row.point,
        rank: Number(row.rank)
      }));
    }

    // 폴백: 포인트 상위 후보를 가져와 보유 카드 시세를 합산 후 총자산 기준 정렬
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
        .select('star, streamer:streamers(base_value)')
        .eq('user_id', u.id);
      // 카드 가치는 별(0~5성) 배수(1 + star*0.6)를 반영하여 합산
      const cardsValue = (cards || []).reduce(
        (sum: number, c: any) => sum + (c.streamer?.base_value || 0) * (1 + (c.star || 0) * 0.6), 0
      );
      enriched.push({
        ...(u as User),
        card_count: (cards || []).length,
        total_asset: u.point + Math.round(cardsValue)
      });
    }
    enriched.sort((a, b) => b.total_asset - a.total_asset);
    
    // 전체 목록 기준 순위를 매겨서 반환
    const mapped = enriched.map((item, idx) => ({
      ...item,
      rank: idx + 1
    }));

    // 검색어가 있다면 필터링
    const filtered = keyword.trim()
      ? mapped.filter((u) => u.username.toLowerCase().includes(keyword.toLowerCase()))
      : mapped;

    return filtered.slice(0, limit);
  }
}

// 별(0~5성)별 커스텀 이미지 컬럼명 (인덱스 0 = 0성 = custom_image_url)
