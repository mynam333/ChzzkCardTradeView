import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { initDatabaseConnection } from './services/db';
import { initRepositories } from './repositories';
import apiRouter from './routes/api';
import { startPushNotificationScheduler } from './controllers/pushController';

// 환경 변수 설정 로드
dotenv.config();

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
    app.listen(PORT, () => {
      console.log(`[Server] 백엔드 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
    });
  } catch (error) {
    console.error('[Server] 서버 시작 도중 초기화 오류가 발생했습니다:', error);
    process.exit(1);
  }
};

startServer();
