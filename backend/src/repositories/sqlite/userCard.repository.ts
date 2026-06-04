import { getSqliteDb } from "../../services/db";
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

  // 같은 스트리머·같은 별 카드 2장 → 1장(별+1). better-sqlite3 트랜잭션으로 원자 처리
  async fuse(userId: string, channelId: string, star: number): Promise<{ ok: boolean; reason: string; newStar?: number }> {
    if (star >= 5) return { ok: false, reason: 'MAX_STAR' };
    const db = this.getDb();
    const txn = db.transaction(() => {
      // 1) 업그레이드 대상: 현재 star인 카드 1장
      const target = db.prepare(
        'SELECT id FROM user_cards WHERE user_id = ? AND channel_id = ? AND COALESCE(star,0) = ? ORDER BY id ASC LIMIT 1'
      ).get(userId, channelId, star) as any;
      if (!target) throw new Error('NO_TARGET');
      // 2) 한계돌파 재료: 같은 스트리머의 0성 카드 1장 (대상과 다른 카드)
      const fodder = db.prepare(
        'SELECT id FROM user_cards WHERE user_id = ? AND channel_id = ? AND COALESCE(star,0) = 0 AND id <> ? ORDER BY id ASC LIMIT 1'
      ).get(userId, channelId, target.id) as any;
      if (!fodder) throw new Error('NO_FODDER');
      // 대상 카드의 별을 1 올리고, 재료 0성 카드는 소모(삭제)
      db.prepare('UPDATE user_cards SET star = ? WHERE id = ?').run(star + 1, target.id);
      db.prepare('DELETE FROM user_cards WHERE id = ?').run(fodder.id);
    });
    try {
      txn();
      return { ok: true, reason: 'OK', newStar: star + 1 };
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
             bi.id as border_id, bi.style_json as border_style,
             ni.id as name_id, ni.style_json as name_style, ni.font_url as name_font_url, ni.font_family as name_font_family
      FROM user_cards uc
      JOIN streamers s ON uc.channel_id = s.channel_id
      LEFT JOIN shop_items bi ON uc.border_item_id = bi.id
      LEFT JOIN shop_items ni ON uc.name_effect_item_id = ni.id
      WHERE uc.user_id = ?
      ORDER BY uc.id DESC
    `).all(userId);

    return rows.map((row: any) => ({
      id: row.id,
      user_id: row.user_id,
      channel_id: row.channel_id,
      serial_number: row.serial_number,
      star: row.star ?? 0,
      border_item_id: row.border_item_id ?? null,
      name_effect_item_id: row.name_effect_item_id ?? null,
      border: row.border_id ? { id: row.border_id, style_json: row.border_style } : null,
      name_effect: row.name_id ? { id: row.name_id, style_json: row.name_style, font_url: row.name_font_url, font_family: row.name_font_family } : null,
      acquired_at: row.acquired_at,
      streamer: {
        channel_id: row.channel_id,
        name: row.streamer_name,
        logo_url: row.streamer_logo,
        custom_image_url: row.streamer_custom_image,
        custom_images: [row.streamer_custom_image ?? null, row.sci1 ?? null, row.sci2 ?? null, row.sci3 ?? null, row.sci4 ?? null, row.sci5 ?? null],
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

  async deleteCards(userId: string, channelId: string, count: number): Promise<number> {
    // 특정 개수만큼만 삭제하기 위해 rowid 또는 id를 조회해서 IN 절로 삭제합니다.
    const rows = this.getDb().prepare(
      'SELECT id FROM user_cards WHERE user_id = ? AND channel_id = ? ORDER BY id ASC LIMIT ?'
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

  async findByChannel(channelId: string): Promise<{ user_id: string; star: number }[]> {
    const rows = this.getDb().prepare(
      'SELECT user_id, COALESCE(star, 0) AS star FROM user_cards WHERE channel_id = ?'
    ).all(channelId) as any[];
    return rows.map(r => ({ user_id: r.user_id, star: r.star || 0 }));
  }

  async deleteByChannel(channelId: string): Promise<number> {
    const result = this.getDb().prepare('DELETE FROM user_cards WHERE channel_id = ?').run(channelId);
    return result.changes;
  }
}

// 7. SQLite 거래(1:1 교환) 레포지토리
