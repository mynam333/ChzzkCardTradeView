import fs from 'fs';
import path from 'path';

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
let pruneTimer: NodeJS.Timeout | null = null;
let maxLogStringLength = 2000;
let maxLogBufferBytes = 1024 * 1024;
let logFilePrefix = 'backend';
let logFileRole = 'process';
let splitByProcessRole = true;
let logStream: fs.WriteStream | null = null;
let logStreamPath = '';
let droppedLogLines = 0;

const pad = (value: number) => String(value).padStart(2, '0');

const dateStamp = (date = new Date()) => {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const sanitizeLogNamePart = (value: string, fallback: string) => {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || fallback;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const currentLogPath = () => {
  const suffix = splitByProcessRole ? `-${logFileRole}` : '';
  return path.join(logDir, `${logFilePrefix}${suffix}-${dateStamp()}.log`);
};

const truncateString = (value: string, maxLength = maxLogStringLength) => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...<truncated:${value.length - maxLength}>`;
};

const normalizeForLog = (value: any, seen = new WeakSet<object>(), depth = 0): any => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ? truncateString(value.stack, 4000) : undefined
    };
  }

  if (typeof value === 'string') return truncateString(value);
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[Circular]';
  if (depth >= 6) return '[MaxDepth]';

  seen.add(value);

  if (Array.isArray(value)) {
    const limit = 100;
    const normalized = value.slice(0, limit).map((item) => normalizeForLog(item, seen, depth + 1));
    if (value.length > limit) {
      normalized.push(`...<truncated:${value.length - limit}>`);
    }
    return normalized;
  }

  const result: Record<string, any> = {};
  const entries = Object.entries(value).slice(0, 100);
  for (const [key, nestedValue] of entries) {
    result[key] = normalizeForLog(nestedValue, seen, depth + 1);
  }
  const extraKeys = Object.keys(value).length - entries.length;
  if (extraKeys > 0) {
    result.__truncated_keys = extraKeys;
  }
  return result;
};

const serializeArg = (arg: any): string => {
  if (arg instanceof Error) {
    return truncateString(arg.stack || arg.message, 4000);
  }
  if (typeof arg === 'string') return truncateString(arg);
  try {
    return JSON.stringify(normalizeForLog(arg));
  } catch {
    return truncateString(String(arg));
  }
};

const writeLine = (line: string) => {
  if (!initialized || !logDir) return;
  try {
    const stream = getLogStream();
    if (!stream) return;

    if (stream.writableLength >= maxLogBufferBytes) {
      droppedLogLines += 1;
      return;
    }

    if (droppedLogLines > 0) {
      const dropped = droppedLogLines;
      droppedLogLines = 0;
      stream.write(`[${new Date().toISOString()}] [WARN] [FileLogger] dropped ${dropped} buffered log lines\n`);
    }

    stream.write(`${line}\n`);
  } catch {
    // 파일 로그 실패가 서비스 동작을 막으면 안 됩니다.
  }
};

const closeLogStream = () => {
  if (!logStream) return;
  try {
    logStream.end();
  } catch {
    // 파일 로그 종료 실패는 무시합니다.
  }
  logStream = null;
  logStreamPath = '';
};

const getLogStream = () => {
  const targetPath = currentLogPath();
  if (logStream && logStreamPath === targetPath && !logStream.destroyed) {
    return logStream;
  }

  closeLogStream();
  try {
    const stream = fs.createWriteStream(targetPath, { flags: 'a', encoding: 'utf8' });
    stream.on('error', (err: any) => {
      originalConsole.warn('[FileLogger] 파일 로그 쓰기 실패:', err?.message || err);
      if (logStream === stream) {
        logStream = null;
        logStreamPath = '';
      }
      stream.destroy();
    });
    logStream = stream;
    logStreamPath = targetPath;
    return stream;
  } catch {
    return null;
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
  const logFilePattern = new RegExp(`^${escapeRegExp(logFilePrefix)}(?:-[a-z0-9._-]+)?-\\d{4}-\\d{2}-\\d{2}\\.log$`);
  try {
    for (const entry of fs.readdirSync(logDir)) {
      if (!logFilePattern.test(entry)) continue;
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
  maxLogStringLength = Math.max(500, Number(process.env.LOG_MAX_STRING_LENGTH || 2000));
  maxLogBufferBytes = Math.max(64 * 1024, Number(process.env.LOG_MAX_BUFFER_BYTES || 1024 * 1024));
  logFilePrefix = sanitizeLogNamePart(process.env.LOG_FILE_PREFIX || 'backend', 'backend');
  logFileRole = sanitizeLogNamePart(process.env.LOG_PROCESS_NAME || process.env.PROCESS_ROLE || 'process', 'process');
  splitByProcessRole = process.env.LOG_SPLIT_BY_PROCESS !== 'false';

  try {
    fs.mkdirSync(logDir, { recursive: true });
    initialized = true;
    pruneOldLogs();
    const pruneIntervalMs = Math.max(60_000, Number(process.env.LOG_PRUNE_INTERVAL_MS || 6 * 60 * 60 * 1000));
    pruneTimer = setInterval(pruneOldLogs, pruneIntervalMs);
    pruneTimer.unref?.();

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

process.once('beforeExit', closeLogStream);
