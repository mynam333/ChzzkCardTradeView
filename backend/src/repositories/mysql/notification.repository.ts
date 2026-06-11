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
      group_key: row.group_key ?? null,
      is_read: row.is_read === 1 || row.is_read === true,
      deleted_at: row.deleted_at ?? null,
      created_at: row.created_at
    };
  }

  async create(n: Pick<AppNotification, 'user_id' | 'title' | 'body' | 'link'> & { group_key?: string | null }): Promise<AppNotification> {
    const result = await this.getDb().run(
      'INSERT INTO notifications (user_id, title, body, link, group_key) VALUES (?, ?, ?, ?, ?)',
      n.user_id,
      n.title,
      n.body ?? null,
      n.link ?? null,
      n.group_key ?? null
    );
    const row = await this.getDb().get('SELECT * FROM notifications WHERE id = ?', result.insertId);
    return this.mapRow(row);
  }

  async upsertByGroupKey(n: Pick<AppNotification, 'user_id' | 'title' | 'body' | 'link'> & { group_key: string }): Promise<AppNotification> {
    await this.getDb().run(
      `INSERT INTO notifications (user_id, title, body, link, group_key, is_read, deleted_at, created_at)
       VALUES (?, ?, ?, ?, ?, 0, NULL, UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE
         title = VALUES(title),
         body = VALUES(body),
         link = VALUES(link),
         is_read = 0,
         deleted_at = NULL,
         created_at = UTC_TIMESTAMP()`,
      n.user_id,
      n.title,
      n.body ?? null,
      n.link ?? null,
      n.group_key
    );
    const row = await this.getDb().get(
      'SELECT * FROM notifications WHERE user_id = ? AND group_key = ? LIMIT 1',
      n.user_id,
      n.group_key
    );
    return this.mapRow(row);
  }

  async findByUser(userId: string, limit: number): Promise<AppNotification[]> {
    const rows = await this.getDb().all(
      'SELECT * FROM notifications WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT ?',
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
