'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { BellRing, Check, CircleAlert, Clock3, LoaderCircle, Radio, Search, ShieldCheck, Swords, Volume2, VolumeX } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { arenaCoreTooltips } from '@/lib/arenaTooltips';
import { ArenaTooltip } from './ArenaTooltip';
import {
  createIdleArenaQuickMatchSnapshot,
  formatArenaQuickMatchElapsed,
  getArenaQuickMatchPollDelayMs,
  getArenaQuickMatchProposalProgress,
  isCurrentArenaQuickMatchOperation,
  mergeArenaQuickMatchSnapshot,
  normalizeArenaQuickMatchResponse,
  type ArenaQuickMatchSnapshot
} from './arenaQuickMatch';
import styles from './ArenaQuickMatchFlow.module.css';

type BusyAction = 'join' | 'accept' | 'cancel' | null;
type NoticeTone = 'success' | 'error' | 'info';
type SoundStatus = 'off' | 'on' | 'unavailable';

type ArenaQuickMatchFlowProps = {
  deckId: string;
  seasonId?: string;
  initialStatus?: unknown;
  onMissingDeck: () => void;
  onBeforeSearch?: () => Promise<boolean> | boolean;
  onMatch: (matchId: string) => void;
  notify?: (message: string, tone: NoticeTone) => void;
};

const pollablePhases = new Set(['searching', 'proposal', 'accepted']);
const serverQueuePhases = new Set(['joining', 'searching', 'proposal', 'accepted']);
const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const getErrorMessage = (value: unknown, fallback: string) => {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.trim()) return record.message;
  }
  return fallback;
};

const isAbortError = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

const ArenaQuickMatchDialog: React.FC<{
  open: boolean;
  snapshot: ArenaQuickMatchSnapshot;
  busyAction: BusyAction;
  nowMs: number;
  connectionIssue: boolean;
  errorMessage: string;
  proposalError: string;
  soundStatus: SoundStatus;
  onAccept: () => void;
  onCancel: () => void;
  onEnableSound: () => void;
  onRetry: () => void;
}> = ({ open, snapshot, busyAction, nowMs, connectionIssue, errorMessage, proposalError, soundStatus, onAccept, onCancel, onEnableSound, onRetry }) => {
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const serverNowMs = nowMs + (snapshot.serverClockOffsetMs ?? 0);
  const elapsed = formatArenaQuickMatchElapsed(snapshot.searchStartedAtMs, serverNowMs);
  const proposalClock = getArenaQuickMatchProposalProgress(snapshot.acceptDeadlineAtMs, serverNowMs);
  const canCancel = snapshot.phase === 'searching' || snapshot.phase === 'error';
  const canAccept = snapshot.phase === 'proposal'
    && Boolean(snapshot.proposalId && snapshot.acceptDeadlineAtMs)
    && proposalClock.remainingMs > 0
    && busyAction === null;
  const mmrRange = snapshot.minMmr !== null && snapshot.maxMmr !== null
    ? `${snapshot.minMmr.toLocaleString()}–${snapshot.maxMmr.toLocaleString()}`
    : '계산 중';

  React.useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const target = dialogRef.current?.querySelector<HTMLElement>('[data-quick-match-autofocus]');
      (target || dialogRef.current)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, snapshot.phase]);

  if (!open || typeof document === 'undefined') return null;

  const heading = snapshot.phase === 'proposal'
    ? '대전 상대를 찾았어요'
    : snapshot.phase === 'accepted'
      ? '매칭 확인을 보냈어요'
      : snapshot.phase === 'error'
        ? '탐색 상태를 확인해 주세요'
        : snapshot.transitionReason
          ? '상대를 다시 찾고 있어요'
          : snapshot.phase === 'joining' ? '대기열에 연결하고 있어요' : '실력이 비슷한 상대를 찾고 있어요';
  const description = snapshot.phase === 'proposal'
    ? '10초 안에 확인해 주세요. 응답하지 않으면 내 탐색이 종료되고 반복 미응답 시 매칭 우선순위가 낮아질 수 있습니다.'
    : snapshot.phase === 'accepted'
      ? '상대의 확인만 남았습니다. 상대가 응답하지 않으면 같은 창에서 자동으로 다시 탐색합니다.'
      : snapshot.phase === 'error'
        ? errorMessage
        : snapshot.transitionReason
          ? snapshot.transitionReason === 'opponent_invalid_deck'
            ? '이전 상대의 덱이 대전 규칙을 통과하지 못해 기존 경과 시간과 범위를 유지한 채 다시 연결하고 있습니다.'
            : snapshot.transitionReason === 'opponent_cancelled'
              ? '이전 상대가 탐색을 취소해 기존 경과 시간과 범위를 유지한 채 다시 연결하고 있습니다.'
              : '이전 상대의 응답 시간이 지나 탐색 범위를 유지한 채 다시 연결하고 있습니다.'
          : '내 MMR을 기준으로 범위를 조금씩 넓히며 상대를 찾습니다.';

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (canCancel && busyAction === null) onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) || []);
    if (!focusable.length) {
      event.preventDefault();
      dialogRef.current?.focus();
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
    <div className={styles.backdrop} onPointerDown={(event) => {
      if (event.target === event.currentTarget) event.preventDefault();
    }}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="arena-quick-match-title"
        aria-describedby="arena-quick-match-description"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.dialogScroll}>
          <header className={styles.header}>
            <div className={`${styles.signal} ${snapshot.phase === 'proposal' ? styles.proposalSignal : ''}`} aria-hidden="true">
              {snapshot.phase === 'proposal' ? <BellRing /> : snapshot.phase === 'accepted' ? <ShieldCheck /> : <Radio />}
            </div>
            <div>
              <h2 id="arena-quick-match-title">{heading}</h2>
              <p id="arena-quick-match-description">{description}</p>
            </div>
          </header>

          <div className={styles.soundControl}>
            <button
              type="button"
              className={styles.soundButton}
              onClick={onEnableSound}
              disabled={soundStatus !== 'off'}
              aria-pressed={soundStatus === 'on'}
              aria-describedby="arena-quick-match-sound-help"
            >
              {soundStatus === 'on' ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
              {soundStatus === 'on' ? '알림음 켜짐' : soundStatus === 'unavailable' ? '알림음 미지원' : '알림음 켜기'}
            </button>
            <span id="arena-quick-match-sound-help">
              {soundStatus === 'on' ? '새 제안을 소리로 알려드려요.' : '복원된 탐색은 브라우저 정책상 직접 켜야 해요.'}
            </span>
          </div>

          <p className={styles.liveStatus} role="status" aria-live={snapshot.phase === 'proposal' ? 'assertive' : 'polite'}>
            {connectionIssue ? '서버 연결을 다시 확인하고 있습니다.' : snapshot.phase === 'proposal' ? '매칭 제안이 도착했습니다.' : heading}
          </p>

          <dl className={styles.metrics}>
            <div><dt><Clock3 aria-hidden="true" /> 탐색 경과</dt><dd>{elapsed}</dd></div>
            <div><dt><Search aria-hidden="true" /> 현재 MMR 범위</dt><dd>{mmrRange}</dd></div>
          </dl>

          {snapshot.phase === 'accepted' ? (
            <section className={styles.waitingPanel} aria-label="상대 확인 대기">
              <div className={styles.waitingCopy}>
                <LoaderCircle className={styles.spin} aria-hidden="true" />
                <div><strong>상대 확인을 기다리는 중</strong><span>두 플레이어가 모두 확인하기 전까지 상대 정보는 공개되지 않습니다.</span></div>
                <b>{proposalClock.remainingSeconds}초</b>
              </div>
              <div
                className={styles.progressTrack}
                role="progressbar"
                aria-label="상대 확인 남은 시간"
                aria-valuemin={0}
                aria-valuemax={10}
                aria-valuenow={proposalClock.remainingSeconds}
              >
                <span style={{ '--quick-match-progress': `${proposalClock.progress * 100}%` } as React.CSSProperties} />
              </div>
            </section>
          ) : snapshot.phase === 'error' ? (
            <button type="button" className={styles.retryButton} onClick={onRetry} disabled={busyAction !== null} data-quick-match-autofocus>
              <Search /> 다시 탐색
            </button>
          ) : snapshot.phase === 'proposal' ? (
            <div className={styles.proposalPrivacy}><ShieldCheck aria-hidden="true" /> 양쪽 확인 전에는 상대 정보가 공개되지 않습니다.</div>
          ) : (
            <div className={styles.searchingVisual} aria-hidden="true"><span /><Search /></div>
          )}
        </div>

        {snapshot.phase === 'proposal' ? (
          <section className={styles.proposalPanel} aria-label="매칭 제안 확인">
            <div className={styles.countdown}><strong>{proposalClock.remainingSeconds}</strong><span>초 남음</span></div>
            <div
              className={styles.progressTrack}
              role="progressbar"
              aria-label="매칭 확인 남은 시간"
              aria-valuemin={0}
              aria-valuemax={10}
              aria-valuenow={proposalClock.remainingSeconds}
            >
              <span style={{ '--quick-match-progress': `${proposalClock.progress * 100}%` } as React.CSSProperties} />
            </div>
            <button type="button" className={styles.acceptButton} onClick={onAccept} disabled={!canAccept} data-quick-match-autofocus>
              {busyAction === 'accept' ? <LoaderCircle className={styles.spin} /> : proposalError ? <CircleAlert /> : <Check />}
              {proposalClock.remainingMs <= 0 ? '제안 상태 확인 중' : proposalError ? '매칭 확인 다시 시도' : '매칭 확인'}
            </button>
            {proposalError ? <p className={styles.proposalError} role="alert"><CircleAlert aria-hidden="true" /><span>{proposalError}</span></p> : null}
            {!snapshot.acceptDeadlineAtMs || !snapshot.proposalId ? <p className={styles.failClosed}>제안 정보를 안전하게 다시 확인하고 있습니다.</p> : null}
            <p className={styles.dockHint}>확인 중에는 Esc로 창을 닫을 수 없습니다.</p>
          </section>
        ) : (
          <footer className={styles.footer}>
            {canCancel ? (
              <button type="button" className={styles.cancelButton} onClick={onCancel} disabled={busyAction !== null} data-quick-match-autofocus={snapshot.phase === 'searching' ? true : undefined}>
                {busyAction === 'cancel' ? <LoaderCircle className={styles.spin} /> : null} 탐색 취소
              </button>
            ) : (
              <span>확인이 끝날 때까지 이 창을 유지합니다.</span>
            )}
          </footer>
        )}
      </div>
    </div>,
    document.body
  );
};

export const ArenaQuickMatchFlow: React.FC<ArenaQuickMatchFlowProps> = ({ deckId, seasonId, initialStatus, onMissingDeck, onBeforeSearch, onMatch, notify }) => {
  const [open, setOpen] = React.useState(false);
  const [snapshot, setSnapshot] = React.useState<ArenaQuickMatchSnapshot>(() => createIdleArenaQuickMatchSnapshot());
  const [busyAction, setBusyAction] = React.useState<BusyAction>(null);
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const [connectionIssue, setConnectionIssue] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState('');
  const [proposalError, setProposalError] = React.useState('');
  const [soundStatus, setSoundStatus] = React.useState<SoundStatus>('off');
  const [pollGeneration, setPollGeneration] = React.useState(0);
  const snapshotRef = React.useRef(snapshot);
  const busyActionRef = React.useRef<BusyAction>(null);
  const actionRequestRef = React.useRef(0);
  const pollRequestRef = React.useRef(0);
  const operationEpochRef = React.useRef(0);
  const pollAbortRef = React.useRef<AbortController | null>(null);
  const actionAbortRef = React.useRef<AbortController | null>(null);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const soundedProposalRef = React.useRef<string | null>(null);
  const navigatedMatchRef = React.useRef<string | null>(null);
  const initialStatusRef = React.useRef<unknown>(null);
  const seasonIdRef = React.useRef(seasonId);
  const onMatchRef = React.useRef(onMatch);
  const notifyRef = React.useRef(notify);

  React.useEffect(() => { seasonIdRef.current = seasonId; }, [seasonId]);
  React.useEffect(() => { onMatchRef.current = onMatch; }, [onMatch]);
  React.useEffect(() => { notifyRef.current = notify; }, [notify]);

  const setBusy = React.useCallback((value: BusyAction) => {
    busyActionRef.current = value;
    setBusyAction(value);
  }, []);

  const beginAction = React.useCallback((action: Exclude<BusyAction, null>) => {
    const operationEpoch = ++operationEpochRef.current;
    pollRequestRef.current += 1;
    pollAbortRef.current?.abort();
    setBusy(action);
    const requestId = ++actionRequestRef.current;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    return { controller, operationEpoch, requestId };
  }, [setBusy]);

  const restartPolling = React.useCallback(() => {
    setPollGeneration((generation) => generation + 1);
  }, []);

  const cancelServerQueueSilently = React.useCallback((reason: string) => {
    const activeSeasonId = seasonIdRef.current;
    void apiFetch('/arena/matchmaking/quick/cancel', {
      method: 'POST',
      keepalive: true,
      body: JSON.stringify({ seasonId: activeSeasonId, reason })
    }).catch(() => undefined);
  }, []);

  const unlockAudio = React.useCallback(async () => {
    const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) {
      setSoundStatus('unavailable');
      return false;
    }
    try {
      const previousContext = audioContextRef.current;
      const context = previousContext && previousContext.state !== 'closed' ? previousContext : new AudioContextClass();
      audioContextRef.current = context;
      context.onstatechange = () => {
        if (context.state !== 'closed') setSoundStatus(context.state === 'running' ? 'on' : 'off');
      };
      if (context.state === 'suspended') await context.resume();
      if (context.state !== 'running') {
        setSoundStatus('off');
        return false;
      }
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      gain.gain.value = 0.0001;
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.02);
      setSoundStatus('on');
      return true;
    } catch {
      setSoundStatus('off');
      return false;
    }
  }, []);

  const playProposalSound = React.useCallback(() => {
    const context = audioContextRef.current;
    if (!context || context.state !== 'running') return false;
    try {
      [659.25, 783.99].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime + index * 0.13;
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.16, start + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.24);
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  React.useEffect(() => {
    const proposalId = snapshot.proposalId;
    if (soundStatus !== 'on' || snapshot.phase !== 'proposal' || !proposalId || soundedProposalRef.current === proposalId) return;
    if (playProposalSound()) soundedProposalRef.current = proposalId;
  }, [playProposalSound, snapshot.phase, snapshot.proposalId, soundStatus]);

  const applyResponse = React.useCallback((raw: unknown) => {
    const receivedAtMs = Date.now();
    const incoming = normalizeArenaQuickMatchResponse(raw, receivedAtMs);
    const previous = snapshotRef.current;
    const serverNowMs = receivedAtMs + (incoming.serverClockOffsetMs ?? previous.serverClockOffsetMs ?? 0);
    const next = mergeArenaQuickMatchSnapshot(previous, incoming, serverNowMs);
    snapshotRef.current = next;
    setSnapshot(next);
    setConnectionIssue(false);
    setErrorMessage(next.phase === 'error'
      ? next.message || (next.rawStatus === 'accept_timeout'
        ? '매칭 확인 시간이 지나 탐색이 종료되었습니다. 다시 탐색해 주세요.'
        : '매칭 제안이 종료되었습니다. 다시 탐색해 주세요.')
      : '');
    if (next.phase !== 'proposal' || next.proposalId !== previous.proposalId) setProposalError('');
    if ((previous.phase === 'proposal' || previous.phase === 'accepted') && next.phase === 'searching') {
      notifyRef.current?.(
        next.transitionReason === 'opponent_invalid_deck'
          ? '상대의 덱이 대전 규칙을 통과하지 못해 자동으로 다시 찾습니다.'
          : next.transitionReason === 'opponent_cancelled'
            ? '상대가 탐색을 취소해 자동으로 다시 찾습니다.'
            : '상대 응답 시간이 지나 자동으로 다시 탐색합니다.',
        'info'
      );
    }
    if (next.phase === 'matched' && next.matchId && navigatedMatchRef.current !== next.matchId) {
      navigatedMatchRef.current = next.matchId;
      setOpen(false);
      notifyRef.current?.('두 플레이어가 매칭을 확인했습니다.', 'success');
      onMatchRef.current(next.matchId);
    }
    return next;
  }, []);

  const startSearch = React.useCallback(async () => {
    if (!deckId) {
      onMissingDeck();
      return;
    }
    if (busyActionRef.current) return;
    if (onBeforeSearch) {
      const canSearch = await onBeforeSearch();
      if (!canSearch || busyActionRef.current) return;
    }
    const { controller, operationEpoch, requestId } = beginAction('join');
    void unlockAudio();
    const startedAtMs = Date.now();
    const joining = { ...createIdleArenaQuickMatchSnapshot(), phase: 'joining' as const, rawStatus: 'joining', searchStartedAtMs: startedAtMs };
    snapshotRef.current = joining;
    setSnapshot(joining);
    setOpen(true);
    setErrorMessage('');
    setProposalError('');
    setConnectionIssue(false);
    try {
      const response = await apiFetch('/arena/matchmaking/quick/join', {
        method: 'POST',
        body: JSON.stringify({ deckId, seasonId }),
        signal: controller.signal
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(getErrorMessage(json, '빠른대전 탐색을 시작하지 못했습니다.'));
      if (!isCurrentArenaQuickMatchOperation(requestId, actionRequestRef.current, operationEpoch, operationEpochRef.current)) return;
      applyResponse(json);
      notifyRef.current?.('빠른대전 상대를 찾기 시작했습니다.', 'success');
    } catch (error) {
      if (isAbortError(error) || !isCurrentArenaQuickMatchOperation(requestId, actionRequestRef.current, operationEpoch, operationEpochRef.current)) return;
      const failed = { ...snapshotRef.current, phase: 'error' as const, rawStatus: 'error' };
      snapshotRef.current = failed;
      setSnapshot(failed);
      setErrorMessage(error instanceof Error ? error.message : '빠른대전 탐색을 시작하지 못했습니다.');
    } finally {
      if (isCurrentArenaQuickMatchOperation(requestId, actionRequestRef.current, operationEpoch, operationEpochRef.current)) setBusy(null);
    }
  }, [applyResponse, beginAction, deckId, onBeforeSearch, onMissingDeck, seasonId, setBusy, unlockAudio]);

  const acceptProposal = React.useCallback(async () => {
    const current = snapshotRef.current;
    const serverNowMs = Date.now() + (current.serverClockOffsetMs ?? 0);
    if (busyActionRef.current || current.phase !== 'proposal' || !current.proposalId || !current.acceptDeadlineAtMs || current.acceptDeadlineAtMs <= serverNowMs) return;
    const { controller, operationEpoch, requestId } = beginAction('accept');
    setProposalError('');
    try {
      const response = await apiFetch('/arena/matchmaking/quick/accept', {
        method: 'POST',
        body: JSON.stringify({ seasonId, proposalId: current.proposalId }),
        signal: controller.signal
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(getErrorMessage(json, '매칭 확인을 처리하지 못했습니다.'));
      if (!isCurrentArenaQuickMatchOperation(requestId, actionRequestRef.current, operationEpoch, operationEpochRef.current)) return;
      setProposalError('');
      applyResponse(json);
    } catch (error) {
      if (isAbortError(error) || !isCurrentArenaQuickMatchOperation(requestId, actionRequestRef.current, operationEpoch, operationEpochRef.current)) return;
      setProposalError(error instanceof Error ? error.message : '매칭 확인을 처리하지 못했습니다. 다시 시도해 주세요.');
      setConnectionIssue(true);
      restartPolling();
    } finally {
      if (isCurrentArenaQuickMatchOperation(requestId, actionRequestRef.current, operationEpoch, operationEpochRef.current)) setBusy(null);
    }
  }, [applyResponse, beginAction, restartPolling, seasonId, setBusy]);

  const cancelSearch = React.useCallback(async () => {
    if (busyActionRef.current) return;
    if (snapshotRef.current.phase === 'error') {
      const idle = createIdleArenaQuickMatchSnapshot();
      snapshotRef.current = idle;
      setSnapshot(idle);
      setOpen(false);
      setErrorMessage('');
      setProposalError('');
      setConnectionIssue(false);
      return;
    }
    const { controller, operationEpoch, requestId } = beginAction('cancel');
    try {
      const response = await apiFetch('/arena/matchmaking/quick/cancel', {
        method: 'POST',
        body: JSON.stringify({ seasonId }),
        signal: controller.signal
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(getErrorMessage(json, '탐색을 취소하지 못했습니다.'));
      if (!isCurrentArenaQuickMatchOperation(requestId, actionRequestRef.current, operationEpoch, operationEpochRef.current)) return;
      const normalized = normalizeArenaQuickMatchResponse(json);
      if (normalized.matchId) {
        const responseRecord = json && typeof json === 'object' ? json as Record<string, unknown> : {};
        applyResponse({ ...responseRecord, status: 'matched', matchId: normalized.matchId });
        return;
      }
      const idle = createIdleArenaQuickMatchSnapshot();
      snapshotRef.current = idle;
      setSnapshot(idle);
      setOpen(false);
      setProposalError('');
      notifyRef.current?.('빠른대전 탐색을 취소했습니다.', 'success');
    } catch (error) {
      if (isAbortError(error) || !isCurrentArenaQuickMatchOperation(requestId, actionRequestRef.current, operationEpoch, operationEpochRef.current)) return;
      setErrorMessage(error instanceof Error ? error.message : '탐색을 취소하지 못했습니다.');
      setConnectionIssue(true);
      restartPolling();
    } finally {
      if (isCurrentArenaQuickMatchOperation(requestId, actionRequestRef.current, operationEpoch, operationEpochRef.current)) setBusy(null);
    }
  }, [applyResponse, beginAction, restartPolling, seasonId, setBusy]);

  React.useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [open]);

  React.useEffect(() => {
    if (!initialStatus) return;
    const normalized = normalizeArenaQuickMatchResponse(initialStatus);
    if (!pollablePhases.has(normalized.phase) && normalized.phase !== 'matched') return;
    let cancelled = false;
    const restorationEpoch = operationEpochRef.current;
    queueMicrotask(() => {
      if (cancelled || restorationEpoch !== operationEpochRef.current || initialStatusRef.current === initialStatus) return;
      initialStatusRef.current = initialStatus;
      setOpen(true);
      applyResponse(initialStatus);
    });
    return () => { cancelled = true; };
  }, [applyResponse, initialStatus]);

  React.useEffect(() => {
    if (!open || !seasonId || !pollablePhases.has(snapshot.phase)) return;
    let disposed = false;
    let timer: number | null = null;
    let failures = 0;
    const pollingEpoch = operationEpochRef.current;
    pollRequestRef.current += 1;
    const schedule = (delay: number) => {
      if (disposed || pollingEpoch !== operationEpochRef.current) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      if (disposed || pollingEpoch !== operationEpochRef.current) return;
      const requestId = ++pollRequestRef.current;
      pollAbortRef.current?.abort();
      const controller = new AbortController();
      pollAbortRef.current = controller;
      try {
        const response = await apiFetch(`/arena/matchmaking/quick/status?seasonId=${encodeURIComponent(seasonId)}`, { signal: controller.signal });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(getErrorMessage(json, '매칭 상태 확인 실패'));
        if (disposed || !isCurrentArenaQuickMatchOperation(requestId, pollRequestRef.current, pollingEpoch, operationEpochRef.current)) return;
        failures = 0;
        const previousPhase = snapshotRef.current.phase;
        const incoming = normalizeArenaQuickMatchResponse(json);
        if (incoming.phase === 'idle' && (previousPhase === 'proposal' || previousPhase === 'accepted')) {
          setConnectionIssue(true);
          return;
        }
        applyResponse(json);
      } catch (error) {
        if (isAbortError(error) || disposed || !isCurrentArenaQuickMatchOperation(requestId, pollRequestRef.current, pollingEpoch, operationEpochRef.current)) return;
        failures += 1;
        setConnectionIssue(true);
      } finally {
        if (disposed || !isCurrentArenaQuickMatchOperation(requestId, pollRequestRef.current, pollingEpoch, operationEpochRef.current)) return;
        const currentPhase = snapshotRef.current.phase;
        if (pollablePhases.has(currentPhase)) {
          schedule(getArenaQuickMatchPollDelayMs(currentPhase, document.visibilityState, failures));
        }
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      pollRequestRef.current += 1;
      pollAbortRef.current?.abort();
      schedule(0);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    schedule(0);
    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      pollAbortRef.current?.abort();
    };
  }, [applyResponse, open, pollGeneration, seasonId, snapshot.phase]);

  React.useEffect(() => () => {
    const current = snapshotRef.current;
    if (!navigatedMatchRef.current && serverQueuePhases.has(current.phase)) {
      cancelServerQueueSilently('quick_match_flow_disposed');
    }
    actionRequestRef.current += 1;
    operationEpochRef.current += 1;
    pollRequestRef.current += 1;
    actionAbortRef.current?.abort();
    pollAbortRef.current?.abort();
    const audioContext = audioContextRef.current;
    if (audioContext) {
      audioContext.onstatechange = null;
      void audioContext.close();
    }
  }, [cancelServerQueueSilently]);

  return (
    <>
      <ArenaTooltip data={arenaCoreTooltips.quickMode} side="left">
        <button type="button" onClick={() => void startSearch()} aria-haspopup="dialog" aria-expanded={open} disabled={busyAction === 'join'}>
          {busyAction === 'join' ? <LoaderCircle className={styles.spin} /> : <Swords className="h-4 w-4" />} 빠른대전
        </button>
      </ArenaTooltip>
      <ArenaQuickMatchDialog
        open={open}
        snapshot={snapshot}
        busyAction={busyAction}
        nowMs={nowMs}
        connectionIssue={connectionIssue}
        errorMessage={errorMessage}
        proposalError={proposalError}
        soundStatus={soundStatus}
        onAccept={() => void acceptProposal()}
        onCancel={() => void cancelSearch()}
        onEnableSound={() => void unlockAudio()}
        onRetry={() => void startSearch()}
      />
    </>
  );
};
