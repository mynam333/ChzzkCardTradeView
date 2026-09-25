export type ActionCard = { name: string; image_url: string; channel_id: string };
export type ActionView = {
  revision: number; server_now: number; server_received_at?: number; input_grace_ms?: number;
  cards: ActionCard[]; current_card: number | null; upcoming_cards?: number[]; target_count?: number; sequence: number[];
  frames: Array<{ start: number; duration: number; cells: Array<{ cell: number; card: number }> }>;
  state: { starts_at: number | null; ends_at: number | null; done: boolean; correct: number; mistakes: number;
    combo: number; index: number; blocked_until: number; clicked: string[]; stage: number; cleared: number;
    position: number; preview_at: number; input_at: number; input_count?: number };
  awaiting_transition?: boolean;
};
export type OrderedInputs = { offset: number; values: number[] };

export function canPressOrderedAction(type: string, view: ActionView, now: number): boolean {
  const state = view.state;
  if (view.awaiting_transition || state.done || state.starts_at === null || state.ends_at === null ||
    now < state.starts_at || now >= state.ends_at) return false;
  if (type === 'fan_meeting') return view.current_card !== null && now >= state.blocked_until;
  return type === 'sequence_relay' && now >= state.input_at;
}

export function reconcileActionInputs(queue: OrderedInputs, view: ActionView): OrderedInputs {
  const count = view.state.input_count || 0;
  return { offset: count, values: view.state.done ? [] : queue.values.slice(Math.max(0, count - queue.offset)) };
}

// Feedback is local; only acknowledged server state is used for settlement.
export function projectActionInputs(type: string, view: ActionView, values: number[]): ActionView {
  const next = { ...view, state: { ...view.state }, upcoming_cards: [...(view.upcoming_cards || [])] };
  for (const value of values) {
    if (next.state.done || next.awaiting_transition) break;
    if (type === 'fan_meeting') {
      const expected = next.upcoming_cards.shift();
      if (expected === undefined) break;
      if (expected === value) { next.state.correct++; next.state.combo++; }
      else { next.state.mistakes++; next.state.combo = 0; }
      next.state.index++;
      next.current_card = next.upcoming_cards[0] ?? null;
    } else if (type === 'sequence_relay') {
      if (view.sequence[next.state.position] !== value) {
        next.state.mistakes++;
        next.state.position = 0;
        next.state.done = next.state.mistakes >= 2;
        next.awaiting_transition = true;
      } else {
        next.state.position++;
        if (next.state.position === view.sequence.length) {
          next.state.cleared = next.state.stage + 1;
          next.state.done = next.state.cleared === 5;
          next.awaiting_transition = true;
        }
      }
    }
    next.state.input_count = (next.state.input_count || 0) + 1;
  }
  return next;
}

export function activeCatchCells(view: ActionView, now: number) {
  const cells = new Map<number, { frame: number; card: number }>();
  if (view.state.starts_at === null) return cells;
  const elapsed = now - view.state.starts_at;
  view.frames.forEach((frame, index) => {
    if (elapsed >= frame.start && elapsed < frame.start + frame.duration) {
      frame.cells.forEach(item => cells.set(item.cell, { frame: index, card: item.card }));
    }
  });
  return cells;
}
