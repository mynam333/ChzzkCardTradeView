import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import { getDbMode, getMysqlDb, getSqliteDb } from './db';
import { ArenaDeck, getArenaDeck, validateArenaDeckInput } from './arenaDeckService';
import { getArenaCurrentSeasonId, isArenaSeasonOpen } from './arenaSeasonService';
import {
  ArenaDeckSnapshot,
  createPendingRankedArenaMatch,
  ensureArenaMatchTables,
  getArenaMatchForUser,
  loadArenaDeckSnapshot
} from './arenaMatchService';
import { pickArenaBattlefieldRule } from './arenaBattleSimulator';
import { getArenaOpsConfigSync } from './arenaOpsConfig';

const QUEUE_TTL_SECONDS = Math.max(30, Number(process.env.ARENA_QUICK_QUEUE_TTL_SECONDS || 60));
const QUEUE_REJOIN_COOLDOWN_SECONDS = Math.max(0, Math.min(30, Number(process.env.ARENA_QUICK_REJOIN_COOLDOWN_SECONDS || 5)));
const QUEUE_CLEANUP_INTERVAL_MS = Math.max(10_000, Number(process.env.ARENA_QUICK_QUEUE_CLEANUP_INTERVAL_MS || 30_000));
const MAX_QUEUE_CLEANUP_ROWS = Math.max(10, Number(process.env.ARENA_QUICK_QUEUE_CLEANUP_LIMIT || 100));
const MMR_BUCKET_SIZE = Math.max(50, Number(process.env.ARENA_QUICK_MMR_BUCKET_SIZE || 100));
const MAX_QUEUE_CANDIDATES = Math.max(1, Math.min(20, Number(process.env.ARENA_QUICK_MAX_CANDIDATES || 10)));
const QUEUE_RECOVERY_MATCH_LIMIT = Math.max(1, Math.min(20, Number(process.env.ARENA_QUICK_RECOVERY_MATCH_LIMIT || 8)));
const SAME_OPPONENT_COOLDOWN_MINUTES = Math.max(0, Math.min(60, Number(process.env.ARENA_SAME_OPPONENT_COOLDOWN_MINUTES || 10)));
const MAX_SAME_OPPONENT_MATCHES_PER_HOUR = Math.max(1, Math.min(20, Number(process.env.ARENA_MAX_SAME_OPPONENT_MATCHES_PER_HOUR || 3)));
const SAME_OPPONENT_SCAN_LIMIT = Math.max(20, Math.min(300, Number(process.env.ARENA_SAME_OPPONENT_SCAN_LIMIT || 120)));

let ensureQueueTablePromise: Promise<void> | null = null;
let lastQueueCleanupAt = 0;
const quickMatchEvents = new EventEmitter();
quickMatchEvents.setMaxListeners(Math.max(100, Number(process.env.ARENA_QUICK_SSE_MAX_LISTENERS || 1000)));


const QUEUE_COLUMNS = `id, user_id, season_id, deck_id, deck_hash, round_plan_hash, mmr, mmr_bucket,
  status, queued_at, expires_at, matched_match_id`;

export const isArenaQuickMatchEnabled = () => isArenaSeasonOpen() && getArenaOpsConfigSync().quick_match_enabled;

export type ArenaQuickMatchStatus = 'queued' | 'matched' | 'cancelled' | 'expired' | 'none';

export interface ArenaQuickMatchResponse {
  status: ArenaQuickMatchStatus;
  queue_ticket_id: string | null;
  match_id: string | null;
  elapsed_sec: number;
  poll_after_sec: number | null;
  resume_available: boolean;
  expires_at?: string | null;
  message?: string;
}

type QueueRow = {
  id: number | string | bigint;
  user_id: string;
  season_id: string;
  deck_id: string;
  deck_hash: string;
  round_plan_hash: string;
  mmr: number;
  mmr_bucket: number;
  status: ArenaQuickMatchStatus | 'WAITING' | 'MATCHING' | 'MATCHED' | 'CANCELLED' | 'EXPIRED';
  queued_at: string;
  expires_at: string;
  matched_match_id: number | string | bigint | null;
};

type RatingRow = {
  user_id: string;
  mmr: number;
  rating_points: number;
  tier: string;
  wins: number;
  losses: number;
  draws: number;
};

const normalizeQueueStatus = (status: QueueRow['status']): ArenaQuickMatchStatus => {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'WAITING' || normalized === 'MATCHING') return 'queued';
  if (normalized === 'MATCHED') return 'matched';
  if (normalized === 'CANCELLED') return 'cancelled';
  if (normalized === 'EXPIRED') return 'expired';
  return 'none';
};

const mmrBucket = (mmr: number) => Math.floor(mmr / MMR_BUCKET_SIZE) * MMR_BUCKET_SIZE;

const parseDbTime = (value: string | null | undefined): number => {
  if (!value) return Date.now();
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const normalized = hasTimezone ? value.replace(' ', 'T') : `${value.replace(' ', 'T')}+09:00`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : Date.now();
};

const secondsSince = (value: string | null | undefined) => Math.max(0, Math.floor((Date.now() - parseDbTime(value)) / 1000));


const quickEventKey = (userId: string) => `quick:${userId}`;
const emitArenaQuickMatchEvent = (userId: string, payload: ArenaQuickMatchResponse) => {
  quickMatchEvents.emit(quickEventKey(userId), payload);
};
export const subscribeArenaQuickMatchEvents = (userId: string, listener: (payload: ArenaQuickMatchResponse) => void) => {
  const key = quickEventKey(userId);
  quickMatchEvents.on(key, listener);
  return () => quickMatchEvents.off(key, listener);
};

const toResponse = (row: QueueRow | null | undefined): ArenaQuickMatchResponse => {
  if (!row) {
    return {
      status: 'none',
      queue_ticket_id: null,
      match_id: null,
      elapsed_sec: 0,
      poll_after_sec: null,
      resume_available: false
    };
  }

  const status = normalizeQueueStatus(row.status);
  return {
    status,
    queue_ticket_id: String(row.id),
    match_id: row.matched_match_id ? String(row.matched_match_id) : null,
    elapsed_sec: secondsSince(row.queued_at),
    poll_after_sec: status === 'queued' ? 3 : null,
    resume_available: status === 'matched' && Boolean(row.matched_match_id),
    expires_at: row.expires_at
  };
};

const ensureArenaQueueTable = async () => {
  if (ensureQueueTablePromise) return ensureQueueTablePromise;

  ensureQueueTablePromise = (async () => {
    if (getDbMode() === 'MYSQL') {
      await getMysqlDb().run(`
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
      return;
    }

    if (getDbMode() === 'LOCAL_SQL') {
      getSqliteDb().exec(`
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
      `);
      return;
    }

    throw new Error('ArenaMatchStorageUnsupported');
  })().catch((err) => {
    ensureQueueTablePromise = null;
    throw err;
  });

  return ensureQueueTablePromise;
};

const maybeCleanupExpiredQueue = async () => {
  const now = Date.now();
  if (now - lastQueueCleanupAt < QUEUE_CLEANUP_INTERVAL_MS) return;
  lastQueueCleanupAt = now;

  if (getDbMode() === 'MYSQL') {
    await getMysqlDb().run(
      `UPDATE arena_match_queue
          SET status = 'EXPIRED'
        WHERE status = 'WAITING'
          AND expires_at <= UTC_TIMESTAMP()
        LIMIT ?`,
      MAX_QUEUE_CLEANUP_ROWS
    );
    return;
  }

  getSqliteDb()
    .prepare(
      `UPDATE arena_match_queue
          SET status = 'EXPIRED'
        WHERE id IN (
          SELECT id FROM arena_match_queue
           WHERE status = 'WAITING'
             AND expires_at <= datetime('now')
           LIMIT ?
        )`
    )
    .run(MAX_QUEUE_CLEANUP_ROWS);
};

const loadLatestQueueForUser = async (userId: string): Promise<QueueRow | null> => {
  if (getDbMode() === 'MYSQL') {
    const row = await getMysqlDb().get<QueueRow>(
      `SELECT ${QUEUE_COLUMNS} FROM arena_match_queue
        WHERE user_id = ? AND season_id = ?
        ORDER BY id DESC
        LIMIT 1`,
      userId,
      getArenaCurrentSeasonId()
    );
    return row || null;
  }

  const row = getSqliteDb()
    .prepare(
      `SELECT ${QUEUE_COLUMNS} FROM arena_match_queue
        WHERE user_id = ? AND season_id = ?
        ORDER BY id DESC
        LIMIT 1`
    )
    .get(userId, getArenaCurrentSeasonId()) as QueueRow | undefined;
  return row || null;
};

const loadActiveQueueForUser = async (userId: string): Promise<QueueRow | null> => {
  if (getDbMode() === 'MYSQL') {
    const row = await getMysqlDb().get<QueueRow>(
      `SELECT ${QUEUE_COLUMNS} FROM arena_match_queue
        WHERE user_id = ?
          AND season_id = ?
          AND status IN ('WAITING', 'MATCHING', 'MATCHED')
        ORDER BY id DESC
        LIMIT 1`,
      userId,
      getArenaCurrentSeasonId()
    );
    return row || null;
  }

  const row = getSqliteDb()
    .prepare(
      `SELECT ${QUEUE_COLUMNS} FROM arena_match_queue
        WHERE user_id = ?
          AND season_id = ?
          AND status IN ('WAITING', 'MATCHING', 'MATCHED')
        ORDER BY id DESC
        LIMIT 1`
    )
    .get(userId, getArenaCurrentSeasonId()) as QueueRow | undefined;
  return row || null;
};

const loadWaitingQueuesForRecovery = async (limit: number): Promise<QueueRow[]> => {
  const query = `SELECT ${QUEUE_COLUMNS} FROM arena_match_queue
    WHERE season_id = ?
      AND status = 'WAITING'
      AND expires_at > ${getDbMode() === 'MYSQL' ? 'UTC_TIMESTAMP()' : "datetime('now')"}
    ORDER BY queued_at ASC, id ASC
    LIMIT ?`;
  return getDbMode() === 'MYSQL'
    ? await getMysqlDb().all<QueueRow>(query, getArenaCurrentSeasonId(), limit)
    : getSqliteDb().prepare(query).all(getArenaCurrentSeasonId(), limit) as QueueRow[];
};

const loadRating = async (userId: string): Promise<RatingRow> => {
  const fallback: RatingRow = {
    user_id: userId,
    mmr: 1000,
    rating_points: 0,
    tier: 'BRONZE',
    wins: 0,
    losses: 0,
    draws: 0
  };

  if (getDbMode() === 'MYSQL') {
    const row = await getMysqlDb().get<any>(
      `SELECT user_id, mmr, rating_points, tier, wins, losses, draws
         FROM arena_player_ratings
        WHERE season_id = ? AND user_id = ?
        LIMIT 1`,
      getArenaCurrentSeasonId(),
      userId
    );
    return row ? { ...fallback, ...row, mmr: Number(row.mmr || 1000), rating_points: Number(row.rating_points || 0), wins: Number(row.wins || 0), losses: Number(row.losses || 0), draws: Number(row.draws || 0) } : fallback;
  }

  const row = getSqliteDb()
    .prepare(
      `SELECT user_id, mmr, rating_points, tier, wins, losses, draws
         FROM arena_player_ratings
        WHERE season_id = ? AND user_id = ?
        LIMIT 1`
    )
    .get(getArenaCurrentSeasonId(), userId) as any;
  return row ? { ...fallback, ...row, mmr: Number(row.mmr || 1000), rating_points: Number(row.rating_points || 0), wins: Number(row.wins || 0), losses: Number(row.losses || 0), draws: Number(row.draws || 0) } : fallback;
};

const insertQueue = async (userId: string, deck: ArenaDeck, rating: RatingRow): Promise<QueueRow> => {
  const bucket = mmrBucket(rating.mmr);
  if (getDbMode() === 'MYSQL') {
    const result = await getMysqlDb().run(
      `INSERT INTO arena_match_queue
        (user_id, season_id, deck_id, deck_hash, round_plan_hash, mmr, mmr_bucket, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'WAITING', DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))`,
      userId,
      getArenaCurrentSeasonId(),
      deck.id,
      deck.deck_hash,
      deck.deck_hash,
      rating.mmr,
      bucket,
      QUEUE_TTL_SECONDS
    );
    const row = await loadLatestQueueForUser(userId);
    if (!row || String(row.id) !== String(result.insertId)) throw new Error('ArenaQueueCreateReadbackFailed');
    emitArenaQuickMatchEvent(userId, toResponse(row));
    return row;
  }

  const result = getSqliteDb()
    .prepare(
      `INSERT INTO arena_match_queue
        (user_id, season_id, deck_id, deck_hash, round_plan_hash, mmr, mmr_bucket, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'WAITING', datetime('now', '+' || ? || ' seconds'))`
    )
    .run(userId, getArenaCurrentSeasonId(), deck.id, deck.deck_hash, deck.deck_hash, rating.mmr, bucket, QUEUE_TTL_SECONDS);
  const row = await loadLatestQueueForUser(userId);
  if (!row || String(row.id) !== String(result.lastInsertRowid)) throw new Error('ArenaQueueCreateReadbackFailed');
  emitArenaQuickMatchEvent(userId, toResponse(row));
  return row;
};

const loadBlockedRecentOpponents = async (userId: string): Promise<Set<string>> => {
  if (!SAME_OPPONENT_COOLDOWN_MINUTES && !MAX_SAME_OPPONENT_MATCHES_PER_HOUR) return new Set();
  const windowMinutes = Math.max(60, SAME_OPPONENT_COOLDOWN_MINUTES);
  const query = `SELECT player_a_id, player_b_id, created_at
    FROM arena_matches
    WHERE season_id = ?
      AND match_type = 'RANKED'
      AND player_b_id IS NOT NULL
      AND (player_a_id = ? OR player_b_id = ?)
      AND created_at >= ${getDbMode() === 'MYSQL'
        ? 'DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)'
        : "datetime('now', '-' || ? || ' minutes')"}
    ORDER BY id DESC
    LIMIT ?`;
  const rows = getDbMode() === 'MYSQL'
    ? await getMysqlDb().all<any>(query, getArenaCurrentSeasonId(), userId, userId, windowMinutes, SAME_OPPONENT_SCAN_LIMIT)
    : getSqliteDb().prepare(query).all(getArenaCurrentSeasonId(), userId, userId, windowMinutes, SAME_OPPONENT_SCAN_LIMIT) as any[];

  const now = Date.now();
  const opponentCounts = new Map<string, number>();
  const blocked = new Set<string>();
  for (const row of rows) {
    const opponentId = row.player_a_id === userId ? row.player_b_id : row.player_a_id;
    if (!opponentId) continue;
    const createdAtMs = parseDbTime(row.created_at);
    const ageMinutes = Math.max(0, (now - createdAtMs) / 60_000);
    opponentCounts.set(opponentId, (opponentCounts.get(opponentId) || 0) + 1);
    if (SAME_OPPONENT_COOLDOWN_MINUTES > 0 && ageMinutes <= SAME_OPPONENT_COOLDOWN_MINUTES) {
      blocked.add(opponentId);
    }
  }
  for (const [opponentId, count] of opponentCounts) {
    if (count >= MAX_SAME_OPPONENT_MATCHES_PER_HOUR) blocked.add(opponentId);
  }
  return blocked;
};

const findCandidateQueue = async (myQueue: QueueRow): Promise<QueueRow | null> => {
  const minBucket = Number(myQueue.mmr_bucket) - MMR_BUCKET_SIZE;
  const maxBucket = Number(myQueue.mmr_bucket) + MMR_BUCKET_SIZE;
  const blockedOpponents = await loadBlockedRecentOpponents(myQueue.user_id);

  if (getDbMode() === 'MYSQL') {
    const rows = await getMysqlDb().all<QueueRow>(
      `SELECT ${QUEUE_COLUMNS} FROM arena_match_queue
        WHERE season_id = ?
          AND status = 'WAITING'
          AND user_id <> ?
          AND mmr_bucket BETWEEN ? AND ?
          AND expires_at > UTC_TIMESTAMP()
        ORDER BY mmr_bucket ASC, queued_at ASC
        LIMIT ?`,
      getArenaCurrentSeasonId(),
      myQueue.user_id,
      minBucket,
      maxBucket,
      MAX_QUEUE_CANDIDATES
    );
    for (const row of rows) {
      if (String(row.id) === String(myQueue.id)) continue;
      if (blockedOpponents.has(row.user_id)) continue;
      return row;
    }
    return null;
  }

  const rows = getSqliteDb()
    .prepare(
      `SELECT ${QUEUE_COLUMNS} FROM arena_match_queue
        WHERE season_id = ?
          AND status = 'WAITING'
          AND user_id <> ?
          AND mmr_bucket BETWEEN ? AND ?
          AND expires_at > datetime('now')
        ORDER BY mmr_bucket ASC, queued_at ASC
        LIMIT ?`
    )
    .all(getArenaCurrentSeasonId(), myQueue.user_id, minBucket, maxBucket, MAX_QUEUE_CANDIDATES) as QueueRow[];
  for (const row of rows) {
    if (String(row.id) === String(myQueue.id)) continue;
    if (blockedOpponents.has(row.user_id)) continue;
    return row;
  }
  return null;
};

const reserveCandidatePair = async (myQueue: QueueRow, candidate: QueueRow): Promise<{ mine: QueueRow; opponent: QueueRow } | null> => {
  if (getDbMode() === 'MYSQL') {
    const reserved = await getMysqlDb().transaction(async (tx) => {
      const result = await tx.run(
        `UPDATE arena_match_queue
            SET status = 'MATCHING'
          WHERE id IN (?, ?)
            AND status = 'WAITING'
            AND expires_at > UTC_TIMESTAMP()`,
        myQueue.id,
        candidate.id
      );
      return result.affectedRows === 2;
    });
    return reserved ? { mine: { ...myQueue, status: 'MATCHING' }, opponent: { ...candidate, status: 'MATCHING' } } : null;
  }

  const db = getSqliteDb();
  const reserved = db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE arena_match_queue
            SET status = 'MATCHING'
          WHERE id IN (?, ?)
            AND status = 'WAITING'
            AND expires_at > datetime('now')`
      )
      .run(myQueue.id, candidate.id);
    return result.changes === 2;
  })();
  return reserved ? { mine: { ...myQueue, status: 'MATCHING' }, opponent: { ...candidate, status: 'MATCHING' } } : null;
};

const releaseCandidatePair = async (mine: QueueRow, opponent: QueueRow) => {
  if (getDbMode() === 'MYSQL') {
    await getMysqlDb().run(
      `UPDATE arena_match_queue
          SET status = 'WAITING'
        WHERE id IN (?, ?)
          AND status = 'MATCHING'
          AND matched_match_id IS NULL
          AND expires_at > UTC_TIMESTAMP()`,
      mine.id,
      opponent.id
    );
    return;
  }

  getSqliteDb()
    .prepare(
      `UPDATE arena_match_queue
          SET status = 'WAITING'
        WHERE id IN (?, ?)
          AND status = 'MATCHING'
          AND matched_match_id IS NULL
          AND expires_at > datetime('now')`
    )
    .run(mine.id, opponent.id);
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

const tryFinalizeMatch = async (myQueue: QueueRow): Promise<ArenaQuickMatchResponse | null> => {
  const candidate = await findCandidateQueue(myQueue);
  if (!candidate) return null;
  const reserved = await reserveCandidatePair(myQueue, candidate);
  if (!reserved) return null;
  const { mine, opponent } = reserved;

  let myDeck: ArenaDeck;
  let opponentDeck: ArenaDeck;
  let playerDeck: ArenaDeckSnapshot;
  let opponentDeckSnapshot: ArenaDeckSnapshot;
  try {
    [myDeck, opponentDeck] = await Promise.all([
      prepareValidDeck(mine.user_id, mine.deck_id),
      prepareValidDeck(opponent.user_id, opponent.deck_id)
    ]);
    [playerDeck, opponentDeckSnapshot] = await Promise.all([
      loadArenaDeckSnapshot(myDeck),
      loadArenaDeckSnapshot(opponentDeck)
    ]);
    if (playerDeck.cards.length < 6 || opponentDeckSnapshot.cards.length < 6) {
      await releaseCandidatePair(mine, opponent);
      return null;
    }
  } catch (err) {
    await releaseCandidatePair(mine, opponent);
    throw err;
  }

  const matchSeed = createHash('sha256')
    .update(`${getArenaCurrentSeasonId()}:${mine.id}:${opponent.id}:${myDeck.deck_hash}:${opponentDeck.deck_hash}`)
    .digest('hex');
  const battlefieldRule = pickArenaBattlefieldRule(matchSeed);

  let matchId: string | null = null;
  if (getDbMode() === 'MYSQL') {
    matchId = await getMysqlDb().transaction(async (tx) => {
      const locked = await tx.run(
        `UPDATE arena_match_queue
            SET status = 'MATCHED'
          WHERE id IN (?, ?)
            AND status = 'MATCHING'
            AND expires_at > UTC_TIMESTAMP()`,
        mine.id,
        opponent.id
      );
      if (locked.affectedRows !== 2) return null;

      const insertedMatchId = await createPendingRankedArenaMatch({
        playerAId: mine.user_id,
        playerBId: opponent.user_id,
        playerADeckId: myDeck.id,
        playerADeck: playerDeck,
        playerBDeck: opponentDeckSnapshot,
        matchSeed,
        battlefieldRule
      });
      await tx.run(`UPDATE arena_match_queue SET matched_match_id = ? WHERE id IN (?, ?)`, insertedMatchId, mine.id, opponent.id);
      return insertedMatchId;
    });
  } else {
    const db = getSqliteDb();
    const reserved = db.transaction(() => {
      const locked = db
        .prepare(
          `UPDATE arena_match_queue
              SET status = 'MATCHED'
            WHERE id IN (?, ?)
              AND status = 'MATCHING'
              AND expires_at > datetime('now')`
        )
        .run(mine.id, opponent.id);
      return locked.changes === 2;
    });
    if (reserved()) {
      matchId = await createPendingRankedArenaMatch({
        playerAId: mine.user_id,
        playerBId: opponent.user_id,
        playerADeckId: myDeck.id,
        playerADeck: playerDeck,
        playerBDeck: opponentDeckSnapshot,
        matchSeed,
        battlefieldRule
      });
      db.prepare(`UPDATE arena_match_queue SET matched_match_id = ? WHERE id IN (?, ?)`).run(matchId, mine.id, opponent.id);
    }
  }

  if (!matchId) return null;
  const matchedResponse = {
    status: 'matched' as const,
    queue_ticket_id: String(mine.id),
    match_id: matchId,
    elapsed_sec: secondsSince(mine.queued_at),
    poll_after_sec: null,
    resume_available: true
  };
  emitArenaQuickMatchEvent(mine.user_id, matchedResponse);
  emitArenaQuickMatchEvent(opponent.user_id, { ...matchedResponse, queue_ticket_id: String(opponent.id) });
  return matchedResponse;
};

export const finalizeWaitingArenaQuickMatches = async (limitInput?: unknown) => {
  await ensureArenaMatchTables();
  await ensureArenaQueueTable();
  const limit = Math.max(1, Math.min(QUEUE_RECOVERY_MATCH_LIMIT, Number.parseInt(String(limitInput || QUEUE_RECOVERY_MATCH_LIMIT), 10) || QUEUE_RECOVERY_MATCH_LIMIT));
  const rows = await loadWaitingQueuesForRecovery(limit);
  let attempted = 0;
  let matched = 0;
  let failed = 0;

  for (const row of rows) {
    attempted += 1;
    try {
      const result = await tryFinalizeMatch(row);
      if (result?.status === 'matched') matched += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    attempted,
    matched,
    failed,
    limit,
    policy: 'bounded_waiting_pair_finalize'
  };
};

export const recoverArenaQuickMatchQueue = async () => {
  await ensureArenaMatchTables();
  await ensureArenaQueueTable();
  const limit = MAX_QUEUE_CLEANUP_ROWS;

  if (getDbMode() === 'MYSQL') {
    const expired = await getMysqlDb().run(
      `UPDATE arena_match_queue
          SET status = 'EXPIRED'
        WHERE status IN ('WAITING', 'MATCHING')
          AND expires_at <= UTC_TIMESTAMP()
        LIMIT ?`,
      limit
    );
    const released = await getMysqlDb().run(
      `UPDATE arena_match_queue
          SET status = 'WAITING'
        WHERE season_id = ?
          AND status = 'MATCHING'
          AND matched_match_id IS NULL
          AND expires_at > UTC_TIMESTAMP()
          AND queued_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE)
        LIMIT ?`,
      getArenaCurrentSeasonId(),
      limit
    );
    lastQueueCleanupAt = Date.now();
    const finalized = await finalizeWaitingArenaQuickMatches(Math.min(limit, QUEUE_RECOVERY_MATCH_LIMIT));
    return {
      expired: Number(expired.affectedRows || expired.changes || 0),
      released_matching: Number(released.affectedRows || released.changes || 0),
      finalized_matches: finalized.matched,
      finalize_attempted: finalized.attempted,
      finalize_failed: finalized.failed,
      limit,
      policy: 'indexed_bounded_admin_recovery'
    };
  }

  const expired = getSqliteDb()
    .prepare(
      `UPDATE arena_match_queue
          SET status = 'EXPIRED'
        WHERE id IN (
          SELECT id
          FROM arena_match_queue
          WHERE status IN ('WAITING', 'MATCHING')
            AND expires_at <= CURRENT_TIMESTAMP
          LIMIT ?
        )`
    )
    .run(limit);
  const released = getSqliteDb()
    .prepare(
      `UPDATE arena_match_queue
          SET status = 'WAITING'
        WHERE id IN (
          SELECT id
          FROM arena_match_queue
          WHERE season_id = ?
            AND status = 'MATCHING'
            AND matched_match_id IS NULL
            AND expires_at > CURRENT_TIMESTAMP
            AND queued_at < datetime('now', '-5 minutes')
          LIMIT ?
        )`
    )
    .run(getArenaCurrentSeasonId(), limit);
  lastQueueCleanupAt = Date.now();
  const finalized = await finalizeWaitingArenaQuickMatches(Math.min(limit, QUEUE_RECOVERY_MATCH_LIMIT));
  return {
    expired: Number(expired.changes || 0),
    released_matching: Number(released.changes || 0),
    finalized_matches: finalized.matched,
    finalize_attempted: finalized.attempted,
    finalize_failed: finalized.failed,
    limit,
    policy: 'indexed_bounded_admin_recovery'
  };
};

export const getArenaQuickMatchAdminOverview = async () => {
  await ensureArenaQueueTable();
  await maybeCleanupExpiredQueue();
  const query = `SELECT status, COUNT(*) AS count
    FROM arena_match_queue
    WHERE season_id = ?
    GROUP BY status`;
  const rows = getDbMode() === 'MYSQL'
    ? await getMysqlDb().all<any>(query, getArenaCurrentSeasonId())
    : getSqliteDb().prepare(query).all(getArenaCurrentSeasonId()) as any[];
  const byStatus = rows.reduce<Record<string, number>>((acc, row) => {
    acc[String(row.status || 'UNKNOWN').toLowerCase()] = Number(row.count || 0);
    return acc;
  }, {});
  return {
    enabled: isArenaQuickMatchEnabled(),
    season_id: getArenaCurrentSeasonId(),
    queue: {
      waiting: byStatus.waiting || 0,
      matching: byStatus.matching || 0,
      matched: byStatus.matched || 0,
      cancelled: byStatus.cancelled || 0,
      expired: byStatus.expired || 0
    },
    low_load_policy: {
      source: 'grouped_queue_status_counts',
      realtime_rooms: false,
      cleanup_limit: MAX_QUEUE_CLEANUP_ROWS
    }
  };
};

export const joinArenaQuickMatch = async (userId: string, deckId: string): Promise<ArenaQuickMatchResponse> => {
  if (!isArenaQuickMatchEnabled()) throw new Error('ArenaQuickMatchDisabled');
  await ensureArenaMatchTables();
  await ensureArenaQueueTable();
  await maybeCleanupExpiredQueue();

  const active = await loadActiveQueueForUser(userId);
  if (active) {
    const status = normalizeQueueStatus(active.status);
    if (status === 'matched') return toResponse(active);
    if (status === 'queued' && parseDbTime(active.expires_at) > Date.now()) return toResponse(active);
  }

  if (QUEUE_REJOIN_COOLDOWN_SECONDS > 0) {
    const latest = await loadLatestQueueForUser(userId);
    const latestStatus = normalizeQueueStatus(latest?.status || 'none');
    if ((latestStatus === 'cancelled' || latestStatus === 'expired') && secondsSince(latest?.queued_at) < QUEUE_REJOIN_COOLDOWN_SECONDS) {
      return {
        ...toResponse(latest),
        message: '빠른 재등록 방지를 위해 잠시 뒤 다시 시도해주세요.'
      };
    }
  }

  const deck = await prepareValidDeck(userId, deckId);
  const rating = await loadRating(userId);
  const myQueue = await insertQueue(userId, deck, rating);
  const matched = await tryFinalizeMatch(myQueue);
  return matched || toResponse(myQueue);
};

export const getArenaQuickMatchStatus = async (userId: string): Promise<ArenaQuickMatchResponse> => {
  if (!isArenaQuickMatchEnabled()) throw new Error('ArenaQuickMatchDisabled');
  await ensureArenaQueueTable();
  await maybeCleanupExpiredQueue();
  const latest = await loadLatestQueueForUser(userId);
  if (!latest) return toResponse(null);

  if (normalizeQueueStatus(latest.status) === 'queued' && parseDbTime(latest.expires_at) <= Date.now()) {
    if (getDbMode() === 'MYSQL') {
      await getMysqlDb().run(`UPDATE arena_match_queue SET status = 'EXPIRED' WHERE id = ? AND status = 'WAITING'`, latest.id);
    } else {
      getSqliteDb().prepare(`UPDATE arena_match_queue SET status = 'EXPIRED' WHERE id = ? AND status = 'WAITING'`).run(latest.id);
    }
    const expired = { ...toResponse(latest), status: 'expired' as const, poll_after_sec: null };
    emitArenaQuickMatchEvent(userId, expired);
    return expired;
  }

  return toResponse(latest);
};

export const cancelArenaQuickMatch = async (userId: string): Promise<ArenaQuickMatchResponse> => {
  if (!isArenaQuickMatchEnabled()) throw new Error('ArenaQuickMatchDisabled');
  await ensureArenaQueueTable();
  const latest = await loadLatestQueueForUser(userId);
  if (!latest) return toResponse(null);
  const status = normalizeQueueStatus(latest.status);
  if (status === 'matched') return toResponse(latest);
  if (status !== 'queued') return toResponse(latest);

  if (getDbMode() === 'MYSQL') {
    await getMysqlDb().run(
      `UPDATE arena_match_queue
          SET status = 'CANCELLED'
        WHERE id = ?
          AND user_id = ?
          AND status = 'WAITING'`,
      latest.id,
      userId
    );
  } else {
    getSqliteDb()
      .prepare(
        `UPDATE arena_match_queue
            SET status = 'CANCELLED'
          WHERE id = ?
            AND user_id = ?
            AND status = 'WAITING'`
      )
      .run(latest.id, userId);
  }

  const cancelled = { ...toResponse(latest), status: 'cancelled' as const, poll_after_sec: null };
  emitArenaQuickMatchEvent(userId, cancelled);
  return cancelled;
};








