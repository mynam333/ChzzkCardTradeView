'use client';

import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowRight, Home, RotateCcw, SearchX, Store } from 'lucide-react';
import { isDesktopEasterEggSurface, recordEasterEggDiscovery } from '@/lib/easterEgg';

const LOST_CARD_NAMES = [
  '깨진 링크의 카드',
  '사라진 매물의 흔적',
  '방송 종료 후 남은 신호',
  '없는 페이지의 컬렉터',
  '돌아오지 않은 검색 결과'
];

const DUST_MESSAGES = [
  '카드 표면의 먼지가 살짝 반짝입니다.',
  '없는 경로가 조금 더 또렷해졌습니다.',
  '카드 모서리가 기분 좋게 빛났습니다.',
  '아무것도 추가되지 않았지만 예뻐졌습니다.'
];

export default function NotFound() {
  const router = useRouter();
  const pathname = usePathname();
  const [cardName, setCardName] = React.useState(LOST_CARD_NAMES[0]);
  const [flipped, setFlipped] = React.useState(false);
  const [dustIndex, setDustIndex] = React.useState(0);
  const [dusting, setDusting] = React.useState(false);
  const flipClicksRef = React.useRef(0);
  const dustTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => () => {
    if (dustTimerRef.current !== null) window.clearTimeout(dustTimerRef.current);
  }, []);

  const reshuffleCard = () => {
    setCardName((current) => {
      const next = LOST_CARD_NAMES.filter((name) => name !== current);
      return next[Math.floor(Math.random() * next.length)] || LOST_CARD_NAMES[0];
    });
    setFlipped(false);
  };

  const handleCardClick = () => {
    setFlipped((current) => !current);
    if (!isDesktopEasterEggSurface()) return;
    flipClicksRef.current += 1;
    if (flipClicksRef.current >= 4) {
      flipClicksRef.current = 0;
      recordEasterEggDiscovery('lostCard404');
      window.dispatchEvent(new CustomEvent('chikapo:easter-egg-command', {
        detail: { command: 'lostCard404' }
      }));
    }
  };

  const dustCard = () => {
    setDustIndex((current) => (current + 1) % DUST_MESSAGES.length);
    setDusting(true);
    if (dustTimerRef.current !== null) window.clearTimeout(dustTimerRef.current);
    dustTimerRef.current = window.setTimeout(() => {
      setDusting(false);
      dustTimerRef.current = null;
    }, 700);
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.42),transparent_28%,rgba(45,212,191,0.16)_68%,transparent),repeating-linear-gradient(0deg,rgba(22,136,240,0.05)_0_1px,transparent_1px_12px)] dark:bg-[linear-gradient(120deg,rgba(67,228,210,0.08),transparent_34%,rgba(91,183,255,0.08)_70%,transparent),repeating-linear-gradient(0deg,rgba(67,228,210,0.06)_0_1px,transparent_1px_12px)]" />
      <section className="relative z-10 grid w-full max-w-5xl gap-8 md:grid-cols-[1fr_22rem] md:items-center">
        <div className="space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-card/80 px-4 py-2 text-[11px] font-black text-primary shadow-sm backdrop-blur">
            <span className="h-2 w-2 rounded-full bg-primary shadow-[0_0_14px_var(--primary)]" />
            CHIKAPO LOST INDEX
          </div>
          <div>
            <h1 className="cute-landing-title text-4xl leading-tight text-foreground sm:text-5xl">
              분실 카드 보관소
            </h1>
            <p className="mt-4 max-w-xl text-sm font-bold leading-relaxed text-muted-foreground">
              존재하지 않는 경로에서 낡은 카드 신호가 감지되었습니다.
              보관소에 남은 카드를 확인하거나 원래 화면으로 돌아갈 수 있습니다.
            </p>
          </div>
          <div className="lost-path-receipt max-w-xl">
            <div className="flex items-center gap-2 text-[10px] font-black text-primary">
              <SearchX className="h-3.5 w-3.5" />
              LOST PATH RECEIPT
            </div>
            <p className="mt-2 break-all font-mono text-xs font-bold text-muted-foreground">{pathname || '/unknown'}</p>
            <p className="mt-2 text-[10px] font-bold text-muted-foreground">카드, 포인트, 쿠폰은 움직이지 않았습니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => router.push('/')}
              className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-xs font-black text-primary-foreground"
            >
              <Home className="h-4 w-4" /> 메인으로
            </button>
            <button
              type="button"
              onClick={() => router.push('/shop')}
              className="inline-flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-2 text-xs font-black text-foreground hover:bg-secondary"
            >
              <Store className="h-4 w-4" /> 상점으로
            </button>
            <button
              type="button"
              onClick={reshuffleCard}
              className="inline-flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-2 text-xs font-black text-foreground hover:bg-secondary"
            >
              <RotateCcw className="h-4 w-4" /> 카드 다시 확인
            </button>
            <button
              type="button"
              onClick={dustCard}
              className="inline-flex items-center gap-2 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-2 text-xs font-black text-teal-700 hover:bg-teal-100 dark:border-teal-300/20 dark:bg-teal-400/10 dark:text-teal-100"
            >
              카드 먼지 털기
            </button>
          </div>
          <p className="max-w-xl rounded-2xl border border-border/70 bg-card/70 px-4 py-3 text-xs font-bold text-muted-foreground shadow-sm">
            {DUST_MESSAGES[dustIndex]}
          </p>
        </div>

        <button
          type="button"
          onClick={handleCardClick}
          className="lost-card-scene mx-auto h-[26rem] w-[17rem] max-w-full"
          aria-label="분실 카드 뒤집기"
        >
          <span className={`lost-card ${flipped ? 'lost-card-flipped' : ''} ${dusting ? 'lost-card-dusting' : ''}`}>
            <span className="lost-card-face lost-card-front">
              <span className="lost-card-ribbon">UNKNOWN</span>
              <span className="mt-8 rounded-full border border-white/20 bg-white/10 px-3 py-1 font-mono text-[10px] font-black tracking-[0.18em] text-teal-50">No.0404</span>
              <span className="mt-4 text-6xl font-black text-white">404</span>
              <span className="mt-2 text-[10px] font-black tracking-[0.18em] text-teal-100/70">NOT IN INVENTORY</span>
              <span className="mt-auto text-center text-xl font-black leading-tight text-white">{cardName}</span>
              <span className="mt-4 inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[10px] font-black text-teal-100/90">
                카드 뒤집기 <ArrowRight className="h-3 w-3" />
              </span>
            </span>
            <span className="lost-card-face lost-card-back">
              <span className="lost-card-ribbon">CARD LOG</span>
              <span className="mt-10 font-mono text-xs font-black leading-relaxed text-teal-50">
                PATH: NOT FOUND<br />
                INDEX: 0404<br />
                SIGNAL: WEAK<br />
                ASSET: NONE
              </span>
              <span className="mt-5 w-full rounded-2xl border border-teal-100/20 bg-teal-100/10 px-3 py-2 font-mono text-[10px] font-bold leading-relaxed text-teal-50/80">
                LOST_PATH<br />
                {(pathname || '/unknown').slice(0, 36)}
              </span>
              <span className="mt-auto text-center text-xs font-bold leading-relaxed text-teal-100/80">
                이 카드는 실제 보관함에 추가되지 않습니다.
              </span>
            </span>
          </span>
        </button>
      </section>
    </main>
  );
}
