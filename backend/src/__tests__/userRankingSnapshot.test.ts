import { describe, expect, it, vi } from 'vitest';
import {
  isUserRankingSnapshotFresh,
  readLatestUserRankingSnapshotAt,
  snapshotTimestampMs,
  syncPostgresUserRankingSnapshotTables
} from '../services/userRankingSnapshot';

describe('user ranking snapshot refresh policy', () => {
  it('parses database timestamps and rejects invalid values', () => {
    expect(snapshotTimestampMs(new Date('2026-09-03T10:00:00.000Z'))).toBe(1788429600000);
    expect(snapshotTimestampMs('2026-09-03T10:00:00.000Z')).toBe(1788429600000);
    expect(snapshotTimestampMs('not-a-date')).toBeNull();
    expect(snapshotTimestampMs(null)).toBeNull();
  });

  it('skips a cross-process refresh only while the database snapshot is fresh', async () => {
    const snapshotAt = Date.parse('2026-09-03T10:00:00.000Z');
    const db = {
      get: vi.fn().mockResolvedValue({ snapshot_at: new Date(snapshotAt) })
    };

    await expect(readLatestUserRankingSnapshotAt(db)).resolves.toBe(snapshotAt);
    expect(isUserRankingSnapshotFresh(snapshotAt, 180_000, snapshotAt + 179_999)).toBe(true);
    expect(isUserRankingSnapshotFresh(snapshotAt, 180_000, snapshotAt + 180_000)).toBe(false);
  });
});

describe('PostgreSQL user ranking snapshot synchronization', () => {
  it('upserts changed rows and deletes only rows missing from staging', async () => {
    const statements: string[] = [];
    const tx = {
      run: vi.fn(async (sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return { changes: 0 };
      })
    };

    await syncPostgresUserRankingSnapshotTables(tx);

    expect(statements).toHaveLength(5);
    expect(statements[0]).toContain('ON CONFLICT (user_id) DO UPDATE');
    expect(statements[0]).toContain('IS DISTINCT FROM');
    expect(statements[1]).toContain('ON CONFLICT (user_id, channel_id, star) DO UPDATE');
    expect(statements[1]).toContain('existing.card_count IS DISTINCT FROM EXCLUDED.card_count');
    expect(statements[2]).toContain('DELETE FROM user_asset_ranking_cards AS existing WHERE NOT EXISTS');
    expect(statements[3]).toContain('DELETE FROM user_asset_rankings AS existing WHERE NOT EXISTS');
    expect(statements[4]).toContain('UPDATE user_asset_rankings SET snapshot_at = NOW()');
    expect(statements).not.toContain('DELETE FROM user_asset_ranking_cards');
    expect(statements).not.toContain('DELETE FROM user_asset_rankings');
  });
});
