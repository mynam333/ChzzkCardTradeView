import { getDbMode, getMysqlDb, getSqliteDb } from './db';
import { getArenaCurrentSeasonId } from './arenaSeasonService';
import { ensureArenaMatchTables } from './arenaMatchService';

type RawArenaMatchStatRow = {
  id: number | string | bigint;
  season_id: string;
  match_type: string;
  player_a_id: string;
  player_b_id: string | null;
  winner_user_id: string | null;
  summary_json: string;
  created_at: string;
};

type ArenaAdminMetric = {
  snapshot_type: string;
  metric_key: string;
  label: string;
  sample_count: number;
  wins: number;
  losses: number;
  draws: number;
};

type RawSnapshotRow = {
  season_id: string;
  snapshot_type: string;
  metric_key: string;
  sample_count: number;
  wins: number;
  losses: number;
  draws: number;
  payload_json: string;
  snapshot_at: string;
};

const REBUILD_MATCH_LIMIT = Math.max(100, Math.min(5000, Number(process.env.ARENA_ADMIN_STATS_REBUILD_MATCH_LIMIT || 1000)));
const SNAPSHOT_READ_LIMIT = Math.max(50, Math.min(1000, Number(process.env.ARENA_ADMIN_STATS_READ_LIMIT || 300)));
const SNAPSHOT_WRITE_LIMIT = Math.max(50, Math.min(1000, Number(process.env.ARENA_ADMIN_STATS_WRITE_LIMIT || 500)));
const SNAPSHOT_READ_CACHE_TTL_MS = Math.max(2_000, Math.min(60_000, Number(process.env.ARENA_ADMIN_STATS_READ_CACHE_TTL_MS || 10_000)));

let ensureStatsTablePromise: Promise<void> | null = null;
let statsSnapshotRebuildInFlight: Promise<any> | null = null;
let statsSnapshotReadCache: { key: string; expiresAt: number; data: any } | null = null;

const parseJson = <T>(raw: unknown, fallback: T): T => {
  if (raw === null || raw === undefined || raw === '') return fallback;
  if (typeof raw === 'object') return raw as T;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
};

const ensureArenaAdminStatsTable = async () => {
  if (ensureStatsTablePromise) return ensureStatsTablePromise;

  ensureStatsTablePromise = (async () => {
    await ensureArenaMatchTables();
    if (getDbMode() === 'MYSQL') {
      await getMysqlDb().run(`
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
      return;
    }

    if (getDbMode() === 'LOCAL_SQL') {
      getSqliteDb().exec(`
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
        CREATE INDEX IF NOT EXISTS idx_arena_admin_stats_sample
          ON arena_admin_stat_snapshots (season_id, snapshot_type, sample_count);
      `);
      return;
    }

    throw new Error('ArenaAdminStatsStorageUnsupported');
  })().catch((err) => {
    ensureStatsTablePromise = null;
    throw err;
  });

  return ensureStatsTablePromise;
};

const normalizeLimit = (input: unknown, fallback: number, max: number) =>
  Math.max(1, Math.min(max, Number.parseInt(String(input || fallback), 10) || fallback));

const makeMetricKey = (snapshotType: string, key: string) => `${snapshotType}:${key}`.slice(0, 191);

const getMetric = (metrics: Map<string, ArenaAdminMetric>, snapshotType: string, key: string, label: string) => {
  const metricKey = makeMetricKey(snapshotType, key);
  const cacheKey = `${snapshotType}:${metricKey}`;
  const existing = metrics.get(cacheKey);
  if (existing) return existing;
  const created: ArenaAdminMetric = {
    snapshot_type: snapshotType,
    metric_key: metricKey,
    label,
    sample_count: 0,
    wins: 0,
    losses: 0,
    draws: 0
  };
  metrics.set(cacheKey, created);
  return created;
};

const addResult = (metric: ArenaAdminMetric, result: 'win' | 'loss' | 'draw') => {
  metric.sample_count += 1;
  if (result === 'win') metric.wins += 1;
  else if (result === 'loss') metric.losses += 1;
  else metric.draws += 1;
};

const resultForUser = (row: RawArenaMatchStatRow, userId: string): 'win' | 'loss' | 'draw' => {
  if (!row.winner_user_id) return 'draw';
  return row.winner_user_id === userId ? 'win' : 'loss';
};

const statFocusKey = (cards: any[]) => {
  const totals = { hp: 0, attack: 0, defense: 0, speed: 0, focus: 0 };
  for (const card of cards) {
    totals.hp += Number(card?.stats?.hp || 0);
    totals.attack += Number(card?.stats?.attack || 0);
    totals.defense += Number(card?.stats?.defense || 0);
    totals.speed += Number(card?.stats?.speed || 0);
    totals.focus += Number(card?.stats?.focus || 0);
  }
  return Object.entries(totals).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';
};

const collectDeckMetrics = (
  metrics: Map<string, ArenaAdminMetric>,
  deck: any,
  userId: string,
  result: 'win' | 'loss' | 'draw'
) => {
  const cards = Array.isArray(deck?.cards) ? deck.cards : [];
  if (cards.length === 0) return;

  addResult(getMetric(metrics, 'user_record', userId, userId), result);

  const classIds = Array.from(new Set<string>(cards.map((card: any) => String(card?.class_id || 'unknown')))).sort();
  const classCombo = classIds.join('+');
  addResult(getMetric(metrics, 'class_combo', classCombo, classCombo), result);

  for (const classId of classIds) {
    addResult(getMetric(metrics, 'class_single', classId, classId), result);
  }

  const skillIds = Array.from(new Set<string>(cards.flatMap((card: any) =>
    Array.isArray(card?.skills) ? card.skills.map((skill: any) => String(skill?.id || '')).filter(Boolean) : []
  ))).sort();
  for (const skillId of skillIds) {
    addResult(getMetric(metrics, 'skill_single', skillId, skillId), result);
  }

  const focus = statFocusKey(cards);
  addResult(getMetric(metrics, 'stat_focus', focus, focus), result);

  const deckSize = String(cards.length);
  addResult(getMetric(metrics, 'deck_size', deckSize, `${deckSize} cards`), result);

  const strategyChipId = String(deck?.strategy_chip_id || 'none');
  addResult(getMetric(metrics, 'strategy_chip', strategyChipId, strategyChipId), result);

  const roundPlans = Array.isArray(deck?.round_plans) ? deck.round_plans : [];
  const tacticStyles = Array.from(new Set<string>(roundPlans.map((plan: any) => String(plan?.tactic_style || '')).filter(Boolean))).sort();
  for (const tacticStyle of tacticStyles) {
    addResult(getMetric(metrics, 'tactic_style', tacticStyle, tacticStyle), result);
  }

  const focusRules = Array.from(new Set<string>(roundPlans.map((plan: any) => String(plan?.focus_rule || '')).filter(Boolean))).sort();
  for (const focusRule of focusRules) {
    addResult(getMetric(metrics, 'focus_rule', focusRule, focusRule), result);
  }
};

const loadRecentMatches = async (limit: number): Promise<RawArenaMatchStatRow[]> => {
  const query = `SELECT id, season_id, match_type, player_a_id, player_b_id, winner_user_id, summary_json, created_at
    FROM arena_matches
    WHERE season_id = ?
    ORDER BY id DESC
    LIMIT ?`;
  if (getDbMode() === 'MYSQL') {
    return getMysqlDb().all<RawArenaMatchStatRow>(query, getArenaCurrentSeasonId(), limit);
  }
  return getSqliteDb().prepare(query).all(getArenaCurrentSeasonId(), limit) as RawArenaMatchStatRow[];
};

const toSnapshotPayload = (metric: ArenaAdminMetric) => ({
  label: metric.label,
  win_rate: metric.sample_count > 0 ? Number((metric.wins / metric.sample_count).toFixed(4)) : 0
});

const rebuildArenaAdminStatsSnapshotInternal = async (limitInput?: unknown) => {
  await ensureArenaAdminStatsTable();
  const limit = normalizeLimit(limitInput, REBUILD_MATCH_LIMIT, REBUILD_MATCH_LIMIT);
  const rows = await loadRecentMatches(limit);
  const metrics = new Map<string, ArenaAdminMetric>();

  for (const row of rows) {
    const summary = parseJson<any>(row.summary_json, {});
    collectDeckMetrics(metrics, summary.player_deck, row.player_a_id, resultForUser(row, row.player_a_id));
    if (row.player_b_id) {
      collectDeckMetrics(metrics, summary.opponent_deck || summary.bot_deck, row.player_b_id, resultForUser(row, row.player_b_id));
    }
  }

  const snapshotRows = Array.from(metrics.values())
    .sort((a, b) => b.sample_count - a.sample_count || a.snapshot_type.localeCompare(b.snapshot_type))
    .slice(0, SNAPSHOT_WRITE_LIMIT);

  if (getDbMode() === 'MYSQL') {
    await getMysqlDb().transaction(async (tx) => {
      await tx.run(`DELETE FROM arena_admin_stat_snapshots WHERE season_id = ?`, getArenaCurrentSeasonId());
      for (const metric of snapshotRows) {
        await tx.run(
          `INSERT INTO arena_admin_stat_snapshots
            (season_id, snapshot_type, metric_key, sample_count, wins, losses, draws, payload_json, snapshot_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
          getArenaCurrentSeasonId(),
          metric.snapshot_type,
          metric.metric_key,
          metric.sample_count,
          metric.wins,
          metric.losses,
          metric.draws,
          JSON.stringify(toSnapshotPayload(metric))
        );
      }
    });
  } else {
    const db = getSqliteDb();
    db.transaction(() => {
      db.prepare(`DELETE FROM arena_admin_stat_snapshots WHERE season_id = ?`).run(getArenaCurrentSeasonId());
      const stmt = db.prepare(
        `INSERT INTO arena_admin_stat_snapshots
          (season_id, snapshot_type, metric_key, sample_count, wins, losses, draws, payload_json, snapshot_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
      );
      for (const metric of snapshotRows) {
        stmt.run(
          getArenaCurrentSeasonId(),
          metric.snapshot_type,
          metric.metric_key,
          metric.sample_count,
          metric.wins,
          metric.losses,
          metric.draws,
          JSON.stringify(toSnapshotPayload(metric))
        );
      }
    })();
  }

  return {
    season_id: getArenaCurrentSeasonId(),
    source: 'arena_matches_recent_limited',
    scanned_matches: rows.length,
    written_metrics: snapshotRows.length,
    limit,
    snapshot_at: new Date().toISOString()
  };
};

export const rebuildArenaAdminStatsSnapshot = async (limitInput?: unknown) => {
  if (statsSnapshotRebuildInFlight) throw new Error('ArenaAdminStatsRebuildAlreadyRunning');
  statsSnapshotRebuildInFlight = rebuildArenaAdminStatsSnapshotInternal(limitInput);
  try {
    const result = await statsSnapshotRebuildInFlight;
    statsSnapshotReadCache = null;
    return result;
  } finally {
    statsSnapshotRebuildInFlight = null;
  }
};

export const listArenaAdminStatsSnapshot = async (limitInput?: unknown) => {
  await ensureArenaAdminStatsTable();
  const limit = normalizeLimit(limitInput, SNAPSHOT_READ_LIMIT, SNAPSHOT_READ_LIMIT);
  const cacheKey = `${getArenaCurrentSeasonId()}:${limit}`;
  if (statsSnapshotReadCache && statsSnapshotReadCache.key === cacheKey && statsSnapshotReadCache.expiresAt > Date.now()) {
    return statsSnapshotReadCache.data;
  }
  const query = `SELECT season_id, snapshot_type, metric_key, sample_count, wins, losses, draws, payload_json, snapshot_at
    FROM arena_admin_stat_snapshots
    WHERE season_id = ?
    ORDER BY snapshot_type ASC, sample_count DESC
    LIMIT ?`;
  const rows = getDbMode() === 'MYSQL'
    ? await getMysqlDb().all<RawSnapshotRow>(query, getArenaCurrentSeasonId(), limit)
    : getSqliteDb().prepare(query).all(getArenaCurrentSeasonId(), limit) as RawSnapshotRow[];

  const payload = {
    season_id: getArenaCurrentSeasonId(),
    source: rows.length > 0 ? 'admin_stat_snapshot' : 'admin_stat_snapshot_empty',
    snapshot_at: rows[0]?.snapshot_at ? new Date(rows[0].snapshot_at).toISOString() : null,
    items: rows.map((row) => {
      const payload = parseJson<{ label?: string; win_rate?: number }>(row.payload_json, {});
      return {
        snapshot_type: row.snapshot_type,
        metric_key: row.metric_key,
        label: payload.label || row.metric_key,
        sample_count: Number(row.sample_count || 0),
        wins: Number(row.wins || 0),
        losses: Number(row.losses || 0),
        draws: Number(row.draws || 0),
        win_rate: Number(payload.win_rate || 0)
      };
    })
  };
  statsSnapshotReadCache = { key: cacheKey, data: payload, expiresAt: Date.now() + SNAPSHOT_READ_CACHE_TTL_MS };
  return payload;
};



