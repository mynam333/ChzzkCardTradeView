"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const db_1 = require("./services/db");
const repositories_1 = require("./repositories");
const api_1 = __importDefault(require("./routes/api"));
const pushController_1 = require("./controllers/pushController");
// 환경 변수 설정 로드
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5000;
// 미들웨어 설정
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// 로컬 SQLite 업로드 이미지 정적 서빙 경로 마운트
app.use('/uploads', express_1.default.static(path_1.default.join(__dirname, '../../public/uploads')));
// 통합 API 라우터 등록
app.use('/api', api_1.default);
// 기본 헬스체크 API 라우트
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        message: '치지직 카드 트레이드 뷰 백엔드 서버가 정상 작동 중입니다.',
        timestamp: new Date().toISOString()
    });
});
// 데이터베이스 초기화 및 서버 기동
const startServer = async () => {
    try {
        await (0, db_1.initDatabaseConnection)();
        (0, repositories_1.initRepositories)(); // 레포지토리 초기화 추가
        (0, pushController_1.startPushNotificationScheduler)(); // PWA 푸시 알림 예약 크론 가동
        app.listen(PORT, () => {
            console.log(`[Server] 백엔드 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
        });
    }
    catch (error) {
        console.error('[Server] 서버 시작 도중 초기화 오류가 발생했습니다:', error);
        process.exit(1);
    }
};
startServer();
