'use client';

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Eye,
  FileClock,
  RefreshCw,
  Share2,
  ShieldCheck,
  Sparkles,
  Swords,
  Target,
  Trophy
} from 'lucide-react';
import { ArenaLayout } from '../../../ArenaLayout';
import type { ArenaSiteTab } from '../../../ArenaTab';
import { useApp } from '../../../AppContext';
import { apiFetch } from '@/lib/api';
import type {
  ArenaDeckSnapshotDto,
  ArenaMatchViewDto,
  ArenaReplayPayloadDto,
  ArenaRoundPlanDto,
  ArenaRulesCatalogDto,
  ArenaSnapshotCardDto
} from '@chikapo/arena-contract';

type RoundWaitState = {
  roundNo: number;
  deadlineAt: string;
};

type RoundRevealState = {
  roundNo: number;
  stage: 'battle' | 'result';
  winner: 'player' | 'bot' | 'draw';
  completed: boolean;
  result: ArenaMatchViewDto['result'];
};

const ARENA_ROUND_SELECTION_TIMEOUT_MS = 60_000;

const arenaTabHref: Record<ArenaSiteTab, string> = {
  play: '/arena/play',
  inventory: '/arena/inventory',
  ranking: '/arena/ranking',
  style: '/arena/style',
  admin: '/arena/admin'
};

const tacticOptions = [
  ['balanced', '균형'],
  ['aggressive', '공격'],
  ['guard', '수비'],
  ['tempo', '템포'],
  ['counter', '역습'],
  ['finisher', '마무리']
] as const;

const focusOptions = [
  ['frontline_first', '전열 우선'],
  ['backline_first', '후열 우선'],
  ['lowest_hp', '약한 적'],
  ['highest_attack', '고화력']
] as const;

const resultLabel = (result?: ArenaMatchViewDto['result']) => (
  result === 'win' ? '승리' : result === 'loss' ? '패배' : result === 'draw' ? '무승부' : '진행 중'
);

const normalizeArenaProgressStatus = (status?: unknown) => String(status || '').trim().toLowerCase();
const isArenaMatchCompleted = (match?: Pick<ArenaMatchViewDto, 'summary' | 'round_count' | 'player_a_round_wins' | 'player_b_round_wins'> | null) => {
  const status = normalizeArenaProgressStatus(match?.summary?.progress_status);
  if (status === 'completed') return true;
  if (status === 'in_progress') return false;
  return Number(match?.player_a_round_wins || 0) >= 3 || Number(match?.player_b_round_wins || 0) >= 3 || Number(match?.round_count || 0) >= 5;
};

const winnerLabel = (winner?: string) => (
  winner === 'player' ? '내 라운드 승리' : winner === 'bot' ? '상대 라운드 승리' : '라운드 무승부'
);

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
};

const getRoundPlan = (deck: ArenaDeckSnapshotDto | undefined, roundNo: number): ArenaRoundPlanDto | undefined =>
  deck?.round_plans?.find((plan) => plan.round_no === roundNo) || deck?.round_plans?.[0];

const getRoundCards = (deck: ArenaDeckSnapshotDto | undefined, roundNo: number): ArenaSnapshotCardDto[] => {
  if (!deck?.cards?.length) return [];
  const plan = getRoundPlan(deck, roundNo);
  if (!plan?.slots?.length) return deck.cards.slice(0, 6);
  const byId = new Map(deck.cards.map((card) => [card.card_id, card]));
  const planned = plan.slots
    .map((slot) => byId.get(slot.card_id))
    .filter((card): card is ArenaSnapshotCardDto => Boolean(card));
  return planned.length > 0 ? planned : deck.cards.slice(0, 6);
};

const getOpponentDeck = (match: ArenaMatchViewDto | null): ArenaDeckSnapshotDto | undefined =>
  match?.summary?.opponent_deck || match?.summary?.bot_deck;

const getNextRoundNo = (match: ArenaMatchViewDto | null) =>
  match?.summary?.current_round_no || Math.min(5, (match?.round_count || 0) + 1);

const MatchCard: React.FC<{ card: ArenaSnapshotCardDto; side: 'player' | 'opponent' }> = ({ card, side }) => (
  <article className={`arena-status-row min-w-0 overflow-hidden rounded-3xl border p-3 shadow-sm ${
    side === 'player'
      ? 'border-rose-200/80 bg-gradient-to-br from-white/90 to-rose-50/80 dark:border-rose-300/20 dark:from-white/10 dark:to-rose-300/10'
      : 'border-pink-200/80 bg-gradient-to-br from-white/88 to-pink-50/80 dark:border-pink-300/20 dark:from-white/10 dark:to-pink-300/10'
  }`}>
    <div className="flex items-center gap-3">
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-2xl bg-white/80 shadow-sm dark:bg-white/10">
        {card.image_url ? <img src={card.image_url} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-black text-foreground">{card.name}</p>
        <p className="mt-0.5 truncate text-[10px] font-bold text-muted-foreground">{card.class_name}</p>
        {card.skills?.[0] ? (
          <p className="mt-1 truncate text-[10px] font-black text-primary">{card.skills[0].name}</p>
        ) : null}
      </div>
    </div>
    {card.stats ? (
      <div className="mt-3 grid grid-cols-5 gap-1 text-center">
        {[
          ['HP', card.stats.hp],
          ['ATK', card.stats.attack],
          ['DEF', card.stats.defense],
          ['SPD', card.stats.speed],
          ['FOC', card.stats.focus]
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-white/64 px-1 py-1.5 dark:bg-white/10">
            <p className="text-[8px] font-black text-muted-foreground">{label}</p>
            <p className="text-[10px] font-black text-foreground">{value}</p>
          </div>
        ))}
      </div>
    ) : null}
  </article>
);

const StateNotice: React.FC<{
  title: string;
  description: string;
  variant?: 'default' | 'error';
  actionLabel?: string;
  onAction?: () => void;
  loading?: boolean;
}> = ({ title, description, variant = 'default', actionLabel, onAction, loading }) => (
  <div className={`arena-status-row rounded-[2rem] border p-5 ${
    variant === 'error'
      ? 'border-red-200 bg-red-50/80 dark:border-red-300/20 dark:bg-red-300/10'
      : 'border-border bg-card/70'
  }`}>
    <div className="flex items-start gap-3">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
        variant === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-300/10 dark:text-red-100' : 'bg-primary/10 text-primary'
      }`}>
        {variant === 'error' ? <AlertCircle className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-black text-foreground">{title}</p>
        <p className="mt-1 text-xs font-bold leading-relaxed text-muted-foreground">{description}</p>
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            disabled={loading}
            className="cute-wiggle-hover mt-3 inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-xs font-black text-primary-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  </div>
);

const SkeletonRows = () => (
  <div className="grid gap-3">
    {[0, 1, 2].map((item) => (
      <div key={item} className="h-24 animate-pulse rounded-[2rem] border border-border bg-secondary/45" />
    ))}
  </div>
);

export default function ArenaMatchPage() {
  const params = useParams<{ match_id?: string | string[] }>();
  const router = useRouter();
  const { user, toast } = useApp();
  const matchId = Array.isArray(params.match_id) ? params.match_id[0] : params.match_id;

  const [match, setMatch] = React.useState<ArenaMatchViewDto | null>(null);
  const [replay, setReplay] = React.useState<ArenaReplayPayloadDto | null>(null);
  const [rules, setRules] = React.useState<ArenaRulesCatalogDto | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [roundLoading, setRoundLoading] = React.useState(false);
  const [roundWait, setRoundWait] = React.useState<RoundWaitState | null>(null);
  const [roundWaitNow, setRoundWaitNow] = React.useState(() => Date.now());
  const [roundReveal, setRoundReveal] = React.useState<RoundRevealState | null>(null);
  const [tacticStyle, setTacticStyle] = React.useState('balanced');
  const [focusRule, setFocusRule] = React.useState('frontline_first');
  const [strategyChipId, setStrategyChipId] = React.useState('none');
  const [shareLoading, setShareLoading] = React.useState(false);
  const revealTimerRef = React.useRef<number | null>(null);

  const moveArenaTab = React.useCallback((tab: ArenaSiteTab) => {
    router.push(arenaTabHref[tab] || '/arena/play');
  }, [router]);

  const applyMatchDefaults = React.useCallback((nextMatch: ArenaMatchViewDto | null) => {
    if (!nextMatch) return;
    const nextRoundNo = getNextRoundNo(nextMatch);
    const nextPlan = getRoundPlan(nextMatch.summary?.player_deck, nextRoundNo);
    setTacticStyle(nextPlan?.tactic_style || 'balanced');
    setFocusRule(nextPlan?.focus_rule || 'frontline_first');
    setStrategyChipId(nextMatch.summary?.player_deck?.strategy_chip_id || 'none');
    const pending = nextMatch.summary?.pending_round_input;
    setRoundWait(pending?.deadline_at ? { roundNo: pending.round_no, deadlineAt: pending.deadline_at } : null);
  }, []);

  const loadMatch = React.useCallback(async () => {
    if (!matchId) return;
    setLoading(true);
    setError(null);
    try {
      const [matchRes, rulesRes] = await Promise.all([
        apiFetch(`/arena/matches/${encodeURIComponent(matchId)}`),
        apiFetch('/arena/rules/catalog')
      ]);
      const matchData = await matchRes.json().catch(() => ({}));
      if (!matchRes.ok) throw new Error(matchData.message || '아레나 매치를 불러오지 못했습니다.');
      const nextMatch = (matchData.data?.match || matchData.data) as ArenaMatchViewDto | null;
      setMatch(nextMatch);
      applyMatchDefaults(nextMatch);

      const rulesData = await rulesRes.json().catch(() => ({}));
      if (rulesRes.ok) setRules(rulesData.data || null);

      if (nextMatch && isArenaMatchCompleted(nextMatch)) {
        const replayRes = await apiFetch(`/arena/matches/${encodeURIComponent(nextMatch.id)}/replay`);
        const replayData = await replayRes.json().catch(() => ({}));
        if (replayRes.ok) setReplay(replayData.data || null);
      } else {
        setReplay({ match_id: nextMatch?.id || matchId, match_format: 'best_of_five', rounds_to_win: 3, replay_storage: 'tick_events', rounds: [] });
      }
    } catch (err: any) {
      setError(err?.message || '아레나 매치를 불러오지 못했습니다.');
      setMatch(null);
    } finally {
      setLoading(false);
    }
  }, [applyMatchDefaults, matchId]);

  React.useEffect(() => {
    loadMatch();
    return () => {
      if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
    };
  }, [loadMatch]);

  React.useEffect(() => {
    if (!roundWait) return;
    setRoundWaitNow(Date.now());
    const timer = window.setInterval(() => setRoundWaitNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [roundWait?.deadlineAt, roundWait?.roundNo]);

  const nextRoundNo = getNextRoundNo(match);
  const completed = isArenaMatchCompleted(match);
  const playerDeck = match?.summary?.player_deck;
  const opponentDeck = getOpponentDeck(match);
  const playerCards = getRoundCards(playerDeck, nextRoundNo);
  const opponentCards = getRoundCards(opponentDeck, nextRoundNo);
  const roundResults = match?.summary?.round_results || [];
  const selectedReplayRound = replay?.rounds?.[replay.rounds.length - 1];
  const visibleEvents = (selectedReplayRound?.events || []).slice(-18).reverse();
  const waitMs = roundWait ? Math.max(0, new Date(roundWait.deadlineAt).getTime() - roundWaitNow) : 0;
  const waitSec = Math.ceil(waitMs / 1000);
  const canForceRound = Boolean(roundWait && waitMs <= 0);
  const battlefield = match?.summary?.battlefield_rule;
  const tacticChips = rules?.tactic_chips || [];
  const scoreLabel = `${match?.player_a_round_wins || 0}:${match?.player_b_round_wins || 0}`;

  const commitRound = async (forceAutoCommit = false) => {
    if (!match?.id || roundLoading || completed) return;
    setRoundLoading(true);
    setRoundReveal(null);
    if (revealTimerRef.current !== null) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    try {
      const res = await apiFetch(`/arena/matches/${encodeURIComponent(match.id)}/rounds/commit`, {
        method: 'POST',
        body: JSON.stringify({
          round_no: nextRoundNo,
          tactic_style: tacticStyle,
          focus_rule: focusRule,
          strategy_chip_id: strategyChipId,
          auto_commit: forceAutoCommit || canForceRound
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || '라운드 확정에 실패했습니다.');
      const nextMatch = (data.data?.match || null) as ArenaMatchViewDto | null;
      const nextReplay = (data.data?.replay || null) as ArenaReplayPayloadDto | null;
      if (nextMatch) setMatch(nextMatch);
      if (nextReplay) setReplay(nextReplay);

      if (data.data?.round_status?.status === 'waiting') {
        const deadlineAt = data.data.round_status.deadline_at || nextMatch?.summary?.pending_round_input?.deadline_at;
        if (deadlineAt) {
          setRoundWait({ roundNo: nextRoundNo, deadlineAt });
          setRoundWaitNow(Date.now());
          toast('상대의 라운드 선택을 기다립니다.', 'success');
        }
        return;
      }

      setRoundWait(null);
      const latestRound = [...(nextMatch?.summary?.round_results || [])].sort((a, b) => Number(b.round_no || 0) - Number(a.round_no || 0))[0];
      const reveal: RoundRevealState = {
        roundNo: nextRoundNo,
        stage: 'battle',
        winner: latestRound?.winner_side || 'draw',
        completed: isArenaMatchCompleted(nextMatch),
        result: isArenaMatchCompleted(nextMatch) ? (nextMatch?.result || 'draw') : null
      };
      setRoundReveal(reveal);
      applyMatchDefaults(nextMatch);
      revealTimerRef.current = window.setTimeout(() => {
        setRoundReveal({ ...reveal, stage: 'result' });
        toast(reveal.completed ? `세트 ${resultLabel(reveal.result)}로 경기가 종료되었습니다.` : `${reveal.roundNo}라운드가 종료되었습니다.`, 'success');
        revealTimerRef.current = null;
      }, 2200);
    } catch (err: any) {
      toast(err?.message || '라운드 확정에 실패했습니다.', 'error');
    } finally {
      setRoundLoading(false);
    }
  };

  const createShareLink = async () => {
    if (!match?.id || shareLoading) return;
    setShareLoading(true);
    try {
      const res = await apiFetch(`/arena/matches/${encodeURIComponent(match.id)}/share`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || '관전 공유 링크 생성에 실패했습니다.');
      const token = data.data?.token;
      const url = token ? `${window.location.origin}/arena?share=${encodeURIComponent(token)}` : '';
      if (url && navigator.clipboard) await navigator.clipboard.writeText(url);
      toast(url ? '관전 링크를 복사했습니다.' : '관전 링크를 생성했습니다.', 'success');
    } catch (err: any) {
      toast(err?.message || '관전 공유 링크 생성에 실패했습니다.', 'error');
    } finally {
      setShareLoading(false);
    }
  };

  return (
    <ArenaLayout activeTab="play" onTabChange={moveArenaTab}>
      <div className="space-y-5">
        <section className="arena-panel-soft cute-surface overflow-hidden rounded-[2.25rem] p-5 md:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <span className="cute-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-black">
                <Swords className="h-3.5 w-3.5" />
                아레나 게임
              </span>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-foreground md:text-5xl">
                {loading ? '매치를 불러오는 중' : completed ? `세트 ${resultLabel(match?.result)}` : `${nextRoundNo}라운드 전술 준비`}
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-bold leading-relaxed text-muted-foreground">
                {match?.id ? `매치 ID ${match.id} · ${match.match_type === 'RANKED' ? '빠른대전' : '봇 연습전'} · ${formatDateTime(match.created_at)}` : '라운드마다 선택을 바꾸고 전투 결과를 확인합니다.'}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-[2rem] border border-white/70 bg-white/70 p-2 shadow-sm dark:border-white/10 dark:bg-white/10">
              <div className="rounded-2xl bg-secondary/60 px-4 py-3 text-center">
                <p className="text-[10px] font-black text-muted-foreground">스코어</p>
                <p className="mt-1 text-xl font-black text-foreground">{scoreLabel}</p>
              </div>
              <div className="rounded-2xl bg-secondary/60 px-4 py-3 text-center">
                <p className="text-[10px] font-black text-muted-foreground">목표</p>
                <p className="mt-1 text-xl font-black text-foreground">3승</p>
              </div>
              <div className="rounded-2xl bg-secondary/60 px-4 py-3 text-center">
                <p className="text-[10px] font-black text-muted-foreground">상태</p>
                <p className="mt-1 text-sm font-black text-primary">{completed ? '완료' : roundWait ? '대기' : '준비'}</p>
              </div>
            </div>
          </div>
        </section>

        {loading ? (
          <SkeletonRows />
        ) : error ? (
          <StateNotice
            variant="error"
            title="게임 페이지를 열 수 없습니다"
            description={error}
            actionLabel="다시 불러오기"
            onAction={loadMatch}
            loading={loading}
          />
        ) : !match ? (
          <StateNotice title="매치가 없습니다" description="이미 종료되었거나 접근 권한이 없는 매치일 수 있습니다." actionLabel="플레이로 이동" onAction={() => router.push('/arena/play')} />
        ) : (
          <>
            <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="arena-panel-soft cute-surface rounded-[2rem] p-4 md:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black text-primary">전장</p>
                    <h2 className="mt-1 text-xl font-black text-foreground">{battlefield?.name || '기본 전장'}</h2>
                    <p className="mt-1 text-xs font-bold text-muted-foreground">{battlefield?.description || '이번 라운드의 전장 규칙이 적용됩니다.'}</p>
                  </div>
                  {completed ? (
                    <button
                      type="button"
                      onClick={createShareLink}
                      disabled={shareLoading}
                      className="cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-xs font-black text-primary-foreground disabled:opacity-50"
                    >
                      <Share2 className="h-4 w-4" />
                      {shareLoading ? '생성 중' : '관전 링크 복사'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={loadMatch}
                      disabled={loading || roundLoading}
                      className="cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl border border-border bg-secondary/70 px-4 py-2.5 text-xs font-black text-foreground disabled:opacity-50"
                    >
                      <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                      동기화
                    </button>
                  )}
                </div>

                {roundReveal ? (
                  <div className={`arena-round-reveal mt-4 rounded-[2rem] border p-5 ${
                    roundReveal.stage === 'battle'
                      ? 'is-battle border-rose-200 bg-rose-50/80 dark:border-rose-300/20 dark:bg-rose-300/10'
                      : 'is-result border-primary/20 bg-primary/10'
                  }`}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-black text-muted-foreground">R{roundReveal.roundNo}</p>
                        <p className="mt-1 text-2xl font-black text-foreground">
                          {roundReveal.stage === 'battle'
                            ? '전투가 펼쳐지는 중'
                            : roundReveal.completed
                              ? `세트 ${resultLabel(roundReveal.result)}`
                              : winnerLabel(roundReveal.winner)}
                        </p>
                      </div>
                      <div className="arena-round-orb flex h-14 w-14 items-center justify-center rounded-3xl bg-white/80 text-primary shadow-sm dark:bg-white/10">
                        <Swords className="h-6 w-6" />
                      </div>
                    </div>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/70 dark:bg-white/10">
                      <div className={`h-full rounded-full ${roundReveal.stage === 'battle' ? 'arena-battle-progress bg-rose-500' : 'bg-primary'}`} />
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="text-sm font-black text-foreground">내 출전 카드</h3>
                      <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-black text-primary">{playerCards.length}장</span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {playerCards.map((card) => <MatchCard key={card.card_id} card={card} side="player" />)}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="text-sm font-black text-foreground">상대 출전 카드</h3>
                      <span className="rounded-full bg-secondary/70 px-2.5 py-1 text-[10px] font-black text-muted-foreground">{opponentCards.length}장</span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {opponentCards.map((card) => <MatchCard key={card.card_id} card={card} side="opponent" />)}
                    </div>
                  </div>
                </div>
              </div>

              <aside className="space-y-4">
                <div className="arena-panel-soft cute-surface rounded-[2rem] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black text-primary">라운드 선택</p>
                      <h2 className="mt-1 text-lg font-black text-foreground">{completed ? '경기 종료' : `R${nextRoundNo} 준비`}</h2>
                    </div>
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      {completed ? <Trophy className="h-5 w-5" /> : <Target className="h-5 w-5" />}
                    </div>
                  </div>

                  {roundWait ? (
                    <div className="mt-4 rounded-3xl border border-red-200 bg-red-50/80 p-4 dark:border-red-300/20 dark:bg-red-300/10">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-black text-red-700 dark:text-red-100">상대 선택 대기</p>
                          <p className="mt-1 text-xl font-black text-foreground">{canForceRound ? '선택 시간 종료' : `${waitSec}초 남음`}</p>
                        </div>
                        <Clock3 className="h-6 w-6 text-red-600 dark:text-red-100" />
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70 dark:bg-white/10">
                        <div
                          className="h-full rounded-full bg-red-400 transition-all duration-500"
                          style={{ width: `${canForceRound ? 100 : Math.max(8, Math.min(100, 100 - (waitMs / ARENA_ROUND_SELECTION_TIMEOUT_MS) * 100))}%` }}
                        />
                      </div>
                    </div>
                  ) : null}

                  {!completed ? (
                    <div className="mt-4 space-y-3">
                      <div className="grid grid-cols-3 gap-1.5">
                        {tacticOptions.map(([id, label]) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setTacticStyle(id)}
                            className={`rounded-2xl px-2 py-2.5 text-[11px] font-black transition ${tacticStyle === id ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-white/70 text-muted-foreground hover:bg-primary/10 hover:text-primary dark:bg-white/10'}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {focusOptions.map(([id, label]) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setFocusRule(id)}
                            className={`rounded-2xl px-2 py-2.5 text-[11px] font-black transition ${focusRule === id ? 'bg-rose-500 text-white shadow-sm' : 'bg-white/70 text-muted-foreground hover:bg-rose-100 hover:text-rose-700 dark:bg-white/10 dark:hover:bg-rose-300/15 dark:hover:text-rose-100'}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {tacticChips.length > 0 ? (
                        <select
                          value={strategyChipId}
                          onChange={(event) => setStrategyChipId(event.target.value)}
                          className="h-11 w-full rounded-2xl border border-border bg-white/80 px-3 text-xs font-black text-foreground outline-none focus:border-primary dark:bg-card/80"
                        >
                          {tacticChips.map((chip) => (
                            <option key={chip.id} value={chip.id}>{chip.name}</option>
                          ))}
                        </select>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => commitRound()}
                        disabled={roundLoading || Boolean(roundWait && !canForceRound) || roundReveal?.stage === 'battle'}
                        className="arena-primary-cta cute-wiggle-hover flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-black text-primary-foreground shadow-lg shadow-primary/20 disabled:opacity-50"
                      >
                        <Swords className="h-4 w-4" />
                        {roundLoading || roundReveal?.stage === 'battle'
                          ? '전투 중'
                          : roundWait
                            ? canForceRound ? '기본 플랜으로 진행' : '상대 선택 대기'
                            : '라운드 시작'}
                      </button>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-3xl border border-primary/20 bg-primary/10 p-4">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-5 w-5 text-primary" />
                        <p className="text-sm font-black text-foreground">경기가 종료되었습니다</p>
                      </div>
                      <p className="mt-2 text-xs font-bold leading-relaxed text-muted-foreground">
                        아래 라운드 기록에서 결과 흐름을 확인하거나 관전 링크를 공유할 수 있습니다.
                      </p>
                    </div>
                  )}
                </div>

                <div className="arena-panel-soft cute-surface rounded-[2rem] p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <FileClock className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-black text-foreground">라운드 기록</h2>
                  </div>
                  {roundResults.length === 0 ? (
                    <p className="text-xs font-bold leading-relaxed text-muted-foreground">아직 완료된 라운드가 없습니다.</p>
                  ) : (
                    <div className="space-y-2">
                      {roundResults.map((round) => (
                        <div key={round.round_no} className="flex items-center justify-between gap-2 rounded-2xl bg-secondary/55 px-3 py-2">
                          <span className="text-xs font-black text-foreground">R{round.round_no}</span>
                          <span className="text-[10px] font-black text-primary">{winnerLabel(round.winner_side)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </aside>
            </section>

            <section className="arena-panel-soft cute-surface rounded-[2rem] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Eye className="h-5 w-5 text-primary" />
                  <h2 className="text-base font-black text-foreground">전투 로그</h2>
                </div>
                <span className="rounded-full bg-secondary/70 px-3 py-1 text-[10px] font-black text-muted-foreground">
                  {replay?.rounds?.length || 0}라운드 저장
                </span>
              </div>
              {visibleEvents.length === 0 ? (
                <StateNotice title="아직 재생할 전투 로그가 없습니다" description="라운드를 시작하면 공격, 스킬, 피해 흐름이 이곳에 쌓입니다." />
              ) : (
                <div className="mt-4 grid gap-2">
                  {visibleEvents.map((event, index) => (
                    <div key={`${event.t}-${event.type}-${index}`} className="arena-status-row flex items-center justify-between gap-3 rounded-2xl border border-border bg-card/70 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-black text-foreground">{event.message || event.type}</p>
                        <p className="mt-0.5 text-[10px] font-bold text-muted-foreground">{event.actor || '시스템'} · {Math.round(event.t / 100) / 10}s</p>
                      </div>
                      {typeof event.value === 'number' ? (
                        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-black text-primary">{event.value}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </ArenaLayout>
  );
}
