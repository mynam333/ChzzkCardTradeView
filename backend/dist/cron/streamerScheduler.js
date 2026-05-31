"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startStreamerLiveStatusScheduler = exports.syncAllStreamersLiveStatus = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const repositories_1 = require("../repositories");
const chzzkService_1 = require("../services/chzzkService");
// 지연 처리를 위한 헬퍼 함수
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
                console.log(`[LiveStatusSchedulerDebug] DB 업데이트 시도 (ID: ${streamer.channel_id},이름: ${streamer.name}) - 신규 isActive: ${profile.openLive}, 신규 followerCount: ${profile.followerCount}`);
                // 데이터베이스에 라이브 상태 및 팔로워 수 업데이트
                await repositories_1.streamerRepository.updateLiveStatus(streamer.channel_id, profile.openLive, profile.followerCount);
                console.log(`[LiveStatusSchedulerDebug] DB 업데이트 성공 (ID: ${streamer.channel_id})`);
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
