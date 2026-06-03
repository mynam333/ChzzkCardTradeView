import { Response } from 'express';
import { streamerRepository, reportRepository } from '../repositories';
import { AuthenticatedRequest } from '../middlewares/admin';
import { IS_PRODUCTION } from '../config';

/**
 * 특정 스트리머 카드를 신고하는 핸들러 (신고 시점 이미지 스냅샷 포함)
 */
export const reportStreamerCard = async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  const { channel_id } = req.params;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  // 신고 대상 카드의 별(0~5성). 미지정 시 0성.
  const star = Math.max(0, Math.min(5, Math.floor(Number(req.body?.star)) || 0));

  if (!user) {
    return res.status(401).json({ error: 'Unauthorized', message: '인증 정보가 필요합니다.' });
  }

  if (!channel_id || !reason) {
    return res.status(400).json({ error: 'BadRequest', message: '신고 대상 스트리머 ID 및 신고 사유(reason)가 누락되었습니다.' });
  }
  if (reason.length > 500) {
    return res.status(400).json({ error: 'BadRequest', message: '신고 사유는 500자 이내로 입력해 주세요.' });
  }

  try {
    // 신고 대상 스트리머 조회
    const streamer = await streamerRepository.findById(channel_id);
    if (!streamer) {
      return res.status(404).json({ error: 'NotFound', message: '신고할 스트리머의 카드를 찾을 수 없습니다.' });
    }

    // 증거 인멸 방지: 신고 시점에 해당 별(star)에 표시되던 이미지를 스냅샷으로 지정
    // 해당 별 이미지가 없으면 하위 별 → 0성 → 기본 로고 순으로 폴백 (프론트 cardImage 로직과 동일)
    const imgs = (streamer.custom_images && streamer.custom_images.length)
      ? streamer.custom_images
      : [streamer.custom_image_url ?? null];
    let reportedSnapshotUrl: string | null = null;
    for (let j = star; j >= 0; j--) {
      if (imgs[j]) { reportedSnapshotUrl = imgs[j]; break; }
    }
    if (!reportedSnapshotUrl) reportedSnapshotUrl = streamer.logo_url;
    if (!reportedSnapshotUrl) {
      return res.status(400).json({
        error: 'BadRequest',
        message: '신고 대상 카드에 등록된 증거 이미지 주소가 존재하지 않습니다.'
      });
    }

    const reportData = {
      reporter_id: user.id,
      channel_id,
      reported_image_url: reportedSnapshotUrl,
      star,
      reason,
      status: 'pending' as const
    };

    const newReport = await reportRepository.create(reportData);

    return res.status(201).json({
      message: '신고가 접수되었습니다. 신고 시점의 이미지 스냅샷이 안전하게 기록되었습니다.',
      report: newReport
    });
  } catch (err: any) {
    console.error('[ReportController] 카드 신고 처리 중 에러:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: '신고 접수 중 서버 에러가 발생했습니다.',
      details: IS_PRODUCTION ? undefined : err.message
    });
  }
};
