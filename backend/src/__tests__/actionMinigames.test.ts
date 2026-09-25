import { describe, expect, it } from 'vitest';
import {
  ACTION_GAMES, CATCH_INPUT_GRACE_MS, SORT_INPUT_GRACE_MS, ActionGameType, ActionState, actionReward, advanceActionGame,
  createActionTarget, initialActionState, publicActionGame
} from '../services/actionMinigames';

const cards = Array.from({ length: 8 }, (_, i) => ({ channel_id: `c${i}`, name: `사진 ${i}`, image_url: `https://example.com/${i}.png` }));
const ready = (type: ActionGameType) => {
  const target = createActionTarget(type, cards);
  const state = advanceActionGame(type, target, initialActionState(), { kind: 'ready' }, 1000);
  return { target, state };
};

describe('new minigame generation and timing', () => {
  it.each(ACTION_GAMES)('%s uses distinct registered images and does not start until ready', type => {
    const target = createActionTarget(type, cards);
    expect(new Set(target.cards.map(card => card.image_url)).size).toBe(type === 'fan_meeting' ? 2 : 4);
    target.cards.forEach(card => expect(cards).toContainEqual(card));
    expect(() => advanceActionGame(type, target, initialActionState(), { kind: 'finish' }, 1000)).toThrow();
    const state = advanceActionGame(type, target, initialActionState(), { kind: 'ready' }, 50_000);
    expect(state.starts_at).toBe(53_000);
    expect(advanceActionGame(type, target, state, { kind: 'ready' }, 80_000)).toEqual(state);
  });

  it('rejects visually identical source URLs and duplicate channels', () => {
    expect(() => createActionTarget('fan_meeting', cards.map(card => ({ ...card, image_url: 'https://example.com/same.png' })))).toThrow();
    expect(() => createActionTarget('fan_meeting', cards.map(card => ({ ...card, channel_id: 'same' })))).toThrow();
  });

  it('guarantees twelve fully visible targets in 30 seconds with independent cell timing', () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const { frames } = createActionTarget('streamer_catch', cards);
      const targets = frames.filter(frame => frame.cells.some(cell => cell.card === 0));
      expect(targets).toHaveLength(12);
      expect(new Set(targets.map(frame => frame.duration)).size).toBeGreaterThan(1);
      expect(new Set(targets.slice(1).map((frame, i) => frame.start - targets[i].start)).size).toBeGreaterThan(1);
      for (const frame of frames) {
        expect(frame.start).toBeGreaterThanOrEqual(0);
        expect(frame.start + frame.duration).toBeLessThanOrEqual(30_000);
        expect(frame.duration).toBeGreaterThanOrEqual(frame.cells[0].card === 0 ? 1100 : 750);
        expect(frame.duration).toBeLessThanOrEqual(1900);
        expect(frame.cells).toHaveLength(1);
        expect(frame.cells[0].cell).toBeGreaterThanOrEqual(0);
        expect(frame.cells[0].cell).toBeLessThan(9);
        expect(frames.some(other => other !== frame && other.cells[0].cell === frame.cells[0].cell &&
          other.start < frame.start + frame.duration && other.start + other.duration > frame.start)).toBe(false);
      }
      targets.slice(1).forEach((frame, i) => expect(frame.start).toBeGreaterThan(targets[i].start + targets[i].duration));
      expect(frames.some((frame, i) => frames.slice(i + 1).some(other => other.start < frame.start + frame.duration))).toBe(true);
    }
  });

  it('publishes a bounded sorting queue and keeps future relay stages private', () => {
    const fan = ready('fan_meeting');
    expect(publicActionGame('fan_meeting', fan.target, fan.state, 0)).not.toHaveProperty('deck');
    expect(publicActionGame('fan_meeting', fan.target, fan.state, 0).upcoming_cards).toEqual(fan.target.deck.slice(0, 64));
    const relay = ready('sequence_relay');
    expect(relay.target.sequences.map(sequence => sequence.length)).toEqual([4, 5, 6, 7, 8]);
    expect(publicActionGame('sequence_relay', relay.target, initialActionState(), 0).sequence).toEqual([]);
    const publicView = publicActionGame('sequence_relay', relay.target, { ...relay.state, last_request: 'private' }, 0);
    expect(publicView.sequence).toEqual(relay.target.sequences[0]);
    expect(publicView).not.toHaveProperty('sequences');
    expect(publicView.state).not.toHaveProperty('last_request');
  });
});

describe('server-owned action rules', () => {
  it.each(ACTION_GAMES)('%s quick restart skips only the countdown and is idempotent', type => {
    const target = createActionTarget(type, cards);
    const normal = advanceActionGame(type, target, initialActionState(), { kind: 'ready' }, 1000);
    const fast = advanceActionGame(type, target, initialActionState(), { kind: 'ready', quick_start: true }, 1000);
    expect(fast.starts_at).toBe(1000);
    expect(fast.ends_at! - fast.starts_at!).toBe(normal.ends_at! - normal.starts_at!);
    expect(advanceActionGame(type, target, fast, { kind: 'ready', quick_start: true }, 2000)).toEqual(fast);
  });

  it('merges only matching input prefixes and rejects skipped, altered or oversized batches', () => {
    const { target, state } = ready('fan_meeting');
    const first = advanceActionGame('fan_meeting', target, state, { kind: 'sort', offset: 0, values: target.deck.slice(0, 4) }, 4000);
    const next = advanceActionGame('fan_meeting', target, first, { kind: 'sort', offset: 2, values: target.deck.slice(2, 9) }, 4000);
    expect(next).toMatchObject({ correct: 9, index: 9, combo: 9 });
    expect(advanceActionGame('fan_meeting', target, next, { kind: 'sort', offset: 2, values: target.deck.slice(2, 9) }, 4000)).toEqual(next);
    for (const input of [
      { kind: 'sort' as const, offset: 10, values: [0] },
      { kind: 'sort' as const, offset: 0, values: [1 - target.deck[0]] },
      { kind: 'sort' as const, offset: 9, values: Array(65).fill(0) },
      { kind: 'sort' as const, offset: 9, values: [2] },
      { kind: 'sort' as const, offset: -1, values: [0] }
    ]) expect(() => advanceActionGame('fan_meeting', target, next, input, 4000)).toThrow();
    expect(next.correct).toBe(9);
  });

  it('accepts a rapid relay sequence as one batch and enforces the next preview', () => {
    const { target, state } = ready('sequence_relay');
    const input = { kind: 'sequence' as const, offset: 0, values: target.sequences[0] };
    expect(() => advanceActionGame('sequence_relay', target, state, input, state.input_at - 1)).toThrow();
    const next = advanceActionGame('sequence_relay', target, state, input, state.input_at);
    expect(next).toMatchObject({ stage: 1, cleared: 1, position: 0, inputs: target.sequences[0], preview_at: state.input_at });
    expect(() => advanceActionGame('sequence_relay', target, next, { kind: 'sequence', offset: 4, values: target.sequences[1] }, next.input_at - 1)).toThrow();
    expect(() => advanceActionGame('sequence_relay', target, state, { ...input, values: [...input.values, 0] }, state.input_at)).toThrow();
    expect(state.stage).toBe(0);
  });
  it('blocks sorting for exactly 500ms after a mistake and keeps correct inputs immediate', () => {
    const { target, state } = ready('fan_meeting');
    expect(() => advanceActionGame('fan_meeting', target, state, { kind: 'sort', value: 0 }, 3999)).toThrow();
    const wrong = advanceActionGame('fan_meeting', target, state, { kind: 'sort', value: 1 - target.deck[0] }, 4000);
    expect(wrong).toMatchObject({ correct: 0, mistakes: 1, blocked_until: 4500, index: 1 });
    expect(() => advanceActionGame('fan_meeting', target, wrong, { kind: 'sort', value: target.deck[1] }, 4499)).toThrow('0.5초');
    const correct = advanceActionGame('fan_meeting', target, wrong, { kind: 'sort', value: target.deck[1] }, 4500);
    expect(correct).toMatchObject({ correct: 1, mistakes: 1, combo: 1, index: 2 });
    expect(advanceActionGame('fan_meeting', target, correct, { kind: 'sort', value: target.deck[2] }, 4500)).toMatchObject({ correct: 2, index: 3 });
    expect(state.index).toBe(0);
    expect(advanceActionGame('fan_meeting', target, correct, { kind: 'sort', value: target.deck[2] }, state.ends_at! + SORT_INPUT_GRACE_MS)).toMatchObject({ correct: 1, done: true });
    expect(() => advanceActionGame('fan_meeting', target, state, { kind: 'finish' }, 4500)).toThrow();
  });

  it('saves only the batch prefix through a mistake and cannot bypass its penalty', () => {
    const { target, state } = ready('fan_meeting');
    const values = [target.deck[0], 1 - target.deck[1], target.deck[2], target.deck[3]];
    const wrong = advanceActionGame('fan_meeting', target, state, { kind: 'sort', offset: 0, values }, 4000);
    expect(wrong).toMatchObject({ correct: 1, mistakes: 1, index: 2, blocked_until: 4500, inputs: values.slice(0, 2) });
    expect(() => advanceActionGame('fan_meeting', target, wrong, { kind: 'sort', offset: 0, values }, 4499)).toThrow('0.5초');
    const next = advanceActionGame('fan_meeting', target, wrong, { kind: 'sort', offset: 0, values }, 4500);
    expect(next).toMatchObject({ correct: 3, mistakes: 1, index: 4, combo: 2, inputs: values });
    expect(advanceActionGame('fan_meeting', target, next, { kind: 'sort', offset: 0, values }, 4500)).toEqual(next);
  });

  it('rejects catch clicks before appearance, after the receipt window, on empty cells or twice', () => {
    const { target, state } = ready('streamer_catch');
    const frameIndex = target.frames.findIndex(frame => frame.cells.some(cell => cell.card === 0));
    const frame = target.frames[frameIndex];
    const cell = frame.cells.find(cell => cell.card === 0)!.cell;
    const click = { kind: 'catch' as const, frame: frameIndex, value: cell };
    const at = state.starts_at! + frame.start;
    expect(() => advanceActionGame('streamer_catch', target, state, click, at - 1)).toThrow();
    expect(() => advanceActionGame('streamer_catch', target, state, click, at + frame.duration + CATCH_INPUT_GRACE_MS)).toThrow();
    const clicked = advanceActionGame('streamer_catch', target, state, click, at + frame.duration + CATCH_INPUT_GRACE_MS - 1);
    expect(clicked.correct).toBe(1);
    expect(() => advanceActionGame('streamer_catch', target, clicked, click, at + 100)).toThrow();
    const empty = Array.from({ length: 9 }, (_, i) => i).find(i => !frame.cells.some(c => c.cell === i))!;
    expect(() => advanceActionGame('streamer_catch', target, state, { ...click, value: empty }, at + 100)).toThrow();
    const wrongIndex = target.frames.findIndex(item => item.cells[0].card !== 0);
    const wrong = target.frames[wrongIndex];
    expect(advanceActionGame('streamer_catch', target, state, { kind: 'catch', frame: wrongIndex, value: wrong.cells[0].cell }, state.starts_at! + wrong.start + 100)).toMatchObject({ correct: 0, mistakes: 1 });
  });

  it('requires the preview to finish, replays the same sequence and ends on the second mistake', () => {
    const { target, state } = ready('sequence_relay');
    const correct = { kind: 'sequence' as const, value: target.sequences[0][0] };
    expect(() => advanceActionGame('sequence_relay', target, state, correct, state.input_at - 1)).toThrow();
    const wrong = { ...correct, value: (correct.value + 1) % 4 };
    const retry = advanceActionGame('sequence_relay', target, state, wrong, state.input_at);
    expect(retry).toMatchObject({ mistakes: 1, stage: 0, position: 0, done: false });
    expect(publicActionGame('sequence_relay', target, retry, 1).sequence).toEqual(target.sequences[0]);
    const failed = advanceActionGame('sequence_relay', target, retry, wrong, retry.input_at);
    expect(failed).toMatchObject({ mistakes: 2, done: true });
    expect(actionReward('sequence_relay', failed)).toBe(0);
  });

  it('progresses through all five stages and keeps the fourth-stage reward on a final-stage failure', () => {
    const { target, state } = ready('sequence_relay');
    let next = state;
    for (let stage = 0; stage < 4; stage++) {
      const inputAt = next.input_at;
      target.sequences[stage].forEach((value, index) => {
        next = advanceActionGame('sequence_relay', target, next, { kind: 'sequence', value }, inputAt + index * 200);
      });
      expect(next.cleared).toBe(stage + 1);
    }
    const finalStage = next;
    const wrong = (target.sequences[4][0] + 1) % 4;
    next = advanceActionGame('sequence_relay', target, next, { kind: 'sequence', value: wrong }, next.input_at);
    next = advanceActionGame('sequence_relay', target, next, { kind: 'sequence', value: wrong }, next.input_at);
    expect(actionReward('sequence_relay', next)).toBe(1000);
    next = finalStage;
    const inputAt = next.input_at;
    target.sequences[4].forEach((value, index) => { next = advanceActionGame('sequence_relay', target, next, { kind: 'sequence', value }, inputAt + index * 200); });
    expect(next).toMatchObject({ done: true, cleared: 5 });
    expect(actionReward('sequence_relay', next)).toBe(1200);
  });
});

describe('fixed reward thresholds', () => {
  it.each([
    ['fan_meeting', { correct: 14 }, 0], ['fan_meeting', { correct: 15 }, 1000],
    ['fan_meeting', { correct: 19 }, 1000], ['fan_meeting', { correct: 20 }, 1200],
    ['fan_meeting', { correct: 20, mistakes: 1 }, 1000], ['fan_meeting', { correct: 24, mistakes: 1 }, 1000],
    ['fan_meeting', { correct: 25, mistakes: 3 }, 1200],
    ['streamer_catch', { correct: 6 }, 0], ['streamer_catch', { correct: 7, mistakes: 2 }, 1000],
    ['streamer_catch', { correct: 7, mistakes: 3 }, 0], ['streamer_catch', { correct: 9 }, 1000],
    ['streamer_catch', { correct: 10, mistakes: 1 }, 1000], ['streamer_catch', { correct: 10 }, 1200],
    ['streamer_catch', { correct: 11 }, 1200], ['streamer_catch', { correct: 12 }, 1200],
    ['streamer_catch', { correct: 12, mistakes: 1 }, 1000],
    ['sequence_relay', { cleared: 3 }, 0], ['sequence_relay', { cleared: 4 }, 1000],
    ['sequence_relay', { cleared: 4, mistakes: 2 }, 1000], ['sequence_relay', { cleared: 5, mistakes: 1 }, 1000],
    ['sequence_relay', { cleared: 5 }, 1200]
  ] as [ActionGameType, Partial<ActionState>, number][])('%s %j yields exactly %i points', (type, progress, reward) => {
    expect(actionReward(type, { ...initialActionState(), ...progress, done: true })).toBe(reward);
  });
});
