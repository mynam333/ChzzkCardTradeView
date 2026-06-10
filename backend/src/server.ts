/**
 * server.ts - API 서버 진입점.
 *
 * dotenv와 파일 로그를 먼저 초기화한 뒤 app.ts를 로드합니다.
 * backend/.env를 기본으로 읽고, backend/.env.<PROCESS_ROLE>이 있으면 추가로 override합니다.
 */
process.env.PROCESS_ROLE = process.env.PROCESS_ROLE || 'api';

import { bootstrapProcess } from './services/processBootstrap';

bootstrapProcess('Server');

console.log(`[ENV] VAPID_PUBLIC_KEY  = ${process.env.VAPID_PUBLIC_KEY ? '(설정됨)' : '(없음 - 키 확인 필요)'}`);
console.log(`[ENV] VAPID_PRIVATE_KEY = ${process.env.VAPID_PRIVATE_KEY ? '(설정됨)' : '(없음 - 키 확인 필요)'}`);

import('./app');
