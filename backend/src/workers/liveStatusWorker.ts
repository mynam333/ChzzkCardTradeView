process.env.PROCESS_ROLE = process.env.PROCESS_ROLE || 'live-worker';

import { bootstrapProcess } from '../services/processBootstrap';
import { initDatabaseConnection } from '../services/db';
import { initRepositories } from '../repositories';
import { getRuntimeStats } from '../services/runtimeStats';
import { setRuntimeStatsProvider, startRuntimeStatsLogging } from '../services/fileLogger';
import { startStreamerLiveStatusScheduler } from '../cron/streamerScheduler';

bootstrapProcess('LiveStatusWorker');
setRuntimeStatsProvider(getRuntimeStats);
startRuntimeStatsLogging();

const start = async () => {
  await initDatabaseConnection();
  initRepositories();
  startStreamerLiveStatusScheduler();
  console.log('[LiveStatusWorker] 라이브 상태/채팅 수집 worker가 시작되었습니다.');
};

start().catch((err: any) => {
  console.error('[LiveStatusWorker] 시작 실패:', err?.message || err);
  process.exit(1);
});
