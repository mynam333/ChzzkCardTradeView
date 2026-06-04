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

export class SqliteReportRepository implements IReportRepository {
  private getDb() {
    return getSqliteDb();
  }

  async findAll(): Promise<CardReport[]> {
    const rows = this.getDb().prepare('SELECT * FROM card_reports ORDER BY id DESC').all();
    return rows.map((row: any) => ({
      id: row.id,
      reporter_id: row.reporter_id,
      channel_id: row.channel_id,
      reported_image_url: row.reported_image_url,
      star: row.star ?? 0,
      reason: row.reason,
      status: row.status as 'pending' | 'resolved' | 'rejected',
      created_at: row.created_at
    }));
  }

  async create(report: CardReport): Promise<CardReport> {
    const result = this.getDb().prepare(
      'INSERT INTO card_reports (reporter_id, channel_id, reported_image_url, star, reason, status) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(report.reporter_id, report.channel_id, report.reported_image_url, report.star ?? 0, report.reason, report.status);

    report.id = Number(result.lastInsertRowid);
    return report;
  }

  async updateStatus(reportId: number, status: 'resolved' | 'rejected'): Promise<void> {
    this.getDb().prepare('UPDATE card_reports SET status = ? WHERE id = ?').run(status, reportId);
  }

  async countPending(): Promise<number> {
    const row = this.getDb().prepare("SELECT COUNT(*) AS c FROM card_reports WHERE status = 'pending'").get() as any;
    return row?.c || 0;
  }

  async hasPendingReport(reporterId: string, channelId: string, star: number): Promise<boolean> {
    const row = this.getDb().prepare(
      "SELECT 1 FROM card_reports WHERE reporter_id = ? AND channel_id = ? AND star = ? AND status = 'pending' LIMIT 1"
    ).get(reporterId, channelId, star);
    return !!row;
  }
}

// 5. SQLite 공지사항 레포지토리
