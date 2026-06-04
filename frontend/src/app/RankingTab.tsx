'use client';

import React, { useState, useEffect } from 'react';
import {
  TrendingUp,
  Search,
  RefreshCw
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { ProfileModal } from './ProfileModal';
import { StreamerDetailModal } from './StreamerDetailModal';
import { fuzzySearch } from '@/lib/search';

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
}

interface UserRank {
  id: string;
  username: string;
  avatar_url: string;
  point: number;
  card_count: number;
  total_asset?: number;
  rank?: number;
}

type SubTab = 'value' | 'change' | 'user';

export const RankingTab: React.FC = () => {
  const [subTab, setSubTab] = useState<SubTab>('value');

  const [streamers, setStreamers] = useState<Streamer[]>([]);
  const [userRankings, setUserRankings] = useState<UserRank[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const PER_PAGE = 10;
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [detailChannelId, setDetailChannelId] = useState<string | null>(null);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');

  // 검색어 디바운스 (타이핑 성능 최적화)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    fetchRankings();
    // 시세를 준실시간으로 반영하기 위해 25초마다 조용히 갱신 (로딩 스피너 없이)
    const timer = setInterval(() => fetchRankings(true), 25_000);
    return () => clearInterval(timer);
  }, [subTab, debouncedSearchQuery]);

  // 탭 전환·검색 시 1페이지로 초기화
  useEffect(() => { setPage(1); }, [subTab, searchQuery]);

  const fetchRankings = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      if (subTab === 'user') {
        const qParam = debouncedSearchQuery.trim() ? `?q=${encodeURIComponent(debouncedSearchQuery.trim())}` : '';
        const res = await apiFetch(`/users/ranking${qParam}`);
        if (res.ok) setUserRankings(await res.json());
      } else {
        const res = await apiFetch('/streamers');
        if (res.ok) setStreamers(await res.json());
      }
    } catch (e) {
      console.error('랭킹 데이터 획득 실패:', e);
      if (!silent) {
        if (subTab === 'user') setUserRankings([]);
        else setStreamers([]);
      }
    } finally {
      if (!silent) setLoading(false);
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
  const rankAndFilter = <T,>(sorted: T[], getName: (item: T) => string): (T & { rank: number })[] => {
    const withRank = sorted.map((item, i) => ({ ...item, rank: i + 1 }));
    return searchQuery ? withRank.filter((item) => fuzzySearch(getName(item), searchQuery)) : withRank;
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

  // 페이지네이션 (10위 단위) — 순위(rank)는 이미 부여되어 있으므로 슬라이스만 함
  const activeLength = subTab === 'user' ? rankedUsers.length : rankedStreamers.length;
  const totalPages = Math.max(1, Math.ceil(activeLength / PER_PAGE));
  const pageClamped = Math.min(page, totalPages);
  const sliceStart = (pageClamped - 1) * PER_PAGE;
  const pagedStreamers = rankedStreamers.slice(sliceStart, sliceStart + PER_PAGE);
  const pagedUsers = rankedUsers.slice(sliceStart, sliceStart + PER_PAGE);

  const rankColor = (rank: number) =>
    rank === 1 ? 'text-amber-500' : rank === 2 ? 'text-zinc-400' : rank === 3 ? 'text-amber-700' : 'text-muted-foreground';

  const subTabs: { id: SubTab; label: string }[] = [
    { id: 'value', label: '스트리머 시세' },
    { id: 'change', label: '스트리머 등락률' },
    { id: 'user', label: '수집가 자산' }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">

      {/* 랭킹 탭 대제목 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black flex items-center gap-2">
            <TrendingUp className="h-5.5 w-5.5 text-primary" /> 실시간 랭킹 시스템
          </h2>
          <p className="text-xs text-muted-foreground">
            {subTab === 'value' && '카드 가치(시세)가 높은 순으로 정렬됩니다.'}
            {subTab === 'change' && '최근 1시간 동안 시세가 가장 많이 오른 순으로 정렬됩니다.'}
            {subTab === 'user' && '포인트와 보유 카드 가치를 합산한 총자산 순위입니다.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* 슬라이드 서브 탭 */}
          <div className="flex rounded-lg bg-secondary p-1">
            {subTabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setSubTab(t.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-bold transition ${subTab === t.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => fetchRankings()}
            className="rounded-lg p-2 bg-secondary text-muted-foreground hover:text-foreground transition"
            title="새로고침"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 랭킹 메인 */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">

        {/* 검색바 (모든 탭 공통, 검색해도 실제 순위 유지) */}
        <div className="relative mb-5">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder={subTab === 'user' ? '컬렉터(유저) 검색' : '스트리머 검색'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-border bg-secondary/30 pl-10 pr-4 py-2.5 text-xs focus:border-primary focus:outline-none"
          />
        </div>

        {/* 랭킹 테이블 리스트 */}
        <div className="space-y-3.5">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
            </div>
          ) : subTab === 'user' ? (
            // 컬렉터(유저) 자산 랭킹 (검색해도 실제 순위 유지)
            rankedUsers.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-12">표시할 컬렉터가 없습니다.</p>
            ) : pagedUsers.map((ur) => (
              <div
                key={ur.id}
                onClick={() => setProfileUserId(ur.id)}
                className="flex cursor-pointer items-center justify-between rounded-xl bg-secondary/15 p-4 border border-border/50 hover:border-primary/60 hover:bg-secondary/30 transition"
              >
                <div className="flex items-center gap-4">
                  <span className={`w-6 text-center text-xs font-black ${rankColor(ur.rank)}`}>{ur.rank}</span>
                  <img src={ur.avatar_url} alt={ur.username} className="h-10 w-10 rounded-full border border-border/80 bg-card object-cover" />
                  <div>
                    <h4 className="text-xs font-bold text-foreground">{ur.username}</h4>
                    <p className="text-[10px] text-muted-foreground">총 {ur.card_count}장 소장 중</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xs font-black text-primary">{((ur.total_asset ?? ur.point) || 0).toLocaleString()} P</span>
                  <p className="text-[9px] text-muted-foreground">총 자산 (포인트+카드가치)</p>
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
                  onClick={() => setDetailChannelId(st.channel_id)}
                  className="flex cursor-pointer items-center justify-between rounded-xl bg-secondary/15 p-4 border border-border/50 hover:border-primary/60 hover:bg-secondary/30 transition"
                >
                  <div className="flex items-center gap-4">
                    <span className={`w-6 text-center text-xs font-black ${rankColor(st.rank)}`}>{st.rank}</span>
                    <div className="relative shrink-0">
                      <img src={st.custom_image_url || st.logo_url} alt={st.name} className="h-10 w-10 rounded-full border border-border/80 bg-card object-cover" />
                      {st.is_active && (
                        <span className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-red-600 px-1 py-0.5 text-[7px] font-black text-white ring-2 ring-card leading-none">LIVE</span>
                      )}
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                        {st.name}
                      </h4>
                      <p className="text-[10px] text-muted-foreground">{(st.follower_count || 0).toLocaleString()} 팔로워</p>
                    </div>
                  </div>

                  {subTab === 'change' ? (
                    // 등락률 탭: 1시간 등락 '퍼센트' 강조 (정렬 기준)
                    <div className="text-right flex flex-col items-end justify-center">
                      <span className={`text-sm font-black flex items-center gap-0.5 ${rate1h > 0 ? 'text-rose-500' : rate1h < 0 ? 'text-blue-500' : 'text-muted-foreground'}`}>
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
                        <span className="text-xs font-black text-primary">{(st.base_value || 0).toLocaleString()} P</span>
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
          <div className="mt-5 flex items-center justify-center gap-1.5">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={pageClamped <= 1}
              className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
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
                    onClick={() => setPage(p)}
                    className={`min-w-8 rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${p === pageClamped ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
                  >
                    {p}
                  </button>
                ) : (
                  <span key={i} className="px-1 text-xs text-muted-foreground">{p}</span>
                )
              )}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={pageClamped >= totalPages}
              className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
            >
              다음
            </button>
          </div>
        )}

      </div>

      {/* 컬렉터 프로필 모달 */}
      {profileUserId && <ProfileModal userId={profileUserId} onClose={() => setProfileUserId(null)} />}

      {/* 스트리머 시세 상세 모달 */}
      {detailChannelId && <StreamerDetailModal channelId={detailChannelId} onClose={() => setDetailChannelId(null)} />}

    </div>
  );
};
