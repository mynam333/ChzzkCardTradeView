import assert from 'node:assert/strict';
import test from 'node:test';
import {
  arenaCardBudgetByCost,
  arenaCardStatLimitsByCost,
  evaluateArenaCardEditor
} from './arenaCardEditor.ts';

test('card editor exposes the same v2 budget curve and stat ceilings as the server', () => {
  assert.deepEqual(arenaCardBudgetByCost, {
    1: 6, 2: 9, 3: 14, 4: 18, 5: 24, 6: 31, 7: 39, 8: 48, 9: 59
  });
  assert.deepEqual(arenaCardStatLimitsByCost, {
    1: { attackMax: 1, healthMax: 6 },
    2: { attackMax: 2, healthMax: 8 },
    3: { attackMax: 4, healthMax: 10 },
    4: { attackMax: 5, healthMax: 12 },
    5: { attackMax: 6, healthMax: 14 },
    6: { attackMax: 7, healthMax: 16 },
    7: { attackMax: 8, healthMax: 18 },
    8: { attackMax: 9, healthMax: 21 },
    9: { attackMax: 10, healthMax: 25 }
  });
});

test('card editor itemizes an exact-budget v2 card without reporting an error', () => {
  const assessment = evaluateArenaCardEditor({
    cardClass: 'charge',
    cost: 7,
    attack: 4,
    health: 14,
    keywords: [{ type: 'pierce' }, { type: 'weakpoint' }]
  });

  assert.equal(assessment.budgetLimit, 39);
  assert.equal(assessment.attackCost, 12);
  assert.equal(assessment.healthCost, 14);
  assert.equal(assessment.keywordCost, 11);
  assert.equal(assessment.comboCost, 2);
  assert.equal(assessment.totalCost, 39);
  assert.equal(assessment.remaining, 0);
  assert.equal(assessment.valid, true);
});

test('card editor rejects keywords whose combat rules are still pending', () => {
  const assessment = evaluateArenaCardEditor({
    cardClass: 'charge',
    cost: 3,
    attack: 1,
    health: 6,
    keywords: [{ type: 'pursuit', value: 1 }]
  });

  assert.equal(assessment.valid, false);
  assert.ok(assessment.errors.some((message) => message.includes('보류 키워드')));
});

test('card editor rejects v2 stat ceilings and budget overages', () => {
  const assessment = evaluateArenaCardEditor({
    cardClass: 'charge',
    cost: 1,
    attack: 2,
    health: 6,
    keywords: []
  });

  assert.equal(assessment.remaining, -6);
  assert.equal(assessment.valid, false);
  assert.ok(assessment.errors.some((message) => message.includes('공격력은 최대 1')));
  assert.ok(assessment.errors.some((message) => message.includes('예산을 6만큼 초과')));
});
