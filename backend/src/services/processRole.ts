export type ProcessRole =
  | 'api'
  | 'all'
  | 'scheduler-worker'
  | 'live-worker'
  | 'backup-worker'
  | 'image-worker'
  | 'chat-worker'
  | 'arena-worker';

const normalizeRole = (value: string | undefined): ProcessRole => {
  const role = String(value || 'api').trim().toLowerCase();
  if (
    role === 'api' ||
    role === 'all' ||
    role === 'scheduler-worker' ||
    role === 'live-worker' ||
    role === 'backup-worker' ||
    role === 'image-worker' ||
    role === 'chat-worker' ||
    role === 'arena-worker'
  ) {
    return role;
  }
  console.warn(`[ProcessRole] 알 수 없는 PROCESS_ROLE=${value}. api로 동작합니다.`);
  return 'api';
};

export const PROCESS_ROLE: ProcessRole = normalizeRole(process.env.PROCESS_ROLE);

export const isAllInOneProcess = () => PROCESS_ROLE === 'all';
export const isApiProcess = () => PROCESS_ROLE === 'api' || PROCESS_ROLE === 'all';
export const isSchedulerWorkerProcess = () => PROCESS_ROLE === 'scheduler-worker' || PROCESS_ROLE === 'all';
export const isLiveWorkerProcess = () => PROCESS_ROLE === 'live-worker' || PROCESS_ROLE === 'all';
export const isBackupWorkerProcess = () => PROCESS_ROLE === 'backup-worker' || PROCESS_ROLE === 'all';
export const isImageWorkerProcess = () => PROCESS_ROLE === 'image-worker';
export const isChatWorkerProcess = () => PROCESS_ROLE === 'chat-worker';
export const isArenaWorkerProcess = () => PROCESS_ROLE === 'arena-worker' || PROCESS_ROLE === 'all';

export const shouldRunPushScheduler = () =>
  process.env.RUN_PUSH_SCHEDULER === 'true' || isSchedulerWorkerProcess();

export const shouldRunMarketScheduler = () =>
  process.env.RUN_MARKET_SCHEDULER === 'true' || isSchedulerWorkerProcess();

export const shouldServeImageProxyInApi = () =>
  process.env.API_SERVE_IMAGE_PROXY !== 'false';
