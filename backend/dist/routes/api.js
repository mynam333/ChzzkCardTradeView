"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const auth_1 = require("../middlewares/auth");
const admin_1 = require("../middlewares/admin");
const banCheck_1 = require("../middlewares/banCheck");
const streamerController_1 = require("../controllers/streamerController");
const reportController_1 = require("../controllers/reportController");
const chzzkAuthController_1 = require("../controllers/chzzkAuthController");
const adminController_1 = require("../controllers/adminController");
const couponController_1 = require("../controllers/couponController");
const announcementController_1 = require("../controllers/announcementController");
const pushController_1 = require("../controllers/pushController");
const router = (0, express_1.Router)();
// Multer 파일 메모리 스토리지 세팅 (최대 5MB 제한)
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});
// ==========================================
// 0. 치지직 OpenAPI OAuth 로그인 기능
// ==========================================
router.get('/auth/chzzk/url', chzzkAuthController_1.getChzzkAuthUrl);
router.post('/auth/chzzk/callback', chzzkAuthController_1.handleChzzkCallback);
// ==========================================
// 1. 스트리머 전용 기능
// ==========================================
// 스트리머 포토카드 커스텀 이미지 지연 업로드 처리
router.post('/streamers/me/image', auth_1.authMiddleware, banCheck_1.banCheckMiddleware, upload.single('image'), streamerController_1.uploadCustomImage);
// ==========================================
// 2. 일반 유저 및 공용 기능
// ==========================================
// 스트리머 부적절 카드 신고 (스냅샷 보존형)
router.post('/cards/:channel_id/report', auth_1.authMiddleware, banCheck_1.banCheckMiddleware, reportController_1.reportStreamerCard);
// 쿠폰 등록(사용) API
router.post('/coupons/claim', auth_1.authMiddleware, banCheck_1.banCheckMiddleware, couponController_1.claimCoupon);
// 공지사항 전체 조회
router.get('/announcements', announcementController_1.getAnnouncements);
// 활성 팝업 공지 조회
router.get('/announcements/popups', announcementController_1.getActivePopups);
// PWA 푸시 퍼블릭 키 조회
router.get('/push/vapid-key', pushController_1.getVapidPublicKey);
// PWA 푸시 구독 등록
router.post('/push/subscribe', auth_1.authMiddleware, pushController_1.subscribePush);
// ==========================================
// 3. 관리자(ADMIN) 전용 통제 기능 (Admin Guard 및 Auth Check 필터 통과)
// ==========================================
// 특정 스트리머의 카드 이미지를 기본 프로필로 강제 초기화
router.post('/admin/streamers/:channel_id/image/reset', auth_1.authMiddleware, admin_1.adminMiddleware, adminController_1.resetStreamerImage);
// 특정 스트리머의 이미지 업로드 편집 권한 차단 (밴) 및 기존 이미지 초기화
router.post('/admin/streamers/:channel_id/image/ban', auth_1.authMiddleware, admin_1.adminMiddleware, adminController_1.banStreamerImage);
// 특정 스트리머의 이미지 업로드 편집 권한 차단 해제 (언밴)
router.post('/admin/streamers/:channel_id/image/unban', auth_1.authMiddleware, admin_1.adminMiddleware, adminController_1.unbanStreamerImage);
// 특정 유저에 대한 활동 제재 실행 (1일, 7일, 30일, 영구 정지)
router.post('/admin/users/:user_id/ban', auth_1.authMiddleware, admin_1.adminMiddleware, adminController_1.banUser);
// 특정 유저의 활동 제재 해제
router.post('/admin/users/:user_id/unban', auth_1.authMiddleware, admin_1.adminMiddleware, adminController_1.unbanUser);
// 전체 접수된 신고 목록 열람
router.get('/admin/reports', auth_1.authMiddleware, admin_1.adminMiddleware, adminController_1.getReports);
// 특정 신고 건에 대한 종결 처리 상태 갱신
router.post('/admin/reports/:report_id/resolve', auth_1.authMiddleware, admin_1.adminMiddleware, adminController_1.resolveReport);
// 쿠폰 발급 API
router.post('/admin/coupons', auth_1.authMiddleware, admin_1.adminMiddleware, couponController_1.createCoupon);
// 공지사항 작성
router.post('/admin/announcements', auth_1.authMiddleware, admin_1.adminMiddleware, announcementController_1.createAnnouncement);
// 공지사항 삭제
router.delete('/admin/announcements/:id', auth_1.authMiddleware, admin_1.adminMiddleware, announcementController_1.deleteAnnouncement);
// 푸시 알림 즉시 또는 예약 생성
router.post('/admin/push/schedule', auth_1.authMiddleware, admin_1.adminMiddleware, pushController_1.scheduleNotification);
exports.default = router;
