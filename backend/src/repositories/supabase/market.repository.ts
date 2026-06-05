import { getSupabaseClient } from "../../services/db";
import { IMarketRepository, MarketListing } from "../interfaces";
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
      fee: row.fee ?? 0,
      settled_amount: row.settled_amount ?? 0,
      with_cosmetics: !!row.with_cosmetics,
      created_at: row.created_at,
      updated_at: row.updated_at,
      seller_username: row.seller?.username || row.seller_username,
      buyer_username: row.buyer?.username || row.buyer_username,
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
          is_active: !!streamer.is_active
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

  async create(listing: { seller_id: string; user_card_id: number; price: number; with_cosmetics?: boolean }): Promise<MarketListing> {
    if (listing.price < 100) {
      throw new Error('MIN_PRICE_LIMIT');
    }
    const { data, error } = await this.getClient()
      .from('market_listings')
      .insert([{
        seller_id: listing.seller_id,
        user_card_id: listing.user_card_id,
        price: listing.price,
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
      .select('*, seller:users!market_listings_seller_id_fkey(username), buyer:users!market_listings_buyer_id_fkey(username)')
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
    sort: 'latest' | 'oldest' | 'price_desc' | 'price_asc';
  }): Promise<{ listings: MarketListing[]; total: number }> {
    const { data: listingsData, error } = await this.getClient()
      .from('market_listings')
      .select('*, seller:users!market_listings_seller_id_fkey(username), buyer:users!market_listings_buyer_id_fkey(username)')
      .eq('status', 'PENDING');

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
      .select('*, seller:users!market_listings_seller_id_fkey(username), buyer:users!market_listings_buyer_id_fkey(username)')
      .eq('seller_id', userId)
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

  async updateStatus(id: number, status: MarketListing['status'], extra?: { buyer_id?: string; fee?: number; settled_amount?: number }): Promise<void> {
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

  async listHistory(userId: string): Promise<MarketListing[]> {
    const { data: listingsData, error } = await this.getClient()
      .from('market_listings')
      .select('*, seller:users!market_listings_seller_id_fkey(username), buyer:users!market_listings_buyer_id_fkey(username)')
      .or(`seller_id.eq.${userId},buyer_id.eq.${userId}`)
      .in('status', ['SOLD', 'CANCELLED'])
      .order('updated_at', { ascending: false });

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
}
