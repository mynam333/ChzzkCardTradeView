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

export class SupabaseSystemConfigRepository implements ISystemConfigRepository {
  private getClient() {
    return getSupabaseClient();
  }

  async get(key: string, defaultValue: string): Promise<string> {
    try {
      const { data, error } = await this.getClient()
        .from('system_configs')
        .select('value')
        .eq('key', key)
        .maybeSingle();

      if (error || !data) return defaultValue;
      return data.value;
    } catch (e) {
      return defaultValue;
    }
  }

  async set(key: string, value: string): Promise<void> {
    const { error } = await this.getClient()
      .from('system_configs')
      .upsert({ key, value }, { onConflict: 'key' });

    if (error) throw error;
  }
}
