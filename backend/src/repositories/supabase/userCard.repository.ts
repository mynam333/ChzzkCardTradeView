import { getSupabaseClient } from "../../services/db";
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
import { STAR_IMAGE_COLUMNS } from "./shared";
import { formatUploadUrl } from "../../services/imageService";

export class SupabaseUserCardRepository implements IUserCardRepository {
  private getClient() {
    return getSupabaseClient();
  }

  async create(card: any): Promise<any> {
    const { data, error } = await this.getClient()
      .from('user_cards')
      .insert([card])
      .select()
      .single();

    if (error) throw error;
    return data;
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
    const { data, error } = await this.getClient().rpc('draw_card_atomic', {
      p_user_id: userId,
      p_channel_id: channelId,
      p_draw_cost: drawCost,
      p_now: nowIso,
      p_segment_start: segmentStartIso,
      p_max_free_tickets: Math.max(1, Math.floor(maxFreeTickets || 1)),
      p_interval_hours: Math.max(0, Number(intervalHours || 0))
    });

    if (error) {
      console.error('[SupabaseUserCardRepository] draw_card_atomic RPC 에러:', error.message);
      return { ok: false, reason: 'RPC_ERROR' };
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.ok) return { ok: false, reason: row?.reason || 'FAILED' };
    return {
      ok: true,
      reason: 'OK',
      is_free: !!row.is_free,
      free_draw_source: row.free_draw_source || (row.is_free ? 'reset' : 'point'),
      points_left: Number(row.points_left) || 0,
      free_draw_tickets_left: Number(row.free_draw_tickets_left) || 0,
      bonus_free_draw_tickets_left: Number(row.bonus_free_draw_tickets_left) || 0,
      card: {
        id: Number(row.card_id),
        user_id: userId,
        channel_id: channelId,
        serial_number: Number(row.serial_number),
        star: 0
      }
    };
  }

  async findByUserId(userId: string): Promise<any[]> {
    // Supabase 상에서 user_cards와 streamers를 Inner Join
    const { data, error } = await this.getClient()
      .from('user_cards')
      .select(`
        id,
        user_id,
        channel_id,
        serial_number,
        star,
        border_item_id,
        name_effect_item_id,
        is_hidden,
        is_locked,
        favorite_order,
        favorite_at,
        acquired_at,
        streamer:streamers (
          channel_id,
          name,
          logo_url,
          custom_image_url,
          custom_image_url_1,
          custom_image_url_2,
          custom_image_url_3,
          custom_image_url_4,
          custom_image_url_5,
          base_value,
          follower_count,
          is_active,
          is_image_banned,
          serial_number
        )
      `)
      .eq('user_id', userId)
      .order('favorite_order', { ascending: true, nullsFirst: false })
      .order('id', { ascending: false });

    if (error) throw error;
    const cards = (data || []) as any[];
    // 임베드된 스트리머에 별별 커스텀 이미지 배열 부여 및 업로드 URL 포맷팅 적용
    for (const c of cards) {
      if (c.streamer) {
        c.streamer.custom_image_url = formatUploadUrl(c.streamer.custom_image_url);
        c.streamer.custom_images = STAR_IMAGE_COLUMNS.map((col) => formatUploadUrl(c.streamer[col]) ?? null);
      }
    }

    // 장착된 코스메틱(테두리/이름이펙트) 상세를 한 번에 조회해 매핑
    const itemIds = Array.from(new Set(
      cards.flatMap((c) => [c.border_item_id, c.name_effect_item_id]).filter((v): v is number => !!v)
    ));
    let itemMap: Record<number, any> = {};
    if (itemIds.length > 0) {
      const { data: items } = await this.getClient()
        .from('shop_items')
        .select('id, name, style_json, font_url, font_family')
        .in('id', itemIds);
      for (const it of items || []) itemMap[it.id] = it;
    }
    for (const c of cards) {
      const b = c.border_item_id ? itemMap[c.border_item_id] : null;
      const n = c.name_effect_item_id ? itemMap[c.name_effect_item_id] : null;
      c.border = b ? { id: b.id, name: b.name ?? null, style_json: b.style_json } : null;
      c.name_effect = n ? { id: n.id, name: n.name ?? null, style_json: n.style_json, font_url: n.font_url, font_family: n.font_family } : null;
    }
    return cards;
  }

  async fuse(
    userId: string,
    channelId: string,
    star: number,
    materials: { star: number; count: number }[] = [{ star: 0, count: 1 }],
    _reservedByStar: Record<string, number> = {}
  ): Promise<{ ok: boolean; reason: string; newStar?: number }> {
    if (star >= 5) return { ok: false, reason: 'MAX_STAR' };
    const normalizedMaterials = materials
      .map((m) => ({ star: Math.floor(Number(m.star)), count: Math.floor(Number(m.count)) }))
      .filter((m) => m.star >= 0 && m.star <= 4 && m.count > 0);
    if (normalizedMaterials.length === 0) return { ok: false, reason: 'INVALID_MATERIALS' };
    const gain = normalizedMaterials.reduce((sum, m) => sum + ((m.star + 1) * m.count), 0);
    const newStar = star + gain;
    if (newStar > 5) return { ok: false, reason: 'EXCEEDS_MAX_STAR' };

    const isLegacyFuse = normalizedMaterials.length === 1 && normalizedMaterials[0].star === 0 && normalizedMaterials[0].count === 1;
    if (!isLegacyFuse) {
      const { data, error } = await this.getClient().rpc('fuse_card_atomic_v2', {
        p_user_id: userId,
        p_channel_id: channelId,
        p_star: star,
        p_materials: normalizedMaterials
      });
      if (error) {
        console.error('[SupabaseUserCardRepository] fuse_card_atomic_v2 RPC 에러:', error.message);
        return { ok: false, reason: 'RPC_ERROR' };
      }
      const reason = String(data);
      return { ok: reason === 'OK', reason, newStar: reason === 'OK' ? newStar : undefined };
    }

    const { data, error } = await this.getClient().rpc('fuse_card_atomic', {
      p_user_id: userId,
      p_channel_id: channelId,
      p_star: star
    });
    if (error) {
      console.error('[SupabaseUserCardRepository] fuse_card_atomic RPC 에러:', error.message);
      return { ok: false, reason: 'RPC_ERROR' };
    }
    const reason = String(data);
    return { ok: reason === 'OK', reason, newStar: reason === 'OK' ? newStar : undefined };
  }

  async findLatestSerialNumber(channelId: string): Promise<number> {
    const { data, error } = await this.getClient()
      .from('user_cards')
      .select('serial_number')
      .eq('channel_id', channelId)
      .order('serial_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[SupabaseUserCardRepository] findLatestSerialNumber 에러:', error);
      return 0;
    }
    return data ? (data.serial_number as number) : 0;
  }

  async findAllocatedSerialNumbers(channelId: string): Promise<number[]> {
    const { data, error } = await this.getClient()
      .from('user_cards')
      .select('serial_number')
      .eq('channel_id', channelId)
      .order('serial_number', { ascending: true });

    if (error) {
      console.error('[SupabaseUserCardRepository] findAllocatedSerialNumbers 에러:', error);
      return [];
    }
    return (data || []).map(r => r.serial_number);
  }

  async deleteCards(userId: string, channelId: string, count: number): Promise<number> {
    // 특정 개수만큼만 삭제하기 위해 row를 먼저 조회 후 id로 매칭하여 삭제합니다.
    const { data: rows, error: selectError } = await this.getClient()
      .from('user_cards')
      .select('id')
      .eq('user_id', userId)
      .eq('channel_id', channelId)
      .or('is_locked.is.null,is_locked.eq.false')
      .order('id', { ascending: true })
      .limit(count);

    if (selectError || !rows || rows.length === 0) return 0;

    const ids = rows.map(r => r.id);
    const { error: deleteError, count: deletedCount } = await this.getClient()
      .from('user_cards')
      .delete({ count: 'exact' })
      .in('id', ids);

    if (deleteError) throw deleteError;
    return deletedCount || ids.length;
  }

  async count(): Promise<number> {
    const { count, error } = await this.getClient()
      .from('user_cards')
      .select('*', { count: 'exact', head: true });
    if (error) return 0;
    return count || 0;
  }

  async findByChannel(channelId: string): Promise<{ user_id: string; star: number }[]> {
    const { data, error } = await this.getClient()
      .from('user_cards')
      .select('user_id, star')
      .eq('channel_id', channelId);
    if (error || !data) return [];
    return data.map((r: any) => ({ user_id: r.user_id, star: r.star || 0 }));
  }

  async deleteByChannel(channelId: string): Promise<number> {
    const { error, count } = await this.getClient()
      .from('user_cards')
      .delete({ count: 'exact' })
      .eq('channel_id', channelId);
    if (error) throw error;
    return count || 0;
  }

  async sellCardsAtomic(userId: string, actions: { channelId: string; star: number; count: number; baseValue: number }[]): Promise<number> {
    const payload = actions.map((a) => ({
      channel_id: a.channelId,
      star: a.star,
      count: a.count,
      base_value: a.baseValue
    }));
    const { data, error } = await this.getClient().rpc('sell_cards_atomic', {
      p_user_id: userId,
      p_actions: payload
    });
    if (error) throw error;
    return Number(data) || 0;
  }

  async updateVisibility(userId: string, cardId: number, hidden: boolean): Promise<boolean> {
    const { data, error } = await this.getClient()
      .from('user_cards')
      .update({ is_hidden: hidden })
      .eq('id', cardId)
      .eq('user_id', userId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    return !!data;
  }

  async updateVisibilityByGroup(userId: string, channelId: string, star: number, hidden: boolean): Promise<number> {
    const { data, error } = await this.getClient()
      .from('user_cards')
      .update({ is_hidden: hidden })
      .eq('user_id', userId)
      .eq('channel_id', channelId)
      .eq('star', star)
      .select('id');
    if (error) throw error;
    return data?.length || 0;
  }

  async setFavorite(userId: string, cardId: number, favorite: boolean): Promise<boolean> {
    if (!favorite) {
      const { data, error } = await this.getClient()
        .from('user_cards')
        .update({ favorite_order: null, favorite_at: null })
        .eq('id', cardId)
        .eq('user_id', userId)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      return !!data;
    }

    const { data: existing, error: existingError } = await this.getClient()
      .from('user_cards')
      .select('favorite_order')
      .eq('id', cardId)
      .eq('user_id', userId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return false;
    if (existing.favorite_order !== null && existing.favorite_order !== undefined) return true;

    const { data: maxRows, error: maxError } = await this.getClient()
      .from('user_cards')
      .select('favorite_order')
      .eq('user_id', userId)
      .not('favorite_order', 'is', null)
      .order('favorite_order', { ascending: false })
      .limit(1);
    if (maxError) throw maxError;

    const nextOrder = Number(maxRows?.[0]?.favorite_order || 0) + 1;
    const { data, error } = await this.getClient()
      .from('user_cards')
      .update({ favorite_order: nextOrder, favorite_at: new Date().toISOString() })
      .eq('id', cardId)
      .eq('user_id', userId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    return !!data;
  }

  async setLocked(userId: string, cardId: number, locked: boolean): Promise<boolean> {
    const { data, error } = await this.getClient()
      .from('user_cards')
      .update({ is_locked: locked })
      .eq('id', cardId)
      .eq('user_id', userId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    return !!data;
  }
}

// 7. Supabase 거래(1:1 교환) 레포지토리
