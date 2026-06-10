import { getMysqlDb } from '../../services/db';
import { IAnnouncementRepository, Announcement } from '../interfaces';

export class MysqlAnnouncementRepository implements IAnnouncementRepository {
  private getDb() {
    return getMysqlDb();
  }

  private mapRow(row: any): Announcement {
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      is_popup: row.is_popup === 1 || row.is_popup === true,
      is_pinned: row.is_pinned === 1 || row.is_pinned === true,
      popup_expires_at: row.popup_expires_at,
      created_at: row.created_at
    };
  }

  async findAll(): Promise<Announcement[]> {
    const rows = await this.getDb().all('SELECT * FROM announcements ORDER BY is_pinned DESC, id DESC');
    return rows.map((row) => this.mapRow(row));
  }

  async findActivePopups(): Promise<Announcement[]> {
    const rows = await this.getDb().all(`
      SELECT * FROM announcements
      WHERE is_popup = 1
        AND (popup_expires_at IS NULL OR popup_expires_at > UTC_TIMESTAMP())
      ORDER BY is_pinned DESC, id DESC
    `);
    return rows.map((row) => this.mapRow(row));
  }

  async create(announcement: Announcement): Promise<Announcement> {
    const result = await this.getDb().run(
      'INSERT INTO announcements (title, content, is_popup, is_pinned, popup_expires_at) VALUES (?, ?, ?, ?, ?)',
      announcement.title,
      announcement.content,
      announcement.is_popup ? 1 : 0,
      announcement.is_pinned ? 1 : 0,
      announcement.popup_expires_at
    );
    announcement.id = Number(result.insertId);
    return announcement;
  }

  async updatePopup(id: number, isPopup: boolean, popupExpiresAt: string | null): Promise<void> {
    await this.getDb().run('UPDATE announcements SET is_popup = ?, popup_expires_at = ? WHERE id = ?', isPopup ? 1 : 0, popupExpiresAt, id);
  }

  async update(id: number, announcement: Partial<Announcement>): Promise<Announcement> {
    const sets: string[] = [];
    const vals: any[] = [];
    if (announcement.title !== undefined) { sets.push('title = ?'); vals.push(announcement.title); }
    if (announcement.content !== undefined) { sets.push('content = ?'); vals.push(announcement.content); }
    if (announcement.is_popup !== undefined) { sets.push('is_popup = ?'); vals.push(announcement.is_popup ? 1 : 0); }
    if (announcement.is_pinned !== undefined) { sets.push('is_pinned = ?'); vals.push(announcement.is_pinned ? 1 : 0); }
    if (announcement.popup_expires_at !== undefined) { sets.push('popup_expires_at = ?'); vals.push(announcement.popup_expires_at); }
    if (sets.length > 0) {
      vals.push(id);
      await this.getDb().run(`UPDATE announcements SET ${sets.join(', ')} WHERE id = ?`, vals);
    }
    const row = await this.getDb().get('SELECT * FROM announcements WHERE id = ?', id);
    if (!row) throw new Error('ANNOUNCEMENT_NOT_FOUND');
    return this.mapRow(row);
  }

  async delete(id: number): Promise<void> {
    await this.getDb().run('DELETE FROM announcements WHERE id = ?', id);
  }
}
