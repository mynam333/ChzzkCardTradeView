process.env.PROCESS_ROLE = process.env.PROCESS_ROLE || 'arena-worker';
process.env.MYSQL_CONNECTION_LIMIT = process.env.MYSQL_CONNECTION_LIMIT || '1';

import { bootstrapProcess } from '../services/processBootstrap';

bootstrapProcess('ArenaWorker');

const parseInterval = (value: string | undefined, fallback: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.parseInt(String(value || fallback), 10) || fallback));

const JOB_POLL_INTERVAL_MS = parseInterval(process.env.ARENA_WORKER_JOB_POLL_INTERVAL_MS, 30_000, 10_000, 300_000);
const STALE_JOB_RESET_INTERVAL_MS = parseInterval(process.env.ARENA_WORKER_STALE_JOB_RESET_INTERVAL_MS, 300_000, 60_000, 3_600_000);
const HEARTBEAT_INTERVAL_MS = parseInterval(process.env.ARENA_WORKER_HEARTBEAT_INTERVAL_MS, 30_000, 15_000, 300_000);
const TURN_TIMEOUT_SCAN_INTERVAL_MS = parseInterval(process.env.ARENA_V2_TURN_TIMEOUT_SCAN_INTERVAL_MS, 15_000, 5_000, 120_000);
const TURN_TIMEOUT_SECONDS = parseInterval(process.env.ARENA_V2_TURN_TIMEOUT_SECONDS, 40, 5, 300);
const QUEUE_EXPIRY_SCAN_INTERVAL_MS = parseInterval(process.env.ARENA_V2_QUEUE_EXPIRY_SCAN_INTERVAL_MS, 60_000, 15_000, 300_000);
const REPLAY_PRUNE_INTERVAL_MS = parseInterval(process.env.ARENA_V2_REPLAY_PRUNE_INTERVAL_MS, 3_600_000, 300_000, 86_400_000);
const WORKER_STARTED_AT = new Date().toISOString();

let jobTimer: NodeJS.Timeout | null = null;
let staleTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let turnTimeoutTimer: NodeJS.Timeout | null = null;
let queueExpiryTimer: NodeJS.Timeout | null = null;
let replayPruneTimer: NodeJS.Timeout | null = null;
let jobInFlight = false;
let staleResetInFlight = false;
let turnTimeoutInFlight = false;
let queueExpiryInFlight = false;
let replayPruneInFlight = false;

const start = async () => {
  const [
    { initDatabaseConnection },
    { initRepositories },
    { getRuntimeStats },
    { setRuntimeStatsProvider, startRuntimeStatsLogging },
    adminJobs,
    arenaV2Service
  ] = await Promise.all([
    import('../services/db'),
    import('../repositories'),
    import('../services/runtimeStats'),
    import('../services/fileLogger'),
    import('../services/arenaAdminJobService'),
    import('../services/arenaV2Service')
  ]);

  setRuntimeStatsProvider(getRuntimeStats);
  startRuntimeStatsLogging();

  await initDatabaseConnection();
  initRepositories();

  const executeJob = async () => {
    if (jobInFlight) return;
    jobInFlight = true;
    try {
      const job = await adminJobs.claimNextArenaAdminJob();
      if (!job) return;
      await adminJobs.completeArenaAdminJob(job.id, {
        skipped: true,
        arenaVersion: 'v2',
        reason: 'Legacy arena admin jobs are disabled after the v2 GDD replacement.',
        jobType: job.job_type
      });
      console.log(`[ArenaWorker] legacy admin job skipped under v2: ${job.job_type}#${job.id}`);
    } catch (err) {
      console.error('[ArenaWorker] 관리자 작업 처리 실패:', (err as any)?.message || err);
    } finally {
      jobInFlight = false;
    }
  };

  const recordHeartbeat = async () => {
    try {
      await adminJobs.recordArenaWorkerHeartbeat({
        arena_version: 'v2',
        job_poll_interval_ms: JOB_POLL_INTERVAL_MS,
        queue_recovery_interval_ms: 0,
        round_recovery_interval_ms: TURN_TIMEOUT_SCAN_INTERVAL_MS,
        auto_queue_recovery: true,
        auto_round_recovery: true,
        queue_expiry_interval_ms: QUEUE_EXPIRY_SCAN_INTERVAL_MS,
        replay_prune_interval_ms: REPLAY_PRUNE_INTERVAL_MS,
        started_at: WORKER_STARTED_AT,
        uptime_sec: Math.max(0, Math.floor(process.uptime()))
      });
    } catch (err) {
      console.error('[ArenaWorker] heartbeat 기록 실패:', (err as any)?.message || err);
    }
  };

  const processTurnTimeouts = async () => {
    if (turnTimeoutInFlight) return;
    turnTimeoutInFlight = true;
    try {
      const result = await arenaV2Service.processArenaV2ExpiredTurns(TURN_TIMEOUT_SECONDS, 25);
      if (Number((result as any).resolved || 0) > 0) {
        console.log(`[ArenaWorker] v2 만료 턴 확정: ${(result as any).resolved}/${(result as any).scanned}`);
      }
    } catch (err) {
      console.error('[ArenaWorker] v2 만료 턴 처리 실패:', (err as any)?.message || err);
    } finally {
      turnTimeoutInFlight = false;
    }
  };

  const processQueueExpiry = async () => {
    if (queueExpiryInFlight) return;
    queueExpiryInFlight = true;
    try {
      const result = await arenaV2Service.processArenaV2ExpiredQueues();
      const total = Number((result as any).quickExpired || 0) + Number((result as any).battleRoyaleExpired || 0);
      if (total > 0) {
        console.log(`[ArenaWorker] v2 만료 큐 정리: quick=${(result as any).quickExpired} battleRoyale=${(result as any).battleRoyaleExpired}`);
      }
    } catch (err) {
      console.error('[ArenaWorker] v2 만료 큐 처리 실패:', (err as any)?.message || err);
    } finally {
      queueExpiryInFlight = false;
    }
  };

  const pruneReplayEvents = async () => {
    if (replayPruneInFlight) return;
    replayPruneInFlight = true;
    try {
      const result = await arenaV2Service.pruneArenaV2ExpiredReplayEvents(5000);
      if (Number((result as any).pruned || 0) > 0) {
        console.log(`[ArenaWorker] v2 만료 리플레이 삭제: ${(result as any).pruned}건, hold=${(result as any).held}`);
      }
    } catch (err) {
      console.error('[ArenaWorker] v2 리플레이 삭제 처리 실패:', (err as any)?.message || err);
    } finally {
      replayPruneInFlight = false;
    }
  };

  const resetStaleJobs = async () => {
    if (staleResetInFlight) return;
    staleResetInFlight = true;
    try {
      const result = await adminJobs.resetStaleArenaAdminJobs(process.env.ARENA_WORKER_STALE_JOB_MINUTES);
      if (Number((result as any).reset || 0) > 0) {
        console.warn(`[ArenaWorker] 중단된 관리자 작업 재대기 처리: ${(result as any).reset}건`);
      }
    } catch (err) {
      console.error('[ArenaWorker] 중단 작업 재대기 처리 실패:', (err as any)?.message || err);
    } finally {
      staleResetInFlight = false;
    }
  };

  await adminJobs.ensureArenaAdminJobTable();
  await adminJobs.ensureArenaWorkerHeartbeatTable();
  await recordHeartbeat();
  await resetStaleJobs();
  await executeJob();
  await processTurnTimeouts();
  await processQueueExpiry();
  await pruneReplayEvents();

  jobTimer = setInterval(() => void executeJob(), JOB_POLL_INTERVAL_MS);
  staleTimer = setInterval(() => void resetStaleJobs(), STALE_JOB_RESET_INTERVAL_MS);
  heartbeatTimer = setInterval(() => void recordHeartbeat(), HEARTBEAT_INTERVAL_MS);
  turnTimeoutTimer = setInterval(() => void processTurnTimeouts(), TURN_TIMEOUT_SCAN_INTERVAL_MS);
  queueExpiryTimer = setInterval(() => void processQueueExpiry(), QUEUE_EXPIRY_SCAN_INTERVAL_MS);
  replayPruneTimer = setInterval(() => void pruneReplayEvents(), REPLAY_PRUNE_INTERVAL_MS);

  console.log(`[ArenaWorker] 치카포 아레나 v2 worker가 시작되었습니다. jobPoll=${JOB_POLL_INTERVAL_MS}ms turnTimeoutScan=${TURN_TIMEOUT_SCAN_INTERVAL_MS}ms queueExpiry=${QUEUE_EXPIRY_SCAN_INTERVAL_MS}ms replayPrune=${REPLAY_PRUNE_INTERVAL_MS}ms`);
};

const shutdown = () => {
  if (jobTimer) clearInterval(jobTimer);
  if (staleTimer) clearInterval(staleTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (turnTimeoutTimer) clearInterval(turnTimeoutTimer);
  if (queueExpiryTimer) clearInterval(queueExpiryTimer);
  if (replayPruneTimer) clearInterval(replayPruneTimer);
  console.log('[ArenaWorker] 종료 신호를 받아 타이머를 정리했습니다.');
  process.exit(0);
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

start().catch((err: any) => {
  console.error('[ArenaWorker] 시작 실패:', err?.message || err);
  process.exit(1);
});
