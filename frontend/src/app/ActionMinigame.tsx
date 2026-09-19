'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Heart, RefreshCw, Trophy, X } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { proxiedImage } from '@/lib/cosmetics';
import { estimateActionClock } from './actionMinigameTiming';

export const ACTION_GAME_TYPES = ['fan_meeting', 'streamer_catch', 'sequence_relay'] as const;
export type ActionGameType = typeof ACTION_GAME_TYPES[number];
export const isActionGameType = (value: unknown): value is ActionGameType => ACTION_GAME_TYPES.includes(value as ActionGameType);
export const ACTION_GAME_COPY: Record<ActionGameType, { title: string; description: string; bonus: string }> = {
  fan_meeting: { title: '팬 줄서기', description: '같은 사진 쪽으로 카드를 넘기세요. 20초 동안 15장 이상 분류하면 성공! 실수하면 0.5초 쉬어 갑니다.', bonus: '25장 이상 또는 무실수 20장 이상 · +200 P' },
  streamer_catch: { title: '게스트 캐치', description: '목표 사진이 켜진 모니터를 누르세요. 25초 동안 10번 등장하며, 7번 이상 잡고 실수 2회 이하면 성공!', bonus: '10번 모두 캐치 · 실수 0회 · +200 P' },
  sequence_relay: { title: '순서 기억', description: '사진이 나온 순서대로 누르세요. 4개부터 8개까지 5단계! 4단계 완료 시 성공, 두 번 틀리면 종료됩니다.', bonus: '실수 없이 5단계 완료 · +200 P' }
};

type Card = { name: string; image_url: string; channel_id: string };
type View = {
  revision: number; server_now: number; server_received_at?: number; input_grace_ms?: number;
  cards: Card[]; current_card: number | null; sequence: number[];
  frames: Array<{ start: number; duration: number; cells: Array<{ cell: number; card: number }> }>;
  state: { starts_at: number | null; ends_at: number | null; done: boolean; correct: number; mistakes: number;
    combo: number; index: number; blocked_until: number; clicked: string[]; stage: number; cleared: number;
    position: number; preview_at: number; input_at: number };
};
type Input = { kind: 'ready' | 'sort' | 'catch' | 'sequence'; value?: number; frame?: number };
type Pending = { session_id: string; revision: number; request_id: string; action: Input };
type Result = { correct: boolean; message: string; earned_points: number; practice_mode?: boolean };

const imageUrl = (card: Card) => proxiedImage(card.image_url, { width: 320 });
const readableError = (error: unknown, fallback: string) =>
  error instanceof Error && /[가-힣]/.test(error.message) ? error.message : fallback;
async function readResponse(response: Response) {
  try { return await response.json(); }
  catch { throw new Error('서버 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
}
function preload(cards: Card[]) {
  return Promise.all(cards.map(card => new Promise<void>((resolve, reject) => {
    const img = new Image();
    const timer = window.setTimeout(() => { img.onload = null; img.onerror = null; reject(new Error('이미지 준비가 지연되고 있습니다. 다시 시도해 주세요.')); }, 12_000);
    img.onload = () => { window.clearTimeout(timer); resolve(); };
    img.onerror = () => { window.clearTimeout(timer); reject(new Error('이미지를 불러오지 못했습니다. 같은 게임에서 다시 준비할 수 있습니다.')); };
    img.src = imageUrl(card);
  })));
}

export function ActionMinigame({ type, practice, canRestart, onExit, onSettled, onRestart }: {
  type: ActionGameType; practice: boolean; canRestart: boolean; onExit: () => void; onSettled: () => void; onRestart: () => void;
}) {
  const [view, setView] = useState<View | null>(null);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [booted, setBooted] = useState(false);
  const [catchPending, setCatchPending] = useState<string[]>([]);
  const current = useRef<View | null>(null);
  const session = useRef('');
  const clockOffset = useRef(0);
  const clockRoundTrip = useRef(Infinity);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const pending = useRef<Pending | null>(null);
  const catchRequests = useRef(new Map<string, { body: Pending; sending: boolean }>());
  const settled = useRef(false);
  const startRequest = useRef<Promise<{ session_id: string; game_data: View; sentAt: number }> | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const copy = ACTION_GAME_COPY[type];

  const accept = useCallback((data: View, before: number) => {
    // Overlapping catch responses can arrive in the opposite order.
    if (current.current && data.revision < current.current.revision) return;
    const sample = estimateActionClock(data, before, Date.now());
    if (sample.roundTrip <= clockRoundTrip.current) {
      clockOffset.current = sample.offset;
      clockRoundTrip.current = sample.roundTrip;
    }
    current.current = data;
    if (mounted.current) { setView(data); setNow(Date.now() + clockOffset.current); }
  }, []);

  const send = useCallback(async (input: Input, retry = false) => {
    if (inFlight.current || !current.current || !session.current) return;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    const body = retry && pending.current ? pending.current : {
      session_id: session.current, revision: current.current.revision, request_id: crypto.randomUUID(), action: input
    };
    pending.current = body;
    const before = Date.now();
    try {
      const response = await apiFetch('/minigames/action', { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
      const data = await readResponse(response);
      if (data.game_data) accept(data.game_data, before);
      if (!response.ok) {
        if (response.status >= 500 || (response.status === 409 && !data.game_data)) throw new Error(data.message || '입력 저장을 다시 시도해 주세요.');
        setNotice(data.message || '입력을 확인해 주세요.');
      }
      pending.current = null;
    } catch (err) {
      if (mounted.current) setError(readableError(err, '연결을 확인하고 다시 시도해 주세요.'));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [accept]);

  const sendCatch = useCallback(async (input: Input, retry = false) => {
    if (!current.current || !session.current || inFlight.current || !mounted.current) return;
    const key = `${input.frame}:${input.value}`;
    const existing = catchRequests.current.get(key);
    if (existing?.sending || (!retry && (existing || current.current.state.clicked.includes(key)))) return;
    const item = existing || { body: {
      session_id: session.current, revision: current.current.revision, request_id: crypto.randomUUID(), action: input
    }, sending: false };
    item.sending = true;
    catchRequests.current.set(key, item);
    setCatchPending([...catchRequests.current.keys()]);
    // Each cell owns its pending request. Other cells stay interactive while a
    // response is delayed; retries reuse the same request and frame/cell key.
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const before = Date.now();
        try {
          const response = await apiFetch('/minigames/action', { method: 'POST', body: JSON.stringify(item.body), signal: AbortSignal.timeout(8000) });
          const data = await readResponse(response);
          if (!mounted.current) return;
          if (data.game_data) accept(data.game_data, before);
          if (response.status >= 500 || response.status === 409) {
            throw new Error(data.message || '입력 저장을 다시 시도해 주세요.');
          }
          if (!response.ok) setNotice(data.message || '입력을 확인해 주세요.');
          catchRequests.current.delete(key);
          return;
        } catch (err) {
          if (!mounted.current) return;
          if (attempt === 1) throw err;
        }
      }
    } catch (err) {
      if (mounted.current) setError(readableError(err, '연결을 확인하고 다시 시도해 주세요.'));
    } finally {
      item.sending = false;
      if (mounted.current) setCatchPending([...catchRequests.current.keys()]);
    }
  }, [accept]);

  const prepare = useCallback(async () => {
    if (!current.current) return;
    setError(''); setBusy(true);
    try {
      await preload(current.current.cards);
      if (!mounted.current) return;
      setBooted(true);
    } catch (err) {
      if (mounted.current) setError(readableError(err, '이미지 준비에 실패했습니다. 다시 시도해 주세요.'));
    } finally { if (mounted.current) setBusy(false); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    if (!startRequest.current) {
      startRequest.current = (async () => {
        const sentAt = Date.now();
        const response = await apiFetch('/minigames/start', { method: 'POST', body: JSON.stringify({ game_type: type, practice_mode: practice }), signal: AbortSignal.timeout(12000) });
        const data = await readResponse(response);
        if (!response.ok) throw new Error(data.message || '게임을 시작하지 못했습니다.');
        return { ...data, sentAt };
      })();
    }
    void startRequest.current.then(async data => {
      if (cancelled) return;
      session.current = data.session_id;
      accept(data.game_data, data.sentAt);
      await prepare();
    }).catch(err => { if (!cancelled) setError(readableError(err, '게임 준비에 실패했습니다. 다시 시도해 주세요.')); });
    return () => { cancelled = true; mounted.current = false; };
  }, [type, practice, accept, prepare]);

  useEffect(() => {
    if (!booted || result) return;
    const timer = window.setInterval(() => setNow(Date.now() + clockOffset.current), 50);
    return () => window.clearInterval(timer);
  }, [booted, result]);

  const finish = useCallback(async () => {
    if (inFlight.current || catchRequests.current.size || settled.current || !session.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const response = await apiFetch('/minigames/submit', { method: 'POST', body: JSON.stringify({ session_id: session.current, payload: {} }), signal: AbortSignal.timeout(10000) });
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.message || '결과 확인을 다시 시도해 주세요.');
      settled.current = true;
      if (mounted.current) { setResult(data); onSettled(); }
    } catch (err) {
      if (mounted.current) setError(readableError(err, '연결을 확인하고 결과 확인을 다시 시도해 주세요.'));
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }, [onSettled]);

  const state = view?.state;
  const ended = Boolean(state?.done || (state?.ends_at && now >= state.ends_at + (view?.input_grace_ms || 0) + 250));
  useEffect(() => { if (booted && ended && !error && !busy && !pending.current && !catchPending.length) void finish(); }, [booted, ended, error, busy, catchPending.length, finish]);
  const playing = Boolean(booted && state?.starts_at && now >= state.starts_at && state.ends_at && now < state.ends_at && !state.done && !result);
  const enabled = playing && !busy && !error;
  const preview = Boolean(type === 'sequence_relay' && state && now < state.input_at);
  const locked = now < (state?.blocked_until || 0);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!enabled || event.repeat || /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement)?.tagName)) return;
      if (type === 'fan_meeting' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault(); if (!locked) void send({ kind: 'sort', value: event.key === 'ArrowLeft' ? 0 : 1 });
      } else if (type === 'sequence_relay' && !preview && /^[1-4]$/.test(event.key)) {
        event.preventDefault(); void send({ kind: 'sequence', value: Number(event.key) - 1 });
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [enabled, type, locked, preview, send]);

  async function leave() {
    if (inFlight.current) return;
    if (result || !session.current) { onExit(); return; }
    inFlight.current = true;
    setBusy(true); setError('');
    try {
      const response = await apiFetch('/minigames/abandon', { method: 'POST', body: JSON.stringify({ session_id: session.current }), signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('게임 종료를 다시 시도해 주세요.');
      onExit();
    } catch (err) { setError(readableError(err, '종료하지 못했습니다. 다시 시도해 주세요.')); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }

  // Reuse the exact preloaded proxy URL; a second image transform could delay play.
  // eslint-disable-next-line @next/next/no-img-element
  const picture = (card: Card, className = '') => <img src={imageUrl(card)} alt={card.name} draggable={false}
    className={`h-full w-full select-none object-contain ${className}`} />;
  const remaining = state?.ends_at ? Math.max(0, (state.ends_at - Math.max(now, state.starts_at || 0)) / 1000) : type === 'fan_meeting' ? 20 : type === 'streamer_catch' ? 25 : 150;
  const currentFrame = view?.frames.findIndex(frame => state?.starts_at != null && now >= state.starts_at + frame.start && now < state.starts_at + frame.start + frame.duration) ?? -1;
  const previewIndex = state ? Math.floor((now - state.preview_at) / 700) : -1;
  const previewCard = view && previewIndex >= 0 && previewIndex < view.sequence.length && (now - (state?.preview_at || 0)) % 700 < 620 ? view.cards[view.sequence[previewIndex]] : null;

  return <section className="cute-surface mx-auto w-full max-w-3xl rounded-[2rem] p-4 sm:p-6" aria-label={copy.title}>
    <header className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-3">
      <button type="button" onClick={() => void leave()} disabled={busy} className="min-h-11 text-xs font-bold text-muted-foreground disabled:opacity-40">← {result ? '목록으로' : '포기하고 나가기'}</button>
      <h2 className="text-lg font-black">{copy.title}</h2>
      <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">{practice ? '무료 연습' : '보상 도전'}</span>
    </header>
    {!state?.starts_at || result ? <>
      <p className="mb-2 text-center text-sm leading-relaxed text-muted-foreground">{copy.description}</p>
      <p className="mb-5 text-center text-xs font-semibold text-primary">성공 1,000 P · {copy.bonus}{practice && ' (연습은 지급 없음)'}</p>
    </> : <p className="mb-3 text-center text-xs font-semibold text-primary">{type === 'fan_meeting' ? '성공 15장 · 보너스 25장 또는 무실수 20장' : type === 'streamer_catch' ? '성공 7회 · 실수 2회 이하 / 보너스 무실수 10회' : '성공 4단계 · 보너스 무실수 5단계'}</p>}

    {error && <div role="alert" className="mb-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
      <p>{error}</p><button className="mt-3 min-h-11 rounded-xl bg-primary px-4 font-bold text-primary-foreground" disabled={busy} onClick={() => {
        if (catchRequests.current.size) {
          setError('');
          for (const item of catchRequests.current.values()) void sendCatch(item.body.action, true);
        } else if (pending.current) void send(pending.current.action, true);
        else if (!session.current) onRestart();
        else if (!booted) void prepare();
        else if (current.current?.state.starts_at === null) void send({ kind: 'ready' });
        else void finish();
      }}>다시 시도</button>
    </div>}
    {result ? <div className="space-y-5 py-7 text-center" role="status">
      <Trophy className={`mx-auto h-12 w-12 ${result.correct ? 'text-primary' : 'text-muted-foreground'}`} />
      <h3 className="text-2xl font-black">{result.correct ? '성공했어요!' : '다음에 다시 도전해요'}</h3>
      <p className="text-sm">{result.message}</p>
      <p className="text-sm font-bold text-muted-foreground">{type === 'sequence_relay' ? `${state?.cleared || 0}/5단계 완료 · 실수 ${state?.mistakes || 0}회` : `${state?.correct || 0}${type === 'fan_meeting' ? '장 분류' : '/10회 캐치'} · 실수 ${state?.mistakes || 0}회`}</p>
      <p className="text-3xl font-black text-primary">{practice ? '연습 완료' : `+${result.earned_points.toLocaleString()} P`}</p>
      <div className="flex justify-center gap-3"><button disabled={!canRestart} onClick={onRestart} className="min-h-12 rounded-2xl bg-primary px-6 font-bold text-primary-foreground disabled:opacity-40">다시 {practice ? '연습' : '도전'}</button>
        <button onClick={onExit} className="min-h-12 rounded-2xl bg-secondary px-6 font-bold">목록으로</button></div>
      {!canRestart && <p className="text-xs text-muted-foreground">사용할 동전이 없어요. 목록에서 무료 연습을 즐길 수 있어요.</p>}
    </div> : !view || !booted ? <div className="flex min-h-64 flex-col items-center justify-center gap-4" role="status"><RefreshCw className="h-8 w-8 animate-spin text-primary" /><p>카드 이미지를 준비하고 있어요</p></div>
    : <div className="relative">
      {state?.starts_at === null && <div className="mb-5 flex flex-wrap items-center justify-center gap-3 rounded-2xl bg-primary/10 p-4">
        <p className="text-sm font-bold">사진과 규칙을 확인한 뒤 시작하세요</p>
        <button type="button" disabled={busy || Boolean(error)} onClick={() => void send({ kind: 'ready' })} className="min-h-12 rounded-xl bg-primary px-6 font-black text-primary-foreground disabled:opacity-50">게임 시작</button>
      </div>}
      {state?.starts_at && now < state.starts_at && <div className="absolute inset-0 z-20 flex flex-col items-center justify-center rounded-3xl bg-card/95" role="status">
        <p className="text-sm font-bold text-muted-foreground">잠시 후 시작해요</p><p className="text-7xl font-black text-primary">{Math.ceil((state.starts_at - now) / 1000)}</p>
      </div>}
      <div className="mb-4 flex items-center justify-between rounded-2xl bg-secondary/60 px-4 py-3 text-sm font-bold">
        <span>{type === 'sequence_relay' ? `${(state?.stage || 0) + 1} / 5단계` : `${state?.correct || 0}${type === 'fan_meeting' ? '장 정답' : ' / 10회 캐치'}`}</span>
        <span className="tabular-nums">{remaining.toFixed(1)}초</span>
        <span className="inline-flex items-center gap-1">{type === 'fan_meeting' ? `${state?.combo || 0} 콤보` : type === 'streamer_catch' ? `실수 ${state?.mistakes || 0}회` : <><Heart className="h-4 w-4 text-rose-500" />{Math.max(0, 2 - (state?.mistakes || 0))}</>}</span>
      </div>
      <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-primary transition-[width] duration-75" style={{ width: `${Math.max(0, remaining / (type === 'fan_meeting' ? 20 : type === 'streamer_catch' ? 25 : 150) * 100)}%` }} /></div>

      {type === 'fan_meeting' && <>
        <div className="grid grid-cols-2 gap-4">{view.cards.map((card, i) => <div key={card.channel_id} className="flex items-center gap-2 rounded-2xl border border-primary/25 bg-primary/5 p-2">
          <div className="h-16 w-12 shrink-0">{picture(card)}</div><div className="min-w-0"><p className="text-xs text-muted-foreground">{i === 0 ? '← 왼쪽 줄' : '오른쪽 줄 →'}</p><p className="truncate text-sm font-bold">{card.name}</p></div>
        </div>)}</div>
        <div className={`mx-auto my-4 h-44 w-32 touch-pan-y overflow-hidden rounded-2xl border-2 bg-secondary/30 p-2 transition-colors sm:h-52 sm:w-36 ${locked ? 'border-rose-400 bg-rose-500/15' : 'border-primary/30'}`}
          onPointerDown={event => { pointer.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerCancel={() => { pointer.current = null; }}
          onPointerUp={event => { const start = pointer.current; pointer.current = null; if (!start || !enabled || locked) return;
            const dx = event.clientX - start.x, dy = event.clientY - start.y;
            if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.3) void send({ kind: 'sort', value: dx < 0 ? 0 : 1 }); }}>
          <div key={state?.index} className="action-card-enter h-full w-full">{view.current_card !== null && view.cards[view.current_card] && picture(view.cards[view.current_card])}</div>
        </div>
        <p role="status" className="mb-3 h-5 text-center text-xs text-muted-foreground">{locked ? '다른 줄이에요. 잠깐 쉬고 다음 카드!' : '같은 사진 쪽으로 넘겨 주세요'}</p>
        <div className="grid grid-cols-2 gap-3">{[0, 1].map(i => <button key={i} disabled={!enabled || locked} onClick={() => void send({ kind: 'sort', value: i })} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-black text-primary-foreground disabled:opacity-45">{i === 0 && <ArrowLeft className="h-5 w-5" />}{i === 0 ? '왼쪽으로' : '오른쪽으로'}{i === 1 && <ArrowRight className="h-5 w-5" />}</button>)}</div>
        <p className="mt-3 text-center text-xs text-muted-foreground">스와이프 · 좌우 방향키 지원</p>
      </>}

      {type === 'streamer_catch' && <>
        <div className="mb-4 flex items-center justify-center gap-4 rounded-2xl border border-primary/25 bg-primary/5 p-2"><div className="h-16 w-12">{picture(view.cards[0])}</div><div><p className="text-xs text-muted-foreground">오늘의 게스트</p><p className="font-black">{view.cards[0].name}</p><p className="text-xs text-primary">이 사진이 보이면 눌러 주세요</p></div></div>
        <div className="mx-auto grid max-w-[clamp(12rem,calc(100svh-25rem),24rem)] grid-cols-3 gap-2 sm:gap-3">{Array.from({ length: 9 }, (_, cell) => {
          const shown = currentFrame >= 0 ? view.frames[currentFrame].cells.find(item => item.cell === cell) : undefined;
          const clicked = state?.clicked.includes(`${currentFrame}:${cell}`);
          const waiting = catchPending.includes(`${currentFrame}:${cell}`);
          return <button key={cell} type="button" disabled={!enabled || !shown || clicked || waiting} aria-busy={waiting} aria-label={`${cell + 1}번 모니터${shown ? ` · ${view.cards[shown.card].name}` : ' · 대기'}`}
            onPointerDown={event => {
              if (!event.isPrimary || event.button !== 0) return;
              // Capture the visible frame on press, before a finger/mouse release
              // can land on a different picture after the board advances.
              event.preventDefault();
              event.currentTarget.focus({ preventScroll: true });
              void sendCatch({ kind: 'catch', frame: currentFrame, value: cell });
            }}
            onClick={event => { if (event.detail === 0) void sendCatch({ kind: 'catch', frame: currentFrame, value: cell }); }}
            className={`relative aspect-square touch-manipulation overflow-hidden rounded-xl border-2 p-1.5 transition-colors ${waiting ? 'border-primary bg-primary/10' : shown ? 'border-primary/40 bg-card' : 'border-border bg-secondary/60'}`}>
            {shown && <div key={currentFrame} className="action-card-enter pointer-events-none h-full w-full">{picture(view.cards[shown.card])}</div>}
            {(clicked || waiting) && <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-card/65">{waiting ? <RefreshCw className="h-7 w-7 animate-spin text-primary" /> : shown?.card === 0 ? <Check className="h-9 w-9 text-primary" /> : <X className="h-9 w-9 text-rose-500" />}</div>}
          </button>;
        })}</div>
      </>}

      {type === 'sequence_relay' && <>
        <div className="mb-3 text-center"><p className="font-bold" role="status">{state?.starts_at === null ? '아래 네 장의 사진이 차례로 나타나요' : preview ? previewIndex < 0 ? '사진 순서를 기억하세요' : `${Math.min(previewIndex + 1, view.sequence.length)} / ${view.sequence.length}번째 사진을 기억하세요` : `${state?.position || 0} / ${view.sequence.length}개 입력 · 같은 순서로 누르세요`}</p>
          <p className="mt-1 text-xs text-primary">{(state?.cleared || 0) >= 4 ? '4단계 성공! 기본 보상 확보 · 마지막 단계에 도전해요' : '4단계까지 맞히면 성공 · 전체 진행 상한 150초'}</p></div>
        <div className="mx-auto mb-5 flex h-32 w-24 items-center justify-center overflow-hidden rounded-2xl border-2 border-primary/30 bg-secondary/40 p-2 sm:h-44 sm:w-32">
          {preview && previewCard ? picture(previewCard) : <span className="whitespace-pre-line text-center text-sm font-bold text-muted-foreground">{preview || state?.starts_at === null ? '기억할 준비!' : '순서대로\n눌러 주세요'}</span>}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{view.cards.map((card, i) => <button key={card.channel_id} disabled={!enabled || preview} aria-label={`${i + 1}번 ${card.name}`} onClick={() => void send({ kind: 'sequence', value: i })}
          className="rounded-2xl border border-primary/25 bg-card p-2 transition hover:bg-primary/10 disabled:opacity-60"><div className="h-20 sm:h-24">{picture(card)}</div><p className="mt-1 truncate text-xs font-bold">{i + 1}. {card.name}</p></button>)}</div>
        <p className="mt-3 text-center text-xs text-muted-foreground">숫자키 1~4 지원 · 틀리면 같은 순서를 다시 보여드려요</p>
      </>}
      {ended && !result && <p className="mt-5 text-center text-sm" role="status">결과를 확인하고 있어요…</p>}
    </div>}
    {!result && booted && <p role="status" className="mt-3 min-h-5 text-center text-xs text-muted-foreground">{notice || (catchPending.length ? '입력을 확인하고 있어요' : '')}</p>}
    <style jsx>{`
      @keyframes action-card-enter { from { opacity: .65; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      .action-card-enter { animation: action-card-enter 120ms ease-out; }
      @media (prefers-reduced-motion: reduce) { .action-card-enter { animation: none; } }
    `}</style>
  </section>;
}
