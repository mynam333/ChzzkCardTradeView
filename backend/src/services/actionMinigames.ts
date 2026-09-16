import crypto from 'crypto';
import { normalizeImageBlindKey } from '../utils/imageBlindKey';

export const ACTION_GAMES = ['fan_meeting', 'streamer_catch', 'sequence_relay'] as const;
export type ActionGameType = typeof ACTION_GAMES[number];
export const isActionGame = (value: unknown): value is ActionGameType =>
  ACTION_GAMES.includes(value as ActionGameType);
export const ACTION_GAME_NAMES: Record<ActionGameType, string> = {
  fan_meeting: '팬 줄서기', streamer_catch: '게스트 캐치', sequence_relay: '순서 기억'
};
export const ACTION_GAME_PLAY_MS: Record<ActionGameType, number> = {
  fan_meeting: 20_000, streamer_catch: 25_000, sequence_relay: 150_000
};
export type ActionCard = { channel_id: string; name: string; image_url: string };
export type CatchFrame = { start: number; duration: number; cells: Array<{ cell: number; card: number }> };
export type ActionTarget = {
  cards: ActionCard[];
  deck: number[];
  frames: CatchFrame[];
  sequences: number[][];
};
export type ActionState = {
  version: 1;
  starts_at: number | null;
  ends_at: number | null;
  done: boolean;
  correct: number;
  mistakes: number;
  combo: number;
  index: number;
  blocked_until: number;
  clicked: string[];
  stage: number;
  cleared: number;
  position: number;
  preview_at: number;
  input_at: number;
  last_request?: string;
  last_action?: string;
};
export type ActionInput = { kind: 'ready' | 'sort' | 'catch' | 'sequence' | 'finish'; value?: number; frame?: number };
export class ActionGameError extends Error {}
const shuffle = <T>(items: T[]): T[] => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

export function createActionTarget(type: ActionGameType, candidates: ActionCard[]): ActionTarget {
  const needed = type === 'fan_meeting' ? 2 : 4;
  // Channel uniqueness alone does not guarantee different visible images.
  const images = new Set<string>();
  const channels = new Set<string>();
  const cards = shuffle(candidates).filter(card => {
    const key = normalizeImageBlindKey(card.image_url);
    if (!key || images.has(key) || channels.has(card.channel_id)) return false;
    images.add(key); channels.add(card.channel_id); return true;
  }).slice(0, needed).map(({ channel_id, name, image_url }) => ({ channel_id, name, image_url }));
  if (cards.length < needed) throw new ActionGameError('서로 다른 이미지가 부족해 게임을 준비할 수 없습니다.');
  const deck = type === 'fan_meeting'
    ? Array.from({ length: 240 }, () => crypto.randomInt(2)) : [];
  const sequences = type === 'sequence_relay'
    ? Array.from({ length: 5 }, (_, stage) => Array.from({ length: stage + 4 }, () => crypto.randomInt(4))) : [];
  const frames: CatchFrame[] = [];
  if (type === 'streamer_catch') {
    const targets = new Set(shuffle(Array.from({ length: 25 }, (_, i) => i)).slice(0, 10));
    const durations: number[] = [];
    // 25 appearances, each 0.8–1.2s, summing to exactly 25 seconds.
    for (let i = 0; i < 12; i++) {
      const duration = crypto.randomInt(800, 1201);
      durations.push(duration, 2000 - duration);
    }
    durations.push(1000);
    let start = 0;
    for (let i = 0; i < 25; i++) {
      const slots = shuffle(Array.from({ length: 9 }, (_, cell) => cell));
      const selected = targets.has(i) ? [0, ...shuffle([1, 2, 3]).slice(0, 2)] : [1, 2, 3];
      frames.push({ start, duration: durations[i], cells: shuffle(selected).map((card, index) => ({ cell: slots[index], card })) });
      start += durations[i];
    }
  }
  return { cards, deck, frames, sequences };
}

export function initialActionState(): ActionState {
  return { version: 1, starts_at: null, ends_at: null, done: false, correct: 0, mistakes: 0,
    combo: 0, index: 0, blocked_until: 0, clicked: [], stage: 0, cleared: 0,
    position: 0, preview_at: 0, input_at: 0 };
}

export function readActionState(progress: unknown): ActionState {
  const parsed = typeof progress === 'string' ? JSON.parse(progress) : progress;
  const state = (parsed as { action?: ActionState })?.action;
  if (!state || state.version !== 1) throw new ActionGameError('게임 진행 정보를 확인할 수 없습니다.');
  return state;
}

export function advanceActionGame(type: ActionGameType, target: ActionTarget, previous: ActionState, input: ActionInput, now: number): ActionState {
  const state: ActionState = { ...previous, clicked: [...previous.clicked] };
  if (state.done) return state;
  if (input.kind === 'ready') {
    if (state.starts_at !== null) return state;
    state.starts_at = now + 3000;
    state.ends_at = state.starts_at + ACTION_GAME_PLAY_MS[type];
    state.preview_at = state.starts_at;
    state.input_at = state.preview_at + 4 * 700;
    return state;
  }
  if (state.starts_at === null || state.ends_at === null || now < state.starts_at) {
    throw new ActionGameError('카운트다운이 끝난 뒤 입력해 주세요.');
  }
  if (input.kind === 'finish') {
    if (now < state.ends_at) throw new ActionGameError('게임이 아직 진행 중입니다.');
    state.done = true;
    return state;
  }
  // Catch clicks have a small fixed transport allowance, never a client clock.
  if (now >= state.ends_at + (type === 'streamer_catch' ? 150 : 0)) {
    state.done = true;
    return state;
  }
  if (!Number.isInteger(input.value)) throw new ActionGameError('입력값이 올바르지 않습니다.');
  if (type === 'fan_meeting' && input.kind === 'sort') {
    if (input.value !== 0 && input.value !== 1) throw new ActionGameError('왼쪽 또는 오른쪽을 선택해 주세요.');
    if (now < state.blocked_until) throw new ActionGameError('잠시 후 다음 카드를 넘겨 주세요.');
    if (state.index >= target.deck.length) throw new ActionGameError('카드를 모두 분류했습니다.');
    if (target.deck[state.index] === input.value) { state.correct++; state.combo++; }
    else { state.mistakes++; state.combo = 0; state.blocked_until = now + 500; }
    state.index++;
  } else if (type === 'streamer_catch' && input.kind === 'catch') {
    if (!Number.isInteger(input.frame)) throw new ActionGameError('화면 정보가 올바르지 않습니다.');
    const frame = target.frames[input.frame!];
    if (!frame || now < state.starts_at + frame.start || now >= state.starts_at + frame.start + frame.duration + 150) {
      throw new ActionGameError('이미 지나간 화면입니다. 다음 게스트를 기다려 주세요.');
    }
    const shown = frame.cells.find(item => item.cell === input.value);
    if (!shown) throw new ActionGameError('켜진 화면을 선택해 주세요.');
    const key = `${input.frame}:${input.value}`;
    if (state.clicked.includes(key)) throw new ActionGameError('이미 선택한 화면입니다.');
    state.clicked.push(key);
    if (shown.card === 0) state.correct++;
    else state.mistakes++;
  } else if (type === 'sequence_relay' && input.kind === 'sequence') {
    if (input.value! < 0 || input.value! >= target.cards.length) throw new ActionGameError('보기 카드를 선택해 주세요.');
    if (now < state.input_at) throw new ActionGameError('순서를 모두 본 뒤 입력해 주세요.');
    if (target.sequences[state.stage][state.position] !== input.value) {
      state.mistakes++;
      state.position = 0;
      if (state.mistakes >= 2) state.done = true;
      else {
        state.preview_at = now + 800;
        state.input_at = state.preview_at + target.sequences[state.stage].length * 700;
      }
    } else {
      state.position++;
      if (state.position === target.sequences[state.stage].length) {
        state.cleared = state.stage + 1;
        if (state.cleared === 5) state.done = true;
        else {
          state.stage++;
          state.position = 0;
          state.preview_at = now + 800;
          state.input_at = state.preview_at + target.sequences[state.stage].length * 700;
        }
      }
    }
  } else throw new ActionGameError('게임에 맞지 않는 입력입니다.');
  return state;
}

export function actionReward(type: ActionGameType, state: ActionState): 0 | 1000 | 1200 {
  if (!state.done) throw new ActionGameError('게임 종료 후 결과를 확인해 주세요.');
  if (type === 'fan_meeting') return state.correct >= 25 || (state.correct >= 20 && state.mistakes === 0)
    ? 1200 : state.correct >= 15 ? 1000 : 0;
  if (type === 'streamer_catch') return state.correct === 10 && state.mistakes === 0
    ? 1200 : state.correct >= 7 && state.mistakes <= 2 ? 1000 : 0;
  return state.cleared === 5 && state.mistakes === 0 ? 1200 : state.cleared >= 4 ? 1000 : 0;
}

export function publicActionGame(type: ActionGameType, target: ActionTarget, state: ActionState, revision: number, now = Date.now()) {
  const { last_request, last_action, ...publicState } = state;
  return { game_type: type, revision, server_now: now, cards: target.cards, state: publicState,
    current_card: type === 'fan_meeting' ? target.deck[state.index] ?? null : null,
    frames: type === 'streamer_catch' ? target.frames : [],
    sequence: type === 'sequence_relay' && state.starts_at !== null ? target.sequences[state.stage] : [] };
}
