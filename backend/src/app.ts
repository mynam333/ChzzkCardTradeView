import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import https from 'https';
import fs from 'fs';

import { initDatabaseConnection } from './services/db';
import { initRepositories } from './repositories';
import apiRouter from './routes/api';
import { startPushNotificationScheduler, initVapid } from './controllers/pushController';
import { startStreamerLiveStatusScheduler } from './cron/streamerScheduler';

// VAPID 초기화 (dotenv.config() 이후 실행 보장)
initVapid();

const app = express();
const PORT = process.env.PORT || 5000;

// 미들웨어 설정
app.use(cors());
app.use(express.json());

// 로컬 SQLite 업로드 이미지 정적 서빙 경로 마운트
app.use('/uploads', express.static(path.join(__dirname, '../../public/uploads')));

// 통합 API 라우터 등록
app.use('/api', apiRouter);

// 기본 헬스체크 API 라우트
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    message: '치지직 카드 트레이드 뷰 백엔드 서버가 정상 작동 중입니다.',
    timestamp: new Date().toISOString()
  });
});

// 데이터베이스 초기화 및 서버 기동
const startServer = async () => {
  try {
    await initDatabaseConnection();
    initRepositories(); // 레포지토리 초기화 추가
    startPushNotificationScheduler(); // PWA 푸시 알림 예약 크론 가동
    startStreamerLiveStatusScheduler(); // 치지직 실시간 방송 상태 폴링 크론 가동

    const useHttps = process.env.USE_HTTPS === 'true';
    // nginx 표준과 동일한 인증서 파일명(fullchain.pem / privkey.pem)을 사용합니다.
    const privkeyPath = process.env.SSL_PRIVKEY_PATH;
    const fullchainPath = process.env.SSL_FULLCHAIN_PATH;

    if (useHttps && privkeyPath && fullchainPath) {
      try {
        // 상대 경로인 경우 프로젝트 루트 기준으로 절대 경로 해소
        const resolvedPrivkeyPath = path.isAbsolute(privkeyPath) ? privkeyPath : path.resolve(__dirname, '..', '..', privkeyPath);
        const resolvedFullchainPath = path.isAbsolute(fullchainPath) ? fullchainPath : path.resolve(__dirname, '..', '..', fullchainPath);

        if (fs.existsSync(resolvedPrivkeyPath) && fs.existsSync(resolvedFullchainPath)) {
          const sslOptions = {
            key: fs.readFileSync(resolvedPrivkeyPath),   // privkey.pem
            cert: fs.readFileSync(resolvedFullchainPath) // fullchain.pem (중간 CA 체인 포함)
          };

          https.createServer(sslOptions, app).listen(PORT, () => {
            console.log(`[Server] HTTPS SSL 인증서를 성공적으로 로드했습니다.`);
            console.log(`[Server]   ├─ privkey  : ${resolvedPrivkeyPath}`);
            console.log(`[Server]   └─ fullchain: ${resolvedFullchainPath}`);
            console.log(`[Server] 백엔드 서버가 https://localhost:${PORT} 에서 실행 중입니다.`);
          });
          return;
        } else {
          console.warn(`[Server] HTTPS가 활성화되었으나 지정된 SSL 파일이 존재하지 않습니다.`);
          if (!fs.existsSync(resolvedPrivkeyPath))  console.warn(`[Server]   ├─ privkey  누락: ${resolvedPrivkeyPath}`);
          if (!fs.existsSync(resolvedFullchainPath)) console.warn(`[Server]   └─ fullchain 누락: ${resolvedFullchainPath}`);
          console.warn(`[Server] 일반 HTTP 프로토콜로 폴백(Fallback) 전환하여 서버를 실행합니다.`);
        }
      } catch (sslErr: any) {
        console.error(`[Server] SSL 인증서 파일을 읽는 도중 오류가 발생했습니다:`, sslErr.message);
        console.error(`[Server] 일반 HTTP 프로토콜로 폴백(Fallback) 전환하여 서버를 실행합니다.`);
      }
    } else if (useHttps) {
      // USE_HTTPS=true 이지만 경로 환경변수가 누락된 경우
      console.warn(`[Server] USE_HTTPS=true 이지만 SSL_PRIVKEY_PATH 또는 SSL_FULLCHAIN_PATH가 설정되지 않았습니다.`);
      console.warn(`[Server] 일반 HTTP 프로토콜로 폴백(Fallback) 전환하여 서버를 실행합니다.`);
    }

    app.listen(PORT, () => {
      console.log(`[Server] 백엔드 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
    });
  } catch (error) {
    console.error('[Server] 서버 시작 도중 초기화 오류가 발생했습니다:', error);
    process.exit(1);
  }
};

startServer();
