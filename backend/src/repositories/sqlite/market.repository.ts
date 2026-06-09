import { getSqliteDb } from "../../services/db";
import { IMarketRepository, MarketListing } from "../interfaces";
import { STAR_IMAGE_COLUMNS, extractStarImages } from "./shared";
import { formatUploadUrl } from "../../services/imageService";
import { fuzzyMatch } from "../../utils/search";

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
      listing_type: row.listing_type || 'fixed',
      buy_now_price: row.buy_now_price ?? null,
      starting_bid: row.starting_bid ?? null,
      current_bid: row.current_bid ?? null,
      current_bidder_id: row.current_bidder_id ?? null,
      auction_ends_at: row.auction_ends_at ?? null,
      fee: row.fee ?? 0,
      settled_amount: row.settled_amount ?? 0,
      with_cosmetics: row.with_cosmetics === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
      seller_username: row.seller_username,
      buyer_username: row.buyer_username,
      current_bidder_username: row.current_bidder_username,
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
          serial_number: row.streamer_serial ?? undefined
        }
      } : undefined
    };
  }

  async create(listing: {
    seller_id: string;
    user_card_id: number;
    price: number;
    with_cosmetics?: boolean;
    listing_type?: 'fixed' | 'auction';
    buy_now_price?: number | null;
    starting_bid?: number | null;
    auction_ends_at?: string | null;
  }): Promise<MarketListing> {
    const listingType = listing.listing_type === 'auction' ? 'auction' : 'fixed';
    const buyNowPrice = listingType === 'auction' ? (listing.buy_now_price ?? null) : listing.price;
    const startingBid = listingType === 'auction' ? Math.max(100, Number(listing.starting_bid || listing.price)) : null;
    const price = listingType === 'auction' ? (buyNowPrice || startingBid || listing.price) : listing.price;
    if (price < 100 || (startingBid != null && startingBid < 100)) {
      throw new Error('MIN_PRICE_LIMIT');
    }
    const result = this.getDb().prepare(`
      INSERT INTO market_listings
        (seller_id, user_card_id, price, listing_type, buy_now_price, starting_bid, current_bid, auction_ends_at, with_cosmetics, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
    `).run(
      listing.seller_id,
      listing.user_card_id,
      price,
      listingType,
      buyNowPrice,
      startingBid,
      startingBid,
      listing.auction_ends_at ?? null,
      listing.with_cosmetics ? 1 : 0
    );

    const newId = Number(result.lastInsertRowid);
    const created = await this.findById(newId);
    if (!created) {
      throw new Error('CREATE_FAILED');
    }
    return created;
  }

  async findById(id: number): Promise<MarketListing | null> {
    const row = this.getDb().prepare(`
      SELECT ml.*, u.username AS seller_username, bu.username AS buyer_username, cb.username AS current_bidder_username,
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
        LEFT JOIN users cb ON cb.id = ml.current_bidder_id
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
    sort: 'latest' | 'oldest' | 'price_desc' | 'price_asc' | 'ending_soon' | 'bid_desc';
    type?: 'all' | 'fixed' | 'auction';
  }): Promise<{ listings: MarketListing[]; total: number }> {
    const db = this.getDb();
    const rows = db.prepare(`
      SELECT ml.*, u.username AS seller_username, bu.username AS buyer_username, cb.username AS current_bidder_username,
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
        LEFT JOIN users cb ON cb.id = ml.current_bidder_id
        JOIN user_cards uc ON uc.id = ml.user_card_id
        JOIN streamers s ON s.channel_id = uc.channel_id
        LEFT JOIN shop_items bi ON uc.border_item_id = bi.id
        LEFT JOIN shop_items ni ON uc.name_effect_item_id = ni.id
       WHERE ml.status = 'PENDING'
    `).all() as any[];

    let listings = rows.map(r => this.mapRow(r));
    if (options.type && options.type !== 'all') {
      listings = listings.filter(item => (item.listing_type || 'fixed') === options.type);
    }

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
      } else if (options.sort === 'ending_soon') {
        return new Date(a.auction_ends_at || '9999-12-31').getTime() - new Date(b.auction_ends_at || '9999-12-31').getTime();
      } else if (options.sort === 'bid_desc') {
        return (b.current_bid || b.starting_bid || 0) - (a.current_bid || a.starting_bid || 0);
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
      SELECT ml.*, u.username AS seller_username, bu.username AS buyer_username, cb.username AS current_bidder_username,
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
        LEFT JOIN users cb ON cb.id = ml.current_bidder_id
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
      const listing = db.prepare("SELECT * FROM market_listings WHERE id = ? AND status = 'PENDING'").get(listingId) as any;
      if (!listing) throw new Error('NOT_FOUND_OR_NOT_PENDING');
      if (listing.seller_id === buyerId) throw new Error('CANNOT_BUY_OWN_ITEM');

      const buyer = db.prepare('SELECT point FROM users WHERE id = ?').get(buyerId) as any;
      const seller = db.prepare('SELECT point FROM users WHERE id = ?').get(listing.seller_id) as any;
      if (!buyer) throw new Error('BUYER_NOT_FOUND');
      if (!seller) throw new Error('SELLER_NOT_FOUND');

      const finalPrice = listing.listing_type === 'auction'
        ? Number(listing.buy_now_price || listing.price)
        : Number(listing.price);

      if (buyer.point < finalPrice) {
        throw new Error('INSUFFICIENT_POINT');
      }

      // 수수료 5% 소수점 버림
      const fee = Math.floor(finalPrice * 0.05);
      const settledAmount = finalPrice - fee;

      // 정산
      db.prepare('UPDATE users SET point = point - ? WHERE id = ?').run(finalPrice, buyerId);
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
        price: finalPrice
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
      SELECT ml.*, u.username AS seller_username, bu.username AS buyer_username, cb.username AS current_bidder_username,
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
        LEFT JOIN users cb ON cb.id = ml.current_bidder_id
        JOIN user_cards uc ON uc.id = ml.user_card_id
        JOIN streamers s ON s.channel_id = uc.channel_id
        LEFT JOIN shop_items bi ON uc.border_item_id = bi.id
        LEFT JOIN shop_items ni ON uc.name_effect_item_id = ni.id
       WHERE (ml.seller_id = ? OR ml.buyer_id = ?) AND ml.status IN ('SOLD', 'CANCELLED')
       ORDER BY ml.updated_at DESC
    `).all(userId, userId) as any[];

    return rows.map(r => this.mapRow(r));
  }

  async listAllHistory(limit: number): Promise<MarketListing[]> {
    const rows = this.getDb().prepare(`
      SELECT ml.*, u.username AS seller_username, bu.username AS buyer_username, cb.username AS current_bidder_username,
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
        LEFT JOIN users cb ON cb.id = ml.current_bidder_id
        JOIN user_cards uc ON uc.id = ml.user_card_id
        JOIN streamers s ON s.channel_id = uc.channel_id
        LEFT JOIN shop_items bi ON uc.border_item_id = bi.id
        LEFT JOIN shop_items ni ON uc.name_effect_item_id = ni.id
       WHERE ml.status = 'SOLD'
       ORDER BY ml.updated_at DESC
       LIMIT ?
    `).all(Math.max(1, Math.floor(limit))) as any[];

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

  async placeBid(listingId: number, bidderId: string, amount: number): Promise<{ ok: boolean; reason: string; current_bid?: number; auction_ends_at?: string | null; previous_bidder_id?: string | null }> {
    const db = this.getDb();
    const txn = db.transaction(() => {
      const listing = db.prepare("SELECT * FROM market_listings WHERE id = ? AND status = 'PENDING' AND listing_type = 'auction'").get(listingId) as any;
      if (!listing) throw new Error('NOT_FOUND_OR_NOT_AUCTION');
      if (listing.seller_id === bidderId) throw new Error('CANNOT_BID_OWN_ITEM');
      if (listing.auction_ends_at && new Date(listing.auction_ends_at).getTime() <= Date.now()) throw new Error('AUCTION_ENDED');
      const currentBid = Number(listing.current_bid || listing.starting_bid || 0);
      const minBid = currentBid + 100;
      if (amount < minBid) throw new Error('BID_TOO_LOW');
      const bidder = db.prepare('SELECT point FROM users WHERE id = ?').get(bidderId) as any;
      if (!bidder) throw new Error('BIDDER_NOT_FOUND');
      if (Number(bidder.point || 0) < amount) throw new Error('INSUFFICIENT_POINT');

      db.prepare('INSERT INTO market_bids (listing_id, bidder_id, amount) VALUES (?, ?, ?)').run(listingId, bidderId, amount);

      // 안티-스나이프: 마감까지 1분 미만일 때 입찰이 들어오면 마감을 3분 연장합니다.
      const ANTI_SNIPE_THRESHOLD_MS = 60_000;   // 마감 1분 미만이면
      const ANTI_SNIPE_EXTEND_MS = 3 * 60_000;  // 3분 연장
      const nowMs = Date.now();
      const endsAtMs = listing.auction_ends_at ? new Date(listing.auction_ends_at).getTime() : 0;
      const extendedEndsAt = endsAtMs && endsAtMs - nowMs < ANTI_SNIPE_THRESHOLD_MS
        ? new Date(nowMs + ANTI_SNIPE_EXTEND_MS).toISOString()
        : null;

      if (extendedEndsAt) {
        db.prepare('UPDATE market_listings SET current_bid = ?, current_bidder_id = ?, auction_ends_at = ?, updated_at = datetime(\'now\') WHERE id = ?')
          .run(amount, bidderId, extendedEndsAt, listingId);
      } else {
        db.prepare('UPDATE market_listings SET current_bid = ?, current_bidder_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
          .run(amount, bidderId, listingId);
      }
      return {
        ok: true,
        reason: 'OK',
        current_bid: amount,
        auction_ends_at: extendedEndsAt ?? listing.auction_ends_at,
        previous_bidder_id: listing.current_bidder_id ?? null
      };
    });

    try {
      return txn();
    } catch (err: any) {
      return { ok: false, reason: err.message || 'FAILED' };
    }
  }

  async finishExpiredAuctions(nowIso: string): Promise<MarketListing[]> {
    const db = this.getDb();
    const expiredRows = db.prepare(`
      SELECT id FROM market_listings
       WHERE status = 'PENDING'
         AND listing_type = 'auction'
         AND auction_ends_at IS NOT NULL
         AND datetime(auction_ends_at) <= datetime(?)
    `).all(nowIso) as { id: number }[];
    const completed: MarketListing[] = [];

    for (const row of expiredRows) {
      const listing = await this.findById(row.id);
      if (!listing) continue;
      if (!listing.current_bidder_id || !listing.current_bid || listing.current_bid < (listing.starting_bid || 0)) {
        await this.updateStatus(row.id, 'AUCTION_ENDED');
        continue;
      }

      const result = this.getDb().transaction(() => {
        const locked = db.prepare("SELECT * FROM market_listings WHERE id = ? AND status = 'PENDING'").get(row.id) as any;
        if (!locked) return false;
        const buyer = db.prepare('SELECT point FROM users WHERE id = ?').get(locked.current_bidder_id) as any;
        if (!buyer || Number(buyer.point || 0) < Number(locked.current_bid || 0)) {
          db.prepare("UPDATE market_listings SET status = 'AUCTION_ENDED', updated_at = datetime('now') WHERE id = ?").run(row.id);
          return false;
        }
        const price = Number(locked.current_bid || 0);
        const fee = Math.floor(price * 0.05);
        const settledAmount = price - fee;
        db.prepare('UPDATE users SET point = point - ? WHERE id = ?').run(price, locked.current_bidder_id);
        db.prepare('UPDATE users SET point = point + ? WHERE id = ?').run(settledAmount, locked.seller_id);
        db.prepare(`
          UPDATE market_listings
             SET status = 'SOLD', buyer_id = ?, price = ?, fee = ?, settled_amount = ?, updated_at = datetime('now')
           WHERE id = ?
        `).run(locked.current_bidder_id, price, fee, settledAmount, row.id);
        db.prepare('UPDATE user_cards SET user_id = ? WHERE id = ?').run(locked.current_bidder_id, locked.user_card_id);
        return true;
      })();
      if (result) {
        const sold = await this.findById(row.id);
        if (sold) completed.push(sold);
      }
    }
    return completed;
  }

  async upsertWatch(watch: { user_id: string; channel_id: string; star: number | null; max_price: number | null }): Promise<any> {
    const existing = this.getDb().prepare(`
      SELECT id FROM market_watches
       WHERE user_id = ? AND channel_id = ? AND ((star IS NULL AND ? IS NULL) OR star = ?)
       LIMIT 1
    `).get(watch.user_id, watch.channel_id, watch.star, watch.star) as { id: number } | undefined;
    if (existing) {
      this.getDb().prepare('UPDATE market_watches SET max_price = ? WHERE id = ?').run(watch.max_price, existing.id);
      return { id: existing.id, ...watch };
    }
    const result = this.getDb().prepare(`
      INSERT INTO market_watches (user_id, channel_id, star, max_price)
      VALUES (?, ?, ?, ?)
    `).run(watch.user_id, watch.channel_id, watch.star, watch.max_price);
    return { id: Number(result.lastInsertRowid), ...watch };
  }

  async deleteWatch(userId: string, id: number): Promise<boolean> {
    const result = this.getDb().prepare('DELETE FROM market_watches WHERE id = ? AND user_id = ?').run(id, userId);
    return result.changes > 0;
  }

  async listWatches(userId: string): Promise<any[]> {
    const rows = this.getDb().prepare(`
      SELECT mw.*, s.name AS streamer_name, s.logo_url, s.custom_image_url, s.base_value, s.follower_count
        FROM market_watches mw
        JOIN streamers s ON s.channel_id = mw.channel_id
       WHERE mw.user_id = ?
       ORDER BY mw.created_at DESC
    `).all(userId) as any[];
    return rows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      channel_id: row.channel_id,
      star: row.star,
      max_price: row.max_price,
      created_at: row.created_at,
      streamer: {
        channel_id: row.channel_id,
        name: row.streamer_name,
        logo_url: row.logo_url,
        custom_image_url: row.custom_image_url,
        base_value: row.base_value,
        follower_count: row.follower_count
      }
    }));
  }

  async findMatchingWatches(listing: MarketListing): Promise<any[]> {
    const channelId = listing.card?.channel_id;
    if (!channelId) return [];
    const star = listing.card?.star ?? 0;
    const price = listing.listing_type === 'auction'
      ? (listing.buy_now_price ?? listing.current_bid ?? listing.starting_bid ?? listing.price)
      : listing.price;
    return this.getDb().prepare(`
      SELECT * FROM market_watches
       WHERE channel_id = ?
         AND (star IS NULL OR star = ?)
         AND (max_price IS NULL OR max_price >= ?)
         AND user_id <> ?
    `).all(channelId, star, price, listing.seller_id);
  }
}
