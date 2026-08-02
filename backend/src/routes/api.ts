import { Router } from 'express';
import multer from 'multer';
import { subscribeRealtimeStream } from '../services/realtimeStream';
import { getRuntimeStats } from '../services/runtimeStats';
import { getLogFilePath } from '../services/fileLogger';
import { collectSiteInsightEvent } from '../controllers/analyticsController';
import { authMiddleware } from '../middlewares/auth';
import {
  minigameImageAuthMiddleware,
  type MinigameImageAuthenticatedRequest
} from '../middlewares/minigameImageAuth';
import { adminMiddleware } from '../middlewares/admin';
import { banCheckMiddleware } from '../middlewares/banCheck';
import { accountInteractionRestrictionMiddleware } from '../middlewares/accountInteractionRestriction';
import { uploadCustomImage, deleteOwnCustomImage } from '../controllers/streamerController';
import { reportStreamerCard } from '../controllers/reportController';
import { getResetInfo, resetData, listOrphanImages, deleteOrphanImages } from '../controllers/adminMaintenanceController';
import { getChzzkAuthUrl, handleChzzkCallback, logout } from '../controllers/chzzkAuthController';
import {
  resetStreamerImage,
  banStreamerImage,
  unbanStreamerImage,
  deleteStreamerCards,
  listMissingProfileImageStreamers,
  deleteMissingProfileImageStreamers,
  banUser,
  unbanUser,
  getBannedUsers,
  bulkUpdateBans,
  getReports,
  resolveReport,
  excludeReportImageFromPuzzle,
  getFreeDrawInterval,
  setFreeDrawInterval,
  getDrawCost,
  setDrawCost,
  getMinigameTicketChargeInterval,
  setMinigameTicketChargeInterval,
  getMaintenanceStatus,
  setMaintenanceStatus,
  resetUserStatusMessage,
  getUserPointAudit
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
import { getPublicLandingStats } from '../controllers/publicStatsController';
import {
  getMyAssetEvents,
  getAdminAssetEvents,
  getAdminAssetEventSuspects
} from '../controllers/assetEventController';
import {
  getMyAchievements,
  recalculateMyAchievements,
  claimMyAchievement,
  adminGetAchievements,
  adminCreateAchievement,
  adminUpdateAchievement
} from '../controllers/achievementController';

import {
  getUserMe,
  deleteMyAccount,
  getUserRankings,
  getStreamerRankings,
  getStreamerLiveStatuses,
  getUserCards,
  getUserCardGroups,
  updateMyStatusMessage,
  updateMyCardVisibility,
  updateMyCardGroupVisibility,
  updateMyCardFavorite,
  updateMyCardLock,
  drawCard,
  drawCards,
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
  getTradeHistory,
  getAdminTradeHistory
} from '../controllers/tradeController';
import {
  listActiveListings,
  listMyListings,
  createListing,
  cancelListing,
  hideMyListing,
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
  getAdminInsights,
  getCoupons,
  listUsers
} from '../controllers/adminController';
import {
  listTitles,
  createTitle,
  updateTitle,
  deleteTitle,
  listSubscriptionTitleRuleSettings,
  createSubscriptionTitleRuleSetting,
  updateSubscriptionTitleRuleSetting,
  deleteSubscriptionTitleRuleSetting,
  syncMySubscriptionTitleRules,
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
  markAllNotificationsRead,
  hideReadNotification
} from '../controllers/notificationController';
import {
  addMyImageBlind,
  getMyImageBlinds,
  removeMyImageBlind
} from '../controllers/imageBlindController';
import {
  clearRoomViewing,
  closeChatRoom,
  createChatImageMessage,
  createChatMessage,
  cancelOutgoingFriendRequest,
  deleteClosedChatRoom,
  deleteFriend,
  getChatMessages,
  getChatRooms,
  getFriendOverview,
  getRecentChatAttachments,
  markRoomViewing,
  openChatRoom,
  respondToFriendRequest,
  reuseChatAttachmentMessage,
  searchFriendCandidates,
  sendFriendRequest,
  setChatRoomMute
} from '../controllers/friendController';
import {
  getShopItems,
  getMyCosmetics,
  getMyCosmeticCounts,
  getMyPurchases,
  buyShopItem,
  equipToCard,
  unequipFromCard,
  adminGetShopItems,
  adminCreateShopItem,
  adminUpdateShopItem,
  adminResetPurchases,
  adminGetArenaCosmetics,
  adminCreateArenaCosmetic,
  adminUpdateArenaCosmetic,
  uploadArenaCosmeticAsset,
  uploadArenaEmoteAsset,
  getArenaCosmeticShopItems,
  getArenaCosmeticInventoryCounts,
  getArenaCosmeticPurchases,
  getArenaCosmeticLoadout,
  updateArenaCosmeticLoadout,
  buyArenaCosmetic,
  sendArenaEmote
} from '../controllers/shopController';
import {
  getMinigameStatus,
  getActiveMinigameSession,
  abandonMinigameSession,
  startMinigame,
  startMinigameRound,
  checkMinigameRoundAnswer,
  submitMinigameResult
} from '../controllers/minigameController';
import {
  acceptMyArenaV2QuickQueueController,
  cancelMyArenaV2BattleRoyaleQueueController,
  cancelMyArenaV2QuickQueueController,
  createArenaV2BotMatchController,
  createArenaV2SeasonAdminController,
  deleteArenaV2DeckController,
  createArenaV2MatchController,
  grantArenaV2SeasonRewardsAdminController,
  getArenaV2CardDetailController,
  getArenaV2CurrentSeasonController,
  getArenaV2MatchController,
  getArenaV2ReplayController,
  getArenaV2BattleRoyaleController,
  getArenaV2CurrentRewardsController,
  getMyArenaV2StreamerCardController,
  getMyArenaV2BattleRoyaleQueueStatusController,
  getMyArenaV2QuickQueueStatusController,
  joinArenaV2BattleRoyaleQueueController,
  joinArenaV2QuickQueueController,
  listArenaV2CardsController,
  listArenaV2DecksController,
  listArenaV2RankingsController,
  listMyArenaV2OwnedCardsController,
  holdArenaV2ReplayAdminController,
  holdArenaV2RewardGrantAdminController,
  previewArenaV2SeasonRewardsAdminController,
  recordArenaV2OpsFlagAdminController,
  releaseArenaV2RewardGrantAdminController,
  revalidateArenaV2DeckController,
  saveArenaV2DeckController,
  submitArenaV2MulliganController,
  submitArenaV2TurnActionsController,
  transitionArenaV2SeasonAdminController,
  updateMyArenaV2StreamerCardController,
  updateArenaV2DeckController,
  updateArenaV2SeasonAdminController,
  validateArenaV2DeckController,
  disableMyArenaV2StreamerCardController,
  enableMyArenaV2StreamerCardController
} from '../controllers/arenaV2Controller';
import { streamerRepository, titleRepository } from '../repositories';

import { rateLimit } from '../middlewares/rateLimit';
import { maintenanceCheckMiddleware } from '../middlewares/maintenanceCheck';
import { shouldServeImageProxyInApi } from '../services/processRole';
import { bytesToWholeMb, readBytesEnv, readIntegerEnv } from '../utils/env';

const router = Router();

router.post('/analytics/events', collectSiteInsightEvent);
router.use(maintenanceCheckMiddleware);

// 라우트별 레이트 리미터 (IP 기준 고정 윈도우)
const defaultRouteRateLimitWindowMs = readIntegerEnv('ROUTE_RATE_LIMIT_WINDOW_MS', 60_000, { min: 1000 });
const routeRateLimitWindowMs = (name: string) => readIntegerEnv(name, defaultRouteRateLimitWindowMs, { min: 1000 });
const routeRateLimitMax = (name: string, fallback: number) => readIntegerEnv(name, fallback, { min: 0 });

const drawLimiter = rateLimit({ windowMs: routeRateLimitWindowMs('DRAW_RATE_LIMIT_WINDOW_MS'), max: routeRateLimitMax('DRAW_RATE_LIMIT_MAX', 180), key: 'draw' });
const searchLimiter = rateLimit({ windowMs: routeRateLimitWindowMs('SEARCH_RATE_LIMIT_WINDOW_MS'), max: routeRateLimitMax('SEARCH_RATE_LIMIT_MAX', 180), key: 'search' });
const tradeLimiter = rateLimit({ windowMs: routeRateLimitWindowMs('TRADE_RATE_LIMIT_WINDOW_MS'), max: routeRateLimitMax('TRADE_RATE_LIMIT_MAX', 180), key: 'trade' });
const couponLimiter = rateLimit({ windowMs: routeRateLimitWindowMs('COUPON_RATE_LIMIT_WINDOW_MS'), max: routeRateLimitMax('COUPON_RATE_LIMIT_MAX', 60), key: 'coupon' });
const authLimiter = rateLimit({ windowMs: routeRateLimitWindowMs('AUTH_RATE_LIMIT_WINDOW_MS'), max: routeRateLimitMax('AUTH_RATE_LIMIT_MAX', 60), key: 'auth' });
const registerLimiter = rateLimit({ windowMs: routeRateLimitWindowMs('REGISTER_RATE_LIMIT_WINDOW_MS'), max: routeRateLimitMax('REGISTER_RATE_LIMIT_MAX', 60), key: 'register' });
const reportLimiter = rateLimit({ windowMs: routeRateLimitWindowMs('REPORT_RATE_LIMIT_WINDOW_MS'), max: routeRateLimitMax('REPORT_RATE_LIMIT_MAX', 60), key: 'report' });
const chatImageLimiter = rateLimit({ windowMs: routeRateLimitWindowMs('CHAT_IMAGE_RATE_LIMIT_WINDOW_MS'), max: routeRateLimitMax('CHAT_IMAGE_RATE_LIMIT_MAX', 60), key: 'chat-image' });
const minigameLimiter = rateLimit({
  windowMs: routeRateLimitWindowMs('MINIGAME_RATE_LIMIT_WINDOW_MS'),
  max: routeRateLimitMax('MINIGAME_RATE_LIMIT_MAX', 120),
  key: 'minigame',
  keyByUser: true
});
const streamerReadLimiter = rateLimit({ windowMs: routeRateLimitWindowMs('STREAMER_READ_RATE_LIMIT_WINDOW_MS'), max: routeRateLimitMax('STREAMER_READ_RATE_LIMIT_MAX', 240), key: 'streamer-read' });
const arenaReadLimiter = rateLimit({ windowMs: routeRateLimitWindowMs('ARENA_READ_RATE_LIMIT_WINDOW_MS'), max: routeRateLimitMax('ARENA_READ_RATE_LIMIT_MAX', 240), key: 'arena-read' });
const arenaDeckWriteLimiter = rateLimit({ windowMs: routeRateLimitWindowMs('ARENA_DECK_WRITE_RATE_LIMIT_WINDOW_MS'), max: routeRateLimitMax('ARENA_DECK_WRITE_RATE_LIMIT_MAX', 12), key: 'arena-deck-write', keyByUser: true });
const arenaBotMatchLimiter = rateLimit({ windowMs: routeRateLimitWindowMs('ARENA_BOT_MATCH_RATE_LIMIT_WINDOW_MS'), max: routeRateLimitMax('ARENA_BOT_MATCH_RATE_LIMIT_MAX', 10), key: 'arena-bot-match', keyByUser: true });
const arenaQuickJoinLimiter = rateLimit({ windowMs: routeRateLimitWindowMs('ARENA_QUICK_JOIN_RATE_LIMIT_WINDOW_MS'), max: routeRateLimitMax('ARENA_QUICK_JOIN_RATE_LIMIT_MAX', 6), key: 'arena-quick-join', keyByUser: true });
const arenaQuickStatusLimiter = rateLimit({ windowMs: routeRateLimitWindowMs('ARENA_QUICK_STATUS_RATE_LIMIT_WINDOW_MS'), max: routeRateLimitMax('ARENA_QUICK_STATUS_RATE_LIMIT_MAX', 120), key: 'arena-quick-status', keyByUser: true });
const arenaQuickAcceptLimiter = rateLimit({ windowMs: routeRateLimitWindowMs('ARENA_QUICK_ACCEPT_RATE_LIMIT_WINDOW_MS'), max: routeRateLimitMax('ARENA_QUICK_ACCEPT_RATE_LIMIT_MAX', 12), key: 'arena-quick-accept', keyByUser: true });
const arenaQuickCancelLimiter = rateLimit({ windowMs: routeRateLimitWindowMs('ARENA_QUICK_CANCEL_RATE_LIMIT_WINDOW_MS'), max: routeRateLimitMax('ARENA_QUICK_CANCEL_RATE_LIMIT_MAX', 6), key: 'arena-quick-cancel', keyByUser: true });
const arenaAdminLimiter = rateLimit({ windowMs: routeRateLimitWindowMs('ARENA_ADMIN_RATE_LIMIT_WINDOW_MS'), max: routeRateLimitMax('ARENA_ADMIN_RATE_LIMIT_MAX', 30), key: 'arena-admin', keyByUser: true });
const arenaStreamerConfigLimiter = rateLimit({ windowMs: routeRateLimitWindowMs('ARENA_STREAMER_CONFIG_RATE_LIMIT_WINDOW_MS'), max: routeRateLimitMax('ARENA_STREAMER_CONFIG_RATE_LIMIT_MAX', 3), key: 'arena-streamer-config', keyByUser: true });
const arenaStreamerToggleLimiter = rateLimit({ windowMs: routeRateLimitWindowMs('ARENA_STREAMER_TOGGLE_RATE_LIMIT_WINDOW_MS'), max: routeRateLimitMax('ARENA_STREAMER_TOGGLE_RATE_LIMIT_MAX', 5), key: 'arena-streamer-toggle', keyByUser: true });
const arenaCosmeticWriteLimiter = rateLimit({ windowMs: routeRateLimitWindowMs('ARENA_COSMETIC_WRITE_RATE_LIMIT_WINDOW_MS'), max: routeRateLimitMax('ARENA_COSMETIC_WRITE_RATE_LIMIT_MAX', 20), key: 'arena-cosmetic-write', keyByUser: true });
const arenaRoundCommitLimiter = rateLimit({ windowMs: routeRateLimitWindowMs('ARENA_ROUND_COMMIT_RATE_LIMIT_WINDOW_MS'), max: routeRateLimitMax('ARENA_ROUND_COMMIT_RATE_LIMIT_MAX', 18), key: 'arena-round-commit', keyByUser: true });
const arenaShareLimiter = rateLimit({ windowMs: routeRateLimitWindowMs('ARENA_SHARE_RATE_LIMIT_WINDOW_MS'), max: routeRateLimitMax('ARENA_SHARE_RATE_LIMIT_MAX', 8), key: 'arena-share', keyByUser: true });
const arenaSpectatorLimiter = rateLimit({ windowMs: routeRateLimitWindowMs('ARENA_SPECTATOR_RATE_LIMIT_WINDOW_MS'), max: routeRateLimitMax('ARENA_SPECTATOR_RATE_LIMIT_MAX', 120), key: 'arena-spectator' });

const STREAMER_IMAGE_MAX_UPLOAD_BYTES = readBytesEnv('STREAMER_IMAGE_MAX_UPLOAD_BYTES', 20 * 1024 * 1024, { minBytes: 1024 * 1024 });
const CHAT_IMAGE_MAX_UPLOAD_BYTES = readBytesEnv('CHAT_IMAGE_MAX_UPLOAD_BYTES', 25 * 1024 * 1024, { minBytes: 1024 * 1024 });

// Multer 파일 메모리 스토리지 세팅 (이미지 MIME 사전 필터)
const ALLOWED_UPLOAD_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: STREAMER_IMAGE_MAX_UPLOAD_BYTES,
    files: 1,
    fields: 4,
    parts: 5,
    fieldNestingDepth: 0
  },
  fileFilter: (_req, file, cb) => {
    // 비이미지 업로드를 버퍼링 전에 조기 차단 (sharp 처리 이전 1차 방어)
    if (ALLOWED_UPLOAD_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error('이미지 파일(JPEG/PNG/WebP/GIF/AVIF)만 업로드할 수 있습니다.'));
  }
});

// Multer 에러(용량 초과·비이미지 등)를 500이 아닌 400 JSON으로 일관 처리하는 래퍼
const uploadSingleImage = (req: any, res: any, next: any) => {
  upload.single('image')(req, res, (err: any) => {
    if (err) {
      const msg = (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE')
        ? `이미지 용량은 ${bytesToWholeMb(STREAMER_IMAGE_MAX_UPLOAD_BYTES)}MB 이하만 업로드할 수 있습니다.`
        : (err.message || '파일 업로드 중 오류가 발생했습니다.');
      return res.status(400).json({ error: 'BadRequest', message: msg });
    }
    next();
  });
};

const chatImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: CHAT_IMAGE_MAX_UPLOAD_BYTES,
    files: 1,
    fields: 0,
    parts: 1,
    fieldNestingDepth: 0
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_UPLOAD_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error('이미지 파일(JPEG/PNG/WebP/GIF/AVIF)만 첨부할 수 있습니다.'));
  }
});

const uploadChatImage = (req: any, res: any, next: any) => {
  chatImageUpload.single('image')(req, res, (err: any) => {
    if (err) {
      const msg = (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE')
        ? `채팅 이미지는 ${bytesToWholeMb(CHAT_IMAGE_MAX_UPLOAD_BYTES)}MB 이하만 첨부할 수 있습니다.`
        : (err.message || '이미지 첨부 중 오류가 발생했습니다.');
      return res.status(400).json({ error: 'BadRequest', message: msg });
    }
    next();
  });
};

const arenaV2LegacyEndpointRemoved = (_req: any, res: any) => res.status(410).json({
  error: 'ArenaV2EndpointRequired',
  message: '치카포 아레나는 v2 GDD 기준으로 교체되었습니다. v2 전용 API를 사용해주세요.'
});

const arenaV2SystemStatus = (_req: any, res: any) => res.status(200).json({
  status: 'ok',
  arenaVersion: 'v2',
  rulesVersion: 'arena-v2-gdd-1.0.0',
  message: '치카포 아레나 v2 API가 활성화되어 있습니다.'
});

// ==========================================
// 헬스체크 엔드포인트 (/api/health)
// ==========================================
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: '치카포 백엔드 API가 정상 작동 중입니다.',
    timestamp: new Date().toISOString(),
    log_file: getLogFilePath(),
    runtime: getRuntimeStats()
  });
});

router.get('/realtime/stream', (req, res) => {
  subscribeRealtimeStream(res, req.query.topics, req.header('last-event-id'));
});

// ==========================================
// 0. 치지직 OpenAPI OAuth 로그인 및 기본 유저 정보
// ==========================================
router.get('/auth/chzzk/url', getChzzkAuthUrl);
router.post('/auth/chzzk/callback', authLimiter, handleChzzkCallback);
// 로그아웃 — httpOnly 세션 쿠키 제거
router.post('/auth/logout', logout);
router.get('/image-proxy/minigame', minigameImageAuthMiddleware, async (req, res, next) => {
  if (!shouldServeImageProxyInApi()) {
    return res.status(503).json({
      error: 'ImageProxyDisabled',
      message: '미니게임 이미지는 별도 image-worker 프로세스에서 처리됩니다.'
    });
  }
  try {
    const { proxyMinigameImage } = await import('../controllers/imageProxyController');
    return proxyMinigameImage(
      req,
      res,
      (req as MinigameImageAuthenticatedRequest).minigameImageUserId || ''
    );
  } catch (err) {
    return next(err);
  }
});
router.get('/image-proxy', async (req, res, next) => {
  if (!shouldServeImageProxyInApi()) {
    return res.status(503).json({
      error: 'ImageProxyDisabled',
      message: '이미지 프록시는 별도 image-worker 프로세스에서 처리됩니다.'
    });
  }
  try {
    const { proxyImage } = await import('../controllers/imageProxyController');
    return proxyImage(req, res);
  } catch (err) {
    return next(err);
  }
});
router.get('/users/me', authMiddleware, banCheckMiddleware, getUserMe);
router.get('/users/me/asset-events', authMiddleware, banCheckMiddleware, getMyAssetEvents);
router.get('/achievements', authMiddleware, banCheckMiddleware, getMyAchievements);
router.post('/achievements/recalculate', authMiddleware, banCheckMiddleware, recalculateMyAchievements);
router.post('/achievements/:id/claim', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, claimMyAchievement);
router.put('/users/me/status-message', authMiddleware, banCheckMiddleware, updateMyStatusMessage);
router.delete('/users/me', authMiddleware, deleteMyAccount);
router.put('/users/me/title', authMiddleware, banCheckMiddleware, equipMyTitle);
router.get('/users/ranking', streamerReadLimiter, getUserRankings);
router.get('/public/stats', getPublicLandingStats);
router.get('/users/search', authMiddleware, banCheckMiddleware, searchLimiter, searchUsers);
router.get('/users/me/cards/groups', authMiddleware, banCheckMiddleware, getUserCardGroups);
router.get('/users/me/cards', authMiddleware, banCheckMiddleware, getUserCards);
router.get('/users/:user_id/collection', authMiddleware, banCheckMiddleware, getUserCollection);
router.get('/users/:user_id/profile', authMiddleware, banCheckMiddleware, getUserProfile);
router.get('/tutorial/progress', authMiddleware, banCheckMiddleware, getTutorialProgress);
router.post('/tutorial/progress', authMiddleware, banCheckMiddleware, markTutorialCompleted);
router.post('/tutorial/rewards/gacha-ticket', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, claimTutorialGachaTicket);
// 유저 차단 관리
router.get('/users/me/blocks', authMiddleware, banCheckMiddleware, getMyBlocks);
router.post('/users/me/blocks', authMiddleware, banCheckMiddleware, blockUser);
router.delete('/users/me/blocks/:user_id', authMiddleware, banCheckMiddleware, unblockUser);
router.get('/users/me/image-blinds', authMiddleware, banCheckMiddleware, getMyImageBlinds);
router.post('/users/me/image-blinds', authMiddleware, banCheckMiddleware, addMyImageBlind);
router.delete('/users/me/image-blinds', authMiddleware, banCheckMiddleware, removeMyImageBlind);
router.delete('/users/me/image-blinds/:image_key', authMiddleware, banCheckMiddleware, removeMyImageBlind);
router.post('/cards/draw', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, drawLimiter, drawCard);
router.post('/cards/draw-many', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, drawLimiter, drawCards);
router.patch('/cards/visibility', authMiddleware, banCheckMiddleware, updateMyCardGroupVisibility);
router.patch('/cards/:card_id/visibility', authMiddleware, banCheckMiddleware, updateMyCardVisibility);
router.patch('/cards/:card_id/favorite', authMiddleware, banCheckMiddleware, updateMyCardFavorite);
router.patch('/cards/:card_id/lock', authMiddleware, banCheckMiddleware, updateMyCardLock);
router.post('/cards/sell', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, sellCards);
router.post('/cards/fuse', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, fuseCards);

// 상점 (코스메틱: 테두리 / 이름 이펙트)
router.get('/shop/items', authMiddleware, getShopItems);
router.get('/shop/inventory', authMiddleware, getMyCosmetics);
router.get('/shop/inventory-counts', authMiddleware, getMyCosmeticCounts);
router.get('/shop/purchases', authMiddleware, getMyPurchases);
router.post('/shop/buy', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, buyShopItem);
router.post('/cards/:card_id/equip', authMiddleware, banCheckMiddleware, equipToCard);
router.post('/cards/:card_id/unequip', authMiddleware, banCheckMiddleware, unequipFromCard);
// 관리자 상점 관리
router.get('/admin/shop/items', authMiddleware, adminMiddleware, adminGetShopItems);
router.post('/admin/shop/items', authMiddleware, adminMiddleware, adminCreateShopItem);
router.post('/admin/shop/items/:id/reset-purchases', authMiddleware, adminMiddleware, adminResetPurchases);
router.post('/admin/shop/items/:id', authMiddleware, adminMiddleware, adminUpdateShopItem);

// 신규 스트리머 검색 및 카드 등록 API
router.get('/streamers/search', authMiddleware, banCheckMiddleware, searchLimiter, searchChzzkStreamer);
router.post('/streamers/register', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, registerLimiter, registerStreamer);

// 대표 카드 설정
router.post('/users/me/representative', authMiddleware, banCheckMiddleware, setRepresentativeCard);

// 인앱 알림함
router.get('/notifications', authMiddleware, banCheckMiddleware, getNotifications);
router.get('/notifications/stream', authMiddleware, banCheckMiddleware, streamNotifications);
router.post('/notifications/read-all', authMiddleware, banCheckMiddleware, markAllNotificationsRead);
router.post('/notifications/:id/read', authMiddleware, banCheckMiddleware, markNotificationRead);
router.delete('/notifications/:id', authMiddleware, banCheckMiddleware, hideReadNotification);

// 친구 및 1:1 톡
router.get('/friends/search', authMiddleware, banCheckMiddleware, searchLimiter, searchFriendCandidates);
router.get('/friends', authMiddleware, banCheckMiddleware, getFriendOverview);
router.post('/friends/requests', authMiddleware, banCheckMiddleware, sendFriendRequest);
router.delete('/friends/requests/:request_id', authMiddleware, banCheckMiddleware, cancelOutgoingFriendRequest);
router.post('/friends/requests/:request_id/respond', authMiddleware, banCheckMiddleware, respondToFriendRequest);
router.delete('/friends/:user_id', authMiddleware, banCheckMiddleware, deleteFriend);
router.get('/friends/attachments/recent', authMiddleware, banCheckMiddleware, getRecentChatAttachments);
router.get('/friends/rooms', authMiddleware, banCheckMiddleware, getChatRooms);
router.post('/friends/rooms/open', authMiddleware, banCheckMiddleware, openChatRoom);
router.post('/friends/rooms/:room_id/close', authMiddleware, adminMiddleware, closeChatRoom);
router.post('/friends/rooms/:room_id/mute', authMiddleware, banCheckMiddleware, setChatRoomMute);
router.delete('/friends/rooms/:room_id', authMiddleware, banCheckMiddleware, deleteClosedChatRoom);
router.get('/friends/rooms/:room_id/messages', authMiddleware, banCheckMiddleware, getChatMessages);
router.post('/friends/rooms/:room_id/messages', authMiddleware, banCheckMiddleware, createChatMessage);
router.post('/friends/rooms/:room_id/attachments', authMiddleware, banCheckMiddleware, chatImageLimiter, uploadChatImage, createChatImageMessage);
router.post('/friends/rooms/:room_id/attachments/reuse', authMiddleware, banCheckMiddleware, chatImageLimiter, reuseChatAttachmentMessage);
router.post('/friends/rooms/:room_id/viewing', authMiddleware, banCheckMiddleware, markRoomViewing);
router.delete('/friends/rooms/:room_id/viewing', authMiddleware, banCheckMiddleware, clearRoomViewing);

// 1:1 교환(Trade) API (2단계 Double-Lock: confirm → finalize)
router.post('/trades', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, tradeLimiter, createTrade);
router.get('/trades/active', authMiddleware, banCheckMiddleware, getActiveTrades);
router.get('/trades/history', authMiddleware, banCheckMiddleware, getTradeHistory);
router.post('/trades/:trade_id/confirm', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, confirmTrade);
router.post('/trades/:trade_id/finalize', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, finalizeTrade);
router.post('/trades/:trade_id/reject', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, rejectTrade);

// 오픈마켓 API
router.get('/market/listings', authMiddleware, listActiveListings);
router.get('/market/my', authMiddleware, listMyListings);
router.delete('/market/my/:id', authMiddleware, banCheckMiddleware, hideMyListing);
router.get('/market/history', authMiddleware, listMarketHistory);
router.get('/market/watches', authMiddleware, banCheckMiddleware, listMarketWatches);
router.post('/market/watches', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, upsertMarketWatch);
router.delete('/market/watches/:id', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, deleteMarketWatch);
router.post('/market/list', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, createListing);
router.post('/market/cancel/:id', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, cancelListing);
router.post('/market/buy/:id', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, purchaseListing);
router.post('/market/bid/:id', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, placeBid);

// ==========================================
// 미니게임 API (티켓 충전식 포인트 획득 기능)
// ==========================================
router.get('/minigames/status', authMiddleware, banCheckMiddleware, minigameLimiter, getMinigameStatus);
router.get('/minigames/active', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, minigameLimiter, getActiveMinigameSession);
router.post('/minigames/abandon', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, minigameLimiter, abandonMinigameSession);
router.post('/minigames/start', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, minigameLimiter, startMinigame);
router.post('/minigames/round-start', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, minigameLimiter, startMinigameRound);
router.post('/minigames/round-answer', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, minigameLimiter, checkMinigameRoundAnswer);
router.post('/minigames/submit', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, minigameLimiter, submitMinigameResult);

// ==========================================
// 치카포 아레나 API (읽기 우선, 저부하 캐시 기반)
// ==========================================
router.get('/arena/system-status', arenaReadLimiter, arenaV2SystemStatus);
router.get('/admin/arena/system', authMiddleware, adminMiddleware, arenaAdminLimiter, arenaV2SystemStatus);
router.post('/admin/arena/ops/flags', authMiddleware, adminMiddleware, arenaAdminLimiter, recordArenaV2OpsFlagAdminController);
router.patch('/admin/arena/system/flags/:flag', authMiddleware, adminMiddleware, arenaAdminLimiter, recordArenaV2OpsFlagAdminController);
router.post('/admin/arena/seasons', authMiddleware, adminMiddleware, arenaAdminLimiter, createArenaV2SeasonAdminController);
router.patch('/admin/arena/seasons/:season_id', authMiddleware, adminMiddleware, arenaAdminLimiter, updateArenaV2SeasonAdminController);
router.post('/admin/arena/seasons/:season_id/transition', authMiddleware, adminMiddleware, arenaAdminLimiter, transitionArenaV2SeasonAdminController);
router.get('/admin/arena/seasons/:season_id/reward-preview', authMiddleware, adminMiddleware, arenaAdminLimiter, previewArenaV2SeasonRewardsAdminController);
router.post('/admin/arena/seasons/:season_id/grant-rewards', authMiddleware, adminMiddleware, arenaAdminLimiter, grantArenaV2SeasonRewardsAdminController);
router.patch('/admin/arena/season', authMiddleware, adminMiddleware, arenaAdminLimiter, updateArenaV2SeasonAdminController);
router.patch('/admin/arena/restrictions/:type/:id', authMiddleware, adminMiddleware, arenaAdminLimiter, arenaV2LegacyEndpointRemoved);
router.get('/admin/arena/audit-logs', authMiddleware, adminMiddleware, arenaAdminLimiter, arenaV2LegacyEndpointRemoved);
router.get('/admin/arena/jobs', authMiddleware, adminMiddleware, arenaAdminLimiter, arenaV2LegacyEndpointRemoved);
router.get('/admin/arena/stats', authMiddleware, adminMiddleware, arenaAdminLimiter, listArenaV2RankingsController);
router.get('/admin/arena/stats/overview', authMiddleware, adminMiddleware, arenaAdminLimiter, listArenaV2RankingsController);
router.get('/admin/arena/stats/balance', authMiddleware, adminMiddleware, arenaAdminLimiter, listArenaV2RankingsController);
router.get('/admin/arena/abuse-audit', authMiddleware, adminMiddleware, arenaAdminLimiter, arenaV2LegacyEndpointRemoved);
router.post('/admin/arena/rewards/:grant_id/hold', authMiddleware, adminMiddleware, arenaAdminLimiter, holdArenaV2RewardGrantAdminController);
router.post('/admin/arena/rewards/:grant_id/release', authMiddleware, adminMiddleware, arenaAdminLimiter, releaseArenaV2RewardGrantAdminController);
router.post('/admin/arena/matches/:match_id/replay-hold', authMiddleware, adminMiddleware, arenaAdminLimiter, holdArenaV2ReplayAdminController);
router.get('/admin/arena/matches/:match_id/replay-diagnostic', authMiddleware, adminMiddleware, arenaAdminLimiter, arenaV2LegacyEndpointRemoved);
router.get('/admin/arena/reports', authMiddleware, adminMiddleware, arenaAdminLimiter, arenaV2LegacyEndpointRemoved);
router.post('/admin/arena/reports/:report_id/review', authMiddleware, adminMiddleware, arenaAdminLimiter, arenaV2LegacyEndpointRemoved);
router.get('/admin/arena/streamer-right-requests', authMiddleware, adminMiddleware, arenaAdminLimiter, arenaV2LegacyEndpointRemoved);
router.post('/admin/arena/streamer-right-requests/:request_id/review', authMiddleware, adminMiddleware, arenaAdminLimiter, arenaV2LegacyEndpointRemoved);
router.post('/admin/arena/cosmetics/emote-assets', authMiddleware, adminMiddleware, arenaAdminLimiter, uploadSingleImage, uploadArenaEmoteAsset);
router.get('/admin/arena/cosmetics', authMiddleware, adminMiddleware, arenaAdminLimiter, adminGetArenaCosmetics);
router.post('/admin/arena/cosmetics', authMiddleware, adminMiddleware, arenaAdminLimiter, adminCreateArenaCosmetic);
router.patch('/admin/arena/cosmetics/:id', authMiddleware, adminMiddleware, arenaAdminLimiter, adminUpdateArenaCosmetic);
router.post('/admin/arena/cosmetics/assets', authMiddleware, adminMiddleware, arenaAdminLimiter, uploadSingleImage, uploadArenaCosmeticAsset);
router.get('/admin/arena/quick-match', authMiddleware, adminMiddleware, arenaAdminLimiter, arenaV2LegacyEndpointRemoved);
router.post('/admin/arena/quick-match/recover-queue', authMiddleware, adminMiddleware, arenaAdminLimiter, arenaV2LegacyEndpointRemoved);
router.get('/admin/arena/cups', authMiddleware, adminMiddleware, arenaAdminLimiter, arenaV2LegacyEndpointRemoved);
router.post('/admin/arena/cups/recover-queue', authMiddleware, adminMiddleware, arenaAdminLimiter, arenaV2LegacyEndpointRemoved);
router.post('/admin/arena/stats/rebuild', authMiddleware, adminMiddleware, arenaAdminLimiter, arenaV2LegacyEndpointRemoved);
router.post('/admin/arena/rankings/rebuild', authMiddleware, adminMiddleware, arenaAdminLimiter, arenaV2LegacyEndpointRemoved);
router.post('/admin/arena/matches/prune-logs', authMiddleware, adminMiddleware, arenaAdminLimiter, arenaV2LegacyEndpointRemoved);
router.post('/arena/telemetry/performance', authMiddleware, banCheckMiddleware, arenaReadLimiter, arenaV2LegacyEndpointRemoved);
router.get('/arena/season/current', arenaReadLimiter, getArenaV2CurrentSeasonController);
router.get('/arena/seasons/current', arenaReadLimiter, getArenaV2CurrentSeasonController);
router.get('/arena/rules/catalog', arenaReadLimiter, arenaV2LegacyEndpointRemoved);
router.get('/arena/wiki', arenaReadLimiter, arenaV2LegacyEndpointRemoved);
router.get('/arena/wiki/:slug', arenaReadLimiter, arenaV2LegacyEndpointRemoved);
router.get('/arena/cosmetics/shop-items', authMiddleware, banCheckMiddleware, arenaReadLimiter, getArenaCosmeticShopItems);
router.get('/arena/cosmetics/inventory-counts', authMiddleware, banCheckMiddleware, arenaReadLimiter, getArenaCosmeticInventoryCounts);
router.get('/arena/cosmetics/purchases', authMiddleware, banCheckMiddleware, arenaReadLimiter, getArenaCosmeticPurchases);
router.get('/arena/cosmetics/loadout', authMiddleware, banCheckMiddleware, arenaReadLimiter, getArenaCosmeticLoadout);
router.patch('/arena/cosmetics/loadout', authMiddleware, banCheckMiddleware, arenaCosmeticWriteLimiter, updateArenaCosmeticLoadout);
router.post('/arena/cosmetics/buy', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, arenaCosmeticWriteLimiter, buyArenaCosmetic);
router.get('/arena/cups/status', arenaReadLimiter, arenaV2LegacyEndpointRemoved);
router.post('/arena/cups/join', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, arenaQuickJoinLimiter, arenaV2LegacyEndpointRemoved);
router.post('/arena/cups/queue/join', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, arenaQuickJoinLimiter, arenaV2LegacyEndpointRemoved);
router.get('/arena/cups/queue/status', authMiddleware, banCheckMiddleware, arenaQuickStatusLimiter, arenaV2LegacyEndpointRemoved);
router.get('/arena/cups/queue/events', authMiddleware, banCheckMiddleware, arenaQuickStatusLimiter, arenaV2LegacyEndpointRemoved);
router.post('/arena/cups/cancel', authMiddleware, banCheckMiddleware, arenaQuickCancelLimiter, arenaV2LegacyEndpointRemoved);
router.post('/arena/cups/queue/cancel', authMiddleware, banCheckMiddleware, arenaQuickCancelLimiter, arenaV2LegacyEndpointRemoved);
router.get('/arena/cups/:cup_id', authMiddleware, banCheckMiddleware, arenaReadLimiter, arenaV2LegacyEndpointRemoved);
router.post('/arena/battle-royales/join', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, arenaQuickJoinLimiter, joinArenaV2BattleRoyaleQueueController);
router.get('/arena/battle-royales/status', authMiddleware, banCheckMiddleware, arenaQuickStatusLimiter, getMyArenaV2BattleRoyaleQueueStatusController);
router.post('/arena/battle-royales/cancel', authMiddleware, banCheckMiddleware, arenaQuickCancelLimiter, cancelMyArenaV2BattleRoyaleQueueController);
router.post('/arena/battle-royales/queue/join', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, arenaQuickJoinLimiter, joinArenaV2BattleRoyaleQueueController);
router.get('/arena/battle-royales/queue/status', authMiddleware, banCheckMiddleware, arenaQuickStatusLimiter, getMyArenaV2BattleRoyaleQueueStatusController);
router.post('/arena/battle-royales/queue/cancel', authMiddleware, banCheckMiddleware, arenaQuickCancelLimiter, cancelMyArenaV2BattleRoyaleQueueController);
router.get('/arena/battle-royales/:battle_royale_id', authMiddleware, banCheckMiddleware, arenaReadLimiter, getArenaV2BattleRoyaleController);
router.get('/arena/cards/owned', authMiddleware, banCheckMiddleware, arenaReadLimiter, listMyArenaV2OwnedCardsController);
router.get('/arena/cards', arenaReadLimiter, listArenaV2CardsController);
router.get('/arena/cards/:card_id', arenaReadLimiter, getArenaV2CardDetailController);
router.get('/arena/decks', authMiddleware, banCheckMiddleware, arenaReadLimiter, listArenaV2DecksController);
router.post('/arena/decks/validate', authMiddleware, banCheckMiddleware, arenaReadLimiter, validateArenaV2DeckController);
router.post('/arena/decks', authMiddleware, banCheckMiddleware, arenaDeckWriteLimiter, saveArenaV2DeckController);
router.patch('/arena/decks/:deck_id', authMiddleware, banCheckMiddleware, arenaDeckWriteLimiter, updateArenaV2DeckController);
router.delete('/arena/decks/:deck_id', authMiddleware, banCheckMiddleware, arenaDeckWriteLimiter, deleteArenaV2DeckController);
router.post('/arena/decks/:deck_id/validate', authMiddleware, banCheckMiddleware, arenaReadLimiter, revalidateArenaV2DeckController);
router.post('/arena/reports', authMiddleware, banCheckMiddleware, arenaStreamerConfigLimiter, arenaV2LegacyEndpointRemoved);
router.get('/arena/reports/mine', authMiddleware, banCheckMiddleware, arenaReadLimiter, arenaV2LegacyEndpointRemoved);
router.post('/arena/streamer-right-requests', authMiddleware, banCheckMiddleware, arenaStreamerConfigLimiter, arenaV2LegacyEndpointRemoved);
router.get('/arena/streamer-right-requests/mine', authMiddleware, banCheckMiddleware, arenaReadLimiter, arenaV2LegacyEndpointRemoved);
router.post('/arena/matchmaking/quick/join', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, arenaQuickJoinLimiter, joinArenaV2QuickQueueController);
router.get('/arena/matchmaking/quick/status', authMiddleware, banCheckMiddleware, arenaQuickStatusLimiter, getMyArenaV2QuickQueueStatusController);
router.post('/arena/matchmaking/quick/accept', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, arenaQuickAcceptLimiter, acceptMyArenaV2QuickQueueController);
router.get('/arena/matchmaking/quick/events', authMiddleware, banCheckMiddleware, arenaQuickStatusLimiter, arenaV2LegacyEndpointRemoved);
router.post('/arena/matchmaking/quick/cancel', authMiddleware, banCheckMiddleware, arenaQuickCancelLimiter, cancelMyArenaV2QuickQueueController);
router.post('/arena/matches', authMiddleware, banCheckMiddleware, arenaBotMatchLimiter, createArenaV2MatchController);
router.post('/arena/bot-matches', authMiddleware, banCheckMiddleware, arenaBotMatchLimiter, createArenaV2BotMatchController);
router.get('/arena/matches/recent', authMiddleware, banCheckMiddleware, arenaReadLimiter, arenaV2LegacyEndpointRemoved);
router.post('/arena/matches/:match_id/mulligan', authMiddleware, banCheckMiddleware, arenaRoundCommitLimiter, submitArenaV2MulliganController);
router.post('/arena/matches/:match_id/turn-action', authMiddleware, banCheckMiddleware, arenaRoundCommitLimiter, submitArenaV2TurnActionsController);
router.post('/arena/matches/:match_id/actions', authMiddleware, banCheckMiddleware, arenaRoundCommitLimiter, submitArenaV2TurnActionsController);
router.post('/arena/matches/:match_id/emotes', authMiddleware, banCheckMiddleware, arenaCosmeticWriteLimiter, sendArenaEmote);
router.post('/arena/matches/:match_id/rounds/commit', authMiddleware, banCheckMiddleware, arenaRoundCommitLimiter, arenaV2LegacyEndpointRemoved);
router.get('/arena/matches/:match_id', authMiddleware, banCheckMiddleware, arenaReadLimiter, getArenaV2MatchController);
router.get('/arena/matches/:match_id/replay', authMiddleware, banCheckMiddleware, arenaReadLimiter, getArenaV2ReplayController);
router.post('/arena/matches/:match_id/share', authMiddleware, banCheckMiddleware, arenaShareLimiter, arenaV2LegacyEndpointRemoved);
router.get('/arena/spectator/share/:token', arenaSpectatorLimiter, arenaV2LegacyEndpointRemoved);
router.get('/arena/profile/me', authMiddleware, banCheckMiddleware, arenaReadLimiter, getArenaV2CurrentRewardsController);
router.get('/arena/profile/:user_id', arenaReadLimiter, arenaV2LegacyEndpointRemoved);
router.get('/arena/rankings', arenaReadLimiter, listArenaV2RankingsController);
router.get('/arena/rewards/current', authMiddleware, banCheckMiddleware, arenaReadLimiter, getArenaV2CurrentRewardsController);
router.get('/arena/streamer-card/me', authMiddleware, banCheckMiddleware, arenaReadLimiter, getMyArenaV2StreamerCardController);
router.patch('/arena/streamer-card/me', authMiddleware, banCheckMiddleware, arenaStreamerConfigLimiter, updateMyArenaV2StreamerCardController);
router.post('/arena/streamer-card/me/disable', authMiddleware, banCheckMiddleware, arenaStreamerToggleLimiter, disableMyArenaV2StreamerCardController);
router.post('/arena/streamer-card/me/enable', authMiddleware, banCheckMiddleware, arenaStreamerToggleLimiter, enableMyArenaV2StreamerCardController);

// ==========================================

// ==========================================
// 1. 스트리머 관련 기능
// ==========================================
// 전체 스트리머 정보 목록 조회 (시세 탑3 리딩 등 활용)
// 여러 화면(메인·랭킹·가챠·관리자)에서 빈번히 호출되므로 메모리 캐시와 stale 응답을 적용합니다.
let streamersCache: { data: any[]; expiresAt: number } | null = null;
let streamersCacheInFlight: Promise<any[]> | null = null;
const streamersCacheTtlEnv = Number(process.env.STREAMERS_CACHE_TTL_MS);
const STREAMERS_CACHE_TTL = Number.isFinite(streamersCacheTtlEnv) && streamersCacheTtlEnv > 0 ? streamersCacheTtlEnv : 60_000;
const STREAMERS_CACHE_MAX_AGE_SECONDS = Math.max(15, Math.floor(STREAMERS_CACHE_TTL / 1000));
const STREAMERS_INCLUDE_VALUE_1H_HISTORY = process.env.STREAMERS_INCLUDE_VALUE_1H_HISTORY === 'true';

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
    if (err?.cause) {
      console.error('[Streamers] 스트리머 칭호 조회 실패:', err?.message || err);
      console.error('[Streamers] 상세 원인(cause):', err.cause)
    };
    // 직전 성공 캐시가 있으면 그대로 사용(없으면 칭호 없이) 하고, 곧 재시도하도록 짧게 캐싱합니다.
    if (titlesCache) {
      titlesCache.expiresAt = now + 30_000;
      return titlesCache.data;
    }
    return {} as Record<string, any[]>;
  }
};

router.get('/streamers', streamerReadLimiter, async (req, res) => {
  try {
    const now = Date.now();
    if (streamersCache && streamersCache.expiresAt > now) {
      res.set('Cache-Control', `public, max-age=${STREAMERS_CACHE_MAX_AGE_SECONDS}, stale-while-revalidate=120`);
      return res.status(200).json(streamersCache.data);
    }

    const refreshStreamersCache = () => {
      if (!streamersCacheInFlight) {
        streamersCacheInFlight = (async () => {
          const streamers = await streamerRepository.findAll();
          // 1시간 전 시세는 등락률 계산에만 필요합니다. 24h 표시값은 streamers.prev_value를 사용해 전체 이력 조회를 피합니다.
          const [value1hMap, titlesByUser] = await Promise.all([
            STREAMERS_INCLUDE_VALUE_1H_HISTORY
              ? loadStreamerValueMap('1시간 전', () => streamerRepository.getValue1hAgoMap())
              : Promise.resolve({} as Record<string, number>),
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
            prev_value: s.prev_value,
            value_1h_ago: value1hMap[s.channel_id] ?? s.prev_value ?? s.base_value
          }));

          streamersCache = { data: enriched, expiresAt: Date.now() + STREAMERS_CACHE_TTL };
          return enriched;
        })().finally(() => {
          streamersCacheInFlight = null;
        });
      }
      return streamersCacheInFlight;
    };

    if (streamersCache) {
      void refreshStreamersCache().catch((err: any) => {
        console.warn('[Streamers] stale 캐시 백그라운드 갱신 실패:', err?.message || err);
      });
      res.set('Cache-Control', `public, max-age=15, stale-while-revalidate=${Math.max(120, STREAMERS_CACHE_MAX_AGE_SECONDS)}`);
      res.set('X-Streamers-Cache', 'stale');
      return res.status(200).json(streamersCache.data);
    }

    if (streamersCacheInFlight) {
      const data = await streamersCacheInFlight;
      res.set('Cache-Control', `public, max-age=${STREAMERS_CACHE_MAX_AGE_SECONDS}, stale-while-revalidate=120`);
      return res.status(200).json(data);
    }

    const enriched = await refreshStreamersCache();
    res.set('Cache-Control', `public, max-age=${STREAMERS_CACHE_MAX_AGE_SECONDS}, stale-while-revalidate=120`);
    return res.status(200).json(enriched);
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '스트리머 정보를 로드하지 못했습니다.' });
  }
});

// 스트리머 포토카드 커스텀 이미지 지연 업로드 처리
router.get('/streamers/live-status', streamerReadLimiter, getStreamerLiveStatuses);
router.get('/streamers/ranking', streamerReadLimiter, getStreamerRankings);
router.post('/streamers/me/image', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, uploadSingleImage, uploadCustomImage);
// 스트리머 본인 별(0~5성) 커스텀 카드 이미지 삭제
router.post('/streamers/me/image/reset', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, deleteOwnCustomImage);

// 특정 스트리머 상세 + 시세 변화 그래프 데이터 (공개) — /streamers/search, /streamers/register 보다 뒤에 위치
router.get('/streamers/:channel_id', streamerReadLimiter, getStreamerDetail);

// ==========================================
// 2. 일반 유저 및 공용 기능
// ==========================================
// 스트리머 부적절 카드 신고 (스냅샷 보존형) — 분당 10회 제한 + 컨트롤러에서 중복 신고 차단
router.post('/cards/:channel_id/report', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, reportLimiter, reportStreamerCard);

// 쿠폰 등록(사용) API
router.post('/coupons/claim', authMiddleware, banCheckMiddleware, accountInteractionRestrictionMiddleware, couponLimiter, claimCoupon);

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

// 프로필 이미지가 설정되지 않은 스트리머 목록/일괄 삭제
router.get('/admin/streamers/missing-profile-images', authMiddleware, adminMiddleware, listMissingProfileImageStreamers);
router.post('/admin/streamers/missing-profile-images/delete', authMiddleware, adminMiddleware, deleteMissingProfileImageStreamers);

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

// 신고 스냅샷 이미지를 3x4 퍼즐 출제 제외 목록에 등록
router.post('/admin/reports/:report_id/puzzle-exclude', authMiddleware, adminMiddleware, excludeReportImageFromPuzzle);

// 관리자 대시보드 통계
router.get('/admin/stats', authMiddleware, adminMiddleware, getAdminStats);
router.get('/admin/insights', authMiddleware, adminMiddleware, getAdminInsights);

// 관리자 자산 변동 감사 로그 및 의심 계정 요약
router.get('/admin/asset-events', authMiddleware, adminMiddleware, getAdminAssetEvents);
router.get('/admin/asset-events/suspects', authMiddleware, adminMiddleware, getAdminAssetEventSuspects);
router.get('/admin/achievements', authMiddleware, adminMiddleware, adminGetAchievements);
router.post('/admin/achievements', authMiddleware, adminMiddleware, adminCreateAchievement);
router.put('/admin/achievements/:id', authMiddleware, adminMiddleware, adminUpdateAchievement);

// 관리자 유저 목록 (닉네임/채널ID 검색 + 페이지네이션)
router.get('/admin/users', authMiddleware, adminMiddleware, listUsers);
router.get('/admin/users/:user_id/audit/points', authMiddleware, adminMiddleware, getUserPointAudit);
router.post('/admin/users/:user_id/status-message/reset', authMiddleware, adminMiddleware, resetUserStatusMessage);

// 관리자 1:1 교환 이력 조회 (참여 유저 검색 + 상태 필터 + 페이지네이션)
router.get('/admin/trades', authMiddleware, adminMiddleware, getAdminTradeHistory);

router.get('/admin/titles', authMiddleware, adminMiddleware, listTitles);
router.post('/admin/titles', authMiddleware, adminMiddleware, createTitle);
router.get('/admin/titles/subscription-rules', authMiddleware, adminMiddleware, listSubscriptionTitleRuleSettings);
router.post('/admin/titles/subscription-rules', authMiddleware, adminMiddleware, createSubscriptionTitleRuleSetting);
router.put('/admin/titles/subscription-rules/:id', authMiddleware, adminMiddleware, updateSubscriptionTitleRuleSetting);
router.delete('/admin/titles/subscription-rules/:id', authMiddleware, adminMiddleware, deleteSubscriptionTitleRuleSetting);
router.put('/admin/titles/:id', authMiddleware, adminMiddleware, updateTitle);
router.delete('/admin/titles/:id', authMiddleware, adminMiddleware, deleteTitle);
router.post('/admin/titles/:id/award-many', authMiddleware, adminMiddleware, awardTitleToMany);
router.post('/admin/titles/:id/revoke-many', authMiddleware, adminMiddleware, revokeTitleFromMany);
router.post('/admin/titles/:id/users/:user_id', authMiddleware, adminMiddleware, awardTitle);
router.delete('/admin/titles/:id/users/:user_id', authMiddleware, adminMiddleware, revokeTitle);
router.post('/titles/subscriptions/sync', authMiddleware, banCheckMiddleware, syncMySubscriptionTitleRules);

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

