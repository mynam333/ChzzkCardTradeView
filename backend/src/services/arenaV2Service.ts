import crypto from 'crypto';
import Database from 'better-sqlite3';
import type {
  ArenaV2CardClassDto,
  ArenaV2CardVersionDto,
  ArenaV2PhaseTimingDto,
  ArenaV2TurnActionDto,
  ArenaV2ValidationResultDto,
  ArenaV2ViewerResultDto,
  ArenaV2ViewerRoleDto
} from '@chikapo/arena-contract';
import { getDbMode, getMysqlDb, getSqlDialect, getSqliteDb } from './db';
import {
  ARENA_V2_CARD_BUDGET_BY_COST,
  ARENA_V2_CARD_STAT_LIMITS_BY_COST,
  createArenaV2BotTurnActions,
  evaluateArenaV2CardBudget,
  getArenaV2AvailableCost,
  getArenaV2FreeTacticalMoveCount,
  resolveArenaV2Turn,
  validateArenaV2CardVersionDefinition,
  validateArenaV2Deck,
  validateArenaV2TurnAction,
  type ArenaV2RuntimeCardInstance,
  type ArenaV2RuntimePlayer,
  type ArenaV2TurnResolutionResult
} from './arenaV2Engine';
import {
  applyArenaV2PendingByeDrawsForClone,
  normalizeArenaV2BattleRoyaleParticipant,
  resolveArenaV2BattleRoyaleRound,
  scheduleArenaV2BattleRoyaleRound,
  type ArenaV2BattleRoyaleParticipantState,
  type ArenaV2BattleRoyaleRoundMatchResult
} from './arenaV2BattleRoyale';
import { formatUploadUrl } from './imageService';

type SqlExecutor = {
  all<T = any>(sql: string, ...args: any[]): Promise<T[]> | T[];
  get<T = any>(sql: string, ...args: any[]): Promise<T | undefined> | T | undefined;
  run(sql: string, ...args: any[]): Promise<any> | any;
  transaction?<T>(task: (tx: SqlExecutor) => Promise<T>): Promise<T>;
};

let testExecutor: SqlExecutor | null = null;
const arenaV2GeneratedCardSyncCompleted = new Set<string>();
const arenaV2GeneratedCardSyncInFlight = new Map<string, Promise<void>>();

export interface ArenaV2SeasonRow {
  id: string;
  season_key: string;
  name: string;
  status: string;
  starts_at: string;
  ends_at: string;
  modes_enabled: string;
  card_pool_version: string;
  balance_version: string;
  reward_table: string;
  mmr_tier_table: string;
  replay_retention_days: number;
}

export interface ArenaV2ReportInput {
  reporterUserId: string;
  targetType: 'card' | 'match' | 'replay' | 'user' | 'battle_royale';
  targetId: string;
  reason: string;
}

export interface ArenaV2StreamerRightRequestInput {
  requesterUserId: string;
  streamerId: string;
  requestType: 'opt_out' | 'image_change' | 'text_change' | 'card_config' | 'disable_version';
  payload: unknown;
}

export interface ArenaV2StreamerCardConfigInput {
  requesterUserId: string;
  cardClass: string;
  cost: number;
  attack: number;
  health: number;
  keywords: unknown[];
}

export interface ArenaV2AdminSeasonInput {
  seasonKey: string;
  name: string;
  startsAt: string;
  endsAt: string;
  modesEnabled: Record<string, boolean>;
  cardPoolVersion: string;
  balanceVersion: string;
  mmrTierTable: unknown[];
  rewardTable: unknown[];
  createdBy?: string;
}

export interface ArenaV2CardListFilters {
  seasonId?: string;
  class?: string;
  costMin?: number;
  costMax?: number;
  keyword?: string;
  streamerName?: string;
  limit?: number;
  offset?: number;
}

export interface ArenaV2SaveDeckInput {
  userId: string;
  deckId?: string;
  seasonId: string;
  name: string;
  modeScope: 'all' | 'quick' | 'battle_royale_8' | 'bot';
  cardVersionIds: string[];
}

interface ArenaV2RewardRule {
  tier?: string;
  tiers?: string[];
  rankMin?: number;
  rankMax?: number;
  minRank?: number;
  maxRank?: number;
  items?: unknown[];
  rewards?: unknown[];
  rewardItems?: unknown[];
}

export interface ArenaV2CreateMatchInput {
  userId: string;
  mode: 'bot' | 'quick' | 'battle_royale_8';
  seasonId?: string;
  deckId: string;
  botDifficulty?: 'beginner' | 'easy' | 'normal' | 'hard' | 'expert';
}

export interface ArenaV2SubmitTurnInput {
  userId: string;
  matchId: string;
  turnNo: number;
  revision: number;
  isFinal: boolean;
  actions: ArenaV2TurnActionDto[];
}

export interface ArenaV2SubmitMulliganInput {
  userId: string;
  matchId: string;
  replaceCardInstanceIds: string[];
}

export interface ArenaV2JoinQueueInput {
  userId: string;
  deckId: string;
  seasonId?: string;
}

const jsonParse = <T>(value: unknown, fallback: T): T => {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};


type ArenaV2StoredSummary = Record<string, unknown> & {
  phaseTiming?: Partial<ArenaV2PhaseTimingDto>;
  viewerResultsByUser?: Record<string, Partial<ArenaV2ViewerResultDto>>;
};

type ArenaV2BattleRoyaleParticipant = Record<string, unknown> & {
  userId?: string;
  user_id?: string;
  status?: string;
  finalRank?: number | null;
  final_rank?: number | null;
  currentMatchId?: string | null;
  current_match_id?: string | null;
  nextMatchId?: string | null;
  next_match_id?: string | null;
};

type ArenaV2BattleRoyaleViewerContext = {
  placement: number | null;
  sharedPlacement: boolean;
  canSpectate: boolean;
  nextMatchId: string | null;
};

const ARENA_V2_TURN_INTRO_MS = 1_400;
const ARENA_V2_TURN_PLANNING_MS = 40_000;
const ARENA_V2_REPLAY_BUFFER_MS = 2_400;
const ARENA_V2_REPLAY_EVENT_DURATION_MS: Record<string, number> = {
  line_attack: 820,
  direct_attack: 820,
  card_attack: 820,
  card_defeated: 720,
  revive: 720,
  shield_absorb: 620,
  overflow_damage: 620,
  counter: 620,
  silence: 620,
  stun: 620,
  push: 620,
  pull: 620,
  drain: 620,
  vengeance: 620,
  residue: 620,
  spirit_damage: 620,
  fatigue: 620
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const parseNullableRank = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const rank = Number(value);
  return Number.isInteger(rank) && rank > 0 ? rank : null;
};

const getArenaV2ReplayDurationMs = (events: Array<{ eventType: string }>): number => {
  const visualDurationMs = events.reduce(
    (total, replayEvent) => total + (ARENA_V2_REPLAY_EVENT_DURATION_MS[replayEvent.eventType] || 0),
    0
  );
  return visualDurationMs + ARENA_V2_REPLAY_BUFFER_MS;
};

const createArenaV2PhaseTiming = (
  events: Array<{ eventType: string }>,
  nowMs = Date.now()
): ArenaV2PhaseTimingDto => {
  const replayDurationMs = getArenaV2ReplayDurationMs(events);
  const replayEndsAtMs = nowMs + replayDurationMs;
  const planningStartsAtMs = replayEndsAtMs + ARENA_V2_TURN_INTRO_MS;
  return {
    replayDurationMs,
    replayEndsAt: new Date(replayEndsAtMs).toISOString(),
    introDurationMs: ARENA_V2_TURN_INTRO_MS,
    planningStartsAt: new Date(planningStartsAtMs).toISOString(),
    turnDeadlineAt: new Date(planningStartsAtMs + ARENA_V2_TURN_PLANNING_MS).toISOString(),
    serverNow: new Date(nowMs).toISOString()
  };
};

const parseArenaV2StoredSummary = (value: unknown): ArenaV2StoredSummary => {
  const parsed = jsonParse<unknown>(value, {});
  return isRecord(parsed) ? parsed as ArenaV2StoredSummary : {};
};

const serializeArenaV2PhaseTiming = (
  summary: ArenaV2StoredSummary,
  serverNow = new Date().toISOString()
): ArenaV2PhaseTimingDto | null => {
  const timing = summary.phaseTiming;
  if (!isRecord(timing)) return null;
  const replayDurationMs = Math.max(0, Number(timing.replayDurationMs || 0));
  const introDurationMs = Math.max(0, Number(timing.introDurationMs || 0));
  const replayEndsAt = typeof timing.replayEndsAt === 'string' ? timing.replayEndsAt : null;
  const planningStartsAt = typeof timing.planningStartsAt === 'string' ? timing.planningStartsAt : null;
  const turnDeadlineAt = typeof timing.turnDeadlineAt === 'string' ? timing.turnDeadlineAt : null;
  return {
    replayDurationMs,
    replayEndsAt,
    introDurationMs,
    planningStartsAt,
    turnDeadlineAt,
    serverNow
  };
};

const publicArenaV2ResultSummary = (summary: ArenaV2StoredSummary): ArenaV2StoredSummary => {
  const { viewerResultsByUser: _privateViewerResults, ...publicSummary } = summary;
  return publicSummary;
};

const makeId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const makeDeterministicId = (prefix: string, value: string) => `${prefix}_${stableHash(value).slice(0, 32)}`;

const stableHash = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');
const stableNumber = (value: string, modulo: number): number => Number.parseInt(stableHash(value).slice(0, 8), 16) % modulo;

const makeArenaV2DefaultCardId = (seasonId: string, streamerId: string): string =>
  `arena_v2_card_${stableHash(`${seasonId}:${streamerId}`).slice(0, 32)}`;

const isArenaV2GeneratedCardId = (cardId: unknown, seasonId: string, streamerId: string): boolean => {
  const normalizedId = String(cardId || '');
  return normalizedId === makeArenaV2DefaultCardId(seasonId, streamerId)
    || normalizedId === `arena_v2_card_${seasonId}_${streamerId}`;
};

const stableShuffle = <T extends { id: string }>(items: T[], seed: string): T[] =>
  [...items].sort((a, b) => stableHash(`${seed}:${a.id}`).localeCompare(stableHash(`${seed}:${b.id}`)));

const ARENA_V2_CARD_CLASSES: ArenaV2CardClassDto[] = ['charge', 'guardian', 'sniper', 'support', 'trick', 'specter', 'tech'];

type ArenaV2GeneratedKeyword = { type: string; value?: number; limit?: string };
type ArenaV2GeneratedProfile = 'aggressive' | 'durable' | 'tactical' | 'balanced';
type ArenaV2GeneratedCandidate = {
  key: string;
  cost: number;
  attack: number;
  health: number;
  keywords: ArenaV2GeneratedKeyword[];
  attackCost: number;
  healthCost: number;
  effectCost: number;
  totalCost: number;
};

const generatedKeyword = (type: string, value?: number, limit?: string): ArenaV2GeneratedKeyword => ({
  type,
  ...(value == null ? {} : { value }),
  ...(limit ? { limit } : {})
});

const commonGeneratedKeywordBundles: ArenaV2GeneratedKeyword[][] = [
  [],
  [generatedKeyword('shield', 1)],
  [generatedKeyword('shield', 2)]
];

const generatedKeywordBundlesByClass: Record<ArenaV2CardClassDto, ArenaV2GeneratedKeyword[][]> = {
  charge: [
    [generatedKeyword('pierce')], [generatedKeyword('pursuit', 1)], [generatedKeyword('pursuit', 2)],
    [generatedKeyword('direct_pressure', 1)], [generatedKeyword('direct_pressure', 2)], [generatedKeyword('backline_pressure')],
    [generatedKeyword('weakpoint')], [generatedKeyword('aoe_damage', 1)], [generatedKeyword('lifesteal', 1)],
    [generatedKeyword('pierce'), generatedKeyword('weakpoint')],
    [generatedKeyword('pursuit', 1), generatedKeyword('weakpoint')],
    [generatedKeyword('backline_pressure'), generatedKeyword('weakpoint')],
    [generatedKeyword('lifesteal', 1), generatedKeyword('weakpoint')],
    [generatedKeyword('pursuit', 1), generatedKeyword('backline_pressure'), generatedKeyword('weakpoint')],
    [generatedKeyword('pierce'), generatedKeyword('aoe_damage', 1), generatedKeyword('weakpoint')]
  ],
  guardian: [
    [generatedKeyword('taunt')], [generatedKeyword('shield', 3)], [generatedKeyword('shield', 5)],
    [generatedKeyword('damage_reduction', 1)], [generatedKeyword('damage_reduction', 2)],
    [generatedKeyword('counter', 1)], [generatedKeyword('counter', 2)], [generatedKeyword('lifesteal', 1)],
    [generatedKeyword('revive')], [generatedKeyword('taunt'), generatedKeyword('shield', 1)],
    [generatedKeyword('damage_reduction', 1), generatedKeyword('counter', 1)],
    [generatedKeyword('shield', 3), generatedKeyword('counter', 1)],
    [generatedKeyword('shield', 3), generatedKeyword('counter', 1), generatedKeyword('damage_reduction', 1)]
  ],
  sniper: [
    [generatedKeyword('aim')], [generatedKeyword('backline_pressure')], [generatedKeyword('weakpoint')],
    [generatedKeyword('pursuit', 1)], [generatedKeyword('pursuit', 2)], [generatedKeyword('silence')],
    [generatedKeyword('stun')], [generatedKeyword('direct_pressure', 1)], [generatedKeyword('aoe_damage', 1)],
    [generatedKeyword('aim'), generatedKeyword('backline_pressure')],
    [generatedKeyword('aim'), generatedKeyword('weakpoint')],
    [generatedKeyword('backline_pressure'), generatedKeyword('weakpoint')],
    [generatedKeyword('direct_pressure', 1), generatedKeyword('weakpoint')],
    [generatedKeyword('aim'), generatedKeyword('backline_pressure'), generatedKeyword('weakpoint')],
    [generatedKeyword('backline_pressure'), generatedKeyword('weakpoint'), generatedKeyword('pursuit', 1)]
  ],
  support: [
    [generatedKeyword('guard_support')], [generatedKeyword('attack_support')], [generatedKeyword('emergency_heal', 1)],
    [generatedKeyword('emergency_heal', 2)], [generatedKeyword('shield', 3)], [generatedKeyword('battle_draw')],
    [generatedKeyword('grave_buff')], [generatedKeyword('guard_support'), generatedKeyword('attack_support')],
    [generatedKeyword('emergency_heal', 1), generatedKeyword('shield', 2)],
    [generatedKeyword('guard_support'), generatedKeyword('shield', 2)],
    [generatedKeyword('battle_draw'), generatedKeyword('attack_support')],
    [generatedKeyword('grave_buff'), generatedKeyword('emergency_heal', 1)],
    [generatedKeyword('guard_support'), generatedKeyword('attack_support'), generatedKeyword('shield', 2)],
    [generatedKeyword('emergency_heal', 1), generatedKeyword('guard_support'), generatedKeyword('shield', 2)]
  ],
  trick: [
    [generatedKeyword('weaken', 1)], [generatedKeyword('weaken', 2)], [generatedKeyword('silence')],
    [generatedKeyword('stun')], [generatedKeyword('push')], [generatedKeyword('pull')], [generatedKeyword('aim')],
    [generatedKeyword('weakpoint')], [generatedKeyword('aoe_damage', 1)],
    [generatedKeyword('weaken', 1), generatedKeyword('push')],
    [generatedKeyword('weaken', 1), generatedKeyword('pull')],
    [generatedKeyword('silence'), generatedKeyword('push')],
    [generatedKeyword('aim'), generatedKeyword('weaken', 1)],
    [generatedKeyword('weaken', 1), generatedKeyword('push'), generatedKeyword('pull')],
    [generatedKeyword('silence'), generatedKeyword('weaken', 1), generatedKeyword('push')]
  ],
  specter: [
    [generatedKeyword('remnant', 1)], [generatedKeyword('remnant', 2)], [generatedKeyword('vengeance', 1)],
    [generatedKeyword('vengeance', 2)], [generatedKeyword('grudge', 1)], [generatedKeyword('grudge', 2)],
    [generatedKeyword('grave_buff')], [generatedKeyword('grave_recover', undefined, 'cost_2')],
    [generatedKeyword('grave_recover', undefined, 'specter')], [generatedKeyword('revive')],
    [generatedKeyword('remnant', 1), generatedKeyword('vengeance', 1)],
    [generatedKeyword('remnant', 1), generatedKeyword('grave_buff')],
    [generatedKeyword('vengeance', 1), generatedKeyword('grave_recover', undefined, 'cost_2')],
    [generatedKeyword('remnant', 1), generatedKeyword('vengeance', 1), generatedKeyword('grave_buff')],
    [generatedKeyword('remnant', 1), generatedKeyword('grudge', 1), generatedKeyword('shield', 2)]
  ],
  tech: [
    [generatedKeyword('battle_draw')], [generatedKeyword('guard_support')], [generatedKeyword('attack_support')],
    [generatedKeyword('push')], [generatedKeyword('pull')], [generatedKeyword('weakpoint')],
    [generatedKeyword('shield', 3)], [generatedKeyword('damage_reduction', 1)], [generatedKeyword('grave_buff')],
    [generatedKeyword('aoe_damage', 1)], [generatedKeyword('battle_draw'), generatedKeyword('attack_support')],
    [generatedKeyword('guard_support'), generatedKeyword('attack_support')],
    [generatedKeyword('push'), generatedKeyword('pull')],
    [generatedKeyword('shield', 3), generatedKeyword('damage_reduction', 1)],
    [generatedKeyword('battle_draw'), generatedKeyword('attack_support'), generatedKeyword('shield', 1)],
    [generatedKeyword('guard_support'), generatedKeyword('push'), generatedKeyword('weakpoint')]
  ]
};

const generatedCostBuckets = [
  { upperExclusive: 9, cost: 1 },
  { upperExclusive: 22, cost: 2 },
  { upperExclusive: 37, cost: 3 },
  { upperExclusive: 52, cost: 4 },
  { upperExclusive: 66, cost: 5 },
  { upperExclusive: 78, cost: 6 },
  { upperExclusive: 88, cost: 7 },
  { upperExclusive: 95, cost: 8 },
  { upperExclusive: 100, cost: 9 }
] as const;

const generatedCandidateCache = new Map<string, ArenaV2GeneratedCandidate[]>();

const normalizeArenaV2KeywordList = (value: unknown): Array<{ type: string; value?: number; limit?: string }> => {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 3)
    .map((item) => {
      if (typeof item === 'string') return { type: item.trim() };
      if (!item || typeof item !== 'object') return null;
      const raw = item as Record<string, unknown>;
      const type = String(raw.type || '').trim();
      if (!type) return null;
      const keyword: { type: string; value?: number; limit?: string } = { type };
      const valueNumber = Number(raw.value);
      if (Number.isInteger(valueNumber)) keyword.value = valueNumber;
      if (typeof raw.limit === 'string' && raw.limit.trim()) keyword.limit = raw.limit.trim();
      return keyword;
    })
    .filter((item): item is { type: string; value?: number; limit?: string } => Boolean(item));
};

const sanitizeCardDisplayName = (value: unknown, fallback: string): string => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return (normalized || fallback).slice(0, 40);
};

const normalizeArenaV2CardClass = (value: unknown, fallback: ArenaV2CardClassDto = 'charge'): ArenaV2CardClassDto => {
  const normalized = String(value || '').trim().toLowerCase();
  return ARENA_V2_CARD_CLASSES.includes(normalized as ArenaV2CardClassDto) ? normalized as ArenaV2CardClassDto : fallback;
};

const defaultArenaV2CardClassForStreamer = (streamerId: string): ArenaV2CardClassDto => {
  const hash = crypto.createHash('sha256').update(`arena-v2-class:${streamerId}`).digest();
  return ARENA_V2_CARD_CLASSES[hash[0] % ARENA_V2_CARD_CLASSES.length];
};

const defaultArenaV2CardCostForStreamer = (streamerId: string): number => {
  const bucket = stableNumber(`arena-v2-cost:${streamerId}`, 100);
  return generatedCostBuckets.find((item) => bucket < item.upperExclusive)?.cost || 9;
};

const generatedCandidateKey = (attack: number, health: number, keywords: ArenaV2GeneratedKeyword[]): string =>
  `${attack}:${health}:${keywords.map((keyword) => `${keyword.type}:${keyword.value ?? ''}:${keyword.limit || ''}`).join('|')}`;

const generatedCandidatesFor = (cost: number, cardClass: ArenaV2CardClassDto): ArenaV2GeneratedCandidate[] => {
  const cacheKey = `${cost}:${cardClass}`;
  const cached = generatedCandidateCache.get(cacheKey);
  if (cached) return cached;

  const limits = ARENA_V2_CARD_STAT_LIMITS_BY_COST[cost];
  const budgetLimit = ARENA_V2_CARD_BUDGET_BY_COST[cost];
  const bundles = [...commonGeneratedKeywordBundles, ...generatedKeywordBundlesByClass[cardClass]];
  const uniqueCandidates = new Map<string, ArenaV2GeneratedCandidate>();

  for (const bundle of bundles) {
    for (let attack = 0; attack <= limits.attackMax; attack += 1) {
      for (let health = 1; health <= limits.healthMax; health += 1) {
        const keywords = bundle.map((keyword) => ({ ...keyword }));
        const candidate = {
          id: 'generated',
          streamerId: 'generated',
          seasonId: 'generated',
          status: 'active' as const,
          cardClass,
          cost,
          attack,
          health,
          keywords,
          validationResult: null
        };
        const validation = validateArenaV2CardVersionDefinition(candidate);
        if (!validation.valid) continue;
        const budget = evaluateArenaV2CardBudget(candidate);
        // 자동 생성 카드는 코스트별 제작 예산을 남김없이 사용해야 합니다.
        if (budget.totalCost !== budgetLimit) continue;
        const key = generatedCandidateKey(attack, health, keywords);
        uniqueCandidates.set(key, {
          key,
          cost,
          attack,
          health,
          keywords,
          attackCost: budget.attackCost,
          healthCost: budget.healthCost,
          effectCost: budget.keywordCost + budget.comboCost,
          totalCost: budget.totalCost
        });
      }
    }
  }

  const candidates = Array.from(uniqueCandidates.values()).sort((a, b) => a.key.localeCompare(b.key));
  generatedCandidateCache.set(cacheKey, candidates);
  return candidates;
};

const matchesGeneratedProfile = (candidate: ArenaV2GeneratedCandidate, profile: ArenaV2GeneratedProfile): boolean => {
  if (profile === 'aggressive') {
    return candidate.attack > 0 && candidate.attackCost >= candidate.healthCost && candidate.attackCost >= candidate.effectCost;
  }
  if (profile === 'durable') {
    return candidate.healthCost >= candidate.attackCost && candidate.healthCost >= candidate.effectCost;
  }
  if (profile === 'tactical') {
    return candidate.keywords.length > 0 && candidate.effectCost >= Math.min(4, candidate.attackCost + candidate.healthCost);
  }
  return candidate.attack > 0
    && candidate.health >= 2
    && Math.abs(candidate.attackCost - candidate.healthCost) <= Math.ceil(candidate.totalCost * 0.45);
};

export const generateArenaV2DefaultCardCombatDefinition = (streamerIdInput: string) => {
  const streamerId = String(streamerIdInput || '').trim();
  const cardClass = defaultArenaV2CardClassForStreamer(streamerId);
  const cost = defaultArenaV2CardCostForStreamer(streamerId);
  const profiles: ArenaV2GeneratedProfile[] = ['aggressive', 'durable', 'tactical', 'balanced'];
  const profile = profiles[stableNumber(`arena-v2-profile:${streamerId}`, profiles.length)];
  const maximumKeywordCount = cost <= 2 ? 1 : cost <= 6 ? 2 : 3;
  const minimumKeywordCount = profile === 'tactical' ? 1 : 0;
  const keywordCount = minimumKeywordCount
    + stableNumber(`arena-v2-keyword-count:${streamerId}`, maximumKeywordCount - minimumKeywordCount + 1);
  const allCandidates = generatedCandidatesFor(cost, cardClass);
  const keywordCandidates = allCandidates.filter((candidate) => candidate.keywords.length === keywordCount);
  const profileCandidates = (keywordCandidates.length ? keywordCandidates : allCandidates)
    .filter((candidate) => matchesGeneratedProfile(candidate, profile));
  const selectable = profileCandidates.length
    ? profileCandidates
    : keywordCandidates.length
      ? keywordCandidates
      : allCandidates;

  if (!selectable.length) {
    throw new Error(`ArenaV2GeneratedCardExactBudgetCandidateMissing:${cost}:${cardClass}`);
  }

  const selected = selectable[stableNumber(`arena-v2-candidate:${streamerId}`, selectable.length)];
  return {
    cardClass,
    cost: selected.cost,
    attack: selected.attack,
    health: selected.health,
    keywords: selected.keywords.map((keyword) => ({ ...keyword })),
    profile
  };
};

const arenaV2ArtAssetForStreamerStar = (streamer: any, star = 0): string | null => {
  const images = [
    streamer.custom_image_url ?? streamer.streamer_custom_image,
    streamer.custom_image_url_1 ?? streamer.streamer_custom_image_1,
    streamer.custom_image_url_2 ?? streamer.streamer_custom_image_2,
    streamer.custom_image_url_3 ?? streamer.streamer_custom_image_3,
    streamer.custom_image_url_4 ?? streamer.streamer_custom_image_4,
    streamer.custom_image_url_5 ?? streamer.streamer_custom_image_5
  ];
  const safeStar = Math.max(0, Math.min(5, Math.floor(Number(star || 0))));
  for (let index = safeStar; index >= 0; index -= 1) {
    if (images[index]) return formatUploadUrl(String(images[index]));
  }
  const logoUrl = streamer.logo_url ?? streamer.streamer_logo;
  return logoUrl ? formatUploadUrl(String(logoUrl)) : null;
};

const defaultArenaV2ArtAssetForStreamer = (streamer: any): string | null => arenaV2ArtAssetForStreamerStar(streamer, 5);

const getHighestOwnedArenaV2StreamerStar = async (db: SqlExecutor, userId: string, streamerId: string) => {
  const row = await queryGet<{ highest_star: number | string | null }>(
    db,
    'SELECT MAX(COALESCE(star, 0)) AS highest_star FROM user_cards WHERE user_id = ? AND channel_id = ?',
    [userId, streamerId]
  );
  const highestStar = Number(row?.highest_star ?? 0);
  return Number.isFinite(highestStar) ? Math.max(0, Math.min(5, Math.floor(highestStar))) : 0;
};

const arenaV2ArtAssetForOwnedStreamer = async (db: SqlExecutor, userId: string, streamer: any) => {
  const streamerId = String(streamer.channel_id || streamer.streamer_id || '').trim();
  const highestStar = streamerId ? await getHighestOwnedArenaV2StreamerStar(db, userId, streamerId) : 0;
  return arenaV2ArtAssetForStreamerStar(streamer, highestStar);
};

const serializeArenaV2CardVersionRow = (row: any) => ({
  id: row.id,
  streamerId: row.streamer_id,
  displayName: row.display_name,
  seasonId: row.season_id,
  version: Number(row.version),
  cardClass: row.card_class,
  cost: Number(row.cost),
  attack: Number(row.attack),
  health: Number(row.health),
  keywords: jsonParse(row.keywords, []),
  balanceScore: Number(row.balance_score || 0),
  validationResult: jsonParse<ArenaV2ValidationResultDto | null>(row.validation_result, null),
  artAssetId: formatUploadUrl(row.art_asset_id || row.streamer_custom_image || row.streamer_logo || null),
  status: row.status,
  streamer: row.streamer_name ? {
    channelId: row.streamer_id,
    name: row.streamer_name,
    logoUrl: formatUploadUrl(row.streamer_logo || null),
    customImageUrl: formatUploadUrl(row.streamer_custom_image || null),
    isImageBanned: Boolean(Number(row.streamer_is_image_banned || 0))
  } : undefined
});

const getExecutor = (): SqlExecutor | null => {
  if (testExecutor) return testExecutor;
  const mode = getDbMode();
  if (mode === 'LOCAL_SQL') {
    const sqlite = getSqliteDb();
    return {
      all: <T = any>(sql: string, params: any[] = []) => sqlite.prepare(sql).all(...params) as T[],
      get: <T = any>(sql: string, params: any[] = []) => sqlite.prepare(sql).get(...params) as T | undefined,
      run: (sql: string, params: any[] = []) => sqlite.prepare(sql).run(...params)
    };
  }
  if (mode === 'MYSQL') return getMysqlDb();
  return null;
};

const arenaV2OwnedStarsAggregateSql = () => (
  getSqlDialect() === 'postgres'
    ? "STRING_AGG(DISTINCT COALESCE(star, 0)::text, ',')"
    : 'GROUP_CONCAT(DISTINCT COALESCE(star, 0))'
);

const normalizeArenaV2CardListLimit = (limit: unknown, fallback = 40) =>
  Math.min(Math.max(Number(limit || fallback), 1), 1000);

const normalizeArenaV2CardListOffset = (offset: unknown) =>
  Math.max(Math.floor(Number(offset || 0)), 0);

export const __setArenaV2ExecutorForTest = (executor: SqlExecutor | null) => {
  testExecutor = executor;
  arenaV2GeneratedCardSyncCompleted.clear();
  arenaV2GeneratedCardSyncInFlight.clear();
};

const queryAll = async <T>(db: SqlExecutor, sql: string, params: any[] = []): Promise<T[]> => {
  const result = db.all<T>(sql, params);
  return Array.isArray(result) ? result : await result;
};

const queryGet = async <T>(db: SqlExecutor, sql: string, params: any[] = []): Promise<T | undefined> => {
  const result = db.get<T>(sql, params);
  return result instanceof Promise ? await result : result;
};

const runSql = async (db: SqlExecutor, sql: string, params: any[] = []) => {
  const result = db.run(sql, params);
  return result instanceof Promise ? await result : result;
};

let arenaV2SqliteTransactionTail: Promise<void> = Promise.resolve();

const withArenaV2Transaction = async <T>(task: (tx: SqlExecutor) => Promise<T>): Promise<T> => {
  if (testExecutor) {
    return testExecutor.transaction ? testExecutor.transaction(task) : task(testExecutor);
  }
  if (getDbMode() === 'MYSQL') {
    const remoteDb = getMysqlDb();
    return remoteDb.transaction(async (tx) => task(tx));
  }
  if (getDbMode() !== 'LOCAL_SQL') throw new Error('ArenaV2SqlDbRequired');

  let releaseTransaction!: () => void;
  const previousTransaction = arenaV2SqliteTransactionTail;
  arenaV2SqliteTransactionTail = new Promise<void>((resolve) => {
    releaseTransaction = resolve;
  });
  await previousTransaction;

  let sqlite: Database.Database | null = null;
  let began = false;
  try {
    const sqlitePath = getSqliteDb().name;
    sqlite = new Database(sqlitePath);
    sqlite.pragma('busy_timeout = 5000');
    sqlite.pragma('foreign_keys = ON');
    const sqliteExecutor: SqlExecutor = {
      all: <TRow = any>(sql: string, params: any[] = []) => sqlite!.prepare(sql).all(...params) as TRow[],
      get: <TRow = any>(sql: string, params: any[] = []) => sqlite!.prepare(sql).get(...params) as TRow | undefined,
      run: (sql: string, params: any[] = []) => sqlite!.prepare(sql).run(...params)
    };
    sqlite.exec('BEGIN IMMEDIATE');
    began = true;
    const result = await task(sqliteExecutor);
    sqlite.exec('COMMIT');
    began = false;
    return result;
  } catch (error) {
    if (sqlite && began) {
      try {
        sqlite.exec('ROLLBACK');
      } catch {
        // Preserve the original open, begin, task, or commit failure.
      }
    }
    throw error;
  } finally {
    try {
      sqlite?.close();
    } catch {
      // Releasing the serialized transaction tail is more important than a close error.
    } finally {
      releaseTransaction();
    }
  }
};

const arenaV2ForUpdateClause = () => (
  getDbMode() === 'MYSQL' && !testExecutor ? 'FOR UPDATE' : ''
);

const affectedRows = (result: any) => Number(result?.changes ?? result?.affectedRows ?? 0);
const isArenaV2DuplicateKeyError = (error: any) => (
  ['ER_DUP_ENTRY', '23505', 'SQLITE_CONSTRAINT_UNIQUE'].includes(String(error?.code || ''))
  || /duplicate key|unique constraint/i.test(String(error?.message || ''))
);

const promoteArenaV2TurnResultIfReady = async (
  db: SqlExecutor,
  match: any,
  nowMs = Date.now()
): Promise<any> => {
  if (match?.status !== 'turn_result') return match;
  const summary = parseArenaV2StoredSummary(match.result_summary);
  const phaseTiming = serializeArenaV2PhaseTiming(summary, new Date(nowMs).toISOString());
  const planningStartsAtMs = phaseTiming?.planningStartsAt ? Date.parse(phaseTiming.planningStartsAt) : Number.NaN;
  if (Number.isFinite(planningStartsAtMs) && planningStartsAtMs > nowMs) return match;

  const nextSummary: ArenaV2StoredSummary = { ...summary, status: 'turn_planning' };
  const updated = await runSql(
    db,
    `
      UPDATE arena_v2_matches
         SET status = 'turn_planning',
             result_summary = ?,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'turn_result'
    `,
    [JSON.stringify(nextSummary), match.id]
  );
  const affectedRows = Number(updated?.changes ?? updated?.affectedRows ?? 1);
  if (affectedRows <= 0) return match;
  return {
    ...match,
    status: 'turn_planning',
    result_summary: JSON.stringify(nextSummary),
    updated_at: new Date(nowMs).toISOString()
  };
};

const defaultArenaV2PreparationSeasonInput = (): ArenaV2AdminSeasonInput => {
  const now = new Date();
  const endsAt = new Date(now.getTime());
  endsAt.setFullYear(endsAt.getFullYear() + 1);
  return {
    seasonKey: 'default_preseason',
    name: '아레나 준비 시즌',
    startsAt: now.toISOString(),
    endsAt: endsAt.toISOString(),
    modesEnabled: { quick: false, bot: false, battle_royale_8: false },
    cardPoolVersion: 'cards-v1',
    balanceVersion: 'balance-v1',
    rewardTable: [],
    mmrTierTable: [],
    createdBy: 'system'
  };
};

export const serializeArenaV2Season = (row: ArenaV2SeasonRow | null | undefined) => {
  if (!row) return null;
  return {
    id: row.id,
    seasonKey: row.season_key,
    name: row.name,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    modesEnabled: jsonParse<Record<string, boolean>>(row.modes_enabled, {}),
    cardPoolVersion: row.card_pool_version,
    balanceVersion: row.balance_version,
    rewardTable: jsonParse<unknown[]>(row.reward_table, []),
    mmrTierTable: jsonParse<unknown[]>(row.mmr_tier_table, []),
    replayRetentionDays: Number(row.replay_retention_days || 7)
  };
};

const findArenaV2CurrentOrPreparationSeasonRow = async (db: SqlExecutor) => queryGet<ArenaV2SeasonRow>(
  db,
  `
    SELECT *
      FROM arena_v2_seasons
     WHERE status IN ('active', 'scheduled', 'draft')
     ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END,
              starts_at DESC
     LIMIT 1
  `
);

const ensureArenaV2PreparationSeason = async (db: SqlExecutor) => {
  const existing = await findArenaV2CurrentOrPreparationSeasonRow(db);
  if (existing) return existing;
  const input = defaultArenaV2PreparationSeasonInput();
  const id = 'arena_v2_default_preseason';
  try {
    await runSql(
      db,
      `
        INSERT INTO arena_v2_seasons
          (id, season_key, name, status, starts_at, ends_at, modes_enabled, card_pool_version, balance_version, reward_table, mmr_tier_table, replay_retention_days, created_by)
        VALUES
          (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, 7, ?)
      `,
      [
        id,
        input.seasonKey,
        input.name,
        input.startsAt,
        input.endsAt,
        JSON.stringify(input.modesEnabled),
        input.cardPoolVersion,
        input.balanceVersion,
        JSON.stringify(input.rewardTable),
        JSON.stringify(input.mmrTierTable),
        input.createdBy
      ]
    );
  } catch (err: any) {
    if (!['ER_DUP_ENTRY', '23505'].includes(String(err?.code || ''))) throw err;
  }
  return await findArenaV2CurrentOrPreparationSeasonRow(db)
    || await queryGet<ArenaV2SeasonRow>(db, 'SELECT * FROM arena_v2_seasons WHERE id = ? LIMIT 1', [id]);
};

export const getArenaV2CurrentSeason = async () => {
  const db = getExecutor();
  if (!db) return null;
  const row = await queryGet<ArenaV2SeasonRow>(
    db,
    `
      SELECT *
        FROM arena_v2_seasons
       WHERE status = 'active'
       ORDER BY starts_at DESC
       LIMIT 1
    `
  );
  return serializeArenaV2Season(row || await ensureArenaV2PreparationSeason(db));
};

export const createArenaV2SeasonAdmin = async (input: ArenaV2AdminSeasonInput) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const id = makeId('arena_v2_season');
  await runSql(
    db,
    `
      INSERT INTO arena_v2_seasons
        (id, season_key, name, status, starts_at, ends_at, modes_enabled, card_pool_version, balance_version, reward_table, mmr_tier_table, replay_retention_days, created_by)
      VALUES
        (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, 7, ?)
    `,
    [
      id,
      input.seasonKey,
      input.name,
      input.startsAt,
      input.endsAt,
      JSON.stringify(input.modesEnabled || {}),
      input.cardPoolVersion,
      input.balanceVersion,
      JSON.stringify(input.rewardTable || []),
      JSON.stringify(input.mmrTierTable || []),
      input.createdBy || 'system'
    ]
  );
  return getArenaV2SeasonById(id);
};

export const getArenaV2SeasonById = async (seasonId: string) => {
  const db = getExecutor();
  if (!db) return null;
  const row = await queryGet<ArenaV2SeasonRow>(db, 'SELECT * FROM arena_v2_seasons WHERE id = ? LIMIT 1', [seasonId]);
  return serializeArenaV2Season(row);
};

export const updateArenaV2SeasonAdmin = async (seasonId: string, patch: Partial<ArenaV2AdminSeasonInput> & { status?: string }) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const existing = await getArenaV2SeasonById(seasonId);
  if (!existing) throw new Error('ArenaV2SeasonNotFound');
  if (['locked', 'settling', 'closed', 'cancelled'].includes(existing.status) && patch.status !== existing.status) {
    throw new Error('ArenaV2SeasonLocked');
  }
  await runSql(
    db,
    `
      UPDATE arena_v2_seasons
         SET season_key = ?,
             name = ?,
             starts_at = ?,
             ends_at = ?,
             modes_enabled = ?,
             card_pool_version = ?,
             balance_version = ?,
             reward_table = ?,
             mmr_tier_table = ?,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
    `,
    [
      patch.seasonKey ?? existing.seasonKey,
      patch.name ?? existing.name,
      patch.startsAt ?? existing.startsAt,
      patch.endsAt ?? existing.endsAt,
      JSON.stringify(patch.modesEnabled ?? existing.modesEnabled),
      patch.cardPoolVersion ?? existing.cardPoolVersion,
      patch.balanceVersion ?? existing.balanceVersion,
      JSON.stringify(patch.rewardTable ?? existing.rewardTable),
      JSON.stringify(patch.mmrTierTable ?? existing.mmrTierTable),
      seasonId
    ]
  );
  return getArenaV2SeasonById(seasonId);
};

export const transitionArenaV2SeasonAdmin = async (seasonId: string, toStatus: string, reason: string) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const existing = await getArenaV2SeasonById(seasonId);
  if (!existing) throw new Error('ArenaV2SeasonNotFound');
  const allowed: Record<string, string[]> = {
    draft: ['scheduled', 'cancelled'],
    scheduled: ['active', 'cancelled'],
    active: ['locked'],
    locked: ['settling'],
    settling: ['closed']
  };
  if (!allowed[existing.status]?.includes(toStatus)) throw new Error('ArenaV2SeasonTransitionInvalid');
  await runSql(
    db,
    `
      UPDATE arena_v2_seasons
         SET status = ?,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
    `,
    [toStatus, seasonId]
  );
  return { season: await getArenaV2SeasonById(seasonId), transition: { fromStatus: existing.status, toStatus, reason } };
};

const validateArenaV2DeckForSeasonWithExecutor = async (
  db: SqlExecutor,
  seasonId: string,
  cardVersionIds: string[]
) => {
  if (cardVersionIds.length === 0) {
    return validateArenaV2Deck({ seasonId, cardVersionIds, cardsByVersionId: {} });
  }
  const placeholders = cardVersionIds.map(() => '?').join(', ');
  const rows = await queryAll<any>(
    db,
    `
      SELECT id, streamer_id, season_id, status
             , card_class, cost, attack, health, keywords, validation_result
        FROM arena_v2_card_versions
       WHERE id IN (${placeholders})
    `,
    cardVersionIds
  );
  const cardsByVersionId: Parameters<typeof validateArenaV2Deck>[0]['cardsByVersionId'] = {};
  for (const row of rows) {
    cardsByVersionId[row.id] = {
      id: row.id,
      streamerId: row.streamer_id,
      seasonId: row.season_id,
      status: row.status,
      cardClass: row.card_class,
      cost: Number(row.cost),
      attack: Number(row.attack),
      health: Number(row.health),
      keywords: jsonParse(row.keywords, []),
      validationResult: jsonParse(row.validation_result, null)
    };
  }

  return validateArenaV2Deck({ seasonId, cardVersionIds, cardsByVersionId });
};

export const validateArenaV2DeckForSeason = async (seasonId: string, cardVersionIds: string[]) => {
  const db = getExecutor();
  if (!db) {
    return validateArenaV2Deck({ seasonId, cardVersionIds, cardsByVersionId: {} });
  }
  return validateArenaV2DeckForSeasonWithExecutor(db, seasonId, cardVersionIds);
};

const buildDefaultArenaV2CardVersionForStreamer = (seasonId: string, streamer: any) => {
  const streamerId = String(streamer.channel_id || '').trim();
  const combat = generateArenaV2DefaultCardCombatDefinition(streamerId);
  const candidate = {
    id: makeArenaV2DefaultCardId(seasonId, streamerId),
    streamerId,
    seasonId,
    status: 'active' as const,
    cardClass: combat.cardClass,
    cost: combat.cost,
    attack: combat.attack,
    health: combat.health,
    keywords: combat.keywords,
    validationResult: null
  };
  const validation = validateArenaV2CardVersionDefinition(candidate);
  if (!validation.valid) {
    const fallback = {
      ...candidate,
      cardClass: 'charge' as ArenaV2CardClassDto,
      cost: 2,
      attack: 1,
      health: 5,
      keywords: [] as Array<{ type: string; value?: number; limit?: string }>
    };
    const fallbackValidation = validateArenaV2CardVersionDefinition(fallback);
    const fallbackBudget = evaluateArenaV2CardBudget(fallback);
    if (!fallbackValidation.valid || fallbackBudget.remaining !== 0) {
      throw new Error(`ArenaV2GeneratedCardFallbackInvalid:${streamerId}`);
    }
    return {
      ...fallback,
      displayName: sanitizeCardDisplayName(streamer.name, streamerId),
      validation: fallbackValidation,
      balanceScore: fallbackBudget.totalCost,
      artAssetId: defaultArenaV2ArtAssetForStreamer(streamer)
    };
  }
  const budget = evaluateArenaV2CardBudget(candidate);
  if (budget.remaining !== 0) {
    throw new Error(`ArenaV2GeneratedCardBudgetNotFullySpent:${streamerId}:${budget.totalCost}/${budget.budgetLimit}`);
  }
  return {
    ...candidate,
    displayName: sanitizeCardDisplayName(streamer.name, streamerId),
    validation,
    balanceScore: budget.totalCost,
    artAssetId: defaultArenaV2ArtAssetForStreamer(streamer)
  };
};

const generatedArenaV2CombatMatches = (existing: any, generated: ReturnType<typeof buildDefaultArenaV2CardVersionForStreamer>) => (
  String(existing.card_class || '') === generated.cardClass
  && Number(existing.cost) === generated.cost
  && Number(existing.attack) === generated.attack
  && Number(existing.health) === generated.health
  && JSON.stringify(jsonParse(existing.keywords, [])) === JSON.stringify(generated.keywords)
  && Number(existing.balance_score || 0) === Number(generated.balanceScore || 0)
  && JSON.stringify(jsonParse(existing.validation_result, null)) === JSON.stringify(generated.validation)
);

type ArenaV2GeneratedCardSyncOutcome = 'created' | 'updated' | 'skipped';

const syncGeneratedArenaV2CardForStreamer = async (
  db: SqlExecutor,
  seasonId: string,
  streamer: any,
  existing?: any
): Promise<ArenaV2GeneratedCardSyncOutcome> => {
  const streamerId = String(streamer.channel_id || '').trim();
  if (!streamerId) return 'skipped';
  const generated = buildDefaultArenaV2CardVersionForStreamer(seasonId, streamer);

  if (existing) {
    // 자동 생성 카드만 제자리 갱신합니다. 스트리머가 직접 만든 새 버전은 덮어쓰지 않습니다.
    if (!isArenaV2GeneratedCardId(existing.id, seasonId, streamerId) || generatedArenaV2CombatMatches(existing, generated)) return 'skipped';
    await runSql(
      db,
      `
        UPDATE arena_v2_card_versions
           SET card_class = ?,
               cost = ?,
               attack = ?,
               health = ?,
               keywords = ?,
               balance_score = ?,
               validation_result = ?,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND season_id = ? AND status = 'active'
      `,
      [
        generated.cardClass,
        generated.cost,
        generated.attack,
        generated.health,
        JSON.stringify(generated.keywords),
        generated.balanceScore,
        JSON.stringify(generated.validation),
        existing.id,
        seasonId
      ]
    );
    existing.card_class = generated.cardClass;
    existing.cost = generated.cost;
    existing.attack = generated.attack;
    existing.health = generated.health;
    existing.keywords = JSON.stringify(generated.keywords);
    existing.balance_score = generated.balanceScore;
    existing.validation_result = JSON.stringify(generated.validation);
    return 'updated';
  }

  const conflictClause = getSqlDialect() === 'mysql'
    ? 'ON DUPLICATE KEY UPDATE id = VALUES(id)'
    : 'ON CONFLICT (id) DO NOTHING';
  const result = await runSql(
    db,
    `
      INSERT INTO arena_v2_card_versions
        (id, streamer_id, display_name, season_id, version, card_class, cost, attack, health, keywords, balance_score, validation_result, art_asset_id, status)
      VALUES
        (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
      ${conflictClause}
    `,
    [
      generated.id,
      streamerId,
      generated.displayName,
      seasonId,
      generated.cardClass,
      generated.cost,
      generated.attack,
      generated.health,
      JSON.stringify(generated.keywords),
      generated.balanceScore,
      JSON.stringify(generated.validation),
      generated.artAssetId
    ]
  );
  const changedRows = Number(result?.changes ?? result?.rowCount ?? result?.affectedRows ?? 1);
  return changedRows > 0 ? 'created' : 'skipped';
};

const runArenaV2GeneratedCardSyncBatch = async (
  jobs: Array<() => Promise<ArenaV2GeneratedCardSyncOutcome>>,
  concurrency = 16
) => {
  const totals = { created: 0, updated: 0, skipped: 0 };
  for (let index = 0; index < jobs.length; index += concurrency) {
    const outcomes = await Promise.all(jobs.slice(index, index + concurrency).map((job) => job()));
    for (const outcome of outcomes) totals[outcome] += 1;
  }
  return totals;
};

export const syncArenaV2CardsFromRegisteredStreamers = async (seasonId?: string) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const activeSeason = seasonId ? await getArenaV2SeasonById(seasonId) : await getArenaV2CurrentSeason();
  if (!activeSeason?.id) throw new Error('ArenaV2SeasonNotFound');
  const pageSize = 500;
  const totals = { scanned: 0, created: 0, updated: 0, skipped: 0 };
  let cursorBaseValue: number | null = null;
  let cursorChannelId = '';

  while (true) {
    const hasCursor: boolean = cursorBaseValue != null;
    const streamers: any[] = await queryAll<any>(
      db,
      `
        SELECT channel_id, name, logo_url, custom_image_url, custom_image_url_1, custom_image_url_2,
               custom_image_url_3, custom_image_url_4, custom_image_url_5,
               follower_count, base_value, is_active, is_image_banned
          FROM streamers
         WHERE COALESCE(is_image_banned, 0) = 0
           ${hasCursor ? 'AND (COALESCE(base_value, 0) < ? OR (COALESCE(base_value, 0) = ? AND channel_id > ?))' : ''}
         ORDER BY COALESCE(base_value, 0) DESC, channel_id ASC
         LIMIT ?
      `,
      hasCursor ? [cursorBaseValue, cursorBaseValue, cursorChannelId, pageSize] : [pageSize]
    );
    if (streamers.length === 0) break;

    const streamerIds = streamers
      .map((streamer: any) => String(streamer.channel_id || '').trim())
      .filter(Boolean);
    const existingByStreamerId = new Map<string, any>();
    if (streamerIds.length > 0) {
      const placeholders = streamerIds.map(() => '?').join(', ');
      const existingRows = await queryAll<any>(
        db,
        `
          SELECT id, streamer_id, version, card_class, cost, attack, health, keywords, balance_score, validation_result
            FROM arena_v2_card_versions
           WHERE season_id = ? AND status = 'active' AND streamer_id IN (${placeholders})
           ORDER BY streamer_id ASC, version DESC, updated_at DESC
        `,
        [activeSeason.id, ...streamerIds]
      );
      for (const row of existingRows) {
        const streamerId = String(row.streamer_id || '').trim();
        if (streamerId && !existingByStreamerId.has(streamerId)) existingByStreamerId.set(streamerId, row);
      }
    }

    const pageTotals = await runArenaV2GeneratedCardSyncBatch(streamers.map((streamer: any) => () => {
      const streamerId = String(streamer.channel_id || '').trim();
      return syncGeneratedArenaV2CardForStreamer(db, activeSeason.id, streamer, existingByStreamerId.get(streamerId));
    }));
    totals.scanned += streamers.length;
    totals.created += pageTotals.created;
    totals.updated += pageTotals.updated;
    totals.skipped += pageTotals.skipped;

    if (streamers.length < pageSize) break;
    const lastStreamer: any = streamers[streamers.length - 1];
    cursorBaseValue = Number(lastStreamer.base_value || 0);
    cursorChannelId = String(lastStreamer.channel_id || '');
    if (!cursorChannelId) break;
  }

  return { seasonId: activeSeason.id, ...totals };
};

export const syncArenaV2CardsFromOwnedCards = async (userId: string, seasonId?: string, options: { limit?: number } = {}) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const activeSeason = seasonId ? await getArenaV2SeasonById(seasonId) : await getArenaV2CurrentSeason();
  if (!activeSeason?.id) throw new Error('ArenaV2SeasonNotFound');
  const syncLimit = Math.min(Math.max(Math.floor(Number(options.limit || 500)), 1), 1000);
  const streamers = await queryAll<any>(
    db,
    `
      SELECT s.channel_id, s.name, s.logo_url, s.custom_image_url, s.custom_image_url_1, s.custom_image_url_2,
             s.custom_image_url_3, s.custom_image_url_4, s.custom_image_url_5,
             s.follower_count, s.base_value, s.is_active, s.is_image_banned,
             COUNT(uc.id) AS owned_count
        FROM user_cards uc
        JOIN streamers s ON s.channel_id = uc.channel_id
       WHERE uc.user_id = ?
         AND COALESCE(s.is_image_banned, 0) = 0
       GROUP BY s.channel_id, s.name, s.logo_url, s.custom_image_url, s.custom_image_url_1, s.custom_image_url_2,
                s.custom_image_url_3, s.custom_image_url_4, s.custom_image_url_5,
                s.follower_count, s.base_value, s.is_active, s.is_image_banned
       ORDER BY owned_count DESC, s.base_value DESC, s.channel_id ASC
       LIMIT ?
    `,
    [userId, syncLimit]
  );

  const streamerIds = streamers
    .map((streamer) => String(streamer.channel_id || '').trim())
    .filter(Boolean);
  if (streamerIds.length === 0) {
    return { seasonId: activeSeason.id, scanned: 0, created: 0, updated: 0, skipped: 0 };
  }
  const placeholders = streamerIds.map(() => '?').join(', ');
  const existingRows = await queryAll<any>(
    db,
    `
      SELECT id, streamer_id, version, card_class, cost, attack, health, keywords, balance_score, validation_result
        FROM arena_v2_card_versions
       WHERE season_id = ? AND status = 'active' AND streamer_id IN (${placeholders})
    `,
    [activeSeason.id, ...streamerIds]
  );
  const existingByStreamerId = new Map(existingRows.map((row) => [String(row.streamer_id), row]));
  const totals = await runArenaV2GeneratedCardSyncBatch(streamers.map((streamer) => () => {
    const streamerId = String(streamer.channel_id || '').trim();
    return syncGeneratedArenaV2CardForStreamer(db, activeSeason.id, streamer, existingByStreamerId.get(streamerId));
  }));

  return { seasonId: activeSeason.id, scanned: streamers.length, ...totals };
};

const ensureArenaV2CardsForSeason = async (_db: SqlExecutor, seasonId: string) => {
  if (arenaV2GeneratedCardSyncCompleted.has(seasonId)) return;
  const activeCount = await queryGet<{ count: number }>(
    _db,
    'SELECT COUNT(*) AS count FROM arena_v2_card_versions WHERE season_id = ? AND status = ?',
    [seasonId, 'active']
  );
  const mustWaitForInitialCards = Number(activeCount?.count || 0) === 0;
  const existingSync = arenaV2GeneratedCardSyncInFlight.get(seasonId);
  if (existingSync) {
    if (mustWaitForInitialCards || testExecutor) await existingSync;
    return;
  }
  const sync = syncArenaV2CardsFromRegisteredStreamers(seasonId)
    .then(() => {
      arenaV2GeneratedCardSyncCompleted.add(seasonId);
    })
    .catch((error: any) => {
      console.error('[ArenaV2] 자동 생성 카드 백그라운드 동기화 실패:', error?.message || error);
    })
    .finally(() => {
      arenaV2GeneratedCardSyncInFlight.delete(seasonId);
    });
  arenaV2GeneratedCardSyncInFlight.set(seasonId, sync);
  // 기존 카드가 있으면 전체 갱신은 요청과 분리합니다. 빈 시즌의 최초 생성과 테스트만 완료를 기다립니다.
  if (mustWaitForInitialCards || testExecutor) await sync;
};

export const listArenaV2Cards = async (filters: ArenaV2CardListFilters = {}) => {
  const db = getExecutor();
  if (!db) return [];
  const activeSeason = filters.seasonId ? null : await getArenaV2CurrentSeason();
  const seasonId = filters.seasonId || activeSeason?.id;
  if (!seasonId) return [];
  await ensureArenaV2CardsForSeason(db, seasonId);

  const where = ['cv.season_id = ?', "cv.status = 'active'"];
  const params: any[] = [seasonId];
  if (filters.class) {
    where.push('cv.card_class = ?');
    params.push(filters.class);
  }
  if (Number.isFinite(filters.costMin)) {
    where.push('cv.cost >= ?');
    params.push(filters.costMin);
  }
  if (Number.isFinite(filters.costMax)) {
    where.push('cv.cost <= ?');
    params.push(filters.costMax);
  }
  if (filters.keyword) {
    where.push('cv.keywords LIKE ?');
    params.push(`%${filters.keyword}%`);
  }
  if (filters.streamerName) {
    where.push('(display_name LIKE ? OR s.name LIKE ? OR streamer_id LIKE ?)');
    params.push(`%${filters.streamerName}%`);
    params.push(`%${filters.streamerName}%`);
    params.push(`%${filters.streamerName}%`);
  }
  const limit = normalizeArenaV2CardListLimit(filters.limit);
  const offset = normalizeArenaV2CardListOffset(filters.offset);
  params.push(limit + 1);
  params.push(offset);

  const rows = await queryAll<any>(
    db,
    `
      SELECT cv.id, cv.streamer_id, cv.display_name, cv.season_id, cv.version, cv.card_class, cv.cost,
             cv.attack, cv.health, cv.keywords, cv.balance_score, cv.validation_result,
             COALESCE(cv.art_asset_id, s.custom_image_url, s.logo_url) AS art_asset_id,
             cv.status,
             s.name AS streamer_name,
             s.logo_url AS streamer_logo,
             s.custom_image_url AS streamer_custom_image,
             s.is_image_banned AS streamer_is_image_banned
        FROM arena_v2_card_versions cv
        LEFT JOIN streamers s ON s.channel_id = cv.streamer_id
       WHERE ${where.join(' AND ')}
       ORDER BY cv.cost ASC, cv.display_name ASC, cv.id ASC
       LIMIT ? OFFSET ?
    `,
    params
  );

  await runArenaV2GeneratedCardSyncBatch(rows.map((row) => () => syncGeneratedArenaV2CardForStreamer(
    db,
    seasonId,
    {
      channel_id: row.streamer_id,
      name: row.streamer_name || row.display_name,
      logo_url: row.streamer_logo,
      custom_image_url: row.streamer_custom_image
    },
    row
  )));

  return rows.map(serializeArenaV2CardVersionRow);
};

export const listArenaV2OwnedCardsForUser = async (userId: string, filters: ArenaV2CardListFilters = {}) => {
  const db = getExecutor();
  if (!db) return [];
  const activeSeason = filters.seasonId ? null : await getArenaV2CurrentSeason();
  const seasonId = filters.seasonId || activeSeason?.id;
  if (!seasonId) return [];
  await ensureArenaV2CardsForSeason(db, seasonId);
  const limit = normalizeArenaV2CardListLimit(filters.limit);
  const offset = normalizeArenaV2CardListOffset(filters.offset);
  await syncArenaV2CardsFromOwnedCards(userId, seasonId, { limit: Math.max(offset + limit + 1, 100) });
  const ownedStarsAggregate = arenaV2OwnedStarsAggregateSql();

  const where = ['cv.season_id = ?', "cv.status = 'active'", 'owned.owned_count > 0'];
  const params: any[] = [userId, seasonId];
  if (filters.class) {
    where.push('cv.card_class = ?');
    params.push(filters.class);
  }
  if (Number.isFinite(filters.costMin)) {
    where.push('cv.cost >= ?');
    params.push(filters.costMin);
  }
  if (Number.isFinite(filters.costMax)) {
    where.push('cv.cost <= ?');
    params.push(filters.costMax);
  }
  if (filters.keyword) {
    where.push('cv.keywords LIKE ?');
    params.push(`%${filters.keyword}%`);
  }
  if (filters.streamerName) {
    where.push('(cv.display_name LIKE ? OR s.name LIKE ? OR cv.streamer_id LIKE ?)');
    params.push(`%${filters.streamerName}%`);
    params.push(`%${filters.streamerName}%`);
    params.push(`%${filters.streamerName}%`);
  }
  params.push(limit + 1);
  params.push(offset);

  const rows = await queryAll<any>(
    db,
    `
      SELECT cv.id, cv.streamer_id, cv.display_name, cv.season_id, cv.version, cv.card_class, cv.cost,
             cv.attack, cv.health, cv.keywords, cv.balance_score, cv.validation_result,
             COALESCE(cv.art_asset_id, s.custom_image_url, s.logo_url) AS art_asset_id,
             cv.status,
             s.name AS streamer_name,
             s.logo_url AS streamer_logo,
             s.custom_image_url AS streamer_custom_image,
             s.custom_image_url_1 AS streamer_custom_image_1,
             s.custom_image_url_2 AS streamer_custom_image_2,
             s.custom_image_url_3 AS streamer_custom_image_3,
             s.custom_image_url_4 AS streamer_custom_image_4,
             s.custom_image_url_5 AS streamer_custom_image_5,
             s.is_image_banned AS streamer_is_image_banned,
             owned.owned_count AS owned_count,
             owned.owned_stars AS owned_stars
        FROM arena_v2_card_versions cv
        JOIN (
          SELECT channel_id,
                 COUNT(*) AS owned_count,
                 ${ownedStarsAggregate} AS owned_stars
            FROM user_cards
           WHERE user_id = ?
           GROUP BY channel_id
        ) owned ON owned.channel_id = cv.streamer_id
        LEFT JOIN streamers s ON s.channel_id = cv.streamer_id
       WHERE ${where.join(' AND ')}
       ORDER BY owned.owned_count DESC, cv.cost ASC, cv.display_name ASC, cv.id ASC
       LIMIT ? OFFSET ?
    `,
    params
  );

  return rows.map((row) => {
    const ownedStars = String(row.owned_stars || '')
      .split(',')
      .map((star) => Number(star))
      .filter((star) => Number.isFinite(star))
      .sort((a, b) => a - b);
    const highestOwnedStar = ownedStars.length ? Math.max(...ownedStars) : 0;
    return {
      ...serializeArenaV2CardVersionRow({
        ...row,
        art_asset_id: arenaV2ArtAssetForStreamerStar(row, highestOwnedStar)
      }),
      ownedCount: Number(row.owned_count || 0),
      ownedStars
    };
  });
};

export const getArenaV2CardVersion = async (cardVersionId: string) => {
  const db = getExecutor();
  if (!db) return null;
  const row = await queryGet<any>(
    db,
    `
      SELECT cv.id, cv.streamer_id, cv.display_name, cv.season_id, cv.version, cv.card_class, cv.cost,
             cv.attack, cv.health, cv.keywords, cv.balance_score, cv.validation_result,
             COALESCE(cv.art_asset_id, s.custom_image_url, s.logo_url) AS art_asset_id,
             cv.status,
             s.name AS streamer_name,
             s.logo_url AS streamer_logo,
             s.custom_image_url AS streamer_custom_image,
             s.is_image_banned AS streamer_is_image_banned
        FROM arena_v2_card_versions cv
        LEFT JOIN streamers s ON s.channel_id = cv.streamer_id
       WHERE cv.id = ?
       LIMIT 1
    `,
    [cardVersionId]
  );
  if (!row) return null;
  return serializeArenaV2CardVersionRow(row);
};

const findArenaV2OwnedStreamer = async (db: SqlExecutor, userId: string) => queryGet<any>(
  db,
  `
    SELECT channel_id, name, logo_url, custom_image_url, custom_image_url_1, custom_image_url_2,
           custom_image_url_3, custom_image_url_4, custom_image_url_5,
           follower_count, base_value, is_active, is_image_banned, registered_by
      FROM streamers
     WHERE channel_id = ? OR registered_by = ?
     ORDER BY CASE WHEN channel_id = ? THEN 0 ELSE 1 END
     LIMIT 1
  `,
  [userId, userId, userId]
);

const getLatestArenaV2StreamerCardRow = async (db: SqlExecutor, seasonId: string, streamerId: string, includeDisabled = false) => queryGet<any>(
  db,
  `
    SELECT cv.id, cv.streamer_id, cv.display_name, cv.season_id, cv.version, cv.card_class, cv.cost,
           cv.attack, cv.health, cv.keywords, cv.balance_score, cv.validation_result,
           COALESCE(cv.art_asset_id, s.custom_image_url, s.logo_url) AS art_asset_id,
           cv.status,
           s.name AS streamer_name,
           s.logo_url AS streamer_logo,
           s.custom_image_url AS streamer_custom_image,
           s.is_image_banned AS streamer_is_image_banned
      FROM arena_v2_card_versions cv
      LEFT JOIN streamers s ON s.channel_id = cv.streamer_id
     WHERE cv.season_id = ? AND cv.streamer_id = ?
       ${includeDisabled ? '' : "AND cv.status = 'active'"}
     ORDER BY cv.version DESC, cv.updated_at DESC
     LIMIT 1
  `,
  [seasonId, streamerId]
);

export const getMyArenaV2StreamerCard = async (userId: string, seasonId?: string) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const streamer = await findArenaV2OwnedStreamer(db, userId);
  if (!streamer) throw new Error('ArenaStreamerRightForbidden');
  const season = seasonId ? await getArenaV2SeasonById(seasonId) : await getArenaV2CurrentSeason();
  if (!season?.id) {
    if (seasonId) throw new Error('ArenaV2SeasonNotFound');
    return {
      seasonId: null,
      streamer: {
        channelId: streamer.channel_id,
        name: streamer.name,
        logoUrl: streamer.logo_url,
        customImageUrl: streamer.custom_image_url,
        isImageBanned: Boolean(Number(streamer.is_image_banned || 0))
      },
      card: null,
      canEdit: false
    };
  }

  await ensureArenaV2CardsForSeason(db, season.id);
  let row = await getLatestArenaV2StreamerCardRow(db, season.id, streamer.channel_id, true);
  if (!row) {
    await syncGeneratedArenaV2CardForStreamer(db, season.id, streamer);
    row = await getLatestArenaV2StreamerCardRow(db, season.id, streamer.channel_id, true);
  } else if (row.status === 'active') {
    await syncGeneratedArenaV2CardForStreamer(db, season.id, streamer, row);
  }
  if (row) {
    row.art_asset_id = await arenaV2ArtAssetForOwnedStreamer(db, userId, streamer);
  }
  const card = row ? serializeArenaV2CardVersionRow(row) : null;
  return {
    seasonId: season.id,
    streamer: {
      channelId: streamer.channel_id,
      name: streamer.name,
      logoUrl: streamer.logo_url,
      customImageUrl: streamer.custom_image_url,
      isImageBanned: Boolean(Number(streamer.is_image_banned || 0))
    },
    card,
    budget: card ? evaluateArenaV2CardBudget(card) : null,
    canEdit: season.status === 'active' || season.status === 'scheduled' || season.status === 'draft'
  };
};

export const updateMyArenaV2StreamerCard = async (input: ArenaV2StreamerCardConfigInput) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const season = await getArenaV2CurrentSeason();
  if (!season?.id) throw new Error('ArenaV2SeasonNotFound');
  const streamer = await findArenaV2OwnedStreamer(db, input.requesterUserId);
  if (!streamer) throw new Error('ArenaStreamerRightForbidden');
  if (Boolean(Number(streamer.is_image_banned || 0))) throw new Error('ArenaV2StreamerCardImageBanned');

  const cardClass = normalizeArenaV2CardClass(input.cardClass);
  const cost = Math.max(1, Math.min(9, Math.floor(Number(input.cost || 1))));
  const attack = Math.max(0, Math.floor(Number(input.attack || 0)));
  const health = Math.max(1, Math.floor(Number(input.health || 1)));
  const keywords = normalizeArenaV2KeywordList(input.keywords);
  const candidate = {
    id: 'pending',
    streamerId: streamer.channel_id,
    seasonId: season.id,
    status: 'active' as const,
    cardClass,
    cost,
    attack,
    health,
    keywords,
    validationResult: null
  };
  const validation = validateArenaV2CardVersionDefinition(candidate);
  const budget = evaluateArenaV2CardBudget(candidate);
  if (!validation.valid) {
    return { accepted: false as const, validation, budget, card: null };
  }

  const versionRow = await queryGet<{ max_version: number }>(
    db,
    'SELECT COALESCE(MAX(version), 0) AS max_version FROM arena_v2_card_versions WHERE season_id = ? AND streamer_id = ?',
    [season.id, streamer.channel_id]
  );
  const nextVersion = Number(versionRow?.max_version || 0) + 1;
  const cardId = makeId('arena_v2_card');
  const displayName = sanitizeCardDisplayName(streamer.name, streamer.channel_id);
  const artAssetId = await arenaV2ArtAssetForOwnedStreamer(db, input.requesterUserId, streamer);
  const balanceScore = budget.totalCost;

  await runSql(
    db,
    `
      UPDATE arena_v2_card_versions
         SET status = 'disabled',
             updated_at = CURRENT_TIMESTAMP
       WHERE season_id = ? AND streamer_id = ? AND status = 'active'
    `,
    [season.id, streamer.channel_id]
  );
  await runSql(
    db,
    `
      INSERT INTO arena_v2_card_versions
        (id, streamer_id, display_name, season_id, version, card_class, cost, attack, health, keywords, balance_score, validation_result, art_asset_id, status)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `,
    [
      cardId,
      streamer.channel_id,
      displayName,
      season.id,
      nextVersion,
      cardClass,
      cost,
      attack,
      health,
      JSON.stringify(keywords),
      balanceScore,
      JSON.stringify(validation),
      artAssetId || null
    ]
  );

  return {
    accepted: true as const,
    validation,
    budget,
    card: await getArenaV2CardVersion(cardId)
  };
};

export const disableMyArenaV2StreamerCard = async (userId: string) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const season = await getArenaV2CurrentSeason();
  if (!season?.id) throw new Error('ArenaV2SeasonNotFound');
  const streamer = await findArenaV2OwnedStreamer(db, userId);
  if (!streamer) throw new Error('ArenaStreamerRightForbidden');
  await runSql(
    db,
    `
      UPDATE arena_v2_card_versions
         SET status = 'disabled',
             updated_at = CURRENT_TIMESTAMP
       WHERE season_id = ? AND streamer_id = ? AND status = 'active'
    `,
    [season.id, streamer.channel_id]
  );
  return { disabled: true, seasonId: season.id, streamerId: streamer.channel_id };
};

export const enableMyArenaV2StreamerCard = async (userId: string) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const season = await getArenaV2CurrentSeason();
  if (!season?.id) throw new Error('ArenaV2SeasonNotFound');
  const streamer = await findArenaV2OwnedStreamer(db, userId);
  if (!streamer) throw new Error('ArenaStreamerRightForbidden');
  const active = await getLatestArenaV2StreamerCardRow(db, season.id, streamer.channel_id);
  if (active) return { enabled: true, card: serializeArenaV2CardVersionRow(active) };
  const latest = await getLatestArenaV2StreamerCardRow(db, season.id, streamer.channel_id, true);
  if (latest) {
    await runSql(
      db,
      `
        UPDATE arena_v2_card_versions
           SET status = 'active',
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
      `,
      [latest.id]
    );
    latest.status = 'active';
    await syncGeneratedArenaV2CardForStreamer(db, season.id, streamer, latest);
    return { enabled: true, card: await getArenaV2CardVersion(latest.id) };
  }
  await syncArenaV2CardsFromRegisteredStreamers(season.id);
  return { enabled: true, card: await getLatestArenaV2StreamerCardRow(db, season.id, streamer.channel_id).then((row) => row ? serializeArenaV2CardVersionRow(row) : null) };
};

export const listArenaV2DecksForUser = async (userId: string, seasonId?: string) => {
  const db = getExecutor();
  if (!db) return [];
  const where = ['user_id = ?'];
  const params: any[] = [userId];
  if (seasonId) {
    where.push('season_id = ?');
    params.push(seasonId);
  }

  const rows = await queryAll<any>(
    db,
    `
      SELECT id, user_id, season_id, name, mode_scope, card_version_ids, validation_hash, is_valid, validation_result, created_at, updated_at
        FROM arena_v2_decks
       WHERE ${where.join(' AND ')}
       ORDER BY updated_at DESC
       LIMIT 100
    `,
    params
  );

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    seasonId: row.season_id,
    name: row.name,
    modeScope: row.mode_scope,
    cardVersionIds: jsonParse<string[]>(row.card_version_ids, []),
    validationHash: row.validation_hash,
    isValid: Boolean(Number(row.is_valid)),
    validationResult: jsonParse(row.validation_result, { valid: false, errors: [], warnings: [] }),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
};

const lockArenaV2User = async (db: SqlExecutor, userId: string) => {
  await queryGet(db, `SELECT id FROM users WHERE id = ? LIMIT 1 ${arenaV2ForUpdateClause()}`, [userId]);
};

const findArenaV2ActiveParticipationForUser = async (db: SqlExecutor, userId: string) => {
  const now = new Date().toISOString();
  return queryGet<any>(
    db,
    `SELECT activity_kind, reference_id
       FROM (
         SELECT 'quick_queue' AS activity_kind, q.id AS reference_id
           FROM arena_v2_match_queue q
           LEFT JOIN arena_v2_matches m ON m.id = q.matched_match_id
          WHERE q.user_id = ?
            AND ((q.status = 'waiting' AND q.expires_at >= ?)
              OR q.status IN ('proposed', 'accepted', 'matching')
              OR (q.status = 'matched' AND m.status NOT IN ('completed', 'cancelled')))
         UNION ALL
         SELECT 'battle_royale' AS activity_kind, q.id AS reference_id
           FROM arena_v2_battle_royale_queue q
           LEFT JOIN arena_v2_battle_royales br ON br.id = q.battle_royale_id
          WHERE q.user_id = ?
            AND ((q.status = 'waiting' AND q.expires_at >= ?)
              OR (q.status = 'matched' AND br.status = 'active'))
         UNION ALL
         SELECT 'match' AS activity_kind, p.match_id AS reference_id
           FROM arena_v2_match_players p
           JOIN arena_v2_matches m ON m.id = p.match_id
          WHERE p.user_id = ? AND m.status NOT IN ('completed', 'cancelled')
       ) active_participation
      LIMIT 1`,
    [userId, now, userId, now, userId]
  );
};

const assertArenaV2UserAvailable = async (db: SqlExecutor, userId: string) => {
  if (await findArenaV2ActiveParticipationForUser(db, userId)) {
    throw new Error('ArenaV2AlreadyActive');
  }
};

const assertArenaV2DeckNotInUse = async (db: SqlExecutor, deckId: string) => {
  const now = new Date().toISOString();
  const active = await queryGet<any>(
    db,
    `SELECT activity_kind
       FROM (
         SELECT 'quick_queue' AS activity_kind
           FROM arena_v2_match_queue q
           LEFT JOIN arena_v2_matches m ON m.id = q.matched_match_id
          WHERE q.deck_id = ?
            AND ((q.status = 'waiting' AND q.expires_at >= ?)
              OR q.status IN ('proposed', 'accepted', 'matching')
              OR (q.status = 'matched' AND m.status NOT IN ('completed', 'cancelled')))
         UNION ALL
         SELECT 'battle_royale' AS activity_kind
           FROM arena_v2_battle_royale_queue q
           LEFT JOIN arena_v2_battle_royales br ON br.id = q.battle_royale_id
          WHERE q.deck_id = ?
            AND ((q.status = 'waiting' AND q.expires_at >= ?)
              OR (q.status = 'matched' AND br.status = 'active'))
         UNION ALL
         SELECT 'match' AS activity_kind
           FROM arena_v2_match_players p
           JOIN arena_v2_matches m ON m.id = p.match_id
          WHERE p.deck_id = ? AND m.status NOT IN ('completed', 'cancelled')
       ) active_deck
      LIMIT 1`,
    [deckId, now, deckId, now, deckId]
  );
  if (active) throw new Error('ArenaV2DeckInUse');
};

export const saveArenaV2Deck = async (input: ArenaV2SaveDeckInput) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const validation = await validateArenaV2DeckForSeason(input.seasonId, input.cardVersionIds);
  const deckId = input.deckId || makeId('arena_v2_deck');
  const validationHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      seasonId: input.seasonId,
      modeScope: input.modeScope,
      cardVersionIds: input.cardVersionIds,
      validation
    }))
    .digest('hex');
  const cardVersionIdsJson = JSON.stringify(input.cardVersionIds);
  const validationJson = JSON.stringify(validation);

  if (input.deckId) {
    await withArenaV2Transaction(async (tx) => {
      await lockArenaV2User(tx, input.userId);
      const existing = await queryGet<{ id: string; user_id: string }>(
        tx,
        'SELECT id, user_id FROM arena_v2_decks WHERE id = ? LIMIT 1',
        [input.deckId]
      );
      if (!existing) {
        throw new Error('ArenaV2DeckNotFound');
      }
      if (existing.user_id !== input.userId) {
        throw new Error('ArenaV2DeckForbidden');
      }
      await assertArenaV2DeckNotInUse(tx, input.deckId!);
      await runSql(
        tx,
        `
          UPDATE arena_v2_decks
             SET season_id = ?,
                 name = ?,
                 mode_scope = ?,
                 card_version_ids = ?,
                 validation_hash = ?,
                 is_valid = ?,
                 validation_result = ?,
                 updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND user_id = ?
        `,
        [input.seasonId, input.name, input.modeScope, cardVersionIdsJson, validationHash, validation.valid ? 1 : 0, validationJson, deckId, input.userId]
      );
    });
  } else {
    await runSql(
      db,
      `
        INSERT INTO arena_v2_decks
          (id, user_id, season_id, name, mode_scope, card_version_ids, validation_hash, is_valid, validation_result)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [deckId, input.userId, input.seasonId, input.name, input.modeScope, cardVersionIdsJson, validationHash, validation.valid ? 1 : 0, validationJson]
    );
  }

  return {
    id: deckId,
    userId: input.userId,
    seasonId: input.seasonId,
    name: input.name,
    modeScope: input.modeScope,
    cardVersionIds: input.cardVersionIds,
    validationHash,
    isValid: validation.valid,
    validationResult: validation
  };
};

export const revalidateArenaV2DeckForUser = async (userId: string, deckId: string) => withArenaV2Transaction(async (tx) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  await lockArenaV2User(tx, userId);
  const deck = await queryGet<any>(
    tx,
    'SELECT id, user_id, season_id, name, mode_scope, card_version_ids, validation_hash, is_valid, validation_result FROM arena_v2_decks WHERE id = ? LIMIT 1',
    [deckId]
  );
  if (!deck) throw new Error('ArenaV2DeckNotFound');
  if (deck.user_id !== userId) throw new Error('ArenaV2DeckForbidden');
  await assertArenaV2DeckNotInUse(tx, deckId);

  const cardVersionIds = jsonParse<string[]>(deck.card_version_ids, []);
  const validation = await validateArenaV2DeckForSeasonWithExecutor(tx, deck.season_id, cardVersionIds);
  const validationHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      seasonId: deck.season_id,
      modeScope: deck.mode_scope,
      cardVersionIds,
      validation
    }))
    .digest('hex');
  await runSql(
    tx,
    `
      UPDATE arena_v2_decks
         SET validation_hash = ?,
             is_valid = ?,
             validation_result = ?,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?
    `,
    [validationHash, validation.valid ? 1 : 0, JSON.stringify(validation), deckId, userId]
  );
  return {
    id: deck.id,
    userId: deck.user_id,
    seasonId: deck.season_id,
    name: deck.name,
    modeScope: deck.mode_scope,
    cardVersionIds,
    validationHash,
    isValid: validation.valid,
    validationResult: validation
  };
});

export const deleteArenaV2DeckForUser = async (userId: string, deckId: string) => withArenaV2Transaction(async (tx) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  await lockArenaV2User(tx, userId);
  const existing = await queryGet<{ id: string; user_id: string }>(
    tx,
    'SELECT id, user_id FROM arena_v2_decks WHERE id = ? LIMIT 1',
    [deckId]
  );
  if (!existing) throw new Error('ArenaV2DeckNotFound');
  if (existing.user_id !== userId) throw new Error('ArenaV2DeckForbidden');
  await assertArenaV2DeckNotInUse(tx, deckId);
  await runSql(tx, 'DELETE FROM arena_v2_decks WHERE id = ? AND user_id = ?', [deckId, userId]);
  return { deleted: true };
});

export const createArenaV2Match = async (input: ArenaV2CreateMatchInput) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  if (input.mode !== 'bot') {
    throw new Error(input.mode === 'quick' ? 'ArenaV2UseQuickQueue' : 'ArenaV2UseBattleRoyaleQueue');
  }
  return withArenaV2Transaction(async (tx) => {
    const db = tx;
    await lockArenaV2User(tx, input.userId);
    await assertArenaV2UserAvailable(tx, input.userId);

  const deck = await queryGet<any>(
    db,
    'SELECT id, user_id, season_id, card_version_ids, is_valid FROM arena_v2_decks WHERE id = ? LIMIT 1',
    [input.deckId]
  );
  if (!deck) throw new Error('ArenaV2DeckNotFound');
  if (deck.user_id !== input.userId) throw new Error('ArenaV2DeckForbidden');
  if (!Boolean(Number(deck.is_valid))) throw new Error('ArenaV2DeckInvalid');

  const seasonId = input.seasonId || deck.season_id;
  if (seasonId !== deck.season_id) throw new Error('ArenaV2DeckSeasonMismatch');
  const season = await queryGet<any>(
    db,
    'SELECT id, card_pool_version FROM arena_v2_seasons WHERE id = ? AND status = ? LIMIT 1',
    [seasonId, 'active']
  );
  if (!season) throw new Error('ArenaV2SeasonClosed');

  const playerCardVersionIds = jsonParse<string[]>(deck.card_version_ids, []);
  const validation = await validateArenaV2DeckForSeasonWithExecutor(tx, seasonId, playerCardVersionIds);
  if (!validation.valid) throw new Error('ArenaV2DeckInvalid');

  const playerCards = await loadArenaV2CardVersionsByIds(db, playerCardVersionIds);
  const botCards = await queryAll<any>(
    db,
    `
      SELECT id, cost, attack, health
        FROM arena_v2_card_versions
       WHERE season_id = ? AND status = 'active'
       ORDER BY cost ASC, id ASC
       LIMIT 20
    `,
    [seasonId]
  );
  if (botCards.length < 14) throw new Error('ArenaV2BotDeckUnavailable');

  const matchId = makeId('arena_v2_match');
  const seed = stableHash(`chikapo-arena-v2:${matchId}:${input.userId}:${Date.now()}`);
  const playerOrder = stableShuffle(playerCards, `${seed}:player`).map((card) => ({
    instanceId: makeId('arena_v2_card'),
    card
  }));
  const botOrder = stableShuffle(botCards.slice(0, Math.max(14, Math.min(botCards.length, 20))), `${seed}:bot`).map((card) => ({
    instanceId: makeId('arena_v2_card'),
    card
  }));

  await runSql(
    db,
    `
      INSERT INTO arena_v2_matches
        (id, season_id, mode, status, battle_royale_id, round_no, turn_no, rng_seed, rules_version, card_pool_version, result_summary)
      VALUES
        (?, ?, 'bot', 'mulligan', NULL, 0, 1, ?, 'arena-v2-gdd-1.0.0', ?, ?)
    `,
    [
      matchId,
      seasonId,
      seed,
      season.card_pool_version,
      JSON.stringify({ status: 'mulligan', botDifficulty: input.botDifficulty || 'normal',
        mulliganDeadlineAt: new Date(Date.now() + ARENA_V2_TURN_PLANNING_MS).toISOString() })
    ]
  );

  await insertArenaV2MatchPlayer(db, {
    matchId,
    userId: input.userId,
    seatNo: 0,
    deckId: input.deckId,
    orderedInstances: playerOrder
  });
  await insertArenaV2MatchPlayer(db, {
    matchId,
    userId: null,
    seatNo: 1,
    deckId: null,
    orderedInstances: botOrder
  });

  for (const [seatNo, ordered] of [[0, playerOrder], [1, botOrder]] as const) {
    for (let index = 0; index < ordered.length; index += 1) {
      const item = ordered[index];
      await runSql(
        db,
        `
          INSERT INTO arena_v2_card_instances
            (id, match_id, owner_seat_no, card_version_id, zone, position, current_attack, current_health, damage_taken, status_effects, created_turn)
          VALUES
            (?, ?, ?, ?, ?, NULL, ?, ?, 0, ?, 0)
        `,
        [
          item.instanceId,
          matchId,
          seatNo,
          item.card.id,
          index < 5 ? 'hand' : 'deck',
          Number(item.card.attack || 0),
          Number(item.card.health || 1),
          JSON.stringify([])
        ]
      );
    }
  }

  return {
    matchId,
    mode: 'bot' as const,
    status: 'mulligan' as const,
    turnNo: 1,
    seed,
    self: {
      seatNo: 0,
      handCardInstanceIds: playerOrder.slice(0, 5).map((item) => item.instanceId),
      deckCount: Math.max(0, playerOrder.length - 5)
    },
    opponent: {
      seatNo: 1,
      handCount: 5,
      deckCount: Math.max(0, botOrder.length - 5),
      botDifficulty: input.botDifficulty || 'normal'
    }
  };
  });
};

// Server-authoritative quick-match ready-check implementation.
const ARENA_V2_QUICK_ACCEPT_WINDOW_MS = 10_000;
const ARENA_V2_QUICK_QUEUE_TTL_MS = 10 * 60_000;
const ARENA_V2_QUICK_INITIAL_RANGE = 100;
const ARENA_V2_QUICK_RANGE_STEP = 50;
const ARENA_V2_QUICK_RANGE_STEP_MS = 15_000;
const ARENA_V2_QUICK_MAX_MMR_GAP = 500;
const ARENA_V2_QUICK_PENALTY_DELAY_MS = 15_000;

const arenaV2QuickRangeAt = (joinedAt: unknown, nowMs = Date.now()) => {
  const joinedAtMs = Date.parse(String(joinedAt || ''));
  const elapsedMs = Number.isFinite(joinedAtMs) ? Math.max(0, nowMs - joinedAtMs) : 0;
  return Math.min(
    ARENA_V2_QUICK_MAX_MMR_GAP,
    ARENA_V2_QUICK_INITIAL_RANGE + Math.floor(elapsedMs / ARENA_V2_QUICK_RANGE_STEP_MS) * ARENA_V2_QUICK_RANGE_STEP
  );
};

const arenaV2QuickTicketSelect = `
  SELECT q.id, q.season_id, q.user_id, q.deck_id, q.mmr, q.status,
         q.search_min_mmr, q.search_max_mmr, q.proposal_id, q.accept_deadline_at,
         q.accepted_at, q.matched_match_id, q.last_transition_reason,
         q.joined_at, q.updated_at, q.expires_at
    FROM arena_v2_matchmaking_active_slots slot
    JOIN arena_v2_match_queue q ON q.id = slot.ticket_id
`;

const readArenaV2QuickActiveTicket = async (
  db: SqlExecutor,
  seasonId: string,
  userId: string,
  lock = false
) => {
  const row = await queryGet<any>(
    db,
    `${arenaV2QuickTicketSelect}
      WHERE slot.season_id = ? AND slot.user_id = ?
        AND q.status IN ('waiting', 'proposed', 'accepted', 'matched')
      LIMIT 1
      ${lock ? arenaV2ForUpdateClause() : ''}`,
    [seasonId, userId]
  );
  if (!row) {
    await runSql(db, 'DELETE FROM arena_v2_matchmaking_active_slots WHERE season_id = ? AND user_id = ?', [seasonId, userId]);
    return undefined;
  }
  if (row.status === 'matched') {
    const match = await queryGet<any>(db, 'SELECT status FROM arena_v2_matches WHERE id = ? LIMIT 1', [row.matched_match_id]);
    if (!match || ['completed', 'cancelled'].includes(String(match.status))) {
      await releaseArenaV2QuickSlot(db, row);
      return undefined;
    }
  }
  return row;
};

const getArenaV2QuickConduct = async (db: SqlExecutor, seasonId: string, userId: string) => (
  await queryGet<any>(
    db,
    `SELECT timeout_strikes, priority_penalty, last_timeout_at
       FROM arena_v2_matchmaking_conduct
      WHERE season_id = ? AND user_id = ?
      LIMIT 1`,
    [seasonId, userId]
  ) || { timeout_strikes: 0, priority_penalty: 0, last_timeout_at: null }
);

const recordArenaV2QuickConductEvent = async (
  db: SqlExecutor,
  input: { eventKey: string; seasonId: string; userId: string; eventType: 'timeout' | 'cancelled_proposal' | 'success' }
) => {
  const insertSql = getSqlDialect()
    ? `INSERT IGNORE INTO arena_v2_matchmaking_conduct_events
         (event_key, season_id, user_id, event_type)
       VALUES (?, ?, ?, ?)`
    : `INSERT OR IGNORE INTO arena_v2_matchmaking_conduct_events
         (event_key, season_id, user_id, event_type)
       VALUES (?, ?, ?, ?)`;
  const inserted = await runSql(db, insertSql, [input.eventKey, input.seasonId, input.userId, input.eventType]);
  if (affectedRows(inserted) <= 0) return false;

  const existing = await queryGet<any>(
    db,
    `SELECT timeout_strikes, priority_penalty
       FROM arena_v2_matchmaking_conduct
      WHERE season_id = ? AND user_id = ?
      LIMIT 1
      ${arenaV2ForUpdateClause()}`,
    [input.seasonId, input.userId]
  );
  const previousStrikes = Math.max(0, Number(existing?.timeout_strikes || 0));
  const timeoutStrikes = input.eventType === 'success'
    ? Math.max(0, previousStrikes - 1)
    : Math.min(20, previousStrikes + 1);
  const priorityPenalty = Math.min(10, timeoutStrikes);
  if (existing) {
    await runSql(
      db,
      `UPDATE arena_v2_matchmaking_conduct
          SET timeout_strikes = ?, priority_penalty = ?,
              last_timeout_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE season_id = ? AND user_id = ?`,
      [
        timeoutStrikes,
        priorityPenalty,
        input.eventType === 'success' ? null : new Date().toISOString(),
        input.seasonId,
        input.userId
      ]
    );
  } else {
    await runSql(
      db,
      `INSERT INTO arena_v2_matchmaking_conduct
         (season_id, user_id, timeout_strikes, priority_penalty, last_timeout_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        input.seasonId,
        input.userId,
        timeoutStrikes,
        priorityPenalty,
        input.eventType === 'success' ? null : new Date().toISOString()
      ]
    );
  }
  return true;
};

const releaseArenaV2QuickSlot = async (db: SqlExecutor, ticket: any) => {
  await runSql(
    db,
    'DELETE FROM arena_v2_matchmaking_active_slots WHERE season_id = ? AND user_id = ? AND ticket_id = ?',
    [ticket.season_id, ticket.user_id, ticket.id]
  );
};

const requeueArenaV2QuickTicket = async (
  db: SqlExecutor,
  ticket: any,
  reason: 'opponent_timeout' | 'opponent_cancelled' | 'opponent_invalid_deck',
  nowMs: number
) => {
  const range = arenaV2QuickRangeAt(ticket.joined_at, nowMs);
  await runSql(
    db,
    `UPDATE arena_v2_match_queue
        SET status = 'waiting', proposal_id = NULL, accept_deadline_at = NULL, accepted_at = NULL,
            search_min_mmr = ?, search_max_mmr = ?, last_transition_reason = ?,
            expires_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status IN ('proposed', 'accepted')`,
    [
      Number(ticket.mmr) - range,
      Number(ticket.mmr) + range,
      reason,
      new Date(nowMs + ARENA_V2_QUICK_QUEUE_TTL_MS).toISOString(),
      ticket.id
    ]
  );
};

const finalizeArenaV2QuickProposal = async (db: SqlExecutor, proposalId: string, rows: any[]) => {
  if (rows.length !== 2 || rows.some((row) => row.status !== 'accepted')) return null;
  const validRows: any[] = [];
  for (const row of rows) {
    const deck = await queryGet<any>(
      db,
      'SELECT id, user_id, season_id, card_version_ids, is_valid FROM arena_v2_decks WHERE id = ? LIMIT 1',
      [row.deck_id]
    );
    const cardVersionIds = jsonParse<string[]>(deck?.card_version_ids, []);
    const validation = deck
      && deck.user_id === row.user_id
      && deck.season_id === row.season_id
      && Boolean(Number(deck.is_valid))
      ? await validateArenaV2DeckForSeasonWithExecutor(db, row.season_id, cardVersionIds)
      : { valid: false };
    if (validation.valid) validRows.push(row);
  }
  if (validRows.length !== 2) {
    for (const row of rows) {
      if (validRows.includes(row)) {
        await requeueArenaV2QuickTicket(db, row, 'opponent_invalid_deck', Date.now());
      } else {
        await runSql(
          db,
          `UPDATE arena_v2_match_queue
              SET status = 'cancelled', last_transition_reason = 'invalid_deck', updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND proposal_id = ? AND status = 'accepted'`,
          [row.id, proposalId]
        );
        await releaseArenaV2QuickSlot(db, row);
      }
    }
    return null;
  }
  const season = await queryGet<any>(
    db,
    `SELECT id, card_pool_version
       FROM arena_v2_seasons
      WHERE id = ? AND status = 'active'
      LIMIT 1
      ${arenaV2ForUpdateClause()}`,
    [rows[0].season_id]
  );
  if (!season) throw new Error('ArenaV2SeasonClosed');
  const matchId = makeDeterministicId('arena_v2_match', `quick:${proposalId}`);
  let claimed = 0;
  for (const row of rows) {
    const result = await runSql(
      db,
      `UPDATE arena_v2_match_queue
          SET status = 'matching', matched_match_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND proposal_id = ? AND status = 'accepted'`,
      [matchId, row.id, proposalId]
    );
    claimed += affectedRows(result);
  }
  if (claimed !== 2) throw new Error('ArenaV2QuickMatchFinalizeConflict');
  await createArenaV2MatchFromDeckSeats(db, {
    matchId,
    seasonId: season.id,
    cardPoolVersion: season.card_pool_version,
    mode: 'quick',
    battleRoyaleId: null,
    roundNo: 0,
    seats: rows
      .slice()
      .sort((left, right) => String(left.id).localeCompare(String(right.id)))
      .map((row, seatNo) => ({ seatNo, userId: row.user_id, deckId: row.deck_id })),
    summary: { status: 'mulligan', queue: 'quick', proposalId }
  });
  for (const row of rows) {
    await runSql(
      db,
      `UPDATE arena_v2_match_queue
          SET status = 'matched', matched_match_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND proposal_id = ? AND status = 'matching'`,
      [matchId, row.id, proposalId]
    );
    await recordArenaV2QuickConductEvent(db, {
      eventKey: `quick:${proposalId}:success:${row.user_id}`,
      seasonId: row.season_id,
      userId: row.user_id,
      eventType: 'success'
    });
  }
  return matchId;
};

const recoverExpiredArenaV2QuickProposals = async (db: SqlExecutor, nowMs: number, limit = 64) => {
  const now = new Date(nowMs).toISOString();
  const proposals = await queryAll<any>(
    db,
    `SELECT DISTINCT proposal_id
       FROM arena_v2_match_queue
      WHERE status IN ('proposed', 'accepted')
        AND proposal_id IS NOT NULL
        AND accept_deadline_at <= ?
      ORDER BY proposal_id ASC
      LIMIT ?`,
    [now, Math.max(1, Math.min(256, limit))]
  );
  let recovered = 0;
  for (const proposal of proposals) {
    const proposalId = String(proposal.proposal_id || '');
    if (!proposalId) continue;
    const rows = await queryAll<any>(
      db,
      `SELECT * FROM arena_v2_match_queue
        WHERE proposal_id = ? AND status IN ('proposed', 'accepted')
        ORDER BY id ASC
        ${arenaV2ForUpdateClause()}`,
      [proposalId]
    );
    if (rows.length === 2 && rows.every((row) => row.status === 'accepted')) {
      await finalizeArenaV2QuickProposal(db, proposalId, rows);
      recovered += 1;
      continue;
    }
    for (const row of rows) {
      if (row.status === 'accepted') {
        await requeueArenaV2QuickTicket(db, row, 'opponent_timeout', nowMs);
        continue;
      }
      await runSql(
        db,
        `UPDATE arena_v2_match_queue
            SET status = 'accept_timeout', last_transition_reason = 'proposal_expired',
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'proposed'`,
        [row.id]
      );
      await releaseArenaV2QuickSlot(db, row);
      await recordArenaV2QuickConductEvent(db, {
        eventKey: `quick:${proposalId}:timeout:${row.user_id}`,
        seasonId: row.season_id,
        userId: row.user_id,
        eventType: 'timeout'
      });
    }
    recovered += 1;
  }
  return recovered;
};

const insertArenaV2QuickSlotIgnore = async (db: SqlExecutor, ticket: any) => {
  const sql = getSqlDialect()
    ? 'INSERT IGNORE INTO arena_v2_matchmaking_active_slots (season_id, user_id, ticket_id) VALUES (?, ?, ?)'
    : 'INSERT OR IGNORE INTO arena_v2_matchmaking_active_slots (season_id, user_id, ticket_id) VALUES (?, ?, ?)';
  await runSql(db, sql, [ticket.season_id, ticket.user_id, ticket.id]);
};

const findArenaV2QuickActiveMatchTicket = async (db: SqlExecutor, seasonId: string, userId: string, lock = false) => queryGet<any>(
  db,
  `SELECT q.*
     FROM arena_v2_match_queue q
     JOIN arena_v2_matches m ON m.id = q.matched_match_id
    WHERE q.season_id = ? AND q.user_id = ? AND q.status = 'matched'
      AND m.status NOT IN ('completed', 'cancelled')
    ORDER BY q.updated_at DESC, q.id DESC
    LIMIT 1 ${lock ? arenaV2ForUpdateClause() : ''}`,
  [seasonId, userId]
);

const repairArenaV2QuickActiveSlots = async (db: SqlExecutor) => {
  await runSql(
    db,
    `DELETE FROM arena_v2_matchmaking_active_slots
      WHERE ticket_id IN (
        SELECT q.id FROM arena_v2_match_queue q
         WHERE q.status IN ('cancelled', 'expired', 'accept_timeout', 'declined')
      )`
  );
  const rows = await queryAll<any>(
    db,
    `SELECT q.*
       FROM arena_v2_match_queue q
      WHERE (q.status IN ('waiting', 'proposed', 'accepted')
         OR (q.status = 'matched' AND EXISTS (
              SELECT 1 FROM arena_v2_matches m
               WHERE m.id = q.matched_match_id AND m.status NOT IN ('completed', 'cancelled')
            )))
        AND NOT EXISTS (
              SELECT 1
                FROM arena_v2_matchmaking_active_slots slot
                JOIN arena_v2_match_queue active_q ON active_q.id = slot.ticket_id
               WHERE slot.season_id = q.season_id AND slot.user_id = q.user_id
                 AND (active_q.status IN ('waiting', 'proposed', 'accepted')
                   OR (active_q.status = 'matched' AND EXISTS (
                        SELECT 1 FROM arena_v2_matches active_m
                         WHERE active_m.id = active_q.matched_match_id
                           AND active_m.status NOT IN ('completed', 'cancelled')
                      )))
            )
      ORDER BY q.season_id ASC, q.user_id ASC,
               CASE WHEN q.status = 'matched' THEN 0 ELSE 1 END ASC,
               q.joined_at DESC, q.id DESC
      LIMIT 512
      ${arenaV2ForUpdateClause()}`
  );
  const byUser = new Map<string, any[]>();
  for (const row of rows) {
    const key = `${row.season_id}:${row.user_id}`;
    const group = byUser.get(key) || [];
    group.push(row);
    byUser.set(key, group);
  }
  for (const group of byUser.values()) {
    const keep = group[0];
    for (const duplicate of group.slice(1)) {
      if (duplicate.status === 'matched') continue;
      await runSql(
        db,
        `UPDATE arena_v2_match_queue
            SET status = 'cancelled', last_transition_reason = 'duplicate_active_ticket', updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status IN ('waiting', 'proposed', 'accepted')`,
        [duplicate.id]
      );
    }
    await runSql(db, 'DELETE FROM arena_v2_matchmaking_active_slots WHERE season_id = ? AND user_id = ?', [keep.season_id, keep.user_id]);
    await insertArenaV2QuickSlotIgnore(db, keep);
  }
  return byUser.size;
};

const readRepairArenaV2QuickUser = async (seasonId: string, userId: string, nowMs: number) => withArenaV2Transaction(async (tx) => {
  const own = await readArenaV2QuickActiveTicket(tx, seasonId, userId, true);
  const deadlineMs = Date.parse(String(own?.accept_deadline_at || ''));
  if (!own?.proposal_id || !['proposed', 'accepted'].includes(own.status) || !Number.isFinite(deadlineMs) || deadlineMs > nowMs) return;
  const rows = await queryAll<any>(tx, `SELECT * FROM arena_v2_match_queue WHERE proposal_id = ? AND status IN ('proposed', 'accepted') ORDER BY id ASC ${arenaV2ForUpdateClause()}`, [own.proposal_id]);
  if (rows.length === 2 && rows.every((row) => row.status === 'accepted')) {
    await finalizeArenaV2QuickProposal(tx, own.proposal_id, rows);
    return;
  }
  for (const row of rows) {
    if (row.status === 'accepted') {
      await requeueArenaV2QuickTicket(tx, row, 'opponent_timeout', nowMs);
    } else {
      await runSql(tx, `UPDATE arena_v2_match_queue SET status = 'accept_timeout', last_transition_reason = 'proposal_expired', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'proposed'`, [row.id]);
      await releaseArenaV2QuickSlot(tx, row);
      await recordArenaV2QuickConductEvent(tx, {
        eventKey: `quick:${own.proposal_id}:timeout:${row.user_id}`,
        seasonId: row.season_id,
        userId: row.user_id,
        eventType: 'timeout'
      });
    }
  }
});

export const processArenaV2QuickMatchmaking = async (limit = 32) => withArenaV2Transaction(async (tx) => {
  const nowMs = Date.now();
  const repairedSlots = await repairArenaV2QuickActiveSlots(tx);
  const recovered = await recoverExpiredArenaV2QuickProposals(tx, nowMs, limit * 2);
  const waiting = await queryAll<any>(
    tx,
    `SELECT q.*,
            COALESCE((SELECT c.priority_penalty
                        FROM arena_v2_matchmaking_conduct c
                       WHERE c.season_id = q.season_id AND c.user_id = q.user_id), 0) AS priority_penalty
       FROM arena_v2_matchmaking_active_slots slot
       JOIN arena_v2_match_queue q ON q.id = slot.ticket_id
      WHERE q.status = 'waiting' AND q.expires_at >= ?
      ORDER BY priority_penalty ASC, q.joined_at ASC, q.id ASC
      LIMIT 256
      ${arenaV2ForUpdateClause()}`,
    [new Date(nowMs).toISOString()]
  );
  for (const row of waiting) {
    const range = arenaV2QuickRangeAt(row.joined_at, nowMs);
    row.search_min_mmr = Number(row.mmr) - range;
    row.search_max_mmr = Number(row.mmr) + range;
    await runSql(
      tx,
      `UPDATE arena_v2_match_queue
          SET search_min_mmr = ?, search_max_mmr = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'waiting'`,
      [row.search_min_mmr, row.search_max_mmr, row.id]
    );
  }

  let proposed = 0;
  const claimed = new Set<string>();
  for (let index = 0; index < waiting.length && proposed < limit; index += 1) {
    const left = waiting[index];
    if (claimed.has(left.id)) continue;
    const leftEligibleAt = Date.parse(String(left.joined_at))
      + Math.max(0, Number(left.priority_penalty || 0)) * ARENA_V2_QUICK_PENALTY_DELAY_MS;
    if (Number.isFinite(leftEligibleAt) && leftEligibleAt > nowMs) continue;
    const leftRange = arenaV2QuickRangeAt(left.joined_at, nowMs);
    let opponent: any = null;
    for (let candidateIndex = index + 1; candidateIndex < waiting.length; candidateIndex += 1) {
      const candidate = waiting[candidateIndex];
      if (claimed.has(candidate.id) || candidate.season_id !== left.season_id || candidate.user_id === left.user_id) continue;
      const candidateEligibleAt = Date.parse(String(candidate.joined_at))
        + Math.max(0, Number(candidate.priority_penalty || 0)) * ARENA_V2_QUICK_PENALTY_DELAY_MS;
      if (Number.isFinite(candidateEligibleAt) && candidateEligibleAt > nowMs) continue;
      const gap = Math.abs(Number(left.mmr) - Number(candidate.mmr));
      const candidateRange = arenaV2QuickRangeAt(candidate.joined_at, nowMs);
      if (gap <= ARENA_V2_QUICK_MAX_MMR_GAP && gap <= leftRange && gap <= candidateRange) {
        opponent = candidate;
        break;
      }
    }
    if (!opponent) continue;
    const proposalId = makeId('arena_v2_proposal');
    const acceptDeadlineAt = new Date(nowMs + ARENA_V2_QUICK_ACCEPT_WINDOW_MS).toISOString();
    for (const row of [left, opponent]) {
      const result = await runSql(
        tx,
        `UPDATE arena_v2_match_queue
            SET status = 'proposed', proposal_id = ?, accept_deadline_at = ?, accepted_at = NULL,
                last_transition_reason = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'waiting'`,
        [proposalId, acceptDeadlineAt, row.id]
      );
      if (affectedRows(result) <= 0) throw new Error('ArenaV2QuickProposalClaimConflict');
      claimed.add(row.id);
    }
    proposed += 1;
  }
  return { recovered, proposed, scanned: waiting.length, repairedSlots, serverNow: new Date(nowMs).toISOString() };
});

const serializeArenaV2QuickReadyTicket = async (db: SqlExecutor, row: any, nowMs = Date.now()) => {
  const conduct = await getArenaV2QuickConduct(db, row.season_id, row.user_id);
  const currentSearchRange = arenaV2QuickRangeAt(row.joined_at, nowMs);
  let opponentAccepted = false;
  if (row.proposal_id && ['proposed', 'accepted'].includes(row.status)) {
    const opponent = await queryGet<any>(
      db,
      `SELECT status FROM arena_v2_match_queue
        WHERE proposal_id = ? AND id <> ? AND status IN ('proposed', 'accepted')
        LIMIT 1`,
      [row.proposal_id, row.id]
    );
    opponentAccepted = opponent?.status === 'accepted';
  }
  return {
    id: row.id,
    seasonId: row.season_id,
    userId: row.user_id,
    deckId: row.deck_id,
    mmr: Number(row.mmr || 1000),
    status: row.status,
    searchMinMmr: Number(row.mmr) - currentSearchRange,
    searchMaxMmr: Number(row.mmr) + currentSearchRange,
    currentSearchRange,
    currentMmrRange: { minMmr: Number(row.mmr) - currentSearchRange, maxMmr: Number(row.mmr) + currentSearchRange },
    proposalId: row.proposal_id || null,
    acceptDeadlineAt: row.accept_deadline_at || null,
    acceptedAt: row.accepted_at || null,
    acceptedBySelf: row.status === 'accepted',
    opponentAccepted,
    requiresAcceptance: row.status === 'proposed',
    matchedMatchId: row.matched_match_id || null,
    joinedAt: row.joined_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    priorityPenalty: Number(conduct.priority_penalty || 0),
    timeoutStrikes: Number(conduct.timeout_strikes || 0),
    transitionReason: row.last_transition_reason || null
  };
};

const arenaV2QuickResponse = async (db: SqlExecutor, row: any | undefined, nowMs = Date.now()) => {
  const serverNow = new Date(nowMs).toISOString();
  if (!row) return { status: 'none' as const, serverNow, ticket: null };
  const ticket = await serializeArenaV2QuickReadyTicket(db, row, nowMs);
  return {
    status: ticket.status,
    serverNow,
    queueId: ticket.id,
    joinedAt: ticket.joinedAt,
    acceptDeadlineAt: ticket.acceptDeadlineAt,
    proposalId: ticket.proposalId,
    acceptedBySelf: ticket.acceptedBySelf,
    opponentAccepted: ticket.opponentAccepted,
    requiresAcceptance: ticket.requiresAcceptance,
    transitionReason: ticket.transitionReason,
    estimatedRange: { minMmr: ticket.searchMinMmr, maxMmr: ticket.searchMaxMmr },
    matchId: ticket.matchedMatchId,
    ticket
  };
};

const joinArenaV2QuickReadyQueue = async (input: ArenaV2JoinQueueInput) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const deck = await withArenaV2Transaction(async (tx) => {
    await lockArenaV2User(tx, input.userId);
    const lockedDeck = await loadValidArenaV2DeckForUse(tx, input.userId, input.deckId, input.seasonId);
    await expireArenaV2QueueRows(tx, lockedDeck.seasonId, input.userId);
    let existing = await readArenaV2QuickActiveTicket(tx, lockedDeck.seasonId, input.userId, true);
    if (!existing) {
      const activeMatchTicket = await findArenaV2QuickActiveMatchTicket(tx, lockedDeck.seasonId, input.userId, true);
      if (activeMatchTicket) {
        await insertArenaV2QuickSlotIgnore(tx, activeMatchTicket);
        return lockedDeck;
      }
      existing = await queryGet<any>(
        tx,
        `SELECT * FROM arena_v2_match_queue
          WHERE season_id = ? AND user_id = ? AND status IN ('waiting', 'proposed', 'accepted')
          ORDER BY joined_at DESC LIMIT 1 ${arenaV2ForUpdateClause()}`,
        [lockedDeck.seasonId, input.userId]
      );
      if (existing) {
        const slotSql = getSqlDialect()
          ? 'INSERT IGNORE INTO arena_v2_matchmaking_active_slots (season_id, user_id, ticket_id) VALUES (?, ?, ?)'
          : 'INSERT OR IGNORE INTO arena_v2_matchmaking_active_slots (season_id, user_id, ticket_id) VALUES (?, ?, ?)';
        await runSql(tx, slotSql, [lockedDeck.seasonId, input.userId, existing.id]);
        return lockedDeck;
      }
      await assertArenaV2UserAvailable(tx, input.userId);
      const rating = await queryGet<any>(
        tx,
        'SELECT mmr FROM arena_v2_ratings WHERE season_id = ? AND user_id = ? LIMIT 1',
        [lockedDeck.seasonId, input.userId]
      );
      const mmr = Number.isFinite(Number(rating?.mmr)) ? Number(rating.mmr) : 1000;
      const ticketId = makeId('arena_v2_queue');
      const expiresAt = new Date(Date.now() + ARENA_V2_QUICK_QUEUE_TTL_MS).toISOString();
      await runSql(
        tx,
        `INSERT INTO arena_v2_match_queue
           (id, season_id, user_id, deck_id, mmr, status, search_min_mmr, search_max_mmr, expires_at)
         VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?, ?)`,
        [ticketId, lockedDeck.seasonId, input.userId, input.deckId, mmr, mmr - ARENA_V2_QUICK_INITIAL_RANGE, mmr + ARENA_V2_QUICK_INITIAL_RANGE, expiresAt]
      );
      await runSql(
        tx,
        'INSERT INTO arena_v2_matchmaking_active_slots (season_id, user_id, ticket_id) VALUES (?, ?, ?)',
        [lockedDeck.seasonId, input.userId, ticketId]
      );
    }
    return lockedDeck;
  });
  await processArenaV2QuickMatchmaking(32);
  const nowMs = Date.now();
  const row = await readArenaV2QuickActiveTicket(db, deck.seasonId, input.userId);
  if (!row) throw new Error('ArenaV2QuickQueueStateLost');
  return arenaV2QuickResponse(db, row, nowMs);
};

const getArenaV2QuickReadyStatus = async (userId: string, seasonId?: string) => {
  const db = getExecutor();
  const nowMs = Date.now();
  if (!db) return { status: 'none' as const, serverNow: new Date(nowMs).toISOString(), ticket: null };
  const season = seasonId ? { id: seasonId } : await getArenaV2CurrentSeason();
  if (!season?.id) return { status: 'none' as const, serverNow: new Date(nowMs).toISOString(), ticket: null };
  await readRepairArenaV2QuickUser(season.id, userId, nowMs);
  let active = await readArenaV2QuickActiveTicket(db, season.id, userId);
  if (!active) {
    const activeMatchTicket = await findArenaV2QuickActiveMatchTicket(db, season.id, userId);
    if (activeMatchTicket) {
      await insertArenaV2QuickSlotIgnore(db, activeMatchTicket);
      active = activeMatchTicket;
    }
  }
  if (active) return arenaV2QuickResponse(db, active, nowMs);
  const latest = await queryGet<any>(
    db,
    `SELECT * FROM arena_v2_match_queue
      WHERE season_id = ? AND user_id = ?
        AND (status IN ('accept_timeout', 'declined') OR (status = 'cancelled' AND last_transition_reason = 'invalid_deck'))
      ORDER BY updated_at DESC LIMIT 1`,
    [season.id, userId]
  );
  const updatedAtMs = Date.parse(String(latest?.updated_at || ''));
  return latest && Number.isFinite(updatedAtMs) && nowMs - updatedAtMs <= 15_000
    ? arenaV2QuickResponse(db, latest, nowMs)
    : arenaV2QuickResponse(db, undefined, nowMs);
};

export const acceptArenaV2QuickQueue = async (userId: string, seasonId: string | undefined, proposalId: string) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const season = seasonId ? { id: seasonId } : await getArenaV2CurrentSeason();
  if (!season?.id) throw new Error('ArenaV2SeasonClosed');
  return withArenaV2Transaction(async (tx) => {
    const nowMs = Date.now();
    await recoverExpiredArenaV2QuickProposals(tx, nowMs, 64);
    let own = await readArenaV2QuickActiveTicket(tx, season.id, userId, true);
    if (!own) {
      const terminal = await queryGet<any>(
        tx,
        `SELECT * FROM arena_v2_match_queue
          WHERE season_id = ? AND user_id = ? AND proposal_id = ?
            AND status IN ('matched', 'accept_timeout', 'declined')
          ORDER BY updated_at DESC LIMIT 1`,
        [season.id, userId, proposalId]
      );
      if (terminal) return arenaV2QuickResponse(tx, terminal, nowMs);
      throw new Error('ArenaV2QuickProposalStale');
    }
    if (!proposalId || own.proposal_id !== proposalId || !['proposed', 'accepted'].includes(own.status)) {
      throw new Error('ArenaV2QuickProposalStale');
    }
    if (own.status === 'proposed') {
      const deadlineMs = Date.parse(String(own.accept_deadline_at || ''));
      if (!Number.isFinite(deadlineMs) || deadlineMs <= nowMs) {
        await recoverExpiredArenaV2QuickProposals(tx, nowMs, 64);
        own = await readArenaV2QuickActiveTicket(tx, season.id, userId, true);
        return arenaV2QuickResponse(tx, own, nowMs);
      }
      await runSql(
        tx,
        `UPDATE arena_v2_match_queue SET status = 'accepted', accepted_at = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'proposed' AND accept_deadline_at > ?`,
        [new Date(nowMs).toISOString(), own.id, new Date(nowMs).toISOString()]
      );
      own.status = 'accepted';
      own.accepted_at = new Date(nowMs).toISOString();
    }
    if (own.status === 'accepted' && own.proposal_id) {
      const rows = await queryAll<any>(
        tx,
        `SELECT * FROM arena_v2_match_queue WHERE proposal_id = ? AND status IN ('proposed', 'accepted') ORDER BY id ASC ${arenaV2ForUpdateClause()}`,
        [own.proposal_id]
      );
      if (rows.length === 2 && rows.every((row) => row.status === 'accepted')) {
        await finalizeArenaV2QuickProposal(tx, own.proposal_id, rows);
        own = await queryGet<any>(tx, 'SELECT * FROM arena_v2_match_queue WHERE id = ? LIMIT 1', [own.id]);
      }
    }
    return arenaV2QuickResponse(tx, own, nowMs);
  });
};

const cancelArenaV2QuickReadyQueue = async (userId: string, seasonId?: string) => {
  const db = getExecutor();
  const nowMs = Date.now();
  if (!db) return { cancelled: false, serverNow: new Date(nowMs).toISOString() };
  const season = seasonId ? { id: seasonId } : await getArenaV2CurrentSeason();
  if (!season?.id) return { cancelled: false, serverNow: new Date(nowMs).toISOString() };
  return withArenaV2Transaction(async (tx) => {
    await recoverExpiredArenaV2QuickProposals(tx, nowMs, 64);
    const own = await readArenaV2QuickActiveTicket(tx, season.id, userId, true);
    if (!own) return { cancelled: false, serverNow: new Date(nowMs).toISOString() };
    if (own.status === 'matched') return { cancelled: false, status: 'matched' as const, matchId: own.matched_match_id, serverNow: new Date(nowMs).toISOString() };
    if (['proposed', 'accepted'].includes(own.status) && own.proposal_id) {
      const rows = await queryAll<any>(tx, `SELECT * FROM arena_v2_match_queue WHERE proposal_id = ? AND status IN ('proposed', 'accepted') ORDER BY id ASC ${arenaV2ForUpdateClause()}`, [own.proposal_id]);
      for (const row of rows) {
        if (row.id === own.id) continue;
        await requeueArenaV2QuickTicket(tx, row, 'opponent_cancelled', nowMs);
      }
      await runSql(tx, `UPDATE arena_v2_match_queue SET status = 'declined', last_transition_reason = 'cancelled_proposal', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('proposed', 'accepted')`, [own.id]);
      await recordArenaV2QuickConductEvent(tx, {
        eventKey: `quick:${own.proposal_id}:cancel:${userId}`,
        seasonId: season.id,
        userId,
        eventType: 'cancelled_proposal'
      });
    } else {
      await runSql(tx, `UPDATE arena_v2_match_queue SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'waiting'`, [own.id]);
    }
    await releaseArenaV2QuickSlot(tx, own);
    return { cancelled: true, status: own.status === 'waiting' ? 'cancelled' as const : 'declined' as const, serverNow: new Date(nowMs).toISOString() };
  });
};
export const joinArenaV2QuickQueue = joinArenaV2QuickReadyQueue;
export const getArenaV2QuickQueueStatus = getArenaV2QuickReadyStatus;
export const cancelArenaV2QuickQueue = cancelArenaV2QuickReadyQueue;

const tryFormArenaV2BattleRoyale = async (seasonId: string): Promise<string | null> => withArenaV2Transaction(async (tx) => {
  const now = new Date().toISOString();
  const waitingTickets = await queryAll<any>(
    tx,
    `
      SELECT id, season_id, user_id, deck_id, status, battle_royale_id, joined_at, updated_at, expires_at
        FROM arena_v2_battle_royale_queue
       WHERE season_id = ? AND status = 'waiting' AND expires_at >= ?
       ORDER BY joined_at ASC, id ASC
       LIMIT 64
       ${arenaV2ForUpdateClause()}
    `,
    [seasonId, now]
  );
  const entrants: any[] = [];
  const entrantUserIds = new Set<string>();
  for (const ticket of waitingTickets) {
    const userId = String(ticket.user_id);
    if (entrantUserIds.has(userId)) continue;
    entrantUserIds.add(userId);
    entrants.push(ticket);
    if (entrants.length === 8) break;
  }
  if (entrants.length < 8) return null;
  const entrantIds = entrants.map((ticket) => String(ticket.id));
  const battleRoyaleId = makeDeterministicId('arena_v2_br', `${seasonId}:${entrantIds.join(':')}`);
  const season = await queryGet<any>(
    tx,
    `SELECT id, card_pool_version FROM arena_v2_seasons WHERE id = ? AND status = 'active' LIMIT 1 ${arenaV2ForUpdateClause()}`,
    [seasonId]
  );
  if (!season) throw new Error('ArenaV2SeasonClosed');

  const deckIds = [...new Set(entrants.map((ticket) => String(ticket.deck_id)))].sort();
  const deckPlaceholders = deckIds.map(() => '?').join(', ');
  const deckRows = await queryAll<any>(
    tx,
    `
      SELECT id, user_id, season_id, card_version_ids, is_valid
        FROM arena_v2_decks
       WHERE id IN (${deckPlaceholders})
       ORDER BY id ASC
       ${arenaV2ForUpdateClause()}
    `,
    deckIds
  );
  const deckById = new Map(deckRows.map((deck) => [String(deck.id), deck]));
  const initialParticipants: ArenaV2BattleRoyaleParticipantState[] = [];
  for (let index = 0; index < entrants.length; index += 1) {
    const ticket = entrants[index];
    const deck = deckById.get(String(ticket.deck_id));
    if (!deck) throw new Error('ArenaV2DeckNotFound');
    if (String(deck.user_id) !== String(ticket.user_id)) throw new Error('ArenaV2DeckForbidden');
    if (String(deck.season_id) !== seasonId) throw new Error('ArenaV2DeckSeasonMismatch');
    if (!Boolean(Number(deck.is_valid))) throw new Error('ArenaV2DeckInvalid');
    const frozenCardVersionIds = jsonParse<string[]>(deck.card_version_ids, []);
    const validation = await validateArenaV2DeckForSeasonWithExecutor(tx, seasonId, frozenCardVersionIds);
    if (!validation.valid) throw new Error('ArenaV2DeckInvalid');
    initialParticipants.push(normalizeArenaV2BattleRoyaleParticipant({
      seedNo: index + 1,
      userId: String(ticket.user_id),
      deckId: String(ticket.deck_id),
      status: 'active',
      roundStatus: 'paired',
      health: 30,
      currentRoundNo: 0,
      finalRank: null,
      currentMatchId: null,
      nextMatchId: null,
      stateSourceMatchId: null,
      lastOpponentUserId: null,
      lastByeRoundNo: null,
      byeCount: 0,
      wins: 0,
      lossStreak: 0,
      directDamageDealt: 0,
      freeTacticalMoveNextRound: false,
      frozenCardVersionIds,
      frozenCardPoolVersion: String(season.card_pool_version),
      validationHash: stableHash(JSON.stringify({ seasonId, cardPoolVersion: season.card_pool_version, frozenCardVersionIds })),
      tieBreaker: stableHash(`${battleRoyaleId}:${index + 1}:${ticket.user_id}`)
    }, battleRoyaleId));
  }

  const schedule = scheduleArenaV2BattleRoyaleRound(initialParticipants, 1);
  const participantByUserId = new Map(schedule.participants.map((participant) => [participant.userId, participant]));
  const matches = schedule.pairings.map((pairing) => {
    const users = [pairing.leftUserId, pairing.rightUserId].sort();
    const matchId = makeDeterministicId('arena_v2_match', `${battleRoyaleId}:1:${users.join(':')}`);
    for (const userId of users) {
      const participant = participantByUserId.get(userId);
      if (!participant) throw new Error('ArenaV2BattleRoyaleParticipantMissing');
      participant.currentMatchId = matchId;
      participant.nextMatchId = matchId;
    }
    return { matchId, users };
  });
  const matchIds = matches.map((match) => match.matchId);
  const ticketPlaceholders = entrantIds.map(() => '?').join(', ');
  const claimed = await runSql(
    tx,
    `
      UPDATE arena_v2_battle_royale_queue
         SET status = 'matched', battle_royale_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id IN (${ticketPlaceholders}) AND status = 'waiting'
    `,
    [battleRoyaleId, ...entrantIds]
  );
  if (affectedRows(claimed) !== 8) throw new Error('ArenaV2BattleRoyaleQueueClaimConflict');
  await runSql(
    tx,
    `
      INSERT INTO arena_v2_battle_royales
        (id, season_id, status, current_round_no, participant_state, match_ids, winner_user_id)
      VALUES
        (?, ?, 'active', 1, ?, ?, NULL)
    `,
    [battleRoyaleId, seasonId, JSON.stringify(schedule.participants), JSON.stringify(matchIds)]
  );
  for (const match of matches) {
    const seats = match.users.map((userId, seatNo) => {
      const participant = participantByUserId.get(userId)!;
      return {
        seatNo,
        userId,
        deckId: participant.deckId,
        playerHealth: participant.health,
        frozenCardVersionIds: participant.frozenCardVersionIds
      };
    });
    await createArenaV2MatchFromDeckSeats(tx, {
      matchId: match.matchId,
      seasonId,
      cardPoolVersion: String(season.card_pool_version),
      mode: 'battle_royale_8',
      battleRoyaleId,
      roundNo: 1,
      seats,
      summary: { status: 'mulligan', queue: 'battle_royale_8', battleRoyaleId, roundNo: 1 }
    });
  }
  const sharedMulliganDeadlineAt = new Date(Date.now() + ARENA_V2_TURN_PLANNING_MS).toISOString();
  for (const match of matches) {
    await runSql(
      tx,
      `
        UPDATE arena_v2_matches
           SET result_summary = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'mulligan'
      `,
      [
        JSON.stringify({
          status: 'mulligan', queue: 'battle_royale_8', battleRoyaleId, roundNo: 1,
          mulliganDeadlineAt: sharedMulliganDeadlineAt
        }),
        match.matchId
      ]
    );
  }
  return battleRoyaleId;
});

export const joinArenaV2BattleRoyaleQueue = async (input: ArenaV2JoinQueueInput) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const queued = await withArenaV2Transaction(async (tx) => {
    // The user row is the cross-dialect mutex for the partial-unique waiting-ticket invariant.
    await lockArenaV2User(tx, input.userId);
    const deck = await loadValidArenaV2DeckForUse(tx, input.userId, input.deckId, input.seasonId);
    await expireArenaV2QueueRows(tx, deck.seasonId, input.userId);
    const existing = await queryGet<any>(
      tx,
      `
        SELECT q.id, q.season_id, q.user_id, q.deck_id, q.status, q.battle_royale_id, q.joined_at, q.updated_at, q.expires_at
          FROM arena_v2_battle_royale_queue q
         WHERE q.season_id = ? AND q.user_id = ?
           AND (q.status = 'waiting' OR (q.status = 'matched' AND EXISTS (
             SELECT 1 FROM arena_v2_battle_royales br
              WHERE br.id = q.battle_royale_id AND br.status = 'active'
           )))
         ORDER BY q.joined_at DESC
         LIMIT 1
         ${arenaV2ForUpdateClause()}
      `,
      [deck.seasonId, input.userId]
    );
    if (existing) return { ticket: existing, seasonId: deck.seasonId };

    await assertArenaV2UserAvailable(tx, input.userId);

    const ticketId = makeId('arena_v2_br_queue');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await runSql(
      tx,
      `
        INSERT INTO arena_v2_battle_royale_queue
          (id, season_id, user_id, deck_id, status, expires_at)
        VALUES
          (?, ?, ?, ?, 'waiting', ?)
      `,
      [ticketId, deck.seasonId, input.userId, input.deckId, expiresAt]
    );
    const now = new Date().toISOString();
    return { seasonId: deck.seasonId, ticket: {
      id: ticketId,
      season_id: deck.seasonId,
      user_id: input.userId,
      deck_id: input.deckId,
      status: 'waiting',
      battle_royale_id: null,
      joined_at: now,
      updated_at: now,
      expires_at: expiresAt
    } };
  });
  await tryFormArenaV2BattleRoyale(queued.seasonId);
  const storedTicket = await queryGet<any>(
    db,
    `
      SELECT id, season_id, user_id, deck_id, status, battle_royale_id, joined_at, updated_at, expires_at
        FROM arena_v2_battle_royale_queue
       WHERE id = ?
       LIMIT 1
    `,
    [queued.ticket.id]
  );
  return serializeArenaV2BattleRoyaleQueue(storedTicket || queued.ticket);
};

export const getArenaV2BattleRoyaleQueueStatus = async (userId: string, seasonId?: string) => {
  const db = getExecutor();
  if (!db) return { status: 'none' as const, ticket: null };
  const season = seasonId ? { id: seasonId } : await getArenaV2CurrentSeason();
  if (!season?.id) return { status: 'none' as const, ticket: null };
  await expireArenaV2QueueRows(db, season.id, userId);
  const row = await queryGet<any>(
    db,
    `
      SELECT id, season_id, user_id, deck_id, status, battle_royale_id, joined_at, updated_at, expires_at
        FROM arena_v2_battle_royale_queue
       WHERE season_id = ? AND user_id = ? AND status IN ('waiting', 'matched')
       ORDER BY joined_at DESC
       LIMIT 1
    `,
    [season.id, userId]
  );
  if (!row) return { status: 'none' as const, ticket: null };
  const ticket = serializeArenaV2BattleRoyaleQueue(row);
  const participantCount = row.status === 'matched'
    ? 8
    : await countArenaV2BattleRoyaleQueueParticipants(db, season.id);
  return {
    status: row.status,
    queueId: ticket.id,
    joinedAt: ticket.joinedAt,
    participantCount,
    battleRoyaleId: ticket.battleRoyaleId,
    ticket
  };
};

export const cancelArenaV2BattleRoyaleQueue = async (userId: string, seasonId?: string) => {
  const db = getExecutor();
  if (!db) return { cancelled: false };
  const season = seasonId ? { id: seasonId } : await getArenaV2CurrentSeason();
  if (!season?.id) return { cancelled: false };
  await expireArenaV2QueueRows(db, season.id, userId);
  const matched = await queryGet<any>(
    db,
    `
      SELECT id, battle_royale_id
        FROM arena_v2_battle_royale_queue
       WHERE season_id = ? AND user_id = ? AND status = 'matched'
       ORDER BY updated_at DESC
       LIMIT 1
    `,
    [season.id, userId]
  );
  if (matched) return { cancelled: false, status: 'matched' as const, battleRoyaleId: matched.battle_royale_id };
  await runSql(
    db,
    `
      UPDATE arena_v2_battle_royale_queue
         SET status = 'cancelled',
             updated_at = CURRENT_TIMESTAMP
       WHERE season_id = ? AND user_id = ? AND status = 'waiting'
    `,
    [season.id, userId]
  );
  return { cancelled: true };
};

const expireArenaV2QueueRows = async (db: SqlExecutor, seasonId?: string, userId?: string) => {
  const now = new Date().toISOString();
  const scopedQuickWhere = [
    "status = 'waiting'",
    'expires_at < ?',
    seasonId ? 'season_id = ?' : '',
    userId ? 'user_id = ?' : ''
  ].filter(Boolean).join(' AND ');
  const scopedParams = [now, ...(seasonId ? [seasonId] : []), ...(userId ? [userId] : [])];
  await runSql(
    db,
    `
      UPDATE arena_v2_match_queue
         SET status = 'expired',
             updated_at = CURRENT_TIMESTAMP
       WHERE ${scopedQuickWhere}
    `,
    scopedParams
  );
  await runSql(
    db,
    `DELETE FROM arena_v2_matchmaking_active_slots
      WHERE ticket_id IN (
        SELECT id FROM arena_v2_match_queue WHERE status IN ('cancelled', 'expired', 'accept_timeout', 'declined')
      )`
  );
  await runSql(
    db,
    `
      UPDATE arena_v2_battle_royale_queue
         SET status = 'expired',
             updated_at = CURRENT_TIMESTAMP
       WHERE ${scopedQuickWhere}
    `,
    scopedParams
  );
};

const countArenaV2BattleRoyaleQueueParticipants = async (db: SqlExecutor, seasonId: string) => {
  const row = await queryGet<{ count: number; c?: number }>(
    db,
    `
      SELECT COUNT(*) AS count
        FROM arena_v2_battle_royale_queue
       WHERE season_id = ? AND status = 'waiting' AND expires_at >= ?
    `,
    [seasonId, new Date().toISOString()]
  );
  return Number(row?.count ?? row?.c ?? 0);
};

export const processArenaV2ExpiredQueues = async () => {
  const db = getExecutor();
  if (!db) return { quickExpired: 0, battleRoyaleExpired: 0 };
  const now = new Date().toISOString();
  const quick = await runSql(
    db,
    `
      UPDATE arena_v2_match_queue
         SET status = 'expired',
             updated_at = CURRENT_TIMESTAMP
       WHERE status = 'waiting' AND expires_at < ?
    `,
    [now]
  );
  await runSql(
    db,
    `DELETE FROM arena_v2_matchmaking_active_slots
      WHERE ticket_id IN (
        SELECT id FROM arena_v2_match_queue WHERE status IN ('cancelled', 'expired', 'accept_timeout', 'declined')
      )`
  );
  const battleRoyale = await runSql(
    db,
    `
      UPDATE arena_v2_battle_royale_queue
         SET status = 'expired',
             updated_at = CURRENT_TIMESTAMP
       WHERE status = 'waiting' AND expires_at < ?
    `,
    [now]
  );
  return {
    quickExpired: Number(quick?.changes ?? quick?.affectedRows ?? 0),
    battleRoyaleExpired: Number(battleRoyale?.changes ?? battleRoyale?.affectedRows ?? 0)
  };
};

const loadValidArenaV2DeckForUse = async (db: SqlExecutor, userId: string, deckId: string, seasonId?: string) => {
  const deck = await queryGet<any>(
    db,
    'SELECT id, user_id, season_id, card_version_ids, is_valid FROM arena_v2_decks WHERE id = ? LIMIT 1',
    [deckId]
  );
  if (!deck) throw new Error('ArenaV2DeckNotFound');
  if (deck.user_id !== userId) throw new Error('ArenaV2DeckForbidden');
  if (!Boolean(Number(deck.is_valid))) throw new Error('ArenaV2DeckInvalid');
  if (seasonId && deck.season_id !== seasonId) throw new Error('ArenaV2DeckSeasonMismatch');
  const season = await queryGet<any>(
    db,
    'SELECT id, card_pool_version FROM arena_v2_seasons WHERE id = ? AND status = ? LIMIT 1',
    [deck.season_id, 'active']
  );
  if (!season) throw new Error('ArenaV2SeasonClosed');
  const cardVersionIds = jsonParse<string[]>(deck.card_version_ids, []);
  const validation = await validateArenaV2DeckForSeasonWithExecutor(db, deck.season_id, cardVersionIds);
  if (!validation.valid) throw new Error('ArenaV2DeckInvalid');
  return { deck, season, seasonId: deck.season_id };
};

const serializeArenaV2QuickQueue = (row: any) => ({
  id: row.id,
  seasonId: row.season_id,
  userId: row.user_id,
  deckId: row.deck_id,
  mmr: Number(row.mmr || 1000),
  status: row.status,
  searchMinMmr: Number(row.search_min_mmr || 0),
  searchMaxMmr: Number(row.search_max_mmr || 0),
  matchedMatchId: row.matched_match_id,
  joinedAt: row.joined_at,
  updatedAt: row.updated_at,
  expiresAt: row.expires_at
});

const serializeArenaV2BattleRoyaleQueue = (row: any) => ({
  id: row.id,
  seasonId: row.season_id,
  userId: row.user_id,
  deckId: row.deck_id,
  status: row.status,
  battleRoyaleId: row.battle_royale_id,
  joinedAt: row.joined_at,
  updatedAt: row.updated_at,
  expiresAt: row.expires_at
});

const battleRoyaleParticipantUserId = (participant: ArenaV2BattleRoyaleParticipant): string | null => {
  const value = participant.userId ?? participant.user_id;
  return typeof value === 'string' && value ? value : null;
};

const battleRoyaleParticipantMatchId = (
  participant: ArenaV2BattleRoyaleParticipant,
  key: 'current' | 'next'
): string | null => {
  const value = key === 'current'
    ? participant.currentMatchId ?? participant.current_match_id
    : participant.nextMatchId ?? participant.next_match_id;
  return typeof value === 'string' && value ? value : null;
};

const loadArenaV2BattleRoyaleSnapshot = async (
  db: SqlExecutor,
  battleRoyaleId: string,
  userId?: string | null
) => {
  const row = await queryGet<any>(
    db,
    `
      SELECT id, season_id, status, current_round_no, participant_state, match_ids, winner_user_id, created_at, updated_at, finished_at
        FROM arena_v2_battle_royales
       WHERE id = ?
       LIMIT 1
    `,
    [battleRoyaleId]
  );
  if (!row?.id) return null;

  const participantState = jsonParse<ArenaV2BattleRoyaleParticipant[]>(row.participant_state, []);
  const viewerParticipant = userId
    ? participantState.find((participant) => battleRoyaleParticipantUserId(participant) === userId)
    : undefined;
  if (userId && !viewerParticipant) return null;

  const matchRows = await queryAll<any>(
    db,
    `
      SELECT id, status, round_no, turn_no, winner_user_id, finished_at, result_summary
        FROM arena_v2_matches
       WHERE battle_royale_id = ?
       ORDER BY round_no ASC, created_at ASC, id ASC
    `,
    [battleRoyaleId]
  );
  const publicMatches: Array<Record<string, unknown> & { participantUserIds: string[] }> = [];
  const finalRankByUserId = new Map<string, number>();
  for (const match of matchRows) {
    const matchPlayers = await queryAll<any>(
      db,
      `
        SELECT seat_no, user_id, final_rank
          FROM arena_v2_match_players
         WHERE match_id = ?
         ORDER BY seat_no ASC
      `,
      [match.id]
    );
    for (const player of matchPlayers) {
      const finalRank = parseNullableRank(player.final_rank);
      if (player.user_id && finalRank != null) finalRankByUserId.set(String(player.user_id), finalRank);
    }
    publicMatches.push({
      id: match.id,
      status: match.status,
      roundNo: Number(match.round_no || 0),
      turnNo: Number(match.turn_no || 1),
      winnerUserId: match.winner_user_id || null,
      finishedAt: match.finished_at || null,
      participantUserIds: matchPlayers
        .map((player) => typeof player.user_id === 'string' ? player.user_id : null)
        .filter((value): value is string => Boolean(value)),
      players: matchPlayers.map((player) => ({
        seatNo: Number(player.seat_no),
        userId: player.user_id || null,
        finalRank: parseNullableRank(player.final_rank)
      }))
    });
  }

  const storedMatchIds = jsonParse<string[]>(row.match_ids, []);
  const discoveredMatchIds = publicMatches.map((match) => String(match.id));
  const matchIds = [...new Set([...storedMatchIds, ...discoveredMatchIds])];
  const ongoingStatuses = new Set(['created', 'mulligan', 'turn_planning', 'action_locked', 'combat_resolving', 'turn_result']);
  const spectatableMatchIds = publicMatches
    .filter((match) => ongoingStatuses.has(String(match.status)))
    .map((match) => String(match.id));

  const publicParticipantState = participantState.map((participant) => {
    const participantUserId = battleRoyaleParticipantUserId(participant);
    const status = typeof participant.status === 'string' ? participant.status : 'active';
    return {
      seedNo: Number(participant.seedNo ?? participant.seed_no ?? 0),
      userId: participantUserId,
      status,
      roundStatus: String(participant.roundStatus ?? participant.round_status ?? 'paired'),
      health: Math.max(0, Number(participant.health ?? participant.playerHealth ?? participant.player_health ?? 30)),
      alive: status !== 'eliminated',
      currentRoundNo: Number(participant.currentRoundNo ?? participant.current_round_no ?? 0),
      finalRank: parseNullableRank(participant.finalRank ?? participant.final_rank)
        ?? (participantUserId ? finalRankByUserId.get(participantUserId) ?? null : null),
      lastOpponentUserId: participant.lastOpponentUserId ?? participant.last_opponent_user_id ?? null,
      lastByeRoundNo: parseNullableRank(participant.lastByeRoundNo ?? participant.last_bye_round_no),
      byeCount: Math.max(0, Number(participant.byeCount ?? participant.bye_count ?? 0)),
      currentMatchId: battleRoyaleParticipantMatchId(participant, 'current'),
      nextMatchId: battleRoyaleParticipantMatchId(participant, 'next')
    };
  });

  const viewerMatches = userId
    ? publicMatches.filter((match) => match.participantUserIds.includes(userId))
    : [];
  const activeViewerMatch = [...viewerMatches]
    .reverse()
    .find((match) => ongoingStatuses.has(String(match.status)));
  const latestViewerMatch = [...viewerMatches]
    .sort((left, right) => Number(right.roundNo) - Number(left.roundNo))[0];
  const viewerPlacement = viewerParticipant
    ? parseNullableRank(viewerParticipant.finalRank ?? viewerParticipant.final_rank)
      ?? (userId ? finalRankByUserId.get(userId) ?? null : null)
    : null;
  const placementCount = viewerPlacement == null
    ? 0
    : publicParticipantState.filter((participant) => participant.finalRank === viewerPlacement).length;
  const configuredNextMatchId = viewerParticipant
    ? battleRoyaleParticipantMatchId(viewerParticipant, 'next')
    : null;
  const configuredNextMatch = configuredNextMatchId
    ? publicMatches.find((match) => String(match.id) === configuredNextMatchId)
    : null;
  const nextMatchId = configuredNextMatch && ongoingStatuses.has(String(configuredNextMatch.status)) ? configuredNextMatchId : null;
  const configuredCurrentMatchId = viewerParticipant
    ? battleRoyaleParticipantMatchId(viewerParticipant, 'current')
    : null;
  const currentMatchId = configuredCurrentMatchId && matchIds.includes(configuredCurrentMatchId)
    ? configuredCurrentMatchId
    : activeViewerMatch ? String(activeViewerMatch.id) : latestViewerMatch ? String(latestViewerMatch.id) : null;
  const participantStatus = String(viewerParticipant?.status || '').toLowerCase();
  const viewerFinishedCurrentMatch = latestViewerMatch?.status === 'completed'
    || participantStatus === 'eliminated'
    || participantStatus === 'completed';
  const canSpectate = Boolean(userId && viewerFinishedCurrentMatch && spectatableMatchIds.some((matchId) => {
    const candidate = publicMatches.find((match) => match.id === matchId);
    return candidate && !candidate.participantUserIds.includes(userId);
  }));

  let outcome: ArenaV2ViewerResultDto['outcome'] | null = null;
  if (viewerPlacement != null) {
    outcome = viewerPlacement === 1 ? 'win' : 'loss';
  } else if (userId && latestViewerMatch?.status === 'completed') {
    const latestSummary = parseArenaV2StoredSummary(
      matchRows.find((match) => match.id === latestViewerMatch.id)?.result_summary
    );
    outcome = latestSummary.result === 'draw'
      ? 'draw'
      : latestViewerMatch.winnerUserId === userId ? 'win' : 'loss';
  } else if (userId && (row.status === 'completed' || row.status === 'finished')) {
    outcome = row.winner_user_id === userId ? 'win' : 'loss';
  }

  const viewerResult: ArenaV2ViewerResultDto | null = outcome ? {
    outcome,
    mmrBefore: null,
    mmrAfter: null,
    mmrDelta: null,
    tierBefore: null,
    tierAfter: null,
    unrated: true,
    placement: viewerPlacement,
    sharedPlacement: placementCount > 1,
    canSpectate,
    nextMatchId
  } : null;

  return {
    row,
    matchIds,
    matches: publicMatches.map(({ participantUserIds: _participantUserIds, ...match }) => ({
      ...match,
      spectatable: spectatableMatchIds.includes(String(match.id))
    })),
    participantState: publicParticipantState,
    spectatableMatchIds,
    currentMatchId,
    viewerContext: {
      placement: viewerPlacement,
      sharedPlacement: placementCount > 1,
      canSpectate,
      nextMatchId
    } satisfies ArenaV2BattleRoyaleViewerContext,
    viewerResult
  };
};


export const getArenaV2MatchForUser = async (
  matchId: string,
  userId?: string | null,
  battleRoyaleId?: string | null
) => {
  const db = getExecutor();
  if (!db) return null;
  let match = await queryGet<any>(
    db,
    `
      SELECT id, season_id, mode, status, battle_royale_id, round_no, turn_no, rng_seed, rules_version, card_pool_version,
             started_at, finished_at, winner_user_id, result_summary, replay_expires_at, created_at, updated_at
        FROM arena_v2_matches
       WHERE id = ?
       LIMIT 1
    `,
    [matchId]
  );
  if (!match) return null;

  const players = await queryAll<any>(
    db,
    `
      SELECT id, match_id, user_id, seat_no, deck_id, player_health, fatigue_count, initial_deck_order, hand_card_instance_ids,
             deck_card_instance_ids, graveyard_card_instance_ids, board_state, mulligan_state, final_rank, created_at, updated_at
        FROM arena_v2_match_players
       WHERE match_id = ?
       ORDER BY seat_no ASC
    `,
    [matchId]
  );
  const self = userId ? players.find((player) => player.user_id === userId) : undefined;
  let battleRoyaleSnapshot: Awaited<ReturnType<typeof loadArenaV2BattleRoyaleSnapshot>> = null;
  if (userId && !self) {
    if (!battleRoyaleId || battleRoyaleId !== match.battle_royale_id) return null;
    battleRoyaleSnapshot = await loadArenaV2BattleRoyaleSnapshot(db, battleRoyaleId, userId);
    if (!battleRoyaleSnapshot) return null;
  } else if (userId && match.battle_royale_id && match.status === 'completed') {
    battleRoyaleSnapshot = await loadArenaV2BattleRoyaleSnapshot(db, match.battle_royale_id, userId);
  }
  // 상태를 변경하는 read-repair는 참가자 또는 정확한 8인전 관전자 권한 확인 뒤에만 수행합니다.
  match = await promoteArenaV2TurnResultIfReady(db, match);

  const instances = await queryAll<any>(
    db,
    `
      SELECT ci.id, ci.match_id, ci.owner_seat_no, ci.card_version_id, ci.zone, ci.position, ci.current_attack, ci.current_health,
             ci.damage_taken, ci.status_effects, ci.created_turn,
             cv.streamer_id, cv.display_name, cv.season_id, cv.version, cv.card_class, cv.cost, cv.attack, cv.health, cv.keywords,
             CASE
               WHEN COALESCE(s.is_image_banned, 0) <> 0 THEN NULLIF(s.logo_url, '')
               ELSE COALESCE(NULLIF(cv.art_asset_id, ''), NULLIF(s.custom_image_url, ''), NULLIF(s.logo_url, ''))
             END AS art_asset_id,
             cv.status AS card_status
        FROM arena_v2_card_instances ci
        LEFT JOIN arena_v2_card_versions cv ON cv.id = ci.card_version_id
        LEFT JOIN streamers s ON s.channel_id = cv.streamer_id
       WHERE ci.match_id = ?
       ORDER BY ci.owner_seat_no ASC, ci.zone ASC, ci.created_turn ASC, ci.id ASC
    `,
    [matchId]
  );
  const viewerRole: ArenaV2ViewerRoleDto = self ? 'participant' : 'spectator';
  return serializeArenaV2MatchView(match, players, instances, {
    selfSeatNo: self?.seat_no ?? null,
    viewerRole,
    viewerUserId: userId || null,
    battleRoyaleContext: battleRoyaleSnapshot?.viewerContext ?? null
  });
};

export const isArenaV2MatchParticipant = async (matchId: string, userId: string) => {
  const db = getExecutor();
  if (!db || !matchId || !userId) return false;
  const row = await queryGet<{ id: string }>(
    db,
    'SELECT id FROM arena_v2_match_players WHERE match_id = ? AND user_id = ? LIMIT 1',
    [matchId, userId]
  );
  return Boolean(row?.id);
};

const loadArenaV2RuntimeMatch = async (db: SqlExecutor, matchId: string): Promise<{
  match: any;
  players: ArenaV2RuntimePlayer[];
  cardInstances: ArenaV2RuntimeCardInstance[];
}> => {
  const match = await queryGet<any>(
    db,
    `
      SELECT id, season_id, mode, status, battle_royale_id, round_no, turn_no, rng_seed, rules_version, card_pool_version,
             started_at, finished_at, winner_user_id, result_summary, replay_expires_at, created_at, updated_at
        FROM arena_v2_matches
       WHERE id = ?
       LIMIT 1
    `,
    [matchId]
  );
  if (!match) throw new Error('ArenaV2MatchNotFound');
  const playerRows = await queryAll<any>(
    db,
    `
      SELECT id, match_id, user_id, seat_no, deck_id, player_health, fatigue_count, initial_deck_order, hand_card_instance_ids,
             deck_card_instance_ids, graveyard_card_instance_ids, board_state, mulligan_state, final_rank, created_at, updated_at
        FROM arena_v2_match_players
       WHERE match_id = ?
       ORDER BY seat_no ASC
    `,
    [matchId]
  );
  const instanceRows = await queryAll<any>(
    db,
    `
      SELECT ci.id, ci.match_id, ci.owner_seat_no, ci.card_version_id, ci.zone, ci.position, ci.current_attack, ci.current_health,
             ci.damage_taken, ci.status_effects, ci.created_turn,
             cv.display_name, cv.card_class, cv.cost, cv.attack, cv.health, cv.keywords
        FROM arena_v2_card_instances ci
        LEFT JOIN arena_v2_card_versions cv ON cv.id = ci.card_version_id
       WHERE ci.match_id = ?
       ORDER BY ci.owner_seat_no ASC, ci.zone ASC, ci.created_turn ASC, ci.id ASC
    `,
    [matchId]
  );
  return {
    match,
    players: playerRows.map((player) => ({
      seatNo: Number(player.seat_no),
      userId: player.user_id,
      deckId: player.deck_id,
      playerHealth: Number(player.player_health ?? 30),
      fatigueCount: Math.max(0, Number(player.fatigue_count || 0)),
      handCardInstanceIds: jsonParse<string[]>(player.hand_card_instance_ids, []),
      deckCardInstanceIds: jsonParse<string[]>(player.deck_card_instance_ids, []),
      graveyardCardInstanceIds: jsonParse<string[]>(player.graveyard_card_instance_ids, []),
      boardState: jsonParse(player.board_state, []),
      mulliganState: jsonParse(player.mulligan_state, {})
    })),
    cardInstances: instanceRows.map((instance) => ({
      id: instance.id,
      ownerSeatNo: Number(instance.owner_seat_no),
      cardVersionId: instance.card_version_id,
      zone: instance.zone,
      position: jsonParse(instance.position, null),
      currentAttack: Number(instance.current_attack || instance.attack || 0),
      currentHealth: Number(instance.current_health || instance.health || 1),
      damageTaken: Number(instance.damage_taken || 0),
      statusEffects: jsonParse(instance.status_effects, []),
      createdTurn: Number(instance.created_turn || 0),
      card: {
        id: instance.card_version_id,
        cost: Number(instance.cost || 0),
        attack: Number(instance.attack || instance.current_attack || 0),
        health: Number(instance.health || instance.current_health || 1),
        displayName: instance.display_name || instance.card_version_id,
        cardClass: instance.card_class || 'charge',
        keywords: jsonParse(instance.keywords, [])
      }
    }))
  };
};

const collectArenaV2FinalActions = async (db: SqlExecutor, matchId: string, turnNo: number) => {
  const rows = await queryAll<any>(
    db,
    `
      SELECT seat_no, action_payload
        FROM arena_v2_action_submissions
       WHERE match_id = ? AND turn_no = ? AND is_final = 1
       ORDER BY submitted_at ASC
    `,
    [matchId, turnNo]
  );
  const actionsBySeatNo: Record<number, ArenaV2TurnActionDto[]> = {};
  for (const row of rows) {
    const payload = jsonParse<{ actions?: ArenaV2TurnActionDto[] }>(row.action_payload, { actions: [] });
    actionsBySeatNo[Number(row.seat_no)] = payload.actions || [];
  }
  return actionsBySeatNo;
};

const collectArenaV2LatestValidActions = async (db: SqlExecutor, matchId: string, turnNo: number) => {
  const rows = await queryAll<any>(
    db,
    `
      SELECT seat_no, action_payload, validation_result, revision, submitted_at
        FROM arena_v2_action_submissions
       WHERE match_id = ? AND turn_no = ?
       ORDER BY seat_no ASC, revision DESC, submitted_at DESC
    `,
    [matchId, turnNo]
  );
  const actionsBySeatNo: Record<number, ArenaV2TurnActionDto[]> = {};
  for (const row of rows) {
    const seatNo = Number(row.seat_no);
    if (actionsBySeatNo[seatNo]) continue;
    const validation = jsonParse<{ valid?: boolean }>(row.validation_result, { valid: false });
    if (!validation.valid) continue;
    const payload = jsonParse<{ actions?: ArenaV2TurnActionDto[] }>(row.action_payload, { actions: [] });
    actionsBySeatNo[seatNo] = payload.actions || [];
  }
  return actionsBySeatNo;
};

const reconcileArenaV2BattleRoyale = async (
  battleRoyaleId: string
): Promise<'advanced' | 'finished' | 'waiting' | 'noop'> => withArenaV2Transaction(async (tx) => {
  const battleRoyale = await queryGet<any>(
    tx,
    `
      SELECT id, season_id, status, current_round_no, participant_state, match_ids, winner_user_id, finished_at
        FROM arena_v2_battle_royales
       WHERE id = ?
       LIMIT 1
       ${arenaV2ForUpdateClause()}
    `,
    [battleRoyaleId]
  );
  if (!battleRoyale || battleRoyale.status !== 'active') return 'noop';
  const roundNo = Math.max(1, Number(battleRoyale.current_round_no || 1));

  // Lock order is battle royale -> this round's matches -> their players.
  const roundMatches = await queryAll<any>(
    tx,
    `
      SELECT id, status, round_no, winner_user_id, result_summary, card_pool_version
        FROM arena_v2_matches
       WHERE battle_royale_id = ? AND round_no = ?
       ORDER BY id ASC
       ${arenaV2ForUpdateClause()}
    `,
    [battleRoyaleId, roundNo]
  );
  if (roundMatches.length === 0) return 'waiting';
  const matchPlaceholders = roundMatches.map(() => '?').join(', ');
  const roundPlayers = await queryAll<any>(
    tx,
    `
      SELECT id, match_id, user_id, seat_no, player_health, final_rank
        FROM arena_v2_match_players
       WHERE match_id IN (${matchPlaceholders})
       ORDER BY match_id ASC, seat_no ASC
       ${arenaV2ForUpdateClause()}
    `,
    roundMatches.map((match) => match.id)
  );

  const participants = jsonParse<Record<string, unknown>[]>(battleRoyale.participant_state, [])
    .map((participant) => normalizeArenaV2BattleRoyaleParticipant(participant, battleRoyaleId));
  const participantByUserId = new Map(participants.map((participant) => [participant.userId, participant]));
  const pairedParticipants = participants.filter((participant) => (
    participant.status === 'active'
    && participant.currentRoundNo === roundNo
    && participant.roundStatus === 'paired'
  ));
  if (pairedParticipants.length !== roundMatches.length * 2 || roundPlayers.length !== roundMatches.length * 2) {
    throw new Error('ArenaV2BattleRoyaleRoundShapeInvalid');
  }
  if (roundMatches.some((match) => match.status !== 'completed')) return 'waiting';

  const currentRoundMatchByUserId = new Map<string, string>();
  const matchResults: ArenaV2BattleRoyaleRoundMatchResult[] = [];
  for (const match of roundMatches) {
    const players = roundPlayers
      .filter((player) => String(player.match_id) === String(match.id))
      .sort((left, right) => Number(left.seat_no) - Number(right.seat_no));
    if (players.length !== 2) throw new Error('ArenaV2BattleRoyaleMatchPlayerCountInvalid');
    const summary = parseArenaV2StoredSummary(match.result_summary);
    const battleRoyaleRound = isRecord(summary.battleRoyaleRound) ? summary.battleRoyaleRound : null;
    const roundStats = battleRoyaleRound && Array.isArray(battleRoyaleRound.roundStats)
      ? battleRoyaleRound.roundStats.filter(isRecord)
      : [];
    if (Number(battleRoyaleRound?.roundNo || 0) !== roundNo || roundStats.length !== 2) {
      throw new Error('ArenaV2BattleRoyaleRoundAggregateMissing');
    }
    const resultPlayers = players.map((player) => {
      const userId = String(player.user_id || '');
      const participant = participantByUserId.get(userId);
      if (!participant) throw new Error('ArenaV2BattleRoyaleMatchParticipantInvalid');
      participant.currentMatchId = String(match.id);
      participant.stateSourceMatchId = String(match.id);
      currentRoundMatchByUserId.set(userId, String(match.id));
      const stats = roundStats.find((item) => String(item.userId || '') === userId);
      if (!stats) throw new Error('ArenaV2BattleRoyaleRoundAggregateMissing');
      return {
        userId,
        health: Math.max(0, Number(player.player_health ?? 0)),
        directDamageDealt: Math.max(0, Number(stats.directDamageDealt || 0))
      };
    });
    matchResults.push({
      matchId: String(match.id),
      winnerUserId: match.winner_user_id ? String(match.winner_user_id) : null,
      players: resultPlayers
    });
  }

  const resolution = resolveArenaV2BattleRoyaleRound({
    battleRoyaleId,
    roundNo,
    participants,
    matches: matchResults
  });
  for (const participant of resolution.participants) {
    if (participant.finalRank == null) continue;
    const matchId = currentRoundMatchByUserId.get(participant.userId);
    if (!matchId) continue;
    await runSql(
      tx,
      `
        UPDATE arena_v2_match_players
           SET final_rank = ?, updated_at = CURRENT_TIMESTAMP
         WHERE match_id = ? AND user_id = ?
      `,
      [participant.finalRank, matchId, participant.userId]
    );
  }

  const storedMatchIds = jsonParse<string[]>(battleRoyale.match_ids, []);
  if (resolution.finished) {
    const updated = await runSql(
      tx,
      `
        UPDATE arena_v2_battle_royales
           SET status = 'finished',
               participant_state = ?,
               winner_user_id = ?,
               finished_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'active' AND current_round_no = ?
      `,
      [JSON.stringify(resolution.participants), resolution.winnerUserId, battleRoyaleId, roundNo]
    );
    if (affectedRows(updated) !== 1) throw new Error('ArenaV2BattleRoyaleAdvanceConflict');
    return 'finished';
  }

  const nextRoundNo = resolution.nextRoundNo;
  const nextParticipantByUserId = new Map(resolution.participants.map((participant) => [participant.userId, participant]));
  const nextMatches = resolution.pairings.map((pairing) => {
    const users = [pairing.leftUserId, pairing.rightUserId].sort();
    const matchId = makeDeterministicId('arena_v2_match', `${battleRoyaleId}:${nextRoundNo}:${users.join(':')}`);
    for (const userId of users) {
      const participant = nextParticipantByUserId.get(userId);
      if (!participant) throw new Error('ArenaV2BattleRoyaleParticipantMissing');
      participant.currentMatchId = matchId;
      participant.nextMatchId = matchId;
    }
    return { matchId, users };
  });
  for (const match of nextMatches) {
    const seats = match.users.map((userId, seatNo) => {
      const participant = nextParticipantByUserId.get(userId)!;
      if (!participant.stateSourceMatchId) throw new Error('ArenaV2BattleRoyaleStateSourceMissing');
      return {
        seatNo,
        userId,
        deckId: participant.deckId,
        playerHealth: participant.health,
        freeTacticalMoveNextRound: participant.freeTacticalMoveNextRound,
        pendingByeDraws: participant.pendingByeDraws,
        frozenCardVersionIds: participant.frozenCardVersionIds,
        stateSourceMatchId: participant.stateSourceMatchId
      };
    });
    await createArenaV2MatchFromDeckSeats(tx, {
      matchId: match.matchId,
      seasonId: String(battleRoyale.season_id),
      cardPoolVersion: resolution.participants[0]?.frozenCardPoolVersion || String(roundMatches[0].card_pool_version),
      mode: 'battle_royale_8',
      battleRoyaleId,
      roundNo: nextRoundNo,
      initialStatus: 'turn_planning',
      seats,
      summary: {
        status: 'turn_planning',
        queue: 'battle_royale_8',
        battleRoyaleId,
        roundNo: nextRoundNo,
        carriedState: true
      }
    });
  }
  const sharedRoundPhaseTiming = createArenaV2PhaseTiming([], Date.now());
  for (const match of nextMatches) {
    await runSql(
      tx,
      `
        UPDATE arena_v2_matches
           SET result_summary = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'turn_planning'
      `,
      [
        JSON.stringify({
          status: 'turn_planning',
          queue: 'battle_royale_8',
          battleRoyaleId,
          roundNo: nextRoundNo,
          carriedState: true,
          phaseTiming: sharedRoundPhaseTiming
        }),
        match.matchId
      ]
    );
    for (const userId of match.users) nextParticipantByUserId.get(userId)!.pendingByeDraws = 0;
  }
  const allMatchIds = [...new Set([...storedMatchIds, ...nextMatches.map((match) => match.matchId)])];
  const updated = await runSql(
    tx,
    `
      UPDATE arena_v2_battle_royales
         SET current_round_no = ?,
             participant_state = ?,
             match_ids = ?,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'active' AND current_round_no = ?
    `,
    [nextRoundNo, JSON.stringify(resolution.participants), JSON.stringify(allMatchIds), battleRoyaleId, roundNo]
  );
  if (affectedRows(updated) !== 1) throw new Error('ArenaV2BattleRoyaleAdvanceConflict');
  return 'advanced';
});

export const processArenaV2BattleRoyaleProgressions = async (limit = 25) => {
  const db = getExecutor();
  if (!db) return { scanned: 0, advanced: 0, finished: 0, failed: 0 };
  const rows = await queryAll<any>(
    db,
    `
      SELECT id
        FROM arena_v2_battle_royales
       WHERE status = 'active'
       ORDER BY updated_at ASC, id ASC
       LIMIT ?
    `,
    [Math.min(Math.max(Number(limit || 25), 1), 100)]
  );
  let advanced = 0;
  let finished = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const outcome = await reconcileArenaV2BattleRoyale(String(row.id));
      if (outcome === 'advanced') advanced += 1;
      if (outcome === 'finished') finished += 1;
    } catch (error: any) {
      failed += 1;
      console.error('[ArenaV2] 8인전 라운드 복구 실패:', row.id, error?.message || error);
    }
  }
  return { scanned: rows.length, advanced, finished, failed };
};

const resolveArenaV2TurnFromActions = async (
  db: SqlExecutor,
  input: {
    matchId: string;
    turnNo: number;
    actionsBySeatNo: Record<number, ArenaV2TurnActionDto[]>;
  }
) => {
  void db;
  const persisted = await withArenaV2Transaction(async (tx) => {
    const runtime = await loadArenaV2RuntimeMatch(tx, input.matchId);
    if (!['turn_planning', 'action_locked'].includes(String(runtime.match.status))) return null;
    const claimed = await runSql(
      tx,
      `
        UPDATE arena_v2_matches
           SET status = 'combat_resolving',
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND turn_no = ? AND status IN ('turn_planning', 'action_locked')
      `,
      [input.matchId, input.turnNo]
    );
    if (affectedRows(claimed) !== 1) return null;
    const resolution = resolveArenaV2Turn({
      matchId: input.matchId,
      mode: runtime.match.mode,
      turnNo: input.turnNo,
      seed: runtime.match.rng_seed,
      players: runtime.players,
      cardInstances: runtime.cardInstances,
      actionsBySeatNo: input.actionsBySeatNo
    });
    await persistArenaV2TurnResolution(tx, runtime.match, resolution);
    return {
      resolution,
      battleRoyaleId: runtime.match.mode === 'battle_royale_8' && resolution.nextStatus === 'completed'
        ? String(runtime.match.battle_royale_id || '')
        : ''
    };
  });
  if (persisted?.battleRoyaleId) {
    try {
      await reconcileArenaV2BattleRoyale(persisted.battleRoyaleId);
    } catch (error: any) {
      console.error('[ArenaV2] 완료된 8인전 매치 후 라운드 반영 실패:', persisted.battleRoyaleId, error?.message || error);
    }
  }
  return persisted?.resolution || null;
};

const insertArenaV2ActionSubmission = async (
  db: SqlExecutor,
  input: {
    id: string;
    matchId: string;
    userId: string;
    seatNo: number;
    turnNo: number;
    revision: number;
    actions: ArenaV2TurnActionDto[];
    validation: unknown;
    isFinal: boolean;
  }
) => runSql(
  db,
  `
    INSERT INTO arena_v2_action_submissions
      (id, match_id, user_id, seat_no, turn_no, revision, action_payload, validation_result, is_final)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  [
    input.id,
    input.matchId,
    input.userId,
    input.seatNo,
    input.turnNo,
    input.revision,
    JSON.stringify({ actions: input.actions }),
    JSON.stringify(input.validation),
    input.isFinal ? 1 : 0
  ]
);

const persistArenaV2TurnResolution = async (db: SqlExecutor, match: any, resolution: ArenaV2TurnResolutionResult) => {
  const persistedAtMs = Date.now();
  const expiresAt = new Date(persistedAtMs + 7 * 24 * 60 * 60 * 1000).toISOString();
  const lastSeq = await queryGet<{ max_seq: number }>(
    db,
    'SELECT COALESCE(MAX(seq), 0) AS max_seq FROM arena_v2_replay_events WHERE match_id = ?',
    [match.id]
  );
  let seq = Number(lastSeq?.max_seq || 0);
  for (const replayEvent of resolution.replayEvents) {
    seq += 1;
    await runSql(
      db,
      `
        INSERT INTO arena_v2_replay_events
          (match_id, seq, turn_no, event_type, payload, expires_at)
        VALUES
          (?, ?, ?, ?, ?, ?)
      `,
      [match.id, seq, replayEvent.turnNo, replayEvent.eventType, JSON.stringify(replayEvent.payload), expiresAt]
    );
  }
  for (const player of resolution.players) {
    await runSql(
      db,
      `
        UPDATE arena_v2_match_players
           SET player_health = ?,
               fatigue_count = ?,
               hand_card_instance_ids = ?,
               deck_card_instance_ids = ?,
               graveyard_card_instance_ids = ?,
               board_state = ?,
               mulligan_state = ?,
               updated_at = CURRENT_TIMESTAMP
         WHERE match_id = ? AND seat_no = ?
      `,
      [
        player.playerHealth,
        player.fatigueCount || 0,
        JSON.stringify(player.handCardInstanceIds),
        JSON.stringify(player.deckCardInstanceIds),
        JSON.stringify(player.graveyardCardInstanceIds),
        JSON.stringify(player.boardState),
        JSON.stringify(player.mulliganState || {}),
        match.id,
        player.seatNo
      ]
    );
  }
  for (const instance of resolution.cardInstances) {
    await runSql(
      db,
      `
        UPDATE arena_v2_card_instances
           SET zone = ?,
               position = ?,
               current_attack = ?,
               current_health = ?,
               damage_taken = ?,
               status_effects = ?,
               created_turn = ?,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
      `,
      [
        instance.zone,
        instance.position ? JSON.stringify(instance.position) : null,
        instance.currentAttack,
        instance.currentHealth,
        instance.damageTaken,
        JSON.stringify(instance.statusEffects || []),
        instance.createdTurn,
        instance.id
      ]
    );
  }
  const storedSummary: ArenaV2StoredSummary = { ...resolution.summary };
  if (resolution.nextStatus !== 'completed') {
    storedSummary.status = 'turn_result';
    storedSummary.phaseTiming = createArenaV2PhaseTiming(resolution.replayEvents, persistedAtMs);
  }
  if (match.mode === 'quick' && resolution.nextStatus === 'completed') {
    storedSummary.viewerResultsByUser = await updateArenaV2QuickRatings(
      db,
      match.season_id,
      match.id,
      resolution
    );
  }
  if (resolution.nextStatus === 'completed') {
    await runSql(
      db,
      `
        UPDATE arena_v2_matches
           SET status = ?,
               turn_no = ?,
               winner_user_id = ?,
               finished_at = ?,
               replay_expires_at = ?,
               result_summary = ?,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
      `,
      [
        resolution.nextStatus,
        resolution.nextTurnNo,
        resolution.winnerUserId,
        new Date(persistedAtMs).toISOString(),
        expiresAt,
        JSON.stringify(storedSummary),
        match.id
      ]
    );
  } else {
    await runSql(
      db,
      `
        UPDATE arena_v2_matches
           SET status = ?,
               turn_no = ?,
               winner_user_id = NULL,
               result_summary = ?,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
      `,
      ['turn_result', resolution.nextTurnNo, JSON.stringify(storedSummary), match.id]
    );
  }
};

const tierForArenaV2Mmr = (mmr: number) => {
  if (mmr >= 1800) return 'master';
  if (mmr >= 1500) return 'diamond';
  if (mmr >= 1300) return 'gold';
  if (mmr >= 1150) return 'silver';
  return 'bronze';
};

const updateArenaV2QuickRatings = async (
  db: SqlExecutor,
  seasonId: string,
  matchId: string,
  resolution: ArenaV2TurnResolutionResult
) => {
  const viewerResultsByUser: Record<string, {
    mmrBefore: number;
    mmrAfter: number;
    mmrDelta: number;
    tierBefore: string;
    tierAfter: string;
  }> = {};
  for (const player of resolution.players) {
    if (!player.userId) continue;
    const existing = await queryGet<any>(
      db,
      'SELECT id, mmr, peak_mmr, wins, losses, draws, last_match_id FROM arena_v2_ratings WHERE season_id = ? AND user_id = ? LIMIT 1',
      [seasonId, player.userId]
    );
    const isDraw = resolution.result === 'draw';
    const isWin = resolution.winnerUserId === player.userId;
    const nominalDelta = isDraw ? 0 : isWin ? 25 : -25;
    if (existing?.last_match_id === matchId) {
      const mmrAfter = Number(existing.mmr ?? 1000);
      const mmrBefore = Math.max(0, mmrAfter - nominalDelta);
      viewerResultsByUser[player.userId] = {
        mmrBefore,
        mmrAfter,
        mmrDelta: mmrAfter - mmrBefore,
        tierBefore: tierForArenaV2Mmr(mmrBefore),
        tierAfter: tierForArenaV2Mmr(mmrAfter)
      };
      continue;
    }
    const oldMmr = Number(existing?.mmr ?? 1000);
    const nextMmr = Math.max(0, oldMmr + nominalDelta);
    const nextPeak = Math.max(Number(existing?.peak_mmr ?? 1000), nextMmr);
    const tier = tierForArenaV2Mmr(nextMmr);
    const peakTier = tierForArenaV2Mmr(nextPeak);
    if (existing) {
      await runSql(
        db,
        `
          UPDATE arena_v2_ratings
             SET mmr = ?,
                 peak_mmr = ?,
                 tier = ?,
                 peak_tier = ?,
                 wins = wins + ?,
                 losses = losses + ?,
                 draws = draws + ?,
                 last_match_id = ?,
                 updated_at = CURRENT_TIMESTAMP
           WHERE id = ?
        `,
        [nextMmr, nextPeak, tier, peakTier, isWin ? 1 : 0, !isDraw && !isWin ? 1 : 0, isDraw ? 1 : 0, matchId, existing.id]
      );
    } else {
      await runSql(
        db,
        `
          INSERT INTO arena_v2_ratings
            (id, season_id, user_id, mmr, peak_mmr, tier, peak_tier, wins, losses, draws, last_match_id)
          VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          makeId('arena_v2_rating'),
          seasonId,
          player.userId,
          nextMmr,
          nextPeak,
          tier,
          peakTier,
          isWin ? 1 : 0,
          !isDraw && !isWin ? 1 : 0,
          isDraw ? 1 : 0,
          matchId
        ]
      );
    }
    viewerResultsByUser[player.userId] = {
      mmrBefore: oldMmr,
      mmrAfter: nextMmr,
      mmrDelta: nextMmr - oldMmr,
      tierBefore: tierForArenaV2Mmr(oldMmr),
      tierAfter: tier
    };
  }
  return viewerResultsByUser;
};

export const submitArenaV2TurnActions = async (input: ArenaV2SubmitTurnInput) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const view = await getArenaV2MatchForUser(input.matchId, input.userId);
  if (!view) throw new Error('ArenaV2MatchNotFound');
  if (view.status !== 'turn_planning' && view.status !== 'action_locked') throw new Error('ArenaV2MatchNotPlanning');
  if (view.turnNo !== input.turnNo) throw new Error('ArenaV2TurnMismatch');
  const turnDeadlineMs = view.phaseTiming?.turnDeadlineAt ? Date.parse(view.phaseTiming.turnDeadlineAt) : Number.NaN;
  if (Number.isFinite(turnDeadlineMs) && Date.now() >= turnDeadlineMs) {
    throw new Error('ArenaV2TurnDeadlineExpired');
  }
  const selfSeatNo = view.selfSeatNo;
  if (selfSeatNo == null) throw new Error('ArenaV2MatchForbidden');
  const self = view.players.find((player) => player.seatNo === selfSeatNo);
  if (!self) throw new Error('ArenaV2MatchForbidden');
  const latestSubmission = await queryGet<{ max_revision: number }>(
    db,
    `
      SELECT MAX(revision) AS max_revision
        FROM arena_v2_action_submissions
       WHERE match_id = ? AND seat_no = ? AND turn_no = ?
    `,
    [input.matchId, selfSeatNo, input.turnNo]
  );
  const latestRevision = latestSubmission?.max_revision == null ? -1 : Number(latestSubmission.max_revision);
  if (Number(input.revision) <= latestRevision) throw new Error('ArenaV2RevisionNotIncreasing');
  const ownInstances = view.cardInstances.filter((instance) => instance.ownerSeatNo === selfSeatNo);
  const cardInstancesById: Record<string, any> = {};
  for (const instance of ownInstances) {
    cardInstancesById[instance.id] = {
      id: instance.id,
      cardVersionId: instance.cardVersionId,
      cost: Number(instance.card?.cost || 0),
      createdTurn: Number(instance.createdTurn || 0)
    };
  }
  const validation = validateArenaV2TurnAction({
    turnNo: view.turnNo,
    availableCost: getArenaV2AvailableCost(view.turnNo),
    handCardInstanceIds: self.handCardInstanceIds,
    boardCards: self.boardState,
    freeTacticalMoveCount: getArenaV2FreeTacticalMoveCount(self.mulliganState),
    cardInstancesById,
    actions: input.actions
  });
  const submissionId = makeId('arena_v2_action');
  let submissionInserted: any;
  try {
    submissionInserted = await runSql(
      db,
      `
        INSERT INTO arena_v2_action_submissions
          (id, match_id, user_id, seat_no, turn_no, revision, action_payload, validation_result, is_final)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1
             FROM arena_v2_matches
            WHERE id = ? AND turn_no = ? AND status IN ('turn_planning', 'action_locked')
         )
      `,
      [
        submissionId,
        input.matchId,
        input.userId,
        selfSeatNo,
        input.turnNo,
        input.revision,
        JSON.stringify({ actions: input.actions }),
        JSON.stringify(validation),
        input.isFinal && validation.valid ? 1 : 0,
        input.matchId,
        input.turnNo
      ]
    );
  } catch (error: any) {
    if (isArenaV2DuplicateKeyError(error)) throw new Error('ArenaV2RevisionNotIncreasing');
    throw error;
  }
  if (affectedRows(submissionInserted) !== 1) throw new Error('ArenaV2MatchNotPlanning');
  if (input.isFinal && validation.valid) {
    const runtime = await loadArenaV2RuntimeMatch(db, input.matchId);
    const actionsBySeatNo = await collectArenaV2FinalActions(db, input.matchId, input.turnNo);
    if (runtime.match.mode === 'bot') {
      const botPlayer = runtime.players.find((player) => player.userId == null);
      if (botPlayer && !actionsBySeatNo[botPlayer.seatNo]) {
        const botInstances = runtime.cardInstances.filter((instance) => instance.ownerSeatNo === botPlayer.seatNo);
        const botCardInstancesById: Record<string, any> = {};
        for (const instance of botInstances) {
          botCardInstancesById[instance.id] = {
            id: instance.id,
            cardVersionId: instance.cardVersionId,
            cost: Number(instance.card?.cost || 0),
            createdTurn: Number(instance.createdTurn || 0)
          };
        }
        const botActions = createArenaV2BotTurnActions({
          turnNo: input.turnNo,
          handCardInstanceIds: botPlayer.handCardInstanceIds,
          boardCards: botPlayer.boardState,
          cardInstancesById: botCardInstancesById
        });
        const botValidation = validateArenaV2TurnAction({
          turnNo: input.turnNo,
          availableCost: getArenaV2AvailableCost(input.turnNo),
          handCardInstanceIds: botPlayer.handCardInstanceIds,
          boardCards: botPlayer.boardState,
          freeTacticalMoveCount: getArenaV2FreeTacticalMoveCount(botPlayer.mulliganState),
          cardInstancesById: botCardInstancesById,
          actions: botActions
        });
        if (botValidation.valid) {
          actionsBySeatNo[botPlayer.seatNo] = botActions;
          await insertArenaV2ActionSubmission(db, {
            id: makeId('arena_v2_action'),
            matchId: input.matchId,
            userId: `bot:${input.matchId}`,
            seatNo: botPlayer.seatNo,
            turnNo: input.turnNo,
            revision: 0,
            actions: botActions,
            validation: botValidation,
            isFinal: true
          });
        }
      }
    }

    const finalSeatNos = new Set(Object.keys(actionsBySeatNo).map((seatNo) => Number(seatNo)));
    const allPlayersLocked = runtime.players.every((player) => finalSeatNos.has(player.seatNo));
    if (allPlayersLocked) {
      await resolveArenaV2TurnFromActions(db, {
        matchId: input.matchId,
        turnNo: input.turnNo,
        actionsBySeatNo
      });
    } else {
      await runSql(
        db,
        `
          UPDATE arena_v2_matches
             SET status = 'action_locked',
                 result_summary = ?,
                 updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND turn_no = ?
        `,
        [
          JSON.stringify({
            ...parseArenaV2StoredSummary(runtime.match.result_summary),
            status: 'action_locked',
            lockedSeats: [...finalSeatNos],
            waitingSeats: runtime.players.filter((player) => !finalSeatNos.has(player.seatNo)).map((player) => player.seatNo)
          }),
          input.matchId,
          input.turnNo
        ]
      );
    }
  }
  return {
    submissionId,
    validation,
    accepted: validation.valid,
    match: await getArenaV2MatchForUser(input.matchId, input.userId)
  };
};

const autoConfirmExpiredArenaV2Mulligan = async (
  matchId: string,
  nowMs: number,
  legacyCutoffMs: number
): Promise<boolean> => withArenaV2Transaction(async (tx) => {
  const match = await queryGet<any>(
    tx,
    `
      SELECT id, status, result_summary, updated_at
        FROM arena_v2_matches
       WHERE id = ?
       LIMIT 1
       ${arenaV2ForUpdateClause()}
    `,
    [matchId]
  );
  if (!match || match.status !== 'mulligan') return false;
  const summary = parseArenaV2StoredSummary(match.result_summary);
  const deadlineMs = typeof summary.mulliganDeadlineAt === 'string'
    ? Date.parse(summary.mulliganDeadlineAt)
    : Number.NaN;
  const updatedAtMs = match.updated_at ? Date.parse(match.updated_at) : 0;
  if (Number.isFinite(deadlineMs) ? deadlineMs > nowMs : updatedAtMs > legacyCutoffMs) return false;

  const players = await queryAll<any>(
    tx,
    `
      SELECT seat_no, user_id, hand_card_instance_ids, mulligan_state
        FROM arena_v2_match_players
       WHERE match_id = ?
       ORDER BY seat_no ASC
       ${arenaV2ForUpdateClause()}
    `,
    [matchId]
  );
  if (players.length === 0) return false;
  const autoConfirmedSeats: number[] = [];
  const submittedAt = new Date(nowMs).toISOString();
  for (const player of players) {
    const state = jsonParse<Record<string, unknown>>(player.mulligan_state, {});
    if (state.done) continue;
    const seatNo = Number(player.seat_no);
    const kept = jsonParse<string[]>(player.hand_card_instance_ids, []);
    await runSql(
      tx,
      `
        UPDATE arena_v2_match_players
           SET mulligan_state = ?, updated_at = CURRENT_TIMESTAMP
         WHERE match_id = ? AND seat_no = ?
      `,
      [JSON.stringify({ ...state, done: true, replaced: [], kept, submittedAt, autoConfirmed: true }), matchId, seatNo]
    );
    autoConfirmedSeats.push(seatNo);
  }
  const phaseTiming = createArenaV2PhaseTiming([], nowMs);
  const updated = await runSql(
    tx,
    `
      UPDATE arena_v2_matches
         SET status = 'turn_result', result_summary = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'mulligan'
    `,
    [JSON.stringify({
      ...summary,
      status: 'turn_result',
      readySeats: players.map((player) => Number(player.seat_no)),
      waitingSeats: [],
      autoConfirmedMulliganSeats: autoConfirmedSeats,
      phaseTiming
    }), matchId]
  );
  return affectedRows(updated) === 1;
});

type ArenaV2ExpiredMatchOutcome = 'noop' | 'promoted' | 'resolved';

const processArenaV2ExpiredMatch = async (
  matchId: string,
  nowMs = Date.now(),
  timeoutSeconds = 40
): Promise<ArenaV2ExpiredMatchOutcome> => {
  const legacyCutoffMs = nowMs - Math.max(5, Number(timeoutSeconds || 40)) * 1000;
  let completedBattleRoyaleId = '';
  const outcome = await withArenaV2Transaction(async (tx): Promise<ArenaV2ExpiredMatchOutcome> => {
    const match = await queryGet<any>(
      tx,
      `
        SELECT id, season_id, mode, status, battle_royale_id, round_no, turn_no, rng_seed, rules_version,
               card_pool_version, result_summary, updated_at
          FROM arena_v2_matches
         WHERE id = ?
         LIMIT 1
         ${arenaV2ForUpdateClause()}
      `,
      [matchId]
    );
    if (!match) return 'noop';

    const summary = parseArenaV2StoredSummary(match.result_summary);
    if (match.status === 'turn_result') {
      const phaseTiming = serializeArenaV2PhaseTiming(summary, new Date(nowMs).toISOString());
      const planningStartsAtMs = phaseTiming?.planningStartsAt
        ? Date.parse(phaseTiming.planningStartsAt)
        : Number.NaN;
      if (Number.isFinite(planningStartsAtMs) && planningStartsAtMs > nowMs) return 'noop';
      const updated = await runSql(
        tx,
        `
          UPDATE arena_v2_matches
             SET status = 'turn_planning',
                 result_summary = ?,
                 updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'turn_result'
        `,
        [JSON.stringify({ ...summary, status: 'turn_planning' }), matchId]
      );
      return affectedRows(updated) === 1 ? 'promoted' : 'noop';
    }
    if (match.status !== 'turn_planning' && match.status !== 'action_locked') return 'noop';

    const phaseTiming = serializeArenaV2PhaseTiming(summary, new Date(nowMs).toISOString());
    const deadlineMs = phaseTiming?.turnDeadlineAt ? Date.parse(phaseTiming.turnDeadlineAt) : Number.NaN;
    const updatedAtMs = match.updated_at ? Date.parse(match.updated_at) : 0;
    if (Number.isFinite(deadlineMs) ? deadlineMs > nowMs : updatedAtMs > legacyCutoffMs) return 'noop';

    const claimed = await runSql(
      tx,
      `
        UPDATE arena_v2_matches
           SET status = 'combat_resolving',
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND turn_no = ? AND status IN ('turn_planning', 'action_locked')
      `,
      [matchId, Number(match.turn_no)]
    );
    if (affectedRows(claimed) !== 1) return 'noop';

    const runtime = await loadArenaV2RuntimeMatch(tx, matchId);
    const turnNo = Number(match.turn_no);
    const finalActions = await collectArenaV2FinalActions(tx, matchId, turnNo);
    const latestValidActions = await collectArenaV2LatestValidActions(tx, matchId, turnNo);
    const actionsBySeatNo: Record<number, ArenaV2TurnActionDto[]> = { ...finalActions };
    for (const player of runtime.players) {
      if (Object.prototype.hasOwnProperty.call(actionsBySeatNo, player.seatNo)) continue;
      const timeoutActions = latestValidActions[player.seatNo] || [{ type: 'end' as const }];
      actionsBySeatNo[player.seatNo] = timeoutActions;
      await insertArenaV2ActionSubmission(tx, {
        id: makeDeterministicId('arena_v2_action', `${matchId}:${turnNo}:${player.seatNo}:timeout`),
        matchId,
        userId: player.userId || `bot:${matchId}`,
        seatNo: player.seatNo,
        turnNo,
        // API 사용자 revision은 0 이상만 허용하므로 timeout은 충돌할 수 없는 예약 음수 영역을 사용합니다.
        revision: -1_000_000 - turnNo,
        actions: timeoutActions,
        validation: {
          valid: true,
          errors: [],
          warnings: [{ code: 'ArenaV2TurnTimeout', message: '제한 시간 초과로 서버가 행동을 확정했습니다.' }]
        },
        isFinal: true
      });
    }

    const resolution = resolveArenaV2Turn({
      matchId,
      mode: runtime.match.mode,
      turnNo,
      seed: runtime.match.rng_seed,
      players: runtime.players,
      cardInstances: runtime.cardInstances,
      actionsBySeatNo
    });
    await persistArenaV2TurnResolution(tx, runtime.match, resolution);
    if (runtime.match.mode === 'battle_royale_8' && resolution.nextStatus === 'completed') {
      completedBattleRoyaleId = String(runtime.match.battle_royale_id || '');
    }
    return 'resolved';
  });

  if (completedBattleRoyaleId) {
    try {
      await reconcileArenaV2BattleRoyale(completedBattleRoyaleId);
    } catch (error: any) {
      console.error('[ArenaV2] 만료된 8인전 매치 후 라운드 반영 실패:', completedBattleRoyaleId, error?.message || error);
    }
  }
  return outcome;
};

export const processArenaV2ExpiredTurns = async (
  timeoutSeconds = 40,
  limit = 25,
  processBattleRoyales = true
) => {
  const db = getExecutor();
  if (!db) return { scanned: 0, promoted: 0, resolved: 0, mulligansAutoConfirmed: 0 };
  const candidates = await queryAll<any>(
    db,
    `
      SELECT id, turn_no, status, result_summary, updated_at
        FROM arena_v2_matches
       WHERE status IN ('mulligan', 'turn_result', 'turn_planning', 'action_locked')
       ORDER BY updated_at ASC
       LIMIT ?
    `,
    [Math.min(Math.max(Number(limit || 25), 1), 100)]
  );
  let promoted = 0;
  let resolved = 0;
  let mulligansAutoConfirmed = 0;
  let failed = 0;
  const nowMs = Date.now();
  const legacyCutoffMs = nowMs - Math.max(5, Number(timeoutSeconds || 40)) * 1000;
  for (const candidate of candidates) {
    try {
      if (candidate.status === 'mulligan') {
        if (await autoConfirmExpiredArenaV2Mulligan(String(candidate.id), nowMs, legacyCutoffMs)) {
          mulligansAutoConfirmed += 1;
        }
        continue;
      }
      const outcome = await processArenaV2ExpiredMatch(String(candidate.id), nowMs, timeoutSeconds);
      if (outcome === 'promoted') promoted += 1;
      if (outcome === 'resolved') resolved += 1;
    } catch (error: any) {
      failed += 1;
      console.error('[ArenaV2] 만료 경기 자동 진행 실패:', candidate.id, error?.message || error);
    }
  }
  const battleRoyaleProgression = processBattleRoyales
    ? await processArenaV2BattleRoyaleProgressions(limit)
    : { scanned: 0, advanced: 0, finished: 0, failed: 0 };
  return { scanned: candidates.length, promoted, resolved, failed, mulligansAutoConfirmed, battleRoyaleProgression };
};

export const syncArenaV2MatchForUser = async (
  matchId: string,
  userId: string,
  battleRoyaleId?: string | null
) => {
  const authorizedView = await getArenaV2MatchForUser(matchId, userId, battleRoyaleId);
  if (!authorizedView) return null;
  const nowMs = Date.now();
  if (authorizedView.status === 'mulligan') {
    const summary = isRecord(authorizedView.resultSummary) ? authorizedView.resultSummary : {};
    const deadlineMs = typeof summary.mulliganDeadlineAt === 'string'
      ? Date.parse(summary.mulliganDeadlineAt)
      : Number.NaN;
    if (Number.isFinite(deadlineMs) && deadlineMs > nowMs) return authorizedView;
    await autoConfirmExpiredArenaV2Mulligan(matchId, nowMs, nowMs - 40_000);
  } else if (authorizedView.status === 'turn_planning' || authorizedView.status === 'action_locked') {
    const deadlineMs = authorizedView.phaseTiming?.turnDeadlineAt
      ? Date.parse(authorizedView.phaseTiming.turnDeadlineAt)
      : Number.NaN;
    if (Number.isFinite(deadlineMs) && deadlineMs > nowMs) return authorizedView;
    await processArenaV2ExpiredMatch(matchId, nowMs);
  } else {
    return authorizedView;
  }
  return getArenaV2MatchForUser(matchId, userId, battleRoyaleId);
};

export const submitArenaV2Mulligan = async (input: ArenaV2SubmitMulliganInput) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const view = await getArenaV2MatchForUser(input.matchId, input.userId);
  if (!view) throw new Error('ArenaV2MatchNotFound');
  if (view.status !== 'mulligan') throw new Error('ArenaV2MatchNotMulligan');
  const selfSeatNo = view.selfSeatNo;
  if (selfSeatNo == null) throw new Error('ArenaV2MatchForbidden');
  const self = view.players.find((player) => player.seatNo === selfSeatNo);
  if (!self) throw new Error('ArenaV2MatchForbidden');
  const existingSummary = isRecord(view.resultSummary) ? view.resultSummary : {};
  const mulliganDeadlineMs = typeof existingSummary.mulliganDeadlineAt === 'string'
    ? Date.parse(existingSummary.mulliganDeadlineAt) : Number.NaN;
  if (Number.isFinite(mulliganDeadlineMs) && Date.now() >= mulliganDeadlineMs) {
    throw new Error('ArenaV2MulliganDeadlineExpired');
  }

  const replaceSet = new Set(input.replaceCardInstanceIds);
  if (replaceSet.size > 3) throw new Error('ArenaV2MulliganTooManyCards');
  const handSet = new Set(self.handCardInstanceIds);
  for (const id of replaceSet) {
    if (!handSet.has(id)) throw new Error('ArenaV2MulliganCardInvalid');
  }

  const currentPlayer = await queryGet<any>(
    db,
    `
      SELECT hand_card_instance_ids, deck_card_instance_ids, mulligan_state
        FROM arena_v2_match_players
       WHERE match_id = ? AND seat_no = ?
       LIMIT 1
    `,
    [input.matchId, selfSeatNo]
  );
  if (!currentPlayer) throw new Error('ArenaV2MatchForbidden');

  const hand = jsonParse<string[]>(currentPlayer.hand_card_instance_ids, []);
  const deck = jsonParse<string[]>(currentPlayer.deck_card_instance_ids, []);
  const currentMulliganState = jsonParse<{ done?: boolean }>(currentPlayer.mulligan_state, {});
  if (currentMulliganState.done) throw new Error('ArenaV2MulliganAlreadyDone');
  const kept = hand.filter((id) => !replaceSet.has(id));
  const returned = hand.filter((id) => replaceSet.has(id));
  const drawn = deck.slice(0, returned.length);
  const remainingDeck = stableShuffle(
    [...deck.slice(returned.length), ...returned].map((id) => ({ id })),
    `${input.matchId}:mulligan:${selfSeatNo}:${returned.join(':')}`
  ).map((item) => item.id);
  const nextHand = [...kept, ...drawn];
  const mulliganState = {
    done: true,
    replaced: returned,
    kept,
    submittedAt: new Date().toISOString(),
  };

  if (Number.isFinite(mulliganDeadlineMs) && Date.now() >= mulliganDeadlineMs) {
    throw new Error('ArenaV2MulliganDeadlineExpired');
  }
  const playerUpdated = await runSql(
    db,
    `
      UPDATE arena_v2_match_players
         SET hand_card_instance_ids = ?,
             deck_card_instance_ids = ?,
             mulligan_state = ?,
             updated_at = CURRENT_TIMESTAMP
       WHERE match_id = ? AND seat_no = ?
         AND EXISTS (
           SELECT 1 FROM arena_v2_matches
            WHERE id = ? AND status = 'mulligan'
         )
    `,
    [JSON.stringify(nextHand), JSON.stringify(remainingDeck), JSON.stringify(mulliganState), input.matchId, selfSeatNo, input.matchId]
  );
  if (affectedRows(playerUpdated) !== 1) throw new Error('ArenaV2MatchNotMulligan');
  for (const cardInstanceId of drawn) {
    await runSql(
      db,
      `
        UPDATE arena_v2_card_instances
           SET zone = 'hand',
               position = NULL,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
      `,
      [cardInstanceId]
    );
  }
  for (const cardInstanceId of returned) {
    await runSql(
      db,
      `
        UPDATE arena_v2_card_instances
           SET zone = 'deck',
               position = NULL,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
      `,
      [cardInstanceId]
    );
  }
  const allPlayers = await queryAll<any>(
    db,
    `
      SELECT seat_no, user_id, mulligan_state
        FROM arena_v2_match_players
       WHERE match_id = ?
       ORDER BY seat_no ASC
    `,
    [input.matchId]
  );
  const allMulligansDone = view.mode === 'bot' || allPlayers.every((player) => jsonParse<{ done?: boolean }>(player.mulligan_state, {}).done);
  if (allMulligansDone) {
    const phaseTiming = createArenaV2PhaseTiming([]);
    await runSql(
      db,
      `
        UPDATE arena_v2_matches
           SET status = 'turn_result',
               result_summary = ?,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'mulligan'
      `,
      [
        JSON.stringify({
          ...existingSummary,
          status: 'turn_result',
          mulliganSeatNo: selfSeatNo,
          readySeats: allPlayers.map((player) => Number(player.seat_no)),
          waitingSeats: [],
          phaseTiming
        }),
        input.matchId
      ]
    );
  } else {
    const readySeats = allPlayers
      .filter((player) => jsonParse<{ done?: boolean }>(player.mulligan_state, {}).done)
      .map((player) => Number(player.seat_no));
    await runSql(
      db,
      `
        UPDATE arena_v2_matches
           SET result_summary = ?,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'mulligan'
      `,
      [
        JSON.stringify({
          ...existingSummary,
          status: 'mulligan',
          readySeats,
          waitingSeats: allPlayers
            .filter((player) => !readySeats.includes(Number(player.seat_no)))
            .map((player) => Number(player.seat_no))
        }),
        input.matchId
      ]
    );
  }
  return {
    accepted: true,
    mulliganState,
    match: await getArenaV2MatchForUser(input.matchId, input.userId)
  };
};

export const getArenaV2Replay = async (
  matchId: string,
  userId?: string | null,
  battleRoyaleId?: string | null
) => {
  const db = getExecutor();
  if (!db) return null;
  const match = userId
    ? await syncArenaV2MatchForUser(matchId, userId, battleRoyaleId)
    : await getArenaV2MatchForUser(matchId, userId, battleRoyaleId);
  if (!match) return null;
  const replayState = await queryGet<any>(
    db,
    'SELECT replay_expires_at, status FROM arena_v2_matches WHERE id = ? LIMIT 1',
    [matchId]
  );
  const replayExpiresAt = replayState?.replay_expires_at ? Date.parse(replayState.replay_expires_at) : 0;
  const events = await queryAll<any>(
    db,
    `
      SELECT id, match_id, seq, turn_no, event_type, payload, created_at, expires_at
        FROM arena_v2_replay_events
       WHERE match_id = ?
       ORDER BY seq ASC
       LIMIT 5000
    `,
    [matchId]
  );
  if (events.length === 0 && replayExpiresAt > 0 && replayExpiresAt < Date.now()) {
    throw new Error('ArenaReplayExpired');
  }
  return {
    match,
    events: events.map((event) => ({
      id: event.id,
      matchId: event.match_id,
      seq: Number(event.seq || 0),
      turnNo: Number(event.turn_no || 0),
      eventType: event.event_type,
      payload: jsonParse(event.payload, {}),
      createdAt: event.created_at,
      expiresAt: event.expires_at
    }))
  };
};

export const pruneArenaV2ExpiredReplayEvents = async (limit = 5000) => {
  const db = getExecutor();
  if (!db) return { pruned: 0, held: 0 };
  const now = new Date().toISOString();
  const heldRows = await queryAll<any>(
    db,
    `
      SELECT DISTINCT match_id
        FROM arena_v2_replay_holds
       WHERE status = 'active'
         AND (hold_until IS NULL OR hold_until >= ?)
       LIMIT ?
    `,
    [now, Math.min(Math.max(Number(limit || 5000), 1), 20000)]
  );
  const result = await runSql(
    db,
    `
      DELETE FROM arena_v2_replay_events
       WHERE expires_at < ?
         AND match_id NOT IN (
           SELECT match_id
             FROM arena_v2_replay_holds
            WHERE status = 'active'
              AND (hold_until IS NULL OR hold_until >= ?)
         )
       LIMIT ?
    `,
    [now, now, Math.min(Math.max(Number(limit || 5000), 1), 20000)]
  );
  return {
    pruned: Number(result?.changes ?? result?.affectedRows ?? 0),
    held: heldRows.length
  };
};

export const listArenaV2Rankings = async (seasonId?: string, limit = 100) => {
  const db = getExecutor();
  if (!db) return { seasonId: seasonId || null, source: 'arena_v2_ratings_empty', updatedAt: null, items: [] };
  const season = seasonId ? { id: seasonId } : await getArenaV2CurrentSeason();
  if (!season?.id) return { seasonId: null, source: 'arena_v2_ratings_empty', updatedAt: null, items: [] };
  const rows = await queryAll<any>(
    db,
    `
      SELECT season_id, user_id, mmr, peak_mmr, tier, peak_tier, wins, losses, draws, updated_at
        FROM arena_v2_ratings
       WHERE season_id = ?
       ORDER BY mmr DESC, peak_mmr DESC, updated_at ASC
       LIMIT ?
    `,
    [season.id, Math.min(Math.max(Number(limit || 100), 1), 200)]
  );
  return {
    seasonId: season.id,
    source: rows.length ? 'arena_v2_ratings' : 'arena_v2_ratings_empty',
    updatedAt: rows[0]?.updated_at || null,
    items: rows.map((row, index) => ({
      rank: index + 1,
      userId: row.user_id,
      displayName: row.user_id,
      mmr: Number(row.mmr || 1000),
      peakMmr: Number(row.peak_mmr || row.mmr || 1000),
      tier: row.tier || 'bronze',
      peakTier: row.peak_tier || row.tier || 'bronze',
      wins: Number(row.wins || 0),
      losses: Number(row.losses || 0),
      draws: Number(row.draws || 0),
      updatedAt: row.updated_at
    }))
  };
};

export const getArenaV2CurrentRewardsForUser = async (userId: string, seasonId?: string) => {
  const db = getExecutor();
  if (!db) return null;
  const season = seasonId ? { id: seasonId } : await getArenaV2CurrentSeason();
  if (!season?.id) return null;
  const rating = await queryGet<any>(
    db,
    `
      SELECT season_id, user_id, mmr, peak_mmr, tier, peak_tier, wins, losses, draws
        FROM arena_v2_ratings
       WHERE season_id = ? AND user_id = ?
       LIMIT 1
    `,
    [season.id, userId]
  );
  const grant = await queryGet<any>(
    db,
    `
      SELECT id, reward_basis, reward_items, status, hold_reason, granted_at, created_at, updated_at
        FROM arena_v2_reward_grants
       WHERE season_id = ? AND user_id = ?
       LIMIT 1
    `,
    [season.id, userId]
  );
  return {
    seasonId: season.id,
    rating: rating ? {
      mmr: Number(rating.mmr || 1000),
      peakMmr: Number(rating.peak_mmr || rating.mmr || 1000),
      tier: rating.tier || 'bronze',
      peakTier: rating.peak_tier || rating.tier || 'bronze',
      wins: Number(rating.wins || 0),
      losses: Number(rating.losses || 0),
      draws: Number(rating.draws || 0)
    } : {
      mmr: 1000,
      peakMmr: 1000,
      tier: 'bronze',
      peakTier: 'bronze',
      wins: 0,
      losses: 0,
      draws: 0
    },
    grant: grant ? {
      id: grant.id,
      rewardBasis: jsonParse(grant.reward_basis, {}),
      rewardItems: jsonParse(grant.reward_items, []),
      status: grant.status,
      holdReason: grant.hold_reason,
      grantedAt: grant.granted_at,
      createdAt: grant.created_at,
      updatedAt: grant.updated_at
    } : null
  };
};

export const getArenaV2BattleRoyale = async (battleRoyaleId: string, userId?: string | null) => {
  const db = getExecutor();
  if (!db) return null;
  const snapshot = await loadArenaV2BattleRoyaleSnapshot(db, battleRoyaleId, userId);
  if (!snapshot) return null;
  const { row } = snapshot;
  return {
    id: row.id,
    seasonId: row.season_id,
    status: row.status,
    currentRoundNo: Number(row.current_round_no || 0),
    participantState: snapshot.participantState,
    matchIds: snapshot.matchIds,
    matches: snapshot.matches,
    spectatableMatchIds: snapshot.spectatableMatchIds,
    currentMatchId: snapshot.currentMatchId,
    viewerResult: snapshot.viewerResult,
    winnerUserId: row.winner_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at
  };
};

export const listArenaV2WikiEntries = () => ([
  { slug: 'core-rules', title: '핵심 규칙', category: 'rules', status: 'active', updatedAt: '2026-07-07' },
  { slug: 'deck-building', title: '덱 빌딩', category: 'rules', status: 'active', updatedAt: '2026-07-07' },
  { slug: 'battle-royale-8', title: '8인 배틀로얄', category: 'mode', status: 'active', updatedAt: '2026-07-07' },
  { slug: 'reports-rights', title: '신고와 스트리머 권리', category: 'operations', status: 'active', updatedAt: '2026-07-07' }
]);

export const getArenaV2WikiEntry = (slug: string) => {
  const entry = listArenaV2WikiEntries().find((item) => item.slug === slug);
  if (!entry) return null;
  const bodyBySlug: Record<string, string[]> = {
    'core-rules': ['2x3 전장, 손패, 코스트, 동시 턴 제출을 기준으로 진행한다.', '서버가 모든 행동을 검증하고 결과를 확정한다.'],
    'deck-building': ['덱은 같은 시즌의 활성 카드 14~20장으로 구성한다.', '동일 카드 버전과 동일 스트리머 카드는 각각 1장까지만 허용한다.'],
    'battle-royale-8': ['8명이 큐에 모이면 배틀로얄 방을 생성하고 라운드별 매치를 진행한다.', '탈락자 순위와 생존 상태는 battle royale 상태에 저장한다.'],
    'reports-rights': ['신고, 리플레이 보존, 스트리머 권리 요청은 v2 전용 테이블로 분리한다.', '운영자는 신고와 권리 요청을 별도 검토 큐에서 처리한다.']
  };
  return { ...entry, body: bodyBySlug[slug] || [] };
};

const serializeArenaV2MatchView = (
  match: any,
  players: any[],
  instances: any[],
  options: {
    selfSeatNo: number | null;
    viewerRole: ArenaV2ViewerRoleDto;
    viewerUserId: string | null;
    battleRoyaleContext: ArenaV2BattleRoyaleViewerContext | null;
  }
) => {
  const selfSeatNo = options.selfSeatNo == null ? null : Number(options.selfSeatNo);
  const summary = parseArenaV2StoredSummary(match.result_summary);
  const phaseTiming = serializeArenaV2PhaseTiming(summary);
  const resultSummary = publicArenaV2ResultSummary(summary);
  if (phaseTiming) resultSummary.phaseTiming = phaseTiming;
  const privateResultCandidate = options.viewerUserId
    ? summary.viewerResultsByUser?.[options.viewerUserId]
    : undefined;
  const privateResult: Record<string, unknown> = isRecord(privateResultCandidate) ? privateResultCandidate : {};
  const privateNumber = (key: string): number | null => {
    const value = privateResult[key];
    if (value == null || value === '') return null;
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
  };
  const privateString = (key: string): string | null => (
    typeof privateResult[key] === 'string' && privateResult[key] ? String(privateResult[key]) : null
  );
  const selfPlayer = selfSeatNo == null
    ? undefined
    : players.find((player) => Number(player.seat_no) === selfSeatNo);
  const placement = parseNullableRank(selfPlayer?.final_rank)
    ?? options.battleRoyaleContext?.placement
    ?? null;
  const nextMatchId = options.battleRoyaleContext?.nextMatchId === String(match.id)
    ? null
    : options.battleRoyaleContext?.nextMatchId ?? null;
  let viewerResult: ArenaV2ViewerResultDto | null = null;
  if (match.status === 'completed' && options.viewerRole === 'participant' && options.viewerUserId) {
    const outcome: ArenaV2ViewerResultDto['outcome'] = match.mode === 'battle_royale_8' && placement != null
      ? placement === 1 ? 'win' : 'loss'
      : summary.result === 'draw'
        ? 'draw'
        : match.winner_user_id === options.viewerUserId ? 'win' : 'loss';
    viewerResult = {
      outcome,
      mmrBefore: privateNumber('mmrBefore'),
      mmrAfter: privateNumber('mmrAfter'),
      mmrDelta: privateNumber('mmrDelta'),
      tierBefore: privateString('tierBefore'),
      tierAfter: privateString('tierAfter'),
      unrated: match.mode !== 'quick',
      placement,
      sharedPlacement: options.battleRoyaleContext?.sharedPlacement ?? false,
      canSpectate: options.battleRoyaleContext?.canSpectate ?? false,
      nextMatchId
    };
  }
  return ({
  id: match.id,
  seasonId: match.season_id,
  mode: match.mode,
  status: match.status,
  battleRoyaleId: match.battle_royale_id,
  roundNo: Number(match.round_no || 0),
  turnNo: Number(match.turn_no || 1),
  rulesVersion: match.rules_version,
  cardPoolVersion: match.card_pool_version,
  startedAt: match.started_at,
  finishedAt: match.finished_at,
  winnerUserId: match.winner_user_id,
  resultSummary,
  viewerRole: options.viewerRole,
  phaseTiming,
  viewerResult,
  selfSeatNo,
  players: players.map((player) => {
    const seatNo = Number(player.seat_no);
    const handCardInstanceIds = jsonParse<string[]>(player.hand_card_instance_ids, []);
    return {
      seatNo,
      userId: player.user_id,
      deckId: seatNo === selfSeatNo ? player.deck_id : null,
      playerHealth: Math.max(0, Number(player.player_health ?? 30)),
      fatigueCount: Math.max(0, Number(player.fatigue_count || 0)),
      handCardInstanceIds: seatNo === selfSeatNo ? handCardInstanceIds : [],
      handCount: handCardInstanceIds.length,
      deckCount: jsonParse<string[]>(player.deck_card_instance_ids, []).length,
      graveyardCardInstanceIds: jsonParse<string[]>(player.graveyard_card_instance_ids, []),
      boardState: jsonParse(player.board_state, []),
      mulliganState: seatNo === selfSeatNo ? jsonParse(player.mulligan_state, {}) : {},
      finalRank: parseNullableRank(player.final_rank)
    };
  }),
  cardInstances: instances.filter((instance) => isArenaV2CardInstanceVisibleToSeat(instance, selfSeatNo)).map((instance) => ({
    id: instance.id,
    ownerSeatNo: Number(instance.owner_seat_no),
    cardVersionId: instance.card_version_id,
    card: instance.display_name ? {
      id: instance.card_version_id,
      streamerId: instance.streamer_id,
      displayName: instance.display_name,
      seasonId: instance.season_id,
      version: Number(instance.version || 1),
      cardClass: instance.card_class,
      cost: Number(instance.cost || 0),
      attack: Number(instance.attack || instance.current_attack || 0),
      health: Number(instance.health || instance.current_health || 1),
      keywords: jsonParse(instance.keywords, []),
      artAssetId: formatUploadUrl(instance.art_asset_id || null),
      status: instance.card_status || 'active'
    } : undefined,
    zone: instance.zone,
    position: jsonParse(instance.position, null),
    currentAttack: Number(instance.current_attack || 0),
    currentHealth: Number(instance.current_health || 0),
    damageTaken: Number(instance.damage_taken || 0),
    statusEffects: jsonParse(instance.status_effects, []),
    createdTurn: Number(instance.created_turn || 0)
  }))
});
};

function isArenaV2CardInstanceVisibleToSeat(instance: any, selfSeatNo: number | null): boolean {
  const ownerSeatNo = Number(instance.owner_seat_no);
  if (ownerSeatNo === selfSeatNo) return true;
  return instance.zone === 'board' || instance.zone === 'graveyard' || instance.zone === 'banished';
}

const loadArenaV2CardVersionsByIds = async (
  db: SqlExecutor,
  ids: string[],
  includeInactive = false
) => {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const rows = await queryAll<any>(
    db,
    `
      SELECT id, cost, attack, health
        FROM arena_v2_card_versions
       WHERE id IN (${placeholders}) ${includeInactive ? '' : "AND status = 'active'"}
    `,
    ids
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
};

const createArenaV2MatchFromDeckSeats = async (
  db: SqlExecutor,
  input: {
    matchId?: string;
    seasonId: string;
    cardPoolVersion: string;
    mode: 'quick' | 'battle_royale_8';
    battleRoyaleId: string | null;
    roundNo: number;
    initialStatus?: 'mulligan' | 'turn_planning';
    phaseTiming?: ArenaV2PhaseTimingDto;
    seats: Array<{
      seatNo: number;
      userId: string;
      deckId: string;
      playerHealth?: number;
      freeTacticalMoveNextRound?: boolean;
      pendingByeDraws?: number;
      frozenCardVersionIds?: string[];
      stateSourceMatchId?: string | null;
    }>;
    summary: Record<string, unknown>;
  }
) => {
  const matchId = input.matchId || makeId('arena_v2_match');
  const seed = stableHash(`chikapo-arena-v2:${matchId}:${input.mode}:${input.roundNo}:${input.seats.map((seat) => seat.userId).join(':')}`);
  const initialStatus = input.initialStatus || 'mulligan';
  const initialTurnNo = input.mode === 'battle_royale_8' ? Math.max(1, input.roundNo) : 1;
  const sharedCreatedAtMs = Date.now();
  const initialSummary: ArenaV2StoredSummary = { ...input.summary, status: initialStatus };
  if (initialStatus === 'turn_planning') {
    initialSummary.phaseTiming = input.phaseTiming || createArenaV2PhaseTiming([], sharedCreatedAtMs);
  } else {
    initialSummary.mulliganDeadlineAt = new Date(sharedCreatedAtMs + ARENA_V2_TURN_PLANNING_MS).toISOString();
  }
  await runSql(
    db,
    `
      INSERT INTO arena_v2_matches
        (id, season_id, mode, status, battle_royale_id, round_no, turn_no, rng_seed, rules_version, card_pool_version, result_summary)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, 'arena-v2-gdd-1.0.0', ?, ?)
    `,
    [
      matchId,
      input.seasonId,
      input.mode,
      initialStatus,
      input.battleRoyaleId,
      input.roundNo,
      initialTurnNo,
      seed,
      input.cardPoolVersion,
      JSON.stringify(initialSummary)
    ]
  );

  for (const seat of input.seats) {
    if (seat.stateSourceMatchId) {
      await cloneArenaV2PersistentPlayerState(db, {
        matchId,
        sourceMatchId: seat.stateSourceMatchId,
        userId: seat.userId,
        seatNo: seat.seatNo,
        deckId: seat.deckId,
        playerHealth: seat.playerHealth,
        freeTacticalMoveNextRound: Boolean(seat.freeTacticalMoveNextRound),
        pendingByeDraws: Math.max(0, Number(seat.pendingByeDraws || 0))
      });
      continue;
    }

    let cardVersionIds = [...(seat.frozenCardVersionIds || [])];
    if (cardVersionIds.length === 0) {
      const deck = await queryGet<any>(
        db,
        'SELECT id, user_id, season_id, card_version_ids, is_valid FROM arena_v2_decks WHERE id = ? LIMIT 1',
        [seat.deckId]
      );
      if (!deck) throw new Error('ArenaV2DeckNotFound');
      if (deck.user_id !== seat.userId) throw new Error('ArenaV2DeckForbidden');
      if (deck.season_id !== input.seasonId) throw new Error('ArenaV2DeckSeasonMismatch');
      if (!Boolean(Number(deck.is_valid))) throw new Error('ArenaV2DeckInvalid');
      cardVersionIds = jsonParse<string[]>(deck.card_version_ids, []);
      const validation = await validateArenaV2DeckForSeasonWithExecutor(db, input.seasonId, cardVersionIds);
      if (!validation.valid) throw new Error('ArenaV2DeckInvalid');
    }
    const cards = await loadArenaV2CardVersionsByIds(db, cardVersionIds, Boolean(seat.frozenCardVersionIds?.length));
    if (cards.length !== cardVersionIds.length) throw new Error('ArenaV2FrozenCardVersionMissing');
    const ordered = stableShuffle(cards, `${seed}:seat:${seat.seatNo}`).map((card, index) => ({
      instanceId: makeDeterministicId('arena_v2_card', `${matchId}:${seat.seatNo}:${card.id}:${index}`),
      card
    }));
    await insertArenaV2MatchPlayer(db, {
      matchId,
      userId: seat.userId,
      seatNo: seat.seatNo,
      deckId: seat.deckId,
      orderedInstances: ordered,
      playerHealth: seat.playerHealth,
      freeTacticalMoveNextRound: Boolean(seat.freeTacticalMoveNextRound)
    });
    for (let index = 0; index < ordered.length; index += 1) {
      const item = ordered[index];
      await runSql(
        db,
        `
          INSERT INTO arena_v2_card_instances
            (id, match_id, owner_seat_no, card_version_id, zone, position, current_attack, current_health, damage_taken, status_effects, created_turn)
          VALUES
            (?, ?, ?, ?, ?, NULL, ?, ?, 0, ?, 0)
        `,
        [
          item.instanceId,
          matchId,
          seat.seatNo,
          item.card.id,
          index < 5 ? 'hand' : 'deck',
          Number(item.card.attack || 0),
          Number(item.card.health || 1),
          JSON.stringify([])
        ]
      );
    }
  }
  return matchId;
};

const insertArenaV2MatchPlayer = async (
  db: SqlExecutor,
  input: {
    matchId: string;
    userId: string | null;
    seatNo: number;
    deckId: string | null;
    orderedInstances: Array<{ instanceId: string; card: any }>;
    playerHealth?: number;
    fatigueCount?: number;
    freeTacticalMoveNextRound?: boolean;
  }
) => {
  const hand = input.orderedInstances.slice(0, 5).map((item) => item.instanceId);
  const deck = input.orderedInstances.slice(5).map((item) => item.instanceId);
  await runSql(
    db,
    `
      INSERT INTO arena_v2_match_players
        (id, match_id, user_id, seat_no, deck_id, player_health, fatigue_count, initial_deck_order, hand_card_instance_ids, deck_card_instance_ids, graveyard_card_instance_ids, board_state, mulligan_state)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      makeDeterministicId('arena_v2_player', `${input.matchId}:${input.seatNo}:${input.userId || 'bot'}`),
      input.matchId,
      input.userId,
      input.seatNo,
      input.deckId,
      Math.max(0, Number(input.playerHealth ?? 30)),
      Math.max(0, Number(input.fatigueCount || 0)),
      JSON.stringify(input.orderedInstances.map((item) => item.instanceId)),
      JSON.stringify(hand),
      JSON.stringify(deck),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify({
        done: false,
        replaced: [],
        freeTacticalMoveCount: input.freeTacticalMoveNextRound ? 1 : 0
      })
    ]
  );
};

const cloneArenaV2PersistentPlayerState = async (
  db: SqlExecutor,
  input: {
    matchId: string;
    sourceMatchId: string;
    userId: string;
    seatNo: number;
    deckId: string;
    playerHealth?: number;
    freeTacticalMoveNextRound: boolean;
    pendingByeDraws: number;
  }
) => {
  const sourcePlayer = await queryGet<any>(
    db,
    `
      SELECT id, seat_no, player_health, fatigue_count, initial_deck_order, hand_card_instance_ids,
             deck_card_instance_ids, graveyard_card_instance_ids, board_state, mulligan_state
        FROM arena_v2_match_players
       WHERE match_id = ? AND user_id = ?
       LIMIT 1
    `,
    [input.sourceMatchId, input.userId]
  );
  if (!sourcePlayer) throw new Error('ArenaV2BattleRoyaleStateSourceMissing');
  const sourceInstances = await queryAll<any>(
    db,
    `
      SELECT id, card_version_id, zone, position, current_attack, current_health, damage_taken, created_turn
        FROM arena_v2_card_instances
       WHERE match_id = ? AND owner_seat_no = ?
       ORDER BY id ASC
    `,
    [input.sourceMatchId, Number(sourcePlayer.seat_no)]
  );
  const idBySourceId = new Map(sourceInstances.map((instance) => [
    String(instance.id),
    makeDeterministicId('arena_v2_card', `${input.matchId}:${input.seatNo}:${instance.id}`)
  ]));
  const mapIds = (value: unknown) => jsonParse<string[]>(value, [])
    .map((id) => idBySourceId.get(id))
    .filter((id): id is string => Boolean(id));
  const boardState = jsonParse<any[]>(sourcePlayer.board_state, [])
    .map((card) => ({ ...card, cardInstanceId: idBySourceId.get(String(card.cardInstanceId || '')) }))
    .filter((card) => Boolean(card.cardInstanceId));
  const sourceMulliganState = jsonParse<Record<string, unknown>>(sourcePlayer.mulligan_state, {});
  const initialDeckOrder = mapIds(sourcePlayer.initial_deck_order);
  const pendingByeDraws = Math.max(0, Math.floor(Number(input.pendingByeDraws || 0)));
  const pendingDrawState = applyArenaV2PendingByeDrawsForClone({
    handCardInstanceIds: mapIds(sourcePlayer.hand_card_instance_ids),
    deckCardInstanceIds: mapIds(sourcePlayer.deck_card_instance_ids),
    graveyardCardInstanceIds: mapIds(sourcePlayer.graveyard_card_instance_ids),
    pendingDraws: pendingByeDraws
  });
  const { handCardInstanceIds: hand, deckCardInstanceIds: deck, graveyardCardInstanceIds: graveyard } = pendingDrawState;

  await runSql(
    db,
    `
      INSERT INTO arena_v2_match_players
        (id, match_id, user_id, seat_no, deck_id, player_health, fatigue_count, initial_deck_order, hand_card_instance_ids, deck_card_instance_ids, graveyard_card_instance_ids, board_state, mulligan_state)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      makeDeterministicId('arena_v2_player', `${input.matchId}:${input.seatNo}:${input.userId}`),
      input.matchId,
      input.userId,
      input.seatNo,
      input.deckId,
      Math.max(0, Number(input.playerHealth ?? sourcePlayer.player_health ?? 30)),
      Math.max(0, Number(sourcePlayer.fatigue_count || 0)),
      JSON.stringify(initialDeckOrder),
      JSON.stringify(hand),
      JSON.stringify(deck),
      JSON.stringify(graveyard),
      JSON.stringify(boardState),
      JSON.stringify({
        ...sourceMulliganState,
        done: true,
        freeTacticalMoveCount: input.freeTacticalMoveNextRound ? 1 : 0,
        byeDrawsApplied: pendingByeDraws
      })
    ]
  );

  for (const sourceInstance of sourceInstances) {
    const instanceId = idBySourceId.get(String(sourceInstance.id));
    const zoneOverride = instanceId ? pendingDrawState.zoneOverrideByInstanceId[instanceId] : undefined;
    await runSql(
      db,
      `
        INSERT INTO arena_v2_card_instances
          (id, match_id, owner_seat_no, card_version_id, zone, position, current_attack, current_health, damage_taken, status_effects, created_turn)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        instanceId,
        input.matchId,
        input.seatNo,
        sourceInstance.card_version_id,
        zoneOverride || sourceInstance.zone,
        zoneOverride || sourceInstance.position == null ? null : JSON.stringify(jsonParse(sourceInstance.position, null)),
        Number(sourceInstance.current_attack || 0),
        Number(sourceInstance.current_health ?? 1),
        Math.max(0, Number(sourceInstance.damage_taken || 0)),
        JSON.stringify([]),
        Number(sourceInstance.created_turn || 0)
      ]
    );
  }
};

export const arenaV2TargetExists = async (targetType: ArenaV2ReportInput['targetType'], targetId: string): Promise<boolean> => {
  const db = getExecutor();
  if (!db) return false;
  const tableByTarget: Record<ArenaV2ReportInput['targetType'], string> = {
    card: 'arena_v2_card_versions',
    match: 'arena_v2_matches',
    replay: 'arena_v2_replay_events',
    user: 'users',
    battle_royale: 'arena_v2_battle_royales'
  };
  const table = tableByTarget[targetType];
  if (targetType === 'replay') {
    const row = await queryGet(db, `SELECT 1 AS ok FROM ${table} WHERE match_id = ? LIMIT 1`, [targetId]);
    return Boolean(row);
  }
  const row = await queryGet(db, `SELECT 1 AS ok FROM ${table} WHERE id = ? LIMIT 1`, [targetId]);
  return Boolean(row);
};

export const createArenaV2Report = async (input: ArenaV2ReportInput) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const id = makeId('arena_v2_report');
  await runSql(
    db,
    `
      INSERT INTO arena_v2_reports
        (id, reporter_user_id, target_type, target_id, reason, status)
      VALUES
        (?, ?, ?, ?, ?, 'received')
    `,
    [id, input.reporterUserId, input.targetType, input.targetId, input.reason]
  );
  return { id, status: 'received' as const };
};

export const listArenaV2ReportsForUser = async (userId: string, limit = 50) => {
  const db = getExecutor();
  if (!db) return [];
  return queryAll(
    db,
    `
      SELECT id, target_type, target_id, reason, status, admin_note, created_at, updated_at
        FROM arena_v2_reports
       WHERE reporter_user_id = ?
       ORDER BY created_at DESC
       LIMIT ?
    `,
    [userId, Math.min(Math.max(limit, 1), 100)]
  );
};

export const listArenaV2ReportsAdmin = async (status?: string, limit = 100) => {
  const db = getExecutor();
  if (!db) return [];
  const params: any[] = [];
  const statusFilter = status ? 'WHERE status = ?' : '';
  if (status) params.push(status);
  params.push(Math.min(Math.max(limit, 1), 200));
  return queryAll(
    db,
    `
      SELECT id, reporter_user_id, target_type, target_id, reason, status, admin_note, created_at, updated_at
        FROM arena_v2_reports
       ${statusFilter}
       ORDER BY created_at DESC
       LIMIT ?
    `,
    params
  );
};

export const reviewArenaV2ReportAdmin = async (reportId: string, reviewerUserId: string, status: 'actioned' | 'rejected', adminNote: string) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const existing = await queryGet<any>(db, 'SELECT id FROM arena_v2_reports WHERE id = ? LIMIT 1', [reportId]);
  if (!existing) throw new Error('ArenaV2ReportNotFound');
  await runSql(
    db,
    `
      UPDATE arena_v2_reports
         SET status = ?,
             admin_note = ?,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
    `,
    [status, adminNote || `reviewed_by:${reviewerUserId}`, reportId]
  );
  return { id: reportId, status };
};

export const createArenaV2StreamerRightRequest = async (input: ArenaV2StreamerRightRequestInput) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const id = makeId('arena_v2_right');
  await runSql(
    db,
    `
      INSERT INTO arena_v2_streamer_right_requests
        (id, streamer_id, requester_user_id, request_type, payload, status)
      VALUES
        (?, ?, ?, ?, ?, 'pending')
    `,
    [id, input.streamerId, input.requesterUserId, input.requestType, JSON.stringify(input.payload ?? {})]
  );
  return { id, status: 'pending' as const };
};

export const listArenaV2StreamerRightRequestsForUser = async (userId: string, streamerId?: string, limit = 50) => {
  const db = getExecutor();
  if (!db) return [];
  const params: any[] = [userId];
  const streamerFilter = streamerId ? 'AND streamer_id = ?' : '';
  if (streamerId) params.push(streamerId);
  params.push(Math.min(Math.max(limit, 1), 100));
  return queryAll(
    db,
    `
      SELECT id, streamer_id, request_type, payload, status, review_note, created_at, updated_at
        FROM arena_v2_streamer_right_requests
       WHERE requester_user_id = ?
       ${streamerFilter}
       ORDER BY created_at DESC
       LIMIT ?
    `,
    params
  );
};

export const listArenaV2StreamerRightRequestsAdmin = async (status?: string, limit = 100) => {
  const db = getExecutor();
  if (!db) return [];
  const params: any[] = [];
  const statusFilter = status ? 'WHERE status = ?' : '';
  if (status) params.push(status);
  params.push(Math.min(Math.max(limit, 1), 200));
  return queryAll(
    db,
    `
      SELECT id, streamer_id, requester_user_id, request_type, payload, status, reviewed_by, review_note, created_at, updated_at
        FROM arena_v2_streamer_right_requests
       ${statusFilter}
       ORDER BY created_at DESC
       LIMIT ?
    `,
    params
  );
};

export const reviewArenaV2StreamerRightRequestAdmin = async (requestId: string, reviewerUserId: string, status: 'approved' | 'rejected', reviewNote: string) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const existing = await queryGet<any>(
    db,
    'SELECT id, requester_user_id, request_type, payload FROM arena_v2_streamer_right_requests WHERE id = ? LIMIT 1',
    [requestId]
  );
  if (!existing) throw new Error('ArenaV2StreamerRightRequestNotFound');
  let appliedCard: unknown = null;
  if (status === 'approved' && existing.request_type === 'card_config') {
    const payload = jsonParse<Record<string, unknown>>(existing.payload, {});
    const result = await updateMyArenaV2StreamerCard({
      requesterUserId: existing.requester_user_id,
      cardClass: String(payload.cardClass || ''),
      cost: Number(payload.cost),
      attack: Number(payload.attack),
      health: Number(payload.health),
      keywords: Array.isArray(payload.keywords) ? payload.keywords : []
    });
    if (!result.accepted) {
      await runSql(
        db,
        `
          UPDATE arena_v2_streamer_right_requests
             SET status = 'rejected',
                 reviewed_by = ?,
                 review_note = ?,
                 updated_at = CURRENT_TIMESTAMP
           WHERE id = ?
        `,
        [reviewerUserId, reviewNote || JSON.stringify(result.validation), requestId]
      );
      return { id: requestId, status: 'rejected' as const, validation: result.validation };
    }
    appliedCard = result.card;
  }
  await runSql(
    db,
    `
      UPDATE arena_v2_streamer_right_requests
         SET status = ?,
             reviewed_by = ?,
             review_note = ?,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
    `,
    [status, reviewerUserId, reviewNote, requestId]
  );
  return { id: requestId, status, appliedCard };
};

export const holdArenaV2RewardGrantAdmin = async (grantId: string, reason: string) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  await runSql(
    db,
    `
      UPDATE arena_v2_reward_grants
         SET status = 'held',
             hold_reason = ?,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
    `,
    [reason, grantId]
  );
  return { id: grantId, status: 'held' as const };
};

export const releaseArenaV2RewardGrantAdmin = async (grantId: string) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  await runSql(
    db,
    `
      UPDATE arena_v2_reward_grants
         SET status = 'pending',
             hold_reason = NULL,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
    `,
    [grantId]
  );
  return { id: grantId, status: 'pending' as const };
};

export const createArenaV2ReplayHoldAdmin = async (matchId: string, adminUserId: string, reason: string, holdUntil?: string) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const match = await queryGet<any>(db, 'SELECT id FROM arena_v2_matches WHERE id = ? LIMIT 1', [matchId]);
  if (!match) throw new Error('ArenaV2MatchNotFound');
  const id = makeId('arena_v2_replay_hold');
  await runSql(
    db,
    `
      INSERT INTO arena_v2_replay_holds
        (id, match_id, reason, status, hold_until, created_by)
      VALUES
        (?, ?, ?, 'active', ?, ?)
    `,
    [id, matchId, reason, holdUntil || null, adminUserId]
  );
  return { id, matchId, status: 'active' as const };
};

export const previewArenaV2SeasonRewardsAdmin = async (seasonId: string) => {
  const rankings = await listArenaV2Rankings(seasonId, 200);
  const season = await getArenaV2SeasonById(seasonId);
  const rewardTable = Array.isArray(season?.rewardTable) ? season.rewardTable as ArenaV2RewardRule[] : [];
  const tiers: Record<string, number> = {};
  const grants = rankings.items.map((item) => {
    tiers[item.peakTier] = (tiers[item.peakTier] || 0) + 1;
    return {
      userId: item.userId,
      rank: item.rank,
      peakTier: item.peakTier,
      peakMmr: item.peakMmr,
      rewardItems: resolveArenaV2RewardItems(rewardTable, item)
    };
  });
  return {
    seasonId,
    tiers,
    totalPlayers: rankings.items.length,
    rewardRules: rewardTable.length,
    grants,
    duplicateRisk: false,
    heldAccounts: 0
  };
};

export const grantArenaV2SeasonRewardsAdmin = async (seasonId: string, dryRun: boolean, reason: string) => {
  const preview = await previewArenaV2SeasonRewardsAdmin(seasonId);
  if (dryRun) {
    return {
      dryRun,
      reason,
      preview,
      granted: 0,
      skipped: 0,
      status: 'preview'
    };
  }
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  let granted = 0;
  let skipped = 0;
  for (const grant of preview.grants) {
    const existing = await queryGet<any>(
      db,
      'SELECT id FROM arena_v2_reward_grants WHERE season_id = ? AND user_id = ? LIMIT 1',
      [seasonId, grant.userId]
    );
    if (existing) {
      skipped += 1;
      continue;
    }
    const rewardBasis = {
      reason,
      rank: grant.rank,
      peakTier: grant.peakTier,
      peakMmr: grant.peakMmr,
      generatedAt: new Date().toISOString()
    };
    await runSql(
      db,
      `
        INSERT INTO arena_v2_reward_grants
          (id, season_id, user_id, reward_basis, reward_items, status, hold_reason, idempotency_key, granted_at)
        VALUES
          (?, ?, ?, ?, ?, 'pending', NULL, ?, NULL)
      `,
      [
        makeId('arena_v2_reward'),
        seasonId,
        grant.userId,
        JSON.stringify(rewardBasis),
        JSON.stringify(grant.rewardItems),
        `arena-v2:${seasonId}:${grant.userId}`
      ]
    );
    granted += 1;
  }
  return {
    dryRun,
    reason,
    preview,
    granted,
    skipped,
    status: 'grants_created'
  };
};

function resolveArenaV2RewardItems(rewardTable: ArenaV2RewardRule[], ranking: { rank: number; peakTier: string; peakMmr: number }) {
  const items: unknown[] = [];
  for (const rule of rewardTable) {
    const tiers = new Set([rule.tier, ...(Array.isArray(rule.tiers) ? rule.tiers : [])].filter(Boolean).map((tier) => String(tier).toLowerCase()));
    const rankMin = Number(rule.rankMin ?? rule.minRank ?? 1);
    const rankMax = Number(rule.rankMax ?? rule.maxRank ?? Number.MAX_SAFE_INTEGER);
    const tierMatches = tiers.size === 0 || tiers.has(String(ranking.peakTier).toLowerCase());
    const rankMatches = ranking.rank >= rankMin && ranking.rank <= rankMax;
    if (!tierMatches || !rankMatches) continue;
    const ruleItems = Array.isArray(rule.items)
      ? rule.items
      : Array.isArray(rule.rewards)
        ? rule.rewards
        : Array.isArray(rule.rewardItems)
          ? rule.rewardItems
          : [];
    items.push(...ruleItems);
  }
  return items;
}

export const recordArenaV2OpsFlagAdmin = async (adminUserId: string, flag: string, enabled: boolean, reason: string) => ({
  flag,
  enabled,
  reason,
  updatedBy: adminUserId,
  updatedAt: new Date().toISOString()
});
