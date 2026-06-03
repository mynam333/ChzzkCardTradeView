import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middlewares/auth';
import { adminMiddleware } from '../middlewares/admin';
import { banCheckMiddleware } from '../middlewares/banCheck';
import { uploadCustomImage, deleteOwnCustomImage } from '../controllers/streamerController';
import { reportStreamerCard } from '../controllers/reportController';
import { proxyImage } from '../controllers/imageProxyController';
import { getChzzkAuthUrl, handleChzzkCallback } from '../controllers/chzzkAuthController';
import {
  resetStreamerImage,
  banStreamerImage,
  unbanStreamerImage,
  deleteStreamerCards,
  banUser,
  unbanUser,
  getReports,
  resolveReport
} from '../controllers/adminController';
import { claimCoupon, createCoupon } from '../controllers/couponController';
import {
  createAnnouncement,
  getAnnouncements,
  getActivePopups,
  deleteAnnouncement,
  setAnnouncementPopup
} from '../controllers/announcementController';
import {
  getVapidPublicKey,
  subscribePush,
  scheduleNotification
} from '../controllers/pushController';

import {
  getUserMe,
  getUserRankings,
  getUserCards,
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
  getCoupons
} from '../controllers/adminController';
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead
} from '../controllers/notificationController';
import {
  getShopItems,
  getMyCosmetics,
  buyShopItem,
  equipToCard,
  unequipFromCard,
  adminGetShopItems,
  adminCreateShopItem,
  adminUpdateShopItem
} from '../controllers/shopController';
import { streamerRepository } from '../repositories';
import { rateLimit } from '../middlewares/rateLimit';

const router = Router();

// 라우트별 레이트 리미터 (IP 기준 고정 윈도우)
const drawLimiter = rateLimit({ windowMs: 60_000, max: 30, key: 'draw' });
const searchLimiter = rateLimit({ windowMs: 60_000, max: 30, key: 'search' });
const tradeLimiter = rateLimit({ windowMs: 60_000, max: 30, key: 'trade' });
const couponLimiter = rateLimit({ windowMs: 60_000, max: 15, key: 'coupon' });
const authLimiter = rateLimit({ windowMs: 60_000, max: 15, key: 'auth' });
const registerLimiter = rateLimit({ windowMs: 60_000, max: 10, key: 'register' });

// Multer 파일 메모리 스토리지 세팅 (최대 5MB 제한)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

// ==========================================
// 헬스체크 엔드포인트 (/api/health)
// ==========================================
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: '치지직 카드 트레이드 뷰 백엔드 API가 정상 작동 중입니다.',
    timestamp: new Date().toISOString()
  });
});

// ==========================================
// 0. 치지직 OpenAPI OAuth 로그인 및 기본 유저 정보
// ==========================================
router.get('/auth/chzzk/url', getChzzkAuthUrl);
router.post('/auth/chzzk/callback', authLimiter, handleChzzkCallback);
router.get('/image-proxy', proxyImage);
router.get('/users/me', authMiddleware, banCheckMiddleware, getUserMe);
router.get('/users/ranking', getUserRankings);
router.get('/users/search', authMiddleware, banCheckMiddleware, searchLimiter, searchUsers);
router.get('/users/me/cards', authMiddleware, banCheckMiddleware, getUserCards);
router.get('/users/:user_id/collection', authMiddleware, banCheckMiddleware, getUserCollection);
router.get('/users/:user_id/profile', authMiddleware, banCheckMiddleware, getUserProfile);
// 유저 차단 관리
router.get('/users/me/blocks', authMiddleware, banCheckMiddleware, getMyBlocks);
router.post('/users/me/blocks', authMiddleware, banCheckMiddleware, blockUser);
router.delete('/users/me/blocks/:user_id', authMiddleware, banCheckMiddleware, unblockUser);
router.post('/cards/draw', authMiddleware, banCheckMiddleware, drawLimiter, drawCard);
router.post('/cards/sell', authMiddleware, banCheckMiddleware, sellCards);
router.post('/cards/fuse', authMiddleware, banCheckMiddleware, fuseCards);

// 상점 (코스메틱: 테두리 / 이름 이펙트)
router.get('/shop/items', authMiddleware, getShopItems);
router.get('/shop/inventory', authMiddleware, getMyCosmetics);
router.post('/shop/buy', authMiddleware, banCheckMiddleware, buyShopItem);
router.post('/cards/:card_id/equip', authMiddleware, banCheckMiddleware, equipToCard);
router.post('/cards/:card_id/unequip', authMiddleware, banCheckMiddleware, unequipFromCard);
// 관리자 상점 관리
router.get('/admin/shop/items', authMiddleware, adminMiddleware, adminGetShopItems);
router.post('/admin/shop/items', authMiddleware, adminMiddleware, adminCreateShopItem);
router.post('/admin/shop/items/:id', authMiddleware, adminMiddleware, adminUpdateShopItem);

// 신규 스트리머 검색 및 카드 등록 API
router.get('/streamers/search', authMiddleware, banCheckMiddleware, searchLimiter, searchChzzkStreamer);
router.post('/streamers/register', authMiddleware, banCheckMiddleware, registerLimiter, registerStreamer);

// 대표 카드 설정
router.post('/users/me/representative', authMiddleware, banCheckMiddleware, setRepresentativeCard);

// 인앱 알림함
router.get('/notifications', authMiddleware, getNotifications);
router.post('/notifications/read-all', authMiddleware, markAllNotificationsRead);
router.post('/notifications/:id/read', authMiddleware, markNotificationRead);

// 1:1 교환(Trade) API (2단계 Double-Lock: confirm → finalize)
router.post('/trades', authMiddleware, banCheckMiddleware, tradeLimiter, createTrade);
router.get('/trades/active', authMiddleware, banCheckMiddleware, getActiveTrades);
router.get('/trades/history', authMiddleware, banCheckMiddleware, getTradeHistory);
router.post('/trades/:trade_id/confirm', authMiddleware, banCheckMiddleware, confirmTrade);
router.post('/trades/:trade_id/finalize', authMiddleware, banCheckMiddleware, finalizeTrade);
router.post('/trades/:trade_id/reject', authMiddleware, banCheckMiddleware, rejectTrade);



// ==========================================
// ==========================================
// 1. 스트리머 관련 기능
// ==========================================
// 전체 스트리머 정보 목록 조회 (시세 탑3 리딩 등 활용)
// 여러 화면(메인·랭킹·가챠·관리자)에서 빈번히 호출되므로 짧은 TTL 메모리 캐시 적용
let streamersCache: { data: any[]; expiresAt: number } | null = null;
const STREAMERS_CACHE_TTL = 15_000; // 15초

router.get('/streamers', async (req, res) => {
  try {
    const now = Date.now();
    if (streamersCache && streamersCache.expiresAt > now) {
      return res.status(200).json(streamersCache.data);
    }

    const streamers = await streamerRepository.findAll();
    // 24시간/1시간 전 시세를 조회하여 등락률·등락 랭킹 계산에 활용
    const [value24hMap, value1hMap] = await Promise.all([
      streamerRepository.getValue24hAgoMap(),
      streamerRepository.getValue1hAgoMap()
    ]);
    const enriched = streamers.map((s) => ({
      ...s,
      // 24h 이력이 있으면 그 값을, 없으면(신규 등록 등) 기존 prev_value 유지
      prev_value: value24hMap[s.channel_id] ?? s.prev_value,
      // 1시간 전 시세 (1시간 등락 랭킹용). 이력이 없으면 현재 시세로 폴백(변동 0)
      value_1h_ago: value1hMap[s.channel_id] ?? s.base_value
    }));

    streamersCache = { data: enriched, expiresAt: now + STREAMERS_CACHE_TTL };
    return res.status(200).json(enriched);
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '스트리머 정보를 로드하지 못했습니다.' });
  }
});

// 스트리머 포토카드 커스텀 이미지 지연 업로드 처리
router.post('/streamers/me/image', authMiddleware, banCheckMiddleware, upload.single('image'), uploadCustomImage);
// 스트리머 본인 별(0~5성) 커스텀 카드 이미지 삭제
router.post('/streamers/me/image/reset', authMiddleware, banCheckMiddleware, deleteOwnCustomImage);

// 특정 스트리머 상세 + 시세 변화 그래프 데이터 (공개) — /streamers/search, /streamers/register 보다 뒤에 위치
router.get('/streamers/:channel_id', getStreamerDetail);

// ==========================================
// 2. 일반 유저 및 공용 기능
// ==========================================
// 스트리머 부적절 카드 신고 (스냅샷 보존형)
router.post('/cards/:channel_id/report', authMiddleware, banCheckMiddleware, reportStreamerCard);

// 쿠폰 등록(사용) API
router.post('/coupons/claim', authMiddleware, banCheckMiddleware, couponLimiter, claimCoupon);

// 공지사항 전체 조회
router.get('/announcements', getAnnouncements);

// 활성 팝업 공지 조회
router.get('/announcements/popups', getActivePopups);

// PWA 푸시 퍼블릭 키 조회
router.get('/push/vapid-key', getVapidPublicKey);

// PWA 푸시 구독 등록
router.post('/push/subscribe', authMiddleware, subscribePush);

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

// 쿠폰 발급 및 목록/사용현황 조회
router.post('/admin/coupons', authMiddleware, adminMiddleware, createCoupon);
router.get('/admin/coupons', authMiddleware, adminMiddleware, getCoupons);

// 공지사항 작성
router.post('/admin/announcements', authMiddleware, adminMiddleware, createAnnouncement);

// 공지사항 삭제
router.delete('/admin/announcements/:id', authMiddleware, adminMiddleware, deleteAnnouncement);

// 공지사항 팝업 노출 여부 토글
router.post('/admin/announcements/:id/popup', authMiddleware, adminMiddleware, setAnnouncementPopup);

// 푸시 알림 즉시 또는 예약 생성
router.post('/admin/push/schedule', authMiddleware, adminMiddleware, scheduleNotification);

export default router;
