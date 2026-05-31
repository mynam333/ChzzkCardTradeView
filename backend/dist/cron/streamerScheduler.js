"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startStreamerLiveStatusScheduler = exports.syncAllStreamersLiveStatus = exports.calculateCardValue = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const repositories_1 = require("../repositories");
const chzzkService_1 = require("../services/chzzkService");
const chatManager_1 = require("../services/chatManager");
// 지연 처리를 위한 헬퍼 함수
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * 정교하게 개편된 카드 가치 계산 공식을 실행합니다.
 * @param followers 팔로워 수
 * @param broadcastMultiplier 실시간 방송 감가 배율 (0.2 ~ 1.0)
 * @param chats 실제 채팅량 (방송 중 집계됨)
 * @param concurrentUserCount 실시간 동시 시청자 수
 * @returns 100 ~ 500,000 범위 내로 보정된 최종 가치
 */
const calculateCardValue = (followers, broadcastMultiplier, chats, concurrentUserCount) => {
    // 1. 기본 팔로우 기반 가치 (팔로워 수와 동일하게 1:1 매칭)
    const baseFollowerValue = followers;
    // 2. 필요 기준 채팅량 (시청자 수 + 팔로워 수 연동 모델)
    // 대형 스트리머일수록 전체 시청자 대비 채팅 전송 비율(눈팅 비율)이 작아지는 경향을 보정합니다.
    const viewerScale = concurrentUserCount > 1000 ? 0.15 : 0.25;
    const requiredChats = Math.round(concurrentUserCount * viewerScale + Math.sqrt(followers) * 0.05 + 2);
    // 3. 채팅량 영향 요인 보너스/감가 (로그 변동 적용하여 극으로 갈수록 변화 폭 완만화)
    // 기본 가치(팔로워) 규모에 맞춰 변동폭이 건강하게 유지되도록 스케일러를 Math.sqrt(baseFollowerValue) * 150 으로 동적 설정
    // 이를 통해 팔로워 수에 비례하여 합리적인 범위 내에서 채팅만으로도 큰 변동폭(수천 ~ 수십만)이 가능하도록 보정합니다.
    const chatDiff = chats - requiredChats;
    const chatSign = Math.sign(chatDiff);
    const scaleFactor = Math.sqrt(baseFollowerValue) * 150;
    const chatBonus = chatSign * Math.log(1 + Math.abs(chatDiff) / 10) * scaleFactor;
    // 4. 최종 가치 계산 (기본가치 * 방송감가배율 + 채팅보너스)
    const finalValue = Math.round(baseFollowerValue * broadcastMultiplier + chatBonus);
    // 5. 상하한 한계 제한 (100 ~ 500,000)
    return Math.min(Math.max(finalValue, 100), 500000);
};
exports.calculateCardValue = calculateCardValue;
/**
 * 모든 등록된 스트리머의 방송 여부(is_active) 및 팔로워 수를 순차적으로 갱신합니다.
 */
const syncAllStreamersLiveStatus = async () => {
    console.log('[LiveStatusScheduler] 스트리머 실시간 방송 상태 및 팔로워 수 동기화 시작...');
    try {
        const streamers = await repositories_1.streamerRepository.findAll();
        if (streamers.length === 0) {
            console.log('[LiveStatusScheduler] 등록된 스트리머가 없어 동기화를 건너뜁니다.');
            return;
        }
        let successCount = 0;
        for (const streamer of streamers) {
            try {
                // API 요청 간 시간 간격을 두어 네이버 API Rate Limit 방지 (200ms)
                await delay(200);
                const profile = await (0, chzzkService_1.fetchChzzkChannelProfile)(streamer.channel_id);
                // 1. 방송 켬 트랜지션 감지 (기존 오프라인이었는데 생방송이 켜진 경우)
                const isTransitionToLive = !streamer.is_active && profile.openLive;
                if (isTransitionToLive) {
                    console.log(`[LiveStatusScheduler] 방송 시작 감지 -> 방송 횟수 증가 (대상: ${streamer.name})`);
                    await repositories_1.streamerRepository.incrementBroadcastCount(streamer.channel_id);
                }
                // 2. 방송 상태 및 팔로워 수 1차 업데이트
                await repositories_1.streamerRepository.updateLiveStatus(streamer.channel_id, profile.openLive, profile.followerCount);
                // 3. 실시간 채팅 수집을 위한 Websocket 연결/종료 관리
                if (profile.openLive && profile.chatChannelId) {
                    // 방송 중이면 웹소켓 연결 수립
                    chatManager_1.chatManager.connect(streamer.channel_id, profile.chatChannelId);
                }
                else {
                    // 방송 중이 아니면 웹소켓 연결 해제
                    chatManager_1.chatManager.disconnect(streamer.channel_id);
                }
                // 4. 가치 및 감가 배율 재계산을 위해 최신 상태 조회
                const updatedStreamer = await repositories_1.streamerRepository.findById(streamer.channel_id);
                if (updatedStreamer) {
                    let m = updatedStreamer.broadcast_multiplier !== undefined ? updatedStreamer.broadcast_multiplier : 1.0;
                    const MAX_DELTA = 0.05; // 1회 스케줄러 당 변경 가능한 배율의 최대 절댓값 한계
                    let delta = 0;
                    if (profile.openLive) {
                        // 방송 중일 때 복구 (Recovery): 초반(0.2 부근)에 급격히 복구되다가 1.0에 갈수록 완만히 안착
                        // 2분 주기 기준, 약 4~6시간(120~180 루프) 정도 방송을 유지하면 거의 1.0 수준으로 완벽하게 복구되도록 설계
                        delta = Math.log(1 + (1.0 - m) * 10) * 0.0055;
                    }
                    else {
                        // 방송 중이 아닐 때 감가 (Decay): 처음에는 작게 깎이다가 점점 더 속도가 붙어 크게 깎이는 가속 감가
                        // 5일(120시간 = 3600 루프) 연속 미방송 시 최저치인 0.2에 도달하도록 감가 속도 밸런싱 (상한 1.2 연동하여 기준을 1.25로 변경)
                        delta = -((Math.pow(1.25 - m, 2) * 0.00035) + 0.00005);
                    }
                    // 스케줄러 회당 최대 변동 제한 적용 (+- 0.05 한계)
                    const clampedDelta = Math.max(Math.min(delta, MAX_DELTA), -MAX_DELTA);
                    m = m + clampedDelta;
                    // 감가 한계 범위 제한 (0.2 ~ 1.2)
                    const newMultiplier = Math.min(Math.max(m, 0.2), 1.2);
                    // 최종 가치 연산 (실시간 시청자 수 반영)
                    const finalVal = (0, exports.calculateCardValue)(updatedStreamer.follower_count, newMultiplier, updatedStreamer.chat_count || 0, profile.concurrentUserCount || 0);
                    // 활동 지표는 방송 횟수, 채팅량에 감가 배율 가중치를 합성하여 점수화
                    const activityScore = Math.round(((updatedStreamer.broadcast_count || 0) * 10 + (updatedStreamer.chat_count || 0)) * newMultiplier);
                    // 변경된 최종 가치, 감가 배율 및 활동 점수 업데이트
                    updatedStreamer.broadcast_multiplier = newMultiplier;
                    updatedStreamer.base_value = finalVal;
                    updatedStreamer.activity_score = activityScore;
                    // 다음 2분 동안의 채팅 수집을 위해 chat_count를 0으로 초기화
                    updatedStreamer.chat_count = 0;
                    await repositories_1.streamerRepository.save(updatedStreamer);
                }
                successCount++;
            }
            catch (err) {
                console.error(`[LiveStatusScheduler] 스트리머 정보 업데이트 실패 (ID: ${streamer.channel_id}):`, err.message);
            }
        }
        console.log(`[LiveStatusScheduler] 동기화 완료: 총 ${streamers.length}명 중 ${successCount}명 성공`);
    }
    catch (error) {
        console.error('[LiveStatusScheduler] 동기화 중 치명적인 에러 발생:', error.message);
    }
};
exports.syncAllStreamersLiveStatus = syncAllStreamersLiveStatus;
/**
 * 치지직 실시간 상태 폴링 스케줄러를 구동합니다. (매 2분마다 실행)
 */
const startStreamerLiveStatusScheduler = () => {
    console.log('[LiveStatusScheduler] 치지직 방송 상태 폴링 스케줄러가 백그라운드에서 구동되었습니다. (2분 간격)');
    // 서버 시작 시 최초 1회 즉시 실행
    (0, exports.syncAllStreamersLiveStatus)();
    // 2분마다 주기적으로 크론 스케줄 가동
    node_cron_1.default.schedule('*/2 * * * *', async () => {
        await (0, exports.syncAllStreamersLiveStatus)();
    });
};
exports.startStreamerLiveStatusScheduler = startStreamerLiveStatusScheduler;
