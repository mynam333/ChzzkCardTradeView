import { getSupabaseClient } from "../../services/db";
import { IMinigameRepository, UserMinigameTicket, MinigameSession, MinigameType } from "../interfaces";

const MAX_AUTO_TICKETS = 5;

export class SupabaseMinigameRepository implements IMinigameRepository {
  private getClient() {
    return getSupabaseClient();
  }

  async getTicketStatus(userId: string): Promise<UserMinigameTicket> {
    const client = this.getClient();
    // 1. 조회 시도
    const { data: ticket, error } = await client
      .from('user_minigame_tickets')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !ticket) {
      // 2. 존재하지 않으면 기본 5개로 신규 생성
      const now = new Date().toISOString();
      const newTicket = {
        user_id: userId,
        current_tickets: 5,
        bonus_tickets: 0,
        last_charged_at: now,
        updated_at: now
      };

      const { data: inserted, error: insertError } = await client
        .from('user_minigame_tickets')
        .insert(newTicket)
        .select()
        .maybeSingle();

      if (insertError || !inserted) {
        console.warn('[Supabase Minigame Repo] Ticket init failed, returning mock initial ticket:', insertError?.message);
        return newTicket;
      }
      return inserted as UserMinigameTicket;
    }

    return {
      ...(ticket as UserMinigameTicket),
      bonus_tickets: (ticket as any).bonus_tickets ?? 0
    };
  }

  async updateTickets(userId: string, currentTickets: number, lastChargedAt: string): Promise<void> {
    const client = this.getClient();
    const now = new Date().toISOString();
    await client
      .from('user_minigame_tickets')
      .update({
        current_tickets: currentTickets,
        last_charged_at: lastChargedAt,
        updated_at: now
      })
      .eq('user_id', userId);
  }

  async addBonusTickets(userId: string, amount: number): Promise<UserMinigameTicket> {
    const client = this.getClient();
    const qty = Math.max(0, Math.floor(amount) || 0);
    const { data, error } = await client.rpc('add_minigame_bonus_tickets', {
      p_user_id: userId,
      p_amount: qty
    });

    if (!error && data) {
      return data as UserMinigameTicket;
    }

    if (error) {
      console.warn('[Supabase Minigame Repo] add_minigame_bonus_tickets RPC 실패, RMW 폴백 수행:', error.message);
    }

    const ticket = await this.getTicketStatus(userId);
    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await client
      .from('user_minigame_tickets')
      .upsert({
        user_id: userId,
        current_tickets: ticket.current_tickets ?? 5,
        bonus_tickets: (ticket.bonus_tickets || 0) + qty,
        last_charged_at: ticket.last_charged_at || now,
        updated_at: now
      }, { onConflict: 'user_id' })
      .select()
      .maybeSingle();

    if (updateError || !updated) throw updateError || new Error('보너스 티켓 지급에 실패했습니다.');
    return updated as UserMinigameTicket;
  }

  async startSession(session: MinigameSession): Promise<{ ok: boolean; reason?: string }> {
    const client = this.getClient();
    try {
      let practiceMode = false;
      try {
        practiceMode = JSON.parse(session.target_data)?.practice_mode === true;
      } catch {
        practiceMode = false;
      }

      if (practiceMode) {
        const { error } = await client
          .from('minigame_sessions')
          .insert({
            id: session.id,
            user_id: session.user_id,
            game_type: session.game_type,
            status: session.status,
            target_data: session.target_data,
            ticket_spent_type: 'NONE',
            created_at: new Date().toISOString()
          });

        return {
          ok: !error,
          reason: error ? '연습 게임 세션 생성 중 오류가 발생했습니다.' : undefined
        };
      }

      const { data: rpcResult, error: rpcError } = await client.rpc('start_minigame_session_atomic', {
        p_session_id: session.id,
        p_user_id: session.user_id,
        p_game_type: session.game_type,
        p_target_data: session.target_data
      });
      if (!rpcError) {
        const reason = String(rpcResult);
        return { ok: reason === 'OK', reason: reason === 'OK' ? undefined : reason };
      }
      console.warn('[Supabase Minigame Repo] start_minigame_session_atomic RPC 실패, RMW 폴백 수행:', rpcError.message);

      // RMW 방식으로 티켓 검증 및 차감 진행 (원자적 RPC 미설치 대응 폴백 구성)
      const ticket = await this.getTicketStatus(session.user_id);
      if ((ticket.current_tickets || 0) + (ticket.bonus_tickets || 0) <= 0) {
        return { ok: false, reason: '사용 가능한 미니게임 티켓이 부족합니다.' };
      }

      // 1. 티켓 차감
      const now = new Date().toISOString();
      const useBase = (ticket.current_tickets || 0) > 0;
      const ticketSpentType = useBase ? 'BASE' : 'BONUS';
      const { error: ticketError } = await client
        .from('user_minigame_tickets')
        .update({
          current_tickets: useBase ? ticket.current_tickets - 1 : ticket.current_tickets,
          bonus_tickets: useBase ? ticket.bonus_tickets : ticket.bonus_tickets - 1,
          updated_at: now
        })
        .eq('user_id', session.user_id);

      if (ticketError) {
        console.error('[Supabase Minigame Repo] Ticket deduct error:', ticketError.message);
        return { ok: false, reason: '티켓 차감 중 오류가 발생했습니다.' };
      }

      // 2. 세션 인서트
      const { error: sessionError } = await client
        .from('minigame_sessions')
        .insert({
          id: session.id,
          user_id: session.user_id,
          game_type: session.game_type,
          status: session.status,
          target_data: session.target_data,
          ticket_spent_type: ticketSpentType,
          created_at: now
        });

      if (sessionError) {
        console.error('[Supabase Minigame Repo] Session start error:', sessionError.message);
        // 실패 시 티켓 복구 시도
        await client
          .from('user_minigame_tickets')
          .update({
            current_tickets: ticket.current_tickets,
            bonus_tickets: ticket.bonus_tickets,
            updated_at: now
          })
          .eq('user_id', session.user_id);

        return { ok: false, reason: '세션 생성 중 오류가 발생했습니다.' };
      }

      return { ok: true };
    } catch (e: any) {
      console.error('[Supabase Minigame Repo] startSession 예외:', e);
      return { ok: false, reason: e.message || '서버 통신 예외가 발생했습니다.' };
    }
  }

  async completeSession(sessionId: string, earnedPoints: number): Promise<{ ok: boolean; reason?: string; newPoints?: number }> {
    const client = this.getClient();
    try {
      // 1. 세션 조회
      const { data: session, error: findError } = await client
        .from('minigame_sessions')
        .select('*')
        .eq('id', sessionId)
        .maybeSingle();

      if (findError || !session) {
        return { ok: false, reason: '존재하지 않는 미니게임 세션입니다.' };
      }
      if (session.status !== 'STARTED') {
        return { ok: false, reason: '이미 완료되었거나 만료된 세션입니다.' };
      }

      // 2. 세션 완료 처리
      const now = new Date().toISOString();
      const { error: updateError } = await client
        .from('minigame_sessions')
        .update({
          status: 'COMPLETED',
          earned_points: earnedPoints,
          completed_at: now
        })
        .eq('id', sessionId);

      if (updateError) {
        return { ok: false, reason: '세션 완료 처리 중 오류가 발생했습니다.' };
      }

      // 3. 포인트 가산 (유저 포인트 증감 RPC 호출, 실패 시 RMW 폴백)
      const { error: rpcError } = await client.rpc('increment_user_point', { p_id: session.user_id, p_delta: earnedPoints });
      if (rpcError) {
        console.warn('[Supabase Minigame Repo] increment_user_point RPC 실패, RMW 폴백 수행:', rpcError.message);
        // RMW 폴백
        const { data: user, error: userFindError } = await client
          .from('users')
          .select('point')
          .eq('id', session.user_id)
          .single();

        if (!userFindError && user) {
          await client
            .from('users')
            .update({ point: (user.point || 0) + earnedPoints })
            .eq('id', session.user_id);
        }
      }

      // 4. 최신 포인트 조회
      const { data: latestUser } = await client
        .from('users')
        .select('point')
        .eq('id', session.user_id)
        .maybeSingle();

      return { ok: true, newPoints: latestUser?.point ?? 0 };
    } catch (e: any) {
      console.error('[Supabase Minigame Repo] completeSession 예외:', e);
      return { ok: false, reason: e.message || '서버 통신 예외가 발생했습니다.' };
    }
  }

  async findSessionById(id: string): Promise<MinigameSession | null> {
    const { data, error } = await this.getClient()
      .from('minigame_sessions')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) return null;
    return data as MinigameSession;
  }

  async findActiveStartedSession(userId: string, gameType: MinigameType): Promise<MinigameSession | null> {
    const { data, error } = await this.getClient()
      .from('minigame_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('game_type', gameType)
      .eq('status', 'STARTED')
      .neq('ticket_spent_type', 'NONE')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return data as MinigameSession;
  }

  async expireSessions(olderThanMinutes: number, limit = 50): Promise<void> {
    const client = this.getClient();
    const limitDate = new Date(Date.now() - olderThanMinutes * 60 * 1000).toISOString();
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 50)));

    const { data: sessions, error: selectError } = await client
      .from('minigame_sessions')
      .select('*')
      .eq('status', 'STARTED')
      .lt('created_at', limitDate)
      .order('created_at', { ascending: true })
      .limit(safeLimit);

    if (selectError || !sessions?.length) return;

    for (const session of sessions as any[]) {
      const { data: expired, error: updateError } = await client
        .from('minigame_sessions')
        .update({
          status: 'EXPIRED',
          completed_at: new Date().toISOString()
        })
        .eq('id', session.id)
        .eq('status', 'STARTED')
        .select('*')
        .maybeSingle();

      if (updateError || !expired) continue;
    }
  }
}
