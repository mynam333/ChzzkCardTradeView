import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeCatchCells, canPressOrderedAction, canReplayHiddenSequencePreview, canRestartSequencePreview, projectActionInputs, reconcileActionInputs, resolveSequenceTiming, sequencePreviewFrame, sequenceReplayStart, shouldReplaySequencePreview } from './actionMinigameInput.ts';
import { isPrimaryMinigamePointer, minigamePress, preventRepeatedKeyboardActivation } from './minigamePress.ts';

const view = () => ({ revision: 1, server_now: 1000, cards: [], current_card: 0,
  upcoming_cards: [0, 1, 0, 0, 1], sequence: [0, 1, 1, 3], frames: [],
  state: { starts_at: 1000, ends_at: 21000, done: false, correct: 0, mistakes: 0,
    combo: 0, index: 0, blocked_until: 0, clicked: [], stage: 0, cleared: 0,
    position: 0, preview_at: 1000, input_at: 3800, input_count: 0 } });

test('projects queued fan inputs without mutating confirmed state', () => {
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

test('every ordered input path enforces the penalty boundary and game clock', () => {
  const saved = view();
  saved.state.blocked_until = 4500;
  assert.equal(canPressOrderedAction('fan_meeting', saved, 4499), false);
  assert.equal(canPressOrderedAction('fan_meeting', saved, 4500), true);
  assert.equal(canPressOrderedAction('fan_meeting', saved, 21000), false);
  saved.state.starts_at = null;
  assert.equal(canPressOrderedAction('fan_meeting', saved, 4500), false);
});

test('rapid correct relay input stays enabled while previews and stage transitions remain protected', () => {
  const saved = view();
  assert.equal(canPressOrderedAction('sequence_relay', saved, 3799), false);
  assert.equal(canPressOrderedAction('sequence_relay', saved, 3800), true);
  saved.state.position = 2;
  assert.equal(canPressOrderedAction('sequence_relay', saved, 3800), true);
  saved.awaiting_transition = true;
  assert.equal(canPressOrderedAction('sequence_relay', saved, 3800), false);
});

test('relay preview uses session timing while old and malformed sessions keep legacy timing', () => {
  const current = view();
  current.sequence_timing = { step_ms: 1000, visible_ms: 800 };
  assert.deepEqual(resolveSequenceTiming(current), current.sequence_timing);
  assert.deepEqual(sequencePreviewFrame(current, 1799), { index: 0, visible: true });
  assert.deepEqual(sequencePreviewFrame(current, 1800), { index: 0, visible: false });
  assert.deepEqual(sequencePreviewFrame(current, 2000), { index: 1, visible: true });

  const legacy = view();
  assert.deepEqual(resolveSequenceTiming(legacy), { step_ms: 700, visible_ms: 620 });
  assert.deepEqual(sequencePreviewFrame(legacy, 1619), { index: 0, visible: true });
  assert.deepEqual(sequencePreviewFrame(legacy, 1620), { index: 0, visible: false });
  legacy.sequence_timing = { step_ms: 0, visible_ms: 100 };
  assert.deepEqual(resolveSequenceTiming(legacy), { step_ms: 700, visible_ms: 620 });
});

test('relay only replays a complete preview for a fresh stage or retry', () => {
  const fresh = view();
  assert.equal(sequenceReplayStart(fresh, 900), 1000);
  assert.equal(sequenceReplayStart(fresh, 1200), 1200);
  assert.equal(shouldReplaySequencePreview(fresh), true);
  assert.equal(shouldReplaySequencePreview(fresh, '0:3800'), false);
  assert.equal(canReplayHiddenSequencePreview(fresh, 3799), true);
  assert.equal(canReplayHiddenSequencePreview(fresh, 3800), false);
  fresh.state.position = 2;
  assert.equal(shouldReplaySequencePreview(fresh), false);
  assert.equal(canRestartSequencePreview(fresh), false);
  fresh.state.position = 0;
  fresh.state.input_at = 7600;
  assert.equal(shouldReplaySequencePreview(fresh, '0:3800'), true);
  assert.equal(canRestartSequencePreview(fresh), true);
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
  assert.equal(isPrimaryMinigamePointer({ isPrimary: true }), true);
  assert.equal(isPrimaryMinigamePointer({ isPrimary: false }), false);
});

test('held Enter and Space cannot repeat a focused card activation', () => {
  let prevented = 0;
  const event = key => ({ key, repeat: true, preventDefault() { prevented++; } });
  assert.equal(preventRepeatedKeyboardActivation(event('Enter')), true);
  assert.equal(preventRepeatedKeyboardActivation(event(' ')), true);
  assert.equal(preventRepeatedKeyboardActivation(event('1')), false);
  assert.equal(preventRepeatedKeyboardActivation({ ...event('Enter'), repeat: false }), false);
  assert.equal(prevented, 2);
});
