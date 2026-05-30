"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * server.ts - 애플리케이션 진입점 (엔트리포인트)
 *
 * ⚠️ 이 파일이 가장 먼저 실행되어야 합니다.
 * dotenv를 가장 먼저 로드한 뒤 app.ts를 불러옵니다.
 */
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
// __dirname 확인 (디버깅용)
console.log(`[ENV] server.ts __dirname: ${__dirname}`);
// ts-node로 실행 시: __dirname = backend/src  →  ../.env = backend/.env
// node dist/server.js 실행 시: __dirname = backend/dist  →  ../.env = backend/.env
const envPath = path_1.default.resolve(__dirname, '../.env');
console.log(`[ENV] .env 탐색 경로: ${envPath}`);
const result = dotenv_1.default.config({ path: envPath });
if (result.error) {
    console.error(`[ENV] .env 파일 로드 실패: ${envPath}`, result.error.message);
}
else {
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    console.log(`[ENV] .env 파일 로드 완료`);
    console.log(`[ENV] VAPID_PUBLIC_KEY  = ${pub ? pub.substring(0, 15) + '...' : '(없음 - 키 확인 필요)'}`);
    console.log(`[ENV] VAPID_PRIVATE_KEY = ${priv ? priv.substring(0, 10) + '...' : '(없음 - 키 확인 필요)'}`);
}
// dotenv 로드 완료 후 앱 모듈 동적 로드
Promise.resolve().then(() => __importStar(require('./app')));
