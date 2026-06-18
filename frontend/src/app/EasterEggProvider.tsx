'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { Sparkles, Terminal, X } from 'lucide-react';
import {
  DailyFortune,
  EasterEggTerminalCode,
  getDailyFortune,
  isDesktopEasterEggSurface,
  recordEasterEggDiscovery,
  recordTerminalCode
} from '@/lib/easterEgg';

type EasterEggCommandDetail =
  | { command: 'themeToggle' }
  | { command: 'fortune' }
  | { command: 'terminalCode'; code: EasterEggTerminalCode }
  | { command: 'lostCard404' };

const BOOT_SEQUENCE = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'KeyB',
  'KeyA'
];

const MODE_TIMEOUT_MS = 5 * 60 * 1000;

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable;
};

const isBlockingModalOpen = () => {
  if (typeof document === 'undefined') return false;
  return Boolean(document.querySelector('.modal-backdrop'));
};

export const EasterEggProvider: React.FC<{
  children: React.ReactNode;
  toast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}> = ({ children, toast }) => {
  const router = useRouter();
  const [modeActive, setModeActive] = React.useState(false);
  const [bootOpen, setBootOpen] = React.useState(false);
  const [bootLogOpen, setBootLogOpen] = React.useState(false);
  const [fortune, setFortune] = React.useState<DailyFortune | null>(null);
  const [terminalLog, setTerminalLog] = React.useState<string[] | null>(null);
  const [liveBanner, setLiveBanner] = React.useState(false);
  const sequenceRef = React.useRef<string[]>([]);
  const sequenceTimerRef = React.useRef<number | null>(null);
  const modeTimerRef = React.useRef<number | null>(null);
  const liveTimerRef = React.useRef<number | null>(null);

  const setDocumentMode = React.useCallback((active: boolean) => {
    document.documentElement.classList.toggle('easter-egg-mode', active);
    setModeActive(active);
  }, []);

  const stopModeTimer = React.useCallback(() => {
    if (modeTimerRef.current !== null) {
      window.clearTimeout(modeTimerRef.current);
      modeTimerRef.current = null;
    }
  }, []);

  const activateMode = React.useCallback((message = '이스터에그 신호를 수신했습니다.') => {
    if (!isDesktopEasterEggSurface()) return;
    stopModeTimer();
    setDocumentMode(true);
    recordEasterEggDiscovery('theme');
    toast(message, 'info');
    modeTimerRef.current = window.setTimeout(() => {
      setDocumentMode(false);
      toast('이스터에그 모드를 종료했습니다.', 'info');
      modeTimerRef.current = null;
    }, MODE_TIMEOUT_MS);
  }, [setDocumentMode, stopModeTimer, toast]);

  const toggleMode = React.useCallback(() => {
    if (!isDesktopEasterEggSurface()) return;
    if (modeActive) {
      stopModeTimer();
      setDocumentMode(false);
      toast('이스터에그 모드를 종료했습니다.', 'info');
    } else {
      activateMode();
    }
  }, [activateMode, modeActive, setDocumentMode, stopModeTimer, toast]);

  const showFortune = React.useCallback(() => {
    if (!isDesktopEasterEggSurface()) return;
    setFortune(getDailyFortune());
    recordEasterEggDiscovery('fortune');
  }, []);

  const showTerminalLog = React.useCallback((lines: string[]) => {
    setTerminalLog(lines);
  }, []);

  const showLiveBanner = React.useCallback(() => {
    if (liveTimerRef.current !== null) window.clearTimeout(liveTimerRef.current);
    setLiveBanner(true);
    liveTimerRef.current = window.setTimeout(() => {
      setLiveBanner(false);
      liveTimerRef.current = null;
    }, 3000);
  }, []);

  const handleTerminalCode = React.useCallback((code: EasterEggTerminalCode) => {
    if (!isDesktopEasterEggSurface()) return;
    recordTerminalCode(code);
    if (code === 'lostCard') {
      showTerminalLog([
        'CHIKAPO TERMINAL READY',
        'SEARCH CODE: NO.0404',
        'LOST CARD INDEX OPEN'
      ]);
      window.setTimeout(() => router.push('/cards/no-0404'), 420);
      return;
    }
    if (code === 'terminalLog') {
      showTerminalLog([
        'CARD://LOST',
        'MARKET SIGNAL: EMPTY SLOT',
        'NO ASSET MOVED'
      ]);
      return;
    }
    showLiveBanner();
  }, [router, showLiveBanner, showTerminalLog]);

  React.useEffect(() => () => {
    stopModeTimer();
    if (sequenceTimerRef.current !== null) window.clearTimeout(sequenceTimerRef.current);
    if (liveTimerRef.current !== null) window.clearTimeout(liveTimerRef.current);
    document.documentElement.classList.remove('easter-egg-mode');
  }, [stopModeTimer]);

  React.useEffect(() => {
    const handleCommand = (event: Event) => {
      const detail = (event as CustomEvent<EasterEggCommandDetail>).detail;
      if (!detail || !isDesktopEasterEggSurface()) return;
      if (detail.command === 'themeToggle') toggleMode();
      if (detail.command === 'fortune') showFortune();
      if (detail.command === 'terminalCode') handleTerminalCode(detail.code);
      if (detail.command === 'lostCard404') activateMode('No.0404 카드가 이스터에그 신호를 열었습니다.');
    };

    window.addEventListener('chikapo:easter-egg-command', handleCommand);
    return () => window.removeEventListener('chikapo:easter-egg-command', handleCommand);
  }, [activateMode, handleTerminalCode, showFortune, toggleMode]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isDesktopEasterEggSurface() || isEditableTarget(event.target) || bootOpen || isBlockingModalOpen()) return;
      if (sequenceTimerRef.current !== null) window.clearTimeout(sequenceTimerRef.current);
      sequenceTimerRef.current = window.setTimeout(() => {
        sequenceRef.current = [];
        sequenceTimerRef.current = null;
      }, 3000);

      const next = [...sequenceRef.current, event.code].slice(-BOOT_SEQUENCE.length);
      sequenceRef.current = next;
      const matches = BOOT_SEQUENCE.every((key, index) => next[index] === key);
      if (next.length === BOOT_SEQUENCE.length && matches) {
        event.preventDefault();
        sequenceRef.current = [];
        setBootOpen(true);
        recordEasterEggDiscovery('keyboardBoot');
      } else if (!BOOT_SEQUENCE.slice(0, next.length).every((key, index) => next[index] === key)) {
        sequenceRef.current = [];
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [bootOpen]);

  const portal = typeof document !== 'undefined' ? createPortal(
    <>
      {liveBanner && (
        <div className="pointer-events-none fixed left-1/2 top-6 z-[120] -translate-x-1/2 rounded-full border border-teal-200/80 bg-slate-950/88 px-5 py-2 text-[11px] font-black tracking-[0.18em] text-teal-100 shadow-[0_18px_50px_rgba(20,184,166,0.28)] backdrop-blur-xl">
          LIVE SIGNAL DETECTED
        </div>
      )}

      {bootOpen && (
        <div className="modal-backdrop modal-backdrop-center z-[110] bg-slate-950/70 backdrop-blur-sm" onClick={() => setBootOpen(false)}>
          <div className="modal-panel modal-panel-sm rounded-2xl border border-teal-300/30 bg-card p-5 text-foreground shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-teal-300/30 bg-teal-400/10 text-teal-400">
                  <Terminal className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-base font-black">치카포 단말기 부팅 완료</h3>
                  <p className="mt-1 text-xs font-bold text-muted-foreground">숨겨진 카드 단말기가 응답했습니다.</p>
                </div>
              </div>
              <button type="button" onClick={() => setBootOpen(false)} className="rounded-xl p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="닫기">
                <X className="h-4 w-4" />
              </button>
            </div>
            {bootLogOpen && (
              <div className="mt-4 rounded-2xl border border-teal-300/25 bg-slate-950 px-4 py-3 font-mono text-[11px] font-bold leading-relaxed text-teal-100">
                <p>CHIKAPO TERMINAL READY</p>
                <p>MARKET SIGNAL: SEARCH CODE ACCEPTED</p>
                <p>LOST CARD INDEX: 0404</p>
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setBootLogOpen((current) => !current)} className="rounded-xl border border-border bg-secondary px-4 py-2 text-xs font-black text-foreground hover:bg-secondary/80">
                부팅 로그 보기
              </button>
              <button type="button" onClick={() => setBootOpen(false)} className="rounded-xl bg-primary px-4 py-2 text-xs font-black text-primary-foreground">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {fortune && (
        <div className="modal-backdrop modal-backdrop-center z-[110] bg-slate-950/70 backdrop-blur-sm" onClick={() => setFortune(null)}>
          <div className="modal-panel modal-panel-sm rounded-2xl border border-sky-200/70 bg-card p-5 text-foreground shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
                  <Sparkles className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-base font-black">오늘의운세</h3>
                  <p className="mt-1 text-xs font-bold text-muted-foreground">{fortune.grade}</p>
                </div>
              </div>
              <button type="button" onClick={() => setFortune(null)} className="rounded-xl p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="닫기">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-3 rounded-2xl border border-border bg-secondary/35 p-4 text-xs font-bold leading-relaxed">
              <p className="text-sm font-black text-foreground">{fortune.message}</p>
              <div className="grid grid-cols-2 gap-2">
                <p><span className="text-muted-foreground">행운 탭</span><br />{fortune.luckyTab}</p>
                <p><span className="text-muted-foreground">행운 색</span><br />{fortune.luckyColor}</p>
              </div>
              <p className="text-muted-foreground">{fortune.caution}</p>
            </div>
            <p className="mt-3 text-[10px] font-bold leading-relaxed text-muted-foreground">
              이 운세는 재미용이며 실제 카드 가치, 거래 결과, 가챠 결과와 관련이 없습니다.
            </p>
          </div>
        </div>
      )}

      {terminalLog && (
        <div className="modal-backdrop modal-backdrop-center z-[110] bg-slate-950/70 backdrop-blur-sm" onClick={() => setTerminalLog(null)}>
          <div className="modal-panel modal-panel-xs rounded-2xl border border-teal-300/30 bg-slate-950 p-5 text-teal-100 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-mono text-sm font-black">CARD TERMINAL</h3>
                <div className="mt-4 space-y-1 font-mono text-[11px] font-bold leading-relaxed">
                  {terminalLog.map((line) => <p key={line}>{line}</p>)}
                </div>
              </div>
              <button type="button" onClick={() => setTerminalLog(null)} className="rounded-xl p-1.5 text-teal-100/70 hover:bg-white/10 hover:text-teal-50" aria-label="닫기">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  ) : null;

  return (
    <>
      {children}
      {portal}
    </>
  );
};
