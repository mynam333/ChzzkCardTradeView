import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const arcadeSource = readFileSync(new URL('./ArcadeTab.tsx', import.meta.url), 'utf8');
const actionSource = readFileSync(new URL('./ActionMinigame.tsx', import.meta.url), 'utf8');
const combinedSource = `${arcadeSource}\n${actionSource}`;

test('reward config parsing keeps the legacy 1000/200 fallback and rejects unsafe values', () => {
  assert.match(actionSource, /success_points: 1000/);
  assert.match(actionSource, /bonus_points: 200/);
  assert.match(actionSource, /Number\.isSafeInteger\(successPoints\)/);
  assert.match(actionSource, /Number\.isSafeInteger\(bonusPoints\)/);
  assert.match(actionSource, /Number\(successPoints\) < 0/);
  assert.match(actionSource, /Number\(bonusPoints\) < 0/);
  assert.match(actionSource, /Number\(successPoints\) \+ Number\(bonusPoints\) > MAX_MINIGAME_REWARD_POINTS/);
});

test('lobby reads current rewards from status without hard-coded point copy', () => {
  assert.match(arcadeSource, /type TicketStatusResponse = \{[\s\S]*reward_config\?: unknown;/);
  assert.match(arcadeSource, /setRewardConfig\(resolveMinigameRewardConfig\(data\.reward_config\)\)/);
  assert.match(arcadeSource, /rewardConfig\.success_points\.toLocaleString\(\)/);
  assert.match(arcadeSource, /rewardConfig\.bonus_points\.toLocaleString\(\)/);
  assert.doesNotMatch(combinedSource, /1,000 P|200 P/);
});

test('non-action start and resume responses replace lobby rewards with the session snapshot', () => {
  assert.match(arcadeSource, /type StartGameResponse = \{[\s\S]*reward_config\?: unknown;/);
  const snapshotAssignments = arcadeSource.match(/setSessionRewardConfig\(resolveMinigameRewardConfig\(data\.reward_config\)\)/g) || [];
  assert.ok(snapshotAssignments.length >= 2, 'start and resume must both capture reward_config');
  assert.match(arcadeSource, /sessionRewardConfig\.success_points\.toLocaleString\(\)/);
  assert.match(arcadeSource, /sessionRewardConfig\.bonus_points\.toLocaleString\(\)/);
});

test('action games accept lobby rewards but prefer their own start response snapshot', () => {
  assert.match(actionSource, /rewardConfig\?: MinigameRewardConfig/);
  assert.match(actionSource, /reward_config\?: unknown/);
  assert.match(
    actionSource,
    /setSessionRewardConfig\(resolveMinigameRewardConfig\(data\.reward_config\)\)/
  );
  assert.match(arcadeSource, /<ActionMinigame[\s\S]*rewardConfig=\{rewardConfig\}/);
});

test('bonus conditions are copy-only and reward amounts are rendered separately', () => {
  assert.match(actionSource, /bonusCondition: '25장 이상 또는 무실수 20장 이상'/);
  assert.match(arcadeSource, /bonusCondition: '5문제 모두 정답'/);
  assert.match(combinedSource, /보너스 조건:/);
  assert.doesNotMatch(actionSource, /bonusCondition: '[^']*\+\d/);
});
