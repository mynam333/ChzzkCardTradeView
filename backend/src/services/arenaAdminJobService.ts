import { getDbMode, getMysqlDb, getSqliteDb } from './db';

export type ArenaAdminJobType = 'stats_rebuild' | 'rankings_rebuild' | 'replay_prune';

type ArenaAdminJobRow = {
  id: number | string | bigint;
  job_type: ArenaAdminJobType | string;
  status: string;
  payload_json: string | null;
  result_json: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

const MAX_JOB_READ_LIMIT = 20;
let ensureArenaAdminJobsPromise: Promise<void> | null = null;

const parseJson = <T>(raw: unknown, fallback: T): T => {
  if (raw === null || raw === undefined || raw === '') return fallback;
  if (typeof raw === 'object') return raw as T;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
};

const mapJob = (row: ArenaAdminJobRow) => ({
  id: String(row.id),
  job_type: row.job_type,
  status: row.status,
  payload: parseJson(row.payload_json, {}),
  result: parseJson(row.result_json, null),
  error_message: row.error_message,
  created_at: row.created_at,
  started_at: row.started_at,
  finished_at: row.finished_at
});

export const ensureArenaAdminJobTable = async () => {
  if (ensureArenaAdminJobsPromise) return ensureArenaAdminJobsPromise;
  ensureArenaAdminJobsPromise = (async () => {
    if (getDbMode() === 'MYSQL') {
      await getMysqlDb().run(`
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
      return;
    }

    if (getDbMode() === 'LOCAL_SQL') {
      getSqliteDb().exec(`
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
      `);
      return;
    }

    throw new Error('ArenaAdminJobsStorageUnsupported');
  })().catch((err) => {
    ensureArenaAdminJobsPromise = null;
    throw err;
  });
  return ensureArenaAdminJobsPromise;
};

const assertNoRunningJob = async (jobType: ArenaAdminJobType) => {
  const query = `SELECT COUNT(*) AS count
    FROM arena_admin_jobs
    WHERE job_type = ?
      AND status IN ('QUEUED', 'RUNNING')`;
  const row = getDbMode() === 'MYSQL'
    ? await getMysqlDb().get<any>(query, jobType)
    : getSqliteDb().prepare(query).get(jobType) as any;
  if (Number(row?.count || 0) > 0) throw new Error('ArenaAdminJobAlreadyRunning');
};

const createJob = async (jobType: ArenaAdminJobType, payload: unknown) => {
  await ensureArenaAdminJobTable();
  await assertNoRunningJob(jobType);
  const payloadJson = JSON.stringify(payload || {});
  if (getDbMode() === 'MYSQL') {
    const result = await getMysqlDb().run(
      `INSERT INTO arena_admin_jobs (job_type, status, payload_json)
       VALUES (?, 'QUEUED', ?)`,
      jobType,
      payloadJson
    );
    return String(result.insertId);
  }
  const result = getSqliteDb()
    .prepare(`INSERT INTO arena_admin_jobs (job_type, status, payload_json) VALUES (?, 'QUEUED', ?)`)
    .run(jobType, payloadJson);
  return String(result.lastInsertRowid);
};

const markJobRunning = async (jobId: string) => {
  if (getDbMode() === 'MYSQL') {
    await getMysqlDb().run(`UPDATE arena_admin_jobs SET status = 'RUNNING', started_at = UTC_TIMESTAMP() WHERE id = ?`, jobId);
    return;
  }
  getSqliteDb().prepare(`UPDATE arena_admin_jobs SET status = 'RUNNING', started_at = CURRENT_TIMESTAMP WHERE id = ?`).run(jobId);
};

const markJobSucceeded = async (jobId: string, result: unknown) => {
  const resultJson = JSON.stringify(result || {});
  if (getDbMode() === 'MYSQL') {
    await getMysqlDb().run(
      `UPDATE arena_admin_jobs
          SET status = 'SUCCEEDED', result_json = ?, finished_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      resultJson,
      jobId
    );
    return;
  }
  getSqliteDb()
    .prepare(`UPDATE arena_admin_jobs SET status = 'SUCCEEDED', result_json = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(resultJson, jobId);
};

const markJobFailed = async (jobId: string, err: any) => {
  const message = String(err?.message || err || 'Unknown error').slice(0, 500);
  if (getDbMode() === 'MYSQL') {
    await getMysqlDb().run(
      `UPDATE arena_admin_jobs
          SET status = 'FAILED', error_message = ?, finished_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      message,
      jobId
    );
    return;
  }
  getSqliteDb()
    .prepare(`UPDATE arena_admin_jobs SET status = 'FAILED', error_message = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(message, jobId);
};

export const startArenaAdminJob = async (
  jobType: ArenaAdminJobType,
  payload: unknown
) => {
  const jobId = await createJob(jobType, payload);
  return { id: jobId, job_type: jobType, status: 'QUEUED', payload: payload || {} };
};

export const claimNextArenaAdminJob = async () => {
  await ensureArenaAdminJobTable();
  const query = `SELECT *
    FROM arena_admin_jobs
    WHERE status = 'QUEUED'
    ORDER BY id ASC
    LIMIT 1`;
  const row = getDbMode() === 'MYSQL'
    ? await getMysqlDb().get<ArenaAdminJobRow>(query)
    : getSqliteDb().prepare(query).get() as ArenaAdminJobRow | undefined;
  if (!row) return null;

  if (getDbMode() === 'MYSQL') {
    const result = await getMysqlDb().run(
      `UPDATE arena_admin_jobs
          SET status = 'RUNNING', started_at = UTC_TIMESTAMP()
        WHERE id = ? AND status = 'QUEUED'`,
      row.id
    );
    if (Number(result.affectedRows || 0) !== 1) return null;
  } else {
    const result = getSqliteDb()
      .prepare(`UPDATE arena_admin_jobs SET status = 'RUNNING', started_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'QUEUED'`)
      .run(row.id);
    if (Number(result.changes || 0) !== 1) return null;
  }

  return mapJob({ ...row, status: 'RUNNING', started_at: new Date().toISOString() });
};

export const completeArenaAdminJob = async (jobId: string, result: unknown) => {
  await markJobSucceeded(jobId, result);
};

export const failArenaAdminJob = async (jobId: string, err: unknown) => {
  await markJobFailed(jobId, err);
};

export const resetStaleArenaAdminJobs = async (minutesInput?: unknown) => {
  await ensureArenaAdminJobTable();
  const minutes = Math.max(5, Math.min(240, Number.parseInt(String(minutesInput || 30), 10) || 30));
  if (getDbMode() === 'MYSQL') {
    const result = await getMysqlDb().run(
      `UPDATE arena_admin_jobs
          SET status = 'QUEUED', started_at = NULL, error_message = NULL
        WHERE status = 'RUNNING'
          AND started_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)`,
      minutes
    );
    return { reset: Number(result.affectedRows || 0), stale_after_minutes: minutes };
  }

  const result = getSqliteDb()
    .prepare(
      `UPDATE arena_admin_jobs
          SET status = 'QUEUED', started_at = NULL, error_message = NULL
        WHERE status = 'RUNNING'
          AND started_at < datetime('now', ?)`
    )
    .run(`-${minutes} minutes`);
  return { reset: Number(result.changes || 0), stale_after_minutes: minutes };
};

export const listArenaAdminJobs = async (limitInput?: unknown) => {
  await ensureArenaAdminJobTable();
  const limit = Math.max(1, Math.min(MAX_JOB_READ_LIMIT, Number.parseInt(String(limitInput || 10), 10) || 10));
  const query = `SELECT *
    FROM arena_admin_jobs
    ORDER BY id DESC
    LIMIT ?`;
  const rows = getDbMode() === 'MYSQL'
    ? await getMysqlDb().all<ArenaAdminJobRow>(query, limit)
    : getSqliteDb().prepare(query).all(limit) as ArenaAdminJobRow[];
  return {
    items: rows.map(mapJob),
    limit,
    source: 'arena_admin_jobs'
  };
};

let ensureArenaWorkerHeartbeatPromise: Promise<void> | null = null;

export const ensureArenaWorkerHeartbeatTable = async () => {
  if (ensureArenaWorkerHeartbeatPromise) return ensureArenaWorkerHeartbeatPromise;
  ensureArenaWorkerHeartbeatPromise = (async () => {
    if (getDbMode() === 'MYSQL') {
      await getMysqlDb().run(`
        CREATE TABLE IF NOT EXISTS arena_worker_heartbeats (
          worker_id VARCHAR(128) NOT NULL PRIMARY KEY,
          process_role VARCHAR(64) NOT NULL,
          status VARCHAR(24) NOT NULL DEFAULT 'ONLINE',
          payload_json JSON NULL,
          heartbeat_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_arena_worker_heartbeat_at (heartbeat_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      return;
    }

    if (getDbMode() === 'LOCAL_SQL') {
      getSqliteDb().exec(`
        CREATE TABLE IF NOT EXISTS arena_worker_heartbeats (
          worker_id TEXT NOT NULL PRIMARY KEY,
          process_role TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ONLINE',
          payload_json TEXT,
          heartbeat_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_arena_worker_heartbeat_at ON arena_worker_heartbeats (heartbeat_at);
      `);
      return;
    }

    throw new Error('ArenaWorkerHeartbeatStorageUnsupported');
  })().catch((err) => {
    ensureArenaWorkerHeartbeatPromise = null;
    throw err;
  });
  return ensureArenaWorkerHeartbeatPromise;
};

export const recordArenaWorkerHeartbeat = async (payload: Record<string, unknown> = {}) => {
  await ensureArenaWorkerHeartbeatTable();
  const processRole = String(process.env.PROCESS_ROLE || 'arena-worker');
  const workerSlot = String(process.env.NODE_APP_INSTANCE || process.env.pm_id || '0');
  const workerId = String(process.env.ARENA_WORKER_ID || `${processRole}:${workerSlot}`);
  const payloadJson = JSON.stringify({ ...payload, pid: process.pid, worker_slot: workerSlot });
  if (getDbMode() === 'MYSQL') {
    await getMysqlDb().run(
      `INSERT INTO arena_worker_heartbeats (worker_id, process_role, status, payload_json, heartbeat_at)
       VALUES (?, ?, 'ONLINE', ?, UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE
         process_role = VALUES(process_role),
         status = VALUES(status),
         payload_json = VALUES(payload_json),
         heartbeat_at = VALUES(heartbeat_at),
         updated_at = UTC_TIMESTAMP()`,
      workerId,
      processRole,
      payloadJson
    );
    return { worker_id: workerId, heartbeat_at: new Date().toISOString() };
  }

  getSqliteDb()
    .prepare(
      `INSERT INTO arena_worker_heartbeats (worker_id, process_role, status, payload_json, heartbeat_at, updated_at)
       VALUES (?, ?, 'ONLINE', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(worker_id) DO UPDATE SET
         process_role = excluded.process_role,
         status = excluded.status,
         payload_json = excluded.payload_json,
         heartbeat_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`
    )
    .run(workerId, processRole, payloadJson);
  return { worker_id: workerId, heartbeat_at: new Date().toISOString() };
};

const parseDbDate = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isFinite(parsed) ? parsed : null;
};

export const getArenaWorkerHeartbeatStatus = async () => {
  await ensureArenaWorkerHeartbeatTable();
  const staleAfterMs = Math.max(60_000, Math.min(900_000, Number(process.env.ARENA_WORKER_HEARTBEAT_STALE_MS || 180_000)));
  const query = `SELECT worker_id, process_role, status, payload_json, heartbeat_at, updated_at
    FROM arena_worker_heartbeats
    ORDER BY heartbeat_at DESC
    LIMIT 5`;
  const rows = getDbMode() === 'MYSQL'
    ? await getMysqlDb().all<any>(query)
    : getSqliteDb().prepare(query).all() as any[];
  const now = Date.now();
  const items = rows.map((row) => {
    const heartbeatMs = parseDbDate(row.heartbeat_at);
    return {
      worker_id: String(row.worker_id || ''),
      process_role: String(row.process_role || ''),
      status: heartbeatMs && now - heartbeatMs <= staleAfterMs ? 'ONLINE' : 'STALE',
      heartbeat_at: row.heartbeat_at,
      seconds_since_heartbeat: heartbeatMs ? Math.max(0, Math.floor((now - heartbeatMs) / 1000)) : null,
      payload: parseJson(row.payload_json, {})
    };
  });
  return {
    ok: items.some((item) => item.status === 'ONLINE'),
    stale_after_ms: staleAfterMs,
    items,
    source: 'arena_worker_heartbeats'
  };
};
