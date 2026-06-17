import { getSqliteDb } from "../../services/db";
import { IMinigameRepository, UserMinigameTicket, MinigameSession, MinigameType } from "../interfaces";
import { recordSqlitePointLedger } from "../../services/pointLedger";

const MAX_AUTO_TICKETS = 5;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const formatKstDbTime = (dateMs = Date.now()): string => {
  const kst = new Date(dateMs + KST_OFFSET_MS);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')} ${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}:${String(kst.getUTCSeconds()).padStart(2, '0')}`;
};

export class SqliteMinigameRepository implements IMinigameRepository {
  private getDb() {
    return getSqliteDb();
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
    return {
      user_id: row.user_id,
      current_tickets: row.current_tickets,
      bonus_tickets: row.bonus_tickets ?? 0,
      last_charged_at: row.last_charged_at,
      updated_at: row.updated_at
    };
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
      return {
        user_id: row.user_id,
        current_tickets: row.current_tickets,
        bonus_tickets: row.bonus_tickets ?? 0,
        last_charged_at: row.last_charged_at,
        updated_at: row.updated_at
      };
    });
    return txn();
  }

  async startSession(session: MinigameSession): Promise<{ ok: boolean; reason?: string }> {
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
        // 1. 일반 게임만 티켓 보유 현황을 확인하고 차감합니다.
        let ticket = db.prepare('SELECT current_tickets, bonus_tickets FROM user_minigame_tickets WHERE user_id = ?').get(session.user_id) as any;

        // 혹시 로우가 없다면 생성
        if (!ticket) {
          const nowStr = new Date().toISOString();
          db.prepare(
            'INSERT INTO user_minigame_tickets (user_id, current_tickets, bonus_tickets, last_charged_at, updated_at) VALUES (?, 5, 0, ?, ?)'
          ).run(session.user_id, nowStr, nowStr);
          ticket = { current_tickets: 5, bonus_tickets: 0 };
        }

        if ((ticket.current_tickets || 0) + (ticket.bonus_tickets || 0) <= 0) {
          return { ok: false, reason: '사용 가능한 미니게임 티켓이 부족합니다.' };
        }

        // 2. 기본 충전 티켓을 먼저 차감하고, 없으면 쿠폰 등으로 얻은 보너스 티켓을 차감합니다.
        if ((ticket.current_tickets || 0) > 0) {
          db.prepare(
            "UPDATE user_minigame_tickets SET current_tickets = current_tickets - 1, updated_at = datetime('now') WHERE user_id = ?"
          ).run(session.user_id);
          ticketSpentType = 'BASE';
        } else {
          db.prepare(
            "UPDATE user_minigame_tickets SET bonus_tickets = bonus_tickets - 1, updated_at = datetime('now') WHERE user_id = ?"
          ).run(session.user_id);
          ticketSpentType = 'BONUS';
        }
      }

      // 3. 세션 기록
      db.prepare(
        'INSERT INTO minigame_sessions (id, user_id, game_type, status, target_data, ticket_spent_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(session.id, session.user_id, session.game_type, session.status, session.target_data, ticketSpentType, session.created_at || formatKstDbTime());

      return { ok: true };
    });

    return txn();
  }

  async completeSession(sessionId: string, earnedPoints: number): Promise<{ ok: boolean; reason?: string; newPoints?: number }> {
    const db = this.getDb();
    const txn = db.transaction(() => {
      // 1. 세션이 존재하고 'STARTED' 상태인지 확인
      const session = db.prepare('SELECT * FROM minigame_sessions WHERE id = ?').get(sessionId) as any;
      if (!session) {
        return { ok: false, reason: '존재하지 않는 미니게임 세션입니다.' };
      }
      if (session.status === 'COMPLETED') {
        const user = db.prepare('SELECT point FROM users WHERE id = ?').get(session.user_id) as any;
        return { ok: true, newPoints: user?.point ?? 0 };
      }
      if (session.status !== 'STARTED') {
        return { ok: false, reason: '이미 종료되었거나 만료된 세션입니다.' };
      }

      // 2. 세션 상태 업데이트
      db.prepare(
        "UPDATE minigame_sessions SET status = 'COMPLETED', earned_points = ?, completed_at = ? WHERE id = ?"
      ).run(earnedPoints, formatKstDbTime(), sessionId);

      // 3. 포인트 지급 (users 테이블)
      db.prepare(
        'UPDATE users SET point = point + ? WHERE id = ?'
      ).run(earnedPoints, session.user_id);
      recordSqlitePointLedger(db, {
        userId: session.user_id,
        amount: earnedPoints,
        sourceType: 'minigame',
        sourceId: sessionId,
        reason: 'minigame_reward',
        description: `${session.game_type} 미니게임 보상`,
        metadata: { session_id: sessionId, game_type: session.game_type }
      });

      // 4. 새로운 포인트 잔액 조회
      const user = db.prepare('SELECT point FROM users WHERE id = ?').get(session.user_id) as any;

      return { ok: true, newPoints: user?.point ?? 0 };
    });

    return txn();
  }

  async findSessionById(id: string): Promise<MinigameSession | null> {
    const row = this.getDb().prepare('SELECT * FROM minigame_sessions WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      user_id: row.user_id,
      game_type: row.game_type as any,
      status: row.status as any,
      target_data: row.target_data,
      ticket_spent_type: row.ticket_spent_type ?? null,
      created_at: row.created_at,
      completed_at: row.completed_at,
      earned_points: row.earned_points
    };
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
    return {
      id: row.id,
      user_id: row.user_id,
      game_type: row.game_type as any,
      status: row.status as any,
      target_data: row.target_data,
      ticket_spent_type: row.ticket_spent_type ?? null,
      created_at: row.created_at,
      completed_at: row.completed_at,
      earned_points: row.earned_points
    };
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
        ORDER BY datetime(created_at) ASC
        LIMIT ?
      `).all(cutoff, safeLimit) as any[];

      for (const session of expired) {
        const update = db.prepare(`
          UPDATE minigame_sessions
          SET status = 'EXPIRED', completed_at = ?
          WHERE id = ? AND status = 'STARTED'
        `).run(formatKstDbTime(), session.id);

        if (update.changes <= 0) continue;

        let practiceMode = false;
        try {
          practiceMode = JSON.parse(session.target_data || '{}')?.practice_mode === true;
        } catch {
          practiceMode = false;
        }
        if (practiceMode || session.ticket_spent_type === 'NONE') continue;

        const spentType = session.ticket_spent_type === 'BONUS' ? 'BONUS' : 'BASE';
        const now = new Date().toISOString();
        db.prepare(`
          INSERT OR IGNORE INTO user_minigame_tickets
            (user_id, current_tickets, bonus_tickets, last_charged_at, updated_at)
          VALUES (?, ${MAX_AUTO_TICKETS}, 0, ?, ?)
        `).run(session.user_id, now, now);

        if (spentType === 'BONUS') {
          db.prepare(`
            UPDATE user_minigame_tickets
            SET bonus_tickets = bonus_tickets + 1,
                updated_at = datetime('now')
            WHERE user_id = ?
          `).run(session.user_id);
          continue;
        }

        const ticket = db.prepare(`
          SELECT current_tickets
          FROM user_minigame_tickets
          WHERE user_id = ?
        `).get(session.user_id) as any;

        if ((ticket?.current_tickets ?? 0) < MAX_AUTO_TICKETS) {
          db.prepare(`
            UPDATE user_minigame_tickets
            SET current_tickets = current_tickets + 1,
                updated_at = datetime('now')
            WHERE user_id = ?
          `).run(session.user_id);
        } else {
          db.prepare(`
            UPDATE user_minigame_tickets
            SET bonus_tickets = bonus_tickets + 1,
                updated_at = datetime('now')
            WHERE user_id = ?
          `).run(session.user_id);
        }
      }
    });
    txn();
  }
}
