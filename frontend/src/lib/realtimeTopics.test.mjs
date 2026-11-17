import assert from 'node:assert/strict';
import test from 'node:test';
import { getRealtimeTopicsForPathname } from './realtimeTopics.ts';

test('shop and unrelated routes retain their existing topic scopes', () => {
  assert.deepEqual(
    new Set(getRealtimeTopicsForPathname('/shop').split(',')),
    new Set(['maintenance', 'ranking', 'shop', 'market'])
  );
  assert.deepEqual(
    new Set(getRealtimeTopicsForPathname('/inventory').split(',')),
    new Set(['maintenance', 'ranking'])
  );
});
