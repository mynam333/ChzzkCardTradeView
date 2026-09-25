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
  fan_meeting: 20_000, streamer_catch: 30_000, sequence_relay: 150_000
};
export const CATCH_INPUT_GRACE_MS = 500;
export const SORT_INPUT_GRACE_MS = 500;
export const CATCH_TARGET_COUNT = 12;
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
  inputs?: number[];
};
export type ActionInput = { kind: 'ready' | 'sort' | 'catch' | 'sequence' | 'finish'; value?: number; frame?: number;
  values?: number[]; offset?: number; quick_start?: boolean };
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
    // Reserve every target first, so random placement cannot reduce the quota or
    // truncate the final appearance. Targets never compete with each other.
    const durations = Array.from({ length: CATCH_TARGET_COUNT }, () => crypto.randomInt(1100, 1901));
    const weights = Array.from({ length: CATCH_TARGET_COUNT + 1 }, () => crypto.randomInt(1, 101));
    const freeTime = ACTION_GAME_PLAY_MS.streamer_catch - durations.reduce((a, b) => a + b, 0) - weights.length * 200;
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const gaps = weights.map(weight => 200 + Math.floor(freeTime * weight / totalWeight));
    let start = gaps[0];
    let previousCell = -1;
    for (let i = 0; i < CATCH_TARGET_COUNT; i++) {
      const cell = shuffle(Array.from({ length: 9 }, (_, index) => index).filter(index => index !== previousCell))[0];
      frames.push({ start, duration: durations[i], cells: [{ cell, card: 0 }] });
      previousCell = cell;
      start += durations[i] + gaps[i + 1];
    }
    const targets = [...frames];
    // Every other cell has its own random idle and visible times. Leave a gap
    // around reserved targets so a photo cannot replace another on the same press.
    for (let cell = 0; cell < 9; cell++) {
      let at = crypto.randomInt(300, 2401);
      while (at < ACTION_GAME_PLAY_MS.streamer_catch) {
        const duration = crypto.randomInt(750, 1851);
        if (at + duration <= ACTION_GAME_PLAY_MS.streamer_catch && !targets.some(target =>
          target.cells[0].cell === cell && at < target.start + target.duration + 250 && at + duration + 250 > target.start)) {
          frames.push({ start: at, duration, cells: [{ cell, card: crypto.randomInt(1, 4) }] });
        }
        at += duration + crypto.randomInt(900, 4001);
      }
    }
    frames.sort((a, b) => a.start - b.start);
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
  if (input.values !== undefined) {
    if (!((type === 'fan_meeting' && input.kind === 'sort') || (type === 'sequence_relay' && input.kind === 'sequence')) ||
      !Array.isArray(input.values) || !input.values.length || input.values.length > 64 ||
      !input.values.every(Number.isInteger) || !Number.isInteger(input.offset) || input.offset! < 0) {
      throw new ActionGameError('연속 입력 정보가 올바르지 않습니다.');
    }
    const saved = previous.inputs || [];
    if (input.offset! > saved.length || input.values.some((value, i) =>
      input.offset! + i < saved.length && saved[input.offset! + i] !== value)) {
      throw new ActionGameError('입력 순서를 확인할 수 없습니다.');
    }
    let next = previous;
    for (const value of input.values.slice(Math.max(0, saved.length - input.offset!))) {
      next = advanceActionGame(type, target, next, { kind: input.kind, value }, now);
      if (next.done) break;
    }
    return { ...next };
  }
  const state: ActionState = { ...previous, clicked: [...previous.clicked] };
  if (state.done) return state;
  if (input.kind === 'ready') {
    if (state.starts_at !== null) return state;
    state.starts_at = now + (input.quick_start === true ? 0 : 3000);
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
  // Bound transport tolerance using the server's request receipt time, never a client clock.
  if (now >= state.ends_at + (type === 'streamer_catch' ? CATCH_INPUT_GRACE_MS : type === 'fan_meeting' ? SORT_INPUT_GRACE_MS : 0)) {
    state.done = true;
    return state;
  }
  if (!Number.isInteger(input.value)) throw new ActionGameError('입력값이 올바르지 않습니다.');
  if (type === 'fan_meeting' && input.kind === 'sort') {
    if (input.value !== 0 && input.value !== 1) throw new ActionGameError('왼쪽 또는 오른쪽을 선택해 주세요.');
    if (state.index >= target.deck.length) throw new ActionGameError('카드를 모두 분류했습니다.');
    if (target.deck[state.index] === input.value) { state.correct++; state.combo++; }
    else { state.mistakes++; state.combo = 0; }
    state.blocked_until = 0;
    state.index++;
    state.inputs = [...(state.inputs || []), input.value];
  } else if (type === 'streamer_catch' && input.kind === 'catch') {
    if (!Number.isInteger(input.frame)) throw new ActionGameError('화면 정보가 올바르지 않습니다.');
    const frame = target.frames[input.frame!];
    if (!frame || now < state.starts_at + frame.start || now >= state.starts_at + frame.start + frame.duration + CATCH_INPUT_GRACE_MS) {
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
    state.inputs = [...(state.inputs || []), input.value!];
    if (target.sequences[state.stage][state.position] !== input.value) {
      state.mistakes++;
      state.position = 0;
      if (state.mistakes >= 2) state.done = true;
      else {
        state.preview_at = now;
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
          state.preview_at = now;
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
  if (type === 'streamer_catch') return state.correct >= 10 && state.mistakes === 0
    ? 1200 : state.correct >= 7 && state.mistakes <= 2 ? 1000 : 0;
  return state.cleared === 5 && state.mistakes === 0 ? 1200 : state.cleared >= 4 ? 1000 : 0;
}

export function publicActionGame(type: ActionGameType, target: ActionTarget, state: ActionState, revision: number, now = Date.now(), receivedAt = now) {
  const { last_request, last_action, inputs, ...publicState } = state;
  return { game_type: type, revision, server_now: now, server_received_at: receivedAt,
    input_grace_ms: type === 'streamer_catch' ? CATCH_INPUT_GRACE_MS : type === 'fan_meeting' ? SORT_INPUT_GRACE_MS : 0, cards: target.cards,
    state: { ...publicState, input_count: inputs?.length || 0 },
    upcoming_cards: type === 'fan_meeting' ? target.deck.slice(state.index, state.index + 64) : [],
    target_count: type === 'streamer_catch' ? target.frames.filter(frame => frame.cells.some(cell => cell.card === 0)).length : 0,
    current_card: type === 'fan_meeting' ? target.deck[state.index] ?? null : null,
    frames: type === 'streamer_catch' ? target.frames : [],
    sequence: type === 'sequence_relay' && state.starts_at !== null ? target.sequences[state.stage] : [] };
}
