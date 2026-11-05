import { describe, expect, it, vi } from 'vitest';
import {
  buildPostgresUserRankingSnapshotStaging,
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
  it('aggregates visible cards once and builds only the unique indexes needed for synchronization', async () => {
    const statements: string[] = [];
    const tx = {
      run: vi.fn(async (sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return { changes: 0 };
      })
    };

    await buildPostgresUserRankingSnapshotStaging(tx);

    expect(statements).toHaveLength(6);
    expect(statements.join(' ').match(/FROM user_cards\b/g)).toHaveLength(1);
    expect(statements[0]).toContain('LIKE user_asset_ranking_cards INCLUDING DEFAULTS');
    expect(statements[0]).not.toContain('INCLUDING ALL');
    expect(statements[1]).toContain('uc.is_hidden IS NOT TRUE');
    expect(statements[1]).toContain('u.banned_until IS NULL OR u.banned_until <= NOW()');
    expect(statements[1]).toContain('COALESCE(uc.star, 0)');
    expect(statements[1]).toContain('GROUP BY uc.user_id, uc.channel_id, COALESCE(uc.star, 0)');
    expect(statements[2]).toContain('CREATE UNIQUE INDEX');
    expect(statements[2]).toContain('(user_id, channel_id, star)');
    expect(statements[3]).toContain('LIKE user_asset_rankings INCLUDING DEFAULTS');
    expect(statements[3]).not.toContain('INCLUDING ALL');
    expect(statements[4]).toContain('FROM user_asset_ranking_cards_next rc');
    expect(statements[4]).not.toContain('FROM user_cards');
    expect(statements[4]).toContain('SUM(rc.card_count) AS card_count');
    expect(statements[4]).toContain('rc.card_count * s.base_value * (1 + rc.star * 0.8)');
    expect(statements[4]).toContain('FROM users u LEFT JOIN CardValues cv ON cv.user_id = u.id');
    expect(statements[4]).toContain('COALESCE(cv.card_count, 0)');
    expect(statements[4]).toContain('u.banned_until IS NULL OR u.banned_until <= NOW()');
    expect(statements[4]).toContain('ROUND(cards_value_raw)::BIGINT');
    expect(statements[5]).toContain('CREATE UNIQUE INDEX');
    expect(statements[5]).toContain('(user_id)');
  });

  it('updates changed card groups, inserts missing groups, and deletes rows absent from staging', async () => {
    const statements: string[] = [];
    const tx = {
      run: vi.fn(async (sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return { changes: 0 };
      })
    };

    await syncPostgresUserRankingSnapshotTables(tx);

    expect(statements).toHaveLength(6);
    expect(statements[0]).toContain('ON CONFLICT (user_id) DO UPDATE');
    expect(statements[0]).toContain('IS DISTINCT FROM');
    expect(statements[1]).toContain('UPDATE user_asset_ranking_cards AS existing');
    expect(statements[1]).toContain('FROM user_asset_ranking_cards_next AS next');
    expect(statements[1]).toContain('existing.card_count IS DISTINCT FROM next.card_count');
    expect(statements[2]).toContain('INSERT INTO user_asset_ranking_cards AS existing');
    expect(statements[2]).toContain('WHERE NOT EXISTS');
    expect(statements[2]).toContain('FROM user_asset_ranking_cards AS current');
    expect(statements[2]).toContain('ON CONFLICT (user_id, channel_id, star) DO UPDATE');
    expect(statements[2]).toContain('existing.card_count IS DISTINCT FROM EXCLUDED.card_count');
    // NOT EXISTS deletion also clears the live table when staging is empty.
    expect(statements[3]).toContain('DELETE FROM user_asset_ranking_cards AS existing WHERE NOT EXISTS');
    expect(statements[4]).toContain('DELETE FROM user_asset_rankings AS existing WHERE NOT EXISTS');
    expect(statements[5]).toContain('UPDATE user_asset_rankings SET snapshot_at = NOW()');
    expect(statements).not.toContain('DELETE FROM user_asset_ranking_cards');
    expect(statements).not.toContain('DELETE FROM user_asset_rankings');
  });
});
