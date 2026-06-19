/**
 * types.ts — 프론트엔드 전역에서 공유하는 도메인 타입.
 * 백엔드 응답 스키마와 1:1 대응합니다. (any 남용 제거용)
 */

export type CosmeticType = 'border' | 'name_effect';

export interface UserTitle {
  id: number;
  name: string;
  description: string | null;
  css: string;
  icon_name: string | null;
  icon_color: string;
  created_at?: string;
  updated_at?: string;
  awarded_at?: string;
  is_equipped?: boolean;
}

export interface SubscriptionTitleRule {
  id: number;
  broadcaster_channel_id: string;
  broadcaster_name: string | null;
  title_id: number;
  active: boolean;
  created_at?: string;
  updated_at?: string;
  title_name?: string | null;
}

export interface CosmeticRef {
  class?: string;
  css?: string;
  // 레거시 인라인 스타일(JSON CSSProperties)도 허용
  [key: string]: unknown;
}

/** 스트리머 카드/시세 정보 */
export interface Streamer {
  channel_id: string;
  name: string;
  logo_url: string | null;
  custom_image_url: string | null;
  custom_images?: (string | null)[];
  is_image_banned?: boolean;
  follower_count: number;
  activity_score: number;
  base_value: number;
  prev_value?: number;
  is_active: boolean;
  broadcast_count?: number;
  broadcast_minutes?: number;
  serial_number?: number;
  updated_at?: string;
}

/** 유저 보유 카드 1장 */
export interface UserCard {
  id: number;
  channel_id: string;
  serial_number: number;
  star?: number;
  border?: CosmeticRef | null;
  name_effect?: CosmeticRef | null;
  acquired_at: string;
  streamer?: Streamer;
}

/** 상점 아이템(코스메틱) */
export interface ShopItem {
  id: number;
  type: CosmeticType;
  name: string;
  description: string | null;
  price: number;
  style_json: string | null;
  font_url: string | null;
  font_family: string | null;
  purchase_limit: number;
  listed_at?: string | null;
  created_at?: string | null;
  sale_start_at?: string | null;
  sale_end_at?: string | null;
  limited_total_quantity?: number;
  sold_quantity?: number;
  active?: boolean;
}

/** 관리자 유저 목록 항목 */
export interface AdminUser {
  id: string;
  username: string;
  avatar_url: string | null;
  role: 'USER' | 'ADMIN';
  point: number;
  status_message?: string | null;
  banned_until: string | null;
  ban_reason?: string | null;
  created_at: string | null;
  deleted_at?: string | null;
  is_deleted?: boolean;
  identity_source?: 'current' | 'rejoined' | 'deleted_snapshot' | 'unknown';
  titles: UserTitle[];
}

export type PointLedgerSourceType =
  | 'gacha_draw'
  | 'card_sell'
  | 'coupon'
  | 'minigame'
  | 'shop_purchase'
  | 'market_purchase'
  | 'market_sale'
  | 'market_bid'
  | 'market_bid_refund'
  | 'card_delete_refund'
  | 'trade'
  | 'admin_reset'
  | 'manual_adjustment'
  | 'unknown';

export interface PointLedgerEntry {
  id: number;
  user_id: string;
  username?: string | null;
  user_deleted_at?: string | null;
  counterparty_user_id: string | null;
  counterparty_username?: string | null;
  counterparty_deleted_at?: string | null;
  amount: number;
  balance_after: number | null;
  source_type: PointLedgerSourceType;
  source_id: string | null;
  reason: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface PointAuditResponse {
  user: {
    id: string;
    username: string | null;
    avatar_url: string | null;
    point: number | null;
    role: AdminUser['role'] | null;
    deleted_at?: string | null;
    identity_source?: 'current' | 'rejoined' | 'deleted_snapshot' | 'unknown';
  };
  entries: PointLedgerEntry[];
  page_summary: {
    income: number;
    expense: number;
    net: number;
  };
  next_before_id: number | null;
}

export type AssetEventAssetType = 'card' | 'point' | 'cosmetic' | 'ticket' | 'title' | 'unknown';
export type AssetEventAction =
  | 'add'
  | 'remove'
  | 'move'
  | 'delete'
  | 'update'
  | 'spend'
  | 'refund'
  | 'reserve'
  | 'release'
  | 'equip'
  | 'unequip';

export interface AssetEventLogEntry {
  id: number;
  event_key: string | null;
  user_id: string | null;
  username?: string | null;
  user_deleted_at?: string | null;
  counterparty_user_id: string | null;
  counterparty_username?: string | null;
  counterparty_deleted_at?: string | null;
  from_user_id: string | null;
  from_username?: string | null;
  to_user_id: string | null;
  to_username?: string | null;
  asset_type: AssetEventAssetType;
  action: AssetEventAction;
  amount: number | null;
  quantity: number | null;
  balance_after: number | null;
  source_type: string;
  source_id: string | null;
  reason: string;
  description: string | null;
  card_id: number | null;
  channel_id: string | null;
  streamer_name?: string | null;
  serial_number: number | null;
  star: number | null;
  item_id: number | null;
  item_name?: string | null;
  item_type: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface AssetEventListResponse {
  entries: AssetEventLogEntry[];
  page_summary: {
    point_income: number;
    point_expense: number;
    cards: number;
    cosmetics: number;
    tickets: number;
  };
  next_before_id: number | null;
}

export interface AssetEventSuspect {
  user_id: string;
  username: string | null;
  user_deleted_at: string | null;
  severity: 'high' | 'medium' | 'low';
  reasons: string[];
  total_events: number;
  point_income: number;
  point_expense: number;
  card_moves: number;
  card_adds: number;
  card_deletes: number;
  cosmetic_events: number;
  negative_balance_events: number;
  last_event_at: string | null;
}

export interface AssetEventSuspectResponse {
  items: AssetEventSuspect[];
  days: number;
}

export interface TradeOfferCard {
  channel_id: string;
  star?: number;
  count: number;
  streamer_name?: string | null;
  streamer_logo_url?: string | null;
  cosmetics?: {
    border?: { id: number; name?: string | null } | null;
    name_effect?: { id: number; name?: string | null } | null;
  }[];
}

export interface TradeOffer {
  cards: TradeOfferCard[];
  point: number;
  with_cosmetics?: boolean;
}

export type TradeStatus = 'PENDING' | 'CONFIRMED' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';

export interface AdminTrade {
  id: number;
  sender_id: string;
  receiver_id: string;
  sender_username?: string | null;
  receiver_username?: string | null;
  sender_offer: TradeOffer;
  receiver_offer: TradeOffer;
  status: TradeStatus;
  created_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
}

export interface AdminTradeListResponse {
  items: AdminTrade[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

/** 관리자 신고 목록 항목 (reporter_username/streamer_name 보강 포함) */
export interface AdminReport {
  id: number;
  reporter_id: string;
  channel_id: string;
  reported_image_url: string;
  star: number;
  reason: string;
  status: 'pending' | 'resolved' | 'rejected';
  created_at: string | null;
  reporter_username: string | null;
  streamer_name: string | null;
  puzzle_excluded?: boolean;
}

/** 쿠폰 */
export type CouponRewardType = 'point' | 'card' | 'cosmetic' | 'minigame_ticket' | 'free_draw_ticket' | 'title';

export interface CouponReward {
  type: CouponRewardType;
  points?: number;
  channel_id?: string | null;
  item_id?: number | null;
  title_id?: number | null;
  quantity?: number;
  label?: string;
}

export interface Coupon {
  id: number;
  code: string;
  coupon_type: 'single' | 'multi';
  reward_type: CouponRewardType;
  points: number;
  reward_channel_id: string | null;
  reward_item_id?: number | null;
  reward_quantity: number;
  rewards?: CouponReward[];
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  created_at?: string;
}

/** 공지사항 */
export interface Announcement {
  id: number;
  title: string;
  content: string;
  is_popup: boolean;
  is_pinned: boolean;
  popup_expires_at: string | null;
  created_at?: string;
}

/** 미사용 업로드 이미지(관리자 정리용) */
export interface OrphanImage {
  rel: string;
  size: number;
  url: string;
}

export type AchievementCategory =
  | 'start'
  | 'attendance'
  | 'collection'
  | 'growth'
  | 'economy'
  | 'trade'
  | 'market'
  | 'minigame'
  | 'community'
  | 'streamer'
  | 'event'
  | 'hidden';

export type AchievementTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'legendary' | 'event';
export type AchievementStatus = 'locked' | 'in_progress' | 'completed' | 'claimed' | 'expired';
export type AchievementRewardType = 'point' | 'card' | 'cosmetic' | 'minigame_ticket' | 'free_draw_ticket' | 'title';

export interface AchievementReward {
  type: AchievementRewardType;
  points?: number;
  channel_id?: string;
  item_id?: number;
  title_id?: number;
  quantity?: number;
  label?: string;
  revoke_when_unmet?: boolean;
}

export interface UserAchievement {
  achievement_id: number;
  code: string | null;
  name: string;
  description: string | null;
  condition_text?: string | null;
  category: AchievementCategory;
  tier: AchievementTier;
  icon: string | null;
  icon_color: string | null;
  is_hidden: boolean;
  is_secret: boolean;
  status: AchievementStatus;
  progress_current: number;
  progress_target: number;
  progress_percent: number;
  completed_at: string | null;
  claimed_at: string | null;
  rewards: AchievementReward[];
}

export interface UserAchievementsResponse {
  items: UserAchievement[];
  summary: Record<string, number>;
}

export interface AdminAchievement {
  id: number;
  code: string;
  name: string;
  description: string | null;
  category: AchievementCategory;
  tier: AchievementTier;
  icon: string | null;
  icon_color: string | null;
  is_active: boolean;
  is_hidden: boolean;
  is_secret: boolean;
  criteria_json: string | Record<string, unknown>;
  rewards_json: string | AchievementReward[];
  hidden_hint?: string | null;
  sort_order: number;
  starts_at?: string | null;
  ends_at?: string | null;
  progress_mode: string;
  repeat_policy: string;
  claim_policy: string;
  limited_winner_count?: number | null;
  completed_users?: number;
  claimed_users?: number;
  created_at?: string | null;
  updated_at?: string | null;
}
