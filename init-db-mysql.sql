-- ChzzkCardTradeView MySQL 8 schema
-- SQLite partial indexes are represented with generated columns where needed.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(191) PRIMARY KEY,
    username VARCHAR(191) NOT NULL,
    avatar_url TEXT,
    role VARCHAR(16) DEFAULT 'USER',
    point BIGINT DEFAULT 0,
    last_free_draw VARCHAR(64),
    free_draw_tickets INT NOT NULL DEFAULT 0,
    bonus_free_draw_tickets INT NOT NULL DEFAULT 0,
    banned_until VARCHAR(64),
    ban_reason TEXT,
    representative_card_channel_id VARCHAR(191),
    representative_card_star INT,
    status_message VARCHAR(255),
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at VARCHAR(64),
    created_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP())
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tutorial_rewards (
    user_id VARCHAR(191) NOT NULL,
    reward_key VARCHAR(191) NOT NULL,
    reward_type VARCHAR(64) NOT NULL,
    reward_amount BIGINT NOT NULL DEFAULT 0,
    created_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP()),
    PRIMARY KEY(user_id, reward_key),
    CONSTRAINT fk_tutorial_rewards_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS titles (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(191) NOT NULL,
    description TEXT,
    css MEDIUMTEXT NOT NULL,
    icon_name VARCHAR(191),
    icon_color VARCHAR(32) NOT NULL DEFAULT '#ffffff',
    created_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP()),
    updated_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP())
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_titles (
    user_id VARCHAR(191) NOT NULL,
    title_id BIGINT NOT NULL,
    awarded_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP()),
    is_equipped TINYINT NOT NULL DEFAULT 0,
    equipped_user_id VARCHAR(191) GENERATED ALWAYS AS (CASE WHEN is_equipped = 1 THEN user_id ELSE NULL END) STORED,
    PRIMARY KEY (user_id, title_id),
    KEY idx_user_titles_user (user_id),
    UNIQUE KEY idx_user_titles_equipped (equipped_user_id),
    CONSTRAINT fk_user_titles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_titles_title FOREIGN KEY (title_id) REFERENCES titles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS streamers (
    channel_id VARCHAR(191) PRIMARY KEY,
    name VARCHAR(191) NOT NULL,
    logo_url TEXT,
    custom_image_url TEXT,
    custom_image_url_1 TEXT,
    custom_image_url_2 TEXT,
    custom_image_url_3 TEXT,
    custom_image_url_4 TEXT,
    custom_image_url_5 TEXT,
    is_image_banned TINYINT DEFAULT 0,
    follower_count BIGINT DEFAULT 0,
    activity_score BIGINT DEFAULT 0,
    base_value BIGINT DEFAULT 1000,
    is_active TINYINT DEFAULT 0,
    broadcast_count BIGINT DEFAULT 0,
    broadcast_minutes BIGINT DEFAULT 0,
    chat_count BIGINT DEFAULT 0,
    broadcast_multiplier DOUBLE DEFAULT 1.0,
    prev_value BIGINT DEFAULT 1000,
    last_broadcast_at VARCHAR(64),
    serial_number BIGINT,
    registered_by VARCHAR(191),
    updated_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP()),
    KEY idx_streamers_registered_by (registered_by),
    CONSTRAINT fk_streamers_registered_by FOREIGN KEY(registered_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shop_items (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    type VARCHAR(64) NOT NULL,
    name VARCHAR(191) NOT NULL,
    description TEXT,
    price BIGINT NOT NULL DEFAULT 0,
    style_json MEDIUMTEXT,
    font_url TEXT,
    font_family VARCHAR(191),
    active TINYINT DEFAULT 1,
    purchase_limit INT DEFAULT 0,
    created_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP())
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_cards (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(191) NOT NULL,
    channel_id VARCHAR(191) NOT NULL,
    serial_number BIGINT NOT NULL,
    star INT DEFAULT 0,
    border_item_id BIGINT,
    name_effect_item_id BIGINT,
    is_hidden TINYINT NOT NULL DEFAULT 0,
    favorite_order BIGINT,
    favorite_at VARCHAR(64),
    acquired_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP()),
    KEY idx_user_cards_user_visible (user_id, is_hidden),
    KEY idx_user_cards_channel_id (channel_id, id),
    KEY idx_user_cards_channel_star_visible (channel_id, star, is_hidden),
    KEY idx_user_cards_user_inventory_order (user_id, favorite_order, id),
    KEY idx_user_cards_user_favorite_max (user_id, favorite_order),
    CONSTRAINT fk_user_cards_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_cards_streamer FOREIGN KEY(channel_id) REFERENCES streamers(channel_id) ON DELETE CASCADE,
    CONSTRAINT fk_user_cards_border FOREIGN KEY(border_item_id) REFERENCES shop_items(id) ON DELETE SET NULL,
    CONSTRAINT fk_user_cards_name_effect FOREIGN KEY(name_effect_item_id) REFERENCES shop_items(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trades (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    sender_id VARCHAR(191) NOT NULL,
    receiver_id VARCHAR(191) NOT NULL,
    sender_offer MEDIUMTEXT NOT NULL,
    receiver_offer MEDIUMTEXT NOT NULL,
    status VARCHAR(32) DEFAULT 'PENDING',
    created_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP()),
    completed_at VARCHAR(64),
    KEY idx_trades_sender (sender_id),
    KEY idx_trades_receiver (receiver_id),
    CONSTRAINT fk_trades_sender FOREIGN KEY(sender_id) REFERENCES users(id),
    CONSTRAINT fk_trades_receiver FOREIGN KEY(receiver_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS value_history (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    channel_id VARCHAR(191) NOT NULL,
    value BIGINT NOT NULL,
    recorded_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP()),
    KEY idx_value_history_channel_recorded (channel_id, recorded_at),
    KEY idx_value_history_recorded_channel (recorded_at, channel_id),
    CONSTRAINT fk_value_history_streamer FOREIGN KEY(channel_id) REFERENCES streamers(channel_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coupons (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(191) UNIQUE NOT NULL,
    coupon_type VARCHAR(32) NOT NULL,
    reward_type VARCHAR(64) NOT NULL DEFAULT 'point',
    points BIGINT NOT NULL DEFAULT 0,
    reward_channel_id VARCHAR(191),
    reward_item_id BIGINT,
    reward_quantity BIGINT DEFAULT 0,
    max_uses BIGINT DEFAULT 1,
    used_count BIGINT DEFAULT 0,
    expires_at VARCHAR(64),
    created_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP()),
    KEY idx_coupons_reward_item (reward_item_id),
    CONSTRAINT fk_coupons_reward_streamer FOREIGN KEY(reward_channel_id) REFERENCES streamers(channel_id) ON DELETE SET NULL,
    CONSTRAINT fk_coupons_reward_item FOREIGN KEY(reward_item_id) REFERENCES shop_items(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coupon_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    coupon_id BIGINT NOT NULL,
    user_id VARCHAR(191) NOT NULL,
    redeemed_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP()),
    UNIQUE KEY idx_coupon_logs_coupon_user_unique (coupon_id, user_id),
    KEY idx_coupon_logs_user (user_id),
    CONSTRAINT fk_coupon_logs_coupon FOREIGN KEY(coupon_id) REFERENCES coupons(id) ON DELETE CASCADE,
    CONSTRAINT fk_coupon_logs_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS announcements (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(255) NOT NULL,
    content MEDIUMTEXT NOT NULL,
    is_popup TINYINT DEFAULT 0,
    is_pinned TINYINT DEFAULT 0,
    popup_expires_at VARCHAR(64),
    created_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP())
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(191) NOT NULL,
    endpoint VARCHAR(768) NOT NULL,
    auth_key VARCHAR(512) NOT NULL,
    p256dh_key VARCHAR(512) NOT NULL,
    origin VARCHAR(255),
    created_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP()),
    UNIQUE KEY idx_push_subscriptions_endpoint (endpoint),
    KEY idx_push_subscriptions_user (user_id),
    CONSTRAINT fk_push_subscriptions_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS push_notifications (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    coupon_code VARCHAR(191),
    status VARCHAR(32) DEFAULT 'pending',
    scheduled_at VARCHAR(64),
    sent_at VARCHAR(64),
    created_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP())
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS card_reports (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    reporter_id VARCHAR(191) NOT NULL,
    channel_id VARCHAR(191) NOT NULL,
    reported_image_url TEXT NOT NULL,
    star INT DEFAULT 0,
    reason TEXT NOT NULL,
    status VARCHAR(32) DEFAULT 'pending',
    created_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP()),
    KEY idx_card_reports_reporter (reporter_id),
    KEY idx_card_reports_channel (channel_id),
    CONSTRAINT fk_card_reports_reporter FOREIGN KEY(reporter_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_card_reports_channel FOREIGN KEY(channel_id) REFERENCES streamers(channel_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS streamer_registration_blocks (
    channel_id VARCHAR(191) PRIMARY KEY,
    reason TEXT NOT NULL,
    blocked_by VARCHAR(191),
    created_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP()),
    KEY idx_streamer_registration_blocks_blocked_by (blocked_by),
    CONSTRAINT fk_streamer_registration_blocks_blocked_by FOREIGN KEY(blocked_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(191) NOT NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT,
    link TEXT,
    is_read TINYINT DEFAULT 0,
    deleted_at VARCHAR(64),
    created_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP()),
    KEY idx_notifications_user (user_id, is_read),
    CONSTRAINT fk_notifications_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_cosmetics (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(191) NOT NULL,
    item_id BIGINT NOT NULL,
    quantity BIGINT DEFAULT 0,
    UNIQUE KEY idx_user_cosmetics_user_item_unique (user_id, item_id),
    KEY idx_user_cosmetics_item (item_id),
    CONSTRAINT fk_user_cosmetics_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_cosmetics_item FOREIGN KEY(item_id) REFERENCES shop_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shop_purchases (
    user_id VARCHAR(191) NOT NULL,
    item_id BIGINT NOT NULL,
    count BIGINT DEFAULT 0,
    PRIMARY KEY(user_id, item_id),
    KEY idx_shop_purchases_item (item_id),
    CONSTRAINT fk_shop_purchases_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_shop_purchases_item FOREIGN KEY(item_id) REFERENCES shop_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_blocks (
    blocker_id VARCHAR(191) NOT NULL,
    blocked_id VARCHAR(191) NOT NULL,
    created_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP()),
    PRIMARY KEY(blocker_id, blocked_id),
    KEY idx_user_blocks_blocked (blocked_id),
    CONSTRAINT fk_user_blocks_blocker FOREIGN KEY(blocker_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_blocks_blocked FOREIGN KEY(blocked_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_configs (
    `key` VARCHAR(191) PRIMARY KEY,
    value TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS market_listings (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    seller_id VARCHAR(191) NOT NULL,
    user_card_id BIGINT NOT NULL,
    price BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    listing_type VARCHAR(32) NOT NULL DEFAULT 'fixed',
    buy_now_price BIGINT,
    starting_bid BIGINT,
    current_bid BIGINT,
    current_bidder_id VARCHAR(191),
    auction_ends_at VARCHAR(64),
    bid_reserved BIGINT DEFAULT 0,
    buyer_id VARCHAR(191),
    fee BIGINT DEFAULT 0,
    fee_rate INT DEFAULT 5,
    settled_amount BIGINT DEFAULT 0,
    with_cosmetics TINYINT DEFAULT 0,
    seller_hidden_at VARCHAR(64),
    created_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP()),
    updated_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP()),
    pending_user_card_id BIGINT GENERATED ALWAYS AS (CASE WHEN status = 'PENDING' THEN user_card_id ELSE NULL END) STORED,
    KEY idx_market_listings_status (status),
    KEY idx_market_listings_created (created_at),
    KEY idx_market_listings_sold_updated_card (status, updated_at, user_card_id, price),
    UNIQUE KEY idx_market_listings_pending_card (pending_user_card_id),
    KEY idx_market_listings_seller (seller_id),
    KEY idx_market_listings_buyer (buyer_id),
    KEY idx_market_listings_current_bidder (current_bidder_id),
    CONSTRAINT fk_market_listings_seller FOREIGN KEY(seller_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_market_listings_card FOREIGN KEY(user_card_id) REFERENCES user_cards(id) ON DELETE CASCADE,
    CONSTRAINT fk_market_listings_current_bidder FOREIGN KEY(current_bidder_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_market_listings_buyer FOREIGN KEY(buyer_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS market_bids (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    listing_id BIGINT NOT NULL,
    bidder_id VARCHAR(191) NOT NULL,
    amount BIGINT NOT NULL,
    created_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP()),
    KEY idx_market_bids_listing (listing_id, amount),
    KEY idx_market_bids_bidder (bidder_id),
    CONSTRAINT fk_market_bids_listing FOREIGN KEY(listing_id) REFERENCES market_listings(id) ON DELETE CASCADE,
    CONSTRAINT fk_market_bids_bidder FOREIGN KEY(bidder_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS market_watches (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(191) NOT NULL,
    channel_id VARCHAR(191) NOT NULL,
    star INT,
    max_price BIGINT,
    created_at VARCHAR(64) DEFAULT (UTC_TIMESTAMP()),
    UNIQUE KEY idx_market_watches_user_card (user_id, channel_id, star),
    KEY idx_market_watches_card (channel_id, star),
    CONSTRAINT fk_market_watches_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_market_watches_channel FOREIGN KEY(channel_id) REFERENCES streamers(channel_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_minigame_tickets (
    user_id VARCHAR(191) PRIMARY KEY,
    current_tickets INT NOT NULL DEFAULT 5,
    bonus_tickets INT NOT NULL DEFAULT 0,
    last_charged_at VARCHAR(64) NOT NULL DEFAULT (UTC_TIMESTAMP()),
    updated_at VARCHAR(64) NOT NULL DEFAULT (UTC_TIMESTAMP()),
    CONSTRAINT fk_user_minigame_tickets_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS minigame_sessions (
    id VARCHAR(191) PRIMARY KEY,
    user_id VARCHAR(191) NOT NULL,
    game_type VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'STARTED',
    target_data MEDIUMTEXT,
    ticket_spent_type VARCHAR(32) DEFAULT 'NONE',
    created_at VARCHAR(64) NOT NULL DEFAULT (UTC_TIMESTAMP()),
    completed_at VARCHAR(64),
    earned_points BIGINT DEFAULT 0,
    KEY idx_minigame_sessions_user (user_id),
    CONSTRAINT fk_minigame_sessions_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO system_configs (`key`, value) VALUES ('free_draw_interval', '24');
INSERT IGNORE INTO system_configs (`key`, value) VALUES ('free_draw_max_stack', '1');
INSERT IGNORE INTO system_configs (`key`, value) VALUES ('draw_cost', '10000');
INSERT IGNORE INTO system_configs (`key`, value) VALUES ('draw_target_value', '2500');
INSERT IGNORE INTO system_configs (`key`, value) VALUES ('minigame_ticket_charge_interval_minutes', '240');
INSERT IGNORE INTO system_configs (`key`, value) VALUES ('maintenance_active', 'false');
INSERT IGNORE INTO system_configs (`key`, value) VALUES ('maintenance_start_at', '');
INSERT IGNORE INTO system_configs (`key`, value) VALUES ('maintenance_end_at', '');

SET FOREIGN_KEY_CHECKS = 1;
