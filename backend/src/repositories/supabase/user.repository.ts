import { getSupabaseClient } from "../../services/db";
import { fuzzyScore } from "../../utils/search";
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
    const kw = (keyword || '').trim();
    if (!kw) return [];
    // 초성/띄어쓰기 무시 유사도 검색.
    // 1) 직접 부분일치(ilike) — 후보 풀 밖(오래된) 유저도 포착
    // 2) 최근 유저 후보 풀 — 초성/띄어쓰기 유사 매칭용 (PostgREST max-rows 보호 위해 캡)
    const POOL_CAP = 2000;
    const safeLike = kw.replace(/[,()%]/g, ' ');
    const [likeRes, poolRes] = await Promise.all([
      this.getClient().from('users').select('*').ilike('username', `%${safeLike}%`).limit(limit),
      this.getClient().from('users').select('*').order('created_at', { ascending: false }).limit(POOL_CAP)
    ]);

    const byId = new Map<string, any>();
    for (const u of (likeRes.data || [])) byId.set(u.id, u);
    for (const u of (poolRes.data || [])) if (!byId.has(u.id)) byId.set(u.id, u);

    return Array.from(byId.values())
      .map((u) => ({ u, score: fuzzyScore(u.username || '', kw) }))
      .filter((x): x is { u: any; score: number } => x.score !== null)
      .sort((a, b) => a.score - b.score || String(a.u.username).localeCompare(String(b.u.username)))
      .slice(0, limit)
      .map((x) => x.u as User);
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

  async syncFreeDrawTickets(id: string, segmentStartIso: string | null, maxStack: number, intervalHours: number): Promise<User | null> {
    const safeMaxStack = Math.max(1, Math.floor(maxStack || 1));
    const { data, error } = await this.getClient().rpc('sync_free_draw_tickets', {
      p_id: id,
      p_segment_start: segmentStartIso,
      p_max_stack: safeMaxStack,
      p_interval_hours: Math.max(0, Number(intervalHours || 0))
    });

    if (error) {
      console.warn('[Supabase] sync_free_draw_tickets RPC 실패, 폴백 사용:', error.message);
      const current = await this.findById(id);
      if (!current) return null;

      if (segmentStartIso !== null) {
        const currentTickets = Number(current.free_draw_tickets || 0);
        const shouldGrant = !current.last_free_draw || new Date(current.last_free_draw).getTime() < new Date(segmentStartIso).getTime();
        if (shouldGrant) {
          const diffMs = current.last_free_draw
            ? new Date(segmentStartIso).getTime() - new Date(current.last_free_draw).getTime()
            : 0;
          const intervalMs = Math.max(1, Number(intervalHours || 1)) * 60 * 60 * 1000;
          const grantCount = current.last_free_draw ? Math.max(1, Math.floor(diffMs / intervalMs)) : 1;
          const nextTickets = Math.min(safeMaxStack, currentTickets + grantCount);
          const { error: updErr } = await this.getClient()
            .from('users')
            .update({ free_draw_tickets: nextTickets, last_free_draw: segmentStartIso })
            .eq('id', id);
          if (updErr) throw updErr;
          return { ...current, free_draw_tickets: nextTickets, last_free_draw: segmentStartIso };
        }
      }
      return current;
    }

    const row = Array.isArray(data) ? data[0] : data;
    return row ? row as User : null;
  }

  async addBonusFreeDrawTickets(id: string, amount: number): Promise<void> {
    const qty = Math.max(0, Math.floor(amount || 0));
    if (qty <= 0) return;

    const { error } = await this.getClient().rpc('add_bonus_free_draw_tickets', {
      p_user_id: id,
      p_amount: qty
    });
    if (error) {
      console.warn('[Supabase] add_bonus_free_draw_tickets RPC 실패, 폴백 사용:', error.message);
      const current = await this.findById(id);
      if (!current) throw new Error('무료 소환 티켓을 지급할 사용자를 찾을 수 없습니다.');
      const { error: updErr } = await this.getClient()
        .from('users')
        .update({ bonus_free_draw_tickets: Number(current.bonus_free_draw_tickets || 0) + qty })
        .eq('id', id);
      if (updErr) throw updErr;
    }
  }

  async deleteAccount(id: string): Promise<void> {
    const { error } = await this.getClient().rpc('delete_user_account', { p_user_id: id });
    if (!error) return;

    console.warn('[Supabase] delete_user_account RPC 실패, 폴백 사용:', error.message);
    const client = this.getClient();
    const deleteEq = async (table: string, column: string) => {
      const { error: deleteError } = await client.from(table).delete().eq(column, id);
      if (deleteError) throw deleteError;
    };

    await client.from('market_listings').update({ buyer_id: null }).eq('buyer_id', id);
    await deleteEq('market_listings', 'seller_id');
    await client.from('trades').delete().or(`sender_id.eq.${id},receiver_id.eq.${id}`);
    await client.from('user_blocks').delete().or(`blocker_id.eq.${id},blocked_id.eq.${id}`);
    await deleteEq('notifications', 'user_id');
    await deleteEq('push_subscriptions', 'user_id');
    await deleteEq('coupon_logs', 'user_id');
    await deleteEq('card_reports', 'reporter_id');
    await deleteEq('user_titles', 'user_id');
    await deleteEq('user_cosmetics', 'user_id');
    await deleteEq('shop_purchases', 'user_id');
    await deleteEq('user_minigame_tickets', 'user_id');
    await deleteEq('minigame_sessions', 'user_id');
    await deleteEq('user_cards', 'user_id');
    await client.from('streamers').update({ registered_by: null }).eq('registered_by', id);

    const { error: userDeleteError } = await client.from('users').delete().eq('id', id);
    if (userDeleteError) throw userDeleteError;
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

  async updateRepresentativeCard(id: string, channelId: string | null, star: number | null): Promise<void> {
    const { error } = await this.getClient()
      .from('users')
      .update({ representative_card_channel_id: channelId, representative_card_star: star })
      .eq('id', id);
    if (error) throw error;
  }

  async updateStatusMessage(id: string, message: string | null): Promise<void> {
    const { error } = await this.getClient()
      .from('users')
      .update({ status_message: message })
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

  async findRankings(limit: number, keyword: string = '', options?: { mode?: 'total' | 'cards'; channelId?: string; star?: number | null }): Promise<UserRanking[]> {
    // 카드 시세 합산 정렬은 RPC(get_user_rankings) 우선 사용 (keyword 및 rank 포함)
    const mode = options?.mode || 'total';
    const channelId = (options?.channelId || '').trim();
    const star = options?.star ?? null;

    // 특정 카드(채널[+별]) 보유자 랭킹은 RPC가 지원하지 않으므로 전용 경로로 처리합니다.
    // (정상적인 설계상 분기이며 N+1 없이 일괄 조회합니다 — 'RPC 실패' 경고 대상이 아님)
    if (channelId) {
      return this.findCardHolderRankings(limit, keyword, mode, channelId, star);
    }

    if (mode === 'cards') {
      return this.findCardValueRankings(limit, keyword);
    }

    const { data, error } = await this.getClient().rpc('get_user_rankings', { p_limit: limit, p_keyword: keyword });
    if (!error && Array.isArray(data)) {
      const mapped = data.map((row: any) => ({
        id: row.id,
        username: row.username,
        avatar_url: row.avatar_url,
        role: row.role as 'USER' | 'ADMIN',
        point: row.point,
        last_free_draw: row.last_free_draw,
        banned_until: row.banned_until,
        status_message: row.status_message ?? null,
        created_at: row.created_at,
        card_count: Number(row.card_count) || 0,
        cards_value: Number(row.cards_value) || Math.max(0, Number(row.total_asset || 0) - Number(row.point || 0)),
        total_asset: Number(row.total_asset) || row.point,
        rank: Number(row.rank)
      }));
      return mapped;
    }

    // 폴백: RPC가 실제로 실패한 경우에만 도달. 포인트 상위 후보를 가져와 보유 카드 시세를 합산 후 정렬.
    console.warn('[Supabase] get_user_rankings RPC 실패, 포인트 기준 폴백 사용:', error?.message);
    const candidateLimit = Math.min(Math.max(limit * 5, 50), 200);
    let userQuery = this.getClient()
      .from('users')
      .select('*')
      .limit(candidateLimit);
    if (keyword.trim()) {
      userQuery = userQuery.ilike('username', `%${keyword.trim()}%`);
    } else {
      userQuery = userQuery.order('point', { ascending: false });
    }
    const { data: users, error: uErr } = await userQuery;
    if (uErr) throw uErr;
    const candidates = (users || []) as User[];
    if (candidates.length === 0) return [];

    // 후보 유저들의 보유 카드를 한 번에 조회해 N+1을 제거합니다.
    const enriched = await this.enrichWithCardValues(candidates);
    enriched.sort((a, b) => b.total_asset - a.total_asset);
    return enriched.map((item, idx) => ({ ...item, rank: idx + 1 })).slice(0, limit);
  }

  /**
   * 전체 카드 가치 랭킹을 먼저 확정한 뒤 검색어를 적용합니다.
   * 검색 결과만으로 rank를 다시 매기면 프론트 검색 시 기존 순위가 흔들립니다.
   */
  private async findCardValueRankings(limit: number, keyword: string): Promise<UserRanking[]> {
    const users = await this.fetchUsersForRanking();
    if (users.length === 0) return [];

    const kw = (keyword || '').trim();
    const ranked = (await this.enrichWithCardValues(users))
      .sort((a, b) => (b.cards_value || 0) - (a.cards_value || 0) || String(a.id).localeCompare(String(b.id)))
      .map((item, idx) => ({ ...item, rank: idx + 1 }));

    return ranked
      .filter((u) => !kw || fuzzyScore(u.username || '', kw) !== null)
      .slice(0, limit);
  }

  /**
   * 특정 카드(채널[+별]) 보유자 랭킹. RPC 미지원 케이스를 N+1 없이 일괄 조회로 처리합니다.
   * 보유한 해당 카드들의 합산 가치 기준으로 순위를 매깁니다.
   */
  private async findCardHolderRankings(
    limit: number,
    keyword: string,
    mode: 'total' | 'cards',
    channelId: string,
    star: number | null
  ): Promise<UserRanking[]> {
    const ownerIds = await this.fetchCardOwnerIds(channelId, star);
    if (ownerIds.size === 0) return [];
    const kw = (keyword || '').trim();
    const users = await this.fetchUsersForRanking();
    const ranked = (await this.enrichWithCardValues(users))
      .sort((a, b) => mode === 'cards'
        ? (b.cards_value || 0) - (a.cards_value || 0) || String(a.id).localeCompare(String(b.id))
        : b.total_asset - a.total_asset || String(a.id).localeCompare(String(b.id))
      )
      .map((item, idx) => ({ ...item, rank: idx + 1 }));

    return ranked
      .filter((u) => ownerIds.has(u.id))
      .filter((u) => !kw || fuzzyScore(u.username || '', kw) !== null)
      .slice(0, limit);
  }

  private async fetchUsersForRanking(cap = 5000): Promise<User[]> {
    const users: User[] = [];
    const pageSize = 1000;

    for (let offset = 0; offset < cap; offset += pageSize) {
      const { data, error } = await this.getClient()
        .from('users')
        .select('*')
        .order('created_at', { ascending: true })
        .range(offset, Math.min(offset + pageSize - 1, cap - 1));

      if (error) throw error;
      const page = (data || []) as User[];
      users.push(...page);
      if (page.length < pageSize) break;
    }

    return users;
  }

  /**
   * 후보 유저 목록의 보유 카드 가치를 한 번의 조회로 합산해 부여합니다(N+1 제거).
   */
  private async enrichWithCardValues(candidates: User[]): Promise<UserRanking[]> {
    const ids = candidates.map((u) => u.id);
    if (ids.length === 0) return [];

    const cards = await this.fetchVisibleCardsByUserIds(ids);
    const channelIds = Array.from(new Set(cards.map((card) => card.channel_id).filter(Boolean)));
    const baseValueMap = await this.fetchStreamerBaseValueMap(channelIds);
    const agg = new Map<string, { value: number; count: number }>();
    for (const c of cards) {
      const value = (baseValueMap.get(c.channel_id) || 0) * (1 + (c.star || 0) * 0.8);
      const cur = agg.get(c.user_id) || { value: 0, count: 0 };
      cur.value += value;
      cur.count += 1;
      agg.set(c.user_id, cur);
    }
    return candidates.map((u) => {
      const a = agg.get(u.id) || { value: 0, count: 0 };
      const cardsValue = Math.round(a.value);
      return { ...u, card_count: a.count, cards_value: cardsValue, total_asset: u.point + cardsValue };
    });
  }

  private async fetchVisibleCardsByUserIds(userIds: string[]): Promise<{ user_id: string; channel_id: string; star: number }[]> {
    const cards: { user_id: string; channel_id: string; star: number }[] = [];
    const userIdSet = new Set(userIds);
    const pageSize = 1000;

    // 많은 user_id를 .in(...)에 넣으면 Supabase 요청 URL/헤더가 16KB를 넘어
    // UND_ERR_HEADERS_OVERFLOW가 발생할 수 있습니다. 카드 목록은 페이지 단위로 읽고
    // 대상 유저 필터링은 서버 메모리에서 수행합니다.
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await this.getClient()
        .from('user_cards')
        .select('id, user_id, channel_id, star')
        .or('is_hidden.is.null,is_hidden.eq.false')
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (error) throw error;
      for (const row of data || []) {
        if (userIdSet.has(row.user_id)) {
          cards.push({
            user_id: row.user_id,
            channel_id: row.channel_id,
            star: Number(row.star || 0)
          });
        }
      }
      if (!data || data.length < pageSize) break;
    }

    return cards;
  }

  private async fetchCardOwnerIds(channelId: string, star: number | null): Promise<Set<string>> {
    const ownerIds = new Set<string>();
    const pageSize = 1000;

    for (let offset = 0; ; offset += pageSize) {
      let query = this.getClient()
        .from('user_cards')
        .select('user_id')
        .eq('channel_id', channelId)
        .or('is_hidden.is.null,is_hidden.eq.false')
        .range(offset, offset + pageSize - 1);
      if (star !== null) query = query.eq('star', star);

      const { data, error } = await query;
      if (error) throw error;
      for (const row of data || []) {
        if (row.user_id) ownerIds.add(row.user_id);
      }
      if (!data || data.length < pageSize) break;
    }

    return ownerIds;
  }

  private async fetchStreamerBaseValueMap(channelIds: string[]): Promise<Map<string, number>> {
    const valueMap = new Map<string, number>();
    const channelIdSet = new Set(channelIds);
    const pageSize = 1000;

    // channel_id 배열도 커지면 .in(...) URL이 길어질 수 있어 전체 스트리머를
    // 페이지 단위로 읽고 필요한 채널만 매핑합니다.
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await this.getClient()
        .from('streamers')
        .select('channel_id, base_value')
        .order('channel_id', { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (error) throw error;
      for (const streamer of data || []) {
        if (channelIdSet.has(streamer.channel_id)) {
          valueMap.set(streamer.channel_id, Number(streamer.base_value || 0));
        }
      }
      if (!data || data.length < pageSize) break;
    }

    return valueMap;
  }
}

// 별(0~5성)별 커스텀 이미지 컬럼명 (인덱스 0 = 0성 = custom_image_url)
