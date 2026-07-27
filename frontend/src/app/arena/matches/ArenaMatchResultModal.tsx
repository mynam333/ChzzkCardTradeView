'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight,
  Crown,
  Eye,
  LogOut,
  Medal,
  Minus,
  Swords,
  TrendingDown,
  TrendingUp
} from 'lucide-react';
import styles from './ArenaMatchResultModal.module.css';

export type ArenaMatchOutcome = 'win' | 'loss' | 'draw';

export interface ArenaMatchResultModalProps {
  open: boolean;
  outcome: ArenaMatchOutcome;
  modeLabel: string;
  mmrBefore?: number | null;
  mmrAfter?: number | null;
  mmrDelta?: number | null;
  unrated?: boolean;
  placement?: number | null;
  isBattleRoyale?: boolean;
  sharedPlacement?: boolean;
  round?: number | null;
  canSpectate?: boolean;
  hasNextMatch?: boolean;
  onExit: () => void;
  onSpectate?: () => void;
  onContinue?: () => void;
}

const numberFormatter = new Intl.NumberFormat('ko-KR');

const outcomeCopy: Record<ArenaMatchOutcome, { eyebrow: string; title: string; description: string }> = {
  win: {
    eyebrow: 'BATTLE COMPLETE',
    title: '승리',
    description: '마지막 전투까지 멋지게 마무리했습니다.'
  },
  loss: {
    eyebrow: 'BATTLE COMPLETE',
    title: '패배',
    description: '전투는 끝났지만 다음 전략을 준비할 수 있습니다.'
  },
  draw: {
    eyebrow: 'BATTLE COMPLETE',
    title: '무승부',
    description: '팽팽한 승부 끝에 같은 결과를 기록했습니다.'
  }
};

const isFiniteNumber = (value: number | null | undefined): value is number => Number.isFinite(value);
const subscribeToClient = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function ArenaMatchResultModal({
  open,
  outcome,
  modeLabel,
  mmrBefore,
  mmrAfter,
  mmrDelta,
  unrated = false,
  placement,
  isBattleRoyale = false,
  sharedPlacement = false,
  round,
  canSpectate = false,
  hasNextMatch = false,
  onExit,
  onSpectate,
  onContinue
}: ArenaMatchResultModalProps) {
  const mounted = React.useSyncExternalStore(subscribeToClient, getClientSnapshot, getServerSnapshot);
  const [explicitActionHint, setExplicitActionHint] = React.useState(false);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const continueButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const spectateButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const exitButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();
  const hintId = React.useId();
  const hasPlacement = isFiniteNumber(placement) && placement > 0;
  const canContinue = hasNextMatch && Boolean(onContinue);
  const canOpenSpectator = canSpectate && Boolean(onSpectate);


  React.useEffect(() => {
    if (!open || !mounted) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const frame = window.requestAnimationFrame(() => {
      setExplicitActionHint(false);
      const primaryButton = canContinue
        ? continueButtonRef.current
        : canOpenSpectator
          ? spectateButtonRef.current
          : exitButtonRef.current;
      (primaryButton || dialogRef.current)?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus({ preventScroll: true });
      previousFocusRef.current = null;
    };
  }, [canContinue, canOpenSpectator, mounted, open]);

  if (!mounted || !open) return null;

  const copy = isBattleRoyale && !hasPlacement
    ? {
        ...outcomeCopy[outcome],
        eyebrow: 'ROUND RESULT',
        description: hasNextMatch
          ? '이번 라운드 결과가 확정되었습니다. 다음 경기를 준비해 주세요.'
          : '이번 라운드 전투가 끝났습니다. 남은 경기 결과를 집계하고 있습니다.'
      }
    : outcomeCopy[outcome];
  const hasRatedResult = !unrated
    && isFiniteNumber(mmrBefore)
    && isFiniteNumber(mmrAfter)
    && isFiniteNumber(mmrDelta);
  const delta = hasRatedResult ? mmrDelta : 0;
  const OutcomeIcon = outcome === 'win' ? Crown : outcome === 'loss' ? TrendingDown : Minus;
  const outcomeClass = outcome === 'win' ? styles.win : outcome === 'loss' ? styles.loss : styles.draw;

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setExplicitActionHint(true);
      const primaryButton = canContinue
        ? continueButtonRef.current
        : canOpenSpectator
          ? spectateButtonRef.current
          : exitButtonRef.current;
      primaryButton?.focus();
      return;
    }

    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled)')
    );
    if (!focusable.length) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className={`${styles.overlay} ${outcomeClass}`}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        setExplicitActionHint(true);
        exitButtonRef.current?.focus();
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId} ${hintId}`}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
      >
        <div className={styles.ambient} aria-hidden="true">
          <span className={styles.orbit} />
          <span className={styles.sparkOne} />
          <span className={styles.sparkTwo} />
          <span className={styles.sparkThree} />
        </div>

        <header className={styles.hero}>
          <div className={styles.resultIcon} aria-hidden="true">
            <OutcomeIcon />
          </div>
          <div className={styles.eyebrow}>{copy.eyebrow}</div>
          <h2 id={titleId}>{copy.title}</h2>
          <p id={descriptionId}>{copy.description}</p>
          <div className={styles.contextChips} aria-label="경기 정보">
            <span><Swords aria-hidden="true" />{modeLabel}</span>
            {isFiniteNumber(round) && round > 0 ? <span>ROUND {round}</span> : null}
          </div>
        </header>

        <div className={styles.content}>
          {isBattleRoyale ? (
            <section className={styles.placementCard} aria-label="8인전 등수">
              <div className={styles.placementIcon} aria-hidden="true"><Medal /></div>
              <div>
                <span>{hasPlacement ? '8인전 최종 결과' : '8인전 진행 결과'}</span>
                <strong>
                  {hasPlacement
                    ? <>{sharedPlacement ? '공동 ' : ''}{placement}위</>
                    : hasNextMatch ? '생존 중 · 다음 경기 준비' : '라운드 결과 집계 중'}
                </strong>
              </div>
              <small>
                {hasPlacement
                  ? '이번 8인전을 마쳤습니다.'
                  : hasNextMatch ? '다음 경기가 준비되었습니다.' : '남은 경기 결과를 확인하고 있습니다.'}
              </small>
            </section>
          ) : null}

          <section className={styles.ratingCard} aria-label="MMR 변동">
            <div className={styles.sectionHeading}>
              <span>MMR 결과</span>
              {hasRatedResult ? (
                <strong className={delta > 0 ? styles.positive : delta < 0 ? styles.negative : styles.neutral}>
                  {delta > 0 ? '+' : ''}{numberFormatter.format(delta)}
                </strong>
              ) : (
                <strong className={styles.unrated}>영향 없음</strong>
              )}
            </div>

            {hasRatedResult ? (
              <div className={styles.ratingFlow}>
                <div><span>경기 전</span><strong>{numberFormatter.format(mmrBefore)}</strong></div>
                <ArrowRight aria-label="에서" />
                <div><span>경기 후</span><strong>{numberFormatter.format(mmrAfter)}</strong></div>
              </div>
            ) : (
              <div className={styles.unratedMessage}>
                <TrendingUp aria-hidden="true" />
                <div>
                  <strong>비랭크 경기</strong>
                  <span>이 경기 결과는 빠른대전 MMR에 반영되지 않습니다.</span>
                </div>
              </div>
            )}
          </section>

          {hasNextMatch ? (
            <div className={styles.nextMatchNotice} role="status">
              <span aria-hidden="true" />
              8인전이 계속됩니다. 준비된 다음 경기로 이동할 수 있습니다.
            </div>
          ) : null}
        </div>

        <footer className={styles.footer}>
          <div className={styles.actions}>
            {canContinue && onContinue ? (
              <button ref={continueButtonRef} type="button" className={styles.primaryAction} onClick={onContinue}>
                다음 경기로 <ArrowRight aria-hidden="true" />
              </button>
            ) : null}
            {canOpenSpectator && onSpectate ? (
              <button ref={spectateButtonRef} type="button" className={styles.spectateAction} onClick={onSpectate}>
                <Eye aria-hidden="true" /> 남은 경기 관전
              </button>
            ) : null}
            <button ref={exitButtonRef} type="button" className={styles.exitAction} onClick={onExit}>
              <LogOut aria-hidden="true" /> 아레나 나가기
            </button>
          </div>
          <p
            id={hintId}
            className={`${styles.actionHint} ${explicitActionHint ? styles.isEmphasized : ''}`}
            aria-live="polite"
          >
            {explicitActionHint
              ? '결과 화면은 자동으로 닫히지 않습니다. 위 버튼 중 하나를 선택해 주세요.'
              : '결과를 확인한 뒤 원하는 다음 행동을 선택해 주세요.'}
          </p>
        </footer>
      </div>
    </div>,
    document.body
  );
}

export default ArenaMatchResultModal;
