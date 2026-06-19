'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Award,
  CheckCircle2,
  ChevronDown,
  Gift,
  Lock,
  Medal,
  RefreshCw,
  Search,
  Sparkles,
  Trophy
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { AppIcon } from '@/lib/iconLibrary';
import { useApp } from './AppContext';
import type { AchievementCategory, AchievementReward, AchievementStatus, UserAchievement, UserAchievementsResponse } from '@/lib/types';

type StatusFilter = 'all' | AchievementStatus;
type HiddenFilter = 'all' | 'visible' | 'hidden';
type SortOption = 'recommended' | 'progress' | 'completed' | 'tier' | 'name';

const categoryLabels: Record<AchievementCategory, string> = {
  start: '시작',
  attendance: '출석',
  collection: '수집',
  growth: '성장',
  economy: '경제',
  trade: '교환',
  market: '마켓',
  minigame: '미니게임',
  community: '커뮤니티',
  streamer: '스트리머',
  event: '이벤트',
  hidden: '숨김'
};

const statusLabels: Record<AchievementStatus, string> = {
  locked: '잠김',
  in_progress: '진행 중',
  completed: '완료',
  claimed: '수령 완료',
  expired: '만료'
};

const tierStyles: Record<string, string> = {
  bronze: 'border-amber-700/20 bg-amber-700/10 text-amber-700 dark:text-amber-300',
  silver: 'border-slate-400/25 bg-slate-400/10 text-slate-600 dark:text-slate-200',
  gold: 'border-yellow-400/25 bg-yellow-400/10 text-yellow-600 dark:text-yellow-200',
  platinum: 'border-cyan-300/25 bg-cyan-300/10 text-cyan-600 dark:text-cyan-200',
  legendary: 'border-fuchsia-400/25 bg-fuchsia-400/10 text-fuchsia-600 dark:text-fuchsia-200',
  event: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-600 dark:text-emerald-200'
};

const rewardText = (reward: AchievementReward) => {
  const quantity = Number(reward.quantity || 0);
  const suffix = reward.revoke_when_unmet ? ' (유지 중)' : '';
  if (reward.type === 'point') return `${Number(reward.points || 0).toLocaleString()}P`;
  if (reward.type === 'card') return `${reward.label || '스트리머 카드'} ${quantity.toLocaleString()}장`;
  if (reward.type === 'cosmetic') return `${reward.label || '코스메틱'} ${quantity.toLocaleString()}개${suffix}`;
  if (reward.type === 'minigame_ticket') return `미니게임 티켓 ${quantity.toLocaleString()}장`;
  if (reward.type === 'free_draw_ticket') return `무료 소환권 ${quantity.toLocaleString()}장`;
  if (reward.type === 'title') return `${reward.label || '칭호'} 칭호${suffix}`;
  return `보상${suffix}`;
};

const AchievementIcon = ({ item }: { item: UserAchievement }) => {
  const iconName = item.is_hidden && !item.code ? 'Lock' : item.icon || 'Award';
  return <AppIcon name={iconName} className="h-5 w-5" style={{ color: item.icon_color || undefined }} />;
};

export const AchievementsTab: React.FC = () => {
  const { user, toast, refreshUserData } = useApp();
  const [items, setItems] = useState<UserAchievement[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<StatusFilter>('all');
  const [category, setCategory] = useState<AchievementCategory | 'all'>('all');
  const [hidden, setHidden] = useState<HiddenFilter>('all');
  const [sort, setSort] = useState<SortOption>('recommended');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [claimingId, setClaimingId] = useState<number | null>(null);

  const fetchAchievements = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status !== 'all') params.set('status', status);
      if (category !== 'all') params.set('category', category);
      if (hidden !== 'all') params.set('hidden', hidden);
      params.set('sort', sort);
      const res = await apiFetch(`/achievements?${params.toString()}`);
      const data = await res.json().catch(() => null) as UserAchievementsResponse | null;
      if (!res.ok || !data) {
        toast((data as any)?.message || '업적 목록을 불러오지 못했습니다.', 'error');
        return;
      }
      setItems(data.items || []);
      setSummary(data.summary || {});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAchievements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, status, category, hidden, sort]);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) => {
      const haystack = `${item.name} ${item.description || ''} ${item.code || ''} ${categoryLabels[item.category] || ''}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [items, search]);

  const claimReward = async (achievementId: number) => {
    setClaimingId(achievementId);
    try {
      const res = await apiFetch(`/achievements/${achievementId}/claim`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.message || '업적 보상을 수령하지 못했습니다.', 'error');
        return;
      }
      toast(data.message || '업적 보상을 수령했습니다.', 'success');
      await Promise.all([fetchAchievements(), refreshUserData()]);
    } finally {
      setClaimingId(null);
    }
  };

  if (!user) {
    return (
      <section className="flex min-h-[45vh] items-center justify-center">
        <div className="rounded-2xl border border-border bg-card px-6 py-8 text-center shadow-sm">
          <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-black">로그인이 필요합니다.</p>
        </div>
      </section>
    );
  }

  const total = Number(summary.total || items.length || 0);
  const completed = Number(summary.completed || 0);
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary">
              <Trophy className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-xl font-black text-foreground">업적</h2>
              <p className="text-xs text-muted-foreground">달성 {completed.toLocaleString()} / 전체 {total.toLocaleString()}</p>
            </div>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[420px]">
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-[10px] font-black text-muted-foreground">진척률</p>
            <p className="mt-1 text-lg font-black text-primary">{percent}%</p>
          </div>
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-[10px] font-black text-muted-foreground">보상 대기</p>
            <p className="mt-1 text-lg font-black text-emerald-500">{Number(summary.claimable || 0).toLocaleString()}</p>
          </div>
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-[10px] font-black text-muted-foreground">숨김 업적</p>
            <p className="mt-1 text-lg font-black text-fuchsia-500">{Number(summary.hidden || 0).toLocaleString()}</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1.1fr_170px_170px_170px_170px_auto]">
          <label className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full rounded-xl border border-border bg-secondary/40 py-2.5 pl-9 pr-3 text-xs font-bold outline-none focus:border-primary"
              placeholder="업적 검색"
            />
          </label>
          <Select value={status} onChange={(value) => setStatus(value as StatusFilter)}>
            <option value="all">전체 상태</option>
            {Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </Select>
          <Select value={category} onChange={(value) => setCategory(value as AchievementCategory | 'all')}>
            <option value="all">전체 분류</option>
            {Object.entries(categoryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </Select>
          <Select value={hidden} onChange={(value) => setHidden(value as HiddenFilter)}>
            <option value="all">전체 공개</option>
            <option value="visible">일반 업적</option>
            <option value="hidden">숨겨진 업적</option>
          </Select>
          <Select value={sort} onChange={(value) => setSort(value as SortOption)}>
            <option value="recommended">추천순</option>
            <option value="progress">진행도순</option>
            <option value="completed">완료순</option>
            <option value="tier">등급순</option>
            <option value="name">이름순</option>
          </Select>
          <button
            onClick={fetchAchievements}
            disabled={loading}
            className="flex items-center justify-center gap-1 rounded-xl bg-secondary px-3 py-2.5 text-xs font-black text-muted-foreground hover:text-foreground disabled:opacity-50"
            title="새로고침"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filteredItems.map((item) => {
          const masked = item.is_hidden && !item.code;
          const claimable = item.status === 'completed';
          const rewards = item.rewards || [];
          return (
            <article key={item.achievement_id} className={`rounded-2xl border p-4 shadow-sm transition ${claimable ? 'border-emerald-400/40 bg-emerald-400/5' : 'border-border bg-card'}`}>
              <div className="flex items-start gap-3">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${masked ? 'border-muted bg-secondary text-muted-foreground' : 'border-primary/15 bg-primary/10 text-primary'}`}>
                  <AchievementIcon item={item} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${tierStyles[item.tier] || tierStyles.bronze}`}>
                      {item.tier}
                    </span>
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                      {categoryLabels[item.category] || item.category}
                    </span>
                    {item.is_hidden && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                  </div>
                  <h3 className="mt-2 truncate text-sm font-black">{item.name}</h3>
                  <p className="mt-1 line-clamp-2 min-h-[2.25rem] text-xs leading-relaxed text-muted-foreground">
                    {item.description || (masked ? '달성 전까지 내용이 공개되지 않습니다.' : '설명 없음')}
                  </p>
                  <p className="mt-2 rounded-lg bg-secondary/45 px-2.5 py-1.5 text-[10px] font-bold leading-relaxed text-muted-foreground">
                    {masked ? '달성 조건 비공개' : `달성 조건: ${item.condition_text || '조건 없음'}`}
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between text-[10px] font-black text-muted-foreground">
                  <span>{statusLabels[item.status] || item.status}</span>
                  <span>{masked ? '???' : `${item.progress_current.toLocaleString()} / ${item.progress_target.toLocaleString()}`}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  <div className={`h-full rounded-full ${item.status === 'claimed' ? 'bg-primary' : claimable ? 'bg-emerald-500' : 'bg-sky-500'}`} style={{ width: `${Math.max(0, Math.min(100, item.progress_percent))}%` }} />
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-bold text-muted-foreground">
                  {item.status === 'claimed' ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> : rewards.length > 0 ? <Gift className="h-3.5 w-3.5 text-emerald-500" /> : <Medal className="h-3.5 w-3.5" />}
                  <span className="truncate">{masked ? '비공개 보상' : rewards.length > 0 ? rewards.map(rewardText).join(', ') : '보상 없음'}</span>
                </div>
                {claimable && (
                  <button
                    onClick={() => claimReward(item.achievement_id)}
                    disabled={claimingId === item.achievement_id}
                    className="flex shrink-0 items-center gap-1 rounded-lg bg-emerald-500 px-3 py-2 text-[10px] font-black text-white hover:bg-emerald-600 disabled:opacity-50"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {claimingId === item.achievement_id ? '수령 중' : '수령'}
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {!loading && filteredItems.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-border py-16 text-center">
            <Award className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-bold text-muted-foreground">표시할 업적이 없습니다.</p>
          </div>
        )}
        {loading && (
          <div className="col-span-full flex justify-center py-16">
            <RefreshCw className="h-7 w-7 animate-spin text-primary" />
          </div>
        )}
      </div>
    </section>
  );
};

const Select: React.FC<{ value: string; onChange: (value: string) => void; children: React.ReactNode }> = ({ value, onChange, children }) => (
  <label className="relative block">
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full appearance-none rounded-xl border border-border bg-secondary/40 px-3 py-2.5 pr-9 text-xs font-bold outline-none focus:border-primary"
    >
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
  </label>
);
