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

  private mapRow(row: any): AppNotification {
    return {
      id: row.id,
      user_id: row.user_id,
      title: row.title,
      body: row.body,
      link: row.link,
      group_key: row.group_key ?? null,
      is_read: row.is_read === 1,
      deleted_at: row.deleted_at ?? null,
      created_at: row.created_at
    };
  }

  async create(n: Pick<AppNotification, 'user_id' | 'title' | 'body' | 'link'> & { group_key?: string | null }): Promise<AppNotification> {
    const result = this.getDb().prepare(
      'INSERT INTO notifications (user_id, title, body, link, group_key) VALUES (?, ?, ?, ?, ?)'
    ).run(n.user_id, n.title, n.body ?? null, n.link ?? null, n.group_key ?? null);

    const row = this.getDb().prepare('SELECT * FROM notifications WHERE id = ?').get(result.lastInsertRowid) as any;
    return this.mapRow(row);
  }

  async upsertByGroupKey(n: Pick<AppNotification, 'user_id' | 'title' | 'body' | 'link'> & { group_key: string }): Promise<AppNotification> {
    this.getDb().prepare(
      `INSERT INTO notifications (user_id, title, body, link, group_key, is_read, deleted_at, created_at)
       VALUES (?, ?, ?, ?, ?, 0, NULL, datetime('now'))
       ON CONFLICT(user_id, group_key) DO UPDATE SET
         title = excluded.title,
         body = excluded.body,
         link = excluded.link,
         is_read = 0,
         deleted_at = NULL,
         created_at = datetime('now')`
    ).run(n.user_id, n.title, n.body ?? null, n.link ?? null, n.group_key);
    const row = this.getDb().prepare('SELECT * FROM notifications WHERE user_id = ? AND group_key = ? LIMIT 1').get(n.user_id, n.group_key) as any;
    return this.mapRow(row);
  }

  async findByUser(userId: string, limit: number): Promise<AppNotification[]> {
    const rows = this.getDb().prepare(
      'SELECT * FROM notifications WHERE user_id = ? AND deleted_at IS NULL ORDER BY datetime(created_at) DESC, id DESC LIMIT ?'
    ).all(userId, limit) as any[];
    return rows.map((r) => this.mapRow(r));
  }

  async countUnread(userId: string): Promise<number> {
    const row = this.getDb().prepare(
      'SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0 AND deleted_at IS NULL'
    ).get(userId) as any;
    return row?.c || 0;
  }

  async markRead(id: number, userId: string): Promise<void> {
    this.getDb().prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(id, userId);
  }

  async markGroupRead(userId: string, groupKey: string): Promise<void> {
    this.getDb()
      .prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND group_key = ? AND is_read = 0 AND deleted_at IS NULL')
      .run(userId, groupKey);
  }

  async markAllRead(userId: string): Promise<void> {
    this.getDb().prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0 AND deleted_at IS NULL').run(userId);
  }

  async hideRead(id: number, userId: string): Promise<boolean> {
    const result = this.getDb()
      .prepare("UPDATE notifications SET deleted_at = datetime('now') WHERE id = ? AND user_id = ? AND is_read = 1 AND deleted_at IS NULL")
      .run(id, userId);
    return result.changes > 0;
  }
}

// 8. SQLite 시스템 설정 레포지토리
