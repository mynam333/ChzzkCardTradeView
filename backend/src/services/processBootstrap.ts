import path from 'path';
import dns from 'dns';
import fs from 'fs';
import dotenv from 'dotenv';
import { initFileLogging } from './fileLogger';

let bootstrapped = false;

export const bootstrapProcess = (name: string) => {
  if (bootstrapped) return;
  bootstrapped = true;

  if (typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
  }

  process.on('unhandledRejection', (reason: any) => {
    console.error(`[${name}] 처리되지 않은 Promise 거부:`, reason?.message || reason);
    if (reason?.cause) console.error(`[${name}] 상세 원인(cause):`, reason.cause);
  });

  process.on('uncaughtException', (err: any) => {
    console.error(`[${name}] 처리되지 않은 예외:`, err?.message || err);
    if (err?.cause) console.error(`[${name}] 상세 원인(cause):`, err.cause);
  });

  const envPath = path.resolve(__dirname, '../.env');
  const result = dotenv.config({ path: envPath });
  const role = String(process.env.PROCESS_ROLE || '').trim();
  const roleEnvPath = role ? path.resolve(__dirname, `../.env.${role}`) : '';
  const roleResult = roleEnvPath && fs.existsSync(roleEnvPath)
    ? dotenv.config({ path: roleEnvPath, override: true })
    : null;
  initFileLogging();

  if (result.error) {
    console.error(`[${name}] .env 파일 로드 실패: ${envPath}`, result.error.message);
  } else {
    console.log(`[${name}] .env 파일 로드 완료: ${envPath}`);
  }
  if (roleResult && !roleResult.error) {
    console.log(`[${name}] 역할별 .env 파일 로드 완료: ${roleEnvPath}`);
  } else if (roleResult?.error) {
    console.error(`[${name}] 역할별 .env 파일 로드 실패: ${roleEnvPath}`, roleResult.error.message);
  }
};
