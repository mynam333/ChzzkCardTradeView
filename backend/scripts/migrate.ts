/**
 * migrate.ts - Supabase(PostgreSQL) 스키마 초기화 스크립트
 *
 * 사용법:
 *   npx ts-node scripts/migrate.ts
 *
 * 요구사항:
 *   backend/.env 파일에 DATABASE_URL이 올바르게 설정되어 있어야 합니다.
 */
import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs';
import postgres from 'postgres';

// .env 로드 (scripts/ → src/ 폴더 기준이 아니므로 backend/ 기준으로 탐색)
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl || databaseUrl.includes('[YOUR-PASSWORD]')) {
  console.error('❌ DATABASE_URL이 설정되지 않았거나 비밀번호가 교체되지 않았습니다.');
  console.error('   backend/.env 파일에서 DATABASE_URL의 [YOUR-PASSWORD] 부분을 실제 비밀번호로 교체하세요.');
  process.exit(1);
}

// init-db-postgres.sql 경로 (프로젝트 루트)
const sqlPath = path.resolve(__dirname, '../../init-db-postgres.sql');

if (!fs.existsSync(sqlPath)) {
  console.error(`❌ 스키마 파일을 찾을 수 없습니다: ${sqlPath}`);
  process.exit(1);
}

const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

async function migrate() {
  console.log('🔌 Supabase PostgreSQL 연결 중...');

  const sql = postgres(databaseUrl!, {
    ssl: 'require', // Supabase는 SSL 필수
    max: 1,         // 마이그레이션용 단일 커넥션
  });

  try {
    console.log('📄 스키마 파일 실행 중:', sqlPath);
    await sql.unsafe(sqlContent);
    console.log('✅ Supabase 스키마 초기화가 완료되었습니다!');
    console.log('');
    console.log('테이블 목록을 확인하려면 Supabase 대시보드 > Table Editor를 확인하세요.');
  } catch (err: any) {
    console.error('❌ 마이그레이션 실패:', err.message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

migrate();
