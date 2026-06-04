-- ============================================================
-- ChzzkCardTradeView - Supabase(PostgreSQL) 초기 스키마 구성
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
    access_token TEXT,                           -- 치지직 OAuth access_token (암호화 저장)
    refresh_token TEXT,                          -- 치지직 OAuth refresh_token (암호화 저장)
    token_expires_at TIMESTAMPTZ,                -- 치지직 access_token 만료 시각
    created_at TIMESTAMPTZ DEFAULT NOW()
);

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

-- 3. 유저 보유 카드 매핑 테이블
CREATE TABLE IF NOT EXISTS user_cards (
    id SERIAL PRIMARY KEY,                       -- 자동 증가 고유 ID
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES streamers(channel_id) ON DELETE CASCADE,
    serial_number INTEGER NOT NULL,              -- 발행 일련번호
    star INTEGER DEFAULT 0,                       -- 합성 별 등급 (0~5)
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
    reward_type TEXT NOT NULL DEFAULT 'point',   -- 'point'(재화) 또는 'card'(스트리머 카드)
    points INTEGER NOT NULL DEFAULT 0,           -- reward_type='point' 지급 재화
    reward_channel_id TEXT,                      -- reward_type='card' 지급 스트리머 채널 ID
    reward_item_id INTEGER,                      -- reward_type='cosmetic' 지급 상점 아이템 ID
    reward_quantity INTEGER DEFAULT 0,           -- card/cosmetic 지급 수량
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
    status TEXT DEFAULT 'pending',               -- 'pending', 'sent'
    scheduled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

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

-- 13. 상점 아이템 (테두리 / 이름 이펙트)
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
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS purchase_limit INTEGER DEFAULT 0;
ALTER TABLE user_cards ADD COLUMN IF NOT EXISTS star INTEGER DEFAULT 0;
ALTER TABLE user_cards ADD COLUMN IF NOT EXISTS border_item_id INTEGER;
ALTER TABLE user_cards ADD COLUMN IF NOT EXISTS name_effect_item_id INTEGER;

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

-- 유저 랭킹: (포인트 + 보유 카드 시세 합산) 총자산 기준 정렬
CREATE OR REPLACE FUNCTION get_user_rankings(p_limit INTEGER)
RETURNS TABLE (
  id TEXT, username TEXT, avatar_url TEXT, role TEXT, point INTEGER,
  last_free_draw TIMESTAMPTZ, banned_until TIMESTAMPTZ, created_at TIMESTAMPTZ,
  card_count BIGINT, total_asset BIGINT
) AS $$
  -- 카드 가치는 별(0~5성) 배수(1 + star*0.6)를 반영하여 합산
  SELECT u.id, u.username, u.avatar_url, u.role, u.point,
         u.last_free_draw, u.banned_until, u.created_at,
         COUNT(uc.id) AS card_count,
         (u.point + COALESCE(SUM(s.base_value * (1 + COALESCE(uc.star, 0) * 0.6)), 0))::BIGINT AS total_asset
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
           (u.point + COALESCE(SUM(s.base_value * (1 + COALESCE(uc.star, 0) * 0.6)), 0))::BIGINT AS total_asset,
           ROW_NUMBER() OVER (
             ORDER BY (u.point + COALESCE(SUM(s.base_value * (1 + COALESCE(uc.star, 0) * 0.6)), 0)) DESC
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

