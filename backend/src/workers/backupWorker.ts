process.env.PROCESS_ROLE = process.env.PROCESS_ROLE || 'backup-worker';
process.env.MYSQL_CONNECTION_LIMIT = process.env.MYSQL_CONNECTION_LIMIT || '1';

import { bootstrapProcess } from '../services/processBootstrap';

bootstrapProcess('BackupWorker');

const start = async () => {
  const [
    { initDatabaseConnection },
    { initRepositories },
    { getRuntimeStats },
    { setRuntimeStatsProvider, startRuntimeStatsLogging },
    { startMysqlSqliteBackupScheduler }
  ] = await Promise.all([
    import('../services/db'),
    import('../repositories'),
    import('../services/runtimeStats'),
    import('../services/fileLogger'),
    import('../services/mysqlSqliteBackup')
  ]);

  setRuntimeStatsProvider(getRuntimeStats);
  startRuntimeStatsLogging();

  await initDatabaseConnection();
  initRepositories();
  startMysqlSqliteBackupScheduler();
  console.log('[BackupWorker] MySQL -> SQLite 백업 worker가 시작되었습니다.');
};

start().catch((err: any) => {
  console.error('[BackupWorker] 시작 실패:', err?.message || err);
  process.exit(1);
});
