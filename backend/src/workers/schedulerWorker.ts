process.env.PROCESS_ROLE = process.env.PROCESS_ROLE || 'scheduler-worker';
process.env.MYSQL_CONNECTION_LIMIT = process.env.MYSQL_CONNECTION_LIMIT || '2';

import { bootstrapProcess } from '../services/processBootstrap';

bootstrapProcess('SchedulerWorker');

const start = async () => {
  const [
    { initDatabaseConnection },
    { initRepositories },
    { getRuntimeStats },
    { setRuntimeStatsProvider, startRuntimeStatsLogging },
    { initVapid, startPushNotificationScheduler },
    { startMarketSettlementScheduler }
  ] = await Promise.all([
    import('../services/db'),
    import('../repositories'),
    import('../services/runtimeStats'),
    import('../services/fileLogger'),
    import('../controllers/pushController'),
    import('../cron/marketScheduler')
  ]);

  setRuntimeStatsProvider(getRuntimeStats);
  startRuntimeStatsLogging();
  initVapid();

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
