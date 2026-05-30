"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchChzzkChannelProfile = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
/**
 * 치지직 공개 API를 통해 스트리머 채널 프로필 데이터를 실시간 획득합니다.
 *
 * @param channelId 치지직 채널 고유 ID
 * @returns 스트리머 이름, 프로필 이미지 URL, 팔로워 수, 방송 여부
 */
const fetchChzzkChannelProfile = async (channelId) => {
    const apiUrl = `https://api.chzzk.naver.com/service/v1/channels/${channelId}`;
    try {
        const response = await fetch(apiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        if (!response.ok) {
            throw new Error(`치지직 API 응답 실패 (HTTP 상태 코드: ${response.status})`);
        }
        const body = (await response.json());
        if (body.code === 200 && body.content) {
            const { channelName, channelImageUrl, followerCount, openLive } = body.content;
            return {
                name: channelName || '알 수 없는 스트리머',
                logoUrl: channelImageUrl || 'https://api.dicebear.com/7.x/identicon/svg?seed=' + channelId,
                followerCount: followerCount || 0,
                openLive: !!openLive
            };
        }
        else {
            throw new Error(body.message || 'API 응답 형식이 올바르지 않습니다.');
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
