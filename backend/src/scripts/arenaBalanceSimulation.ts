import {
  ARENA_V2_CARD_BUDGET_BY_COST,
  evaluateArenaV2CardBudget,
  validateArenaV2CardVersionDefinition
} from '../services/arenaV2Engine';
import {
  ARENA_V2_BALANCE_VERSION,
  ARENA_V2_CARD_POOL_VERSION,
  generateArenaV2DefaultCardCombatDefinition
} from '../services/arenaV2Service';

const requestedSampleSize = Number(process.env.ARENA_BALANCE_SAMPLE_SIZE || 100_000);
const sampleSize = Number.isInteger(requestedSampleSize) && requestedSampleSize > 0
  ? requestedSampleSize
  : 100_000;

type CostReport = {
  cost: number;
  budget: number;
  cards: number;
  signatures: Set<string>;
  classes: Set<string>;
  keywordTypes: Set<string>;
  keywordCounts: Set<number>;
  attacks: Set<number>;
  health: Set<number>;
};

const reports = new Map<number, CostReport>();
for (let cost = 1; cost <= 9; cost += 1) {
  reports.set(cost, {
    cost,
    budget: ARENA_V2_CARD_BUDGET_BY_COST[cost],
    cards: 0,
    signatures: new Set(),
    classes: new Set(),
    keywordTypes: new Set(),
    keywordCounts: new Set(),
    attacks: new Set(),
    health: new Set()
  });
}

for (let index = 0; index < sampleSize; index += 1) {
  const streamerId = `arena-balance-sample-${index}`;
  const generated = generateArenaV2DefaultCardCombatDefinition(streamerId);
  const card = {
    id: `arena-balance-card-${index}`,
    streamerId,
    seasonId: 'arena-balance-simulation',
    status: 'active' as const,
    cardClass: generated.cardClass,
    cost: generated.cost,
    attack: generated.attack,
    health: generated.health,
    keywords: generated.keywords,
    validationResult: null
  };
  const validation = validateArenaV2CardVersionDefinition(card);
  const budget = evaluateArenaV2CardBudget(card);
  const hasUnspecifiedGeneratedKeyword = generated.keywords.some((keyword) => ['pursuit', 'grave_buff'].includes(keyword.type));
  if (!validation.valid || budget.remaining !== 0 || hasUnspecifiedGeneratedKeyword) {
    throw new Error(`InvalidGeneratedCard:${streamerId}:${JSON.stringify({ generated, validation, budget })}`);
  }

  const report = reports.get(generated.cost)!;
  report.cards += 1;
  report.classes.add(generated.cardClass);
  report.keywordCounts.add(generated.keywords.length);
  report.attacks.add(generated.attack);
  report.health.add(generated.health);
  for (const keyword of generated.keywords) report.keywordTypes.add(keyword.type);
  report.signatures.add(`${generated.cardClass}:${generated.attack}:${generated.health}:${JSON.stringify(generated.keywords)}`);
}

const output = Array.from(reports.values()).map((report) => ({
  cost: report.cost,
  budget: report.budget,
  cards: report.cards,
  share: `${((report.cards / sampleSize) * 100).toFixed(2)}%`,
  signatures: report.signatures.size,
  classes: report.classes.size,
  attackValues: report.attacks.size,
  healthValues: report.health.size,
  keywordCounts: Array.from(report.keywordCounts).sort((a, b) => a - b).join(','),
  keywordTypes: report.keywordTypes.size
}));

console.log(`[Arena balance] ${ARENA_V2_CARD_POOL_VERSION} / ${ARENA_V2_BALANCE_VERSION} / samples=${sampleSize}`);
console.table(output);
console.log(`[Arena balance] unique signatures=${output.reduce((sum, row) => sum + row.signatures, 0)}`);
