import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./ArcadeTab.tsx', import.meta.url), 'utf8');

const sliceBetween = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
};

const answerFlow = sliceBetween('const submitRoundAnswer', 'const advanceToPaidRound');
const paidAdvanceFlow = sliceBetween('const advanceToPaidRound', 'if (!submitRetry');
const continueFlow = sliceBetween('const handleRoundContinue', '// 로그인 체크');
const valueDuelView = sliceBetween('게임 4: 시세 듀얼', '게임 5: 카드 확대 탐정');

test('paid value duel keeps feedback on the answered round until continue is clicked', () => {
  assert.match(answerFlow, /setRoundFeedback\(\{/);
  assert.match(answerFlow, /data\.has_next_round === hasNextRound/);
  assert.match(answerFlow, /data\.next_round === null/);
  assert.match(answerFlow, /data\.next_round_deadline_at === null/);
  assert.match(
    answerFlow,
    /setPendingPaidRound\(hasNextRound[\s\S]*roundIndex: expectedNextIndex, localDeadlineAt: null/
  );
  assert.doesNotMatch(answerFlow, /setRoundIndex\(/);
  assert.match(
    paidAdvanceFlow,
    /if \(activeGame !== 'quiz' \|\| isPracticeMode[\s\S]*window\.setTimeout\(\(\) => advanceToPaidRound/
  );
});

test('paid value duel starts the next round only through the continue request', () => {
  assert.match(continueFlow, /apiFetch\('\/minigames\/round-start'/);
  assert.match(continueFlow, /JSON\.stringify\(\{ session_id: sessionId, round: nextIndex \}\)/);
  assert.match(continueFlow, /roundStartInFlightRef\.current/);
  assert.match(continueFlow, /data\.success === true/);
  assert.match(continueFlow, /responseRound === nextIndex/);
  assert.match(continueFlow, /responseTotalRounds === roundTotalRounds/);
  assert.match(continueFlow, /responseDeadlineMs > responseServerNowMs/);
  assert.match(continueFlow, /isValueDuelRound\(nextRound\)/);
  assert.match(continueFlow, /nextRound\.round === nextIndex/);
  assert.match(
    continueFlow,
    /advanceToPaidRound\([\s\S]*roundIndex: nextIndex, localDeadlineAt: nextLocalDeadline[\s\S]*nextRound/
  );
  assert.doesNotMatch(continueFlow, /setIsGameOver\(/);
});

test('failed round start stays retryable and exposes button loading state', () => {
  assert.match(continueFlow, /다시 시도해 주세요/);
  assert.match(continueFlow, /finally \{[\s\S]*roundStartInFlightRef\.current = false;[\s\S]*setRoundStartBusy\(false\)/);
  assert.match(valueDuelView, /disabled=\{isGameOver \|\| roundStartBusy\}/);
  assert.match(valueDuelView, /aria-busy=\{roundStartBusy\}/);
  assert.match(valueDuelView, /다음 문제 준비 중/);
});

test('practice and final-round continue behavior remains local', () => {
  assert.ok(continueFlow.indexOf('if (isLastRound)') < continueFlow.indexOf("if (!isPracticeMode)"));
  assert.match(continueFlow, /if \(isLastRound\) \{[\s\S]*submitResult\(\{ answers: roundAnswers \}\)/);
  assert.match(continueFlow, /setRoundIndex\(nextIndex\)/);
  assert.match(continueFlow, /setRoundFeedback\(null\)/);
});
