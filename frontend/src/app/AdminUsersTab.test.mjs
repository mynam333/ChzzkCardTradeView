import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./AdminUsersTab.tsx', import.meta.url), 'utf8');

const sliceBetween = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
};

const fetchFlow = sliceBetween('const fetchUsers = useCallback', '// 검색어 디바운스');
const requestEffects = sliceBetween('// 검색어 디바운스', '// 닉네임/ID 클립보드 복사');
const listView = sliceBetween('유저 목록 (', '{/* 페이지네이션 */}');

test('admin user list exposes HTTP, network, and response-contract failures', () => {
  assert.match(fetchFlow, /const data = await res\.json\(\)\.catch\(\(\) => \(\{\}\)\)/);
  assert.match(fetchFlow, /if \(!res\.ok\) \{[\s\S]*setUsersError\(message\)/);
  assert.match(fetchFlow, /if \(!Array\.isArray\(data\?\.users\)\) \{[\s\S]*응답 형식이 올바르지 않습니다/);
  assert.match(fetchFlow, /catch \{[\s\S]*서버 통신 중 오류가 발생했습니다/);
  assert.doesNotMatch(fetchFlow, /noop/);
});

test('admin user list prevents stale requests and performs one effect-driven fetch', () => {
  assert.match(fetchFlow, /const requestId = \+\+usersRequestIdRef\.current/);
  assert.match(fetchFlow, /if \(requestId !== usersRequestIdRef\.current\) return/);
  assert.match(fetchFlow, /if \(requestId === usersRequestIdRef\.current\) setUsersLoading\(false\)/);
  assert.equal((requestEffects.match(/fetchUsers\(/g) || []).length, 1);
  assert.match(requestEffects, /setDebouncedUserSearch\(userSearch\)/);
});

test('admin user list renders an accessible retry state instead of an empty-list message', () => {
  assert.match(listView, /usersError \? \(/);
  assert.match(listView, /role="alert"/);
  assert.match(listView, /다시 시도/);
  assert.match(listView, /fetchUsers\(userPage, debouncedUserSearch\)/);
});
