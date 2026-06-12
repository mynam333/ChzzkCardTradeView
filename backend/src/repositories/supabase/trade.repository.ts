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
  AdminTradeListOptions,
  AdminTradeListResult,
  AppNotification
} from '../interfaces';

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

  private async findParticipantIds(search?: string): Promise<string[] | null> {
    const keyword = String(search || '').trim();
    if (!keyword) return null;

    const { data, error } = await this.getClient()
      .from('users')
      .select('id')
      .or(`id.eq.${keyword},username.eq.${keyword},username.ilike.%${keyword}%`)
      .limit(40);
    if (error) throw error;
    return (data || []).map((row: any) => row.id);
  }

  async listForAdmin(options: AdminTradeListOptions): Promise<AdminTradeListResult> {
    const page = Math.max(1, Math.floor(options.page || 1));
    const limit = Math.max(1, Math.min(100, Math.floor(options.limit || 30)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const participantIds = await this.findParticipantIds(options.search);
    if (participantIds && participantIds.length === 0) {
      return { items: [], total: 0, page, limit, total_pages: 1 };
    }

    let query = this.getClient()
      .from('trades')
      .select('*, sender:users!trades_sender_id_fkey(username), receiver:users!trades_receiver_id_fkey(username)', { count: 'exact' });

    if (options.status && options.status !== 'ALL') {
      query = query.eq('status', options.status);
    }
    if (participantIds) {
      query = query.or(`sender_id.in.(${participantIds.join(',')}),receiver_id.in.(${participantIds.join(',')})`);
    }

    const { data, error, count } = await query
      .order('id', { ascending: false })
      .range(from, to);

    if (error) throw error;

    const items = (data || []).map((row: any) => ({
      ...row,
      sender_username: row.sender?.username,
      receiver_username: row.receiver?.username
    })) as Trade[];
    const total = count || 0;
    return {
      items,
      total,
      page,
      limit,
      total_pages: Math.max(1, Math.ceil(total / limit))
    };
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

// 8. Supabase 인앱 알림 레포지토리
