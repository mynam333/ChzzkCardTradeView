'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Bug, Download, Gauge, RotateCcw, Settings, SlidersHorizontal } from 'lucide-react';
import { ArenaLayout } from '../../ArenaLayout';
import { useApp } from '../../AppContext';
import type { ArenaSiteTab } from '../../ArenaTab';
import { apiFetch } from '@/lib/api';

type VfxQuality = 'auto' | 'high' | 'low' | 'off';

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
      downloadJson(`arena-debug-${id}-${Date.now()}.json`, bundle);
      toast('아레나 디버그 파일을 생성했습니다.', 'success');
    } catch (error) {
      console.error(error);
      toast('디버그 파일 생성 중 오류가 발생했습니다.', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <ArenaLayout activeTab="play" onTabChange={moveArenaTab}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-8">
        <header className="cute-surface relative overflow-hidden rounded-[2rem] border border-primary/15 p-6 shadow-[0_22px_60px_rgba(244,63,94,0.12)]">
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
              className="cute-button cute-button-secondary inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-black"
            >
              플레이로 돌아가기
            </button>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
          <article className="cute-surface rounded-[1.75rem] border border-primary/12 p-5 shadow-[0_16px_42px_rgba(244,63,94,0.10)]">
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
                  className={`rounded-3xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(244,63,94,0.16)] ${
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

          <article className="cute-surface rounded-[1.75rem] border border-primary/12 p-5 shadow-[0_16px_42px_rgba(244,63,94,0.10)]">
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
                  className={`rounded-2xl border px-3 py-3 text-sm font-black transition hover:-translate-y-0.5 ${
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
              className="mt-5 inline-flex items-center gap-2 rounded-full border border-border bg-white/70 px-4 py-2 text-sm font-black text-muted-foreground transition hover:border-primary/30 hover:text-primary dark:bg-white/5"
            >
              <RotateCcw className="h-4 w-4" />
              로컬 설정 초기화
            </button>
          </article>
        </section>

        <section className="cute-surface rounded-[1.75rem] border border-primary/12 p-5 shadow-[0_16px_42px_rgba(244,63,94,0.10)]">
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
              className="min-h-12 flex-1 rounded-2xl border border-border bg-white/80 px-4 text-sm font-bold outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:bg-white/5"
            />
            <button
              type="button"
              onClick={exportDebugBundle}
              disabled={exporting}
              className="cute-button inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 text-sm font-black disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {exporting ? '생성 중' : 'JSON export'}
            </button>
          </div>
        </section>
      </div>
    </ArenaLayout>
  );
};
