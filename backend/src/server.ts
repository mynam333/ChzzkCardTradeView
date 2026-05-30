/**
 * server.ts - 애플리케이션 진입점 (엔트리포인트)
 *
 * ⚠️ 이 파일이 가장 먼저 실행되어야 합니다.
 * dotenv를 가장 먼저 로드한 뒤 app.ts를 불러옵니다.
 */
import path from 'path';
import dotenv from 'dotenv';

// __dirname 확인 (디버깅용)
console.log(`[ENV] server.ts __dirname: ${__dirname}`);

// ts-node로 실행 시: __dirname = backend/src  →  ../.env = backend/.env
// node dist/server.js 실행 시: __dirname = backend/dist  →  ../.env = backend/.env
const envPath = path.resolve(__dirname, '../.env');
console.log(`[ENV] .env 탐색 경로: ${envPath}`);

const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error(`[ENV] .env 파일 로드 실패: ${envPath}`, result.error.message);
} else {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  console.log(`[ENV] .env 파일 로드 완료`);
  console.log(`[ENV] VAPID_PUBLIC_KEY  = ${pub ? pub.substring(0, 15) + '...' : '(없음 - 키 확인 필요)'}`);
  console.log(`[ENV] VAPID_PRIVATE_KEY = ${priv ? priv.substring(0, 10) + '...' : '(없음 - 키 확인 필요)'}`);
}

// dotenv 로드 완료 후 앱 모듈 동적 로드
import('./app');
