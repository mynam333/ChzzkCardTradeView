import { getMysqlDb } from '../../services/db';
import { IReportRepository, CardReport } from '../interfaces';

export class MysqlReportRepository implements IReportRepository {
  private getDb() {
    return getMysqlDb();
  }

  private mapRow(row: any): CardReport {
    return {
      id: row.id,
      reporter_id: row.reporter_id,
      channel_id: row.channel_id,
      reported_image_url: row.reported_image_url,
      star: row.star ?? 0,
      reason: row.reason,
      status: row.status as 'pending' | 'resolved' | 'rejected',
      created_at: row.created_at
    };
  }

  async findAll(): Promise<CardReport[]> {
    const rows = await this.getDb().all('SELECT * FROM card_reports ORDER BY id DESC');
    return rows.map((row) => this.mapRow(row));
  }

  async findById(reportId: number): Promise<CardReport | null> {
    const row = await this.getDb().get('SELECT * FROM card_reports WHERE id = ?', reportId);
    return row ? this.mapRow(row) : null;
  }

  async create(report: CardReport): Promise<CardReport> {
    const result = await this.getDb().run(
      'INSERT INTO card_reports (reporter_id, channel_id, reported_image_url, star, reason, status) VALUES (?, ?, ?, ?, ?, ?)',
      report.reporter_id,
      report.channel_id,
      report.reported_image_url,
      report.star ?? 0,
      report.reason,
      report.status
    );
    report.id = Number(result.insertId);
    return report;
  }

  async updateStatus(reportId: number, status: 'resolved' | 'rejected'): Promise<void> {
    await this.getDb().run('UPDATE card_reports SET status = ? WHERE id = ?', status, reportId);
  }

  async countPending(): Promise<number> {
    const row = await this.getDb().get("SELECT COUNT(*) AS c FROM card_reports WHERE status = 'pending'");
    return row?.c || 0;
  }

  async hasPendingReport(reporterId: string, channelId: string, star: number): Promise<boolean> {
    const row = await this.getDb().get(
      "SELECT 1 FROM card_reports WHERE reporter_id = ? AND channel_id = ? AND star = ? AND status = 'pending' LIMIT 1",
      reporterId,
      channelId,
      star
    );
    return !!row;
  }
}
