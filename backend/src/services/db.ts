import Database from 'better-sqlite3';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

let sqliteDb: Database.Database | null = null;
let supabaseClient: SupabaseClient | null = null;
let dbMode: 'LOCAL_SQL' | 'SUPABASE' = 'LOCAL_SQL';

/**
 * 데이터베이스 연결 상태를 감지하고 모드를 초기화합니다.
 */
export const initDatabaseConnection = async (): Promise<void> => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseKey) {
    try {
      // Supabase 클라이언트 인스턴스화
      supabaseClient = createClient(supabaseUrl, supabaseKey);
      
      // 실제 원격 서버 연결이 유효한지 1건 조회 시도 (연결 감지)
      const { error } = await supabaseClient.from('users').select('id').limit(1);
      
      if (error) {
        throw new Error(error.message);
      }
      
      dbMode = 'SUPABASE';
      console.log('[DB] Supabase 클라우드 데이터베이스와 연동되었습니다. (SUPABASE MODE)');
      return;
    } catch (err: any) {
      console.warn(`[DB] Supabase 연결 검사 실패: ${err.message || err}. 로컬 SQLite 모드로 작동을 준비합니다.`);
    }
  } else {
    console.log('[DB] Supabase 접속 환경 변수가 불완전합니다. 로컬 SQLite 모드로 동작합니다.');
  }

  // 로컬 SQLite로 Fallback 처리
  try {
    dbMode = 'LOCAL_SQL';
    // 루트 폴더에 local.sqlite 생성
    const dbPath = path.join(__dirname, '../../../local.sqlite');
    sqliteDb = new Database(dbPath);
    
    // SQLite3 기본 설정 변경 (성능 향상 및 락 방지)
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.pragma('foreign_keys = ON');
    
    // init-db.sql 초기 스키마 및 더미 로드
    const sqlPath = path.join(__dirname, '../../../init-db.sql');
    if (fs.existsSync(sqlPath)) {
      const sqlSchema = fs.readFileSync(sqlPath, 'utf8');
      sqliteDb.exec(sqlSchema);
      console.log('[DB] 로컬 SQLite3 데이터베이스 연결 및 초기 스키마 적재가 완료되었습니다. (LOCAL MODE)');
      
      // 테이블 컬럼 자동 마이그레이션 방어 장치
      try {
        sqliteDb.prepare("SELECT broadcast_count FROM streamers LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] streamers 테이블에 broadcast_count 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE streamers ADD COLUMN broadcast_count INTEGER DEFAULT 0;");
      }
      try {
        sqliteDb.prepare("SELECT chat_count FROM streamers LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] streamers 테이블에 chat_count 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE streamers ADD COLUMN chat_count INTEGER DEFAULT 0;");
      }
      try {
        sqliteDb.prepare("SELECT broadcast_multiplier FROM streamers LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] streamers 테이블에 broadcast_multiplier 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE streamers ADD COLUMN broadcast_multiplier REAL DEFAULT 1.0;");
      }
      try {
        sqliteDb.prepare("SELECT prev_value FROM streamers LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] streamers 테이블에 prev_value 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE streamers ADD COLUMN prev_value INTEGER DEFAULT 1000;");
      }
      try {
        sqliteDb.prepare("SELECT broadcast_minutes FROM streamers LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] streamers 테이블에 broadcast_minutes 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE streamers ADD COLUMN broadcast_minutes INTEGER DEFAULT 0;");
      }
      try {
        sqliteDb.prepare("SELECT registered_by FROM streamers LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] streamers 테이블에 registered_by 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE streamers ADD COLUMN registered_by TEXT;");
      }
      // 별(1~5성)별 커스텀 카드 이미지 컬럼 (0성은 기존 custom_image_url 사용)
      for (let st = 1; st <= 5; st++) {
        try {
          sqliteDb.prepare(`SELECT custom_image_url_${st} FROM streamers LIMIT 1`).get();
        } catch (e) {
          console.log(`[DB Migration] streamers 테이블에 custom_image_url_${st} 컬럼이 없어 추가합니다.`);
          sqliteDb.exec(`ALTER TABLE streamers ADD COLUMN custom_image_url_${st} TEXT;`);
        }
      }
      try {
        sqliteDb.prepare("SELECT representative_card_channel_id FROM users LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] users 테이블에 representative_card_channel_id 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE users ADD COLUMN representative_card_channel_id TEXT;");
      }
      try {
        sqliteDb.prepare("SELECT ban_reason FROM users LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] users 테이블에 ban_reason 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE users ADD COLUMN ban_reason TEXT;");
      }
      try {
        sqliteDb.prepare("SELECT access_token FROM users LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] users 테이블에 access_token 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE users ADD COLUMN access_token TEXT;");
      }
      try {
        sqliteDb.prepare("SELECT refresh_token FROM users LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] users 테이블에 refresh_token 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE users ADD COLUMN refresh_token TEXT;");
      }
      try {
        sqliteDb.prepare("SELECT token_expires_at FROM users LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] users 테이블에 token_expires_at 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE users ADD COLUMN token_expires_at TEXT;");
      }
      try {
        sqliteDb.prepare("SELECT star FROM user_cards LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] user_cards 테이블에 star 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE user_cards ADD COLUMN star INTEGER DEFAULT 0;");
      }
      try {
        sqliteDb.prepare("SELECT border_item_id FROM user_cards LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] user_cards 테이블에 코스메틱 장착 컬럼을 추가합니다.');
        sqliteDb.exec("ALTER TABLE user_cards ADD COLUMN border_item_id INTEGER;");
        sqliteDb.exec("ALTER TABLE user_cards ADD COLUMN name_effect_item_id INTEGER;");
      }
      try {
        sqliteDb.prepare("SELECT reward_type FROM coupons LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] coupons 테이블에 보상(reward) 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE coupons ADD COLUMN reward_type TEXT NOT NULL DEFAULT 'point';");
        sqliteDb.exec("ALTER TABLE coupons ADD COLUMN reward_channel_id TEXT;");
        sqliteDb.exec("ALTER TABLE coupons ADD COLUMN reward_quantity INTEGER DEFAULT 0;");
      }
      try {
        sqliteDb.prepare("SELECT reward_item_id FROM coupons LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] coupons 테이블에 reward_item_id(코스메틱 보상) 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE coupons ADD COLUMN reward_item_id INTEGER;");
      }
      try {
        sqliteDb.prepare("SELECT purchase_limit FROM shop_items LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] shop_items 테이블에 purchase_limit(1인 구매 제한) 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE shop_items ADD COLUMN purchase_limit INTEGER DEFAULT 0;");
      }
      try {
        sqliteDb.prepare("SELECT star FROM card_reports LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] card_reports 테이블에 star(신고 카드 별) 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE card_reports ADD COLUMN star INTEGER DEFAULT 0;");
      }
      // 상점 구매 횟수 테이블 (구매 제한 추적) — 신규 배포 호환
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS shop_purchases (
        user_id TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        count INTEGER DEFAULT 0,
        PRIMARY KEY(user_id, item_id)
      );`);

      // 시스템 설정 테이블 (무료 뽑기 간격 등)
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS system_configs (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );`);
      sqliteDb.prepare("INSERT OR IGNORE INTO system_configs (key, value) VALUES ('free_draw_interval', '24')").run();
      // 뽑기 비용 기본값 (하드코딩 제거, DB 관리)
      sqliteDb.prepare("INSERT OR IGNORE INTO system_configs (key, value) VALUES ('draw_cost', '10000')").run();
    } else {
      console.warn(`[DB] 초기화 SQL 파일(${sqlPath})을 찾을 수 없어 테이블 생성 단계를 건너뜁니다.`);
    }
  } catch (sqliteErr) {
    console.error('[DB] 로컬 SQLite3 데이터베이스 로딩 실패:', sqliteErr);
    throw sqliteErr;
  }
};

/**
 * 현재 활성화된 데이터베이스 모드를 반환합니다.
 */
export const getDbMode = (): 'LOCAL_SQL' | 'SUPABASE' => {
  return dbMode;
};

/**
 * 로컬 SQLite3 데이터베이스 커넥션을 반환합니다.
 */
export const getSqliteDb = (): Database.Database => {
  if (dbMode !== 'LOCAL_SQL' || !sqliteDb) {
    throw new Error('현재 데이터베이스 모드가 LOCAL_SQL이 아닙니다.');
  }
  return sqliteDb;
};

/**
 * Supabase 클라이언트 인터페이스를 반환합니다.
 */
export const getSupabaseClient = (): SupabaseClient => {
  if (dbMode !== 'SUPABASE' || !supabaseClient) {
    throw new Error('현재 데이터베이스 모드가 SUPABASE가 아닙니다.');
  }
  return supabaseClient;
};
