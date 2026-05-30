"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportStreamerCardHandler = exports.reportStreamerCard = void 0;
const repositories_1 = require("../repositories");
/**
 * 특정 스트리머 카드를 신고하는 핸들러 (신고 시점 이미지 스냅샷 포함)
 */
const reportStreamerCard = async (req, res) => {
    const user = req.user;
    const { channel_id } = req.params;
    const { reason } = req.body;
    if (!user) {
        return res.status(401).json({ error: 'Unauthorized', message: '인증 정보가 필요합니다.' });
    }
    if (!channel_id || !reason) {
        return res.status(400).json({ error: 'BadRequest', message: '신고 대상 스트리머 ID 및 신고 사유(reason)가 누락되었습니다.' });
    }
    try {
        // 신고 대상 스트리머 조회
        const streamer = await repositories_1.streamerRepository.findById(channel_id);
        if (!streamer) {
            return res.status(404).json({ error: 'NotFound', message: '신고할 스트리머의 카드를 찾을 수 없습니다.' });
        }
        // 증거 인멸 방지: 신고를 누른 당시 스트리머가 사용 중인 이미지 URL을 스냅샷으로 지정
        // 커스텀 이미지 주소가 없으면 기본 치지직 로고 주소를 사용
        const reportedSnapshotUrl = streamer.custom_image_url || streamer.logo_url;
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
            reason,
            status: 'pending'
        };
        const newReport = await repositories_1.reportRepository.create(reportData);
        return res.status(201).json({
            message: '신고가 접수되었습니다. 신고 시점의 이미지 스냅샷이 안전하게 기록되었습니다.',
            report: newReport
        });
    }
    catch (err) {
        console.error('[ReportController] 카드 신고 처리 중 에러:', err);
        return res.status(500).json({
            error: 'InternalServerError',
            message: '신고 접수 중 서버 에러가 발생했습니다.',
            details: err.message
        });
    }
};
exports.reportStreamerCard = reportStreamerCard;
exports.reportStreamerCardHandler = exports.reportStreamerCard;
