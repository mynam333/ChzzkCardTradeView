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

export class SqliteAnnouncementRepository implements IAnnouncementRepository {
  private getDb() {
    return getSqliteDb();
  }

  async findAll(): Promise<Announcement[]> {
    const rows = this.getDb().prepare('SELECT * FROM announcements ORDER BY id DESC').all();
    return rows.map((row: any) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      is_popup: row.is_popup === 1,
      popup_expires_at: row.popup_expires_at,
      created_at: row.created_at
    }));
  }

  async findActivePopups(): Promise<Announcement[]> {
    // 현재 시각 기준으로 유효한 팝업만 추출
    const rows = this.getDb().prepare(`
      SELECT * FROM announcements 
      WHERE is_popup = 1 
        AND (popup_expires_at IS NULL OR datetime(popup_expires_at) > datetime('now')) 
      ORDER BY id DESC
    `).all();

    return rows.map((row: any) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      is_popup: true,
      popup_expires_at: row.popup_expires_at,
      created_at: row.created_at
    }));
  }

  async create(announcement: Announcement): Promise<Announcement> {
    const result = this.getDb().prepare(
      'INSERT INTO announcements (title, content, is_popup, popup_expires_at) VALUES (?, ?, ?, ?)'
    ).run(
      announcement.title, 
      announcement.content, 
      announcement.is_popup ? 1 : 0, 
      announcement.popup_expires_at
    );

    announcement.id = Number(result.lastInsertRowid);
    return announcement;
  }

  async updatePopup(id: number, isPopup: boolean, popupExpiresAt: string | null): Promise<void> {
    this.getDb().prepare('UPDATE announcements SET is_popup = ?, popup_expires_at = ? WHERE id = ?')
      .run(isPopup ? 1 : 0, popupExpiresAt, id);
  }

  async update(id: number, announcement: Partial<Announcement>): Promise<Announcement> {
    const sets: string[] = [];
    const vals: any[] = [];
    if (announcement.title !== undefined) {
      sets.push('title = ?');
      vals.push(announcement.title);
    }
    if (announcement.content !== undefined) {
      sets.push('content = ?');
      vals.push(announcement.content);
    }
    if (announcement.is_popup !== undefined) {
      sets.push('is_popup = ?');
      vals.push(announcement.is_popup ? 1 : 0);
    }
    if (announcement.popup_expires_at !== undefined) {
      sets.push('popup_expires_at = ?');
      vals.push(announcement.popup_expires_at);
    }
    if (sets.length === 0) {
      const row = this.getDb().prepare('SELECT * FROM announcements WHERE id = ?').get(id) as any;
      return {
        id: row.id,
        title: row.title,
        content: row.content,
        is_popup: row.is_popup === 1,
        popup_expires_at: row.popup_expires_at,
        created_at: row.created_at
      };
    }
    vals.push(id);
    this.getDb().prepare(`UPDATE announcements SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    const row = this.getDb().prepare('SELECT * FROM announcements WHERE id = ?').get(id) as any;
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      is_popup: row.is_popup === 1,
      popup_expires_at: row.popup_expires_at,
      created_at: row.created_at
    };
  }

  async delete(id: number): Promise<void> {
    this.getDb().prepare('DELETE FROM announcements WHERE id = ?').run(id);
  }
}

// 6. SQLite 유저 보유 카드 레포지토리
