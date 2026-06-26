'use client';

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, Pause, Play, RefreshCw, RotateCcw, SkipBack, SkipForward, Trophy } from 'lucide-react';
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
  type RoundRevealState,
  winnerLabel
} from '../matches/ArenaMatchPageClient';

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

const readSpectateSpeed = () => {
  if (typeof window === 'undefined') return 1;
  const value = Number(window.localStorage.getItem('arena:replay-speed') || '1');
  return SPECTATE_SPEED_OPTIONS.includes(value) ? value : 1;
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
      setError(err?.message || '관전 리플레이를 불러오지 못했습니다.');
      setPayload(null);
      setPlaying(false);
    } finally {
      setLoading(false);
    }
  }, [shareToken]);

  const rounds = payload?.replay.rounds || [];
  const selectedRound = rounds.find((round) => round.round_no === selectedRoundNo) || rounds[0];
  const events = selectedRound?.events || [];
  const battleTurns = React.useMemo(() => buildArenaBattleTurns(events), [events]);
  const activeTurn = battleTurns.length > 0 ? battleTurns[Math.min(eventIndex, battleTurns.length - 1)] : undefined;
  const activeEvent = activeTurn?.primary;
  const roundFinished = battleTurns.length === 0 || eventIndex >= battleTurns.length - 1;
  const roundResult = payload?.match.round_results?.find((round) => Number(round.round_no) === Number(selectedRound?.round_no));
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

  const setSpeed = (speed: number) => {
    setPlaybackSpeed(speed);
    window.localStorage.setItem('arena:replay-speed', String(speed));
  };

  return (
    <ArenaLayout activeTab="play" onTabChange={moveArenaTab}>
      <div className="space-y-5">
        <section className="arena-panel-soft cute-surface overflow-hidden rounded-[2.25rem] p-5 md:p-6">
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
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-[2rem] border border-white/70 bg-white/70 p-2 shadow-sm dark:border-white/10 dark:bg-white/10">
              <div className="rounded-2xl bg-secondary/60 px-4 py-3 text-center">
                <p className="text-[10px] font-black text-muted-foreground">스코어</p>
                <p className="mt-1 text-xl font-black text-foreground">{payload ? `${payload.match.player_a_round_wins}:${payload.match.player_b_round_wins}` : '-'}</p>
              </div>
              <div className="rounded-2xl bg-secondary/60 px-4 py-3 text-center">
                <p className="text-[10px] font-black text-muted-foreground">라운드</p>
                <p className="mt-1 text-xl font-black text-foreground">{selectedRound?.round_no || '-'}</p>
              </div>
              <div className="rounded-2xl bg-secondary/60 px-4 py-3 text-center">
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
                className="min-w-0 flex-1 rounded-2xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="공유 링크 또는 토큰"
              />
              <button
                type="button"
                onClick={() => loadSpectatorReplay()}
                disabled={loading || !shareToken.trim()}
                className="cute-wiggle-hover inline-flex shrink-0 items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-xs font-black text-primary-foreground shadow-lg shadow-primary/20 disabled:opacity-50"
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
                    className={`rounded-2xl px-3 py-2 text-[11px] font-black transition ${selectedRoundNo === round.round_no ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-secondary/70 text-muted-foreground hover:text-foreground'}`}
                  >
                    R{round.round_no}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {error ? (
            <div className="mt-4 rounded-3xl border border-red-200 bg-red-50/80 p-4 text-sm font-bold text-red-700 dark:border-red-300/20 dark:bg-red-300/10 dark:text-red-100">
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
                />
              </div>
              <div className="mt-4 rounded-[1.75rem] border border-border bg-secondary/28 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black text-primary">R{selectedRound.round_no} {winnerLabel(selectedRound.winner_side)}</p>
                    <p className="mt-1 truncate text-sm font-black text-foreground">{activeEvent?.message || '라운드를 재생하면 전투 흐름이 표시됩니다.'}</p>
                    <p className="mt-1 text-[10px] font-bold text-muted-foreground">
                      {battleTurns.length > 0 ? `${Math.min(eventIndex + 1, battleTurns.length)} / ${battleTurns.length} 턴` : '턴 없음'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex rounded-2xl border border-border bg-card p-1">
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
                      className="cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2 text-xs font-black text-foreground disabled:opacity-50"
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
                      className="cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2 text-xs font-black text-foreground disabled:opacity-50"
                    >
                      <SkipForward className="h-3.5 w-3.5" />
                      다음
                    </button>
                    <button
                      type="button"
                      onClick={restartRound}
                      disabled={battleTurns.length === 0}
                      className="cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-2 text-xs font-black text-foreground disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      처음부터
                    </button>
                    <button
                      type="button"
                      onClick={() => setPlaying((prev) => !prev)}
                      disabled={battleTurns.length === 0 || roundFinished}
                      className="arena-primary-cta cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-xs font-black text-primary-foreground shadow-lg shadow-primary/20 disabled:opacity-50"
                    >
                      {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      {playing ? '일시정지' : '재생'}
                    </button>
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70 dark:bg-white/10">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${battleTurns.length > 0 ? Math.max(4, Math.round(((eventIndex + 1) / battleTurns.length) * 100)) : 0}%` }}
                  />
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
