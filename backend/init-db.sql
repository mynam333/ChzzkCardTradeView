-- ChzzkCardTradeView 로컬 SQLite 초기 스키마 구성 스크립트

-- 1. 유저 테이블
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,                       -- 치지직 로그인 UID / Supabase Auth ID
    username TEXT NOT NULL,                    -- 치지직 닉네임
    avatar_url TEXT,                           -- 프로필 이미지 URL
    role TEXT DEFAULT 'USER',                  -- 권한 구분 ('USER' 또는 'ADMIN')
    point INTEGER DEFAULT 0,                   -- 보유 재화 (기본값: 0)
    last_free_draw TEXT,                       -- 마지막 무료 뽑기 일시 (ISO String)
    banned_until TEXT,                         -- 유저 차단 만료 일시 (ISO String, 기본값: NULL)
    ban_reason TEXT,                           -- 유저 차단 사유 (nullable)
    created_at TEXT DEFAULT (datetime('now'))  -- 계정 생성 일시
);

-- 2. 스트리머 테이블
CREATE TABLE IF NOT EXISTS streamers (
    channel_id TEXT PRIMARY KEY,               -- 치지직 채널 고유 ID
    name TEXT NOT NULL,                        -- 스트리머 활동명
    logo_url TEXT,                             -- 치지직 기본 프로필 로고 URL
    custom_image_url TEXT,                     -- 스트리머 업로드 커스텀 이미지 URL (0성, NULL 가능)
    custom_image_url_1 TEXT,                    -- 1성 커스텀 카드 이미지
    custom_image_url_2 TEXT,                    -- 2성 커스텀 카드 이미지
    custom_image_url_3 TEXT,                    -- 3성 커스텀 카드 이미지
    custom_image_url_4 TEXT,                    -- 4성 커스텀 카드 이미지
    custom_image_url_5 TEXT,                    -- 5성 커스텀 카드 이미지
    is_image_banned INTEGER DEFAULT 0,         -- 커스텀 이미지 업로드 권한 차단 여부 (0: false, 1: true)
    follower_count INTEGER DEFAULT 0,          -- 실시간 팔로워 수
    activity_score INTEGER DEFAULT 0,          -- 활동 지표 환산 점수
    base_value INTEGER DEFAULT 1000,           -- 현재 환산 시세 (재화 기준)
    is_active INTEGER DEFAULT 0,               -- 현재 방송 중 여부 (0: false, 1: true)
    registered_by TEXT,                         -- 카드를 등록한 유저의 ID (nullable)
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 3. 유저 보유 카드 매핑 테이블
CREATE TABLE IF NOT EXISTS user_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,      -- 자동 증가 고유 ID
    user_id TEXT NOT NULL,                     -- 보유자 고유 ID (users.id FK)
    channel_id TEXT NOT NULL,                  -- 스트리머 카드 ID (streamers.channel_id FK)
    serial_number INTEGER NOT NULL,            -- 발행 일련번호
    acquired_at TEXT DEFAULT (datetime('now')),-- 획득 일시
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(channel_id) REFERENCES streamers(channel_id) ON DELETE CASCADE
);

-- 4. 1:1 교환 제안 테이블
CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,      -- 거래 고유 ID
    sender_id TEXT NOT NULL,                   -- 제안자 ID (users.id FK)
    receiver_id TEXT NOT NULL,                 -- 수신자 ID (users.id FK)
    sender_offer TEXT NOT NULL,                -- 제안품 { cards: [], point: 0 } (JSON 형식 텍스트)
    receiver_offer TEXT NOT NULL,              -- 요청품 { cards: [], point: 0 } (JSON 형식 텍스트)
    status TEXT DEFAULT 'PENDING',             -- 거래 상태 ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED')
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    FOREIGN KEY(sender_id) REFERENCES users(id),
    FOREIGN KEY(receiver_id) REFERENCES users(id)
);

-- 5. 스트리머 시세 히스토리 테이블
CREATE TABLE IF NOT EXISTS value_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL,                  -- 스트리머 ID (streamers.channel_id FK)
    value INTEGER NOT NULL,                    -- 변경 시점의 가치
    recorded_at TEXT DEFAULT (datetime('now')),-- 시세 변동 시점
    FOREIGN KEY(channel_id) REFERENCES streamers(channel_id) ON DELETE CASCADE
);

-- 6. 쿠폰 테이블
CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,                 -- 쿠폰 코드 (수동 입력 또는 랜덤)
    coupon_type TEXT NOT NULL,                 -- 쿠폰 유형 ('single' 또는 'multi')
    points INTEGER NOT NULL DEFAULT 0,         -- 지급 재화 크기
    max_uses INTEGER DEFAULT 1,                -- 최대 사용 가능 횟수 (multi인 경우)
    used_count INTEGER DEFAULT 0,              -- 현재 사용 횟수
    expires_at TEXT,                           -- 유효 만료 기한 (ISO String)
    created_at TEXT DEFAULT (datetime('now'))
);

-- 7. 쿠폰 사용 로그 테이블 (중복 사용 차단용)
CREATE TABLE IF NOT EXISTS coupon_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    coupon_id INTEGER NOT NULL,                -- 쿠폰 ID
    user_id TEXT NOT NULL,                     -- 사용한 유저 ID
    redeemed_at TEXT DEFAULT (datetime('now')),-- 사용한 시점
    FOREIGN KEY(coupon_id) REFERENCES coupons(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(coupon_id, user_id)                 -- 1인 1회 제한을 위한 유니크 제약
);

-- 8. 공지사항 및 팝업 테이블
CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,                       -- 공지 제목
    content TEXT NOT NULL,                     -- 공지 내용
    is_popup INTEGER DEFAULT 0,                -- 메인 팝업 여부 (0: false, 1: true)
    popup_expires_at TEXT,                     -- 팝업 노출 기한
    created_at TEXT DEFAULT (datetime('now'))
);

-- 9. PWA 푸시 구독 정보 테이블
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,                     -- 유저 ID
    endpoint TEXT NOT NULL,                    -- 브라우저 푸시 수신 엔드포인트 URL
    auth_key TEXT NOT NULL,                    -- 암호화 인증 키(auth)
    p256dh_key TEXT NOT NULL,                  -- 암호화 공개 키(p256dh)
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 10. 예약 푸시 알림 테이블
CREATE TABLE IF NOT EXISTS push_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,                       -- 알림 제목
    body TEXT NOT NULL,                        -- 알림 본문
    status TEXT DEFAULT 'pending',             -- 전송 상태 ('pending', 'sent')
    scheduled_at TEXT,                         -- 예약 발송 시각 (즉시 발송 시 NULL, ISO String)
    created_at TEXT DEFAULT (datetime('now'))
);

-- 11. 카드 신고 내역 테이블
CREATE TABLE IF NOT EXISTS card_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id TEXT NOT NULL,                 -- 신고 유저 ID (users.id FK)
    channel_id TEXT NOT NULL,                  -- 신고 대상 카드 ID (streamers.channel_id FK)
    reported_image_url TEXT NOT NULL,          -- 신고 시점의 카드 이미지 스냅샷 URL
    reason TEXT NOT NULL,                      -- 신고 사유
    status TEXT DEFAULT 'pending',             -- 처리 상태 ('pending', 'resolved', 'rejected')
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(reporter_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(channel_id) REFERENCES streamers(channel_id) ON DELETE CASCADE
);

-- 12. 시스템 설정 테이블
CREATE TABLE IF NOT EXISTS system_configs (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
INSERT OR IGNORE INTO system_configs (key, value) VALUES ('free_draw_interval', '24');


