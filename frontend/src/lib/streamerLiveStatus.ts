'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { apiFetch } from '@/lib/api';

export type StreamerLiveStatusSource = {
  channel_id?: string | null;
  is_active?: boolean | null;
  isLive?: boolean | null;
};

type LiveStatusResponse = {
  statuses?: unknown;
  updated_at?: string;
};

type LiveStatusChange = {
  channel_id?: unknown;
  is_active?: unknown;
};

type RankingRealtimeDetail = {
  scope?: string;
  affects?: string[];
  live_statuses?: LiveStatusChange[];
};

type LiveStatusSnapshot = Readonly<Record<string, boolean>>;
type LiveStatusListener = () => void;

const LIVE_STATUS_CACHE_TTL_MS = 10_000;
const LIVE_STATUS_POLL_MS = 30_000;
const LIVE_STATUS_EVENT_REFRESH_DELAY_MS = 250;
// 백엔드 프로세스 캐시(최대 15초)가 이벤트 직전 값을 돌려줘도 최신 패치를 되돌리지 않도록 보호합니다.
const LIVE_STATUS_PATCH_PROTECTION_MS = 20_000;
const EMPTY_LIVE_STATUSES: LiveStatusSnapshot = Object.freeze({});

let liveStatusSnapshot: LiveStatusSnapshot = EMPTY_LIVE_STATUSES;
let liveStatusCacheExpiresAt = 0;
let liveStatusInFlight: Promise<LiveStatusSnapshot | null> | null = null;
let liveStatusSyncStarted = false;
let liveStatusPollTimer: number | null = null;
let liveStatusRefreshTimer: number | null = null;
let liveStatusPatchRevision = 0;

const liveStatusListeners = new Set<LiveStatusListener>();
const latestStatusPatches = new Map<string, {
  isActive: boolean;
  revision: number;
  protectUntil: number;
}>();

const normalizeStatusMap = (value: unknown): LiveStatusSnapshot | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const statuses: Record<string, boolean> = {};
  for (const [rawChannelId, rawStatus] of Object.entries(value as Record<string, unknown>)) {
    const channelId = rawChannelId.trim();
    if (channelId && typeof rawStatus === 'boolean') {
      statuses[channelId] = rawStatus;
    }
  }
  return statuses;
};

const normalizeStatusChanges = (value: unknown): Record<string, boolean> => {
  if (!Array.isArray(value)) return {};

  const changes: Record<string, boolean> = {};
  for (const item of value as LiveStatusChange[]) {
    const channelId = typeof item?.channel_id === 'string' ? item.channel_id.trim() : '';
    if (channelId && typeof item?.is_active === 'boolean') {
      changes[channelId] = item.is_active;
    }
  }
  return changes;
};

const statusMapsEqual = (left: LiveStatusSnapshot, right: LiveStatusSnapshot) => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(channelId => left[channelId] === right[channelId]);
};

const publishLiveStatusSnapshot = (
  nextSnapshot: LiveStatusSnapshot,
  expiresAt = liveStatusCacheExpiresAt
) => {
  liveStatusCacheExpiresAt = expiresAt;
  if (statusMapsEqual(liveStatusSnapshot, nextSnapshot)) return;

  liveStatusSnapshot = nextSnapshot;
  liveStatusListeners.forEach(listener => listener());
};

const refreshLiveStatuses = (force = false): Promise<LiveStatusSnapshot | null> => {
  const now = Date.now();
  if (!force && liveStatusCacheExpiresAt > now) {
    return Promise.resolve(liveStatusSnapshot);
  }
  if (liveStatusInFlight) return liveStatusInFlight;

  const requestPatchRevision = liveStatusPatchRevision;
  const request = (async () => {
    try {
      const response = await apiFetch('/streamers/live-status', { cache: 'no-store' });
      if (!response.ok) return null;

      const payload = await response.json() as LiveStatusResponse;
      const responseStatuses = normalizeStatusMap(payload.statuses);
      if (!responseStatuses) return null;

      const nextStatuses: Record<string, boolean> = { ...responseStatuses };
      const responseReceivedAt = Date.now();
      latestStatusPatches.forEach((patch, channelId) => {
        if (patch.revision > requestPatchRevision || patch.protectUntil > responseReceivedAt) {
          nextStatuses[channelId] = patch.isActive;
        } else {
          latestStatusPatches.delete(channelId);
        }
      });
      publishLiveStatusSnapshot(nextStatuses, responseReceivedAt + LIVE_STATUS_CACHE_TTL_MS);
      return liveStatusSnapshot;
    } catch {
      return null;
    }
  })().finally(() => {
    liveStatusInFlight = null;
  });

  liveStatusInFlight = request;
  return request;
};

const scheduleLiveStatusRefresh = (delay = 0) => {
  if (typeof window === 'undefined' || document.visibilityState !== 'visible') return;
  if (liveStatusRefreshTimer !== null) window.clearTimeout(liveStatusRefreshTimer);
  liveStatusRefreshTimer = window.setTimeout(() => {
    liveStatusRefreshTimer = null;
    void refreshLiveStatuses(true);
  }, delay);
};

const handleRankingUpdate = (event: Event) => {
  const detail = (event as CustomEvent<RankingRealtimeDetail | null>).detail;
  const changes = normalizeStatusChanges(detail?.live_statuses);
  const changedEntries = Object.entries(changes);

  if (changedEntries.length > 0) {
    const revision = ++liveStatusPatchRevision;
    const protectUntil = Date.now() + LIVE_STATUS_PATCH_PROTECTION_MS;
    const nextStatuses: Record<string, boolean> = { ...liveStatusSnapshot };
    changedEntries.forEach(([channelId, isActive]) => {
      nextStatuses[channelId] = isActive;
      latestStatusPatches.set(channelId, { isActive, revision, protectUntil });
    });
    publishLiveStatusSnapshot(nextStatuses, Date.now() + LIVE_STATUS_CACHE_TTL_MS);
    return;
  }

  const affects = new Set(detail?.affects || []);
  if (detail?.scope === 'users' && !affects.has('streamer_live')) {
    return;
  }
  scheduleLiveStatusRefresh(LIVE_STATUS_EVENT_REFRESH_DELAY_MS);
};

const handleVisibilityChange = () => {
  if (document.visibilityState === 'visible') scheduleLiveStatusRefresh();
};

const handleWindowFocus = () => {
  scheduleLiveStatusRefresh();
};

const startLiveStatusSync = () => {
  if (liveStatusSyncStarted || typeof window === 'undefined') return;
  liveStatusSyncStarted = true;

  window.addEventListener('chikapo:ranking-updated', handleRankingUpdate);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('focus', handleWindowFocus);

  if (document.visibilityState === 'visible') void refreshLiveStatuses(false);
  liveStatusPollTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') void refreshLiveStatuses(true);
  }, LIVE_STATUS_POLL_MS);
};

const stopLiveStatusSync = () => {
  if (!liveStatusSyncStarted || typeof window === 'undefined') return;
  liveStatusSyncStarted = false;

  window.removeEventListener('chikapo:ranking-updated', handleRankingUpdate);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('focus', handleWindowFocus);

  if (liveStatusPollTimer !== null) window.clearInterval(liveStatusPollTimer);
  if (liveStatusRefreshTimer !== null) window.clearTimeout(liveStatusRefreshTimer);
  liveStatusPollTimer = null;
  liveStatusRefreshTimer = null;
};

const subscribeToLiveStatuses = (listener: LiveStatusListener) => {
  liveStatusListeners.add(listener);
  if (liveStatusListeners.size === 1) startLiveStatusSync();

  return () => {
    liveStatusListeners.delete(listener);
    if (liveStatusListeners.size === 0) stopLiveStatusSync();
  };
};

const subscribeToNothing = () => () => undefined;
const getLiveStatusSnapshot = () => liveStatusSnapshot;
const getServerLiveStatusSnapshot = () => EMPTY_LIVE_STATUSES;

export const resolveStreamerLiveStatus = (
  streamer: StreamerLiveStatusSource | null | undefined,
  statuses: LiveStatusSnapshot = liveStatusSnapshot
) => {
  const channelId = typeof streamer?.channel_id === 'string' ? streamer.channel_id.trim() : '';
  if (channelId && Object.prototype.hasOwnProperty.call(statuses, channelId)) {
    return statuses[channelId] === true;
  }
  return streamer?.is_active === true || streamer?.isLive === true;
};

export const useStreamerLiveStatuses = (enabled = true) => {
  const statuses = useSyncExternalStore(
    enabled ? subscribeToLiveStatuses : subscribeToNothing,
    getLiveStatusSnapshot,
    getServerLiveStatusSnapshot
  );

  const isStreamerLive = useCallback(
    (streamer: StreamerLiveStatusSource | null | undefined) => resolveStreamerLiveStatus(streamer, statuses),
    [statuses]
  );
  const refresh = useCallback((force = true) => refreshLiveStatuses(force), []);

  return { statuses, isStreamerLive, refresh };
};
