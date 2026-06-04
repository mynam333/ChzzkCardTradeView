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

  async create(n: Pick<AppNotification, 'user_id' | 'title' | 'body' | 'link'>): Promise<void> {
    const { error } = await this.getClient()
      .from('notifications')
      .insert([{ user_id: n.user_id, title: n.title, body: n.body ?? null, link: n.link ?? null }]);
    if (error) throw error;
  }

  async findByUser(userId: string, limit: number): Promise<AppNotification[]> {
    const { data, error } = await this.getClient()
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
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
      .eq('is_read', false);
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

  async markAllRead(userId: string): Promise<void> {
    const { error } = await this.getClient()
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);
    if (error) throw error;
  }
}

// 8. Supabase 시스템 설정 레포지토리
