// ChzzkCardTradeView 데이터 액세스 레이어 추상화 인터페이스 정의

export interface User {
  id: string;
  username: string;
  avatar_url: string | null;
  role: 'USER' | 'ADMIN';
  point: number;
  last_free_draw: string | null;
  banned_until: string | null;
  ban_reason?: string | null;
  representative_card_channel_id?: string | null;
  access_token?: string | null;
  refresh_token?: string | null;
  token_expires_at?: string | null; // 치지직 access_token 만료 시각(ISO)
  created_at?: string;
}

export interface Streamer {
  channel_id: string;
  name: string;
  logo_url: string | null;
  custom_image_url: string | null;
  // 별(0~5성)별 커스텀 카드 이미지. 인덱스 0 = custom_image_url(0성). 미등록 성은 null.
  custom_images?: (string | null)[];
  is_image_banned: boolean;
  follower_count: number;
  activity_score: number;
  base_value: number;
  is_active: boolean;
  serial_number?: number;
  broadcast_count?: number;
  broadcast_minutes?: number;
  chat_count?: number;
  broadcast_multiplier?: number;
  prev_value?: number;
  updated_at?: string;
  registered_by?: string | null;
}

// 시세 히스토리 한 점
export interface ValueHistoryPoint {
  value: number;
  recorded_at: string;
}

// 스케줄러 1주기 계산 결과(스트리머 1명) — 일괄 반영용
export interface StreamerScheduleResult {
  channel_id: string;
  prev_value: number;
  base_value: number;
  activity_score: number;
  broadcast_multiplier: number;
  /** 누적 방송 시간 가산(분). 0이면 미가산 */
  add_minutes: number;
  /** 방송 시작 트랜지션 시 1, 아니면 0 */
  add_broadcast_count: number;
  /** 차감할 채팅 수(0 하한). 집계 도중 유입분 보존을 위해 상대 차감 */
  consumed_chats: number;
  /** 이번 주기에 HTTP로 라이브 상태를 폴링했는지 여부 */
  polled: boolean;
  /** polled === true 일 때만 반영되는 라이브 상태 */
  is_active: boolean;
  /** polled === true 일 때만 반영되는 팔로워 수 */
  follower_count: number;
}

export interface Coupon {
  id?: number;
  code: string;
  // single: 선착순 발급 갯수(max_uses) 제한, multi: 기간 내 1인 1회 · 총량 무제한
  coupon_type: 'single' | 'multi';
  // 보상 종류: point(재화) | card(스트리머 카드) | cosmetic(코스메틱 아이템)
  reward_type: 'point' | 'card' | 'cosmetic';
  points: number;                     // reward_type === 'point' 일 때 지급 재화량
  reward_channel_id: string | null;   // reward_type === 'card' 일 때 지급 스트리머 채널 ID
  reward_item_id?: number | null;     // reward_type === 'cosmetic' 일 때 지급 상점 아이템 ID
  reward_quantity: number;            // card/cosmetic 일 때 지급 수량
  max_uses: number;                   // single: 발급 갯수, multi: 0(무제한)
  used_count: number;
  expires_at: string | null;
  created_at?: string;
}

export interface CardReport {
  id?: number;
  reporter_id: string;
  channel_id: string;
  reported_image_url: string;
  /** 신고된 카드의 별(0~5성) — 어떤 별 이미지를 신고했는지 식별용 */
  star?: number;
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

export interface CosmeticRef {
  id: number;
  style_json?: string | null;
  font_url?: string | null;
  font_family?: string | null;
}

export interface UserCard {
  id?: number;
  user_id: string;
  channel_id: string;
  serial_number: number;
  star?: number;
  acquired_at?: string;
  // 장착된 코스메틱(조회 시 임베드)
  border_item_id?: number | null;
  name_effect_item_id?: number | null;
  border?: CosmeticRef | null;
  name_effect?: CosmeticRef | null;
}

// 1. 유저 리포지토리 인터페이스
export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  /** 닉네임으로 사용자를 조회합니다(거래 상대 지정용). 동명이인 시 가장 먼저 가입한 1명. */
  findByUsername(username: string): Promise<User | null>;
  /** 닉네임 부분일치로 사용자 목록을 검색합니다(거래 상대 검색용). */
  searchByUsername(keyword: string, limit: number): Promise<User[]>;
  create(user: User): Promise<User>;
  updatePoint(id: string, point: number): Promise<void>;
  /** 포인트를 원자적으로 delta만큼 증감합니다(delta 음수 가능, 하한 검증 없음). */
  incrementPoint(id: string, delta: number): Promise<void>;
  /** 잔액이 충분할 때만 원자적으로 차감합니다. 성공 시 true, 잔액 부족 시 false. */
  tryDeductPoint(id: string, amount: number): Promise<boolean>;
  updateBanStatus(id: string, bannedUntil: string | null, reason?: string | null): Promise<void>;
  /** 세그먼트 시작 시간보다 마지막 무료뽑기 시각이 이전일 때만 갱신합니다. 갱신 성공 시 true. segmentStartIso가 null이면 무제한. */
  claimFreeDrawIfEligible(id: string, nowIso: string, segmentStartIso: string | null): Promise<boolean>;
  updateLastFreeDraw(id: string, time: string): Promise<void>;
  updateProfile(id: string, username: string, avatarUrl: string | null, accessToken?: string | null, refreshToken?: string | null): Promise<void>;
  /** 치지직 OAuth 토큰 및 만료 시각을 갱신합니다(토큰 리프레시 결과 저장용). */
  updateTokens(id: string, accessToken: string | null, refreshToken: string | null, tokenExpiresAt: string | null): Promise<void>;
  updateRepresentativeCard(id: string, channelId: string | null): Promise<void>;
  findRankings(limit: number, keyword?: string): Promise<UserRanking[]>;
  count(): Promise<number>;
  /** 관리자용 유저 목록(닉네임/ID 부분검색 + 페이지네이션). keyword 비면 전체. */
  listUsers(keyword: string, limit: number, offset: number): Promise<{ users: User[]; total: number }>;
  /** blockerId가 blockedId를 차단합니다(멱등). */
  blockUser(blockerId: string, blockedId: string): Promise<void>;
  /** blockerId가 blockedId 차단을 해제합니다. */
  unblockUser(blockerId: string, blockedId: string): Promise<void>;
  /** blockerId가 차단한 사용자 목록을 반환합니다. */
  getBlockedUsers(blockerId: string): Promise<User[]>;
  /** blockerId가 blockedId를 차단했는지 여부. */
  isBlocked(blockerId: string, blockedId: string): Promise<boolean>;
}

// 유저 랭킹 응답용 확장 타입 (보유 카드 수 및 자산 합산 포함)
export interface UserRanking extends User {
  card_count: number;
  total_asset: number;
  rank?: number;
}

// 2. 스트리머 리포지토리 인터페이스
export interface IStreamerRepository {
  findAll(): Promise<Streamer[]>;
  findById(channelId: string): Promise<Streamer | null>;
  save(streamer: Streamer): Promise<void>;
  /** 지정한 별(0~5성) 슬롯의 커스텀 카드 이미지를 갱신합니다. star 미지정 시 0성. */
  updateCustomImage(channelId: string, imageUrl: string | null, star?: number): Promise<void>;
  /** 모든 별 슬롯(0~5성)의 커스텀 카드 이미지를 초기화합니다. */
  resetAllCustomImages(channelId: string): Promise<void>;
  updateImageBanStatus(channelId: string, isBanned: boolean): Promise<void>;
  findStreamerIndex(channelId: string): Promise<number>;
  findMaxSerialNumber(): Promise<number>;
  findAllocatedStreamerSerialNumbers(): Promise<number[]>;
  updateLiveStatus(channelId: string, isActive: boolean, followerCount: number): Promise<void>;
  incrementBroadcastCount(channelId: string): Promise<void>;
  /** 방송 중 누적 방송 시간(분)을 증가시킵니다. */
  incrementBroadcastMinutes(channelId: string, minutes: number): Promise<void>;
  incrementChatCount(channelId: string, count?: number): Promise<void>;
  /** since 이후의 시세 이력 포인트를 시간순으로 반환합니다(그래프용). */
  getValueHistory(channelId: string, sinceIso: string): Promise<ValueHistoryPoint[]>;
  count(): Promise<number>;
  /** 시세 재계산 결과만 원자적으로 반영합니다(chat_count 등 다른 컬럼은 건드리지 않음). */
  updateValueMetrics(channelId: string, prevValue: number, baseValue: number, activityScore: number, multiplier: number): Promise<void>;
  /** 스케줄러가 집계에 소비한 만큼만 chat_count를 차감합니다(집계 도중 유입된 채팅 보존). */
  decrementChatCount(channelId: string, amount: number): Promise<void>;
  /** 현재 시세를 value_history에 기록하고 오래된 이력을 정리합니다. */
  recordValueHistory(channelId: string, value: number): Promise<void>;
  /** 스케줄러 1주기 계산 결과를 일괄(단일 트랜잭션/RPC) 반영합니다. */
  bulkApplyScheduleResults(results: StreamerScheduleResult[]): Promise<void>;
  /** 여러 스트리머의 시세 이력을 한 번에 기록합니다. */
  bulkRecordValueHistory(points: { channel_id: string; value: number }[]): Promise<void>;
  /** 지정한 일수보다 오래된 시세 이력을 전 채널 일괄 정리합니다. */
  pruneValueHistory(olderThanDays: number): Promise<void>;
  /** 채널별 약 24시간 전 시세 맵을 반환합니다(등락률 계산용). */
  getValue24hAgoMap(): Promise<Record<string, number>>;
  /** 채널별 약 1시간 전 시세 맵을 반환합니다(1시간 등락 랭킹용). */
  getValue1hAgoMap(): Promise<Record<string, number>>;
  /** 스트리머를 삭제합니다(연관 카드/시세이력/신고는 FK CASCADE로 함께 제거). */
  delete(channelId: string): Promise<void>;
}

// 3. 쿠폰 리포지토리 인터페이스
export interface ICouponRepository {
  findByCode(code: string): Promise<Coupon | null>;
  create(coupon: Coupon): Promise<Coupon>;
  incrementUsedCount(couponId: number): Promise<void>;
  findAll(): Promise<Coupon[]>;
  checkCouponRedeemed(couponId: number, userId: string): Promise<boolean>;
  /**
   * 쿠폰 사용 로그를 기록합니다. UNIQUE(coupon_id, user_id) 제약을 이용해
   * 동시 중복 사용을 원자적으로 차단합니다. 신규 기록 시 true, 이미 사용한 경우 false.
   */
  logCouponRedeem(couponId: number, userId: string): Promise<boolean>;
}

// 4. 신고 리포지토리 인터페이스
export interface IReportRepository {
  findAll(): Promise<CardReport[]>;
  create(report: CardReport): Promise<CardReport>;
  updateStatus(reportId: number, status: 'resolved' | 'rejected'): Promise<void>;
  countPending(): Promise<number>;
}

// 5. 공지사항 리포지토리 인터페이스
export interface IAnnouncementRepository {
  findAll(): Promise<Announcement[]>;
  findActivePopups(): Promise<Announcement[]>;
  create(announcement: Announcement): Promise<Announcement>;
  /** 공지의 팝업 노출 여부 및 만료 시각을 갱신합니다. */
  updatePopup(id: number, isPopup: boolean, popupExpiresAt: string | null): Promise<void>;
  delete(id: number): Promise<void>;
}

// 거래 제안 한쪽의 제시 내용 (카드 묶음 + 포인트)
export interface TradeOffer {
  // star: 별(0~5성) 구분. 레거시 데이터는 star가 없을 수 있음(미지정 시 별 무관 처리)
  cards: { channel_id: string; star?: number; count: number }[];
  point: number;
}

export interface Trade {
  id?: number;
  sender_id: string;
  receiver_id: string;
  sender_offer: TradeOffer;
  receiver_offer: TradeOffer;
  // PENDING: 수신자 검토 대기, CONFIRMED: 수신자 동의(제안자 최종승인 대기), ACCEPTED: 체결 완료
  status: 'PENDING' | 'CONFIRMED' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';
  created_at?: string;
  completed_at?: string | null;
  // 조회 편의를 위한 비정규화 표시용 필드 (옵션)
  sender_username?: string;
  receiver_username?: string;
}

// 7. 거래(1:1 교환) 리포지토리 인터페이스
export interface ITradeRepository {
  create(trade: Pick<Trade, 'sender_id' | 'receiver_id' | 'sender_offer' | 'receiver_offer'>): Promise<Trade>;
  findById(id: number): Promise<Trade | null>;
  /** 해당 유저가 보내거나 받은 진행 중(PENDING/CONFIRMED) 거래 목록 */
  findActiveByUser(userId: string): Promise<Trade[]>;
  /** 해당 유저의 종료된(ACCEPTED/REJECTED/CANCELLED) 거래 이력 */
  findHistoryByUser(userId: string, limit: number): Promise<Trade[]>;
  updateStatus(id: number, status: Trade['status']): Promise<void>;
  /** 1단계: 수신자가 조건에 동의 (PENDING → CONFIRMED). actorId는 수신자여야 합니다. */
  confirm(id: number, actorId: string): Promise<{ ok: boolean; reason: string }>;
  /** 2단계: 제안자가 최종 승인하여 원자적으로 체결 (CONFIRMED → ACCEPTED). actorId는 제안자여야 합니다. */
  finalize(id: number, actorId: string): Promise<{ ok: boolean; reason: string }>;
  countCompleted(): Promise<number>;
}

// 인앱 알림
export interface AppNotification {
  id?: number;
  user_id: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at?: string;
}

export interface INotificationRepository {
  create(n: Pick<AppNotification, 'user_id' | 'title' | 'body' | 'link'>): Promise<void>;
  findByUser(userId: string, limit: number): Promise<AppNotification[]>;
  countUnread(userId: string): Promise<number>;
  markRead(id: number, userId: string): Promise<void>;
  markAllRead(userId: string): Promise<void>;
}

// 6. 유저 보유 카드 리포지토리 인터페이스
export interface IUserCardRepository {
  create(card: UserCard): Promise<UserCard>;
  findByUserId(userId: string): Promise<(UserCard & { streamer: Streamer })[]>;
  findLatestSerialNumber(channelId: string): Promise<number>;
  findAllocatedSerialNumbers(channelId: string): Promise<number[]>;
  deleteCards(userId: string, channelId: string, count: number): Promise<number>;
  count(): Promise<number>;
  /** 같은 스트리머·같은 별 카드 2장을 합성하여 1장(별+1)으로 만듭니다. */
  fuse(userId: string, channelId: string, star: number): Promise<{ ok: boolean; reason: string; newStar?: number }>;
  /** 특정 스트리머 카드의 보유자·별 목록(보상 계산용). */
  findByChannel(channelId: string): Promise<{ user_id: string; star: number }[]>;
  /** 특정 스트리머 카드를 모두 삭제하고 삭제된 수를 반환합니다. */
  deleteByChannel(channelId: string): Promise<number>;
}

// 8. 시스템 설정 리포지토리 인터페이스
export interface ISystemConfigRepository {
  get(key: string, defaultValue: string): Promise<string>;
  set(key: string, value: string): Promise<void>;
}
