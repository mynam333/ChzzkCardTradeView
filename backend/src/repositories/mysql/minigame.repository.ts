import { getMysqlDb } from '../../services/db';
import { IMinigameRepository, UserMinigameTicket, MinigameSession, MinigameType } from '../interfaces';
import { recordMysqlPointLedger } from '../../services/pointLedger';

const MAX_AUTO_TICKETS = 5;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const formatKstDbTime = (dateMs = Date.now()): string => {
  const kst = new Date(dateMs + KST_OFFSET_MS);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')} ${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}:${String(kst.getUTCSeconds()).padStart(2, '0')}`;
};

export class MysqlMinigameRepository implements IMinigameRepository {
  private getDb() {
    return getMysqlDb();
  }

  private mapTicket(row: any, userId: string): UserMinigameTicket {
    return {
      user_id: row?.user_id ?? userId,
      current_tickets: Number(row?.current_tickets ?? MAX_AUTO_TICKETS),
      bonus_tickets: Number(row?.bonus_tickets ?? 0),
      last_charged_at: row?.last_charged_at ?? new Date().toISOString(),
      updated_at: row?.updated_at
    };
  }

  private mapSession(row: any): MinigameSession {
    return {
      id: row.id,
      user_id: row.user_id,
      game_type: row.game_type,
      status: row.status,
      target_data: row.target_data,
      ticket_spent_type: row.ticket_spent_type ?? null,
      created_at: row.created_at,
      completed_at: row.completed_at,
      earned_points: row.earned_points
    };
  }

  async getTicketStatus(userId: string): Promise<UserMinigameTicket> {
    let row = await this.getDb().get('SELECT * FROM user_minigame_tickets WHERE user_id = ?', userId);
    if (!row) {
      const now = new Date().toISOString();
      await this.getDb().run(
        'INSERT IGNORE INTO user_minigame_tickets (user_id, current_tickets, last_charged_at, updated_at) VALUES (?, 5, ?, ?)',
        userId, now, now
      );
      row = await this.getDb().get('SELECT * FROM user_minigame_tickets WHERE user_id = ?', userId);
      if (!row) return { user_id: userId, current_tickets: 5, bonus_tickets: 0, last_charged_at: now, updated_at: now };
    }
    return this.mapTicket(row, userId);
  }

  async updateTickets(userId: string, currentTickets: number, lastChargedAt: string): Promise<void> {
    const now = new Date().toISOString();
    await this.getDb().run(
      'UPDATE user_minigame_tickets SET current_tickets = ?, last_charged_at = ?, updated_at = ? WHERE user_id = ?',
      currentTickets, lastChargedAt, now, userId
    );
  }

  async addBonusTickets(userId: string, amount: number): Promise<UserMinigameTicket> {
    const qty = Math.max(0, Math.floor(amount) || 0);
    const now = new Date().toISOString();
    return this.getDb().transaction(async (tx) => {
      await tx.run(`
        INSERT INTO user_minigame_tickets (user_id, current_tickets, bonus_tickets, last_charged_at, updated_at)
        VALUES (?, 5, ?, ?, ?)
        ON DUPLICATE KEY UPDATE bonus_tickets = bonus_tickets + VALUES(bonus_tickets), updated_at = VALUES(updated_at)
      `, userId, qty, now, now);
      const row = await tx.get('SELECT * FROM user_minigame_tickets WHERE user_id = ?', userId);
      return this.mapTicket(row, userId);
    });
  }

  async startSession(session: MinigameSession): Promise<{ ok: boolean; reason?: string }> {
    let practiceMode = false;
    let ticketSpentType: 'BASE' | 'BONUS' | 'NONE' = 'NONE';
    try { practiceMode = JSON.parse(session.target_data)?.practice_mode === true; } catch { practiceMode = false; }

    return this.getDb().transaction(async (tx) => {
      if (!practiceMode) {
        let ticket = await tx.get('SELECT current_tickets, bonus_tickets FROM user_minigame_tickets WHERE user_id = ? FOR UPDATE', session.user_id);
        if (!ticket) {
          const nowStr = new Date().toISOString();
          await tx.run(
            'INSERT INTO user_minigame_tickets (user_id, current_tickets, bonus_tickets, last_charged_at, updated_at) VALUES (?, 5, 0, ?, ?)',
            session.user_id, nowStr, nowStr
          );
          ticket = { current_tickets: 5, bonus_tickets: 0 };
        }
        if ((Number(ticket.current_tickets || 0) + Number(ticket.bonus_tickets || 0)) <= 0) {
          return { ok: false, reason: '사용 가능한 미니게임 티켓이 부족합니다.' };
        }
        if (Number(ticket.current_tickets || 0) > 0) {
          await tx.run('UPDATE user_minigame_tickets SET current_tickets = current_tickets - 1, updated_at = UTC_TIMESTAMP() WHERE user_id = ?', session.user_id);
          ticketSpentType = 'BASE';
        } else {
          await tx.run('UPDATE user_minigame_tickets SET bonus_tickets = bonus_tickets - 1, updated_at = UTC_TIMESTAMP() WHERE user_id = ?', session.user_id);
          ticketSpentType = 'BONUS';
        }
      }

      await tx.run(
        'INSERT INTO minigame_sessions (id, user_id, game_type, status, target_data, ticket_spent_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        session.id, session.user_id, session.game_type, session.status, session.target_data, ticketSpentType, session.created_at || formatKstDbTime()
      );
      return { ok: true };
    });
  }

  async completeSession(sessionId: string, earnedPoints: number): Promise<{ ok: boolean; reason?: string; newPoints?: number }> {
    return this.getDb().transaction(async (tx) => {
      const session = await tx.get('SELECT * FROM minigame_sessions WHERE id = ? FOR UPDATE', sessionId);
      if (!session) return { ok: false, reason: '존재하지 않는 미니게임 세션입니다.' };
      if (session.status === 'COMPLETED') {
        const user = await tx.get('SELECT point FROM users WHERE id = ?', session.user_id);
        return { ok: true, newPoints: user?.point ?? 0 };
      }
      if (session.status !== 'STARTED') return { ok: false, reason: '이미 종료되었거나 만료된 세션입니다.' };
      await tx.run("UPDATE minigame_sessions SET status = 'COMPLETED', earned_points = ?, completed_at = ? WHERE id = ?", earnedPoints, formatKstDbTime(), sessionId);
      await tx.run('UPDATE users SET point = point + ? WHERE id = ?', earnedPoints, session.user_id);
      await recordMysqlPointLedger(tx, {
        userId: session.user_id,
        amount: earnedPoints,
        sourceType: 'minigame',
        sourceId: sessionId,
        reason: 'minigame_reward',
        description: `${session.game_type} 미니게임 보상`,
        metadata: { session_id: sessionId, game_type: session.game_type }
      });
      const user = await tx.get('SELECT point FROM users WHERE id = ?', session.user_id);
      return { ok: true, newPoints: user?.point ?? 0 };
    });
  }

  async findSessionById(id: string): Promise<MinigameSession | null> {
    const row = await this.getDb().get('SELECT * FROM minigame_sessions WHERE id = ?', id);
    return row ? this.mapSession(row) : null;
  }

  async findActiveStartedSession(userId: string, gameType: MinigameType): Promise<MinigameSession | null> {
    const row = await this.getDb().get(`
      SELECT *
      FROM minigame_sessions
      WHERE user_id = ?
        AND game_type = ?
        AND status = 'STARTED'
        AND COALESCE(ticket_spent_type, 'NONE') <> 'NONE'
      ORDER BY created_at DESC
      LIMIT 1
    `, userId, gameType);
    return row ? this.mapSession(row) : null;
  }

  async expireSessions(olderThanMinutes: number): Promise<void> {
    await this.getDb().transaction(async (tx) => {
      const cutoff = formatKstDbTime(Date.now() - olderThanMinutes * 60 * 1000);
      const expired = await tx.all(`
        SELECT *
        FROM minigame_sessions
        WHERE status = 'STARTED'
          AND created_at < ?
        FOR UPDATE
      `, cutoff);
      for (const session of expired) {
        const update = await tx.run("UPDATE minigame_sessions SET status = 'EXPIRED', completed_at = ? WHERE id = ? AND status = 'STARTED'", formatKstDbTime(), session.id);
        if (update.changes <= 0) continue;
        let practiceMode = false;
        try { practiceMode = JSON.parse(session.target_data || '{}')?.practice_mode === true; } catch { practiceMode = false; }
        if (practiceMode || session.ticket_spent_type === 'NONE') continue;

        const spentType = session.ticket_spent_type === 'BONUS' ? 'BONUS' : 'BASE';
        const now = new Date().toISOString();
        await tx.run(
          'INSERT IGNORE INTO user_minigame_tickets (user_id, current_tickets, bonus_tickets, last_charged_at, updated_at) VALUES (?, ?, 0, ?, ?)',
          session.user_id, MAX_AUTO_TICKETS, now, now
        );
        if (spentType === 'BONUS') {
          await tx.run('UPDATE user_minigame_tickets SET bonus_tickets = bonus_tickets + 1, updated_at = UTC_TIMESTAMP() WHERE user_id = ?', session.user_id);
          continue;
        }
        const ticket = await tx.get('SELECT current_tickets FROM user_minigame_tickets WHERE user_id = ? FOR UPDATE', session.user_id);
        if ((ticket?.current_tickets ?? 0) < MAX_AUTO_TICKETS) {
          await tx.run('UPDATE user_minigame_tickets SET current_tickets = current_tickets + 1, updated_at = UTC_TIMESTAMP() WHERE user_id = ?', session.user_id);
        } else {
          await tx.run('UPDATE user_minigame_tickets SET bonus_tickets = bonus_tickets + 1, updated_at = UTC_TIMESTAMP() WHERE user_id = ?', session.user_id);
        }
      }
    });
  }
}
