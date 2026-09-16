import { getSqliteDb } from "../../services/db";
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
import { recordSqlitePointLedger } from "../../services/pointLedger";

const MAX_AUTO_TICKETS = 5;
const DEFAULT_TICKET_CHARGE_INTERVAL_MINUTES = 240;
const ALLOWED_MINIGAME_REWARDS = new Set([0, 1000, 1200]);

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const formatKstDbTime = (dateMs = Date.now()): string => {
  const kst = new Date(dateMs + KST_OFFSET_MS);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')} ${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}:${String(kst.getUTCSeconds()).padStart(2, '0')}`;
};

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

const calculateTicketRefresh = (
  row: any,
  userId: string,
  chargeIntervalMinutes: number,
  nowMs = Date.now()
): RefreshedMinigameTicket => {
  const intervalMinutes = Number.isFinite(Number(chargeIntervalMinutes)) && Number(chargeIntervalMinutes) >= 1
    ? Math.floor(Number(chargeIntervalMinutes))
    : DEFAULT_TICKET_CHARGE_INTERVAL_MINUTES;
  const intervalMs = intervalMinutes * 60 * 1000;
  const nowIso = new Date(nowMs).toISOString();
  let currentTickets = Math.max(0, Math.min(MAX_AUTO_TICKETS, Math.floor(Number(row?.current_tickets ?? MAX_AUTO_TICKETS))));
  const bonusTickets = Math.max(0, Math.floor(Number(row?.bonus_tickets ?? 0)));
  let lastChargedAt = String(row?.last_charged_at || nowIso);
  let lastChargedMs = new Date(lastChargedAt).getTime();

  if (!Number.isFinite(lastChargedMs) || lastChargedMs > nowMs) {
    lastChargedMs = nowMs;
    lastChargedAt = nowIso;
  }
  if (currentTickets >= MAX_AUTO_TICKETS) {
    currentTickets = MAX_AUTO_TICKETS;
    lastChargedAt = nowIso;
  } else {
    const elapsedMs = nowMs - lastChargedMs;
    if (elapsedMs >= intervalMs) {
      const chargedCount = Math.floor(elapsedMs / intervalMs);
      currentTickets = Math.min(MAX_AUTO_TICKETS, currentTickets + chargedCount);
      lastChargedMs = currentTickets === MAX_AUTO_TICKETS
        ? nowMs
        : lastChargedMs + chargedCount * intervalMs;
      lastChargedAt = new Date(lastChargedMs).toISOString();
    }
  }

  return {
    user_id: row?.user_id ?? userId,
    current_tickets: currentTickets,
    bonus_tickets: bonusTickets,
    last_charged_at: lastChargedAt,
    updated_at: String(row?.updated_at || nowIso),
    seconds_until_next_ticket: currentTickets >= MAX_AUTO_TICKETS
      ? intervalMinutes * 60
      : Math.max(0, Math.ceil((new Date(lastChargedAt).getTime() + intervalMs - nowMs) / 1000))
  };
};

export class SqliteMinigameRepository implements IMinigameRepository {
  private getDb() {
    return getSqliteDb();
  }

  private mapTicket(row: any, userId: string): UserMinigameTicket {
    return {
      user_id: row?.user_id ?? userId,
      current_tickets: Number(row?.current_tickets ?? MAX_AUTO_TICKETS),
      bonus_tickets: Number(row?.bonus_tickets ?? 0),
      last_charged_at: String(row?.last_charged_at || new Date().toISOString()),
      updated_at: row?.updated_at == null ? undefined : String(row.updated_at)
    };
  }

  private mapSession(row: any): MinigameSession {
    return {
      id: row.id,
      user_id: row.user_id,
      game_type: row.game_type as MinigameType,
      status: row.status,
      target_data: row.target_data,
      ticket_spent_type: row.ticket_spent_type ?? null,
      created_at: row.created_at,
      completed_at: row.completed_at,
      earned_points: Number(row.earned_points ?? 0),
      validation_version: Number(row.validation_version ?? 0),
      progress_data: typeof row.progress_data === 'string' ? row.progress_data : JSON.stringify(row.progress_data || {}),
      progress_revision: Number(row.progress_revision ?? 0),
      expires_at: row.expires_at ?? null,
      result_data: typeof row.result_data === 'string' || row.result_data == null
        ? row.result_data ?? null
        : JSON.stringify(row.result_data)
    };
  }

  async getTicketStatus(userId: string): Promise<UserMinigameTicket> {
    const db = this.getDb();
    // 1. 조회 시도
    let row = db.prepare('SELECT * FROM user_minigame_tickets WHERE user_id = ?').get(userId) as any;
    if (!row) {
      // 2. 존재하지 않으면 기본 5개로 신규 생성
      const now = new Date().toISOString();
      try {
        db.prepare(
          'INSERT OR IGNORE INTO user_minigame_tickets (user_id, current_tickets, last_charged_at, updated_at) VALUES (?, 5, ?, ?)'
        ).run(userId, now, now);
      } catch (err) {
        console.error('[SQLite Minigame Repo] Ticket init error:', err);
      }
      row = db.prepare('SELECT * FROM user_minigame_tickets WHERE user_id = ?').get(userId) as any;
      // 복구책
      if (!row) {
        return {
          user_id: userId,
          current_tickets: 5,
          bonus_tickets: 0,
          last_charged_at: now,
          updated_at: now
        };
      }
    }
    return this.mapTicket(row, userId);
  }

  async refreshTicketStatus(userId: string, chargeIntervalMinutes: number): Promise<RefreshedMinigameTicket> {
    const db = this.getDb();
    const now = new Date().toISOString();
    const txn = db.transaction(() => {
      db.prepare(
        'INSERT OR IGNORE INTO user_minigame_tickets (user_id, current_tickets, bonus_tickets, last_charged_at, updated_at) VALUES (?, 5, 0, ?, ?)'
      ).run(userId, now, now);
      const row = db.prepare('SELECT * FROM user_minigame_tickets WHERE user_id = ?').get(userId) as any;
      const refreshed = calculateTicketRefresh(row, userId, chargeIntervalMinutes);
      if (
        Number(row?.current_tickets ?? MAX_AUTO_TICKETS) !== refreshed.current_tickets ||
        String(row?.last_charged_at || now) !== refreshed.last_charged_at
      ) {
        const updatedAt = new Date().toISOString();
        db.prepare(
          'UPDATE user_minigame_tickets SET current_tickets = ?, last_charged_at = ?, updated_at = ? WHERE user_id = ?'
        ).run(refreshed.current_tickets, refreshed.last_charged_at, updatedAt, userId);
        refreshed.updated_at = updatedAt;
      }
      return refreshed;
    });
    return txn();
  }

  async updateTickets(userId: string, currentTickets: number, lastChargedAt: string): Promise<void> {
    const db = this.getDb();
    const now = new Date().toISOString();
    db.prepare(
      'UPDATE user_minigame_tickets SET current_tickets = ?, last_charged_at = ?, updated_at = ? WHERE user_id = ?'
    ).run(currentTickets, lastChargedAt, now, userId);
  }

  async addBonusTickets(userId: string, amount: number): Promise<UserMinigameTicket> {
    const db = this.getDb();
    const qty = Math.max(0, Math.floor(amount) || 0);
    const now = new Date().toISOString();
    const txn = db.transaction(() => {
      db.prepare(`
        INSERT INTO user_minigame_tickets (user_id, current_tickets, bonus_tickets, last_charged_at, updated_at)
        VALUES (?, 5, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          bonus_tickets = bonus_tickets + excluded.bonus_tickets,
          updated_at = excluded.updated_at
      `).run(userId, qty, now, now);

      const row = db.prepare('SELECT * FROM user_minigame_tickets WHERE user_id = ?').get(userId) as any;
      return this.mapTicket(row, userId);
    });
    return txn();
  }

  async startSession(session: MinigameSession, chargeIntervalMinutes = DEFAULT_TICKET_CHARGE_INTERVAL_MINUTES): Promise<{ ok: boolean; reason?: string }> {
    const db = this.getDb();
    let practiceMode = false;
    let ticketSpentType: 'BASE' | 'BONUS' | 'NONE' = 'NONE';
    try {
      practiceMode = JSON.parse(session.target_data)?.practice_mode === true;
    } catch {
      practiceMode = false;
    }

    const txn = db.transaction(() => {
      if (!practiceMode) {
        const nowStr = new Date().toISOString();
        db.prepare(
          'INSERT OR IGNORE INTO user_minigame_tickets (user_id, current_tickets, bonus_tickets, last_charged_at, updated_at) VALUES (?, 5, 0, ?, ?)'
        ).run(session.user_id, nowStr, nowStr);
        const ticket = db.prepare('SELECT * FROM user_minigame_tickets WHERE user_id = ?').get(session.user_id) as any;
        const activeSession = db.prepare(`
          SELECT id
          FROM minigame_sessions
          WHERE user_id = ?
            AND status = 'STARTED'
            AND ticket_spent_type IN ('BASE', 'BONUS')
          ORDER BY datetime(created_at) DESC
          LIMIT 1
        `).get(session.user_id) as any;
        if (activeSession) {
          return { ok: false, reason: '이미 진행 중인 보상형 미니게임 세션이 있습니다.' };
        }

        const refreshed = calculateTicketRefresh(ticket, session.user_id, chargeIntervalMinutes);
        if ((refreshed.current_tickets + refreshed.bonus_tickets) <= 0) {
          return { ok: false, reason: '사용 가능한 미니게임 티켓이 부족합니다.' };
        }

        let nextBaseTickets = refreshed.current_tickets;
        let nextBonusTickets = refreshed.bonus_tickets;
        if (nextBaseTickets > 0) {
          nextBaseTickets -= 1;
          ticketSpentType = 'BASE';
        } else {
          nextBonusTickets -= 1;
          ticketSpentType = 'BONUS';
        }
        db.prepare(`
          UPDATE user_minigame_tickets
          SET current_tickets = ?, bonus_tickets = ?, last_charged_at = ?, updated_at = ?
          WHERE user_id = ?
        `).run(nextBaseTickets, nextBonusTickets, refreshed.last_charged_at, nowStr, session.user_id);
      }

      db.prepare(
        `INSERT INTO minigame_sessions
          (id, user_id, game_type, status, target_data, ticket_spent_type, created_at,
           validation_version, progress_data, progress_revision, expires_at, result_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        session.id,
        session.user_id,
        session.game_type,
        session.status,
        session.target_data,
        ticketSpentType,
        session.created_at || formatKstDbTime(),
        Math.max(0, Math.floor(Number(session.validation_version ?? 0))),
        JSON.stringify(normalizeProgressData(session.progress_data)),
        Math.max(0, Math.floor(Number(session.progress_revision ?? 0))),
        session.expires_at ?? null,
        session.result_data ?? null
      );

      return { ok: true };
    });

    return txn();
  }

  async saveActionProgress(sessionId: string, userId: string, revision: number, progressData: string, expiresAt?: string): Promise<boolean> {
    const result = this.getDb().prepare(
      "UPDATE minigame_sessions SET progress_data = ?, progress_revision = progress_revision + 1, expires_at = COALESCE(?, expires_at) WHERE id = ? AND user_id = ? AND status = 'STARTED' AND progress_revision = ? AND expires_at > ? AND game_type IN ('fan_meeting', 'streamer_catch', 'sequence_relay')"
    ).run(progressData, expiresAt ?? null, sessionId, userId, revision, new Date().toISOString());
    return result.changes === 1;
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

    const db = this.getDb();
    const txn = db.transaction((): MinigameRoundDeadlineArmResult => {
      const row = db.prepare(
        'SELECT * FROM minigame_sessions WHERE id = ? AND user_id = ?'
      ).get(sessionId, userId) as any;
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
        db.prepare(
          "UPDATE minigame_sessions SET status = 'EXPIRED', completed_at = ? WHERE id = ? AND user_id = ? AND status = 'STARTED'"
        ).run(formatKstDbTime(), sessionId, userId);
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
        return { ok: true, armedNow: false, session: this.mapSession(row) };
      }
      if (armedRound != null) {
        return { ok: false, reason: '현재 라운드와 저장된 시작 상태가 일치하지 않습니다.' };
      }
      if (row.game_type === 'value_duel' && Number.isFinite(storedDeadlineMs)) {
        if (storedDeadlineMs <= Date.now()) {
          return { ok: false, reason: '이미 마감된 라운드는 다시 시작할 수 없습니다.' };
        }
        return { ok: true, armedNow: false, session: this.mapSession(row) };
      }

      const currentRevision = Math.max(0, Math.floor(Number(row.progress_revision ?? 0)));
      const nextProgressData = JSON.stringify({
        ...progress,
        round_outcomes: outcomes,
        round_deadline_at: normalizedDeadline.value,
        [markerKey]: round
      });
      const updateResult = db.prepare(`
        UPDATE minigame_sessions
        SET progress_data = ?, progress_revision = progress_revision + 1
        WHERE id = ? AND user_id = ? AND status = 'STARTED' AND progress_revision = ?
      `).run(nextProgressData, sessionId, userId, currentRevision);
      if (updateResult.changes !== 1) {
        return { ok: false, reason: '미니게임 진행 상태가 변경되었습니다. 다시 시도해 주세요.' };
      }
      return {
        ok: true,
        armedNow: true,
        session: this.mapSession({
          ...row,
          progress_data: nextProgressData,
          progress_revision: currentRevision + 1
        })
      };
    });
    return txn();
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

    const db = this.getDb();
    const txn = db.transaction(() => {
      const row = db.prepare(
        'SELECT * FROM minigame_sessions WHERE id = ? AND user_id = ?'
      ).get(sessionId, userId) as any;
      if (!row) return { ok: false, reason: '존재하지 않는 미니게임 세션입니다.' };
      if (row.status !== 'STARTED') return { ok: false, reason: '이미 종료되었거나 만료된 세션입니다.' };

      const expiresAtMs = row.expires_at ? new Date(row.expires_at).getTime() : NaN;
      if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
        db.prepare(
          "UPDATE minigame_sessions SET status = 'EXPIRED', completed_at = ? WHERE id = ? AND user_id = ? AND status = 'STARTED'"
        ).run(formatKstDbTime(), sessionId, userId);
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
        if (storedSelection !== normalizedSelection) {
          return { ok: false, reason: '이미 다른 답안으로 처리된 라운드입니다.' };
        }
        return { ok: true, session: this.mapSession(row), duplicate: true };
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
      const updateResult = db.prepare(`
        UPDATE minigame_sessions
        SET progress_data = ?, progress_revision = progress_revision + 1
        WHERE id = ? AND user_id = ? AND status = 'STARTED' AND progress_revision = ?
      `).run(nextProgressData, sessionId, userId, currentRevision);
      if (updateResult.changes !== 1) {
        return { ok: false, reason: '미니게임 진행 상태가 변경되었습니다. 다시 시도해 주세요.' };
      }
      return {
        ok: true,
        duplicate: false,
        session: this.mapSession({
          ...row,
          progress_data: nextProgressData,
          progress_revision: currentRevision + 1
        })
      };
    });
    return txn();
  }

  async completeSession(
    sessionId: string,
    earnedPoints: number,
    resultData?: string
  ): Promise<MinigameCompletionResult> {
    if (!Number.isInteger(earnedPoints) || !ALLOWED_MINIGAME_REWARDS.has(earnedPoints)) {
      return { ok: false, reason: '허용되지 않은 미니게임 보상입니다.' };
    }
    const db = this.getDb();
    const txn = db.transaction((): MinigameCompletionResult => {
      // 1. 세션이 존재하고 'STARTED' 상태인지 확인
      const session = db.prepare('SELECT * FROM minigame_sessions WHERE id = ?').get(sessionId) as any;
      if (!session) {
        return { ok: false, reason: '존재하지 않는 미니게임 세션입니다.' };
      }
      if (session.status === 'COMPLETED') {
        const user = db.prepare('SELECT point FROM users WHERE id = ?').get(session.user_id) as any;
        if (!user) throw new Error('미니게임 세션 소유자를 찾을 수 없습니다.');
        const stored = this.mapSession(session);
        return {
          ok: true,
          settledNow: false,
          newPoints: Number(user.point ?? 0),
          earnedPoints: Number(stored.earned_points ?? 0),
          resultData: stored.result_data ?? null
        };
      }
      if (earnedPoints !== 0 && Number(session.validation_version ?? 0) !== 1) {
        return { ok: false, reason: '서버 권위 검증을 거치지 않은 미니게임 세션입니다.' };
      }
      if (earnedPoints !== 0 && !['BASE', 'BONUS'].includes(String(session.ticket_spent_type || 'NONE'))) {
        return { ok: false, reason: '티켓을 사용하지 않은 미니게임 세션에는 보상을 지급할 수 없습니다.' };
      }
      if (session.status !== 'STARTED') {
        return { ok: false, reason: '이미 종료되었거나 만료된 세션입니다.' };
      }

      // 2. 세션 상태 업데이트
      const completion = db.prepare(
        "UPDATE minigame_sessions SET status = 'COMPLETED', earned_points = ?, completed_at = ?, result_data = ? WHERE id = ? AND status = 'STARTED'"
      ).run(earnedPoints, formatKstDbTime(), resultData ?? null, sessionId);
      if (completion.changes !== 1) {
        throw new Error('미니게임 세션 완료 상태를 원자적으로 저장하지 못했습니다.');
      }

      if (earnedPoints !== 0) {
        const pointUpdate = db.prepare(
          'UPDATE users SET point = point + ? WHERE id = ?'
        ).run(earnedPoints, session.user_id);
        if (pointUpdate.changes !== 1) {
          throw new Error('미니게임 세션 소유자의 포인트를 갱신하지 못했습니다.');
        }
      }

      const user = db.prepare('SELECT point FROM users WHERE id = ?').get(session.user_id) as any;
      if (!user) throw new Error('미니게임 세션 소유자를 찾을 수 없습니다.');
      if (earnedPoints !== 0) {
        recordSqlitePointLedger(db, {
          userId: session.user_id,
          amount: earnedPoints,
          balanceAfter: user?.point ?? 0,
          sourceType: 'minigame',
          sourceId: sessionId,
          reason: 'minigame_reward',
          description: `${session.game_type} 미니게임 보상`,
          metadata: { session_id: sessionId, game_type: session.game_type }
        });
      }

      return {
        ok: true,
        settledNow: true,
        newPoints: Number(user.point ?? 0),
        earnedPoints,
        resultData: resultData ?? null
      };
    });

    return txn();
  }

  async findSessionById(id: string): Promise<MinigameSession | null> {
    const row = this.getDb().prepare('SELECT * FROM minigame_sessions WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapSession(row);
  }

  async findActiveStartedSession(userId: string, gameType: MinigameType): Promise<MinigameSession | null> {
    const row = this.getDb().prepare(`
      SELECT *
      FROM minigame_sessions
      WHERE user_id = ?
        AND game_type = ?
        AND status = 'STARTED'
        AND COALESCE(ticket_spent_type, 'NONE') <> 'NONE'
      ORDER BY datetime(created_at) DESC
      LIMIT 1
    `).get(userId, gameType) as any;
    if (!row) return null;
    return this.mapSession(row);
  }

  async expireSessions(olderThanMinutes: number, limit = 50): Promise<void> {
    const db = this.getDb();
    const txn = db.transaction(() => {
      const cutoff = formatKstDbTime(Date.now() - olderThanMinutes * 60 * 1000);
      const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 50)));
      const expired = db.prepare(`
        SELECT *
        FROM minigame_sessions
        WHERE status = 'STARTED'
          AND created_at < ?
          AND (game_type NOT IN ('fan_meeting', 'streamer_catch', 'sequence_relay') OR expires_at <= ?)
        ORDER BY datetime(created_at) ASC
        LIMIT ?
      `).all(cutoff, new Date().toISOString(), safeLimit) as any[];

      for (const session of expired) {
        db.prepare(`
          UPDATE minigame_sessions
          SET status = 'EXPIRED', completed_at = ?
          WHERE id = ? AND status = 'STARTED'
        `).run(formatKstDbTime(), session.id);
      }
    });
    txn();
  }
}
