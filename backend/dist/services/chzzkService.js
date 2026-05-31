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
    console.log(`[ChzzkDebug] API 조회 시작 - 대상 채널 ID: ${channelId}`);
    try {
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
        const [profileRes, liveRes] = await Promise.all([
            fetch(profileUrl, { headers }),
            fetch(liveStatusUrl, { headers }).catch((err) => {
                console.error(`[ChzzkDebug] live-status fetch 에러:`, err.message);
                return null;
            })
        ]);
        console.log(`[ChzzkDebug] profile API HTTP 상태: ${profileRes.status}`);
        if (liveRes) {
            console.log(`[ChzzkDebug] live-status API HTTP 상태: ${liveRes.status}`);
        }
        else {
            console.log(`[ChzzkDebug] live-status API 응답 없음(null)`);
        }
        if (!profileRes.ok) {
            throw new Error(`치지직 API 응답 실패 (HTTP 상태 코드: ${profileRes.status})`);
        }
        const profileBody = (await profileRes.json());
        let openLive = false;
        if (liveRes && liveRes.ok) {
            try {
                const liveBody = (await liveRes.json());
                console.log(`[ChzzkDebug] live-status API 응답 바디:`, JSON.stringify(liveBody));
                if (liveBody.code === 200 && liveBody.content) {
                    openLive = liveBody.content.status === 'OPEN';
                    console.log(`[ChzzkDebug] 실시간 방송 상태 판정 (status: ${liveBody.content.status}) -> openLive: ${openLive}`);
                }
                else {
                    console.log(`[ChzzkDebug] live-status 응답 코드가 200이 아니거나 content가 없음: code=${liveBody.code}`);
                }
            }
            catch (e) {
                console.warn(`[ChzzkDebug] 방송 상태 JSON 파싱 실패 (대상: ${channelId}):`, e.message);
            }
        }
        else if (liveRes) {
            console.log(`[ChzzkDebug] live-status API 응답이 ok가 아님 (status: ${liveRes.status})`);
        }
        if (profileBody.code === 200 && profileBody.content) {
            const { channelName, channelImageUrl, followerCount } = profileBody.content;
            console.log(`[ChzzkDebug] 프로필 획득 완료: 이름=${channelName}, 팔로워=${followerCount}, 최종 openLive=${openLive}`);
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
        console.error(`[ChzzkDebug] 치지직 API 최종 조회 실패 (대상: ${channelId}):`, error.message);
        return {
            name: `스트리머_${channelId.substring(0, 5)}`,
            logoUrl: `https://api.dicebear.com/7.x/adventurer/svg?seed=${channelId}`,
            followerCount: 150,
            openLive: false
        };
    }
};
exports.fetchChzzkChannelProfile = fetchChzzkChannelProfile;
