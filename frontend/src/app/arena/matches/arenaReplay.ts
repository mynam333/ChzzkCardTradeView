import type {
  ArenaV2BoardPositionDto,
  ArenaV2CardInstanceDto,
  ArenaV2MatchStatusDto,
  ArenaV2MatchViewDto
} from '@chikapo/arena-contract';

export type ArenaReplayEvent = {
  seq: number;
  turnNo: number;
  eventType: string;
  payload: Record<string, unknown>;
};

export type ArenaReplayPresentationPhase = 'replaying' | 'turn_intro' | 'planning' | 'result';

export type ArenaReplayTurnClock = {
  hasStarted: boolean;
  secondsLeft: number;
};

export type ArenaReplayAnchorPoint = {
  x: number;
  y: number;
  radius: number;
};

export const resolveDirectAttackTargetPoint = (input: {
  frontAnchor?: ArenaReplayAnchorPoint | null;
  backAnchor?: ArenaReplayAnchorPoint | null;
  boardCenterAnchor?: ArenaReplayAnchorPoint | null;
  seatAnchor?: ArenaReplayAnchorPoint | null;
}): ArenaReplayAnchorPoint | null => {
  const back = input.backAnchor;
  if (!back) return input.seatAnchor ? { ...input.seatAnchor } : null;

  const vectors = [
    input.frontAnchor ? { x: back.x - input.frontAnchor.x, y: back.y - input.frontAnchor.y } : null,
    input.boardCenterAnchor && input.seatAnchor
      ? { x: input.seatAnchor.x - input.boardCenterAnchor.x, y: input.seatAnchor.y - input.boardCenterAnchor.y }
      : null,
    input.boardCenterAnchor
      ? { x: back.x - input.boardCenterAnchor.x, y: back.y - input.boardCenterAnchor.y }
      : null,
    input.seatAnchor ? { x: input.seatAnchor.x - back.x, y: input.seatAnchor.y - back.y } : null
  ];
  const vector = vectors.find((candidate) => candidate && Number.isFinite(candidate.x) && Number.isFinite(candidate.y) && Math.hypot(candidate.x, candidate.y) > 0.001);
  if (!vector) return { ...back, radius: Math.max(18, back.radius * 0.72) };

  const vectorLength = Math.hypot(vector.x, vector.y);
  const overshoot = Math.max(12, back.radius * 0.9, vectorLength * 0.38);
  return {
    x: back.x + (vector.x / vectorLength) * overshoot,
    y: back.y + (vector.y / vectorLength) * overshoot,
    radius: Math.max(18, back.radius * 0.72)
  };
};


const replayVisualEventTypes = new Set([
  'line_attack',
  'direct_attack',
  'card_attack',
  'shield_absorb',
  'damage_reduction',
  'overflow_damage',
  'aoe_damage',
  'counter',
  'silence',
  'stun',
  'push',
  'pull',
  'drain',
  'battle_draw',
  'emergency_heal',
  'guard_support',
  'attack_support',
  'support_redirect',
  'trick_passive',
  'tech_passive',
  'card_defeated',
  'revive',
  'vengeance',
  'residue',
  'spirit_damage',
  'graveyard_recover',
  'fatigue'
]);

const cardDamageEventTypes = new Set([
  'line_attack',
  'card_attack',
  'overflow_damage',
  'aoe_damage',
  'support_redirect',
  'counter',
  'vengeance'
]);

const playerDamageEventTypes = new Set(['direct_attack', 'spirit_damage', 'fatigue']);

export const isReplayVisualEvent = (event: ArenaReplayEvent) => replayVisualEventTypes.has(event.eventType);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const cloneJsonValue = <T>(value: T): T => {
  if (value == null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value)) as T;
};

const cloneReplayMatch = (match: ArenaV2MatchViewDto): ArenaV2MatchViewDto => ({
  ...match,
  resultSummary: cloneJsonValue(match.resultSummary),
  players: match.players.map((player) => ({
    ...player,
    playerHealth: Math.max(0, Number(player.playerHealth) || 0),
    handCardInstanceIds: [...player.handCardInstanceIds],
    graveyardCardInstanceIds: [...player.graveyardCardInstanceIds],
    boardState: player.boardState.map((slot) => ({
      ...slot,
      position: { ...slot.position }
    })),
    mulliganState: cloneJsonValue(player.mulliganState)
  })),
  cardInstances: match.cardInstances.map((instance) => ({
    ...instance,
    position: instance.position ? { ...instance.position } : null,
    statusEffects: cloneJsonValue(instance.statusEffects),
    card: instance.card ? {
      ...instance.card,
      keywords: instance.card.keywords.map((keyword) => ({ ...keyword })),
      validationResult: cloneJsonValue(instance.card.validationResult),
      streamer: instance.card.streamer ? { ...instance.card.streamer } : undefined
    } : undefined
  }))
});

const payloadString = (payload: Record<string, unknown>, names: string[]) => {
  for (const name of names) {
    const value = payload[name];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
};

export const readReplayPayloadNumber = (payload: Record<string, unknown>, names: string[]) => {
  for (const name of names) {
    if (!(name in payload)) continue;
    const rawValue = payload[name];
    if (rawValue == null || rawValue === '') continue;
    const value = Number(rawValue);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
};

const payloadNumber = readReplayPayloadNumber;

export const getArenaFreeTacticalMoveCount = (mulliganState: unknown): number => {
  if (!isRecord(mulliganState)) return 0;
  const rawValue = mulliganState.freeTacticalMoveCount ?? mulliganState.freeTacticalMove;
  if (rawValue === true) return 1;
  if (rawValue == null || rawValue === '') return 0;
  const value = Number(rawValue);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
};

export const calculateArenaTurnActionCost = (
  actions: ReadonlyArray<{
    type: string;
    cardInstanceId?: string;
    handCardInstanceId?: string;
  }>,
  getCardCost: (cardInstanceId: string) => number,
  freeTacticalMoveCount = 0
): number => {
  let freeMovesLeft = Math.max(0, Math.floor(Number(freeTacticalMoveCount) || 0));
  return actions.reduce((total, action) => {
    if (action.type === 'move') {
      if (freeMovesLeft > 0) {
        freeMovesLeft -= 1;
        return total;
      }
      return total + 1;
    }
    const cardInstanceId = action.type === 'replace'
      ? action.handCardInstanceId
      : action.type === 'place'
        ? action.cardInstanceId
        : undefined;
    if (!cardInstanceId) return total;
    const cardCost = Number(getCardCost(cardInstanceId));
    return total + (Number.isFinite(cardCost) ? Math.max(0, cardCost) : 0);
  }, 0);
};

const arenaLiveSyncStatuses = new Set([
  'mulligan',
  'turn_planning',
  'action_locked',
  'combat_resolving',
  'turn_result'
]);

export const getArenaMatchSyncIntervalMs = (
  status?: string | null,
  pendingBattleRoyaleResult = false
) => pendingBattleRoyaleResult
  ? 3_000
  : arenaLiveSyncStatuses.has(String(status || '')) ? 1_000 : 2_000;

export const isArenaMatchRequestCurrent = (
  activeGeneration: number,
  requestGeneration: number,
  requestedMatchId: string,
  responseMatchId?: string | null
) => activeGeneration === requestGeneration
  && (!responseMatchId || responseMatchId === requestedMatchId);

const payloadPosition = (
  payload: Record<string, unknown>,
  names: string[]
): ArenaV2BoardPositionDto | undefined => {
  for (const name of names) {
    const value = payload[name];
    if (!isRecord(value)) continue;
    const column = Number(value.column);
    if ((value.row === 'front' || value.row === 'back') && Number.isInteger(column) && column >= 0 && column <= 2) {
      return { row: value.row, column: column as ArenaV2BoardPositionDto['column'] };
    }
  }
  return undefined;
};

const normalizeReplayEvent = (value: unknown): ArenaReplayEvent | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ArenaReplayEvent>;
  const seq = Number(candidate.seq);
  const turnNo = Number(candidate.turnNo);
  if (!Number.isFinite(seq) || !Number.isFinite(turnNo) || typeof candidate.eventType !== 'string') return null;
  return {
    seq,
    turnNo,
    eventType: candidate.eventType,
    payload: candidate.payload && typeof candidate.payload === 'object' ? candidate.payload : {}
  };
};

const findCardInstance = (match: ArenaV2MatchViewDto, cardInstanceId: string) => (
  match.cardInstances.find((instance) => instance.id === cardInstanceId)
);

const findPlayer = (match: ArenaV2MatchViewDto, seatNo: number | undefined) => (
  typeof seatNo === 'number' ? match.players.find((player) => player.seatNo === seatNo) : undefined
);

const boardPositionKey = (position: ArenaV2BoardPositionDto) => position.row + ':' + position.column;

const putCardOnBoard = (
  match: ArenaV2MatchViewDto,
  cardInstanceId: string,
  seatNo: number,
  position: ArenaV2BoardPositionDto
) => {
  const instance = findCardInstance(match, cardInstanceId);
  const player = findPlayer(match, seatNo);
  if (!instance || !player) return;

  for (const candidate of match.players) {
    candidate.boardState = candidate.boardState.filter((slot) => slot.cardInstanceId !== cardInstanceId);
    candidate.graveyardCardInstanceIds = candidate.graveyardCardInstanceIds.filter((id) => id !== cardInstanceId);
  }
  const targetKey = boardPositionKey(position);
  player.boardState = player.boardState.filter((slot) => boardPositionKey(slot.position) !== targetKey);
  player.boardState.push({
    cardInstanceId,
    position: { ...position },
    createdTurn: instance.createdTurn
  });
  instance.zone = 'board';
  instance.position = { ...position };
};

const removeCardFromBoard = (match: ArenaV2MatchViewDto, cardInstanceId: string, seatNo?: number) => {
  const instance = findCardInstance(match, cardInstanceId);
  const ownerSeatNo = seatNo ?? instance?.ownerSeatNo;
  for (const player of match.players) {
    player.boardState = player.boardState.filter((slot) => slot.cardInstanceId !== cardInstanceId);
  }
  const owner = findPlayer(match, ownerSeatNo);
  if (owner && !owner.graveyardCardInstanceIds.includes(cardInstanceId)) {
    owner.graveyardCardInstanceIds.push(cardInstanceId);
  }
  if (instance) {
    instance.zone = 'graveyard';
    instance.position = null;
  }
};

const moveBoardCard = (
  match: ArenaV2MatchViewDto,
  cardInstanceId: string,
  seatNo: number | undefined,
  position: ArenaV2BoardPositionDto | undefined
) => {
  const instance = findCardInstance(match, cardInstanceId);
  if (!instance || !position) return;
  putCardOnBoard(match, cardInstanceId, seatNo ?? instance.ownerSeatNo, position);
};

const targetCardId = (event: ArenaReplayEvent) => payloadString(event.payload, [
  'targetCardInstanceId',
  'targetInstanceId',
  'defeatedCardInstanceId',
  'cardInstanceId'
]);

const eventHealthDamage = (event: ArenaReplayEvent) => {
  const healthDamage = payloadNumber(event.payload, ['healthDamage']);
  if (typeof healthDamage === 'number') return Math.max(0, healthDamage);
  const damage = payloadNumber(event.payload, ['damage']) ?? 0;
  const shieldDamage = payloadNumber(event.payload, ['shieldDamage']) ?? 0;
  return Math.max(0, damage - shieldDamage);
};

const applyCardDamage = (match: ArenaV2MatchViewDto, event: ArenaReplayEvent, direction: 1 | -1) => {
  const cardInstanceId = targetCardId(event);
  const instance = cardInstanceId ? findCardInstance(match, cardInstanceId) : undefined;
  if (!instance) return;
  instance.damageTaken = Math.max(0, instance.damageTaken + eventHealthDamage(event) * direction);
};

const applyDrain = (match: ArenaV2MatchViewDto, event: ArenaReplayEvent, direction: 1 | -1) => {
  const cardInstanceId = payloadString(event.payload, ['cardInstanceId', 'targetCardInstanceId']);
  const instance = cardInstanceId ? findCardInstance(match, cardInstanceId) : undefined;
  if (!instance) return;
  const heal = Math.max(0, payloadNumber(event.payload, ['heal']) ?? 0);
  instance.damageTaken = Math.max(0, instance.damageTaken - heal * direction);
};

const isCardOnBoard = (match: ArenaV2MatchViewDto, cardInstanceId: string) => (
  match.players.some((player) => player.boardState.some((slot) => slot.cardInstanceId === cardInstanceId))
);

const applyBattleDraw = (match: ArenaV2MatchViewDto, event: ArenaReplayEvent, direction: 1 | -1) => {
  const seatNo = payloadNumber(event.payload, ['sourceSeatNo', 'seatNo']);
  const player = findPlayer(match, seatNo);
  if (!player) return;
  const result = payloadString(event.payload, ['result']);
  const cardInstanceId = payloadString(event.payload, ['cardInstanceId']);
  const instance = cardInstanceId ? findCardInstance(match, cardInstanceId) : undefined;
  const handCountAfter = payloadNumber(event.payload, ['handCount']);
  const deckCountAfter = payloadNumber(event.payload, ['deckCount']);

  if (direction === 1) {
    if (typeof handCountAfter === 'number') player.handCount = Math.max(0, handCountAfter);
    if (typeof deckCountAfter === 'number') player.deckCount = Math.max(0, deckCountAfter);
    if (!cardInstanceId) return;
    player.handCardInstanceIds = player.handCardInstanceIds.filter((id) => id !== cardInstanceId);
    player.graveyardCardInstanceIds = player.graveyardCardInstanceIds.filter((id) => id !== cardInstanceId);
    if (result === 'drawn') {
      if (instance) player.handCardInstanceIds.push(cardInstanceId);
      if (instance) {
        instance.zone = 'hand';
        instance.position = null;
      }
    } else if (result === 'overdraw') {
      if (!player.graveyardCardInstanceIds.includes(cardInstanceId)) player.graveyardCardInstanceIds.push(cardInstanceId);
      if (instance) {
        instance.zone = 'graveyard';
        instance.position = null;
      }
    }
    return;
  }

  if (typeof handCountAfter === 'number') {
    player.handCount = Math.max(0, handCountAfter - (result === 'drawn' ? 1 : 0));
  }
  if (typeof deckCountAfter === 'number') {
    player.deckCount = Math.max(0, deckCountAfter + (result === 'empty_deck' ? 0 : 1));
  }
  if (!cardInstanceId) return;
  player.handCardInstanceIds = player.handCardInstanceIds.filter((id) => id !== cardInstanceId);
  player.graveyardCardInstanceIds = player.graveyardCardInstanceIds.filter((id) => id !== cardInstanceId);
  if (instance && !isCardOnBoard(match, cardInstanceId)) {
    instance.zone = 'deck';
    instance.position = null;
  }
};

const applyGraveyardRecover = (match: ArenaV2MatchViewDto, event: ArenaReplayEvent, direction: 1 | -1) => {
  const seatNo = payloadNumber(event.payload, ['seatNo', 'sourceSeatNo']);
  const player = findPlayer(match, seatNo);
  const cardInstanceId = payloadString(event.payload, ['recoveredCardInstanceId']);
  if (!player || !cardInstanceId) return;
  const instance = findCardInstance(match, cardInstanceId);
  const handCountAfter = payloadNumber(event.payload, ['handCount']);

  player.handCardInstanceIds = player.handCardInstanceIds.filter((id) => id !== cardInstanceId);
  player.graveyardCardInstanceIds = player.graveyardCardInstanceIds.filter((id) => id !== cardInstanceId);
  if (direction === 1) {
    if (typeof handCountAfter === 'number') player.handCount = Math.max(0, handCountAfter);
    if (instance) player.handCardInstanceIds.push(cardInstanceId);
    if (instance) {
      instance.zone = 'hand';
      instance.position = null;
      instance.damageTaken = 0;
    }
    return;
  }

  if (typeof handCountAfter === 'number') player.handCount = Math.max(0, handCountAfter - 1);
  if (!isCardOnBoard(match, cardInstanceId)) {
    player.graveyardCardInstanceIds.push(cardInstanceId);
    if (instance) {
      instance.zone = 'graveyard';
      instance.position = null;
      instance.damageTaken = Math.max(instance.currentHealth, instance.damageTaken);
    }
  }
};

const applyPlayerDamage = (match: ArenaV2MatchViewDto, event: ArenaReplayEvent, direction: 1 | -1) => {
  const seatNo = payloadNumber(event.payload, ['targetSeatNo', 'seatNo']);
  const player = findPlayer(match, seatNo);
  if (!player) return;
  const damage = Math.max(0, payloadNumber(event.payload, ['damage']) ?? 0);
  const fatigueHealthAfter = event.eventType === 'fatigue'
    ? payloadNumber(event.payload, ['health'])
    : undefined;
  const healthAfter = payloadNumber(event.payload, ['playerHealthAfter', 'hp_after']) ?? fatigueHealthAfter;
  const healthBefore = payloadNumber(event.payload, ['playerHealthBefore', 'hp_before'])
    ?? (typeof fatigueHealthAfter === 'number' ? fatigueHealthAfter + damage : undefined);
  if (direction === 1 && typeof healthAfter === 'number') {
    player.playerHealth = Math.max(0, healthAfter);
    return;
  }
  if (direction === -1 && typeof healthBefore === 'number') {
    player.playerHealth = Math.max(0, healthBefore);
    return;
  }
  const targetHealth = payloadNumber(event.payload, ['targetHealth']);
  if (typeof targetHealth === 'number') {
    player.playerHealth = Math.max(0, direction === 1 ? targetHealth : targetHealth + damage);
    return;
  }
  player.playerHealth = Math.max(0, player.playerHealth + damage * -direction);
};

const applyRevive = (match: ArenaV2MatchViewDto, event: ArenaReplayEvent, direction: 1 | -1) => {
  const cardInstanceId = payloadString(event.payload, ['cardInstanceId', 'targetCardInstanceId']);
  const instance = cardInstanceId ? findCardInstance(match, cardInstanceId) : undefined;
  if (!instance) return;
  if (direction === -1) {
    instance.damageTaken = Math.max(instance.currentHealth, instance.damageTaken);
    return;
  }
  const health = Math.max(1, payloadNumber(event.payload, ['health']) ?? 1);
  instance.damageTaken = Math.max(0, instance.currentHealth - health);
};

const applyMovement = (match: ArenaV2MatchViewDto, event: ArenaReplayEvent, direction: 1 | -1) => {
  const cardInstanceId = targetCardId(event);
  const instance = cardInstanceId ? findCardInstance(match, cardInstanceId) : undefined;
  if (!instance) return;
  const seatNo = payloadNumber(event.payload, ['targetSeatNo', 'seatNo']) ?? instance.ownerSeatNo;
  const to = payloadPosition(event.payload, ['to', 'targetPosition', 'position']);
  if (!to) return;
  const position: ArenaV2BoardPositionDto = direction === 1
    ? to
    : {
        row: event.eventType === 'push' ? 'front' : 'back',
        column: to.column
      };
  moveBoardCard(match, cardInstanceId, seatNo, position);
};

const applyDefeat = (match: ArenaV2MatchViewDto, event: ArenaReplayEvent, direction: 1 | -1) => {
  const cardInstanceId = targetCardId(event);
  if (!cardInstanceId) return;
  const instance = findCardInstance(match, cardInstanceId);
  const seatNo = payloadNumber(event.payload, ['seatNo', 'targetSeatNo']) ?? instance?.ownerSeatNo;
  if (direction === 1) {
    removeCardFromBoard(match, cardInstanceId, seatNo);
    return;
  }
  const position = payloadPosition(event.payload, ['targetPosition', 'position']);
  if (typeof seatNo === 'number' && position) putCardOnBoard(match, cardInstanceId, seatNo, position);
};

const applyVisualEvent = (match: ArenaV2MatchViewDto, event: ArenaReplayEvent, direction: 1 | -1) => {
  if (cardDamageEventTypes.has(event.eventType)) {
    applyCardDamage(match, event, direction);
    return;
  }
  if (playerDamageEventTypes.has(event.eventType)) {
    applyPlayerDamage(match, event, direction);
    return;
  }
  if (event.eventType === 'drain' || event.eventType === 'emergency_heal') {
    applyDrain(match, event, direction);
    return;
  }
  if (event.eventType === 'battle_draw') {
    applyBattleDraw(match, event, direction);
    return;
  }
  if (event.eventType === 'graveyard_recover') {
    applyGraveyardRecover(match, event, direction);
    return;
  }
  if (event.eventType === 'push' || event.eventType === 'pull') {
    applyMovement(match, event, direction);
    return;
  }
  if (event.eventType === 'card_defeated') {
    applyDefeat(match, event, direction);
    return;
  }
  if (event.eventType === 'revive') applyRevive(match, event, direction);
};

const parseSnapshotBoardState = (value: unknown) => {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const cardInstanceId = typeof item.cardInstanceId === 'string' ? item.cardInstanceId : '';
    const position = payloadPosition(item, ['position']);
    if (!cardInstanceId || !position) return [];
    const createdTurn = Number(item.createdTurn);
    return [{
      cardInstanceId,
      position,
      createdTurn: Number.isFinite(createdTurn) ? createdTurn : 0
    }];
  });
};

const findCombatSnapshot = (events: ArenaReplayEvent[]) => {
  const firstVisualEvent = events.find(isReplayVisualEvent);
  const candidates = events.filter((event) => (
    event.eventType === 'turn_start'
    && (!firstVisualEvent || event.seq <= firstVisualEvent.seq)
    && isRecord(event.payload.combatSnapshot)
  ));
  const snapshotEvent = candidates[candidates.length - 1];
  return snapshotEvent ? snapshotEvent.payload.combatSnapshot as Record<string, unknown> : undefined;
};

const buildMatchFromCombatSnapshot = (
  postCombatMatch: ArenaV2MatchViewDto,
  snapshot: Record<string, unknown>
) => {
  const match = cloneReplayMatch(postCombatMatch);
  const boardByCardId = new Map<string, {
    seatNo: number;
    position: ArenaV2BoardPositionDto;
    createdTurn: number;
  }>();

  if (Array.isArray(snapshot.players)) {
    for (const value of snapshot.players) {
      if (!isRecord(value)) continue;
      const seatNo = Number(value.seatNo);
      const player = findPlayer(match, Number.isFinite(seatNo) ? seatNo : undefined);
      if (!player) continue;
      const playerHealth = Number(value.playerHealth);
      if (Number.isFinite(playerHealth)) player.playerHealth = Math.max(0, playerHealth);
      const fatigueCount = Number(value.fatigueCount);
      if (Number.isFinite(fatigueCount)) player.fatigueCount = fatigueCount;
      const handCount = Number(value.handCount);
      if (Number.isFinite(handCount)) player.handCount = Math.max(0, handCount);
      const deckCount = Number(value.deckCount);
      if (Number.isFinite(deckCount)) player.deckCount = Math.max(0, deckCount);
      if (Array.isArray(value.graveyardCardInstanceIds)) {
        player.graveyardCardInstanceIds = value.graveyardCardInstanceIds.filter((id): id is string => typeof id === 'string');
      }
      const boardState = parseSnapshotBoardState(value.boardState ?? value.board);
      if (!boardState) continue;
      player.boardState = boardState;
      for (const slot of boardState) {
        boardByCardId.set(slot.cardInstanceId, {
          seatNo: player.seatNo,
          position: { ...slot.position },
          createdTurn: slot.createdTurn
        });
      }
    }
  }

  const snapshotInstances = Array.isArray(snapshot.cardInstances)
    ? snapshot.cardInstances
    : Array.isArray(snapshot.cards)
      ? snapshot.cards
      : [];
  for (const value of snapshotInstances) {
    if (!isRecord(value) || typeof value.id !== 'string') continue;
    const boardRecord = boardByCardId.get(value.id);
    const snapshotPosition = payloadPosition(value, ['position']);
    if (!boardRecord && !(value.zone === 'board' && snapshotPosition)) continue;

    let instance = findCardInstance(match, value.id);
    if (!instance) {
      const ownerSeatNo = Number(value.ownerSeatNo ?? boardRecord?.seatNo);
      const cardVersionId = typeof value.cardVersionId === 'string' ? value.cardVersionId : '';
      if (!Number.isFinite(ownerSeatNo) || !cardVersionId) continue;
      instance = {
        id: value.id,
        ownerSeatNo,
        cardVersionId,
        zone: 'board',
        position: boardRecord?.position || snapshotPosition || null,
        currentAttack: Number(value.currentAttack) || 0,
        currentHealth: Number(value.currentHealth) || 0,
        damageTaken: Math.max(0, Number(value.damageTaken) || 0),
        statusEffects: Array.isArray(value.statusEffects) ? cloneJsonValue(value.statusEffects) : [],
        createdTurn: Number(value.createdTurn) || boardRecord?.createdTurn || 0,
        card: isRecord(value.card) ? cloneJsonValue(value.card) as unknown as ArenaV2CardInstanceDto['card'] : undefined
      };
      match.cardInstances.push(instance);
    } else {
      const currentAttack = Number(value.currentAttack);
      const currentHealth = Number(value.currentHealth);
      const damageTaken = Number(value.damageTaken);
      const createdTurn = Number(value.createdTurn);
      if (Number.isFinite(currentAttack)) instance.currentAttack = currentAttack;
      if (Number.isFinite(currentHealth)) instance.currentHealth = currentHealth;
      if (Number.isFinite(damageTaken)) instance.damageTaken = Math.max(0, damageTaken);
      if (Number.isFinite(createdTurn)) instance.createdTurn = createdTurn;
      if (Array.isArray(value.statusEffects)) instance.statusEffects = cloneJsonValue(value.statusEffects);
      if (isRecord(value.card)) {
        instance.card = cloneJsonValue(value.card) as unknown as ArenaV2CardInstanceDto['card'];
      }
    }
  }

  for (const [cardInstanceId, boardRecord] of boardByCardId) {
    const instance = findCardInstance(match, cardInstanceId);
    if (!instance) continue;
    instance.zone = 'board';
    instance.position = { ...boardRecord.position };
    instance.createdTurn = boardRecord.createdTurn || instance.createdTurn;
    for (const player of match.players) {
      player.graveyardCardInstanceIds = player.graveyardCardInstanceIds.filter((id) => id !== cardInstanceId);
    }
  }

  return match;
};

const rewindSnapshotResourceMembership = (match: ArenaV2MatchViewDto, replayEvents: ArenaReplayEvent[]) => {
  for (const event of replayEvents) {
    const isBattleDraw = event.eventType === 'battle_draw';
    const isTurnDraw = event.eventType === 'draw' || event.eventType === 'overdraw';
    const isGraveRecover = event.eventType === 'graveyard_recover';
    if (!isBattleDraw && !isTurnDraw && !isGraveRecover) continue;
    const seatNo = payloadNumber(event.payload, isBattleDraw ? ['sourceSeatNo', 'seatNo'] : ['seatNo', 'sourceSeatNo']);
    const player = findPlayer(match, seatNo);
    const cardInstanceId = payloadString(event.payload, isGraveRecover ? ['recoveredCardInstanceId'] : ['cardInstanceId']);
    if (!player || !cardInstanceId) continue;
    player.handCardInstanceIds = player.handCardInstanceIds.filter((id) => id !== cardInstanceId);
    const instance = findCardInstance(match, cardInstanceId);
    if (!instance || isCardOnBoard(match, cardInstanceId)) continue;
    instance.position = null;
    if (isBattleDraw || isTurnDraw) {
      player.graveyardCardInstanceIds = player.graveyardCardInstanceIds.filter((id) => id !== cardInstanceId);
      instance.zone = 'deck';
    } else {
      if (!player.graveyardCardInstanceIds.includes(cardInstanceId)) player.graveyardCardInstanceIds.push(cardInstanceId);
      instance.zone = 'graveyard';
      instance.damageTaken = Math.max(instance.currentHealth, instance.damageTaken);
    }
  }
};

const buildLegacyReplayStartMatch = (
  postCombatMatch: ArenaV2MatchViewDto,
  visualEvents: ArenaReplayEvent[]
) => {
  const match = cloneReplayMatch(postCombatMatch);
  for (let index = visualEvents.length - 1; index >= 0; index -= 1) {
    applyVisualEvent(match, visualEvents[index], -1);
  }
  return match;
};

/**
 * completedVisualEventCount excludes the currently playing event. A defeated
 * card therefore remains mounted for its card_defeated animation and is
 * removed only after the caller reports that event as completed.
 */
export const buildReplayPresentationMatch = (
  postCombatMatch: ArenaV2MatchViewDto,
  replayEvents: ArenaReplayEvent[],
  completedVisualEventCount: number
): ArenaV2MatchViewDto => {
  const orderedEvents = [...replayEvents].sort((left, right) => left.seq - right.seq);
  const visualEvents = orderedEvents.filter(isReplayVisualEvent);
  const completedCount = Math.min(
    visualEvents.length,
    Math.max(0, Math.floor(Number(completedVisualEventCount) || 0))
  );

  if (completedCount >= visualEvents.length) return cloneReplayMatch(postCombatMatch);

  const snapshot = findCombatSnapshot(orderedEvents);
  const presentationMatch = snapshot
    ? buildMatchFromCombatSnapshot(postCombatMatch, snapshot)
    : buildLegacyReplayStartMatch(postCombatMatch, visualEvents);
  if (snapshot) rewindSnapshotResourceMembership(presentationMatch, orderedEvents);
  for (let index = 0; index < completedCount; index += 1) {
    applyVisualEvent(presentationMatch, visualEvents[index], 1);
  }
  return presentationMatch;
};

export const shouldRevealReplayResult = (
  status: ArenaV2MatchStatusDto | string | undefined,
  completedVisualEventCount: number,
  visualEventCount: number
) => (
  (status === 'completed' || status === 'cancelled')
  && Math.max(0, completedVisualEventCount) >= Math.max(0, visualEventCount)
);

export const shouldContinueBattleRoyaleResultSync = (match: {
  status?: string | null;
  mode?: string | null;
  battleRoyaleId?: string | null;
  viewerRole?: string | null;
  selfSeatNo?: number | null;
  viewerResult?: { placement?: number | null; nextMatchId?: string | null } | null;
  players?: Array<{ seatNo: number; finalRank?: number | null }>;
} | null | undefined) => {
  if (!match || match.status !== 'completed' || match.mode !== 'battle_royale_8' || !match.battleRoyaleId) return false;
  if (match.viewerRole !== 'participant' && match.selfSeatNo == null) return false;
  const selfFinalRank = match.selfSeatNo == null
    ? null
    : match.players?.find((player) => player.seatNo === match.selfSeatNo)?.finalRank;
  const placement = match.viewerResult?.placement ?? selfFinalRank;
  const hasPlacement = typeof placement === 'number' && Number.isFinite(placement) && placement > 0;
  const hasNextMatch = typeof match.viewerResult?.nextMatchId === 'string' && Boolean(match.viewerResult.nextMatchId.trim());
  return !hasPlacement && !hasNextMatch;
};


export const resolveReplayPresentationPhase = (input: {
  status?: ArenaV2MatchStatusDto | string;
  completedVisualEventCount: number;
  visualEventCount: number;
  nowMs: number;
  turnIntroStartsAtMs?: number | null;
  turnIntroEndsAtMs?: number | null;
}): ArenaReplayPresentationPhase => {
  if (Math.max(0, input.completedVisualEventCount) < Math.max(0, input.visualEventCount)) return 'replaying';
  if (shouldRevealReplayResult(input.status, input.completedVisualEventCount, input.visualEventCount)) return 'result';
  if (typeof input.turnIntroStartsAtMs === 'number' && Number.isFinite(input.turnIntroStartsAtMs) && input.nowMs < input.turnIntroStartsAtMs) return 'replaying';
  if (typeof input.turnIntroEndsAtMs === 'number' && Number.isFinite(input.turnIntroEndsAtMs) && input.nowMs < input.turnIntroEndsAtMs) return 'turn_intro';
  return 'planning';
};

export const resolveReplayDisplayTurnNo = (
  presentationPhase: ArenaReplayPresentationPhase,
  matchTurnNo: number | null | undefined,
  replayEvents: ReadonlyArray<Pick<ArenaReplayEvent, 'seq' | 'turnNo' | 'eventType'>>
): number => {
  const parsedMatchTurnNo = Number(matchTurnNo);
  const safeMatchTurnNo = Number.isFinite(parsedMatchTurnNo) && parsedMatchTurnNo > 0
    ? Math.floor(parsedMatchTurnNo)
    : 1;
  if (presentationPhase !== 'replaying') return safeMatchTurnNo;

  let latestEvent: Pick<ArenaReplayEvent, 'seq' | 'turnNo' | 'eventType'> | undefined;
  let latestTurnStart: Pick<ArenaReplayEvent, 'seq' | 'turnNo' | 'eventType'> | undefined;
  for (const replayEvent of replayEvents) {
    if (!Number.isFinite(replayEvent.seq) || !Number.isFinite(replayEvent.turnNo)) continue;
    if (!latestEvent || replayEvent.seq >= latestEvent.seq) latestEvent = replayEvent;
    if (replayEvent.eventType === 'turn_start'
      && (!latestTurnStart || replayEvent.seq >= latestTurnStart.seq)) latestTurnStart = replayEvent;
  }
  const replayTurnNo = Number(latestTurnStart?.turnNo ?? latestEvent?.turnNo);
  return Number.isFinite(replayTurnNo) && replayTurnNo > 0
    ? Math.floor(replayTurnNo)
    : safeMatchTurnNo;
};

export const getReplayTurnClock = (
  nowMs: number,
  planningStartsAtMs: number,
  turnDurationMs = 40_000
): ArenaReplayTurnClock => {
  const safeDuration = Math.max(0, Number.isFinite(turnDurationMs) ? turnDurationMs : 40_000);
  const safeNow = Number.isFinite(nowMs) ? nowMs : 0;
  const safeStart = Number.isFinite(planningStartsAtMs) ? planningStartsAtMs : safeNow;
  const hasStarted = safeNow >= safeStart;
  const remainingMs = hasStarted ? Math.max(0, safeStart + safeDuration - safeNow) : safeDuration;
  return {
    hasStarted,
    secondsLeft: Math.ceil(remainingMs / 1000)
  };
};

export const isReplayTurnClockOpen = (clock: ArenaReplayTurnClock): boolean => (
  clock.hasStarted
  && Number.isFinite(clock.secondsLeft)
  && clock.secondsLeft > 0
);

export const selectLatestReplayScene = (values: unknown) => {
  const allEvents = (Array.isArray(values) ? values : [])
    .map(normalizeReplayEvent)
    .filter((event): event is ArenaReplayEvent => Boolean(event))
    .sort((left, right) => left.seq - right.seq);
  const latestTurnStart = [...allEvents].reverse().find((event) => event.eventType === 'turn_start');
  if (latestTurnStart) {
    const events = allEvents.filter((event) => event.seq >= latestTurnStart.seq);
    return {
      events,
      visualEvents: events.filter(isReplayVisualEvent)
    };
  }

  const allVisualEvents = allEvents.filter(isReplayVisualEvent);
  const latestVisualEvent = allVisualEvents[allVisualEvents.length - 1];
  const latestTurnEnd = [...allEvents].reverse().find((event) => event.eventType === 'turn_end');
  const sceneAnchor = !latestTurnEnd || (latestVisualEvent && latestVisualEvent.seq > latestTurnEnd.seq)
    ? latestVisualEvent
    : latestTurnEnd;
  const sceneTurnNo = sceneAnchor?.turnNo
    ?? allEvents.reduce((latest, event) => Math.max(latest, event.turnNo), -1);
  const events = sceneTurnNo >= 0 ? allEvents.filter((event) => event.turnNo === sceneTurnNo) : [];
  return {
    events,
    visualEvents: events.filter(isReplayVisualEvent)
  };
};
