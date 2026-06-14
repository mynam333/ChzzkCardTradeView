import { Request, Response } from 'express';
import {
  streamerRepository,
  userRepository,
  reportRepository,
  couponRepository,
  userCardRepository,
  tradeRepository,
  notificationRepository,
  systemConfigRepository,
  titleRepository
} from '../repositories';
import { AuthenticatedRequest } from '../middlewares/admin';
import { IS_PRODUCTION } from '../config';
import { sendPushToUser } from './pushController';
import { deleteLocalUploadByUrl } from '../services/imageService';
import { clearRankingCaches, clearUserRankingCaches } from './playController';
import { publishRealtimeEvent } from '../services/realtimeStream';
import { CardReport, Streamer } from '../repositories/interfaces';
import { listPointLedgerForUser } from '../services/pointLedger';
import { isDiceBearImageUrl } from '../services/chzzkService';
import {
  addPuzzleExcludedImage,
  getPuzzleExcludedImageKeys,
  normalizePuzzleImageKey
} from '../services/puzzleImageExclusionService';

const reportStarLabel = (report: CardReport) => `${report.star || 0}성`;

const reportTargetLabel = async (report: CardReport) => {
  const streamer = await streamerRepository.findById(report.channel_id).catch(() => null);
  return streamer?.name || report.channel_id;
};

const truncateReportReason = (reason: string) => {
  const trimmed = reason.trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 120)}...` : trimmed;
};

const findReportTargetUserIds = async (report: CardReport) => {
  const streamer = await streamerRepository.findById(report.channel_id).catch(() => null);
  const candidateIds = [streamer?.registered_by, report.channel_id].filter(Boolean) as string[];
  const uniqueIds = [...new Set(candidateIds)];
  if (uniqueIds.length === 0) return { targetName: streamer?.name || report.channel_id, userIds: [] as string[] };

  const users = await userRepository.findByIds(uniqueIds).catch(() => []);
  return {
    targetName: streamer?.name || report.channel_id,
    userIds: users.map((user) => user.id)
  };
};

const notifyReportResult = async (
  report: CardReport,
  status: 'resolved' | 'rejected',
  options: { targetName?: string; actionLabel?: string; detail?: string } = {}
) => {
  const targetName = options.targetName || await reportTargetLabel(report);
  const target = `'${targetName}' ${reportStarLabel(report)} 카드`;
  const reason = truncateReportReason(report.reason);
  const title = status === 'resolved' ? '신고 처리 완료' : '신고 기각 안내';
  const body = status === 'rejected'
    ? `신고하신 ${target} 신고가 기각되었습니다. 신고 사유: "${reason}". 검토 결과 별도 조치가 필요하지 않은 것으로 판단되었습니다.`
    : `신고하신 ${target} 신고가 처리되었습니다. 신고 사유: "${reason}". 처리 내용: ${options.detail || options.actionLabel || '관리자 검토 완료'}.`;

  await notificationRepository.create({
    user_id: report.reporter_id,
    title,
    body,
    link: 'my-info'
  });
  sendPushToUser(report.reporter_id, title, body, '/my-info').catch(() => { /* 푸시 실패는 처리 결과 저장을 막지 않습니다. */ });

  if (status !== 'resolved') return;

  const { userIds: targetUserIds } = await findReportTargetUserIds(report);
  if (targetUserIds.length === 0) return;

  const targetTitle = '카드 이미지 신고 처리 안내';
  const targetBody = `${target}에 "${reason}" 사유로 접수된 신고가 처리되었습니다. 처리 내용: ${options.detail || options.actionLabel || '관리자 검토 완료'}.`;
  for (const userId of targetUserIds) {
    await notificationRepository.create({
      user_id: userId,
      title: targetTitle,
      body: targetBody,
      link: 'my-info'
    });
    sendPushToUser(userId, targetTitle, targetBody, '/my-info').catch(() => { /* 푸시 실패는 처리 결과 저장을 막지 않습니다. */ });
  }
};

const hasMissingProfileImage = (streamer: Pick<Streamer, 'logo_url'>) =>
  !streamer.logo_url || streamer.logo_url.trim().length === 0 || isDiceBearImageUrl(streamer.logo_url);

type DeleteStreamerWithCompensationOptions = {
  preventReregistration?: boolean;
  blockReason?: string;
  blockedBy?: string | null;
  pendingReports?: CardReport[];
  reportDetail?: string;
};

const deleteStreamerWithCompensation = async (
  streamer: Streamer,
  options: DeleteStreamerWithCompensationOptions = {}
) => {
  const channelId = streamer.channel_id;
  const cards = await userCardRepository.findByChannel(channelId);
  const pendingReports = (options.pendingReports || await reportRepository.findAll().catch(() => []))
    .filter((report) => report.channel_id === channelId && report.status === 'pending');

  const cardsByUser: Record<string, number> = {};
  for (const c of cards) {
    cardsByUser[c.user_id] = (cardsByUser[c.user_id] || 0) + 1;
  }

  let totalFreeDrawTicketsGranted = 0;
  for (const [userId, deletedCount] of Object.entries(cardsByUser)) {
    if (deletedCount <= 0) continue;
    await userRepository.addBonusFreeDrawTickets(userId, 1);
    totalFreeDrawTicketsGranted += 1;
    const title = '보유 카드 삭제 및 보상 지급';
    const body = `'${streamer.name}' 카드 ${deletedCount.toLocaleString()}장이 삭제되어 추가 무료 소환 티켓 1장이 지급되었습니다.`;
    sendPushToUser(userId, title, body, '/shop');
    notificationRepository.create({ user_id: userId, title, body, link: 'shop' }).catch(() => { /* 무시 */ });
  }

  const removed = await userCardRepository.deleteByChannel(channelId);
  if (options.preventReregistration) {
    await streamerRepository.blockRegistration(
      channelId,
      options.blockReason || '[관리자 삭제] 카드 재등록 금지',
      options.blockedBy || null
    );
  }

  for (const report of pendingReports) {
    await notifyReportResult(report, 'resolved', {
      targetName: streamer.name,
      detail: options.reportDetail || `신고 대상 카드가 삭제되었고 보유자에게 추가 무료 소환 티켓 보상이 지급되었습니다.${options.preventReregistration ? ' 해당 채널의 카드 재등록도 차단되었습니다.' : ''}`
    }).catch(() => { /* 알림 실패는 카드 삭제 처리를 막지 않습니다. */ });
  }

  await streamerRepository.delete(channelId);

  return {
    channel_id: channelId,
    name: streamer.name,
    affected_users: Object.keys(cardsByUser).length,
    cards_removed: removed,
    total_free_draw_tickets_granted: totalFreeDrawTicketsGranted,
    registration_blocked: options.preventReregistration === true
  };
};

/**
 * 특정 스트리머의 카드를 전량 삭제(스트리머 폐기)하고, 보유자에게 추가 무료 소환 티켓 보상 지급
 * - 삭제 대상 카드를 1장 이상 보유한 유저당 추가 무료 소환 티켓 1장을 지급
 * - 이후 해당 스트리머의 카드를 모두 삭제하고 스트리머 레코드도 제거(시세이력/신고 CASCADE)
 */
export const deleteStreamerCards = async (req: Request, res: Response) => {
  const { channel_id } = req.params;
  const preventReregistration = req.body?.prevent_reregistration === true;
  if (!channel_id) {
    return res.status(400).json({ error: 'BadRequest', message: '대상 스트리머 채널 ID가 유효하지 않습니다.' });
  }
  if (req.body?.confirmation !== channel_id) {
    return res.status(400).json({ error: 'BadRequest', message: '스트리머 삭제 확인 값이 올바르지 않습니다.' });
  }
  try {
    const streamer = await streamerRepository.findById(channel_id);
    if (!streamer) {
      return res.status(404).json({ error: 'NotFound', message: '스트리머 정보를 찾을 수 없습니다.' });
    }

    const result = await deleteStreamerWithCompensation(streamer, {
      preventReregistration,
      blockReason: '[본인 카드 삭제 요청] 권리자 요청에 따라 카드 재등록 금지',
      blockedBy: (req as AuthenticatedRequest).user?.id || null
    });
    clearRankingCaches();

    return res.status(200).json({
      message: `'${streamer.name}' 스트리머 카드를 삭제했습니다. 보유자 ${result.affected_users}명에게 추가 무료 소환 티켓 1장씩 지급했습니다. (삭제 카드 ${result.cards_removed}장)${preventReregistration ? ' 재등록 금지도 적용했습니다.' : ''}`,
      channel_id,
      affected_users: result.affected_users,
      cards_removed: result.cards_removed,
      compensation_type: 'free_draw_ticket',
      total_free_draw_tickets_granted: result.total_free_draw_tickets_granted,
      registration_blocked: preventReregistration
    });
  } catch (err: any) {
    console.error('[AdminController] deleteStreamerCards 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '스트리머 카드 삭제 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

export const listMissingProfileImageStreamers = async (_req: Request, res: Response) => {
  try {
    const streamers = (await streamerRepository.findAll()).filter(hasMissingProfileImage);
    const enriched = await Promise.all(streamers.map(async (streamer) => {
      const cards = await userCardRepository.findByChannel(streamer.channel_id).catch(() => []);
      const affectedUsers = new Set(cards.map((card) => card.user_id)).size;
      return {
        ...streamer,
        card_count: cards.length,
        affected_users: affectedUsers
      };
    }));

    return res.status(200).json({
      streamers: enriched.sort((a, b) => b.card_count - a.card_count),
      count: enriched.length,
      total_cards: enriched.reduce((sum, item) => sum + item.card_count, 0),
      total_affected_users: enriched.reduce((sum, item) => sum + item.affected_users, 0)
    });
  } catch (err: any) {
    console.error('[AdminController] listMissingProfileImageStreamers 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '프로필 이미지 미설정 스트리머 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

export const deleteMissingProfileImageStreamers = async (req: Request, res: Response) => {
  if (req.body?.confirmation !== 'DELETE_MISSING_PROFILE_IMAGES') {
    return res.status(400).json({ error: 'BadRequest', message: '일괄 삭제 확인 값이 올바르지 않습니다.' });
  }

  try {
    const streamers = (await streamerRepository.findAll()).filter(hasMissingProfileImage);
    if (streamers.length === 0) {
      return res.status(200).json({
        message: '프로필 이미지가 설정되지 않은 스트리머가 없습니다.',
        deleted_streamers: 0,
        affected_users: 0,
        cards_removed: 0,
        compensation_type: 'free_draw_ticket',
        total_free_draw_tickets_granted: 0,
        results: []
      });
    }

    const pendingReports = await reportRepository.findAll().catch(() => []);
    const results = [];
    for (const streamer of streamers) {
      const result = await deleteStreamerWithCompensation(streamer, {
        pendingReports,
        reportDetail: '프로필 이미지가 설정되지 않은 스트리머 정리로 카드가 삭제되었고 보유자에게 추가 무료 소환 티켓 보상이 지급되었습니다.'
      });
      results.push(result);
    }
    clearRankingCaches();

    const affectedUsers = results.reduce((sum, item) => sum + item.affected_users, 0);
    const cardsRemoved = results.reduce((sum, item) => sum + item.cards_removed, 0);
    const ticketsGranted = results.reduce((sum, item) => sum + item.total_free_draw_tickets_granted, 0);

    return res.status(200).json({
      message: `프로필 이미지가 설정되지 않은 스트리머 ${results.length}명을 삭제했습니다. 보유자 보상 ${ticketsGranted}건, 삭제 카드 ${cardsRemoved}장.`,
      deleted_streamers: results.length,
      affected_users: affectedUsers,
      cards_removed: cardsRemoved,
      compensation_type: 'free_draw_ticket',
      total_free_draw_tickets_granted: ticketsGranted,
      results
    });
  } catch (err: any) {
    console.error('[AdminController] deleteMissingProfileImageStreamers 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '프로필 이미지 미설정 스트리머 일괄 삭제 실패', details: IS_PRODUCTION ? undefined : err.message });
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
      // 전체 별 슬롯 초기화 + 로컬 업로드 파일 정리
      const urls = [streamer.custom_image_url, ...(streamer.custom_images || [])];
      await streamerRepository.resetAllCustomImages(channel_id);
      for (const u of urls) deleteLocalUploadByUrl(u);
    } else {
      // 특정 별 슬롯만 초기화 + 해당 파일 정리
      const prevUrl = (streamer.custom_images && streamer.custom_images[star]) || (star === 0 ? streamer.custom_image_url : null);
      await streamerRepository.updateCustomImage(channel_id, null, star);
      deleteLocalUploadByUrl(prevUrl);
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
    const urls = [streamer.custom_image_url, ...(streamer.custom_images || [])];
    await streamerRepository.resetAllCustomImages(channel_id);
    for (const u of urls) deleteLocalUploadByUrl(u);

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
 * 제재된 유저 목록 조회 (닉네임/ID 검색, 정렬, 페이지네이션 지원)
 */
export const getBannedUsers = async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = parseInt(req.query.limit as string, 10) || 10;
  const keyword = (req.query.q as string) || '';
  const sortBy = (req.query.sortBy as string) || 'banned_until';
  const sortOrder = (req.query.sortOrder as string) === 'asc' ? 'asc' : 'desc';

  const offset = (page - 1) * limit;

  try {
    const { users, total } = await userRepository.listBannedUsers(keyword, sortBy, sortOrder, limit, offset);

    return res.status(200).json({
      users: users.map(u => ({
        id: u.id,
        username: u.username,
        avatar_url: u.avatar_url,
        banned_until: u.banned_until,
        ban_reason: u.ban_reason,
        created_at: u.created_at
      })),
      total,
      page,
      total_pages: Math.ceil(total / limit)
    });
  } catch (err: any) {
    return res.status(500).json({
      error: 'InternalServerError',
      message: '제재 유저 목록 조회 실패',
      details: IS_PRODUCTION ? undefined : err.message
    });
  }
};

/**
 * 선택된 유저들의 제재 상태 일괄 수정
 */
export const bulkUpdateBans = async (req: Request, res: Response) => {
  const { userIds, duration, reason } = req.body;

  if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'BadRequest', message: '대상 유저 ID 목록(userIds)이 필요합니다.' });
  }

  if (!duration) {
    return res.status(400).json({ error: 'BadRequest', message: '제재 방식(duration)이 필요합니다.' });
  }

  try {
    let banDate: Date | null = null;
    let bannedUntilIso: string | null = null;

    if (duration !== 'unban') {
      banDate = new Date();
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
          banDate = new Date('9999-12-31T23:59:59Z');
          break;
        default:
          return res.status(400).json({ error: 'BadRequest', message: '유효하지 않은 제재 기간 형식입니다.' });
      }
      bannedUntilIso = banDate.toISOString();
    }

    const results = [];
    for (const userId of userIds) {
      const targetUser = await userRepository.findById(userId);
      if (targetUser && targetUser.role !== 'ADMIN') {
        await userRepository.updateBanStatus(userId, bannedUntilIso, duration === 'unban' ? null : reason);
        results.push(userId);
      }
    }
    if (results.length > 0) clearUserRankingCaches();

    return res.status(200).json({
      message: `${results.length}명의 사용자 제재가 수정되었습니다.`,
      updated_user_ids: results,
      banned_until: bannedUntilIso
    });
  } catch (err: any) {
    return res.status(500).json({
      error: 'InternalServerError',
      message: '일괄 제재 수정 실패',
      details: IS_PRODUCTION ? undefined : err.message
    });
  }
};

/**
 * 4. 특정 유저에 대한 활동 제재 실행 (1일, 7일, 30일, 영구 정지)
 */
export const banUser = async (req: Request, res: Response) => {
  const { user_id } = req.params;
  const { duration, reason } = req.body; // '1d', '7d', '30d', 'permanent', 'reason'

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
    await userRepository.updateBanStatus(user_id, bannedUntilIso, reason);
    clearUserRankingCaches();

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
    clearUserRankingCaches();

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

    // 신고자 닉네임 / 대상 스트리머 닉네임을 함께 제공 (배치 조회로 N+1 방지)
    const reporterIds = [...new Set(reports.map((r) => r.reporter_id))];
    const channelIds = [...new Set(reports.map((r) => r.channel_id))];
    const [reporters, streamers, puzzleExcludedKeys] = await Promise.all([
      userRepository.findByIds(reporterIds).catch(() => []),
      streamerRepository.findByIds(channelIds).catch(() => []),
      getPuzzleExcludedImageKeys().catch(() => new Set<string>())
    ]);
    const reporterNameMap = Object.fromEntries(reporters.map((u) => [u.id, u.username]));
    const streamerNameMap = Object.fromEntries(streamers.map((s) => [s.channel_id, s.name]));

    const enriched = reports.map((r) => ({
      ...r,
      reporter_username: reporterNameMap[r.reporter_id] || null,
      streamer_name: streamerNameMap[r.channel_id] || null,
      puzzle_excluded: puzzleExcludedKeys.has(normalizePuzzleImageKey(r.reported_image_url))
    }));
    return res.status(200).json(enriched);
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '신고 목록 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 7. 신고 처리 상태 종결 (승인/기각)
 */
export const resolveReport = async (req: Request, res: Response) => {
  const { report_id } = req.params;
  const { status, resolution_action, resolution_detail } = req.body; // 'resolved' or 'rejected'

  if (!report_id || !['resolved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'BadRequest', message: '유효한 신고 ID 및 처리 상태(status: resolved | rejected)가 필요합니다.' });
  }

  try {
    const reportId = Number(report_id);
    const report = (await reportRepository.findAll()).find((item) => item.id === reportId);
    if (!report) {
      return res.status(404).json({ error: 'NotFound', message: '처리할 신고를 찾을 수 없습니다.' });
    }
    if (report.status !== 'pending') {
      return res.status(400).json({ error: 'BadRequest', message: '이미 처리된 신고입니다.' });
    }

    await reportRepository.updateStatus(reportId, status);
    await notifyReportResult(report, status, {
      actionLabel: typeof resolution_action === 'string' ? resolution_action : undefined,
      detail: typeof resolution_detail === 'string' ? resolution_detail : undefined
    }).catch((notifyErr) => {
      console.warn('[AdminController] 신고 처리 알림 생성 실패:', notifyErr?.message || notifyErr);
    });

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
 * 7-1. 신고 스냅샷 이미지를 3x4 퍼즐 출제 제외 목록에 등록
 */
export const excludeReportImageFromPuzzle = async (req: AuthenticatedRequest, res: Response) => {
  const { report_id } = req.params;
  const reportId = Number(report_id);
  if (!report_id || !Number.isFinite(reportId)) {
    return res.status(400).json({ error: 'BadRequest', message: '유효한 신고 ID가 필요합니다.' });
  }

  try {
    const report = (await reportRepository.findAll()).find((item) => item.id === reportId);
    if (!report) {
      return res.status(404).json({ error: 'NotFound', message: '신고를 찾을 수 없습니다.' });
    }
    if (!report.reported_image_url) {
      return res.status(400).json({ error: 'BadRequest', message: '신고에 저장된 이미지 스냅샷이 없습니다.' });
    }

    const record = await addPuzzleExcludedImage({
      imageUrl: report.reported_image_url,
      sourceReportId: report.id ?? reportId,
      channelId: report.channel_id,
      star: report.star ?? 0,
      reason: `card_report:${reportId}`,
      createdBy: req.user?.id || null
    });

    return res.status(200).json({
      message: '해당 신고 이미지가 3x4 퍼즐 출제 제외 목록에 등록되었습니다.',
      excluded_image: record
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '퍼즐 제외 이미지 등록 실패', details: IS_PRODUCTION ? undefined : err.message });
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
    const titlesByUser = await titleRepository.findByUserIds(users.map((u) => u.id));
    const items = users.map((u) => ({
      id: u.id,
      username: u.username,
      avatar_url: u.avatar_url,
      role: u.role,
      point: u.point,
      status_message: u.status_message ?? null,
      banned_until: u.banned_until ?? null,
      ban_reason: u.ban_reason ?? null,
      created_at: u.created_at ?? null,
      deleted_at: u.deleted_at ?? null,
      is_deleted: u.is_deleted === true,
      identity_source: u.identity_source ?? (u.is_deleted ? 'deleted_snapshot' : 'current'),
      titles: titlesByUser[u.id] || []
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

export const resetUserStatusMessage = async (req: Request, res: Response) => {
  const { user_id } = req.params;
  if (!user_id) {
    return res.status(400).json({ error: 'BadRequest', message: '대상 유저 ID가 유효하지 않습니다.' });
  }

  try {
    const targetUser = await userRepository.findById(user_id);
    if (!targetUser) {
      return res.status(404).json({ error: 'NotFound', message: '대상 사용자를 찾을 수 없습니다.' });
    }
    if (!targetUser.status_message) {
      return res.status(200).json({
        message: `${targetUser.username}님의 상태 메시지는 이미 비어 있습니다.`,
        user_id,
        status_message: null
      });
    }

    await userRepository.updateStatusMessage(user_id, null);
    clearUserRankingCaches();
    return res.status(200).json({
      message: `${targetUser.username}님의 상태 메시지를 초기화했습니다.`,
      user_id,
      status_message: null
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '상태 메시지 초기화 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

export const getUserPointAudit = async (req: Request, res: Response) => {
  const { user_id } = req.params;
  const limit = Math.max(1, Math.min(200, Math.floor(Number(req.query.limit || 80))));
  const beforeId = req.query.before_id ? Math.max(0, Math.floor(Number(req.query.before_id))) : null;

  if (!user_id) {
    return res.status(400).json({ error: 'BadRequest', message: '대상 유저 ID가 유효하지 않습니다.' });
  }

  try {
    const targetUser = await userRepository.findById(user_id);
    const deletedAccount = await userRepository.findDeletedAccount(user_id);
    const { entries, next_before_id } = await listPointLedgerForUser(user_id, { limit, beforeId });
    const totals = entries.reduce((acc, entry) => {
      if (entry.amount > 0) acc.income += entry.amount;
      if (entry.amount < 0) acc.expense += Math.abs(entry.amount);
      return acc;
    }, { income: 0, expense: 0 });

    return res.status(200).json({
      user: targetUser ? {
        id: targetUser.id,
        username: targetUser.username,
        avatar_url: targetUser.avatar_url,
        point: targetUser.point,
        role: targetUser.role,
        deleted_at: deletedAccount?.deleted_at || null,
        identity_source: deletedAccount ? 'rejoined' : 'current'
      } : {
        id: user_id,
        username: deletedAccount?.username_snapshot || null,
        avatar_url: deletedAccount?.avatar_url_snapshot || null,
        point: deletedAccount?.point_at_deletion ?? null,
        role: null,
        deleted_at: deletedAccount?.deleted_at || null,
        identity_source: deletedAccount ? 'deleted_snapshot' : 'unknown'
      },
      entries,
      page_summary: {
        income: totals.income,
        expense: totals.expense,
        net: totals.income - totals.expense
      },
      next_before_id
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '유저 포인트 감사 내역 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
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

/**
 * 10. 무료 뽑기 초기화 간격 조회 (시간 단위)
 */
export const getFreeDrawInterval = async (req: Request, res: Response) => {
  try {
    const val = await systemConfigRepository.get('free_draw_interval', '24');
    const maxStack = await systemConfigRepository.get('free_draw_max_stack', '1');
    return res.status(200).json({ interval: parseFloat(val), maxStack: parseInt(maxStack, 10) || 1 });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '설정 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 11. 무료 뽑기 초기화 간격 저장 (시간 단위)
 */
export const setFreeDrawInterval = async (req: Request, res: Response) => {
  const { interval, maxStack } = req.body;
  const num = parseFloat(String(interval));
  if (isNaN(num) || num < 0) {
    return res.status(400).json({ error: 'BadRequest', message: '올바른 0 이상의 숫자를 지정해야 합니다.' });
  }
  const stackNum = maxStack === undefined ? null : parseInt(String(maxStack), 10);
  if (stackNum !== null && (isNaN(stackNum) || stackNum < 1)) {
    return res.status(400).json({ error: 'BadRequest', message: '최대 중첩 횟수는 1 이상의 정수여야 합니다.' });
  }

  try {
    await systemConfigRepository.set('free_draw_interval', String(num));
    if (stackNum !== null) {
      await systemConfigRepository.set('free_draw_max_stack', String(stackNum));
    }
    const savedStack = stackNum ?? (parseInt(await systemConfigRepository.get('free_draw_max_stack', '1'), 10) || 1);
    return res.status(200).json({ message: `무료 뽑기 초기화 간격이 ${num}시간, 최대 중첩 ${savedStack}회로 변경되었습니다.`, interval: num, maxStack: savedStack });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '설정 저장 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 12. 뽑기 1회 비용 조회 (포인트 단위)
 */
export const getDrawCost = async (req: Request, res: Response) => {
  try {
    const val = await systemConfigRepository.get('draw_cost', '10000');
    return res.status(200).json({ cost: parseInt(val, 10) || 10000 });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '설정 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 13. 뽑기 1회 비용 저장 (포인트 단위, 0 이상 정수)
 */
export const setDrawCost = async (req: Request, res: Response) => {
  const { cost } = req.body;
  const num = parseInt(String(cost), 10);
  if (isNaN(num) || num < 0) {
    return res.status(400).json({ error: 'BadRequest', message: '올바른 0 이상의 정수를 지정해야 합니다.' });
  }

  try {
    await systemConfigRepository.set('draw_cost', String(num));
    return res.status(200).json({ message: `뽑기 비용이 ${num.toLocaleString()} P로 변경되었습니다.`, cost: num });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '설정 저장 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 14. 미니게임 동전 충전 간격 조회 (분 단위)
 */
export const getMinigameTicketChargeInterval = async (req: Request, res: Response) => {
  try {
    const val = await systemConfigRepository.get('minigame_ticket_charge_interval_minutes', '240');
    const minutes = parseInt(val, 10);
    return res.status(200).json({ intervalMinutes: Number.isFinite(minutes) && minutes >= 1 ? minutes : 240 });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '미니게임 동전 충전 설정 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 15. 미니게임 동전 충전 간격 저장 (분 단위)
 */
export const setMinigameTicketChargeInterval = async (req: Request, res: Response) => {
  const { intervalMinutes } = req.body;
  const num = parseInt(String(intervalMinutes), 10);
  if (!Number.isFinite(num) || num < 1) {
    return res.status(400).json({ error: 'BadRequest', message: '미니게임 동전 충전 간격은 1분 이상의 정수여야 합니다.' });
  }

  try {
    await systemConfigRepository.set('minigame_ticket_charge_interval_minutes', String(num));
    return res.status(200).json({
      message: `미니게임 동전 충전 간격이 ${num.toLocaleString()}분으로 변경되었습니다. 진행 중인 유저 타이머는 다음 조회 시 새 설정으로 재계산됩니다.`,
      intervalMinutes: num
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '미니게임 동전 충전 설정 저장 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 16. 점검 상태 조회 (모든 유저 가능)
 */
export const getMaintenanceStatus = async (req: Request, res: Response) => {
  try {
    const active = await systemConfigRepository.get('maintenance_active', 'false');
    const startAt = await systemConfigRepository.get('maintenance_start_at', '');
    const endAt = await systemConfigRepository.get('maintenance_end_at', '');

    return res.status(200).json({
      active: active === 'true',
      startAt: startAt || null,
      endAt: endAt || null
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '점검 상태 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 17. 점검 상태 설정 (ADMIN 전용)
 */
export const setMaintenanceStatus = async (req: Request, res: Response) => {
  const { active, startAt, endAt } = req.body;

  if (active !== undefined && typeof active !== 'boolean') {
    return res.status(400).json({ error: 'BadRequest', message: 'active 값은 boolean 타입이어야 합니다.' });
  }

  try {
    const currentActive = await systemConfigRepository.get('maintenance_active', 'false');
    const currentStartAt = await systemConfigRepository.get('maintenance_start_at', '');
    const currentEndAt = await systemConfigRepository.get('maintenance_end_at', '');

    if (active !== undefined) {
      await systemConfigRepository.set('maintenance_active', active ? 'true' : 'false');
    }
    if (startAt !== undefined) {
      await systemConfigRepository.set('maintenance_start_at', startAt || '');
    }
    if (endAt !== undefined) {
      await systemConfigRepository.set('maintenance_end_at', endAt || '');
    }

    const nextState = {
      active: active !== undefined ? active : currentActive === 'true',
      startAt: startAt !== undefined ? (startAt || null) : (currentStartAt || null),
      endAt: endAt !== undefined ? (endAt || null) : (currentEndAt || null)
    };
    publishRealtimeEvent('maintenance', nextState);

    return res.status(200).json({
      message: '점검 설정이 성공적으로 저장되었습니다.',
      ...nextState
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '점검 설정 저장 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};
