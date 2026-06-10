process.env.PROCESS_ROLE = process.env.PROCESS_ROLE || 'backup-worker';
process.env.MYSQL_CONNECTION_LIMIT = process.env.MYSQL_CONNECTION_LIMIT || '1';

import { bootstrapProcess } from '../services/processBootstrap';
import { initDatabaseConnection } from '../services/db';
import { initRepositories } from '../repositories';
import { getRuntimeStats } from '../services/runtimeStats';
import { setRuntimeStatsProvider, startRuntimeStatsLogging } from '../services/fileLogger';
import { startMysqlSqliteBackupScheduler } from '../services/mysqlSqliteBackup';

bootstrapProcess('BackupWorker');
setRuntimeStatsProvider(getRuntimeStats);
startRuntimeStatsLogging();

const start = async () => {
  await initDatabaseConnection();
  initRepositories();
  startMysqlSqliteBackupScheduler();
  console.log('[BackupWorker] MySQL -> SQLite 백업 worker가 시작되었습니다.');
};

start().catch((err: any) => {
  console.error('[BackupWorker] 시작 실패:', err?.message || err);
  process.exit(1);
});
