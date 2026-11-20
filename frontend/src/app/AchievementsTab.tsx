'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Award,
  CalendarClock,
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
import {
  formatWeeklyRemaining,
  getWeeklyServerOffset,
  parseWeeklyMissionsPayload,
  weeklyProgressPercent,
  type WeeklyMission,
  type WeeklyMissionsPayload
} from '@/lib/weeklyMissions';

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

const weeklyDifficultyLabels = { easy: '쉬움', normal: '보통', hard: '어려움' } as const;
const weeklyDifficultyStyles = {
  easy: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300',
  normal: 'border-sky-400/30 bg-sky-400/10 text-sky-600 dark:text-sky-300',
  hard: 'border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-600 dark:text-fuchsia-300'
} as const;
const weeklyStatusLabels = { in_progress: '진행 중', claimable: '수령 가능', claimed: '수령 완료' } as const;
const weeklyEndFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

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

const weeklyRewardText = (mission: WeeklyMission) => {
  const rewards: string[] = [];
  if (mission.reward_points > 0) rewards.push(`${mission.reward_points.toLocaleString()}P`);
  if (mission.reward_minigame_tickets > 0) rewards.push(`미니게임 티켓 ${mission.reward_minigame_tickets.toLocaleString()}장`);
  if (mission.reward_free_draw_tickets > 0) rewards.push(`무료 소환권 ${mission.reward_free_draw_tickets.toLocaleString()}장`);
  return rewards.join(' · ') || '보상 없음';
};

const WeeklyMissionCard = React.memo(function WeeklyMissionCard({ mission, claiming, expired, onClaim }: {
  mission: WeeklyMission;
  claiming: boolean;
  expired: boolean;
  onClaim: (mission: WeeklyMission) => void;
}) {
  const progressPercent = weeklyProgressPercent(mission);
  return (
    <article data-testid="weekly-mission-card" data-difficulty={mission.difficulty} data-status={mission.status}
      className={`rounded-2xl border p-3.5 shadow-sm ${mission.status === 'claimable' ? 'border-emerald-400/45 bg-emerald-400/5' : 'border-border bg-card'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${weeklyDifficultyStyles[mission.difficulty]}`}>
            {weeklyDifficultyLabels[mission.difficulty]}
          </span>
          <h3 className="mt-2 text-sm font-black leading-snug text-foreground">{mission.title}</h3>
        </div>
        {mission.status === 'claimed' ? <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" /> : <Gift className="h-5 w-5 shrink-0 text-emerald-500" />}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{mission.description}</p>
      <div className="mt-3 space-y-1.5">
        {mission.conditions.map((condition) => (
          <div key={condition.label} className="flex items-center justify-between gap-2 text-xs font-bold text-muted-foreground">
            <span className="min-w-0 truncate">{condition.label}</span>
            <span className="shrink-0 tabular-nums">{Math.min(condition.progress, condition.target).toLocaleString()} / {condition.target.toLocaleString()}</span>
          </div>
        ))}
        <div className="h-2 overflow-hidden rounded-full bg-secondary" aria-label={`진행도 ${progressPercent}%`}>
          <div className={`h-full rounded-full ${mission.status === 'claimed' ? 'bg-primary' : mission.status === 'claimable' ? 'bg-emerald-500' : 'bg-sky-500'}`}
            style={{ width: `${progressPercent}%` }} />
        </div>
      </div>
      <div className="mt-3 flex items-end justify-between gap-2 border-t border-border/60 pt-2.5">
        <div className="min-w-0">
          <p className="text-xs font-black text-muted-foreground">{weeklyStatusLabels[mission.status]}</p>
          <p className="mt-0.5 line-clamp-2 text-xs font-bold text-foreground">{weeklyRewardText(mission)}</p>
        </div>
        {mission.status === 'claimable' && (
          <button type="button" data-testid={`weekly-mission-claim-${mission.id}`} onClick={() => onClaim(mission)} disabled={claiming || expired}
            className="min-h-11 shrink-0 rounded-xl bg-emerald-500 px-3 text-xs font-black text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50">
            {claiming ? '수령 중' : expired ? '갱신 중' : '보상 수령'}
          </button>
        )}
      </div>
    </article>
  );
});

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
  const achievementRequest = useRef<AbortController | null>(null);
  const [achievementRevision, setAchievementRevision] = useState(0);
  const [claimingId, setClaimingId] = useState<number | null>(null);
  const userId = user ? String(user.id) : '';
  const [weeklyState, setWeeklyState] = useState<{ ownerId: string; payload: WeeklyMissionsPayload | null; loading: boolean; error: string }>({
    ownerId: '', payload: null, loading: false, error: ''
  });
  const [claimingWeekly, setClaimingWeekly] = useState<{ ownerId: string; id: number } | null>(null);
  const [weeklyClock, setWeeklyClock] = useState(() => Date.now());
  const weeklyRequest = useRef<{ id: number; controller: AbortController } | null>(null);
  const weeklyRequestId = useRef(0);
  const weeklyClaimRequest = useRef<{ ownerId: string; weekKey: string; missionId: number; controller: AbortController } | null>(null);
  const weeklyServerOffset = useRef(0);
  const refreshedExpiredWeek = useRef('');

  const loadWeeklyMissions = useCallback(async () => {
    if (!userId) return;
    weeklyRequest.current?.controller.abort();
    const controller = new AbortController();
    const requestId = ++weeklyRequestId.current;
    weeklyRequest.current = { id: requestId, controller };
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
    setWeeklyState((previous) => ({
      ownerId: userId,
      payload: previous.ownerId === userId ? previous.payload : null,
      loading: true,
      error: ''
    }));
    try {
      const response = await apiFetch('/achievements/weekly', { signal: controller.signal });
      const raw = await response.json().catch(() => null) as Record<string, unknown> | null;
      if ((!timedOut && controller.signal.aborted) || weeklyRequest.current?.id !== requestId) return;
      const payload = response.ok ? parseWeeklyMissionsPayload(raw) : null;
      if (!response.ok || !payload) {
        setWeeklyState((previous) => ({ ownerId: userId, payload: previous.ownerId === userId ? previous.payload : null, loading: false, error: String(raw?.message || '주간 미션을 불러오지 못했습니다.') }));
        return;
      }
      weeklyServerOffset.current = getWeeklyServerOffset(payload.server_now);
      setWeeklyClock(Date.now() + weeklyServerOffset.current);
      setWeeklyState({ ownerId: userId, payload, loading: false, error: '' });
    } catch (error) {
      if ((!timedOut && controller.signal.aborted) || weeklyRequest.current?.id !== requestId) return;
      setWeeklyState((previous) => ({ ownerId: userId, payload: previous.ownerId === userId ? previous.payload : null, loading: false, error: timedOut ? '주간 미션 응답이 지연되고 있습니다. 다시 시도해 주세요.' : error instanceof Error && /[가-힣]/.test(error.message) ? error.message : '주간 미션 연결이 지연되고 있습니다.' }));
    } finally {
      window.clearTimeout(timeout);
      if (weeklyRequest.current?.id === requestId) weeklyRequest.current = null;
    }
  }, [userId]);

  useEffect(() => {
    weeklyRequest.current?.controller.abort();
    weeklyClaimRequest.current?.controller.abort();
    weeklyRequest.current = null;
    weeklyClaimRequest.current = null;
    refreshedExpiredWeek.current = '';
    if (!userId) {
      return;
    }
    const start = window.setTimeout(() => { void loadWeeklyMissions(); }, 0);
    return () => {
      window.clearTimeout(start);
      weeklyRequest.current?.controller.abort();
      weeklyClaimRequest.current?.controller.abort();
      weeklyRequest.current = null;
      weeklyClaimRequest.current = null;
    };
  }, [userId, loadWeeklyMissions]);

  const weekly = weeklyState.ownerId === userId ? weeklyState.payload : null;
  const weeklyLoading = weeklyState.ownerId === userId && weeklyState.loading;
  const weeklyError = weeklyState.ownerId === userId ? weeklyState.error : '';
  const weeklyExpired = Boolean(weekly && weeklyClock >= Date.parse(weekly.ends_at));

  useEffect(() => {
    if (!weekly) return;
    const updateClock = () => setWeeklyClock(Date.now() + weeklyServerOffset.current);
    const onVisibility = () => { if (document.visibilityState === 'visible') updateClock(); };
    updateClock();
    const timer = window.setInterval(updateClock, 30_000);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [weekly]);

  useEffect(() => {
    if (!weekly || !weeklyExpired || weeklyLoading || refreshedExpiredWeek.current === weekly.week_key) return;
    refreshedExpiredWeek.current = weekly.week_key;
    void loadWeeklyMissions();
  }, [weekly, weeklyExpired, weeklyLoading, loadWeeklyMissions]);

  useEffect(() => {
    if (!weekly || weeklyExpired) return;
    const remaining = Date.parse(weekly.ends_at) - (Date.now() + weeklyServerOffset.current);
    const timer = window.setTimeout(() => {
      if (refreshedExpiredWeek.current === weekly.week_key) return;
      refreshedExpiredWeek.current = weekly.week_key;
      setWeeklyClock(Date.now() + weeklyServerOffset.current);
      void loadWeeklyMissions();
    }, Math.max(0, remaining) + 25);
    return () => window.clearTimeout(timer);
  }, [weekly, weeklyExpired, loadWeeklyMissions]);

  const claimWeeklyMission = useCallback(async (mission: WeeklyMission) => {
    if (!weekly || !userId || mission.status !== 'claimable' || weeklyClaimRequest.current) return;
    if (Date.now() + weeklyServerOffset.current >= Date.parse(weekly.ends_at)) {
      toast('주간 미션이 갱신되고 있습니다. 새 목록을 불러올게요.', 'info');
      await loadWeeklyMissions();
      return;
    }
    weeklyRequest.current?.controller.abort();
    weeklyRequest.current = null;
    weeklyRequestId.current++;
    setWeeklyState((previous) => previous.ownerId === userId ? { ...previous, loading: false } : previous);
    const controller = new AbortController();
    const token = { ownerId: userId, weekKey: weekly.week_key, missionId: mission.id, controller };
    weeklyClaimRequest.current = token;
    setClaimingWeekly({ ownerId: userId, id: mission.id });
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
    try {
      const response = await apiFetch(`/achievements/weekly/${mission.id}/claim`, {
        method: 'POST',
        body: JSON.stringify({ week_key: weekly.week_key }),
        signal: controller.signal
      });
      const raw = await response.json().catch(() => null) as Record<string, unknown> | null;
      if ((!timedOut && controller.signal.aborted) || weeklyClaimRequest.current !== token) return;
      if (!response.ok) {
        const code = String(raw?.code || '');
        if (response.status === 409 && code === 'WEEK_CHANGED') {
          toast('새 주간 미션으로 갱신되었습니다.', 'info');
          await loadWeeklyMissions();
        } else if ((response.status === 409 && code === 'NOT_COMPLETED') || response.status === 404) {
          toast(String(raw?.message || '주간 미션 상태가 변경되었습니다.'), 'info');
          await loadWeeklyMissions();
        } else {
          toast(String(raw?.message || '주간 미션 보상을 수령하지 못했습니다.'), 'error');
        }
        return;
      }
      const payload = parseWeeklyMissionsPayload(raw);
      if (!payload || payload.week_key !== token.weekKey) {
        await loadWeeklyMissions();
        return;
      }
      weeklyServerOffset.current = getWeeklyServerOffset(payload.server_now);
      setWeeklyClock(Date.now() + weeklyServerOffset.current);
      setWeeklyState({ ownerId: token.ownerId, payload, loading: false, error: '' });
      const claimResult = raw?.claim_result as { already_claimed?: boolean } | undefined;
      toast(claimResult?.already_claimed ? '이미 수령한 주간 미션 보상입니다.' : '주간 미션 보상을 수령했습니다.', 'success');
      setAchievementRevision(value => value + 1);
      void refreshUserData();
    } catch (error) {
      if ((timedOut || !controller.signal.aborted) && weeklyClaimRequest.current === token) {
        toast(timedOut ? '보상 수령 응답이 지연되고 있습니다. 다시 눌러 상태를 확인해 주세요.' : error instanceof Error && /[가-힣]/.test(error.message) ? error.message : '주간 미션 보상 수령 연결이 지연되고 있습니다.', 'error');
      }
    } finally {
      window.clearTimeout(timeout);
      if (weeklyClaimRequest.current === token) {
        weeklyClaimRequest.current = null;
        setClaimingWeekly(null);
      }
    }
  }, [weekly, userId, toast, loadWeeklyMissions, refreshUserData]);

  const fetchAchievements = useCallback(async () => {
    if (!userId) return;
    achievementRequest.current?.abort();
    const controller = new AbortController();
    achievementRequest.current = controller;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status !== 'all') params.set('status', status);
      if (category !== 'all') params.set('category', category);
      if (hidden !== 'all') params.set('hidden', String(hidden === 'hidden'));
      params.set('sort', sort);
      const res = await apiFetch(`/achievements?${params.toString()}`, { signal: controller.signal });
      const data = await res.json().catch(() => null) as (UserAchievementsResponse & { message?: string }) | null;
      if (controller.signal.aborted) return;
      if (!res.ok || !data) {
        toast(data?.message || '업적 목록을 불러오지 못했습니다.', 'error');
        return;
      }
      setItems(data.items || []);
      setSummary(data.summary || {});
    } catch {
      if (!controller.signal.aborted) toast('업적 목록을 불러오지 못했습니다.', 'error');
    } finally {
      if (achievementRequest.current === controller) {
        achievementRequest.current = null;
        setLoading(false);
      }
    }
  }, [userId, status, category, hidden, sort, toast]);

  useEffect(() => {
    const start = window.setTimeout(() => { void fetchAchievements(); }, 0);
    return () => {
      window.clearTimeout(start);
      achievementRequest.current?.abort();
      achievementRequest.current = null;
    };
  }, [fetchAchievements, achievementRevision]);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) => {
      const haystack = [item.name, item.description, item.code, item.condition_text, item.hidden_hint, categoryLabels[item.category]].join(' ').toLowerCase();
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
      setAchievementRevision(value => value + 1);
      await refreshUserData();
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
  const weeklyRemaining = weekly ? formatWeeklyRemaining(weekly.ends_at, weeklyClock) : '';
  const weeklyEndLabel = weekly ? `${weeklyEndFormatter.format(new Date(weekly.ends_at))} KST 초기화` : '매주 월요일 00:00 KST 초기화';

  return (
    <section data-tour="achievements-overview" className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary">
              <Trophy className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-xl font-black text-foreground">업적&amp;미션</h2>
              <p className="text-xs text-muted-foreground">업적 {total.toLocaleString()}개 중 {completed.toLocaleString()}개 달성</p>
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

      <section data-testid="weekly-missions" className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/8 via-card to-accent/20 p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
              <CalendarClock className="h-5 w-5" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-black text-foreground">이번 주 미션</h2>
                <span className="rounded-full bg-card/80 px-2 py-0.5 text-[10px] font-black text-primary">쉬움 2 · 보통 2 · 어려움 1</span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">개인별 5개 미션 · 완료 후 보상을 직접 수령하세요.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {weekly && <span className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-black text-foreground">
              완료 {weekly.summary.completed.toLocaleString()} / {weekly.summary.total.toLocaleString()}
            </span>}
            <div className="text-left sm:text-right">
              <p data-testid="weekly-missions-countdown" className={`text-xs font-black ${weeklyExpired ? 'text-amber-500' : 'text-primary'}`}>{weeklyRemaining || (weeklyLoading ? '주간 미션 확인 중' : '주간 미션')}</p>
              <p className="mt-0.5 text-[10px] font-bold text-muted-foreground">{weeklyEndLabel}</p>
            </div>
            <button type="button" aria-label="주간 미션 새로고침" onClick={() => void loadWeeklyMissions()}
              disabled={weeklyLoading || Boolean(claimingWeekly)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${weeklyLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {weeklyError && (
          <div data-testid="weekly-missions-error" role="alert" className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs sm:flex-row sm:items-center sm:justify-between">
            <p className="font-bold text-foreground">{weeklyError}</p>
            <button type="button" data-testid="weekly-missions-retry" onClick={() => void loadWeeklyMissions()} disabled={weeklyLoading}
              className="min-h-11 shrink-0 rounded-xl bg-primary px-4 text-xs font-black text-primary-foreground disabled:opacity-50">
              {weeklyLoading ? '다시 불러오는 중' : '다시 시도'}
            </button>
          </div>
        )}

        {weeklyLoading && !weekly && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5" role="status" aria-label="주간 미션을 불러오는 중">
            {Array.from({ length: 5 }, (_, index) => <div key={index} className="h-44 animate-pulse rounded-2xl border border-border bg-card/70" />)}
          </div>
        )}
        {weekly && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {weekly.missions.map((mission) => (
              <WeeklyMissionCard key={mission.id} mission={mission} claiming={claimingWeekly?.ownerId === userId && claimingWeekly.id === mission.id}
                expired={weeklyExpired || weeklyLoading} onClaim={claimWeeklyMission} />
            ))}
          </div>
        )}
      </section>

      <div data-tour="achievements-filters" className="rounded-2xl border border-border bg-card p-4 shadow-sm">
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

      <div data-tour="achievements-list" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
                    {masked ? item.hidden_hint || '달성 조건 비공개' : `달성 조건: ${item.condition_text || '조건 없음'}`}
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between text-[10px] font-black text-muted-foreground">
                  <span>{statusLabels[item.status] || item.status}</span>
                  <span>{masked ? '???' : `${(item.progress_current ?? 0).toLocaleString()} / ${(item.progress_target ?? 1).toLocaleString()}`}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  <div className={`h-full rounded-full ${item.status === 'claimed' ? 'bg-primary' : claimable ? 'bg-emerald-500' : 'bg-sky-500'}`} style={{ width: `${Math.max(0, Math.min(100, item.progress_percent ?? 0))}%` }} />
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

