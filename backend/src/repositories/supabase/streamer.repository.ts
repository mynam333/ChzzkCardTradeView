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
import { STAR_IMAGE_COLUMNS, withStarImages } from "./shared";

export class SupabaseStreamerRepository implements IStreamerRepository {
  private getClient() {
    return getSupabaseClient();
  }

  async findAll(): Promise<Streamer[]> {
    const { data, error } = await this.getClient()
      .from('streamers')
      .select('*')
      .order('base_value', { ascending: false });

    if (error) throw error;
    return (data || []).map(withStarImages);
  }

  async findById(channelId: string): Promise<Streamer | null> {
    const { data, error } = await this.getClient()
      .from('streamers')
      .select('*')
      .eq('channel_id', channelId)
      .single();

    if (error || !data) return null;
    return withStarImages(data);
  }

  async findByIds(channelIds: string[]): Promise<Streamer[]> {
    if (channelIds.length === 0) return [];
    const { data, error } = await this.getClient().from('streamers').select('*').in('channel_id', channelIds);
    if (error || !data) return [];
    return data.map(withStarImages);
  }

  async save(streamer: Streamer): Promise<void> {
    const { error } = await this.getClient()
      .from('streamers')
      .upsert(streamer);

    if (error) throw error;
  }

  async updateCustomImage(channelId: string, imageUrl: string | null, star: number = 0): Promise<void> {
    const idx = Math.max(0, Math.min(5, Math.floor(star || 0)));
    const col = STAR_IMAGE_COLUMNS[idx];
    const { error } = await this.getClient()
      .from('streamers')
      .update({ [col]: imageUrl, updated_at: new Date().toISOString() })
      .eq('channel_id', channelId);

    if (error) throw error;
  }
  async resetAllCustomImages(channelId: string): Promise<void> {
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const c of STAR_IMAGE_COLUMNS) patch[c] = null;
    const { error } = await this.getClient()
      .from('streamers')
      .update(patch)
      .eq('channel_id', channelId);

    if (error) throw error;
  }
  async delete(channelId: string): Promise<void> {
    // 연관 user_cards/value_history/card_reports 는 FK ON DELETE CASCADE 로 함께 삭제됩니다.
    const { error } = await this.getClient()
      .from('streamers')
      .delete()
      .eq('channel_id', channelId);
    if (error) throw error;
  }
  async updateImageBanStatus(channelId: string, isBanned: boolean): Promise<void> {
    const { error } = await this.getClient()
      .from('streamers')
      .update({ is_image_banned: isBanned, updated_at: new Date().toISOString() })
      .eq('channel_id', channelId);

    if (error) throw error;
  }
  async findStreamerIndex(channelId: string): Promise<number> {
    const { data, error } = await this.getClient()
      .from('streamers')
      .select('channel_id')
      .order('channel_id', { ascending: true });

    if (error || !data) return 1;
    const index = data.findIndex(r => r.channel_id === channelId);
    return index !== -1 ? index + 1 : 1;
  }

  async findMaxSerialNumber(): Promise<number> {
    const { data, error } = await this.getClient()
      .from('streamers')
      .select('serial_number')
      .order('serial_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return 0;
    return (data.serial_number as number) || 0;
  }

  async findAllocatedStreamerSerialNumbers(): Promise<number[]> {
    const { data, error } = await this.getClient()
      .from('streamers')
      .select('serial_number')
      .not('serial_number', 'is', null)
      .order('serial_number', { ascending: true });

    if (error || !data) return [];
    return data.map(r => r.serial_number as number);
  }

  async updateLiveStatus(channelId: string, isActive: boolean, followerCount: number): Promise<void> {
    const { error } = await this.getClient()
      .from('streamers')
      .update({
        is_active: isActive,
        follower_count: followerCount,
        updated_at: new Date().toISOString()
      })
      .eq('channel_id', channelId);

    if (error) throw error;
  }

  async incrementBroadcastCount(channelId: string): Promise<void> {
    const { error } = await this.getClient().rpc('increment_streamer_broadcast', { p_channel_id: channelId });
    if (error) {
      console.warn('[Supabase] increment_streamer_broadcast RPC 실패, 폴백 사용:', error.message);
      const streamer = await this.findById(channelId);
      if (!streamer) return;
      await this.getClient().from('streamers')
        .update({ broadcast_count: (streamer.broadcast_count || 0) + 1, updated_at: new Date().toISOString() })
        .eq('channel_id', channelId);
    }
  }

  async incrementChatCount(channelId: string, count: number = 1): Promise<void> {
    const { error } = await this.getClient().rpc('increment_streamer_chat', { p_channel_id: channelId, p_count: count });
    if (error) {
      console.warn('[Supabase] increment_streamer_chat RPC 실패, 폴백 사용:', error.message);
      const streamer = await this.findById(channelId);
      if (!streamer) return;
      await this.getClient().from('streamers')
        .update({ chat_count: (streamer.chat_count || 0) + count, updated_at: new Date().toISOString() })
        .eq('channel_id', channelId);
    }
  }

  async incrementBroadcastMinutes(channelId: string, minutes: number): Promise<void> {
    if (minutes <= 0) return;
    const { error } = await this.getClient().rpc('increment_streamer_minutes', { p_channel_id: channelId, p_minutes: minutes });
    if (error) {
      const streamer = await this.findById(channelId);
      if (!streamer) return;
      await this.getClient().from('streamers')
        .update({ broadcast_minutes: (streamer.broadcast_minutes || 0) + minutes })
        .eq('channel_id', channelId);
    }
  }

  async getValueHistory(channelId: string, sinceIso: string): Promise<{ value: number; recorded_at: string }[]> {
    const { data, error } = await this.getClient()
      .from('value_history')
      .select('value, recorded_at')
      .eq('channel_id', channelId)
      .gte('recorded_at', sinceIso)
      .order('recorded_at', { ascending: true });
    if (error || !data) return [];
    return data.map((r: any) => ({ value: r.value, recorded_at: r.recorded_at }));
  }

  async count(): Promise<number> {
    const { count, error } = await this.getClient()
      .from('streamers')
      .select('*', { count: 'exact', head: true });
    if (error) return 0;
    return count || 0;
  }

  async updateValueMetrics(channelId: string, prevValue: number, baseValue: number, activityScore: number, multiplier: number): Promise<void> {
    const { error } = await this.getClient()
      .from('streamers')
      .update({
        prev_value: prevValue,
        base_value: baseValue,
        activity_score: activityScore,
        broadcast_multiplier: multiplier,
        updated_at: new Date().toISOString()
      })
      .eq('channel_id', channelId);
    if (error) throw error;
  }

  async decrementChatCount(channelId: string, amount: number): Promise<void> {
    if (amount <= 0) return;
    const { error } = await this.getClient().rpc('decrement_streamer_chat', { p_channel_id: channelId, p_amount: amount });
    if (error) {
      console.warn('[Supabase] decrement_streamer_chat RPC 실패, 폴백 사용:', error.message);
      const streamer = await this.findById(channelId);
      if (!streamer) return;
      const next = Math.max((streamer.chat_count || 0) - amount, 0);
      await this.getClient().from('streamers')
        .update({ chat_count: next, updated_at: new Date().toISOString() })
        .eq('channel_id', channelId);
    }
  }

  async recordValueHistory(channelId: string, value: number): Promise<void> {
    const { error } = await this.getClient()
      .from('value_history')
      .insert([{ channel_id: channelId, value }]);
    if (error) throw error;
    // 오래된 이력 정리 (8일 초과)
    const cutoff = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await this.getClient().from('value_history').delete().eq('channel_id', channelId).lt('recorded_at', cutoff);
  }

  async bulkApplyScheduleResults(results: StreamerScheduleResult[]): Promise<void> {
    if (results.length === 0) return;
    const client = this.getClient();
    // 1차: 서버측 단일 RPC로 일괄 반영 (네트워크 왕복 1회). 미배포 시 폴백.
    const { error } = await client.rpc('bulk_apply_streamer_schedule', { p_updates: results });
    if (!error) return;
    console.warn('[Supabase] bulk_apply_streamer_schedule RPC 실패, 행별 폴백 사용:', error.message);
    // 폴백: 행마다 개별 update (느리지만 정확)
    for (const r of results) {
      const patch: any = {
        prev_value: r.prev_value,
        base_value: r.base_value,
        activity_score: r.activity_score,
        broadcast_multiplier: r.broadcast_multiplier,
        updated_at: new Date().toISOString()
      };
      if (r.polled) {
        patch.is_active = r.is_active;
        patch.follower_count = r.follower_count;
        patch.last_broadcast_at = r.last_broadcast_at ?? null;
        if (r.logo_url) {
          patch.logo_url = r.logo_url;
        }
      }
      await client.from('streamers').update(patch).eq('channel_id', r.channel_id);
      if (r.add_minutes > 0) {
        await client.rpc('increment_streamer_minutes', { p_channel_id: r.channel_id, p_minutes: r.add_minutes })
          .then(({ error: e }) => { if (e) console.warn('[Supabase] minutes 폴백 실패:', e.message); });
      }
      if (r.add_broadcast_count > 0) {
        await client.rpc('increment_streamer_broadcast', { p_channel_id: r.channel_id })
          .then(({ error: e }) => { if (e) console.warn('[Supabase] broadcast 폴백 실패:', e.message); });
      }
      if (r.consumed_chats > 0) {
        await client.rpc('decrement_streamer_chat', { p_channel_id: r.channel_id, p_amount: r.consumed_chats })
          .then(({ error: e }) => { if (e) console.warn('[Supabase] chat 폴백 실패:', e.message); });
      }
    }
  }

  async bulkRecordValueHistory(points: { channel_id: string; value: number }[]): Promise<void> {
    if (points.length === 0) return;
    const { error } = await this.getClient().from('value_history').insert(points);
    if (error) throw error;
  }

  async pruneValueHistory(olderThanDays: number): Promise<void> {
    const days = Math.max(1, Math.floor(olderThanDays));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await this.getClient().from('value_history').delete().lt('recorded_at', cutoff);
    if (error) throw error;
  }

  private async valueAgoMap(hours: number): Promise<Record<string, number>> {
    // 경계 시각 이전에 기록된 이력 중 채널별 가장 최근 값을 선택
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const { data, error } = await this.getClient()
      .from('value_history')
      .select('channel_id, value, recorded_at')
      .lte('recorded_at', cutoff)
      .order('recorded_at', { ascending: false });
    if (error || !data) return {};

    const map: Record<string, number> = {};
    for (const row of data as any[]) {
      // 내림차순 정렬이므로 채널별 최초 등장이 경계에 가장 근접한 값
      if (map[row.channel_id] === undefined) {
        map[row.channel_id] = row.value;
      }
    }
    return map;
  }

  async getValue24hAgoMap(): Promise<Record<string, number>> {
    return this.valueAgoMap(24);
  }

  async getValue1hAgoMap(): Promise<Record<string, number>> {
    return this.valueAgoMap(1);
  }
}
// 3. Supabase 쿠폰 레포지토리
