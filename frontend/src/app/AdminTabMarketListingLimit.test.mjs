import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./AdminTab.tsx', import.meta.url), 'utf8');

const sliceBetween = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
};

const settingsFlow = sliceBetween(
  'const fetchMarketListingLimit = async () =>',
  'const minifyCss = (css: string): string =>'
);
const settingsCard = sliceBetween(
  '{/* 사용자별 마켓 동시 등록 한도 */}',
  '{/* 아이템 추가/수정 폼 */}'
);

test('admin market listing limit reads and writes the protected config endpoint', () => {
  assert.match(settingsFlow, /apiFetch\('\/admin\/config\/market-listing-limit'\)/);
  assert.match(settingsFlow, /method: 'POST'/);
  assert.match(settingsFlow, /body: JSON\.stringify\(\{ limit \}\)/);
  assert.match(settingsFlow, /Number\.isInteger\(limit\)/);
  assert.match(settingsFlow, /limit < 1 \|\| limit > 100/);
});

test('shop tab renders a mobile-safe integer control and explains lowering behavior', () => {
  assert.match(settingsCard, /마켓 동시 등록 한도/);
  assert.match(settingsCard, /min="1"/);
  assert.match(settingsCard, /max="100"/);
  assert.match(settingsCard, /grid-cols-1[\s\S]*sm:grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.match(settingsCard, /기존 매물은 취소되지 않고/);
  assert.match(settingsCard, /disabled=\{isSavingMarketListingLimit\}/);
});

test('opening the shop tab refreshes the market listing limit', () => {
  const shopEffect = sliceBetween("if (subTab === 'shop')", "if (subTab === 'push')");
  assert.match(shopEffect, /fetchMarketListingLimit\(\)/);
});
