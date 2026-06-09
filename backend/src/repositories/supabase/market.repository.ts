import { getSupabaseClient } from "../../services/db";
import { IMarketRepository, MarketListing, MarketWatch } from "../interfaces";
import { formatUploadUrl } from "../../services/imageService";
import { fuzzyMatch } from "../../utils/search";
import { FIXED_MARKET_FEE_RATE, calculateMarketFee } from "../../utils/marketFee";

export class SupabaseMarketRepository implements IMarketRepository {
  private getClient() {
    return getSupabaseClient();
  }

  private mapRow(row: any, card: any): MarketListing {
    const streamer = card?.streamer;
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
      bid_reserved: row.bid_reserved ?? 0,
      fee: row.fee ?? 0,
      fee_rate: row.fee_rate ?? FIXED_MARKET_FEE_RATE,
      settled_amount: row.settled_amount ?? 0,
      with_cosmetics: !!row.with_cosmetics,
      seller_hidden_at: row.seller_hidden_at ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      seller_username: row.seller?.username || row.seller_username,
      buyer_username: row.buyer?.username || row.buyer_username,
      current_bidder_username: row.current_bidder?.username || row.current_bidder_username,
      card: (card && streamer) ? {
        id: card.id,
        user_id: card.user_id,
        channel_id: card.channel_id,
        serial_number: card.serial_number,
        star: card.star ?? 0,
        border_item_id: card.border_item_id ?? null,
        name_effect_item_id: card.name_effect_item_id ?? null,
        border: card.border ? { id: card.border.id, style_json: card.border.style_json } : null,
        name_effect: card.name_effect ? { id: card.name_effect.id, style_json: card.name_effect.style_json, font_url: card.name_effect.font_url, font_family: card.name_effect.font_family } : null,
        acquired_at: card.acquired_at,
        streamer: {
          channel_id: streamer.channel_id,
          name: streamer.name,
          logo_url: streamer.logo_url,
          custom_image_url: formatUploadUrl(streamer.custom_image_url),
          custom_images: [
            formatUploadUrl(streamer.custom_image_url) ?? null,
            formatUploadUrl(streamer.custom_image_url_1) ?? null,
            formatUploadUrl(streamer.custom_image_url_2) ?? null,
            formatUploadUrl(streamer.custom_image_url_3) ?? null,
            formatUploadUrl(streamer.custom_image_url_4) ?? null,
            formatUploadUrl(streamer.custom_image_url_5) ?? null
          ],
          base_value: streamer.base_value,
          follower_count: streamer.follower_count,
          is_image_banned: !!streamer.is_image_banned,
          activity_score: 0,
          is_active: !!streamer.is_active,
          serial_number: streamer.serial_number ?? undefined
        }
      } : undefined
    };
  }

  private async getCardDetail(cardId: number): Promise<any | null> {
    const { data: card, error: cardErr } = await this.getClient()
      .from('user_cards')
      .select(`
        *,
        streamer:streamers(*)
      `)
      .eq('id', cardId)
      .maybeSingle();

    if (cardErr || !card) return null;

    // 코스메틱 로드
    const itemIds = [card.border_item_id, card.name_effect_item_id].filter((v): v is number => !!v);
    let itemMap: Record<number, any> = {};
    if (itemIds.length > 0) {
      const { data: items } = await this.getClient()
        .from('shop_items')
        .select('id, style_json, font_url, font_family')
        .in('id', itemIds);
      for (const it of items || []) itemMap[it.id] = it;
    }

    const b = card.border_item_id ? itemMap[card.border_item_id] : null;
    const n = card.name_effect_item_id ? itemMap[card.name_effect_item_id] : null;
    card.border = b ? { id: b.id, style_json: b.style_json } : null;
    card.name_effect = n ? { id: n.id, style_json: n.style_json, font_url: n.font_url, font_family: n.font_family } : null;

    return card;
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
    const listingType = listing.listing_type || 'fixed';
    const startingBid = Math.floor(Number(listing.starting_bid ?? listing.price));
    const buyNowPrice = listing.buy_now_price == null ? null : Math.floor(Number(listing.buy_now_price));
    const feeRate = Math.max(0, Math.floor(Number(listing.fee_rate ?? FIXED_MARKET_FEE_RATE)));
    if ((listingType === 'auction' ? startingBid : listing.price) < 100) {
      throw new Error('MIN_PRICE_LIMIT');
    }
    const { data, error } = await this.getClient()
      .from('market_listings')
      .insert([{
        seller_id: listing.seller_id,
        user_card_id: listing.user_card_id,
        price: listingType === 'auction' ? (buyNowPrice || startingBid) : listing.price,
        listing_type: listingType,
        buy_now_price: listingType === 'auction' ? buyNowPrice : listing.price,
        starting_bid: listingType === 'auction' ? startingBid : null,
        current_bid: listingType === 'auction' ? startingBid : null,
        auction_ends_at: listingType === 'auction' ? listing.auction_ends_at : null,
        bid_reserved: 0,
        fee_rate: feeRate,
        with_cosmetics: !!listing.with_cosmetics,
        status: 'PENDING'
      }])
      .select()
      .single();

    if (error) throw error;
    
    const created = await this.findById(data.id);
    if (!created) {
      throw new Error('CREATE_FAILED');
    }
    return created;
  }

  async findById(id: number): Promise<MarketListing | null> {
    const { data, error } = await this.getClient()
      .from('market_listings')
      .select('*, seller:users!market_listings_seller_id_fkey(username), buyer:users!market_listings_buyer_id_fkey(username), current_bidder:users!market_listings_current_bidder_id_fkey(username)')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) return null;

    const cardData = await this.getCardDetail(data.user_card_id);
    return this.mapRow(data, cardData);
  }

  async findPendingCardIdsByUser(userId: string): Promise<number[]> {
    const { data, error } = await this.getClient()
      .from('market_listings')
      .select('user_card_id')
      .eq('seller_id', userId)
      .eq('status', 'PENDING');

    if (error || !data) return [];
    return data.map(r => r.user_card_id);
  }

  async listActive(options: {
    page: number;
    limit: number;
    search?: string;
    sort: 'latest' | 'oldest' | 'price_desc' | 'price_asc' | 'ending_soon' | 'bid_desc';
    type?: 'all' | 'fixed' | 'auction';
  }): Promise<{ listings: MarketListing[]; total: number }> {
    let query = this.getClient()
      .from('market_listings')
      .select('*, seller:users!market_listings_seller_id_fkey(username), buyer:users!market_listings_buyer_id_fkey(username), current_bidder:users!market_listings_current_bidder_id_fkey(username)')
      .eq('status', 'PENDING');
    if (options.type && options.type !== 'all') {
      query = query.eq('listing_type', options.type);
    }
    const { data: listingsData, error } = await query;

    if (error || !listingsData) {
      return { listings: [], total: 0 };
    }

    const cardIds = listingsData.map(l => l.user_card_id);
    let cardsMap: Record<number, any> = {};
    if (cardIds.length > 0) {
      const { data: cardsData } = await this.getClient()
        .from('user_cards')
        .select(`
          *,
          streamer:streamers(*)
        `)
        .in('id', cardIds);

      if (cardsData) {
        // 코스메틱 일괄 로드
        const itemIds = Array.from(new Set(
          cardsData.flatMap((c) => [c.border_item_id, c.name_effect_item_id]).filter((v): v is number => !!v)
        ));
        let itemMap: Record<number, any> = {};
        if (itemIds.length > 0) {
          const { data: items } = await this.getClient()
            .from('shop_items')
            .select('id, style_json, font_url, font_family')
            .in('id', itemIds);
          for (const it of items || []) itemMap[it.id] = it;
        }

        cardsData.forEach(c => {
          const b = c.border_item_id ? itemMap[c.border_item_id] : null;
          const n = c.name_effect_item_id ? itemMap[c.name_effect_item_id] : null;
          c.border = b ? { id: b.id, style_json: b.style_json } : null;
          c.name_effect = n ? { id: n.id, style_json: n.style_json, font_url: n.font_url, font_family: n.font_family } : null;
          cardsMap[c.id] = c;
        });
      }
    }

    let listings = listingsData.map(l => this.mapRow(l, cardsMap[l.user_card_id]));

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
        return Number(b.current_bid || b.price || 0) - Number(a.current_bid || a.price || 0);
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
    const { data: listingsData, error } = await this.getClient()
      .from('market_listings')
      .select('*, seller:users!market_listings_seller_id_fkey(username), buyer:users!market_listings_buyer_id_fkey(username), current_bidder:users!market_listings_current_bidder_id_fkey(username)')
      .eq('seller_id', userId)
      .is('seller_hidden_at', null)
      .order('id', { ascending: false });

    if (error || !listingsData) {
      return [];
    }

    const cardIds = listingsData.map(l => l.user_card_id);
    let cardsMap: Record<number, any> = {};
    if (cardIds.length > 0) {
      const { data: cardsData } = await this.getClient()
        .from('user_cards')
        .select(`
          *,
          streamer:streamers(*)
        `)
        .in('id', cardIds);

      if (cardsData) {
        // 코스메틱 일괄 로드
        const itemIds = Array.from(new Set(
          cardsData.flatMap((c) => [c.border_item_id, c.name_effect_item_id]).filter((v): v is number => !!v)
        ));
        let itemMap: Record<number, any> = {};
        if (itemIds.length > 0) {
          const { data: items } = await this.getClient()
            .from('shop_items')
            .select('id, style_json, font_url, font_family')
            .in('id', itemIds);
          for (const it of items || []) itemMap[it.id] = it;
        }

        cardsData.forEach(c => {
          const b = c.border_item_id ? itemMap[c.border_item_id] : null;
          const n = c.name_effect_item_id ? itemMap[c.name_effect_item_id] : null;
          c.border = b ? { id: b.id, style_json: b.style_json } : null;
          c.name_effect = n ? { id: n.id, style_json: n.style_json, font_url: n.font_url, font_family: n.font_family } : null;
          cardsMap[c.id] = c;
        });
      }
    }

    return listingsData.map(l => this.mapRow(l, cardsMap[l.user_card_id]));
  }

  async hideForSeller(id: number, sellerId: string): Promise<boolean> {
    const { data, error } = await this.getClient()
      .from('market_listings')
      .update({ seller_hidden_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('seller_id', sellerId)
      .in('status', ['SOLD', 'CANCELLED', 'AUCTION_ENDED'])
      .is('seller_hidden_at', null)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    return !!data;
  }

  async updateStatus(id: number, status: MarketListing['status'], extra?: { buyer_id?: string; fee?: number; settled_amount?: number }): Promise<void> {
    if (!extra && (status === 'CANCELLED' || status === 'AUCTION_ENDED')) {
      const listing = await this.findById(id);
      const reserved = Number(listing?.bid_reserved || 0);
      if (listing?.status === 'PENDING' && reserved > 0 && listing.current_bidder_id) {
        await this.getClient().rpc('increment_user_point', { p_id: listing.current_bidder_id, p_delta: reserved });
      }
      const { error } = await this.getClient()
        .from('market_listings')
        .update({ status, bid_reserved: 0, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
      return;
    }

    const payload: any = { status, updated_at: new Date().toISOString() };
    if (extra) {
      payload.buyer_id = extra.buyer_id ?? null;
      payload.fee = extra.fee ?? 0;
      payload.settled_amount = extra.settled_amount ?? 0;
    }

    const { error } = await this.getClient()
      .from('market_listings')
      .update(payload)
      .eq('id', id);

    if (error) throw error;
  }

  async buyAtomic(listingId: number, buyerId: string): Promise<{ ok: boolean; reason: string; settled_amount?: number; seller_id?: string; price?: number }> {
    const { data, error } = await this.getClient()
      .rpc('buy_market_item_atomic', { p_listing_id: listingId, p_buyer_id: buyerId });

    if (error) {
      console.error('[SupabaseMarketRepository] buy_market_item_atomic RPC 에러:', error.message);
      return { ok: false, reason: 'RPC_ERROR' };
    }

    const result = String(data);
    if (result !== 'OK') {
      return { ok: false, reason: result };
    }

    const { data: updatedListing } = await this.getClient()
      .from('market_listings')
      .select('settled_amount, seller_id, price')
      .eq('id', listingId)
      .maybeSingle();

    return {
      ok: true,
      reason: 'OK',
      settled_amount: updatedListing?.settled_amount,
      seller_id: updatedListing?.seller_id,
      price: updatedListing?.price
    };
  }

  // 매물 목록에 카드/스트리머/코스메틱 정보를 일괄(배치) 결합합니다. (listHistory/listAllHistory 공용)
  private async attachCardsToListings(listingsData: any[]): Promise<MarketListing[]> {
    if (!listingsData || listingsData.length === 0) return [];

    const cardIds = listingsData.map(l => l.user_card_id);
    let cardsMap: Record<number, any> = {};
    if (cardIds.length > 0) {
      const { data: cardsData } = await this.getClient()
        .from('user_cards')
        .select(`
          *,
          streamer:streamers(*)
        `)
        .in('id', cardIds);

      if (cardsData) {
        // 코스메틱 일괄 로드
        const itemIds = Array.from(new Set(
          cardsData.flatMap((c) => [c.border_item_id, c.name_effect_item_id]).filter((v): v is number => !!v)
        ));
        let itemMap: Record<number, any> = {};
        if (itemIds.length > 0) {
          const { data: items } = await this.getClient()
            .from('shop_items')
            .select('id, style_json, font_url, font_family')
            .in('id', itemIds);
          for (const it of items || []) itemMap[it.id] = it;
        }

        cardsData.forEach(c => {
          const b = c.border_item_id ? itemMap[c.border_item_id] : null;
          const n = c.name_effect_item_id ? itemMap[c.name_effect_item_id] : null;
          c.border = b ? { id: b.id, style_json: b.style_json } : null;
          c.name_effect = n ? { id: n.id, style_json: n.style_json, font_url: n.font_url, font_family: n.font_family } : null;
          cardsMap[c.id] = c;
        });
      }
    }

    return listingsData.map(l => this.mapRow(l, cardsMap[l.user_card_id]));
  }

  async listHistory(userId: string): Promise<MarketListing[]> {
    const { data: listingsData, error } = await this.getClient()
      .from('market_listings')
      .select('*, seller:users!market_listings_seller_id_fkey(username), buyer:users!market_listings_buyer_id_fkey(username), current_bidder:users!market_listings_current_bidder_id_fkey(username)')
      .or(`seller_id.eq.${userId},buyer_id.eq.${userId}`)
      .in('status', ['SOLD', 'CANCELLED', 'AUCTION_ENDED'])
      .order('updated_at', { ascending: false });

    if (error || !listingsData) return [];
    return this.attachCardsToListings(listingsData);
  }

  async listAllHistory(limit: number): Promise<MarketListing[]> {
    const { data: listingsData, error } = await this.getClient()
      .from('market_listings')
      .select('*, seller:users!market_listings_seller_id_fkey(username), buyer:users!market_listings_buyer_id_fkey(username), current_bidder:users!market_listings_current_bidder_id_fkey(username)')
      .eq('status', 'SOLD')
      .order('updated_at', { ascending: false })
      .limit(Math.max(1, Math.floor(limit)));

    if (error || !listingsData) return [];
    return this.attachCardsToListings(listingsData);
  }

  async getRecentPrice(channelId: string): Promise<number | null> {
    const { data, error } = await this.getClient()
      .from('market_listings')
      .select('price, user_cards!inner(channel_id)')
      .eq('status', 'SOLD')
      .eq('user_cards.channel_id', channelId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return (data as any).price;
  }

  async placeBid(listingId: number, bidderId: string, amount: number): Promise<{ ok: boolean; reason: string; current_bid?: number; auction_ends_at?: string | null; previous_bidder_id?: string | null }> {
    const { data: rpcData, error: rpcError } = await this.getClient().rpc('place_market_bid_atomic', {
      p_listing_id: listingId,
      p_bidder_id: bidderId,
      p_amount: amount
    });
    if (!rpcError && rpcData) {
      const result = typeof rpcData === 'string' ? JSON.parse(rpcData) : rpcData;
      return {
        ok: !!result.ok,
        reason: String(result.reason || (result.ok ? 'OK' : 'FAILED')),
        current_bid: result.current_bid == null ? undefined : Number(result.current_bid),
        auction_ends_at: result.auction_ends_at ?? null,
        previous_bidder_id: result.previous_bidder_id ?? null
      };
    }
    if (rpcError) {
      console.warn('[SupabaseMarketRepository] place_market_bid_atomic RPC 실패, 폴백 사용:', rpcError.message);
    }

    const listing = await this.findById(listingId);
    if (!listing || listing.status !== 'PENDING' || listing.listing_type !== 'auction') {
      return { ok: false, reason: 'NOT_FOUND_OR_NOT_AUCTION' };
    }
    if (listing.seller_id === bidderId) return { ok: false, reason: 'CANNOT_BID_OWN_ITEM' };
    if (listing.auction_ends_at && new Date(listing.auction_ends_at).getTime() <= Date.now()) {
      return { ok: false, reason: 'AUCTION_ENDED' };
    }

    const currentBid = Number(listing.current_bid || listing.starting_bid || listing.price || 0);
    if (amount < currentBid + 100) return { ok: false, reason: 'BID_TOO_LOW', current_bid: currentBid };

    const { data: bidder, error: bidderError } = await this.getClient()
      .from('users')
      .select('point')
      .eq('id', bidderId)
      .maybeSingle();
    const currentReserved = Number(listing.bid_reserved || 0);
    const isRaisingOwnBid = listing.current_bidder_id === bidderId && currentReserved > 0;
    const payableNow = isRaisingOwnBid ? amount - currentReserved : amount;
    if (payableNow <= 0) return { ok: false, reason: 'BID_TOO_LOW', current_bid: currentBid };
    if (bidderError || !bidder || Number(bidder.point || 0) < payableNow) {
      return { ok: false, reason: 'INSUFFICIENT_POINT', current_bid: currentBid };
    }

    const { data: deductedBidder, error: deductError } = await this.getClient()
      .from('users')
      .update({ point: Number(bidder.point || 0) - payableNow })
      .eq('id', bidderId)
      .gte('point', payableNow)
      .select('id')
      .maybeSingle();
    if (deductError) throw deductError;
    if (!deductedBidder) return { ok: false, reason: 'INSUFFICIENT_POINT', current_bid: currentBid };

    const nowIso = new Date().toISOString();
    const { error: bidError } = await this.getClient()
      .from('market_bids')
      .insert([{ listing_id: listingId, bidder_id: bidderId, amount, created_at: nowIso }]);
    if (bidError) throw bidError;

    if (!isRaisingOwnBid && currentReserved > 0 && listing.current_bidder_id) {
      await this.getClient().rpc('increment_user_point', { p_id: listing.current_bidder_id, p_delta: currentReserved });
    }

    // 안티-스나이프: 마감까지 1분 미만일 때 입찰이 들어오면 마감을 3분 연장합니다.
    const ANTI_SNIPE_THRESHOLD_MS = 60_000;   // 마감 1분 미만이면
    const ANTI_SNIPE_EXTEND_MS = 3 * 60_000;  // 3분 연장
    const nowMs = Date.now();
    const endsAtMs = listing.auction_ends_at ? new Date(listing.auction_ends_at).getTime() : 0;
    const extendedEndsAt = endsAtMs && endsAtMs - nowMs < ANTI_SNIPE_THRESHOLD_MS
      ? new Date(nowMs + ANTI_SNIPE_EXTEND_MS).toISOString()
      : null;

    const updatePayload: any = { current_bid: amount, current_bidder_id: bidderId, bid_reserved: amount, updated_at: nowIso };
    if (extendedEndsAt) updatePayload.auction_ends_at = extendedEndsAt;
    const { error: updateError } = await this.getClient()
      .from('market_listings')
      .update(updatePayload)
      .eq('id', listingId)
      .eq('status', 'PENDING');
    if (updateError) throw updateError;

    return {
      ok: true,
      reason: 'OK',
      current_bid: amount,
      auction_ends_at: extendedEndsAt ?? listing.auction_ends_at,
      previous_bidder_id: listing.current_bidder_id ?? null
    };
  }

  async finishExpiredAuctions(nowIso: string): Promise<MarketListing[]> {
    const { data: rows, error } = await this.getClient()
      .from('market_listings')
      .select('*, seller:users!market_listings_seller_id_fkey(username), buyer:users!market_listings_buyer_id_fkey(username), current_bidder:users!market_listings_current_bidder_id_fkey(username)')
      .eq('status', 'PENDING')
      .eq('listing_type', 'auction')
      .lte('auction_ends_at', nowIso)
      .limit(50);
    if (error || !rows?.length) return [];

    const settled: MarketListing[] = [];
    for (const row of rows) {
      const amount = Number(row.current_bid || row.starting_bid || row.price || 0);
      const bidderId = row.current_bidder_id as string | null;
      if (!bidderId || amount <= 0) {
        await this.updateStatus(row.id, 'AUCTION_ENDED');
        continue;
      }

      const reserved = Number(row.bid_reserved || 0);
      const { data: bidder } = await this.getClient()
        .from('users')
        .select('point')
        .eq('id', bidderId)
        .maybeSingle();
      if (!bidder || (reserved <= 0 && Number(bidder.point || 0) < amount)) {
        await this.updateStatus(row.id, 'AUCTION_ENDED');
        continue;
      }

      const feeRate = Number(row.fee_rate ?? FIXED_MARKET_FEE_RATE);
      const { fee, settledAmount } = calculateMarketFee(amount, feeRate);
      const client = this.getClient();
      if (reserved <= 0) {
        const { error: buyerError } = await client
          .from('users')
          .update({ point: Number(bidder.point || 0) - amount })
          .eq('id', bidderId)
          .gte('point', amount);
        if (buyerError) throw buyerError;
      }

      await client.rpc('increment_user_point', { p_id: row.seller_id, p_delta: settledAmount });
      await client.from('user_cards').update({ user_id: bidderId }).eq('id', row.user_card_id);
      const { error: listingError } = await client
        .from('market_listings')
        .update({
          status: 'SOLD',
          buyer_id: bidderId,
          price: amount,
          fee,
          bid_reserved: 0,
          settled_amount: settledAmount,
          updated_at: nowIso
        })
        .eq('id', row.id)
        .eq('status', 'PENDING');
      if (listingError) throw listingError;

      const cardData = await this.getCardDetail(row.user_card_id);
      settled.push(this.mapRow({ ...row, status: 'SOLD', buyer_id: bidderId, price: amount, fee, bid_reserved: 0, settled_amount: settledAmount }, cardData));
    }
    return settled;
  }

  async upsertWatch(watch: { user_id: string; channel_id: string; star: number | null; max_price: number | null }): Promise<MarketWatch> {
    const { data: existing } = await this.getClient()
      .from('market_watches')
      .select('*')
      .eq('user_id', watch.user_id)
      .eq('channel_id', watch.channel_id);
    const row = existing?.find((item: any) => (item.star ?? null) === watch.star);

    if (row?.id) {
      const { data, error } = await this.getClient()
        .from('market_watches')
        .update({ max_price: watch.max_price })
        .eq('id', row.id)
        .select('*')
        .single();
      if (error) throw error;
      return data as MarketWatch;
    }

    const { data, error } = await this.getClient()
      .from('market_watches')
      .insert([watch])
      .select('*')
      .single();
    if (error) throw error;
    return data as MarketWatch;
  }

  async deleteWatch(userId: string, id: number): Promise<boolean> {
    const { count, error } = await this.getClient()
      .from('market_watches')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
    return (count || 0) > 0;
  }

  async listWatches(userId: string): Promise<MarketWatch[]> {
    const { data, error } = await this.getClient()
      .from('market_watches')
      .select('*, streamer:streamers(*)')
      .eq('user_id', userId)
      .order('id', { ascending: false });
    if (error || !data) return [];
    return data.map((row: any) => ({
      ...row,
      streamer: row.streamer ? {
        ...row.streamer,
        logo_url: formatUploadUrl(row.streamer.logo_url),
        custom_image_url: formatUploadUrl(row.streamer.custom_image_url)
      } : null
    }));
  }

  async findMatchingWatches(listing: MarketListing): Promise<MarketWatch[]> {
    const channelId = listing.card?.channel_id || listing.card?.streamer?.channel_id;
    if (!channelId) return [];
    const star = listing.card?.star ?? 0;
    const price = Number(listing.buy_now_price || listing.current_bid || listing.price || 0);
    const { data, error } = await this.getClient()
      .from('market_watches')
      .select('*, streamer:streamers(*)')
      .eq('channel_id', channelId);
    if (error || !data) return [];
    return data
      .filter((watch: any) => (watch.star === null || watch.star === undefined || Number(watch.star) === star))
      .filter((watch: any) => !watch.max_price || price <= Number(watch.max_price))
      .filter((watch: any) => watch.user_id !== listing.seller_id)
      .map((watch: any) => ({ ...watch, streamer: watch.streamer || null }));
  }
}
