import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middlewares/auth';
import { adminMiddleware } from '../middlewares/admin';
import { banCheckMiddleware } from '../middlewares/banCheck';
import { uploadCustomImage } from '../controllers/streamerController';
import { reportStreamerCard } from '../controllers/reportController';
import { getChzzkAuthUrl, handleChzzkCallback } from '../controllers/chzzkAuthController';
import {
  resetStreamerImage,
  banStreamerImage,
  unbanStreamerImage,
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
  deleteAnnouncement
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
import { streamerRepository } from '../repositories';

const router = Router();

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
router.post('/auth/chzzk/callback', handleChzzkCallback);
router.get('/users/me', authMiddleware, banCheckMiddleware, getUserMe);
router.get('/users/ranking', getUserRankings);
router.get('/users/me/cards', authMiddleware, banCheckMiddleware, getUserCards);
router.post('/cards/draw', authMiddleware, banCheckMiddleware, drawCard);
router.post('/cards/sell', authMiddleware, banCheckMiddleware, sellCards);

// 신규 스트리머 검색 및 카드 등록 API
router.get('/streamers/search', authMiddleware, banCheckMiddleware, searchChzzkStreamer);
router.post('/streamers/register', authMiddleware, banCheckMiddleware, registerStreamer);



// ==========================================
// ==========================================
// 1. 스트리머 관련 기능
// ==========================================
// 전체 스트리머 정보 목록 조회 (시세 탑3 리딩 등 활용)
router.get('/streamers', async (req, res) => {
  try {
    const streamers = await streamerRepository.findAll();
    return res.status(200).json(streamers);
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '스트리머 정보를 로드하지 못했습니다.' });
  }
});

// 스트리머 포토카드 커스텀 이미지 지연 업로드 처리
router.post('/streamers/me/image', authMiddleware, banCheckMiddleware, upload.single('image'), uploadCustomImage);

// ==========================================
// 2. 일반 유저 및 공용 기능
// ==========================================
// 스트리머 부적절 카드 신고 (스냅샷 보존형)
router.post('/cards/:channel_id/report', authMiddleware, banCheckMiddleware, reportStreamerCard);

// 쿠폰 등록(사용) API
router.post('/coupons/claim', authMiddleware, banCheckMiddleware, claimCoupon);

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

// 특정 유저에 대한 활동 제재 실행 (1일, 7일, 30일, 영구 정지)
router.post('/admin/users/:user_id/ban', authMiddleware, adminMiddleware, banUser);

// 특정 유저의 활동 제재 해제
router.post('/admin/users/:user_id/unban', authMiddleware, adminMiddleware, unbanUser);

// 전체 접수된 신고 목록 열람
router.get('/admin/reports', authMiddleware, adminMiddleware, getReports);

// 특정 신고 건에 대한 종결 처리 상태 갱신
router.post('/admin/reports/:report_id/resolve', authMiddleware, adminMiddleware, resolveReport);

// 쿠폰 발급 API
router.post('/admin/coupons', authMiddleware, adminMiddleware, createCoupon);

// 공지사항 작성
router.post('/admin/announcements', authMiddleware, adminMiddleware, createAnnouncement);

// 공지사항 삭제
router.delete('/admin/announcements/:id', authMiddleware, adminMiddleware, deleteAnnouncement);

// 푸시 알림 즉시 또는 예약 생성
router.post('/admin/push/schedule', authMiddleware, adminMiddleware, scheduleNotification);

export default router;
