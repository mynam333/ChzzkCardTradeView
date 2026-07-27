import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const componentSource = readFileSync(new URL('./ArenaQuickMatchFlow.tsx', import.meta.url), 'utf8');
const styleSource = readFileSync(new URL('./ArenaQuickMatchFlow.module.css', import.meta.url), 'utf8');

test('hidden tabs keep polling while visible searches use the low-latency delay helper', () => {
  assert.match(componentSource, /getArenaQuickMatchPollDelayMs\(currentPhase, document\.visibilityState, failures\)/);
  assert.doesNotMatch(componentSource, /document\.visibilityState === ['"]hidden['"][\s\S]{0,120}return/);
  assert.match(componentSource, /document\.addEventListener\(['"]visibilitychange['"], onVisibilityChange\)/);
});

test('every network action invalidates polling through one shared operation epoch', () => {
  assert.match(componentSource, /const operationEpoch = \+\+operationEpochRef\.current/);
  assert.match(componentSource, /pollRequestRef\.current \+= 1;\s*pollAbortRef\.current\?\.abort\(\)/);
  assert.deepEqual(
    [...componentSource.matchAll(/beginAction\('(join|accept|cancel)'\)/g)].map((match) => match[1]).sort(),
    ['accept', 'cancel', 'join']
  );
  assert.match(componentSource, /isCurrentArenaQuickMatchOperation\(requestId, pollRequestRef\.current, pollingEpoch, operationEpochRef\.current\)/);
});

test('proposal CTA is outside the scroll region and exposes sound and retry states', () => {
  assert.match(styleSource, /\.dialog\s*\{[\s\S]*grid-template-rows:\s*minmax\(0, 1fr\) auto;[\s\S]*overflow:\s*hidden;/);
  assert.match(styleSource, /\.dialogScroll\s*\{[\s\S]*overflow-y:\s*auto;/);
  assert.ok(componentSource.indexOf('className={styles.dialogScroll}') < componentSource.indexOf('className={styles.proposalPanel}'));
  assert.match(componentSource, /알림음 켜기/);
  assert.match(componentSource, /매칭 확인 다시 시도/);
  assert.match(componentSource, /className=\{styles\.proposalError\} role="alert"/);
});

test('opponent deck rejection has distinct requeue guidance', () => {
  assert.match(componentSource, /이전 상대의 덱이 대전 규칙을 통과하지 못해/);
  assert.match(componentSource, /상대의 덱이 대전 규칙을 통과하지 못해 자동으로 다시 찾습니다/);
});
