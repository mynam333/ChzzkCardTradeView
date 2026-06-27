'use client';

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, FastForward, FileClock, Pause, Play, RefreshCw, RotateCcw, SkipBack, SkipForward, Trophy } from 'lucide-react';
import { ArenaLayout } from '../../ArenaLayout';
import type { ArenaSiteTab } from '../../ArenaTab';
import { apiFetch } from '@/lib/api';
import type {
  ArenaDeckSnapshotDto,
  ArenaMatchViewDto,
  ArenaReplayPayloadDto,
  ArenaRoundResultDto,
  ArenaRulesCatalogDto
} from '@chikapo/arena-contract';
import {
  ArenaBattleStage,
  ARENA_BATTLE_TURN_MS,
  buildArenaBattleTurns,
  formatDateTime,
  getRoundCards,
  getRoundSlots,
  resultLabel,
  summarizeArenaBattleTurn,
  type ArenaBattleTurnSummaryItem,
  type RoundRevealState
} from '../matches/ArenaMatchPageClient';
import type { ArenaBattleTurn } from '@/lib/arenaBattleTimeline';

type ArenaSpectatorPayload = {
  match: {
    match_id: string;
    match_type: 'RANKED' | 'BOT_PRACTICE';
    match_format?: string;
    rounds_to_win?: number;
    round_count: number;
    player_a_round_wins: number;
    player_b_round_wins: number;
    draw_rounds: number;
    created_at: string;
    player_deck: ArenaDeckSnapshotDto;
    opponent_deck: ArenaDeckSnapshotDto;
    round_results?: ArenaRoundResultDto[];
  };
  replay: ArenaReplayPayloadDto;
};

const arenaTabHref: Record<ArenaSiteTab, string> = {
  play: '/arena/play',
  inventory: '/arena/inventory',
  ranking: '/arena/ranking',
  style: '/arena/style',
  admin: '/arena/admin'
};

const getTokenFromInput = (value: string) => {
  const raw = value.trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'https://arena.local');
    return url.searchParams.get('share') || url.pathname.split('/').filter(Boolean).pop() || raw;
  } catch {
    return raw.includes('share=')
      ? new URLSearchParams(raw.split('?')[1] || raw).get('share') || raw
      : raw;
  }
};

const SPECTATE_SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2];

const spectateSummaryToneClass: Record<ArenaBattleTurnSummaryItem['key'], string> = {
  damage: 'bg-rose-500/10 text-rose-700 dark:text-rose-100',
  heal: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-100',
  shield: 'bg-sky-500/10 text-sky-700 dark:text-sky-100',
  control: 'bg-violet-500/10 text-violet-700 dark:text-violet-100',
  retire: 'bg-slate-500/10 text-slate-700 dark:text-slate-100',
  effect: 'bg-primary/10 text-primary'
};

const getSpectateErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  if (!message || message === 'Failed to fetch' || message.includes('NetworkError')) {
    return '관전 리플레이 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }
  return message;
};

const readSpectateSpeed = () => {
  if (typeof window === 'undefined') return 1;
  const value = Number(window.localStorage.getItem('arena:replay-speed') || '1');
  return SPECTATE_SPEED_OPTIONS.includes(value) ? value : 1;
};

const spectateWinnerLabel = (winner?: string) => (
  winner === 'player' ? '플레이어 승리' : winner === 'bot' ? '상대 승리' : '무승부'
);

const normalizeSpectateToken = (value?: string | null) => String(value || '').trim().toLowerCase();

const buildSpectatorNameResolver = (decks: Array<ArenaDeckSnapshotDto | undefined>) => {
  const entries = decks.flatMap((deck) => (deck?.cards || []).flatMap((card) => [
    [normalizeSpectateToken(card.card_id), card.name] as const,
    [normalizeSpectateToken(card.channel_id), card.name] as const,
    [normalizeSpectateToken(card.name), card.name] as const
  ]));
  const lookup = new Map(entries.filter(([key]) => Boolean(key)));
  return (value?: string) => {
    const normalized = normalizeSpectateToken(value);
    if (!normalized) return '';
    return lookup.get(normalized) || value || '';
  };
};

const getSpectatorTurnLabel = (turn?: ArenaBattleTurn) => {
  if (!turn) return '전투 대기';
  if (turn.actionType === 'start') return '라운드 시작';
  if (turn.actionType === 'skill') return turn.skillName || '스킬 사용';
  if (turn.actionType === 'heal') return '회복';
  if (turn.actionType === 'guard') return '보호';
  if (turn.actionType === 'control') return '제어 효과';
  if (turn.actionType === 'retire') return '전투불능';
  if (turn.actionType === 'attack') return '기본 공격';
  return '전투 효과';
};

const getSpectatorTurnCaption = (turn: ArenaBattleTurn | undefined, resolveName: (value?: string) => string) => {
  if (!turn) return '라운드를 재생하면 주요 행동이 이곳에 표시됩니다.';
  if (turn.actionType === 'start') return turn.primary.message || '라운드가 시작되었습니다.';
  const actor = resolveName(turn.actor) || turn.actor || '전투 카드';
  const targets = turn.targetIds.map(resolveName).filter(Boolean).slice(0, 2).join(', ');
  const value = Math.max(0, Number(turn.value || 0));
  return `${actor} -> ${targets || '대상'}${value > 0 ? ` · ${value.toLocaleString()} 효과` : ''}`;
};

export const ArenaSpectatePageClient: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialShare = searchParams.get('share') || '';
  const [shareToken, setShareToken] = React.useState(initialShare);
  const [payload, setPayload] = React.useState<ArenaSpectatorPayload | null>(null);
  const [rules, setRules] = React.useState<ArenaRulesCatalogDto | null>(null);
  const [loading, setLoading] = React.useState(Boolean(initialShare));
  const [error, setError] = React.useState<string | null>(null);
  const [selectedRoundNo, setSelectedRoundNo] = React.useState(1);
  const [eventIndex, setEventIndex] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [playbackSpeed, setPlaybackSpeed] = React.useState(1);
  const initialLoadRef = React.useRef(false);

  const moveArenaTab = React.useCallback((tab: ArenaSiteTab) => {
    router.push(arenaTabHref[tab] || '/arena/play');
  }, [router]);

  const loadSpectatorReplay = React.useCallback(async (tokenValue = shareToken) => {
    const token = getTokenFromInput(tokenValue);
    if (!token) {
      setError('관전 토큰이 없습니다.');
      setPayload(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [spectatorRes, rulesRes] = await Promise.all([
        apiFetch(`/arena/spectator/share/${encodeURIComponent(token)}`),
        apiFetch('/arena/rules/catalog')
      ]);
      const spectatorData = await spectatorRes.json().catch(() => ({}));
      if (!spectatorRes.ok) throw new Error(spectatorData.message || '관전 리플레이를 불러오지 못했습니다.');
      const nextPayload = (spectatorData.data || spectatorData) as ArenaSpectatorPayload;
      setPayload(nextPayload);
      setSelectedRoundNo(nextPayload.replay.rounds[0]?.round_no || 1);
      setEventIndex(0);
      setPlaying(false);
      const rulesData = await rulesRes.json().catch(() => ({}));
      if (rulesRes.ok) setRules(rulesData.data || null);
      if (token !== shareToken) setShareToken(token);
    } catch (err: any) {
      setError(getSpectateErrorMessage(err));
      setPayload(null);
      setPlaying(false);
    } finally {
      setLoading(false);
    }
  }, [shareToken]);

  const rounds = React.useMemo(
    () => (payload?.replay.rounds || []).slice().sort((a, b) => Number(a.round_no || 0) - Number(b.round_no || 0)),
    [payload?.replay.rounds]
  );
  const selectedRound = rounds.find((round) => round.round_no === selectedRoundNo) || rounds[0];
  const events = selectedRound?.events || [];
  const battleTurns = React.useMemo(() => buildArenaBattleTurns(events), [events]);
  const activeTurn = battleTurns.length > 0 ? battleTurns[Math.min(eventIndex, battleTurns.length - 1)] : undefined;
  const activeEvent = activeTurn?.primary;
  const activeTurnSummary = React.useMemo(() => summarizeArenaBattleTurn(activeTurn), [activeTurn]);
  const roundFinished = battleTurns.length === 0 || eventIndex >= battleTurns.length - 1;
  const replayProgressPercent = battleTurns.length > 0 ? Math.round(((Math.min(eventIndex, battleTurns.length - 1) + 1) / battleTurns.length) * 100) : 0;
  const selectedReplayOmittedCount = Number(selectedRound?.timeline_summary?.omitted_event_count || 0);
  const selectedReplayOriginalCount = Number(selectedRound?.original_event_count || selectedRound?.events?.length || 0);
  const selectedReplayTruncated = Boolean(selectedRound?.replay_truncated || selectedReplayOmittedCount > 0);
  const roundResult = payload?.match.round_results?.find((round) => Number(round.round_no) === Number(selectedRound?.round_no));
  const resolveSpectatorName = React.useMemo(
    () => buildSpectatorNameResolver([payload?.match.player_deck, payload?.match.opponent_deck]),
    [payload?.match.opponent_deck, payload?.match.player_deck]
  );
  const visibleEvents = React.useMemo(() => (events || []).slice(-18).reverse(), [events]);
  const selectedRoundResults = React.useMemo(
    () => (payload?.match.round_results || [])
      .filter((round) => Number(round.round_no) <= Number(selectedRound?.round_no || 0))
      .sort((a, b) => Number(a.round_no || 0) - Number(b.round_no || 0)),
    [payload?.match.round_results, selectedRound?.round_no]
  );
  const visibleScore = selectedRoundResults.reduce((score, round) => {
    if (round.winner_side === 'player') return { ...score, player: score.player + 1 };
    if (round.winner_side === 'bot') return { ...score, opponent: score.opponent + 1 };
    return score;
  }, { player: 0, opponent: 0 });
  const scoreLabel = payload ? `${visibleScore.player}:${visibleScore.opponent}` : '-';
  const currentTurnLabel = battleTurns.length > 0 ? `${Math.min(eventIndex + 1, battleTurns.length)}/${battleTurns.length}` : '-';
  const currentActionLabel = playing && activeTurn
    ? `재생 중 · ${getSpectatorTurnLabel(activeTurn)}`
    : activeTurn
      ? getSpectatorTurnLabel(activeTurn)
      : selectedRound
        ? '라운드 리플레이 준비'
        : '관전 링크 대기';
  const currentActionCaption = activeTurn
    ? getSpectatorTurnCaption(activeTurn, resolveSpectatorName)
    : selectedRound
      ? '재생을 누르면 이 라운드의 전투 흐름을 순서대로 볼 수 있습니다.'
      : '공유 링크 또는 토큰을 입력해 완료된 경기를 관전합니다.';
  const match = payload ? ({
    id: payload.match.match_id,
    result: payload.match.player_a_round_wins > payload.match.player_b_round_wins ? 'win' : payload.match.player_a_round_wins < payload.match.player_b_round_wins ? 'loss' : 'draw',
    match_type: payload.match.match_type,
    round_count: payload.match.round_count,
    player_a_round_wins: payload.match.player_a_round_wins,
    player_b_round_wins: payload.match.player_b_round_wins,
    difficulty: 'spectator',
    created_at: payload.match.created_at,
    summary: {
      player_deck: payload.match.player_deck,
      opponent_deck: payload.match.opponent_deck,
      round_results: payload.match.round_results || []
    }
  } as ArenaMatchViewDto) : null;
  const roundReveal: RoundRevealState | null = selectedRound ? {
    roundNo: selectedRound.round_no,
    stage: playing && !roundFinished ? 'battle' : 'result',
    winner: selectedRound.winner_side,
    completed: true,
    result: match?.result || 'draw'
  } : null;
  const skillLookup = React.useMemo(() => new Map(((rules?.skills || []) as any[]).map((skill) => [skill.id, skill])), [rules?.skills]);
  const classLookup = React.useMemo(() => {
    const pairs = ((rules?.classes || []) as any[]).flatMap((cardClass) => {
      const keys = [cardClass.id, cardClass.class_id].filter(Boolean) as string[];
      return keys.map((key) => [key, cardClass] as const);
    });
    return new Map(pairs);
  }, [rules?.classes]);

  React.useEffect(() => {
    if (initialLoadRef.current || !initialShare) return;
    initialLoadRef.current = true;
    loadSpectatorReplay(initialShare);
  }, [initialShare, loadSpectatorReplay]);

  React.useEffect(() => {
    setPlaybackSpeed(readSpectateSpeed());
  }, []);

  React.useEffect(() => {
    if (!playing || !selectedRound || battleTurns.length === 0) return;
    if (eventIndex >= battleTurns.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(
      () => setEventIndex((prev) => Math.min(battleTurns.length - 1, prev + 1)),
      Math.max(180, Math.round(ARENA_BATTLE_TURN_MS / playbackSpeed))
    );
    return () => window.clearTimeout(timer);
  }, [battleTurns.length, eventIndex, playbackSpeed, playing, selectedRound]);

  const restartRound = () => {
    setEventIndex(0);
    setPlaying(true);
  };

  const skipToLastScene = () => {
    if (battleTurns.length === 0) return;
    setPlaying(false);
    setEventIndex(battleTurns.length - 1);
  };

  const togglePlayback = () => {
    if (battleTurns.length === 0) return;
    if (roundFinished) {
      setEventIndex(0);
      setPlaying(true);
      return;
    }
    setPlaying((prev) => !prev);
  };

  const setSpeed = (speed: number) => {
    setPlaybackSpeed(speed);
    window.localStorage.setItem('arena:replay-speed', String(speed));
  };

  return (
    <ArenaLayout activeTab="play" onTabChange={moveArenaTab}>
      <div className="space-y-5">
        <section className="arena-panel-soft arena-premium-panel cute-surface overflow-hidden rounded-[2.25rem] p-5 md:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <span className="cute-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-black">
                <Eye className="h-3.5 w-3.5" />
                아레나 관전
              </span>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-foreground md:text-5xl">
                {match ? `세트 ${resultLabel(match.result)}` : '관전 리플레이'}
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-bold leading-relaxed text-muted-foreground">
                {payload ? `매치 ID ${payload.match.match_id} · ${payload.match.match_type === 'RANKED' ? '빠른대전' : '봇 연습전'} · ${formatDateTime(payload.match.created_at)}` : '공유받은 링크로 완료된 경기를 라운드별로 재생합니다.'}
              </p>
              <div className="arena-current-action mt-4 max-w-2xl rounded-[1.65rem] px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`arena-action-dot ${playing ? 'is-live' : payload ? 'is-done' : 'is-ready'}`} />
                  <p className="text-sm font-black text-foreground">{currentActionLabel}</p>
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-black text-primary">턴 {currentTurnLabel}</span>
                </div>
                <p className="mt-1 text-xs font-bold leading-relaxed text-muted-foreground">{currentActionCaption}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-[2rem] border border-white/70 bg-white/70 p-2 shadow-sm dark:border-white/10 dark:bg-white/10">
              <div className="arena-premium-metric rounded-2xl px-4 py-3 text-center">
                <p className="text-[10px] font-black text-muted-foreground">현재 스코어</p>
                <p className="mt-1 text-xl font-black text-foreground">{scoreLabel}</p>
              </div>
              <div className="arena-premium-metric rounded-2xl px-4 py-3 text-center">
                <p className="text-[10px] font-black text-muted-foreground">라운드</p>
                <p className="mt-1 text-xl font-black text-foreground">{selectedRound?.round_no || '-'}</p>
              </div>
              <div className="arena-premium-metric rounded-2xl px-4 py-3 text-center">
                <p className="text-[10px] font-black text-muted-foreground">상태</p>
                <p className="mt-1 text-sm font-black text-primary">{playing ? '재생 중' : '대기'}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="arena-panel-soft cute-surface rounded-[2rem] p-4 md:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-1 gap-2">
              <input
                value={shareToken}
                onChange={(event) => {
                  setShareToken(event.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') loadSpectatorReplay();
                }}
                className="arena-premium-input min-w-0 flex-1 rounded-2xl border px-3 py-2 text-xs font-bold text-foreground outline-none transition"
                placeholder="공유 링크 또는 토큰"
              />
              <button
                type="button"
                onClick={() => loadSpectatorReplay()}
                disabled={loading || !shareToken.trim()}
                className="arena-polished-button cute-wiggle-hover inline-flex shrink-0 items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-xs font-black text-primary-foreground shadow-lg shadow-primary/20 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                조회
              </button>
            </div>
            {rounds.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {rounds.map((round) => (
                  <button
                    key={round.round_no}
                    type="button"
                    onClick={() => {
                      setSelectedRoundNo(round.round_no);
                      setEventIndex(0);
                      setPlaying(false);
                    }}
                    className={`arena-replay-round-button min-w-28 rounded-2xl px-3 py-2 text-left transition ${
                      selectedRoundNo === round.round_no
                        ? 'is-selected bg-primary text-primary-foreground shadow-sm'
                        : 'bg-secondary/70 text-foreground hover:-translate-y-0.5 hover:bg-primary/10 hover:text-primary'
                    }`}
                  >
                    <span className="block text-[11px] font-black">R{round.round_no} · {spectateWinnerLabel(round.winner_side)}</span>
                    <span className={`mt-0.5 block text-[9px] font-bold ${selectedRoundNo === round.round_no ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>
                      {round.events.length} 이벤트
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {error ? (
            <div className="arena-warning-ribbon mt-4 rounded-3xl p-4 pl-6 text-sm font-bold text-amber-800 dark:text-amber-100">
              {error}
            </div>
          ) : null}

          {match && payload && selectedRound ? (
            <>
              <div className="mt-4">
                <ArenaBattleStage
                  match={match}
                  playerCards={getRoundCards(payload.match.player_deck, selectedRound.round_no)}
                  opponentCards={getRoundCards(payload.match.opponent_deck, selectedRound.round_no)}
                  playerSlots={getRoundSlots(payload.match.player_deck, selectedRound.round_no)}
                  opponentSlots={getRoundSlots(payload.match.opponent_deck, selectedRound.round_no)}
                  activeTurn={activeTurn}
                  activeEvent={activeEvent}
                  battleEvents={events}
                  unitStates={selectedRound.unit_states || []}
                  battleEventIndex={eventIndex}
                  revealOpponent
                  roundReveal={roundReveal}
                  roundResult={roundResult}
                  skillLookup={skillLookup}
                  classLookup={classLookup}
                  user={{ username: '플레이어', avatarUrl: null }}
                  loadout={null}
                  displayPlayerRoundWins={visibleScore.player}
                  displayOpponentRoundWins={visibleScore.opponent}
                />
              </div>
              <div className="arena-replay-control arena-premium-panel mt-4 rounded-[1.75rem] p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black text-primary">R{selectedRound.round_no} {spectateWinnerLabel(selectedRound.winner_side)}</p>
                    <p className="mt-1 truncate text-sm font-black text-foreground">{getSpectatorTurnLabel(activeTurn)}</p>
                    <p className="mt-1 text-[10px] font-bold text-muted-foreground">
                      {battleTurns.length > 0 ? `${Math.min(eventIndex + 1, battleTurns.length)} / ${battleTurns.length} 턴` : '턴 없음'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="arena-premium-metric flex rounded-2xl p-1">
                      {SPECTATE_SPEED_OPTIONS.map((speed) => (
                        <button
                          key={speed}
                          type="button"
                          onClick={() => setSpeed(speed)}
                          className={`rounded-xl px-2.5 py-1.5 text-[10px] font-black transition ${
                            playbackSpeed === speed ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {speed}x
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setPlaying(false);
                        setEventIndex((prev) => Math.max(0, prev - 1));
                      }}
                      disabled={battleTurns.length === 0 || eventIndex <= 0}
                      className="arena-polished-button cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl bg-white/72 px-3 py-2 text-xs font-black text-foreground disabled:opacity-50 dark:bg-white/10"
                    >
                      <SkipBack className="h-3.5 w-3.5" />
                      이전
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPlaying(false);
                        setEventIndex((prev) => Math.min(battleTurns.length - 1, prev + 1));
                      }}
                      disabled={battleTurns.length === 0 || eventIndex >= battleTurns.length - 1}
                      className="arena-polished-button cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl bg-white/72 px-3 py-2 text-xs font-black text-foreground disabled:opacity-50 dark:bg-white/10"
                    >
                      <SkipForward className="h-3.5 w-3.5" />
                      다음
                    </button>
                    <button
                      type="button"
                      onClick={restartRound}
                      disabled={battleTurns.length === 0}
                      className="arena-polished-button cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl bg-white/72 px-4 py-2 text-xs font-black text-foreground disabled:opacity-50 dark:bg-white/10"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      처음부터
                    </button>
                    <button
                      type="button"
                      onClick={skipToLastScene}
                      disabled={battleTurns.length === 0 || eventIndex >= battleTurns.length - 1}
                      className="arena-polished-button cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl bg-white/72 px-4 py-2 text-xs font-black text-foreground disabled:opacity-50 dark:bg-white/10"
                    >
                      <FastForward className="h-3.5 w-3.5" />
                      마지막 장면
                    </button>
                    <button
                      type="button"
                      onClick={togglePlayback}
                      disabled={battleTurns.length === 0}
                      className="arena-primary-cta arena-polished-button cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-xs font-black text-primary-foreground shadow-lg shadow-primary/20 disabled:opacity-50"
                    >
                      {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      {playing ? '일시정지' : roundFinished ? '다시 재생' : '재생'}
                    </button>
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70 dark:bg-white/10">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${battleTurns.length > 0 ? Math.max(4, replayProgressPercent) : 0}%` }}
                  />
                </div>
                {selectedReplayTruncated ? (
                  <div className="arena-warning-ribbon mt-3 rounded-2xl px-3 py-2 pl-5 text-[11px] font-bold leading-relaxed text-amber-800 dark:text-amber-100">
                    이 라운드는 저장 상한으로 일부 이벤트가 생략되었습니다.
                    {selectedReplayOmittedCount > 0 ? ` 생략 ${selectedReplayOmittedCount.toLocaleString()}개` : ''}
                    {selectedReplayOriginalCount > 0 ? ` · 원본 ${selectedReplayOriginalCount.toLocaleString()}개` : ''}
                  </div>
                ) : null}
              </div>
              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
                <div className="arena-replay-now arena-premium-panel rounded-[1.75rem] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black text-primary">현재 장면</p>
                      <h2 className="mt-1 truncate text-lg font-black text-foreground">{getSpectatorTurnLabel(activeTurn)}</h2>
                    </div>
                    <span className="rounded-full bg-white/70 px-3 py-1 text-[10px] font-black text-primary dark:bg-white/10">
                      {replayProgressPercent}%
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-bold leading-relaxed text-muted-foreground">
                    {getSpectatorTurnCaption(activeTurn, resolveSpectatorName)}
                  </p>
                  {activeTurnSummary.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {activeTurnSummary.map((item) => (
                        <span
                          key={`${item.key}-${item.label}`}
                          className={`rounded-full px-2.5 py-1 text-[10px] font-black ${spectateSummaryToneClass[item.key]}`}
                        >
                          {item.label} {item.value}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {selectedReplayTruncated ? (
                    <p className="mt-2 text-[10px] font-black text-amber-700 dark:text-amber-200">
                      일부 이벤트 생략됨
                    </p>
                  ) : null}
                  {activeEvent?.message ? (
                    <div className="mt-3 rounded-2xl bg-white/62 px-3 py-2 text-xs font-bold text-foreground dark:bg-white/10">
                      {activeEvent.message}
                    </div>
                  ) : null}
                </div>
                <div className="arena-premium-panel rounded-[1.75rem] p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <FileClock className="h-4 w-4 text-primary" />
                      <h2 className="text-sm font-black text-foreground">이벤트 로그</h2>
                    </div>
                    <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-black text-primary">{selectedRound.events.length}</span>
                  </div>
                  {visibleEvents.length > 0 ? (
                    <div className="arena-compact-scroll grid max-h-80 gap-2 overflow-y-auto pr-1">
                      {visibleEvents.map((event, index) => (
                        <div key={`${event.t}-${event.type}-${index}`} className="arena-status-row flex items-center justify-between gap-3 rounded-2xl border border-border bg-card/70 px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-black text-foreground">{event.message || event.type}</p>
                            <p className="mt-0.5 text-[10px] font-bold text-muted-foreground">{resolveSpectatorName(event.actor) || event.actor || '시스템'} · {Math.round(event.t / 100) / 10}s</p>
                          </div>
                          {typeof event.value === 'number' ? (
                            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-black text-primary">{event.value}</span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs font-bold leading-relaxed text-muted-foreground">표시할 이벤트가 없습니다.</p>
                  )}
                </div>
              </div>
            </>
          ) : loading ? (
            <div className="mt-4 grid gap-3">
              {[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-[2rem] border border-border bg-secondary/45" />)}
            </div>
          ) : (
            <div className="mt-4 rounded-3xl border border-dashed border-border bg-secondary/30 p-5 text-center">
              <Trophy className="mx-auto h-8 w-8 text-primary" />
              <p className="mt-3 text-sm font-black text-foreground">관전할 리플레이가 없습니다</p>
              <p className="mt-1 text-xs font-bold text-muted-foreground">공유 링크 또는 토큰을 입력해 주세요.</p>
            </div>
          )}
        </section>
      </div>
    </ArenaLayout>
  );
};
