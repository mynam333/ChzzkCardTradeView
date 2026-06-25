import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { generateArenaCardFromStreamer, ArenaGeneratedCard, ArenaCardStatKey } from '../services/arenaCatalog';
import { simulateArenaSet, ArenaSimulatorDeckSnapshot, ArenaSimulatorCardSnapshot } from '../services/arenaBattleSimulator';
import { ARENA_BATTLEFIELD_RULES, ARENA_TACTIC_CHIPS } from '../services/arenaRules';

type MetricBucket = {
  metric_type: string;
  metric_key: string;
  label: string;
  sample_count: number;
  wins: number;
  losses: number;
  draws: number;
};

type SimDeck = ArenaSimulatorDeckSnapshot & {
  classCombo: string;
  dominantStat: ArenaCardStatKey;
  metricKeys: Array<{ type: string; key: string; label: string }>;
};

type DeckResultBucket = {
  deck_id: string;
  name: string;
  class_combo: string;
  strategy_chip_id: string;
  sample_count: number;
  wins: number;
  losses: number;
  draws: number;
};

const rootDir = path.resolve(__dirname, '../../..');
const reportsDir = path.join(rootDir, 'reports');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

const cardCount = readInt('ARENA_BALANCE_CARD_COUNT', 480, 48, 3000);
const deckCount = readInt('ARENA_BALANCE_DECK_COUNT', 160, 16, 1200);
const matchCount = readInt('ARENA_BALANCE_MATCHES', 800, 50, 50000);
const eliteMatchCount = readInt('ARENA_BALANCE_ELITE_MATCHES', Math.min(6000, matchCount), 0, 50000);
const elitePercent = readFloat('ARENA_BALANCE_ELITE_PERCENT', 0.2, 0.05, 0.5);
const minSample = readInt('ARENA_BALANCE_MIN_SAMPLE', 30, 5, 1000);
const upperWarn = readFloat('ARENA_BALANCE_UPPER_WARN', 0.58, 0.51, 0.9);
const lowerWarn = readFloat('ARENA_BALANCE_LOWER_WARN', 0.42, 0.1, 0.49);
const sideSwapEnabled = readBool('ARENA_BALANCE_SIDE_SWAP', true);
const seed = process.env.ARENA_BALANCE_SEED || 'arena-balance-v1';

const startedAt = performance.now();
const cards = buildSyntheticCards(cardCount);
const decks = buildDecks(cards, deckCount);
const buckets = new Map<string, MetricBucket>();
const eliteBuckets = new Map<string, MetricBucket>();
const deckResultBuckets = new Map<string, DeckResultBucket>();
const matchSummaries: Array<{
  scope: 'overall' | 'elite';
  match_no: number;
  winner: 'A' | 'B' | 'draw';
  rounds: number;
  deck_a: string;
  deck_b: string;
  battlefield_rule_id: string;
}> = [];

for (let index = 0; index < matchCount; index += 1) {
  const deckA = decks[hashIndex(`${seed}:a:${index}`, decks.length)];
  let deckB = decks[hashIndex(`${seed}:b:${index}`, decks.length)];
  if (deckA.deck_id === deckB.deck_id) {
    deckB = decks[(decks.indexOf(deckB) + 1) % decks.length];
  }
  const field = ARENA_BATTLEFIELD_RULES[hashIndex(`${seed}:field:${index}`, ARENA_BATTLEFIELD_RULES.length)];
  runMatchPair({
    scope: 'overall',
    matchNo: index + 1,
    deckA,
    deckB,
    field,
    matchSeed: `${seed}:match:${index}`,
    bucketMap: buckets,
    updateDeckStats: true
  });
}

const items = Array.from(buckets.values())
  .map(toReviewedMetric)
  .sort(compareReviewedMetrics);

const deckItems = Array.from(deckResultBuckets.values())
  .map((bucket) => ({
    ...bucket,
    win_rate: safeRate(bucket.wins, bucket.sample_count),
    loss_rate: safeRate(bucket.losses, bucket.sample_count),
    draw_rate: safeRate(bucket.draws, bucket.sample_count)
  }))
  .sort((a, b) => b.win_rate - a.win_rate || b.sample_count - a.sample_count || a.deck_id.localeCompare(b.deck_id));

const eliteDeckCount = Math.max(2, Math.min(decks.length, Math.round(decks.length * elitePercent)));
const eliteDeckIds = new Set(deckItems.slice(0, eliteDeckCount).map((deck) => deck.deck_id));
const eliteDecks = decks.filter((deck) => eliteDeckIds.has(deck.deck_id));

if (eliteMatchCount > 0 && eliteDecks.length >= 2) {
  for (let index = 0; index < eliteMatchCount; index += 1) {
    const deckA = eliteDecks[hashIndex(`${seed}:elite:a:${index}`, eliteDecks.length)];
    let deckB = eliteDecks[hashIndex(`${seed}:elite:b:${index}`, eliteDecks.length)];
    if (deckA.deck_id === deckB.deck_id) {
      deckB = eliteDecks[(eliteDecks.indexOf(deckB) + 1) % eliteDecks.length];
    }
    const field = ARENA_BATTLEFIELD_RULES[hashIndex(`${seed}:elite:field:${index}`, ARENA_BATTLEFIELD_RULES.length)];
    runMatchPair({
      scope: 'elite',
      matchNo: index + 1,
      deckA,
      deckB,
      field,
      matchSeed: `${seed}:elite-match:${index}`,
      bucketMap: eliteBuckets,
      updateDeckStats: false
    });
  }
}

const eliteItems = Array.from(eliteBuckets.values())
  .map(toReviewedMetric)
  .sort(compareReviewedMetrics);

const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  seed,
  inputs: {
    card_count: cardCount,
    deck_count: deckCount,
    match_count: matchCount,
    side_swap_enabled: sideSwapEnabled,
    effective_overall_sets: matchCount * (sideSwapEnabled ? 2 : 1),
    elite_match_count: eliteMatchCount,
    elite_percent: elitePercent,
    elite_deck_count: eliteDecks.length,
    effective_elite_sets: eliteMatchCount * (sideSwapEnabled ? 2 : 1),
    min_sample: minSample,
    upper_warn: upperWarn,
    lower_warn: lowerWarn
  },
  duration_ms: Math.round(performance.now() - startedAt),
  summary: {
    total_metrics: items.length,
    watch_count: items.filter((item) => item.review.flag === 'WATCH').length,
    overperforming_count: items.filter((item) => item.review.flag === 'OVERPERFORMING').length,
    underperforming_count: items.filter((item) => item.review.flag === 'UNDERPERFORMING').length,
    low_sample_count: items.filter((item) => item.review.flag === 'LOW_SAMPLE').length,
    elite_watch_count: eliteItems.filter((item) => item.review.flag === 'WATCH').length,
    elite_overperforming_count: eliteItems.filter((item) => item.review.flag === 'OVERPERFORMING').length,
    elite_underperforming_count: eliteItems.filter((item) => item.review.flag === 'UNDERPERFORMING').length,
    elite_low_sample_count: eliteItems.filter((item) => item.review.flag === 'LOW_SAMPLE').length
  },
  notes: [
    'This is an offline deterministic simulation. It does not read or write DB.',
    'Point, market price, live status, ownership count, and paid cosmetics are not used as combat inputs.',
    'Metrics are deck-result attributions, so they indicate balance direction rather than final live-service truth.',
    'Side-swap mode runs each pairing from both sides to reduce first-side/targeting bias.',
    'Elite metrics are measured after selecting the top deck percentile from the overall stage.'
  ],
  top_outliers: items.filter((item) => item.review.flag !== 'NORMAL').slice(0, 30),
  top_elite_outliers: eliteItems.filter((item) => item.review.flag !== 'NORMAL').slice(0, 30),
  top_decks: deckItems.slice(0, 30),
  items,
  elite_items: eliteItems,
  sample_matches: matchSummaries.slice(0, 24)
};

mkdirSync(reportsDir, { recursive: true });
const jsonPath = path.join(reportsDir, `arena-balance-simulation-${stamp}.json`);
const csvPath = path.join(reportsDir, `arena-balance-simulation-${stamp}.csv`);
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
writeFileSync(csvPath, toCsv([
  ...items.map((item) => ({ ...item, metric_scope: 'overall' as const })),
  ...eliteItems.map((item) => ({ ...item, metric_scope: 'elite' as const }))
]), 'utf8');

printSummary(report, jsonPath, csvPath);

function runMatchPair({
  scope,
  matchNo,
  deckA,
  deckB,
  field,
  matchSeed,
  bucketMap,
  updateDeckStats
}: {
  scope: 'overall' | 'elite';
  matchNo: number;
  deckA: SimDeck;
  deckB: SimDeck;
  field: typeof ARENA_BATTLEFIELD_RULES[number];
  matchSeed: string;
  bucketMap: Map<string, MetricBucket>;
  updateDeckStats: boolean;
}) {
  runSingleMatch(scope, matchNo, deckA, deckB, field, matchSeed, bucketMap, updateDeckStats);
  if (sideSwapEnabled) {
    runSingleMatch(scope, matchNo, deckB, deckA, field, `${matchSeed}:swap`, bucketMap, updateDeckStats);
  }
}

function runSingleMatch(
  scope: 'overall' | 'elite',
  matchNo: number,
  deckA: SimDeck,
  deckB: SimDeck,
  field: typeof ARENA_BATTLEFIELD_RULES[number],
  matchSeed: string,
  bucketMap: Map<string, MetricBucket>,
  updateDeckStats: boolean
) {
  const result = simulateArenaSet({
    playerDeck: deckA,
    opponentDeck: deckB,
    matchSeed,
    battlefield_rule_id: field.id
  });
  const winner = result.playerWins > result.opponentWins ? 'A' : result.opponentWins > result.playerWins ? 'B' : 'draw';
  const resultA = winner === 'A' ? 'win' : winner === 'B' ? 'loss' : 'draw';
  const resultB = winner === 'B' ? 'win' : winner === 'A' ? 'loss' : 'draw';
  recordDeckResult(deckA, resultA, bucketMap);
  recordDeckResult(deckB, resultB, bucketMap);
  if (updateDeckStats) {
    recordDeckStats(deckA, resultA);
    recordDeckStats(deckB, resultB);
  }
  if (winner === 'draw') {
    recordMetric(bucketMap, 'battlefield_rule', field.id, field.name, 'draw');
  } else {
    recordMetric(bucketMap, 'battlefield_rule', field.id, field.name, 'win');
    recordMetric(bucketMap, 'battlefield_rule', field.id, field.name, 'loss');
  }
  if (matchSummaries.length < 48) {
    matchSummaries.push({
      scope,
      match_no: matchNo,
      winner,
      rounds: result.roundResults.length,
      deck_a: deckA.deck_id,
      deck_b: deckB.deck_id,
      battlefield_rule_id: field.id
    });
  }
}

function buildSyntheticCards(count: number): ArenaGeneratedCard[] {
  return Array.from({ length: count }, (_, index) => generateArenaCardFromStreamer({
    channel_id: `balance_channel_${String(index + 1).padStart(5, '0')}`,
    name: `밸런스 카드 ${index + 1}`,
    logo_url: null,
    custom_image_url: null,
    custom_images: [],
    is_image_banned: false
  } as any));
}

function buildDecks(sourceCards: ArenaGeneratedCard[], count: number): SimDeck[] {
  return Array.from({ length: count }, (_, deckIndex) => {
    const selected = pickCardsForDeck(sourceCards, deckIndex);
    const cards = selected.map(toSimCard);
    const tacticChip = ARENA_TACTIC_CHIPS[hashIndex(`${seed}:chip:${deckIndex}`, ARENA_TACTIC_CHIPS.length)];
    const roundPlans = Array.from({ length: 5 }, (_, roundIndex) => {
      const roundNo = roundIndex + 1;
      const offset = hashIndex(`${seed}:plan:${deckIndex}:${roundNo}`, cards.length);
      const tacticStyles = ['balanced', 'aggressive', 'guard', 'tempo', 'counter', 'finisher'];
      const focusRules = ['frontline_first', 'backline_first', 'lowest_hp', 'highest_attack'];
      return {
        round_no: roundNo as 1 | 2 | 3 | 4 | 5,
        formation_id: `sim-${roundNo}`,
        tactic_style: tacticStyles[hashIndex(`${seed}:tactic:${deckIndex}:${roundNo}`, tacticStyles.length)],
        focus_rule: focusRules[hashIndex(`${seed}:focus:${deckIndex}:${roundNo}`, focusRules.length)],
        slots: cards.slice(0, 6).map((card, slotIndex) => {
          const shifted = (slotIndex + offset + roundIndex) % 6;
          return {
            card_id: cards[shifted].card_id,
            channel_id: cards[shifted].channel_id,
            row: (shifted < 3 ? 1 : 0) as 0 | 1,
            col: (shifted % 3) as 0 | 1 | 2 | 3
          };
        })
      };
    });
    const statTotals = sumStats(selected);
    const dominantStat = (Object.entries(statTotals) as Array<[ArenaCardStatKey, number]>)
      .sort((a, b) => b[1] - a[1])[0][0];
    const classCombo = Array.from(new Set(selected.map((card) => card.class.id))).sort().join('+');
    return {
      deck_id: `sim_deck_${deckIndex + 1}`,
      name: `시뮬레이션 덱 ${deckIndex + 1}`,
      cards,
      strategy_chip_id: tacticChip.id,
      round_plans: roundPlans,
      classCombo,
      dominantStat,
      metricKeys: buildMetricKeys(selected, String(tacticChip.id), classCombo, dominantStat, roundPlans)
    };
  });
}

function pickCardsForDeck(sourceCards: ArenaGeneratedCard[], deckIndex: number) {
  const picked: ArenaGeneratedCard[] = [];
  let cursor = hashIndex(`${seed}:deck:${deckIndex}`, sourceCards.length);
  while (picked.length < 10) {
    const card = sourceCards[cursor % sourceCards.length];
    if (!picked.some((item) => item.card_id === card.card_id)) {
      picked.push(card);
    }
    cursor += 1 + hashIndex(`${seed}:deck-step:${deckIndex}:${picked.length}`, 17);
  }
  return picked;
}

function toSimCard(card: ArenaGeneratedCard): ArenaSimulatorCardSnapshot {
  return {
    card_id: card.card_id,
    channel_id: card.channel_id,
    name: card.name,
    image_url: card.image_url,
    class_id: card.class.id,
    class_name: card.class.name,
    stats: card.stats,
    skills: card.skills.map((skill) => ({ id: skill.id, name: skill.name, type: skill.type }))
  };
}

function buildMetricKeys(
  cardsForDeck: ArenaGeneratedCard[],
  tacticChipId: string,
  classCombo: string,
  dominantStat: ArenaCardStatKey,
  roundPlans: SimDeck['round_plans']
) {
  const metrics: Array<{ type: string; key: string; label: string }> = [
    { type: 'class_combo', key: classCombo, label: classCombo },
    { type: 'stat_focus', key: dominantStat, label: dominantStat },
    { type: 'strategy_chip', key: tacticChipId, label: tacticChipId }
  ];
  for (const classId of new Set(cardsForDeck.map((card) => card.class.id))) {
    const sample = cardsForDeck.find((card) => card.class.id === classId);
    metrics.push({ type: 'class_single', key: classId, label: sample?.class.name || classId });
  }
  for (const skill of new Map(cardsForDeck.flatMap((card) => card.skills).map((skill) => [skill.id, skill])).values()) {
    metrics.push({ type: 'skill_single', key: skill.id, label: skill.name });
  }
  for (const tag of new Set(cardsForDeck.flatMap((card) => card.tags))) {
    metrics.push({ type: 'tag_single', key: tag, label: tag });
  }
  for (const tactic of new Set(roundPlans.map((plan) => String(plan.tactic_style || 'balanced')))) {
    metrics.push({ type: 'tactic_style', key: tactic, label: tactic });
  }
  for (const focus of new Set(roundPlans.map((plan) => String(plan.focus_rule || 'frontline_first')))) {
    metrics.push({ type: 'focus_rule', key: focus, label: focus });
  }
  return metrics;
}

function recordDeckResult(deck: SimDeck, result: 'win' | 'loss' | 'draw', bucketMap: Map<string, MetricBucket>) {
  for (const metric of deck.metricKeys) {
    recordMetric(bucketMap, metric.type, metric.key, metric.label, result);
  }
}

function recordDeckStats(deck: SimDeck, result: 'win' | 'loss' | 'draw') {
  const bucket = deckResultBuckets.get(deck.deck_id) || {
    deck_id: deck.deck_id,
    name: deck.name,
    class_combo: deck.classCombo,
    strategy_chip_id: String(deck.strategy_chip_id || 'none'),
    sample_count: 0,
    wins: 0,
    losses: 0,
    draws: 0
  };
  bucket.sample_count += 1;
  if (result === 'win') bucket.wins += 1;
  else if (result === 'loss') bucket.losses += 1;
  else bucket.draws += 1;
  deckResultBuckets.set(deck.deck_id, bucket);
}

function recordMetric(bucketMap: Map<string, MetricBucket>, type: string, key: string, label: string, result: 'win' | 'loss' | 'draw') {
  const id = `${type}:${key}`;
  const bucket = bucketMap.get(id) || {
    metric_type: type,
    metric_key: key,
    label,
    sample_count: 0,
    wins: 0,
    losses: 0,
    draws: 0
  };
  bucket.sample_count += 1;
  if (result === 'win') bucket.wins += 1;
  else if (result === 'loss') bucket.losses += 1;
  else bucket.draws += 1;
  bucketMap.set(id, bucket);
}

function sumStats(cardsForDeck: ArenaGeneratedCard[]) {
  return cardsForDeck.reduce<Record<ArenaCardStatKey, number>>((acc, card) => {
    acc.hp += card.stats.hp;
    acc.attack += card.stats.attack;
    acc.defense += card.stats.defense;
    acc.speed += card.stats.speed;
    acc.focus += card.stats.focus;
    return acc;
  }, { hp: 0, attack: 0, defense: 0, speed: 0, focus: 0 });
}

function toReviewedMetric(bucket: MetricBucket) {
  return {
    ...bucket,
    win_rate: safeRate(bucket.wins, bucket.sample_count),
    loss_rate: safeRate(bucket.losses, bucket.sample_count),
    draw_rate: safeRate(bucket.draws, bucket.sample_count),
    review: reviewBucket(bucket)
  };
}

function compareReviewedMetrics(
  a: MetricBucket & { win_rate: number; review: { flag: string } },
  b: MetricBucket & { win_rate: number; review: { flag: string } }
) {
  return severityScore(b) - severityScore(a)
    || b.sample_count - a.sample_count
    || a.metric_type.localeCompare(b.metric_type)
    || a.metric_key.localeCompare(b.metric_key);
}

function reviewBucket(bucket: MetricBucket) {
  const winRate = safeRate(bucket.wins, bucket.sample_count);
  if (bucket.sample_count < minSample) {
    return { flag: 'LOW_SAMPLE', reason: `sample < ${minSample}` };
  }
  if (winRate >= upperWarn) {
    return { flag: 'OVERPERFORMING', reason: `win_rate >= ${upperWarn}` };
  }
  if (winRate <= lowerWarn) {
    return { flag: 'UNDERPERFORMING', reason: `win_rate <= ${lowerWarn}` };
  }
  const distance = Math.abs(winRate - 0.5);
  if (distance >= 0.06) {
    return { flag: 'WATCH', reason: 'near warning threshold' };
  }
  return { flag: 'NORMAL', reason: 'inside target range' };
}

function severityScore(item: { sample_count: number; win_rate: number; review: { flag: string } }) {
  const flagWeight = item.review.flag === 'OVERPERFORMING' || item.review.flag === 'UNDERPERFORMING' ? 100
    : item.review.flag === 'WATCH' ? 50
      : item.review.flag === 'LOW_SAMPLE' ? 10
        : 0;
  return flagWeight + Math.abs(item.win_rate - 0.5) * 100 + Math.min(20, item.sample_count / 20);
}

function safeRate(value: number, total: number) {
  return total > 0 ? Number((value / total).toFixed(4)) : 0;
}

function hashIndex(input: string, modulo: number) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % modulo;
}

function readInt(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  const value = raw ? Number.parseInt(raw, 10) : fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function readFloat(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  const value = raw ? Number.parseFloat(raw) : fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function readBool(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const normalized = raw.trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized)
    ? true
    : ['0', 'false', 'no', 'n', 'off'].includes(normalized)
      ? false
      : fallback;
}

function toCsv(rows: Array<MetricBucket & { metric_scope: 'overall' | 'elite'; win_rate: number; loss_rate: number; draw_rate: number; review: { flag: string; reason: string } }>) {
  const headers = [
    'metric_scope',
    'metric_type',
    'metric_key',
    'label',
    'sample_count',
    'wins',
    'losses',
    'draws',
    'win_rate',
    'loss_rate',
    'draw_rate',
    'review_flag',
    'review_reason'
  ];
  return `${headers.join(',')}\n${rows.map((row) => [
    row.metric_scope,
    row.metric_type,
    row.metric_key,
    row.label,
    row.sample_count,
    row.wins,
    row.losses,
    row.draws,
    row.win_rate,
    row.loss_rate,
    row.draw_rate,
    row.review.flag,
    row.review.reason
  ].map(csvCell).join(',')).join('\n')}\n`;
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function printSummary(reportData: typeof report, jsonPath: string, csvPath: string) {
  console.log(`Arena balance simulation complete: ${matchCount} matches, ${cardCount} cards, ${deckCount} decks`);
  console.log(`Duration: ${reportData.duration_ms}ms`);
  console.log(`Outliers: over=${reportData.summary.overperforming_count}, under=${reportData.summary.underperforming_count}, watch=${reportData.summary.watch_count}, low_sample=${reportData.summary.low_sample_count}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV: ${csvPath}`);
  for (const item of reportData.top_outliers.slice(0, 12)) {
    console.log(`${item.review.flag} ${item.metric_type}:${item.label} win=${Math.round(item.win_rate * 100)}% sample=${item.sample_count}`);
  }
}
