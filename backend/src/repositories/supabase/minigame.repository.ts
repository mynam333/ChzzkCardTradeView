import { getSupabaseClient } from "../../services/db";
import {
  IMinigameRepository,
  UserMinigameTicket,
  RefreshedMinigameTicket,
  MinigameSession,
  MinigameType,
  MinigameRoundOutcomeResult,
  MinigameRoundDeadlineArmResult,
  MinigameCompletionResult
} from "../interfaces";

const MAX_AUTO_TICKETS = 5;
const DEFAULT_TICKET_CHARGE_INTERVAL_MINUTES = 240;
const ALLOWED_MINIGAME_REWARDS = new Set([0, 1000, 1200]);

const parseDbJson = <T = any>(value: unknown, fallback: T): T => {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
};

const normalizeProgressData = (value: unknown): Record<string, any> => {
  const parsed = parseDbJson<Record<string, any>>(value, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
};

const normalizeRoundDeadline = (value: string | null): { ok: true; value: string | null } | { ok: false } => {
  if (value === null) return { ok: true, value: null };
  const trimmed = String(value).trim();
  const deadlineMs = trimmed ? new Date(trimmed).getTime() : NaN;
  if (!Number.isFinite(deadlineMs)) return { ok: false };
  return { ok: true, value: new Date(deadlineMs).toISOString() };
};

const mapSession = (row: any): MinigameSession => ({
  ...(row as MinigameSession),
  earned_points: Number(row?.earned_points ?? 0),
  validation_version: Number(row?.validation_version ?? 0),
  progress_data: typeof row?.progress_data === 'string' ? row.progress_data : JSON.stringify(row?.progress_data || {}),
  progress_revision: Number(row?.progress_revision ?? 0),
  expires_at: row?.expires_at ?? null,
  result_data: typeof row?.result_data === 'string' || row?.result_data == null
    ? row?.result_data ?? null
    : JSON.stringify(row.result_data)
});

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

  async refreshTicketStatus(userId: string, chargeIntervalMinutes: number): Promise<RefreshedMinigameTicket> {
    const intervalMinutes = Number.isFinite(Number(chargeIntervalMinutes)) && Number(chargeIntervalMinutes) >= 1
      ? Math.floor(Number(chargeIntervalMinutes))
      : DEFAULT_TICKET_CHARGE_INTERVAL_MINUTES;
    const { data, error } = await this.getClient().rpc('refresh_minigame_ticket_status', {
      p_user_id: userId,
      p_charge_interval_minutes: intervalMinutes
    });
    if (!error && data) {
      const ticket = Array.isArray(data) ? data[0] : data;
      if (ticket) {
        return {
          ...(ticket as UserMinigameTicket),
          current_tickets: Number(ticket.current_tickets ?? MAX_AUTO_TICKETS),
          bonus_tickets: Number(ticket.bonus_tickets ?? 0),
          seconds_until_next_ticket: Math.max(0, Number(ticket.seconds_until_next_ticket ?? intervalMinutes * 60))
        };
      }
    }

    if (error) {
      console.warn('[Supabase Minigame Repo] refresh_minigame_ticket_status RPC 실패, 비변경 조회로 폴백:', error.message);
    }
    // Do not perform an unlocked read-modify-write fallback: it could restore a ticket
    // concurrently consumed by startSession. A stale countdown is safer than minting a ticket.
    const ticket = await this.getTicketStatus(userId);
    const intervalMs = intervalMinutes * 60 * 1000;
    const lastChargedMs = new Date(ticket.last_charged_at).getTime();
    const secondsUntilNextTicket = ticket.current_tickets >= MAX_AUTO_TICKETS
      ? intervalMinutes * 60
      : Number.isFinite(lastChargedMs)
        ? Math.max(0, Math.ceil((lastChargedMs + intervalMs - Date.now()) / 1000))
        : intervalMinutes * 60;
    return { ...ticket, seconds_until_next_ticket: secondsUntilNextTicket };
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

  async startSession(session: MinigameSession, chargeIntervalMinutes = DEFAULT_TICKET_CHARGE_INTERVAL_MINUTES): Promise<{ ok: boolean; reason?: string }> {
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
            created_at: session.created_at || new Date().toISOString(),
            validation_version: Math.max(0, Math.floor(Number(session.validation_version ?? 0))),
            progress_data: JSON.stringify(normalizeProgressData(session.progress_data)),
            progress_revision: Math.max(0, Math.floor(Number(session.progress_revision ?? 0))),
            expires_at: session.expires_at ?? null,
            result_data: session.result_data ?? null
          });

        return {
          ok: !error,
          reason: error ? '연습 게임 세션 생성 중 오류가 발생했습니다.' : undefined
        };
      }

      const { data: rpcResult, error: rpcError } = await client.rpc('start_minigame_session_authoritative_atomic', {
        p_session_id: session.id,
        p_user_id: session.user_id,
        p_game_type: session.game_type,
        p_target_data: session.target_data,
        p_charge_interval_minutes: Number.isFinite(Number(chargeIntervalMinutes)) && Number(chargeIntervalMinutes) >= 1
          ? Math.floor(Number(chargeIntervalMinutes))
          : DEFAULT_TICKET_CHARGE_INTERVAL_MINUTES,
        p_validation_version: Math.max(0, Math.floor(Number(session.validation_version ?? 0))),
        p_progress_data: JSON.stringify(normalizeProgressData(session.progress_data)),
        p_expires_at: session.expires_at ?? null,
        p_result_data: session.result_data ?? null
      });
      if (!rpcError) {
        const reason = String(rpcResult);
        return { ok: reason === 'OK', reason: reason === 'OK' ? undefined : reason };
      }
      console.warn('[Supabase Minigame Repo] authoritative start RPC 실패, 보상형 시작을 차단합니다:', rpcError.message);
      return { ok: false, reason: '원자적 미니게임 시작 기능이 준비되지 않았습니다.' };
    } catch (e: any) {
      console.error('[Supabase Minigame Repo] startSession 예외:', e);
      return { ok: false, reason: e.message || '서버 통신 예외가 발생했습니다.' };
    }
  }

  async armRoundDeadline(
    sessionId: string,
    userId: string,
    round: number,
    roundDeadlineAt: string
  ): Promise<MinigameRoundDeadlineArmResult> {
    if (!Number.isInteger(round) || round < 0) return { ok: false, reason: '라운드 번호가 올바르지 않습니다.' };
    const normalizedDeadline = normalizeRoundDeadline(roundDeadlineAt);
    if (!normalizedDeadline.ok || !normalizedDeadline.value) {
      return { ok: false, reason: '라운드 마감 정보가 올바르지 않습니다.' };
    }
    if (new Date(normalizedDeadline.value).getTime() <= Date.now()) {
      return { ok: false, reason: '새 라운드 마감 시간은 미래여야 합니다.' };
    }

    const client = this.getClient();
    const loadSession = async () => {
      const { data, error } = await client
        .from('minigame_sessions')
        .select('*')
        .eq('id', sessionId)
        .eq('user_id', userId)
        .maybeSingle();
      return error || !data ? null : data;
    };

    // A losing concurrent caller reloads the winning revision and returns its
    // deadline. It never writes its later candidate deadline over the winner.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const row = await loadSession();
      if (!row) return { ok: false, reason: '존재하지 않는 미니게임 세션입니다.' };
      if (row.status !== 'STARTED') return { ok: false, reason: '이미 종료되었거나 만료된 세션입니다.' };
      if (
        !['crop_detective', 'value_duel'].includes(String(row.game_type)) ||
        !['BASE', 'BONUS'].includes(String(row.ticket_spent_type || 'NONE'))
      ) {
        return { ok: false, reason: '라운드 시작을 지원하는 보상형 미니게임 세션이 아닙니다.' };
      }

      const expiresAtMs = row.expires_at ? new Date(row.expires_at).getTime() : NaN;
      if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
        await client.from('minigame_sessions')
          .update({ status: 'EXPIRED', completed_at: new Date().toISOString() })
          .eq('id', sessionId)
          .eq('user_id', userId)
          .eq('status', 'STARTED');
        return { ok: false, reason: '미니게임 세션이 만료되었습니다.' };
      }

      const progress = normalizeProgressData(row.progress_data);
      const outcomes = Array.isArray(progress.round_outcomes) ? progress.round_outcomes : [];
      const validStoredOutcomes = outcomes.every((outcome: any, index: number) =>
        outcome && Number(outcome.round) === index &&
        (outcome.selected_channel_id === null || typeof outcome.selected_channel_id === 'string')
      );
      if (!validStoredOutcomes) return { ok: false, reason: '저장된 미니게임 진행 상태가 올바르지 않습니다.' };
      if (round !== outcomes.length) return { ok: false, reason: '현재 순서의 라운드만 준비할 수 있습니다.' };

      const target = parseDbJson<any>(row.target_data, {});
      const rounds = Array.isArray(target?.rounds) ? target.rounds : [];
      if (!rounds[round] || Number(rounds[round]?.round) !== round) {
        return { ok: false, reason: '존재하지 않는 라운드입니다.' };
      }

      const markerKey = row.game_type === 'crop_detective'
        ? 'round_image_armed_round'
        : 'round_started_round';
      const armedRound = progress[markerKey];
      if (armedRound != null && (!Number.isInteger(armedRound) || armedRound < 0)) {
        return { ok: false, reason: '저장된 라운드 시작 상태가 올바르지 않습니다.' };
      }
      const storedDeadlineRaw = progress.round_deadline_at;
      const storedDeadlineMs = typeof storedDeadlineRaw === 'string'
        ? new Date(storedDeadlineRaw).getTime()
        : NaN;
      if (armedRound === round) {
        if (!Number.isFinite(storedDeadlineMs)) {
          return { ok: false, reason: '저장된 라운드 마감 정보가 올바르지 않습니다.' };
        }
        if (storedDeadlineMs <= Date.now()) {
          return { ok: false, reason: '이미 마감된 라운드는 다시 준비할 수 없습니다.' };
        }
        return { ok: true, armedNow: false, session: mapSession(row) };
      }
      if (armedRound != null) {
        return { ok: false, reason: '현재 라운드와 저장된 시작 상태가 일치하지 않습니다.' };
      }
      if (row.game_type === 'value_duel' && Number.isFinite(storedDeadlineMs)) {
        if (storedDeadlineMs <= Date.now()) {
          return { ok: false, reason: '이미 마감된 라운드는 다시 시작할 수 없습니다.' };
        }
        return { ok: true, armedNow: false, session: mapSession(row) };
      }

      const currentRevision = Math.max(0, Math.floor(Number(row.progress_revision ?? 0)));
      const nextProgressData = JSON.stringify({
        ...progress,
        round_outcomes: outcomes,
        round_deadline_at: normalizedDeadline.value,
        [markerKey]: round
      });
      const { data: updated, error: updateError } = await client
        .from('minigame_sessions')
        .update({ progress_data: nextProgressData, progress_revision: currentRevision + 1 })
        .eq('id', sessionId)
        .eq('user_id', userId)
        .eq('status', 'STARTED')
        .eq('progress_revision', currentRevision)
        .select('*')
        .maybeSingle();
      if (!updateError && updated) {
        return { ok: true, armedNow: true, session: mapSession(updated) };
      }
    }

    return { ok: false, reason: '미니게임 진행 상태가 변경되었습니다. 다시 시도해 주세요.' };
  }

  async recordRoundOutcome(
    sessionId: string,
    userId: string,
    round: number,
    selectedChannelId: string | null,
    nextRoundDeadlineAt: string | null
  ): Promise<MinigameRoundOutcomeResult> {
    if (!Number.isInteger(round) || round < 0) return { ok: false, reason: '라운드 번호가 올바르지 않습니다.' };
    const normalizedSelection = selectedChannelId == null ? null : String(selectedChannelId).trim();
    if (selectedChannelId != null && !normalizedSelection) return { ok: false, reason: '선택한 답안이 올바르지 않습니다.' };
    const receivedAtMs = Date.now();

    const client = this.getClient();
    const loadSession = async () => {
      const { data, error } = await client
        .from('minigame_sessions')
        .select('*')
        .eq('id', sessionId)
        .eq('user_id', userId)
        .maybeSingle();
      return error || !data ? null : data;
    };

    const row = await loadSession();
    if (!row) return { ok: false, reason: '존재하지 않는 미니게임 세션입니다.' };
    if (row.status !== 'STARTED') return { ok: false, reason: '이미 종료되었거나 만료된 세션입니다.' };

    const expiresAtMs = row.expires_at ? new Date(row.expires_at).getTime() : NaN;
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
      await client.from('minigame_sessions')
        .update({ status: 'EXPIRED', completed_at: new Date().toISOString() })
        .eq('id', sessionId)
        .eq('user_id', userId)
        .eq('status', 'STARTED');
      return { ok: false, reason: '미니게임 세션이 만료되었습니다.' };
    }

    const progress = normalizeProgressData(row.progress_data);
    const outcomes = Array.isArray(progress.round_outcomes) ? progress.round_outcomes : [];
    const validStoredOutcomes = outcomes.every((outcome: any, index: number) =>
      outcome && Number(outcome.round) === index &&
      (outcome.selected_channel_id === null || typeof outcome.selected_channel_id === 'string')
    );
    if (!validStoredOutcomes) return { ok: false, reason: '저장된 미니게임 진행 상태가 올바르지 않습니다.' };
    if (round < outcomes.length) {
      const storedSelection = outcomes[round]?.selected_channel_id ?? null;
      if (storedSelection !== normalizedSelection) return { ok: false, reason: '이미 다른 답안으로 처리된 라운드입니다.' };
      return { ok: true, session: mapSession(row), duplicate: true };
    }
    if (round !== outcomes.length) return { ok: false, reason: '라운드 답안은 순서대로 제출해야 합니다.' };

    const currentDeadlineMs = typeof progress.round_deadline_at === 'string'
      ? new Date(progress.round_deadline_at).getTime()
      : NaN;
    if (
      row.game_type === 'crop_detective' &&
      (progress.round_image_armed_round !== round || !Number.isFinite(currentDeadlineMs))
    ) {
      return { ok: false, reason: '확대 이미지 준비가 끝나지 않아 라운드가 아직 시작되지 않았습니다.' };
    }
    if (row.game_type === 'value_duel') {
      const hasStartedMarker = Object.prototype.hasOwnProperty.call(progress, 'round_started_round');
      const startedRound = progress.round_started_round;
      if (
        (hasStartedMarker && (startedRound !== round || !Number.isFinite(currentDeadlineMs))) ||
        (!hasStartedMarker && !Number.isFinite(currentDeadlineMs))
      ) {
        return { ok: false, reason: '시세 듀얼 라운드가 아직 시작되지 않았습니다.' };
      }
    }
    if (normalizedSelection !== null) {
      if (!Number.isFinite(currentDeadlineMs)) {
        return { ok: false, reason: '서버 라운드 마감 정보가 없어 답안을 처리할 수 없습니다.' };
      }
      if (receivedAtMs >= currentDeadlineMs) {
        return { ok: false, reason: '라운드 답안 제출 시간이 마감되었습니다.' };
      }
    }
    const nextDeadline = normalizeRoundDeadline(
      row.game_type === 'value_duel' ? null : nextRoundDeadlineAt
    );
    if (!nextDeadline.ok) {
      return { ok: false, reason: '다음 라운드 마감 정보가 올바르지 않습니다.' };
    }

    const currentRevision = Math.max(0, Math.floor(Number(row.progress_revision ?? 0)));
    const nextProgressData = JSON.stringify({
      ...progress,
      round_outcomes: [...outcomes, { round, selected_channel_id: normalizedSelection }],
      round_deadline_at: nextDeadline.value,
      ...(row.game_type === 'crop_detective' ? { round_image_armed_round: null } : {}),
      ...(row.game_type === 'value_duel' ? { round_started_round: null } : {})
    });
    const { data: updated, error: updateError } = await client
      .from('minigame_sessions')
      .update({ progress_data: nextProgressData, progress_revision: currentRevision + 1 })
      .eq('id', sessionId)
      .eq('user_id', userId)
      .eq('status', 'STARTED')
      .eq('progress_revision', currentRevision)
      .select('*')
      .maybeSingle();
    if (!updateError && updated) {
      return { ok: true, session: mapSession(updated), duplicate: false };
    }

    const latest = await loadSession();
    if (latest) {
      const latestOutcomes = normalizeProgressData(latest.progress_data).round_outcomes;
      const storedSelection = Array.isArray(latestOutcomes) ? latestOutcomes[round]?.selected_channel_id ?? null : undefined;
      if (storedSelection === normalizedSelection) {
        return { ok: true, session: mapSession(latest), duplicate: true };
      }
    }
    return { ok: false, reason: '미니게임 진행 상태가 변경되었습니다. 다시 시도해 주세요.' };
  }

  async completeSession(
    sessionId: string,
    earnedPoints: number,
    resultData?: string
  ): Promise<MinigameCompletionResult> {
    if (!Number.isInteger(earnedPoints) || !ALLOWED_MINIGAME_REWARDS.has(earnedPoints)) {
      return { ok: false, reason: '허용되지 않은 미니게임 보상입니다.' };
    }
    const client = this.getClient();
    try {
      // p_user_id는 RPC 내부의 소유권 일치 검증용입니다. 실제 변경은 아래 RPC 하나에서만 수행합니다.
      const { data: owner, error: ownerError } = await client
        .from('minigame_sessions')
        .select('user_id')
        .eq('id', sessionId)
        .maybeSingle();

      if (ownerError || !owner?.user_id) {
        return { ok: false, reason: '존재하지 않는 미니게임 세션입니다.' };
      }

      const { data, error } = await client.rpc('complete_minigame_session_authoritative_atomic', {
        p_session_id: sessionId,
        p_user_id: String(owner.user_id),
        p_earned_points: earnedPoints,
        p_result_data: resultData ?? null
      });
      if (error) {
        console.warn('[Supabase Minigame Repo] authoritative complete RPC 실패, 정산을 차단합니다:', error.message);
        return { ok: false, reason: '원자적 미니게임 완료 기능이 준비되지 않았습니다.' };
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.ok) {
        return { ok: false, reason: String(row?.reason || '미니게임 세션 완료 처리에 실패했습니다.') };
      }
      return {
        ok: true,
        settledNow: row.settled_now === true,
        newPoints: Number(row.new_points ?? 0),
        earnedPoints: Number(row.earned_points ?? 0),
        resultData: typeof row.result_data === 'string' || row.result_data == null
          ? row.result_data ?? null
          : JSON.stringify(row.result_data)
      };
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
    return mapSession(data);
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
    return mapSession(data);
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
