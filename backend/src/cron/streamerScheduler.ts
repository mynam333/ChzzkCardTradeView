import cron from 'node-cron';
import { streamerRepository } from '../repositories';
import { sendPushToUser } from '../controllers/pushController';
import type { Streamer, StreamerScheduleResult } from '../repositories/interfaces';
import {
  fetchChzzkChannelProfile,
  fetchChzzkLiveStatus,
  ChzzkLiveStatus,
  ChzzkProfile,
  getValidUserAccessToken
} from '../services/chzzkService';
import { chatManager } from '../services/chatManager';
import { acquireSchedulerLock } from '../services/schedulerLock';
import { publishRealtimeEvent } from '../services/realtimeStream';
import {
  clearDrawPoolCache,
  clearStreamerLiveStatusCache,
  clearStreamerRankingCaches,
  scheduleUserRankingRefresh
} from '../controllers/playController';
import {
  formatCardDeletionCompensationReward,
  formatCardDeletionCompensationSummary
} from '../services/cardDeletionCompensation';
import { settleStreamerCardDeletion } from '../services/cardDeletionSettlement';
import { createRealtimeNotification } from '../services/notificationDelivery';

// 스케줄러 실행 주기(분). 크론 '*/2 * * * *'와 일치해야 방송 시간 누적이 정확합니다.
const SCHEDULE_INTERVAL_MINUTES = 2;

/**
 * 모든 카드에 적용되는 랜덤 시세 변동(재미 요소)을 계산합니다.
 * 매 주기 대부분은 작은 폭(±0.8%)으로 등락하고, 약 15% 확률로 조금 더 큰 변동(±2.5%)이 발생합니다.
 * 현재 가치에 비례하므로 저가/고가 카드 모두 체감 가능한 수준으로 흔들립니다.
 * @param value 현재(이전) 가치
 * @returns 가치에 더해질 랜덤 변동량 (양수=상승, 음수=하락)
 */
export const computeRandomDrift = (value: number, followers: number = 0): number => {
  const BASE_PCT = 0.008;   // 평상시 최대 변동폭 0.8%
  const SPIKE_PCT = 0.025;  // 가끔 발생하는 큰 변동 2.5%
  const SPIKE_CHANCE = 0.15;

  const maxPct = Math.random() < SPIKE_CHANCE ? SPIKE_PCT : BASE_PCT;

  let pUp = 0.5;
  if (followers > 0) {
    if (value < followers) {
      // 현재 가치가 팔로워 수보다 작을 때 (상승 선호)
      // 밑으로는 팔로워 수의 100%만큼 차이나면 100% 확률 변동
      const gapPct = (followers - value) / followers;
      const z = Math.min(1.0, Math.max(0.0, gapPct));
      // 기하급수적 곡선: y = (e^(4z) - 1) / (e^4 - 1)
      const w = (Math.exp(4 * z) - 1) / (Math.exp(4) - 1);
      pUp = 0.5 + 0.5 * w;
    } else if (value > followers) {
      // 현재 가치가 팔로워 수보다 클 때 (하락 선호)
      // 위로는 팔로워 수의 200%만큼 차이나면 100% 확률 변동
      const gapPct = (value - followers) / followers;
      const z = Math.min(1.0, Math.max(0.0, gapPct / 2.0));
      // 기하급수적 곡선
      const w = (Math.exp(4 * z) - 1) / (Math.exp(4) - 1);
      pUp = 0.5 - 0.5 * w;
    }
  }

  // 결정된 상승 확률 pUp에 따라 변동 방향 및 크기 결정
  const isUp = Math.random() < pUp;
  const pct = Math.random() * maxPct;
  return isUp ? value * pct : -value * pct;
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
  // 500명 이상 시청 시 요구량이 부드럽게 꺾이도록 로그 보정(C1 연속 보간)을 적용하여 성장을 주춤하게 만듭니다.
  let effUserCount = concurrentUserCount;
  if (concurrentUserCount > 500) {
    effUserCount = 500 + 300 * Math.log1p((concurrentUserCount - 500) / 300);
  }

  // 시청자 10명일 때 약 4개, 5,000명일 때 약 160개 내외가 되도록 밸런싱되었습니다.
  const requiredChatsRaw = Math.round(
    0.23 * Math.pow(effUserCount, 0.91) + Math.sqrt(followers) * 0.03 + 1
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
  const randomDrift = computeRandomDrift(currentVal, followers);
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
const readPositiveIntegerEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Math.floor(Number(raw));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// 오프라인 스트리머는 매 주기 전부가 아니라 N개 샤드로 나눠 순회 폴링합니다.
// (라이브 중인 스트리머는 항상 매 주기 폴링) → HTTP 호출량 대폭 절감.
const OFFLINE_POLL_SHARDS = readPositiveIntegerEnv('OFFLINE_POLL_SHARDS', 10); // 기본 10주기(약 20분)에 걸쳐 오프라인 1회 폴링
// 전체 프로필 폴링 사이에도 방송 시작은 빠르게 감지하도록, 훨씬 가벼운 live-status API만 별도 순회합니다.
const OFFLINE_LIVE_PROBE_SHARDS = readPositiveIntegerEnv('OFFLINE_LIVE_PROBE_SHARDS', 2); // 기본 최대 약 4분 내 시작 감지
const OFFLINE_COMPUTE_EVERY_CYCLES = readPositiveIntegerEnv(
  'OFFLINE_COMPUTE_EVERY_CYCLES',
  OFFLINE_POLL_SHARDS
); // 폴링하지 않은 오프라인 스트리머의 DB 시세/이력 반영 주기
const PRUNE_EVERY_CYCLES = readPositiveIntegerEnv('VALUE_HISTORY_PRUNE_EVERY_CYCLES', 30); // 기본 약 1시간마다 정리
const VALUE_HISTORY_RETENTION_DAYS = readPositiveIntegerEnv('VALUE_HISTORY_RETENTION_DAYS', 7); // 기본 7일 초과 시세 이력 삭제
const VALUE_HISTORY_RECORD_EVERY_CYCLES = readPositiveIntegerEnv('VALUE_HISTORY_RECORD_EVERY_CYCLES', 10);
const VALUE_HISTORY_MIN_ABS_DELTA = readPositiveIntegerEnv('VALUE_HISTORY_MIN_ABS_DELTA', 25);
const VALUE_HISTORY_MIN_PCT_DELTA = Math.max(
  0,
  Number(process.env.VALUE_HISTORY_MIN_PCT_DELTA || 0.005)
);
const POLL_JITTER_MS = 30;              // 호출 버스트 완화용 소량 지터(ms)
const INACTIVE_STREAMER_PRUNE_DAYS = 90;
const POLL_FAILURE_BACKOFF_BASE_MS = 2 * 60 * 1000;
const POLL_FAILURE_BACKOFF_MAX_MS = 30 * 60 * 1000;

// 이전 주기가 끝나기 전 다음 크론이 겹쳐 실행되는 것을 막는 가드(오버랩 방지)
let isSyncRunning = false;
let scheduleCycle = 0;
const pollFailures = new Map<string, { count: number; until: number }>();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// channel_id를 안정적으로 0..(shards-1)로 분배 (오프라인 샤드 순회 폴링용)
const shardOf = (channelId: string, shards: number): number => {
  let h = 0;
  for (let i = 0; i < channelId.length; i++) h = (h * 31 + channelId.charCodeAt(i)) >>> 0;
  return h % shards;
};

const isPollingBackedOff = (channelId: string, now: number) => {
  const failure = pollFailures.get(channelId);
  if (!failure) return false;
  if (failure.until <= now) return false;
  return true;
};

const clearPollingFailure = (channelId: string) => {
  pollFailures.delete(channelId);
};

const registerPollingFailure = (channelId: string) => {
  const prev = pollFailures.get(channelId);
  const count = Math.min((prev?.count || 0) + 1, 8);
  const delay = Math.min(POLL_FAILURE_BACKOFF_BASE_MS * (2 ** (count - 1)), POLL_FAILURE_BACKOFF_MAX_MS);
  pollFailures.set(channelId, { count, until: Date.now() + delay });
};

const shouldRecordValueHistory = (result: StreamerScheduleResult, cycle: number) => {
  if (result.is_active || result.add_broadcast_count > 0) return true;
  if (cycle % VALUE_HISTORY_RECORD_EVERY_CYCLES === 0) return true;

  const prevValue = Number(result.prev_value || 0);
  const nextValue = Number(result.base_value || 0);
  const delta = Math.abs(nextValue - prevValue);
  const pctThreshold = prevValue > 0 ? prevValue * VALUE_HISTORY_MIN_PCT_DELTA : 0;
  return delta >= Math.max(VALUE_HISTORY_MIN_ABS_DELTA, pctThreshold);
};

/**
 * 스트리머 1명의 1주기 가치/배율/활동점수를 계산해 일괄 반영용 결과로 반환합니다.
 * profile === null 이면 이번 주기에 HTTP 폴링하지 않은(오프라인) 스트리머로 간주하여
 * 순수 계산(감가·랜덤 드리프트)만 적용합니다. (HTTP 호출 없음)
 */
const buildScheduleResult = (
  streamer: Streamer,
  profile: ChzzkProfile | null,
  cycleFactor = 1
): { update: StreamerScheduleResult; history: { channel_id: string; value: number } } => {
  const polled = profile !== null;
  const normalizedCycleFactor = Math.max(1, cycleFactor);
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
  const rawDelta = isEffectiveLive
    // 복구(Recovery): 0.2 부근에서 빠르게 복구되다 1.0에 가까울수록 완만히 안착
    ? Math.log(1 + (1.0 - m) * 10) * 0.0055
    // 감가(Decay): 처음엔 작게, 점점 가속. 약 5일 연속 미방송 시 최저 0.2 도달
    : -((Math.pow(1.25 - m, 2) * 0.00035) + 0.00005);
  const delta = rawDelta * normalizedCycleFactor;
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
      follower_count: followerCount,
      logo_url: polled ? (profile?.logoUrl || null) : null,
      last_broadcast_at: polled ? (profile?.lastLiveAt || streamer.last_broadcast_at || null) : null
    },
    history: { channel_id: streamer.channel_id, value: finalVal }
  };
};

const isThreeMonthsInactive = (lastLiveAt?: string | null): boolean => {
  if (!lastLiveAt) return false;
  const lastLiveMs = new Date(lastLiveAt).getTime();
  if (Number.isNaN(lastLiveMs)) return false;
  return lastLiveMs <= Date.now() - INACTIVE_STREAMER_PRUNE_DAYS * 24 * 60 * 60 * 1000;
};

const rewardHoldersAndDeleteStreamer = async (streamer: Streamer, reason: 'inactive' | 'not_found', lastLiveAt?: string) => {
  const compensation = await settleStreamerCardDeletion(streamer);

  for (const userCompensation of compensation.users) {
    const title = '보유 카드 삭제 및 보상 지급';
    const reward = formatCardDeletionCompensationReward(userCompensation);
    const body = reason === 'not_found'
      ? `'${streamer.name}' 카드 정보를 더 이상 불러올 수 없어 보유 카드 ${userCompensation.deleted_count.toLocaleString()}장이 정리되었고 ${reward}이 지급되었습니다.`
      : `'${streamer.name}' 카드가 최근 방송 없음으로 정리되어 보유 카드 ${userCompensation.deleted_count.toLocaleString()}장이 삭제되었고 ${reward}이 지급되었습니다.`;
    sendPushToUser(userCompensation.user_id, title, body, '/shop').catch(() => { /* 푸시 실패는 정산을 되돌리지 않습니다. */ });
    createRealtimeNotification({
      user_id: userCompensation.user_id,
      title,
      body,
      link: 'shop'
    }).catch(() => { /* 알림 실패는 정리 작업을 막지 않음 */ });
  }

  console.log(
    `[LiveStatusScheduler] 스트리머 삭제: ${streamer.name}(${streamer.channel_id}), ` +
    `reason=${reason}, lastLiveAt=${lastLiveAt || '-'}, 보상 ${compensation.affected_users}명(${formatCardDeletionCompensationSummary(compensation)}), ` +
    `교환취소 ${compensation.cancelled_trades}건, 매물취소 ${compensation.cancelled_listings}건, 입찰환불 ${compensation.refunded_market_bid_points}P`
  );
};

/**
 * 등록된 스트리머의 방송 상태·팔로워·시세를 1주기 갱신합니다.
 * - 라이브 스트리머: 매 주기 HTTP 폴링
 * - 오프라인 스트리머: N개 샤드로 나눠 순회 폴링
 * - 폴링하지 않은 오프라인 스트리머: 느린 감가 UX를 해치지 않는 선에서 M주기마다 계산/기록
 * - 모든 DB 반영은 단일 트랜잭션/RPC로 일괄 처리
 * - 이전 주기 미완 시 이번 틱은 건너뜀(오버랩 방지)
 */
export const syncAllStreamersLiveStatus = async () => {
  if (isSyncRunning) {
    console.warn('[LiveStatusScheduler] 이전 주기가 아직 진행 중이라 이번 틱을 건너뜁니다(오버랩 방지).');
    return;
  }
  isSyncRunning = true;
  // 락 획득(Supabase RPC)도 try 안에서 처리합니다. 네트워크 오류로 reject되더라도
  // 미처리 Promise 거부로 프로세스가 죽거나 isSyncRunning이 영구히 묶이지 않도록 보호합니다.
  let releaseLock: (() => Promise<void>) | null = null;
  try {
    releaseLock = await acquireSchedulerLock('scheduler:streamer-live-status', 4 * 60 * 1000);
    if (!releaseLock) {
      console.warn('[LiveStatusScheduler] 다른 인스턴스가 동기화를 수행 중이라 이번 틱을 건너뜁니다.');
      return;
    }
    const cycle = scheduleCycle++;
    const streamers = await streamerRepository.findAll();
    if (streamers.length === 0) {
      console.log('[LiveStatusScheduler] 등록된 스트리머가 없어 동기화를 건너뜁니다.');
      return;
    }

    const results: StreamerScheduleResult[] = [];
    const historyPoints: { channel_id: string; value: number }[] = [];
    const pruneTargets: { streamer: Streamer; lastLiveAt: string; reason?: 'inactive' | 'not_found' }[] = [];

    // 1) 전체 프로필 폴링 대상과 방송 상태 전용 probe 대상, 계산 전용 대상을 분리합니다.
    const pollTargets: Streamer[] = [];
    const probeTargets: Streamer[] = [];
    const computeOnlyCandidates: Streamer[] = [];
    const activeShard = cycle % OFFLINE_POLL_SHARDS;
    const activeProbeShard = cycle % OFFLINE_LIVE_PROBE_SHARDS;
    const shouldComputeOffline = cycle % OFFLINE_COMPUTE_EVERY_CYCLES === 0;
    const offlineComputeCycleFactor = cycle === 0 ? 1 : OFFLINE_COMPUTE_EVERY_CYCLES;
    let skippedOfflineCompute = 0;
    let preservedActiveBackoff = 0;
    const nowMs = Date.now();
    for (const s of streamers) {
      const isActive = Boolean(s.is_active);
      const isBackedOff = isPollingBackedOff(s.channel_id, nowMs);
      const shouldPoll = (isActive || shardOf(s.channel_id, OFFLINE_POLL_SHARDS) === activeShard)
        && !isBackedOff;
      if (shouldPoll) pollTargets.push(s);
      else {
        if (!isActive && !isBackedOff && shardOf(s.channel_id, OFFLINE_LIVE_PROBE_SHARDS) === activeProbeShard) {
          probeTargets.push(s);
        }
        // 마지막 확인 상태가 LIVE인 채널은 외부 API backoff 중 OFFLINE으로 추측 갱신하지 않습니다.
        // 정상 응답을 다시 받을 때까지 마지막 상태를 보존해야 일시 오류가 LIVE 배지를 끄지 않습니다.
        if (isActive) preservedActiveBackoff++;
        else if (shouldComputeOffline) computeOnlyCandidates.push(s);
      }
      if (!shouldPoll && !isActive && !shouldComputeOffline) skippedOfflineCompute++;
    }

    // 2) 전체 프로필 대상이 아닌 오프라인 채널은 live-status만 조회합니다.
    //    OPEN으로 확인된 채널은 같은 주기의 전체 프로필 폴링 대상으로 즉시 승격합니다.
    const prefetchedLiveStatuses = new Map<string, ChzzkLiveStatus>();
    const promotedChannelIds = new Set<string>();
    let probeFailCount = 0;
    const PROBE_CONCURRENCY = Math.min(16, Math.max(4, Math.ceil(probeTargets.length / 50)));
    let probeCursor = 0;
    const probeWorker = async () => {
      while (probeCursor < probeTargets.length) {
        const streamer = probeTargets[probeCursor++];
        try {
          const liveStatus = await fetchChzzkLiveStatus(streamer.channel_id, true);
          clearPollingFailure(streamer.channel_id);
          if (liveStatus.openLive) {
            prefetchedLiveStatuses.set(streamer.channel_id, liveStatus);
            promotedChannelIds.add(streamer.channel_id);
            pollTargets.push(streamer);
          }
        } catch (err: any) {
          registerPollingFailure(streamer.channel_id);
          probeFailCount++;
          console.warn(`[LiveStatusScheduler] 방송 상태 probe 실패 (ID: ${streamer.channel_id}):`, err?.message || err);
        }
        if (POLL_JITTER_MS > 0) await sleep(Math.random() * POLL_JITTER_MS);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(PROBE_CONCURRENCY, probeTargets.length) }, () => probeWorker())
    );

    const computeOnly = computeOnlyCandidates.filter((s) => !promotedChannelIds.has(s.channel_id));

    // 3) 계산 전용 오프라인 스트리머: HTTP 없이 감가/드리프트 계산
    //    대부분의 오프라인 카드는 다분 단위로 변해도 체감 차이가 작으므로 DB 쓰기와 이력 삽입을 절감합니다.
    for (const s of computeOnly) {
      const cycleFactor = s.is_active ? 1 : offlineComputeCycleFactor;
      const r = buildScheduleResult(s, null, cycleFactor);
      results.push(r.update);
      historyPoints.push(r.history);
    }

    // 4) 전체 프로필 폴링 대상: 적응형 동시성 워커 풀로 HTTP 폴링 + 채팅 소켓 관리
    let liveCount = 0;
    let failCount = 0;
    const CONCURRENCY = Math.min(16, Math.max(4, Math.ceil(pollTargets.length / 25)));
    let cursor = 0;
    const worker = async () => {
      while (cursor < pollTargets.length) {
        const streamer = pollTargets[cursor++];
        try {
          const profile = await fetchChzzkChannelProfile(
            streamer.channel_id,
            true,
            prefetchedLiveStatuses.get(streamer.channel_id),
            true
          );
          clearPollingFailure(streamer.channel_id);

          // 채팅 수집 소켓 연결/해제 관리 (방송 켬 트랜지션은 결과의 add_broadcast_count로 일괄 반영)
          if (profile.openLive && profile.chatChannelId) {
            const streamerAccessToken = await getValidUserAccessToken(streamer.channel_id);
            chatManager.connect(streamer.channel_id, profile.chatChannelId, streamerAccessToken);
          } else {
            chatManager.disconnect(streamer.channel_id);
          }

          if (!profile.openLive && isThreeMonthsInactive(profile.lastLiveAt || streamer.last_broadcast_at || null)) {
            pruneTargets.push({ streamer, lastLiveAt: profile.lastLiveAt || streamer.last_broadcast_at! });
            continue;
          }

          const r = buildScheduleResult(streamer, profile);
          results.push(r.update);
          historyPoints.push(r.history);
          if (r.update.is_active) liveCount++;
        } catch (err: any) {
          if (err?.statusCode === 404 || err?.statusCode === 410 || /\b(404|410)\b/.test(String(err?.message || ''))) {
            pruneTargets.push({ streamer, lastLiveAt: new Date().toISOString(), reason: 'not_found' });
            continue;
          }
          registerPollingFailure(streamer.channel_id);
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

    // 5) DB 일괄 반영. Supabase에서는 내부적으로 작은 배치로 나눠 statement_timeout을 피합니다.
    if (results.length > 0) {
      const previousLiveStatuses = new Map(
        streamers.map((streamer) => [streamer.channel_id, Boolean(streamer.is_active)] as const)
      );
      const changedLiveStatuses = results
        .filter((result) => result.polled && previousLiveStatuses.get(result.channel_id) !== result.is_active)
        .map((result) => ({ channel_id: result.channel_id, is_active: result.is_active }));
      const dbApplyStart = Date.now();
      await streamerRepository.bulkApplyScheduleResults(results);
      console.log(`[LiveStatusScheduler] DB 시세 반영 완료: ${results.length}건 (${Date.now() - dbApplyStart}ms)`);
      const historyStart = Date.now();
      const filteredHistoryPoints = results
        .filter((result) => shouldRecordValueHistory(result, cycle))
        .map((result) => ({ channel_id: result.channel_id, value: result.base_value }));
      await streamerRepository.bulkRecordValueHistory(filteredHistoryPoints).catch((err: any) => {
        console.warn(
          `[LiveStatusScheduler] 시세 이력 기록 실패(다음 주기에 재시도): ` +
          `${err?.message || err} (대상 ${filteredHistoryPoints.length}/${historyPoints.length}건)`
        );
      });
      console.log(
        `[LiveStatusScheduler] 시세 이력 기록 확인: ${filteredHistoryPoints.length}/${historyPoints.length}건 ` +
        `(${Date.now() - historyStart}ms, 샘플링 ${VALUE_HISTORY_RECORD_EVERY_CYCLES}주기)`
      );
      clearStreamerLiveStatusCache();
      clearStreamerRankingCaches();
      scheduleUserRankingRefresh('streamer_sync');
      publishRealtimeEvent('ranking', {
        reason: 'streamer_sync',
        scope: 'streamers',
        affects: ['streamer_rankings', 'streamer_values', 'streamer_live', 'user_live'],
        streamers: streamers.length,
        polled: pollTargets.length,
        live: liveCount,
        live_statuses: changedLiveStatuses
      });
    } else {
      console.log('[LiveStatusScheduler] 반영할 시세 변경이 없어 DB 쓰기와 랭킹 이벤트를 건너뜁니다.');
    }
    let successfulPrunes = 0;
    for (const target of pruneTargets) {
      await rewardHoldersAndDeleteStreamer(target.streamer, target.reason || 'inactive', target.lastLiveAt).then(() => {
        successfulPrunes += 1;
      }).catch((err: any) => {
        console.error(`[LiveStatusScheduler] 장기 미방송 스트리머 정리 실패 (${target.streamer.channel_id}):`, err.message);
      });
    }
    if (successfulPrunes > 0) {
      clearDrawPoolCache();
      clearStreamerLiveStatusCache();
      clearStreamerRankingCaches();
      scheduleUserRankingRefresh('streamer_prune');
      publishRealtimeEvent('ranking', {
        reason: 'streamer_prune',
        scope: 'streamers',
        affects: ['streamer_rankings', 'streamer_values', 'streamer_live', 'user_live'],
        deleted_streamers: successfulPrunes
      });
    }
    // 6) 주기적으로 오래된 시세 이력 정리 (7일 초과분)
    if (cycle % PRUNE_EVERY_CYCLES === 0) {
      const pruneStart = Date.now();
      await streamerRepository.pruneValueHistory(VALUE_HISTORY_RETENTION_DAYS).catch((err: any) => {
        console.warn(`[LiveStatusScheduler] 오래된 시세 이력 정리 실패(다음 주기에 재시도): ${err?.message || err}`);
      });
      console.log(`[LiveStatusScheduler] 오래된 시세 이력 정리 확인 완료 (${Date.now() - pruneStart}ms)`);
    }

    console.log(
      `[LiveStatusScheduler] 동기화 완료: 총 ${streamers.length}명 ` +
      `(프로필폴링 ${pollTargets.length} / 상태probe ${probeTargets.length}(승격 ${promotedChannelIds.size}) / 라이브 ${liveCount} / ` +
      `계산전용 ${computeOnly.length} / 오프라인계산스킵 ${skippedOfflineCompute} / LIVE상태보존 ${preservedActiveBackoff} / ` +
      `삭제대상 ${pruneTargets.length} / ` +
      `실패 ${failCount + probeFailCount}(프로필 ${failCount}, probe ${probeFailCount}), 동시성 ${CONCURRENCY})`
    );
  } catch (error: any) {
    console.error('[LiveStatusScheduler] 동기화 중 치명적인 에러 발생:', error?.message || error);
    if (error?.cause) console.error('[LiveStatusScheduler] 상세 원인(cause):', error.cause);
  } finally {
    if (releaseLock) await releaseLock().catch(() => undefined);
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
