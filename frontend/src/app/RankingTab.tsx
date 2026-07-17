'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  TrendingUp,
  Search,
  RefreshCw,
  MessageCircleHeart,
  Clock3
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { ProfileModal } from './ProfileModal';
import { StreamerDetailModal } from './StreamerDetailModal';
import { StreamerTooltip } from './StreamerTooltip';
import { fuzzyScore, fuzzySearch, normalizeSearchText } from '@/lib/search';
import { formatLocalDateTime, parseAppDate } from '@/lib/time';
import type { UserTitle } from '@/lib/types';
import { UserTitleList } from './UserTitleBadge';
import { useStreamerLiveStatuses } from '@/lib/streamerLiveStatus';

interface Streamer {
  channel_id: string;
  name: string;
  logo_url: string;
  custom_image_url: string | null;
  base_value: number;
  follower_count: number;
  prev_value?: number;
  value_1h_ago?: number;
  is_active?: boolean;
  rank?: number;
  titles?: UserTitle[];
}

interface UserRank {
  id: string;
  username: string;
  avatar_url: string;
  point: number;
  card_count: number;
  cards_value?: number;
  total_asset?: number;
  status_message?: string | null;
  last_seen_at?: string | null;
  rank?: number;
  titles: UserTitle[];
  is_streamer: boolean;
  is_live: boolean;
}

type SubTab = 'value' | 'change' | 'user' | 'cards';
const RANKING_SUB_TABS: SubTab[] = ['value', 'change', 'user', 'cards'];
type RankingRealtimeDetail = {
  scope?: 'users' | 'streamers' | string;
  affects?: string[];
  reason?: string;
  refreshed?: boolean;
};

export const RankingTab: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isStreamerLive } = useStreamerLiveStatuses(true);
  const tabParam = searchParams.get('tab');
  const initialSubTab: SubTab = RANKING_SUB_TABS.includes(tabParam as SubTab) ? tabParam as SubTab : 'value';
  const pageParam = Number(searchParams.get('page') || '1');
  const [subTab, setSubTab] = useState<SubTab>(initialSubTab);

  const [streamers, setStreamers] = useState<Streamer[]>([]);
  const [userRankings, setUserRankings] = useState<UserRank[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1);
  const [pageInput, setPageInput] = useState(String(Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1));
  const PER_PAGE = 10;
  const [profileUserId, setProfileUserId] = useState<string | null>(searchParams.get('profile'));
  const [detailChannelId, setDetailChannelId] = useState<string | null>(searchParams.get('streamer'));
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [cardFilterName, setCardFilterName] = useState('');
  const [cardFilterChannelId, setCardFilterChannelId] = useState('');
  const [cardFilterCandidates, setCardFilterCandidates] = useState<Streamer[]>([]);
  const [cardFilterSearching, setCardFilterSearching] = useState(false);
  const [cardFilterStar, setCardFilterStar] = useState('');
  const fetchSeqRef = useRef(0);
  const supportsCardHolderFilter = subTab === 'user' || subTab === 'cards';
  const serverSearchQuery = subTab === 'cards' ? '' : debouncedSearchQuery;

  const pushRankingRoute = (updates: Record<string, string | number | null | undefined>) => {
    const params = new URLSearchParams(window.location.search);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') params.delete(key);
      else params.set(key, String(value));
    });
    const query = params.toString();
    router.push(query ? `/ranking?${query}` : '/ranking');
  };

  const handleSubTabChange = (tab: SubTab) => {
    setSubTab(tab);
    setPage(1);
    setProfileUserId(null);
    setDetailChannelId(null);
    pushRankingRoute({ tab, page: null, profile: null, streamer: null });
  };

  const handlePageChange = (nextPage: number) => {
    const normalizedPage = Math.max(1, Math.floor(nextPage));
    setPage(normalizedPage);
    setPageInput(String(normalizedPage));
    pushRankingRoute({ tab: subTab, page: normalizedPage === 1 ? null : normalizedPage });
  };

  const openProfile = (userId: string) => {
    setProfileUserId(userId);
    setDetailChannelId(null);
    pushRankingRoute({ tab: subTab, profile: userId, streamer: null });
  };

  const openStreamerDetail = (channelId: string) => {
    setDetailChannelId(channelId);
    setProfileUserId(null);
    pushRankingRoute({ tab: subTab, streamer: channelId, profile: null });
  };

  const closeRankingModal = () => {
    setProfileUserId(null);
    setDetailChannelId(null);
    pushRankingRoute({ profile: null, streamer: null });
  };

  const findBestCardFilterMatch = (query: string): Streamer | null => {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return null;

    const candidatesById = new Map<string, Streamer>();
    for (const streamer of streamers) candidatesById.set(streamer.channel_id, streamer);
    for (const streamer of cardFilterCandidates) candidatesById.set(streamer.channel_id, streamer);

    const scored = Array.from(candidatesById.values())
      .map((streamer) => {
        const normalizedName = normalizeSearchText(streamer.name || '');
        const normalizedChannelId = normalizeSearchText(streamer.channel_id || '');
        const nameScore = fuzzyScore(streamer.name || '', query);
        const channelScore = fuzzyScore(streamer.channel_id || '', query);
        const score = normalizedName === normalizedQuery || normalizedChannelId === normalizedQuery
          ? -10000
          : nameScore ?? (channelScore !== null ? 2000 + channelScore : null);
        return { streamer, score };
      })
      .filter((item): item is { streamer: Streamer; score: number } => item.score !== null)
      .sort((a, b) => a.score - b.score || (b.streamer.base_value || 0) - (a.streamer.base_value || 0));

    return scored[0]?.streamer || null;
  };

  // 검색어 디바운스 (타이핑 성능 최적화)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const nextTabParam = searchParams.get('tab');
    const nextTab: SubTab = RANKING_SUB_TABS.includes(nextTabParam as SubTab) ? nextTabParam as SubTab : 'value';
    const nextPageRaw = Number(searchParams.get('page') || '1');
    const nextPage = Number.isFinite(nextPageRaw) && nextPageRaw > 0 ? Math.floor(nextPageRaw) : 1;
    setSubTab(nextTab);
    setPage(nextPage);
    setPageInput(String(nextPage));
    const profile = searchParams.get('profile');
    const streamer = searchParams.get('streamer');
    setProfileUserId(profile);
    setDetailChannelId(profile ? null : streamer);
  }, [searchParams]);

  useEffect(() => {
    fetchRankings();
    let refreshTimer: number | null = null;
    const shouldRefreshForEvent = (detail: RankingRealtimeDetail | null) => {
      if (!detail?.scope && !Array.isArray(detail?.affects)) return true;
      const affects = new Set(detail.affects || []);
      const isUserTab = subTab === 'user' || subTab === 'cards';
      if (isUserTab) {
        return detail.scope === 'users'
          || affects.has('user_rankings')
          || affects.has('user_assets')
          || affects.has('user_cards')
          || affects.has('user_live');
      }
      return detail.scope === 'streamers'
        || affects.has('streamer_rankings')
        || affects.has('streamer_values')
        || affects.has('streamer_live');
    };
    const scheduleRefresh = (event?: Event) => {
      if (document.visibilityState !== 'visible') return;
      const detail = (event as CustomEvent<RankingRealtimeDetail | null> | undefined)?.detail || null;
      if (!shouldRefreshForEvent(detail)) return;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      const delay = detail?.scope === 'users' ? 100 : 500;
      refreshTimer = window.setTimeout(() => fetchRankings(true), delay);
    };
    window.addEventListener('chikapo:ranking-updated', scheduleRefresh);
    // 스트림이 끊긴 환경을 위한 느린 fallback입니다.
    const fallbackMs = typeof EventSource === 'undefined' ? 60_000 : 300_000;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') fetchRankings(true);
    }, fallbackMs);
    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.removeEventListener('chikapo:ranking-updated', scheduleRefresh);
      clearInterval(timer);
    };
  }, [subTab, serverSearchQuery, cardFilterChannelId, cardFilterStar]);

  useEffect(() => {
    if (!supportsCardHolderFilter) return;
    const match = findBestCardFilterMatch(cardFilterName);
    setCardFilterChannelId(match ? match.channel_id : '');
  }, [cardFilterName, streamers, cardFilterCandidates, supportsCardHolderFilter]);

  useEffect(() => {
    if (!supportsCardHolderFilter) return;
    const query = cardFilterName.trim();
    if (!query) {
      setCardFilterCandidates([]);
      setCardFilterSearching(false);
      return;
    }
    let canceled = false;
    setCardFilterSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ mode: 'value', q: query, limit: '50' });
        const res = await apiFetch(`/streamers/ranking?${params.toString()}`, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
        if (!res.ok || canceled) return;
        const matches = await res.json();
        if (!Array.isArray(matches) || canceled) return;
        setCardFilterCandidates(matches);
      } catch {
        // 카드 보유자 필터 후보 보강 실패는 기본 랭킹 로드를 막지 않습니다.
      } finally {
        if (!canceled) setCardFilterSearching(false);
      }
    }, 180);
    return () => {
      canceled = true;
      setCardFilterSearching(false);
      window.clearTimeout(timer);
    };
  }, [cardFilterName, supportsCardHolderFilter]);

  useEffect(() => {
    const handleTutorialSubTab = (event: Event) => {
      const subTabId = (event as CustomEvent<{ subTab?: SubTab }>).detail?.subTab;
      if (subTabId === 'value' || subTabId === 'change' || subTabId === 'user' || subTabId === 'cards') {
        handleSubTabChange(subTabId);
      }
    };

    window.addEventListener('chikapo:tutorial-ranking-subtab', handleTutorialSubTab);
    return () => window.removeEventListener('chikapo:tutorial-ranking-subtab', handleTutorialSubTab);
  }, []);

  // 탭 전환·검색 시 1페이지로 초기화
  useEffect(() => {
    setPage(1);
    setPageInput('1');
    const params = new URLSearchParams(window.location.search);
    if (params.has('page')) {
      params.delete('page');
      const query = params.toString();
      router.replace(query ? `/ranking?${query}` : '/ranking');
    }
  }, [searchQuery, cardFilterChannelId, cardFilterStar, router]);

  const fetchRankings = async (silent = false) => {
    const requestSeq = ++fetchSeqRef.current;
    const isCurrentRequest = () => requestSeq === fetchSeqRef.current;

    if (!silent) setLoading(true);
    try {
      if (subTab === 'user' || subTab === 'cards') {
        const params = new URLSearchParams();
        if (serverSearchQuery.trim()) params.set('q', serverSearchQuery.trim());
        if (subTab === 'cards') params.set('mode', 'cards');
        if (cardFilterChannelId) params.set('channel_id', cardFilterChannelId);
        if (cardFilterStar !== '') params.set('star', cardFilterStar);
        const query = params.toString();
        const rankingFetchOptions = { cache: 'no-store' as RequestCache, headers: { 'Cache-Control': 'no-cache' } };
        const [rankings, streamerOptions] = await Promise.all([
          apiFetch(`/users/ranking${query ? `?${query}` : ''}`, rankingFetchOptions).then((res) => res.ok ? res.json() : null),
          supportsCardHolderFilter
            ? apiFetch('/streamers/ranking?mode=value&limit=all', rankingFetchOptions).then((res) => res.ok ? res.json() : null)
            : Promise.resolve(null)
        ]);
        if (!isCurrentRequest()) return;
        if (rankings) setUserRankings(rankings);
        if (streamerOptions) setStreamers(streamerOptions);
      } else {
        const params = new URLSearchParams({
          mode: subTab === 'change' ? 'change' : 'value',
          limit: '100'
        });
        if (serverSearchQuery.trim()) params.set('q', serverSearchQuery.trim());
        const res = await apiFetch(`/streamers/ranking?${params.toString()}`, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
        const streamersData = res.ok ? await res.json() : null;
        if (!isCurrentRequest()) return;
        if (streamersData) setStreamers(streamersData);
      }
    } catch (e) {
      if (!isCurrentRequest()) return;
      console.error('랭킹 데이터 획득 실패:', e);
      if (!silent) {
        if (subTab === 'user' || subTab === 'cards') setUserRankings([]);
        else setStreamers([]);
      }
    } finally {
      if (!silent && isCurrentRequest()) setLoading(false);
    }
  };

  // 1시간 등락량 (현재 시세 - 1시간 전 시세)
  const change1h = (s: Streamer) => (s.base_value || 0) - (s.value_1h_ago ?? s.base_value ?? 0);
  // 1시간 등락률(%) — 등락률 랭킹 정렬 기준
  const changeRate1h = (s: Streamer) => {
    const prev = s.value_1h_ago ?? s.base_value ?? 0;
    return prev > 0 ? (change1h(s) / prev) * 100 : 0;
  };

  // 공통: 정렬된 목록에 실제 순위(rank)를 부여한 뒤 검색어로 필터(순위는 유지)
  const rankAndFilter = <T,>(
    sorted: T[],
    getName: (item: T) => string
  ): (T & { rank: number })[] => {
    const withRank = sorted.map((item, i) => ({
      ...item,
      rank: (item as any).rank ? (item as any).rank : i + 1
    })) as (T & { rank: number })[];

    if (searchQuery) {
      return withRank.filter((item) => fuzzySearch(getName(item), searchQuery));
    } else {
      return withRank.slice(0, 100);
    }
  };

  // 시세/등락률 탭: 서브탭 기준 정렬 후 순위·검색 적용
  // (등락률 탭은 1시간 등락 '퍼센트' 기준, 시세 탭은 카드 가치 기준)
  const rankedStreamers = rankAndFilter(
    [...streamers].sort((a, b) =>
      subTab === 'change' ? changeRate1h(b) - changeRate1h(a) : (b.base_value || 0) - (a.base_value || 0)
    ),
    (s) => s.name
  );

  // 수집가 자산 탭: 백엔드가 총자산 순으로 정렬해 주므로 순위·검색만 적용 (프론트엔드 2차 필터 적용)
  const rankedUsers = rankAndFilter(userRankings, (u) => u.username);
  const selectedCardFilterStreamer = cardFilterChannelId
    ? [...cardFilterCandidates, ...streamers].find((streamer) => streamer.channel_id === cardFilterChannelId) || null
    : null;

  // 페이지네이션 (10위 단위) — 순위(rank)는 이미 부여되어 있으므로 슬라이스만 함
  const activeLength = (subTab === 'user' || subTab === 'cards') ? rankedUsers.length : rankedStreamers.length;
  const totalPages = Math.max(1, Math.ceil(activeLength / PER_PAGE));
  const pageClamped = Math.min(page, totalPages);
  const sliceStart = (pageClamped - 1) * PER_PAGE;
  const pagedStreamers = rankedStreamers.slice(sliceStart, sliceStart + PER_PAGE);
  const pagedUsers = rankedUsers.slice(sliceStart, sliceStart + PER_PAGE);

  const goToRankingPage = () => {
    const parsed = Math.floor(Number(pageInput));
    if (!Number.isFinite(parsed)) {
      setPageInput(String(pageClamped));
      return;
    }
    handlePageChange(Math.min(Math.max(1, parsed), totalPages));
  };

  const rankColor = (rank: number) =>
    rank === 1 ? 'text-amber-500' : rank === 2 ? 'text-zinc-500 dark:text-zinc-400' : rank === 3 ? 'text-amber-700' : 'text-muted-foreground';

  const formatLastSeen = (value?: string | null) => {
    if (!value) return '접속 기록 없음';
    const date = parseAppDate(value);
    if (!date) return '접속 기록 없음';
    const diffMs = Math.max(0, Date.now() - date.getTime());
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diffMs < 10 * minute) return '방금 접속';
    if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))}분 전 접속`;
    if (diffMs < day) return `${Math.floor(diffMs / hour)}시간 전 접속`;
    if (diffMs < 30 * day) return `${Math.floor(diffMs / day)}일 전 접속`;
    return '30일 이상 미접속';
  };

  const lastSeenTone = (value?: string | null) => {
    if (!value) return 'border-border/60 bg-secondary/45 text-muted-foreground';
    const date = parseAppDate(value);
    if (!date) return 'border-border/60 bg-secondary/45 text-muted-foreground';
    const diffMs = Math.max(0, Date.now() - date.getTime());
    const day = 24 * 60 * 60 * 1000;
    if (diffMs < day) return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300';
    if (diffMs < 7 * day) return 'border-sky-400/25 bg-sky-400/10 text-sky-600 dark:text-sky-300';
    if (diffMs < 30 * day) return 'border-amber-400/25 bg-amber-400/10 text-amber-600 dark:text-amber-300';
    return 'border-zinc-400/25 bg-zinc-400/10 text-muted-foreground';
  };

  const subTabs: { id: SubTab; label: string }[] = [
    { id: 'value', label: '스트리머 시세' },
    { id: 'change', label: '스트리머 등락률' },
    { id: 'user', label: '수집가 자산' },
    { id: 'cards', label: '카드 가치 랭킹' }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">

      {/* 랭킹 탭 대제목 */}
      <div data-tour="ranking-header" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="cute-outline-soft flex items-center gap-2 text-2xl font-black">
            <TrendingUp className="h-5.5 w-5.5 text-primary" /> 실시간 랭킹 시스템
          </h2>
          <p className="text-xs text-muted-foreground">
            {subTab === 'value' && '카드 가치(시세)가 높은 순으로 정렬됩니다.'}
            {subTab === 'change' && '최근 1시간 동안 시세가 가장 많이 오른 순으로 정렬됩니다.'}
            {subTab === 'user' && '포인트와 보유 카드 가치를 합산한 총자산 순위입니다. 특정 카드를 가진 사람만 필터링할 수 있습니다.'}
            {subTab === 'cards' && '포인트를 제외하고 보유 카드 가치만 합산한 순위입니다. 특정 카드를 가진 사람만 필터링할 수 있습니다.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* 슬라이드 서브 탭 */}
          <div data-tour="ranking-tabs" className="flex rounded-2xl border border-border bg-secondary/70 p-1">
            {subTabs.map((t) => (
              <button
                key={t.id}
                onClick={() => handleSubTabChange(t.id)}
                className={`cute-wiggle-hover rounded-xl px-3 py-1.5 text-xs font-bold transition ${subTab === t.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => fetchRankings()}
            className="cute-wiggle-hover rounded-2xl border border-border bg-secondary/70 p-2 text-muted-foreground transition hover:-translate-y-0.5 hover:text-foreground"
            title="새로고침"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 랭킹 메인 */}
      <div data-tour="ranking-list" className="cute-surface rounded-[2rem] p-6">

        {/* 검색바 (모든 탭 공통, 검색해도 실제 순위 유지) */}
        <div className="relative mb-5">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder={(subTab === 'user' || subTab === 'cards') ? '컬렉터(유저) 검색' : '스트리머 검색'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-2xl border border-border bg-secondary/45 py-2.5 pl-10 pr-4 text-xs font-semibold focus:border-primary focus:outline-none"
          />
        </div>

        {supportsCardHolderFilter && (
          <div data-tour="ranking-card-filter" className="mb-5 grid gap-2 rounded-2xl border border-primary/15 bg-primary/5 p-3 sm:grid-cols-[1fr_110px_auto] dark:bg-primary/10">
            <input
              value={cardFilterName}
              onChange={(event) => {
                const value = event.target.value;
                setCardFilterName(value);
              }}
              placeholder="특정 카드를 가진 사람 필터 (스트리머 이름)"
              className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold focus:border-primary focus:outline-none"
            />
            <select
              value={cardFilterStar}
              onChange={(event) => setCardFilterStar(event.target.value)}
              className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold focus:border-primary focus:outline-none"
            >
              <option value="">전체 별</option>
              {[0, 1, 2, 3, 4, 5].map((star) => <option key={star} value={star}>{star}성</option>)}
            </select>
            <button
              type="button"
              onClick={() => { setCardFilterName(''); setCardFilterChannelId(''); setCardFilterStar(''); }}
              className="rounded-xl bg-secondary px-3 py-2 text-xs font-black text-muted-foreground hover:text-foreground"
            >
              필터 초기화
            </button>
            {cardFilterName.trim() && (
              <p className="text-[10px] font-bold text-muted-foreground sm:col-span-3">
                {cardFilterSearching
                  ? '스트리머를 검색하는 중입니다...'
                  : selectedCardFilterStreamer
                  ? <>유사도 검색 결과: <b className="text-primary">{selectedCardFilterStreamer.name}</b> 카드 보유자만 표시합니다.</>
                  : '유사도 검색 결과와 일치하는 스트리머를 찾지 못했습니다.'}
              </p>
            )}
          </div>
        )}

        {/* 랭킹 테이블 리스트 */}
        <div className="space-y-3.5">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
            </div>
          ) : (subTab === 'user' || subTab === 'cards') ? (
            // 컬렉터(유저) 자산 랭킹 (검색해도 실제 순위 유지)
            rankedUsers.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-12">표시할 컬렉터가 없습니다.</p>
            ) : pagedUsers.map((ur) => (
              <div
                key={ur.id}
                onClick={() => openProfile(ur.id)}
                className="cute-card-pop flex cursor-pointer items-center justify-between gap-2 rounded-2xl border border-border/50 bg-secondary/25 p-4 hover:border-primary/45 hover:bg-secondary/45 sm:gap-4"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
                  <span className={`cute-number-font w-6 text-center text-xs font-black ${rankColor(ur.rank)}`}>{ur.rank}</span>
                  <div className="relative shrink-0">
                    <img src={ur.avatar_url} alt={ur.username} className="h-11 w-11 rounded-2xl border-2 border-white bg-card object-cover shadow-sm dark:border-white/10" />
                    {isStreamerLive({ channel_id: ur.id, is_active: ur.is_live }) && (
                      <span className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-red-600 px-1 py-0.5 text-[7px] font-black leading-none text-white ring-2 ring-card">
                        LIVE
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <h4 className="truncate text-xs font-bold text-foreground">{ur.username}</h4>
                      <UserTitleList titles={ur.titles} compact />
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <p className="text-[10px] text-muted-foreground">총 {ur.card_count}장 소장 중</p>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-black ${lastSeenTone(ur.last_seen_at)}`}
                        title={ur.last_seen_at ? formatLocalDateTime(ur.last_seen_at) : '접속 기록 없음'}
                      >
                        <Clock3 className="h-2.5 w-2.5" />
                        {formatLastSeen(ur.last_seen_at)}
                      </span>
                    </div>
                    {ur.status_message && (
                      <StreamerTooltip
                        content={ur.status_message}
                        className="mt-1 inline-flex max-w-full sm:max-w-[min(56vw,22rem)]"
                        tooltipClassName="status-message-tooltip"
                        edgeGuard={{ right: 460, bottom: 140 }}
                      >
                        <p className="inline-flex w-full items-center gap-1.5 truncate rounded-full border border-primary/15 bg-primary/10 px-2.5 py-1 text-[11px] font-black text-primary shadow-sm dark:bg-primary/15">
                          <MessageCircleHeart className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{ur.status_message}</span>
                        </p>
                      </StreamerTooltip>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <span className="cute-number-font text-xs font-black text-primary">{(subTab === 'cards' ? (ur.cards_value || 0) : ((ur.total_asset ?? ur.point) || 0)).toLocaleString()} P</span>
                  <p className="text-[9px] text-muted-foreground">{subTab === 'cards' ? '카드 가치만' : '총 자산 (포인트+카드가치)'}</p>
                </div>
              </div>
            ))
          ) : rankedStreamers.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-12">표시할 스트리머가 없습니다.</p>
          ) : (
            pagedStreamers.map((st) => {
              const diff1h = change1h(st);
              const prev1h = st.value_1h_ago ?? st.base_value ?? 0;
              const rate1h = prev1h > 0 ? (diff1h / prev1h) * 100 : 0;

              // 시세 탭은 24h 등락, 등락률 탭은 1h 등락을 표시
              const prev24h = st.prev_value ?? st.base_value ?? 1000;
              const diff24h = (st.base_value || 0) - prev24h;
              const rate24h = prev24h > 0 ? (diff24h / prev24h) * 100 : 0;

              return (
                <div
                  key={st.channel_id}
                  onClick={() => openStreamerDetail(st.channel_id)}
                  className="cute-card-pop flex cursor-pointer items-center justify-between rounded-2xl border border-border/50 bg-secondary/25 p-4 hover:border-primary/45 hover:bg-secondary/45"
                >
                  <div className="flex items-center gap-4">
                    <span className={`cute-number-font w-6 text-center text-xs font-black ${rankColor(st.rank)}`}>{st.rank}</span>
                    <div className="relative shrink-0">
                      <img src={st.logo_url || '/icon.png'} alt={st.name} className="h-11 w-11 rounded-2xl border-2 border-white bg-card object-cover shadow-sm dark:border-white/10" />
                      {isStreamerLive(st) && (
                        <span className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-red-600 px-1 py-0.5 text-[7px] font-black text-white ring-2 ring-card leading-none">LIVE</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h4 className="truncate text-xs font-bold text-foreground">
                          {st.name}
                        </h4>
                        <UserTitleList titles={st.titles} compact />
                      </div>
                      <p className="text-[10px] text-muted-foreground">{(st.follower_count || 0).toLocaleString()} 팔로워</p>
                    </div>
                  </div>

                  {subTab === 'change' ? (
                    // 등락률 탭: 1시간 등락 '퍼센트' 강조 (정렬 기준)
                    <div className="text-right flex flex-col items-end justify-center">
                      <span className={`cute-number-font flex items-center gap-0.5 text-sm font-black ${rate1h > 0 ? 'text-rose-500' : rate1h < 0 ? 'text-blue-500' : 'text-muted-foreground'}`}>
                        {rate1h > 0 ? '▲' : rate1h < 0 ? '▼' : '-'} {rate1h > 0 ? '+' : ''}{rate1h.toFixed(2)}%
                      </span>
                      <p className="text-[10px] text-muted-foreground">
                        1시간 {diff1h > 0 ? '+' : ''}{diff1h.toLocaleString()}P · 현재 {(st.base_value || 0).toLocaleString()}P
                      </p>
                    </div>
                  ) : (
                    // 시세 탭: 현재 시세 + 24h 등락률
                    <div className="text-right flex flex-col items-end justify-center">
                      <div className="flex items-center gap-1.5 justify-end">
                        <span className="cute-number-font text-xs font-black text-primary">{(st.base_value || 0).toLocaleString()} P</span>
                        {diff24h > 0 ? (
                          <span className="text-[10px] font-black text-rose-500" title={`24시간 전: ${prev24h.toLocaleString()} P`}>▲ +{rate24h.toFixed(1)}%</span>
                        ) : diff24h < 0 ? (
                          <span className="text-[10px] font-black text-blue-500" title={`24시간 전: ${prev24h.toLocaleString()} P`}>▼ {rate24h.toFixed(1)}%</span>
                        ) : (
                          <span className="text-[9px] font-bold text-muted-foreground" title={`24시간 전: ${prev24h.toLocaleString()} P`}>- 0.0%</span>
                        )}
                      </div>
                      <p className="text-[9px] text-muted-foreground">실시간 환산 시세 (24h 등락)</p>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* 페이지네이션 (10위 단위) */}
        {!loading && totalPages > 1 && (
          <div className="mt-5 flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap">
            <div className="flex items-center justify-center gap-1.5">
              <button
                onClick={() => handlePageChange(pageClamped - 1)}
                disabled={pageClamped <= 1}
                className="rounded-2xl bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
              >
                이전
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => Math.abs(p - pageClamped) <= 2 || p === 1 || p === totalPages)
                .reduce((acc: (number | string)[], p, idx, arr) => {
                  if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('…');
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, i) =>
                  typeof p === 'number' ? (
                    <button
                      key={i}
                      onClick={() => handlePageChange(p)}
                      className={`min-w-8 rounded-2xl px-2.5 py-1.5 text-xs font-bold transition ${p === pageClamped ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
                    >
                      {p}
                    </button>
                  ) : (
                    <span key={i} className="px-1 text-xs text-muted-foreground">{p}</span>
                  )
                )}
              <button
                onClick={() => handlePageChange(pageClamped + 1)}
                disabled={pageClamped >= totalPages}
                className="rounded-2xl bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
              >
                다음
              </button>
            </div>
            <form
              className="flex items-center gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                goToRankingPage();
              }}
            >
              <input
                type="number"
                min={1}
                max={totalPages}
                value={pageInput}
                onChange={(event) => setPageInput(event.target.value)}
                onBlur={goToRankingPage}
                className="h-8 w-16 rounded-lg border border-border bg-card px-2 text-center text-xs font-black focus:border-primary focus:outline-none"
                aria-label="이동할 랭킹 페이지"
              />
              <span className="text-[11px] font-bold text-muted-foreground">/ {totalPages.toLocaleString()}</span>
              <button
                type="submit"
                className="h-8 rounded-lg border border-border bg-card px-3 text-xs font-black text-foreground transition hover:bg-secondary/40"
              >
                이동
              </button>
            </form>
          </div>
        )}

      </div>

      {/* 컬렉터 프로필 모달 */}
      {profileUserId && <ProfileModal userId={profileUserId} onClose={closeRankingModal} />}

      {/* 스트리머 시세 상세 모달 */}
      {detailChannelId && <StreamerDetailModal channelId={detailChannelId} onClose={closeRankingModal} />}

    </div>
  );
};
