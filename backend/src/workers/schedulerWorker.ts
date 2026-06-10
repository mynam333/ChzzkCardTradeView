process.env.PROCESS_ROLE = process.env.PROCESS_ROLE || 'scheduler-worker';
process.env.MYSQL_CONNECTION_LIMIT = process.env.MYSQL_CONNECTION_LIMIT || '2';

import { bootstrapProcess } from '../services/processBootstrap';
import { initDatabaseConnection } from '../services/db';
import { initRepositories } from '../repositories';
import { getRuntimeStats } from '../services/runtimeStats';
import { setRuntimeStatsProvider, startRuntimeStatsLogging } from '../services/fileLogger';
import { initVapid, startPushNotificationScheduler } from '../controllers/pushController';
import { startMarketSettlementScheduler } from '../cron/marketScheduler';

bootstrapProcess('SchedulerWorker');
setRuntimeStatsProvider(getRuntimeStats);
startRuntimeStatsLogging();
initVapid();

const start = async () => {
  await initDatabaseConnection();
  initRepositories();
  startPushNotificationScheduler();
  startMarketSettlementScheduler();
  console.log('[SchedulerWorker] 푸시/마켓 스케줄러 worker가 시작되었습니다.');
};

start().catch((err: any) => {
  console.error('[SchedulerWorker] 시작 실패:', err?.message || err);
  process.exit(1);
});
