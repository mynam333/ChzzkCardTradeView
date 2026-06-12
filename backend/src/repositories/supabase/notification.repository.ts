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

export class SupabaseNotificationRepository implements INotificationRepository {
  private getClient() {
    return getSupabaseClient();
  }

  async create(n: Pick<AppNotification, 'user_id' | 'title' | 'body' | 'link'> & { group_key?: string | null }): Promise<AppNotification> {
    const { data, error } = await this.getClient()
      .from('notifications')
      .insert([{ user_id: n.user_id, title: n.title, body: n.body ?? null, link: n.link ?? null, group_key: n.group_key ?? null }])
      .select('*')
      .single();
    if (error) throw error;
    return data as AppNotification;
  }

  async upsertByGroupKey(n: Pick<AppNotification, 'user_id' | 'title' | 'body' | 'link'> & { group_key: string }): Promise<AppNotification> {
    const { data: existing, error: findError } = await this.getClient()
      .from('notifications')
      .select('id')
      .eq('user_id', n.user_id)
      .eq('group_key', n.group_key)
      .is('deleted_at', null)
      .maybeSingle();
    if (findError) throw findError;
    if (existing?.id) {
      const { data, error } = await this.getClient()
        .from('notifications')
        .update({ title: n.title, body: n.body ?? null, link: n.link ?? null, is_read: false, created_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select('*')
        .single();
      if (error) throw error;
      return data as AppNotification;
    }
    return this.create(n);
  }

  async findByUser(userId: string, limit: number): Promise<AppNotification[]> {
    const { data, error } = await this.getClient()
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []) as AppNotification[];
  }

  async countUnread(userId: string): Promise<number> {
    const { count, error } = await this.getClient()
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false)
      .is('deleted_at', null);
    if (error) return 0;
    return count || 0;
  }

  async markRead(id: number, userId: string): Promise<void> {
    const { error } = await this.getClient()
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
  }

  async markGroupRead(userId: string, groupKey: string): Promise<void> {
    const { error } = await this.getClient()
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('group_key', groupKey)
      .eq('is_read', false)
      .is('deleted_at', null);
    if (error) throw error;
  }

  async markAllRead(userId: string): Promise<void> {
    const { error } = await this.getClient()
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false)
      .is('deleted_at', null);
    if (error) throw error;
  }

  async hideRead(id: number, userId: string): Promise<boolean> {
    const { data, error } = await this.getClient()
      .from('notifications')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .eq('is_read', true)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    return !!data;
  }
}

// 8. Supabase 시스템 설정 레포지토리
