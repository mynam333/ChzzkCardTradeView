import assert from 'node:assert/strict';
import test from 'node:test';
import { compactUserCards } from '../../../backend/src/services/userCardsCompactService.ts';
import { buildInventoryReservations, expandInventoryCards, loadJsonWithDeadline, normalizeInventoryCardIds, normalizePendingMarketCardIds } from './inventoryLoad.ts';

test('inventory JSON deadline covers the response body read', async () => {
  await assert.rejects(
    loadJsonWithDeadline(
      async (signal) => ({
        ok: true,
        status: 200,
        json: () => new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        })
      }),
      { timeoutMs: 10 }
    ),
    (error) => error?.name === 'TimeoutError'
  );
});

test('inventory JSON load rejects a parent aborted before the request starts', async () => {
  const parent = new AbortController();
  parent.abort(new DOMException('route changed', 'AbortError'));
  let called = false;
  await assert.rejects(
    loadJsonWithDeadline(async () => {
      called = true;
      return new Response('{}');
    }, { timeoutMs: 100, parentSignal: parent.signal }),
    (error) => error?.name === 'AbortError'
  );
  assert.equal(called, false);
});

test('inventory JSON load rejects a parent aborted while reading the body', async () => {
  const parent = new AbortController();
  const pending = loadJsonWithDeadline(async (signal) => ({
    ok: true,
    status: 200,
    json: () => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })
  }), { timeoutMs: 100, parentSignal: parent.signal });
  parent.abort(new DOMException('identity changed', 'AbortError'));
  await assert.rejects(pending, (error) => error?.name === 'AbortError');
});

test('inventory reservations include sent offers and confirmed receiver offers', () => {
  assert.deepEqual(buildInventoryReservations([
    {
      sender_id: 'me',
      receiver_id: 'other',
      status: 'PENDING',
      sender_offer: { cards: [{ channel_id: 'alpha', star: 1, count: 2 }], point: 30 }
    },
    {
      sender_id: 'other',
      receiver_id: 'me',
      status: 'CONFIRMED',
      receiver_offer: { cards: [{ channel_id: 'alpha', star: 1, count: 1 }, { channel_id: 'beta', count: 3 }], point: 20 }
    },
    {
      sender_id: 'other',
      receiver_id: 'me',
      status: 'PENDING',
      receiver_offer: { cards: [{ channel_id: 'ignored', count: 99 }], point: 99 }
    }
  ], 'me'), {
    cards: { alpha: 3, beta: 3 },
    cardsByStar: { 'alpha#1': 3, 'beta#0': 3 },
    points: 50
  });
});

test('compact inventory expansion is lossless and reuses table objects', () => {
  const streamer = { channel_id: 'alpha', name: 'Alpha' };
  const border = { id: 3, type: 'BORDER', style: { color: 'red' } };
  const changedStreamer = { channel_id: 'alpha', name: 'Alpha old snapshot' };
  const payload = {
    version: 1,
    streamers: [streamer, changedStreamer],
    cosmetics: [{ kind: 'border', value: border }],
    cards: [
      { id: 1, channel_id: 'alpha', border_item_id: 3, name_effect_item_id: null },
      { id: 2, channel_id: 'alpha', border_ref: -1, name_effect_ref: -1 },
      { id: 3, channel_id: null, streamer_ref: null, border_item_id: null, name_effect_ref: -1 },
      { id: 4, channel_id: 'alpha', streamer_ref: 1, border_ref: 0, name_effect_ref: null }
    ]
  };

  const expanded = expandInventoryCards(payload);
  assert.strictEqual(expanded[0].streamer, streamer);
  assert.strictEqual(expanded[1].streamer, streamer);
  assert.strictEqual(expanded[0].border, border);
  assert.equal(expanded[0].name_effect, null);
  assert.equal(Object.hasOwn(expanded[1], 'border'), false);
  assert.equal(expanded[2].streamer, null);
  assert.strictEqual(expanded[3].streamer, changedStreamer);
  assert.strictEqual(expanded[3].border, border);
  assert.equal(Object.hasOwn(expanded[0], 'streamer_ref'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(expanded)), [
    { id: 1, channel_id: 'alpha', border_item_id: 3, name_effect_item_id: null, streamer, border, name_effect: null },
    { id: 2, channel_id: 'alpha', streamer },
    { id: 3, channel_id: null, border_item_id: null, streamer: null, border: null },
    { id: 4, channel_id: 'alpha', streamer: changedStreamer, border, name_effect: null }
  ]);
});

test('legacy inventory arrays pass through unchanged', () => {
  const legacy = [{ id: 1, streamer: { channel_id: 'alpha' } }];
  assert.strictEqual(expandInventoryCards(legacy), legacy);
});

test('inventory card ids normalize PostgreSQL BIGINT strings before pending-card identity checks', () => {
  const normalized = normalizeInventoryCardIds([{ id: '9001', channel_id: 'alpha' }, { id: 9002, channel_id: 'beta' }]);
  assert.deepEqual(normalized.map((card) => card.id), [9001, 9002]);
  assert.equal(new Set([9001]).has(normalized[0].id), true);
  assert.throws(() => normalizeInventoryCardIds([{ id: 'not-an-id' }]), /Invalid inventory card id/);
  assert.throws(() => normalizeInventoryCardIds([{ id: String(Number.MAX_SAFE_INTEGER + 1) }]), /Invalid inventory card id/);
});

test('pending market card ids normalize and deduplicate before availability matching', () => {
  assert.deepEqual(normalizePendingMarketCardIds([
    { status: 'PENDING', user_card_id: 9001 },
    { status: 'PENDING', user_card_id: '9001' },
    { status: 'SOLD', user_card_id: 9002 }
  ]), [9001]);
  assert.throws(() => normalizePendingMarketCardIds([{ status: 'PENDING', user_card_id: 0 }]), /Invalid pending market card id/);
  assert.throws(() => normalizePendingMarketCardIds([{ status: 'PENDING', user_card_id: '-3' }]), /Invalid pending market card id/);
});

test('compact inventory rejects invalid references instead of exposing partial cards', () => {
  assert.throws(() => expandInventoryCards({
    version: 1,
    cards: [{ id: 1, streamer_ref: 1 }],
    streamers: [{ channel_id: 'alpha' }],
    cosmetics: []
  }), /Invalid compact inventory reference/);
});

test('frontend decoder round-trips the backend compact codec across null, absent, and conflicting snapshots', () => {
  const legacy = [
    {
      id: 1,
      channel_id: 'alpha',
      border_item_id: 4,
      name_effect_item_id: null,
      streamer: { channel_id: 'alpha', name: 'Alpha' },
      border: { id: 4, name: 'Frame' },
      name_effect: null
    },
    {
      id: 2,
      channel_id: 'alpha',
      streamer: { channel_id: 'alpha', name: 'Older Alpha' },
      border: null,
      name_effect: undefined
    },
    {
      id: 3,
      channel_id: 'idless-streamer',
      streamer: { name: 'ID-less snapshot' },
      border_item_id: 9,
      border: { name: 'ID-less cosmetic' }
    },
    { id: 4, channel_id: 'absent' }
  ];
  const compact = compactUserCards(legacy);
  const expanded = expandInventoryCards(compact);
  assert.deepEqual(JSON.parse(JSON.stringify(expanded)), JSON.parse(JSON.stringify(legacy)));
});
