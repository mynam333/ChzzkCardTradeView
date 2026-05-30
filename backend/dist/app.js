"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
// 환경 변수 설정 로드
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5000;
// 미들웨어 설정
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// 기본 헬스체크 API 라우트
app.get('/health', (req, res) => {
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
