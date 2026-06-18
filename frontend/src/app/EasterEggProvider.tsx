'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { Radio, Sparkles, Terminal, X } from 'lucide-react';
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

const BOOT_TUNE_LINES = [
  '신호가 살짝 간지러워합니다.',
  '카드 단말기가 작은 불빛을 한 번 깜빡였습니다.',
  '없는 카드 번호가 얌전히 줄을 섰습니다.',
  '보상 회로는 잠겨 있고 재미 회로만 켜졌습니다.'
];

const FORTUNE_SHAKE_LINES = [
  '카드가 아주 작게 반짝였습니다.',
  '오늘의 신호가 한 번 더 굴러갔습니다.',
  '가챠 단말기가 모른 척 고개를 돌렸습니다.',
  '행운 색이 잠깐 더 진해졌습니다.'
];

const TERMINAL_SCAN_LINES = [
  'SCAN: EMPTY BUT CUTE',
  'POINT ROUTE: CLOSED',
  'CARD ROUTE: CLOSED',
  'DISPLAY ROUTE: OPEN'
];

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
  const [bootTuneIndex, setBootTuneIndex] = React.useState(0);
  const [fortuneShakeIndex, setFortuneShakeIndex] = React.useState(0);
  const [terminalScanIndex, setTerminalScanIndex] = React.useState(0);
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
        setBootTuneIndex(0);
        setBootLogOpen(false);
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
        <div className="easter-live-banner pointer-events-none fixed left-1/2 top-6 z-[120] -translate-x-1/2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-white shadow-[0_0_18px_rgba(239,68,68,0.5)]">
            <Radio className="h-3.5 w-3.5" />
          </span>
          <span className="font-mono text-[11px] font-black tracking-[0.18em]">LIVE SIGNAL DETECTED</span>
          <span className="easter-signal-bars" aria-hidden="true"><i /><i /><i /></span>
          <span className="rounded-full border border-white/20 px-2 py-0.5 text-[9px] font-black text-teal-100/80">NO ASSET</span>
        </div>
      )}

      {bootOpen && (
        <div className="modal-backdrop modal-backdrop-center z-[110] bg-slate-950/70 backdrop-blur-sm" onClick={() => setBootOpen(false)}>
          <div className="easter-modal-card easter-terminal-modal modal-panel modal-panel-sm text-foreground" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-teal-200/50 pb-4 dark:border-teal-300/15">
              <div className="flex items-center gap-3">
                <span className="easter-icon-tile flex h-12 w-12 items-center justify-center rounded-2xl text-teal-600 dark:text-teal-200">
                  <Terminal className="h-5 w-5" />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-black">치카포 단말기 부팅 완료</h3>
                    <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[9px] font-black text-teal-700 dark:border-teal-300/20 dark:bg-teal-400/10 dark:text-teal-100">
                      FUN MODE
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-bold text-muted-foreground">보관함 밖에서만 반짝이는 작은 단말기입니다.</p>
                </div>
              </div>
              <button type="button" onClick={() => setBootOpen(false)} className="rounded-xl p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="닫기">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 grid gap-2 text-[11px] font-black sm:grid-cols-3">
              <div className="easter-status-chip">
                <span>POINT</span>
                <b>BLOCKED</b>
              </div>
              <div className="easter-status-chip">
                <span>CARD</span>
                <b>BLOCKED</b>
              </div>
              <div className="easter-status-chip">
                <span>FUN</span>
                <b>READY</b>
              </div>
            </div>
            <div className="mt-4 rounded-2xl border border-teal-200/70 bg-teal-50/70 px-4 py-3 text-xs font-bold text-teal-800 dark:border-teal-300/15 dark:bg-teal-400/10 dark:text-teal-100">
              <div className="flex items-center justify-between gap-3">
                <p>{BOOT_TUNE_LINES[bootTuneIndex]}</p>
                <button
                  type="button"
                  onClick={() => setBootTuneIndex((current) => (current + 1) % BOOT_TUNE_LINES.length)}
                  className="shrink-0 rounded-full border border-teal-200 bg-white/75 px-3 py-1 text-[10px] font-black text-teal-700 hover:bg-white dark:border-teal-300/20 dark:bg-white/10 dark:text-teal-100"
                >
                  주파수 맞추기
                </button>
              </div>
            </div>
            {bootLogOpen && (
              <div className="easter-terminal-log mt-4">
                <p><span>01</span> CHIKAPO TERMINAL READY</p>
                <p><span>02</span> MARKET SIGNAL: SEARCH CODE ACCEPTED</p>
                <p><span>03</span> LOST CARD INDEX: 0404</p>
                <p><span>04</span> REWARD ROUTE: DISABLED</p>
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
          <div className="easter-modal-card easter-fortune-card modal-panel modal-panel-sm text-foreground" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="easter-icon-tile flex h-12 w-12 items-center justify-center rounded-2xl text-primary">
                  <Sparkles className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-[10px] font-black tracking-[0.16em] text-primary/80">FREE GACHA SIGNAL</p>
                  <h3 className="mt-0.5 text-lg font-black">오늘의운세</h3>
                  <p className="mt-1 text-xs font-bold text-muted-foreground">무료 가챠 단말기가 오늘의 표정을 읽었습니다.</p>
                </div>
              </div>
              <button type="button" onClick={() => setFortune(null)} className="rounded-xl p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="닫기">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="easter-fortune-ticket mt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-full bg-primary px-3 py-1 text-[10px] font-black text-primary-foreground">{fortune.grade}</span>
                <span className="font-mono text-[10px] font-black text-muted-foreground">NO. TODAY</span>
              </div>
              <p className={`mt-4 text-base font-black leading-relaxed text-foreground ${fortuneShakeIndex > 0 ? 'easter-fortune-shake' : ''}`}>{fortune.message}</p>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-black">
                <div className="rounded-2xl border border-border/70 bg-card/75 px-3 py-2">
                  <span className="text-[10px] text-muted-foreground">행운 탭</span>
                  <p className="mt-0.5 text-foreground">{fortune.luckyTab}</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-card/75 px-3 py-2">
                  <span className="text-[10px] text-muted-foreground">행운 색</span>
                  <p className="mt-0.5 text-foreground">{fortune.luckyColor}</p>
                </div>
              </div>
              <p className="mt-3 rounded-2xl bg-secondary/70 px-3 py-2 text-xs font-bold leading-relaxed text-muted-foreground">{fortune.caution}</p>
              <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card/70 px-3 py-2">
                <p className="text-xs font-bold text-muted-foreground">{FORTUNE_SHAKE_LINES[fortuneShakeIndex]}</p>
                <button
                  type="button"
                  onClick={() => setFortuneShakeIndex((current) => (current + 1) % FORTUNE_SHAKE_LINES.length)}
                  className="shrink-0 rounded-full bg-primary px-3 py-1 text-[10px] font-black text-primary-foreground"
                >
                  카드 흔들기
                </button>
              </div>
            </div>
            <p className="mt-3 text-[10px] font-bold leading-relaxed text-muted-foreground">
              이 운세는 재미용이며 실제 카드 가치, 거래 결과, 가챠 결과와 관련이 없습니다.
            </p>
          </div>
        </div>
      )}

      {terminalLog && (
        <div className="modal-backdrop modal-backdrop-center z-[110] bg-slate-950/70 backdrop-blur-sm" onClick={() => setTerminalLog(null)}>
          <div className="easter-terminal-ticket modal-panel modal-panel-xs" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4" />
                  <h3 className="font-mono text-sm font-black">CARD TERMINAL</h3>
                </div>
                <div className="mt-4 space-y-1 font-mono text-[11px] font-bold leading-relaxed">
                  {terminalLog.map((line) => <p key={line}>{line}</p>)}
                  <p className="text-teal-100/75">{TERMINAL_SCAN_LINES[terminalScanIndex]}</p>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTerminalScanIndex((current) => (current + 1) % TERMINAL_SCAN_LINES.length)}
                    className="rounded-full border border-teal-100/20 px-3 py-1 text-[9px] font-black tracking-[0.14em] text-teal-100/75 hover:bg-white/10"
                  >
                    신호 스캔
                  </button>
                  <span className="rounded-full border border-teal-100/20 px-3 py-1 text-[9px] font-black tracking-[0.14em] text-teal-100/75">
                    DISPLAY ONLY
                  </span>
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
