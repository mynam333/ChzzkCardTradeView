process.env.PROCESS_ROLE = process.env.PROCESS_ROLE || 'image-worker';

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { bootstrapProcess } from '../services/processBootstrap';

bootstrapProcess('ImageProxyWorker');

const app = express();
const port = process.env.IMAGE_WORKER_PORT || process.env.PORT || 2087;
const slowLogMs = Math.max(100, Number(process.env.IMAGE_PROXY_SLOW_REQUEST_LOG_MS || 3000));

app.set('trust proxy', 1);
app.use(cors({ origin: '*', credentials: false }));
app.use(cookieParser());

// Keep config-dependent auth code behind bootstrapProcess(). A static import
// would evaluate config.ts before this worker has loaded backend/.env.
const lazyMinigameImageAuth = (req: Request, res: Response, next: NextFunction) => {
  import('../middlewares/minigameImageAuth')
    .then(({ minigameImageAuthMiddleware }) => minigameImageAuthMiddleware(req, res, next))
    .catch(next);
};

app.use((req: Request, res: Response, next: NextFunction) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    if (durationMs >= slowLogMs || res.statusCode >= 500) {
      console.warn('[ImageWorker RequestTrace]', {
        method: req.method,
        url: '/api/image-proxy',
        status: res.statusCode,
        duration_ms: durationMs,
        ip: req.ip,
        user_agent: req.get('user-agent') || null
      });
    }
  });
  next();
});

app.get('/api/image-proxy/minigame', lazyMinigameImageAuth, async (req, res, next) => {
  try {
    const { proxyMinigameImage } = await import('../controllers/imageProxyController');
    return proxyMinigameImage(
      req,
      res,
      (req as Request & { minigameImageUserId?: string }).minigameImageUserId || ''
    );
  } catch (err) {
    return next(err);
  }
});

app.get('/api/image-proxy', async (req, res, next) => {
  try {
    const { proxyImage } = await import('../controllers/imageProxyController');
    return proxyImage(req, res);
  } catch (err) {
    return next(err);
  }
});
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    role: 'image-worker',
    timestamp: new Date().toISOString()
  });
});

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[ImageProxyWorker] 처리 오류:', err?.message || err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'InternalServerError', message: '이미지 프록시 처리 중 오류가 발생했습니다.' });
  }
});

app.listen(port, () => {
  console.log(`[ImageProxyWorker] 이미지 프록시 worker가 http://localhost:${port} 에서 실행 중입니다.`);
});
