"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadCustomImage = void 0;
const repositories_1 = require("../repositories");
const imageService_1 = require("../services/imageService");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/**
 * 스트리머 본인의 카드 커스텀 배경 이미지 업로드 핸들러
 */
const uploadCustomImage = async (req, res) => {
    const user = req.user;
    const { channel_id } = req.body; // 수정하고자 하는 스트리머 채널 ID
    if (!user) {
        return res.status(401).json({ error: 'Unauthorized', message: '인증 정보가 유효하지 않습니다.' });
    }
    if (!channel_id) {
        return res.status(400).json({ error: 'BadRequest', message: '스트리머 채널 ID(channel_id)가 필요합니다.' });
    }
    // 스트리머 채널 정보 조회
    const streamer = await repositories_1.streamerRepository.findById(channel_id);
    if (!streamer) {
        return res.status(404).json({ error: 'NotFound', message: '존재하지 않는 스트리머 채널입니다.' });
    }
    // 본인 확인 (로컬 및 테스트 환경 편의를 위해, user.id가 channel_id와 같거나 user.id가 'admin_test_uid'인 경우 허용)
    // 실제 서비스 환경에서는 치지직 로그인 시 매핑된 채널 ID 세션값을 매칭 검증함
    const isOwner = user.id === channel_id || user.role === 'ADMIN';
    if (!isOwner) {
        return res.status(403).json({ error: 'Forbidden', message: '해당 스트리머 카드의 수정 권한이 없습니다.' });
    }
    // 이미지 변경 차단 상태 확인 (Ban Check)
    if (streamer.is_image_banned) {
        return res.status(403).json({
            error: 'ImageBanned',
            message: '관리자에 의해 커스텀 카드 이미지 수정 권한이 차단된 상태입니다. (치지직 프로필만 노출됩니다.)'
        });
    }
    // 업로드 파일 존재 검증
    if (!req.file) {
        return res.status(400).json({ error: 'BadRequest', message: '업로드할 이미지 파일이 누락되었습니다.' });
    }
    try {
        // 1. sharp 가공 파이프라인 (webp 포맷 및 최대 1280px 리사이즈)
        const webpBuffer = await (0, imageService_1.resizeAndConvertToWebp)(req.file.buffer);
        // 스트리머의 이름을 폴더명으로 지정하기 위해 안전한 폴더명 형태로 가공합니다.
        // 특수문자나 공백을 안전한 형태로 치환하거나 정리
        const safeStreamerName = streamer.name.replace(/[\/\\?%*:|"<>\s]/g, '_');
        // 스트리머명_channelId 형태의 폴더 생성
        const folderName = `${safeStreamerName}_${channel_id}`;
        const uploadDir = path_1.default.join(__dirname, '../../../public/uploads', folderName);
        if (!fs_1.default.existsSync(uploadDir)) {
            fs_1.default.mkdirSync(uploadDir, { recursive: true });
        }
        const fileName = `custom_${Date.now()}.webp`;
        const filePath = path_1.default.join(uploadDir, fileName);
        fs_1.default.writeFileSync(filePath, webpBuffer);
        // 호스팅 경로 매핑
        const imageUrl = `/uploads/${folderName}/${fileName}`;
        // 3. 데이터베이스 정보 갱신
        await repositories_1.streamerRepository.updateCustomImage(channel_id, imageUrl);
        return res.status(200).json({
            message: '스트리머 카드 이미지가 성공적으로 최적화 및 업로드되었습니다.',
            channel_id,
            custom_image_url: imageUrl
        });
    }
    catch (err) {
        console.error('[StreamerController] 이미지 업로드 중 에러:', err);
        return res.status(500).json({
            error: 'InternalServerError',
            message: '서버 내부 문제로 인해 이미지 처리를 실패했습니다.',
            details: err.message
        });
    }
};
exports.uploadCustomImage = uploadCustomImage;
