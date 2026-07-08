import { getMysqlDb, getSqlDialect } from '../../services/db';
import { IMarketRepository, MarketListing } from '../interfaces';
import { formatUploadUrl } from '../../services/imageService';
import { fuzzyMatch } from '../../utils/search';
import { FIXED_MARKET_FEE_RATE, calculateMarketFee } from '../../utils/marketFee';
import { recordMysqlPointLedger } from '../../services/pointLedger';
import { recordMysqlAssetEvent } from '../../services/assetEventLog';
import { parseMysqlDateTimeMs, toSqlDateTime } from './dateUtils';

export class MysqlMarketRepository implements IMarketRepository {
  private getDb() {
    return getMysqlDb();
  }

  private async latestBidRows(db: { all: (...args: any[]) => Promise<any[]> }, listingId: number): Promise<any[]> {
    return db.all(
      `SELECT mb.*
         FROM market_bids mb
         JOIN (
           SELECT bidder_id, MAX(id) AS id
             FROM market_bids
            WHERE listing_id = ?
            GROUP BY bidder_id
         ) latest ON latest.id = mb.id
        ORDER BY mb.amount DESC, mb.created_at ASC, mb.id ASC`,
      listingId
    );
  }

  private async refundLatestBids(
    db: { all: (...args: any[]) => Promise<any[]>; run: (...args: any[]) => Promise<any> },
    listingId: number,
    sellerId: string,
    exceptBidderId?: string | null
  ): Promise<void> {
    for (const bid of await this.latestBidRows(db, listingId)) {
      if (exceptBidderId && bid.bidder_id === exceptBidderId) continue;
      const amount = Number(bid.amount || 0);
      if (amount <= 0) continue;
      await db.run('UPDATE users SET point = point + ? WHERE id = ?', amount, bid.bidder_id);
      await recordMysqlPointLedger(db, {
        userId: bid.bidder_id,
        counterpartyUserId: sellerId,
        amount,
        sourceType: 'market_bid_refund',
        sourceId: listingId,
        reason: 'auction_lost_refund',
        description: `경매 #${listingId} 미낙찰 입찰 예약금 환불`,
        metadata: { listing_id: listingId, refunded_bid: amount }
      });
    }
  }

  private async buildAuctionResult(listingId: number, winningPrice: number): Promise<MarketListing['auction_result'] | undefined> {
    const bids = await this.latestBidRows(this.getDb(), listingId);
    if (bids.length === 0) return undefined;
    const bidderIds = Array.from(new Set(bids.map((bid) => String(bid.bidder_id || '')).filter(Boolean)));
    const usernames = new Map<string, string | null>();
    if (bidderIds.length > 0) {
      const placeholders = bidderIds.map(() => '?').join(',');
      const rows = await this.getDb().all(`SELECT id, username FROM users WHERE id IN (${placeholders})`, ...bidderIds);
      for (const row of rows) usernames.set(String(row.id), row.username ?? null);
    }
    const winnerId = String(bids[0]?.bidder_id || '');
    return {
      winning_bid: Number(bids[0]?.amount || 0),
      winning_price: Math.max(0, Number(winningPrice || 0)),
      second_bid: bids[1] ? Number(bids[1].amount || 0) : null,
      bidders: bids.map((bid) => {
        const userId = String(bid.bidder_id || '');
        return {
          user_id: userId,
          username: usernames.get(userId) ?? null,
          amount: Number(bid.amount || 0),
          is_winner: userId === winnerId
        };
      })
    };
  }

  private async attachMyBids(listings: MarketListing[], bidderId?: string): Promise<MarketListing[]> {
    if (!bidderId || listings.length === 0) return listings;
    const listingIds = listings.map((listing) => Number(listing.id)).filter(Number.isFinite);
    if (listingIds.length === 0) return listings;
    const placeholders = listingIds.map(() => '?').join(',');
    const rows = await this.getDb().all(
      `SELECT mb.listing_id, mb.amount
         FROM market_bids mb
         JOIN (
           SELECT listing_id, MAX(id) AS id
             FROM market_bids
            WHERE bidder_id = ?
              AND listing_id IN (${placeholders})
            GROUP BY listing_id
         ) latest ON latest.id = mb.id`,
      bidderId,
      ...listingIds
    );
    const bidsByListing = new Map(rows.map((row: any) => [Number(row.listing_id), Number(row.amount || 0)]));
    return listings.map((listing) => {
      const listingId = Number(listing.id);
      return bidsByListing.has(listingId)
        ? { ...listing, my_bid: bidsByListing.get(listingId) ?? null }
        : listing;
    });
  }

  private listingSelectWhere(where: string, options: { includeHistoricalRefs?: boolean } = {}) {
    const includeHistoricalRefs = !!options.includeHistoricalRefs;
    const sellerJoin = includeHistoricalRefs
      ? 'LEFT JOIN users u ON u.id COLLATE utf8mb4_unicode_ci = ml.seller_id COLLATE utf8mb4_unicode_ci'
      : 'JOIN users u ON u.id = ml.seller_id';
    const buyerJoin = includeHistoricalRefs
      ? 'LEFT JOIN users bu ON bu.id COLLATE utf8mb4_unicode_ci = ml.buyer_id COLLATE utf8mb4_unicode_ci'
      : 'LEFT JOIN users bu ON bu.id = ml.buyer_id';
    const currentBidderJoin = includeHistoricalRefs
      ? 'LEFT JOIN users cb ON cb.id COLLATE utf8mb4_unicode_ci = ml.current_bidder_id COLLATE utf8mb4_unicode_ci'
      : 'LEFT JOIN users cb ON cb.id = ml.current_bidder_id';
    const auditJoin = includeHistoricalRefs
      ? "LEFT JOIN market_transaction_audit_logs mat ON mat.listing_id = ml.id AND mat.event_type = 'sold'"
      : '';
    const cardJoin = includeHistoricalRefs ? 'LEFT JOIN user_cards uc ON uc.id = ml.user_card_id' : 'JOIN user_cards uc ON uc.id = ml.user_card_id';
    const channelExpr = includeHistoricalRefs
      ? 'COALESCE(uc.channel_id COLLATE utf8mb4_unicode_ci, mat.channel_id COLLATE utf8mb4_unicode_ci)'
      : 'uc.channel_id';
    const serialExpr = includeHistoricalRefs ? 'COALESCE(uc.serial_number, mat.serial_number)' : 'uc.serial_number';
    const starExpr = includeHistoricalRefs ? 'COALESCE(uc.star, mat.star, 0)' : 'uc.star';
    const streamerJoin = includeHistoricalRefs
      ? `LEFT JOIN streamers s ON s.channel_id COLLATE utf8mb4_unicode_ci = (${channelExpr}) COLLATE utf8mb4_unicode_ci`
      : 'JOIN streamers s ON s.channel_id = uc.channel_id';
    return `
      SELECT ml.*, u.username AS seller_username, bu.username AS buyer_username, cb.username AS current_bidder_username,
             uc.user_id AS card_user_id, ${channelExpr} AS channel_id, ${serialExpr} AS serial_number, ${starExpr} AS star,
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
        ${sellerJoin}
        ${buyerJoin}
        ${currentBidderJoin}
        ${auditJoin}
        ${cardJoin}
        ${streamerJoin}
        LEFT JOIN shop_items bi ON uc.border_item_id = bi.id
        LEFT JOIN shop_items ni ON uc.name_effect_item_id = ni.id
       ${where}
    `;
  }

  private mapRow(row: any): MarketListing {
    return {
      id: row.id,
      seller_id: row.seller_id,
      user_card_id: row.user_card_id,
      price: Number(row.price || 0),
      status: row.status as MarketListing['status'],
      buyer_id: row.buyer_id ?? null,
      listing_type: row.listing_type || 'fixed',
      buy_now_price: row.buy_now_price ?? null,
      starting_bid: row.starting_bid ?? null,
      current_bid: row.current_bid ?? null,
      current_bidder_id: row.current_bidder_id ?? null,
      my_bid: row.my_bid == null ? null : Number(row.my_bid),
      auction_ends_at: row.auction_ends_at ?? null,
      bid_reserved: Number(row.bid_reserved || 0),
      fee: Number(row.fee || 0),
      fee_rate: Number(row.fee_rate ?? FIXED_MARKET_FEE_RATE),
      settled_amount: Number(row.settled_amount || 0),
      with_cosmetics: row.with_cosmetics === 1 || row.with_cosmetics === true,
      seller_hidden_at: row.seller_hidden_at ?? null,
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
          is_image_banned: row.streamer_is_image_banned === 1 || row.streamer_is_image_banned === true,
          activity_score: 0,
          is_active: row.streamer_is_active === 1 || row.streamer_is_active === true,
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
    fee_rate?: number;
  }): Promise<MarketListing> {
    const listingType = listing.listing_type === 'auction' ? 'auction' : 'fixed';
    const buyNowPrice = listingType === 'auction' ? (listing.buy_now_price ?? null) : listing.price;
    const startingBid = listingType === 'auction' ? Math.max(100, Number(listing.starting_bid || listing.price)) : null;
    const price = listingType === 'auction' ? (buyNowPrice || startingBid || listing.price) : listing.price;
    const feeRate = Math.max(0, Math.floor(Number(listing.fee_rate ?? FIXED_MARKET_FEE_RATE)));
    const auctionEndsAt = listingType === 'auction' ? toSqlDateTime(listing.auction_ends_at, getSqlDialect()) : null;
    const now = toSqlDateTime(new Date(), getSqlDialect());
    if (price < 100 || (startingBid != null && startingBid < 100)) throw new Error('MIN_PRICE_LIMIT');
    const insertId = await this.getDb().transaction(async (tx) => {
      const card = await tx.get(
        'SELECT channel_id, serial_number, COALESCE(star, 0) AS star, border_item_id, name_effect_item_id FROM user_cards WHERE id = ? AND user_id = ? AND COALESCE(is_locked, 0) = 0 FOR UPDATE',
        listing.user_card_id,
        listing.seller_id
      );
      if (!card) throw new Error('CARD_LOCKED_OR_NOT_FOUND');

      if (!listing.with_cosmetics) {
        if (card?.border_item_id) {
          await tx.run(
            'INSERT INTO user_cosmetics (user_id, item_id, quantity) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE quantity = quantity + 1',
            listing.seller_id,
            card.border_item_id
          );
          await recordMysqlAssetEvent(tx, {
            userId: listing.seller_id,
            assetType: 'cosmetic',
            action: 'unequip',
            quantity: 1,
            sourceType: 'market_listing',
            sourceId: listing.user_card_id,
            reason: 'market_listing_cosmetic_return',
            description: '오픈마켓 등록으로 장착 코스메틱 반환',
            cardId: listing.user_card_id,
            channelId: card.channel_id,
            itemId: Number(card.border_item_id),
            itemType: 'border'
          });
        }
        if (card?.name_effect_item_id) {
          await tx.run(
            'INSERT INTO user_cosmetics (user_id, item_id, quantity) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE quantity = quantity + 1',
            listing.seller_id,
            card.name_effect_item_id
          );
          await recordMysqlAssetEvent(tx, {
            userId: listing.seller_id,
            assetType: 'cosmetic',
            action: 'unequip',
            quantity: 1,
            sourceType: 'market_listing',
            sourceId: listing.user_card_id,
            reason: 'market_listing_cosmetic_return',
            description: '오픈마켓 등록으로 장착 코스메틱 반환',
            cardId: listing.user_card_id,
            channelId: card.channel_id,
            itemId: Number(card.name_effect_item_id),
            itemType: 'name_effect'
          });
        }
        await tx.run(
          'UPDATE user_cards SET border_item_id = NULL, name_effect_item_id = NULL WHERE id = ? AND user_id = ?',
          listing.user_card_id,
          listing.seller_id
        );
      }

      const result = await tx.run(`
        INSERT INTO market_listings
          (seller_id, user_card_id, pending_user_card_id, price, listing_type, buy_now_price, starting_bid, current_bid, auction_ends_at, bid_reserved, fee_rate, with_cosmetics, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'PENDING', ?, ?)
      `, listing.seller_id, listing.user_card_id, listing.user_card_id, price, listingType, buyNowPrice, startingBid, startingBid, auctionEndsAt, feeRate, listing.with_cosmetics ? 1 : 0, now, now);
      return Number(result.insertId);
    });
    const created = await this.findById(insertId);
    if (!created) throw new Error('CREATE_FAILED');
    return created;
  }

  async findById(id: number): Promise<MarketListing | null> {
    const row = await this.getDb().get(this.listingSelectWhere('WHERE ml.id = ?'), id);
    return row ? this.mapRow(row) : null;
  }

  async hasBids(listingId: number): Promise<boolean> {
    const row = await this.getDb().get('SELECT 1 FROM market_bids WHERE listing_id = ? LIMIT 1', listingId);
    return !!row;
  }

  async findPendingCardIdsByUser(userId: string): Promise<number[]> {
    const rows = await this.getDb().all<{ user_card_id: number }>("SELECT user_card_id FROM market_listings WHERE seller_id = ? AND status = 'PENDING'", userId);
    return rows.map((r) => r.user_card_id);
  }

  async listActive(options: {
    page: number;
    limit: number;
    search?: string;
    sort: 'latest' | 'oldest' | 'price_desc' | 'price_asc' | 'ending_soon' | 'bid_desc';
    type?: 'all' | 'fixed' | 'auction' | 'bidding';
    bidderId?: string;
  }): Promise<{ listings: MarketListing[]; total: number }> {
    const isPostgres = getSqlDialect() === 'postgres';
    const auctionEndsAtExpr = isPostgres ? "NULLIF(ml.auction_ends_at::text, '')::timestamptz" : 'ml.auction_ends_at';
    const where: string[] = [
      "ml.status = 'PENDING'",
      `(COALESCE(ml.listing_type, 'fixed') <> 'auction' OR ml.auction_ends_at IS NULL OR ${auctionEndsAtExpr} > ${isPostgres ? 'NOW()' : '?'})`
    ];
    const params: any[] = isPostgres ? [] : [toSqlDateTime(new Date(), 'mysql')];
    const visiblePriceExpr = "CASE WHEN COALESCE(ml.listing_type, 'fixed') = 'auction' THEN COALESCE(ml.starting_bid, ml.price, 0) ELSE ml.price END";
    const createdAtExpr = isPostgres
      ? 'ml.created_at DESC NULLS LAST, ml.id DESC'
      : 'CASE WHEN ml.created_at IS NULL THEN 1 ELSE 0 END ASC, ml.created_at DESC, ml.id DESC';
    const createdAtAscExpr = isPostgres
      ? 'ml.created_at ASC NULLS LAST, ml.id ASC'
      : 'CASE WHEN ml.created_at IS NULL THEN 1 ELSE 0 END ASC, ml.created_at ASC, ml.id ASC';

    if (options.type === 'bidding') {
      if (!options.bidderId) return { listings: [], total: 0 };
      where.push(
        "ml.listing_type = 'auction'",
        'EXISTS (SELECT 1 FROM market_bids mb WHERE mb.listing_id = ml.id AND mb.bidder_id = ?)'
      );
      params.push(options.bidderId);
    } else if (options.type && options.type !== 'all') {
      where.push("COALESCE(ml.listing_type, 'fixed') = ?");
      params.push(options.type);
    }

    const orderBy = (() => {
      if (options.sort === 'oldest') return createdAtAscExpr;
      if (options.sort === 'price_desc') return `${visiblePriceExpr} DESC, ml.id DESC`;
      if (options.sort === 'price_asc') return `${visiblePriceExpr} ASC, ml.id ASC`;
      if (options.sort === 'ending_soon') return "CASE WHEN ml.auction_ends_at IS NULL THEN 1 ELSE 0 END ASC, ml.auction_ends_at ASC, ml.id ASC";
      if (options.sort === 'bid_desc') return `${visiblePriceExpr} DESC, ml.id DESC`;
      return createdAtExpr;
    })();

    const whereSql = `WHERE ${where.join(' AND ')}`;
    const search = options.search?.trim();
    if (search) {
      if (getSqlDialect() === 'postgres') {
        const searchLike = `%${search}%`;
        const searchWhereSql = `${whereSql} AND (s.name ILIKE ? OR u.username ILIKE ?)`;
        const searchParams = [...params, searchLike, searchLike];
        const countRow = await this.getDb().get<{ total: number }>(`
          SELECT COUNT(*) AS total
            FROM market_listings ml
            JOIN users u ON u.id = ml.seller_id
            JOIN user_cards uc ON uc.id = ml.user_card_id
            JOIN streamers s ON s.channel_id = uc.channel_id
           ${searchWhereSql}
        `, searchParams);
        const offset = (options.page - 1) * options.limit;
        const rows = await this.getDb().all(
          `${this.listingSelectWhere(searchWhereSql)} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
          ...searchParams,
          options.limit,
          offset
        );
        return { listings: await this.attachMyBids(rows.map((r) => this.mapRow(r)), options.bidderId), total: Number(countRow?.total || 0) };
      }
      const rows = await this.getDb().all<any>(
        `SELECT ml.id, s.name AS streamer_name, u.username AS seller_username
           FROM market_listings ml
           JOIN users u ON u.id = ml.seller_id
           JOIN user_cards uc ON uc.id = ml.user_card_id
           JOIN streamers s ON s.channel_id = uc.channel_id
          ${whereSql}
          ORDER BY ${orderBy}`,
        ...params
      );
      const offset = (options.page - 1) * options.limit;
      const matchedIds = rows
        .filter((row) => fuzzyMatch(row.streamer_name || '', search) || fuzzyMatch(row.seller_username || '', search))
        .map((row) => Number(row.id));
      const pageIds = matchedIds.slice(offset, offset + options.limit);
      if (pageIds.length === 0) return { listings: [], total: matchedIds.length };
      const placeholders = pageIds.map(() => '?').join(',');
      const detailRows = await this.getDb().all(
        `${this.listingSelectWhere(`WHERE ml.id IN (${placeholders})`)}`,
        ...pageIds
      );
      const byId = new Map(detailRows.map((row: any) => [Number(row.id), this.mapRow(row)]));
      return { listings: await this.attachMyBids(pageIds.map((id) => byId.get(id)).filter(Boolean) as MarketListing[], options.bidderId), total: matchedIds.length };
    }

    const countRow = await this.getDb().get<{ total: number }>(`
      SELECT COUNT(*) AS total
        FROM market_listings ml
       ${whereSql}
    `, params);
    const offset = (options.page - 1) * options.limit;
    const rows = await this.getDb().all(
      `${this.listingSelectWhere(whereSql)} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      ...params,
      options.limit,
      offset
    );
    return { listings: await this.attachMyBids(rows.map((r) => this.mapRow(r)), options.bidderId), total: Number(countRow?.total || 0) };
  }

  async listByUser(userId: string): Promise<MarketListing[]> {
    const rows = await this.getDb().all(
      `${this.listingSelectWhere('WHERE ml.seller_id = ? AND ml.seller_hidden_at IS NULL')} ORDER BY ml.id DESC`,
      userId
    );
    return rows.map((r) => this.mapRow(r));
  }

  async hideForSeller(id: number, sellerId: string): Promise<boolean> {
    const result = await this.getDb().run(`
      UPDATE market_listings
         SET seller_hidden_at = UTC_TIMESTAMP(),
             updated_at = updated_at
       WHERE id = ? AND seller_id = ? AND status IN ('SOLD', 'CANCELLED', 'AUCTION_ENDED') AND seller_hidden_at IS NULL
    `, id, sellerId);
    return result.changes > 0;
  }

  async updateStatus(id: number, status: MarketListing['status'], extra?: { buyer_id?: string; fee?: number; settled_amount?: number }): Promise<void> {
    if (!extra && (status === 'CANCELLED' || status === 'AUCTION_ENDED')) {
      await this.getDb().transaction(async (tx) => {
        const listing = await tx.get("SELECT * FROM market_listings WHERE id = ? AND status = 'PENDING' FOR UPDATE", id);
        if (listing) {
          await this.refundLatestBids(tx, id, listing.seller_id);
          await this.refundReservedBid(tx, listing);
          await tx.run('UPDATE market_listings SET status = ?, pending_user_card_id = NULL, current_bidder_id = NULL, bid_reserved = 0, updated_at = UTC_TIMESTAMP() WHERE id = ?', status, id);
        }
      });
      return;
    }
    if (extra) {
      await this.getDb().run(
        'UPDATE market_listings SET status = ?, pending_user_card_id = NULL, buyer_id = ?, fee = ?, settled_amount = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?',
        status, extra.buyer_id ?? null, extra.fee ?? 0, extra.settled_amount ?? 0, id
      );
      if (status === 'SOLD') {
        await this.recordTransactionAudit(this.getDb(), id, 'sold');
      }
      return;
    }
    await this.getDb().run(
      "UPDATE market_listings SET status = ?, pending_user_card_id = CASE WHEN ? = 'PENDING' THEN user_card_id ELSE NULL END, updated_at = UTC_TIMESTAMP() WHERE id = ?",
      status, status, id
    );
  }

  private async refundReservedBid(db: { run: (...args: any[]) => Promise<any> }, listing: any) {
    const lookupDb = db as { all?: (...args: any[]) => Promise<any[]> };
    if (listing?.id && lookupDb.all && (await this.latestBidRows(lookupDb as any, Number(listing.id))).length > 0) return;
    const reserved = Number(listing?.bid_reserved || 0);
    if (reserved > 0 && listing?.current_bidder_id) {
      await db.run('UPDATE users SET point = point + ? WHERE id = ?', reserved, listing.current_bidder_id);
      await recordMysqlPointLedger(db, {
        userId: listing.current_bidder_id,
        counterpartyUserId: listing.seller_id || null,
        amount: reserved,
        sourceType: 'market_bid_refund',
        sourceId: listing.id,
        reason: 'auction_cancel_refund',
        description: `경매 #${listing.id} 종료/취소로 예약 입찰금 환불`,
        metadata: { listing_id: listing.id, reserved }
      });
    }
  }

  private async recordTransactionAudit(
    db: { run: (...args: any[]) => Promise<any> },
    listingId: number,
    eventType: 'sold' | 'account_deleted',
    relatedUserId: string | null = null
  ) {
    const auditKey = relatedUserId ? `${eventType}:${listingId}:${relatedUserId}` : `${eventType}:${listingId}`;
    await db.run(`
      INSERT IGNORE INTO market_transaction_audit_logs
        (audit_key, listing_id, event_type, related_user_id, seller_id, buyer_id, current_bidder_id,
         user_card_id, channel_id, serial_number, star, price, status, listing_type, current_bid,
         bid_reserved, fee, settled_amount, listing_created_at, listing_updated_at)
      SELECT
        ?, ml.id, ?, ?, ml.seller_id, ml.buyer_id, ml.current_bidder_id,
        ml.user_card_id, uc.channel_id, uc.serial_number, uc.star, ml.price, ml.status,
        ml.listing_type, ml.current_bid, ml.bid_reserved, ml.fee, ml.settled_amount,
        ml.created_at, ml.updated_at
      FROM market_listings ml
      LEFT JOIN user_cards uc ON uc.id = ml.user_card_id
      WHERE ml.id = ?
    `, auditKey, eventType, relatedUserId, listingId);
  }

  async buyAtomic(listingId: number, buyerId: string): Promise<{ ok: boolean; reason: string; settled_amount?: number; seller_id?: string; price?: number }> {
    try {
      return await this.getDb().transaction(async (tx) => {
        const listing = await tx.get("SELECT * FROM market_listings WHERE id = ? AND status = 'PENDING' FOR UPDATE", listingId);
        if (!listing) throw new Error('NOT_FOUND_OR_NOT_PENDING');
        if (listing.seller_id === buyerId) throw new Error('CANNOT_BUY_OWN_ITEM');
        const buyer = await tx.get('SELECT point FROM users WHERE id = ? FOR UPDATE', buyerId);
        const seller = await tx.get('SELECT point FROM users WHERE id = ? FOR UPDATE', listing.seller_id);
        if (!buyer) throw new Error('BUYER_NOT_FOUND');
        if (!seller) throw new Error('SELLER_NOT_FOUND');
        const finalPrice = listing.listing_type === 'auction' ? Number(listing.buy_now_price || listing.price) : Number(listing.price);
        const payableNow = finalPrice;
        const buyerBid = listing.listing_type === 'auction'
          ? await tx.get('SELECT amount FROM market_bids WHERE listing_id = ? AND bidder_id = ? ORDER BY id DESC LIMIT 1', listingId, buyerId)
          : null;
        const refundableToBuyer = Number(buyerBid?.amount || 0);
        if (Number(buyer.point || 0) + refundableToBuyer < payableNow) throw new Error('INSUFFICIENT_POINT');
        const { fee, settledAmount } = calculateMarketFee(finalPrice, Number(listing.fee_rate ?? FIXED_MARKET_FEE_RATE));

        if (listing.listing_type === 'auction') {
          await this.refundLatestBids(tx, listingId, listing.seller_id);
          await this.refundReservedBid(tx, listing);
        }
        await tx.run('UPDATE users SET point = point - ? WHERE id = ?', payableNow, buyerId);
        await recordMysqlPointLedger(tx, {
          userId: buyerId,
          counterpartyUserId: listing.seller_id,
          amount: -payableNow,
          sourceType: 'market_purchase',
          sourceId: listingId,
          reason: 'market_buy',
          description: `오픈마켓 매물 #${listingId} 구매`,
          metadata: { listing_id: listingId, price: finalPrice, payable_now: payableNow }
        });
        await tx.run('UPDATE users SET point = point + ? WHERE id = ?', settledAmount, listing.seller_id);
        await recordMysqlPointLedger(tx, {
          userId: listing.seller_id,
          counterpartyUserId: buyerId,
          amount: settledAmount,
          sourceType: 'market_sale',
          sourceId: listingId,
          reason: 'market_sale_settlement',
          description: `오픈마켓 매물 #${listingId} 판매 정산`,
          metadata: { listing_id: listingId, price: finalPrice, fee, settled_amount: settledAmount }
        });
        await tx.run("UPDATE market_listings SET status = 'SOLD', pending_user_card_id = NULL, buyer_id = ?, current_bidder_id = NULL, fee = ?, bid_reserved = 0, settled_amount = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?", buyerId, fee, settledAmount, listingId);
        await this.recordTransactionAudit(tx, listingId, 'sold');

        const movingCard = await tx.get(
          'SELECT channel_id, serial_number, COALESCE(star, 0) AS star, border_item_id, name_effect_item_id FROM user_cards WHERE id = ? FOR UPDATE',
          listing.user_card_id
        );
        if (listing.with_cosmetics === 1) {
          await tx.run('UPDATE user_cards SET user_id = ? WHERE id = ?', buyerId, listing.user_card_id);
        } else {
          const card = movingCard;
          if (card?.border_item_id) {
            await tx.run('INSERT INTO user_cosmetics (user_id, item_id, quantity) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE quantity = quantity + 1', listing.seller_id, card.border_item_id);
            await recordMysqlAssetEvent(tx, {
              userId: listing.seller_id,
              assetType: 'cosmetic',
              action: 'unequip',
              quantity: 1,
              sourceType: 'market_purchase',
              sourceId: listingId,
              reason: 'market_sale_cosmetic_return',
              description: `오픈마켓 매물 #${listingId} 코스메틱 제외 반환`,
              cardId: listing.user_card_id,
              channelId: card.channel_id,
              itemId: Number(card.border_item_id),
              itemType: 'border',
              metadata: { listing_id: listingId, buyer_id: buyerId }
            });
          }
          if (card?.name_effect_item_id) {
            await tx.run('INSERT INTO user_cosmetics (user_id, item_id, quantity) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE quantity = quantity + 1', listing.seller_id, card.name_effect_item_id);
            await recordMysqlAssetEvent(tx, {
              userId: listing.seller_id,
              assetType: 'cosmetic',
              action: 'unequip',
              quantity: 1,
              sourceType: 'market_purchase',
              sourceId: listingId,
              reason: 'market_sale_cosmetic_return',
              description: `오픈마켓 매물 #${listingId} 코스메틱 제외 반환`,
              cardId: listing.user_card_id,
              channelId: card.channel_id,
              itemId: Number(card.name_effect_item_id),
              itemType: 'name_effect',
              metadata: { listing_id: listingId, buyer_id: buyerId }
            });
          }
          await tx.run('UPDATE user_cards SET user_id = ?, border_item_id = NULL, name_effect_item_id = NULL WHERE id = ?', buyerId, listing.user_card_id);
        }
        if (movingCard) {
          await recordMysqlAssetEvent(tx, {
            userId: listing.seller_id,
            counterpartyUserId: buyerId,
            fromUserId: listing.seller_id,
            toUserId: buyerId,
            assetType: 'card',
            action: 'move',
            quantity: 1,
            sourceType: 'market_purchase',
            sourceId: listingId,
            reason: 'market_card_move',
            description: `오픈마켓 매물 #${listingId} 카드 이동`,
            cardId: listing.user_card_id,
            channelId: movingCard.channel_id,
            serialNumber: Number(movingCard.serial_number),
            star: Number(movingCard.star || 0),
            metadata: { listing_id: listingId, price: finalPrice, with_cosmetics: listing.with_cosmetics === 1 }
          });
        }
        return { ok: true, reason: 'OK', settled_amount: settledAmount, seller_id: listing.seller_id, price: finalPrice };
      });
    } catch (err: any) {
      return { ok: false, reason: err.message || 'FAILED' };
    }
  }

  async listHistory(userId: string): Promise<MarketListing[]> {
    const rows = await this.getDb().all(
      `${this.listingSelectWhere("WHERE (ml.seller_id = ? OR ml.buyer_id = ?) AND ml.status IN ('SOLD', 'CANCELLED')", { includeHistoricalRefs: true })} ORDER BY ml.updated_at DESC`,
      userId, userId
    );
    const auditOnlyRows = await this.getDb().all(
      `SELECT COALESCE(mat.listing_id, mat.id) AS id,
              mat.seller_id, mat.user_card_id, mat.price, mat.status, mat.buyer_id,
              COALESCE(mat.listing_type, 'fixed') AS listing_type,
              NULL AS buy_now_price, NULL AS starting_bid, mat.current_bid, mat.current_bidder_id,
              NULL AS auction_ends_at, mat.bid_reserved, mat.fee, NULL AS fee_rate,
              mat.settled_amount, 0 AS with_cosmetics, NULL AS seller_hidden_at,
              mat.listing_created_at AS created_at, COALESCE(mat.listing_updated_at, mat.recorded_at) AS updated_at,
              su.username AS seller_username, bu.username AS buyer_username, cb.username AS current_bidder_username,
              NULL AS card_user_id, mat.channel_id, mat.serial_number, COALESCE(mat.star, 0) AS star,
              NULL AS border_item_id, NULL AS name_effect_item_id, NULL AS acquired_at,
              s.name AS streamer_name, s.logo_url AS streamer_logo, s.custom_image_url AS streamer_custom_image,
              s.custom_image_url_1 as sci1, s.custom_image_url_2 as sci2, s.custom_image_url_3 as sci3,
              s.custom_image_url_4 as sci4, s.custom_image_url_5 as sci5,
              s.base_value AS streamer_base_value, s.follower_count AS streamer_follower,
              s.is_active AS streamer_is_active, s.is_image_banned AS streamer_is_image_banned,
              s.serial_number AS streamer_serial,
              NULL AS border_id, NULL AS border_style,
              NULL AS name_id, NULL AS name_style, NULL AS name_font_url, NULL AS name_font_family
         FROM market_transaction_audit_logs mat
         LEFT JOIN market_listings ml ON ml.id = mat.listing_id
         LEFT JOIN users su ON su.id COLLATE utf8mb4_unicode_ci = mat.seller_id COLLATE utf8mb4_unicode_ci
         LEFT JOIN users bu ON bu.id COLLATE utf8mb4_unicode_ci = mat.buyer_id COLLATE utf8mb4_unicode_ci
         LEFT JOIN users cb ON cb.id COLLATE utf8mb4_unicode_ci = mat.current_bidder_id COLLATE utf8mb4_unicode_ci
         LEFT JOIN streamers s ON s.channel_id COLLATE utf8mb4_unicode_ci = mat.channel_id COLLATE utf8mb4_unicode_ci
        WHERE mat.event_type = 'sold'
          AND ml.id IS NULL
          AND (
            mat.seller_id COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci
            OR mat.buyer_id COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci
          )
        ORDER BY COALESCE(mat.listing_updated_at, mat.recorded_at) DESC`,
      userId, userId
    );
    return [...rows, ...auditOnlyRows]
      .map((r) => this.mapRow(r))
      .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
  }

  async listAllHistory(limit: number): Promise<MarketListing[]> {
    const safeLimit = Math.max(1, Math.floor(limit));
    const rows = await this.getDb().all(
      `${this.listingSelectWhere("WHERE ml.status = 'SOLD'", { includeHistoricalRefs: true })} ORDER BY ml.updated_at DESC LIMIT ?`,
      safeLimit
    );
    const auditOnlyRows = await this.getDb().all(
      `SELECT COALESCE(mat.listing_id, mat.id) AS id,
              mat.seller_id, mat.user_card_id, mat.price, mat.status, mat.buyer_id,
              COALESCE(mat.listing_type, 'fixed') AS listing_type,
              NULL AS buy_now_price, NULL AS starting_bid, mat.current_bid, mat.current_bidder_id,
              NULL AS auction_ends_at, mat.bid_reserved, mat.fee, NULL AS fee_rate,
              mat.settled_amount, 0 AS with_cosmetics, NULL AS seller_hidden_at,
              mat.listing_created_at AS created_at, COALESCE(mat.listing_updated_at, mat.recorded_at) AS updated_at,
              su.username AS seller_username, bu.username AS buyer_username, cb.username AS current_bidder_username,
              NULL AS card_user_id, mat.channel_id, mat.serial_number, COALESCE(mat.star, 0) AS star,
              NULL AS border_item_id, NULL AS name_effect_item_id, NULL AS acquired_at,
              s.name AS streamer_name, s.logo_url AS streamer_logo, s.custom_image_url AS streamer_custom_image,
              s.custom_image_url_1 as sci1, s.custom_image_url_2 as sci2, s.custom_image_url_3 as sci3,
              s.custom_image_url_4 as sci4, s.custom_image_url_5 as sci5,
              s.base_value AS streamer_base_value, s.follower_count AS streamer_follower,
              s.is_active AS streamer_is_active, s.is_image_banned AS streamer_is_image_banned,
              s.serial_number AS streamer_serial,
              NULL AS border_id, NULL AS border_style,
              NULL AS name_id, NULL AS name_style, NULL AS name_font_url, NULL AS name_font_family
         FROM market_transaction_audit_logs mat
         LEFT JOIN market_listings ml ON ml.id = mat.listing_id
         LEFT JOIN users su ON su.id COLLATE utf8mb4_unicode_ci = mat.seller_id COLLATE utf8mb4_unicode_ci
         LEFT JOIN users bu ON bu.id COLLATE utf8mb4_unicode_ci = mat.buyer_id COLLATE utf8mb4_unicode_ci
         LEFT JOIN users cb ON cb.id COLLATE utf8mb4_unicode_ci = mat.current_bidder_id COLLATE utf8mb4_unicode_ci
         LEFT JOIN streamers s ON s.channel_id COLLATE utf8mb4_unicode_ci = mat.channel_id COLLATE utf8mb4_unicode_ci
        WHERE mat.event_type = 'sold'
          AND ml.id IS NULL
        ORDER BY COALESCE(mat.listing_updated_at, mat.recorded_at) DESC
        LIMIT ?`,
      safeLimit
    );
    return [...rows, ...auditOnlyRows]
      .map((r) => this.mapRow(r))
      .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime())
      .slice(0, safeLimit);
  }

  async getRecentPrice(channelId: string): Promise<number | null> {
    const row = await this.getDb().get(`
      SELECT ml.price FROM market_listings ml
      JOIN user_cards uc ON uc.id = ml.user_card_id
      WHERE uc.channel_id = ? AND ml.status = 'SOLD'
      ORDER BY ml.updated_at DESC
      LIMIT 1
    `, channelId);
    return row ? Number(row.price) : null;
  }

  async placeBid(listingId: number, bidderId: string, amount: number): Promise<{ ok: boolean; reason: string; auction_ends_at?: string | null }> {
    try {
      return await this.getDb().transaction(async (tx) => {
        const listing = await tx.get("SELECT * FROM market_listings WHERE id = ? AND status = 'PENDING' AND listing_type = 'auction' FOR UPDATE", listingId);
        if (!listing) throw new Error('NOT_FOUND_OR_NOT_AUCTION');
        if (listing.seller_id === bidderId) throw new Error('CANNOT_BID_OWN_ITEM');
        if (listing.auction_ends_at && parseMysqlDateTimeMs(listing.auction_ends_at) <= Date.now()) throw new Error('AUCTION_ENDED');
        const minBid = Number(listing.starting_bid || listing.price || 0);
        if (amount < minBid) throw new Error('BID_TOO_LOW');
        const bidder = await tx.get('SELECT point FROM users WHERE id = ? FOR UPDATE', bidderId);
        if (!bidder) throw new Error('BIDDER_NOT_FOUND');
        const previousBid = await tx.get('SELECT amount FROM market_bids WHERE listing_id = ? AND bidder_id = ? ORDER BY id DESC LIMIT 1', listingId, bidderId);
        const previousAmount = Number(previousBid?.amount || 0);
        const availableAfterRefund = Number(bidder.point || 0) + previousAmount;
        if (availableAfterRefund < amount) throw new Error('INSUFFICIENT_POINT');

        await tx.run('INSERT INTO market_bids (listing_id, bidder_id, amount) VALUES (?, ?, ?)', listingId, bidderId, amount);
        if (previousAmount > 0) {
          await tx.run('UPDATE users SET point = point + ? WHERE id = ?', previousAmount, bidderId);
          await recordMysqlPointLedger(tx, {
            userId: bidderId,
            counterpartyUserId: listing.seller_id,
            amount: previousAmount,
            sourceType: 'market_bid_refund',
            sourceId: listingId,
            reason: 'auction_bid_adjust_refund',
            description: `경매 #${listingId} 이전 입찰 예약금 환불`,
            metadata: { listing_id: listingId, previous_bid: previousAmount, bid_amount: amount, refunded_bid: previousAmount }
          });
        }
        if (amount > 0) {
          await tx.run('UPDATE users SET point = point - ? WHERE id = ?', amount, bidderId);
          await recordMysqlPointLedger(tx, {
            userId: bidderId,
            counterpartyUserId: listing.seller_id,
            amount: -amount,
            sourceType: 'market_bid',
            sourceId: listingId,
            reason: 'auction_bid_reserved',
            description: `경매 #${listingId} 입찰 예약`,
            metadata: { listing_id: listingId, bid_amount: amount, refunded_previous_bid: previousAmount }
          });
        }

        await tx.run('UPDATE market_listings SET updated_at = UTC_TIMESTAMP() WHERE id = ?', listingId);
        return { ok: true, reason: 'OK', auction_ends_at: listing.auction_ends_at ?? null };
      });
    } catch (err: any) {
      return { ok: false, reason: err.message || 'FAILED' };
    }
  }

  async finishExpiredAuctions(nowIso: string): Promise<MarketListing[]> {
    const isPostgres = getSqlDialect() === 'postgres';
    const now = toSqlDateTime(nowIso, 'mysql') ?? toSqlDateTime(new Date(), 'mysql');
    const expiredRows = await this.getDb().all<{ id: number }>(
      `SELECT id
         FROM market_listings
        WHERE status = 'PENDING'
          AND listing_type = 'auction'
          AND ${isPostgres ? "NULLIF(auction_ends_at::text, '') IS NOT NULL" : 'auction_ends_at IS NOT NULL'}
          AND ${isPostgres ? "NULLIF(auction_ends_at::text, '')::timestamptz <= NOW()" : 'auction_ends_at <= ?'}`,
      ...(isPostgres ? [] : [now])
    );
    const completed: MarketListing[] = [];
    const loadCompletedListing = async (id: number, status: MarketListing['status']): Promise<MarketListing | null> => {
      const joined = await this.findById(id).catch(() => null);
      if (joined) return joined;
      const raw = await this.getDb().get('SELECT * FROM market_listings WHERE id = ?', id).catch(() => null);
      if (!raw) return null;
      return {
        id,
        seller_id: raw.seller_id,
        user_card_id: Number(raw.user_card_id || 0),
        price: Number(raw.price || raw.current_bid || raw.starting_bid || 0),
        status,
        buyer_id: raw.buyer_id ?? null,
        listing_type: raw.listing_type || 'auction',
        buy_now_price: raw.buy_now_price ?? null,
        starting_bid: raw.starting_bid ?? null,
        current_bid: raw.current_bid ?? null,
        current_bidder_id: raw.current_bidder_id ?? null,
        auction_ends_at: raw.auction_ends_at ?? null,
        bid_reserved: Number(raw.bid_reserved || 0),
        fee: Number(raw.fee || 0),
        fee_rate: Number(raw.fee_rate ?? FIXED_MARKET_FEE_RATE),
        settled_amount: Number(raw.settled_amount || 0),
        with_cosmetics: raw.with_cosmetics === 1 || raw.with_cosmetics === true,
        seller_hidden_at: raw.seller_hidden_at ?? null,
        created_at: raw.created_at,
        updated_at: raw.updated_at
      };
    };

    for (const row of expiredRows) {
      try {
        const result = await this.getDb().transaction(async (tx) => {
          const locked = await tx.get("SELECT * FROM market_listings WHERE id = ? AND status = 'PENDING' AND listing_type = 'auction' FOR UPDATE", row.id);
          if (!locked) return false;
          const startingBid = Number(locked.starting_bid || 0);
          const bids = await this.latestBidRows(tx, row.id);
          const winningBid = bids[0];
          const winningAmount = Number(winningBid?.amount || 0);
          const secondAmount = Number(bids[1]?.amount || 0);
          const price = Math.max(startingBid, secondAmount);
          const winnerId = winningBid?.bidder_id as string | undefined;
          if (!winnerId || !winningAmount || winningAmount < startingBid) {
            await this.refundLatestBids(tx, row.id, locked.seller_id);
            await this.refundReservedBid(tx, locked);
            await tx.run("UPDATE market_listings SET status = 'AUCTION_ENDED', pending_user_card_id = NULL, bid_reserved = 0, updated_at = UTC_TIMESTAMP() WHERE id = ?", row.id);
            return 'ended';
          }

          const buyer = await tx.get('SELECT id FROM users WHERE id = ? FOR UPDATE', winnerId);
          if (!buyer) {
            await this.refundLatestBids(tx, row.id, locked.seller_id);
            await this.refundReservedBid(tx, locked);
            await tx.run("UPDATE market_listings SET status = 'AUCTION_ENDED', pending_user_card_id = NULL, bid_reserved = 0, updated_at = UTC_TIMESTAMP() WHERE id = ?", row.id);
            return 'ended';
          }

          const { fee, settledAmount } = calculateMarketFee(price, Number(locked.fee_rate ?? FIXED_MARKET_FEE_RATE));
          await this.refundLatestBids(tx, row.id, locked.seller_id, winnerId);
          await this.refundReservedBid(tx, locked);
          const winnerRefund = Math.max(0, winningAmount - price);
          if (winnerRefund > 0) {
            await tx.run('UPDATE users SET point = point + ? WHERE id = ?', winnerRefund, winnerId);
            await recordMysqlPointLedger(tx, {
              userId: winnerId,
              counterpartyUserId: locked.seller_id,
              amount: winnerRefund,
              sourceType: 'market_bid_refund',
              sourceId: row.id,
              reason: 'auction_vickrey_refund',
              description: `경매 #${row.id} 낙찰 차액 환불`,
              metadata: { listing_id: row.id, winning_bid: winningAmount, price, refunded_bid: winnerRefund }
            });
          }
          await tx.run('UPDATE users SET point = point + ? WHERE id = ?', settledAmount, locked.seller_id);
          await recordMysqlPointLedger(tx, {
            userId: locked.seller_id,
            counterpartyUserId: winnerId,
            amount: settledAmount,
            sourceType: 'market_sale',
            sourceId: row.id,
            reason: 'auction_sale_settlement',
            description: `경매 #${row.id} 낙찰 판매 정산`,
            metadata: { listing_id: row.id, price, fee, settled_amount: settledAmount }
          });
          await tx.run("UPDATE market_listings SET status = 'SOLD', pending_user_card_id = NULL, buyer_id = ?, current_bidder_id = ?, current_bid = ?, price = ?, fee = ?, bid_reserved = 0, settled_amount = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?", winnerId, winnerId, price, price, fee, settledAmount, row.id);
          await this.recordTransactionAudit(tx, row.id, 'sold');
          const movingCard = await tx.get(
            'SELECT channel_id, serial_number, COALESCE(star, 0) AS star FROM user_cards WHERE id = ? FOR UPDATE',
            locked.user_card_id
          );
          await tx.run('UPDATE user_cards SET user_id = ? WHERE id = ?', winnerId, locked.user_card_id);
          if (movingCard) {
            await recordMysqlAssetEvent(tx, {
              userId: locked.seller_id,
              counterpartyUserId: winnerId,
              fromUserId: locked.seller_id,
              toUserId: winnerId,
              assetType: 'card',
              action: 'move',
              quantity: 1,
              sourceType: 'market_purchase',
              sourceId: row.id,
              reason: 'auction_card_move',
              description: `경매 #${row.id} 낙찰 카드 이동`,
              cardId: locked.user_card_id,
              channelId: movingCard.channel_id,
              serialNumber: Number(movingCard.serial_number),
              star: Number(movingCard.star || 0),
              metadata: { listing_id: row.id, price }
            });
          }
          return 'sold';
        });
        if (result === 'sold' || result === 'ended') {
          const item = await loadCompletedListing(row.id, result === 'sold' ? 'SOLD' : 'AUCTION_ENDED');
          if (item && (result === 'sold' || result === 'ended')) {
            item.auction_result = await this.buildAuctionResult(row.id, Number(item.price || 0));
          }
          if (item) completed.push(item);
        }
      } catch (err: any) {
        console.warn('[MysqlMarketRepository] 만료 경매 정리 실패, 경매 종료 처리 시도:', row.id, err?.message || err);
        try {
          await this.updateStatus(row.id, 'AUCTION_ENDED');
          const item = await loadCompletedListing(row.id, 'AUCTION_ENDED');
          if (item) completed.push(item);
        } catch (fallbackErr: any) {
          console.warn('[MysqlMarketRepository] 만료 경매 강제 종료 실패:', row.id, fallbackErr?.message || fallbackErr);
        }
      }
    }
    return completed;
  }

  async cancelStaleListings(cutoffIso: string, limit = 200): Promise<MarketListing[]> {
    const isPostgres = getSqlDialect() === 'postgres';
    const cutoff = toSqlDateTime(cutoffIso, getSqlDialect()) ?? toSqlDateTime(new Date(), getSqlDialect());
    const maxRows = Math.max(1, Math.min(500, Math.floor(limit)));
    const cutoffWhere = isPostgres
      ? "WHERE ml.status = 'PENDING' AND COALESCE(ml.listing_type, 'fixed') = 'fixed' AND NULLIF(ml.created_at::text, '')::timestamptz <= ?::timestamptz"
      : "WHERE ml.status = 'PENDING' AND COALESCE(ml.listing_type, 'fixed') = 'fixed' AND ml.created_at <= ?";
    const staleRows = await this.getDb().all<any>(
      `${this.listingSelectWhere(cutoffWhere)}
       ORDER BY ml.created_at ASC, ml.id ASC
       LIMIT ?`,
      cutoff,
      maxRows
    );
    const staleListings = staleRows.map((row) => this.mapRow(row));
    if (staleListings.length === 0) return [];

    const ids = staleListings.map((listing) => Number(listing.id)).filter(Number.isFinite);
    const placeholders = ids.map(() => '?').join(',');
    await this.getDb().run(
      `UPDATE market_listings
          SET status = 'CANCELLED',
              pending_user_card_id = NULL,
              bid_reserved = 0,
              updated_at = UTC_TIMESTAMP()
        WHERE status = 'PENDING'
          AND COALESCE(listing_type, 'fixed') = 'fixed'
          AND id IN (${placeholders})`,
      ...ids
    );
    return staleListings.map((listing) => ({ ...listing, status: 'CANCELLED' as const }));
  }

  async upsertWatch(watch: { user_id: string; channel_id: string; star: number | null; max_price: number | null }): Promise<any> {
    const existing = await this.getDb().get(
      'SELECT id FROM market_watches WHERE user_id = ? AND channel_id = ? AND ((star IS NULL AND ? IS NULL) OR star = ?) LIMIT 1',
      watch.user_id, watch.channel_id, watch.star, watch.star
    );
    if (existing) {
      await this.getDb().run('UPDATE market_watches SET max_price = ? WHERE id = ?', watch.max_price, existing.id);
      return { id: existing.id, ...watch };
    }
    const result = await this.getDb().run('INSERT INTO market_watches (user_id, channel_id, star, max_price) VALUES (?, ?, ?, ?)', watch.user_id, watch.channel_id, watch.star, watch.max_price);
    return { id: Number(result.insertId), ...watch };
  }

  async deleteWatch(userId: string, id: number): Promise<boolean> {
    const result = await this.getDb().run('DELETE FROM market_watches WHERE id = ? AND user_id = ?', id, userId);
    return result.changes > 0;
  }

  async listWatches(userId: string): Promise<any[]> {
    const rows = await this.getDb().all(`
      SELECT mw.*, s.name AS streamer_name, s.logo_url, s.custom_image_url, s.base_value, s.follower_count
        FROM market_watches mw
        JOIN streamers s ON s.channel_id = mw.channel_id
       WHERE mw.user_id = ?
       ORDER BY mw.created_at DESC
    `, userId);
    return rows.map((row: any) => ({
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
    const price = listing.listing_type === 'auction' ? (listing.buy_now_price ?? listing.starting_bid ?? listing.price) : listing.price;
    return this.getDb().all(
      'SELECT * FROM market_watches WHERE channel_id = ? AND (star IS NULL OR star = ?) AND (max_price IS NULL OR max_price >= ?) AND user_id <> ?',
      channelId, star, price, listing.seller_id
    );
  }
}
