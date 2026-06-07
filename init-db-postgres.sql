-- ============================================================
-- 치카포 - Supabase(PostgreSQL) 초기 스키마 구성
-- SQLite 문법과 다른 부분: SERIAL, TIMESTAMP, BOOLEAN 타입 등
-- ============================================================

-- 1. 유저 테이블
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,                         -- 치지직 로그인 UID
    username TEXT NOT NULL,                      -- 치지직 닉네임
    avatar_url TEXT,                             -- 프로필 이미지 URL
    role TEXT DEFAULT 'USER',                    -- 권한 구분 ('USER' 또는 'ADMIN')
    point INTEGER DEFAULT 0,                     -- 보유 재화
    last_free_draw TIMESTAMPTZ,                  -- 마지막 무료 뽑기 일시
    banned_until TIMESTAMPTZ,                    -- 유저 차단 만료 일시 (NULL = 차단 없음)
    ban_reason TEXT,                             -- 유저 차단 사유 (nullable)
    representative_card_channel_id TEXT,         -- 대표 카드로 지정한 스트리머 채널 ID (nullable)
    representative_card_star INTEGER,            -- 대표 카드 별 등급 (nullable, 레거시는 미지정)
    access_token TEXT,                           -- 치지직 OAuth access_token (암호화 저장)
    refresh_token TEXT,                          -- 치지직 OAuth refresh_token (암호화 저장)
    token_expires_at TIMESTAMPTZ,                -- 치지직 access_token 만료 시각
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS titles (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    css TEXT NOT NULL DEFAULT '',
    icon_name TEXT,
    icon_color TEXT NOT NULL DEFAULT '#ffffff',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_titles (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    awarded_at TIMESTAMPTZ DEFAULT NOW(),
    is_equipped BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (user_id, title_id)
);

CREATE INDEX IF NOT EXISTS idx_user_titles_user ON user_titles(user_id);
ALTER TABLE user_titles ADD COLUMN IF NOT EXISTS is_equipped BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_titles_equipped ON user_titles(user_id) WHERE is_equipped = TRUE;

-- 2. 스트리머 테이블
CREATE TABLE IF NOT EXISTS streamers (
    channel_id TEXT PRIMARY KEY,                 -- 치지직 채널 고유 ID
    name TEXT NOT NULL,                          -- 스트리머 활동명
    logo_url TEXT,                               -- 치지직 기본 프로필 로고 URL
    custom_image_url TEXT,                       -- 커스텀 이미지 URL (0성, NULL 가능)
    custom_image_url_1 TEXT,                      -- 1성 커스텀 카드 이미지
    custom_image_url_2 TEXT,                      -- 2성 커스텀 카드 이미지
    custom_image_url_3 TEXT,                      -- 3성 커스텀 카드 이미지
    custom_image_url_4 TEXT,                      -- 4성 커스텀 카드 이미지
    custom_image_url_5 TEXT,                      -- 5성 커스텀 카드 이미지
    is_image_banned BOOLEAN DEFAULT FALSE,       -- 커스텀 이미지 업로드 권한 차단 여부
    follower_count INTEGER DEFAULT 0,            -- 실시간 팔로워 수
    activity_score INTEGER DEFAULT 0,            -- 활동 지표 환산 점수
    base_value INTEGER DEFAULT 1000,             -- 현재 환산 시세 (재화 기준)
    is_active BOOLEAN DEFAULT FALSE,             -- 현재 방송 중 여부
    broadcast_count INTEGER DEFAULT 0,            -- 방송 켠 횟수
    broadcast_minutes INTEGER DEFAULT 0,          -- 누적 방송 시간(분)
    chat_count INTEGER DEFAULT 0,                 -- 실시간 채팅 누적 갯수
    broadcast_multiplier DOUBLE PRECISION DEFAULT 1.0, -- 실시간 방송 감가 배율 (0.2 ~ 1.2)
    prev_value INTEGER DEFAULT 1000,              -- 이전 환산 시세 (등락률 계산용)
    registered_by TEXT,                           -- 카드를 등록한 유저의 ID (nullable)
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 상점 아이템 (기존 13번 테이블)
-- user_cards가 shop_items를 외래키로 참조하므로 먼저 생성합니다.
CREATE TABLE IF NOT EXISTS shop_items (
    id SERIAL PRIMARY KEY,
    type TEXT NOT NULL,                          -- 'border' 또는 'name_effect'
    name TEXT NOT NULL,
    description TEXT,
    price INTEGER NOT NULL DEFAULT 0,
    style_json TEXT,                             -- React 인라인 스타일 객체(JSON 문자열)
    font_url TEXT,                               -- 이름 이펙트용 웹폰트 URL (선택)
    font_family TEXT,                            -- 폰트 패밀리명 (선택)
    active BOOLEAN DEFAULT TRUE,
    purchase_limit INTEGER DEFAULT 0,            -- 1인 최대 구매 갯수 (0 = 무제한)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 유저 보유 카드 매핑 테이블
CREATE TABLE IF NOT EXISTS user_cards (
    id SERIAL PRIMARY KEY,                       -- 자동 증가 고유 ID
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES streamers(channel_id) ON DELETE CASCADE,
    serial_number INTEGER NOT NULL,              -- 발행 일련번호
    star INTEGER DEFAULT 0,                       -- 합성 별 등급 (0~5)
    border_item_id INTEGER REFERENCES shop_items(id) ON DELETE SET NULL,
    name_effect_item_id INTEGER REFERENCES shop_items(id) ON DELETE SET NULL,
    acquired_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 1:1 교환 제안 테이블
CREATE TABLE IF NOT EXISTS trades (
    id SERIAL PRIMARY KEY,
    sender_id TEXT NOT NULL REFERENCES users(id),
    receiver_id TEXT NOT NULL REFERENCES users(id),
    sender_offer JSONB NOT NULL,                 -- { cards: [], point: 0 }
    receiver_offer JSONB NOT NULL,               -- { cards: [], point: 0 }
    status TEXT DEFAULT 'PENDING',               -- 'PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- 5. 스트리머 시세 히스토리 테이블
CREATE TABLE IF NOT EXISTS value_history (
    id SERIAL PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES streamers(channel_id) ON DELETE CASCADE,
    value INTEGER NOT NULL,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. 쿠폰 테이블
CREATE TABLE IF NOT EXISTS coupons (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    coupon_type TEXT NOT NULL,                   -- 'single' 또는 'multi'
    reward_type TEXT NOT NULL DEFAULT 'point',   -- 'point'(재화), 'card'(스트리머 카드), 'cosmetic'(코스메틱), 'minigame_ticket'(추가 미니게임 티켓)
    points INTEGER NOT NULL DEFAULT 0,           -- reward_type='point' 지급 재화
    reward_channel_id TEXT,                      -- reward_type='card' 지급 스트리머 채널 ID
    reward_item_id INTEGER,                      -- reward_type='cosmetic' 지급 상점 아이템 ID
    reward_quantity INTEGER DEFAULT 0,           -- card/cosmetic/minigame_ticket 지급 수량
    max_uses INTEGER DEFAULT 1,                  -- 발급 갯수(single), multi는 0=무제한
    used_count INTEGER DEFAULT 0,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. 쿠폰 사용 로그 테이블
CREATE TABLE IF NOT EXISTS coupon_logs (
    id SERIAL PRIMARY KEY,
    coupon_id INTEGER NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redeemed_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(coupon_id, user_id)                   -- 1인 1회 제한
);

-- 8. 공지사항 및 팝업 테이블
CREATE TABLE IF NOT EXISTS announcements (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    is_popup BOOLEAN DEFAULT FALSE,
    is_pinned BOOLEAN DEFAULT FALSE,
    popup_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. PWA 푸시 구독 정보 테이블
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    auth_key TEXT NOT NULL,
    p256dh_key TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, endpoint)
);

-- 10. 예약 푸시 알림 테이블
CREATE TABLE IF NOT EXISTS push_notifications (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    coupon_code TEXT,
    status TEXT DEFAULT 'pending',               -- 'pending', 'sent'
    scheduled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE push_notifications ADD COLUMN IF NOT EXISTS coupon_code TEXT;

-- 11. 카드 신고 내역 테이블
CREATE TABLE IF NOT EXISTS card_reports (
    id SERIAL PRIMARY KEY,
    reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES streamers(channel_id) ON DELETE CASCADE,
    reported_image_url TEXT NOT NULL,
    star INTEGER DEFAULT 0,                       -- 신고된 카드의 별(0~5성)
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'pending',               -- 'pending', 'resolved', 'rejected'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. 인앱 알림함 테이블
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT,
    link TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);

-- 14. 유저 보유 코스메틱 (미장착 수량)
CREATE TABLE IF NOT EXISTS user_cosmetics (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
    quantity INTEGER DEFAULT 0,
    UNIQUE(user_id, item_id)
);

-- 상점 아이템 1인 구매 횟수 (구매 제한 추적)
CREATE TABLE IF NOT EXISTS shop_purchases (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
    count INTEGER DEFAULT 0,
    PRIMARY KEY(user_id, item_id)
);

-- 15. 미니게임 티켓 및 세션
CREATE TABLE IF NOT EXISTS user_minigame_tickets (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    current_tickets INTEGER NOT NULL DEFAULT 5,  -- 자동 충전되는 기본 티켓(최대 5장)
    bonus_tickets INTEGER NOT NULL DEFAULT 0,    -- 쿠폰 등으로 지급되는 초과 티켓(먼저 소모)
    last_charged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS minigame_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'STARTED',
    target_data TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    earned_points INTEGER DEFAULT 0
);

-- 유저 차단 (blocker_id가 blocked_id에게 받은 교환 제안을 차단)
CREATE TABLE IF NOT EXISTS user_blocks (
    blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY(blocker_id, blocked_id)
);

-- ============================================================
-- 기존 배포 호환: 신규 컬럼 멱등 추가 (CREATE TABLE IF NOT EXISTS는 컬럼을 추가하지 않으므로 필요)
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS representative_card_channel_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS representative_card_star INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS access_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS refresh_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;
ALTER TABLE streamers ADD COLUMN IF NOT EXISTS broadcast_minutes INTEGER DEFAULT 0;
ALTER TABLE streamers ADD COLUMN IF NOT EXISTS custom_image_url_1 TEXT;
ALTER TABLE streamers ADD COLUMN IF NOT EXISTS custom_image_url_2 TEXT;
ALTER TABLE streamers ADD COLUMN IF NOT EXISTS custom_image_url_3 TEXT;
ALTER TABLE streamers ADD COLUMN IF NOT EXISTS custom_image_url_4 TEXT;
ALTER TABLE streamers ADD COLUMN IF NOT EXISTS custom_image_url_5 TEXT;
ALTER TABLE streamers ADD COLUMN IF NOT EXISTS registered_by TEXT;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS reward_type TEXT NOT NULL DEFAULT 'point';
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS reward_channel_id TEXT;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS reward_item_id INTEGER;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS reward_quantity INTEGER DEFAULT 0;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS purchase_limit INTEGER DEFAULT 0;
ALTER TABLE shop_items ALTER COLUMN style_json TYPE TEXT;
ALTER TABLE user_cards ADD COLUMN IF NOT EXISTS star INTEGER DEFAULT 0;
ALTER TABLE user_cards ADD COLUMN IF NOT EXISTS border_item_id INTEGER;
ALTER TABLE user_cards ADD COLUMN IF NOT EXISTS name_effect_item_id INTEGER;
ALTER TABLE user_minigame_tickets ADD COLUMN IF NOT EXISTS bonus_tickets INTEGER NOT NULL DEFAULT 0;

-- 하위 호환성 유지: user_cards 테이블에 코스메틱 외래키 제약조건 추가
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE table_name = 'user_cards' 
          AND constraint_name = 'user_cards_border_item_id_fkey'
    ) THEN
        ALTER TABLE user_cards 
        ADD CONSTRAINT user_cards_border_item_id_fkey 
        FOREIGN KEY (border_item_id) REFERENCES shop_items(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE table_name = 'user_cards' 
          AND constraint_name = 'user_cards_name_effect_item_id_fkey'
    ) THEN
        ALTER TABLE user_cards 
        ADD CONSTRAINT user_cards_name_effect_item_id_fkey 
        FOREIGN KEY (name_effect_item_id) REFERENCES shop_items(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ============================================================
-- 인덱스 설정 (자주 조회되는 컬럼 최적화)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_user_cards_user_id ON user_cards(user_id);
CREATE INDEX IF NOT EXISTS idx_user_cards_channel_id ON user_cards(channel_id);
CREATE INDEX IF NOT EXISTS idx_trades_sender_id ON trades(sender_id);
CREATE INDEX IF NOT EXISTS idx_trades_receiver_id ON trades(receiver_id);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_value_history_channel_id ON value_history(channel_id);
CREATE INDEX IF NOT EXISTS idx_value_history_recorded_at ON value_history(recorded_at);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_card_reports_status ON card_reports(status);

CREATE TABLE IF NOT EXISTS system_configs (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- ============================================================
-- 원자적 연산을 위한 RPC 함수 (동시성 안전성 보장)
-- 백엔드 SupabaseRepository에서 .rpc()로 호출합니다.
-- ============================================================

-- 포인트 원자적 증감 (delta 음수 가능)
CREATE OR REPLACE FUNCTION increment_user_point(p_id TEXT, p_delta INTEGER)
RETURNS VOID AS $$
  UPDATE users SET point = point + p_delta WHERE id = p_id;
$$ LANGUAGE sql;

-- 잔액이 충분할 때만 차감 (성공 시 TRUE, 부족 시 FALSE)
CREATE OR REPLACE FUNCTION deduct_user_point(p_id TEXT, p_amount INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
  updated INTEGER;
BEGIN
  UPDATE users SET point = point - p_amount
   WHERE id = p_id AND point >= p_amount;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$$ LANGUAGE plpgsql;

-- 미니게임 보너스 티켓 지급: 기본 티켓은 5장으로 초기화하고, 보너스 티켓은 상한 없이 누적
CREATE OR REPLACE FUNCTION add_minigame_bonus_tickets(p_user_id TEXT, p_amount INTEGER)
RETURNS user_minigame_tickets AS $$
DECLARE
  ticket user_minigame_tickets%ROWTYPE;
  qty INTEGER := GREATEST(COALESCE(p_amount, 0), 0);
BEGIN
  INSERT INTO user_minigame_tickets (user_id, current_tickets, bonus_tickets, last_charged_at, updated_at)
  VALUES (p_user_id, 5, qty, NOW(), NOW())
  ON CONFLICT (user_id)
  DO UPDATE SET
    bonus_tickets = user_minigame_tickets.bonus_tickets + EXCLUDED.bonus_tickets,
    updated_at = NOW()
  RETURNING * INTO ticket;

  RETURN ticket;
END;
$$ LANGUAGE plpgsql;

-- 미니게임 세션 시작: 보너스 티켓을 먼저 차감하고, 없을 때 기본 충전 티켓을 차감
CREATE OR REPLACE FUNCTION start_minigame_session_atomic(
  p_session_id TEXT,
  p_user_id TEXT,
  p_game_type TEXT,
  p_target_data TEXT
)
RETURNS TEXT AS $$
DECLARE
  ticket user_minigame_tickets%ROWTYPE;
BEGIN
  INSERT INTO user_minigame_tickets (user_id, current_tickets, bonus_tickets, last_charged_at, updated_at)
  VALUES (p_user_id, 5, 0, NOW(), NOW())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO ticket
    FROM user_minigame_tickets
   WHERE user_id = p_user_id
   FOR UPDATE;

  IF COALESCE(ticket.bonus_tickets, 0) + COALESCE(ticket.current_tickets, 0) <= 0 THEN
    RETURN 'NO_TICKET';
  END IF;

  IF COALESCE(ticket.bonus_tickets, 0) > 0 THEN
    UPDATE user_minigame_tickets
       SET bonus_tickets = bonus_tickets - 1,
           updated_at = NOW()
     WHERE user_id = p_user_id;
  ELSE
    UPDATE user_minigame_tickets
       SET current_tickets = current_tickets - 1,
           updated_at = NOW()
     WHERE user_id = p_user_id;
  END IF;

  INSERT INTO minigame_sessions (id, user_id, game_type, status, target_data, created_at)
  VALUES (p_session_id, p_user_id, p_game_type, 'STARTED', p_target_data, NOW());

  RETURN 'OK';
END;
$$ LANGUAGE plpgsql;

-- 무료 뽑기: 마지막 무료뽑기가 세그먼트 시작 이전일 때만 갱신 (p_segment_start가 NULL이면 무제한 무료뽑기)
CREATE OR REPLACE FUNCTION claim_free_draw(p_id TEXT, p_now TIMESTAMPTZ, p_segment_start TIMESTAMPTZ)
RETURNS BOOLEAN AS $$
DECLARE
  updated INTEGER;
BEGIN
  UPDATE users SET last_free_draw = p_now
   WHERE id = p_id
     AND (p_segment_start IS NULL
          OR last_free_draw IS NULL
          OR last_free_draw < p_segment_start);
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$$ LANGUAGE plpgsql;

-- 스트리머 방송 횟수 원자적 증가
CREATE OR REPLACE FUNCTION increment_streamer_broadcast(p_channel_id TEXT)
RETURNS VOID AS $$
  UPDATE streamers SET broadcast_count = broadcast_count + 1, updated_at = NOW()
   WHERE channel_id = p_channel_id;
$$ LANGUAGE sql;

-- 스트리머 채팅 카운트 원자적 증가
CREATE OR REPLACE FUNCTION increment_streamer_chat(p_channel_id TEXT, p_count INTEGER)
RETURNS VOID AS $$
  UPDATE streamers SET chat_count = chat_count + p_count, updated_at = NOW()
   WHERE channel_id = p_channel_id;
$$ LANGUAGE sql;

-- 스트리머 채팅 카운트 원자적 차감 (0 하한)
CREATE OR REPLACE FUNCTION decrement_streamer_chat(p_channel_id TEXT, p_amount INTEGER)
RETURNS VOID AS $$
  UPDATE streamers SET chat_count = GREATEST(chat_count - p_amount, 0), updated_at = NOW()
   WHERE channel_id = p_channel_id;
$$ LANGUAGE sql;

-- 스트리머 누적 방송 시간(분) 원자적 증가
CREATE OR REPLACE FUNCTION increment_streamer_minutes(p_channel_id TEXT, p_minutes INTEGER)
RETURNS VOID AS $$
  UPDATE streamers SET broadcast_minutes = broadcast_minutes + p_minutes, updated_at = NOW()
   WHERE channel_id = p_channel_id;
$$ LANGUAGE sql;

-- 스케줄러 1주기 계산 결과를 단일 호출로 일괄 반영 (네트워크 왕복 최소화)
-- p_updates: StreamerScheduleResult[] 형태의 JSONB 배열
--   { channel_id, prev_value, base_value, activity_score, broadcast_multiplier,
--     add_minutes, add_broadcast_count, consumed_chats, polled, is_active, follower_count }
-- chat_count는 GREATEST(chat_count - consumed_chats, 0)로 상대 차감하여 집계 도중 유입분 보존.
-- is_active/follower_count는 polled=true(이번 주기 HTTP 폴링)인 경우에만 갱신.
CREATE OR REPLACE FUNCTION bulk_apply_streamer_schedule(p_updates JSONB)
RETURNS VOID AS $$
DECLARE
  u JSONB;
BEGIN
  FOR u IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    UPDATE streamers SET
      prev_value           = (u->>'prev_value')::INTEGER,
      base_value           = (u->>'base_value')::INTEGER,
      activity_score       = (u->>'activity_score')::INTEGER,
      broadcast_multiplier = (u->>'broadcast_multiplier')::REAL,
      broadcast_minutes    = broadcast_minutes + COALESCE((u->>'add_minutes')::INTEGER, 0),
      broadcast_count      = broadcast_count + COALESCE((u->>'add_broadcast_count')::INTEGER, 0),
      chat_count           = GREATEST(chat_count - COALESCE((u->>'consumed_chats')::INTEGER, 0), 0),
      is_active            = CASE WHEN COALESCE((u->>'polled')::BOOLEAN, FALSE)
                                  THEN (u->>'is_active')::BOOLEAN ELSE is_active END,
      follower_count       = CASE WHEN COALESCE((u->>'polled')::BOOLEAN, FALSE)
                                  THEN (u->>'follower_count')::INTEGER ELSE follower_count END,
      logo_url             = CASE WHEN COALESCE((u->>'polled')::BOOLEAN, FALSE)
                                  THEN COALESCE(u->>'logo_url', logo_url) ELSE logo_url END,
      updated_at           = NOW()
    WHERE channel_id = u->>'channel_id';
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 1:1 교환 2단계 원자적 체결(제안자 최종 승인): 카드/포인트 양방향 이전을 단일 트랜잭션으로 수행
-- 반환: 'OK' | 'NOT_FOUND' | 'NOT_CONFIRMED' | 'FORBIDDEN' | 'CARD_SHORTAGE'
--       | 'SENDER_POINT_SHORT' | 'RECEIVER_POINT_SHORT' | 'FAILED:<msg>'
CREATE OR REPLACE FUNCTION finalize_trade(p_trade_id INTEGER, p_actor TEXT)
RETURNS TEXT AS $$
DECLARE
  t            trades%ROWTYPE;
  item         JSONB;
  cid          TEXT;
  cnt          INTEGER;
  star_val     INTEGER;
  moved        INTEGER;
  sender_out   INTEGER;
  receiver_out INTEGER;
  s_point      INTEGER;
  r_point      INTEGER;
BEGIN
  SELECT * INTO t FROM trades WHERE id = p_trade_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  IF t.status <> 'CONFIRMED' THEN RETURN 'NOT_CONFIRMED'; END IF;
  IF t.sender_id <> p_actor THEN RETURN 'FORBIDDEN'; END IF;

  sender_out   := COALESCE((t.sender_offer->>'point')::INTEGER, 0);
  receiver_out := COALESCE((t.receiver_offer->>'point')::INTEGER, 0);

  -- 포인트 잔액 검증
  SELECT point INTO s_point FROM users WHERE id = t.sender_id FOR UPDATE;
  SELECT point INTO r_point FROM users WHERE id = t.receiver_id FOR UPDATE;
  IF s_point < sender_out THEN RETURN 'SENDER_POINT_SHORT'; END IF;
  IF r_point < receiver_out THEN RETURN 'RECEIVER_POINT_SHORT'; END IF;

  -- 보낸 사람 카드 → 받는 사람 (별 지정 시 해당 별만)
  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(t.sender_offer->'cards', '[]'::jsonb)) LOOP
    cid := item->>'channel_id';
    cnt := (item->>'count')::INTEGER;
    star_val := (item->>'star')::INTEGER;
    IF cnt IS NULL OR cnt <= 0 THEN CONTINUE; END IF;
    UPDATE user_cards SET user_id = t.receiver_id
     WHERE id IN (
       SELECT id FROM user_cards
        WHERE user_id = t.sender_id AND channel_id = cid
          AND (star_val IS NULL OR star = star_val)
        ORDER BY id ASC LIMIT cnt FOR UPDATE
     );
    GET DIAGNOSTICS moved = ROW_COUNT;
    IF moved < cnt THEN RAISE EXCEPTION 'CARD_SHORTAGE'; END IF;
  END LOOP;

  -- 받는 사람 카드 → 보낸 사람 (별 지정 시 해당 별만)
  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(t.receiver_offer->'cards', '[]'::jsonb)) LOOP
    cid := item->>'channel_id';
    cnt := (item->>'count')::INTEGER;
    star_val := (item->>'star')::INTEGER;
    IF cnt IS NULL OR cnt <= 0 THEN CONTINUE; END IF;
    UPDATE user_cards SET user_id = t.sender_id
     WHERE id IN (
       SELECT id FROM user_cards
        WHERE user_id = t.receiver_id AND channel_id = cid
          AND (star_val IS NULL OR star = star_val)
        ORDER BY id ASC LIMIT cnt FOR UPDATE
     );
    GET DIAGNOSTICS moved = ROW_COUNT;
    IF moved < cnt THEN RAISE EXCEPTION 'CARD_SHORTAGE'; END IF;
  END LOOP;

  -- 포인트 정산 (양방향)
  UPDATE users SET point = point - sender_out + receiver_out WHERE id = t.sender_id;
  UPDATE users SET point = point - receiver_out + sender_out WHERE id = t.receiver_id;

  UPDATE trades SET status = 'ACCEPTED', completed_at = NOW() WHERE id = p_trade_id;
  RETURN 'OK';
EXCEPTION
  WHEN OTHERS THEN
    RETURN 'FAILED:' || SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- 카드 판매: 삭제 대상 카드의 별 배율을 반영해 포인트 지급까지 단일 트랜잭션으로 처리
CREATE OR REPLACE FUNCTION sell_cards_atomic(p_user_id TEXT, p_actions JSONB)
RETURNS INTEGER AS $$
DECLARE
  a JSONB;
  cid TEXT;
  card_star INTEGER;
  cnt INTEGER;
  base_value INTEGER;
  picked_ids INTEGER[];
  picked_count INTEGER;
  gained INTEGER;
  total INTEGER := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('sell_cards:' || p_user_id));

  FOR a IN SELECT * FROM jsonb_array_elements(p_actions)
  LOOP
    cid := a->>'channel_id';
    card_star := COALESCE((a->>'star')::INTEGER, 0);
    cnt := (a->>'count')::INTEGER;
    base_value := (a->>'base_value')::INTEGER;
    IF cid IS NULL OR cnt IS NULL OR cnt <= 0 THEN CONTINUE; END IF;

    SELECT
      ARRAY_AGG(id),
      COUNT(*),
      COALESCE(SUM(ROUND(base_value * (1 + COALESCE(star, 0) * 0.8))::INTEGER), 0)
    INTO picked_ids, picked_count, gained
    FROM (
      SELECT id, star
        FROM user_cards
       WHERE user_id = p_user_id
         AND channel_id = cid
         AND COALESCE(star, 0) = card_star
         AND NOT EXISTS (
           SELECT 1
             FROM market_listings ml
            WHERE ml.user_card_id = user_cards.id
              AND ml.status = 'PENDING'
         )
       ORDER BY id ASC
       LIMIT cnt
       FOR UPDATE
    ) picked;

    IF picked_count < cnt THEN
      RAISE EXCEPTION 'CARD_SHORTAGE';
    END IF;

    DELETE FROM user_cards WHERE id = ANY(picked_ids);
    total := total + gained;
  END LOOP;

  IF total > 0 THEN
    UPDATE users SET point = point + total WHERE id = p_user_id;
  END IF;

  RETURN total;
END;
$$ LANGUAGE plpgsql;

-- 카드 합성: 대상 카드 별 상승과 0성 재료 소모를 단일 트랜잭션으로 처리
CREATE OR REPLACE FUNCTION fuse_card_atomic(p_user_id TEXT, p_channel_id TEXT, p_star INTEGER)
RETURNS TEXT AS $$
DECLARE
  target_id INTEGER;
  fodder_id INTEGER;
BEGIN
  IF p_star >= 5 THEN RETURN 'MAX_STAR'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('fuse_card:' || p_user_id || ':' || p_channel_id));

  SELECT id INTO target_id
    FROM user_cards
   WHERE user_id = p_user_id AND channel_id = p_channel_id AND COALESCE(star, 0) = p_star
     AND NOT EXISTS (
       SELECT 1 FROM market_listings ml
        WHERE ml.user_card_id = user_cards.id AND ml.status = 'PENDING'
     )
   ORDER BY id ASC
   LIMIT 1
   FOR UPDATE;
  IF target_id IS NULL THEN RETURN 'NO_TARGET'; END IF;

  SELECT id INTO fodder_id
    FROM user_cards
   WHERE user_id = p_user_id AND channel_id = p_channel_id AND COALESCE(star, 0) = 0 AND id <> target_id
     AND NOT EXISTS (
       SELECT 1 FROM market_listings ml
        WHERE ml.user_card_id = user_cards.id AND ml.status = 'PENDING'
     )
   ORDER BY id ASC
   LIMIT 1
   FOR UPDATE;
  IF fodder_id IS NULL THEN RETURN 'NO_FODDER'; END IF;

  UPDATE user_cards SET star = p_star + 1 WHERE id = target_id;
  DELETE FROM user_cards WHERE id = fodder_id;
  RETURN 'OK';
END;
$$ LANGUAGE plpgsql;

-- 상점 구매: 포인트 차감, 보유 수량 증가, 구매 제한 카운트를 단일 트랜잭션으로 처리
CREATE OR REPLACE FUNCTION buy_shop_item_atomic(p_user_id TEXT, p_item_id INTEGER)
RETURNS TEXT AS $$
DECLARE
  item shop_items%ROWTYPE;
  bought INTEGER;
  updated INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('buy_shop_item:' || p_user_id || ':' || p_item_id::TEXT));

  SELECT * INTO item FROM shop_items WHERE id = p_item_id AND active = TRUE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;

  IF item.purchase_limit > 0 THEN
    SELECT COALESCE(count, 0) INTO bought FROM shop_purchases WHERE user_id = p_user_id AND item_id = p_item_id;
    IF COALESCE(bought, 0) >= item.purchase_limit THEN RETURN 'LIMIT_REACHED'; END IF;
  END IF;

  UPDATE users SET point = point - item.price
   WHERE id = p_user_id AND point >= item.price;
  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated = 0 THEN RETURN 'INSUFFICIENT_POINT'; END IF;

  INSERT INTO user_cosmetics (user_id, item_id, quantity)
  VALUES (p_user_id, p_item_id, 1)
  ON CONFLICT (user_id, item_id)
  DO UPDATE SET quantity = user_cosmetics.quantity + 1;

  IF item.purchase_limit > 0 THEN
    INSERT INTO shop_purchases (user_id, item_id, count)
    VALUES (p_user_id, p_item_id, 1)
    ON CONFLICT (user_id, item_id)
    DO UPDATE SET count = shop_purchases.count + 1;
  END IF;

  RETURN 'OK';
END;
$$ LANGUAGE plpgsql;

-- 코스메틱 장착: 보유 수량, 기존 장착 반환, 카드 슬롯 갱신을 단일 트랜잭션으로 처리
CREATE OR REPLACE FUNCTION equip_cosmetic_atomic(p_user_id TEXT, p_card_id INTEGER, p_item_id INTEGER)
RETURNS TEXT AS $$
DECLARE
  item shop_items%ROWTYPE;
  current_item INTEGER;
  available INTEGER;
  slot_col TEXT;
BEGIN
  SELECT * INTO item FROM shop_items WHERE id = p_item_id;
  IF NOT FOUND THEN RETURN 'ITEM_NOT_FOUND'; END IF;

  slot_col := CASE WHEN item.type = 'border' THEN 'border_item_id' ELSE 'name_effect_item_id' END;
  PERFORM pg_advisory_xact_lock(hashtext('equip_cosmetic:' || p_user_id || ':' || p_card_id::TEXT || ':' || item.type));

  IF item.type = 'border' THEN
    SELECT border_item_id INTO current_item FROM user_cards WHERE id = p_card_id AND user_id = p_user_id FOR UPDATE;
  ELSE
    SELECT name_effect_item_id INTO current_item FROM user_cards WHERE id = p_card_id AND user_id = p_user_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RETURN 'CARD_NOT_FOUND'; END IF;
  IF current_item = p_item_id THEN RETURN 'OK'; END IF;

  SELECT COALESCE(quantity, 0) INTO available
    FROM user_cosmetics
   WHERE user_id = p_user_id AND item_id = p_item_id
   FOR UPDATE;
  IF COALESCE(available, 0) < 1 THEN RETURN 'NOT_OWNED'; END IF;

  IF current_item IS NOT NULL THEN
    INSERT INTO user_cosmetics (user_id, item_id, quantity)
    VALUES (p_user_id, current_item, 1)
    ON CONFLICT (user_id, item_id)
    DO UPDATE SET quantity = user_cosmetics.quantity + 1;
  END IF;

  UPDATE user_cosmetics SET quantity = GREATEST(quantity - 1, 0)
   WHERE user_id = p_user_id AND item_id = p_item_id;

  IF item.type = 'border' THEN
    UPDATE user_cards SET border_item_id = p_item_id WHERE id = p_card_id AND user_id = p_user_id;
  ELSE
    UPDATE user_cards SET name_effect_item_id = p_item_id WHERE id = p_card_id AND user_id = p_user_id;
  END IF;

  RETURN 'OK';
END;
$$ LANGUAGE plpgsql;

-- 코스메틱 해제: 카드 슬롯 초기화와 보유 수량 반환을 단일 트랜잭션으로 처리
CREATE OR REPLACE FUNCTION unequip_cosmetic_atomic(p_user_id TEXT, p_card_id INTEGER, p_type TEXT)
RETURNS TEXT AS $$
DECLARE
  current_item INTEGER;
BEGIN
  IF p_type NOT IN ('border', 'name_effect') THEN RETURN 'INVALID_TYPE'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('equip_cosmetic:' || p_user_id || ':' || p_card_id::TEXT || ':' || p_type));

  IF p_type = 'border' THEN
    SELECT border_item_id INTO current_item FROM user_cards WHERE id = p_card_id AND user_id = p_user_id FOR UPDATE;
  ELSE
    SELECT name_effect_item_id INTO current_item FROM user_cards WHERE id = p_card_id AND user_id = p_user_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RETURN 'CARD_NOT_FOUND'; END IF;
  IF current_item IS NULL THEN RETURN 'OK'; END IF;

  INSERT INTO user_cosmetics (user_id, item_id, quantity)
  VALUES (p_user_id, current_item, 1)
  ON CONFLICT (user_id, item_id)
  DO UPDATE SET quantity = user_cosmetics.quantity + 1;

  IF p_type = 'border' THEN
    UPDATE user_cards SET border_item_id = NULL WHERE id = p_card_id AND user_id = p_user_id;
  ELSE
    UPDATE user_cards SET name_effect_item_id = NULL WHERE id = p_card_id AND user_id = p_user_id;
  END IF;

  RETURN 'OK';
END;
$$ LANGUAGE plpgsql;

-- 유저 랭킹: (포인트 + 보유 카드 시세 합산) 총자산 기준 정렬
CREATE OR REPLACE FUNCTION get_user_rankings(p_limit INTEGER)
RETURNS TABLE (
  id TEXT, username TEXT, avatar_url TEXT, role TEXT, point INTEGER,
  last_free_draw TIMESTAMPTZ, banned_until TIMESTAMPTZ, created_at TIMESTAMPTZ,
  card_count BIGINT, total_asset BIGINT
) AS $$
  -- 카드 가치는 별(0~5성) 배수(1 + star*0.8)를 반영하여 합산
  SELECT u.id, u.username, u.avatar_url, u.role, u.point,
         u.last_free_draw, u.banned_until, u.created_at,
         COUNT(uc.id) AS card_count,
         (u.point + COALESCE(SUM(s.base_value * (1 + COALESCE(uc.star, 0) * 0.8)), 0))::BIGINT AS total_asset
    FROM users u
    LEFT JOIN user_cards uc ON uc.user_id = u.id
    LEFT JOIN streamers s ON s.channel_id = uc.channel_id
   GROUP BY u.id
   ORDER BY total_asset DESC
   LIMIT p_limit;
$$ LANGUAGE sql;

-- [추가] 검색어 대응 및 전체 랭킹 인덱스(rank)를 포함하는 오버로딩 유저 랭킹 RPC
CREATE OR REPLACE FUNCTION get_user_rankings(p_limit INTEGER, p_keyword TEXT)
RETURNS TABLE (
  id TEXT, username TEXT, avatar_url TEXT, role TEXT, point INTEGER,
  last_free_draw TIMESTAMPTZ, banned_until TIMESTAMPTZ, created_at TIMESTAMPTZ,
  card_count BIGINT, total_asset BIGINT, rank BIGINT
) AS $$
  WITH RankedUsers AS (
    SELECT u.id, u.username, u.avatar_url, u.role, u.point,
           u.last_free_draw, u.banned_until, u.created_at,
           COUNT(uc.id) AS card_count,
           (u.point + COALESCE(SUM(s.base_value * (1 + COALESCE(uc.star, 0) * 0.8)), 0))::BIGINT AS total_asset,
           ROW_NUMBER() OVER (
             ORDER BY (u.point + COALESCE(SUM(s.base_value * (1 + COALESCE(uc.star, 0) * 0.8)), 0)) DESC
           )::BIGINT AS rank
      FROM users u
      LEFT JOIN user_cards uc ON uc.user_id = u.id
      LEFT JOIN streamers s ON s.channel_id = uc.channel_id
     GROUP BY u.id
  )
  SELECT * FROM RankedUsers
   WHERE (p_keyword = '' OR username ILIKE '%' || p_keyword || '%')
   ORDER BY total_asset DESC
   LIMIT p_limit;
$$ LANGUAGE sql;

-- 여러 백엔드 인스턴스에서 동일 스케줄러가 중복 실행되지 않도록 system_configs를 lease 저장소로 사용
CREATE OR REPLACE FUNCTION try_acquire_scheduler_lock(p_key TEXT, p_token TEXT, p_expires_at TIMESTAMPTZ)
RETURNS BOOLEAN AS $$
DECLARE
  current_value JSONB;
  current_token TEXT;
  current_expires TIMESTAMPTZ;
BEGIN
  INSERT INTO system_configs (key, value)
  VALUES (p_key, jsonb_build_object('token', p_token, 'expiresAt', p_expires_at)::TEXT)
  ON CONFLICT (key) DO NOTHING;

  SELECT CASE
           WHEN NULLIF(value, '') IS NULL THEN '{}'::JSONB
           ELSE value::JSONB
         END
    INTO current_value
    FROM system_configs
   WHERE key = p_key
   FOR UPDATE;

  current_token := current_value->>'token';
  current_expires := NULLIF(current_value->>'expiresAt', '')::TIMESTAMPTZ;

  IF current_token IS NOT NULL AND current_token <> p_token AND current_expires > NOW() THEN
    RETURN FALSE;
  END IF;

  UPDATE system_configs
     SET value = jsonb_build_object('token', p_token, 'expiresAt', p_expires_at)::TEXT
   WHERE key = p_key;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 뽑기: 무료권/포인트 차감, 시리얼 채번, 카드 생성을 단일 트랜잭션으로 처리
CREATE OR REPLACE FUNCTION draw_card_atomic(
  p_user_id TEXT,
  p_channel_id TEXT,
  p_draw_cost INTEGER,
  p_now TIMESTAMPTZ,
  p_segment_start TIMESTAMPTZ
)
RETURNS TABLE (
  ok BOOLEAN,
  reason TEXT,
  card_id INTEGER,
  serial_number INTEGER,
  is_free BOOLEAN,
  points_left INTEGER
) AS $$
DECLARE
  u users%ROWTYPE;
  free_draw BOOLEAN;
  next_serial INTEGER;
  new_card_id INTEGER;
BEGIN
  SELECT * INTO u FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'USER_NOT_FOUND', NULL::INTEGER, NULL::INTEGER, FALSE, NULL::INTEGER;
    RETURN;
  END IF;

  free_draw := p_segment_start IS NULL OR u.last_free_draw IS NULL OR u.last_free_draw < p_segment_start;
  IF free_draw THEN
    UPDATE users SET last_free_draw = p_now WHERE id = p_user_id;
  ELSE
    IF u.point < p_draw_cost THEN
      RETURN QUERY SELECT FALSE, 'INSUFFICIENT_POINT', NULL::INTEGER, NULL::INTEGER, FALSE, u.point;
      RETURN;
    END IF;
    UPDATE users SET point = point - p_draw_cost WHERE id = p_user_id;
    u.point := u.point - p_draw_cost;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('user_card_serial:' || p_channel_id));
  SELECT COALESCE(MAX(user_cards.serial_number), 0) + 1 INTO next_serial
    FROM user_cards
   WHERE channel_id = p_channel_id;

  INSERT INTO user_cards (user_id, channel_id, serial_number, star)
  VALUES (p_user_id, p_channel_id, next_serial, 0)
  RETURNING id INTO new_card_id;

  RETURN QUERY SELECT TRUE, 'OK', new_card_id, next_serial, free_draw, u.point;
END;
$$ LANGUAGE plpgsql;

-- 쿠폰 사용: 사용 로그, 사용 횟수, 보상 지급을 단일 트랜잭션으로 처리
CREATE OR REPLACE FUNCTION redeem_coupon_atomic(p_coupon_id INTEGER, p_user_id TEXT)
RETURNS TABLE (
  ok BOOLEAN,
  reason TEXT,
  reward_type TEXT,
  points_added INTEGER,
  new_points INTEGER,
  reward_channel_id TEXT,
  reward_item_id INTEGER,
  reward_quantity INTEGER
) AS $$
DECLARE
  c coupons%ROWTYPE;
  base_serial INTEGER;
  i INTEGER;
  updated_point INTEGER;
BEGIN
  SELECT * INTO c FROM coupons WHERE id = p_coupon_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'NOT_FOUND', NULL::TEXT, 0, NULL::INTEGER, NULL::TEXT, NULL::INTEGER, 0;
    RETURN;
  END IF;

  IF c.expires_at IS NOT NULL AND c.expires_at < NOW() THEN
    RETURN QUERY SELECT FALSE, 'EXPIRED', NULL::TEXT, 0, NULL::INTEGER, NULL::TEXT, NULL::INTEGER, 0;
    RETURN;
  END IF;

  IF c.coupon_type = 'single' AND c.used_count >= c.max_uses THEN
    RETURN QUERY SELECT FALSE, 'SOLD_OUT', NULL::TEXT, 0, NULL::INTEGER, NULL::TEXT, NULL::INTEGER, 0;
    RETURN;
  END IF;

  IF c.reward_type = 'card' AND c.reward_channel_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'INVALID_REWARD', NULL::TEXT, 0, NULL::INTEGER, NULL::TEXT, NULL::INTEGER, 0;
    RETURN;
  END IF;

  IF c.reward_type = 'cosmetic' AND c.reward_item_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'INVALID_REWARD', NULL::TEXT, 0, NULL::INTEGER, NULL::TEXT, NULL::INTEGER, 0;
    RETURN;
  END IF;

  IF c.reward_type = 'minigame_ticket' AND COALESCE(c.reward_quantity, 0) <= 0 THEN
    RETURN QUERY SELECT FALSE, 'INVALID_REWARD', NULL::TEXT, 0, NULL::INTEGER, NULL::TEXT, NULL::INTEGER, 0;
    RETURN;
  END IF;

  BEGIN
    INSERT INTO coupon_logs (coupon_id, user_id) VALUES (p_coupon_id, p_user_id);
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT FALSE, 'DUPLICATE', NULL::TEXT, 0, NULL::INTEGER, NULL::TEXT, NULL::INTEGER, 0;
    RETURN;
  END;

  UPDATE coupons SET used_count = used_count + 1 WHERE id = p_coupon_id;

  IF c.reward_type = 'card' THEN
    PERFORM pg_advisory_xact_lock(hashtext('user_card_serial:' || c.reward_channel_id));
    SELECT COALESCE(MAX(user_cards.serial_number), 0) INTO base_serial
      FROM user_cards
     WHERE channel_id = c.reward_channel_id;

    FOR i IN 1..GREATEST(c.reward_quantity, 0) LOOP
      INSERT INTO user_cards (user_id, channel_id, serial_number, star)
      VALUES (p_user_id, c.reward_channel_id, base_serial + i, 0);
    END LOOP;

    RETURN QUERY SELECT TRUE, 'OK', 'card', 0, NULL::INTEGER, c.reward_channel_id, NULL::INTEGER, c.reward_quantity;
    RETURN;
  END IF;

  IF c.reward_type = 'cosmetic' THEN
    INSERT INTO user_cosmetics (user_id, item_id, quantity)
    VALUES (p_user_id, c.reward_item_id, GREATEST(c.reward_quantity, 1))
    ON CONFLICT (user_id, item_id)
    DO UPDATE SET quantity = user_cosmetics.quantity + EXCLUDED.quantity;

    RETURN QUERY SELECT TRUE, 'OK', 'cosmetic', 0, NULL::INTEGER, NULL::TEXT, c.reward_item_id, c.reward_quantity;
    RETURN;
  END IF;

  IF c.reward_type = 'minigame_ticket' THEN
    PERFORM add_minigame_bonus_tickets(p_user_id, c.reward_quantity);
    RETURN QUERY SELECT TRUE, 'OK', 'minigame_ticket', 0, NULL::INTEGER, NULL::TEXT, NULL::INTEGER, c.reward_quantity;
    RETURN;
  END IF;

  UPDATE users SET point = point + c.points WHERE id = p_user_id RETURNING point INTO updated_point;
  RETURN QUERY SELECT TRUE, 'OK', 'point', c.points, updated_point, NULL::TEXT, NULL::INTEGER, 0;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION release_scheduler_lock(p_key TEXT, p_token TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE system_configs
     SET value = '{"token":"","expiresAt":"1970-01-01T00:00:00Z"}'
   WHERE key = p_key
     AND COALESCE((NULLIF(value, '')::JSONB)->>'token', '') = p_token;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 하위 호환성 유지: user_cosmetics 테이블의 item_id 외래키가 없는 경우 추가
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE table_name = 'user_cosmetics' 
          AND constraint_name = 'user_cosmetics_item_id_fkey'
    ) THEN
        ALTER TABLE user_cosmetics 
        ADD CONSTRAINT user_cosmetics_item_id_fkey 
        FOREIGN KEY (item_id) REFERENCES shop_items(id) ON DELETE CASCADE;
    END IF;
END $$;

-- ============================================================
-- 하위 호환성 유지: 시스템 설정 테이블 생성 및 기본 무료뽑기 간격 설정 추가
-- ============================================================
CREATE TABLE IF NOT EXISTS system_configs (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
INSERT INTO system_configs (key, value) VALUES ('free_draw_interval', '24') ON CONFLICT (key) DO NOTHING;
INSERT INTO system_configs (key, value) VALUES ('draw_cost', '10000') ON CONFLICT (key) DO NOTHING; -- 뽑기 1회 기본 비용
INSERT INTO system_configs (key, value) VALUES ('maintenance_active', 'false') ON CONFLICT (key) DO NOTHING;
INSERT INTO system_configs (key, value) VALUES ('maintenance_start_at', '') ON CONFLICT (key) DO NOTHING;
INSERT INTO system_configs (key, value) VALUES ('maintenance_end_at', '') ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 오픈마켓 테이블 및 인덱스 추가
-- ============================================================
CREATE TABLE IF NOT EXISTS market_listings (
  id BIGSERIAL PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_card_id INTEGER NOT NULL REFERENCES user_cards(id) ON DELETE CASCADE UNIQUE,
  price INTEGER NOT NULL CHECK (price >= 10),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SOLD', 'CANCELLED')),
  buyer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  fee INTEGER DEFAULT 0,
  settled_amount INTEGER DEFAULT 0,
  with_cosmetics BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_listings_status ON market_listings(status);
CREATE INDEX IF NOT EXISTS idx_market_listings_created ON market_listings(created_at DESC);

-- ============================================================
-- 오픈마켓 원자적 구매를 위한 RPC 함수
-- ============================================================
CREATE OR REPLACE FUNCTION buy_market_item_atomic(p_listing_id INTEGER, p_buyer_id TEXT)
RETURNS TEXT AS $$
DECLARE
  listing market_listings%ROWTYPE;
  s_point INTEGER;
  b_point INTEGER;
  calc_fee INTEGER;
  calc_settled INTEGER;
  card_border_id INTEGER;
  card_name_effect_id INTEGER;
BEGIN
  -- 동시 거래 락 획득
  PERFORM pg_advisory_xact_lock(hashtext('buy_market_item:' || p_listing_id::TEXT));

  -- 매물 정보 조회 (FOR UPDATE로 잠금)
  SELECT * INTO listing FROM market_listings WHERE id = p_listing_id AND status = 'PENDING' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'NOT_FOUND_OR_NOT_PENDING';
  END IF;

  IF listing.seller_id = p_buyer_id THEN
    RETURN 'CANNOT_BUY_OWN_ITEM';
  END IF;

  -- 구매자 포인트 조회 및 검증
  SELECT point INTO b_point FROM users WHERE id = p_buyer_id FOR UPDATE;
  IF b_point IS NULL THEN
    RETURN 'BUYER_NOT_FOUND';
  END IF;
  IF b_point < listing.price THEN
    RETURN 'INSUFFICIENT_POINT';
  END IF;

  -- 수수료 계산 (5% 소수점 버림)
  calc_fee := FLOOR(listing.price * 0.05)::INTEGER;
  calc_settled := listing.price - calc_fee;

  -- 구매자 포인트 차감
  UPDATE users SET point = point - listing.price WHERE id = p_buyer_id;

  -- 판매자 포인트 가산
  UPDATE users SET point = point + calc_settled WHERE id = listing.seller_id;

  -- 매물 상태 업데이트
  UPDATE market_listings
     SET status = 'SOLD',
         buyer_id = p_buyer_id,
         fee = calc_fee,
         settled_amount = calc_settled,
         updated_at = NOW()
   WHERE id = p_listing_id;

  -- 카드 소유권 이전 및 코스메틱 처리 분기
  IF listing.with_cosmetics THEN
    -- 코스메틱 정보를 유지한 채 소유권만 이전
    UPDATE user_cards
       SET user_id = p_buyer_id
     WHERE id = listing.user_card_id;
  ELSE
    -- 코스메틱 정보를 해제하고 판매자 계정으로 반환 처리
    SELECT border_item_id, name_effect_item_id INTO card_border_id, card_name_effect_id 
      FROM user_cards 
     WHERE id = listing.user_card_id;

    IF card_border_id IS NOT NULL THEN
      INSERT INTO user_cosmetics (user_id, item_id, quantity)
      VALUES (listing.seller_id, card_border_id, 1)
      ON CONFLICT (user_id, item_id)
      DO UPDATE SET quantity = user_cosmetics.quantity + 1;
    END IF;

    IF card_name_effect_id IS NOT NULL THEN
      INSERT INTO user_cosmetics (user_id, item_id, quantity)
      VALUES (listing.seller_id, card_name_effect_id, 1)
      ON CONFLICT (user_id, item_id)
      DO UPDATE SET quantity = user_cosmetics.quantity + 1;
    END IF;

    UPDATE user_cards
       SET user_id = p_buyer_id,
           border_item_id = NULL,
           name_effect_item_id = NULL
     WHERE id = listing.user_card_id;
  END IF;

  RETURN 'OK';
EXCEPTION
  WHEN OTHERS THEN
    RETURN 'FAILED:' || SQLERRM;
END;
$$ LANGUAGE plpgsql;


