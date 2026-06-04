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

export class SupabaseAnnouncementRepository implements IAnnouncementRepository {
  private getClient() {
    return getSupabaseClient();
  }

  async findAll(): Promise<Announcement[]> {
    const { data, error } = await this.getClient()
      .from('announcements')
      .select('*')
      .order('id', { ascending: false });

    if (error) throw error;
    return (data || []) as Announcement[];
  }

  async findActivePopups(): Promise<Announcement[]> {
    const now = new Date().toISOString();
    const { data, error } = await this.getClient()
      .from('announcements')
      .select('*')
      .eq('is_popup', true)
      .or(`popup_expires_at.is.null,popup_expires_at.gt.${now}`)
      .order('id', { ascending: false });

    if (error) throw error;
    return (data || []) as Announcement[];
  }

  async create(announcement: Announcement): Promise<Announcement> {
    const { data, error } = await this.getClient()
      .from('announcements')
      .insert([announcement])
      .select()
      .single();

    if (error) throw error;
    return data as Announcement;
  }

  async updatePopup(id: number, isPopup: boolean, popupExpiresAt: string | null): Promise<void> {
    const { error } = await this.getClient()
      .from('announcements')
      .update({ is_popup: isPopup, popup_expires_at: popupExpiresAt })
      .eq('id', id);
    if (error) throw error;
  }

  async delete(id: number): Promise<void> {
    const { error } = await this.getClient()
      .from('announcements')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
}

// 6. Supabase 유저 보유 카드 레포지토리
