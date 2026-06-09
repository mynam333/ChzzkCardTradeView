/**
 * server.ts - 애플리케이션 진입점 (엔트리포인트)
 *
 * ⚠️ 이 파일이 가장 먼저 실행되어야 합니다.
 * dotenv를 가장 먼저 로드한 뒤 app.ts를 불러옵니다.
 */
import path from 'path';
import dns from 'dns';
import dotenv from 'dotenv';
import { initFileLogging } from './services/fileLogger';

// 외부 API(Supabase 등) 연결 시, IPv6 경로가 막힌 호스트에서 undici가 AAAA(IPv6)를
// 먼저 시도하다 'TypeError: fetch failed'(ENETUNREACH/타임아웃 등)가 간헐적으로 나는 문제를
// 줄이기 위해 IPv4 주소를 우선 사용하도록 설정합니다. (Node 18+)
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

// 처리되지 않은 Promise 거부/예외로 서버 프로세스가 죽지 않도록 전역 가드를 등록합니다.
// 일시적인 네트워크 오류(fetch failed)가 fire-and-forget 호출에서 발생해도 서버는 계속 동작하고,
// 원인 파악을 위해 cause까지 로그로 남깁니다.
process.on('unhandledRejection', (reason: any) => {
  console.error('[Process] 처리되지 않은 Promise 거부:', reason?.message || reason);
  if (reason?.cause) console.error('[Process] 상세 원인(cause):', reason.cause);
});
process.on('uncaughtException', (err: any) => {
  console.error('[Process] 처리되지 않은 예외:', err?.message || err);
  if (err?.cause) console.error('[Process] 상세 원인(cause):', err.cause);
});

// __dirname 확인 (디버깅용)
console.log(`[ENV] server.ts __dirname: ${__dirname}`);

// ts-node로 실행 시: __dirname = backend/src  →  ../.env = backend/.env
// node dist/server.js 실행 시: __dirname = backend/dist  →  ../.env = backend/.env
const envPath = path.resolve(__dirname, '../.env');
console.log(`[ENV] .env 탐색 경로: ${envPath}`);

const result = dotenv.config({ path: envPath });
initFileLogging();

if (result.error) {
  console.error(`[ENV] .env 파일 로드 실패: ${envPath}`, result.error.message);
} else {
  console.log(`[ENV] .env 파일 로드 완료`);
  console.log(`[ENV] VAPID_PUBLIC_KEY  = ${process.env.VAPID_PUBLIC_KEY ? '(설정됨)' : '(없음 - 키 확인 필요)'}`);
  console.log(`[ENV] VAPID_PRIVATE_KEY = ${process.env.VAPID_PRIVATE_KEY ? '(설정됨)' : '(없음 - 키 확인 필요)'}`);
}

// dotenv 로드 완료 후 앱 모듈 동적 로드
import('./app');
