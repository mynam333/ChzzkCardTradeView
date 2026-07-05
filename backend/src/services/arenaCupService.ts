import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import { getDbMode, getMysqlDb, getSqliteDb } from './db';
import { ArenaDeck, getArenaDeck, validateArenaDeckInput } from './arenaDeckService';
import { getArenaCurrentSeasonId, isArenaSeasonOpen } from './arenaSeasonService';
import { ArenaDeckSnapshot, buildArenaReplayStoragePayload, ensureArenaMatchTables, loadArenaDeckSnapshot } from './arenaMatchService';
import { pickArenaBattlefieldRule, simulateArenaSet } from './arenaBattleSimulator';
import { ARENA_MATCH_FORMAT, ARENA_ROUNDS_TO_WIN } from './arenaRules';
import { getArenaOpsConfigSync } from './arenaOpsConfig';

export const isArenaCupEnabled = () => isArenaSeasonOpen() && getArenaOpsConfigSync().cup_enabled;

type CupQueueStatus = 'queued' | 'matched' | 'cancelled' | 'expired' | 'none';
type RawCupQueueRow = {
  id: number | string | bigint;
  user_id: string;
  season_id: string;
  deck_id: string;
  deck_hash: string;
  status: string;
  queued_at: string;
  expires_at: string;
  cup_id: number | string | bigint | null;
};
type RawCupRow = {
  id: number | string | bigint;
  season_id: string;
  status: string;
  participant_count: number;
  champion_user_id: string | null;
  bracket_json: string;
  replay_json: string | null;
  created_at: string;
  completed_at: string | null;
};

type CupParticipant = {
  seed_no: number;
  queue_id: string;
  user_id: string;
  deck_id: string;
  deck_hash: string;
  deck: ArenaDeckSnapshot;
};

const CUP_SIZE = 8;
const CUP_QUEUE_TTL_SECONDS = Math.max(60, Number(process.env.ARENA_CUP_QUEUE_TTL_SECONDS || 180));
const CUP_CLEANUP_INTERVAL_MS = Math.max(10_000, Number(process.env.ARENA_CUP_QUEUE_CLEANUP_INTERVAL_MS || 30_000));
const CUP_CLEANUP_LIMIT = Math.max(10, Math.min(200, Number(process.env.ARENA_CUP_QUEUE_CLEANUP_LIMIT || 100)));
const CUP_RECOVERY_FINALIZE_LIMIT = Math.max(1, Math.min(5, Number(process.env.ARENA_CUP_RECOVERY_FINALIZE_LIMIT || 2)));
const CUP_STATUS_POLL_AFTER_SEC = Math.max(5, Math.min(30, Number(process.env.ARENA_CUP_STATUS_POLL_AFTER_SEC || 8)));
const CUP_REPLAY_RETENTION_DAYS = Math.max(1, Math.min(90, Number(process.env.ARENA_CUP_REPLAY_RETENTION_DAYS || process.env.ARENA_REPLAY_RETENTION_DAYS || 7)));

const replayExpiresAtSql = () => getDbMode() === 'MYSQL'
  ? 'DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY)'
  : "datetime('now', '+' || ? || ' days')";
const replayNowSql = () => getDbMode() === 'MYSQL' ? 'UTC_TIMESTAMP()' : "datetime('now')";
const CUP_QUEUE_COLUMNS = 'id, user_id, season_id, deck_id, deck_hash, status, queued_at, expires_at, cup_id';

let ensureCupTablesPromise: Promise<void> | null = null;
let lastCupCleanupAt = 0;
const cupQueueEvents = new EventEmitter();
cupQueueEvents.setMaxListeners(Math.max(100, Number(process.env.ARENA_CUP_SSE_MAX_LISTENERS || 1000)));


const parseJson = <T>(raw: unknown, fallback: T): T => {
  if (raw === null || raw === undefined || raw === '') return fallback;
  if (typeof raw === 'object') return raw as T;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
};

const hashHex = (input: string) => createHash('sha256').update(input).digest('hex');
const hashInt = (input: string) => parseInt(hashHex(input).slice(0, 8), 16);

const parseDbTime = (value: string | null | undefined): number => {
  if (!value) return Date.now();
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : Date.now();
};

const countCupReplayEvents = (replay: any) => (Array.isArray(replay?.matches) ? replay.matches : [])
  .reduce((total: number, match: any) => total + (Array.isArray(match?.rounds) ? match.rounds : [])
    .reduce((roundTotal: number, round: any) => roundTotal + (Array.isArray(round?.events) ? round.events.length : 0), 0), 0);

const saveArenaCupReplay = async (cupId: string, replay: any): Promise<string | null> => {
  const storagePayload = buildArenaReplayStoragePayload(replay);
  if (!storagePayload) return null;
  const replayJson = storagePayload.json;
  await ensureArenaCupTables();
  const replayBytes = Buffer.byteLength(replayJson, 'utf8');
  const eventCount = countCupReplayEvents(storagePayload.replay);
  if (getDbMode() === 'MYSQL') {
    await getMysqlDb().run(
      `INSERT INTO arena_cup_replays
        (cup_id, replay_json, replay_bytes, event_count, expires_at)
       VALUES (?, ?, ?, ?, ${replayExpiresAtSql()})
       ON DUPLICATE KEY UPDATE
         replay_json = VALUES(replay_json),
         replay_bytes = VALUES(replay_bytes),
         event_count = VALUES(event_count),
         expires_at = VALUES(expires_at),
         updated_at = UTC_TIMESTAMP()`,
      cupId,
      replayJson,
      replayBytes,
      eventCount,
      CUP_REPLAY_RETENTION_DAYS
    );
    return replayJson;
  }

  getSqliteDb()
    .prepare(
      `INSERT INTO arena_cup_replays
        (cup_id, replay_json, replay_bytes, event_count, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ${replayExpiresAtSql()}, CURRENT_TIMESTAMP)
       ON CONFLICT(cup_id) DO UPDATE SET
         replay_json = excluded.replay_json,
         replay_bytes = excluded.replay_bytes,
         event_count = excluded.event_count,
         expires_at = excluded.expires_at,
         updated_at = CURRENT_TIMESTAMP`
    )
    .run(cupId, replayJson, replayBytes, eventCount, CUP_REPLAY_RETENTION_DAYS);
  return replayJson;
};

const loadArenaCupReplayJson = async (cupId: string, legacyReplayJson?: string | null): Promise<string | null> => {
  await ensureArenaCupTables();
  const query = `SELECT replay_json
    FROM arena_cup_replays
    WHERE cup_id = ?
      AND (expires_at IS NULL OR expires_at > ${replayNowSql()})
    LIMIT 1`;
  const row = getDbMode() === 'MYSQL'
    ? await getMysqlDb().get<any>(query, cupId)
    : getSqliteDb().prepare(query).get(cupId) as any;
  return row?.replay_json || legacyReplayJson || null;
};

export const pruneArenaCupReplayLogs = async (daysInput?: unknown, limitInput?: unknown) => {
  await ensureArenaCupTables();
  const retentionDays = Math.max(1, Math.min(90, Number.parseInt(String(daysInput || CUP_REPLAY_RETENTION_DAYS), 10) || CUP_REPLAY_RETENTION_DAYS));
  const limit = Math.max(10, Math.min(1000, Number.parseInt(String(limitInput || CUP_CLEANUP_LIMIT), 10) || CUP_CLEANUP_LIMIT));

  if (getDbMode() === 'MYSQL') {
    const replayResult = await getMysqlDb().run(
      `DELETE FROM arena_cup_replays
        WHERE expires_at IS NOT NULL
          AND expires_at < UTC_TIMESTAMP()
        LIMIT ?`,
      limit
    );
    const legacyResult = await getMysqlDb().run(
      `UPDATE arena_cups
          SET replay_json = NULL
        WHERE replay_json IS NOT NULL
          AND completed_at IS NOT NULL
          AND completed_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
        LIMIT ?`,
      retentionDays,
      limit
    );
    return {
      pruned: Number(replayResult.affectedRows || 0) + Number(legacyResult.affectedRows || 0),
      cup_replay_rows_pruned: Number(replayResult.affectedRows || 0),
      legacy_cup_rows_pruned: Number(legacyResult.affectedRows || 0),
      retention_days: retentionDays,
      limit
    };
  }

  const replayResult = getSqliteDb()
    .prepare(
      `DELETE FROM arena_cup_replays
        WHERE cup_id IN (
          SELECT cup_id FROM arena_cup_replays
           WHERE expires_at IS NOT NULL
             AND expires_at < datetime('now')
           LIMIT ?
        )`
    )
    .run(limit);
  const legacyResult = getSqliteDb()
    .prepare(
      `UPDATE arena_cups
          SET replay_json = NULL
        WHERE id IN (
          SELECT id FROM arena_cups
           WHERE replay_json IS NOT NULL
             AND completed_at IS NOT NULL
             AND completed_at < datetime('now', '-' || ? || ' days')
           LIMIT ?
        )`
    )
    .run(retentionDays, limit);
  return {
    pruned: Number(replayResult.changes || 0) + Number(legacyResult.changes || 0),
    cup_replay_rows_pruned: Number(replayResult.changes || 0),
    legacy_cup_rows_pruned: Number(legacyResult.changes || 0),
    retention_days: retentionDays,
    limit
  };
};

const secondsSince = (value: string | null | undefined) => Math.max(0, Math.floor((Date.now() - parseDbTime(value)) / 1000));

const normalizeQueueStatus = (status: string): CupQueueStatus => {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'WAITING' || normalized === 'MATCHING') return 'queued';
  if (normalized === 'MATCHED') return 'matched';
  if (normalized === 'CANCELLED') return 'cancelled';
  if (normalized === 'EXPIRED') return 'expired';
  return 'none';
};

const ensureArenaCupTables = async () => {
  if (ensureCupTablesPromise) return ensureCupTablesPromise;

  ensureCupTablesPromise = (async () => {
    await ensureArenaMatchTables();
    if (getDbMode() === 'MYSQL') {
      await getMysqlDb().run(`
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
      await getMysqlDb().run(`
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
      await getMysqlDb().run(`
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
      return;
    }

    if (getDbMode() === 'LOCAL_SQL') {
      getSqliteDb().exec(`
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
      `);
      return;
    }

    throw new Error('ArenaCupStorageUnsupported');
  })().catch((err) => {
    ensureCupTablesPromise = null;
    throw err;
  });

  return ensureCupTablesPromise;
};

const maybeCleanupExpiredCupQueue = async () => {
  const now = Date.now();
  if (now - lastCupCleanupAt < CUP_CLEANUP_INTERVAL_MS) return;
  lastCupCleanupAt = now;

  if (getDbMode() === 'MYSQL') {
    await getMysqlDb().run(
      `UPDATE arena_cup_queue
          SET status = 'EXPIRED'
        WHERE status IN ('WAITING', 'MATCHING')
          AND expires_at <= UTC_TIMESTAMP()
        LIMIT ?`,
      CUP_CLEANUP_LIMIT
    );
    return;
  }

  getSqliteDb()
    .prepare(
      `UPDATE arena_cup_queue
          SET status = 'EXPIRED'
        WHERE id IN (
          SELECT id FROM arena_cup_queue
           WHERE status IN ('WAITING', 'MATCHING')
             AND expires_at <= datetime('now')
           LIMIT ?
        )`
    )
    .run(CUP_CLEANUP_LIMIT);
};

const toQueueResponse = (row: RawCupQueueRow | null | undefined) => {
  if (!row) {
    return {
      status: 'none' as const,
      queue_ticket_id: null,
      cup_id: null,
      queued_count: 0,
      required_count: CUP_SIZE,
      elapsed_sec: 0,
      poll_after_sec: null as number | null,
      resume_available: false
    };
  }
  const status = normalizeQueueStatus(row.status);
  return {
    status,
    queue_ticket_id: String(row.id),
    cup_id: row.cup_id ? String(row.cup_id) : null,
    queued_count: status === 'queued' ? 1 : 0,
    required_count: CUP_SIZE,
    elapsed_sec: secondsSince(row.queued_at),
    poll_after_sec: status === 'queued' ? CUP_STATUS_POLL_AFTER_SEC : null,
    resume_available: status === 'matched' && Boolean(row.cup_id),
    expires_at: row.expires_at
  };
};


export type ArenaCupQueueResponse = {
  status: CupQueueStatus;
  queue_ticket_id: string | null;
  cup_id: string | null;
  queued_count: number;
  required_count: number;
  elapsed_sec: number;
  poll_after_sec: number | null;
  resume_available: boolean;
  expires_at?: string | null;
};
const cupEventKey = (userId: string) => `cup:${userId}`;
const emitArenaCupQueueEvent = (userId: string, payload: ArenaCupQueueResponse) => {
  cupQueueEvents.emit(cupEventKey(userId), payload);
};
export const subscribeArenaCupQueueEvents = (userId: string, listener: (payload: ArenaCupQueueResponse) => void) => {
  const key = cupEventKey(userId);
  cupQueueEvents.on(key, listener);
  return () => cupQueueEvents.off(key, listener);
};

const loadLatestCupQueueForUser = async (userId: string): Promise<RawCupQueueRow | null> => {
  const query = `SELECT ${CUP_QUEUE_COLUMNS} FROM arena_cup_queue
    WHERE user_id = ? AND season_id = ?
    ORDER BY id DESC
    LIMIT 1`;
  if (getDbMode() === 'MYSQL') {
    return (await getMysqlDb().get<RawCupQueueRow>(query, userId, getArenaCurrentSeasonId())) || null;
  }
  return (getSqliteDb().prepare(query).get(userId, getArenaCurrentSeasonId()) as RawCupQueueRow | undefined) || null;
};

const loadActiveCupQueueForUser = async (userId: string): Promise<RawCupQueueRow | null> => {
  const query = `SELECT ${CUP_QUEUE_COLUMNS} FROM arena_cup_queue
    WHERE user_id = ?
      AND season_id = ?
      AND status IN ('WAITING', 'MATCHING', 'MATCHED')
    ORDER BY id DESC
    LIMIT 1`;
  if (getDbMode() === 'MYSQL') {
    return (await getMysqlDb().get<RawCupQueueRow>(query, userId, getArenaCurrentSeasonId())) || null;
  }
  return (getSqliteDb().prepare(query).get(userId, getArenaCurrentSeasonId()) as RawCupQueueRow | undefined) || null;
};

const countWaitingCupQueue = async () => {
  const query = `SELECT COUNT(*) AS count FROM arena_cup_queue
    WHERE season_id = ? AND status = 'WAITING'`;
  const row = getDbMode() === 'MYSQL'
    ? await getMysqlDb().get<any>(query, getArenaCurrentSeasonId())
    : getSqliteDb().prepare(query).get(getArenaCurrentSeasonId()) as any;
  return Number(row?.count || 0);
};

const prepareValidDeck = async (userId: string, deckId: string): Promise<ArenaDeck> => {
  const storedDeck = await getArenaDeck(userId, deckId);
  if (!storedDeck) throw new Error('ArenaDeckNotFound');
  const validation = await validateArenaDeckInput(storedDeck, storedDeck.user_id);
  if (!validation.valid) {
    const err = new Error('ArenaDeckValidationFailed') as Error & { validation?: unknown };
    err.validation = validation;
    throw err;
  }
  return { ...storedDeck, validation_status: 'VALID', validation_result: validation };
};

const insertCupQueue = async (userId: string, deck: ArenaDeck): Promise<RawCupQueueRow> => {
  if (getDbMode() === 'MYSQL') {
    const result = await getMysqlDb().run(
      `INSERT INTO arena_cup_queue
        (user_id, season_id, deck_id, deck_hash, status, expires_at)
       VALUES (?, ?, ?, ?, 'WAITING', DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))`,
      userId,
      getArenaCurrentSeasonId(),
      deck.id,
      deck.deck_hash,
      CUP_QUEUE_TTL_SECONDS
    );
    const row = await loadLatestCupQueueForUser(userId);
    if (!row || String(row.id) !== String(result.insertId)) throw new Error('ArenaCupQueueCreateReadbackFailed');
    emitArenaCupQueueEvent(userId, toQueueResponse(row));
    return row;
  }

  const result = getSqliteDb()
    .prepare(
      `INSERT INTO arena_cup_queue
        (user_id, season_id, deck_id, deck_hash, status, expires_at)
       VALUES (?, ?, ?, ?, 'WAITING', datetime('now', '+' || ? || ' seconds'))`
    )
    .run(userId, getArenaCurrentSeasonId(), deck.id, deck.deck_hash, CUP_QUEUE_TTL_SECONDS);
  const row = await loadLatestCupQueueForUser(userId);
  if (!row || String(row.id) !== String(result.lastInsertRowid)) throw new Error('ArenaCupQueueCreateReadbackFailed');
  emitArenaCupQueueEvent(userId, toQueueResponse(row));
  return row;
};

const loadCupCandidates = async (): Promise<RawCupQueueRow[]> => {
  const query = `SELECT ${CUP_QUEUE_COLUMNS} FROM arena_cup_queue
    WHERE season_id = ?
      AND status = 'WAITING'
      AND expires_at > ${getDbMode() === 'MYSQL' ? 'UTC_TIMESTAMP()' : "datetime('now')"}
    ORDER BY queued_at ASC, id ASC
    LIMIT ?`;
  if (getDbMode() === 'MYSQL') {
    return getMysqlDb().all<RawCupQueueRow>(query, getArenaCurrentSeasonId(), CUP_SIZE);
  }
  return getSqliteDb().prepare(query).all(getArenaCurrentSeasonId(), CUP_SIZE) as RawCupQueueRow[];
};

const reserveCupCandidates = async (rows: RawCupQueueRow[]): Promise<boolean> => {
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(', ');
  if (getDbMode() === 'MYSQL') {
    const result = await getMysqlDb().run(
      `UPDATE arena_cup_queue
          SET status = 'MATCHING'
        WHERE id IN (${placeholders})
          AND status = 'WAITING'
          AND expires_at > UTC_TIMESTAMP()`,
      ...ids
    );
    return Number(result.affectedRows || 0) === CUP_SIZE;
  }

  const result = getSqliteDb()
    .prepare(
      `UPDATE arena_cup_queue
          SET status = 'MATCHING'
        WHERE id IN (${placeholders})
          AND status = 'WAITING'
          AND expires_at > datetime('now')`
    )
    .run(...ids);
  return Number(result.changes || 0) === CUP_SIZE;
};

const releaseCupCandidates = async (rows: RawCupQueueRow[]) => {
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(', ');
  if (getDbMode() === 'MYSQL') {
    await getMysqlDb().run(
      `UPDATE arena_cup_queue
          SET status = 'WAITING'
        WHERE id IN (${placeholders})
          AND status = 'MATCHING'
          AND cup_id IS NULL
          AND expires_at > UTC_TIMESTAMP()`,
      ...ids
    );
    return;
  }

  getSqliteDb()
    .prepare(
      `UPDATE arena_cup_queue
          SET status = 'WAITING'
        WHERE id IN (${placeholders})
          AND status = 'MATCHING'
          AND cup_id IS NULL
          AND expires_at > datetime('now')`
    )
    .run(...ids);
};

const roundDamage = (rounds: any[], side: 'player' | 'bot') =>
  rounds.reduce((total, round) => total + Number(side === 'player' ? round.player_total_damage || 0 : round.bot_total_damage || 0), 0);

const pickWinner = (a: CupParticipant, b: CupParticipant, simulated: ReturnType<typeof simulateArenaSet>, seed: string) => {
  if (simulated.playerWins > simulated.opponentWins) return a;
  if (simulated.opponentWins > simulated.playerWins) return b;
  const playerDamage = roundDamage(simulated.roundResults, 'player');
  const opponentDamage = roundDamage(simulated.roundResults, 'bot');
  if (playerDamage !== opponentDamage) return playerDamage > opponentDamage ? a : b;
  return hashInt(`${seed}:draw-breaker:${a.user_id}:${b.user_id}`) % 2 === 0 ? a : b;
};

const simulateCupMatch = (a: CupParticipant, b: CupParticipant, stage: string, index: number, cupSeed: string) => {
  const matchSeed = hashHex(`${cupSeed}:${stage}:${index}:${a.user_id}:${b.user_id}:${a.deck_hash}:${b.deck_hash}`);
  const battlefieldRule = pickArenaBattlefieldRule(matchSeed);
  const simulated = simulateArenaSet({
    playerDeck: a.deck,
    opponentDeck: b.deck,
    matchSeed,
    battlefield_rule_id: battlefieldRule.id
  });
  const winner = pickWinner(a, b, simulated, matchSeed);
  const loser = winner.user_id === a.user_id ? b : a;
  return {
    match: {
      stage,
      index,
      match_key: `${stage}-${index}`,
      player_a: { seed_no: a.seed_no, user_id: a.user_id, deck_id: a.deck_id, deck_name: a.deck.name },
      player_b: { seed_no: b.seed_no, user_id: b.user_id, deck_id: b.deck_id, deck_name: b.deck.name },
      winner_user_id: winner.user_id,
      player_a_round_wins: simulated.playerWins,
      player_b_round_wins: simulated.opponentWins,
      draw_rounds: simulated.draws,
      round_count: simulated.roundResults.length,
      battlefield_rule: battlefieldRule,
      round_results: simulated.roundResults
    },
    replay: {
      match_key: `${stage}-${index}`,
      match_format: ARENA_MATCH_FORMAT,
      rounds_to_win: ARENA_ROUNDS_TO_WIN,
      replay_version: 2,
      replay_storage: 'tick_events' as const,
      battlefield_rule: battlefieldRule,
      rounds: simulated.replayRounds
    },
    winner,
    loser
  };
};

export const __test_simulateCupBracket = (participants: CupParticipant[], seed: string) => {
  const seeded = [...participants]
    .sort((a, b) => hashInt(`${seed}:seed:${a.user_id}:${a.queue_id}`) - hashInt(`${seed}:seed:${b.user_id}:${b.queue_id}`))
    .map((participant, index) => ({ ...participant, seed_no: index + 1 }));

  const quarterPairs: Array<[CupParticipant, CupParticipant]> = [
    [seeded[0], seeded[7]],
    [seeded[3], seeded[4]],
    [seeded[1], seeded[6]],
    [seeded[2], seeded[5]]
  ];
  const quarterFinals = quarterPairs.map(([a, b], index) => simulateCupMatch(a, b, 'quarterfinal', index + 1, seed));
  const semiPairs: Array<[CupParticipant, CupParticipant]> = [
    [quarterFinals[0].winner, quarterFinals[1].winner],
    [quarterFinals[2].winner, quarterFinals[3].winner]
  ];
  const semiFinals = semiPairs.map(([a, b], index) => simulateCupMatch(a, b, 'semifinal', index + 1, seed));
  const consolationPairs: Array<[CupParticipant, CupParticipant]> = [
    [quarterFinals[0].loser, quarterFinals[1].loser],
    [quarterFinals[2].loser, quarterFinals[3].loser]
  ];
  const consolationSemis = consolationPairs.map(([a, b], index) => simulateCupMatch(a, b, 'consolation_semifinal', index + 1, seed));
  const final = simulateCupMatch(semiFinals[0].winner, semiFinals[1].winner, 'final', 1, seed);
  const thirdPlace = simulateCupMatch(semiFinals[0].loser, semiFinals[1].loser, 'third_place', 1, seed);
  const fifthPlace = simulateCupMatch(consolationSemis[0].winner, consolationSemis[1].winner, 'fifth_place', 1, seed);
  const seventhPlace = simulateCupMatch(consolationSemis[0].loser, consolationSemis[1].loser, 'seventh_place', 1, seed);
  const allMatches = [...quarterFinals, ...semiFinals, ...consolationSemis, final, thirdPlace, fifthPlace, seventhPlace];
  const placements = [
    { rank: 1, participant: final.winner, cup_points: 100 },
    { rank: 2, participant: final.loser, cup_points: 70 },
    { rank: 3, participant: thirdPlace.winner, cup_points: 50 },
    { rank: 4, participant: thirdPlace.loser, cup_points: 35 },
    { rank: 5, participant: fifthPlace.winner, cup_points: 25 },
    { rank: 6, participant: fifthPlace.loser, cup_points: 18 },
    { rank: 7, participant: seventhPlace.winner, cup_points: 12 },
    { rank: 8, participant: seventhPlace.loser, cup_points: 8 }
  ].map(({ rank, participant, cup_points }) => ({
    rank,
    user_id: participant.user_id,
    seed_no: participant.seed_no,
    deck_id: participant.deck_id,
    deck_name: participant.deck.name,
    cup_points
  }));

  return {
    bracket: {
      mode_id: 'eight_player_strategy_cup',
      match_format: ARENA_MATCH_FORMAT,
      rounds_to_win: ARENA_ROUNDS_TO_WIN,
      seed,
      participants: seeded.map((participant) => ({
        seed_no: participant.seed_no,
        user_id: participant.user_id,
        deck_id: participant.deck_id,
        deck_name: participant.deck.name
      })),
      matches: allMatches.map((item) => item.match),
      placements,
      champion_user_id: final.winner.user_id
    },
    replay: {
      replay_version: 2,
      replay_storage: 'cup_tick_events',
      matches: allMatches.map((item) => item.replay)
    }
  };
};

const createCupFromReservedRows = async (rows: RawCupQueueRow[]) => {
  const deckEntries = await Promise.all(rows.map(async (row) => {
    const deck = await prepareValidDeck(row.user_id, row.deck_id);
    const snapshot = await loadArenaDeckSnapshot(deck);
    if (snapshot.cards.length < 6) throw new Error('ArenaDeckSnapshotInvalid');
    return {
      seed_no: 0,
      queue_id: String(row.id),
      user_id: row.user_id,
      deck_id: deck.id,
      deck_hash: deck.deck_hash,
      deck: snapshot
    } satisfies CupParticipant;
  }));
  const seed = hashHex(`${getArenaCurrentSeasonId()}:${rows.map((row) => `${row.id}:${row.user_id}:${row.deck_hash}`).join('|')}`);
  const simulated = __test_simulateCupBracket(deckEntries, seed);
  const bracketJson = JSON.stringify(simulated.bracket);
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(', ');

  if (getDbMode() === 'MYSQL') {
    const cupId = await getMysqlDb().transaction(async (tx) => {
      const inserted = await tx.run(
        `INSERT INTO arena_cups
          (season_id, status, participant_count, champion_user_id, bracket_json, replay_json, completed_at)
         VALUES (?, 'COMPLETED', ?, ?, ?, NULL, UTC_TIMESTAMP())`,
        getArenaCurrentSeasonId(),
        CUP_SIZE,
        simulated.bracket.champion_user_id,
        bracketJson
      );
      await tx.run(
        `UPDATE arena_cup_queue
            SET status = 'MATCHED', cup_id = ?
          WHERE id IN (${placeholders})
            AND status = 'MATCHING'`,
        inserted.insertId,
        ...ids
      );
      return String(inserted.insertId);
    });
    await saveArenaCupReplay(cupId, simulated.replay);
    rows.forEach((row) => emitArenaCupQueueEvent(row.user_id, { ...toQueueResponse({ ...row, status: 'MATCHED', cup_id: cupId }), queued_count: CUP_SIZE }));
    return cupId;
  }

  const db = getSqliteDb();
  const cupId = db.transaction(() => {
    const inserted = db
      .prepare(
        `INSERT INTO arena_cups
          (season_id, status, participant_count, champion_user_id, bracket_json, replay_json, completed_at)
         VALUES (?, 'COMPLETED', ?, ?, ?, NULL, CURRENT_TIMESTAMP)`
      )
      .run(getArenaCurrentSeasonId(), CUP_SIZE, simulated.bracket.champion_user_id, bracketJson);
    db.prepare(
      `UPDATE arena_cup_queue
          SET status = 'MATCHED', cup_id = ?
        WHERE id IN (${placeholders})
          AND status = 'MATCHING'`
    ).run(inserted.lastInsertRowid, ...ids);
    return String(inserted.lastInsertRowid);
  })();
  await saveArenaCupReplay(cupId, simulated.replay);
  rows.forEach((row) => emitArenaCupQueueEvent(row.user_id, { ...toQueueResponse({ ...row, status: 'MATCHED', cup_id: cupId }), queued_count: CUP_SIZE }));
  return cupId;
};

const tryFinalizeCup = async () => {
  const candidates = await loadCupCandidates();
  if (candidates.length < CUP_SIZE) return null;
  const reserved = await reserveCupCandidates(candidates);
  if (!reserved) return null;
  try {
    return await createCupFromReservedRows(candidates);
  } catch (err) {
    await releaseCupCandidates(candidates);
    throw err;
  }
};

export const finalizeWaitingArenaCups = async (limitInput?: unknown) => {
  await ensureArenaCupTables();
  const limit = Math.max(1, Math.min(CUP_RECOVERY_FINALIZE_LIMIT, Number.parseInt(String(limitInput || CUP_RECOVERY_FINALIZE_LIMIT), 10) || CUP_RECOVERY_FINALIZE_LIMIT));
  let attempted = 0;
  let matched = 0;
  let failed = 0;

  for (let index = 0; index < limit; index += 1) {
    attempted += 1;
    try {
      const cupId = await tryFinalizeCup();
      if (!cupId) break;
      matched += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    attempted,
    matched,
    failed,
    limit,
    policy: 'bounded_waiting_cup_finalize'
  };
};

export const joinArenaCupQueue = async (userId: string, deckId: string) => {
  if (!isArenaCupEnabled()) throw new Error('ArenaCupDisabled');
  await ensureArenaCupTables();
  await maybeCleanupExpiredCupQueue();

  const active = await loadActiveCupQueueForUser(userId);
  if (active) {
    const status = normalizeQueueStatus(active.status);
    if (status === 'matched') return toQueueResponse(active);
    if (status === 'queued' && parseDbTime(active.expires_at) > Date.now()) {
      const response = toQueueResponse(active);
      return { ...response, queued_count: await countWaitingCupQueue() };
    }
  }

  const deck = await prepareValidDeck(userId, deckId);
  const queued = await insertCupQueue(userId, deck);
  const cupId = await tryFinalizeCup();
  if (cupId) {
    const latest = await loadLatestCupQueueForUser(userId);
    return toQueueResponse(latest || { ...queued, status: 'MATCHED', cup_id: cupId });
  }

  const response = toQueueResponse(queued);
  return { ...response, queued_count: await countWaitingCupQueue() };
};

export const getArenaCupQueueStatus = async (userId: string) => {
  if (!isArenaCupEnabled()) throw new Error('ArenaCupDisabled');
  await ensureArenaCupTables();
  await maybeCleanupExpiredCupQueue();
  const latest = await loadLatestCupQueueForUser(userId);
  if (!latest) return toQueueResponse(null);
  const response = toQueueResponse(latest);
  return response.status === 'queued' ? { ...response, queued_count: await countWaitingCupQueue() } : response;
};

export const cancelArenaCupQueue = async (userId: string) => {
  if (!isArenaCupEnabled()) throw new Error('ArenaCupDisabled');
  await ensureArenaCupTables();
  const latest = await loadLatestCupQueueForUser(userId);
  if (!latest) return toQueueResponse(null);
  const status = normalizeQueueStatus(latest.status);
  if (status === 'matched') return toQueueResponse(latest);
  if (status !== 'queued') return toQueueResponse(latest);

  if (getDbMode() === 'MYSQL') {
    await getMysqlDb().run(
      `UPDATE arena_cup_queue
          SET status = 'CANCELLED'
        WHERE id = ?
          AND user_id = ?
          AND status IN ('WAITING', 'MATCHING')`,
      latest.id,
      userId
    );
  } else {
    getSqliteDb()
      .prepare(
        `UPDATE arena_cup_queue
            SET status = 'CANCELLED'
          WHERE id = ?
            AND user_id = ?
            AND status IN ('WAITING', 'MATCHING')`
      )
      .run(latest.id, userId);
  }

  const cancelled = { ...toQueueResponse(latest), status: 'cancelled' as const, poll_after_sec: null };
  emitArenaCupQueueEvent(userId, cancelled);
  return cancelled;
};

export const recoverArenaCupQueue = async () => {
  await ensureArenaCupTables();
  const limit = CUP_CLEANUP_LIMIT;

  if (getDbMode() === 'MYSQL') {
    const expired = await getMysqlDb().run(
      `UPDATE arena_cup_queue
          SET status = 'EXPIRED'
        WHERE status IN ('WAITING', 'MATCHING')
          AND expires_at <= UTC_TIMESTAMP()
        LIMIT ?`,
      limit
    );
    const released = await getMysqlDb().run(
      `UPDATE arena_cup_queue
          SET status = 'WAITING'
        WHERE season_id = ?
          AND status = 'MATCHING'
          AND cup_id IS NULL
          AND expires_at > UTC_TIMESTAMP()
          AND queued_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE)
        LIMIT ?`,
      getArenaCurrentSeasonId(),
      limit
    );
    lastCupCleanupAt = Date.now();
    const finalized = await finalizeWaitingArenaCups(Math.min(CUP_RECOVERY_FINALIZE_LIMIT, Math.max(1, Math.floor(limit / CUP_SIZE))));
    return {
      expired: Number(expired.affectedRows || expired.changes || 0),
      released_matching: Number(released.affectedRows || released.changes || 0),
      finalized_cups: finalized.matched,
      finalize_attempted: finalized.attempted,
      finalize_failed: finalized.failed,
      limit,
      policy: 'indexed_bounded_admin_recovery'
    };
  }

  const expired = getSqliteDb()
    .prepare(
      `UPDATE arena_cup_queue
          SET status = 'EXPIRED'
        WHERE id IN (
          SELECT id
          FROM arena_cup_queue
          WHERE status IN ('WAITING', 'MATCHING')
            AND expires_at <= CURRENT_TIMESTAMP
          LIMIT ?
        )`
    )
    .run(limit);
  const released = getSqliteDb()
    .prepare(
      `UPDATE arena_cup_queue
          SET status = 'WAITING'
        WHERE id IN (
          SELECT id
          FROM arena_cup_queue
          WHERE season_id = ?
            AND status = 'MATCHING'
            AND cup_id IS NULL
            AND expires_at > CURRENT_TIMESTAMP
            AND queued_at < datetime('now', '-5 minutes')
          LIMIT ?
        )`
    )
    .run(getArenaCurrentSeasonId(), limit);
  lastCupCleanupAt = Date.now();
  const finalized = await finalizeWaitingArenaCups(Math.min(CUP_RECOVERY_FINALIZE_LIMIT, Math.max(1, Math.floor(limit / CUP_SIZE))));
  return {
    expired: Number(expired.changes || 0),
    released_matching: Number(released.changes || 0),
    finalized_cups: finalized.matched,
    finalize_attempted: finalized.attempted,
    finalize_failed: finalized.failed,
    limit,
    policy: 'indexed_bounded_admin_recovery'
  };
};

export const getArenaCupDetail = async (cupId: string, viewer?: { userId?: string | null; role?: string | null }) => {
  await ensureArenaCupTables();
  const query = `SELECT id, season_id, status, participant_count, champion_user_id, bracket_json, replay_json, created_at, completed_at FROM arena_cups WHERE id = ? LIMIT 1`;
  const row = getDbMode() === 'MYSQL'
    ? await getMysqlDb().get<RawCupRow>(query, cupId)
    : getSqliteDb().prepare(query).get(cupId) as RawCupRow | undefined;
  if (!row) return null;
  const bracket = parseJson<any>(row.bracket_json, null);
  const viewerUserId = String(viewer?.userId || '').trim();
  const isAdmin = viewer?.role === 'ADMIN';
  const isParticipant = Boolean(viewerUserId && Array.isArray(bracket?.participants)
    && bracket.participants.some((participant: any) => String(participant?.user_id || '') === viewerUserId));
  if (!isAdmin && !isParticipant) return null;

  return {
    cup: {
      id: String(row.id),
      season_id: row.season_id,
      status: row.status,
      participant_count: Number(row.participant_count || CUP_SIZE),
      champion_user_id: row.champion_user_id,
      bracket,
      replay: parseJson(await loadArenaCupReplayJson(String(row.id), row.replay_json), null),
      created_at: row.created_at,
      completed_at: row.completed_at
    },
    low_load_policy: {
      realtime_rooms: false,
      source: 'single_cup_row_plus_replay_table',
      db_access_pattern: 'single_cup_primary_key_lookup_with_participant_gate',
      public_access: false
    }
  };
};
export const getArenaCupAdminOverview = async () => {
  await ensureArenaCupTables();
  await maybeCleanupExpiredCupQueue();

  const queueQuery = `SELECT status, COUNT(*) AS count
    FROM arena_cup_queue
    WHERE season_id = ?
    GROUP BY status`;
  const cupQuery = `SELECT COUNT(*) AS count
    FROM arena_cups
    WHERE season_id = ?`;
  const latestQuery = `SELECT id, status, participant_count, champion_user_id, created_at, completed_at
    FROM arena_cups
    WHERE season_id = ?
    ORDER BY id DESC
    LIMIT 10`;

  const queueRows = getDbMode() === 'MYSQL'
    ? await getMysqlDb().all<any>(queueQuery, getArenaCurrentSeasonId())
    : getSqliteDb().prepare(queueQuery).all(getArenaCurrentSeasonId()) as any[];
  const cupCountRow = getDbMode() === 'MYSQL'
    ? await getMysqlDb().get<any>(cupQuery, getArenaCurrentSeasonId())
    : getSqliteDb().prepare(cupQuery).get(getArenaCurrentSeasonId()) as any;
  const latestRows = getDbMode() === 'MYSQL'
    ? await getMysqlDb().all<any>(latestQuery, getArenaCurrentSeasonId())
    : getSqliteDb().prepare(latestQuery).all(getArenaCurrentSeasonId()) as any[];

  const queueByStatus = queueRows.reduce<Record<string, number>>((acc, row) => {
    acc[String(row.status || 'UNKNOWN').toLowerCase()] = Number(row.count || 0);
    return acc;
  }, {});

  return {
    enabled: isArenaCupEnabled(),
    season_id: getArenaCurrentSeasonId(),
    queue: {
      waiting: queueByStatus.waiting || 0,
      matching: queueByStatus.matching || 0,
      matched: queueByStatus.matched || 0,
      cancelled: queueByStatus.cancelled || 0,
      expired: queueByStatus.expired || 0
    },
    cups_total: Number(cupCountRow?.count || 0),
    latest_cups: latestRows.map((row) => ({
      id: String(row.id),
      status: String(row.status || ''),
      participant_count: Number(row.participant_count || CUP_SIZE),
      champion_user_id: row.champion_user_id || null,
      created_at: row.created_at,
      completed_at: row.completed_at || null
    })),
    low_load_policy: {
      source: 'limited_counts_and_recent_cups',
      latest_limit: 10,
      realtime_rooms: false
    }
  };
};




