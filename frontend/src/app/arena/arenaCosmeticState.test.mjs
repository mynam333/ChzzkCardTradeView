import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getSuccessfulRequestApplyVersion,
  getArenaCosmeticStatusLabel,
  getArenaCosmeticToggleLabel,
  isArenaCosmeticActive,
  normalizeArenaCosmeticActive
} from './arenaCosmeticState.ts';

test('arena cosmetic status and action labels describe opposite concepts clearly', () => {
  assert.equal(isArenaCosmeticActive({ active: true }), true);
  assert.equal(getArenaCosmeticStatusLabel({ active: true }), '판매 중');
  assert.equal(getArenaCosmeticToggleLabel({ active: true }), '판매 중지');

  assert.equal(isArenaCosmeticActive({ active: false }), false);
  assert.equal(getArenaCosmeticStatusLabel({ active: false }), '비활성');
  assert.equal(getArenaCosmeticToggleLabel({ active: false }), '판매 시작');
});

test('API activation normalization rejects false-like strings', () => {
  assert.equal(normalizeArenaCosmeticActive(true), true);
  assert.equal(normalizeArenaCosmeticActive(1), true);
  assert.equal(normalizeArenaCosmeticActive('1'), true);
  assert.equal(normalizeArenaCosmeticActive('true'), true);
  assert.equal(normalizeArenaCosmeticActive('t'), true);
  assert.equal(normalizeArenaCosmeticActive(false), false);
  assert.equal(normalizeArenaCosmeticActive(0), false);
  assert.equal(normalizeArenaCosmeticActive('0'), false);
  assert.equal(normalizeArenaCosmeticActive('false'), false);
});

test('an older success remains applicable until a newer success has actually been applied', () => {
  let lastAppliedRequestId = 0;
  const olderRequestId = 1;
  const newerRequestId = 2;

  // newerRequestId가 시작됐다는 사실만으로 olderRequestId의 성공을 버리지 않습니다.
  lastAppliedRequestId = getSuccessfulRequestApplyVersion(olderRequestId, lastAppliedRequestId);
  assert.equal(lastAppliedRequestId, olderRequestId);

  // 최신 요청이 실패하면 apply version은 전진하지 않으므로 이전 성공 상태가 유지됩니다.
  assert.equal(lastAppliedRequestId, olderRequestId);

  lastAppliedRequestId = getSuccessfulRequestApplyVersion(newerRequestId, lastAppliedRequestId);
  assert.equal(lastAppliedRequestId, newerRequestId);

  // 최신 성공이 적용된 뒤 늦게 도착한 이전 응답만 폐기합니다.
  assert.equal(getSuccessfulRequestApplyVersion(olderRequestId, lastAppliedRequestId), null);

  // 한 요청의 카탈로그와 보조 데이터처럼 같은 version의 후속 성공은 적용 가능합니다.
  assert.equal(getSuccessfulRequestApplyVersion(newerRequestId, lastAppliedRequestId), newerRequestId);
});

test('catalog-only success does not invalidate an independent auxiliary response stream', () => {
  const olderFullRequestId = 1;
  const newerCatalogOnlyRequestId = 2;
  const catalogLastApplied = getSuccessfulRequestApplyVersion(newerCatalogOnlyRequestId, 0);
  const auxiliaryLastApplied = 0;

  assert.equal(catalogLastApplied, newerCatalogOnlyRequestId);
  assert.equal(
    getSuccessfulRequestApplyVersion(olderFullRequestId, auxiliaryLastApplied),
    olderFullRequestId
  );
});
