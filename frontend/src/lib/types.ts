/**
 * types.ts — 프론트엔드 전역에서 공유하는 도메인 타입.
 * 백엔드 응답 스키마와 1:1 대응합니다. (any 남용 제거용)
 */

export type CosmeticType = 'border' | 'name_effect';

export interface UserTitle {
  id: number;
  name: string;
  css: string;
  icon_name: string | null;
  icon_color: string;
  created_at?: string;
  updated_at?: string;
  awarded_at?: string;
  is_equipped?: boolean;
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
  created_at: string | null;
  titles: UserTitle[];
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
}

/** 쿠폰 */
export interface Coupon {
  id: number;
  code: string;
  coupon_type: 'single' | 'multi';
  reward_type: 'point' | 'card' | 'cosmetic' | 'minigame_ticket' | 'free_draw_ticket';
  points: number;
  reward_channel_id: string | null;
  reward_item_id?: number | null;
  reward_quantity: number;
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
