import fs from 'fs';
import path from 'path';
import util from 'util';

type LogLevel = 'log' | 'info' | 'warn' | 'error';
type RuntimeStatsProvider = () => unknown;

const LOG_LEVELS: LogLevel[] = ['log', 'info', 'warn', 'error'];
const originalConsole: Record<LogLevel, (...args: any[]) => void> = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console)
};

let initialized = false;
let logDir = '';
let retentionDays = 14;
let runtimeStatsProvider: RuntimeStatsProvider | null = null;
let runtimeStatsTimer: NodeJS.Timeout | null = null;

const pad = (value: number) => String(value).padStart(2, '0');

const dateStamp = (date = new Date()) => {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const currentLogPath = () => path.join(logDir, `backend-${dateStamp()}.log`);

const serializeArg = (arg: any): string => {
  if (arg instanceof Error) {
    return arg.stack || arg.message;
  }
  if (typeof arg === 'string') return arg;
  return util.inspect(arg, {
    depth: 6,
    breakLength: 160,
    maxArrayLength: 100,
    maxStringLength: 4000
  });
};

const writeLine = (line: string) => {
  if (!initialized || !logDir) return;
  try {
    fs.appendFileSync(currentLogPath(), `${line}\n`, 'utf8');
  } catch {
    // 파일 로그 실패가 서비스 동작을 막으면 안 됩니다.
  }
};

const formatLine = (level: LogLevel, args: any[]) => {
  const timestamp = new Date().toISOString();
  const message = args.map(serializeArg).join(' ');
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
};

const pruneOldLogs = () => {
  if (!logDir || retentionDays <= 0) return;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  try {
    for (const entry of fs.readdirSync(logDir)) {
      if (!/^backend-\d{4}-\d{2}-\d{2}\.log$/.test(entry)) continue;
      const fullPath = path.join(logDir, entry);
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(fullPath);
      }
    }
  } catch (err: any) {
    originalConsole.warn('[FileLogger] 오래된 로그 정리 실패:', err?.message || err);
  }
};

export const initFileLogging = () => {
  if (initialized || process.env.BACKEND_FILE_LOGGING === 'false') return;

  logDir = path.resolve(process.env.LOG_DIR || path.join(process.cwd(), 'logs'));
  retentionDays = Math.max(1, Math.floor(Number(process.env.LOG_RETENTION_DAYS || 14)));

  try {
    fs.mkdirSync(logDir, { recursive: true });
    initialized = true;
    pruneOldLogs();

    for (const level of LOG_LEVELS) {
      console[level] = (...args: any[]) => {
        originalConsole[level](...args);
        writeLine(formatLine(level, args));
      };
    }

    console.log(`[FileLogger] 파일 로그 활성화: ${currentLogPath()} (보관 ${retentionDays}일)`);
  } catch (err: any) {
    originalConsole.warn('[FileLogger] 파일 로그 초기화 실패:', err?.message || err);
  }
};

export const getLogFilePath = () => (initialized ? currentLogPath() : null);

export const setRuntimeStatsProvider = (provider: RuntimeStatsProvider) => {
  runtimeStatsProvider = provider;
};

export const startRuntimeStatsLogging = () => {
  if (runtimeStatsTimer || process.env.RUNTIME_STATS_LOGGING === 'false') return;
  const intervalMs = Math.max(10_000, Number(process.env.RUNTIME_STATS_LOG_INTERVAL_MS || 60_000));
  runtimeStatsTimer = setInterval(() => {
    if (!runtimeStatsProvider) return;
    try {
      console.log('[RuntimeStats]', runtimeStatsProvider());
    } catch (err: any) {
      console.warn('[RuntimeStats] 수집 실패:', err?.message || err);
    }
  }, intervalMs);
};

export const stopRuntimeStatsLogging = () => {
  if (!runtimeStatsTimer) return;
  clearInterval(runtimeStatsTimer);
  runtimeStatsTimer = null;
};
