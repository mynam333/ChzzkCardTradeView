import assert from 'node:assert/strict';
import test from 'node:test';
import { formatWeeklyRemaining, getWeeklyServerOffset, parseWeeklyMissionsPayload, weeklyProgressPercent } from './weeklyMissions.ts';

const payload = () => ({
  week_key: '2026-11-16',
  starts_at: '2026-11-15T15:00:00.000Z',
  ends_at: '2026-11-22T15:00:00.000Z',
  server_now: '2026-11-18T03:00:00.000Z',
  missions: [
    { id: 1, mission_code: 'easy_draw', difficulty: 'easy', title: '카드 모으기', description: '카드를 모으세요.', progress: 3, target: 5,
      conditions: [{ label: '카드 획득', progress: 3, target: 5 }], reward_points: 100, reward_minigame_tickets: 0,
      reward_free_draw_tickets: 1, status: 'in_progress', claimed_at: null }
  ],
  summary: { completed: 0, claimed: 0, total: 5 }
});

test('parses a valid weekly payload without losing condition, reward, or reset fields', () => {
  assert.deepEqual(parseWeeklyMissionsPayload(payload()), payload());
});

test('rejects stale or ambiguous mission payloads instead of rendering unsafe claim controls', () => {
  assert.equal(parseWeeklyMissionsPayload({ ...payload(), week_key: 'bad' }), null);
  assert.equal(parseWeeklyMissionsPayload({ ...payload(), missions: [{ ...payload().missions[0], status: 'done' }] }), null);
  assert.equal(parseWeeklyMissionsPayload({ ...payload(), missions: [payload().missions[0], payload().missions[0]] }), null);
  assert.equal(parseWeeklyMissionsPayload({ ...payload(), missions: [{ ...payload().missions[0], conditions: [] }] }), null);
});

test('uses the server clock for reset countdown and clamps progress', () => {
  assert.equal(getWeeklyServerOffset('2026-11-18T03:00:10.000Z', Date.parse('2026-11-18T03:00:00.000Z')), 10_000);
  assert.equal(formatWeeklyRemaining('2026-11-22T15:00:00.000Z', Date.parse('2026-11-21T13:30:00.000Z')), '마감까지 1일 1시간');
  assert.equal(formatWeeklyRemaining('2026-11-22T15:00:00.000Z', Date.parse('2026-11-22T15:00:00.000Z')), '이번 주 마감 · 갱신 중');
  assert.equal(weeklyProgressPercent({ progress: 8, target: 5 }), 100);
});
