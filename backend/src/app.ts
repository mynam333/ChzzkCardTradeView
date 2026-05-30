import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// 환경 변수 설정 로드
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// 미들웨어 설정
app.use(cors());
app.use(express.json());

// 기본 헬스체크 API 라우트
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    message: '치지직 카드 트레이드 뷰 백엔드 서버가 정상 작동 중입니다.',
    timestamp: new Date().toISOString()
  });
});

// 서버 실행
app.listen(PORT, () => {
  console.log(`[Server] 백엔드 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
