import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middlewares/auth';
import { adminMiddleware } from '../middlewares/admin';
import { banCheckMiddleware } from '../middlewares/banCheck';
import { uploadCustomImage, deleteOwnCustomImage } from '../controllers/streamerController';
import { reportStreamerCard } from '../controllers/reportController';
import { proxyImage } from '../controllers/imageProxyController';
import { getResetInfo, resetData, listOrphanImages, deleteOrphanImages } from '../controllers/adminMaintenanceController';
import { getChzzkAuthUrl, handleChzzkCallback, logout } from '../controllers/chzzkAuthController';
import {
  resetStreamerImage,
  banStreamerImage,
  unbanStreamerImage,
  deleteStreamerCards,
  banUser,
  unbanUser,
  getBannedUsers,
  bulkUpdateBans,
  getReports,
  resolveReport,
  getFreeDrawInterval,
  setFreeDrawInterval,
  getDrawCost,
  setDrawCost,
  getMinigameTicketChargeInterval,
  setMinigameTicketChargeInterval,
  getMaintenanceStatus,
  setMaintenanceStatus,
  resetUserStatusMessage
} from '../controllers/adminController';
import { claimCoupon, createCoupon } from '../controllers/couponController';
import {
  createAnnouncement,
  getAnnouncements,
  getActivePopups,
  deleteAnnouncement,
  setAnnouncementPopup,
  updateAnnouncement
} from '../controllers/announcementController';
import {
  getVapidPublicKey,
  subscribePush,
  scheduleNotification,
  getScheduledNotifications,
  getSentNotifications,
  updateScheduledNotification,
  deleteScheduledNotification,
  sendTestPush
} from '../controllers/pushController';
import { claimTutorialGachaTicket, getTutorialProgress, markTutorialCompleted } from '../controllers/tutorialController';

import {
  getUserMe,
  deleteMyAccount,
  getUserRankings,
  getStreamerRankings,
  getUserCards,
  updateMyStatusMessage,
  updateMyCardVisibility,
  updateMyCardFavorite,
  drawCard,
  searchChzzkStreamer,
  registerStreamer,
  sellCards
} from '../controllers/playController';
import {
  createTrade,
  getActiveTrades,
  confirmTrade,
  finalizeTrade,
  rejectTrade,
  getTradeHistory
} from '../controllers/tradeController';
import {
  listActiveListings,
  listMyListings,
  createListing,
  cancelListing,
  purchaseListing,
  placeBid,
  listMarketWatches,
  upsertMarketWatch,
  deleteMarketWatch,
  listMarketHistory
} from '../controllers/marketController';
import {
  getStreamerDetail,
  setRepresentativeCard,
  searchUsers,
  getUserCollection,
  getUserProfile,
  getMyBlocks,
  blockUser,
  unblockUser,
  fuseCards
} from '../controllers/playController';
import {
  getAdminStats,
  getCoupons,
  listUsers
} from '../controllers/adminController';
import {
  listTitles,
  createTitle,
  updateTitle,
  deleteTitle,
  awardTitle,
  awardTitleToMany,
  revokeTitle,
  revokeTitleFromMany,
  equipMyTitle
} from '../controllers/titleController';
import {
  getNotifications,
  streamNotifications,
  markNotificationRead,
  markAllNotificationsRead
} from '../controllers/notificationController';
import {
  getShopItems,
  getMyCosmetics,
  getMyPurchases,
  buyShopItem,
  equipToCard,
  unequipFromCard,
  adminGetShopItems,
  adminCreateShopItem,
  adminUpdateShopItem,
  adminResetPurchases
} from '../controllers/shopController';
import {
  getMinigameStatus,
  startMinigame,
  submitMinigameResult
} from '../controllers/minigameController';
import { streamerRepository, titleRepository } from '../repositories';

import { rateLimit } from '../middlewares/rateLimit';
import { maintenanceCheckMiddleware } from '../middlewares/maintenanceCheck';

const router = Router();
router.use(maintenanceCheckMiddleware);

// 라우트별 레이트 리미터 (IP 기준 고정 윈도우)
const drawLimiter = rateLimit({ windowMs: 60_000, max: 30, key: 'draw' });
const searchLimiter = rateLimit({ windowMs: 60_000, max: 30, key: 'search' });
const tradeLimiter = rateLimit({ windowMs: 60_000, max: 30, key: 'trade' });
const couponLimiter = rateLimit({ windowMs: 60_000, max: 15, key: 'coupon' });
const authLimiter = rateLimit({ windowMs: 60_000, max: 15, key: 'auth' });
const registerLimiter = rateLimit({ windowMs: 60_000, max: 10, key: 'register' });
const reportLimiter = rateLimit({ windowMs: 60_000, max: 10, key: 'report' });

// Multer 파일 메모리 스토리지 세팅 (최대 5MB 제한 + 이미지 MIME 사전 필터)
const ALLOWED_UPLOAD_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // 비이미지 업로드를 5MB 버퍼링 전에 조기 차단 (sharp 처리 이전 1차 방어)
    if (ALLOWED_UPLOAD_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error('이미지 파일(JPEG/PNG/WebP/GIF/AVIF)만 업로드할 수 있습니다.'));
  }
});

// Multer 에러(용량 초과·비이미지 등)를 500이 아닌 400 JSON으로 일관 처리하는 래퍼
const uploadSingleImage = (req: any, res: any, next: any) => {
  upload.single('image')(req, res, (err: any) => {
    if (err) {
      const msg = (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE')
        ? '이미지 용량은 5MB 이하만 업로드할 수 있습니다.'
        : (err.message || '파일 업로드 중 오류가 발생했습니다.');
      return res.status(400).json({ error: 'BadRequest', message: msg });
    }
    next();
  });
};

// ==========================================
// 헬스체크 엔드포인트 (/api/health)
// ==========================================
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: '치카포 백엔드 API가 정상 작동 중입니다.',
    timestamp: new Date().toISOString()
  });
});

// ==========================================
// 0. 치지직 OpenAPI OAuth 로그인 및 기본 유저 정보
// ==========================================
router.get('/auth/chzzk/url', getChzzkAuthUrl);
router.post('/auth/chzzk/callback', authLimiter, handleChzzkCallback);
// 로그아웃 — httpOnly 세션 쿠키 제거
router.post('/auth/logout', logout);
router.get('/image-proxy', proxyImage);
router.get('/users/me', authMiddleware, banCheckMiddleware, getUserMe);
router.put('/users/me/status-message', authMiddleware, banCheckMiddleware, updateMyStatusMessage);
router.delete('/users/me', authMiddleware, deleteMyAccount);
router.put('/users/me/title', authMiddleware, banCheckMiddleware, equipMyTitle);
router.get('/users/ranking', getUserRankings);
router.get('/users/search', authMiddleware, banCheckMiddleware, searchLimiter, searchUsers);
router.get('/users/me/cards', authMiddleware, banCheckMiddleware, getUserCards);
router.get('/users/:user_id/collection', authMiddleware, banCheckMiddleware, getUserCollection);
router.get('/users/:user_id/profile', authMiddleware, banCheckMiddleware, getUserProfile);
router.get('/tutorial/progress', authMiddleware, banCheckMiddleware, getTutorialProgress);
router.post('/tutorial/progress', authMiddleware, banCheckMiddleware, markTutorialCompleted);
router.post('/tutorial/rewards/gacha-ticket', authMiddleware, banCheckMiddleware, claimTutorialGachaTicket);
// 유저 차단 관리
router.get('/users/me/blocks', authMiddleware, banCheckMiddleware, getMyBlocks);
router.post('/users/me/blocks', authMiddleware, banCheckMiddleware, blockUser);
router.delete('/users/me/blocks/:user_id', authMiddleware, banCheckMiddleware, unblockUser);
router.post('/cards/draw', authMiddleware, banCheckMiddleware, drawLimiter, drawCard);
router.patch('/cards/:card_id/visibility', authMiddleware, banCheckMiddleware, updateMyCardVisibility);
router.patch('/cards/:card_id/favorite', authMiddleware, banCheckMiddleware, updateMyCardFavorite);
router.post('/cards/sell', authMiddleware, banCheckMiddleware, sellCards);
router.post('/cards/fuse', authMiddleware, banCheckMiddleware, fuseCards);

// 상점 (코스메틱: 테두리 / 이름 이펙트)
router.get('/shop/items', authMiddleware, getShopItems);
router.get('/shop/inventory', authMiddleware, getMyCosmetics);
router.get('/shop/purchases', authMiddleware, getMyPurchases);
router.post('/shop/buy', authMiddleware, banCheckMiddleware, buyShopItem);
router.post('/cards/:card_id/equip', authMiddleware, banCheckMiddleware, equipToCard);
router.post('/cards/:card_id/unequip', authMiddleware, banCheckMiddleware, unequipFromCard);
// 관리자 상점 관리
router.get('/admin/shop/items', authMiddleware, adminMiddleware, adminGetShopItems);
router.post('/admin/shop/items', authMiddleware, adminMiddleware, adminCreateShopItem);
router.post('/admin/shop/items/:id/reset-purchases', authMiddleware, adminMiddleware, adminResetPurchases);
router.post('/admin/shop/items/:id', authMiddleware, adminMiddleware, adminUpdateShopItem);

// 신규 스트리머 검색 및 카드 등록 API
router.get('/streamers/search', authMiddleware, banCheckMiddleware, searchLimiter, searchChzzkStreamer);
router.post('/streamers/register', authMiddleware, banCheckMiddleware, registerLimiter, registerStreamer);

// 대표 카드 설정
router.post('/users/me/representative', authMiddleware, banCheckMiddleware, setRepresentativeCard);

// 인앱 알림함
router.get('/notifications', authMiddleware, banCheckMiddleware, getNotifications);
router.get('/notifications/stream', authMiddleware, banCheckMiddleware, streamNotifications);
router.post('/notifications/read-all', authMiddleware, banCheckMiddleware, markAllNotificationsRead);
router.post('/notifications/:id/read', authMiddleware, banCheckMiddleware, markNotificationRead);

// 1:1 교환(Trade) API (2단계 Double-Lock: confirm → finalize)
router.post('/trades', authMiddleware, banCheckMiddleware, tradeLimiter, createTrade);
router.get('/trades/active', authMiddleware, banCheckMiddleware, getActiveTrades);
router.get('/trades/history', authMiddleware, banCheckMiddleware, getTradeHistory);
router.post('/trades/:trade_id/confirm', authMiddleware, banCheckMiddleware, confirmTrade);
router.post('/trades/:trade_id/finalize', authMiddleware, banCheckMiddleware, finalizeTrade);
router.post('/trades/:trade_id/reject', authMiddleware, banCheckMiddleware, rejectTrade);

// 오픈마켓 API
router.get('/market/listings', authMiddleware, listActiveListings);
router.get('/market/my', authMiddleware, listMyListings);
router.get('/market/history', authMiddleware, listMarketHistory);
router.get('/market/watches', authMiddleware, banCheckMiddleware, listMarketWatches);
router.post('/market/watches', authMiddleware, banCheckMiddleware, upsertMarketWatch);
router.delete('/market/watches/:id', authMiddleware, banCheckMiddleware, deleteMarketWatch);
router.post('/market/list', authMiddleware, banCheckMiddleware, createListing);
router.post('/market/cancel/:id', authMiddleware, banCheckMiddleware, cancelListing);
router.post('/market/buy/:id', authMiddleware, banCheckMiddleware, purchaseListing);
router.post('/market/bid/:id', authMiddleware, banCheckMiddleware, placeBid);

// ==========================================
// 미니게임 API (티켓 충전식 포인트 획득 기능)
// ==========================================
router.get('/minigames/status', authMiddleware, banCheckMiddleware, getMinigameStatus);
router.post('/minigames/start', authMiddleware, banCheckMiddleware, startMinigame);
router.post('/minigames/submit', authMiddleware, banCheckMiddleware, submitMinigameResult);

// ==========================================

// ==========================================
// 1. 스트리머 관련 기능
// ==========================================
// 전체 스트리머 정보 목록 조회 (시세 탑3 리딩 등 활용)
// 여러 화면(메인·랭킹·가챠·관리자)에서 빈번히 호출되므로 짧은 TTL 메모리 캐시 적용
let streamersCache: { data: any[]; expiresAt: number } | null = null;
const STREAMERS_CACHE_TTL = 15_000; // 15초

const loadStreamerValueMap = async (
  label: string,
  loader: () => Promise<Record<string, number>>
): Promise<Record<string, number>> => {
  try {
    return await loader();
  } catch (err: any) {
    console.error(`[Streamers] ${label} 시세 이력 조회 실패, 현재 시세 기준으로 폴백합니다:`, err?.message || err);
    return {};
  }
};

// 칭호는 거의 변하지 않으므로 별도 캐시로 Supabase 조회 빈도를 크게 낮추고,
// 일시적 조회 실패(fetch failed) 시에는 마지막 성공 결과(stale)로 응답해 사용자 영향을 없앱니다.
let titlesCache: { data: Record<string, any[]>; expiresAt: number } | null = null;
const STREAMER_TITLES_CACHE_TTL = 5 * 60_000; // 5분

const loadStreamerTitles = async (channelIds: string[]) => {
  const now = Date.now();
  if (titlesCache && titlesCache.expiresAt > now) {
    return titlesCache.data;
  }
  try {
    const data = await titleRepository.findByUserIds(channelIds);
    titlesCache = { data, expiresAt: now + STREAMER_TITLES_CACHE_TTL };
    return data;
  } catch (err: any) {
    console.error('[Streamers] 스트리머 칭호 조회 실패:', err?.message || err);
    if (err?.cause) console.error('[Streamers] 상세 원인(cause):', err.cause);
    // 직전 성공 캐시가 있으면 그대로 사용(없으면 칭호 없이) 하고, 곧 재시도하도록 짧게 캐싱합니다.
    if (titlesCache) {
      titlesCache.expiresAt = now + 30_000;
      return titlesCache.data;
    }
    return {} as Record<string, any[]>;
  }
};

router.get('/streamers', async (req, res) => {
  try {
    const now = Date.now();
    if (streamersCache && streamersCache.expiresAt > now) {
      res.set('Cache-Control', 'public, max-age=15');
      return res.status(200).json(streamersCache.data);
    }

    const streamers = await streamerRepository.findAll();
    // 24시간/1시간 전 시세를 조회하여 등락률·등락 랭킹 계산에 활용
    const [value24hMap, value1hMap, titlesByUser] = await Promise.all([
      loadStreamerValueMap('24시간 전', () => streamerRepository.getValue24hAgoMap()),
      loadStreamerValueMap('1시간 전', () => streamerRepository.getValue1hAgoMap()),
      loadStreamerTitles(streamers.map((streamer) => streamer.channel_id))
    ]);
    
    // 민감 정보(registered_by 및 시세 관련 미사용 원천 데이터 등)를 제외한 필드만 화이트리스트 노출
    const enriched = streamers.map((s) => ({
      channel_id: s.channel_id,
      name: s.name,
      logo_url: s.logo_url,
      custom_image_url: s.custom_image_url,
      custom_images: s.custom_images, // 1~5성 커스텀 이미지 배열 화이트리스트 추가
      is_image_banned: s.is_image_banned,
      follower_count: s.follower_count,
      base_value: s.base_value,
      is_active: s.is_active,
      serial_number: s.serial_number,
      titles: (titlesByUser[s.channel_id] || []).filter((title) => title.is_equipped),
      prev_value: value24hMap[s.channel_id] ?? s.prev_value,
      value_1h_ago: value1hMap[s.channel_id] ?? s.base_value
    }));

    streamersCache = { data: enriched, expiresAt: now + STREAMERS_CACHE_TTL };
    res.set('Cache-Control', 'public, max-age=15');
    return res.status(200).json(enriched);
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '스트리머 정보를 로드하지 못했습니다.' });
  }
});

// 스트리머 포토카드 커스텀 이미지 지연 업로드 처리
router.get('/streamers/ranking', getStreamerRankings);
router.post('/streamers/me/image', authMiddleware, banCheckMiddleware, uploadSingleImage, uploadCustomImage);
// 스트리머 본인 별(0~5성) 커스텀 카드 이미지 삭제
router.post('/streamers/me/image/reset', authMiddleware, banCheckMiddleware, deleteOwnCustomImage);

// 특정 스트리머 상세 + 시세 변화 그래프 데이터 (공개) — /streamers/search, /streamers/register 보다 뒤에 위치
router.get('/streamers/:channel_id', getStreamerDetail);

// ==========================================
// 2. 일반 유저 및 공용 기능
// ==========================================
// 스트리머 부적절 카드 신고 (스냅샷 보존형) — 분당 10회 제한 + 컨트롤러에서 중복 신고 차단
router.post('/cards/:channel_id/report', authMiddleware, banCheckMiddleware, reportLimiter, reportStreamerCard);

// 쿠폰 등록(사용) API
router.post('/coupons/claim', authMiddleware, banCheckMiddleware, couponLimiter, claimCoupon);

// 공지사항 전체 조회
router.get('/announcements', getAnnouncements);

// 활성 팝업 공지 조회
router.get('/announcements/popups', getActivePopups);

// PWA 푸시 퍼블릭 키 조회
router.get('/push/vapid-key', getVapidPublicKey);

// PWA 푸시 구독 등록
router.post('/push/subscribe', authMiddleware, banCheckMiddleware, subscribePush);
// 본인에게 테스트 푸시 1건 전송 (구독 정상 등록 여부 확인용)
router.post('/push/test', authMiddleware, banCheckMiddleware, sendTestPush);

// ==========================================
// 3. 관리자(ADMIN) 전용 통제 기능 (Admin Guard 및 Auth Check 필터 통과)
// ==========================================
// 특정 스트리머의 카드 이미지를 기본 프로필로 강제 초기화
router.post('/admin/streamers/:channel_id/image/reset', authMiddleware, adminMiddleware, resetStreamerImage);

// 특정 스트리머의 이미지 업로드 편집 권한 차단 (밴) 및 기존 이미지 초기화
router.post('/admin/streamers/:channel_id/image/ban', authMiddleware, adminMiddleware, banStreamerImage);

// 특정 스트리머의 이미지 업로드 편집 권한 차단 해제 (언밴)
router.post('/admin/streamers/:channel_id/image/unban', authMiddleware, adminMiddleware, unbanStreamerImage);

// 특정 스트리머 카드 전량 삭제(폐기) + 보유자에게 시세 보상 지급
router.post('/admin/streamers/:channel_id/delete', authMiddleware, adminMiddleware, deleteStreamerCards);

// DB 부분 초기화 + 미사용 업로드 이미지 정리 (유지보수)
router.get('/admin/reset/info', authMiddleware, adminMiddleware, getResetInfo);
router.post('/admin/reset', authMiddleware, adminMiddleware, resetData);
router.get('/admin/uploads/orphans', authMiddleware, adminMiddleware, listOrphanImages);
router.post('/admin/uploads/orphans/delete', authMiddleware, adminMiddleware, deleteOrphanImages);

// 제재된 유저 목록 조회 (닉네임/ID 검색, 정렬, 페이지네이션 지원)
router.get('/admin/users/banned', authMiddleware, adminMiddleware, getBannedUsers);

// 선택된 유저들의 제재 상태 일괄 수정
router.post('/admin/users/banned/bulk-update', authMiddleware, adminMiddleware, bulkUpdateBans);

// 특정 유저에 대한 활동 제재 실행 (1일, 7일, 30일, 영구 정지)
router.post('/admin/users/:user_id/ban', authMiddleware, adminMiddleware, banUser);

// 특정 유저의 활동 제재 해제
router.post('/admin/users/:user_id/unban', authMiddleware, adminMiddleware, unbanUser);

// 전체 접수된 신고 목록 열람
router.get('/admin/reports', authMiddleware, adminMiddleware, getReports);

// 특정 신고 건에 대한 종결 처리 상태 갱신
router.post('/admin/reports/:report_id/resolve', authMiddleware, adminMiddleware, resolveReport);

// 관리자 대시보드 통계
router.get('/admin/stats', authMiddleware, adminMiddleware, getAdminStats);

// 관리자 유저 목록 (닉네임/채널ID 검색 + 페이지네이션)
router.get('/admin/users', authMiddleware, adminMiddleware, listUsers);
router.post('/admin/users/:user_id/status-message/reset', authMiddleware, adminMiddleware, resetUserStatusMessage);

router.get('/admin/titles', authMiddleware, adminMiddleware, listTitles);
router.post('/admin/titles', authMiddleware, adminMiddleware, createTitle);
router.put('/admin/titles/:id', authMiddleware, adminMiddleware, updateTitle);
router.delete('/admin/titles/:id', authMiddleware, adminMiddleware, deleteTitle);
router.post('/admin/titles/:id/award-many', authMiddleware, adminMiddleware, awardTitleToMany);
router.post('/admin/titles/:id/revoke-many', authMiddleware, adminMiddleware, revokeTitleFromMany);
router.post('/admin/titles/:id/users/:user_id', authMiddleware, adminMiddleware, awardTitle);
router.delete('/admin/titles/:id/users/:user_id', authMiddleware, adminMiddleware, revokeTitle);

// 쿠폰 발급 및 목록/사용현황 조회
router.post('/admin/coupons', authMiddleware, adminMiddleware, createCoupon);
router.get('/admin/coupons', authMiddleware, adminMiddleware, getCoupons);

// 공지사항 작성
router.post('/admin/announcements', authMiddleware, adminMiddleware, createAnnouncement);

// 공지사항 수정
router.put('/admin/announcements/:id', authMiddleware, adminMiddleware, updateAnnouncement);

// 공지사항 삭제
router.delete('/admin/announcements/:id', authMiddleware, adminMiddleware, deleteAnnouncement);

// 공지사항 팝업 노출 여부 토글
router.post('/admin/announcements/:id/popup', authMiddleware, adminMiddleware, setAnnouncementPopup);

// 푸시 알림 즉시 또는 예약 생성
router.post('/admin/push/schedule', authMiddleware, adminMiddleware, scheduleNotification);
router.get('/admin/push/scheduled', authMiddleware, adminMiddleware, getScheduledNotifications);
router.get('/admin/push/sent', authMiddleware, adminMiddleware, getSentNotifications);
router.put('/admin/push/:id', authMiddleware, adminMiddleware, updateScheduledNotification);
router.delete('/admin/push/:id', authMiddleware, adminMiddleware, deleteScheduledNotification);

// 시스템 설정 (무료 뽑기 간격, 뽑기 비용, 미니게임 동전 충전 간격)
router.get('/admin/config/free-draw', authMiddleware, adminMiddleware, getFreeDrawInterval);
router.post('/admin/config/free-draw', authMiddleware, adminMiddleware, setFreeDrawInterval);
router.get('/admin/config/draw-cost', authMiddleware, adminMiddleware, getDrawCost);
router.post('/admin/config/draw-cost', authMiddleware, adminMiddleware, setDrawCost);
router.get('/admin/config/minigame-ticket-charge', authMiddleware, adminMiddleware, getMinigameTicketChargeInterval);
router.post('/admin/config/minigame-ticket-charge', authMiddleware, adminMiddleware, setMinigameTicketChargeInterval);

// 점검 시스템 API
router.get('/maintenance/status', getMaintenanceStatus);
router.post('/admin/maintenance/status', authMiddleware, adminMiddleware, setMaintenanceStatus);

export default router;
