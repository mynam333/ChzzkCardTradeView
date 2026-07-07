import { describe, expect, it } from 'vitest';
import { ARENA_V2_TABLES, ensureArenaV2SqliteSchema } from '../services/arenaV2SchemaMigration';

describe('arena v2 schema migration', () => {
  it('emits every GDD-required arena_v2 table in SQLite schema SQL', () => {
    let schemaSql = '';
    const db = {
      exec: (sql: string) => {
        schemaSql += sql;
      }
    };

    ensureArenaV2SqliteSchema(db as any);

    for (const table of ARENA_V2_TABLES) {
      expect(schemaSql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it('defines queue uniqueness and replay hold indexes required by the GDD', () => {
    let schemaSql = '';
    ensureArenaV2SqliteSchema({ exec: (sql: string) => { schemaSql += sql; } } as any);

    expect(schemaSql).toContain("uniq_arena_v2_match_queue_waiting");
    expect(schemaSql).toContain("WHERE status = 'waiting'");
    expect(schemaSql).toContain('arena_v2_replay_holds');
    expect(schemaSql).toContain('idx_arena_v2_replay_holds_match');
  });
});
