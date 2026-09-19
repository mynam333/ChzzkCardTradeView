import { describe, expect, it } from 'vitest';
import {
  ACTION_GAMES, CATCH_INPUT_GRACE_MS, ActionGameType, ActionState, actionReward, advanceActionGame,
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

  it('always schedules ten catch opportunities in exactly 25 seconds', () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const { frames } = createActionTarget('streamer_catch', cards);
      expect(frames).toHaveLength(25);
      expect(frames.filter(frame => frame.cells.some(cell => cell.card === 0))).toHaveLength(10);
      expect(frames.reduce((sum, frame) => sum + frame.duration, 0)).toBe(25_000);
      let elapsed = 0;
      for (const frame of frames) {
        expect(frame.start).toBe(elapsed);
        expect(frame.duration).toBeGreaterThanOrEqual(800);
        expect(frame.duration).toBeLessThanOrEqual(1200);
        expect(new Set(frame.cells.map(cell => cell.cell)).size).toBe(3);
        expect(new Set(frame.cells.map(cell => cell.card)).size).toBe(3);
        elapsed += frame.duration;
      }
    }
  });

  it('keeps future sorting cards and relay stages out of public responses', () => {
    const fan = ready('fan_meeting');
    expect(publicActionGame('fan_meeting', fan.target, fan.state, 0)).not.toHaveProperty('deck');
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
  it('counts a sort once, enforces the half-second penalty and stops at 20 seconds', () => {
    const { target, state } = ready('fan_meeting');
    expect(() => advanceActionGame('fan_meeting', target, state, { kind: 'sort', value: 0 }, 3999)).toThrow();
    const wrong = advanceActionGame('fan_meeting', target, state, { kind: 'sort', value: 1 - target.deck[0] }, 4000);
    expect(wrong).toMatchObject({ correct: 0, mistakes: 1, blocked_until: 4500, index: 1 });
    expect(() => advanceActionGame('fan_meeting', target, wrong, { kind: 'sort', value: target.deck[1] }, 4499)).toThrow();
    const correct = advanceActionGame('fan_meeting', target, wrong, { kind: 'sort', value: target.deck[1] }, 4500);
    expect(correct).toMatchObject({ correct: 1, mistakes: 1, combo: 1, index: 2 });
    expect(state.index).toBe(0);
    expect(advanceActionGame('fan_meeting', target, correct, { kind: 'sort', value: target.deck[2] }, state.ends_at!)).toMatchObject({ correct: 1, done: true });
    expect(() => advanceActionGame('fan_meeting', target, state, { kind: 'finish' }, 4500)).toThrow();
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
    const wrong = frame.cells.find(cell => cell.card !== 0)!;
    expect(advanceActionGame('streamer_catch', target, state, { ...click, value: wrong.cell }, at + 100)).toMatchObject({ correct: 0, mistakes: 1 });
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
    ['sequence_relay', { cleared: 3 }, 0], ['sequence_relay', { cleared: 4 }, 1000],
    ['sequence_relay', { cleared: 4, mistakes: 2 }, 1000], ['sequence_relay', { cleared: 5, mistakes: 1 }, 1000],
    ['sequence_relay', { cleared: 5 }, 1200]
  ] as [ActionGameType, Partial<ActionState>, number][])('%s %j yields exactly %i points', (type, progress, reward) => {
    expect(actionReward(type, { ...initialActionState(), ...progress, done: true })).toBe(reward);
  });
});
