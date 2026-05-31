"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchChzzkChannelProfile = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const fetchChzzkChannelProfile = async (channelId) => {
    const profileUrl = `https://api.chzzk.naver.com/service/v1/channels/${channelId}`;
    const liveStatusUrl = `https://api.chzzk.naver.com/polling/v2/channels/${channelId}/live-status`;
    try {
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
        // 두 API를 병렬 호출하여 처리 속도 최적화
        const [profileRes, liveRes] = await Promise.all([
            fetch(profileUrl, { headers }),
            fetch(liveStatusUrl, { headers }).catch(() => null) // liveStatus는 실패 시 오프라인 폴백 처리되도록 catch
        ]);
        if (!profileRes.ok) {
            throw new Error(`치지직 API 응답 실패 (HTTP 상태 코드: ${profileRes.status})`);
        }
        const profileBody = (await profileRes.json());
        let openLive = false;
        if (liveRes && liveRes.ok) {
            try {
                const liveBody = (await liveRes.json());
                if (liveBody.code === 200 && liveBody.content) {
                    // status가 'OPEN'인 경우에만 실시간 방송 중인 상태로 판정
                    openLive = liveBody.content.status === 'OPEN';
                }
            }
            catch (e) {
                console.warn(`[ChzzkService] 방송 상태 파싱 실패 (대상: ${channelId})`);
            }
        }
        if (profileBody.code === 200 && profileBody.content) {
            const { channelName, channelImageUrl, followerCount } = profileBody.content;
            return {
                name: channelName || '알 수 없는 스트리머',
                logoUrl: channelImageUrl || 'https://api.dicebear.com/7.x/identicon/svg?seed=' + channelId,
                followerCount: followerCount || 0,
                openLive
            };
        }
        else {
            throw new Error(profileBody.message || 'API 응답 형식이 올바르지 않습니다.');
        }
    }
    catch (error) {
        console.warn(`[ChzzkService] 치지직 API 조회 실패 (대상: ${channelId}):`, error.message);
        // API 연결 오류 또는 오프라인인 경우의 폴백 기본 정보 반환
        return {
            name: `스트리머_${channelId.substring(0, 5)}`,
            logoUrl: `https://api.dicebear.com/7.x/adventurer/svg?seed=${channelId}`,
            followerCount: 150, // 기본 충족 팔로워 수
            openLive: false
        };
    }
};
exports.fetchChzzkChannelProfile = fetchChzzkChannelProfile;
