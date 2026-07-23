import assert from 'node:assert/strict';
import test from 'node:test';
import { selectLatestReplayScene } from './arenaReplay.ts';

const event = (seq, turnNo, eventType) => ({ seq, turnNo, eventType, payload: {} });

test('다음 턴 드로우가 뒤에 있어도 직전 전투 장면을 선택한다', () => {
  const result = selectLatestReplayScene([
    event(11, 3, 'line_attack'),
    event(12, 3, 'card_defeated'),
    event(13, 4, 'draw'),
    event(14, 4, 'draw'),
    event(15, 3, 'turn_end')
  ]);

  assert.deepEqual(result.visualEvents.map(({ seq }) => seq), [11, 12]);
  assert.deepEqual(result.events.map(({ seq }) => seq), [11, 12, 15]);
});

test('새 턴에 시각 이벤트가 생기면 가장 최근 시각 장면으로 전환한다', () => {
  const result = selectLatestReplayScene([
    event(11, 3, 'line_attack'),
    event(12, 4, 'draw'),
    event(13, 4, 'direct_attack')
  ]);

  assert.deepEqual(result.visualEvents.map(({ seq }) => seq), [13]);
});

test('시각 이벤트가 없으면 가장 큰 턴 번호의 기록만 표시한다', () => {
  const result = selectLatestReplayScene([
    event(1, 1, 'turn_start'),
    event(2, 2, 'draw')
  ]);

  assert.deepEqual(result.events.map(({ seq }) => seq), [2]);
  assert.deepEqual(result.visualEvents, []);
});

test('최근 해결 턴이 조용했다면 예전 전투를 다시 재생하지 않는다', () => {
  const result = selectLatestReplayScene([
    event(1, 2, 'line_attack'),
    event(2, 2, 'turn_end'),
    event(3, 3, 'turn_start'),
    event(4, 4, 'draw'),
    event(5, 3, 'turn_end')
  ]);

  assert.deepEqual(result.events.map(({ seq }) => seq), [3, 5]);
  assert.deepEqual(result.visualEvents, []);
});
