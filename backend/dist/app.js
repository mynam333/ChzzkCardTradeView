"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const https_1 = __importDefault(require("https"));
const fs_1 = __importDefault(require("fs"));
const db_1 = require("./services/db");
const repositories_1 = require("./repositories");
const api_1 = __importDefault(require("./routes/api"));
const pushController_1 = require("./controllers/pushController");
const streamerScheduler_1 = require("./cron/streamerScheduler");
// VAPID 초기화 (dotenv.config() 이후 실행 보장)
(0, pushController_1.initVapid)();
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
        (0, streamerScheduler_1.startStreamerLiveStatusScheduler)(); // 치지직 실시간 방송 상태 폴링 크론 가동
        const useHttps = process.env.USE_HTTPS === 'true';
        // nginx 표준과 동일한 인증서 파일명(fullchain.pem / privkey.pem)을 사용합니다.
        const privkeyPath = process.env.SSL_PRIVKEY_PATH;
        const fullchainPath = process.env.SSL_FULLCHAIN_PATH;
        if (useHttps && privkeyPath && fullchainPath) {
            try {
                // 상대 경로인 경우 프로젝트 루트 기준으로 절대 경로 해소
                const resolvedPrivkeyPath = path_1.default.isAbsolute(privkeyPath) ? privkeyPath : path_1.default.resolve(__dirname, '..', '..', privkeyPath);
                const resolvedFullchainPath = path_1.default.isAbsolute(fullchainPath) ? fullchainPath : path_1.default.resolve(__dirname, '..', '..', fullchainPath);
                if (fs_1.default.existsSync(resolvedPrivkeyPath) && fs_1.default.existsSync(resolvedFullchainPath)) {
                    const sslOptions = {
                        key: fs_1.default.readFileSync(resolvedPrivkeyPath), // privkey.pem
                        cert: fs_1.default.readFileSync(resolvedFullchainPath) // fullchain.pem (중간 CA 체인 포함)
                    };
                    https_1.default.createServer(sslOptions, app).listen(PORT, () => {
                        console.log(`[Server] HTTPS SSL 인증서를 성공적으로 로드했습니다.`);
                        console.log(`[Server]   ├─ privkey  : ${resolvedPrivkeyPath}`);
                        console.log(`[Server]   └─ fullchain: ${resolvedFullchainPath}`);
                        console.log(`[Server] 백엔드 서버가 https://localhost:${PORT} 에서 실행 중입니다.`);
                    });
                    return;
                }
                else {
                    console.warn(`[Server] HTTPS가 활성화되었으나 지정된 SSL 파일이 존재하지 않습니다.`);
                    if (!fs_1.default.existsSync(resolvedPrivkeyPath))
                        console.warn(`[Server]   ├─ privkey  누락: ${resolvedPrivkeyPath}`);
                    if (!fs_1.default.existsSync(resolvedFullchainPath))
                        console.warn(`[Server]   └─ fullchain 누락: ${resolvedFullchainPath}`);
                    console.warn(`[Server] 일반 HTTP 프로토콜로 폴백(Fallback) 전환하여 서버를 실행합니다.`);
                }
            }
            catch (sslErr) {
                console.error(`[Server] SSL 인증서 파일을 읽는 도중 오류가 발생했습니다:`, sslErr.message);
                console.error(`[Server] 일반 HTTP 프로토콜로 폴백(Fallback) 전환하여 서버를 실행합니다.`);
            }
        }
        else if (useHttps) {
            // USE_HTTPS=true 이지만 경로 환경변수가 누락된 경우
            console.warn(`[Server] USE_HTTPS=true 이지만 SSL_PRIVKEY_PATH 또는 SSL_FULLCHAIN_PATH가 설정되지 않았습니다.`);
            console.warn(`[Server] 일반 HTTP 프로토콜로 폴백(Fallback) 전환하여 서버를 실행합니다.`);
        }
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
