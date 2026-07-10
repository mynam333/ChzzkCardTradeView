import Database from 'better-sqlite3';
import { MysqlDb } from './mysqlDb';
import { PostgresDb } from './postgresDb';

type SqlRunner = MysqlDb | PostgresDb;

export const ARENA_V2_TABLES = [
  'arena_v2_seasons',
  'arena_v2_card_versions',
  'arena_v2_decks',
  'arena_v2_match_queue',
  'arena_v2_battle_royale_queue',
  'arena_v2_matches',
  'arena_v2_match_players',
  'arena_v2_card_instances',
  'arena_v2_action_submissions',
  'arena_v2_replay_events',
  'arena_v2_ratings',
  'arena_v2_reward_grants',
  'arena_v2_battle_royales',
  'arena_v2_replay_holds',
  'arena_v2_reports',
  'arena_v2_streamer_right_requests',
  'arena_user_cosmetic_loadouts',
  'arena_v2_admin_audit_logs'
] as const;

export const ensureArenaV2MysqlSchema = async (db: SqlRunner) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_v2_seasons (
      id VARCHAR(64) PRIMARY KEY,
      season_key VARCHAR(64) NOT NULL UNIQUE,
      name VARCHAR(120) NOT NULL,
      status VARCHAR(24) NOT NULL,
      starts_at DATETIME NOT NULL,
      ends_at DATETIME NOT NULL,
      modes_enabled JSON NOT NULL,
      card_pool_version VARCHAR(64) NOT NULL,
      balance_version VARCHAR(64) NOT NULL,
      reward_table JSON NOT NULL,
      mmr_tier_table JSON NOT NULL,
      replay_retention_days INT NOT NULL DEFAULT 7,
      created_by VARCHAR(191) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_arena_v2_seasons_status_time (status, starts_at, ends_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_v2_card_versions (
      id VARCHAR(64) PRIMARY KEY,
      streamer_id VARCHAR(191) NOT NULL,
      display_name VARCHAR(120) NOT NULL,
      season_id VARCHAR(64) NOT NULL,
      version INT NOT NULL,
      card_class VARCHAR(32) NOT NULL,
      cost INT NOT NULL,
      attack INT NOT NULL,
      health INT NOT NULL,
      keywords JSON NOT NULL,
      balance_score DECIMAL(10, 2) NOT NULL DEFAULT 0,
      validation_result JSON NOT NULL,
      art_asset_id TEXT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'draft',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_arena_v2_cards_season_status (season_id, status),
      INDEX idx_arena_v2_cards_streamer_season (streamer_id, season_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_v2_decks (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      season_id VARCHAR(64) NOT NULL,
      name VARCHAR(80) NOT NULL,
      mode_scope VARCHAR(24) NOT NULL,
      card_version_ids JSON NOT NULL,
      validation_hash VARCHAR(128) NOT NULL,
      is_valid TINYINT NOT NULL DEFAULT 0,
      validation_result JSON NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_arena_v2_decks_user_season (user_id, season_id),
      INDEX idx_arena_v2_decks_season_valid (season_id, is_valid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_v2_match_queue (
      id VARCHAR(64) PRIMARY KEY,
      season_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(191) NOT NULL,
      deck_id VARCHAR(64) NOT NULL,
      mmr INT NOT NULL DEFAULT 1000,
      status VARCHAR(24) NOT NULL DEFAULT 'waiting',
      search_min_mmr INT NOT NULL DEFAULT 1000,
      search_max_mmr INT NOT NULL DEFAULT 1000,
      matched_match_id VARCHAR(64) NULL,
      joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      INDEX idx_arena_v2_match_queue_search (season_id, status, mmr, joined_at),
      INDEX idx_arena_v2_match_queue_user (season_id, user_id, status),
      INDEX idx_arena_v2_match_queue_expire (status, expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_v2_battle_royale_queue (
      id VARCHAR(64) PRIMARY KEY,
      season_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(191) NOT NULL,
      deck_id VARCHAR(64) NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'waiting',
      battle_royale_id VARCHAR(64) NULL,
      joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      INDEX idx_arena_v2_br_queue_waiting (season_id, status, joined_at),
      INDEX idx_arena_v2_br_queue_user (season_id, user_id, status),
      INDEX idx_arena_v2_br_queue_expire (status, expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_v2_matches (
      id VARCHAR(64) PRIMARY KEY,
      season_id VARCHAR(64) NULL,
      mode VARCHAR(24) NOT NULL,
      status VARCHAR(32) NOT NULL,
      battle_royale_id VARCHAR(64) NULL,
      round_no INT NOT NULL DEFAULT 0,
      turn_no INT NOT NULL DEFAULT 1,
      rng_seed VARCHAR(191) NOT NULL,
      rules_version VARCHAR(64) NOT NULL,
      card_pool_version VARCHAR(64) NOT NULL,
      started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME NULL,
      winner_user_id VARCHAR(191) NULL,
      result_summary JSON NOT NULL,
      replay_expires_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_arena_v2_matches_season_mode_status (season_id, mode, status),
      INDEX idx_arena_v2_matches_br_round (battle_royale_id, round_no),
      INDEX idx_arena_v2_matches_replay_expire (replay_expires_at),
      INDEX idx_arena_v2_matches_finished (finished_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_v2_match_players (
      id VARCHAR(64) PRIMARY KEY,
      match_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(191) NULL,
      seat_no INT NOT NULL,
      deck_id VARCHAR(64) NULL,
      player_health INT NOT NULL DEFAULT 30,
      fatigue_count INT NOT NULL DEFAULT 0,
      initial_deck_order JSON NOT NULL,
      hand_card_instance_ids JSON NOT NULL,
      deck_card_instance_ids JSON NOT NULL,
      graveyard_card_instance_ids JSON NOT NULL,
      board_state JSON NOT NULL,
      mulligan_state JSON NOT NULL,
      final_rank INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_arena_v2_match_player_seat (match_id, seat_no),
      INDEX idx_arena_v2_match_players_user (match_id, user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_v2_card_instances (
      id VARCHAR(64) PRIMARY KEY,
      match_id VARCHAR(64) NOT NULL,
      owner_seat_no INT NOT NULL,
      card_version_id VARCHAR(64) NOT NULL,
      zone VARCHAR(24) NOT NULL,
      position JSON NULL,
      current_attack INT NOT NULL,
      current_health INT NOT NULL,
      damage_taken INT NOT NULL DEFAULT 0,
      status_effects JSON NOT NULL,
      created_turn INT NOT NULL DEFAULT 0,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_arena_v2_card_instances_zone (match_id, owner_seat_no, zone),
      INDEX idx_arena_v2_card_instances_version (match_id, card_version_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_v2_action_submissions (
      id VARCHAR(64) PRIMARY KEY,
      match_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(191) NOT NULL,
      seat_no INT NOT NULL,
      turn_no INT NOT NULL,
      revision INT NOT NULL,
      action_payload JSON NOT NULL,
      validation_result JSON NOT NULL,
      is_final TINYINT NOT NULL DEFAULT 0,
      submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_arena_v2_action_revision (match_id, seat_no, turn_no, revision),
      INDEX idx_arena_v2_action_final (match_id, turn_no, is_final)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_v2_replay_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      match_id VARCHAR(64) NOT NULL,
      seq INT NOT NULL,
      turn_no INT NOT NULL,
      event_type VARCHAR(64) NOT NULL,
      payload JSON NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      UNIQUE KEY uniq_arena_v2_replay_seq (match_id, seq),
      INDEX idx_arena_v2_replay_expire (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_v2_ratings (
      id VARCHAR(64) PRIMARY KEY,
      season_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(191) NOT NULL,
      mmr INT NOT NULL DEFAULT 1000,
      peak_mmr INT NOT NULL DEFAULT 1000,
      tier VARCHAR(32) NOT NULL DEFAULT 'bronze',
      peak_tier VARCHAR(32) NOT NULL DEFAULT 'bronze',
      wins INT NOT NULL DEFAULT 0,
      losses INT NOT NULL DEFAULT 0,
      draws INT NOT NULL DEFAULT 0,
      last_match_id VARCHAR(64) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_arena_v2_rating_user (season_id, user_id),
      INDEX idx_arena_v2_ratings_mmr (season_id, mmr),
      INDEX idx_arena_v2_ratings_peak (season_id, peak_mmr)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_v2_reward_grants (
      id VARCHAR(64) PRIMARY KEY,
      season_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(191) NOT NULL,
      reward_basis JSON NOT NULL,
      reward_items JSON NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'pending',
      hold_reason TEXT NULL,
      idempotency_key VARCHAR(191) NOT NULL UNIQUE,
      granted_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_arena_v2_reward_user (season_id, user_id),
      INDEX idx_arena_v2_rewards_status (season_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_v2_battle_royales (
      id VARCHAR(64) PRIMARY KEY,
      season_id VARCHAR(64) NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'forming',
      current_round_no INT NOT NULL DEFAULT 0,
      participant_state JSON NOT NULL,
      match_ids JSON NOT NULL,
      winner_user_id VARCHAR(191) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      finished_at DATETIME NULL,
      INDEX idx_arena_v2_br_status (season_id, status),
      INDEX idx_arena_v2_br_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_v2_replay_holds (
      id VARCHAR(64) PRIMARY KEY,
      match_id VARCHAR(64) NOT NULL,
      reason TEXT NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'active',
      hold_until DATETIME NULL,
      created_by VARCHAR(191) NOT NULL,
      released_by VARCHAR(191) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      released_at DATETIME NULL,
      INDEX idx_arena_v2_replay_holds_match (match_id, status),
      INDEX idx_arena_v2_replay_holds_until (status, hold_until)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_v2_reports (
      id VARCHAR(64) PRIMARY KEY,
      reporter_user_id VARCHAR(191) NOT NULL,
      target_type VARCHAR(32) NOT NULL,
      target_id VARCHAR(191) NOT NULL,
      reason TEXT NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'received',
      admin_note TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_arena_v2_reports_target (target_type, target_id),
      INDEX idx_arena_v2_reports_status (status, created_at),
      INDEX idx_arena_v2_reports_reporter (reporter_user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_v2_streamer_right_requests (
      id VARCHAR(64) PRIMARY KEY,
      streamer_id VARCHAR(191) NOT NULL,
      requester_user_id VARCHAR(191) NOT NULL,
      request_type VARCHAR(32) NOT NULL,
      payload JSON NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'pending',
      reviewed_by VARCHAR(191) NULL,
      review_note TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_arena_v2_rights_streamer (streamer_id, status),
      INDEX idx_arena_v2_rights_requester (requester_user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_user_cosmetic_loadouts (
      user_id VARCHAR(191) PRIMARY KEY,
      emote_slot_1_item_id BIGINT NULL,
      emote_slot_2_item_id BIGINT NULL,
      emote_slot_3_item_id BIGINT NULL,
      emote_slot_4_item_id BIGINT NULL,
      emote_slot_5_item_id BIGINT NULL,
      emote_slot_6_item_id BIGINT NULL,
      emote_slot_7_item_id BIGINT NULL,
      emote_slot_8_item_id BIGINT NULL,
      card_frame_item_id BIGINT NULL,
      name_flare_item_id BIGINT NULL,
      hit_vfx_item_id BIGINT NULL,
      summon_vfx_item_id BIGINT NULL,
      ready_stamp_item_id BIGINT NULL,
      nameplate_item_id BIGINT NULL,
      ko_text_item_id BIGINT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_arena_cosmetic_loadouts_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS arena_v2_admin_audit_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      admin_user_id VARCHAR(191) NOT NULL,
      action VARCHAR(80) NOT NULL,
      target_type VARCHAR(80) NOT NULL,
      target_id VARCHAR(191) NULL,
      before_value JSON NULL,
      after_value JSON NULL,
      reason TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_arena_v2_admin_audit_target (target_type, target_id),
      INDEX idx_arena_v2_admin_audit_admin (admin_user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  try {
    await db.run('ALTER TABLE arena_v2_match_players ADD COLUMN fatigue_count INT NOT NULL DEFAULT 0');
  } catch {
    // Existing v2 databases may already have this column.
  }
  for (let slot = 1; slot <= 8; slot += 1) {
    try {
      await db.run(`ALTER TABLE arena_user_cosmetic_loadouts ADD COLUMN emote_slot_${slot}_item_id BIGINT NULL`);
    } catch {
      // Existing v2 databases may already have this column.
    }
  }
  for (const columnName of ['card_frame_item_id', 'name_flare_item_id', 'hit_vfx_item_id', 'summon_vfx_item_id', 'ready_stamp_item_id', 'nameplate_item_id', 'ko_text_item_id']) {
    try {
      await db.run(`ALTER TABLE arena_user_cosmetic_loadouts ADD COLUMN ${columnName} BIGINT NULL`);
    } catch {
      // Existing v2 databases may already have this column.
    }
  }
  try {
    if (db instanceof PostgresDb) {
      await db.run('ALTER TABLE arena_v2_card_versions ALTER COLUMN art_asset_id TYPE TEXT');
    } else {
      await db.run('ALTER TABLE arena_v2_card_versions MODIFY COLUMN art_asset_id TEXT NULL');
    }
  } catch {
    // Existing databases may already have the widened URL column.
  }
};

export const ensureArenaV2SqliteSchema = (db: Database.Database) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS arena_v2_seasons (
      id TEXT PRIMARY KEY,
      season_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      modes_enabled TEXT NOT NULL,
      card_pool_version TEXT NOT NULL,
      balance_version TEXT NOT NULL,
      reward_table TEXT NOT NULL,
      mmr_tier_table TEXT NOT NULL,
      replay_retention_days INTEGER NOT NULL DEFAULT 7,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_arena_v2_seasons_status_time ON arena_v2_seasons(status, starts_at, ends_at);

    CREATE TABLE IF NOT EXISTS arena_v2_card_versions (
      id TEXT PRIMARY KEY,
      streamer_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      season_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      card_class TEXT NOT NULL,
      cost INTEGER NOT NULL,
      attack INTEGER NOT NULL,
      health INTEGER NOT NULL,
      keywords TEXT NOT NULL,
      balance_score REAL NOT NULL DEFAULT 0,
      validation_result TEXT NOT NULL,
      art_asset_id TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_arena_v2_cards_season_status ON arena_v2_card_versions(season_id, status);
    CREATE INDEX IF NOT EXISTS idx_arena_v2_cards_streamer_season ON arena_v2_card_versions(streamer_id, season_id);

    CREATE TABLE IF NOT EXISTS arena_v2_decks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      season_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mode_scope TEXT NOT NULL,
      card_version_ids TEXT NOT NULL,
      validation_hash TEXT NOT NULL,
      is_valid INTEGER NOT NULL DEFAULT 0,
      validation_result TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_arena_v2_decks_user_season ON arena_v2_decks(user_id, season_id);
    CREATE INDEX IF NOT EXISTS idx_arena_v2_decks_season_valid ON arena_v2_decks(season_id, is_valid);

    CREATE TABLE IF NOT EXISTS arena_v2_match_queue (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      deck_id TEXT NOT NULL,
      mmr INTEGER NOT NULL DEFAULT 1000,
      status TEXT NOT NULL DEFAULT 'waiting',
      search_min_mmr INTEGER NOT NULL DEFAULT 1000,
      search_max_mmr INTEGER NOT NULL DEFAULT 1000,
      matched_match_id TEXT,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_arena_v2_match_queue_search ON arena_v2_match_queue(season_id, status, mmr, joined_at);
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_arena_v2_match_queue_waiting ON arena_v2_match_queue(season_id, user_id) WHERE status = 'waiting';
    CREATE INDEX IF NOT EXISTS idx_arena_v2_match_queue_expire ON arena_v2_match_queue(status, expires_at);

    CREATE TABLE IF NOT EXISTS arena_v2_battle_royale_queue (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      deck_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting',
      battle_royale_id TEXT,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_arena_v2_br_queue_waiting ON arena_v2_battle_royale_queue(season_id, status, joined_at);
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_arena_v2_br_queue_waiting ON arena_v2_battle_royale_queue(season_id, user_id) WHERE status = 'waiting';
    CREATE INDEX IF NOT EXISTS idx_arena_v2_br_queue_expire ON arena_v2_battle_royale_queue(status, expires_at);

    CREATE TABLE IF NOT EXISTS arena_v2_matches (
      id TEXT PRIMARY KEY,
      season_id TEXT,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      battle_royale_id TEXT,
      round_no INTEGER NOT NULL DEFAULT 0,
      turn_no INTEGER NOT NULL DEFAULT 1,
      rng_seed TEXT NOT NULL,
      rules_version TEXT NOT NULL,
      card_pool_version TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      winner_user_id TEXT,
      result_summary TEXT NOT NULL,
      replay_expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_arena_v2_matches_season_mode_status ON arena_v2_matches(season_id, mode, status);
    CREATE INDEX IF NOT EXISTS idx_arena_v2_matches_br_round ON arena_v2_matches(battle_royale_id, round_no);
    CREATE INDEX IF NOT EXISTS idx_arena_v2_matches_replay_expire ON arena_v2_matches(replay_expires_at);
    CREATE INDEX IF NOT EXISTS idx_arena_v2_matches_finished ON arena_v2_matches(finished_at);

    CREATE TABLE IF NOT EXISTS arena_v2_match_players (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL,
      user_id TEXT,
      seat_no INTEGER NOT NULL,
      deck_id TEXT,
      player_health INTEGER NOT NULL DEFAULT 30,
      fatigue_count INTEGER NOT NULL DEFAULT 0,
      initial_deck_order TEXT NOT NULL,
      hand_card_instance_ids TEXT NOT NULL,
      deck_card_instance_ids TEXT NOT NULL,
      graveyard_card_instance_ids TEXT NOT NULL,
      board_state TEXT NOT NULL,
      mulligan_state TEXT NOT NULL,
      final_rank INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(match_id, seat_no)
    );
    CREATE INDEX IF NOT EXISTS idx_arena_v2_match_players_user ON arena_v2_match_players(match_id, user_id);

    CREATE TABLE IF NOT EXISTS arena_v2_card_instances (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL,
      owner_seat_no INTEGER NOT NULL,
      card_version_id TEXT NOT NULL,
      zone TEXT NOT NULL,
      position TEXT,
      current_attack INTEGER NOT NULL,
      current_health INTEGER NOT NULL,
      damage_taken INTEGER NOT NULL DEFAULT 0,
      status_effects TEXT NOT NULL,
      created_turn INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_arena_v2_card_instances_zone ON arena_v2_card_instances(match_id, owner_seat_no, zone);
    CREATE INDEX IF NOT EXISTS idx_arena_v2_card_instances_version ON arena_v2_card_instances(match_id, card_version_id);

    CREATE TABLE IF NOT EXISTS arena_v2_action_submissions (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      seat_no INTEGER NOT NULL,
      turn_no INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      action_payload TEXT NOT NULL,
      validation_result TEXT NOT NULL,
      is_final INTEGER NOT NULL DEFAULT 0,
      submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(match_id, seat_no, turn_no, revision)
    );
    CREATE INDEX IF NOT EXISTS idx_arena_v2_action_final ON arena_v2_action_submissions(match_id, turn_no, is_final);

    CREATE TABLE IF NOT EXISTS arena_v2_replay_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      turn_no INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      UNIQUE(match_id, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_arena_v2_replay_expire ON arena_v2_replay_events(expires_at);

    CREATE TABLE IF NOT EXISTS arena_v2_ratings (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      mmr INTEGER NOT NULL DEFAULT 1000,
      peak_mmr INTEGER NOT NULL DEFAULT 1000,
      tier TEXT NOT NULL DEFAULT 'bronze',
      peak_tier TEXT NOT NULL DEFAULT 'bronze',
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0,
      last_match_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(season_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_arena_v2_ratings_mmr ON arena_v2_ratings(season_id, mmr);
    CREATE INDEX IF NOT EXISTS idx_arena_v2_ratings_peak ON arena_v2_ratings(season_id, peak_mmr);

    CREATE TABLE IF NOT EXISTS arena_v2_reward_grants (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      reward_basis TEXT NOT NULL,
      reward_items TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      hold_reason TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      granted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(season_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_arena_v2_rewards_status ON arena_v2_reward_grants(season_id, status);

    CREATE TABLE IF NOT EXISTS arena_v2_battle_royales (
      id TEXT PRIMARY KEY,
      season_id TEXT,
      status TEXT NOT NULL DEFAULT 'forming',
      current_round_no INTEGER NOT NULL DEFAULT 0,
      participant_state TEXT NOT NULL,
      match_ids TEXT NOT NULL,
      winner_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_arena_v2_br_status ON arena_v2_battle_royales(season_id, status);
    CREATE INDEX IF NOT EXISTS idx_arena_v2_br_created ON arena_v2_battle_royales(created_at);

    CREATE TABLE IF NOT EXISTS arena_v2_replay_holds (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      hold_until TEXT,
      created_by TEXT NOT NULL,
      released_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      released_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_arena_v2_replay_holds_match ON arena_v2_replay_holds(match_id, status);
    CREATE INDEX IF NOT EXISTS idx_arena_v2_replay_holds_until ON arena_v2_replay_holds(status, hold_until);

    CREATE TABLE IF NOT EXISTS arena_v2_reports (
      id TEXT PRIMARY KEY,
      reporter_user_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'received',
      admin_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_arena_v2_reports_target ON arena_v2_reports(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_arena_v2_reports_status ON arena_v2_reports(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_arena_v2_reports_reporter ON arena_v2_reports(reporter_user_id, created_at);

    CREATE TABLE IF NOT EXISTS arena_v2_streamer_right_requests (
      id TEXT PRIMARY KEY,
      streamer_id TEXT NOT NULL,
      requester_user_id TEXT NOT NULL,
      request_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by TEXT,
      review_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_arena_v2_rights_streamer ON arena_v2_streamer_right_requests(streamer_id, status);
    CREATE INDEX IF NOT EXISTS idx_arena_v2_rights_requester ON arena_v2_streamer_right_requests(requester_user_id, created_at);

    CREATE TABLE IF NOT EXISTS arena_user_cosmetic_loadouts (
      user_id TEXT PRIMARY KEY,
      emote_slot_1_item_id INTEGER,
      emote_slot_2_item_id INTEGER,
      emote_slot_3_item_id INTEGER,
      emote_slot_4_item_id INTEGER,
      emote_slot_5_item_id INTEGER,
      emote_slot_6_item_id INTEGER,
      emote_slot_7_item_id INTEGER,
      emote_slot_8_item_id INTEGER,
      card_frame_item_id INTEGER,
      name_flare_item_id INTEGER,
      hit_vfx_item_id INTEGER,
      summon_vfx_item_id INTEGER,
      ready_stamp_item_id INTEGER,
      nameplate_item_id INTEGER,
      ko_text_item_id INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_arena_cosmetic_loadouts_updated ON arena_user_cosmetic_loadouts(updated_at);

    CREATE TABLE IF NOT EXISTS arena_v2_admin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      before_value TEXT,
      after_value TEXT,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_arena_v2_admin_audit_target ON arena_v2_admin_audit_logs(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_arena_v2_admin_audit_admin ON arena_v2_admin_audit_logs(admin_user_id, created_at);
  `);

  if (typeof db.prepare === 'function') {
    const matchPlayerColumns = db.prepare('PRAGMA table_info(arena_v2_match_players)').all() as Array<{ name: string }>;
    if (!matchPlayerColumns.some((column) => column.name === 'fatigue_count')) {
      db.exec('ALTER TABLE arena_v2_match_players ADD COLUMN fatigue_count INTEGER NOT NULL DEFAULT 0;');
    }
    const loadoutColumns = db.prepare('PRAGMA table_info(arena_user_cosmetic_loadouts)').all() as Array<{ name: string }>;
    for (let slot = 1; slot <= 8; slot += 1) {
      const columnName = `emote_slot_${slot}_item_id`;
      if (!loadoutColumns.some((column) => column.name === columnName)) {
        db.exec(`ALTER TABLE arena_user_cosmetic_loadouts ADD COLUMN ${columnName} INTEGER;`);
      }
    }
    for (const columnName of ['card_frame_item_id', 'name_flare_item_id', 'hit_vfx_item_id', 'summon_vfx_item_id', 'ready_stamp_item_id', 'nameplate_item_id', 'ko_text_item_id']) {
      if (!loadoutColumns.some((column) => column.name === columnName)) {
        db.exec(`ALTER TABLE arena_user_cosmetic_loadouts ADD COLUMN ${columnName} INTEGER;`);
      }
    }
  }
};
