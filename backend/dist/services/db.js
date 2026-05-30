"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSupabaseClient = exports.getSqliteDb = exports.getDbMode = exports.initDatabaseConnection = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const supabase_js_1 = require("@supabase/supabase-js");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
let sqliteDb = null;
let supabaseClient = null;
let dbMode = 'LOCAL_SQL';
/**
 * 데이터베이스 연결 상태를 감지하고 모드를 초기화합니다.
 */
const initDatabaseConnection = async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (supabaseUrl && supabaseKey) {
        try {
            // Supabase 클라이언트 인스턴스화
            supabaseClient = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey);
            // 실제 원격 서버 연결이 유효한지 1건 조회 시도 (연결 감지)
            const { error } = await supabaseClient.from('users').select('id').limit(1);
            if (error) {
                throw new Error(error.message);
            }
            dbMode = 'SUPABASE';
            console.log('[DB] Supabase 클라우드 데이터베이스와 연동되었습니다. (SUPABASE MODE)');
            return;
        }
        catch (err) {
            console.warn(`[DB] Supabase 연결 검사 실패: ${err.message || err}. 로컬 SQLite 모드로 작동을 준비합니다.`);
        }
    }
    else {
        console.log('[DB] Supabase 접속 환경 변수가 불완전합니다. 로컬 SQLite 모드로 동작합니다.');
    }
    // 로컬 SQLite로 Fallback 처리
    try {
        dbMode = 'LOCAL_SQL';
        // 루트 폴더에 local.sqlite 생성
        const dbPath = path_1.default.join(__dirname, '../../../local.sqlite');
        sqliteDb = new better_sqlite3_1.default(dbPath);
        // SQLite3 기본 설정 변경 (성능 향상 및 락 방지)
        sqliteDb.pragma('journal_mode = WAL');
        sqliteDb.pragma('foreign_keys = ON');
        // init-db.sql 초기 스키마 및 더미 로드
        const sqlPath = path_1.default.join(__dirname, '../../../init-db.sql');
        if (fs_1.default.existsSync(sqlPath)) {
            const sqlSchema = fs_1.default.readFileSync(sqlPath, 'utf8');
            sqliteDb.exec(sqlSchema);
            console.log('[DB] 로컬 SQLite3 데이터베이스 연결 및 초기 스키마 적재가 완료되었습니다. (LOCAL MODE)');
        }
        else {
            console.warn(`[DB] 초기화 SQL 파일(${sqlPath})을 찾을 수 없어 테이블 생성 단계를 건너뜁니다.`);
        }
    }
    catch (sqliteErr) {
        console.error('[DB] 로컬 SQLite3 데이터베이스 로딩 실패:', sqliteErr);
        throw sqliteErr;
    }
};
exports.initDatabaseConnection = initDatabaseConnection;
/**
 * 현재 활성화된 데이터베이스 모드를 반환합니다.
 */
const getDbMode = () => {
    return dbMode;
};
exports.getDbMode = getDbMode;
/**
 * 로컬 SQLite3 데이터베이스 커넥션을 반환합니다.
 */
const getSqliteDb = () => {
    if (dbMode !== 'LOCAL_SQL' || !sqliteDb) {
        throw new Error('현재 데이터베이스 모드가 LOCAL_SQL이 아닙니다.');
    }
    return sqliteDb;
};
exports.getSqliteDb = getSqliteDb;
/**
 * Supabase 클라이언트 인터페이스를 반환합니다.
 */
const getSupabaseClient = () => {
    if (dbMode !== 'SUPABASE' || !supabaseClient) {
        throw new Error('현재 데이터베이스 모드가 SUPABASE가 아닙니다.');
    }
    return supabaseClient;
};
exports.getSupabaseClient = getSupabaseClient;
