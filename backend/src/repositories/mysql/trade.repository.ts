import { getMysqlDb } from '../../services/db';
import { recordMysqlPointLedger } from '../../services/pointLedger';
import { ITradeRepository, Trade } from '../interfaces';

export class MysqlTradeRepository implements ITradeRepository {
  private getDb() {
    return getMysqlDb();
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
      completed_at: row.completed_at,
      sender_username: row.sender_username,
      receiver_username: row.receiver_username
    };
  }

  async create(trade: Pick<Trade, 'sender_id' | 'receiver_id' | 'sender_offer' | 'receiver_offer'>): Promise<Trade> {
    const result = await this.getDb().run(
      `INSERT INTO trades (sender_id, receiver_id, sender_offer, receiver_offer, status)
       VALUES (?, ?, ?, ?, 'PENDING')`,
      trade.sender_id,
      trade.receiver_id,
      JSON.stringify(trade.sender_offer),
      JSON.stringify(trade.receiver_offer)
    );
    return { id: Number(result.insertId), ...trade, status: 'PENDING' };
  }

  async findById(id: number): Promise<Trade | null> {
    const row = await this.getDb().get('SELECT * FROM trades WHERE id = ?', id);
    return row ? this.mapRow(row) : null;
  }

  async findActiveByUser(userId: string): Promise<Trade[]> {
    const rows = await this.getDb().all(`
      SELECT t.*, su.username AS sender_username, ru.username AS receiver_username
        FROM trades t
        LEFT JOIN users su ON su.id = t.sender_id
        LEFT JOIN users ru ON ru.id = t.receiver_id
       WHERE t.status IN ('PENDING','CONFIRMED') AND (t.sender_id = ? OR t.receiver_id = ?)
       ORDER BY t.id DESC
    `, userId, userId);
    return rows.map((row) => this.mapRow(row));
  }

  async findHistoryByUser(userId: string, limit: number): Promise<Trade[]> {
    const rows = await this.getDb().all(`
      SELECT t.*, su.username AS sender_username, ru.username AS receiver_username
        FROM trades t
        LEFT JOIN users su ON su.id = t.sender_id
        LEFT JOIN users ru ON ru.id = t.receiver_id
       WHERE t.status IN ('ACCEPTED','REJECTED','CANCELLED') AND (t.sender_id = ? OR t.receiver_id = ?)
       ORDER BY t.id DESC
       LIMIT ?
    `, userId, userId, limit);
    return rows.map((row) => this.mapRow(row));
  }

  async updateStatus(id: number, status: Trade['status']): Promise<void> {
    await this.getDb().run('UPDATE trades SET status = ? WHERE id = ?', status, id);
  }

  async countCompleted(): Promise<number> {
    const row = await this.getDb().get("SELECT COUNT(*) AS c FROM trades WHERE status = 'ACCEPTED'");
    return row?.c || 0;
  }

  async confirm(id: number, actorId: string): Promise<{ ok: boolean; reason: string }> {
    const row = await this.getDb().get('SELECT * FROM trades WHERE id = ?', id);
    if (!row) return { ok: false, reason: 'NOT_FOUND' };
    if (row.status !== 'PENDING') return { ok: false, reason: 'NOT_PENDING' };
    if (row.receiver_id !== actorId) return { ok: false, reason: 'FORBIDDEN' };
    await this.getDb().run("UPDATE trades SET status = 'CONFIRMED' WHERE id = ?", id);
    return { ok: true, reason: 'OK' };
  }

  async finalize(id: number, actorId: string): Promise<{ ok: boolean; reason: string }> {
    try {
      await this.getDb().transaction(async (tx) => {
        const row = await tx.get('SELECT * FROM trades WHERE id = ? FOR UPDATE', id);
        if (!row) throw new Error('NOT_FOUND');
        if (row.status !== 'CONFIRMED') throw new Error('NOT_CONFIRMED');
        if (row.sender_id !== actorId) throw new Error('FORBIDDEN');

        const senderOffer = JSON.parse(row.sender_offer);
        const receiverOffer = JSON.parse(row.receiver_offer);
        const senderOut = Number(senderOffer.point || 0);
        const receiverOut = Number(receiverOffer.point || 0);

        const sender = await tx.get('SELECT point FROM users WHERE id = ? FOR UPDATE', row.sender_id);
        const receiver = await tx.get('SELECT point FROM users WHERE id = ? FOR UPDATE', row.receiver_id);
        if (!sender || !receiver) throw new Error('USER_NOT_FOUND');
        if (Number(sender.point || 0) < senderOut) throw new Error('SENDER_POINT_SHORT');
        if (Number(receiver.point || 0) < receiverOut) throw new Error('RECEIVER_POINT_SHORT');

        const moveCards = async (fromId: string, toId: string, cards: { channel_id: string; star?: number; count: number }[]) => {
          for (const c of cards) {
            if (!c.channel_id || !c.count || c.count <= 0) continue;
            const hasStar = c.star !== undefined && c.star !== null;
            const owned = hasStar
              ? await tx.all<{ id: number }>(
                  'SELECT id FROM user_cards WHERE user_id = ? AND channel_id = ? AND star = ? ORDER BY id ASC LIMIT ? FOR UPDATE',
                  fromId, c.channel_id, c.star, c.count
                )
              : await tx.all<{ id: number }>(
                  'SELECT id FROM user_cards WHERE user_id = ? AND channel_id = ? ORDER BY id ASC LIMIT ? FOR UPDATE',
                  fromId, c.channel_id, c.count
                );
            if (owned.length < c.count) throw new Error('CARD_SHORTAGE');
            const ids = owned.map((o) => o.id);
            const placeholders = ids.map(() => '?').join(',');
            await tx.run(`UPDATE user_cards SET user_id = ? WHERE id IN (${placeholders})`, [toId, ...ids]);
          }
        };

        await moveCards(row.sender_id, row.receiver_id, senderOffer.cards || []);
        await moveCards(row.receiver_id, row.sender_id, receiverOffer.cards || []);
        await tx.run('UPDATE users SET point = point - ? + ? WHERE id = ?', senderOut, receiverOut, row.sender_id);
        await tx.run('UPDATE users SET point = point - ? + ? WHERE id = ?', receiverOut, senderOut, row.receiver_id);
        const senderDelta = receiverOut - senderOut;
        const receiverDelta = senderOut - receiverOut;
        await recordMysqlPointLedger(tx, {
          userId: row.sender_id,
          counterpartyUserId: row.receiver_id,
          amount: senderDelta,
          sourceType: 'trade',
          sourceId: id,
          reason: 'trade_finalize',
          description: `1:1 교환 체결 #${id}`,
          metadata: { trade_id: id, sender_out: senderOut, receiver_out: receiverOut }
        });
        await recordMysqlPointLedger(tx, {
          userId: row.receiver_id,
          counterpartyUserId: row.sender_id,
          amount: receiverDelta,
          sourceType: 'trade',
          sourceId: id,
          reason: 'trade_finalize',
          description: `1:1 교환 체결 #${id}`,
          metadata: { trade_id: id, sender_out: senderOut, receiver_out: receiverOut }
        });
        await tx.run("UPDATE trades SET status = 'ACCEPTED', completed_at = UTC_TIMESTAMP() WHERE id = ?", id);
      });
      return { ok: true, reason: 'OK' };
    } catch (err: any) {
      return { ok: false, reason: err.message || 'FAILED' };
    }
  }
}
