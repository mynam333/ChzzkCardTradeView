import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TRADE_SELECTION_PAGE_SIZE,
  clampTradeSelection,
  clearTradeResults,
  getTradeResultCapacity,
  paginateTradeResults,
  selectAllTradeResults,
  selectionIncludesEquippedCosmetics,
  summarizeTradeSelection
} from './tradeSelection.ts';

test('select all fills every searched result to its available limit and preserves other selections', () => {
  const selected = selectAllTradeResults(
    { outside: 2, stale: 4 },
    [
      { key: 'alpha#0', maxCount: 3 },
      { key: 'beta#2', maxCount: 1 },
      { key: 'stale', maxCount: 0 }
    ]
  );

  assert.deepEqual(selected, { outside: 2, 'alpha#0': 3, 'beta#2': 1 });
});

test('clear all removes only searched results', () => {
  assert.deepEqual(
    clearTradeResults(
      { outside: 2, 'alpha#0': 3, 'beta#2': 1 },
      [{ key: 'alpha#0' }, { key: 'beta#2' }]
    ),
    { outside: 2 }
  );
});

test('selection summary and capacity count card quantities rather than only groups', () => {
  const results = [
    { key: 'alpha#0', maxCount: 3 },
    { key: 'beta#2', maxCount: 2 }
  ];
  assert.deepEqual(summarizeTradeSelection({ outside: 8, 'alpha#0': 30, 'beta#2': 1 }, results), {
    groupCount: 2,
    cardCount: 4
  });
  assert.equal(getTradeResultCapacity(results), 5);
});

test('final selection drops unavailable groups and clamps stale quantities', () => {
  assert.deepEqual(
    clampTradeSelection(
      { unavailable: 1, 'alpha#0': 30, 'beta#2': 1 },
      [{ key: 'alpha#0', maxCount: 3 }, { key: 'beta#2', maxCount: 0 }]
    ),
    { 'alpha#0': 3 }
  );
});

test('pagination clamps pages and never renders more than the fixed trade page size', () => {
  const results = Array.from({ length: TRADE_SELECTION_PAGE_SIZE * 2 + 3 }, (_, index) => index);
  const middle = paginateTradeResults(results, 2);
  const last = paginateTradeResults(results, 999);

  assert.equal(middle.items.length, TRADE_SELECTION_PAGE_SIZE);
  assert.equal(last.page, 3);
  assert.deepEqual(last.items, [96, 97, 98]);
});

test('equipped cosmetic detection scans inventory once and only checks selected available instances', () => {
  let channelReads = 0;
  const cards = Array.from({ length: 500 }, (_, index) => ({
    id: index + 1,
    get channel_id() {
      channelReads += 1;
      return `channel-${index % 250}`;
    },
    star: 0,
    is_locked: index === 0,
    border: index === 250 ? { id: 'equipped' } : null
  }));

  assert.equal(selectionIncludesEquippedCosmetics({ 'channel-0#0': 1 }, cards, new Set()), true);
  assert.ok(channelReads <= cards.length, `expected one pass, read channel_id ${channelReads} times`);
  assert.equal(selectionIncludesEquippedCosmetics({ 'channel-1#0': 1 }, cards, new Set([2])), false);
  assert.equal(selectionIncludesEquippedCosmetics({ 'channel-2#0': 1 }, cards, new Set()), false);
});
