import { getMysqlDb } from '../../services/db';
import { INotificationRepository, AppNotification } from '../interfaces';

export class MysqlNotificationRepository implements INotificationRepository {
  private getDb() {
    return getMysqlDb();
  }

  private mapRow(row: any): AppNotification {
    return {
      id: row.id,
      user_id: row.user_id,
      title: row.title,
      body: row.body,
      link: row.link,
      is_read: row.is_read === 1 || row.is_read === true,
      deleted_at: row.deleted_at ?? null,
      created_at: row.created_at
    };
  }

  async create(n: Pick<AppNotification, 'user_id' | 'title' | 'body' | 'link'>): Promise<AppNotification> {
    const result = await this.getDb().run(
      'INSERT INTO notifications (user_id, title, body, link) VALUES (?, ?, ?, ?)',
      n.user_id,
      n.title,
      n.body ?? null,
      n.link ?? null
    );
    const row = await this.getDb().get('SELECT * FROM notifications WHERE id = ?', result.insertId);
    return this.mapRow(row);
  }

  async findByUser(userId: string, limit: number): Promise<AppNotification[]> {
    const rows = await this.getDb().all(
      'SELECT * FROM notifications WHERE user_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?',
      userId,
      limit
    );
    return rows.map((row) => this.mapRow(row));
  }

  async countUnread(userId: string): Promise<number> {
    const row = await this.getDb().get(
      'SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0 AND deleted_at IS NULL',
      userId
    );
    return row?.c || 0;
  }

  async markRead(id: number, userId: string): Promise<void> {
    await this.getDb().run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', id, userId);
  }

  async markAllRead(userId: string): Promise<void> {
    await this.getDb().run('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0 AND deleted_at IS NULL', userId);
  }

  async hideRead(id: number, userId: string): Promise<boolean> {
    const result = await this.getDb().run(
      'UPDATE notifications SET deleted_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ? AND is_read = 1 AND deleted_at IS NULL',
      id,
      userId
    );
    return result.changes > 0;
  }
}
