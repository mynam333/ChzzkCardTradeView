import { getSqliteDb } from "../../services/db";
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

export class SqliteSystemConfigRepository implements ISystemConfigRepository {
  private getDb() {
    return getSqliteDb();
  }

  async get(key: string, defaultValue: string, _options?: { fresh?: boolean }): Promise<string> {
    try {
      const row = this.getDb().prepare('SELECT value FROM system_configs WHERE key = ?').get(key) as any;
      return row ? row.value : defaultValue;
    } catch (e) {
      return defaultValue;
    }
  }

  async set(key: string, value: string): Promise<void> {
    this.getDb().prepare(`
      INSERT INTO system_configs (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }
}
