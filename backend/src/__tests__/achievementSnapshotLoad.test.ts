import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: { run: vi.fn(), get: vi.fn(), all: vi.fn() },
  dialect: 'postgres' as string
}));
vi.mock('../services/db', () => ({
  getDbMode: () => 'MYSQL',
  getMysqlDb: () => mocks.db,
  getSqlDialect: () => mocks.dialect
}));

beforeEach(() => {
  vi.resetModules();
  mocks.dialect = 'postgres';
  mocks.db.run.mockReset().mockResolvedValue({ changes: 1 });
  mocks.db.get.mockReset().mockResolvedValue({ point: 1000 });
  mocks.db.all.mockReset().mockResolvedValue([]);
});

describe('achievement database load', () => {
  it('does not scan historical rows when PostgreSQL already enforces the required unique keys', async () => {
    mocks.db.all.mockResolvedValue([
      { table_name: 'achievements', key_columns: 'code' },
      { table_name: 'user_achievements', key_columns: 'achievement_id,repeat_key,user_id' },
      { table_name: 'user_achievement_stats', key_columns: 'stat_key,user_id' },
      { table_name: 'achievement_grant_logs', key_columns: 'achievement_id,repeat_key,user_id' },
      { table_name: 'achievement_events', key_columns: 'event_key' },
      { table_name: 'achievement_evaluation_queue', key_columns: 'dedupe_key' }
    ]);
    const { ensureAchievementTables } = await import('../services/achievementService');
    await ensureAchievementTables();
    expect(mocks.db.run.mock.calls.filter(([sql]) => /ROW_NUMBER\(\) OVER/.test(sql))).toHaveLength(0);
    const indexQuery = mocks.db.all.mock.calls.find(([sql]) => /FROM pg_index/.test(sql))?.[0];
    expect(indexQuery).toContain('index_info.indisvalid');
    expect(indexQuery).toContain('index_info.indpred IS NULL');
    expect(indexQuery).toContain('key_column.position <= index_info.indnkeyatts');
  });

  it('retains duplicate cleanup only for keys whose unique index is missing', async () => {
    mocks.db.all.mockResolvedValue([{ table_name: 'achievement_events', key_columns: 'event_key' }]);
    const { ensureAchievementTables } = await import('../services/achievementService');
    await ensureAchievementTables();
    const scans = mocks.db.run.mock.calls.filter(([sql]) => /ROW_NUMBER\(\) OVER/.test(sql));
    expect(scans).toHaveLength(5);
    expect(scans.every(([sql]) => !/DELETE FROM achievement_events\s/.test(sql))).toBe(true);
  });

  it('shares first-request schema initialization across simultaneous events', async () => {
    let resume!: () => void;
    mocks.db.run.mockImplementationOnce(() => new Promise(resolve => { resume = () => resolve({ changes: 0 }); }));
    const { ensureAchievementTables } = await import('../services/achievementService');
    const requests = Array.from({ length: 15 }, () => ensureAchievementTables());
    expect(mocks.db.run).toHaveBeenCalledTimes(1);
    resume();
    await Promise.all(requests);
    const creates = mocks.db.run.mock.calls.filter(([sql]) => /CREATE TABLE IF NOT EXISTS achievements\s*\(/.test(sql));
    expect(creates).toHaveLength(1);
  });

  it('batches snapshot writes and avoids rewriting unchanged PostgreSQL statistics', async () => {
    const { ensureAchievementTables, recomputeSnapshotStats } = await import('../services/achievementService');
    await ensureAchievementTables();
    mocks.db.run.mockClear();
    await recomputeSnapshotStats('owner');
    const snapshots = mocks.db.run.mock.calls.filter(([sql]) => /IS DISTINCT FROM/.test(sql));
    expect(snapshots).toHaveLength(1);
    const [sql, ...params] = snapshots[0];
    expect(sql).toContain('ON CONFLICT (user_id, stat_key)');
    expect(params.length / 3).toBeGreaterThan(40);
    expect(params).toContain('inventory.locked_count');
    expect(params).toContain('user.point_balance');
    // One independent balance write preserves fallback behavior if an optional table is unavailable.
    expect(mocks.db.run.mock.calls.filter(([statement]) => /INSERT INTO user_achievement_stats/.test(statement))).toHaveLength(2);
  });

  it('retains the MySQL batch upsert syntax', async () => {
    mocks.dialect = 'mysql';
    const { ensureAchievementTables, recomputeSnapshotStats } = await import('../services/achievementService');
    await ensureAchievementTables();
    mocks.db.run.mockClear();
    await recomputeSnapshotStats('owner');
    const batch = mocks.db.run.mock.calls.find(([, ...params]) => params.length > 100);
    expect(batch?.[0]).toContain('ON DUPLICATE KEY UPDATE');
    expect(batch?.[0]).not.toContain('IS DISTINCT FROM');
  });

  it('refreshes snapshots once when an event requests evaluation and refresh together', async () => {
    const { ensureAchievementTables, recordAchievementEvent } = await import('../services/achievementService');
    await ensureAchievementTables();
    mocks.db.get.mockClear();
    await recordAchievementEvent({ userId: 'owner', eventKey: 'batch:1', eventType: 'card.settings', refreshSnapshots: true });
    expect(mocks.db.get.mock.calls.filter(([sql]) => /COUNT\(\*\) AS card_count/.test(sql))).toHaveLength(1);
  });

  it('still refreshes snapshots when explicitly skipping evaluation', async () => {
    const { ensureAchievementTables, recordAchievementEvent } = await import('../services/achievementService');
    await ensureAchievementTables();
    mocks.db.get.mockClear();
    await recordAchievementEvent({ userId: 'owner', eventKey: 'batch:1', eventType: 'card.settings', refreshSnapshots: true, evaluate: false });
    expect(mocks.db.get.mock.calls.filter(([sql]) => /COUNT\(\*\) AS card_count/.test(sql))).toHaveLength(1);
  });
});
