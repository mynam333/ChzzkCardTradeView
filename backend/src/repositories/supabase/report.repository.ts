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

export class SupabaseReportRepository implements IReportRepository {
  private getClient() {
    return getSupabaseClient();
  }

  async findAll(): Promise<CardReport[]> {
    const { data, error } = await this.getClient()
      .from('card_reports')
      .select('*')
      .order('id', { ascending: false });

    if (error) throw error;
    return (data || []) as CardReport[];
  }

  async findById(reportId: number): Promise<CardReport | null> {
    const { data, error } = await this.getClient()
      .from('card_reports')
      .select('*')
      .eq('id', reportId)
      .maybeSingle();

    if (error) throw error;
    return (data || null) as CardReport | null;
  }

  async create(report: CardReport): Promise<CardReport> {
    const { data, error } = await this.getClient()
      .from('card_reports')
      .insert([report])
      .select()
      .single();

    if (error) throw error;
    return data as CardReport;
  }

  async updateStatus(reportId: number, status: 'resolved' | 'rejected'): Promise<void> {
    const { error } = await this.getClient()
      .from('card_reports')
      .update({ status })
      .eq('id', reportId);

    if (error) throw error;
  }

  async countPending(): Promise<number> {
    const { count, error } = await this.getClient()
      .from('card_reports')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');
    if (error) return 0;
    return count || 0;
  }

  async hasPendingReport(reporterId: string, channelId: string, star: number): Promise<boolean> {
    const { count, error } = await this.getClient()
      .from('card_reports')
      .select('*', { count: 'exact', head: true })
      .eq('reporter_id', reporterId)
      .eq('channel_id', channelId)
      .eq('star', star)
      .eq('status', 'pending');
    if (error) return false;
    return (count || 0) > 0;
  }
}

// 5. Supabase 공지사항 레포지토리
