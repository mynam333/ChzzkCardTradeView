import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateActionClock } from './actionMinigameTiming.ts';

test('slow server processing does not advance the visible catch board', () => {
  // 50 ms each way, 900 ms processing, and a server clock 5 seconds ahead.
  const timing = estimateActionClock({ server_received_at: 6050, server_now: 6950 }, 1000, 2000);
  assert.deepEqual(timing, { offset: 5000, roundTrip: 100 });
  assert.equal(2000 + timing.offset, 7000);
});

test('a delayed response has a worse clock sample than a normal response', () => {
  const normal = estimateActionClock({ server_received_at: 6050, server_now: 6150 }, 1000, 1200);
  const delayed = estimateActionClock({ server_received_at: 6050, server_now: 6150 }, 1000, 2600);
  assert.equal(normal.offset, 5000);
  assert.ok(delayed.roundTrip > normal.roundTrip);
});

test('server processing is excluded even with a clock behind the browser', () => {
  assert.deepEqual(estimateActionClock({ server_received_at: 750, server_now: 1050 }, 1000, 1400), { offset: -300, roundTrip: 100 });
});

test('older responses without a receipt timestamp do not count DB time as network lead', () => {
  assert.deepEqual(estimateActionClock({ server_now: 2000 }, 1000, 2000), { offset: 0, roundTrip: 1000 });
});
