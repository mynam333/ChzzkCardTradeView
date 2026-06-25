import Database from 'better-sqlite3';
import { MysqlDb } from './mysqlDb';

const ensureMysqlColumn = async (db: MysqlDb, table: string, column: string, ddl: string) => {
  const row = await db.get(
    `
      SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?
         AND COLUMN_NAME = ?
       LIMIT 1
    `,
    table,
    column
  );
  if (!row) await db.run(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
};

const ensureSqliteColumn = (db: Database.Database, table: string, column: string, ddl: string) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run();
  }
};

export const ensureArenaMysqlSchema = async (db: MysqlDb) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_decks (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      season_id VARCHAR(64) NOT NULL,
      name VARCHAR(80) NOT NULL,
      cards_json JSON NOT NULL,
      round_plans_json JSON NOT NULL,
      deck_hash VARCHAR(128) NOT NULL,
      validation_status VARCHAR(32) NOT NULL DEFAULT 'VALID',
      validation_result_json JSON NULL,
      last_used_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_arena_decks_user (user_id, season_id, updated_at),
      INDEX idx_arena_decks_hash (deck_hash),
      INDEX idx_arena_decks_validation (season_id, validation_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_matches (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      season_id VARCHAR(64) NOT NULL,
      match_type VARCHAR(32) NOT NULL,
      match_format VARCHAR(32) NOT NULL DEFAULT 'best_of_five',
      rounds_to_win TINYINT NOT NULL DEFAULT 3,
      round_count TINYINT NOT NULL,
      player_a_id VARCHAR(191) NOT NULL,
      player_b_id VARCHAR(191) NULL,
      player_a_deck_id BIGINT NULL,
      winner_user_id VARCHAR(191) NULL,
      player_a_round_wins TINYINT NOT NULL DEFAULT 0,
      player_b_round_wins TINYINT NOT NULL DEFAULT 0,
      draw_rounds TINYINT NOT NULL DEFAULT 0,
      difficulty VARCHAR(16) NOT NULL DEFAULT 'normal',
      summary_json JSON NOT NULL,
      progress_status VARCHAR(24) NOT NULL DEFAULT 'COMPLETED',
      pending_round_deadline_at DATETIME NULL,
      replay_json JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_arena_matches_player_a (player_a_id, created_at),
      INDEX idx_arena_matches_player_b (player_b_id, created_at),
      INDEX idx_arena_matches_season_created (season_id, created_at),
      INDEX idx_arena_matches_type_created (match_type, created_at),
      INDEX idx_arena_matches_season_type_id (season_id, match_type, id),
      INDEX idx_arena_matches_pair_a_recent (season_id, match_type, player_a_id, created_at),
      INDEX idx_arena_matches_pair_b_recent (season_id, match_type, player_b_id, created_at),
      INDEX idx_arena_matches_round_recovery (season_id, progress_status, pending_round_deadline_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureMysqlColumn(db, 'arena_matches', 'progress_status', "progress_status VARCHAR(24) NOT NULL DEFAULT 'COMPLETED'");
  await ensureMysqlColumn(db, 'arena_matches', 'pending_round_deadline_at', 'pending_round_deadline_at DATETIME NULL');
  await db.run(`ALTER TABLE arena_matches ADD INDEX idx_arena_matches_round_recovery (season_id, progress_status, pending_round_deadline_at)`).catch(() => undefined);
  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_player_ratings (
      season_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(191) NOT NULL,
      mmr INT NOT NULL DEFAULT 1000,
      rating_points INT NOT NULL DEFAULT 0,
      tier VARCHAR(32) NOT NULL DEFAULT 'BRONZE',
      wins INT NOT NULL DEFAULT 0,
      losses INT NOT NULL DEFAULT 0,
      draws INT NOT NULL DEFAULT 0,
      last_played_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (season_id, user_id),
      INDEX idx_arena_rating_points (season_id, rating_points),
      INDEX idx_arena_rating_mmr (season_id, mmr)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_match_replays (
      match_id BIGINT NOT NULL PRIMARY KEY,
      replay_json JSON NOT NULL,
      replay_bytes INT NOT NULL DEFAULT 0,
      event_count INT NOT NULL DEFAULT 0,
      expires_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_arena_match_replays_expire (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_rank_snapshots (
      season_id VARCHAR(64) NOT NULL,
      rank_type VARCHAR(32) NOT NULL,
      rank_no INT NOT NULL,
      user_id VARCHAR(191) NOT NULL,
      score INT NOT NULL DEFAULT 0,
      payload_json JSON NOT NULL,
      snapshot_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (season_id, rank_type, rank_no),
      UNIQUE KEY uniq_arena_rank_user (season_id, rank_type, user_id),
      INDEX idx_arena_rank_score (season_id, rank_type, score)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_match_queue (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      season_id VARCHAR(64) NOT NULL,
      deck_id VARCHAR(64) NOT NULL,
      deck_hash VARCHAR(128) NOT NULL,
      round_plan_hash VARCHAR(128) NOT NULL,
      mmr INT NOT NULL,
      mmr_bucket INT NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'WAITING',
      queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      matched_match_id BIGINT NULL,
      INDEX idx_arena_queue_bucket (season_id, status, mmr_bucket, queued_at),
      INDEX idx_arena_queue_user (user_id, season_id, status, queued_at),
      INDEX idx_arena_queue_expire (status, expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_cups (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      season_id VARCHAR(64) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED',
      participant_count TINYINT NOT NULL DEFAULT 8,
      champion_user_id VARCHAR(191) NULL,
      bracket_json JSON NOT NULL,
      replay_json JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME NULL,
      INDEX idx_arena_cups_season_created (season_id, created_at),
      INDEX idx_arena_cups_champion (season_id, champion_user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_cup_replays (
      cup_id BIGINT NOT NULL PRIMARY KEY,
      replay_json JSON NOT NULL,
      replay_bytes INT NOT NULL DEFAULT 0,
      event_count INT NOT NULL DEFAULT 0,
      expires_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_arena_cup_replays_expire (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_cup_queue (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      season_id VARCHAR(64) NOT NULL,
      deck_id VARCHAR(64) NOT NULL,
      deck_hash VARCHAR(128) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'WAITING',
      queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      cup_id BIGINT NULL,
      INDEX idx_arena_cup_queue_waiting (season_id, status, queued_at),
      INDEX idx_arena_cup_queue_user (user_id, season_id, status, queued_at),
      INDEX idx_arena_cup_queue_expire (status, expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_admin_stat_snapshots (
      season_id VARCHAR(64) NOT NULL,
      snapshot_type VARCHAR(64) NOT NULL,
      metric_key VARCHAR(191) NOT NULL,
      sample_count INT NOT NULL DEFAULT 0,
      wins INT NOT NULL DEFAULT 0,
      losses INT NOT NULL DEFAULT 0,
      draws INT NOT NULL DEFAULT 0,
      payload_json JSON NOT NULL,
      snapshot_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (season_id, snapshot_type, metric_key),
      INDEX idx_arena_admin_stats_sample (season_id, snapshot_type, sample_count)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_admin_jobs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      job_type VARCHAR(64) NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'QUEUED',
      payload_json JSON NULL,
      result_json JSON NULL,
      error_message VARCHAR(500) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME NULL,
      finished_at DATETIME NULL,
      INDEX idx_arena_admin_jobs_status (status, created_at),
      INDEX idx_arena_admin_jobs_type_status (job_type, status, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_admin_audit_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      admin_user_id VARCHAR(191) NOT NULL,
      action_type VARCHAR(80) NOT NULL,
      target_type VARCHAR(80) NOT NULL,
      target_id VARCHAR(191) NULL,
      reason VARCHAR(500) NULL,
      payload_json JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_arena_admin_audit_created (created_at),
      INDEX idx_arena_admin_audit_target (target_type, target_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_spectator_links (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      token_hash VARCHAR(128) NOT NULL UNIQUE,
      match_id BIGINT NOT NULL,
      owner_user_id VARCHAR(191) NOT NULL,
      visibility VARCHAR(24) NOT NULL DEFAULT 'LINK_ONLY',
      expires_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revoked_at DATETIME NULL,
      INDEX idx_arena_spectator_links_match (match_id),
      INDEX idx_arena_spectator_links_owner (owner_user_id, created_at),
      INDEX idx_arena_spectator_links_expire (visibility, expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_user_cosmetic_loadouts (
      user_id VARCHAR(191) NOT NULL PRIMARY KEY,
      border_item_id BIGINT NULL,
      name_effect_item_id BIGINT NULL,
      emote_slot_1_item_id BIGINT NULL,
      emote_slot_2_item_id BIGINT NULL,
      emote_slot_3_item_id BIGINT NULL,
      emote_slot_4_item_id BIGINT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_arena_cosmetic_border (border_item_id),
      INDEX idx_arena_cosmetic_name_effect (name_effect_item_id),
      INDEX idx_arena_cosmetic_emote_1 (emote_slot_1_item_id),
      INDEX idx_arena_cosmetic_emote_2 (emote_slot_2_item_id),
      INDEX idx_arena_cosmetic_emote_3 (emote_slot_3_item_id),
      INDEX idx_arena_cosmetic_emote_4 (emote_slot_4_item_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureMysqlColumn(db, 'arena_user_cosmetic_loadouts', 'emote_slot_1_item_id', 'emote_slot_1_item_id BIGINT NULL');
  await ensureMysqlColumn(db, 'arena_user_cosmetic_loadouts', 'emote_slot_2_item_id', 'emote_slot_2_item_id BIGINT NULL');
  await ensureMysqlColumn(db, 'arena_user_cosmetic_loadouts', 'emote_slot_3_item_id', 'emote_slot_3_item_id BIGINT NULL');
  await ensureMysqlColumn(db, 'arena_user_cosmetic_loadouts', 'emote_slot_4_item_id', 'emote_slot_4_item_id BIGINT NULL');
};

export const ensureArenaSqliteSchema = (db: Database.Database) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS arena_decks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      season_id TEXT NOT NULL,
      name TEXT NOT NULL,
      cards_json TEXT NOT NULL,
      round_plans_json TEXT NOT NULL,
      deck_hash TEXT NOT NULL,
      validation_status TEXT NOT NULL DEFAULT 'VALID',
      validation_result_json TEXT,
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_arena_decks_user ON arena_decks (user_id, season_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_arena_decks_hash ON arena_decks (deck_hash);
    CREATE INDEX IF NOT EXISTS idx_arena_decks_validation ON arena_decks (season_id, validation_status);

    CREATE TABLE IF NOT EXISTS arena_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      season_id TEXT NOT NULL,
      match_type TEXT NOT NULL,
      match_format TEXT NOT NULL DEFAULT 'best_of_five',
      rounds_to_win INTEGER NOT NULL DEFAULT 3,
      round_count INTEGER NOT NULL,
      player_a_id TEXT NOT NULL,
      player_b_id TEXT,
      player_a_deck_id INTEGER,
      winner_user_id TEXT,
      player_a_round_wins INTEGER NOT NULL DEFAULT 0,
      player_b_round_wins INTEGER NOT NULL DEFAULT 0,
      draw_rounds INTEGER NOT NULL DEFAULT 0,
      difficulty TEXT NOT NULL DEFAULT 'normal',
      summary_json TEXT NOT NULL,
      progress_status TEXT NOT NULL DEFAULT 'COMPLETED',
      pending_round_deadline_at TEXT,
      replay_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_arena_matches_player_a ON arena_matches (player_a_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_arena_matches_player_b ON arena_matches (player_b_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_arena_matches_season_created ON arena_matches (season_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_arena_matches_type_created ON arena_matches (match_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_arena_matches_season_type_id ON arena_matches (season_id, match_type, id);
    CREATE INDEX IF NOT EXISTS idx_arena_matches_pair_a_recent ON arena_matches (season_id, match_type, player_a_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_arena_matches_pair_b_recent ON arena_matches (season_id, match_type, player_b_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_arena_matches_round_recovery ON arena_matches (season_id, progress_status, pending_round_deadline_at);

    CREATE TABLE IF NOT EXISTS arena_player_ratings (
      season_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      mmr INTEGER NOT NULL DEFAULT 1000,
      rating_points INTEGER NOT NULL DEFAULT 0,
      tier TEXT NOT NULL DEFAULT 'BRONZE',
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0,
      last_played_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (season_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_arena_rating_points ON arena_player_ratings (season_id, rating_points);
    CREATE INDEX IF NOT EXISTS idx_arena_rating_mmr ON arena_player_ratings (season_id, mmr);

    CREATE TABLE IF NOT EXISTS arena_match_replays (
      match_id INTEGER NOT NULL PRIMARY KEY,
      replay_json TEXT NOT NULL,
      replay_bytes INTEGER NOT NULL DEFAULT 0,
      event_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_arena_match_replays_expire ON arena_match_replays (expires_at);

    CREATE TABLE IF NOT EXISTS arena_rank_snapshots (
      season_id TEXT NOT NULL,
      rank_type TEXT NOT NULL,
      rank_no INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL,
      snapshot_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (season_id, rank_type, rank_no)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_arena_rank_user ON arena_rank_snapshots (season_id, rank_type, user_id);
    CREATE INDEX IF NOT EXISTS idx_arena_rank_score ON arena_rank_snapshots (season_id, rank_type, score);

    CREATE TABLE IF NOT EXISTS arena_match_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      season_id TEXT NOT NULL,
      deck_id TEXT NOT NULL,
      deck_hash TEXT NOT NULL,
      round_plan_hash TEXT NOT NULL,
      mmr INTEGER NOT NULL,
      mmr_bucket INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'WAITING',
      queued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      matched_match_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_arena_queue_bucket ON arena_match_queue (season_id, status, mmr_bucket, queued_at);
    CREATE INDEX IF NOT EXISTS idx_arena_queue_user ON arena_match_queue (user_id, season_id, status, queued_at);
    CREATE INDEX IF NOT EXISTS idx_arena_queue_expire ON arena_match_queue (status, expires_at);

    CREATE TABLE IF NOT EXISTS arena_cups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      season_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      participant_count INTEGER NOT NULL DEFAULT 8,
      champion_user_id TEXT,
      bracket_json TEXT NOT NULL,
      replay_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_arena_cups_season_created ON arena_cups (season_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_arena_cups_champion ON arena_cups (season_id, champion_user_id);

    CREATE TABLE IF NOT EXISTS arena_cup_replays (
      cup_id INTEGER NOT NULL PRIMARY KEY,
      replay_json TEXT NOT NULL,
      replay_bytes INTEGER NOT NULL DEFAULT 0,
      event_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_arena_cup_replays_expire ON arena_cup_replays (expires_at);

    CREATE TABLE IF NOT EXISTS arena_cup_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      season_id TEXT NOT NULL,
      deck_id TEXT NOT NULL,
      deck_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'WAITING',
      queued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      cup_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_arena_cup_queue_waiting ON arena_cup_queue (season_id, status, queued_at);
    CREATE INDEX IF NOT EXISTS idx_arena_cup_queue_user ON arena_cup_queue (user_id, season_id, status, queued_at);
    CREATE INDEX IF NOT EXISTS idx_arena_cup_queue_expire ON arena_cup_queue (status, expires_at);

    CREATE TABLE IF NOT EXISTS arena_admin_stat_snapshots (
      season_id TEXT NOT NULL,
      snapshot_type TEXT NOT NULL,
      metric_key TEXT NOT NULL,
      sample_count INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL,
      snapshot_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (season_id, snapshot_type, metric_key)
    );
    CREATE INDEX IF NOT EXISTS idx_arena_admin_stats_sample ON arena_admin_stat_snapshots (season_id, snapshot_type, sample_count);

    CREATE TABLE IF NOT EXISTS arena_admin_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'QUEUED',
      payload_json TEXT,
      result_json TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_arena_admin_jobs_status ON arena_admin_jobs (status, created_at);
    CREATE INDEX IF NOT EXISTS idx_arena_admin_jobs_type_status ON arena_admin_jobs (job_type, status, created_at);

    CREATE TABLE IF NOT EXISTS arena_admin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_user_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      reason TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_arena_admin_audit_created ON arena_admin_audit_logs (created_at);
    CREATE INDEX IF NOT EXISTS idx_arena_admin_audit_target ON arena_admin_audit_logs (target_type, target_id, created_at);

    CREATE TABLE IF NOT EXISTS arena_spectator_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      match_id INTEGER NOT NULL,
      owner_user_id TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'LINK_ONLY',
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_arena_spectator_links_match ON arena_spectator_links (match_id);
    CREATE INDEX IF NOT EXISTS idx_arena_spectator_links_owner ON arena_spectator_links (owner_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_arena_spectator_links_expire ON arena_spectator_links (visibility, expires_at);

    CREATE TABLE IF NOT EXISTS arena_user_cosmetic_loadouts (
      user_id TEXT NOT NULL PRIMARY KEY,
      border_item_id INTEGER,
      name_effect_item_id INTEGER,
      emote_slot_1_item_id INTEGER,
      emote_slot_2_item_id INTEGER,
      emote_slot_3_item_id INTEGER,
      emote_slot_4_item_id INTEGER,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_arena_cosmetic_border ON arena_user_cosmetic_loadouts (border_item_id);
    CREATE INDEX IF NOT EXISTS idx_arena_cosmetic_name_effect ON arena_user_cosmetic_loadouts (name_effect_item_id);
    CREATE INDEX IF NOT EXISTS idx_arena_cosmetic_emote_1 ON arena_user_cosmetic_loadouts (emote_slot_1_item_id);
    CREATE INDEX IF NOT EXISTS idx_arena_cosmetic_emote_2 ON arena_user_cosmetic_loadouts (emote_slot_2_item_id);
    CREATE INDEX IF NOT EXISTS idx_arena_cosmetic_emote_3 ON arena_user_cosmetic_loadouts (emote_slot_3_item_id);
    CREATE INDEX IF NOT EXISTS idx_arena_cosmetic_emote_4 ON arena_user_cosmetic_loadouts (emote_slot_4_item_id);
  `);
  ensureSqliteColumn(db, 'arena_matches', 'progress_status', "progress_status TEXT NOT NULL DEFAULT 'COMPLETED'");
  ensureSqliteColumn(db, 'arena_matches', 'pending_round_deadline_at', 'pending_round_deadline_at TEXT');
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_arena_matches_round_recovery ON arena_matches (season_id, progress_status, pending_round_deadline_at)`).run();
  ensureSqliteColumn(db, 'arena_user_cosmetic_loadouts', 'emote_slot_1_item_id', 'emote_slot_1_item_id INTEGER');
  ensureSqliteColumn(db, 'arena_user_cosmetic_loadouts', 'emote_slot_2_item_id', 'emote_slot_2_item_id INTEGER');
  ensureSqliteColumn(db, 'arena_user_cosmetic_loadouts', 'emote_slot_3_item_id', 'emote_slot_3_item_id INTEGER');
  ensureSqliteColumn(db, 'arena_user_cosmetic_loadouts', 'emote_slot_4_item_id', 'emote_slot_4_item_id INTEGER');
};
