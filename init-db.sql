-- 치카포 로컬 SQLite 초기 스키마 구성 스크립트

-- 1. 유저 테이블
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,                       -- 치지직 로그인 UID / Supabase Auth ID
    username TEXT NOT NULL,                    -- 치지직 닉네임
    avatar_url TEXT,                           -- 프로필 이미지 URL
    role TEXT DEFAULT 'USER',                  -- 권한 구분 ('USER' 또는 'ADMIN')
    point INTEGER DEFAULT 0,                   -- 보유 재화 (기본값: 0)
    last_free_draw TEXT,                       -- 마지막 무료 뽑기 충전 구간 (ISO String)
    free_draw_tickets INTEGER NOT NULL DEFAULT 0, -- 주기 충전 무료 소환 기회
    bonus_free_draw_tickets INTEGER NOT NULL DEFAULT 0, -- 쿠폰/보상 추가 무료 소환 티켓
    banned_until TEXT,                         -- 유저 차단 만료 일시 (ISO String, 기본값: NULL)
    ban_reason TEXT,                           -- 유저 차단 사유 (nullable)
    representative_card_channel_id TEXT,       -- 대표 카드로 지정한 스트리머 채널 ID (nullable)
    representative_card_star INTEGER,          -- 대표 카드 별 등급 (nullable, 레거시는 미지정)
    status_message TEXT,                       -- 프로필 상태 메시지
    access_token TEXT,                         -- 치지직 OAuth access_token (암호화 저장)
    refresh_token TEXT,                        -- 치지직 OAuth refresh_token (암호화 저장)
    token_expires_at TEXT,                     -- 치지직 access_token 만료 시각 (ISO String)
    last_seen_at TEXT,                         -- 마지막 접속/활동 감지 시각
    created_at TEXT DEFAULT (datetime('now'))  -- 계정 생성 일시
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active
    ON auth_sessions(user_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
    ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS chat_attachment_quota_locks (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chat_attachment_quota_reservations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reserved_bytes INTEGER NOT NULL CHECK (reserved_bytes > 0),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_attachment_quota_reservations_user
    ON chat_attachment_quota_reservations(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_chat_attachment_quota_reservations_expiry
    ON chat_attachment_quota_reservations(expires_at);

CREATE TABLE IF NOT EXISTS deleted_user_accounts (
    user_id TEXT PRIMARY KEY,                  -- 탈퇴한 치지직 채널 ID
    deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
    username_snapshot TEXT,
    avatar_url_snapshot TEXT,
    point_at_deletion INTEGER
);

CREATE TABLE IF NOT EXISTS point_ledger_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    counterparty_user_id TEXT,
    amount INTEGER NOT NULL,
    balance_after INTEGER,
    source_type TEXT NOT NULL,
    source_id TEXT,
    reason TEXT NOT NULL,
    description TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_point_ledger_user_id ON point_ledger_entries(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_point_ledger_counterparty ON point_ledger_entries(counterparty_user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_point_ledger_source ON point_ledger_entries(source_type, source_id);

CREATE TABLE IF NOT EXISTS asset_event_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_key TEXT UNIQUE,
    user_id TEXT,
    counterparty_user_id TEXT,
    from_user_id TEXT,
    to_user_id TEXT,
    asset_type TEXT NOT NULL,
    action TEXT NOT NULL,
    amount INTEGER,
    quantity INTEGER,
    balance_after INTEGER,
    source_type TEXT NOT NULL DEFAULT 'unknown',
    source_id TEXT,
    reason TEXT NOT NULL,
    description TEXT,
    card_id INTEGER,
    channel_id TEXT,
    serial_number INTEGER,
    star INTEGER,
    item_id INTEGER,
    item_type TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_asset_event_user ON asset_event_logs(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_asset_event_counterparty ON asset_event_logs(counterparty_user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_asset_event_from_to ON asset_event_logs(from_user_id, to_user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_asset_event_asset_action ON asset_event_logs(asset_type, action, id DESC);
CREATE INDEX IF NOT EXISTS idx_asset_event_source ON asset_event_logs(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_asset_event_card ON asset_event_logs(card_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_asset_event_item ON asset_event_logs(item_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_asset_event_created ON asset_event_logs(created_at);

CREATE TABLE IF NOT EXISTS tutorial_rewards (
    user_id TEXT NOT NULL,
    reward_key TEXT NOT NULL,
    reward_type TEXT NOT NULL,
    reward_amount INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY(user_id, reward_key),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS titles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    css TEXT NOT NULL DEFAULT '',
    icon_name TEXT,
    icon_color TEXT NOT NULL DEFAULT '#ffffff',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_titles (
    user_id TEXT NOT NULL,
    title_id INTEGER NOT NULL,
    awarded_at TEXT DEFAULT (datetime('now')),
    is_equipped INTEGER NOT NULL DEFAULT 0,
    grant_source TEXT NOT NULL DEFAULT 'manual',
    PRIMARY KEY (user_id, title_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (title_id) REFERENCES titles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_titles_grant_source ON user_titles(grant_source, title_id);

CREATE INDEX IF NOT EXISTS idx_user_titles_user ON user_titles(user_id);

CREATE TABLE IF NOT EXISTS subscription_title_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    broadcaster_channel_id TEXT NOT NULL,       -- 구독 확인 대상 치지직 채널 ID
    broadcaster_name TEXT,                      -- 관리자 표시용 채널명
    title_id INTEGER NOT NULL,                  -- 구독 중일 때 제공할 칭호
    active INTEGER NOT NULL DEFAULT 1,          -- 규칙 사용 여부
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(title_id) REFERENCES titles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_subscription_title_rules_active ON subscription_title_rules(active, title_id);
CREATE INDEX IF NOT EXISTS idx_subscription_title_rules_broadcaster ON subscription_title_rules(broadcaster_channel_id);

CREATE TABLE IF NOT EXISTS subscription_title_states (
    user_id TEXT NOT NULL,
    rule_id INTEGER NOT NULL,
    is_subscribed INTEGER NOT NULL DEFAULT 0,
    checked_at TEXT,
    checked_until TEXT,
    last_error TEXT,
    PRIMARY KEY(user_id, rule_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(rule_id) REFERENCES subscription_title_rules(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_subscription_title_states_valid ON subscription_title_states(rule_id, is_subscribed, checked_until);
CREATE INDEX IF NOT EXISTS idx_subscription_title_states_user ON subscription_title_states(user_id, checked_until);

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
    broadcast_count INTEGER DEFAULT 0,          -- 방송 켠 횟수
    broadcast_minutes INTEGER DEFAULT 0,        -- 누적 방송 시간(분)
    chat_count INTEGER DEFAULT 0,               -- 실시간 채팅 누적 갯수
    broadcast_multiplier REAL DEFAULT 1.0,      -- 실시간 방송 감가 배율 (0.2 ~ 1.0)
    prev_value INTEGER DEFAULT 1000,            -- 이전 환산 시세 (등락률 계산용)
    last_broadcast_at TEXT,                     -- 마지막 방송 감지 일시
    serial_number INTEGER,                      -- 스트리머 카드 발행 일련번호
    registered_by TEXT,                         -- 카드를 등록한 유저의 ID (nullable)
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 3. 유저 보유 카드 매핑 테이블
CREATE TABLE IF NOT EXISTS user_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,      -- 자동 증가 고유 ID
    user_id TEXT NOT NULL,                     -- 보유자 고유 ID (users.id FK)
    channel_id TEXT NOT NULL,                  -- 스트리머 카드 ID (streamers.channel_id FK)
    serial_number INTEGER NOT NULL,            -- 발행 일련번호
    star INTEGER DEFAULT 0,                     -- 합성 별 등급 (0~5)
    border_item_id INTEGER,                    -- 장착된 테두리 코스메틱 ID
    name_effect_item_id INTEGER,               -- 장착된 이름 이펙트 코스메틱 ID
    is_hidden INTEGER NOT NULL DEFAULT 0,       -- 외부 보유 카드 노출 숨김
    is_locked INTEGER NOT NULL DEFAULT 0,       -- 거래/합성 등 이동 잠금 여부
    favorite_order INTEGER,                    -- 즐겨찾기 고정 정렬 순서
    favorite_at TEXT,                          -- 즐겨찾기 설정 일시
    acquired_at TEXT DEFAULT (datetime('now')),-- 획득 일시
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(channel_id) REFERENCES streamers(channel_id) ON DELETE CASCADE,
    FOREIGN KEY(border_item_id) REFERENCES shop_items(id) ON DELETE SET NULL,
    FOREIGN KEY(name_effect_item_id) REFERENCES shop_items(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_user_cards_user_visible ON user_cards(user_id, is_hidden);
CREATE INDEX IF NOT EXISTS idx_user_cards_user_locked ON user_cards(user_id, is_locked);
CREATE INDEX IF NOT EXISTS idx_user_cards_channel_star_visible ON user_cards(channel_id, star, is_hidden);
CREATE INDEX IF NOT EXISTS idx_user_cards_user_inventory_order ON user_cards(user_id, favorite_order, id DESC);
CREATE INDEX IF NOT EXISTS idx_user_cards_user_favorite_max ON user_cards(user_id, favorite_order DESC) WHERE favorite_order IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_asset_rankings (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    avatar_url TEXT,
    role TEXT DEFAULT 'USER',
    point INTEGER NOT NULL DEFAULT 0,
    last_free_draw TEXT,
    banned_until TEXT,
    ban_reason TEXT,
    status_message TEXT,
    last_seen_at TEXT,
    created_at TEXT,
    card_count INTEGER NOT NULL DEFAULT 0,
    cards_value INTEGER NOT NULL DEFAULT 0,
    total_asset INTEGER NOT NULL DEFAULT 0,
    total_rank INTEGER NOT NULL,
    cards_rank INTEGER NOT NULL,
    snapshot_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_user_asset_rankings_total ON user_asset_rankings(total_rank, user_id);
CREATE INDEX IF NOT EXISTS idx_user_asset_rankings_cards ON user_asset_rankings(cards_rank, user_id);
CREATE INDEX IF NOT EXISTS idx_user_asset_rankings_username ON user_asset_rankings(username);

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
    reward_type TEXT NOT NULL DEFAULT 'point', -- 보상 종류 ('point', 'card', 'cosmetic', 'minigame_ticket', 'free_draw_ticket')
    points INTEGER NOT NULL DEFAULT 0,         -- 지급 재화 크기 (reward_type='point')
    reward_channel_id TEXT,                    -- 지급 스트리머 채널 ID (reward_type='card')
    reward_item_id INTEGER,                    -- 지급 상점 아이템 ID (reward_type='cosmetic')
    reward_quantity INTEGER DEFAULT 0,         -- 지급 수량 (card/cosmetic/minigame_ticket/free_draw_ticket)
    rewards TEXT NOT NULL DEFAULT '[]',        -- 다중 보상 JSON 배열. 비어 있으면 레거시 단일 보상 컬럼 사용
    max_uses INTEGER DEFAULT 1,                -- 발급 갯수 (single), multi는 0=무제한
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
    is_pinned INTEGER DEFAULT 0,               -- 플랫폼 새소식 상단 고정 여부
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
    origin TEXT,                               -- 구독을 등록한 사이트 출처(origin)
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
DELETE FROM push_subscriptions
 WHERE id NOT IN (
   SELECT MAX(id)
     FROM push_subscriptions
    GROUP BY endpoint
 );
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);

-- 10. 예약 푸시 알림 테이블
CREATE TABLE IF NOT EXISTS push_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,                       -- 알림 제목
    body TEXT NOT NULL,                        -- 알림 본문
    coupon_code TEXT,                          -- 클릭 시 내 정보에 자동 입력할 쿠폰 코드
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
    star INTEGER DEFAULT 0,                     -- 신고된 카드의 별(0~5성)
    reason TEXT NOT NULL,                      -- 신고 사유
    status TEXT DEFAULT 'pending',             -- 처리 상태 ('pending', 'resolved', 'rejected')
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(reporter_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(channel_id) REFERENCES streamers(channel_id) ON DELETE CASCADE
);

-- 스트리머 카드 재등록 금지 목록
CREATE TABLE IF NOT EXISTS streamer_registration_blocks (
    channel_id TEXT PRIMARY KEY,
    reason TEXT NOT NULL,
    blocked_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- 12. 인앱 알림함 테이블
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,                     -- 수신 유저 ID
    title TEXT NOT NULL,                       -- 알림 제목
    body TEXT,                                 -- 알림 본문
    link TEXT,                                 -- 클릭 시 이동할 탭/경로 (예: 'gacha')
    group_key TEXT,                            -- 같은 성격의 알림을 갱신/묶기 위한 키
    is_read INTEGER DEFAULT 0,                 -- 읽음 여부 (0/1)
    deleted_at TEXT,                           -- 알림함에서 숨김 처리한 시각(DB 기록은 유지)
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_group_key ON notifications(user_id, group_key, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_notifications_group_key ON notifications(user_id, group_key);

-- 13. 상점 아이템 (테두리 / 이름 이펙트)
CREATE TABLE IF NOT EXISTS shop_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,                        -- 'border' 또는 'name_effect'
    name TEXT NOT NULL,
    description TEXT,
    price INTEGER NOT NULL DEFAULT 0,
    style_json TEXT,                           -- React 인라인 스타일 객체(JSON 문자열)
    font_url TEXT,                             -- 이름 이펙트용 웹폰트 URL (선택)
    font_family TEXT,                          -- 폰트 패밀리명 (선택)
    active INTEGER DEFAULT 1,                  -- 판매 활성 여부 (0/1)
    purchase_limit INTEGER DEFAULT 0,         -- 1인 최대 구매 갯수 (0 = 무제한)
    listed_at TEXT,                            -- 상점에 활성 등록된 시각
    sale_start_at TEXT,                        -- 한정판매 시작 시각
    sale_end_at TEXT,                          -- 한정판매 종료 시각
    limited_total_quantity INTEGER NOT NULL DEFAULT 0, -- 전체 선착순 판매 수량 (0 = 무제한)
    sold_quantity INTEGER NOT NULL DEFAULT 0,  -- 판매 완료 수량
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_shop_items_active_listed ON shop_items(active, listed_at, id);
CREATE INDEX IF NOT EXISTS idx_shop_items_limited_sale ON shop_items(active, sale_start_at, sale_end_at, limited_total_quantity, sold_quantity);

-- 14. 유저 보유 코스메틱 (미장착 수량)
CREATE TABLE IF NOT EXISTS user_cosmetics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    quantity INTEGER DEFAULT 0,
    UNIQUE(user_id, item_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(item_id) REFERENCES shop_items(id) ON DELETE CASCADE
);

-- 상점 아이템 1인 구매 횟수 (구매 제한 추적)
CREATE TABLE IF NOT EXISTS shop_purchases (
    user_id TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    count INTEGER DEFAULT 0,
    PRIMARY KEY(user_id, item_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(item_id) REFERENCES shop_items(id) ON DELETE CASCADE
);

-- 유저 차단 (blocker_id가 blocked_id에게 받은 교환 제안을 차단)
CREATE TABLE IF NOT EXISTS user_blocks (
    blocker_id TEXT NOT NULL,
    blocked_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY(blocker_id, blocked_id),
    FOREIGN KEY(blocker_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(blocked_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 친구 신청
CREATE TABLE IF NOT EXISTS friend_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    responded_at TEXT,
    FOREIGN KEY(requester_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver ON friend_requests(receiver_id, status, id);
CREATE INDEX IF NOT EXISTS idx_friend_requests_requester ON friend_requests(requester_id, status, id);

-- 친구 관계: user_a_id < user_b_id 정렬쌍
CREATE TABLE IF NOT EXISTS friendships (
    user_a_id TEXT NOT NULL,
    user_b_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY(user_a_id, user_b_id),
    FOREIGN KEY(user_a_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(user_b_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 1:1 채팅방
CREATE TABLE IF NOT EXISTS chat_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_a_id TEXT NOT NULL,
    user_b_id TEXT NOT NULL,
    is_admin_room INTEGER NOT NULL DEFAULT 0,
    closed_at TEXT,
    closed_by_user_id TEXT,
    deleted_for_a INTEGER NOT NULL DEFAULT 0,
    deleted_for_b INTEGER NOT NULL DEFAULT 0,
    hidden_after_a TEXT,
    hidden_after_b TEXT,
    muted_for_a INTEGER NOT NULL DEFAULT 0,
    muted_for_b INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_a_id, user_b_id),
    FOREIGN KEY(user_a_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(user_b_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_user_a ON chat_rooms(user_a_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_user_b ON chat_rooms(user_b_id, updated_at);

-- 1:1 채팅 메시지
CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    sender_id TEXT NOT NULL,
    body TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'text',
    attachment_url TEXT,
    attachment_mime TEXT,
    attachment_size_bytes INTEGER,
    attachment_width INTEGER,
    attachment_height INTEGER,
    attachment_expires_at TEXT,
    attachment_deleted_at TEXT,
    link_preview_json TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    read_at TEXT,
    FOREIGN KEY(room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
    FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id, id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_unread ON chat_messages(room_id, sender_id, read_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_attachment_expiry ON chat_messages(message_type, attachment_expires_at, attachment_deleted_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender_attachments ON chat_messages(sender_id, message_type, attachment_deleted_at, attachment_expires_at);

CREATE TABLE IF NOT EXISTS link_previews (
    url_hash TEXT PRIMARY KEY,
    normalized_url TEXT NOT NULL,
    preview_json TEXT,
    status TEXT NOT NULL DEFAULT 'success',
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_link_previews_expires ON link_previews(expires_at);

-- 15. 시스템 설정 테이블
CREATE TABLE IF NOT EXISTS system_configs (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
INSERT OR IGNORE INTO system_configs (key, value) VALUES ('free_draw_interval', '24');
INSERT OR IGNORE INTO system_configs (key, value) VALUES ('free_draw_max_stack', '1');
INSERT OR IGNORE INTO system_configs (key, value) VALUES ('draw_cost', '10000'); -- 뽑기 1회 기본 비용
INSERT OR IGNORE INTO system_configs (key, value) VALUES ('minigame_ticket_charge_interval_minutes', '240'); -- 미니게임 동전 충전 간격(분)

-- 16. 오픈마켓 매물 테이블
CREATE TABLE IF NOT EXISTS market_listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id TEXT NOT NULL,
    user_card_id INTEGER NOT NULL,
    price INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    listing_type TEXT NOT NULL DEFAULT 'fixed',
    buy_now_price INTEGER,
    starting_bid INTEGER,
    current_bid INTEGER,
    current_bidder_id TEXT,
    auction_ends_at TEXT,
    bid_reserved INTEGER DEFAULT 0,
    buyer_id TEXT,
    fee INTEGER DEFAULT 0,
    fee_rate INTEGER DEFAULT 5,
    settled_amount INTEGER DEFAULT 0,
    with_cosmetics INTEGER DEFAULT 0,
    seller_hidden_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(seller_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(user_card_id) REFERENCES user_cards(id) ON DELETE CASCADE,
    FOREIGN KEY(current_bidder_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY(buyer_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_market_listings_status ON market_listings(status);
CREATE INDEX IF NOT EXISTS idx_market_listings_created ON market_listings(created_at);
CREATE INDEX IF NOT EXISTS idx_market_listings_status_type_created ON market_listings(status, listing_type, created_at, id);
CREATE INDEX IF NOT EXISTS idx_market_listings_participants
    ON market_listings(seller_id, buyer_id, current_bidder_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_listings_pending_card
    ON market_listings(user_card_id)
    WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS market_transaction_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_key TEXT NOT NULL UNIQUE,
    listing_id INTEGER,
    event_type TEXT NOT NULL,
    related_user_id TEXT,
    seller_id TEXT,
    buyer_id TEXT,
    current_bidder_id TEXT,
    user_card_id INTEGER,
    channel_id TEXT,
    serial_number INTEGER,
    star INTEGER,
    price INTEGER,
    status TEXT,
    listing_type TEXT,
    current_bid INTEGER,
    bid_reserved INTEGER,
    fee INTEGER,
    settled_amount INTEGER,
    listing_created_at TEXT,
    listing_updated_at TEXT,
    recorded_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_market_audit_listing ON market_transaction_audit_logs(listing_id, event_type);
CREATE INDEX IF NOT EXISTS idx_market_audit_user ON market_transaction_audit_logs(related_user_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_market_audit_participants ON market_transaction_audit_logs(seller_id, buyer_id, current_bidder_id);

CREATE TABLE IF NOT EXISTS market_bids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL,
    bidder_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(listing_id) REFERENCES market_listings(id) ON DELETE CASCADE,
    FOREIGN KEY(bidder_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS market_watches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    star INTEGER,
    max_price INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, channel_id, star),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(channel_id) REFERENCES streamers(channel_id) ON DELETE CASCADE
);

-- 17. 미니게임 티켓 및 세션 테이블
CREATE TABLE IF NOT EXISTS user_minigame_tickets (
    user_id TEXT PRIMARY KEY,
    current_tickets INTEGER NOT NULL DEFAULT 5,
    bonus_tickets INTEGER NOT NULL DEFAULT 0,
    last_charged_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS minigame_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    game_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'STARTED',
    target_data TEXT,
    ticket_spent_type TEXT DEFAULT 'NONE',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    earned_points INTEGER DEFAULT 0,
    validation_version INTEGER NOT NULL DEFAULT 0,
    progress_data TEXT NOT NULL DEFAULT '{}',
    progress_revision INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    result_data TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

UPDATE minigame_sessions
   SET status = 'EXPIRED',
       completed_at = COALESCE(completed_at, datetime('now'))
 WHERE id IN (
   SELECT id
     FROM (
       SELECT id,
              ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY datetime(created_at) DESC, id DESC) AS rn
         FROM minigame_sessions
        WHERE status = 'STARTED'
          AND ticket_spent_type IN ('BASE', 'BONUS')
     ) ranked_paid_sessions
    WHERE rn > 1
 );

CREATE UNIQUE INDEX IF NOT EXISTS uniq_minigame_sessions_paid_started_user
    ON minigame_sessions(user_id)
 WHERE status = 'STARTED'
   AND ticket_spent_type IN ('BASE', 'BONUS');
CREATE INDEX IF NOT EXISTS idx_minigame_sessions_status_created
    ON minigame_sessions(status, created_at, id);
CREATE INDEX IF NOT EXISTS idx_minigame_sessions_user_game_status_created
    ON minigame_sessions(user_id, game_type, status, created_at DESC);
