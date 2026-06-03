import cron from 'node-cron';
import { streamerRepository, userRepository } from '../repositories';
import type { Streamer, StreamerScheduleResult } from '../repositories/interfaces';
import { fetchChzzkChannelProfile, ChzzkProfile, refreshChzzkToken } from '../services/chzzkService';
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
 *          (채팅 부족으로 인한 하락은 max(100, 팔로워의 20%)까지만, 그 외 요인은 100까지 하락 가능)
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
  const requiredChatsRaw = Math.round(
    0.23 * Math.pow(concurrentUserCount, 0.95) + Math.sqrt(followers) * 0.03 + 1
  );
  // 2-1. 소규모 방 완화: 시청자 10명 미만은 채팅 화력이 낮아도 기준치를 낮춰 너그럽게 평가
  // (0명 → 0.4배, 10명 → 1.0배로 선형 보간)
  const smallRoomLeniency = concurrentUserCount < 10
    ? 0.4 + 0.06 * concurrentUserCount
    : 1;
  const requiredChats = Math.max(1, Math.round(requiredChatsRaw * smallRoomLeniency));

  // 3. 채팅량 영향 요인 보너스/감가 (이전 가치 규모에 맞게 유동적으로 스케일링)
  // 방송 중(isLive = true) 일 때만 채팅 보너스가 작용합니다.
  let chatBonus = 0;
  if (isLive) {
    const chatDiff = chats - requiredChats;
    const chatSign = Math.sign(chatDiff);
    const scaleFactor = Math.sqrt(currentVal) * 0.5; // 채팅량 편차에 의한 가치 변동폭을 대폭 축소하여 안정성 확보 (15 -> 0.5)
    chatBonus = chatSign * Math.log(1 + Math.abs(chatDiff) / 10) * scaleFactor;
    // 소규모 방(시청자 10명 미만)은 채팅 부족으로 인한 감가를 추가로 절반만 적용
    if (chatBonus < 0 && concurrentUserCount < 10) {
      chatBonus *= 0.5;
    }
  }

  // 4. 최종 가치 계산 (이전 가치 + 방송 상태 델타 변동 + 채팅 보너스 + 팔로워 증감 반영)
  const valueChangeFromBroadcast = currentVal * deltaMultiplier;
  // 팔로워 1명 증감당 가치 1 변동 (필요에 따라 가중치 조정 가능)
  const followerBonus = followerDelta;
  // 5. 랜덤 시세 변동: 방송 여부와 무관하게 모든 카드에 소폭 등락을 부여 (재미 요소)
  const randomDrift = computeRandomDrift(currentVal);
  // 채팅 외 요인(방송 델타·팔로워 증감·랜덤 드리프트)만 반영한 값 — 이 요인들은 20% 밑으로도 내려갈 수 있음
  const valueWithoutChat = currentVal + valueChangeFromBroadcast + followerBonus + randomDrift;
  let finalValue = Math.round(valueWithoutChat + chatBonus);

  // 6. 채팅 부족 하한선: 채팅 수가 적어서 내려가는 가치는 max(100, 팔로워의 20%)까지만 허용
  //    (채팅 외 요인으로 이미 그보다 낮아진 경우엔 채팅이 더 끌어내리지 않도록 보호만 적용)
  if (chatBonus < 0) {
    const chatFloor = Math.max(100, Math.round(followers * 0.2));
    const floorRef = Math.min(valueWithoutChat, chatFloor);
    finalValue = Math.max(finalValue, Math.round(floorRef));
  }

  // 7. 상하한 한계 제한 (절대 하한 100 ~ 상한 500,000)
  return Math.min(Math.max(finalValue, 100), 500000);
};

// ============================================================
//  스케줄러 부하/지연 최적화 설정
// ============================================================
// 오프라인 스트리머는 매 주기 전부가 아니라 N개 샤드로 나눠 순회 폴링합니다.
// (라이브 중인 스트리머는 항상 매 주기 폴링) → HTTP 호출량 대폭 절감.
const OFFLINE_POLL_SHARDS = 3;          // 3주기(약 6분)에 걸쳐 오프라인 1회 폴링
const PRUNE_EVERY_CYCLES = 30;          // 약 1시간마다 시세 이력 정리
const VALUE_HISTORY_RETENTION_DAYS = 7; // 7일 초과 시세 이력 삭제
const POLL_JITTER_MS = 30;              // 호출 버스트 완화용 소량 지터(ms)

// 이전 주기가 끝나기 전 다음 크론이 겹쳐 실행되는 것을 막는 가드(오버랩 방지)
let isSyncRunning = false;
let scheduleCycle = 0;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// channel_id를 안정적으로 0..(shards-1)로 분배 (오프라인 샤드 순회 폴링용)
const shardOf = (channelId: string, shards: number): number => {
  let h = 0;
  for (let i = 0; i < channelId.length; i++) h = (h * 31 + channelId.charCodeAt(i)) >>> 0;
  return h % shards;
};

/**
 * 스트리머 1명의 1주기 가치/배율/활동점수를 계산해 일괄 반영용 결과로 반환합니다.
 * profile === null 이면 이번 주기에 HTTP 폴링하지 않은(오프라인) 스트리머로 간주하여
 * 순수 계산(감가·랜덤 드리프트)만 적용합니다. (HTTP 호출 없음)
 */
const buildScheduleResult = (
  streamer: Streamer,
  profile: ChzzkProfile | null
): { update: StreamerScheduleResult; history: { channel_id: string; value: number } } => {
  const polled = profile !== null;
  const openLive = polled ? profile!.openLive : false;
  // 폴링한 라이브 스트리머만 채팅 소켓 연결 여부를 따져 실질 라이브 판정
  // (19금/연령제한/해외차단 등으로 라이브지만 소켓 미연결이면 오프라인 취급 → 감가)
  const isChatConnected = polled ? chatManager.isConnected(streamer.channel_id) : false;
  const isEffectiveLive = openLive && isChatConnected;

  const concurrentUserCount = polled ? (profile!.concurrentUserCount || 0) : 0;
  const followerCount = polled ? profile!.followerCount : (streamer.follower_count || 0);
  const followerDelta = polled ? (profile!.followerCount - (streamer.follower_count || 0)) : 0;
  const addBroadcastCount = (polled && !streamer.is_active && openLive) ? 1 : 0;

  // 감가/복구 배율 (원본 로직 유지)
  let m = streamer.broadcast_multiplier !== undefined ? streamer.broadcast_multiplier : 1.0;
  const MAX_DELTA = 0.05; // 1주기당 배율 변동 절댓값 한계
  const delta = isEffectiveLive
    // 복구(Recovery): 0.2 부근에서 빠르게 복구되다 1.0에 가까울수록 완만히 안착
    ? Math.log(1 + (1.0 - m) * 10) * 0.0055
    // 감가(Decay): 처음엔 작게, 점점 가속. 약 5일 연속 미방송 시 최저 0.2 도달
    : -((Math.pow(1.25 - m, 2) * 0.00035) + 0.00005);
  const clampedDelta = Math.max(Math.min(delta, MAX_DELTA), -MAX_DELTA);
  m = m + clampedDelta;
  const newMultiplier = Math.min(Math.max(m, 0.2), 1.2); // 0.2 ~ 1.2 범위

  // 이번 주기에 집계에 소비한 채팅 수(스냅샷 기준). 라이브 폴링이 아니면 차감하지 않음.
  const consumedChats = streamer.chat_count || 0;
  const finalVal = calculateCardValue(
    streamer.base_value || streamer.follower_count,
    followerCount,
    clampedDelta,
    consumedChats,
    concurrentUserCount,
    isEffectiveLive,
    followerDelta
  );

  const addMinutes = isEffectiveLive ? SCHEDULE_INTERVAL_MINUTES : 0;
  const broadcastMinutes = (streamer.broadcast_minutes || 0) + addMinutes;
  const activityScore = Math.round((broadcastMinutes / 60 * 50 + consumedChats) * newMultiplier);
  const prevValue = streamer.base_value || streamer.follower_count;

  return {
    update: {
      channel_id: streamer.channel_id,
      prev_value: prevValue,
      base_value: finalVal,
      activity_score: activityScore,
      broadcast_multiplier: newMultiplier,
      add_minutes: addMinutes,
      add_broadcast_count: addBroadcastCount,
      // 폴링하지 않은 오프라인 스트리머의 chat_count는 건드리지 않음
      consumed_chats: polled ? consumedChats : 0,
      polled,
      is_active: openLive,
      follower_count: followerCount
    },
    history: { channel_id: streamer.channel_id, value: finalVal }
  };
};

/**
 * 등록된 스트리머의 방송 상태·팔로워·시세를 1주기 갱신합니다.
 * - 라이브 스트리머: 매 주기 HTTP 폴링
 * - 오프라인 스트리머: N개 샤드로 나눠 순회 폴링(감가·드리프트는 매 주기 순수 계산)
 * - 모든 DB 반영은 단일 트랜잭션/RPC로 일괄 처리
 * - 이전 주기 미완 시 이번 틱은 건너뜀(오버랩 방지)
 */
export const syncAllStreamersLiveStatus = async () => {
  if (isSyncRunning) {
    console.warn('[LiveStatusScheduler] 이전 주기가 아직 진행 중이라 이번 틱을 건너뜁니다(오버랩 방지).');
    return;
  }
  isSyncRunning = true;
  const cycle = scheduleCycle++;
  try {
    const streamers = await streamerRepository.findAll();
    if (streamers.length === 0) {
      console.log('[LiveStatusScheduler] 등록된 스트리머가 없어 동기화를 건너뜁니다.');
      return;
    }

    const results: StreamerScheduleResult[] = [];
    const historyPoints: { channel_id: string; value: number }[] = [];

    // 1) 폴링 대상(라이브 + 이번 샤드의 오프라인)과 계산 전용(나머지 오프라인) 분리
    const pollTargets: Streamer[] = [];
    const computeOnly: Streamer[] = [];
    const activeShard = cycle % OFFLINE_POLL_SHARDS;
    for (const s of streamers) {
      const shouldPoll = s.is_active || shardOf(s.channel_id, OFFLINE_POLL_SHARDS) === activeShard;
      if (shouldPoll) pollTargets.push(s);
      else computeOnly.push(s);
    }

    // 2) 계산 전용 오프라인 스트리머: HTTP 없이 즉시 감가/드리프트 계산
    for (const s of computeOnly) {
      const r = buildScheduleResult(s, null);
      results.push(r.update);
      historyPoints.push(r.history);
    }

    // 3) 폴링 대상: 적응형 동시성 워커 풀로 HTTP 폴링 + 채팅 소켓 관리
    let liveCount = 0;
    let failCount = 0;
    const CONCURRENCY = Math.min(16, Math.max(4, Math.ceil(pollTargets.length / 25)));
    let cursor = 0;
    const worker = async () => {
      while (cursor < pollTargets.length) {
        const streamer = pollTargets[cursor++];
        try {
          const profile = await fetchChzzkChannelProfile(streamer.channel_id);

          // 채팅 수집 소켓 연결/해제 관리 (방송 켬 트랜지션은 결과의 add_broadcast_count로 일괄 반영)
          if (profile.openLive && profile.chatChannelId) {
            const streamerAccessToken = await getValidStreamerAccessToken(streamer.channel_id);
            chatManager.connect(streamer.channel_id, profile.chatChannelId, streamerAccessToken);
          } else {
            chatManager.disconnect(streamer.channel_id);
          }

          const r = buildScheduleResult(streamer, profile);
          results.push(r.update);
          historyPoints.push(r.history);
          if (r.update.is_active) liveCount++;
        } catch (err: any) {
          failCount++;
          console.error(`[LiveStatusScheduler] 스트리머 폴링 실패 (ID: ${streamer.channel_id}):`, err.message);
        }
        // 소량 지터로 호출 버스트 완화 (Chzzk 레이트리밋/차단 회피)
        if (POLL_JITTER_MS > 0) await sleep(Math.random() * POLL_JITTER_MS);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, pollTargets.length) }, () => worker())
    );

    // 4) DB 일괄 반영 (단일 트랜잭션/RPC로 왕복 최소화)
    await streamerRepository.bulkApplyScheduleResults(results);
    await streamerRepository.bulkRecordValueHistory(historyPoints);
    // 5) 주기적으로 오래된 시세 이력 정리 (7일 초과분)
    if (cycle % PRUNE_EVERY_CYCLES === 0) {
      await streamerRepository.pruneValueHistory(VALUE_HISTORY_RETENTION_DAYS);
    }

    console.log(
      `[LiveStatusScheduler] 동기화 완료: 총 ${streamers.length}명 ` +
      `(폴링 ${pollTargets.length} / 라이브 ${liveCount} / 계산전용 ${computeOnly.length} / 실패 ${failCount}, 동시성 ${CONCURRENCY})`
    );
  } catch (error: any) {
    console.error('[LiveStatusScheduler] 동기화 중 치명적인 에러 발생:', error.message);
  } finally {
    isSyncRunning = false;
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
