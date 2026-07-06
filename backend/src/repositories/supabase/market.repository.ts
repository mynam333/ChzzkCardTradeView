import { getSupabaseClient } from "../../services/db";
import { IMarketRepository, MarketListing, MarketWatch } from "../interfaces";
import { formatUploadUrl } from "../../services/imageService";
import { fuzzyMatch } from "../../utils/search";
import { FIXED_MARKET_FEE_RATE, calculateMarketFee } from "../../utils/marketFee";

export class SupabaseMarketRepository implements IMarketRepository {
  private getClient() {
    return getSupabaseClient();
  }

  private async latestBidRows(listingId: number): Promise<any[]> {
    const { data } = await this.getClient()
      .from('market_bids')
      .select('id, listing_id, bidder_id, amount, created_at')
      .eq('listing_id', listingId)
      .order('id', { ascending: false });
    const byBidder = new Map<string, any>();
    for (const bid of data || []) {
      if (!byBidder.has(bid.bidder_id)) byBidder.set(bid.bidder_id, bid);
    }
    return Array.from(byBidder.values()).sort((a, b) => {
      const amountDiff = Number(b.amount || 0) - Number(a.amount || 0);
      if (amountDiff !== 0) return amountDiff;
      const timeDiff = new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
      if (timeDiff !== 0) return timeDiff;
      return Number(a.id || 0) - Number(b.id || 0);
    });
  }

  private async refundLatestBids(listingId: number, exceptBidderId?: string | null): Promise<void> {
    for (const bid of await this.latestBidRows(listingId)) {
      if (exceptBidderId && bid.bidder_id === exceptBidderId) continue;
      const amount = Number(bid.amount || 0);
      if (amount <= 0) continue;
      await this.getClient().rpc('increment_user_point', { p_id: bid.bidder_id, p_delta: amount });
    }
  }

  private async attachMyBids(listings: MarketListing[], bidderId?: string): Promise<MarketListing[]> {
    if (!bidderId || listings.length === 0) return listings;
    const listingIds = listings.map((listing) => Number(listing.id)).filter(Number.isFinite);
    if (listingIds.length === 0) return listings;
    const { data } = await this.getClient()
      .from('market_bids')
      .select('id, listing_id, amount')
      .eq('bidder_id', bidderId)
      .in('listing_id', listingIds)
      .order('id', { ascending: false });
    const bidsByListing = new Map<number, number>();
    for (const bid of data || []) {
      const listingId = Number((bid as any).listing_id);
      if (!bidsByListing.has(listingId)) {
        bidsByListing.set(listingId, Number((bid as any).amount || 0));
      }
    }
    return listings.map((listing) => {
      const listingId = Number(listing.id);
      return bidsByListing.has(listingId)
        ? { ...listing, my_bid: bidsByListing.get(listingId) ?? null }
        : listing;
    });
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
      my_bid: row.my_bid == null ? null : Number(row.my_bid),
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
    const now = new Date().toISOString();
    if ((listingType === 'auction' ? startingBid : listing.price) < 100) {
      throw new Error('MIN_PRICE_LIMIT');
    }
    const { data: card, error: cardError } = await this.getClient()
      .from('user_cards')
      .select('id')
      .eq('id', listing.user_card_id)
      .eq('user_id', listing.seller_id)
      .or('is_locked.is.null,is_locked.eq.false')
      .maybeSingle();
    if (cardError) throw cardError;
    if (!card) throw new Error('CARD_LOCKED_OR_NOT_FOUND');

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
        status: 'PENDING',
        created_at: now,
        updated_at: now
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

  async hasBids(listingId: number): Promise<boolean> {
    const { data, error } = await this.getClient()
      .from('market_bids')
      .select('id')
      .eq('listing_id', listingId)
      .limit(1)
      .maybeSingle();
    return !error && !!data;
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
    type?: 'all' | 'fixed' | 'auction' | 'bidding';
    bidderId?: string;
  }): Promise<{ listings: MarketListing[]; total: number }> {
    let bidListingIds: number[] | null = null;
    if (options.type === 'bidding') {
      if (!options.bidderId) return { listings: [], total: 0 };
      const { data: bidRows, error: bidError } = await this.getClient()
        .from('market_bids')
        .select('listing_id')
        .eq('bidder_id', options.bidderId);
      if (bidError || !bidRows?.length) return { listings: [], total: 0 };
      bidListingIds = Array.from(new Set(bidRows.map((row: any) => Number(row.listing_id)).filter(Number.isFinite)));
      if (bidListingIds.length === 0) return { listings: [], total: 0 };
    }

    let query = this.getClient()
      .from('market_listings')
      .select('*, seller:users!market_listings_seller_id_fkey(username), buyer:users!market_listings_buyer_id_fkey(username), current_bidder:users!market_listings_current_bidder_id_fkey(username)')
      .eq('status', 'PENDING');
    if (options.type === 'bidding') {
      query = query
        .eq('listing_type', 'auction')
        .in('id', bidListingIds as number[]);
    } else if (options.type && options.type !== 'all') {
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

    const now = Date.now();
    let listings = listingsData
      .map(l => this.mapRow(l, cardsMap[l.user_card_id]))
      .filter((item) => {
        if ((item.listing_type || 'fixed') !== 'auction' || !item.auction_ends_at) return true;
        const endTime = new Date(item.auction_ends_at).getTime();
        return !Number.isFinite(endTime) || endTime > now;
      });

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
    const visiblePrice = (listing: MarketListing) => (listing.listing_type === 'auction'
      ? Number(listing.starting_bid ?? listing.price ?? 0)
      : Number(listing.price || 0));
    listings.sort((a, b) => {
      if (options.sort === 'latest') {
        const bTime = new Date(b.created_at || '').getTime();
        const aTime = new Date(a.created_at || '').getTime();
        return (Number.isFinite(bTime) ? bTime : -Infinity) - (Number.isFinite(aTime) ? aTime : -Infinity)
          || Number(b.id || 0) - Number(a.id || 0);
      } else if (options.sort === 'oldest') {
        const aTime = new Date(a.created_at || '').getTime();
        const bTime = new Date(b.created_at || '').getTime();
        return (Number.isFinite(aTime) ? aTime : Infinity) - (Number.isFinite(bTime) ? bTime : Infinity)
          || Number(a.id || 0) - Number(b.id || 0);
      } else if (options.sort === 'price_desc') {
        return visiblePrice(b) - visiblePrice(a);
      } else if (options.sort === 'price_asc') {
        return visiblePrice(a) - visiblePrice(b);
      } else if (options.sort === 'ending_soon') {
        return new Date(a.auction_ends_at || '9999-12-31').getTime() - new Date(b.auction_ends_at || '9999-12-31').getTime();
      } else if (options.sort === 'bid_desc') {
        return visiblePrice(b) - visiblePrice(a);
      }
      return 0;
    });

    const total = listings.length;
    const startIndex = (options.page - 1) * options.limit;
    const paginatedListings = listings.slice(startIndex, startIndex + options.limit);

    return {
      listings: await this.attachMyBids(paginatedListings, options.bidderId),
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
    const { data: current, error: currentError } = await this.getClient()
      .from('market_listings')
      .select('id, updated_at')
      .eq('id', id)
      .eq('seller_id', sellerId)
      .in('status', ['SOLD', 'CANCELLED', 'AUCTION_ENDED'])
      .is('seller_hidden_at', null)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) return false;

    const { data, error } = await this.getClient()
      .from('market_listings')
      .update({ seller_hidden_at: new Date().toISOString(), updated_at: (current as any).updated_at })
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
      if (listing?.status === 'PENDING') {
        await this.refundLatestBids(id);
      }
      if (listing?.status === 'PENDING' && reserved > 0 && listing.current_bidder_id) {
        const hasBidRows = await this.hasBids(id);
        if (!hasBidRows) {
          await this.getClient().rpc('increment_user_point', { p_id: listing.current_bidder_id, p_delta: reserved });
        }
      }
      const { error } = await this.getClient()
        .from('market_listings')
        .update({ status, pending_user_card_id: null, current_bidder_id: null, bid_reserved: 0, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
      return;
    }

    const payload: any = { status, updated_at: new Date().toISOString() };
    if (extra) {
      payload.buyer_id = extra.buyer_id ?? null;
      payload.fee = extra.fee ?? 0;
      payload.settled_amount = extra.settled_amount ?? 0;
      payload.pending_user_card_id = null;
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

    await this.getClient()
      .from('market_listings')
      .update({ pending_user_card_id: null })
      .eq('id', listingId)
      .eq('status', 'SOLD');

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

  async placeBid(listingId: number, bidderId: string, amount: number): Promise<{ ok: boolean; reason: string; auction_ends_at?: string | null }> {
    const { data, error } = await this.getClient().rpc('place_market_bid_atomic', {
      p_listing_id: listingId,
      p_bidder_id: bidderId,
      p_amount: amount
    });
    if (error) {
      console.error('[SupabaseMarketRepository] place_market_bid_atomic RPC 에러:', error.message);
      return { ok: false, reason: 'RPC_ERROR' };
    }
    let result: any = data;
    if (typeof data === 'string') {
      try {
        result = JSON.parse(data);
      } catch {
        result = { ok: false, reason: data || 'FAILED' };
      }
    }
    return {
      ok: !!result?.ok,
      reason: result?.reason || 'FAILED',
      auction_ends_at: result?.auction_ends_at ?? null
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
    const pushEnded = async (row: any) => {
      await this.updateStatus(row.id, 'AUCTION_ENDED');
      const cardData = await this.getCardDetail(row.user_card_id).catch(() => null);
      settled.push(this.mapRow({ ...row, status: 'AUCTION_ENDED', bid_reserved: 0 }, cardData));
    };

    for (const row of rows) {
      try {
        const startingBid = Number(row.starting_bid || 0);
        const bids = await this.latestBidRows(row.id);
        const winningBid = bids[0];
        const amount = Number(winningBid?.amount || 0);
        const bidderId = winningBid?.bidder_id as string | null;
        if (!bidderId || amount <= 0 || amount < startingBid) {
          await pushEnded(row);
          continue;
        }

        const { data: bidder } = await this.getClient()
          .from('users')
          .select('id')
          .eq('id', bidderId)
          .maybeSingle();
        if (!bidder) {
          await pushEnded(row);
          continue;
        }

        const feeRate = Number(row.fee_rate ?? FIXED_MARKET_FEE_RATE);
        const { fee, settledAmount } = calculateMarketFee(amount, feeRate);
        const client = this.getClient();

        await this.refundLatestBids(row.id, bidderId);
        await client.rpc('increment_user_point', { p_id: row.seller_id, p_delta: settledAmount });
        await client.from('user_cards').update({ user_id: bidderId }).eq('id', row.user_card_id);
        const { error: listingError } = await client
          .from('market_listings')
          .update({
            status: 'SOLD',
            pending_user_card_id: null,
            buyer_id: bidderId,
            current_bidder_id: bidderId,
            current_bid: amount,
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
        settled.push(this.mapRow({ ...row, status: 'SOLD', buyer_id: bidderId, current_bidder_id: bidderId, current_bid: amount, price: amount, fee, bid_reserved: 0, settled_amount: settledAmount }, cardData));
      } catch (err: any) {
        console.warn('[SupabaseMarketRepository] 만료 경매 정리 실패, 경매 종료 처리 시도:', row.id, err?.message || err);
        try {
          await pushEnded(row);
        } catch (fallbackErr: any) {
          console.warn('[SupabaseMarketRepository] 만료 경매 강제 종료 실패:', row.id, fallbackErr?.message || fallbackErr);
        }
      }
    }
    return settled;
  }

  async cancelStaleListings(cutoffIso: string, limit = 200): Promise<MarketListing[]> {
    const maxRows = Math.max(1, Math.min(500, Math.floor(limit)));
    const { data: rows, error } = await this.getClient()
      .from('market_listings')
      .select('*, seller:users!market_listings_seller_id_fkey(username), buyer:users!market_listings_buyer_id_fkey(username), current_bidder:users!market_listings_current_bidder_id_fkey(username)')
      .eq('status', 'PENDING')
      .eq('listing_type', 'fixed')
      .lte('created_at', cutoffIso)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(maxRows);
    if (error) throw error;
    if (!rows?.length) return [];

    const ids = rows.map((row: any) => row.id).filter((id: any) => Number.isFinite(Number(id)));
    const { error: updateError } = await this.getClient()
      .from('market_listings')
      .update({
        status: 'CANCELLED',
        pending_user_card_id: null,
        bid_reserved: 0,
        updated_at: new Date().toISOString()
      })
      .in('id', ids)
      .eq('status', 'PENDING');
    if (updateError) throw updateError;

    const cancelled: MarketListing[] = [];
    for (const row of rows) {
      const cardData = await this.getCardDetail(row.user_card_id);
      cancelled.push(this.mapRow({ ...row, status: 'CANCELLED', bid_reserved: 0 }, cardData));
    }
    return cancelled;
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
    const price = Number(listing.listing_type === 'auction'
      ? (listing.buy_now_price ?? listing.starting_bid ?? listing.price ?? 0)
      : (listing.price ?? 0));
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
