import { getSqliteDb } from "../../services/db";
import { recordSqlitePointLedger } from "../../services/pointLedger";
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

export class SqliteTradeRepository implements ITradeRepository {
  private getDb() {
    return getSqliteDb();
  }

  private mapRow(row: any): Trade {
    return {
      id: row.id,
      sender_id: row.sender_id,
      receiver_id: row.receiver_id,
      sender_offer: JSON.parse(row.sender_offer),
      receiver_offer: JSON.parse(row.receiver_offer),
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at,
      sender_username: row.sender_username,
      receiver_username: row.receiver_username
    };
  }

  private findParticipantIds(search?: string): string[] | null {
    const keyword = String(search || '').trim();
    if (!keyword) return null;

    const rows = this.getDb().prepare(`
      SELECT id
        FROM users
       WHERE id = ?
          OR username = ?
          OR username LIKE ?
       ORDER BY CASE WHEN id = ? OR username = ? THEN 0 ELSE 1 END, username ASC
       LIMIT 40
    `).all(keyword, keyword, `%${keyword}%`, keyword, keyword) as { id: string }[];
    return rows.map((row) => row.id);
  }

  async create(trade: Pick<Trade, 'sender_id' | 'receiver_id' | 'sender_offer' | 'receiver_offer'>): Promise<Trade> {
    const result = this.getDb().prepare(
      `INSERT INTO trades (sender_id, receiver_id, sender_offer, receiver_offer, status)
       VALUES (?, ?, ?, ?, 'PENDING')`
    ).run(
      trade.sender_id,
      trade.receiver_id,
      JSON.stringify(trade.sender_offer),
      JSON.stringify(trade.receiver_offer)
    );
    return {
      id: Number(result.lastInsertRowid),
      ...trade,
      status: 'PENDING'
    };
  }

  async findById(id: number): Promise<Trade | null> {
    const row = this.getDb().prepare('SELECT * FROM trades WHERE id = ?').get(id) as any;
    return row ? this.mapRow(row) : null;
  }

  async findActiveByUser(userId: string): Promise<Trade[]> {
    const rows = this.getDb().prepare(`
      SELECT t.*, su.username AS sender_username, ru.username AS receiver_username
        FROM trades t
        LEFT JOIN users su ON su.id = t.sender_id
        LEFT JOIN users ru ON ru.id = t.receiver_id
       WHERE t.status IN ('PENDING','CONFIRMED') AND (t.sender_id = ? OR t.receiver_id = ?)
       ORDER BY t.id DESC
    `).all(userId, userId) as any[];
    return rows.map(r => this.mapRow(r));
  }

  async findHistoryByUser(userId: string, limit: number): Promise<Trade[]> {
    const rows = this.getDb().prepare(`
      SELECT t.*, su.username AS sender_username, ru.username AS receiver_username
        FROM trades t
        LEFT JOIN users su ON su.id = t.sender_id
        LEFT JOIN users ru ON ru.id = t.receiver_id
       WHERE t.status IN ('ACCEPTED','REJECTED','CANCELLED') AND (t.sender_id = ? OR t.receiver_id = ?)
       ORDER BY t.id DESC
       LIMIT ?
    `).all(userId, userId, limit) as any[];
    return rows.map(r => this.mapRow(r));
  }

  async listForAdmin(options: AdminTradeListOptions): Promise<AdminTradeListResult> {
    const page = Math.max(1, Math.floor(options.page || 1));
    const limit = Math.max(1, Math.min(100, Math.floor(options.limit || 30)));
    const offset = (page - 1) * limit;
    const where: string[] = [];
    const params: any[] = [];

    if (options.status && options.status !== 'ALL') {
      where.push('t.status = ?');
      params.push(options.status);
    }

    const participantIds = this.findParticipantIds(options.search);
    if (participantIds && participantIds.length === 0) {
      return { items: [], total: 0, page, limit, total_pages: 1 };
    }
    if (participantIds) {
      const placeholders = participantIds.map(() => '?').join(',');
      where.push(`(t.sender_id IN (${placeholders}) OR t.receiver_id IN (${placeholders}))`);
      params.push(...participantIds, ...participantIds);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countRow = this.getDb().prepare(`SELECT COUNT(*) AS c FROM trades t ${whereSql}`).get(...params) as any;
    const total = Number(countRow?.c || 0);
    const rows = this.getDb().prepare(`
      SELECT t.*, su.username AS sender_username, ru.username AS receiver_username
        FROM trades t
        LEFT JOIN users su ON su.id = t.sender_id
        LEFT JOIN users ru ON ru.id = t.receiver_id
       ${whereSql}
       ORDER BY t.id DESC
       LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as any[];

    return {
      items: rows.map((row) => this.mapRow(row)),
      total,
      page,
      limit,
      total_pages: Math.max(1, Math.ceil(total / limit))
    };
  }

  async updateStatus(id: number, status: Trade['status']): Promise<void> {
    this.getDb().prepare('UPDATE trades SET status = ? WHERE id = ?').run(status, id);
  }

  async countCompleted(): Promise<number> {
    const row = this.getDb().prepare("SELECT COUNT(*) AS c FROM trades WHERE status = 'ACCEPTED'").get() as any;
    return row?.c || 0;
  }

  // 1단계: 수신자 동의 (PENDING → CONFIRMED)
  async confirm(id: number, actorId: string, options: { receiverWithCosmetics?: boolean } = {}): Promise<{ ok: boolean; reason: string }> {
    const row = this.getDb().prepare('SELECT * FROM trades WHERE id = ?').get(id) as any;
    if (!row) return { ok: false, reason: 'NOT_FOUND' };
    if (row.status !== 'PENDING') return { ok: false, reason: 'NOT_PENDING' };
    if (row.receiver_id !== actorId) return { ok: false, reason: 'FORBIDDEN' };
    const receiverOffer = JSON.parse(row.receiver_offer);
    receiverOffer.with_cosmetics = options.receiverWithCosmetics === true;
    this.getDb()
      .prepare("UPDATE trades SET receiver_offer = ?, status = 'CONFIRMED' WHERE id = ?")
      .run(JSON.stringify(receiverOffer), id);
    return { ok: true, reason: 'OK' };
  }

  // 2단계: 제안자 최종 승인 및 원자적 체결 (CONFIRMED → ACCEPTED)
  async finalize(id: number, actorId: string): Promise<{ ok: boolean; reason: string }> {
    const db = this.getDb();

    // 카드 channel_id(+star)+count 만큼 소유자를 from→to로 이전하는 헬퍼 (부족 시 throw)
    const moveCards = (fromId: string, toId: string, cards: { channel_id: string; star?: number; count: number }[], withCosmetics: boolean) => {
      for (const c of cards) {
        if (!c.channel_id || !c.count || c.count <= 0) continue;
        const hasStar = c.star !== undefined && c.star !== null;
        const owned = hasStar
          ? db.prepare(
              `SELECT id, border_item_id, name_effect_item_id
                 FROM user_cards uc
                WHERE uc.user_id = ?
                  AND uc.channel_id = ?
                  AND uc.star = ?
                  AND NOT EXISTS (
                    SELECT 1 FROM market_listings ml
                     WHERE ml.user_card_id = uc.id AND ml.status = 'PENDING'
                  )
                ORDER BY uc.id ASC
                LIMIT ?`
            ).all(fromId, c.channel_id, c.star, c.count) as { id: number; border_item_id: number | null; name_effect_item_id: number | null }[]
          : db.prepare(
              `SELECT id, border_item_id, name_effect_item_id
                 FROM user_cards uc
                WHERE uc.user_id = ?
                  AND uc.channel_id = ?
                  AND NOT EXISTS (
                    SELECT 1 FROM market_listings ml
                     WHERE ml.user_card_id = uc.id AND ml.status = 'PENDING'
                  )
                ORDER BY uc.id ASC
                LIMIT ?`
            ).all(fromId, c.channel_id, c.count) as { id: number; border_item_id: number | null; name_effect_item_id: number | null }[];
        if (owned.length < c.count) {
          throw new Error('CARD_SHORTAGE');
        }
        const ids = owned.map(o => o.id);
        const placeholders = ids.map(() => '?').join(',');
        if (!withCosmetics) {
          for (const row of owned) {
            for (const itemId of [row.border_item_id, row.name_effect_item_id]) {
              if (!itemId) continue;
              db.prepare(`
                INSERT INTO user_cosmetics (user_id, item_id, quantity) VALUES (?, ?, 1)
                ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + 1
              `).run(fromId, itemId);
            }
          }
          db.prepare(`UPDATE user_cards SET border_item_id = NULL, name_effect_item_id = NULL WHERE id IN (${placeholders})`).run(...ids);
        }
        db.prepare(`UPDATE user_cards SET user_id = ? WHERE id IN (${placeholders})`).run(toId, ...ids);
      }
    };

    const txn = db.transaction(() => {
      const row = db.prepare('SELECT * FROM trades WHERE id = ?').get(id) as any;
      if (!row) throw new Error('NOT_FOUND');
      if (row.status !== 'CONFIRMED') throw new Error('NOT_CONFIRMED');
      if (row.sender_id !== actorId) throw new Error('FORBIDDEN');

      const senderOffer = JSON.parse(row.sender_offer);
      const receiverOffer = JSON.parse(row.receiver_offer);
      const senderOut = Number(senderOffer.point || 0);
      const receiverOut = Number(receiverOffer.point || 0);

      // 포인트 잔액 검증
      const sender = db.prepare('SELECT point FROM users WHERE id = ?').get(row.sender_id) as any;
      const receiver = db.prepare('SELECT point FROM users WHERE id = ?').get(row.receiver_id) as any;
      if (!sender || !receiver) throw new Error('USER_NOT_FOUND');
      if (sender.point < senderOut) throw new Error('SENDER_POINT_SHORT');
      if (receiver.point < receiverOut) throw new Error('RECEIVER_POINT_SHORT');

      // 카드 이전 (양방향)
      moveCards(row.sender_id, row.receiver_id, senderOffer.cards || [], senderOffer.with_cosmetics === true);
      moveCards(row.receiver_id, row.sender_id, receiverOffer.cards || [], receiverOffer.with_cosmetics === true);

      // 포인트 정산 (양방향 동시 반영)
      db.prepare('UPDATE users SET point = point - ? + ? WHERE id = ?').run(senderOut, receiverOut, row.sender_id);
      db.prepare('UPDATE users SET point = point - ? + ? WHERE id = ?').run(receiverOut, senderOut, row.receiver_id);
      const senderDelta = receiverOut - senderOut;
      const receiverDelta = senderOut - receiverOut;
      recordSqlitePointLedger(db, {
        userId: row.sender_id,
        counterpartyUserId: row.receiver_id,
        amount: senderDelta,
        sourceType: 'trade',
        sourceId: id,
        reason: 'trade_finalize',
        description: `1:1 교환 체결 #${id}`,
        metadata: { trade_id: id, sender_out: senderOut, receiver_out: receiverOut }
      });
      recordSqlitePointLedger(db, {
        userId: row.receiver_id,
        counterpartyUserId: row.sender_id,
        amount: receiverDelta,
        sourceType: 'trade',
        sourceId: id,
        reason: 'trade_finalize',
        description: `1:1 교환 체결 #${id}`,
        metadata: { trade_id: id, sender_out: senderOut, receiver_out: receiverOut }
      });

      // 거래 체결 처리
      db.prepare("UPDATE trades SET status = 'ACCEPTED', completed_at = datetime('now') WHERE id = ?").run(id);
    });

    try {
      txn();
      return { ok: true, reason: 'OK' };
    } catch (err: any) {
      return { ok: false, reason: err.message || 'FAILED' };
    }
  }
}

// 8. SQLite 인앱 알림 레포지토리
