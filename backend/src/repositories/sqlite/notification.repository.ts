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

export class SqliteNotificationRepository implements INotificationRepository {
  private getDb() {
    return getSqliteDb();
  }

  async create(n: Pick<AppNotification, 'user_id' | 'title' | 'body' | 'link'>): Promise<AppNotification> {
    const result = this.getDb().prepare(
      'INSERT INTO notifications (user_id, title, body, link) VALUES (?, ?, ?, ?)'
    ).run(n.user_id, n.title, n.body ?? null, n.link ?? null);

    const row = this.getDb().prepare('SELECT * FROM notifications WHERE id = ?').get(result.lastInsertRowid) as any;
    return {
      id: row.id,
      user_id: row.user_id,
      title: row.title,
      body: row.body,
      link: row.link,
      is_read: row.is_read === 1,
      created_at: row.created_at
    };
  }

  async findByUser(userId: string, limit: number): Promise<AppNotification[]> {
    const rows = this.getDb().prepare(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?'
    ).all(userId, limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      title: r.title,
      body: r.body,
      link: r.link,
      is_read: r.is_read === 1,
      created_at: r.created_at
    }));
  }

  async countUnread(userId: string): Promise<number> {
    const row = this.getDb().prepare(
      'SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0'
    ).get(userId) as any;
    return row?.c || 0;
  }

  async markRead(id: number, userId: string): Promise<void> {
    this.getDb().prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(id, userId);
  }

  async markAllRead(userId: string): Promise<void> {
    this.getDb().prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(userId);
  }
}

// 8. SQLite 시스템 설정 레포지토리
