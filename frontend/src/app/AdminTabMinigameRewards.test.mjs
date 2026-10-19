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
  'const parseMinigameRewardInput = (value: string)',
  'const fetchDrawCost = async () =>'
);
const settingsCard = sliceBetween(
  '{/* 미니게임 포인트 보상 설정 */}',
  '{/* 뽑기 비용 설정 */}'
);

test('admin minigame rewards use the protected GET and one POST for both values', () => {
  assert.match(settingsFlow, /apiFetch\('\/admin\/config\/minigame-rewards'\)/);
  assert.match(settingsFlow, /apiFetch\('\/admin\/config\/minigame-rewards', \{[\s\S]*method: 'POST'/);
  assert.match(settingsFlow, /JSON\.stringify\(\{ success_points: successPoints, bonus_points: bonusPoints \}\)/);
  assert.match(settingsFlow, /reward_config \?\? root\.rewardConfig \?\? root\.config/);
  assert.match(settingsFlow, /source\.success_points \?\? source\.successPoints/);
  assert.match(settingsFlow, /source\.bonus_points \?\? source\.bonusPoints/);
});

test('reward inputs default to 1000 and 200 and enforce integer and total limits', () => {
  assert.match(source, /useState\('1000'\)[^\n]*\n[^\n]*useState\('200'\)/);
  assert.match(settingsFlow, /\/\^\\d\+\$\/\.test\(normalized\)/);
  assert.match(settingsFlow, /Number\.isSafeInteger\(parsed\)/);
  assert.match(settingsFlow, /parsed >= 0 && parsed <= 10_000_000/);
  assert.match(settingsFlow, /parsedMinigameSuccessPoints \+ parsedMinigameBonusPoints <= 10_000_000/);
});

test('shop entry refreshes minigame rewards', () => {
  const shopEffect = sliceBetween("if (subTab === 'shop')", "if (subTab === 'push')");
  assert.match(shopEffect, /fetchMinigameRewards\(\)/);
});

test('saving stays locked until the persisted settings load successfully', () => {
  assert.match(source, /useState<'loading' \| 'ready' \| 'error'>\('loading'\)/);
  assert.match(settingsFlow, /setMinigameRewardsLoadState\('ready'\)/);
  assert.match(settingsFlow, /setMinigameRewardsLoadState\('error'\)/);
  assert.match(settingsFlow, /if \(minigameRewardsLoadState !== 'ready'\)/);
  assert.match(settingsCard, /현재 보상 설정을 불러오지 못해 저장이 잠겨 있습니다/);
  assert.match(settingsCard, /onClick=\{fetchMinigameRewards\}/);
});

test('reward card follows the ticket card and stays mobile safe', () => {
  const ticketToDrawCards = sliceBetween(
    '{/* 미니게임 동전 충전 간격 설정 */}',
    '{/* 뽑기 비용 설정 */}'
  );
  assert.match(ticketToDrawCards, /\{\/\* 미니게임 포인트 보상 설정 \*\/\}/);
  assert.match(settingsCard, /grid-cols-1[\s\S]*sm:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)_auto\]/);
  assert.equal((settingsCard.match(/max="10000000"/g) || []).length, 2);
  assert.match(settingsCard, /disabled=\{minigameRewardsLoadState !== 'ready' \|\| isSavingMinigameRewards \|\| !isMinigameRewardInputValid\}/);
  assert.match(settingsCard, /현재 지급 미리보기 · 일반 성공/);
  assert.match(settingsCard, /보너스 성공 \{minigameRewardTotal\.toLocaleString\(\)\} P/);
  assert.match(settingsCard, /새 세션부터 적용/);
  assert.match(settingsCard, /진행 중인 게임은 <b>시작 시 설정을 유지<\/b>/);
});
