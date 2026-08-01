// 치카포 데이터 액세스 레이어 추상화 인터페이스 정의

export interface User {
  id: string;
  username: string;
  avatar_url: string | null;
  role: 'USER' | 'ADMIN';
  point: number;
  last_free_draw: string | null;
  free_draw_tickets?: number;
  bonus_free_draw_tickets?: number;
  banned_until: string | null;
  ban_reason?: string | null;
  representative_card_channel_id?: string | null;
  representative_card_star?: number | null;
  status_message?: string | null;
  access_token?: string | null;
  refresh_token?: string | null;
  token_expires_at?: string | null; // 치지직 access_token 만료 시각(ISO)
  last_seen_at?: string | null;
  created_at?: string;
  is_deleted?: boolean;
  deleted_at?: string | null;
  identity_source?: 'current' | 'rejoined' | 'deleted_snapshot' | 'unknown';
}

export interface DeletedUserAccount {
  user_id: string;
  deleted_at: string | Date;
  username_snapshot?: string | null;
  avatar_url_snapshot?: string | null;
  point_at_deletion?: number | null;
}

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
  last_broadcast_at?: string | null;
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
  /** 치지직 API에서 불러온 프로필 이미지 URL (polled === true 일 때 다르면 업데이트) */
  logo_url?: string | null;
  /** 마지막 방송 감지 일시. polled === true 일 때만 반영합니다. */
  last_broadcast_at?: string | null;
}

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
  id?: number;
  code: string;
  // single: 선착순 발급 갯수(max_uses) 제한, multi: 기간 내 1인 1회 · 총량 무제한
  coupon_type: 'single' | 'multi';
  // 보상 종류: point(재화) | card(스트리머 카드) | cosmetic(코스메틱 아이템) | minigame_ticket(추가 미니게임 티켓) | free_draw_ticket(추가 무료 소환 티켓) | title(칭호)
  reward_type: CouponRewardType;
  points: number;                     // reward_type === 'point' 일 때 지급 재화량
  reward_channel_id: string | null;   // reward_type === 'card' 일 때 지급 스트리머 채널 ID
  reward_item_id?: number | null;     // reward_type === 'cosmetic'|'title' 일 때 지급 상점 아이템/칭호 ID
  reward_quantity: number;            // card/cosmetic/minigame_ticket/free_draw_ticket 일 때 지급 수량
  rewards?: CouponReward[];           // 다중 보상. 비어 있으면 위 레거시 단일 보상 컬럼을 사용합니다.
  max_uses: number;                   // single: 발급 갯수, multi: 0(무제한)
  used_count: number;
  expires_at: string | null;
  created_at?: string;
}

export interface CouponRedeemResult {
  ok: boolean;
  reason: string;
  reward_type?: CouponRewardType;
  points_added?: number;
  new_points?: number;
  reward_channel_id?: string | null;
  reward_item_id?: number | null;
  reward_quantity?: number;
  rewards?: CouponReward[];
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
  is_pinned: boolean;
  popup_expires_at: string | null;
  created_at?: string;
}

export interface CosmeticRef {
  id: number;
  name?: string | null;
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
  is_hidden?: boolean;
  is_locked?: boolean;
  favorite_order?: number | null;
  favorite_at?: string | null;
  border?: CosmeticRef | null;
  name_effect?: CosmeticRef | null;
}

export interface UserCardInventoryGroup {
  channel_id: string;
  star: number;
  count: number;
  hidden_count: number;
  locked_count: number;
  favorite_count: number;
  first_card_id: number | null;
  favorite_order: number | null;
  streamer: Streamer;
}

// 1. 유저 리포지토리 인터페이스
export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  /** 여러 사용자를 ID 배열로 한 번에 조회합니다(N+1 방지). */
  findByIds(ids: string[]): Promise<User[]>;
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
  /** 현재 무료 소환 구간까지 충전분을 반영하고 최신 유저 정보를 반환합니다. */
  syncFreeDrawTickets(id: string, segmentStartIso: string | null, maxStack: number, intervalHours: number): Promise<User | null>;
  /** 쿠폰/보상용 추가 무료 소환 티켓을 누적 지급합니다. */
  addBonusFreeDrawTickets(id: string, amount: number): Promise<void>;
  /** 회원 탈퇴: 계정과 계정에 종속된 개인 데이터를 삭제/비식별 처리합니다. */
  deleteAccount(id: string): Promise<void>;
  /** 탈퇴 후 재가입 계정의 상호작용 제한 및 감사 추적용 tombstone 조회. */
  findDeletedAccount(id: string): Promise<DeletedUserAccount | null>;
  updateLastFreeDraw(id: string, time: string): Promise<void>;
  updateProfile(id: string, username: string, avatarUrl: string | null, accessToken?: string | null, refreshToken?: string | null): Promise<void>;
  /** 치지직 OAuth 토큰 및 만료 시각을 갱신합니다(토큰 리프레시 결과 저장용). */
  updateTokens(id: string, accessToken: string | null, refreshToken: string | null, tokenExpiresAt: string | null): Promise<void>;
  updateLastSeen(id: string, seenAt: string): Promise<void>;
  updateRepresentativeCard(id: string, channelId: string | null, star: number | null): Promise<void>;
  updateStatusMessage(id: string, message: string | null): Promise<void>;
  findRankings(limit: number, keyword?: string, options?: { mode?: 'total' | 'cards'; channelId?: string; star?: number | null }): Promise<UserRanking[]>;
  count(): Promise<number>;
  /** 관리자용 유저 목록(닉네임/ID 부분검색 + 페이지네이션). keyword 비면 전체. */
  listUsers(keyword: string, limit: number, offset: number): Promise<{ users: User[]; total: number }>;
  /** 제재된 유저 목록(닉네임/ID 부분검색 + 정렬 + 페이지네이션). */
  listBannedUsers(keyword: string, sortBy: string, sortOrder: 'asc' | 'desc', limit: number, offset: number): Promise<{ users: User[]; total: number }>;
  /** blockerId가 blockedId를 차단합니다(멱등). */
  blockUser(blockerId: string, blockedId: string): Promise<void>;
  /** blockerId가 blockedId 차단을 해제합니다. */
  unblockUser(blockerId: string, blockedId: string): Promise<void>;
  /** blockerId가 차단한 사용자 목록을 반환합니다. */
  getBlockedUsers(blockerId: string): Promise<User[]>;
  /** blockerId가 blockedId를 차단했는지 여부. */
  isBlocked(blockerId: string, blockedId: string): Promise<boolean>;
}

export interface ITitleRepository {
  findAll(): Promise<UserTitle[]>;
  findById(id: number): Promise<UserTitle | null>;
  findByUserId(userId: string): Promise<UserTitle[]>;
  findByUserIds(userIds: string[]): Promise<Record<string, UserTitle[]>>;
  create(title: Pick<UserTitle, 'name' | 'description' | 'css' | 'icon_name' | 'icon_color'>): Promise<UserTitle>;
  update(id: number, title: Partial<Pick<UserTitle, 'name' | 'description' | 'css' | 'icon_name' | 'icon_color'>>): Promise<UserTitle | null>;
  delete(id: number): Promise<void>;
  award(userId: string, titleId: number): Promise<void>;
  awardMany(userIds: string[], titleId: number): Promise<void>;
  revoke(userId: string, titleId: number): Promise<void>;
  revokeMany(userIds: string[], titleId: number): Promise<void>;
  equip(userId: string, titleId: number | null): Promise<boolean>;
}

// 유저 랭킹 응답용 확장 타입 (보유 카드 수 및 자산 합산 포함)
export interface UserRanking extends User {
  card_count: number;
  cards_value: number;
  total_asset: number;
  rank?: number;
}

/** 카드/보관함 화면에서 방송 배지만 갱신할 때 사용하는 경량 상태 행입니다. */
export interface StreamerLiveStatus {
  channel_id: string;
  is_active: boolean;
}

// 2. 스트리머 리포지토리 인터페이스
export interface IStreamerRepository {
  findAll(): Promise<Streamer[]>;
  /** 전체 프로필/이미지를 제외하고 채널별 방송 여부만 조회합니다. */
  findLiveStatuses(): Promise<StreamerLiveStatus[]>;
  /** 랭킹·검색 목록용 최소 필드만 조회합니다(커스텀 별 이미지 등 무거운 필드 제외). */
  findRankingBase(limit?: number): Promise<Streamer[]>;
  findById(channelId: string): Promise<Streamer | null>;
  /** 여러 스트리머를 channel_id 배열로 한 번에 조회합니다(N+1 방지). */
  findByIds(channelIds: string[]): Promise<Streamer[]>;
  save(streamer: Streamer): Promise<void>;
  /** 지정한 별(0~5성) 슬롯의 커스텀 카드 이미지를 갱신합니다. star 미지정 시 0성. */
  updateCustomImage(channelId: string, imageUrl: string | null, star?: number): Promise<void>;
  /** 모든 별 슬롯(0~5성)의 커스텀 카드 이미지를 초기화합니다. */
  resetAllCustomImages(channelId: string): Promise<void>;
  updateImageBanStatus(channelId: string, isBanned: boolean): Promise<void>;
  /** 본인 카드 삭제 요청 등으로 재등록이 금지된 채널인지 확인합니다. */
  isRegistrationBlocked(channelId: string): Promise<boolean>;
  /** 삭제된 스트리머 채널을 재등록 금지 목록에 기록합니다. */
  blockRegistration(channelId: string, reason: string, blockedBy?: string | null): Promise<void>;
  findStreamerIndex(channelId: string): Promise<number>;
  findMaxSerialNumber(): Promise<number>;
  findAllocatedStreamerSerialNumbers(): Promise<number[]>;
  updateLiveStatus(channelId: string, isActive: boolean, followerCount: number): Promise<void>;
  incrementBroadcastCount(channelId: string): Promise<void>;
  /** 방송 중 누적 방송 시간(분)을 증가시킵니다. */
  incrementBroadcastMinutes(channelId: string, minutes: number): Promise<void>;
  incrementChatCount(channelId: string, count?: number): Promise<void>;
  /** 여러 채널의 채팅 카운트를 한 번에 증가시킵니다. */
  bulkIncrementChatCounts(counts: { channel_id: string; count: number }[]): Promise<void>;
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
  /** 지정 채널들의 약 24시간 전 시세 맵을 반환합니다(랭킹 목록 최적화용). */
  getValue24hAgoMapForChannels(channelIds: string[]): Promise<Record<string, number>>;
  /** 채널별 약 1시간 전 시세 맵을 반환합니다(1시간 등락 랭킹용). */
  getValue1hAgoMap(): Promise<Record<string, number>>;
  /** 지정 채널들의 약 1시간 전 시세 맵을 반환합니다(랭킹 목록 최적화용). */
  getValue1hAgoMapForChannels(channelIds: string[]): Promise<Record<string, number>>;
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
  /** 쿠폰 사용 로그, 사용 횟수, 보상 지급을 단일 트랜잭션/RPC로 처리합니다. */
  redeemAtomic(couponId: number, userId: string): Promise<CouponRedeemResult>;
}

// 4. 신고 리포지토리 인터페이스
export interface IReportRepository {
  findAll(): Promise<CardReport[]>;
  findById(reportId: number): Promise<CardReport | null>;
  create(report: CardReport): Promise<CardReport>;
  updateStatus(reportId: number, status: 'resolved' | 'rejected'): Promise<void>;
  countPending(): Promise<number>;
  /** 동일 신고자가 같은 스트리머 카드(별 포함)에 대해 이미 미처리(pending) 신고를 했는지 여부 (중복 신고 차단용) */
  hasPendingReport(reporterId: string, channelId: string, star: number): Promise<boolean>;
}

// 5. 공지사항 리포지토리 인터페이스
export interface IAnnouncementRepository {
  findAll(): Promise<Announcement[]>;
  findActivePopups(): Promise<Announcement[]>;
  create(announcement: Announcement): Promise<Announcement>;
  /** 공지의 팝업 노출 여부 및 만료 시각을 갱신합니다. */
  updatePopup(id: number, isPopup: boolean, popupExpiresAt: string | null): Promise<void>;
  update(id: number, announcement: Partial<Announcement>): Promise<Announcement>;
  delete(id: number): Promise<void>;
}

// 거래 제안 한쪽의 제시 내용 (카드 묶음 + 포인트)
export interface TradeOffer {
  // star: 별(0~5성) 구분. 레거시 데이터는 star가 없을 수 있음(미지정 시 별 무관 처리)
  cards: {
    channel_id: string;
    star?: number;
    count: number;
    streamer_name?: string | null;
    streamer_logo_url?: string | null;
    cosmetics?: {
      border?: { id: number; name?: string | null } | null;
      name_effect?: { id: number; name?: string | null } | null;
    }[];
  }[];
  point: number;
  /** true일 때만 장착 코스메틱을 카드와 함께 이전합니다. 기본값은 false입니다. */
  with_cosmetics?: boolean;
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
  updated_at?: string;
  completed_at?: string | null;
  // 조회 편의를 위한 비정규화 표시용 필드 (옵션)
  sender_username?: string;
  receiver_username?: string;
}

export interface AdminTradeListOptions {
  page: number;
  limit: number;
  search?: string;
  status?: Trade['status'] | 'ALL';
}

export interface AdminTradeListResult {
  items: Trade[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

// 7. 거래(1:1 교환) 리포지토리 인터페이스
export interface ITradeRepository {
  create(trade: Pick<Trade, 'sender_id' | 'receiver_id' | 'sender_offer' | 'receiver_offer'>): Promise<Trade>;
  findById(id: number): Promise<Trade | null>;
  /** 해당 유저가 보내거나 받은 진행 중(PENDING/CONFIRMED) 거래 목록 */
  findActiveByUser(userId: string): Promise<Trade[]>;
  /** 해당 유저의 종료된(ACCEPTED/REJECTED/CANCELLED) 거래 이력 */
  findHistoryByUser(userId: string, limit: number): Promise<Trade[]>;
  /** 관리자용 전체 거래 이력 조회. 검색어가 있으면 참여 유저 후보를 먼저 좁힌 뒤 거래 테이블을 조회합니다. */
  listForAdmin(options: AdminTradeListOptions): Promise<AdminTradeListResult>;
  updateStatus(id: number, status: Trade['status']): Promise<void>;
  /** 1단계: 수신자가 조건에 동의 (PENDING → CONFIRMED). actorId는 수신자여야 합니다. */
  confirm(id: number, actorId: string, options?: { receiverWithCosmetics?: boolean }): Promise<{ ok: boolean; reason: string }>;
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
  group_key?: string | null;
  is_read: boolean;
  deleted_at?: string | null;
  created_at?: string;
}

export interface INotificationRepository {
  create(n: Pick<AppNotification, 'user_id' | 'title' | 'body' | 'link'> & { group_key?: string | null }): Promise<AppNotification>;
  upsertByGroupKey(n: Pick<AppNotification, 'user_id' | 'title' | 'body' | 'link'> & { group_key: string }): Promise<AppNotification>;
  findByUser(userId: string, limit: number): Promise<AppNotification[]>;
  countUnread(userId: string): Promise<number>;
  markRead(id: number, userId: string): Promise<void>;
  markGroupRead(userId: string, groupKey: string): Promise<void>;
  markAllRead(userId: string): Promise<void>;
  hideRead(id: number, userId: string): Promise<boolean>;
}

// 6. 유저 보유 카드 리포지토리 인터페이스
export interface IUserCardRepository {
  create(card: UserCard): Promise<UserCard>;
  /** 무료권/포인트 차감, 시리얼 채번, 카드 생성을 단일 트랜잭션/RPC로 처리합니다. */
  drawAtomic(
    userId: string,
    channelId: string,
    drawCost: number,
    nowIso: string,
    segmentStartIso: string | null,
    maxFreeTickets: number,
    intervalHours: number
  ): Promise<{
    ok: boolean;
    reason: string;
    card?: UserCard;
    is_free?: boolean;
    free_draw_source?: 'unlimited' | 'reset' | 'bonus' | 'point';
    points_left?: number;
    free_draw_tickets_left?: number;
    bonus_free_draw_tickets_left?: number;
  }>;
  findByUserId(userId: string): Promise<(UserCard & { streamer: Streamer })[]>;
  findInventoryGroupsByUserId(userId: string): Promise<UserCardInventoryGroup[]>;
  findLatestSerialNumber(channelId: string): Promise<number>;
  findAllocatedSerialNumbers(channelId: string): Promise<number[]>;
  deleteCards(userId: string, channelId: string, count: number): Promise<number>;
  count(): Promise<number>;
  /** 대상 카드의 별을 올리고 같은 스트리머 카드를 재료로 소모합니다. */
  fuse(
    userId: string,
    channelId: string,
    star: number,
    materials?: { star: number; count: number }[],
    reservedByStar?: Record<string, number>
  ): Promise<{ ok: boolean; reason: string; newStar?: number }>;
  /** 특정 스트리머 카드의 보유자·별 목록(보상 계산용). */
  findByChannel(channelId: string): Promise<{
    user_id: string;
    star: number;
    id?: number;
    serial_number?: number;
    border_item_id?: number | null;
    name_effect_item_id?: number | null;
  }[]>;
  countByChannelIds(channelIds: string[]): Promise<Record<string, { card_count: number; affected_users: number }>>;
  /** 특정 스트리머 카드를 모두 삭제하고 삭제된 수를 반환합니다. */
  deleteByChannel(channelId: string): Promise<number>;
  /** 카드 삭제와 판매 포인트 가산을 단일 트랜잭션/RPC로 처리합니다. */
  sellCardsAtomic(userId: string, actions: { channelId: string; star: number; count: number; baseValue: number }[]): Promise<number>;
  updateVisibility(userId: string, cardId: number, hidden: boolean): Promise<boolean>;
  updateVisibilityByGroup(userId: string, channelId: string, star: number, hidden: boolean): Promise<number>;
  setFavorite(userId: string, cardId: number, favorite: boolean): Promise<boolean>;
  setLocked(userId: string, cardId: number, locked: boolean): Promise<boolean>;
}

// 8. 시스템 설정 리포지토리 인터페이스
export interface ISystemConfigRepository {
  get(key: string, defaultValue: string): Promise<string>;
  set(key: string, value: string): Promise<void>;
}

// 9. 오픈마켓 (유저 간 카드 거래 장터)
export interface MarketListing {
  id?: number;
  seller_id: string;
  user_card_id: number;
  price: number;
  status: 'PENDING' | 'SOLD' | 'CANCELLED' | 'AUCTION_ENDED';
  buyer_id: string | null;
  listing_type?: 'fixed' | 'auction';
  buy_now_price?: number | null;
  starting_bid?: number | null;
  current_bid?: number | null;
  current_bidder_id?: string | null;
  my_bid?: number | null;
  /** 판매자/거래 당사자에게만 제공되는 최고 제시 입찰가. 공개 목록/전체 거래 이력에는 포함하지 않습니다. */
  highest_bid?: number | null;
  /** 판매자/거래 당사자에게만 제공되는 실제 경매 낙찰가. 공개 목록/전체 거래 이력에는 포함하지 않습니다. */
  winning_price?: number | null;
  auction_ends_at?: string | null;
  bid_reserved?: number;
  fee: number;
  fee_rate?: number;
  settled_amount: number;
  with_cosmetics?: boolean;
  seller_hidden_at?: string | null;
  created_at?: string;
  updated_at?: string;
  // 비정규화 조인 정보
  seller_username?: string;
  buyer_username?: string;
  current_bidder_username?: string;
  auction_result?: {
    winning_bid: number;
    winning_price: number;
    second_bid: number | null;
    bidders: Array<{
      user_id: string;
      username?: string | null;
      amount: number;
      is_winner: boolean;
    }>;
  };
  card?: UserCard & { streamer: Streamer };
}

export interface MarketWatch {
  id?: number;
  user_id: string;
  channel_id: string;
  star: number | null;
  max_price: number | null;
  created_at?: string;
  streamer?: Streamer | null;
}

export interface IMarketRepository {
  create(listing: {
    seller_id: string;
    user_card_id: number;
    price: number;
    with_cosmetics?: boolean;
    listing_type?: 'fixed' | 'auction';
    buy_now_price?: number | null;
    starting_bid?: number | null;
    auction_ends_at?: string | null;
    fee_rate?: number;
  }): Promise<MarketListing>;
  findById(id: number): Promise<MarketListing | null>;
  hasBids(listingId: number): Promise<boolean>;
  /** 판매자가 판매 중인 매물을 취소합니다. 입찰이 생긴 경매는 같은 트랜잭션 안에서 거부해야 합니다. */
  cancelBySeller(listingId: number, sellerId: string): Promise<{ ok: boolean; reason: 'OK' | 'NOT_FOUND' | 'FORBIDDEN' | 'NOT_PENDING' | 'AUCTION_HAS_BIDS' }>;
  /** 비공개 화면에서 사용할 매물별 최고 입찰가를 조회합니다. */
  getHighestBids(listingIds: number[]): Promise<Record<number, number>>;
  /** 판매 중인 카드의 이중 지출 방지용 에스크로 판별 (PENDING인 카드 ID 목록) */
  findPendingCardIdsByUser(userId: string): Promise<number[]>;
  /** 마켓 목록 조회 (유사도 검색 필터 및 페이지네이션, 정렬 지원) */
  listActive(options: {
    page: number;
    limit: number;
    search?: string;
    sort: 'latest' | 'oldest' | 'price_desc' | 'price_asc' | 'ending_soon' | 'bid_desc';
    type?: 'all' | 'fixed' | 'auction' | 'bidding';
    bidderId?: string;
  }): Promise<{ listings: MarketListing[]; total: number }>;
  /** 내 판매 목록 관리 */
  listByUser(userId: string): Promise<MarketListing[]>;
  hideForSeller(id: number, sellerId: string): Promise<boolean>;
  updateStatus(id: number, status: MarketListing['status'], extra?: { buyer_id?: string; fee?: number; settled_amount?: number }): Promise<void>;
  /**
   * 원자적 구매 처리 (트랜잭션)
   * 성공 시 { ok: true, settled_amount, seller_id, price }, 실패 시 { ok: false, reason } 반환
   */
  buyAtomic(listingId: number, buyerId: string): Promise<{ ok: boolean; reason: string; settled_amount?: number; seller_id?: string; price?: number }>;
  /** 내가 판매 완료했거나 구매 완료한 거래 로그 조회 */
  listHistory(userId: string): Promise<MarketListing[]>;
  /** 전체 유저의 완료된(SOLD) 오픈마켓 거래 이력 (공개 거래 장부). */
  listAllHistory(limit: number): Promise<MarketListing[]>;
  /** 특정 스트리머 카드가 오픈마켓에서 최근 판매 완료된 체결가 조회 */
  getRecentPrice(channelId: string): Promise<number | null>;
  placeBid(listingId: number, bidderId: string, amount: number): Promise<{ ok: boolean; reason: string; auction_ends_at?: string | null }>;
  finishExpiredAuctions(nowIso: string): Promise<MarketListing[]>;
  cancelStaleListings(cutoffIso: string, limit?: number): Promise<MarketListing[]>;
  upsertWatch(watch: { user_id: string; channel_id: string; star: number | null; max_price: number | null }): Promise<MarketWatch>;
  deleteWatch(userId: string, id: number): Promise<boolean>;
  listWatches(userId: string): Promise<MarketWatch[]>;
  findMatchingWatches(listing: MarketListing): Promise<MarketWatch[]>;
}

// 10. 미니게임 티켓 및 세션 데이터 인터페이스
export type MinigameType = 'quiz' | 'puzzle' | 'match' | 'value_duel' | 'crop_detective';

export interface UserMinigameTicket {
  user_id: string;
  /** 자동 충전되는 기본 티켓. 최대 5장까지 충전됩니다. */
  current_tickets: number;
  /** 쿠폰 등으로 지급되는 초과 보너스 티켓. 5장 상한을 받지 않고 먼저 소모됩니다. */
  bonus_tickets: number;
  last_charged_at: string;
  updated_at?: string;
}

export type RefreshedMinigameTicket = UserMinigameTicket & {
  seconds_until_next_ticket: number;
};

export interface MinigameSession {
  id: string;
  user_id: string;
  game_type: MinigameType;
  status: 'STARTED' | 'COMPLETED' | 'EXPIRED';
  target_data: string; // JSON string
  ticket_spent_type?: 'BASE' | 'BONUS' | 'NONE' | null;
  created_at?: string;
  completed_at?: string | null;
  earned_points?: number;
  validation_version?: number;
  progress_data?: string;
  progress_revision?: number;
  expires_at?: string | null;
  result_data?: string | null;
}

export type MinigameRoundOutcomeResult = {
  ok: boolean;
  reason?: string;
  session?: MinigameSession;
  duplicate?: boolean;
};

export type MinigameCompletionResult =
  | {
      ok: true;
      /** 이번 호출이 세션과 포인트를 최초로 정산했는지 여부입니다. */
      settledNow: boolean;
      newPoints: number;
      /** 호출 인자가 아닌 DB에 확정 저장된 보상입니다. */
      earnedPoints: number;
      /** 호출 인자가 아닌 DB에 확정 저장된 결과입니다. */
      resultData: string | null;
    }
  | {
      ok: false;
      reason: string;
    };

export interface IMinigameRepository {
  getTicketStatus(userId: string): Promise<UserMinigameTicket>;
  refreshTicketStatus(userId: string, chargeIntervalMinutes: number): Promise<RefreshedMinigameTicket>;
  updateTickets(userId: string, currentTickets: number, lastChargedAt: string): Promise<void>;
  addBonusTickets(userId: string, amount: number): Promise<UserMinigameTicket>;
  startSession(session: MinigameSession, chargeIntervalMinutes?: number): Promise<{ ok: boolean; reason?: string }>;
  recordRoundOutcome(
    sessionId: string,
    userId: string,
    round: number,
    selectedChannelId: string | null,
    /** 다음 라운드의 서버 마감 시각. 마지막 라운드는 null을 명시합니다. */
    nextRoundDeadlineAt: string | null
  ): Promise<MinigameRoundOutcomeResult>;
  completeSession(
    sessionId: string,
    earnedPoints: number,
    resultData?: string
  ): Promise<MinigameCompletionResult>;
  findSessionById(id: string): Promise<MinigameSession | null>;
  findActiveStartedSession(userId: string, gameType: MinigameType): Promise<MinigameSession | null>;
  expireSessions(olderThanMinutes: number, limit?: number): Promise<void>;
}
