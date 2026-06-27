'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Activity, Bug, Download, FileSearch, Flame, Gauge, HeartPulse, Play, RotateCcw, Settings, Shield, SlidersHorizontal, Sparkles, Zap } from 'lucide-react';
import { ArenaLayout } from '../../ArenaLayout';
import { useApp } from '../../AppContext';
import type { ArenaSiteTab } from '../../ArenaTab';
import { apiFetch } from '@/lib/api';
import { validateArenaBattleTimeline, type ArenaBattleTimelineDiagnostic } from '@/lib/arenaBattleTimeline';
import {
  ARENA_PREVIEW_CLASS_LOOKUP,
  ARENA_PREVIEW_LOADOUT,
  ARENA_PREVIEW_OPPONENT_CARDS,
  ARENA_PREVIEW_PLAYER_CARDS,
  ARENA_PREVIEW_SKILL_LOOKUP,
  ARENA_VFX_PREVIEW_MATCH_ID,
  ARENA_VFX_PREVIEW_OPTIONS,
  arenaPreviewUnitStatesFor,
  buildArenaPreviewEvents,
  buildArenaPreviewMatch,
  buildArenaPreviewSlots,
  type ArenaVfxPreviewKind
} from '@/lib/arenaBattlePreview';
import {
  ARENA_BATTLE_TURN_MS,
  ArenaBattleStage,
  buildArenaBattleTurns,
  type RoundRevealState
} from '../matches/ArenaMatchPageClient';
import type { ArenaReplayPayloadDto, ArenaRoundResultDto } from '@chikapo/arena-contract';

type VfxQuality = 'auto' | 'high' | 'low' | 'off';
type DebugReplayRound = {
  round_no: number;
  winner_side?: string;
  duration_ms?: number;
  replay_truncated?: boolean;
  original_event_count?: number;
  timeline_summary?: {
    first_event_t?: number;
    last_event_t?: number;
    omitted_event_count?: number;
  };
  events?: Array<{
    t: number;
    type: string;
    actor?: string;
    targets?: string[];
    value?: number;
    hp_before?: number;
    hp_after?: number;
    shield_before?: number;
    shield_after?: number;
    vfx_kind?: string;
    damage_type?: string;
    skill_id?: string;
    effect_tags?: string[];
    message?: string;
  }>;
};

const asRecord = (value: unknown): Record<string, unknown> | null => (
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
);

const isTimelineDiagnostic = (value: unknown): value is ArenaBattleTimelineDiagnostic => {
  const record = asRecord(value);
  return record?.schema === 'arena-battle-timeline-diagnostic-v1' && Array.isArray(record.rounds);
};

const extractReplayPayload = (value: unknown): Partial<ArenaReplayPayloadDto> | null => {
  const root = asRecord(value);
  if (!root) return null;

  const responses = asRecord(root.responses);
  const replayResponse = asRecord(responses?.replay);
  const replayBody = asRecord(replayResponse?.body);
  const candidates = [
    asRecord(replayBody?.data),
    asRecord(replayBody?.replay),
    replayBody,
    asRecord(root.replay),
    asRecord(root.data),
    root
  ].filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));

  const payload = candidates.find((candidate) => Array.isArray(candidate.rounds));
  return payload ? payload as Partial<ArenaReplayPayloadDto> : null;
};

const extractTimelineDiagnostic = (value: unknown) => {
  const root = asRecord(value);
  const diagnostics = asRecord(root?.diagnostics);
  const timeline = diagnostics?.timeline;
  return isTimelineDiagnostic(timeline) ? timeline : null;
};

const arenaTabHref: Record<ArenaSiteTab, string> = {
  play: '/arena/play',
  inventory: '/arena/inventory',
  ranking: '/arena/ranking',
  style: '/arena/style',
  admin: '/arena/admin'
};

const VFX_OPTIONS: Array<{ value: VfxQuality; label: string; description: string }> = [
  { value: 'auto', label: '자동', description: '기기 성능과 모션 설정을 보고 자동으로 조절합니다.' },
  { value: 'high', label: '높음', description: '전투 VFX와 입자 효과를 가장 풍부하게 표시합니다.' },
  { value: 'low', label: '가벼움', description: '저사양 기기에서 핵심 연출만 유지합니다.' },
  { value: 'off', label: '최소', description: '모션 민감도나 디버그 상황에서 동적 효과를 줄입니다.' }
];

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2];
const VFX_PREVIEW_ICONS: Record<ArenaVfxPreviewKind, React.ComponentType<{ className?: string }>> = {
  attack: Zap,
  skill: Sparkles,
  ultimate: Activity,
  heal: HeartPulse,
  guard: Shield,
  control: SlidersHorizontal,
  burn: Flame,
  poison: Bug,
  tempo: Play,
  retire: RotateCcw
};

const readVfxQuality = (): VfxQuality => {
  if (typeof window === 'undefined') return 'auto';
  const value = window.localStorage.getItem('arena:vfx-quality');
  return value === 'high' || value === 'low' || value === 'off' ? value : 'auto';
};

const readReplaySpeed = () => {
  if (typeof window === 'undefined') return 1;
  const value = Number(window.localStorage.getItem('arena:replay-speed') || '1');
  return SPEED_OPTIONS.includes(value) ? value : 1;
};

const downloadJson = (filename: string, payload: unknown) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const ArenaSettingsPageClient: React.FC = () => {
  const router = useRouter();
  const { toast } = useApp();
  const [vfxQuality, setVfxQuality] = React.useState<VfxQuality>('auto');
  const [replaySpeed, setReplaySpeed] = React.useState(1);
  const [matchId, setMatchId] = React.useState('');
  const [exporting, setExporting] = React.useState(false);
  const [diagnostic, setDiagnostic] = React.useState<ArenaBattleTimelineDiagnostic | null>(null);
  const [debugInput, setDebugInput] = React.useState('');
  const [debugRounds, setDebugRounds] = React.useState<DebugReplayRound[]>([]);
  const [selectedDebugRoundNo, setSelectedDebugRoundNo] = React.useState<number | null>(null);
  const [previewKind, setPreviewKind] = React.useState<ArenaVfxPreviewKind>('attack');
  const [previewRunId, setPreviewRunId] = React.useState(1);
  const [previewTurnIndex, setPreviewTurnIndex] = React.useState(0);
  const [previewPlaying, setPreviewPlaying] = React.useState(true);

  React.useEffect(() => {
    setVfxQuality(readVfxQuality());
    setReplaySpeed(readReplaySpeed());
  }, []);

  const moveArenaTab = React.useCallback((tab: ArenaSiteTab) => {
    router.push(arenaTabHref[tab] || '/arena/play');
  }, [router]);

  const saveVfxQuality = (value: VfxQuality) => {
    setVfxQuality(value);
    if (value === 'auto') window.localStorage.removeItem('arena:vfx-quality');
    else window.localStorage.setItem('arena:vfx-quality', value);
    toast('전투 연출 품질을 저장했습니다.', 'success');
  };

  const saveReplaySpeed = (value: number) => {
    setReplaySpeed(value);
    window.localStorage.setItem('arena:replay-speed', String(value));
    toast('관전 재생 속도를 저장했습니다.', 'success');
  };

  const resetLocalSettings = () => {
    window.localStorage.removeItem('arena:vfx-quality');
    window.localStorage.removeItem('arena:replay-speed');
    setVfxQuality('auto');
    setReplaySpeed(1);
    toast('아레나 로컬 설정을 초기화했습니다.', 'success');
  };

  const exportDebugBundle = async () => {
    const id = matchId.trim();
    if (!id) {
      toast('매치 ID를 입력해주세요.', 'warning');
      return;
    }

    setExporting(true);
    try {
      const [matchRes, replayRes, rulesRes] = await Promise.all([
        apiFetch(`/arena/matches/${encodeURIComponent(id)}`),
        apiFetch(`/arena/matches/${encodeURIComponent(id)}/replay`),
        apiFetch('/arena/rules/catalog')
      ]);

      const readPayload = async (res: Response) => {
        const text = await res.text();
        try {
          return text ? JSON.parse(text) : null;
        } catch {
          return { raw: text };
        }
      };

      const bundle = {
        exported_at: new Date().toISOString(),
        debug_schema: 'arena-debug-bundle-v1',
        match_id: id,
        local_settings: {
          vfx_quality: readVfxQuality(),
          replay_speed: readReplaySpeed()
        },
        responses: {
          match: { ok: matchRes.ok, status: matchRes.status, body: await readPayload(matchRes) },
          replay: { ok: replayRes.ok, status: replayRes.status, body: await readPayload(replayRes) },
          rules: { ok: rulesRes.ok, status: rulesRes.status, body: await readPayload(rulesRes) }
        }
      };
      const replayPayload = extractReplayPayload(bundle.responses.replay.body);
      const replayRounds = Array.isArray(replayPayload?.rounds) ? replayPayload.rounds : [];
      const timelineDiagnostic = validateArenaBattleTimeline(replayRounds);
      const enrichedBundle = {
        ...bundle,
        diagnostics: {
          timeline: timelineDiagnostic
        }
      };
      setDiagnostic(timelineDiagnostic);
      setDebugRounds(replayRounds);
      setSelectedDebugRoundNo(replayRounds[0]?.round_no || null);
      downloadJson(`arena-debug-${id}-${Date.now()}.json`, enrichedBundle);
      toast('아레나 디버그 파일을 생성했습니다.', 'success');
    } catch (error) {
      console.error(error);
      toast('디버그 파일 생성 중 오류가 발생했습니다.', 'error');
    } finally {
      setExporting(false);
    }
  };

  const analyzeDebugInput = () => {
    const text = debugInput.trim();
    if (!text) {
      toast('분석할 JSON을 입력해주세요.', 'warning');
      return;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      const replayPayload = extractReplayPayload(parsed);
      const replayRounds = Array.isArray(replayPayload?.rounds) ? replayPayload.rounds : [];
      const nextDiagnostic = extractTimelineDiagnostic(parsed) || validateArenaBattleTimeline(replayRounds);
      setDiagnostic(nextDiagnostic);
      setDebugRounds(replayRounds);
      setSelectedDebugRoundNo(replayRounds[0]?.round_no || nextDiagnostic.rounds[0]?.roundNo || null);
      toast('디버그 JSON을 분석했습니다.', 'success');
    } catch {
      toast('JSON 형식이 올바르지 않습니다.', 'error');
    }
  };

  const selectedDebugRound = React.useMemo(() => {
    if (debugRounds.length === 0) return null;
    return debugRounds.find((round) => Number(round.round_no) === Number(selectedDebugRoundNo)) || debugRounds[0];
  }, [debugRounds, selectedDebugRoundNo]);

  const previewEvents = React.useMemo(() => buildArenaPreviewEvents(previewKind), [previewKind]);
  const previewTurns = React.useMemo(() => buildArenaBattleTurns(previewEvents), [previewEvents]);
  const activePreviewTurn = previewTurns[Math.min(previewTurnIndex, Math.max(0, previewTurns.length - 1))];
  const previewMatch = React.useMemo(() => buildArenaPreviewMatch(previewKind, previewRunId), [previewKind, previewRunId]);
  const previewUnitStates = React.useMemo(() => arenaPreviewUnitStatesFor(previewKind), [previewKind]);
  const previewRoundReveal = React.useMemo<RoundRevealState>(() => ({
    roundNo: 1,
    stage: previewPlaying ? 'battle' : 'result',
    winner: 'player',
    completed: true,
    result: 'win'
  }), [previewPlaying]);
  const previewRoundResult = React.useMemo<ArenaRoundResultDto>(() => ({
    round_no: 1,
    winner_side: 'player',
    player_remaining_units: 6,
    bot_remaining_units: previewKind === 'retire' ? 5 : 6,
    player_total_damage: previewKind === 'heal' || previewKind === 'guard' || previewKind === 'tempo' ? 0 : previewKind === 'ultimate' || previewKind === 'retire' ? 420 : previewKind === 'skill' ? 240 : 180,
    bot_total_damage: 0
  }), [previewKind]);

  React.useEffect(() => {
    if (!previewPlaying || previewTurns.length === 0) return undefined;
    if (previewTurnIndex >= previewTurns.length - 1) {
      const settleTimer = window.setTimeout(() => setPreviewPlaying(false), Math.max(420, Math.round(ARENA_BATTLE_TURN_MS * 0.7)));
      return () => window.clearTimeout(settleTimer);
    }
    const timer = window.setTimeout(() => {
      setPreviewTurnIndex((index) => Math.min(index + 1, previewTurns.length - 1));
    }, Math.max(480, Math.round(ARENA_BATTLE_TURN_MS * 0.78)));
    return () => window.clearTimeout(timer);
  }, [previewPlaying, previewTurnIndex, previewTurns.length]);

  const startVfxPreview = (kind: ArenaVfxPreviewKind) => {
    setPreviewKind(kind);
    setPreviewRunId((id) => id + 1);
    setPreviewTurnIndex(0);
    setPreviewPlaying(true);
  };

  return (
    <ArenaLayout activeTab="play" onTabChange={moveArenaTab}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-8">
        <header className="arena-premium-panel cute-surface relative overflow-hidden rounded-[2rem] p-6">
          <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-primary/16 blur-3xl" />
          <div className="relative flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-white/70 px-3 py-1 text-xs font-black text-primary shadow-sm dark:bg-white/10">
                <Settings className="h-4 w-4" />
                숨겨진 아레나 설정
              </div>
              <h1 className="cute-display-font text-3xl font-black text-foreground md:text-4xl">전투 품질과 디버그 관리</h1>
              <p className="mt-2 max-w-2xl text-sm font-semibold text-muted-foreground">
                일반 플레이 화면을 방해하지 않는 곳에서 전투 연출, 관전 재생, 문제 분석용 export를 관리합니다.
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.push('/arena/play')}
              className="arena-polished-button cute-button cute-button-secondary inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-black"
            >
              플레이로 돌아가기
            </button>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
          <article className="arena-premium-panel cute-surface rounded-[1.75rem] p-5">
            <div className="mb-4 flex items-center gap-2">
              <Gauge className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-black text-foreground">전투 연출 품질</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {VFX_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => saveVfxQuality(option.value)}
                  className={`arena-polished-button rounded-3xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(244,63,94,0.16)] ${
                    vfxQuality === option.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-white/70 text-foreground dark:bg-white/5'
                  }`}
                >
                  <span className="block text-base font-black">{option.label}</span>
                  <span className="mt-1 block text-xs font-semibold text-muted-foreground">{option.description}</span>
                </button>
              ))}
            </div>
          </article>

          <article className="arena-premium-panel cute-surface rounded-[1.75rem] p-5">
            <div className="mb-4 flex items-center gap-2">
              <SlidersHorizontal className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-black text-foreground">관전 재생 속도</h2>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {SPEED_OPTIONS.map((speed) => (
                <button
                  key={speed}
                  type="button"
                  onClick={() => saveReplaySpeed(speed)}
                  className={`arena-polished-button rounded-2xl border px-3 py-3 text-sm font-black transition hover:-translate-y-0.5 ${
                    replaySpeed === speed
                      ? 'border-primary bg-primary text-primary-foreground shadow-[0_12px_26px_rgba(244,63,94,0.22)]'
                      : 'border-border bg-white/70 text-foreground dark:bg-white/5'
                  }`}
                >
                  {speed}x
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={resetLocalSettings}
              className="arena-polished-button mt-5 inline-flex items-center gap-2 rounded-full border border-border bg-white/70 px-4 py-2 text-sm font-black text-muted-foreground transition hover:border-primary/30 hover:text-primary dark:bg-white/5"
            >
              <RotateCcw className="h-4 w-4" />
              로컬 설정 초기화
            </button>
          </article>
        </section>

        <section className="arena-premium-panel cute-surface rounded-[1.75rem] p-5">
          <div className="mb-4 flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-black text-foreground">전투 VFX 프리뷰</h2>
              </div>
              <p className="mt-1 text-xs font-bold leading-relaxed text-muted-foreground">
                실제 전투 렌더러에 로컬 샘플 이벤트를 넣어 액션별 타격감과 이펙트를 확인합니다. API 호출이나 DB 저장은 발생하지 않습니다.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="rounded-full border border-primary/15 bg-primary/8 px-3 py-1 text-xs font-black text-primary">
                현재 품질 {VFX_OPTIONS.find((option) => option.value === vfxQuality)?.label || '자동'}
              </div>
              <button
                type="button"
                onClick={() => router.push(`/arena/matches?match_id=${encodeURIComponent(ARENA_VFX_PREVIEW_MATCH_ID)}`)}
                className="arena-polished-button rounded-full border border-primary/15 bg-white/72 px-3 py-1 text-xs font-black text-primary transition hover:-translate-y-0.5 dark:bg-white/8"
              >
                실제 매치 화면으로 QA
              </button>
            </div>
          </div>
          <div className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
            <div className="grid content-start gap-2 sm:grid-cols-2 xl:grid-cols-1">
              {ARENA_VFX_PREVIEW_OPTIONS.map((option) => {
                const Icon = VFX_PREVIEW_ICONS[option.value];
                const active = option.value === previewKind;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => startVfxPreview(option.value)}
                    className={`arena-polished-button group rounded-3xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-[0_16px_32px_rgba(244,63,94,0.15)] ${
                      active
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-white/70 text-foreground dark:bg-white/5'
                    }`}
                  >
                    <span className="flex items-center gap-2 text-sm font-black">
                      <span className={`flex h-8 w-8 items-center justify-center rounded-2xl ${active ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      {option.label}
                    </span>
                    <span className="mt-2 block text-[11px] font-bold leading-relaxed text-muted-foreground">{option.description}</span>
                  </button>
                );
              })}
            </div>
            <div className="arena-vfx-preview-stage min-h-[500px] overflow-visible rounded-[1.75rem] border border-primary/10 bg-gradient-to-br from-rose-50/70 via-white/75 to-pink-50/70 p-2 shadow-inner dark:from-rose-950/18 dark:via-white/5 dark:to-pink-950/18">
              <ArenaBattleStage
                match={previewMatch}
                playerCards={ARENA_PREVIEW_PLAYER_CARDS}
                opponentCards={ARENA_PREVIEW_OPPONENT_CARDS}
                playerSlots={buildArenaPreviewSlots(ARENA_PREVIEW_PLAYER_CARDS)}
                opponentSlots={buildArenaPreviewSlots(ARENA_PREVIEW_OPPONENT_CARDS)}
                activeTurn={activePreviewTurn}
                activeEvent={activePreviewTurn?.primary}
                battleEvents={previewEvents}
                unitStates={previewUnitStates}
                battleEventIndex={previewTurnIndex}
                revealOpponent
                roundReveal={previewRoundReveal}
                roundResult={previewRoundResult}
                skillLookup={ARENA_PREVIEW_SKILL_LOOKUP}
                classLookup={ARENA_PREVIEW_CLASS_LOOKUP}
                user={{ id: 'arena-vfx-preview', username: 'VFX 프리뷰', profile_image_url: '/arena-icon.png', avatarUrl: '/arena-icon.png' }}
                loadout={ARENA_PREVIEW_LOADOUT}
                displayPlayerRoundWins={previewPlaying ? 0 : 1}
                displayOpponentRoundWins={0}
              />
            </div>
          </div>
        </section>

        <section className="arena-premium-panel cute-surface rounded-[1.75rem] p-5">
          <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <Bug className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-black text-foreground">전투 디버그 export</h2>
            </div>
            <p className="text-xs font-bold text-muted-foreground">버그 제보와 밸런스 검토에 필요한 데이터를 한 번에 저장합니다.</p>
          </div>
          <div className="flex flex-col gap-3 md:flex-row">
            <input
              value={matchId}
              onChange={(event) => setMatchId(event.target.value)}
              placeholder="매치 ID"
              className="arena-premium-input min-h-12 flex-1 rounded-2xl px-4 text-sm font-bold outline-none"
            />
            <button
              type="button"
              onClick={exportDebugBundle}
              disabled={exporting}
              className="arena-polished-button cute-button inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 text-sm font-black disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {exporting ? '생성 중' : 'JSON export'}
            </button>
          </div>
          {diagnostic ? (
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <div className="arena-premium-metric rounded-2xl px-4 py-3">
                <p className="text-[10px] font-black text-muted-foreground">라운드</p>
                <p className="mt-1 text-xl font-black text-foreground">{diagnostic.roundCount}</p>
              </div>
              <div className="arena-premium-metric rounded-2xl px-4 py-3">
                <p className="text-[10px] font-black text-muted-foreground">턴</p>
                <p className="mt-1 text-xl font-black text-foreground">{diagnostic.turnCount}</p>
              </div>
              <div className="arena-premium-metric rounded-2xl px-4 py-3">
                <p className="text-[10px] font-black text-muted-foreground">경고</p>
                <p className="mt-1 text-xl font-black text-amber-600 dark:text-amber-200">{diagnostic.warningCount}</p>
              </div>
              <div className="arena-premium-metric rounded-2xl px-4 py-3">
                <p className="text-[10px] font-black text-muted-foreground">오류</p>
                <p className="mt-1 text-xl font-black text-red-600 dark:text-red-200">{diagnostic.errorCount}</p>
              </div>
              {diagnostic.issues.length > 0 ? (
                <div className="arena-warning-ribbon md:col-span-4 rounded-2xl p-4 pl-6">
                  <p className="text-xs font-black text-amber-800 dark:text-amber-100">최근 진단 항목</p>
                  <div className="mt-2 space-y-1.5">
                    {diagnostic.issues.slice(0, 5).map((issue, index) => (
                      <p key={`${issue.code}-${issue.roundNo}-${issue.eventIndex}-${index}`} className="text-[11px] font-bold text-amber-800/85 dark:text-amber-100/85">
                        R{issue.roundNo} · {issue.code} · {issue.message}
                      </p>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="arena-premium-metric md:col-span-4 rounded-2xl p-4 text-xs font-black text-primary">
                  전투 타임라인 진단에서 문제를 찾지 못했습니다.
                </div>
              )}
            </div>
          ) : null}
        </section>

        <section className="arena-premium-panel cute-surface rounded-[1.75rem] p-5">
          <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <FileSearch className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-black text-foreground">디버그 JSON 검증</h2>
            </div>
            <p className="text-xs font-bold text-muted-foreground">export 파일 내용을 붙여 넣으면 브라우저에서 즉시 타임라인을 점검합니다.</p>
          </div>
          <textarea
            value={debugInput}
            onChange={(event) => setDebugInput(event.target.value)}
            placeholder='{"debug_schema":"arena-debug-bundle-v1", ...}'
            className="arena-premium-input min-h-40 w-full resize-y rounded-3xl p-4 font-mono text-xs font-bold text-foreground outline-none"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={analyzeDebugInput}
              className="arena-polished-button cute-button inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-5 text-sm font-black"
            >
              <FileSearch className="h-4 w-4" />
              붙여넣은 JSON 분석
            </button>
            <button
              type="button"
              onClick={() => setDebugInput('')}
              className="arena-polished-button inline-flex min-h-11 items-center justify-center rounded-2xl border border-border bg-white/70 px-5 text-sm font-black text-muted-foreground transition hover:border-primary/30 hover:text-primary dark:bg-white/5"
            >
              비우기
            </button>
          </div>
        </section>

        {diagnostic ? (
          <section className="arena-premium-panel cute-surface rounded-[1.75rem] p-5">
            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2">
                <Bug className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-black text-foreground">전투 타임라인 뷰어</h2>
              </div>
              <p className="text-xs font-bold text-muted-foreground">라운드 이벤트, HP 변화, VFX 메타데이터를 확인합니다.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {diagnostic.rounds.map((round) => (
                <button
                  key={round.roundNo}
                  type="button"
                  onClick={() => setSelectedDebugRoundNo(round.roundNo)}
                  className={`arena-polished-button rounded-2xl px-3 py-2 text-[11px] font-black transition ${
                    Number(selectedDebugRoundNo) === Number(round.roundNo)
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-secondary/70 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  R{round.roundNo} · {round.turnCount}턴
                </button>
              ))}
            </div>
            {selectedDebugRound ? (
              <div className="arena-premium-panel mt-4 overflow-hidden rounded-3xl">
                <div className="grid grid-cols-3 gap-px bg-border text-center text-[10px] font-black text-muted-foreground">
                  <div className="bg-card px-3 py-2">승자 {selectedDebugRound.winner_side || '-'}</div>
                  <div className="bg-card px-3 py-2">시간 {selectedDebugRound.duration_ms ?? '-'}ms</div>
                  <div className="bg-card px-3 py-2">이벤트 {selectedDebugRound.events?.length || 0}</div>
                </div>
                {selectedDebugRound.replay_truncated || Number(selectedDebugRound.timeline_summary?.omitted_event_count || 0) > 0 ? (
                  <div className="arena-warning-ribbon border-b border-amber-200 px-4 py-3 pl-6 text-xs font-bold leading-relaxed dark:border-amber-300/20">
                    이 라운드는 이벤트 저장 상한으로 일부 이벤트가 생략되었습니다.
                    {Number(selectedDebugRound.timeline_summary?.omitted_event_count || 0) > 0 ? ` 생략 ${Number(selectedDebugRound.timeline_summary?.omitted_event_count || 0).toLocaleString()}개` : ''}
                    {Number(selectedDebugRound.original_event_count || 0) > 0 ? ` · 원본 ${Number(selectedDebugRound.original_event_count || 0).toLocaleString()}개` : ''}
                  </div>
                ) : null}
                <div className="arena-compact-scroll max-h-[28rem] overflow-auto">
                  <table className="w-full min-w-[760px] border-collapse text-left text-[11px]">
                    <thead className="sticky top-0 z-10 bg-secondary text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-black">t</th>
                        <th className="px-3 py-2 font-black">타입</th>
                        <th className="px-3 py-2 font-black">행동자</th>
                        <th className="px-3 py-2 font-black">대상</th>
                        <th className="px-3 py-2 font-black">값</th>
                        <th className="px-3 py-2 font-black">HP</th>
                        <th className="px-3 py-2 font-black">보호막</th>
                        <th className="px-3 py-2 font-black">VFX</th>
                        <th className="px-3 py-2 font-black">메시지</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedDebugRound.events || []).slice(0, 160).map((event, index) => (
                        <tr key={`${event.t}-${event.type}-${index}`} className="border-t border-border/70 odd:bg-white/55 even:bg-secondary/25 dark:odd:bg-white/5">
                          <td className="whitespace-nowrap px-3 py-2 font-bold text-muted-foreground">{event.t}</td>
                          <td className="whitespace-nowrap px-3 py-2 font-black text-foreground">{event.type}</td>
                          <td className="max-w-[9rem] truncate px-3 py-2 font-bold text-muted-foreground">{event.actor || '-'}</td>
                          <td className="max-w-[10rem] truncate px-3 py-2 font-bold text-muted-foreground">{event.targets?.join(', ') || '-'}</td>
                          <td className="whitespace-nowrap px-3 py-2 font-black text-primary">{event.value ?? '-'}</td>
                          <td className="whitespace-nowrap px-3 py-2 font-bold text-foreground">
                            {event.hp_before != null || event.hp_after != null ? `${event.hp_before ?? '-'} → ${event.hp_after ?? '-'}` : '-'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 font-bold text-foreground">
                            {event.shield_before != null || event.shield_after != null ? `${event.shield_before ?? '-'} → ${event.shield_after ?? '-'}` : '-'}
                          </td>
                          <td className="max-w-[12rem] truncate px-3 py-2 font-bold text-muted-foreground">
                            {event.vfx_kind || '-'}{event.damage_type ? ` / ${event.damage_type}` : ''}{event.effect_tags?.length ? ` · ${event.effect_tags.join(',')}` : ''}
                          </td>
                          <td className="max-w-[14rem] truncate px-3 py-2 font-bold text-muted-foreground">{event.message || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {(selectedDebugRound.events?.length || 0) > 160 ? (
                  <p className="border-t border-border bg-secondary/45 px-4 py-3 text-xs font-bold text-muted-foreground">
                    화면 성능을 위해 앞 160개 이벤트만 표시합니다. 전체 이벤트는 JSON export 파일에 포함됩니다.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="arena-premium-metric mt-4 rounded-3xl p-4 text-xs font-bold text-muted-foreground">
                표시할 라운드 이벤트가 없습니다. 진단 요약만 포함된 JSON일 수 있습니다.
              </div>
            )}
          </section>
        ) : null}
      </div>
    </ArenaLayout>
  );
};
