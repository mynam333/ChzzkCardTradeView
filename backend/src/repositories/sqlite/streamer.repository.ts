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
  StreamerLiveStatus,
  StreamerScheduleResult,
  Coupon,
  CardReport,
  Announcement,
  Trade,
  AppNotification
} from '../interfaces';
import { STAR_IMAGE_COLUMNS, extractStarImages } from "./shared";
import { formatUploadUrl } from "../../services/imageService";

export class SqliteStreamerRepository implements IStreamerRepository {
  private static readonly VALUE_AGO_CACHE_TTL_MS = Math.max(
    5_000,
    Number(process.env.VALUE_AGO_CACHE_TTL_MS || 60_000)
  );
  private static readonly VALUE_AGO_LOOKBACK_HOURS = Math.max(
    1,
    Number(process.env.VALUE_AGO_LOOKBACK_HOURS || 3)
  );
  private valueAgoCache = new Map<number, { data: Record<string, number>; expiresAt: number }>();
  private valueAgoInFlight = new Map<number, Promise<Record<string, number>>>();

  private getDb() {
    return getSqliteDb();
  }

  private toSqliteUtcString(date: Date): string {
    return date.toISOString().replace('T', ' ').replace('Z', '+00:00');
  }

  private normalizeSqliteUtcString(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return this.toSqliteUtcString(parsed);
  }

  async findAll(): Promise<Streamer[]> {
    const rows = this.getDb().prepare('SELECT * FROM streamers ORDER BY base_value DESC').all();
    return rows.map((row: any) => ({
      channel_id: row.channel_id,
      name: row.name,
      logo_url: row.logo_url,
      custom_image_url: formatUploadUrl(row.custom_image_url),
      custom_images: extractStarImages(row),
      is_image_banned: row.is_image_banned === 1,
      follower_count: row.follower_count,
      activity_score: row.activity_score,
      base_value: row.base_value,
      is_active: row.is_active === 1,
      serial_number: row.serial_number || undefined,
      broadcast_count: row.broadcast_count || 0,
      broadcast_minutes: row.broadcast_minutes || 0,
      chat_count: row.chat_count || 0,
      broadcast_multiplier: row.broadcast_multiplier !== undefined ? row.broadcast_multiplier : 1.0,
      prev_value: row.prev_value !== undefined ? row.prev_value : 1000,
      last_broadcast_at: row.last_broadcast_at ?? null,
      registered_by: row.registered_by || null,
      updated_at: row.updated_at
    }));
  }

  async findLiveStatuses(): Promise<StreamerLiveStatus[]> {
    const rows = this.getDb()
      .prepare('SELECT channel_id, is_active FROM streamers ORDER BY channel_id ASC')
      .all() as { channel_id: string; is_active: number }[];
    return rows.map((row) => ({
      channel_id: row.channel_id,
      is_active: row.is_active === 1
    }));
  }

  async findRankingBase(limit?: number): Promise<Streamer[]> {
    const safeLimit = limit && Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : null;
    const rows = this.getDb().prepare(`
      SELECT channel_id, name, logo_url, custom_image_url, follower_count, base_value, is_active, serial_number, prev_value
        FROM streamers
       ORDER BY base_value DESC
       ${safeLimit ? 'LIMIT ?' : ''}
    `).all(...(safeLimit ? [safeLimit] : [])) as any[];
    return rows.map((row: any) => ({
      channel_id: row.channel_id,
      name: row.name,
      logo_url: row.logo_url,
      custom_image_url: formatUploadUrl(row.custom_image_url),
      custom_images: [],
      is_image_banned: false,
      follower_count: row.follower_count,
      activity_score: 0,
      base_value: row.base_value,
      is_active: row.is_active === 1,
      serial_number: row.serial_number || undefined,
      prev_value: row.prev_value !== undefined ? row.prev_value : row.base_value
    }));
  }

  async findById(channelId: string): Promise<Streamer | null> {
    const row = this.getDb().prepare('SELECT * FROM streamers WHERE channel_id = ?').get(channelId) as any;
    if (!row) return null;
    return {
      channel_id: row.channel_id,
      name: row.name,
      logo_url: row.logo_url,
      custom_image_url: formatUploadUrl(row.custom_image_url),
      custom_images: extractStarImages(row),
      is_image_banned: row.is_image_banned === 1,
      follower_count: row.follower_count,
      activity_score: row.activity_score,
      base_value: row.base_value,
      is_active: row.is_active === 1,
      serial_number: row.serial_number || undefined,
      broadcast_count: row.broadcast_count || 0,
      broadcast_minutes: row.broadcast_minutes || 0,
      chat_count: row.chat_count || 0,
      broadcast_multiplier: row.broadcast_multiplier !== undefined ? row.broadcast_multiplier : 1.0,
      prev_value: row.prev_value !== undefined ? row.prev_value : 1000,
      last_broadcast_at: row.last_broadcast_at ?? null,
      registered_by: row.registered_by || null,
      updated_at: row.updated_at
    };
  }

  async findByIds(channelIds: string[]): Promise<Streamer[]> {
    if (channelIds.length === 0) return [];
    const placeholders = channelIds.map(() => '?').join(',');
    const rows = this.getDb().prepare(`SELECT * FROM streamers WHERE channel_id IN (${placeholders})`).all(...channelIds) as any[];
    return rows.map((row: any) => ({
      channel_id: row.channel_id,
      name: row.name,
      logo_url: row.logo_url,
      custom_image_url: formatUploadUrl(row.custom_image_url),
      custom_images: extractStarImages(row),
      is_image_banned: row.is_image_banned === 1,
      follower_count: row.follower_count,
      activity_score: row.activity_score,
      base_value: row.base_value,
      is_active: row.is_active === 1,
      serial_number: row.serial_number || undefined,
      broadcast_count: row.broadcast_count || 0,
      broadcast_minutes: row.broadcast_minutes || 0,
      chat_count: row.chat_count || 0,
      broadcast_multiplier: row.broadcast_multiplier !== undefined ? row.broadcast_multiplier : 1.0,
      prev_value: row.prev_value !== undefined ? row.prev_value : 1000,
      last_broadcast_at: row.last_broadcast_at ?? null,
      registered_by: row.registered_by || null,
      updated_at: row.updated_at
    }));
  }

  async save(streamer: Streamer): Promise<void> {
    this.getDb().prepare(`
      INSERT INTO streamers (channel_id, name, logo_url, follower_count, activity_score, base_value, is_active, serial_number, broadcast_count, chat_count, broadcast_multiplier, prev_value, last_broadcast_at, registered_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET
        name = excluded.name,
        logo_url = excluded.logo_url,
        follower_count = excluded.follower_count,
        activity_score = excluded.activity_score,
        base_value = excluded.base_value,
        is_active = excluded.is_active,
        serial_number = COALESCE(excluded.serial_number, streamers.serial_number),
        broadcast_count = COALESCE(excluded.broadcast_count, streamers.broadcast_count),
        chat_count = COALESCE(excluded.chat_count, streamers.chat_count),
        broadcast_multiplier = COALESCE(excluded.broadcast_multiplier, streamers.broadcast_multiplier),
        prev_value = COALESCE(excluded.prev_value, streamers.prev_value),
        last_broadcast_at = COALESCE(excluded.last_broadcast_at, streamers.last_broadcast_at),
        registered_by = COALESCE(excluded.registered_by, streamers.registered_by),
        updated_at = datetime('now')
    `).run(
      streamer.channel_id,
      streamer.name,
      streamer.logo_url,
      streamer.follower_count,
      streamer.activity_score,
      streamer.base_value,
      streamer.is_active ? 1 : 0,
      streamer.serial_number || null,
      streamer.broadcast_count || 0,
      streamer.chat_count || 0,
      streamer.broadcast_multiplier !== undefined ? streamer.broadcast_multiplier : 1.0,
      streamer.prev_value !== undefined ? streamer.prev_value : 1000,
      streamer.last_broadcast_at || null,
      streamer.registered_by || null
    );
  }

  async updateCustomImage(channelId: string, imageUrl: string | null, star: number = 0): Promise<void> {
    const idx = Math.max(0, Math.min(5, Math.floor(star || 0)));
    const col = STAR_IMAGE_COLUMNS[idx];
    this.getDb().prepare(`UPDATE streamers SET ${col} = ?, updated_at = datetime('now') WHERE channel_id = ?`)
      .run(imageUrl, channelId);
  }
  async resetAllCustomImages(channelId: string): Promise<void> {
    const setClause = STAR_IMAGE_COLUMNS.map((c) => `${c} = NULL`).join(', ');
    this.getDb().prepare(`UPDATE streamers SET ${setClause}, updated_at = datetime('now') WHERE channel_id = ?`)
      .run(channelId);
  }
  async delete(channelId: string): Promise<void> {
    // 연관 user_cards/value_history/card_reports 는 FK ON DELETE CASCADE 로 함께 삭제됩니다.
    this.getDb().prepare('DELETE FROM streamers WHERE channel_id = ?').run(channelId);
  }
  async updateImageBanStatus(channelId: string, isBanned: boolean): Promise<void> {
    this.getDb().prepare('UPDATE streamers SET is_image_banned = ?, updated_at = datetime(\'now\') WHERE channel_id = ?')
      .run(isBanned ? 1 : 0, channelId);
  }

  async isRegistrationBlocked(channelId: string): Promise<boolean> {
    const row = this.getDb().prepare('SELECT 1 FROM streamer_registration_blocks WHERE channel_id = ? LIMIT 1').get(channelId);
    return !!row;
  }

  async blockRegistration(channelId: string, reason: string, blockedBy?: string | null): Promise<void> {
    this.getDb().prepare(`
      INSERT INTO streamer_registration_blocks (channel_id, reason, blocked_by, created_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(channel_id) DO UPDATE SET
        reason = excluded.reason,
        blocked_by = excluded.blocked_by,
        created_at = datetime('now')
    `).run(channelId, reason, blockedBy || null);
  }

  async findStreamerIndex(channelId: string): Promise<number> {
    const rows = this.getDb().prepare('SELECT channel_id FROM streamers ORDER BY channel_id').all() as { channel_id: string }[];
    const index = rows.findIndex(r => r.channel_id === channelId);
    return index !== -1 ? index + 1 : 1;
  }

  async findMaxSerialNumber(): Promise<number> {
    const row = this.getDb().prepare('SELECT MAX(serial_number) as max_sn FROM streamers').get() as any;
    return row && row.max_sn ? row.max_sn : 0;
  }

  async findAllocatedStreamerSerialNumbers(): Promise<number[]> {
    const rows = this.getDb().prepare('SELECT serial_number FROM streamers WHERE serial_number IS NOT NULL ORDER BY serial_number ASC').all() as any[];
    return rows.map(r => r.serial_number);
  }

  async updateLiveStatus(channelId: string, isActive: boolean, followerCount: number): Promise<void> {
    this.getDb().prepare('UPDATE streamers SET is_active = ?, follower_count = ?, last_broadcast_at = CASE WHEN ? = 1 THEN datetime(\'now\') ELSE last_broadcast_at END, updated_at = datetime(\'now\') WHERE channel_id = ?')
      .run(isActive ? 1 : 0, followerCount, isActive ? 1 : 0, channelId);
  }

  async incrementBroadcastCount(channelId: string): Promise<void> {
    this.getDb().prepare('UPDATE streamers SET broadcast_count = broadcast_count + 1, updated_at = datetime(\'now\') WHERE channel_id = ?')
      .run(channelId);
  }

  async incrementBroadcastMinutes(channelId: string, minutes: number): Promise<void> {
    if (minutes <= 0) return;
    this.getDb().prepare('UPDATE streamers SET broadcast_minutes = broadcast_minutes + ? WHERE channel_id = ?')
      .run(minutes, channelId);
  }

  async getValueHistory(channelId: string, sinceIso: string): Promise<{ value: number; recorded_at: string }[]> {
    const since = this.normalizeSqliteUtcString(sinceIso);
    const rows = this.getDb().prepare(
      `SELECT value, recorded_at FROM value_history
        WHERE channel_id = ? AND recorded_at >= ?
        ORDER BY recorded_at ASC`
    ).all(channelId, since) as any[];
    return rows.map(r => ({ value: r.value, recorded_at: r.recorded_at }));
  }

  async count(): Promise<number> {
    const row = this.getDb().prepare('SELECT COUNT(*) AS c FROM streamers').get() as any;
    return row?.c || 0;
  }

  async incrementChatCount(channelId: string, count: number = 1): Promise<void> {
    this.getDb().prepare('UPDATE streamers SET chat_count = chat_count + ?, updated_at = datetime(\'now\') WHERE channel_id = ?')
      .run(count, channelId);
  }

  async bulkIncrementChatCounts(counts: { channel_id: string; count: number }[]): Promise<void> {
    if (counts.length === 0) return;
    const db = this.getDb();
    const stmt = db.prepare('UPDATE streamers SET chat_count = chat_count + ?, updated_at = datetime(\'now\') WHERE channel_id = ?');
    db.transaction(() => {
      for (const item of counts) {
        if (item.count > 0) stmt.run(item.count, item.channel_id);
      }
    })();
  }

  async updateValueMetrics(channelId: string, prevValue: number, baseValue: number, activityScore: number, multiplier: number): Promise<void> {
    this.getDb().prepare(
      `UPDATE streamers
         SET prev_value = ?, base_value = ?, activity_score = ?, broadcast_multiplier = ?, updated_at = datetime('now')
       WHERE channel_id = ?`
    ).run(prevValue, baseValue, activityScore, multiplier, channelId);
  }

  async decrementChatCount(channelId: string, amount: number): Promise<void> {
    if (amount <= 0) return;
    // 집계 도중 새로 들어온 채팅이 음수가 되지 않도록 0 하한 적용
    this.getDb().prepare(
      `UPDATE streamers SET chat_count = MAX(chat_count - ?, 0) WHERE channel_id = ?`
    ).run(amount, channelId);
  }

  async recordValueHistory(channelId: string, value: number): Promise<void> {
    this.getDb().prepare('INSERT INTO value_history (channel_id, value) VALUES (?, ?)').run(channelId, value);
    // 7일을 초과한 이력은 UI에서 쓰지 않으므로 채널별 기록 시에도 가볍게 정리합니다.
    this.getDb().prepare(
      `DELETE FROM value_history
        WHERE id IN (
          SELECT id FROM value_history
           WHERE channel_id = ? AND datetime(recorded_at) < datetime('now', '-7 days')
           ORDER BY datetime(recorded_at) ASC
           LIMIT 500
        )`
    ).run(channelId);
  }

  async bulkApplyScheduleResults(results: StreamerScheduleResult[]): Promise<void> {
    if (results.length === 0) return;
    const db = this.getDb();
    // 라이브 폴링 여부에 따라 컬럼 집합이 달라 두 종류의 prepared statement 사용
    const updPolled = db.prepare(
      `UPDATE streamers SET
         prev_value = ?, base_value = ?, activity_score = ?, broadcast_multiplier = ?,
         broadcast_minutes = broadcast_minutes + ?,
         broadcast_count = broadcast_count + ?,
         chat_count = MAX(chat_count - ?, 0),
         is_active = ?, follower_count = ?,
         logo_url = ?,
         last_broadcast_at = ?,
         updated_at = datetime('now')
       WHERE channel_id = ?`
    );
    const updCompute = db.prepare(
      `UPDATE streamers SET
         prev_value = ?, base_value = ?, activity_score = ?, broadcast_multiplier = ?,
         broadcast_minutes = broadcast_minutes + ?,
         broadcast_count = broadcast_count + ?,
         chat_count = MAX(chat_count - ?, 0),
         updated_at = datetime('now')
       WHERE channel_id = ?`
    );
    const tx = db.transaction((rows: StreamerScheduleResult[]) => {
      for (const r of rows) {
        if (r.polled) {
          updPolled.run(
            r.prev_value, r.base_value, r.activity_score, r.broadcast_multiplier,
            r.add_minutes, r.add_broadcast_count, r.consumed_chats,
            r.is_active ? 1 : 0, r.follower_count, r.logo_url ?? null, r.last_broadcast_at ?? null, r.channel_id
          );
        } else {
          updCompute.run(
            r.prev_value, r.base_value, r.activity_score, r.broadcast_multiplier,
            r.add_minutes, r.add_broadcast_count, r.consumed_chats, r.channel_id
          );
        }
      }
    });
    tx(results);
  }

  async bulkRecordValueHistory(points: { channel_id: string; value: number }[]): Promise<void> {
    if (points.length === 0) return;
    const db = this.getDb();
    const ins = db.prepare('INSERT INTO value_history (channel_id, value) VALUES (?, ?)');
    const tx = db.transaction((rows: { channel_id: string; value: number }[]) => {
      for (const p of rows) ins.run(p.channel_id, p.value);
    });
    tx(points);
  }

  async pruneValueHistory(olderThanDays: number): Promise<void> {
    const days = Math.max(1, Math.floor(olderThanDays));
    const chunkSize = Math.max(100, Math.min(50000, Math.floor(Number(process.env.VALUE_HISTORY_PRUNE_CHUNK_SIZE || 10000))));
    const maxChunks = Math.max(1, Math.min(200, Math.floor(Number(process.env.VALUE_HISTORY_PRUNE_MAX_CHUNKS || 50))));
    const stmt = this.getDb().prepare(
      `DELETE FROM value_history
        WHERE id IN (
          SELECT id FROM value_history
           WHERE datetime(recorded_at) < datetime('now', '-' || ? || ' days')
           ORDER BY datetime(recorded_at) ASC
           LIMIT ?
        )`
    );
    let deletedTotal = 0;
    for (let i = 0; i < maxChunks; i += 1) {
      const result = stmt.run(days, chunkSize);
      const deleted = Number(result.changes || 0);
      deletedTotal += deleted;
      if (deleted < chunkSize) break;
    }
    if (deletedTotal >= chunkSize * maxChunks) {
      console.warn(`[ValueHistory] 오래된 시세 이력이 많아 이번 주기에는 ${deletedTotal.toLocaleString()}건까지만 정리했습니다.`);
    }
  }

  // 채널별로 지정한 시간 경계에 가장 근접한(경계 이전 중 가장 최근) 시세를 선택
  private async valueAgoMap(hours: number): Promise<Record<string, number>> {
    const now = Date.now();
    const cached = this.valueAgoCache.get(hours);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }
    const inFlight = this.valueAgoInFlight.get(hours);
    if (inFlight) return inFlight;

    const request = Promise.resolve()
      .then(() => this.loadValueAgoMap(hours))
      .then((data) => {
        this.valueAgoCache.set(hours, {
          data,
          expiresAt: Date.now() + SqliteStreamerRepository.VALUE_AGO_CACHE_TTL_MS
        });
        return data;
      })
      .finally(() => {
        this.valueAgoInFlight.delete(hours);
      });
    this.valueAgoInFlight.set(hours, request);
    return request;
  }

  private loadValueAgoMap(hours: number): Record<string, number> {
    const cutoffMs = Date.now() - hours * 60 * 60 * 1000;
    const cutoff = this.toSqliteUtcString(new Date(cutoffMs));
    const windowStart = this.toSqliteUtcString(
      new Date(cutoffMs - SqliteStreamerRepository.VALUE_AGO_LOOKBACK_HOURS * 60 * 60 * 1000)
    );
    const rows = this.getDb().prepare(
      `SELECT channel_id, value, recorded_at
         FROM value_history
        WHERE recorded_at >= ? AND recorded_at <= ?
        ORDER BY recorded_at DESC`
    ).all(windowStart, cutoff) as any[];

    const map: Record<string, number> = {};
    for (const r of rows) {
      if (map[r.channel_id] === undefined) {
        map[r.channel_id] = r.value;
      }
    }
    return map;
  }

  private loadValueAgoMapForChannels(hours: number, channelIds: string[]): Record<string, number> {
    const uniqueChannelIds = Array.from(new Set(channelIds.filter(Boolean)));
    if (uniqueChannelIds.length === 0) return {};

    const cutoffMs = Date.now() - hours * 60 * 60 * 1000;
    const cutoff = this.toSqliteUtcString(new Date(cutoffMs));
    const windowStart = this.toSqliteUtcString(
      new Date(cutoffMs - SqliteStreamerRepository.VALUE_AGO_LOOKBACK_HOURS * 60 * 60 * 1000)
    );
    const placeholders = uniqueChannelIds.map(() => '?').join(',');
    const rows = this.getDb().prepare(
      `SELECT vh.channel_id, vh.value, vh.recorded_at
         FROM value_history vh
         JOIN (
           SELECT channel_id, MAX(recorded_at) AS recorded_at
             FROM value_history
            WHERE channel_id IN (${placeholders})
              AND recorded_at >= ?
              AND recorded_at <= ?
            GROUP BY channel_id
         ) latest
           ON latest.channel_id = vh.channel_id
          AND latest.recorded_at = vh.recorded_at`
    ).all(...uniqueChannelIds, windowStart, cutoff) as any[];

    const map: Record<string, number> = {};
    for (const row of rows) {
      if (map[row.channel_id] === undefined) map[row.channel_id] = Number(row.value);
    }
    return map;
  }

  async getValue24hAgoMap(): Promise<Record<string, number>> {
    return this.valueAgoMap(24);
  }

  async getValue24hAgoMapForChannels(channelIds: string[]): Promise<Record<string, number>> {
    return this.loadValueAgoMapForChannels(24, channelIds);
  }

  async getValue1hAgoMap(): Promise<Record<string, number>> {
    return this.valueAgoMap(1);
  }

  async getValue1hAgoMapForChannels(channelIds: string[]): Promise<Record<string, number>> {
    return this.loadValueAgoMapForChannels(1, channelIds);
  }
}
// 3. SQLite 쿠폰 레포지토리
