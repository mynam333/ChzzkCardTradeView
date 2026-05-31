// ChzzkCardTradeView 데이터 액세스 레이어 추상화 인터페이스 정의

export interface User {
  id: string;
  username: string;
  avatar_url: string | null;
  role: 'USER' | 'ADMIN';
  point: number;
  last_free_draw: string | null;
  banned_until: string | null;
  access_token?: string | null;
  refresh_token?: string | null;
  created_at?: string;
}

export interface Streamer {
  channel_id: string;
  name: string;
  logo_url: string | null;
  custom_image_url: string | null;
  is_image_banned: boolean;
  follower_count: number;
  activity_score: number;
  base_value: number;
  is_active: boolean;
  serial_number?: number;
  broadcast_count?: number;
  chat_count?: number;
  broadcast_multiplier?: number;
  updated_at?: string;
}

export interface Coupon {
  id?: number;
  code: string;
  coupon_type: 'single' | 'multi';
  points: number;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  created_at?: string;
}

export interface CardReport {
  id?: number;
  reporter_id: string;
  channel_id: string;
  reported_image_url: string;
  reason: string;
  status: 'pending' | 'resolved' | 'rejected';
  created_at?: string;
}

export interface Announcement {
  id?: number;
  title: string;
  content: string;
  is_popup: boolean;
  popup_expires_at: string | null;
  created_at?: string;
}

export interface UserCard {
  id?: number;
  user_id: string;
  channel_id: string;
  serial_number: number;
  acquired_at?: string;
}

// 1. 유저 리포지토리 인터페이스
export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  create(user: User): Promise<User>;
  updatePoint(id: string, point: number): Promise<void>;
  updateBanStatus(id: string, bannedUntil: string | null): Promise<void>;
  updateLastFreeDraw(id: string, time: string): Promise<void>;
  updateProfile(id: string, username: string, avatarUrl: string | null, accessToken?: string | null, refreshToken?: string | null): Promise<void>;
  findRankings(limit: number): Promise<User[]>;
}

// 2. 스트리머 리포지토리 인터페이스
export interface IStreamerRepository {
  findAll(): Promise<Streamer[]>;
  findById(channelId: string): Promise<Streamer | null>;
  save(streamer: Streamer): Promise<void>;
  updateCustomImage(channelId: string, imageUrl: string | null): Promise<void>;
  updateImageBanStatus(channelId: string, isBanned: boolean): Promise<void>;
  findStreamerIndex(channelId: string): Promise<number>;
  findMaxSerialNumber(): Promise<number>;
  findAllocatedStreamerSerialNumbers(): Promise<number[]>;
  updateLiveStatus(channelId: string, isActive: boolean, followerCount: number): Promise<void>;
  incrementBroadcastCount(channelId: string): Promise<void>;
  incrementChatCount(channelId: string, count?: number): Promise<void>;
}

// 3. 쿠폰 리포지토리 인터페이스
export interface ICouponRepository {
  findByCode(code: string): Promise<Coupon | null>;
  create(coupon: Coupon): Promise<Coupon>;
  incrementUsedCount(couponId: number): Promise<void>;
  checkCouponRedeemed(couponId: number, userId: string): Promise<boolean>;
  logCouponRedeem(couponId: number, userId: string): Promise<void>;
}

// 4. 신고 리포지토리 인터페이스
export interface IReportRepository {
  findAll(): Promise<CardReport[]>;
  create(report: CardReport): Promise<CardReport>;
  updateStatus(reportId: number, status: 'resolved' | 'rejected'): Promise<void>;
}

// 5. 공지사항 리포지토리 인터페이스
export interface IAnnouncementRepository {
  findAll(): Promise<Announcement[]>;
  findActivePopups(): Promise<Announcement[]>;
  create(announcement: Announcement): Promise<Announcement>;
  delete(id: number): Promise<void>;
}

// 6. 유저 보유 카드 리포지토리 인터페이스
export interface IUserCardRepository {
  create(card: UserCard): Promise<UserCard>;
  findByUserId(userId: string): Promise<(UserCard & { streamer: Streamer })[]>;
  findLatestSerialNumber(channelId: string): Promise<number>;
  findAllocatedSerialNumbers(channelId: string): Promise<number[]>;
  deleteCards(userId: string, channelId: string, count: number): Promise<number>;
}
