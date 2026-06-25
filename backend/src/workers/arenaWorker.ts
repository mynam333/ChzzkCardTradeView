process.env.PROCESS_ROLE = process.env.PROCESS_ROLE || 'arena-worker';
process.env.MYSQL_CONNECTION_LIMIT = process.env.MYSQL_CONNECTION_LIMIT || '1';

import { bootstrapProcess } from '../services/processBootstrap';

bootstrapProcess('ArenaWorker');

const parseInterval = (value: string | undefined, fallback: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.parseInt(String(value || fallback), 10) || fallback));

const JOB_POLL_INTERVAL_MS = parseInterval(process.env.ARENA_WORKER_JOB_POLL_INTERVAL_MS, 10_000, 3_000, 60_000);
const QUEUE_RECOVERY_INTERVAL_MS = parseInterval(process.env.ARENA_WORKER_QUEUE_RECOVERY_INTERVAL_MS, 60_000, 30_000, 600_000);
const ROUND_RECOVERY_INTERVAL_MS = parseInterval(process.env.ARENA_WORKER_ROUND_RECOVERY_INTERVAL_MS, 10_000, 5_000, 120_000);
const STALE_JOB_RESET_INTERVAL_MS = parseInterval(process.env.ARENA_WORKER_STALE_JOB_RESET_INTERVAL_MS, 300_000, 60_000, 3_600_000);
const HEARTBEAT_INTERVAL_MS = parseInterval(process.env.ARENA_WORKER_HEARTBEAT_INTERVAL_MS, 30_000, 15_000, 300_000);
const AUTO_QUEUE_RECOVERY = process.env.ARENA_WORKER_AUTO_QUEUE_RECOVERY !== 'false';
const AUTO_ROUND_RECOVERY = process.env.ARENA_WORKER_AUTO_ROUND_RECOVERY !== 'false';

let jobTimer: NodeJS.Timeout | null = null;
let queueTimer: NodeJS.Timeout | null = null;
let roundTimer: NodeJS.Timeout | null = null;
let staleTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let jobInFlight = false;
let queueRecoveryInFlight = false;
let roundRecoveryInFlight = false;
let staleResetInFlight = false;

const start = async () => {
  const [
    { initDatabaseConnection },
    { initRepositories },
    { getRuntimeStats },
    { setRuntimeStatsProvider, startRuntimeStatsLogging },
    adminJobs,
    statsService,
    matchService,
    matchmakingService,
    cupService,
    spectatorLinkService
  ] = await Promise.all([
    import('../services/db'),
    import('../repositories'),
    import('../services/runtimeStats'),
    import('../services/fileLogger'),
    import('../services/arenaAdminJobService'),
    import('../services/arenaAdminStatsService'),
    import('../services/arenaMatchService'),
    import('../services/arenaMatchmakingService'),
    import('../services/arenaCupService'),
    import('../services/arenaSpectatorLinkService')
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

      try {
        const payload = job.payload || {};
        let result: unknown;
        if (job.job_type === 'stats_rebuild') {
          result = await statsService.rebuildArenaAdminStatsSnapshot((payload as any).limit);
        } else if (job.job_type === 'rankings_rebuild') {
          result = await matchService.rebuildArenaRankingSnapshot((payload as any).limit);
        } else if (job.job_type === 'replay_prune') {
          const [matches, cups, spectatorLinks] = await Promise.all([
            matchService.pruneArenaReplayLogs((payload as any).retention_days, (payload as any).limit),
            cupService.pruneArenaCupReplayLogs((payload as any).retention_days, (payload as any).limit),
            spectatorLinkService.pruneArenaSpectatorLinks((payload as any).limit)
          ]);
          result = {
            targets: ['arena_match_replays', 'arena_cup_replays', 'arena_spectator_links', 'legacy_inline_replay_json'],
            match_replays: matches,
            cup_replays: cups,
            spectator_links: spectatorLinks,
            pruned: Number((matches as any).pruned || 0) + Number((cups as any).pruned || 0) + Number((spectatorLinks as any).pruned || 0)
          };
        } else {
          throw new Error(`UnknownArenaAdminJobType:${job.job_type}`);
        }
        await adminJobs.completeArenaAdminJob(job.id, result);
        console.log(`[ArenaWorker] 관리자 작업 완료: ${job.job_type}#${job.id}`);
      } catch (err) {
        await adminJobs.failArenaAdminJob(job.id, err);
        console.error(`[ArenaWorker] 관리자 작업 실패: ${job.job_type}#${job.id}`, (err as any)?.message || err);
      }
    } finally {
      jobInFlight = false;
    }
  };

  const runQueueRecovery = async () => {
    if (!AUTO_QUEUE_RECOVERY || queueRecoveryInFlight) return;
    queueRecoveryInFlight = true;
    try {
      const [quick, cup] = await Promise.all([
        matchmakingService.recoverArenaQuickMatchQueue(),
        cupService.recoverArenaCupQueue()
      ]);
      const changed = Number((quick as any)?.expired || 0)
        + Number((quick as any)?.released_matching || 0)
        + Number((quick as any)?.finalized_matches || 0)
        + Number((cup as any)?.expired || 0)
        + Number((cup as any)?.released_matching || 0)
        + Number((cup as any)?.finalized_cups || 0);
      if (changed > 0) {
        console.log(`[ArenaWorker] 큐 복구 완료: changed=${changed}`);
      }
    } catch (err) {
      console.error('[ArenaWorker] 큐 복구 실패:', (err as any)?.message || err);
    } finally {
      queueRecoveryInFlight = false;
    }
  };

  const runRoundRecovery = async () => {
    if (!AUTO_ROUND_RECOVERY || roundRecoveryInFlight) return;
    roundRecoveryInFlight = true;
    try {
      const result = await matchService.recoverExpiredArenaRoundCommits(process.env.ARENA_EXPIRED_ROUND_SCAN_LIMIT);
      if (Number((result as any)?.committed || 0) > 0 || Number((result as any)?.errors?.length || 0) > 0) {
        console.log(
          `[ArenaWorker] 만료 라운드 자동 진행: committed=${(result as any).committed} errors=${(result as any).errors?.length || 0}`
        );
      }
    } catch (err) {
      console.error('[ArenaWorker] 만료 라운드 자동 진행 실패:', (err as any)?.message || err);
    } finally {
      roundRecoveryInFlight = false;
    }
  };

  const recordHeartbeat = async () => {
    try {
      await adminJobs.recordArenaWorkerHeartbeat({
        job_poll_interval_ms: JOB_POLL_INTERVAL_MS,
        queue_recovery_interval_ms: QUEUE_RECOVERY_INTERVAL_MS,
        round_recovery_interval_ms: ROUND_RECOVERY_INTERVAL_MS,
        auto_queue_recovery: AUTO_QUEUE_RECOVERY,
        auto_round_recovery: AUTO_ROUND_RECOVERY
      });
    } catch (err) {
      console.error('[ArenaWorker] heartbeat 기록 실패:', (err as any)?.message || err);
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
  await runQueueRecovery();
  await runRoundRecovery();

  jobTimer = setInterval(() => void executeJob(), JOB_POLL_INTERVAL_MS);
  queueTimer = setInterval(() => void runQueueRecovery(), QUEUE_RECOVERY_INTERVAL_MS);
  roundTimer = setInterval(() => void runRoundRecovery(), ROUND_RECOVERY_INTERVAL_MS);
  staleTimer = setInterval(() => void resetStaleJobs(), STALE_JOB_RESET_INTERVAL_MS);
  heartbeatTimer = setInterval(() => void recordHeartbeat(), HEARTBEAT_INTERVAL_MS);

  console.log(
    `[ArenaWorker] 아레나 관리자 작업/큐/라운드 복구 worker가 시작되었습니다. jobPoll=${JOB_POLL_INTERVAL_MS}ms queueRecovery=${QUEUE_RECOVERY_INTERVAL_MS}ms roundRecovery=${ROUND_RECOVERY_INTERVAL_MS}ms`
  );
};

const shutdown = () => {
  if (jobTimer) clearInterval(jobTimer);
  if (queueTimer) clearInterval(queueTimer);
  if (roundTimer) clearInterval(roundTimer);
  if (staleTimer) clearInterval(staleTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  console.log('[ArenaWorker] 종료 신호를 받아 타이머를 정리했습니다.');
  process.exit(0);
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

start().catch((err: any) => {
  console.error('[ArenaWorker] 시작 실패:', err?.message || err);
  process.exit(1);
});
