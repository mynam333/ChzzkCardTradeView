import { getSqlDialect } from './db';

type EconomyLockTransaction = {
  all: <T = any>(sql: string, ...args: any[]) => Promise<T[]>;
  run: (sql: string, ...args: any[]) => Promise<any>;
};

const normalizeChannelIds = (channelIds: string[]) =>
  [...new Set(channelIds.map((value) => String(value || '').trim()).filter(Boolean))].sort();

/**
 * Serializes destructive streamer-card settlement with new trade/market reservations.
 * Call only from inside the transaction that performs the guarded operation.
 */
export const lockEconomyChannels = async (
  tx: EconomyLockTransaction,
  channelIds: string[]
): Promise<string[]> => {
  const ids = normalizeChannelIds(channelIds);
  if (ids.length === 0) return [];

  if (getSqlDialect() === 'postgres') {
    for (const channelId of ids) {
      await tx.run(
        'SELECT pg_advisory_xact_lock(hashtext(?))',
        `economy:streamer-card:${channelId}`
      );
    }
  }

  const placeholders = ids.map(() => '?').join(',');
  const rows = await tx.all<{ channel_id: string }>(
    `SELECT channel_id
       FROM streamers
      WHERE channel_id IN (${placeholders})
      ORDER BY channel_id
      FOR UPDATE`,
    ...ids
  );
  return rows.map((row) => String(row.channel_id));
};

