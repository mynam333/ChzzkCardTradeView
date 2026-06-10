process.env.PROCESS_ROLE = process.env.PROCESS_ROLE || 'live-worker';

import { bootstrapProcess } from '../services/processBootstrap';

bootstrapProcess('LiveStatusWorker');

const start = async () => {
  const [
    { initDatabaseConnection },
    { initRepositories },
    { getRuntimeStats },
    { setRuntimeStatsProvider, startRuntimeStatsLogging },
    { startStreamerLiveStatusScheduler }
  ] = await Promise.all([
    import('../services/db'),
    import('../repositories'),
    import('../services/runtimeStats'),
    import('../services/fileLogger'),
    import('../cron/streamerScheduler')
  ]);

  setRuntimeStatsProvider(getRuntimeStats);
  startRuntimeStatsLogging();

  await initDatabaseConnection();
  initRepositories();
  startStreamerLiveStatusScheduler();
  console.log('[LiveStatusWorker] 라이브 상태/채팅 수집 worker가 시작되었습니다.');
};

start().catch((err: any) => {
  console.error('[LiveStatusWorker] 시작 실패:', err?.message || err);
  process.exit(1);
});
