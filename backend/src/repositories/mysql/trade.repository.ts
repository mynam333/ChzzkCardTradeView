import { getMysqlDb } from '../../services/db';
import { recordMysqlPointLedger } from '../../services/pointLedger';
import { recordMysqlAssetEvent, recordMysqlAssetEvents } from '../../services/assetEventLog';
import { AdminTradeListOptions, AdminTradeListResult, ITradeRepository, Trade } from '../interfaces';

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
      updated_at: row.updated_at,
      completed_at: row.completed_at,
      sender_username: row.sender_username,
      receiver_username: row.receiver_username
    };
  }

  private async findParticipantIds(search?: string): Promise<string[] | null> {
    const keyword = String(search || '').trim();
    if (!keyword) return null;

    const like = `%${keyword.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = await this.getDb().all<{ id: string }>(`
      SELECT id
        FROM users
       WHERE id = ?
          OR username = ?
          OR username LIKE ? ESCAPE '\\'
       ORDER BY CASE WHEN id = ? OR username = ? THEN 0 ELSE 1 END, username ASC
       LIMIT 40
    `, keyword, keyword, like, keyword, keyword);
    return rows.map((row) => row.id);
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

    const participantIds = await this.findParticipantIds(options.search);
    if (participantIds && participantIds.length === 0) {
      return { items: [], total: 0, page, limit, total_pages: 1 };
    }
    if (participantIds) {
      const placeholders = participantIds.map(() => '?').join(',');
      where.push(`(t.sender_id IN (${placeholders}) OR t.receiver_id IN (${placeholders}))`);
      params.push(...participantIds, ...participantIds);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countRow = await this.getDb().get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM trades t ${whereSql}`,
      ...params
    );
    const total = Number(countRow?.c || 0);
    const rows = await this.getDb().all(`
      SELECT t.*, su.username AS sender_username, ru.username AS receiver_username
        FROM trades t
        LEFT JOIN users su ON su.id = t.sender_id
        LEFT JOIN users ru ON ru.id = t.receiver_id
       ${whereSql}
       ORDER BY t.id DESC
       LIMIT ? OFFSET ?
    `, ...params, limit, offset);

    return {
      items: rows.map((row) => this.mapRow(row)),
      total,
      page,
      limit,
      total_pages: Math.max(1, Math.ceil(total / limit))
    };
  }

  async updateStatus(id: number, status: Trade['status']): Promise<void> {
    await this.getDb().run('UPDATE trades SET status = ? WHERE id = ?', status, id);
  }

  async countCompleted(): Promise<number> {
    const row = await this.getDb().get("SELECT COUNT(*) AS c FROM trades WHERE status = 'ACCEPTED'");
    return row?.c || 0;
  }

  async confirm(id: number, actorId: string, options: { receiverWithCosmetics?: boolean } = {}): Promise<{ ok: boolean; reason: string }> {
    const row = await this.getDb().get('SELECT * FROM trades WHERE id = ?', id);
    if (!row) return { ok: false, reason: 'NOT_FOUND' };
    if (row.status !== 'PENDING') return { ok: false, reason: 'NOT_PENDING' };
    if (row.receiver_id !== actorId) return { ok: false, reason: 'FORBIDDEN' };
    const receiverOffer = JSON.parse(row.receiver_offer);
    receiverOffer.with_cosmetics = options.receiverWithCosmetics === true;
    await this.getDb().run(
      "UPDATE trades SET receiver_offer = ?, status = 'CONFIRMED' WHERE id = ?",
      JSON.stringify(receiverOffer),
      id
    );
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

        const moveCards = async (fromId: string, toId: string, cards: { channel_id: string; star?: number; count: number }[], withCosmetics: boolean) => {
          for (const c of cards) {
            if (!c.channel_id || !c.count || c.count <= 0) continue;
            const hasStar = c.star !== undefined && c.star !== null;
            const owned = hasStar
              ? await tx.all<{ id: number; serial_number: number; star: number; border_item_id: number | null; name_effect_item_id: number | null }>(
                  `SELECT id, serial_number, COALESCE(star, 0) AS star, border_item_id, name_effect_item_id
                     FROM user_cards uc
                    WHERE uc.user_id = ?
                      AND uc.channel_id = ?
                      AND uc.star = ?
                      AND COALESCE(uc.is_locked, 0) = 0
                      AND NOT EXISTS (
                        SELECT 1 FROM market_listings ml
                         WHERE ml.user_card_id = uc.id AND ml.status = 'PENDING'
                      )
                    ORDER BY uc.id ASC
                    LIMIT ? FOR UPDATE`,
                  fromId, c.channel_id, c.star, c.count
                )
              : await tx.all<{ id: number; serial_number: number; star: number; border_item_id: number | null; name_effect_item_id: number | null }>(
                  `SELECT id, serial_number, COALESCE(star, 0) AS star, border_item_id, name_effect_item_id
                     FROM user_cards uc
                    WHERE uc.user_id = ?
                      AND uc.channel_id = ?
                      AND COALESCE(uc.is_locked, 0) = 0
                      AND NOT EXISTS (
                        SELECT 1 FROM market_listings ml
                         WHERE ml.user_card_id = uc.id AND ml.status = 'PENDING'
                      )
                    ORDER BY uc.id ASC
                    LIMIT ? FOR UPDATE`,
                  fromId, c.channel_id, c.count
                );
            if (owned.length < c.count) throw new Error('CARD_SHORTAGE');
            const ids = owned.map((o) => o.id);
            const placeholders = ids.map(() => '?').join(',');
            if (!withCosmetics) {
              for (const row of owned) {
                for (const itemId of [row.border_item_id, row.name_effect_item_id]) {
                  if (!itemId) continue;
                  await tx.run(
                    `INSERT INTO user_cosmetics (user_id, item_id, quantity) VALUES (?, ?, 1)
                     ON DUPLICATE KEY UPDATE quantity = quantity + 1`,
                    fromId,
                    itemId
                  );
                  await recordMysqlAssetEvent(tx, {
                    userId: fromId,
                    assetType: 'cosmetic',
                    action: 'add',
                    quantity: 1,
                    sourceType: 'trade',
                    sourceId: id,
                    reason: 'trade_cosmetic_return',
                    description: `1:1 교환 #${id} 코스메틱 제외 반환`,
                    cardId: Number(row.id),
                    channelId: c.channel_id,
                    itemId: Number(itemId),
                    metadata: { trade_id: id, from_user_id: fromId, to_user_id: toId }
                  });
                }
              }
              await tx.run(
                `UPDATE user_cards SET border_item_id = NULL, name_effect_item_id = NULL WHERE id IN (${placeholders})`,
                ...ids
              );
            }
            await tx.run(`UPDATE user_cards SET user_id = ? WHERE id IN (${placeholders})`, toId, ...ids);
            await recordMysqlAssetEvents(tx, owned.map((row) => ({
              userId: fromId,
              counterpartyUserId: toId,
              fromUserId: fromId,
              toUserId: toId,
              assetType: 'card',
              action: 'move',
              quantity: 1,
              sourceType: 'trade',
              sourceId: id,
              reason: 'trade_card_move',
              description: `1:1 교환 #${id} 카드 이동`,
              cardId: Number(row.id),
              channelId: c.channel_id,
              serialNumber: Number(row.serial_number),
              star: Number(row.star || 0),
              metadata: { trade_id: id, with_cosmetics: withCosmetics, requested_star: c.star ?? null }
            })));
          }
        };

        await moveCards(row.sender_id, row.receiver_id, senderOffer.cards || [], senderOffer.with_cosmetics === true);
        await moveCards(row.receiver_id, row.sender_id, receiverOffer.cards || [], receiverOffer.with_cosmetics === true);
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
