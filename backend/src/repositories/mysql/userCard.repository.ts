import { getMysqlDb } from '../../services/db';
import { IUserCardRepository } from '../interfaces';
import { formatUploadUrl } from '../../services/imageService';

export class MysqlUserCardRepository implements IUserCardRepository {
  private getDb() {
    return getMysqlDb();
  }

  async create(card: any): Promise<any> {
    const result = await this.getDb().run(
      'INSERT INTO user_cards (user_id, channel_id, serial_number, star) VALUES (?, ?, ?, ?)',
      card.user_id, card.channel_id, card.serial_number, card.star ?? 0
    );
    card.id = Number(result.insertId);
    return card;
  }

  async drawAtomic(
    userId: string,
    channelId: string,
    drawCost: number,
    _nowIso: string,
    segmentStartIso: string | null,
    maxFreeTickets: number,
    intervalHours: number
  ): Promise<{
    ok: boolean;
    reason: string;
    card?: any;
    is_free?: boolean;
    free_draw_source?: 'unlimited' | 'reset' | 'bonus' | 'point';
    points_left?: number;
    free_draw_tickets_left?: number;
    bonus_free_draw_tickets_left?: number;
  }> {
    const safeMaxFreeTickets = Math.max(1, Math.floor(maxFreeTickets || 1));
    return this.getDb().transaction(async (tx) => {
      const user = await tx.get('SELECT id, point, last_free_draw, free_draw_tickets, bonus_free_draw_tickets FROM users WHERE id = ? FOR UPDATE', userId);
      if (!user) return { ok: false, reason: 'USER_NOT_FOUND' };

      let nextPoint = Number(user.point || 0);
      let nextFreeTickets = Number(user.free_draw_tickets || 0);
      let nextBonusTickets = Number(user.bonus_free_draw_tickets || 0);
      let freeDrawSource: 'unlimited' | 'reset' | 'bonus' | 'point' = 'point';

      if (segmentStartIso !== null) {
        const shouldGrant = !user.last_free_draw || new Date(user.last_free_draw).getTime() < new Date(segmentStartIso).getTime();
        if (shouldGrant) {
          const diffMs = user.last_free_draw ? new Date(segmentStartIso).getTime() - new Date(user.last_free_draw).getTime() : 0;
          const intervalMs = Math.max(1, Number(intervalHours || 1)) * 60 * 60 * 1000;
          const grantCount = user.last_free_draw ? Math.max(1, Math.floor(diffMs / intervalMs)) : 1;
          nextFreeTickets = Math.min(safeMaxFreeTickets, nextFreeTickets + grantCount);
          await tx.run('UPDATE users SET free_draw_tickets = ?, last_free_draw = ? WHERE id = ?', nextFreeTickets, segmentStartIso, userId);
        }
      }

      if (segmentStartIso === null) {
        freeDrawSource = 'unlimited';
      } else if (nextFreeTickets > 0) {
        nextFreeTickets -= 1;
        freeDrawSource = 'reset';
        await tx.run('UPDATE users SET free_draw_tickets = ? WHERE id = ?', nextFreeTickets, userId);
      } else if (nextBonusTickets > 0) {
        nextBonusTickets -= 1;
        freeDrawSource = 'bonus';
        await tx.run('UPDATE users SET bonus_free_draw_tickets = ? WHERE id = ?', nextBonusTickets, userId);
      } else {
        const deducted = await tx.run('UPDATE users SET point = point - ? WHERE id = ? AND point >= ?', drawCost, userId, drawCost);
        if (deducted.changes === 0) return { ok: false, reason: 'INSUFFICIENT_POINT' };
        nextPoint -= drawCost;
      }

      const latest = await tx.get('SELECT COALESCE(MAX(serial_number), 0) AS max_sn FROM user_cards WHERE channel_id = ? FOR UPDATE', channelId);
      const serialNumber = Number(latest?.max_sn || 0) + 1;
      const result = await tx.run('INSERT INTO user_cards (user_id, channel_id, serial_number, star) VALUES (?, ?, ?, 0)', userId, channelId, serialNumber);
      return {
        ok: true,
        reason: 'OK',
        is_free: freeDrawSource !== 'point',
        free_draw_source: freeDrawSource,
        points_left: nextPoint,
        free_draw_tickets_left: nextFreeTickets,
        bonus_free_draw_tickets_left: nextBonusTickets,
        card: { id: Number(result.insertId), user_id: userId, channel_id: channelId, serial_number: serialNumber, star: 0 }
      };
    });
  }

  async fuse(userId: string, channelId: string, star: number, materials: { star: number; count: number }[] = [{ star: 0, count: 1 }]): Promise<{ ok: boolean; reason: string; newStar?: number }> {
    if (star >= 5) return { ok: false, reason: 'MAX_STAR' };
    const normalizedMaterials = materials
      .map((m) => ({ star: Math.floor(Number(m.star)), count: Math.floor(Number(m.count)) }))
      .filter((m) => m.star >= 0 && m.star <= 4 && m.count > 0);
    if (normalizedMaterials.length === 0) return { ok: false, reason: 'INVALID_MATERIALS' };
    const gain = normalizedMaterials.reduce((sum, m) => sum + ((m.star + 1) * m.count), 0);
    const newStar = star + gain;
    if (newStar > 5) return { ok: false, reason: 'EXCEEDS_MAX_STAR' };
    try {
      await this.getDb().transaction(async (tx) => {
        const target = await tx.get(
          `SELECT uc.id
             FROM user_cards uc
            WHERE uc.user_id = ? AND uc.channel_id = ? AND COALESCE(uc.star, 0) = ?
              AND NOT EXISTS (SELECT 1 FROM market_listings ml WHERE ml.user_card_id = uc.id AND ml.status = 'PENDING')
            ORDER BY uc.id ASC
            LIMIT 1
            FOR UPDATE`,
          userId, channelId, star
        );
        if (!target) throw new Error('NO_TARGET');

        const materialIds: number[] = [];
        for (const material of normalizedMaterials) {
          const excludedIds = [target.id, ...materialIds];
          const excludePlaceholders = excludedIds.map(() => '?').join(',');
          const rows = await tx.all<{ id: number }>(
            `SELECT uc.id
               FROM user_cards uc
              WHERE uc.user_id = ? AND uc.channel_id = ? AND COALESCE(uc.star, 0) = ?
                AND uc.id NOT IN (${excludePlaceholders})
                AND NOT EXISTS (SELECT 1 FROM market_listings ml WHERE ml.user_card_id = uc.id AND ml.status = 'PENDING')
              ORDER BY uc.id ASC
              LIMIT ?
              FOR UPDATE`,
            userId, channelId, material.star, ...excludedIds, material.count
          );
          if (rows.length < material.count) throw new Error('NO_FODDER');
          materialIds.push(...rows.map((row) => Number(row.id)));
        }

        if (materialIds.length === 0) throw new Error('NO_FODDER');
        const deletePlaceholders = materialIds.map(() => '?').join(',');
        await tx.run('UPDATE user_cards SET star = ? WHERE id = ?', newStar, target.id);
        await tx.run(`DELETE FROM user_cards WHERE id IN (${deletePlaceholders})`, ...materialIds);
      });
      return { ok: true, reason: 'OK', newStar };
    } catch (err: any) {
      return { ok: false, reason: err.message || 'FAILED' };
    }
  }

  private mapCardRow(row: any): any {
    return {
      id: row.id,
      user_id: row.user_id,
      channel_id: row.channel_id,
      serial_number: row.serial_number,
      star: row.star ?? 0,
      border_item_id: row.border_item_id ?? null,
      name_effect_item_id: row.name_effect_item_id ?? null,
      is_hidden: row.is_hidden === 1 || row.is_hidden === true,
      favorite_order: row.favorite_order ?? null,
      favorite_at: row.favorite_at ?? null,
      border: row.border_id ? { id: row.border_id, style_json: row.border_style } : null,
      name_effect: row.name_id ? { id: row.name_id, style_json: row.name_style, font_url: row.name_font_url, font_family: row.name_font_family } : null,
      acquired_at: row.acquired_at,
      streamer: {
        channel_id: row.channel_id,
        name: row.streamer_name,
        logo_url: row.streamer_logo,
        custom_image_url: formatUploadUrl(row.streamer_custom_image),
        custom_images: [
          formatUploadUrl(row.streamer_custom_image) ?? null,
          formatUploadUrl(row.sci1) ?? null,
          formatUploadUrl(row.sci2) ?? null,
          formatUploadUrl(row.sci3) ?? null,
          formatUploadUrl(row.sci4) ?? null,
          formatUploadUrl(row.sci5) ?? null
        ],
        base_value: row.streamer_base_value,
        follower_count: row.streamer_follower,
        is_image_banned: row.streamer_is_image_banned === 1 || row.streamer_is_image_banned === true,
        activity_score: 0,
        is_active: row.streamer_is_active === 1 || row.streamer_is_active === true,
        serial_number: row.streamer_serial || undefined
      }
    };
  }

  async findByUserId(userId: string): Promise<any[]> {
    const rows = await this.getDb().all(`
      SELECT uc.*, s.name as streamer_name, s.logo_url as streamer_logo, s.custom_image_url as streamer_custom_image,
             s.custom_image_url_1 as sci1, s.custom_image_url_2 as sci2, s.custom_image_url_3 as sci3,
             s.custom_image_url_4 as sci4, s.custom_image_url_5 as sci5,
             s.base_value as streamer_base_value, s.follower_count as streamer_follower,
             s.is_active as streamer_is_active, s.is_image_banned as streamer_is_image_banned,
             s.serial_number as streamer_serial,
             bi.id as border_id, bi.style_json as border_style,
             ni.id as name_id, ni.style_json as name_style, ni.font_url as name_font_url, ni.font_family as name_font_family
      FROM user_cards uc
      JOIN streamers s ON uc.channel_id = s.channel_id
      LEFT JOIN shop_items bi ON uc.border_item_id = bi.id
      LEFT JOIN shop_items ni ON uc.name_effect_item_id = ni.id
      WHERE uc.user_id = ?
      ORDER BY CASE WHEN uc.favorite_order IS NULL THEN 1 ELSE 0 END, uc.favorite_order ASC, uc.id DESC
    `, userId);
    return rows.map((row) => this.mapCardRow(row));
  }

  async findLatestSerialNumber(channelId: string): Promise<number> {
    const row = await this.getDb().get('SELECT MAX(serial_number) as max_sn FROM user_cards WHERE channel_id = ?', channelId);
    return row && row.max_sn ? Number(row.max_sn) : 0;
  }

  async findAllocatedSerialNumbers(channelId: string): Promise<number[]> {
    const rows = await this.getDb().all('SELECT serial_number FROM user_cards WHERE channel_id = ? ORDER BY serial_number ASC', channelId);
    return rows.map((r: any) => Number(r.serial_number));
  }

  async updateVisibility(userId: string, cardId: number, hidden: boolean): Promise<boolean> {
    const result = await this.getDb().run('UPDATE user_cards SET is_hidden = ? WHERE id = ? AND user_id = ?', hidden ? 1 : 0, cardId, userId);
    return result.changes > 0;
  }

  async setFavorite(userId: string, cardId: number, favorite: boolean): Promise<boolean> {
    if (!favorite) {
      const result = await this.getDb().run('UPDATE user_cards SET favorite_order = NULL, favorite_at = NULL WHERE id = ? AND user_id = ?', cardId, userId);
      return result.changes > 0;
    }
    const maxRow = await this.getDb().get('SELECT COALESCE(MAX(favorite_order), 0) AS max_order FROM user_cards WHERE user_id = ?', userId);
    const result = await this.getDb().run(
      'UPDATE user_cards SET favorite_order = ?, favorite_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ?',
      Number(maxRow?.max_order || 0) + 1,
      cardId,
      userId
    );
    return result.changes > 0;
  }

  async deleteCards(userId: string, channelId: string, count: number): Promise<number> {
    const rows = await this.getDb().all<{ id: number }>(
      'SELECT id FROM user_cards WHERE user_id = ? AND channel_id = ? ORDER BY id ASC LIMIT ?',
      userId, channelId, count
    );
    if (rows.length === 0) return 0;
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const result = await this.getDb().run(`DELETE FROM user_cards WHERE id IN (${placeholders})`, ids);
    return result.changes;
  }

  async count(): Promise<number> {
    const row = await this.getDb().get('SELECT COUNT(*) AS c FROM user_cards');
    return row?.c || 0;
  }

  async findByChannel(channelId: string): Promise<{ user_id: string; star: number }[]> {
    const rows = await this.getDb().all('SELECT user_id, COALESCE(star, 0) AS star FROM user_cards WHERE channel_id = ?', channelId);
    return rows.map((r: any) => ({ user_id: r.user_id, star: Number(r.star || 0) }));
  }

  async deleteByChannel(channelId: string): Promise<number> {
    const result = await this.getDb().run('DELETE FROM user_cards WHERE channel_id = ?', channelId);
    return result.changes;
  }

  async sellCardsAtomic(userId: string, actions: { channelId: string; star: number; count: number; baseValue: number }[]): Promise<number> {
    return this.getDb().transaction(async (tx) => {
      let total = 0;
      for (const action of actions) {
        const rows = await tx.all<{ id: number; star: number }>(
          `SELECT uc.id, COALESCE(uc.star, 0) AS star
             FROM user_cards uc
            WHERE uc.user_id = ? AND uc.channel_id = ? AND COALESCE(uc.star, 0) = ?
              AND NOT EXISTS (SELECT 1 FROM market_listings ml WHERE ml.user_card_id = uc.id AND ml.status = 'PENDING')
            ORDER BY uc.id ASC
            LIMIT ?
            FOR UPDATE`,
          userId, action.channelId, action.star, action.count
        );
        if (rows.length < action.count) throw new Error('CARD_SHORTAGE');
        for (const row of rows) total += Math.round(action.baseValue * (1 + (row.star || 0) * 0.8));
        const placeholders = rows.map(() => '?').join(',');
        await tx.run(`DELETE FROM user_cards WHERE id IN (${placeholders})`, rows.map((r) => r.id));
      }
      if (total > 0) await tx.run('UPDATE users SET point = point + ? WHERE id = ?', total, userId);
      return total;
    });
  }
}
