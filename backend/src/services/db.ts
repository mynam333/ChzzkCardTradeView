import Database from 'better-sqlite3';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

let sqliteDb: Database.Database | null = null;
let supabaseClient: SupabaseClient | null = null;
let dbMode: 'LOCAL_SQL' | 'SUPABASE' = 'LOCAL_SQL';

/**
 * Supabase(PostgREST) 호출용 fetch 래퍼.
 * Node(undici)의 keep-alive 소켓이 서버측에서 끊기거나 일시적 네트워크
 * 오류가 발생하면 fetch가 'TypeError: fetch failed'로 거부됩니다. 이런 일시
 * 오류에 한해 짧은 백오프로 재시도하여 간헐적 조회 실패를 흡수합니다.
 * (HTTP 4xx/5xx 응답은 throw가 아니라 정상 반환되므로 재시도 대상이 아닙니다.)
 */
const SUPABASE_FETCH_MAX_RETRIES = 2;
const fetchWithRetry: typeof fetch = async (input, init) => {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= SUPABASE_FETCH_MAX_RETRIES; attempt++) {
    try {
      return await fetch(input, init);
    } catch (err: any) {
      lastErr = err;
      // 네트워크 계층 오류(TypeError: fetch failed)만 재시도. 그 외(abort 등)는 즉시 전파.
      const isNetworkError = err instanceof TypeError;
      if (!isNetworkError || attempt === SUPABASE_FETCH_MAX_RETRIES) break;
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  throw lastErr;
};

/**
 * 데이터베이스 연결 상태를 감지하고 모드를 초기화합니다.
 */
export const initDatabaseConnection = async (): Promise<void> => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseKey) {
    try {
      // Supabase 클라이언트 인스턴스화 (일시 네트워크 오류 재시도 fetch 주입)
      supabaseClient = createClient(supabaseUrl, supabaseKey, {
        global: { fetch: fetchWithRetry }
      });
      
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
      try {
        sqliteDb.prepare("SELECT serial_number FROM streamers LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] streamers 테이블에 serial_number 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE streamers ADD COLUMN serial_number INTEGER;");
      }
      try {
        sqliteDb.prepare("SELECT last_broadcast_at FROM streamers LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] streamers 테이블에 last_broadcast_at 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE streamers ADD COLUMN last_broadcast_at TEXT;");
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
        sqliteDb.prepare("SELECT representative_card_star FROM users LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] users 테이블에 representative_card_star 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE users ADD COLUMN representative_card_star INTEGER;");
      }
      try {
        sqliteDb.prepare("SELECT status_message FROM users LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] users 테이블에 status_message 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE users ADD COLUMN status_message TEXT;");
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
        sqliteDb.prepare("SELECT free_draw_tickets FROM users LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] users 테이블에 free_draw_tickets 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE users ADD COLUMN free_draw_tickets INTEGER NOT NULL DEFAULT 0;");
      }
      try {
        sqliteDb.prepare("SELECT bonus_free_draw_tickets FROM users LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] users 테이블에 bonus_free_draw_tickets 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE users ADD COLUMN bonus_free_draw_tickets INTEGER NOT NULL DEFAULT 0;");
      }
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS tutorial_rewards (
        user_id TEXT NOT NULL,
        reward_key TEXT NOT NULL,
        reward_type TEXT NOT NULL,
        reward_amount INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(user_id, reward_key),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );`);
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
        sqliteDb.prepare("SELECT is_hidden FROM user_cards LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] user_cards 테이블에 숨김/즐겨찾기 컬럼을 추가합니다.');
        sqliteDb.exec("ALTER TABLE user_cards ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;");
        sqliteDb.exec("ALTER TABLE user_cards ADD COLUMN favorite_order INTEGER;");
        sqliteDb.exec("ALTER TABLE user_cards ADD COLUMN favorite_at TEXT;");
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
        sqliteDb.prepare("SELECT coupon_code FROM push_notifications LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] push_notifications 테이블에 coupon_code 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE push_notifications ADD COLUMN coupon_code TEXT;");
      }
      try {
        sqliteDb.exec(`
          DELETE FROM push_subscriptions
           WHERE id NOT IN (
             SELECT MAX(id)
               FROM push_subscriptions
              GROUP BY endpoint
           );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);
        `);
      } catch (e) {
        console.warn('[DB Migration] push_subscriptions endpoint 중복 정리/인덱스 생성 경고:', e);
      }
      try {
        sqliteDb.prepare("SELECT purchase_limit FROM shop_items LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] shop_items 테이블에 purchase_limit(1인 구매 제한) 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE shop_items ADD COLUMN purchase_limit INTEGER DEFAULT 0;");
      }
      try {
        sqliteDb.prepare("SELECT is_equipped FROM user_titles LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] user_titles 테이블에 is_equipped 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE user_titles ADD COLUMN is_equipped INTEGER NOT NULL DEFAULT 0;");
      }
      sqliteDb.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_titles_equipped ON user_titles(user_id) WHERE is_equipped = 1;");
      try {
        sqliteDb.prepare("SELECT star FROM card_reports LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] card_reports 테이블에 star(신고 카드 별) 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE card_reports ADD COLUMN star INTEGER DEFAULT 0;");
      }
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS streamer_registration_blocks (
        channel_id TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        blocked_by TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );`);
      try {
        sqliteDb.prepare("SELECT is_pinned FROM announcements LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] announcements 테이블에 is_pinned(상단 고정) 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE announcements ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;");
      }
      // 상점 구매 횟수 테이블 (구매 제한 추적) — 신규 배포 호환
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS shop_purchases (
        user_id TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        count INTEGER DEFAULT 0,
        PRIMARY KEY(user_id, item_id)
      );`);

      // 오픈마켓 매물 테이블 생성 — 신규 배포 호환
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS market_listings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seller_id TEXT NOT NULL,
        user_card_id INTEGER NOT NULL,
        price INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        buyer_id TEXT,
        fee INTEGER DEFAULT 0,
        settled_amount INTEGER DEFAULT 0,
        with_cosmetics INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY(seller_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(user_card_id) REFERENCES user_cards(id) ON DELETE CASCADE,
        FOREIGN KEY(buyer_id) REFERENCES users(id) ON DELETE SET NULL
      );`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_market_listings_status ON market_listings(status);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_market_listings_created ON market_listings(created_at);`);
      try {
        const db = sqliteDb;
        if (!db) throw new Error('SQLITE_DB_NOT_READY');
        const indexes = db.prepare("PRAGMA index_list('market_listings')").all() as any[];
        const hasGlobalCardUnique = indexes.some((idx) => {
          if (!idx.unique) return false;
          const cols = db.prepare(`PRAGMA index_info(${JSON.stringify(idx.name)})`).all() as any[];
          return cols.length === 1 && cols[0]?.name === 'user_card_id';
        });
        if (hasGlobalCardUnique) {
          console.log('[DB Migration] market_listings.user_card_id 전역 UNIQUE 제약을 PENDING 부분 UNIQUE 인덱스로 변경합니다.');
          const fk = db.pragma('foreign_keys', { simple: true }) as number;
          db.pragma('foreign_keys = OFF');
          try {
            db.exec(`
              DROP TABLE IF EXISTS market_listings_new;
              CREATE TABLE IF NOT EXISTS market_listings_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                seller_id TEXT NOT NULL,
                user_card_id INTEGER NOT NULL,
                price INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'PENDING',
                buyer_id TEXT,
                fee INTEGER DEFAULT 0,
                settled_amount INTEGER DEFAULT 0,
                with_cosmetics INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY(seller_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(user_card_id) REFERENCES user_cards(id) ON DELETE CASCADE,
                FOREIGN KEY(buyer_id) REFERENCES users(id) ON DELETE SET NULL
              );
              INSERT INTO market_listings_new
                (id, seller_id, user_card_id, price, status, buyer_id, fee, settled_amount, with_cosmetics, created_at, updated_at)
              SELECT id, seller_id, user_card_id, price, status, buyer_id, fee, settled_amount,
                     COALESCE(with_cosmetics, 0), created_at, updated_at
                FROM market_listings;
              DROP TABLE market_listings;
              ALTER TABLE market_listings_new RENAME TO market_listings;
            `);
          } finally {
            db.pragma(`foreign_keys = ${fk ? 'ON' : 'OFF'}`);
          }
        }
      } catch (e) {
        console.error('[DB Migration] market_listings UNIQUE 제약 변경 실패:', e);
      }
      sqliteDb.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_market_listings_pending_card ON market_listings(user_card_id) WHERE status = 'PENDING';`);

      // 미니게임 티켓 및 세션 테이블 생성
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS user_minigame_tickets (
        user_id TEXT PRIMARY KEY,
        current_tickets INTEGER NOT NULL DEFAULT 5,
        bonus_tickets INTEGER NOT NULL DEFAULT 0,
        last_charged_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );`);

      try {
        sqliteDb.prepare("SELECT bonus_tickets FROM user_minigame_tickets LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] user_minigame_tickets 테이블에 bonus_tickets 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE user_minigame_tickets ADD COLUMN bonus_tickets INTEGER NOT NULL DEFAULT 0;");
      }

      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS minigame_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        game_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'STARTED',
        target_data TEXT,
        ticket_spent_type TEXT DEFAULT 'NONE',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        earned_points INTEGER DEFAULT 0,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );`);

      try {
        sqliteDb.prepare("SELECT ticket_spent_type FROM minigame_sessions LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] minigame_sessions 테이블에 ticket_spent_type 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE minigame_sessions ADD COLUMN ticket_spent_type TEXT DEFAULT 'NONE';");
      }

      try {
        sqliteDb.prepare("SELECT with_cosmetics FROM market_listings LIMIT 1").get();
      } catch (e) {
        console.log('[DB Migration] market_listings 테이블에 with_cosmetics 컬럼이 없어 추가합니다.');
        sqliteDb.exec("ALTER TABLE market_listings ADD COLUMN with_cosmetics INTEGER DEFAULT 0;");
      }
      for (const [column, ddl] of [
        ['listing_type', "ALTER TABLE market_listings ADD COLUMN listing_type TEXT NOT NULL DEFAULT 'fixed';"],
        ['buy_now_price', 'ALTER TABLE market_listings ADD COLUMN buy_now_price INTEGER;'],
        ['starting_bid', 'ALTER TABLE market_listings ADD COLUMN starting_bid INTEGER;'],
        ['current_bid', 'ALTER TABLE market_listings ADD COLUMN current_bid INTEGER;'],
        ['current_bidder_id', 'ALTER TABLE market_listings ADD COLUMN current_bidder_id TEXT;'],
        ['auction_ends_at', 'ALTER TABLE market_listings ADD COLUMN auction_ends_at TEXT;']
      ] as const) {
        try {
          sqliteDb.prepare(`SELECT ${column} FROM market_listings LIMIT 1`).get();
        } catch (e) {
          console.log(`[DB Migration] market_listings 테이블에 ${column} 컬럼이 없어 추가합니다.`);
          sqliteDb.exec(ddl);
        }
      }
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS market_bids (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        listing_id INTEGER NOT NULL,
        bidder_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY(listing_id) REFERENCES market_listings(id) ON DELETE CASCADE,
        FOREIGN KEY(bidder_id) REFERENCES users(id) ON DELETE CASCADE
      );`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_market_bids_listing ON market_bids(listing_id, amount DESC);`);
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS market_watches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        star INTEGER,
        max_price INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, channel_id, star),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(channel_id) REFERENCES streamers(channel_id) ON DELETE CASCADE
      );`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_market_watches_card ON market_watches(channel_id, star);`);

      // 시스템 설정 테이블 (무료 뽑기 간격 등)
      sqliteDb.exec(`CREATE TABLE IF NOT EXISTS system_configs (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );`);
      sqliteDb.prepare("INSERT OR IGNORE INTO system_configs (key, value) VALUES ('free_draw_interval', '24')").run();
      sqliteDb.prepare("INSERT OR IGNORE INTO system_configs (key, value) VALUES ('free_draw_max_stack', '1')").run();
      // 뽑기 비용 기본값 (하드코딩 제거, DB 관리)
      sqliteDb.prepare("INSERT OR IGNORE INTO system_configs (key, value) VALUES ('draw_cost', '10000')").run();
      sqliteDb.prepare("INSERT OR IGNORE INTO system_configs (key, value) VALUES ('minigame_ticket_charge_interval_minutes', '240')").run();
      sqliteDb.prepare("INSERT OR IGNORE INTO system_configs (key, value) VALUES ('maintenance_active', 'false')").run();
      sqliteDb.prepare("INSERT OR IGNORE INTO system_configs (key, value) VALUES ('maintenance_start_at', '')").run();
      sqliteDb.prepare("INSERT OR IGNORE INTO system_configs (key, value) VALUES ('maintenance_end_at', '')").run();

      // 이미지 URL 자동 상대경로 마이그레이션 (호스트/포트 변경 방어 장치)
      try {
        const columns = [
          'custom_image_url', 'custom_image_url_1', 'custom_image_url_2',
          'custom_image_url_3', 'custom_image_url_4', 'custom_image_url_5'
        ];
        for (const col of columns) {
          sqliteDb.prepare(`
            UPDATE streamers
            SET ${col} = '/' || SUBSTR(${col}, INSTR(${col}, 'uploads/'))
            WHERE ${col} LIKE '%/uploads/%'
          `).run();
        }
        console.log('[DB Migration] SQLite 이미지 절대경로를 상대경로로 변환 완료했습니다.');
      } catch (migrateErr: any) {
        console.warn('[DB Migration] SQLite 이미지 경로 마이그레이션 경고:', migrateErr?.message);
      }
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

/**
 * 테스트 전용: in-memory SQLite 인스턴스를 주입합니다.
 * (운영 코드 경로에서는 호출되지 않습니다)
 */
export const __setSqliteDbForTest = (db: Database.Database | null): void => {
  sqliteDb = db;
  dbMode = 'LOCAL_SQL';
};
