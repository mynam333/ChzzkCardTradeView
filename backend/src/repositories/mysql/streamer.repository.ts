import { getMysqlDb, getSqlDialect } from '../../services/db';
import { IStreamerRepository, Streamer, StreamerLiveStatus, StreamerScheduleResult } from '../interfaces';
import { STAR_IMAGE_COLUMNS, extractStarImages } from './shared';
import { formatUploadUrl } from '../../services/imageService';
import { lockEconomyChannels } from '../../services/economyChannelLock';
import { randomUUID } from 'node:crypto';

export class MysqlStreamerRepository implements IStreamerRepository {
  private static readonly VALUE_AGO_CACHE_TTL_MS = Math.max(5_000, Number(process.env.VALUE_AGO_CACHE_TTL_MS || 60_000));
  private static readonly VALUE_AGO_LOOKBACK_HOURS = Math.max(1, Number(process.env.VALUE_AGO_LOOKBACK_HOURS || 3));
  private static readonly VALUE_AGO_CHANNEL_QUERY_THRESHOLD = Math.max(50, Number(process.env.VALUE_AGO_CHANNEL_QUERY_THRESHOLD || 200));
  private static readonly VALUE_AGO_CHANNEL_CHUNK_SIZE = Math.max(25, Number(process.env.VALUE_AGO_CHANNEL_CHUNK_SIZE || 200));
  private static readonly SCHEDULE_UPDATE_CHUNK_SIZE = Math.max(25, Number(process.env.STREAMER_SCHEDULE_UPDATE_CHUNK_SIZE || 100));
  private static readonly VALUE_HISTORY_INSERT_CHUNK_SIZE = Math.max(50, Number(process.env.VALUE_HISTORY_INSERT_CHUNK_SIZE || 500));
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

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }

  private caseExpr<T extends StreamerScheduleResult>(
    rows: T[],
    getValue: (row: T) => any,
    fallback: string
  ): { sql: string; params: any[] } {
    const params: any[] = [];
    const cases = rows.map((row) => {
      params.push(row.channel_id, getValue(row));
      return 'WHEN ? THEN ?';
    }).join(' ');
    return {
      sql: `CASE channel_id ${cases} ELSE ${fallback} END`,
      params
    };
  }

  private async applyScheduleUpdateChunk(rows: StreamerScheduleResult[], polled: boolean): Promise<void> {
    if (rows.length === 0) return;
    const assignments: string[] = [];
    const params: any[] = [];
    const addCase = (
      column: string,
      getValue: (row: StreamerScheduleResult) => any,
      fallback = column
    ) => {
      const expr = this.caseExpr(rows, getValue, fallback);
      assignments.push(`${column} = ${expr.sql}`);
      params.push(...expr.params);
    };
    const addIncrementCase = (
      column: string,
      getValue: (row: StreamerScheduleResult) => any
    ) => {
      const expr = this.caseExpr(rows, getValue, '0');
      assignments.push(`${column} = ${column} + ${expr.sql}`);
      params.push(...expr.params);
    };

    addCase('prev_value', (row) => row.prev_value);
    addCase('base_value', (row) => row.base_value);
    addCase('activity_score', (row) => row.activity_score);
    addCase('broadcast_multiplier', (row) => row.broadcast_multiplier);
    addIncrementCase('broadcast_minutes', (row) => row.add_minutes);
    addIncrementCase('broadcast_count', (row) => row.add_broadcast_count);
    const consumedChatsExpr = this.caseExpr(rows, (row) => row.consumed_chats, '0');
    assignments.push(`chat_count = GREATEST(chat_count - ${consumedChatsExpr.sql}, 0)`);
    params.push(...consumedChatsExpr.params);

    if (polled) {
      // PostgreSQL은 CASE 결과를 BOOLEAN으로 추론한 뒤 드라이버의 boolean
      // serializer를 사용하므로 0/1이 아니라 실제 boolean을 전달해야 합니다.
      addCase('is_active', (row) => row.is_active);
      addCase('follower_count', (row) => row.follower_count);
      addCase('logo_url', (row) => row.logo_url ?? null);
      addCase('last_broadcast_at', (row) => row.last_broadcast_at ? this.normalizeUtcString(row.last_broadcast_at) : null);
    }

    assignments.push('updated_at = UTC_TIMESTAMP()');
    const ids = rows.map((row) => row.channel_id);
    await this.getDb().run(
      `UPDATE streamers
          SET ${assignments.join(',\n              ')}
        WHERE channel_id IN (${ids.map(() => '?').join(',')})`,
      ...params,
      ...ids
    );
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
      lifecycle_id: row.lifecycle_id || undefined,
      updated_at: row.updated_at
    };
  }

  async findAll(): Promise<Streamer[]> {
    const rows = await this.getDb().all('SELECT * FROM streamers ORDER BY base_value DESC');
    return rows.map((row) => this.mapRow(row));
  }

  async findLiveStatuses(): Promise<StreamerLiveStatus[]> {
    const rows = await this.getDb().all<{ channel_id: string; is_active: number | boolean }>(
      'SELECT channel_id, is_active FROM streamers ORDER BY channel_id ASC'
    );
    return rows.map((row) => ({
      channel_id: row.channel_id,
      is_active: row.is_active === true || Number(row.is_active) === 1
    }));
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
    const lifecycleId = streamer.lifecycle_id || randomUUID();
    await this.getDb().transaction(async (tx) => {
      const existingChannels = await lockEconomyChannels(tx, [streamer.channel_id]);
      if (existingChannels.includes(streamer.channel_id)) throw new Error('STREAMER_ALREADY_EXISTS');

      const blocked = await tx.get(
        'SELECT 1 AS blocked FROM streamer_registration_blocks WHERE channel_id = ? LIMIT 1',
        streamer.channel_id
      );
      const isSelfRegistration = Boolean(streamer.registered_by) && streamer.registered_by === streamer.channel_id;
      if (blocked && !isSelfRegistration) throw new Error('STREAMER_REGISTRATION_BLOCKED');

      await tx.run(`
        INSERT INTO streamers
          (channel_id, name, logo_url, follower_count, activity_score, base_value, is_active,
           serial_number, broadcast_count, chat_count, broadcast_multiplier, prev_value,
           last_broadcast_at, registered_by, lifecycle_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        streamer.registered_by || null,
        lifecycleId
      );
    });
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
    return Number(row?.c || 0);
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
    await this.getDb().run('DELETE FROM value_history WHERE channel_id = ? AND recorded_at < UTC_TIMESTAMP() - INTERVAL 7 DAY LIMIT ?', channelId, 500);
  }

  async bulkApplyScheduleResults(results: StreamerScheduleResult[]): Promise<void> {
    if (results.length === 0) return;
    const orderedResults = [...results].sort((a, b) => a.channel_id.localeCompare(b.channel_id));
    const polledRows = orderedResults.filter((row) => row.polled);
    const computeOnlyRows = orderedResults.filter((row) => !row.polled);
    for (const chunk of this.chunk(polledRows, MysqlStreamerRepository.SCHEDULE_UPDATE_CHUNK_SIZE)) {
      await this.applyScheduleUpdateChunk(chunk, true);
    }
    for (const chunk of this.chunk(computeOnlyRows, MysqlStreamerRepository.SCHEDULE_UPDATE_CHUNK_SIZE)) {
      await this.applyScheduleUpdateChunk(chunk, false);
    }
  }

  async bulkRecordValueHistory(points: { channel_id: string; value: number }[]): Promise<void> {
    if (points.length === 0) return;
    for (const chunk of this.chunk(points, MysqlStreamerRepository.VALUE_HISTORY_INSERT_CHUNK_SIZE)) {
      const params: any[] = [];
      const placeholders = chunk.map((point) => {
        params.push(point.channel_id, point.value);
        return '(?, ?)';
      }).join(',');
      await this.getDb().run(
        `INSERT INTO value_history (channel_id, value) VALUES ${placeholders}`,
        ...params
      );
    }
  }

  async pruneValueHistory(olderThanDays: number): Promise<void> {
    const days = Math.max(1, Math.floor(olderThanDays));
    const chunkSize = Math.max(100, Math.min(50000, Math.floor(Number(process.env.VALUE_HISTORY_PRUNE_CHUNK_SIZE || 10000))));
    const maxChunks = Math.max(1, Math.min(200, Math.floor(Number(process.env.VALUE_HISTORY_PRUNE_MAX_CHUNKS || 50))));
    let deletedTotal = 0;
    for (let i = 0; i < maxChunks; i += 1) {
      const result = await this.getDb().run(
        'DELETE FROM value_history WHERE recorded_at < UTC_TIMESTAMP() - INTERVAL ? DAY ORDER BY recorded_at ASC LIMIT ?',
        days,
        chunkSize
      );
      deletedTotal += Number(result.affectedRows || result.changes || 0);
      if (Number(result.affectedRows || result.changes || 0) < chunkSize) break;
    }
    if (deletedTotal >= chunkSize * maxChunks) {
      console.warn(`[ValueHistory] 오래된 시세 이력이 많아 이번 주기에는 ${deletedTotal.toLocaleString()}건까지만 정리했습니다.`);
    }
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
      .catch((err) => {
        if (cached) {
          cached.expiresAt = Date.now() + Math.min(MysqlStreamerRepository.VALUE_AGO_CACHE_TTL_MS, 60_000);
          console.warn(`[ValueHistory] ${hours}시간 전 시세 조회 실패, stale 캐시를 사용합니다:`, err?.message || err);
          return cached.data;
        }
        throw err;
      })
      .finally(() => this.valueAgoInFlight.delete(hours));
    this.valueAgoInFlight.set(hours, request);
    return request;
  }

  private async loadValueAgoMap(hours: number): Promise<Record<string, number>> {
    const cutoffMs = Date.now() - hours * 60 * 60 * 1000;
    const cutoff = this.toUtcString(new Date(cutoffMs));
    const windowStart = this.toUtcString(new Date(cutoffMs - MysqlStreamerRepository.VALUE_AGO_LOOKBACK_HOURS * 60 * 60 * 1000));
    const rows = getSqlDialect() === 'postgres'
      ? await this.getDb().all(
        `SELECT DISTINCT ON (vh.channel_id) vh.channel_id, vh.value
           FROM value_history vh
          WHERE vh.recorded_at <= ?
            AND vh.recorded_at >= ?
          ORDER BY vh.channel_id, vh.recorded_at DESC`,
        cutoff, windowStart
      )
      : await this.getDb().all(
        `SELECT vh.channel_id, vh.value
           FROM value_history vh FORCE INDEX (idx_value_history_recorded_channel)
          WHERE vh.recorded_at <= ?
            AND vh.recorded_at >= ?
          ORDER BY vh.recorded_at DESC`,
        cutoff, windowStart
      );
    return this.mapValueAgoRows(rows);
  }

  private async loadValueAgoMapForChannels(hours: number, channelIds: string[]): Promise<Record<string, number>> {
    const uniqueChannelIds = Array.from(new Set(channelIds.filter(Boolean)));
    if (uniqueChannelIds.length === 0) return {};

    if (uniqueChannelIds.length >= MysqlStreamerRepository.VALUE_AGO_CHANNEL_QUERY_THRESHOLD) {
      const allMap = await this.valueAgoMap(hours);
      const map: Record<string, number> = {};
      for (const channelId of uniqueChannelIds) {
        if (allMap[channelId] !== undefined) map[channelId] = allMap[channelId];
      }
      return map;
    }

    const cutoffMs = Date.now() - hours * 60 * 60 * 1000;
    const cutoff = this.toUtcString(new Date(cutoffMs));
    const windowStart = this.toUtcString(new Date(cutoffMs - MysqlStreamerRepository.VALUE_AGO_LOOKBACK_HOURS * 60 * 60 * 1000));
    const map: Record<string, number> = {};
    for (const chunk of this.chunk(uniqueChannelIds, MysqlStreamerRepository.VALUE_AGO_CHANNEL_CHUNK_SIZE)) {
      const placeholders = chunk.map(() => '?').join(',');
      const rows = await this.getDb().all(
        `SELECT s.channel_id,
                (
                  SELECT vh.value
                    FROM value_history vh FORCE INDEX (idx_value_history_channel_recorded)
                   WHERE vh.channel_id = s.channel_id
                     AND vh.recorded_at <= ?
                     AND vh.recorded_at >= ?
                   ORDER BY vh.recorded_at DESC
                   LIMIT 1
                ) AS value
           FROM streamers s
          WHERE s.channel_id IN (${placeholders})`,
        cutoff,
        windowStart,
        ...chunk
      );
      Object.assign(map, this.mapValueAgoRows(rows));
    }
    return map;
  }

  private mapValueAgoRows(rows: any[]): Record<string, number> {
    const map: Record<string, number> = {};
    for (const row of rows) {
      if (!row?.channel_id || row.value == null) continue;
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
