import crypto from 'crypto';
import { getDbMode, getMysqlDb, getSqliteDb } from './db';
import { ensureArenaMatchTables } from './arenaMatchService';
import { getArenaCurrentSeasonId } from './arenaSeasonService';
import { ARENA_ROUNDS_TO_WIN } from './arenaRules';
import { getArenaSpectatorReplay } from './arenaSpectatorService';

const LINK_TTL_DAYS = Math.max(1, Math.min(30, Number(process.env.ARENA_SPECTATOR_LINK_TTL_DAYS || 7)));

let ensureLinksPromise: Promise<void> | null = null;

const ensureArenaSpectatorLinkTable = async () => {
  if (ensureLinksPromise) return ensureLinksPromise;
  ensureLinksPromise = (async () => {
    await ensureArenaMatchTables();
    if (getDbMode() === 'MYSQL') {
      await getMysqlDb().run(`
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
      return;
    }
    if (getDbMode() === 'LOCAL_SQL') {
      getSqliteDb().exec(`
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
      `);
      return;
    }
    throw new Error('ArenaSpectatorLinkStorageUnsupported');
  })().catch((err) => {
    ensureLinksPromise = null;
    throw err;
  });
  return ensureLinksPromise;
};

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

const loadCompletedMatchForOwner = async (userId: string, matchId: string) => {
  const query = `SELECT id, player_a_id, player_b_id, player_a_round_wins, player_b_round_wins, round_count
    FROM arena_matches
    WHERE id = ?
      AND season_id = ?
      AND (player_a_id = ? OR player_b_id = ?)
    LIMIT 1`;
  const row = getDbMode() === 'MYSQL'
    ? await getMysqlDb().get<any>(query, matchId, getArenaCurrentSeasonId(), userId, userId)
    : getSqliteDb().prepare(query).get(matchId, getArenaCurrentSeasonId(), userId, userId) as any;
  if (!row) return null;
  const completed = Number(row.player_a_round_wins || 0) >= ARENA_ROUNDS_TO_WIN
    || Number(row.player_b_round_wins || 0) >= ARENA_ROUNDS_TO_WIN
    || Number(row.round_count || 0) >= 5;
  return completed ? row : null;
};

export const createArenaSpectatorShareLink = async (userId: string, matchId: string) => {
  await ensureArenaSpectatorLinkTable();
  const match = await loadCompletedMatchForOwner(userId, matchId);
  if (!match) throw new Error('ArenaSpectatorShareMatchNotFound');
  const token = crypto.randomBytes(18).toString('base64url');
  const tokenHash = hashToken(token);
  if (getDbMode() === 'MYSQL') {
    await getMysqlDb().run(
      `INSERT INTO arena_spectator_links
        (token_hash, match_id, owner_user_id, visibility, expires_at)
       VALUES (?, ?, ?, 'LINK_ONLY', DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY))`,
      tokenHash,
      matchId,
      userId,
      LINK_TTL_DAYS
    );
  } else {
    getSqliteDb()
      .prepare(
        `INSERT INTO arena_spectator_links
          (token_hash, match_id, owner_user_id, visibility, expires_at)
         VALUES (?, ?, ?, 'LINK_ONLY', datetime('now', '+' || ? || ' days'))`
      )
      .run(tokenHash, matchId, userId, LINK_TTL_DAYS);
  }
  return {
    token,
    match_id: String(matchId),
    expires_in_days: LINK_TTL_DAYS
  };
};

export const getArenaSpectatorReplayByToken = async (token: string) => {
  await ensureArenaSpectatorLinkTable();
  const tokenHash = hashToken(String(token || '').trim());
  if (!tokenHash) return null;
  const query = `SELECT match_id
    FROM arena_spectator_links
    WHERE token_hash = ?
      AND visibility IN ('LINK_ONLY', 'PUBLIC')
      AND revoked_at IS NULL
      AND expires_at > ${getDbMode() === 'MYSQL' ? 'UTC_TIMESTAMP()' : "datetime('now')"}
    LIMIT 1`;
  const row = getDbMode() === 'MYSQL'
    ? await getMysqlDb().get<any>(query, tokenHash)
    : getSqliteDb().prepare(query).get(tokenHash) as any;
  if (!row) return null;
  return getArenaSpectatorReplay(String(row.match_id));
};

export const pruneArenaSpectatorLinks = async (limitInput?: unknown) => {
  await ensureArenaSpectatorLinkTable();
  const limit = Math.max(10, Math.min(1000, Number.parseInt(String(limitInput || 200), 10) || 200));
  if (getDbMode() === 'MYSQL') {
    const result = await getMysqlDb().run(
      `DELETE FROM arena_spectator_links
        WHERE expires_at <= UTC_TIMESTAMP()
           OR (revoked_at IS NOT NULL AND revoked_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY))
        LIMIT ?`,
      limit
    );
    return {
      pruned: Number(result.affectedRows || 0),
      limit,
      source: 'arena_spectator_links'
    };
  }

  const result = getSqliteDb()
    .prepare(
      `DELETE FROM arena_spectator_links
        WHERE id IN (
          SELECT id
          FROM arena_spectator_links
          WHERE expires_at <= datetime('now')
             OR (revoked_at IS NOT NULL AND revoked_at < datetime('now', '-7 days'))
          LIMIT ?
        )`
    )
    .run(limit);
  return {
    pruned: Number(result.changes || 0),
    limit,
    source: 'arena_spectator_links'
  };
};
