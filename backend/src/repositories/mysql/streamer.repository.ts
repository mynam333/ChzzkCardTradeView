import { getMysqlDb } from '../../services/db';
import { IStreamerRepository, Streamer, StreamerScheduleResult } from '../interfaces';
import { STAR_IMAGE_COLUMNS, extractStarImages } from './shared';
import { formatUploadUrl } from '../../services/imageService';

export class MysqlStreamerRepository implements IStreamerRepository {
  private static readonly VALUE_AGO_CACHE_TTL_MS = Math.max(5_000, Number(process.env.VALUE_AGO_CACHE_TTL_MS || 60_000));
  private static readonly VALUE_AGO_LOOKBACK_HOURS = Math.max(1, Number(process.env.VALUE_AGO_LOOKBACK_HOURS || 3));
  private valueAgoCache = new Map<number, { data: Record<string, number>; expiresAt: number }>();
  private valueAgoInFlight = new Map<number, Promise<Record<string, number>>>();

  private getDb() {
    return getMysqlDb();
  }

  private toUtcString(date: Date): string {
    return date.toISOString().replace('T', ' ').replace('Z', '+00:00');
  }

  private normalizeUtcString(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return this.toUtcString(parsed);
  }

  private mapRow(row: any): Streamer {
    return {
      channel_id: row.channel_id,
      name: row.name,
      logo_url: row.logo_url,
      custom_image_url: formatUploadUrl(row.custom_image_url),
      custom_images: extractStarImages(row),
      is_image_banned: row.is_image_banned === 1 || row.is_image_banned === true,
      follower_count: Number(row.follower_count || 0),
      activity_score: Number(row.activity_score || 0),
      base_value: Number(row.base_value || 0),
      is_active: row.is_active === 1 || row.is_active === true,
      serial_number: row.serial_number || undefined,
      broadcast_count: Number(row.broadcast_count || 0),
      broadcast_minutes: Number(row.broadcast_minutes || 0),
      chat_count: Number(row.chat_count || 0),
      broadcast_multiplier: row.broadcast_multiplier !== undefined ? Number(row.broadcast_multiplier) : 1.0,
      prev_value: row.prev_value !== undefined ? Number(row.prev_value) : 1000,
      last_broadcast_at: row.last_broadcast_at ?? null,
      registered_by: row.registered_by || null,
      updated_at: row.updated_at
    };
  }

  async findAll(): Promise<Streamer[]> {
    const rows = await this.getDb().all('SELECT * FROM streamers ORDER BY base_value DESC');
    return rows.map((row) => this.mapRow(row));
  }

  async findRankingBase(limit?: number): Promise<Streamer[]> {
    const safeLimit = limit && Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : null;
    const rows = await this.getDb().all(`
      SELECT channel_id, name, logo_url, custom_image_url, follower_count, base_value, is_active, serial_number, prev_value
        FROM streamers
       ORDER BY base_value DESC
       ${safeLimit ? 'LIMIT ?' : ''}
    `, ...(safeLimit ? [safeLimit] : []));
    return rows.map((row: any) => ({
      channel_id: row.channel_id,
      name: row.name,
      logo_url: row.logo_url,
      custom_image_url: formatUploadUrl(row.custom_image_url),
      custom_images: [],
      is_image_banned: false,
      follower_count: Number(row.follower_count || 0),
      activity_score: 0,
      base_value: Number(row.base_value || 0),
      is_active: row.is_active === 1 || row.is_active === true,
      serial_number: row.serial_number || undefined,
      prev_value: row.prev_value !== undefined ? Number(row.prev_value) : Number(row.base_value || 0)
    }));
  }

  async findById(channelId: string): Promise<Streamer | null> {
    const row = await this.getDb().get('SELECT * FROM streamers WHERE channel_id = ?', channelId);
    return row ? this.mapRow(row) : null;
  }

  async findByIds(channelIds: string[]): Promise<Streamer[]> {
    if (channelIds.length === 0) return [];
    const placeholders = channelIds.map(() => '?').join(',');
    const rows = await this.getDb().all(`SELECT * FROM streamers WHERE channel_id IN (${placeholders})`, channelIds);
    return rows.map((row) => this.mapRow(row));
  }

  async save(streamer: Streamer): Promise<void> {
    await this.getDb().run(`
      INSERT INTO streamers (channel_id, name, logo_url, follower_count, activity_score, base_value, is_active, serial_number, broadcast_count, chat_count, broadcast_multiplier, prev_value, last_broadcast_at, registered_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        logo_url = VALUES(logo_url),
        follower_count = VALUES(follower_count),
        activity_score = VALUES(activity_score),
        base_value = VALUES(base_value),
        is_active = VALUES(is_active),
        serial_number = COALESCE(VALUES(serial_number), serial_number),
        broadcast_count = COALESCE(VALUES(broadcast_count), broadcast_count),
        chat_count = COALESCE(VALUES(chat_count), chat_count),
        broadcast_multiplier = COALESCE(VALUES(broadcast_multiplier), broadcast_multiplier),
        prev_value = COALESCE(VALUES(prev_value), prev_value),
        last_broadcast_at = COALESCE(VALUES(last_broadcast_at), last_broadcast_at),
        registered_by = COALESCE(VALUES(registered_by), registered_by),
        updated_at = UTC_TIMESTAMP()
    `,
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
    await this.getDb().run(`UPDATE streamers SET ${col} = ?, updated_at = UTC_TIMESTAMP() WHERE channel_id = ?`, imageUrl, channelId);
  }

  async resetAllCustomImages(channelId: string): Promise<void> {
    const setClause = STAR_IMAGE_COLUMNS.map((c) => `${c} = NULL`).join(', ');
    await this.getDb().run(`UPDATE streamers SET ${setClause}, updated_at = UTC_TIMESTAMP() WHERE channel_id = ?`, channelId);
  }

  async delete(channelId: string): Promise<void> {
    await this.getDb().run('DELETE FROM streamers WHERE channel_id = ?', channelId);
  }

  async updateImageBanStatus(channelId: string, isBanned: boolean): Promise<void> {
    await this.getDb().run('UPDATE streamers SET is_image_banned = ?, updated_at = UTC_TIMESTAMP() WHERE channel_id = ?', isBanned ? 1 : 0, channelId);
  }

  async isRegistrationBlocked(channelId: string): Promise<boolean> {
    const row = await this.getDb().get('SELECT 1 FROM streamer_registration_blocks WHERE channel_id = ? LIMIT 1', channelId);
    return !!row;
  }

  async blockRegistration(channelId: string, reason: string, blockedBy?: string | null): Promise<void> {
    await this.getDb().run(`
      INSERT INTO streamer_registration_blocks (channel_id, reason, blocked_by, created_at)
      VALUES (?, ?, ?, UTC_TIMESTAMP())
      ON DUPLICATE KEY UPDATE reason = VALUES(reason), blocked_by = VALUES(blocked_by), created_at = UTC_TIMESTAMP()
    `, channelId, reason, blockedBy || null);
  }

  async findStreamerIndex(channelId: string): Promise<number> {
    const rows = await this.getDb().all<{ channel_id: string }>('SELECT channel_id FROM streamers ORDER BY channel_id');
    const index = rows.findIndex((r) => r.channel_id === channelId);
    return index !== -1 ? index + 1 : 1;
  }

  async findMaxSerialNumber(): Promise<number> {
    const row = await this.getDb().get('SELECT MAX(serial_number) as max_sn FROM streamers');
    return row && row.max_sn ? Number(row.max_sn) : 0;
  }

  async findAllocatedStreamerSerialNumbers(): Promise<number[]> {
    const rows = await this.getDb().all('SELECT serial_number FROM streamers WHERE serial_number IS NOT NULL ORDER BY serial_number ASC');
    return rows.map((r: any) => Number(r.serial_number));
  }

  async updateLiveStatus(channelId: string, isActive: boolean, followerCount: number): Promise<void> {
    await this.getDb().run(
      'UPDATE streamers SET is_active = ?, follower_count = ?, last_broadcast_at = CASE WHEN ? = 1 THEN UTC_TIMESTAMP() ELSE last_broadcast_at END, updated_at = UTC_TIMESTAMP() WHERE channel_id = ?',
      isActive ? 1 : 0, followerCount, isActive ? 1 : 0, channelId
    );
  }

  async incrementBroadcastCount(channelId: string): Promise<void> {
    await this.getDb().run('UPDATE streamers SET broadcast_count = broadcast_count + 1, updated_at = UTC_TIMESTAMP() WHERE channel_id = ?', channelId);
  }

  async incrementBroadcastMinutes(channelId: string, minutes: number): Promise<void> {
    if (minutes <= 0) return;
    await this.getDb().run('UPDATE streamers SET broadcast_minutes = broadcast_minutes + ? WHERE channel_id = ?', minutes, channelId);
  }

  async getValueHistory(channelId: string, sinceIso: string): Promise<{ value: number; recorded_at: string }[]> {
    const since = this.normalizeUtcString(sinceIso);
    const rows = await this.getDb().all(
      `SELECT value, recorded_at FROM value_history
        WHERE channel_id = ? AND recorded_at >= ?
        ORDER BY recorded_at ASC`,
      channelId, since
    );
    return rows.map((r: any) => ({ value: Number(r.value), recorded_at: r.recorded_at }));
  }

  async count(): Promise<number> {
    const row = await this.getDb().get('SELECT COUNT(*) AS c FROM streamers');
    return row?.c || 0;
  }

  async incrementChatCount(channelId: string, count: number = 1): Promise<void> {
    await this.getDb().run('UPDATE streamers SET chat_count = chat_count + ?, updated_at = UTC_TIMESTAMP() WHERE channel_id = ?', count, channelId);
  }

  async bulkIncrementChatCounts(counts: { channel_id: string; count: number }[]): Promise<void> {
    if (counts.length === 0) return;
    const merged = new Map<string, number>();
    for (const item of counts) {
      const channelId = String(item.channel_id || '').trim();
      const count = Math.max(0, Math.floor(Number(item.count || 0)));
      if (!channelId || count <= 0) continue;
      merged.set(channelId, (merged.get(channelId) || 0) + count);
    }

    const rows = Array.from(merged.entries())
      .map(([channel_id, count]) => ({ channel_id, count }))
      .sort((a, b) => a.channel_id.localeCompare(b.channel_id));

    const chunkSize = Math.max(1, Number(process.env.MYSQL_CHAT_FLUSH_CHUNK_SIZE || 100));
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const caseParts: string[] = [];
      const params: any[] = [];
      for (const item of chunk) {
        caseParts.push('WHEN ? THEN ?');
        params.push(item.channel_id, item.count);
      }
      const ids = chunk.map((item) => item.channel_id);
      await this.getDb().transaction(async (tx) => {
        await tx.run(
          `UPDATE streamers
              SET chat_count = chat_count + CASE channel_id ${caseParts.join(' ')} ELSE 0 END,
                  updated_at = UTC_TIMESTAMP()
            WHERE channel_id IN (${ids.map(() => '?').join(',')})`,
          [...params, ...ids]
        );
      });
    }
  }

  async updateValueMetrics(channelId: string, prevValue: number, baseValue: number, activityScore: number, multiplier: number): Promise<void> {
    await this.getDb().run(
      `UPDATE streamers
         SET prev_value = ?, base_value = ?, activity_score = ?, broadcast_multiplier = ?, updated_at = UTC_TIMESTAMP()
       WHERE channel_id = ?`,
      prevValue, baseValue, activityScore, multiplier, channelId
    );
  }

  async decrementChatCount(channelId: string, amount: number): Promise<void> {
    if (amount <= 0) return;
    await this.getDb().run('UPDATE streamers SET chat_count = GREATEST(chat_count - ?, 0) WHERE channel_id = ?', amount, channelId);
  }

  async recordValueHistory(channelId: string, value: number): Promise<void> {
    await this.getDb().run('INSERT INTO value_history (channel_id, value) VALUES (?, ?)', channelId, value);
    await this.getDb().run('DELETE FROM value_history WHERE channel_id = ? AND recorded_at < UTC_TIMESTAMP() - INTERVAL 8 DAY', channelId);
  }

  async bulkApplyScheduleResults(results: StreamerScheduleResult[]): Promise<void> {
    if (results.length === 0) return;
    const orderedResults = [...results].sort((a, b) => a.channel_id.localeCompare(b.channel_id));
    await this.getDb().transaction(async (tx) => {
      for (const r of orderedResults) {
        if (r.polled) {
          await tx.run(
            `UPDATE streamers SET
               prev_value = ?, base_value = ?, activity_score = ?, broadcast_multiplier = ?,
               broadcast_minutes = broadcast_minutes + ?,
               broadcast_count = broadcast_count + ?,
               chat_count = GREATEST(chat_count - ?, 0),
               is_active = ?, follower_count = ?,
               logo_url = ?,
               last_broadcast_at = ?,
               updated_at = UTC_TIMESTAMP()
             WHERE channel_id = ?`,
            r.prev_value, r.base_value, r.activity_score, r.broadcast_multiplier,
            r.add_minutes, r.add_broadcast_count, r.consumed_chats,
            r.is_active ? 1 : 0, r.follower_count, r.logo_url ?? null, r.last_broadcast_at ?? null, r.channel_id
          );
        } else {
          await tx.run(
            `UPDATE streamers SET
               prev_value = ?, base_value = ?, activity_score = ?, broadcast_multiplier = ?,
               broadcast_minutes = broadcast_minutes + ?,
               broadcast_count = broadcast_count + ?,
               chat_count = GREATEST(chat_count - ?, 0),
               updated_at = UTC_TIMESTAMP()
             WHERE channel_id = ?`,
            r.prev_value, r.base_value, r.activity_score, r.broadcast_multiplier,
            r.add_minutes, r.add_broadcast_count, r.consumed_chats, r.channel_id
          );
        }
      }
    });
  }

  async bulkRecordValueHistory(points: { channel_id: string; value: number }[]): Promise<void> {
    if (points.length === 0) return;
    await this.getDb().transaction(async (tx) => {
      for (const p of points) {
        await tx.run('INSERT INTO value_history (channel_id, value) VALUES (?, ?)', p.channel_id, p.value);
      }
    });
  }

  async pruneValueHistory(olderThanDays: number): Promise<void> {
    const days = Math.max(1, Math.floor(olderThanDays));
    await this.getDb().run('DELETE FROM value_history WHERE recorded_at < UTC_TIMESTAMP() - INTERVAL ? DAY', days);
  }

  private async valueAgoMap(hours: number): Promise<Record<string, number>> {
    const now = Date.now();
    const cached = this.valueAgoCache.get(hours);
    if (cached && cached.expiresAt > now) return cached.data;
    const inFlight = this.valueAgoInFlight.get(hours);
    if (inFlight) return inFlight;
    const request = this.loadValueAgoMap(hours)
      .then((data) => {
        this.valueAgoCache.set(hours, { data, expiresAt: Date.now() + MysqlStreamerRepository.VALUE_AGO_CACHE_TTL_MS });
        return data;
      })
      .finally(() => this.valueAgoInFlight.delete(hours));
    this.valueAgoInFlight.set(hours, request);
    return request;
  }

  private async loadValueAgoMap(hours: number): Promise<Record<string, number>> {
    const cutoffMs = Date.now() - hours * 60 * 60 * 1000;
    const cutoff = this.toUtcString(new Date(cutoffMs));
    const windowStart = this.toUtcString(new Date(cutoffMs - MysqlStreamerRepository.VALUE_AGO_LOOKBACK_HOURS * 60 * 60 * 1000));
    const rows = await this.getDb().all(
      `SELECT channel_id, value, recorded_at
         FROM value_history
        WHERE recorded_at >= ? AND recorded_at <= ?
        ORDER BY recorded_at DESC`,
      windowStart, cutoff
    );
    const map: Record<string, number> = {};
    for (const r of rows) {
      if (map[r.channel_id] === undefined) map[r.channel_id] = Number(r.value);
    }
    return map;
  }

  private async loadValueAgoMapForChannels(hours: number, channelIds: string[]): Promise<Record<string, number>> {
    const uniqueChannelIds = Array.from(new Set(channelIds.filter(Boolean)));
    if (uniqueChannelIds.length === 0) return {};

    const cutoffMs = Date.now() - hours * 60 * 60 * 1000;
    const cutoff = this.toUtcString(new Date(cutoffMs));
    const windowStart = this.toUtcString(new Date(cutoffMs - MysqlStreamerRepository.VALUE_AGO_LOOKBACK_HOURS * 60 * 60 * 1000));
    const placeholders = uniqueChannelIds.map(() => '?').join(',');
    const rows = await this.getDb().all(
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
          AND latest.recorded_at = vh.recorded_at`,
      ...uniqueChannelIds,
      windowStart,
      cutoff
    );
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
