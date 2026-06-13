import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'path';
import https from 'https';
import fs from 'fs';
import type { Server as NetServer } from 'net';

import { initDatabaseConnection } from './services/db';
import { initRepositories } from './repositories';
import apiRouter from './routes/api';
import { startPushNotificationScheduler, initVapid } from './controllers/pushController';
import { IS_PRODUCTION, isConfiguredCorsOriginAllowed } from './config';
import { csrfOriginGuard } from './middlewares/csrf';
import { rateLimit } from './middlewares/rateLimit';
import { apiAccessGuard } from './middlewares/apiAccessGuard';
import { softBanMiddleware } from './middlewares/softBan';
import { getRuntimeStats } from './services/runtimeStats';
import { getLogFilePath, setRuntimeStatsProvider, startRuntimeStatsLogging } from './services/fileLogger';
import { ensureDirectory, getUploadsDir } from './services/storagePaths';
import { readIntegerEnv } from './utils/env';
import { startChatAttachmentCleanupScheduler } from './services/friendChatService';
import {
  isApiProcess,
  isAllInOneProcess,
  PROCESS_ROLE,
  shouldRunMarketScheduler,
  shouldRunPushScheduler
} from './services/processRole';

// VAPID 초기화 (dotenv.config() 이후 실행 보장)
initVapid();
setRuntimeStatsProvider(getRuntimeStats);
startRuntimeStatsLogging();

const app = express();
const PORT = process.env.PORT || 5000;
const SLOW_REQUEST_LOG_MS = Math.max(100, Number(process.env.SLOW_REQUEST_LOG_MS || 2000));
const IMAGE_PROXY_SLOW_REQUEST_LOG_MS = Math.max(
  SLOW_REQUEST_LOG_MS,
  Number(process.env.IMAGE_PROXY_SLOW_REQUEST_LOG_MS || 10_000)
);
const REQUEST_LOG_URL_MAX_LENGTH = Math.max(120, Number(process.env.REQUEST_LOG_URL_MAX_LENGTH || 300));
const BODY_SIZE_LIMIT = process.env.API_BODY_SIZE_LIMIT || '50mb';

const resolveProjectPath = (value: string): string =>
  path.isAbsolute(value) ? value : path.resolve(__dirname, '..', '..', value);

const getHttpsCertificatePaths = (): { keyPath?: string; certPath?: string; source: string } => {
  if (process.env.CLOUDFLARE_ORIGIN_KEY_PATH || process.env.CLOUDFLARE_ORIGIN_CERT_PATH) {
    return {
      keyPath: process.env.CLOUDFLARE_ORIGIN_KEY_PATH,
      certPath: process.env.CLOUDFLARE_ORIGIN_CERT_PATH,
      source: 'Cloudflare Origin Certificate'
    };
  }

  if (process.env.SSL_KEY_PATH || process.env.SSL_CERT_PATH) {
    return {
      keyPath: process.env.SSL_KEY_PATH,
      certPath: process.env.SSL_CERT_PATH,
      source: 'SSL certificate'
    };
  }

  return {
    keyPath: process.env.SSL_PRIVKEY_PATH,
    certPath: process.env.SSL_FULLCHAIN_PATH,
    source: 'Let\'s Encrypt compatible certificate'
  };
};
const NORMAL_CLOSE_PATHS = new Set(['/api/realtime/stream', '/api/notifications/stream']);
let activeServer: NetServer | null = null;
let shuttingDown = false;

const notifyProcessReady = () => {
  if (typeof process.send === 'function') {
    process.send('ready');
  }
};

const registerServer = (server: NetServer, url: string) => {
  activeServer = server;
  console.log(`[Server] 백엔드 서버가 ${url} 에서 실행 중입니다.`);
  notifyProcessReady();
};

const shutdownGracefully = (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Server] ${signal} 수신. 새 요청 수락을 중지하고 종료합니다.`);

  const forceExitTimer = setTimeout(() => {
    console.error('[Server] 정상 종료 제한 시간을 초과하여 프로세스를 강제 종료합니다.');
    process.exit(1);
  }, Number(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS || 12_000));
  forceExitTimer.unref();

  if (!activeServer) {
    process.exit(0);
    return;
  }

  activeServer.close((err?: Error) => {
    if (err) {
      console.error('[Server] HTTP 서버 종료 중 오류:', err);
      process.exit(1);
      return;
    }
    console.log('[Server] 기존 연결 정리 완료. 프로세스를 종료합니다.');
    process.exit(0);
  });
};

process.once('SIGTERM', shutdownGracefully);
process.once('SIGINT', shutdownGracefully);

const truncateLogValue = (value: string, maxLength = REQUEST_LOG_URL_MAX_LENGTH) => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...<truncated:${value.length - maxLength}>`;
};

const getImageProxyTargetHost = (req: Request) => {
  const rawQueryUrl = Array.isArray(req.query.url) ? req.query.url[0] : req.query.url;
  const rawUrl = typeof rawQueryUrl === 'string'
    ? rawQueryUrl
    : new URL(req.originalUrl || req.url, 'http://localhost').searchParams.get('url');
  if (!rawUrl) return null;

  try {
    return new URL(rawUrl).host;
  } catch {
    return 'invalid-url';
  }
};

const getRequestLogInfo = (req: Request) => {
  if (req.path.startsWith('/api/image-proxy')) {
    return {
      url: '/api/image-proxy',
      target_host: getImageProxyTargetHost(req)
    };
  }

  return {
    url: truncateLogValue(req.originalUrl || req.url)
  };
};

const isNormalClientClose = (req: Request) => {
  if (NORMAL_CLOSE_PATHS.has(req.path)) return true;
  const rawPath = (req.originalUrl || req.url || '').split('?', 1)[0];
  return NORMAL_CLOSE_PATHS.has(rawPath);
};

// 리버스 프록시(nginx 등) 뒤에서 X-Forwarded-For/Proto를 신뢰하여 req.ip·https 판별이 정확하도록 설정.
// (rate limiter가 클라이언트 위조 헤더로 우회되지 않도록 첫 프록시 1홉만 신뢰)
app.set('trust proxy', 1);

// 보안 헤더 (X-Frame-Options·X-Content-Type-Options·HSTS 등).
// 단, 이미지 프록시(/api/image-proxy) 및 업로드 정적 파일(/uploads) 요청에 대해서는
// helmet의 Content-Security-Policy(default-src 'none')가 브라우저 내 이미지 로드를 차단하므로 미들웨어를 건너뜁니다.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/api/image-proxy') || req.path.startsWith('/uploads')) {
    return next();
  }
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"]
      }
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })(req, res, next);
});

// 미들웨어 설정
// CORS: /api/image-proxy 요청에 대해서는 전역 cors 미들웨어를 완전히 우회(Skip)시킵니다.
// 이미지 프록시 컨트롤러(imageProxyController.ts) 자체에서 Access-Control-Allow-Origin: * 및 CORP 헤더를 단독 관리하므로,
// 이 미들웨어를 건너뜀으로써 헤더 중복 설정(ACAO: *, *) 및 자격증명(credentials) 충돌 현상을 해결하여 이미지 깨짐을 예방합니다.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/api/image-proxy')) {
    return next();
  }
  // 그 외 일반 API 요청들은 환경변수로 지정된 오리진 화이트리스트만 허용하며, 쿠키 사용을 위해 credentials를 허용합니다.
  cors({
    origin: (origin, callback) => {
      const isAllowed = !origin || isConfiguredCorsOriginAllowed(origin);
      callback(null, isAllowed);
    },
    credentials: true
  })(req, res, next);
});

// /api/health 외 API 직접 호출을 먼저 걸러 DB/라우터 진입 자체를 줄입니다.
app.use('/api', apiAccessGuard);
// API 전체 경로에 soft-ban + 기본 레이트 리밋 적용.
// soft-ban은 짧은 시간의 비정상 반복 요청을 몇 분간 쉬게 하여 DB/API 폭주를 완화합니다.
app.use('/api', softBanMiddleware);
const globalApiLimiter = rateLimit({
  windowMs: readIntegerEnv('GLOBAL_API_RATE_LIMIT_WINDOW_MS', 60_000, { min: 1000 }),
  max: readIntegerEnv('GLOBAL_API_RATE_LIMIT_MAX', 600, { min: 0 }),
  key: 'global-api'
});
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/image-proxy' || req.path === '/api/image-proxy') return next();
  return globalApiLimiter(req, res, next);
});

app.use((req: Request, res: Response, next: NextFunction) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const slowThresholdMs = req.path.startsWith('/api/image-proxy')
      ? IMAGE_PROXY_SLOW_REQUEST_LOG_MS
      : SLOW_REQUEST_LOG_MS;
    if (durationMs >= slowThresholdMs || res.statusCode >= 500) {
      console.warn('[RequestTrace]', {
        method: req.method,
        ...getRequestLogInfo(req),
        status: res.statusCode,
        duration_ms: durationMs,
        ip: req.ip,
        user_agent: req.get('user-agent') || null
      });
    }
  });
  res.on('close', () => {
    if (!res.writableEnded && !isNormalClientClose(req)) {
      console.warn('[RequestClosed]', {
        method: req.method,
        ...getRequestLogInfo(req),
        duration_ms: Date.now() - startedAt,
        ip: req.ip
      });
    }
  });
  next();
});

app.use(express.json({ limit: BODY_SIZE_LIMIT }));
app.use(express.urlencoded({ limit: BODY_SIZE_LIMIT, extended: true }));
app.use(cookieParser());
app.use(csrfOriginGuard);

// 로컬 SQLite 업로드 이미지 정적 서빙 경로 마운트 (타 오리진 로드 허용)
const uploadsDir = getUploadsDir();
ensureDirectory(uploadsDir);
console.log(`[Storage] 업로드 디렉터리: ${uploadsDir}`);
app.use('/uploads', express.static(uploadsDir, {
  setHeaders: (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
  }
}));

// 통합 API 라우터 등록
app.use('/api', apiRouter);

// 전역 에러 핸들러 (스택 트레이스 노출 방지 및 일관된 에러 응답)
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  const isRequestAborted =
    err?.type === 'request.aborted' ||
    err?.code === 'ECONNABORTED' ||
    err?.message === 'request aborted' ||
    (req as any).aborted === true;

  if (isRequestAborted) {
    console.warn(`[Request Aborted] ${req.method} ${req.originalUrl || req.url}`);
    if (!res.headersSent && !res.destroyed) {
      return res.status(499).json({ error: 'ClientClosedRequest', message: '요청이 클라이언트에 의해 중단되었습니다.' });
    }
    return;
  }

  console.error('[Global Error]', err.stack || err);
  
  const status = err.status || err.statusCode || 500;
  const response: { error: string; message: string; details?: any } = {
    error: status === 400 ? 'BadRequest' : 'InternalServerError',
    message: status === 400 ? (err.message || '잘못된 요청입니다.') : '서버 내부 오류가 발생했습니다.'
  };

  // 개발 환경일 때만 디버그 메시지 제공
  if (!IS_PRODUCTION && err.message) {
    response.details = err.message;
  }

  res.status(status).json(response);
});

// 기본 헬스체크 API 라우트
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    message: '치카포 백엔드 서버가 정상 작동 중입니다.',
    timestamp: new Date().toISOString(),
    log_file: getLogFilePath(),
    runtime: getRuntimeStats()
  });
});

// 데이터베이스 초기화 및 서버 기동
const startServer = async () => {
  try {
    await initDatabaseConnection();
    initRepositories(); // 레포지토리 초기화 추가
    if (shouldRunPushScheduler()) {
      startPushNotificationScheduler(); // PWA 푸시 알림 예약 크론 가동
    }
    if (isApiProcess() || isAllInOneProcess()) {
      startChatAttachmentCleanupScheduler();
    }
    if (shouldRunMarketScheduler()) {
      const { startMarketSettlementScheduler } = await import('./cron/marketScheduler');
      startMarketSettlementScheduler(); // 오픈마켓 만료 경매 정산 크론 가동
    }
    if (isAllInOneProcess()) {
      const { startStreamerLiveStatusScheduler } = await import('./cron/streamerScheduler');
      const { startMysqlSqliteBackupScheduler } = await import('./services/mysqlSqliteBackup');
      startStreamerLiveStatusScheduler();
      startMysqlSqliteBackupScheduler();
    }
    console.log(`[Server] PROCESS_ROLE=${PROCESS_ROLE} API 서버 모드로 기동합니다.`);

    const useHttps = process.env.USE_HTTPS === 'true';
    const { keyPath, certPath, source } = getHttpsCertificatePaths();

    if (useHttps && keyPath && certPath) {
      try {
        // 상대 경로인 경우 프로젝트 루트 기준으로 절대 경로 해소
        const resolvedKeyPath = resolveProjectPath(keyPath);
        const resolvedCertPath = resolveProjectPath(certPath);

        if (fs.existsSync(resolvedKeyPath) && fs.existsSync(resolvedCertPath)) {
          const sslOptions = {
            key: fs.readFileSync(resolvedKeyPath),
            cert: fs.readFileSync(resolvedCertPath)
          };

          const httpsServer = https.createServer(sslOptions, app);
          httpsServer.listen(PORT, () => {
            console.log(`[Server] HTTPS 인증서를 성공적으로 로드했습니다. (${source})`);
            console.log(`[Server]   ├─ key : ${resolvedKeyPath}`);
            console.log(`[Server]   └─ cert: ${resolvedCertPath}`);
            registerServer(httpsServer, `https://localhost:${PORT}`);
          });
          return;
        } else {
          console.warn(`[Server] HTTPS가 활성화되었으나 지정된 SSL 파일이 존재하지 않습니다.`);
          if (!fs.existsSync(resolvedKeyPath)) console.warn(`[Server]   ├─ key 누락: ${resolvedKeyPath}`);
          if (!fs.existsSync(resolvedCertPath)) console.warn(`[Server]   └─ cert 누락: ${resolvedCertPath}`);
          console.warn(`[Server] 일반 HTTP 프로토콜로 폴백(Fallback) 전환하여 서버를 실행합니다.`);
        }
      } catch (sslErr: any) {
        console.error(`[Server] SSL 인증서 파일을 읽는 도중 오류가 발생했습니다:`, sslErr.message);
        console.error(`[Server] 일반 HTTP 프로토콜로 폴백(Fallback) 전환하여 서버를 실행합니다.`);
      }
    } else if (useHttps) {
      // USE_HTTPS=true 이지만 경로 환경변수가 누락된 경우
      console.warn(`[Server] USE_HTTPS=true 이지만 인증서 key/cert 경로가 설정되지 않았습니다.`);
      console.warn(`[Server] CLOUDFLARE_ORIGIN_KEY_PATH/CLOUDFLARE_ORIGIN_CERT_PATH 또는 SSL_KEY_PATH/SSL_CERT_PATH를 설정하세요.`);
      console.warn(`[Server] 일반 HTTP 프로토콜로 폴백(Fallback) 전환하여 서버를 실행합니다.`);
    }

    const httpServer = app.listen(PORT, () => {
      registerServer(httpServer, `http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('[Server] 서버 시작 도중 초기화 오류가 발생했습니다:', error);
    process.exit(1);
  }
};

startServer();
