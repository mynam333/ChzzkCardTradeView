import { Request, Response } from 'express';
import {
  streamerRepository,
  userRepository,
  reportRepository,
  couponRepository,
  userCardRepository,
  tradeRepository,
  notificationRepository
} from '../repositories';
import { AuthenticatedRequest } from '../middlewares/admin';
import { IS_PRODUCTION } from '../config';
import { sendPushToUser } from './pushController';

/**
 * 특정 스트리머의 카드를 전량 삭제(스트리머 폐기)하고, 보유자에게 삭제 시점 시세만큼 보상 지급
 * - 보유 카드 1장당 base_value × (1 + star*0.6) 포인트를 보유자에게 지급
 * - 이후 해당 스트리머의 카드를 모두 삭제하고 스트리머 레코드도 제거(시세이력/신고 CASCADE)
 */
export const deleteStreamerCards = async (req: Request, res: Response) => {
  const { channel_id } = req.params;
  if (!channel_id) {
    return res.status(400).json({ error: 'BadRequest', message: '대상 스트리머 채널 ID가 유효하지 않습니다.' });
  }
  try {
    const streamer = await streamerRepository.findById(channel_id);
    if (!streamer) {
      return res.status(404).json({ error: 'NotFound', message: '스트리머 정보를 찾을 수 없습니다.' });
    }

    const baseValue = streamer.base_value || 0;
    const cards = await userCardRepository.findByChannel(channel_id);

    // 보유자별 보상 합산 (별 등급 배율 반영)
    const payout: Record<string, number> = {};
    for (const c of cards) {
      payout[c.user_id] = (payout[c.user_id] || 0) + Math.round(baseValue * (1 + (c.star || 0) * 0.6));
    }

    // 포인트 지급 + 알림
    let totalPaid = 0;
    for (const [userId, amount] of Object.entries(payout)) {
      if (amount <= 0) continue;
      await userRepository.incrementPoint(userId, amount);
      totalPaid += amount;
      const title = '카드 보상 지급';
      const body = `'${streamer.name}' 카드가 삭제되어 ${amount.toLocaleString()} P가 지급되었습니다.`;
      sendPushToUser(userId, title, body, '/');
      notificationRepository.create({ user_id: userId, title, body, link: 'gacha' }).catch(() => { /* 무시 */ });
    }

    // 카드 전량 삭제 후 스트리머 제거
    const removed = await userCardRepository.deleteByChannel(channel_id);
    await streamerRepository.delete(channel_id);

    return res.status(200).json({
      message: `'${streamer.name}' 스트리머 카드를 삭제했습니다. 보유자 ${Object.keys(payout).length}명에게 총 ${totalPaid.toLocaleString()} P를 지급했습니다. (삭제 카드 ${removed}장)`,
      channel_id,
      affected_users: Object.keys(payout).length,
      cards_removed: removed,
      total_points_paid: totalPaid
    });
  } catch (err: any) {
    console.error('[AdminController] deleteStreamerCards 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '스트리머 카드 삭제 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 1. 스트리머 카드 커스텀 이미지를 기본 프로필로 강제 초기화
 */
export const resetStreamerImage = async (req: Request, res: Response) => {
  const { channel_id } = req.params;
  // star 미지정 시 전체 초기화, 0~5 지정 시 해당 별 슬롯만 초기화
  const rawStar = req.body?.star ?? req.query?.star;
  const hasStar = rawStar !== undefined && rawStar !== null && rawStar !== '';
  const star = hasStar ? Math.max(0, Math.min(5, parseInt(String(rawStar), 10) || 0)) : null;

  if (!channel_id) {
    return res.status(400).json({ error: 'BadRequest', message: '대상 스트리머 채널 ID가 유효하지 않습니다.' });
  }

  try {
    const streamer = await streamerRepository.findById(channel_id);
    if (!streamer) {
      return res.status(404).json({ error: 'NotFound', message: '스트리머 정보를 찾을 수 없습니다.' });
    }

    if (star === null) {
      // 전체 별 슬롯 초기화
      await streamerRepository.resetAllCustomImages(channel_id);
    } else {
      // 특정 별 슬롯만 초기화
      await streamerRepository.updateCustomImage(channel_id, null, star);
    }

    return res.status(200).json({
      message: star === null
        ? `스트리머(${streamer.name})의 모든 커스텀 카드 이미지가 초기화되었습니다.`
        : `스트리머(${streamer.name})의 ${star}성 카드 이미지가 초기화되었습니다.`,
      channel_id,
      star
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '스트리머 이미지 초기화 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 2. 특정 스트리머의 커스텀 이미지 수정 권한을 차단(Ban)
 */
export const banStreamerImage = async (req: Request, res: Response) => {
  const { channel_id } = req.params;

  if (!channel_id) {
    return res.status(400).json({ error: 'BadRequest', message: '대상 스트리머 채널 ID가 유효하지 않습니다.' });
  }

  try {
    const streamer = await streamerRepository.findById(channel_id);
    if (!streamer) {
      return res.status(404).json({ error: 'NotFound', message: '스트리머 정보를 찾을 수 없습니다.' });
    }

    // 업로드 권한 차단
    await streamerRepository.updateImageBanStatus(channel_id, true);
    // 차단 완료 후 즉각적인 기존 커스텀 이미지(전체 별 슬롯) 초기화 병행 (안전 조치)
    await streamerRepository.resetAllCustomImages(channel_id);

    return res.status(200).json({
      message: `스트리머(${streamer.name})의 카드 이미지 업로드 권한이 성공적으로 차단되었으며, 기존 커스텀 이미지가 수거되었습니다.`,
      channel_id
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '스트리머 이미지 차단 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 3. 특정 스트리머의 커스텀 이미지 수정 권한 차단 해제(Unban)
 */
export const unbanStreamerImage = async (req: Request, res: Response) => {
  const { channel_id } = req.params;

  if (!channel_id) {
    return res.status(400).json({ error: 'BadRequest', message: '대상 스트리머 채널 ID가 유효하지 않습니다.' });
  }

  try {
    const streamer = await streamerRepository.findById(channel_id);
    if (!streamer) {
      return res.status(404).json({ error: 'NotFound', message: '스트리머 정보를 찾을 수 없습니다.' });
    }

    await streamerRepository.updateImageBanStatus(channel_id, false);

    return res.status(200).json({
      message: `스트리머(${streamer.name})의 카드 이미지 업로드 차단이 해제되었습니다.`,
      channel_id
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '스트리머 차단 해제 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 4. 특정 유저에 대한 활동 제재 실행 (1일, 7일, 30일, 영구 정지)
 */
export const banUser = async (req: Request, res: Response) => {
  const { user_id } = req.params;
  const { duration } = req.body; // '1d', '7d', '30d', 'permanent'

  if (!user_id || !duration) {
    return res.status(400).json({ error: 'BadRequest', message: '대상 유저 ID 및 차단 기간(duration)이 필요합니다.' });
  }

  try {
    const targetUser = await userRepository.findById(user_id);
    if (!targetUser) {
      return res.status(404).json({ error: 'NotFound', message: '대상 사용자를 찾을 수 없습니다.' });
    }

    // 어드민 계정 자체 밴 방지
    if (targetUser.role === 'ADMIN') {
      return res.status(403).json({ error: 'Forbidden', message: '관리자 권한 계정은 차단할 수 없습니다.' });
    }

    let banDate = new Date();
    switch (duration) {
      case '1d':
        banDate.setDate(banDate.getDate() + 1);
        break;
      case '7d':
        banDate.setDate(banDate.getDate() + 7);
        break;
      case '30d':
        banDate.setDate(banDate.getDate() + 30);
        break;
      case 'permanent':
        // 영구 차단 시 9999년으로 날짜 고정 지정
        banDate = new Date('9999-12-31T23:59:59Z');
        break;
      default:
        return res.status(400).json({ error: 'BadRequest', message: '유효한 차단 기간 형식이 아닙니다 (1d, 7d, 30d, permanent).' });
    }

    const bannedUntilIso = banDate.toISOString();
    await userRepository.updateBanStatus(user_id, bannedUntilIso);

    return res.status(200).json({
      message: `사용자(${targetUser.username})가 제재 처리되었습니다.`,
      user_id,
      banned_until: bannedUntilIso
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '유저 차단 처리 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 5. 특정 유저의 활동 제재 해제
 */
export const unbanUser = async (req: Request, res: Response) => {
  const { user_id } = req.params;

  if (!user_id) {
    return res.status(400).json({ error: 'BadRequest', message: '대상 유저 ID가 유효하지 않습니다.' });
  }

  try {
    const targetUser = await userRepository.findById(user_id);
    if (!targetUser) {
      return res.status(404).json({ error: 'NotFound', message: '대상 사용자를 찾을 수 없습니다.' });
    }

    await userRepository.updateBanStatus(user_id, null);

    return res.status(200).json({
      message: `사용자(${targetUser.username})의 제재가 해제되어 정상 정상 활동이 가능합니다.`,
      user_id
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '유저 제재 해제 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 6. 신고 내역 목록 조회
 */
export const getReports = async (req: Request, res: Response) => {
  try {
    const reports = await reportRepository.findAll();
    return res.status(200).json(reports);
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '신고 목록 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 7. 신고 처리 상태 종결 (승인/기각)
 */
export const resolveReport = async (req: Request, res: Response) => {
  const { report_id } = req.params;
  const { status } = req.body; // 'resolved' or 'rejected'

  if (!report_id || !['resolved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'BadRequest', message: '유효한 신고 ID 및 처리 상태(status: resolved | rejected)가 필요합니다.' });
  }

  try {
    await reportRepository.updateStatus(Number(report_id), status);
    return res.status(200).json({
      message: `신고(${report_id}) 건이 성공적으로 처리(${status})되었습니다.`,
      report_id,
      status
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '신고 처리 상태 변경 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 8. 관리자 대시보드 통계 요약
 */
export const getAdminStats = async (req: Request, res: Response) => {
  try {
    const [userCount, streamerCount, cardCount, completedTrades, pendingReports] = await Promise.all([
      userRepository.count(),
      streamerRepository.count(),
      userCardRepository.count(),
      tradeRepository.countCompleted(),
      reportRepository.countPending()
    ]);

    return res.status(200).json({
      user_count: userCount,
      streamer_count: streamerCount,
      card_distributed: cardCount,
      completed_trades: completedTrades,
      pending_reports: pendingReports
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '통계 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 관리자용 유저 목록 조회 (닉네임/채널ID 검색 + 페이지네이션)
 * - 프로필 이미지(avatar_url), 닉네임(username), 채널ID(id)만 노출
 * - 토큰 등 민감 정보는 응답에서 제외
 */
export const listUsers = async (req: Request, res: Response) => {
  try {
    const keyword = typeof req.query.q === 'string' ? req.query.q : '';
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const rawLimit = parseInt(String(req.query.limit || '20'), 10) || 20;
    const limit = Math.min(50, Math.max(1, rawLimit));
    const offset = (page - 1) * limit;

    const { users, total } = await userRepository.listUsers(keyword, limit, offset);
    const items = users.map((u) => ({
      id: u.id,
      username: u.username,
      avatar_url: u.avatar_url,
      role: u.role,
      point: u.point,
      banned_until: u.banned_until ?? null,
      created_at: u.created_at ?? null
    }));

    return res.status(200).json({
      users: items,
      total,
      page,
      limit,
      total_pages: Math.max(1, Math.ceil(total / limit))
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '유저 목록 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 9. 발급된 쿠폰 목록 및 사용 현황 조회
 */
export const getCoupons = async (req: Request, res: Response) => {
  try {
    const coupons = await couponRepository.findAll();
    return res.status(200).json(coupons);
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '쿠폰 목록 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};
