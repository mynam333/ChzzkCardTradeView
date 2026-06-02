import cron from 'node-cron';
import { streamerRepository, userRepository } from '../repositories';
import { fetchChzzkChannelProfile, refreshChzzkToken } from '../services/chzzkService';
import { chatManager } from '../services/chatManager';
import { decryptToken, encryptToken } from '../services/cryptoService';

/**
 * 스트리머(유저)의 유효한 치지직 access_token을 반환합니다.
 * 만료 임박(5분 이내) 시 refresh_token으로 갱신 후 DB에 저장합니다.
 */
const getValidStreamerAccessToken = async (channelId: string): Promise<string | undefined> => {
  try {
    const streamerUser = await userRepository.findById(channelId);
    if (!streamerUser?.access_token) return undefined;

    const accessToken = decryptToken(streamerUser.access_token) || undefined;
    const expiresAt = streamerUser.token_expires_at ? new Date(streamerUser.token_expires_at).getTime() : 0;
    const needsRefresh = expiresAt > 0 && Date.now() >= expiresAt - 5 * 60 * 1000;

    if (needsRefresh && streamerUser.refresh_token) {
      const refresh = decryptToken(streamerUser.refresh_token);
      if (refresh) {
        const refreshed = await refreshChzzkToken(refresh);
        if (refreshed) {
          const newExpiry = refreshed.expiresIn
            ? new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
            : null;
          await userRepository.updateTokens(
            channelId,
            encryptToken(refreshed.accessToken),
            encryptToken(refreshed.refreshToken),
            newExpiry
          );
          console.log(`[LiveStatusScheduler] 치지직 토큰 갱신 완료 (대상: ${channelId})`);
          return refreshed.accessToken;
        }
      }
    }
    return accessToken;
  } catch {
    return undefined;
  }
};

// 스케줄러 실행 주기(분). 크론 '*/2 * * * *'와 일치해야 방송 시간 누적이 정확합니다.
const SCHEDULE_INTERVAL_MINUTES = 2;

/**
 * 모든 카드에 적용되는 랜덤 시세 변동(재미 요소)을 계산합니다.
 * 매 주기 대부분은 작은 폭(±0.8%)으로 등락하고, 약 15% 확률로 조금 더 큰 변동(±2.5%)이 발생합니다.
 * 현재 가치에 비례하므로 저가/고가 카드 모두 체감 가능한 수준으로 흔들립니다.
 * @param value 현재(이전) 가치
 * @returns 가치에 더해질 랜덤 변동량 (양수=상승, 음수=하락)
 */
export const computeRandomDrift = (value: number): number => {
  const BASE_PCT = 0.008;   // 평상시 최대 변동폭 0.8%
  const SPIKE_PCT = 0.025;  // 가끔 발생하는 큰 변동 2.5%
  const SPIKE_CHANCE = 0.15;

  const maxPct = Math.random() < SPIKE_CHANCE ? SPIKE_PCT : BASE_PCT;
  // -maxPct ~ +maxPct 사이 균등 분포 (상승/하락 동일 확률)
  const pct = (Math.random() * 2 - 1) * maxPct;
  return value * pct;
};

/**
 * 정교하게 개편된 카드 가치 계산 공식을 실행합니다.
 * @param prevValue 이전 가치 (시세 연속성 유지)
 * @param followers 팔로워 수 (요구 채팅량 계산용)
 * @param deltaMultiplier 1회 스케줄러 주기당 방송 상태에 따른 변동 배율 델타값
 * @param chats 실제 채팅량 (방송 중 집계됨)
 * @param concurrentUserCount 실시간 동시 시청자 수
 * @param isLive 실시간 채팅 집계 및 보너스 적용 대상이 되는 생방송 활성화 여부
 * @returns 100 ~ 500,000 범위 내로 보정된 최종 가치
 */
export const calculateCardValue = (
  prevValue: number,
  followers: number, 
  deltaMultiplier: number, 
  chats: number,
  concurrentUserCount: number,
  isLive: boolean,
  followerDelta: number
): number => {
  // 1. 이전 가치 안전장치 (0 이하 또는 누락 방지)
  const currentVal = prevValue > 0 ? prevValue : followers;

  // 2. 필요 기준 채팅량 (시청자 규모별 타겟 튜닝 모델 적용)
  // 시청자 10명일 때 약 4개, 5,000명일 때 약 750개가 되도록 밸런싱되었습니다.
  const requiredChats = Math.round(
    0.23 * Math.pow(concurrentUserCount, 0.95) + Math.sqrt(followers) * 0.03 + 1
  );

  // 3. 채팅량 영향 요인 보너스/감가 (이전 가치 규모에 맞게 유동적으로 스케일링)
  // 방송 중(isLive = true) 일 때만 채팅 보너스가 작용합니다.
  let chatBonus = 0;
  if (isLive) {
    const chatDiff = chats - requiredChats;
    const chatSign = Math.sign(chatDiff);
    const scaleFactor = Math.sqrt(currentVal) * 0.5; // 채팅량 편차에 의한 가치 변동폭을 대폭 축소하여 안정성 확보 (15 -> 0.5)
    chatBonus = chatSign * Math.log(1 + Math.abs(chatDiff) / 10) * scaleFactor;
  }

  // 4. 최종 가치 계산 (이전 가치 + 방송 상태 델타 변동 + 채팅 보너스 + 팔로워 증감 반영)
  const valueChangeFromBroadcast = currentVal * deltaMultiplier;
  // 팔로워 1명 증감당 가치 1 변동 (필요에 따라 가중치 조정 가능)
  const followerBonus = followerDelta;
  // 5. 랜덤 시세 변동: 방송 여부와 무관하게 모든 카드에 소폭 등락을 부여 (재미 요소)
  const randomDrift = computeRandomDrift(currentVal);
  const finalValue = Math.round(currentVal + valueChangeFromBroadcast + chatBonus + followerBonus + randomDrift);

  // 6. 상하한 한계 제한 (100 ~ 500,000)
  return Math.min(Math.max(finalValue, 100), 500000);
};

/**
 * 모든 등록된 스트리머의 방송 여부(is_active) 및 팔로워 수를 순차적으로 갱신합니다.
 */
export const syncAllStreamersLiveStatus = async () => {
  console.log('[LiveStatusScheduler] 스트리머 실시간 방송 상태 및 팔로워 수 동기화 시작...');
  try {
    const streamers = await streamerRepository.findAll();
    if (streamers.length === 0) {
      console.log('[LiveStatusScheduler] 등록된 스트리머가 없어 동기화를 건너뜁니다.');
      return;
    }

    let successCount = 0;
    const CONCURRENCY = 4; // 동시 처리 스트리머 수 상한 (2분 주기 초과 방지 + 과도한 동시 요청 억제)

    const processStreamer = async (streamer: typeof streamers[number]) => {
      try {
        const profile = await fetchChzzkChannelProfile(streamer.channel_id);
        
        // 1. 방송 켬 트랜지션 감지 (기존 오프라인이었는데 생방송이 켜진 경우)
        const isTransitionToLive = !streamer.is_active && profile.openLive;
        if (isTransitionToLive) {
          console.log(`[LiveStatusScheduler] 방송 시작 감지 -> 방송 횟수 증가 (대상: ${streamer.name})`);
          await streamerRepository.incrementBroadcastCount(streamer.channel_id);
        }

        // 2. 방송 상태 및 팔로워 수 1차 업데이트
        await streamerRepository.updateLiveStatus(
          streamer.channel_id,
          profile.openLive,
          profile.followerCount
        );

        // 3. 실시간 채팅 수집을 위한 Websocket 연결/종료 관리
        if (profile.openLive && profile.chatChannelId) {
          // 만료 임박 시 자동 갱신된 유효 토큰 사용 (없으면 비로그인 수집)
          const streamerAccessToken = await getValidStreamerAccessToken(streamer.channel_id);
          // 방송 중이면 웹소켓 연결 수립
          chatManager.connect(streamer.channel_id, profile.chatChannelId, streamerAccessToken);
        } else {
          // 방송 중이 아니면 웹소켓 연결 해제
          chatManager.disconnect(streamer.channel_id);
        }

        // 4. 가치 및 감가 배율 재계산을 위해 최신 상태 조회
        const updatedStreamer = await streamerRepository.findById(streamer.channel_id);
        if (updatedStreamer) {
          let m = updatedStreamer.broadcast_multiplier !== undefined ? updatedStreamer.broadcast_multiplier : 1.0;

          const MAX_DELTA = 0.05; // 1회 스케줄러 당 변경 가능한 배율의 최대 절댓값 한계
          let delta = 0;

          // 19금/연령제한/해외차단 등으로 생방송 중(profile.openLive = true)이지만 채팅 수집 소켓이 비활성화된 경우 가치 계산 시 오프라인(감가) 처리
          const isChatConnected = chatManager.isConnected(streamer.channel_id);
          const isEffectiveLive = profile.openLive && isChatConnected;

          if (isEffectiveLive) {
            // 방송 중일 때 복구 (Recovery): 초반(0.2 부근)에 급격히 복구되다가 1.0에 갈수록 완만히 안착
            // 2분 주기 기준, 약 4~6시간(120~180 루프) 정도 방송을 유지하면 거의 1.0 수준으로 완벽하게 복구되도록 설계
            delta = Math.log(1 + (1.0 - m) * 10) * 0.0055;
          } else {
            // 방송 중이 아닐 때 감가 (Decay): 처음에는 작게 깎이다가 점점 더 속도가 붙어 크게 깎이는 가속 감가
            // 5일(120시간 = 3600 루프) 연속 미방송 시 최저치인 0.2에 도달하도록 감가 속도 밸런싱 (상한 1.2 연동하여 기준을 1.25로 변경)
            delta = -((Math.pow(1.25 - m, 2) * 0.00035) + 0.00005);
          }

          // 스케줄러 회당 최대 변동 제한 적용 (+- 0.05 한계)
          const clampedDelta = Math.max(Math.min(delta, MAX_DELTA), -MAX_DELTA);
          m = m + clampedDelta;

          // 감가 한계 범위 제한 (0.2 ~ 1.2)
          const newMultiplier = Math.min(Math.max(m, 0.2), 1.2);

          // 팔로워 증감량 계산
          const followerDelta = profile.followerCount - (streamer.follower_count || 0);

          // 이번 주기에 집계에 사용한 채팅 수(소비량). 집계 도중 새로 들어온 채팅은 보존하기 위해 별도 보관.
          const consumedChats = updatedStreamer.chat_count || 0;

          // 최종 가치 연산 (이전 base_value 기준 누적식 변동 적용, 방송중 여부 및 팔로워 증감 전달)
          const finalVal = calculateCardValue(
            updatedStreamer.base_value || updatedStreamer.follower_count,
            updatedStreamer.follower_count,
            clampedDelta,
            consumedChats,
            profile.concurrentUserCount || 0,
            isEffectiveLive,
            followerDelta
          );

          console.log(`[LiveStatusScheduler] 가치 계산 상세 (스트리머: ${updatedStreamer.name}) - 이전가치: ${updatedStreamer.base_value}, 팔로워: ${updatedStreamer.follower_count}, 팔로워변동: ${followerDelta}, 시청자: ${profile.concurrentUserCount || 0}, 채팅: ${consumedChats}, 배율델타: ${clampedDelta.toFixed(5)} -> 최종가치: ${finalVal}`);

          // 방송 시간 누적: effective live면 이번 스케줄 주기(2분)만큼 방송 시간(분) 가산
          if (isEffectiveLive) {
            await streamerRepository.incrementBroadcastMinutes(streamer.channel_id, SCHEDULE_INTERVAL_MINUTES);
          }

          // 활동 지표는 누적 방송 시간(시간 단위) + 채팅량에 감가 배율 가중치를 합성하여 점수화
          const broadcastMinutes = (updatedStreamer.broadcast_minutes || 0) + (isEffectiveLive ? SCHEDULE_INTERVAL_MINUTES : 0);
          const broadcastHours = broadcastMinutes / 60;
          const activityScore = Math.round(
            (broadcastHours * 50 + consumedChats) * newMultiplier
          );

          const prevValue = updatedStreamer.base_value || updatedStreamer.follower_count;

          // 시세/배율/점수만 원자적으로 반영 (chat_count는 건드리지 않아 집계 중 유입 채팅 보존)
          await streamerRepository.updateValueMetrics(
            streamer.channel_id,
            prevValue,
            finalVal,
            activityScore,
            newMultiplier
          );

          // 집계에 소비한 만큼만 chat_count 차감 (집계 도중 들어온 채팅은 다음 주기로 이월)
          await streamerRepository.decrementChatCount(streamer.channel_id, consumedChats);

          // 시세 히스토리 기록 (24시간 등락률/차트용)
          await streamerRepository.recordValueHistory(streamer.channel_id, finalVal);
        }

        successCount++;
      } catch (err: any) {
        console.error(`[LiveStatusScheduler] 스트리머 정보 업데이트 실패 (ID: ${streamer.channel_id}):`, err.message);
      }
    };

    // 동시성 제한 워커 풀: 커서를 공유하며 최대 CONCURRENCY개씩 병렬 처리
    let cursor = 0;
    const worker = async () => {
      while (cursor < streamers.length) {
        const idx = cursor++;
        await processStreamer(streamers[idx]);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, streamers.length) }, () => worker())
    );

    console.log(`[LiveStatusScheduler] 동기화 완료: 총 ${streamers.length}명 중 ${successCount}명 성공`);
  } catch (error: any) {
    console.error('[LiveStatusScheduler] 동기화 중 치명적인 에러 발생:', error.message);
  }
};

/**
 * 치지직 실시간 상태 폴링 스케줄러를 구동합니다. (매 2분마다 실행)
 */
export const startStreamerLiveStatusScheduler = () => {
  console.log('[LiveStatusScheduler] 치지직 방송 상태 폴링 스케줄러가 백그라운드에서 구동되었습니다. (2분 간격)');
  
  // 서버 시작 시 최초 1회 즉시 실행
  syncAllStreamersLiveStatus();

  // 2분마다 주기적으로 크론 스케줄 가동
  cron.schedule('*/2 * * * *', async () => {
    await syncAllStreamersLiveStatus();
  });
};
