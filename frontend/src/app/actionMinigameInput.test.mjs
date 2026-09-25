import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeCatchCells, projectActionInputs, reconcileActionInputs } from './actionMinigameInput.ts';
import { minigamePress } from './minigamePress.ts';

const view = () => ({ revision: 1, server_now: 1000, cards: [], current_card: 0,
  upcoming_cards: [0, 1, 0, 0, 1], sequence: [0, 1, 1, 3], frames: [],
  state: { starts_at: 1000, ends_at: 21000, done: false, correct: 0, mistakes: 0,
    combo: 0, index: 0, blocked_until: 0, clicked: [], stage: 0, cleared: 0,
    position: 0, preview_at: 1000, input_at: 3800, input_count: 0 } });

test('fan sorting advances immediately even after a wrong press, without mutating confirmed state', () => {
  const saved = view();
  const next = projectActionInputs('fan_meeting', saved, [1, 1, 0]);
  assert.equal(next.state.correct, 2);
  assert.equal(next.state.mistakes, 1);
  assert.equal(next.state.index, 3);
  assert.equal(next.state.combo, 2);
  assert.deepEqual(next.upcoming_cards, [0, 1]);
  assert.equal(saved.state.index, 0);
  assert.equal(saved.upcoming_cards.length, 5);
});

test('partial acknowledgement preserves presses made during a delayed request', () => {
  const queue = { offset: 0, values: [0, 1, 0, 0] };
  const confirmed = view();
  Object.assign(confirmed.state, { input_count: 1, index: 1, correct: 1, combo: 1 });
  confirmed.upcoming_cards.shift();
  const pending = reconcileActionInputs(queue, confirmed);
  assert.deepEqual(pending, { offset: 1, values: [1, 0, 0] });
  const projected = projectActionInputs('fan_meeting', confirmed, pending.values);
  assert.equal(projected.state.correct, 4);
  assert.equal(projected.state.index, 4);
  assert.deepEqual(reconcileActionInputs(pending, confirmed), pending);
  assert.deepEqual(reconcileActionInputs(pending, { ...confirmed, state: { ...confirmed.state, done: true, input_count: 4 } }), { offset: 4, values: [] });
});

test('relay accepts repeated cards and a whole sequence without an acknowledgement between presses', () => {
  const saved = view();
  const partial = projectActionInputs('sequence_relay', saved, [0, 1, 1]);
  assert.equal(partial.state.position, 3);
  assert.equal(partial.awaiting_transition, undefined);
  const next = projectActionInputs('sequence_relay', saved, [0, 1, 1, 3]);
  assert.equal(next.state.cleared, 1);
  assert.equal(next.awaiting_transition, true);
  assert.equal(next.state.input_count, 4);
  assert.equal(saved.state.position, 0);
});

test('relay stops at a mistake or stage boundary instead of consuming the next preview', () => {
  const saved = view();
  const wrong = projectActionInputs('sequence_relay', saved, [0, 3, 1]);
  assert.equal(wrong.state.mistakes, 1);
  assert.equal(wrong.state.input_count, 2);
  assert.equal(wrong.awaiting_transition, true);
  saved.state.mistakes = 1;
  assert.equal(projectActionInputs('sequence_relay', saved, [2]).state.done, true);
  const extra = projectActionInputs('sequence_relay', view(), [0, 1, 1, 3, 2]);
  assert.equal(extra.state.input_count, 4);
});

test('catch cells enter and leave independently with stable appearance IDs', () => {
  const saved = view();
  saved.frames = [
    { start: 100, duration: 1500, cells: [{ cell: 2, card: 0 }] },
    { start: 500, duration: 750, cells: [{ cell: 5, card: 2 }] },
    { start: 2000, duration: 1100, cells: [{ cell: 2, card: 1 }] }
  ];
  assert.equal(activeCatchCells(saved, 1099).size, 0);
  assert.deepEqual([...activeCatchCells(saved, 1500)], [[2, { frame: 0, card: 0 }], [5, { frame: 1, card: 2 }]]);
  assert.deepEqual([...activeCatchCells(saved, 2250)], [[2, { frame: 0, card: 0 }]]);
  assert.equal(activeCatchCells(saved, 2600).size, 0);
  assert.deepEqual([...activeCatchCells(saved, 3000)], [[2, { frame: 2, card: 1 }]]);
});

test('pointer contact acts once, compatibility clicks do not repeat, keyboard remains supported', () => {
  let presses = 0;
  const handlers = minigamePress(() => presses++);
  const pointer = { button: 0, preventDefault() {}, currentTarget: { focus() {} } };
  handlers.onPointerDown(pointer);
  handlers.onClick({ detail: 1 });
  assert.equal(presses, 1);
  handlers.onPointerDown({ ...pointer, button: 2 });
  assert.equal(presses, 1);
  handlers.onClick({ detail: 0 });
  handlers.onPointerDown({ ...pointer, isPrimary: false });
  assert.equal(presses, 3);
});
