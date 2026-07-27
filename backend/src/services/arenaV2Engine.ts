import type {
  ArenaV2BoardPositionDto,
  ArenaV2BoardRowDto,
  ArenaV2CardVersionDto,
  ArenaV2KeywordDto,
  ArenaV2TurnActionDto,
  ArenaV2ValidationIssueDto,
  ArenaV2ValidationResultDto
} from '@chikapo/arena-contract';

export const ARENA_V2_DECK_MIN_CARD_COUNT = 14;
export const ARENA_V2_DECK_MAX_CARD_COUNT = 20;
export const ARENA_V2_BOARD_ROWS = 2;
export const ARENA_V2_BOARD_COLUMNS = 3;
export const ARENA_V2_TURN_SECONDS = 40;
export const ARENA_V2_MAX_COST = 9;
export const ARENA_V2_TACTICAL_MOVE_COST = 1;
export const ARENA_V2_TACTICAL_MOVES_PER_TURN = 1;
export const ARENA_V2_INITIAL_PLAYER_HEALTH = 30;
export const ARENA_V2_MAX_HAND_SIZE = 8;
export const ARENA_V2_FIRST_DRAW_TURN = 2;
export const ARENA_V2_HEALTH_CHECK_TURN = 9;
export const ARENA_V2_SUDDEN_DEATH_TURN = 10;

export interface ArenaV2DeckValidationInput {
  seasonId: string;
  cardVersionIds: string[];
  cardsByVersionId: Record<string, ArenaV2DeckCardVersion>;
}

export type ArenaV2DeckCardVersion = Pick<
  ArenaV2CardVersionDto,
  'id' | 'streamerId' | 'seasonId' | 'status' | 'cardClass' | 'cost' | 'attack' | 'health' | 'keywords'
> & {
  validationResult?: Partial<ArenaV2ValidationResultDto> | null;
};

export interface ArenaV2CardInstanceForAction {
  id: string;
  cardVersionId: string;
  cost: number;
  createdTurn: number;
}

export interface ArenaV2BoardCard {
  cardInstanceId: string;
  position: ArenaV2BoardPositionDto;
  createdTurn: number;
}

export interface ArenaV2ActionValidationInput {
  turnNo: number;
  availableCost: number;
  handCardInstanceIds: string[];
  boardCards: ArenaV2BoardCard[];
  cardInstancesById: Record<string, ArenaV2CardInstanceForAction>;
  actions: ArenaV2TurnActionDto[];
  freeTacticalMoveCount?: number;
}

export interface ArenaV2RuntimePlayer {
  seatNo: number;
  userId: string | null;
  deckId: string | null;
  playerHealth: number;
  handCardInstanceIds: string[];
  deckCardInstanceIds: string[];
  graveyardCardInstanceIds: string[];
  boardState: ArenaV2BoardCard[];
  fatigueCount?: number;
  mulliganState?: unknown;
}

export interface ArenaV2RuntimeCardInstance {
  id: string;
  ownerSeatNo: number;
  cardVersionId: string;
  zone: string;
  position: ArenaV2BoardPositionDto | null;
  currentAttack: number;
  currentHealth: number;
  damageTaken: number;
  statusEffects: unknown[];
  createdTurn: number;
  card?: Pick<ArenaV2CardVersionDto, 'id' | 'cost' | 'attack' | 'health' | 'displayName' | 'cardClass'> & {
    keywords?: ArenaV2KeywordDto[];
  };
}

export interface ArenaV2ReplayEvent {
  seq?: number;
  turnNo: number;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface ArenaV2TurnResolutionInput {
  matchId: string;
  mode: string;
  turnNo: number;
  seed: string;
  players: ArenaV2RuntimePlayer[];
  cardInstances: ArenaV2RuntimeCardInstance[];
  actionsBySeatNo: Record<number, ArenaV2TurnActionDto[]>;
}

export interface ArenaV2TurnResolutionResult {
  nextStatus: 'turn_planning' | 'completed';
  nextTurnNo: number;
  winnerSeatNo: number | null;
  winnerUserId: string | null;
  result: 'in_progress' | 'win' | 'draw';
  summary: Record<string, unknown>;
  players: ArenaV2RuntimePlayer[];
  cardInstances: ArenaV2RuntimeCardInstance[];
  replayEvents: ArenaV2ReplayEvent[];
}

interface MutableBoardSlot {
  cardInstanceId: string;
  createdTurn: number;
}

type BoardMap = Map<string, MutableBoardSlot>;

interface ArenaV2CombatContext {
  directDamageTakenBySeatNo: Map<number, number>;
  shieldByInstanceId: Map<string, number>;
  stunnedInstanceIds: Set<string>;
  silencedInstanceIds: Set<string>;
  revivedInstanceIds: Set<string>;
}

interface ArenaV2BoardSlot {
  instance: ArenaV2RuntimeCardInstance;
  position: ArenaV2BoardPositionDto;
}

interface ArenaV2DefeatedRecord {
  player: ArenaV2RuntimePlayer;
  instance: ArenaV2RuntimeCardInstance;
  position: ArenaV2BoardPositionDto;
}

const issue = (code: string, message: string): ArenaV2ValidationIssueDto => ({ code, message });

const result = (errors: ArenaV2ValidationIssueDto[], warnings: ArenaV2ValidationIssueDto[] = []): ArenaV2ValidationResultDto => ({
  valid: errors.length === 0,
  errors,
  warnings
});

export const ARENA_V2_CARD_BUDGET_BY_COST: Record<number, number> = {
  1: 5,
  2: 8,
  3: 12,
  4: 16,
  5: 21,
  6: 27,
  7: 34,
  8: 42,
  9: 51
};

export const ARENA_V2_CARD_STAT_LIMITS_BY_COST: Record<number, { attackMax: number; healthMax: number }> = {
  1: { attackMax: 1, healthMax: 4 },
  2: { attackMax: 2, healthMax: 6 },
  3: { attackMax: 3, healthMax: 8 },
  4: { attackMax: 4, healthMax: 10 },
  5: { attackMax: 5, healthMax: 12 },
  6: { attackMax: 6, healthMax: 14 },
  7: { attackMax: 7, healthMax: 16 },
  8: { attackMax: 8, healthMax: 18 },
  9: { attackMax: 9, healthMax: 20 }
};

const ARENA_V2_CARD_CLASSES = new Set(['charge', 'guardian', 'sniper', 'support', 'trick', 'specter', 'tech']);

const normalizeKeywordType = (type: unknown): string => {
  const raw = String(type || '').trim().toLowerCase();
  const aliases: Record<string, string> = {
    도발: 'taunt',
    보호막: 'shield',
    보호: 'shield',
    '피해 감소': 'damage_reduction',
    피해감소: 'damage_reduction',
    관통: 'pierce',
    추격: 'pursuit',
    '직접 압박': 'direct_pressure',
    직접압박: 'direct_pressure',
    '후열 압박': 'backline_pressure',
    후열압박: 'backline_pressure',
    '약점 공격': 'weakpoint',
    약점공격: 'weakpoint',
    '광역 피해': 'aoe_damage',
    광역피해: 'aoe_damage',
    조준: 'aim',
    저격: 'aim',
    snipe: 'aim',
    침묵: 'silence',
    기절: 'stun',
    밀치기: 'push',
    끌어오기: 'pull',
    끌기: 'pull',
    약화: 'weaken',
    '전투 드로우': 'battle_draw',
    전투드로우: 'battle_draw',
    '응급 회복': 'emergency_heal',
    응급회복: 'emergency_heal',
    '보호 지원': 'guard_support',
    보호지원: 'guard_support',
    '공격 지원': 'attack_support',
    공격지원: 'attack_support',
    '묘지 강화': 'grave_buff',
    묘지강화: 'grave_buff',
    '묘지 회수': 'grave_recover',
    묘지회수: 'grave_recover',
    graveyard_recover: 'grave_recover',
    부활: 'revive',
    흡혈: 'lifesteal',
    drain: 'lifesteal',
    반격: 'counter',
    원한: 'vengeance',
    원혼: 'grudge',
    spirit: 'grudge',
    잔재: 'remnant',
    residue: 'remnant',
    망령: 'specter'
  };
  return aliases[raw] || raw;
};

const keywordValue = (keyword: ArenaV2KeywordDto): number | undefined => {
  if (keyword.value == null) return undefined;
  const value = Number(keyword.value);
  return Number.isInteger(value) ? value : undefined;
};

const keywordLimit = (keyword: ArenaV2KeywordDto): string => String(keyword.limit || '').trim().toLowerCase();

const keywordHasValue = (keywords: ArenaV2KeywordDto[], type: string, value?: number): boolean => keywords.some((keyword) => {
  if (normalizeKeywordType(keyword.type) !== type) return false;
  return value == null || keywordValue(keyword) === value;
});

const keywordCost = (keyword: ArenaV2KeywordDto): number | null => {
  const type = normalizeKeywordType(keyword.type);
  const value = keywordValue(keyword);
  switch (type) {
    case 'taunt': return 4;
    case 'shield':
      return value && value >= 1 && value <= 5 ? value : null;
    case 'damage_reduction':
      if (value === 1) return 4;
      if (value === 2) return 7;
      return null;
    case 'counter':
      if (value === 1) return 4;
      if (value === 2) return 7;
      return null;
    case 'lifesteal':
      if (value === 1) return 6;
      if (value === 2) return 10;
      return null;
    case 'revive': return 18;
    case 'pierce': return 6;
    case 'pursuit':
      if (value === 1) return 5;
      if (value === 2) return 9;
      return null;
    case 'direct_pressure':
      if (value === 1) return 7;
      if (value === 2) return 12;
      return null;
    case 'backline_pressure': return 5;
    case 'weakpoint': return 5;
    case 'aoe_damage':
      if (value === 1) return 8;
      if (value === 2) return 14;
      return null;
    case 'aim': return 8;
    case 'silence': return 8;
    case 'stun': return 10;
    case 'push': return 6;
    case 'pull': return 7;
    case 'weaken':
      if (value === 1) return 5;
      if (value === 2) return 9;
      return null;
    case 'battle_draw': return 6;
    case 'emergency_heal':
      if (value === 1) return 7;
      if (value === 2) return 12;
      return null;
    case 'guard_support': return 4;
    case 'attack_support': return 5;
    case 'grave_buff': return 6;
    case 'grave_recover': {
      const limit = keywordLimit(keyword);
      if (limit === 'cost_2' || limit === '2_cost_or_less' || limit === 'low_cost_2') return 8;
      if (limit === 'specter') return 9;
      if (limit === 'same_class') return 11;
      if (limit === 'cost_4' || limit === '4_cost_or_less') return 12;
      if (limit === 'self_cost') return 14;
      if (limit === 'any' || limit === 'unlimited' || limit === '') return 18;
      return null;
    }
    case 'vengeance':
      if (value === 1) return 4;
      if (value === 2) return 7;
      return null;
    case 'grudge':
      if (value === 1) return 10;
      if (value === 2) return 18;
      return null;
    case 'remnant':
      if (value === 1) return 5;
      if (value === 2) return 8;
      return null;
    default:
      return null;
  }
};

const comboSurcharge = (card: ArenaV2DeckCardVersion, keywords: ArenaV2KeywordDto[]): number => {
  const has = (type: string) => keywords.some((keyword) => normalizeKeywordType(keyword.type) === type);
  const hasDamageReduction = has('damage_reduction');
  const hasGraveRecover = has('grave_recover');
  let surcharge = 0;

  if (has('pierce') && card.attack >= 4) surcharge += 2;
  if (has('pierce') && card.attack >= 6) surcharge += 3;
  if (has('pierce') && has('lifesteal')) surcharge += 5;
  if (has('pierce') && has('pursuit')) surcharge += 3;
  if (has('direct_pressure') && card.attack >= 4) surcharge += 3;
  if (has('direct_pressure') && card.attack >= 6) surcharge += 4;
  if (has('direct_pressure') && has('backline_pressure')) surcharge += 3;
  if (has('direct_pressure') && has('pierce')) surcharge += 3;
  if (has('direct_pressure') && card.cardClass === 'charge') surcharge += 2;
  if (has('aim') && card.attack >= 3) surcharge += 2;
  if (has('aim') && card.attack >= 5) surcharge += 3;
  if (has('aim') && has('silence')) surcharge += 4;
  if (has('aim') && has('stun')) surcharge += 5;
  if (has('aim') && has('weaken')) surcharge += 2;
  if (has('aim') && has('lifesteal')) surcharge += 3;
  if (has('aim') && has('pursuit')) surcharge += 3;
  if (has('silence') && has('stun')) surcharge += 5;
  if (has('silence') && has('aoe_damage')) surcharge += 5;
  if (has('stun') && has('aoe_damage')) surcharge += 6;
  if (has('taunt') && hasDamageReduction) surcharge += 3;
  if (has('taunt') && keywords.some((keyword) => normalizeKeywordType(keyword.type) === 'shield' && Number(keyword.value || 0) >= 3)) surcharge += 2;
  if (has('taunt') && has('counter')) surcharge += 2;
  if (has('taunt') && has('revive')) surcharge += 8;
  if (has('taunt') && has('lifesteal')) surcharge += 3;
  if (card.cardClass === 'guardian' && has('revive')) surcharge += 6;
  if (has('revive') && hasDamageReduction) surcharge += 6;
  if (has('revive') && has('lifesteal')) surcharge += 7;
  if (has('revive') && has('vengeance')) surcharge += 6;
  if (has('revive') && has('grudge')) surcharge += 10;
  if (has('revive') && hasGraveRecover) surcharge += 10;
  if (card.cardClass === 'support' && has('vengeance')) surcharge += 3;
  if (card.cardClass === 'support' && has('grudge')) surcharge += 5;
  if (card.cardClass === 'support' && has('revive')) surcharge += 6;
  if (card.cardClass === 'support' && hasGraveRecover) surcharge += 4;
  if (has('battle_draw') && hasGraveRecover) surcharge += 5;
  if (hasGraveRecover && has('grudge')) surcharge += 6;
  if (has('grudge') && card.cost <= 2) surcharge += 4;

  return surcharge;
};

export interface ArenaV2CardBudgetBreakdown {
  budgetLimit: number | null;
  attackCost: number;
  healthCost: number;
  statCost: number;
  keywordItems: Array<{ type: string; value?: number; limit?: string; cost: number | null }>;
  keywordCost: number;
  comboCost: number;
  totalCost: number;
  remaining: number | null;
  isOverBudget: boolean;
}

export function evaluateArenaV2CardBudget(card: ArenaV2DeckCardVersion): ArenaV2CardBudgetBreakdown {
  const attackCost = Math.max(0, Number(card.attack) || 0) * 3;
  const healthCost = Math.max(0, Number(card.health) || 0);
  const keywords = Array.isArray(card.keywords) ? card.keywords : [];
  const keywordItems = keywords.map((keyword) => ({
    type: normalizeKeywordType(keyword.type),
    ...(keywordValue(keyword) != null ? { value: keywordValue(keyword) } : {}),
    ...(keywordLimit(keyword) ? { limit: keywordLimit(keyword) } : {}),
    cost: keywordCost(keyword)
  }));
  const keywordCostTotal = keywordItems.reduce((sum, item) => sum + (item.cost || 0), 0);
  const comboCost = comboSurcharge(card, keywords);
  const totalCost = attackCost + healthCost + keywordCostTotal + comboCost;
  const budgetLimit = ARENA_V2_CARD_BUDGET_BY_COST[Number(card.cost)] ?? null;
  const remaining = budgetLimit == null ? null : budgetLimit - totalCost;
  return {
    budgetLimit,
    attackCost,
    healthCost,
    statCost: attackCost + healthCost,
    keywordItems,
    keywordCost: keywordCostTotal,
    comboCost,
    totalCost,
    remaining,
    isOverBudget: remaining != null && remaining < 0
  };
}

export function validateArenaV2CardVersionDefinition(card: ArenaV2DeckCardVersion): ArenaV2ValidationResultDto {
  const errors: ArenaV2ValidationIssueDto[] = [];
  const warnings: ArenaV2ValidationIssueDto[] = [];
  const cost = Number(card.cost);
  const attack = Number(card.attack);
  const health = Number(card.health);
  const keywords = Array.isArray(card.keywords) ? card.keywords : [];

  if (card.validationResult && card.validationResult.valid === false) {
    errors.push(issue('ArenaV2CardStoredValidationFailed', '저장된 카드 검증 결과가 실패 상태입니다.'));
  }
  if (!ARENA_V2_CARD_CLASSES.has(String(card.cardClass))) {
    errors.push(issue('ArenaV2CardInvalidClass', '카드 클래스가 GDD 데이터 사전에 없습니다.'));
  }
  if (!Number.isInteger(cost) || cost < 1 || cost > ARENA_V2_MAX_COST) {
    errors.push(issue('ArenaV2CardInvalidCost', '카드 코스트는 1~9 정수여야 합니다.'));
  }
  if (!Number.isInteger(attack) || attack < 0) {
    errors.push(issue('ArenaV2CardInvalidAttack', '카드 공격력은 0 이상의 정수여야 합니다.'));
  }
  if (!Number.isInteger(health) || health < 1) {
    errors.push(issue('ArenaV2CardInvalidHealth', '카드 체력은 1 이상의 정수여야 합니다.'));
  }
  if (!Array.isArray(card.keywords)) {
    errors.push(issue('ArenaV2CardInvalidKeywords', '카드 키워드는 배열이어야 합니다.'));
  }
  if (keywords.length > 3) {
    errors.push(issue('ArenaV2CardTooManyKeywords', '카드는 최대 3개의 키워드만 가질 수 있습니다.'));
  }
  const normalizedKeywordTypes = keywords.map((keyword) => normalizeKeywordType(keyword.type));
  if (new Set(normalizedKeywordTypes).size !== normalizedKeywordTypes.length) {
    errors.push(issue('ArenaV2CardDuplicateKeyword', '같은 키워드는 한 번만 선택할 수 있습니다.'));
  }

  const statLimits = ARENA_V2_CARD_STAT_LIMITS_BY_COST[cost];
  if (statLimits) {
    if (attack > statLimits.attackMax) {
      errors.push(issue('ArenaV2CardAttackLimitExceeded', '카드 공격력이 코스트별 상한을 넘었습니다.'));
    }
    if (health > statLimits.healthMax) {
      errors.push(issue('ArenaV2CardHealthLimitExceeded', '카드 체력이 코스트별 상한을 넘었습니다.'));
    }
  }

  for (const keyword of keywords) {
    const costForKeyword = keywordCost(keyword);
    if (costForKeyword == null) {
      errors.push(issue('ArenaV2CardInvalidKeyword', `지원하지 않거나 파라미터가 잘못된 키워드가 포함되어 있습니다: ${String(keyword.type || '')}`));
    }
  }

  const has = (type: string) => keywords.some((keyword) => normalizeKeywordType(keyword.type) === type);
  const hasGraveRecover = has('grave_recover');
  if (cost === 1 && has('direct_pressure')) errors.push(issue('ArenaV2CardForbiddenCombo', '1코스트 카드는 직접 압박을 가질 수 없습니다.'));
  if (cost === 1 && has('grudge')) errors.push(issue('ArenaV2CardForbiddenCombo', '1코스트 카드는 원혼을 가질 수 없습니다.'));
  if (cost === 1 && hasGraveRecover) errors.push(issue('ArenaV2CardForbiddenCombo', '1코스트 카드는 묘지 회수를 가질 수 없습니다.'));
  if (cost === 1 && has('battle_draw')) errors.push(issue('ArenaV2CardForbiddenCombo', '1코스트 카드는 전투 드로우를 가질 수 없습니다.'));
  if (cost === 2 && has('revive')) errors.push(issue('ArenaV2CardForbiddenCombo', '2코스트 카드는 부활을 가질 수 없습니다.'));
  if (has('revive') && keywordHasValue(keywords, 'grudge', 2)) errors.push(issue('ArenaV2CardForbiddenCombo', '부활과 원혼 2 조합은 금지됩니다.'));
  if (has('aim') && has('stun') && attack >= 5) errors.push(issue('ArenaV2CardForbiddenCombo', '조준, 기절, 공격력 5 이상 조합은 금지됩니다.'));
  if (has('silence') && has('stun') && has('aoe_damage')) errors.push(issue('ArenaV2CardForbiddenCombo', '침묵, 기절, 광역 피해 조합은 금지됩니다.'));
  if (hasGraveRecover && has('battle_draw')) errors.push(issue('ArenaV2CardForbiddenCombo', '묘지 회수와 전투 드로우 조합은 금지됩니다.'));
  if (keywordHasValue(keywords, 'direct_pressure', 2) && attack >= 6) errors.push(issue('ArenaV2CardForbiddenCombo', '직접 압박 2와 공격력 6 이상 조합은 금지됩니다.'));

  const budget = evaluateArenaV2CardBudget(card);
  if (budget.isOverBudget) {
    errors.push(issue('ArenaV2CardBudgetExceeded', '카드 총 비용이 코스트별 총 예산을 넘었습니다.'));
  }

  return result(errors, warnings);
}

export function arenaV2BoardKey(position: ArenaV2BoardPositionDto): string {
  return `${position.row}:${position.column}`;
}

export function isArenaV2BoardPosition(value: unknown): value is ArenaV2BoardPositionDto {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ArenaV2BoardPositionDto>;
  return (candidate.row === 'front' || candidate.row === 'back')
    && (candidate.column === 0 || candidate.column === 1 || candidate.column === 2);
}

export function validateArenaV2Deck(input: ArenaV2DeckValidationInput): ArenaV2ValidationResultDto {
  const errors: ArenaV2ValidationIssueDto[] = [];
  const { cardVersionIds, cardsByVersionId, seasonId } = input;

  if (cardVersionIds.length < ARENA_V2_DECK_MIN_CARD_COUNT) {
    errors.push(issue('ArenaV2DeckTooSmall', `덱은 최소 ${ARENA_V2_DECK_MIN_CARD_COUNT}장이어야 합니다.`));
  }
  if (cardVersionIds.length > ARENA_V2_DECK_MAX_CARD_COUNT) {
    errors.push(issue('ArenaV2DeckTooLarge', `덱은 최대 ${ARENA_V2_DECK_MAX_CARD_COUNT}장까지 가능합니다.`));
  }

  const seenVersionIds = new Set<string>();
  const seenStreamerIds = new Set<string>();
  for (const cardVersionId of cardVersionIds) {
    if (seenVersionIds.has(cardVersionId)) {
      errors.push(issue('ArenaV2DuplicateCardVersion', '동일 카드 버전은 덱에 1장만 넣을 수 있습니다.'));
      continue;
    }
    seenVersionIds.add(cardVersionId);

    const card = cardsByVersionId[cardVersionId];
    if (!card) {
      errors.push(issue('ArenaV2CardVersionNotFound', '존재하지 않는 카드 버전이 포함되어 있습니다.'));
      continue;
    }
    if (card.seasonId !== seasonId) {
      errors.push(issue('ArenaV2CardSeasonMismatch', '다른 시즌의 카드 버전이 포함되어 있습니다.'));
    }
    if (card.status !== 'active') {
      errors.push(issue('ArenaV2CardVersionInactive', '공식 모드에 사용할 수 없는 카드 버전이 포함되어 있습니다.'));
    }
    const cardValidation = validateArenaV2CardVersionDefinition(card);
    for (const cardError of cardValidation.errors) {
      errors.push(issue(cardError.code, `${card.id}: ${cardError.message}`));
    }
    if (seenStreamerIds.has(card.streamerId)) {
      errors.push(issue('ArenaV2DuplicateStreamerCard', '동일 스트리머 카드는 덱에 1장만 넣을 수 있습니다.'));
    } else {
      seenStreamerIds.add(card.streamerId);
    }
  }

  return result(errors);
}

export function validateArenaV2TurnAction(input: ArenaV2ActionValidationInput): ArenaV2ValidationResultDto {
  const errors: ArenaV2ValidationIssueDto[] = [];
  const hand = new Set(input.handCardInstanceIds);
  const board = buildBoard(input.boardCards, errors);
  const occupiedAtTurnStart = new Set(board.keys());
  const movedCards = new Set<string>();
  const placedThisTurn = new Set<string>();
  const placedTargets = new Set<string>();
  let spentCost = 0;
  let tacticalMoveCount = 0;
  const freeTacticalMoveCount = Math.max(0, Math.floor(Number(input.freeTacticalMoveCount || 0)));

  const orderedActions = [
    ...input.actions.filter((action) => action.type === 'move'),
    ...input.actions.filter((action) => action.type === 'place'),
    ...input.actions.filter((action) => action.type === 'replace'),
    ...input.actions.filter((action) => action.type === 'end')
  ];

  for (const action of orderedActions) {
    if (action.type === 'end') continue;

    if (action.type === 'move') {
      if (!isArenaV2BoardPosition(action.from) || !isArenaV2BoardPosition(action.to)) {
        errors.push(issue('ArenaV2InvalidBoardPosition', '전술 이동 위치가 2x3 필드 범위를 벗어났습니다.'));
        continue;
      }

      const fromKey = arenaV2BoardKey(action.from);
      const toKey = arenaV2BoardKey(action.to);
      const movingSlot = board.get(fromKey);
      if (!movingSlot || movingSlot.cardInstanceId !== action.cardInstanceId) {
        errors.push(issue('ArenaV2MoveSourceInvalid', '전술 이동 대상 카드가 시작 위치에 없습니다.'));
        continue;
      }
      if (!occupiedAtTurnStart.has(fromKey)) {
        errors.push(issue('ArenaV2MoveRequiresStartingCard', '이번 턴 새로 배치한 카드는 전술 이동할 수 없습니다.'));
        continue;
      }
      if (movingSlot.createdTurn === input.turnNo) {
        errors.push(issue('ArenaV2MoveNewCard', '이번 턴 새로 배치한 카드는 전술 이동할 수 없습니다.'));
        continue;
      }
      if (board.has(toKey)) {
        errors.push(issue('ArenaV2MoveTargetOccupied', '전술 이동은 빈 칸으로만 가능합니다.'));
        continue;
      }
      if (!occupiedAtTurnStart.has(toKey)) {
        board.delete(fromKey);
        board.set(toKey, movingSlot);
        movedCards.add(action.cardInstanceId);
        tacticalMoveCount += 1;
        spentCost += tacticalMoveCount <= freeTacticalMoveCount ? 0 : ARENA_V2_TACTICAL_MOVE_COST;
      } else {
        errors.push(issue('ArenaV2MoveTargetWasOccupiedAtStart', '전술 이동 목적지는 시작 필드 기준 빈 칸이어야 합니다.'));
      }
      continue;
    }

    if (action.type === 'place') {
      if (!isArenaV2BoardPosition(action.to)) {
        errors.push(issue('ArenaV2InvalidBoardPosition', '배치 위치가 2x3 필드 범위를 벗어났습니다.'));
        continue;
      }
      const targetKey = arenaV2BoardKey(action.to);
      if (!hand.has(action.cardInstanceId)) {
        errors.push(issue('ArenaV2CardNotInHand', '손패에 없는 카드는 배치할 수 없습니다.'));
        continue;
      }
      if (board.has(targetKey)) {
        errors.push(issue('ArenaV2PlaceTargetOccupied', '기존 카드가 있는 칸에는 배치할 수 없습니다.'));
        continue;
      }
      if (placedTargets.has(targetKey)) {
        errors.push(issue('ArenaV2DuplicatePlacementTarget', '같은 칸에 두 개 이상의 신규 배치를 할 수 없습니다.'));
        continue;
      }
      const card = input.cardInstancesById[action.cardInstanceId];
      if (!card) {
        errors.push(issue('ArenaV2CardInstanceNotFound', '카드 인스턴스를 찾을 수 없습니다.'));
        continue;
      }
      hand.delete(action.cardInstanceId);
      board.set(targetKey, { cardInstanceId: action.cardInstanceId, createdTurn: input.turnNo });
      placedThisTurn.add(action.cardInstanceId);
      placedTargets.add(targetKey);
      spentCost += card.cost;
      continue;
    }

    if (action.type === 'replace') {
      if (!isArenaV2BoardPosition(action.target)) {
        errors.push(issue('ArenaV2InvalidBoardPosition', '교체 위치가 2x3 필드 범위를 벗어났습니다.'));
        continue;
      }
      const targetKey = arenaV2BoardKey(action.target);
      const replacedSlot = board.get(targetKey);
      if (!replacedSlot) {
        errors.push(issue('ArenaV2ReplaceTargetEmpty', '교체는 기존 카드가 있는 칸에만 가능합니다.'));
        continue;
      }
      if (replacedSlot.createdTurn === input.turnNo || placedThisTurn.has(replacedSlot.cardInstanceId)) {
        errors.push(issue('ArenaV2ReplaceNewCard', '이번 턴 새로 배치한 카드는 같은 턴에 교체 대상이 될 수 없습니다.'));
        continue;
      }
      if (!hand.has(action.handCardInstanceId)) {
        errors.push(issue('ArenaV2CardNotInHand', '손패에 없는 카드는 교체에 사용할 수 없습니다.'));
        continue;
      }
      const card = input.cardInstancesById[action.handCardInstanceId];
      if (!card) {
        errors.push(issue('ArenaV2CardInstanceNotFound', '카드 인스턴스를 찾을 수 없습니다.'));
        continue;
      }
      hand.delete(action.handCardInstanceId);
      board.set(targetKey, { cardInstanceId: action.handCardInstanceId, createdTurn: input.turnNo });
      spentCost += card.cost;
    }
  }

  if (tacticalMoveCount > ARENA_V2_TACTICAL_MOVES_PER_TURN) {
    errors.push(issue('ArenaV2TooManyTacticalMoves', '전술 이동은 턴당 1회만 가능합니다.'));
  }
  if (movedCards.size < tacticalMoveCount) {
    errors.push(issue('ArenaV2DuplicateMoveCard', '같은 카드를 한 턴에 두 번 전술 이동할 수 없습니다.'));
  }
  if (spentCost > input.availableCost) {
    errors.push(issue('ArenaV2InsufficientCost', '사용 가능한 코스트를 초과했습니다.'));
  }

  return result(errors);
}

export function resolveArenaV2Turn(input: ArenaV2TurnResolutionInput): ArenaV2TurnResolutionResult {
  const players = input.players.map(cloneRuntimePlayer);
  const instances = input.cardInstances.map(cloneRuntimeCardInstance);
  const replayEvents: ArenaV2ReplayEvent[] = [];
  const instanceById = new Map(instances.map((instance) => [instance.id, instance]));
  const playerBySeat = new Map(players.map((player) => [player.seatNo, player]));
  const combatContext: ArenaV2CombatContext = {
    directDamageTakenBySeatNo: new Map(),
    shieldByInstanceId: new Map(),
    stunnedInstanceIds: new Set(),
    silencedInstanceIds: new Set(),
    revivedInstanceIds: new Set()
  };

  const turnStartEvent = event(input.turnNo, 'turn_start', {
    matchId: input.matchId,
    turnNo: input.turnNo,
    cost: getArenaV2AvailableCost(input.turnNo),
    replayVersion: 2
  });
  replayEvents.push(turnStartEvent);

  for (const player of players) {
    applyActionsForSeat({
      turnNo: input.turnNo,
      player,
      instances: instanceById,
      actions: input.actionsBySeatNo[player.seatNo] || [],
      replayEvents
    });
  }
  syncBoardInstancePositions(players, instanceById);
  turnStartEvent.payload.combatSnapshot = buildPublicCombatSnapshot(players, instanceById);
  combatContext.shieldByInstanceId = initializeCombatShields(players, instanceById);

  resolveCombatPhase('front', input.mode, input.turnNo, players, instanceById, replayEvents, combatContext);
  moveDefeatedCards(players, instanceById, input.turnNo, replayEvents, combatContext);
  resolveCombatPhase('back', input.mode, input.turnNo, players, instanceById, replayEvents, combatContext);
  moveDefeatedCards(players, instanceById, input.turnNo, replayEvents, combatContext);

  if (input.mode === 'battle_royale_8') {
    const roundResult = decideArenaV2BattleRoyaleRoundWinner(
      players,
      combatContext.directDamageTakenBySeatNo,
      replayEvents
    );
    const battleRoyaleRound = {
      roundNo: input.turnNo,
      winnerSeatNo: roundResult.winnerSeatNo,
      winnerUserId: roundResult.winnerUserId,
      result: roundResult.result,
      roundStats: roundResult.roundStats
    };
    replayEvents.push(event(input.turnNo, 'battle_royale_round_result', battleRoyaleRound));
    const nextRoundNo = input.turnNo + 1;
    for (const player of players) {
      drawForNextTurn(player, instanceById, nextRoundNo, replayEvents);
    }
    return buildResolutionResult(input, players, instances, replayEvents, roundResult, { battleRoyaleRound });
  }

  const winnerAfterCombat = decideArenaV2Winner(players, input.turnNo, combatContext.directDamageTakenBySeatNo);
  if (winnerAfterCombat.completed) {
    return buildResolutionResult(input, players, instances, replayEvents, winnerAfterCombat);
  }

  const nextTurnNo = input.turnNo + 1;
  for (const player of players) {
    drawForNextTurn(player, instanceById, nextTurnNo, replayEvents);
  }

  const winnerAfterDraw = decideArenaV2Winner(players, input.turnNo);
  if (winnerAfterDraw.completed) {
    return buildResolutionResult(input, players, instances, replayEvents, winnerAfterDraw);
  }

  replayEvents.push(event(input.turnNo, 'turn_end', {
    nextTurnNo,
    playerHealth: players.map((player) => ({ seatNo: player.seatNo, health: player.playerHealth }))
  }));

  return {
    nextStatus: 'turn_planning',
    nextTurnNo,
    winnerSeatNo: null,
    winnerUserId: null,
    result: 'in_progress',
    summary: {
      status: 'turn_planning',
      resolvedTurnNo: input.turnNo,
      nextTurnNo,
      health: players.map((player) => ({
        seatNo: player.seatNo,
        userId: player.userId,
        health: player.playerHealth,
        fatigueCount: player.fatigueCount || 0
      }))
    },
    players,
    cardInstances: instances,
    replayEvents
  };
}

export function getArenaV2FreeTacticalMoveCount(mulliganState: unknown): number {
  if (!mulliganState || typeof mulliganState !== 'object' || Array.isArray(mulliganState)) return 0;
  const value = (mulliganState as Record<string, unknown>).freeTacticalMoveCount
    ?? (mulliganState as Record<string, unknown>).freeTacticalMove;
  if (value === true) return 1;
  return Math.max(0, Math.floor(Number(value || 0)));
}

export function getArenaV2AvailableCost(turnNo: number): number {
  return Math.min(ARENA_V2_MAX_COST, Math.max(1, turnNo));
}

export function createArenaV2BotTurnActions(input: {
  turnNo: number;
  handCardInstanceIds: string[];
  boardCards: ArenaV2BoardCard[];
  cardInstancesById: Record<string, ArenaV2CardInstanceForAction>;
}): ArenaV2TurnActionDto[] {
  const occupied = new Set(input.boardCards.map((card) => arenaV2BoardKey(card.position)));
  const slots: ArenaV2BoardPositionDto[] = [
    { row: 'front', column: 0 },
    { row: 'front', column: 1 },
    { row: 'front', column: 2 },
    { row: 'back', column: 0 },
    { row: 'back', column: 1 },
    { row: 'back', column: 2 }
  ];
  let remainingCost = getArenaV2AvailableCost(input.turnNo);
  const actions: ArenaV2TurnActionDto[] = [];
  for (const slot of slots) {
    if (occupied.has(arenaV2BoardKey(slot))) continue;
    const playableId = input.handCardInstanceIds.find((id) => {
      const card = input.cardInstancesById[id];
      return card && card.cost <= remainingCost && !actions.some((action) => action.type === 'place' && action.cardInstanceId === id);
    });
    if (!playableId) continue;
    remainingCost -= input.cardInstancesById[playableId].cost;
    actions.push({ type: 'place', cardInstanceId: playableId, to: slot });
  }
  actions.push({ type: 'end' });
  return actions;
}

function buildBoard(boardCards: ArenaV2BoardCard[], errors: ArenaV2ValidationIssueDto[]): BoardMap {
  const board: BoardMap = new Map();
  for (const card of boardCards) {
    if (!isArenaV2BoardPosition(card.position)) {
      errors.push(issue('ArenaV2InvalidBoardPosition', '저장된 필드 위치가 2x3 필드 범위를 벗어났습니다.'));
      continue;
    }
    const key = arenaV2BoardKey(card.position);
    if (board.has(key)) {
      errors.push(issue('ArenaV2BoardSlotDuplicated', '한 칸에는 카드 1장만 존재할 수 있습니다.'));
      continue;
    }
    board.set(key, { cardInstanceId: card.cardInstanceId, createdTurn: card.createdTurn });
  }
  return board;
}

function cloneRuntimePlayer(player: ArenaV2RuntimePlayer): ArenaV2RuntimePlayer {
  return {
    ...player,
    handCardInstanceIds: [...player.handCardInstanceIds],
    deckCardInstanceIds: [...player.deckCardInstanceIds],
    graveyardCardInstanceIds: [...player.graveyardCardInstanceIds],
    fatigueCount: Math.max(0, Number(player.fatigueCount || 0)),
    boardState: player.boardState.map((card) => ({
      cardInstanceId: card.cardInstanceId,
      position: { ...card.position },
      createdTurn: card.createdTurn
    }))
  };
}

function cloneRuntimeCardInstance(instance: ArenaV2RuntimeCardInstance): ArenaV2RuntimeCardInstance {
  return {
    ...instance,
    position: instance.position ? { ...instance.position } : null,
    statusEffects: Array.isArray(instance.statusEffects) ? [...instance.statusEffects] : []
  };
}

function event(turnNo: number, eventType: string, payload: Record<string, unknown>): ArenaV2ReplayEvent {
  return { turnNo, eventType, payload };
}

function syncBoardInstancePositions(
  players: ArenaV2RuntimePlayer[],
  instances: Map<string, ArenaV2RuntimeCardInstance>
) {
  for (const player of players) {
    for (const boardCard of player.boardState) {
      const instance = instances.get(boardCard.cardInstanceId);
      if (instance) {
        instance.zone = 'board';
        instance.position = { ...boardCard.position };
      }
    }
  }
}

function buildPublicCombatSnapshot(
  players: ArenaV2RuntimePlayer[],
  instances: Map<string, ArenaV2RuntimeCardInstance>
) {
  const publicPlayers = [...players]
    .sort((a, b) => a.seatNo - b.seatNo)
    .map((player) => ({
      seatNo: player.seatNo,
      playerHealth: player.playerHealth,
      boardState: [...player.boardState]
        .sort((a, b) => (
          (a.position.row === b.position.row ? 0 : a.position.row === 'front' ? -1 : 1)
          || a.position.column - b.position.column
          || a.cardInstanceId.localeCompare(b.cardInstanceId)
        ))
        .map((boardCard) => ({
          cardInstanceId: boardCard.cardInstanceId,
          position: { ...boardCard.position },
          createdTurn: boardCard.createdTurn
        }))
    }));
  const boardCardIds = new Set(
    publicPlayers.flatMap((player) => player.boardState.map((card) => card.cardInstanceId))
  );
  return {
    players: publicPlayers,
    cardInstances: [...boardCardIds]
      .map((id) => instances.get(id))
      .filter((instance): instance is ArenaV2RuntimeCardInstance => Boolean(instance))
      .sort((a, b) => (
        a.ownerSeatNo - b.ownerSeatNo
        || a.id.localeCompare(b.id)
      ))
      .map((instance) => ({
        id: instance.id,
        ownerSeatNo: instance.ownerSeatNo,
        position: instance.position ? { ...instance.position } : null,
        currentAttack: Number(instance.currentAttack || 0),
        currentHealth: Number(instance.currentHealth || 0),
        damageTaken: Number(instance.damageTaken || 0)
      }))
  };
}

function applyActionsForSeat(input: {
  turnNo: number;
  player: ArenaV2RuntimePlayer;
  instances: Map<string, ArenaV2RuntimeCardInstance>;
  actions: ArenaV2TurnActionDto[];
  replayEvents: ArenaV2ReplayEvent[];
}) {
  let freeTacticalMoveCount = getArenaV2FreeTacticalMoveCount(input.player.mulliganState);
  const orderedActions = [
    ...input.actions.filter((action) => action.type === 'move'),
    ...input.actions.filter((action) => action.type === 'place'),
    ...input.actions.filter((action) => action.type === 'replace')
  ];
  for (const action of orderedActions) {
    if (action.type === 'move') {
      const boardCard = input.player.boardState.find((card) => card.cardInstanceId === action.cardInstanceId);
      const instance = input.instances.get(action.cardInstanceId);
      if (!boardCard || !instance) continue;
      const moveCost = freeTacticalMoveCount > 0 ? 0 : ARENA_V2_TACTICAL_MOVE_COST;
      freeTacticalMoveCount = Math.max(0, freeTacticalMoveCount - 1);
      boardCard.position = { ...action.to };
      instance.position = { ...action.to };
      input.replayEvents.push(event(input.turnNo, 'move', {
        seatNo: input.player.seatNo,
        cardInstanceId: action.cardInstanceId,
        from: action.from,
        to: action.to,
        cost: moveCost,
        usedFreeTacticalMove: moveCost === 0
      }));
      continue;
    }

    if (action.type === 'place') {
      const instance = input.instances.get(action.cardInstanceId);
      if (!instance) continue;
      input.player.handCardInstanceIds = input.player.handCardInstanceIds.filter((id) => id !== action.cardInstanceId);
      input.player.boardState.push({ cardInstanceId: action.cardInstanceId, position: { ...action.to }, createdTurn: input.turnNo });
      instance.zone = 'board';
      instance.position = { ...action.to };
      instance.createdTurn = input.turnNo;
      input.replayEvents.push(event(input.turnNo, 'place', {
        seatNo: input.player.seatNo,
        cardInstanceId: action.cardInstanceId,
        to: action.to
      }));
      continue;
    }

    if (action.type === 'replace') {
      const replacing = input.instances.get(action.handCardInstanceId);
      const target = input.player.boardState.find((card) => arenaV2BoardKey(card.position) === arenaV2BoardKey(action.target));
      if (!replacing || !target) continue;
      const replaced = input.instances.get(target.cardInstanceId);
      input.player.handCardInstanceIds = input.player.handCardInstanceIds.filter((id) => id !== action.handCardInstanceId);
      input.player.graveyardCardInstanceIds.push(target.cardInstanceId);
      target.cardInstanceId = action.handCardInstanceId;
      target.createdTurn = input.turnNo;
      if (replaced) {
        replaced.zone = 'graveyard';
        replaced.position = null;
      }
      replacing.zone = 'board';
      replacing.position = { ...action.target };
      replacing.createdTurn = input.turnNo;
      input.replayEvents.push(event(input.turnNo, 'replace', {
        seatNo: input.player.seatNo,
        outCardInstanceId: replaced?.id,
        inCardInstanceId: action.handCardInstanceId,
        target: action.target
      }));
    }
  }
  const mulliganState = input.player.mulliganState && typeof input.player.mulliganState === 'object' && !Array.isArray(input.player.mulliganState)
    ? { ...(input.player.mulliganState as Record<string, unknown>) }
    : {};
  mulliganState.freeTacticalMoveCount = freeTacticalMoveCount;
  input.player.mulliganState = mulliganState;
}

function resolveCombatPhase(
  row: ArenaV2BoardRowDto,
  mode: string,
  turnNo: number,
  players: ArenaV2RuntimePlayer[],
  instances: Map<string, ArenaV2RuntimeCardInstance>,
  replayEvents: ArenaV2ReplayEvent[],
  combatContext: ArenaV2CombatContext
) {
  const [left, right] = [...players].sort((a, b) => a.seatNo - b.seatNo);
  if (!left || !right) return;
  applyPhaseControlKeywords(row, turnNo, left, right, instances, replayEvents, combatContext);
  const attackPlans: Array<{
    attacker: ArenaV2RuntimeCardInstance;
    attackerPosition: ArenaV2BoardPositionDto;
    attackerSeatNo: number;
    attackerPlayer: ArenaV2RuntimePlayer;
    targetPlayer: ArenaV2RuntimePlayer;
    targetCard?: ArenaV2RuntimeCardInstance;
    targetPosition?: ArenaV2BoardPositionDto;
    damage: number;
  }> = [];

  for (const column of [0, 1, 2] as const) {
    for (const [attackerPlayer, targetPlayer] of [[left, right], [right, left]] as const) {
      const attackerSlot = getBoardSlotAt(attackerPlayer, instances, { row, column });
      if (!attackerSlot || isDefeated(attackerSlot.instance) || combatContext.stunnedInstanceIds.has(attackerSlot.instance.id)) {
        if (attackerSlot && combatContext.stunnedInstanceIds.has(attackerSlot.instance.id)) {
          replayEvents.push(event(turnNo, 'stun_skip', {
            row,
            seatNo: attackerPlayer.seatNo,
            cardInstanceId: attackerSlot.instance.id
          }));
        }
        continue;
      }
      const target = pickLineTarget(targetPlayer, instances, column, attackerSlot.instance, combatContext);
      const rawAttack = getEffectiveAttack(attackerSlot.instance, targetPlayer, instances, combatContext);
      const directAttackDamage = row === 'back' ? Math.max(0, rawAttack - 1) : rawAttack;
      const damage = target ? rawAttack : mode === 'battle_royale_8' && turnNo >= 10
        ? Math.floor(directAttackDamage * 1.25) : directAttackDamage;
      attackPlans.push({
        attacker: attackerSlot.instance,
        attackerPosition: attackerSlot.position,
        attackerSeatNo: attackerPlayer.seatNo,
        attackerPlayer,
        targetPlayer,
        targetCard: target?.instance,
        targetPosition: target?.position,
        damage
      });
    }
  }

  for (const plan of attackPlans) {
    if (plan.targetCard) {
      const targetPosition = applyMovementKeyword(plan, instances, replayEvents, turnNo, combatContext) || plan.targetPosition;
      const remainingTargetHealth = getRemainingHealth(plan.targetCard);
      const damageResult = applyCardDamage(plan.targetCard, plan.damage, combatContext, replayEvents, turnNo, {
        sourceCardInstanceId: plan.attacker.id,
        sourceSeatNo: plan.attackerSeatNo,
        sourcePosition: plan.attackerPosition,
        reason: 'line_attack'
      });
      replayEvents.push(event(turnNo, 'line_attack', {
        row,
        column: plan.attackerPosition.column,
        attackerSeatNo: plan.attackerSeatNo,
        targetSeatNo: plan.targetPlayer.seatNo,
        cardInstanceId: plan.attacker.id,
        sourcePosition: plan.attackerPosition,
        targetCardInstanceId: plan.targetCard.id,
        targetPosition,
        damage: plan.damage,
        healthDamage: damageResult.healthDamage,
        shieldDamage: damageResult.shieldDamage,
        hp_before: damageResult.hpBefore,
        hp_after: damageResult.hpAfter,
        alive_after: damageResult.aliveAfter
      }));
      if (damageResult.healthDamage > 0) {
        applyDrain(plan.attacker, damageResult.healthDamage, turnNo, replayEvents, combatContext);
        applyCounter(plan.targetCard, plan.attacker, targetPosition, turnNo, replayEvents, combatContext);
      }
      const overflow = row === 'front' && targetPosition?.row === 'front'
        ? Math.max(0, damageResult.healthDamage - remainingTargetHealth)
        : 0;
      const overflowDamage = calculateOverflowSpillDamage(plan.attacker, plan.targetCard, overflow, combatContext);
      if (overflowDamage > 0 && targetPosition) {
        const backTarget = getBoardInstanceAt(plan.targetPlayer, instances, { row: 'back', column: targetPosition.column });
        if (backTarget && backTarget.id !== plan.targetCard.id) {
          const spillDamage = overflowDamage;
          if (spillDamage > 0) {
            const spillResult = applyCardDamage(backTarget, spillDamage, combatContext, replayEvents, turnNo, {
              sourceCardInstanceId: plan.attacker.id,
              sourceSeatNo: plan.attackerSeatNo,
              sourcePosition: plan.attackerPosition,
              reason: 'overflow_damage'
            });
            replayEvents.push(event(turnNo, 'overflow_damage', {
              column: targetPosition.column,
              sourceSeatNo: plan.attackerSeatNo,
              targetSeatNo: plan.targetPlayer.seatNo,
              sourceCardInstanceId: plan.attacker.id,
              sourcePosition: plan.attackerPosition,
              targetCardInstanceId: backTarget.id,
              targetPosition: { row: 'back', column: targetPosition.column },
              damage: spillDamage,
              healthDamage: spillResult.healthDamage,
              shieldDamage: spillResult.shieldDamage,
              hp_before: spillResult.hpBefore,
              hp_after: spillResult.hpAfter,
              alive_after: spillResult.aliveAfter
            }));
          }
        }
      }
      continue;
    }

    const hpBefore = Math.max(0, Number(plan.targetPlayer.playerHealth || 0));
    plan.targetPlayer.playerHealth = Math.max(0, plan.targetPlayer.playerHealth - plan.damage);
    const hpAfter = plan.targetPlayer.playerHealth;
    if (plan.damage > 0) {
      combatContext.directDamageTakenBySeatNo.set(
        plan.targetPlayer.seatNo,
        (combatContext.directDamageTakenBySeatNo.get(plan.targetPlayer.seatNo) || 0) + plan.damage
      );
    }
    replayEvents.push(event(turnNo, 'direct_attack', {
      row,
      column: plan.attackerPosition.column,
      attackerSeatNo: plan.attackerSeatNo,
      targetSeatNo: plan.targetPlayer.seatNo,
      cardInstanceId: plan.attacker.id,
      sourcePosition: plan.attackerPosition,
      damage: plan.damage,
      targetHealth: plan.targetPlayer.playerHealth,
      targetPosition: { row: 'back', column: plan.attackerPosition.column },
      playerHealthBefore: hpBefore,
      playerHealthAfter: hpAfter,
      hp_before: hpBefore,
      hp_after: hpAfter,
      alive_after: plan.targetPlayer.playerHealth > 0
    }));
  }
}

function pickLineTarget(
  player: ArenaV2RuntimePlayer,
  instances: Map<string, ArenaV2RuntimeCardInstance>,
  column: ArenaV2BoardPositionDto['column'],
  attacker?: ArenaV2RuntimeCardInstance,
  combatContext?: ArenaV2CombatContext
) {
  const front = getBoardSlotAt(player, instances, { row: 'front', column });
  const back = getBoardSlotAt(player, instances, { row: 'back', column });
  const livingFront = front && !isDefeated(front.instance) ? front : undefined;
  const livingBack = back && !isDefeated(back.instance) ? back : undefined;
  const tauntTarget = [livingFront, livingBack].find((slot) => slot && hasKeyword(slot.instance, ['taunt', '도발'], combatContext));
  if (tauntTarget) return tauntTarget;
  if (attacker && hasKeyword(attacker, ['aim', 'snipe', '조준', '저격'], combatContext)) {
    if (livingBack) return livingBack;
    if (livingFront) return livingFront;
    return undefined;
  }
  if (livingFront) return livingFront;
  if (livingBack) return livingBack;
  return undefined;
}

function getBoardSlotAt(
  player: ArenaV2RuntimePlayer,
  instances: Map<string, ArenaV2RuntimeCardInstance>,
  position: ArenaV2BoardPositionDto
) {
  const boardCard = player.boardState.find((card) => arenaV2BoardKey(card.position) === arenaV2BoardKey(position));
  if (!boardCard) return undefined;
  const instance = instances.get(boardCard.cardInstanceId);
  return instance ? { instance, position: { ...boardCard.position } } : undefined;
}

function getBoardInstanceAt(
  player: ArenaV2RuntimePlayer,
  instances: Map<string, ArenaV2RuntimeCardInstance>,
  position: ArenaV2BoardPositionDto
) {
  const boardCard = player.boardState.find((card) => arenaV2BoardKey(card.position) === arenaV2BoardKey(position));
  return boardCard ? instances.get(boardCard.cardInstanceId) : undefined;
}

function getRemainingHealth(instance: ArenaV2RuntimeCardInstance): number {
  return Number(instance.currentHealth || 0) - Number(instance.damageTaken || 0);
}

function isDefeated(instance: ArenaV2RuntimeCardInstance): boolean {
  return getRemainingHealth(instance) <= 0;
}

function hasKeyword(instance: ArenaV2RuntimeCardInstance | undefined, types: string[], combatContext?: ArenaV2CombatContext): boolean {
  if (instance && combatContext?.silencedInstanceIds.has(instance.id)) return false;
  if (!instance?.card?.keywords?.length) return false;
  const expected = new Set(types.map((type) => type.toLocaleLowerCase()));
  return instance.card.keywords.some((keyword) => expected.has(String(keyword?.type || '').toLocaleLowerCase()));
}

function getKeywordValue(
  instance: ArenaV2RuntimeCardInstance | undefined,
  types: string[],
  combatContext?: ArenaV2CombatContext,
  fallback = 1
): number {
  if (instance && combatContext?.silencedInstanceIds.has(instance.id)) return 0;
  if (!instance?.card?.keywords?.length) return 0;
  const expected = new Set(types.map((type) => type.toLocaleLowerCase()));
  const keyword = instance.card.keywords.find((item) => expected.has(String(item?.type || '').toLocaleLowerCase()));
  if (!keyword) return 0;
  const value = Number(keyword.value ?? fallback);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function calculateOverflowSpillDamage(
  attacker: ArenaV2RuntimeCardInstance,
  target: ArenaV2RuntimeCardInstance | undefined,
  overflow: number,
  combatContext: ArenaV2CombatContext
): number {
  if (overflow <= 0) return 0;
  if (hasKeyword(attacker, ['pierce', 'piercing', '관통'], combatContext)) return overflow;
  if (target && (target.card?.cardClass === 'specter' || hasKeyword(target, ['specter', '망령'], combatContext))) return 0;
  return Math.floor(overflow / 2);
}

function initializeCombatShields(
  players: ArenaV2RuntimePlayer[],
  instances: Map<string, ArenaV2RuntimeCardInstance>
): Map<string, number> {
  const shields = new Map<string, number>();
  for (const player of players) {
    for (const boardCard of player.boardState) {
      const instance = instances.get(boardCard.cardInstanceId);
      const shield = getKeywordValue(instance, ['shield', 'barrier', '보호막', '보호'], undefined, 1);
      if (instance && shield > 0) shields.set(instance.id, shield);
    }
  }
  return shields;
}

function applyPhaseControlKeywords(
  row: ArenaV2BoardRowDto,
  turnNo: number,
  left: ArenaV2RuntimePlayer,
  right: ArenaV2RuntimePlayer,
  instances: Map<string, ArenaV2RuntimeCardInstance>,
  replayEvents: ArenaV2ReplayEvent[],
  combatContext: ArenaV2CombatContext
) {
  for (const column of [0, 1, 2] as const) {
    for (const [attackerPlayer, targetPlayer] of [[left, right], [right, left]] as const) {
      const attackerSlot = getBoardSlotAt(attackerPlayer, instances, { row, column });
      if (!attackerSlot || isDefeated(attackerSlot.instance)) continue;
      const target = pickLineTarget(targetPlayer, instances, column, attackerSlot.instance, combatContext);
      if (!target) continue;
      if (hasKeyword(attackerSlot.instance, ['silence', '침묵'], combatContext)) {
        combatContext.silencedInstanceIds.add(target.instance.id);
        replayEvents.push(event(turnNo, 'silence', {
          sourceCardInstanceId: attackerSlot.instance.id,
          sourceSeatNo: attackerPlayer.seatNo,
          sourcePosition: attackerSlot.position,
          targetCardInstanceId: target.instance.id,
          targetSeatNo: targetPlayer.seatNo,
          targetPosition: target.position,
          column
        }));
      }
      if (hasKeyword(attackerSlot.instance, ['stun', '기절'], combatContext)) {
        combatContext.stunnedInstanceIds.add(target.instance.id);
        replayEvents.push(event(turnNo, 'stun', {
          sourceCardInstanceId: attackerSlot.instance.id,
          sourceSeatNo: attackerPlayer.seatNo,
          sourcePosition: attackerSlot.position,
          targetCardInstanceId: target.instance.id,
          targetSeatNo: targetPlayer.seatNo,
          targetPosition: target.position,
          column
        }));
      }
    }
  }
}

function getEffectiveAttack(
  attacker: ArenaV2RuntimeCardInstance,
  targetPlayer: ArenaV2RuntimePlayer,
  instances: Map<string, ArenaV2RuntimeCardInstance>,
  combatContext: ArenaV2CombatContext
): number {
  const column = attacker.position?.column;
  let attack = Math.max(0, Number(attacker.currentAttack || 0));
  if (column === 0 || column === 1 || column === 2) {
    const weakenSources = [
      getBoardSlotAt(targetPlayer, instances, { row: 'front', column })?.instance,
      getBoardSlotAt(targetPlayer, instances, { row: 'back', column })?.instance
    ];
    for (const source of weakenSources) {
      if (!source || isDefeated(source)) continue;
      attack -= getKeywordValue(source, ['weaken', 'weakness', '약화'], combatContext, 1);
    }
  }
  return Math.max(0, attack);
}

function applyCardDamage(
  target: ArenaV2RuntimeCardInstance,
  rawDamage: number,
  combatContext: ArenaV2CombatContext,
  replayEvents: ArenaV2ReplayEvent[],
  turnNo: number,
  input: {
    sourceCardInstanceId: string;
    sourceSeatNo?: number;
    sourcePosition?: ArenaV2BoardPositionDto | null;
    reason: string;
  }
) {
  const damage = Math.max(0, Math.floor(Number(rawDamage || 0)));
  const hpBefore = Math.max(0, getRemainingHealth(target));
  const shield = combatContext.shieldByInstanceId.get(target.id) || 0;
  const shieldDamage = Math.min(shield, damage);
  const healthDamage = Math.max(0, damage - shieldDamage);
  if (shieldDamage > 0) {
    const nextShield = shield - shieldDamage;
    if (nextShield > 0) combatContext.shieldByInstanceId.set(target.id, nextShield);
    else combatContext.shieldByInstanceId.delete(target.id);
    replayEvents.push(event(turnNo, 'shield_absorb', {
      sourceCardInstanceId: input.sourceCardInstanceId,
      sourceSeatNo: input.sourceSeatNo,
      sourcePosition: input.sourcePosition,
      targetCardInstanceId: target.id,
      targetSeatNo: target.ownerSeatNo,
      targetPosition: target.position,
      reason: input.reason,
      damage: shieldDamage,
      remainingShield: nextShield
    }));
  }
  target.damageTaken += healthDamage;
  const hpAfter = Math.max(0, getRemainingHealth(target));
  return {
    healthDamage,
    shieldDamage,
    hpBefore,
    hpAfter,
    aliveAfter: hpAfter > 0
  };
}

function applyDrain(
  attacker: ArenaV2RuntimeCardInstance,
  healthDamage: number,
  turnNo: number,
  replayEvents: ArenaV2ReplayEvent[],
  combatContext: ArenaV2CombatContext
) {
  const drain = Math.min(healthDamage, getKeywordValue(attacker, ['drain', 'lifesteal', '흡혈'], combatContext, 1));
  if (drain <= 0) return;
  const healed = Math.min(drain, Math.max(0, Number(attacker.damageTaken || 0)));
  if (healed <= 0) return;
  attacker.damageTaken -= healed;
  replayEvents.push(event(turnNo, 'drain', {
    seatNo: attacker.ownerSeatNo,
    cardInstanceId: attacker.id,
    targetPosition: attacker.position,
    heal: healed,
    damageTaken: attacker.damageTaken
  }));
}

function applyCounter(
  target: ArenaV2RuntimeCardInstance,
  attacker: ArenaV2RuntimeCardInstance,
  targetPosition: ArenaV2BoardPositionDto | undefined,
  turnNo: number,
  replayEvents: ArenaV2ReplayEvent[],
  combatContext: ArenaV2CombatContext
) {
  const counter = getKeywordValue(target, ['counter', 'retaliate', '반격'], combatContext, 1);
  if (counter <= 0) return;
  if (targetPosition?.column !== attacker.position?.column) return;
  const result = applyCardDamage(attacker, counter, combatContext, replayEvents, turnNo, {
    sourceCardInstanceId: target.id,
    sourceSeatNo: target.ownerSeatNo,
    sourcePosition: target.position,
    reason: 'counter'
  });
  replayEvents.push(event(turnNo, 'counter', {
    sourceCardInstanceId: target.id,
    sourceSeatNo: target.ownerSeatNo,
    sourcePosition: target.position,
    targetCardInstanceId: attacker.id,
    targetSeatNo: attacker.ownerSeatNo,
    targetPosition: attacker.position,
    damage: counter,
    healthDamage: result.healthDamage,
    shieldDamage: result.shieldDamage,
    hp_before: result.hpBefore,
    hp_after: result.hpAfter,
    alive_after: result.aliveAfter
  }));
}

function applyMovementKeyword(
  plan: {
    attacker: ArenaV2RuntimeCardInstance;
    attackerPlayer: ArenaV2RuntimePlayer;
    targetPlayer: ArenaV2RuntimePlayer;
    targetCard?: ArenaV2RuntimeCardInstance;
    targetPosition?: ArenaV2BoardPositionDto;
  },
  instances: Map<string, ArenaV2RuntimeCardInstance>,
  replayEvents: ArenaV2ReplayEvent[],
  turnNo: number,
  combatContext: ArenaV2CombatContext
) {
  if (!plan.targetCard || !plan.targetPosition) return plan.targetPosition;
  const column = plan.targetPosition.column;
  const fromPosition = { ...plan.targetPosition };
  if (plan.targetPosition.row === 'front' && hasKeyword(plan.attacker, ['push', '밀치기'], combatContext)) {
    if (!getBoardInstanceAt(plan.targetPlayer, instances, { row: 'back', column })) {
      moveBoardCard(plan.targetPlayer, plan.targetCard.id, { row: 'back', column });
      plan.targetCard.position = { row: 'back', column };
      replayEvents.push(event(turnNo, 'push', {
        sourceCardInstanceId: plan.attacker.id,
        sourceSeatNo: plan.attackerPlayer.seatNo,
        sourcePosition: plan.attacker.position,
        targetCardInstanceId: plan.targetCard.id,
        targetSeatNo: plan.targetPlayer.seatNo,
        fromPosition,
        targetPosition: { row: 'back', column },
        to: { row: 'back', column }
      }));
      return { row: 'back', column } as ArenaV2BoardPositionDto;
    }
  }
  if (plan.targetPosition.row === 'back' && hasKeyword(plan.attacker, ['pull', '끌어오기', '끌기'], combatContext)) {
    if (!getBoardInstanceAt(plan.targetPlayer, instances, { row: 'front', column })) {
      moveBoardCard(plan.targetPlayer, plan.targetCard.id, { row: 'front', column });
      plan.targetCard.position = { row: 'front', column };
      replayEvents.push(event(turnNo, 'pull', {
        sourceCardInstanceId: plan.attacker.id,
        sourceSeatNo: plan.attackerPlayer.seatNo,
        sourcePosition: plan.attacker.position,
        targetCardInstanceId: plan.targetCard.id,
        targetSeatNo: plan.targetPlayer.seatNo,
        fromPosition,
        targetPosition: { row: 'front', column },
        to: { row: 'front', column }
      }));
      return { row: 'front', column } as ArenaV2BoardPositionDto;
    }
  }
  return plan.targetPosition;
}

function moveBoardCard(player: ArenaV2RuntimePlayer, cardInstanceId: string, to: ArenaV2BoardPositionDto) {
  const boardCard = player.boardState.find((card) => card.cardInstanceId === cardInstanceId);
  if (!boardCard) return;
  boardCard.position = { ...to };
}

function moveDefeatedCards(
  players: ArenaV2RuntimePlayer[],
  instances: Map<string, ArenaV2RuntimeCardInstance>,
  turnNo: number,
  replayEvents: ArenaV2ReplayEvent[],
  combatContext: ArenaV2CombatContext
) {
  for (let iteration = 0; iteration < instances.size + 1; iteration += 1) {
    const defeatedRecords: ArenaV2DefeatedRecord[] = [];
    for (const player of players) {
      const survivors: ArenaV2BoardCard[] = [];
      for (const boardCard of player.boardState) {
        const instance = instances.get(boardCard.cardInstanceId);
        if (!instance) continue;
        if (isDefeated(instance)) {
          if (hasKeyword(instance, ['revive', '부활'], combatContext) && !combatContext.revivedInstanceIds.has(instance.id)) {
            combatContext.revivedInstanceIds.add(instance.id);
            instance.damageTaken = Math.max(0, Number(instance.currentHealth || 1) - 1);
            survivors.push(boardCard);
            replayEvents.push(event(turnNo, 'revive', {
              seatNo: player.seatNo,
              cardInstanceId: instance.id,
              targetPosition: boardCard.position,
              health: 1
            }));
            continue;
          }
          const defeatedPosition = { ...boardCard.position };
          instance.zone = 'graveyard';
          instance.position = null;
          combatContext.shieldByInstanceId.delete(instance.id);
          if (!player.graveyardCardInstanceIds.includes(instance.id)) player.graveyardCardInstanceIds.push(instance.id);
          defeatedRecords.push({ player, instance, position: defeatedPosition });
          replayEvents.push(event(turnNo, 'card_defeated', {
            seatNo: player.seatNo,
            cardInstanceId: instance.id,
            targetPosition: defeatedPosition
          }));
        } else {
          survivors.push(boardCard);
        }
      }
      player.boardState = survivors;
    }
    if (!defeatedRecords.length) return;
    applyDefeatedCardEffects(defeatedRecords, players, instances, turnNo, replayEvents, combatContext);
  }
}

function applyDefeatedCardEffects(
  defeatedRecords: ArenaV2DefeatedRecord[],
  players: ArenaV2RuntimePlayer[],
  instances: Map<string, ArenaV2RuntimeCardInstance>,
  turnNo: number,
  replayEvents: ArenaV2ReplayEvent[],
  combatContext: ArenaV2CombatContext
) {
  const ordered = [...defeatedRecords].sort((a, b) => (
    a.player.seatNo - b.player.seatNo
    || (a.position.row === b.position.row ? 0 : a.position.row === 'front' ? -1 : 1)
    || a.position.column - b.position.column
    || a.instance.id.localeCompare(b.instance.id)
  ));

  for (const record of ordered) {
    if (combatContext.silencedInstanceIds.has(record.instance.id)) continue;
    const opponent = players.find((player) => player.seatNo !== record.player.seatNo);
    const vengeance = getKeywordValue(record.instance, ['vengeance', 'grudge', '원한'], combatContext, 1);
    if (opponent && vengeance > 0) {
      const target = pickLineTarget(opponent, instances, record.position.column, undefined, combatContext);
      if (target) {
        const result = applyCardDamage(target.instance, vengeance, combatContext, replayEvents, turnNo, {
          sourceCardInstanceId: record.instance.id,
          sourceSeatNo: record.player.seatNo,
          sourcePosition: record.position,
          reason: 'vengeance'
        });
        replayEvents.push(event(turnNo, 'vengeance', {
          sourceCardInstanceId: record.instance.id,
          sourceSeatNo: record.player.seatNo,
          sourcePosition: record.position,
          targetCardInstanceId: target.instance.id,
          targetSeatNo: opponent.seatNo,
          targetPosition: target.position,
          damage: vengeance,
          healthDamage: result.healthDamage,
          shieldDamage: result.shieldDamage,
          hp_before: result.hpBefore,
          hp_after: result.hpAfter,
          alive_after: result.aliveAfter
        }));
      }
    }
  }

  for (const record of ordered) {
    if (combatContext.silencedInstanceIds.has(record.instance.id)) continue;
    const residue = getKeywordValue(record.instance, ['residue', 'remnant', '잔재'], combatContext, 1);
    if (residue > 0) {
      const ally = pickLineTarget(record.player, instances, record.position.column, undefined, combatContext);
      if (ally && ally.instance.id !== record.instance.id) {
        combatContext.shieldByInstanceId.set(ally.instance.id, (combatContext.shieldByInstanceId.get(ally.instance.id) || 0) + residue);
        replayEvents.push(event(turnNo, 'residue', {
          sourceCardInstanceId: record.instance.id,
          sourceSeatNo: record.player.seatNo,
          sourcePosition: record.position,
          targetCardInstanceId: ally.instance.id,
          targetSeatNo: record.player.seatNo,
          targetPosition: ally.position,
          shield: residue,
          totalShield: combatContext.shieldByInstanceId.get(ally.instance.id) || 0
        }));
      }
    }
  }

  for (const record of ordered) {
    if (combatContext.silencedInstanceIds.has(record.instance.id)) continue;
    const spirit = getKeywordValue(record.instance, ['spirit', 'haunt', '원혼'], combatContext, 1);
    const opponent = players.find((player) => player.seatNo !== record.player.seatNo);
    if (opponent && spirit > 0) {
      const hpBefore = Math.max(0, Number(opponent.playerHealth || 0));
      opponent.playerHealth -= spirit;
      const hpAfter = Math.max(0, Number(opponent.playerHealth || 0));
      replayEvents.push(event(turnNo, 'spirit_damage', {
        sourceCardInstanceId: record.instance.id,
        sourceSeatNo: record.player.seatNo,
        sourcePosition: record.position,
        targetSeatNo: opponent.seatNo,
        damage: spirit,
        targetHealth: opponent.playerHealth,
        hp_before: hpBefore,
        hp_after: hpAfter,
        alive_after: opponent.playerHealth > 0
      }));
    }
  }

  for (const record of ordered) {
    if (combatContext.silencedInstanceIds.has(record.instance.id)) continue;
    if (!hasKeyword(record.instance, ['graveyard_recover', 'graveyardRecover', '묘지 회수'], combatContext)) continue;
    const recoverId = record.player.graveyardCardInstanceIds.find((id) => id !== record.instance.id);
    if (!recoverId || record.player.handCardInstanceIds.length >= ARENA_V2_MAX_HAND_SIZE) continue;
    const recovered = instances.get(recoverId);
    if (!recovered) continue;
    record.player.graveyardCardInstanceIds = record.player.graveyardCardInstanceIds.filter((id) => id !== recoverId);
    record.player.handCardInstanceIds.push(recoverId);
    recovered.zone = 'hand';
    recovered.position = null;
    recovered.damageTaken = 0;
    replayEvents.push(event(turnNo, 'graveyard_recover', {
      sourceCardInstanceId: record.instance.id,
      recoveredCardInstanceId: recoverId,
      seatNo: record.player.seatNo
    }));
  }
}

function drawForNextTurn(
  player: ArenaV2RuntimePlayer,
  instances: Map<string, ArenaV2RuntimeCardInstance>,
  nextTurnNo: number,
  replayEvents: ArenaV2ReplayEvent[]
) {
  if (nextTurnNo < ARENA_V2_FIRST_DRAW_TURN) return;
  const drawnId = player.deckCardInstanceIds.shift();
  if (!drawnId) {
    const playerHealthBefore = Math.max(0, Number(player.playerHealth || 0));
    player.fatigueCount = Math.max(0, Number(player.fatigueCount || 0)) + 1;
    const fatigueDamage = player.fatigueCount;
    player.playerHealth = Math.max(0, playerHealthBefore - fatigueDamage);
    replayEvents.push(event(nextTurnNo, 'fatigue', {
      seatNo: player.seatNo,
      fatigueCount: player.fatigueCount,
      damage: fatigueDamage,
      health: player.playerHealth,
      playerHealthBefore,
      playerHealthAfter: player.playerHealth,
      hp_before: playerHealthBefore,
      hp_after: player.playerHealth,
      alive_after: player.playerHealth > 0
    }));
    return;
  }
  const instance = instances.get(drawnId);
  if (!instance) return;
  if (player.handCardInstanceIds.length >= ARENA_V2_MAX_HAND_SIZE) {
    instance.zone = 'graveyard';
    instance.position = null;
    player.graveyardCardInstanceIds.push(drawnId);
    replayEvents.push(event(nextTurnNo, 'overdraw', {
      seatNo: player.seatNo,
      cardInstanceId: drawnId
    }));
    return;
  }
  instance.zone = 'hand';
  instance.position = null;
  player.handCardInstanceIds.push(drawnId);
  replayEvents.push(event(nextTurnNo, 'draw', {
    seatNo: player.seatNo,
    cardInstanceId: drawnId,
    handCount: player.handCardInstanceIds.length,
    deckCount: player.deckCardInstanceIds.length
  }));
}

function decideArenaV2BattleRoyaleRoundWinner(
  players: ArenaV2RuntimePlayer[],
  directDamageTakenBySeatNo: Map<number, number>,
  replayEvents: ArenaV2ReplayEvent[]
): {
  winnerSeatNo: number | null;
  winnerUserId: string | null;
  result: 'win' | 'draw';
  roundStats: Array<{
    seatNo: number;
    userId: string | null;
    health: number;
    directDamageDealt: number;
    defeatedCardCount: number;
  }>;
} {
  const defeatedCardCountBySeatNo = new Map<number, number>();
  for (const replayEvent of replayEvents) {
    if (replayEvent.eventType !== 'card_defeated') continue;
    const defeatedSeatNo = Number(replayEvent.payload.seatNo);
    if (!Number.isInteger(defeatedSeatNo)) continue;
    defeatedCardCountBySeatNo.set(defeatedSeatNo, (defeatedCardCountBySeatNo.get(defeatedSeatNo) || 0) + 1);
  }
  const orderedPlayers = [...players].sort((left, right) => left.seatNo - right.seatNo);
  const roundStats = orderedPlayers.map((player) => {
    const opponent = orderedPlayers.find((candidate) => candidate.seatNo !== player.seatNo);
    return {
      seatNo: player.seatNo,
      userId: player.userId,
      health: Math.max(0, Number(player.playerHealth || 0)),
      directDamageDealt: opponent
        ? Math.max(0, Number(directDamageTakenBySeatNo.get(opponent.seatNo) || 0))
        : 0,
      defeatedCardCount: opponent ? Math.max(0, defeatedCardCountBySeatNo.get(opponent.seatNo) || 0) : 0
    };
  });
  const [left, right] = roundStats;
  if (!left || !right) return { winnerSeatNo: null, winnerUserId: null, result: 'draw', roundStats };

  const winnerStat = left.health !== right.health
    ? (left.health > right.health ? left : right)
    : left.directDamageDealt !== right.directDamageDealt
      ? (left.directDamageDealt > right.directDamageDealt ? left : right)
      : left.defeatedCardCount !== right.defeatedCardCount
        ? (left.defeatedCardCount > right.defeatedCardCount ? left : right)
        : null;
  if (!winnerStat) return { winnerSeatNo: null, winnerUserId: null, result: 'draw', roundStats };
  return {
    winnerSeatNo: winnerStat.seatNo,
    winnerUserId: winnerStat.userId,
    result: 'win',
    roundStats
  };
}

function decideArenaV2Winner(
  players: ArenaV2RuntimePlayer[],
  resolvedTurnNo: number,
  directDamageTakenBySeatNo: Map<number, number> = new Map()
): {
  completed: boolean;
  winnerSeatNo: number | null;
  winnerUserId: string | null;
  result: 'win' | 'draw';
} {
  const alive = players.filter((player) => player.playerHealth > 0);
  if (alive.length === 0) return { completed: true, winnerSeatNo: null, winnerUserId: null, result: 'draw' };
  if (alive.length === 1) {
    return { completed: true, winnerSeatNo: alive[0].seatNo, winnerUserId: alive[0].userId, result: 'win' };
  }
  const [left, right] = [...players].sort((a, b) => a.seatNo - b.seatNo);
  if (!left || !right) return { completed: false, winnerSeatNo: null, winnerUserId: null, result: 'draw' };

  if (resolvedTurnNo === ARENA_V2_HEALTH_CHECK_TURN) {
    if (left.playerHealth !== right.playerHealth) {
      const winner = left.playerHealth > right.playerHealth ? left : right;
      return { completed: true, winnerSeatNo: winner.seatNo, winnerUserId: winner.userId, result: 'win' };
    }
  }

  if (resolvedTurnNo >= ARENA_V2_SUDDEN_DEATH_TURN) {
    const directDamage = players.map((player) => ({
      player,
      damage: directDamageTakenBySeatNo.get(player.seatNo) || 0
    })).filter((item) => item.damage > 0);

    if (directDamage.length === 1) {
      const loser = directDamage[0].player;
      const winner = players.find((player) => player.seatNo !== loser.seatNo);
      if (winner) return { completed: true, winnerSeatNo: winner.seatNo, winnerUserId: winner.userId, result: 'win' };
    }

    if (directDamage.length > 1) {
      const [leftDamage, rightDamage] = directDamage.sort((a, b) => a.player.seatNo - b.player.seatNo);
      if (leftDamage.damage !== rightDamage.damage) {
        const loser = leftDamage.damage > rightDamage.damage ? leftDamage.player : rightDamage.player;
        const winner = players.find((player) => player.seatNo !== loser.seatNo);
        if (winner) return { completed: true, winnerSeatNo: winner.seatNo, winnerUserId: winner.userId, result: 'win' };
      }
      if (leftDamage.player.playerHealth !== rightDamage.player.playerHealth) {
        const loser = leftDamage.player.playerHealth < rightDamage.player.playerHealth ? leftDamage.player : rightDamage.player;
        const winner = players.find((player) => player.seatNo !== loser.seatNo);
        if (winner) return { completed: true, winnerSeatNo: winner.seatNo, winnerUserId: winner.userId, result: 'win' };
      }
    }
  }

  return { completed: false, winnerSeatNo: null, winnerUserId: null, result: 'draw' };
}

function buildResolutionResult(
  input: ArenaV2TurnResolutionInput,
  players: ArenaV2RuntimePlayer[],
  instances: ArenaV2RuntimeCardInstance[],
  replayEvents: ArenaV2ReplayEvent[],
  winner: { winnerSeatNo: number | null; winnerUserId: string | null; result: 'win' | 'draw' },
  extraSummary: Record<string, unknown> = {}
): ArenaV2TurnResolutionResult {
  replayEvents.push(event(input.turnNo, 'match_completed', {
    ...extraSummary,
    result: winner.result,
    winnerSeatNo: winner.winnerSeatNo,
    winnerUserId: winner.winnerUserId,
    health: players.map((player) => ({
      seatNo: player.seatNo,
      userId: player.userId,
      health: player.playerHealth,
      fatigueCount: player.fatigueCount || 0
    }))
  }));
  return {
    nextStatus: 'completed',
    nextTurnNo: input.turnNo,
    winnerSeatNo: winner.winnerSeatNo,
    winnerUserId: winner.winnerUserId,
    result: winner.result,
    summary: {
      status: 'completed',
      resolvedTurnNo: input.turnNo,
      result: winner.result,
      winnerSeatNo: winner.winnerSeatNo,
      winnerUserId: winner.winnerUserId,
      ...extraSummary,
      health: players.map((player) => ({
        seatNo: player.seatNo,
        userId: player.userId,
        health: player.playerHealth,
        fatigueCount: player.fatigueCount || 0
      }))
    },
    players,
    cardInstances: instances,
    replayEvents
  };
}
