import { getSqliteDb } from "../../services/db";
import { IMarketRepository, MarketListing } from "../interfaces";
import { STAR_IMAGE_COLUMNS, extractStarImages } from "./shared";
import { formatUploadUrl } from "../../services/imageService";

// 초성 추출 헬퍼
function getChosung(str: string): string {
  const CHOSUNG = [
    'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
  ];
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i) - 0xac00;
    if (code >= 0 && code <= 11172) {
      result += CHOSUNG[Math.floor(code / 588)];
    } else {
      result += str.charAt(i);
    }
  }
  return result;
}

// 유사도 비교 (초성 매칭 및 띄어쓰기 제거)
function fuzzyMatch(target: string, query: string): boolean {
  const cleanTarget = target.replace(/\s+/g, '').toLowerCase();
  const cleanQuery = query.replace(/\s+/g, '').toLowerCase();
  
  if (cleanTarget.includes(cleanQuery)) return true;
  
  const targetChosung = getChosung(cleanTarget);
  const queryChosung = getChosung(cleanQuery);
  return targetChosung.includes(queryChosung);
}

export class SqliteMarketRepository implements IMarketRepository {
  private getDb() {
    return getSqliteDb();
  }

  private mapRow(row: any): MarketListing {
    return {
      id: row.id,
      seller_id: row.seller_id,
      user_card_id: row.user_card_id,
      price: row.price,
      status: row.status as MarketListing['status'],
      buyer_id: row.buyer_id ?? null,
      fee: row.fee ?? 0,
      settled_amount: row.settled_amount ?? 0,
      with_cosmetics: row.with_cosmetics === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
      seller_username: row.seller_username,
      buyer_username: row.buyer_username,
      card: row.user_card_id ? {
        id: row.user_card_id,
        user_id: row.card_user_id,
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
      } : undefined
    };
  }

  async create(listing: { seller_id: string; user_card_id: number; price: number; with_cosmetics?: boolean }): Promise<MarketListing> {
    if (listing.price < 100) {
      throw new Error('MIN_PRICE_LIMIT');
    }
    const result = this.getDb().prepare(`
      INSERT INTO market_listings (seller_id, user_card_id, price, with_cosmetics, status)
      VALUES (?, ?, ?, ?, 'PENDING')
    `).run(listing.seller_id, listing.user_card_id, listing.price, listing.with_cosmetics ? 1 : 0);

    const newId = Number(result.lastInsertRowid);
    const created = await this.findById(newId);
    if (!created) {
      throw new Error('CREATE_FAILED');
    }
    return created;
  }

  async findById(id: number): Promise<MarketListing | null> {
    const row = this.getDb().prepare(`
      SELECT ml.*, u.username AS seller_username, bu.username AS buyer_username,
             uc.user_id AS card_user_id, uc.channel_id, uc.serial_number, uc.star,
             uc.border_item_id, uc.name_effect_item_id, uc.acquired_at,
             s.name AS streamer_name, s.logo_url AS streamer_logo, s.custom_image_url AS streamer_custom_image,
             s.custom_image_url_1 as sci1, s.custom_image_url_2 as sci2, s.custom_image_url_3 as sci3,
             s.custom_image_url_4 as sci4, s.custom_image_url_5 as sci5,
             s.base_value AS streamer_base_value, s.follower_count AS streamer_follower,
             s.is_active AS streamer_is_active, s.is_image_banned AS streamer_is_image_banned,
             s.serial_number AS streamer_serial,
             bi.id AS border_id, bi.style_json AS border_style,
             ni.id AS name_id, ni.style_json AS name_style, ni.font_url AS name_font_url, ni.font_family AS name_font_family
        FROM market_listings ml
        JOIN users u ON u.id = ml.seller_id
        LEFT JOIN users bu ON bu.id = ml.buyer_id
        JOIN user_cards uc ON uc.id = ml.user_card_id
        JOIN streamers s ON s.channel_id = uc.channel_id
        LEFT JOIN shop_items bi ON uc.border_item_id = bi.id
        LEFT JOIN shop_items ni ON uc.name_effect_item_id = ni.id
       WHERE ml.id = ?
    `).get(id) as any;

    return row ? this.mapRow(row) : null;
  }

  async findPendingCardIdsByUser(userId: string): Promise<number[]> {
    const rows = this.getDb().prepare(`
      SELECT user_card_id FROM market_listings
       WHERE seller_id = ? AND status = 'PENDING'
    `).all(userId) as { user_card_id: number }[];
    return rows.map(r => r.user_card_id);
  }

  async listActive(options: {
    page: number;
    limit: number;
    search?: string;
    sort: 'latest' | 'oldest' | 'price_desc' | 'price_asc';
  }): Promise<{ listings: MarketListing[]; total: number }> {
    const db = this.getDb();
    const rows = db.prepare(`
      SELECT ml.*, u.username AS seller_username, bu.username AS buyer_username,
             uc.user_id AS card_user_id, uc.channel_id, uc.serial_number, uc.star,
             uc.border_item_id, uc.name_effect_item_id, uc.acquired_at,
             s.name AS streamer_name, s.logo_url AS streamer_logo, s.custom_image_url AS streamer_custom_image,
             s.custom_image_url_1 as sci1, s.custom_image_url_2 as sci2, s.custom_image_url_3 as sci3,
             s.custom_image_url_4 as sci4, s.custom_image_url_5 as sci5,
             s.base_value AS streamer_base_value, s.follower_count AS streamer_follower,
             s.is_active AS streamer_is_active, s.is_image_banned AS streamer_is_image_banned,
             s.serial_number AS streamer_serial,
             bi.id AS border_id, bi.style_json AS border_style,
             ni.id AS name_id, ni.style_json AS name_style, ni.font_url AS name_font_url, ni.font_family AS name_font_family
        FROM market_listings ml
        JOIN users u ON u.id = ml.seller_id
        LEFT JOIN users bu ON bu.id = ml.buyer_id
        JOIN user_cards uc ON uc.id = ml.user_card_id
        JOIN streamers s ON s.channel_id = uc.channel_id
        LEFT JOIN shop_items bi ON uc.border_item_id = bi.id
        LEFT JOIN shop_items ni ON uc.name_effect_item_id = ni.id
       WHERE ml.status = 'PENDING'
    `).all() as any[];

    let listings = rows.map(r => this.mapRow(r));

    // 유사도 검색 적용
    if (options.search && options.search.trim()) {
      const q = options.search.trim();
      listings = listings.filter(item => {
        const streamerName = item.card?.streamer?.name || '';
        const sellerName = item.seller_username || '';
        return fuzzyMatch(streamerName, q) || fuzzyMatch(sellerName, q);
      });
    }

    // 정렬 적용
    listings.sort((a, b) => {
      if (options.sort === 'latest') {
        return new Date(b.created_at || '').getTime() - new Date(a.created_at || '').getTime();
      } else if (options.sort === 'oldest') {
        return new Date(a.created_at || '').getTime() - new Date(b.created_at || '').getTime();
      } else if (options.sort === 'price_desc') {
        return b.price - a.price;
      } else if (options.sort === 'price_asc') {
        return a.price - b.price;
      }
      return 0;
    });

    const total = listings.length;
    const startIndex = (options.page - 1) * options.limit;
    const paginatedListings = listings.slice(startIndex, startIndex + options.limit);

    return {
      listings: paginatedListings,
      total
    };
  }

  async listByUser(userId: string): Promise<MarketListing[]> {
    const rows = this.getDb().prepare(`
      SELECT ml.*, u.username AS seller_username, bu.username AS buyer_username,
             uc.user_id AS card_user_id, uc.channel_id, uc.serial_number, uc.star,
             uc.border_item_id, uc.name_effect_item_id, uc.acquired_at,
             s.name AS streamer_name, s.logo_url AS streamer_logo, s.custom_image_url AS streamer_custom_image,
             s.custom_image_url_1 as sci1, s.custom_image_url_2 as sci2, s.custom_image_url_3 as sci3,
             s.custom_image_url_4 as sci4, s.custom_image_url_5 as sci5,
             s.base_value AS streamer_base_value, s.follower_count AS streamer_follower,
             s.is_active AS streamer_is_active, s.is_image_banned AS streamer_is_image_banned,
             s.serial_number AS streamer_serial,
             bi.id AS border_id, bi.style_json AS border_style,
             ni.id AS name_id, ni.style_json AS name_style, ni.font_url AS name_font_url, ni.font_family AS name_font_family
        FROM market_listings ml
        JOIN users u ON u.id = ml.seller_id
        LEFT JOIN users bu ON bu.id = ml.buyer_id
        JOIN user_cards uc ON uc.id = ml.user_card_id
        JOIN streamers s ON s.channel_id = uc.channel_id
        LEFT JOIN shop_items bi ON uc.border_item_id = bi.id
        LEFT JOIN shop_items ni ON uc.name_effect_item_id = ni.id
       WHERE ml.seller_id = ?
       ORDER BY ml.id DESC
    `).all(userId) as any[];

    return rows.map(r => this.mapRow(r));
  }

  async updateStatus(id: number, status: MarketListing['status'], extra?: { buyer_id?: string; fee?: number; settled_amount?: number }): Promise<void> {
    if (extra) {
      this.getDb().prepare(`
        UPDATE market_listings
           SET status = ?, buyer_id = ?, fee = ?, settled_amount = ?, updated_at = datetime('now')
         WHERE id = ?
      `).run(status, extra.buyer_id ?? null, extra.fee ?? 0, extra.settled_amount ?? 0, id);
    } else {
      this.getDb().prepare(`
        UPDATE market_listings
           SET status = ?, updated_at = datetime('now')
         WHERE id = ?
      `).run(status, id);
    }
  }

  async buyAtomic(listingId: number, buyerId: string): Promise<{ ok: boolean; reason: string; settled_amount?: number; seller_id?: string; price?: number }> {
    const db = this.getDb();
    const txn = db.transaction(() => {
      const listing = db.prepare('SELECT * FROM market_listings WHERE id = ? AND status = "PENDING"').get(listingId) as any;
      if (!listing) throw new Error('NOT_FOUND_OR_NOT_PENDING');
      if (listing.seller_id === buyerId) throw new Error('CANNOT_BUY_OWN_ITEM');

      const buyer = db.prepare('SELECT point FROM users WHERE id = ?').get(buyerId) as any;
      const seller = db.prepare('SELECT point FROM users WHERE id = ?').get(listing.seller_id) as any;
      if (!buyer) throw new Error('BUYER_NOT_FOUND');
      if (!seller) throw new Error('SELLER_NOT_FOUND');

      if (buyer.point < listing.price) {
        throw new Error('INSUFFICIENT_POINT');
      }

      // 수수료 5% 소수점 버림
      const fee = Math.floor(listing.price * 0.05);
      const settledAmount = listing.price - fee;

      // 정산
      db.prepare('UPDATE users SET point = point - ? WHERE id = ?').run(listing.price, buyerId);
      db.prepare('UPDATE users SET point = point + ? WHERE id = ?').run(settledAmount, listing.seller_id);

      // 매물 갱신
      db.prepare(`
        UPDATE market_listings
           SET status = 'SOLD', buyer_id = ?, fee = ?, settled_amount = ?, updated_at = datetime('now')
         WHERE id = ?
      `).run(buyerId, fee, settledAmount, listingId);

      // 소유권 및 코스메틱 처리 분기
      if (listing.with_cosmetics === 1) {
        // 코스메틱 정보를 유지한 채 소유권만 이전
        db.prepare(`
          UPDATE user_cards
             SET user_id = ?
           WHERE id = ?
        `).run(buyerId, listing.user_card_id);
      } else {
        // 코스메틱 정보를 해제하고 판매자 계정으로 반환 처리
        const card = db.prepare('SELECT border_item_id, name_effect_item_id FROM user_cards WHERE id = ?').get(listing.user_card_id) as any;
        if (card) {
          if (card.border_item_id) {
            db.prepare(`
              INSERT INTO user_cosmetics (user_id, item_id, quantity) VALUES (?, ?, 1)
              ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + 1
            `).run(listing.seller_id, card.border_item_id);
          }
          if (card.name_effect_item_id) {
            db.prepare(`
              INSERT INTO user_cosmetics (user_id, item_id, quantity) VALUES (?, ?, 1)
              ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + 1
            `).run(listing.seller_id, card.name_effect_item_id);
          }
        }
        
        db.prepare(`
          UPDATE user_cards
             SET user_id = ?, border_item_id = NULL, name_effect_item_id = NULL
           WHERE id = ?
        `).run(buyerId, listing.user_card_id);
      }

      return {
        ok: true,
        reason: 'OK',
        settled_amount: settledAmount,
        seller_id: listing.seller_id,
        price: listing.price
      };
    });

    try {
      return txn();
    } catch (err: any) {
      return { ok: false, reason: err.message || 'FAILED' };
    }
  }

  async listHistory(userId: string): Promise<MarketListing[]> {
    const rows = this.getDb().prepare(`
      SELECT ml.*, u.username AS seller_username, bu.username AS buyer_username,
             uc.user_id AS card_user_id, uc.channel_id, uc.serial_number, uc.star,
             uc.border_item_id, uc.name_effect_item_id, uc.acquired_at,
             s.name AS streamer_name, s.logo_url AS streamer_logo, s.custom_image_url AS streamer_custom_image,
             s.custom_image_url_1 as sci1, s.custom_image_url_2 as sci2, s.custom_image_url_3 as sci3,
             s.custom_image_url_4 as sci4, s.custom_image_url_5 as sci5,
             s.base_value AS streamer_base_value, s.follower_count AS streamer_follower,
             s.is_active AS streamer_is_active, s.is_image_banned AS streamer_is_image_banned,
             s.serial_number AS streamer_serial,
             bi.id AS border_id, bi.style_json AS border_style,
             ni.id AS name_id, ni.style_json AS name_style, ni.font_url AS name_font_url, ni.font_family AS name_font_family
        FROM market_listings ml
        JOIN users u ON u.id = ml.seller_id
        LEFT JOIN users bu ON bu.id = ml.buyer_id
        JOIN user_cards uc ON uc.id = ml.user_card_id
        JOIN streamers s ON s.channel_id = uc.channel_id
        LEFT JOIN shop_items bi ON uc.border_item_id = bi.id
        LEFT JOIN shop_items ni ON uc.name_effect_item_id = ni.id
       WHERE (ml.seller_id = ? OR ml.buyer_id = ?) AND ml.status IN ('SOLD', 'CANCELLED')
       ORDER BY ml.updated_at DESC
    `).all(userId, userId) as any[];

    return rows.map(r => this.mapRow(r));
  }

  async getRecentPrice(channelId: string): Promise<number | null> {
    const row = this.getDb().prepare(`
      SELECT ml.price
        FROM market_listings ml
        JOIN user_cards uc ON uc.id = ml.user_card_id
       WHERE uc.channel_id = ? AND ml.status = 'SOLD'
       ORDER BY ml.updated_at DESC
       LIMIT 1
    `).get(channelId) as { price: number } | undefined;
    return row ? row.price : null;
  }
}
