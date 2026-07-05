import { getSqliteDb } from "../../services/db";
import { recordSqlitePointLedger } from "../../services/pointLedger";
import { recordSqliteAssetEvent, recordSqliteAssetEvents } from "../../services/assetEventLog";
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
  AppNotification
} from '../interfaces';
import { STAR_IMAGE_COLUMNS, extractStarImages } from "./shared";
import { formatUploadUrl } from "../../services/imageService";

export class SqliteUserCardRepository implements IUserCardRepository {
  private getDb() {
    return getSqliteDb();
  }

  async create(card: any): Promise<any> {
    const result = this.getDb().prepare(
      'INSERT INTO user_cards (user_id, channel_id, serial_number, star) VALUES (?, ?, ?, ?)'
    ).run(card.user_id, card.channel_id, card.serial_number, card.star ?? 0);
    card.id = Number(result.lastInsertRowid);
    return card;
  }

  async drawAtomic(
    userId: string,
    channelId: string,
    drawCost: number,
    nowIso: string,
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
    const db = this.getDb();
    const safeMaxFreeTickets = Math.max(1, Math.floor(maxFreeTickets || 1));
    const txn = db.transaction(() => {
      const user = db.prepare('SELECT id, point, last_free_draw, free_draw_tickets, bonus_free_draw_tickets FROM users WHERE id = ?').get(userId) as any;
      if (!user) return { ok: false, reason: 'USER_NOT_FOUND' };

      let nextPoint = Number(user.point || 0);
      let nextFreeTickets = Number(user.free_draw_tickets || 0);
      let nextBonusTickets = Number(user.bonus_free_draw_tickets || 0);
      let freeDrawSource: 'unlimited' | 'reset' | 'bonus' | 'point' = 'point';

      if (segmentStartIso !== null) {
        const shouldGrant = !user.last_free_draw
          || new Date(user.last_free_draw).getTime() < new Date(segmentStartIso).getTime();
        if (shouldGrant) {
          const diffMs = user.last_free_draw
            ? new Date(segmentStartIso).getTime() - new Date(user.last_free_draw).getTime()
            : 0;
          const intervalMs = Math.max(1, Number(intervalHours || 1)) * 60 * 60 * 1000;
          const grantCount = user.last_free_draw ? Math.max(1, Math.floor(diffMs / intervalMs)) : 1;
          nextFreeTickets = Math.min(safeMaxFreeTickets, nextFreeTickets + grantCount);
          db.prepare('UPDATE users SET free_draw_tickets = ?, last_free_draw = ? WHERE id = ?')
            .run(nextFreeTickets, segmentStartIso, userId);
          if (grantCount > 0) {
            recordSqliteAssetEvent(db, {
              userId,
              assetType: 'ticket',
              action: 'add',
              quantity: grantCount,
              sourceType: 'gacha_draw',
              reason: 'free_draw_ticket_refresh',
              description: '무료 소환 티켓 충전',
              metadata: { channel_id: channelId, segment_start: segmentStartIso, max_free_tickets: safeMaxFreeTickets }
            });
          }
        }
      }

      if (nextFreeTickets > 0) {
        nextFreeTickets -= 1;
        freeDrawSource = 'reset';
        db.prepare('UPDATE users SET free_draw_tickets = ? WHERE id = ?').run(nextFreeTickets, userId);
        recordSqliteAssetEvent(db, {
          userId,
          assetType: 'ticket',
          action: 'spend',
          quantity: 1,
          sourceType: 'gacha_draw',
          reason: 'free_draw_ticket_spend',
          description: '무료 소환 티켓 사용',
          metadata: { channel_id: channelId, tickets_left: nextFreeTickets }
        });
      } else if (nextBonusTickets > 0) {
        nextBonusTickets -= 1;
        freeDrawSource = 'bonus';
        db.prepare('UPDATE users SET bonus_free_draw_tickets = ? WHERE id = ?').run(nextBonusTickets, userId);
        recordSqliteAssetEvent(db, {
          userId,
          assetType: 'ticket',
          action: 'spend',
          quantity: 1,
          sourceType: 'gacha_draw',
          reason: 'bonus_free_draw_ticket_spend',
          description: '추가 무료 소환 티켓 사용',
          metadata: { channel_id: channelId, bonus_tickets_left: nextBonusTickets }
        });
      } else {
        const deducted = db.prepare('UPDATE users SET point = point - ? WHERE id = ? AND point >= ?')
          .run(drawCost, userId, drawCost);
        if (deducted.changes === 0) return { ok: false, reason: 'INSUFFICIENT_POINT' };
        nextPoint -= drawCost;
        recordSqlitePointLedger(db, {
          userId,
          amount: -drawCost,
          balanceAfter: nextPoint,
          sourceType: 'gacha_draw',
          reason: 'gacha_draw_paid',
          description: '유료 카드 소환 포인트 차감',
          metadata: { channel_id: channelId, draw_cost: drawCost }
        });
      }

      const latest = db.prepare('SELECT COALESCE(MAX(serial_number), 0) AS max_sn FROM user_cards WHERE channel_id = ?')
        .get(channelId) as any;
      const serialNumber = Number(latest?.max_sn || 0) + 1;
      const result = db.prepare(
        'INSERT INTO user_cards (user_id, channel_id, serial_number, star) VALUES (?, ?, ?, 0)'
      ).run(userId, channelId, serialNumber);
      recordSqliteAssetEvent(db, {
        userId,
        assetType: 'card',
        action: 'add',
        quantity: 1,
        sourceType: 'gacha_draw',
        reason: 'gacha_draw_card_add',
        description: '카드 소환 획득',
        cardId: Number(result.lastInsertRowid),
        channelId,
        serialNumber,
        star: 0,
        metadata: { channel_id: channelId, free_draw_source: freeDrawSource }
      });

      return {
        ok: true,
        reason: 'OK',
        is_free: freeDrawSource !== 'point',
        free_draw_source: freeDrawSource,
        points_left: nextPoint,
        free_draw_tickets_left: nextFreeTickets,
        bonus_free_draw_tickets_left: nextBonusTickets,
        card: {
          id: Number(result.lastInsertRowid),
          user_id: userId,
          channel_id: channelId,
          serial_number: serialNumber,
          star: 0
        }
      };
    });

    return txn();
  }

  // 대상 카드 별 상승 + 같은 스트리머의 0성 재료 1장 소모. better-sqlite3 트랜잭션으로 원자 처리
  async fuse(
    userId: string,
    channelId: string,
    star: number,
    materials: { star: number; count: number }[] = [{ star: 0, count: 1 }],
    reservedByStar: Record<string, number> = {}
  ): Promise<{ ok: boolean; reason: string; newStar?: number }> {
    if (star >= 5) return { ok: false, reason: 'MAX_STAR' };
    const normalizedMaterials = materials
      .map((m) => ({ star: Math.floor(Number(m.star)), count: Math.floor(Number(m.count)) }))
      .filter((m) => m.star >= 0 && m.star <= 4 && m.count > 0);
    if (normalizedMaterials.length === 0) return { ok: false, reason: 'INVALID_MATERIALS' };
    const gain = normalizedMaterials.reduce((sum, m) => sum + ((m.star + 1) * m.count), 0);
    const newStar = star + gain;
    if (newStar > 5) return { ok: false, reason: 'EXCEEDS_MAX_STAR' };
    const db = this.getDb();
    const txn = db.transaction(() => {
      const reservedCount = (st: number) => Math.max(0, Math.floor(Number(reservedByStar[`${channelId}#${st}`] || 0)));
      const selectAvailableIds = (st: number, count: number, excludeIds: number[] = []) => {
        const rows = db.prepare(
          `SELECT uc.id, uc.serial_number, COALESCE(uc.star, 0) AS star
            FROM user_cards uc
            WHERE uc.user_id = ? AND uc.channel_id = ? AND COALESCE(uc.star, 0) = ?
              AND COALESCE(uc.is_locked, 0) = 0
              AND NOT EXISTS (
                SELECT 1 FROM market_listings ml
                 WHERE ml.user_card_id = uc.id AND ml.status = 'PENDING'
              )
            ORDER BY uc.id ASC`
        ).all(userId, channelId, st) as { id: number; serial_number: number; star: number }[];
        const excluded = new Set(excludeIds.map((id) => Number(id)));
        return rows
          .slice(reservedCount(st))
          .filter((row) => !excluded.has(Number(row.id)))
          .slice(0, count);
      };

      const [target] = selectAvailableIds(star, 1);
      if (!target) throw new Error('NO_TARGET');

      const materialRows: { id: number; serial_number: number; star: number }[] = [];
      for (const material of normalizedMaterials) {
        const excludedIds = [target.id, ...materialRows.map((row) => row.id)];
        const rows = selectAvailableIds(material.star, material.count, excludedIds);
        if (rows.length < material.count) throw new Error('NO_FODDER');
        materialRows.push(...rows.map((row) => ({ id: Number(row.id), serial_number: Number(row.serial_number), star: Number(row.star || 0) })));
      }

      if (materialRows.length === 0) throw new Error('NO_FODDER');
      const materialIds = materialRows.map((row) => row.id);
      const affectedIds = [Number(target.id), ...materialIds];
      const affectedPlaceholders = affectedIds.map(() => '?').join(',');
      const equippedRows = db.prepare(`
        SELECT id, border_item_id, name_effect_item_id
          FROM user_cards
         WHERE id IN (${affectedPlaceholders})
           AND user_id = ?
      `).all(...affectedIds, userId) as { id: number; border_item_id: number | null; name_effect_item_id: number | null }[];
      for (const row of equippedRows) {
        for (const itemId of [row.border_item_id, row.name_effect_item_id]) {
          if (!itemId) continue;
          db.prepare(`
            INSERT INTO user_cosmetics (user_id, item_id, quantity) VALUES (?, ?, 1)
            ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + 1
          `).run(userId, itemId);
          recordSqliteAssetEvent(db, {
            userId,
            assetType: 'cosmetic',
            action: 'add',
            quantity: 1,
            sourceType: 'card_fuse',
            sourceId: target.id,
            reason: 'card_fuse_cosmetic_return',
            description: '카드 합성으로 장착 코스메틱 반환',
            cardId: Number(row.id),
            channelId,
            itemId: Number(itemId),
            metadata: { target_card_id: target.id, material_card_ids: materialIds }
          });
        }
      }
      db.prepare(`UPDATE user_cards SET border_item_id = NULL, name_effect_item_id = NULL WHERE id IN (${affectedPlaceholders}) AND user_id = ?`)
        .run(...affectedIds, userId);

      const deletePlaceholders = materialIds.map(() => '?').join(',');
      db.prepare('UPDATE user_cards SET star = ? WHERE id = ?').run(newStar, target.id);
      db.prepare(`DELETE FROM user_cards WHERE id IN (${deletePlaceholders})`).run(...materialIds);
      recordSqliteAssetEvent(db, {
        userId,
        assetType: 'card',
        action: 'update',
        quantity: 1,
        sourceType: 'card_fuse',
        sourceId: target.id,
        reason: 'card_fuse_upgrade',
        description: '카드 합성 별 등급 상승',
        cardId: Number(target.id),
        channelId,
        serialNumber: Number(target.serial_number),
        star: newStar,
        metadata: { previous_star: star, new_star: newStar, material_card_ids: materialIds }
      });
      recordSqliteAssetEvents(db, materialRows.map((row) => ({
        userId,
        assetType: 'card',
        action: 'delete',
        quantity: 1,
        sourceType: 'card_fuse',
        sourceId: target.id,
        reason: 'card_fuse_material_delete',
        description: '카드 합성 재료 소모',
        cardId: row.id,
        channelId,
        serialNumber: row.serial_number,
        star: row.star,
        metadata: { target_card_id: target.id, new_star: newStar }
      })));
    });
    try {
      txn();
      return { ok: true, reason: 'OK', newStar };
    } catch (e: any) {
      return { ok: false, reason: e.message || 'FAILED' };
    }
  }

  async findByUserId(userId: string): Promise<any[]> {
    const rows = this.getDb().prepare(`
      SELECT uc.*, s.name as streamer_name, s.logo_url as streamer_logo, s.custom_image_url as streamer_custom_image,
             s.custom_image_url_1 as sci1, s.custom_image_url_2 as sci2, s.custom_image_url_3 as sci3,
             s.custom_image_url_4 as sci4, s.custom_image_url_5 as sci5,
             s.base_value as streamer_base_value, s.follower_count as streamer_follower,
             s.is_active as streamer_is_active, s.is_image_banned as streamer_is_image_banned,
             s.serial_number as streamer_serial,
             bi.id as border_id, bi.name as border_name, bi.style_json as border_style,
             ni.id as name_id, ni.name as name_name, ni.style_json as name_style, ni.font_url as name_font_url, ni.font_family as name_font_family
      FROM user_cards uc
      JOIN streamers s ON uc.channel_id = s.channel_id
      LEFT JOIN shop_items bi ON uc.border_item_id = bi.id
      LEFT JOIN shop_items ni ON uc.name_effect_item_id = ni.id
      WHERE uc.user_id = ?
      ORDER BY CASE WHEN uc.favorite_order IS NULL THEN 1 ELSE 0 END, uc.favorite_order ASC, uc.id DESC
    `).all(userId);

    return rows.map((row: any) => ({
      id: row.id,
      user_id: row.user_id,
      channel_id: row.channel_id,
      serial_number: row.serial_number,
      star: row.star ?? 0,
      border_item_id: row.border_item_id ?? null,
      name_effect_item_id: row.name_effect_item_id ?? null,
      is_hidden: row.is_hidden === 1,
      is_locked: row.is_locked === 1,
      favorite_order: row.favorite_order ?? null,
      favorite_at: row.favorite_at ?? null,
      border: row.border_id ? { id: row.border_id, name: row.border_name ?? null, style_json: row.border_style } : null,
      name_effect: row.name_id ? { id: row.name_id, name: row.name_name ?? null, style_json: row.name_style, font_url: row.name_font_url, font_family: row.name_font_family } : null,
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
        is_image_banned: row.streamer_is_image_banned === 1,
        activity_score: 0,
        is_active: row.streamer_is_active === 1,
        serial_number: row.streamer_serial || undefined
      }
    }));
  }

  async findInventoryGroupsByUserId(userId: string): Promise<any[]> {
    const rows = this.getDb().prepare(`
      SELECT
        uc.channel_id,
        COALESCE(uc.star, 0) AS star,
        COUNT(*) AS count,
        SUM(CASE WHEN COALESCE(uc.is_hidden, 0) = 1 THEN 1 ELSE 0 END) AS hidden_count,
        SUM(CASE WHEN COALESCE(uc.is_locked, 0) = 1 THEN 1 ELSE 0 END) AS locked_count,
        SUM(CASE WHEN uc.favorite_order IS NOT NULL THEN 1 ELSE 0 END) AS favorite_count,
        MIN(uc.id) AS first_card_id,
        MIN(uc.favorite_order) AS favorite_order,
        s.name as streamer_name, s.logo_url as streamer_logo, s.custom_image_url as streamer_custom_image,
        s.custom_image_url_1 as sci1, s.custom_image_url_2 as sci2, s.custom_image_url_3 as sci3,
        s.custom_image_url_4 as sci4, s.custom_image_url_5 as sci5,
        s.base_value as streamer_base_value, s.follower_count as streamer_follower,
        s.is_active as streamer_is_active, s.is_image_banned as streamer_is_image_banned,
        s.serial_number as streamer_serial
      FROM user_cards uc
      JOIN streamers s ON uc.channel_id = s.channel_id
      WHERE uc.user_id = ?
      GROUP BY
        uc.channel_id, COALESCE(uc.star, 0),
        s.name, s.logo_url, s.custom_image_url, s.custom_image_url_1, s.custom_image_url_2,
        s.custom_image_url_3, s.custom_image_url_4, s.custom_image_url_5,
        s.base_value, s.follower_count, s.is_active, s.is_image_banned, s.serial_number
      ORDER BY CASE WHEN MIN(uc.favorite_order) IS NULL THEN 1 ELSE 0 END, MIN(uc.favorite_order) ASC, MAX(uc.id) DESC
    `).all(userId) as any[];
    return rows.map((row: any) => ({
      channel_id: row.channel_id,
      star: Number(row.star || 0),
      count: Number(row.count || 0),
      hidden_count: Number(row.hidden_count || 0),
      locked_count: Number(row.locked_count || 0),
      favorite_count: Number(row.favorite_count || 0),
      first_card_id: row.first_card_id == null ? null : Number(row.first_card_id),
      favorite_order: row.favorite_order == null ? null : Number(row.favorite_order),
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
        is_image_banned: row.streamer_is_image_banned === 1,
        activity_score: 0,
        is_active: row.streamer_is_active === 1,
        serial_number: row.streamer_serial || undefined
      }
    }));
  }

  async findLatestSerialNumber(channelId: string): Promise<number> {
    const row = this.getDb().prepare(
      'SELECT MAX(serial_number) as max_sn FROM user_cards WHERE channel_id = ?'
    ).get(channelId) as any;
    return row && row.max_sn ? row.max_sn : 0;
  }

  async findAllocatedSerialNumbers(channelId: string): Promise<number[]> {
    const rows = this.getDb().prepare(
      'SELECT serial_number FROM user_cards WHERE channel_id = ? ORDER BY serial_number ASC'
    ).all(channelId) as any[];
    return rows.map(r => r.serial_number);
  }

  async updateVisibility(userId: string, cardId: number, hidden: boolean): Promise<boolean> {
    const result = this.getDb().prepare(
      'UPDATE user_cards SET is_hidden = ? WHERE id = ? AND user_id = ?'
    ).run(hidden ? 1 : 0, cardId, userId);
    return result.changes > 0;
  }

  async updateVisibilityByGroup(userId: string, channelId: string, star: number, hidden: boolean): Promise<number> {
    const result = this.getDb().prepare(
      'UPDATE user_cards SET is_hidden = ? WHERE user_id = ? AND channel_id = ? AND COALESCE(star, 0) = ?'
    ).run(hidden ? 1 : 0, userId, channelId, star);
    return result.changes || 0;
  }

  async setFavorite(userId: string, cardId: number, favorite: boolean): Promise<boolean> {
    const db = this.getDb();
    if (!favorite) {
      const result = db.prepare(
        'UPDATE user_cards SET favorite_order = NULL, favorite_at = NULL WHERE id = ? AND user_id = ?'
      ).run(cardId, userId);
      return result.changes > 0;
    }

    const maxRow = db.prepare(
      'SELECT COALESCE(MAX(favorite_order), 0) AS max_order FROM user_cards WHERE user_id = ?'
    ).get(userId) as any;
    const result = db.prepare(
      "UPDATE user_cards SET favorite_order = ?, favorite_at = datetime('now') WHERE id = ? AND user_id = ?"
    ).run(Number(maxRow?.max_order || 0) + 1, cardId, userId);
    return result.changes > 0;
  }

  async setLocked(userId: string, cardId: number, locked: boolean): Promise<boolean> {
    const result = this.getDb().prepare(
      'UPDATE user_cards SET is_locked = ? WHERE id = ? AND user_id = ?'
    ).run(locked ? 1 : 0, cardId, userId);
    return result.changes > 0;
  }

  async deleteCards(userId: string, channelId: string, count: number): Promise<number> {
    // 특정 개수만큼만 삭제하기 위해 rowid 또는 id를 조회해서 IN 절로 삭제합니다.
    const rows = this.getDb().prepare(
      'SELECT id FROM user_cards WHERE user_id = ? AND channel_id = ? AND COALESCE(is_locked, 0) = 0 ORDER BY id ASC LIMIT ?'
    ).all(userId, channelId, count) as { id: number }[];
    
    if (rows.length === 0) return 0;
    
    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const result = this.getDb().prepare(
      `DELETE FROM user_cards WHERE id IN (${placeholders})`
    ).run(...ids);

    return result.changes;
  }

  async count(): Promise<number> {
    const row = this.getDb().prepare('SELECT COUNT(*) AS c FROM user_cards').get() as any;
    return row?.c || 0;
  }

  async findByChannel(channelId: string): Promise<{ user_id: string; star: number; id?: number; serial_number?: number; border_item_id?: number | null; name_effect_item_id?: number | null }[]> {
    const rows = this.getDb().prepare(
      'SELECT id, user_id, serial_number, COALESCE(star, 0) AS star, border_item_id, name_effect_item_id FROM user_cards WHERE channel_id = ?'
    ).all(channelId) as any[];
    return rows.map(r => ({
      id: Number(r.id),
      user_id: r.user_id,
      serial_number: r.serial_number == null ? undefined : Number(r.serial_number),
      star: r.star || 0,
      border_item_id: r.border_item_id ?? null,
      name_effect_item_id: r.name_effect_item_id ?? null
    }));
  }

  async countByChannelIds(channelIds: string[]): Promise<Record<string, { card_count: number; affected_users: number }>> {
    const uniqueIds = Array.from(new Set(channelIds.filter(Boolean)));
    if (uniqueIds.length === 0) return {};
    const result: Record<string, { card_count: number; affected_users: number }> = {};
    for (let i = 0; i < uniqueIds.length; i += 500) {
      const group = uniqueIds.slice(i, i + 500);
      const placeholders = group.map(() => '?').join(',');
      const rows = this.getDb().prepare(`
        SELECT channel_id, COUNT(*) AS card_count, COUNT(DISTINCT user_id) AS affected_users
        FROM user_cards
        WHERE channel_id IN (${placeholders})
        GROUP BY channel_id
      `).all(...group) as any[];
      rows.forEach((row: any) => {
        result[row.channel_id] = {
          card_count: Number(row.card_count || 0),
          affected_users: Number(row.affected_users || 0)
        };
      });
    }
    return result;
  }

  async deleteByChannel(channelId: string): Promise<number> {
    const db = this.getDb();
    const txn = db.transaction(() => {
      const rows = db.prepare(
        'SELECT id, user_id, channel_id, serial_number, COALESCE(star, 0) AS star, border_item_id, name_effect_item_id FROM user_cards WHERE channel_id = ?'
      ).all(channelId) as {
        id: number;
        user_id: string;
        channel_id: string;
        serial_number: number;
        star: number;
        border_item_id: number | null;
        name_effect_item_id: number | null;
      }[];
      const result = db.prepare('DELETE FROM user_cards WHERE channel_id = ?').run(channelId);
      recordSqliteAssetEvents(db, rows.flatMap((row) => {
        const events: any[] = [{
          userId: row.user_id,
          assetType: 'card',
          action: 'delete',
          quantity: 1,
          sourceType: 'admin_streamer_delete',
          sourceId: channelId,
          reason: 'streamer_card_delete',
          description: '관리자 스트리머 카드 일괄 삭제',
          cardId: Number(row.id),
          channelId: row.channel_id,
          serialNumber: Number(row.serial_number),
          star: Number(row.star || 0)
        }];
        for (const itemId of [row.border_item_id, row.name_effect_item_id]) {
          if (!itemId) continue;
          events.push({
            userId: row.user_id,
            assetType: 'cosmetic',
            action: 'delete',
            quantity: 1,
            sourceType: 'admin_streamer_delete',
            sourceId: channelId,
            reason: 'streamer_card_equipped_cosmetic_delete',
            description: '관리자 카드 일괄 삭제로 장착 코스메틱 제거',
            cardId: Number(row.id),
            channelId: row.channel_id,
            itemId: Number(itemId)
          });
        }
        return events;
      }));
      return result.changes;
    });
    return txn();
  }

  async sellCardsAtomic(userId: string, actions: { channelId: string; star: number; count: number; baseValue: number }[]): Promise<number> {
    const db = this.getDb();
    const txn = db.transaction(() => {
      let total = 0;

      for (const action of actions) {
        const rows = db.prepare(
          `SELECT uc.id, uc.channel_id, uc.serial_number, COALESCE(uc.star, 0) AS star,
                  uc.border_item_id, uc.name_effect_item_id
            FROM user_cards uc
            WHERE uc.user_id = ? AND uc.channel_id = ? AND COALESCE(uc.star, 0) = ?
              AND COALESCE(uc.is_locked, 0) = 0
              AND NOT EXISTS (
                SELECT 1 FROM market_listings ml
                 WHERE ml.user_card_id = uc.id AND ml.status = 'PENDING'
              )
            ORDER BY uc.id ASC
            LIMIT ?`
        ).all(userId, action.channelId, action.star, action.count) as {
          id: number;
          channel_id: string;
          serial_number: number;
          star: number;
          border_item_id: number | null;
          name_effect_item_id: number | null;
        }[];

        if (rows.length < action.count) {
          throw new Error('CARD_SHORTAGE');
        }

        for (const row of rows) {
          total += Math.round(action.baseValue * (1 + (row.star || 0) * 0.8));
        }

        const placeholders = rows.map(() => '?').join(',');
        db.prepare(`DELETE FROM user_cards WHERE id IN (${placeholders})`).run(...rows.map((r) => r.id));
        recordSqliteAssetEvents(db, rows.flatMap((row) => {
          const events: any[] = [{
            userId,
            assetType: 'card',
            action: 'delete',
            quantity: 1,
            sourceType: 'card_sell',
            sourceId: row.id,
            reason: 'card_sell_delete',
            description: '보유 카드 판매 삭제',
            cardId: Number(row.id),
            channelId: row.channel_id,
            serialNumber: Number(row.serial_number),
            star: Number(row.star || 0),
            metadata: { base_value: action.baseValue }
          }];
          for (const itemId of [row.border_item_id, row.name_effect_item_id]) {
            if (!itemId) continue;
            events.push({
              userId,
              assetType: 'cosmetic',
              action: 'delete',
              quantity: 1,
              sourceType: 'card_sell',
              sourceId: row.id,
              reason: 'card_sell_equipped_cosmetic_delete',
              description: '카드 판매로 장착 코스메틱 제거',
              cardId: Number(row.id),
              channelId: row.channel_id,
              itemId: Number(itemId)
            });
          }
          return events;
        }));
      }

      if (total > 0) {
        db.prepare('UPDATE users SET point = point + ? WHERE id = ?').run(total, userId);
        recordSqlitePointLedger(db, {
          userId,
          amount: total,
          sourceType: 'card_sell',
          reason: 'card_sell',
          description: '보유 카드 판매 보상',
          metadata: { actions }
        });
      }

      return total;
    });

    return txn();
  }
}

// 7. SQLite 거래(1:1 교환) 레포지토리
