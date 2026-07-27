import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
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
    expect(schemaSql).toContain('idx_arena_v2_matches_timeout_scan ON arena_v2_matches(status, updated_at)');
    expect(schemaSql).toContain('arena_v2_replay_holds');
    expect(schemaSql).toContain('idx_arena_v2_replay_holds_match');
  });

  it('defines every persisted arena cosmetic loadout slot', () => {
    let schemaSql = '';
    ensureArenaV2SqliteSchema({ exec: (sql: string) => { schemaSql += sql; } } as any);

    for (let slot = 1; slot <= 8; slot += 1) {
      expect(schemaSql).toContain(`emote_slot_${slot}_item_id`);
    }
    for (const column of [
      'card_frame_item_id',
      'name_flare_item_id',
      'hit_vfx_item_id',
      'summon_vfx_item_id',
      'ready_stamp_item_id',
      'nameplate_item_id',
      'ko_text_item_id'
    ]) {
      expect(schemaSql).toContain(column);
    }
  });

  it('upgrades a legacy quick queue before creating ready-check indexes', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`
        CREATE TABLE arena_v2_match_queue (
          id TEXT PRIMARY KEY,
          season_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          deck_id TEXT NOT NULL,
          mmr INTEGER NOT NULL,
          status TEXT NOT NULL,
          search_min_mmr INTEGER NOT NULL,
          search_max_mmr INTEGER NOT NULL,
          matched_match_id TEXT,
          joined_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
      `);

      expect(() => ensureArenaV2SqliteSchema(db as any)).not.toThrow();

      const columns = new Set(
        db.prepare('PRAGMA table_info(arena_v2_match_queue)').all().map((row: any) => row.name)
      );
      for (const column of ['proposal_id', 'accept_deadline_at', 'accepted_at', 'last_transition_reason']) {
        expect(columns.has(column)).toBe(true);
      }
      const indexes = new Set(
        db.prepare('PRAGMA index_list(arena_v2_match_queue)').all().map((row: any) => row.name)
      );
      expect(indexes.has('idx_arena_v2_match_queue_accept_deadline')).toBe(true);
      expect(indexes.has('idx_arena_v2_match_queue_proposal')).toBe(true);
    } finally {
      db.close();
    }
  });
});
