import { describe, expect, it } from 'vitest';
import {
  ARENA_V2_DECK_MAX_CARD_COUNT,
  ARENA_V2_DECK_MIN_CARD_COUNT,
  evaluateArenaV2CardBudget,
  resolveArenaV2Turn,
  validateArenaV2CardVersionDefinition,
  validateArenaV2Deck,
  validateArenaV2TurnAction
} from '../services/arenaV2Engine';

describe('arena v2 card editor budget', () => {
  const makeCard = (overrides: Record<string, unknown> = {}) => ({
    id: 'card-editor-preview',
    streamerId: 'streamer-editor',
    seasonId: 'season-v2',
    status: 'active' as const,
    cardClass: 'tech' as const,
    cost: 7,
    attack: 3,
    health: 6,
    keywords: [{ type: 'battle_draw' }],
    validationResult: null,
    ...overrides
  });

  it('returns the same itemized total used by card validation', () => {
    const card = makeCard({
      cardClass: 'charge',
      attack: 4,
      health: 6,
      keywords: [{ type: 'pierce' }, { type: 'pursuit', value: 1 }]
    });
    const budget = evaluateArenaV2CardBudget(card);

    expect(budget).toMatchObject({
      budgetLimit: 34,
      attackCost: 12,
      healthCost: 6,
      keywordCost: 11,
      comboCost: 5,
      totalCost: 34,
      remaining: 0,
      isOverBudget: false
    });
    expect(validateArenaV2CardVersionDefinition(card).valid).toBe(true);
  });

  it('rejects duplicate keyword selections', () => {
    const validation = validateArenaV2CardVersionDefinition(makeCard({
      keywords: [{ type: 'battle_draw' }, { type: 'battle_draw' }]
    }));

    expect(validation.errors.map((error) => error.code)).toContain('ArenaV2CardDuplicateKeyword');
  });

  it('charges revive and grave recovery synergy exactly once', () => {
    const card = makeCard({
      cardClass: 'specter',
      cost: 9,
      attack: 0,
      health: 12,
      keywords: [{ type: 'revive' }, { type: 'grave_recover', limit: 'cost_2' }]
    });
    const budget = evaluateArenaV2CardBudget(card);

    expect(budget).toMatchObject({
      budgetLimit: 51,
      attackCost: 0,
      healthCost: 12,
      keywordCost: 26,
      comboCost: 10,
      totalCost: 48,
      remaining: 3,
      isOverBudget: false
    });
    expect(validateArenaV2CardVersionDefinition(card).valid).toBe(true);
  });
});

const makeCards = (count: number, seasonId = 'season-v2') => {
  const cardsByVersionId: Record<string, any> = {};
  const cardVersionIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = `card-version-${index + 1}`;
    cardVersionIds.push(id);
    cardsByVersionId[id] = {
      id,
      streamerId: `streamer-${index + 1}`,
      seasonId,
      status: 'active',
      cardClass: 'charge',
      cost: 3,
      attack: 1,
      health: 2,
      keywords: [],
      validationResult: { valid: true, errors: [], warnings: [] }
    };
  }
  return { cardVersionIds, cardsByVersionId };
};

describe('arena v2 deck validation', () => {
  it('accepts GDD deck sizes between 14 and 20 cards', () => {
    for (const count of [ARENA_V2_DECK_MIN_CARD_COUNT, 17, ARENA_V2_DECK_MAX_CARD_COUNT]) {
      const input = makeCards(count);
      expect(validateArenaV2Deck({ seasonId: 'season-v2', ...input }).valid).toBe(true);
    }
  });

  it('rejects decks outside the GDD deck size range', () => {
    const tooSmall = makeCards(13);
    const tooLarge = makeCards(21);

    expect(validateArenaV2Deck({ seasonId: 'season-v2', ...tooSmall }).errors.map((error) => error.code)).toContain('ArenaV2DeckTooSmall');
    expect(validateArenaV2Deck({ seasonId: 'season-v2', ...tooLarge }).errors.map((error) => error.code)).toContain('ArenaV2DeckTooLarge');
  });

  it('rejects duplicate streamer cards and inactive versions', () => {
    const input = makeCards(14);
    input.cardsByVersionId['card-version-2'].streamerId = input.cardsByVersionId['card-version-1'].streamerId;
    input.cardsByVersionId['card-version-3'].status = 'disabled';

    const errors = validateArenaV2Deck({ seasonId: 'season-v2', ...input }).errors.map((error) => error.code);

    expect(errors).toContain('ArenaV2DuplicateStreamerCard');
    expect(errors).toContain('ArenaV2CardVersionInactive');
  });

  it('rejects card versions that fail the GDD card budget validator', () => {
    const input = makeCards(14);
    input.cardsByVersionId['card-version-1'] = {
      ...input.cardsByVersionId['card-version-1'],
      cost: 1,
      attack: 1,
      health: 4,
      keywords: [{ type: 'direct_pressure', value: 1 }]
    };
    input.cardsByVersionId['card-version-2'] = {
      ...input.cardsByVersionId['card-version-2'],
      cardClass: 'legacy-warrior',
      keywords: [{ type: 'unknown_keyword' }]
    };

    const errors = validateArenaV2Deck({ seasonId: 'season-v2', ...input }).errors.map((error) => error.code);

    expect(errors).toContain('ArenaV2CardForbiddenCombo');
    expect(errors).toContain('ArenaV2CardBudgetExceeded');
    expect(errors).toContain('ArenaV2CardInvalidClass');
    expect(errors).toContain('ArenaV2CardInvalidKeyword');
  });
});

describe('arena v2 turn action validation', () => {
  const baseInput = {
    turnNo: 3,
    availableCost: 6,
    handCardInstanceIds: ['hand-1', 'hand-2'],
    boardCards: [
      { cardInstanceId: 'board-a', position: { row: 'front' as const, column: 0 as const }, createdTurn: 1 },
      { cardInstanceId: 'board-b', position: { row: 'back' as const, column: 0 as const }, createdTurn: 1 }
    ],
    cardInstancesById: {
      'hand-1': { id: 'hand-1', cardVersionId: 'v-hand-1', cost: 2, createdTurn: 3 },
      'hand-2': { id: 'hand-2', cardVersionId: 'v-hand-2', cost: 2, createdTurn: 3 },
      'board-a': { id: 'board-a', cardVersionId: 'v-board-a', cost: 2, createdTurn: 1 },
      'board-b': { id: 'board-b', cardVersionId: 'v-board-b', cost: 2, createdTurn: 1 }
    }
  };

  it('allows moving a starting card and placing a hand card into the vacated slot', () => {
    const validation = validateArenaV2TurnAction({
      ...baseInput,
      actions: [
        { type: 'move', cardInstanceId: 'board-a', from: { row: 'front', column: 0 }, to: { row: 'front', column: 1 } },
        { type: 'place', cardInstanceId: 'hand-1', to: { row: 'front', column: 0 } }
      ]
    });

    expect(validation.valid).toBe(true);
  });

  it('rejects moving into a slot that was occupied at turn start', () => {
    const validation = validateArenaV2TurnAction({
      ...baseInput,
      actions: [
        { type: 'move', cardInstanceId: 'board-a', from: { row: 'front', column: 0 }, to: { row: 'back', column: 0 } }
      ]
    });

    expect(validation.errors.map((error) => error.code)).toContain('ArenaV2MoveTargetOccupied');
  });

  it('rejects placing into occupied slots, off-board positions, and excess cost', () => {
    const validation = validateArenaV2TurnAction({
      ...baseInput,
      availableCost: 1,
      handCardInstanceIds: ['hand-1', 'hand-2', 'hand-3'],
      cardInstancesById: {
        ...baseInput.cardInstancesById,
        'hand-3': { id: 'hand-3', cardVersionId: 'v-hand-3', cost: 2, createdTurn: 3 }
      },
      actions: [
        { type: 'place', cardInstanceId: 'hand-1', to: { row: 'front', column: 0 } },
        { type: 'place', cardInstanceId: 'hand-2', to: { row: 'front', column: 3 as any } },
        { type: 'place', cardInstanceId: 'hand-3', to: { row: 'front', column: 1 } }
      ]
    });

    const codes = validation.errors.map((error) => error.code);
    expect(codes).toContain('ArenaV2PlaceTargetOccupied');
    expect(codes).toContain('ArenaV2InvalidBoardPosition');
    expect(codes).toContain('ArenaV2InsufficientCost');
  });

  it('rejects replacing a card placed earlier in the same turn', () => {
    const validation = validateArenaV2TurnAction({
      ...baseInput,
      handCardInstanceIds: ['hand-1', 'hand-2'],
      actions: [
        { type: 'place', cardInstanceId: 'hand-1', to: { row: 'front', column: 1 } },
        { type: 'replace', handCardInstanceId: 'hand-2', target: { row: 'front', column: 1 } }
      ]
    });

    expect(validation.errors.map((error) => error.code)).toContain('ArenaV2ReplaceNewCard');
  });
});

describe('arena v2 turn resolution', () => {
  const runtimeCard = (id: string, seatNo: number, attack = 2, health = 3, cardClass = 'charge', keywords: Array<{ type: string; value?: number }> = []) => ({
    id,
    ownerSeatNo: seatNo,
    cardVersionId: `version-${id}`,
    zone: 'hand',
    position: null,
    currentAttack: attack,
    currentHealth: health,
    damageTaken: 0,
    statusEffects: [],
    createdTurn: 0,
    card: {
      id: `version-${id}`,
      cost: 1,
      attack,
      health,
      displayName: id,
      cardClass: cardClass as any,
      keywords
    }
  });

  it('places a card, performs direct line combat, and draws for turn 2', () => {
    const result = resolveArenaV2Turn({
      matchId: 'match-1',
      mode: 'bot',
      turnNo: 1,
      seed: 'seed',
      players: [
        {
          seatNo: 0,
          userId: 'user-1',
          deckId: 'deck-1',
          playerHealth: 30,
          handCardInstanceIds: ['p-hand'],
          deckCardInstanceIds: ['p-draw'],
          graveyardCardInstanceIds: [],
          boardState: []
        },
        {
          seatNo: 1,
          userId: null,
          deckId: null,
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['b-draw'],
          graveyardCardInstanceIds: [],
          boardState: []
        }
      ],
      cardInstances: [runtimeCard('p-hand', 0), runtimeCard('p-draw', 0), runtimeCard('b-draw', 1)],
      actionsBySeatNo: {
        0: [{ type: 'place', cardInstanceId: 'p-hand', to: { row: 'front', column: 0 } }, { type: 'end' }],
        1: [{ type: 'end' }]
      }
    });

    expect(result.nextStatus).toBe('turn_planning');
    expect(result.nextTurnNo).toBe(2);
    expect(result.players.find((player) => player.seatNo === 1)?.playerHealth).toBe(28);
    expect(result.players.find((player) => player.seatNo === 0)?.handCardInstanceIds).toContain('p-draw');
    expect(result.replayEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining(['place', 'direct_attack', 'draw']));
    const turnStart = result.replayEvents[0];
    expect(turnStart?.payload.replayVersion).toBe(2);
    expect(turnStart?.payload.combatSnapshot).toEqual({
      players: [
        { seatNo: 0, playerHealth: 30, boardState: [{ cardInstanceId: 'p-hand', position: { row: 'front', column: 0 }, createdTurn: 1 }] },
        { seatNo: 1, playerHealth: 30, boardState: [] }
      ],
      cardInstances: [{ id: 'p-hand', ownerSeatNo: 0, position: { row: 'front', column: 0 }, currentAttack: 2, currentHealth: 3, damageTaken: 0 }]
    });
    const snapshotJson = JSON.stringify(turnStart?.payload.combatSnapshot);
    expect(snapshotJson).not.toContain('p-draw');
    expect(snapshotJson).not.toContain('b-draw');
    expect(snapshotJson).not.toContain('user-1');
    expect(snapshotJson).not.toContain('deck-1');
    expect(snapshotJson).not.toContain('handCardInstanceIds');
    expect(snapshotJson).not.toContain('deckCardInstanceIds');
    expect(snapshotJson).not.toContain('cardVersionId');
    const directAttack = result.replayEvents.find((event) => event.eventType === 'direct_attack');
    expect(directAttack?.payload).toMatchObject({
      targetPosition: { row: 'back', column: 0 },
      playerHealthBefore: 30,
      playerHealthAfter: 28,
      hp_before: 30,
      hp_after: 28,
      alive_after: true
    });
  });

  it('resolves simultaneous line attacks and moves defeated cards to graveyard', () => {
    const result = resolveArenaV2Turn({
      matchId: 'match-2',
      mode: 'quick',
      turnNo: 3,
      seed: 'seed',
      players: [
        {
          seatNo: 0,
          userId: 'user-1',
          deckId: 'deck-1',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: [],
          graveyardCardInstanceIds: [],
          boardState: [{ cardInstanceId: 'left', position: { row: 'front', column: 1 }, createdTurn: 1 }]
        },
        {
          seatNo: 1,
          userId: 'user-2',
          deckId: 'deck-2',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: [],
          graveyardCardInstanceIds: [],
          boardState: [{ cardInstanceId: 'right', position: { row: 'front', column: 1 }, createdTurn: 1 }]
        }
      ],
      cardInstances: [runtimeCard('left', 0, 3, 3), runtimeCard('right', 1, 3, 3)],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    expect(result.players.find((player) => player.seatNo === 0)?.graveyardCardInstanceIds).toContain('left');
    expect(result.players.find((player) => player.seatNo === 1)?.graveyardCardInstanceIds).toContain('right');
    expect(result.replayEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining(['line_attack', 'card_defeated']));
    const lethalLineAttack = result.replayEvents.find((event) => event.eventType === 'line_attack');
    expect(lethalLineAttack?.payload).toMatchObject({ hp_before: 3, hp_after: 0, alive_after: false });
  });

  it('uses GDD target priority: front, then back, then player in the same line', () => {
    const result = resolveArenaV2Turn({
      matchId: 'match-target-priority',
      mode: 'quick',
      turnNo: 3,
      seed: 'seed',
      players: [
        {
          seatNo: 0,
          userId: 'user-1',
          deckId: 'deck-1',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['left-draw'],
          graveyardCardInstanceIds: [],
          boardState: [{ cardInstanceId: 'left-front', position: { row: 'front', column: 0 }, createdTurn: 1 }]
        },
        {
          seatNo: 1,
          userId: 'user-2',
          deckId: 'deck-2',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['right-draw'],
          graveyardCardInstanceIds: [],
          boardState: [{ cardInstanceId: 'right-back', position: { row: 'back', column: 0 }, createdTurn: 1 }]
        }
      ],
      cardInstances: [
        runtimeCard('left-front', 0, 3, 6),
        runtimeCard('right-back', 1, 2, 6),
        runtimeCard('left-draw', 0),
        runtimeCard('right-draw', 1)
      ],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    const rightBack = result.cardInstances.find((card) => card.id === 'right-back');
    const leftFront = result.cardInstances.find((card) => card.id === 'left-front');
    expect(result.players.find((player) => player.seatNo === 1)?.playerHealth).toBe(30);
    expect(rightBack?.damageTaken).toBe(3);
    expect(leftFront?.damageTaken).toBe(2);
    const lineAttacks = result.replayEvents.filter((event) => event.eventType === 'line_attack');
    expect(lineAttacks).toHaveLength(2);
    expect(lineAttacks[0]?.payload).toMatchObject({
      attackerSeatNo: 0,
      targetSeatNo: 1,
      cardInstanceId: 'left-front',
      sourcePosition: { row: 'front', column: 0 },
      targetCardInstanceId: 'right-back',
      targetPosition: { row: 'back', column: 0 },
      hp_before: 6,
      hp_after: 3,
      alive_after: true
    });
    expect(lineAttacks[1]?.payload).toMatchObject({
      attackerSeatNo: 1,
      targetSeatNo: 0,
      cardInstanceId: 'right-back',
      sourcePosition: { row: 'back', column: 0 },
      targetCardInstanceId: 'left-front',
      targetPosition: { row: 'front', column: 0 },
      hp_before: 6,
      hp_after: 4,
      alive_after: true
    });
  });

  it('removes a defeated back-row target before its attack phase', () => {
    const result = resolveArenaV2Turn({
      matchId: 'match-front-defeats-back-before-retaliation',
      mode: 'quick',
      turnNo: 3,
      seed: 'seed',
      players: [
        {
          seatNo: 0,
          userId: 'user-1',
          deckId: 'deck-1',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['left-draw'],
          graveyardCardInstanceIds: [],
          boardState: [{ cardInstanceId: 'left-front', position: { row: 'front', column: 0 }, createdTurn: 1 }]
        },
        {
          seatNo: 1,
          userId: 'user-2',
          deckId: 'deck-2',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['right-draw'],
          graveyardCardInstanceIds: [],
          boardState: [{ cardInstanceId: 'right-back', position: { row: 'back', column: 0 }, createdTurn: 1 }]
        }
      ],
      cardInstances: [
        runtimeCard('left-front', 0, 7, 6),
        runtimeCard('right-back', 1, 2, 4),
        runtimeCard('left-draw', 0),
        runtimeCard('right-draw', 1)
      ],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    expect(result.cardInstances.find((card) => card.id === 'left-front')?.damageTaken).toBe(0);
    expect(result.players.find((player) => player.seatNo === 1)?.graveyardCardInstanceIds).toContain('right-back');
    expect(result.replayEvents.filter((event) => event.eventType === 'line_attack')).toHaveLength(1);
    expect(result.replayEvents.find((event) => event.eventType === 'card_defeated')?.payload).toMatchObject({
      cardInstanceId: 'right-back',
      targetPosition: { row: 'back', column: 0 }
    });
  });

  it('makes back-row direct attacks deal attack minus one', () => {
    const result = resolveArenaV2Turn({
      matchId: 'match-back-direct',
      mode: 'quick',
      turnNo: 3,
      seed: 'seed',
      players: [
        {
          seatNo: 0,
          userId: 'user-1',
          deckId: 'deck-1',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['left-draw'],
          graveyardCardInstanceIds: [],
          boardState: [{ cardInstanceId: 'left-back', position: { row: 'back', column: 2 }, createdTurn: 1 }]
        },
        {
          seatNo: 1,
          userId: 'user-2',
          deckId: 'deck-2',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['right-draw'],
          graveyardCardInstanceIds: [],
          boardState: []
        }
      ],
      cardInstances: [runtimeCard('left-back', 0, 4, 6), runtimeCard('left-draw', 0), runtimeCard('right-draw', 1)],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    expect(result.players.find((player) => player.seatNo === 1)?.playerHealth).toBe(27);
    const directAttack = result.replayEvents.find((event) => event.eventType === 'direct_attack');
    expect(directAttack?.payload).toMatchObject({
      row: 'back',
      column: 2,
      damage: 3,
      sourcePosition: { row: 'back', column: 2 },
      targetPosition: { row: 'back', column: 2 },
      playerHealthBefore: 30,
      playerHealthAfter: 27,
      hp_before: 30,
      hp_after: 27,
      alive_after: true
    });
  });

  it('moves defeated front cards before back-row attacks', () => {
    const result = resolveArenaV2Turn({
      matchId: 'match-front-defeated-before-back',
      mode: 'quick',
      turnNo: 3,
      seed: 'seed',
      players: [
        {
          seatNo: 0,
          userId: 'user-1',
          deckId: 'deck-1',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: [],
          graveyardCardInstanceIds: [],
          boardState: [
            { cardInstanceId: 'left-front', position: { row: 'front', column: 1 }, createdTurn: 1 },
            { cardInstanceId: 'left-back', position: { row: 'back', column: 1 }, createdTurn: 1 }
          ]
        },
        {
          seatNo: 1,
          userId: 'user-2',
          deckId: 'deck-2',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: [],
          graveyardCardInstanceIds: [],
          boardState: [
            { cardInstanceId: 'right-front', position: { row: 'front', column: 1 }, createdTurn: 1 },
            { cardInstanceId: 'right-back', position: { row: 'back', column: 1 }, createdTurn: 1 }
          ]
        }
      ],
      cardInstances: [
        runtimeCard('left-front', 0, 2, 2),
        runtimeCard('left-back', 0, 2, 5),
        runtimeCard('right-front', 1, 2, 2),
        runtimeCard('right-back', 1, 2, 5)
      ],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    expect(result.players.find((player) => player.seatNo === 0)?.graveyardCardInstanceIds).toContain('left-front');
    expect(result.players.find((player) => player.seatNo === 1)?.graveyardCardInstanceIds).toContain('right-front');
    expect(result.cardInstances.find((card) => card.id === 'left-back')?.damageTaken).toBe(2);
    expect(result.cardInstances.find((card) => card.id === 'right-back')?.damageTaken).toBe(2);
  });

  it('applies half of front-row overkill damage to the same-line back row', () => {
    const result = resolveArenaV2Turn({
      matchId: 'match-overflow',
      mode: 'quick',
      turnNo: 3,
      seed: 'seed',
      players: [
        {
          seatNo: 0,
          userId: 'user-1',
          deckId: 'deck-1',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['left-draw'],
          graveyardCardInstanceIds: [],
          boardState: [{ cardInstanceId: 'attacker', position: { row: 'front', column: 2 }, createdTurn: 1 }]
        },
        {
          seatNo: 1,
          userId: 'user-2',
          deckId: 'deck-2',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['right-draw'],
          graveyardCardInstanceIds: [],
          boardState: [
            { cardInstanceId: 'front-target', position: { row: 'front', column: 2 }, createdTurn: 1 },
            { cardInstanceId: 'back-target', position: { row: 'back', column: 2 }, createdTurn: 1 }
          ]
        }
      ],
      cardInstances: [
        runtimeCard('attacker', 0, 7, 8),
        runtimeCard('front-target', 1, 0, 3),
        runtimeCard('back-target', 1, 0, 8),
        runtimeCard('left-draw', 0),
        runtimeCard('right-draw', 1)
      ],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    expect(result.players.find((player) => player.seatNo === 1)?.graveyardCardInstanceIds).toContain('front-target');
    expect(result.cardInstances.find((card) => card.id === 'back-target')?.damageTaken).toBe(2);
    expect(result.replayEvents.map((event) => event.eventType)).toContain('overflow_damage');
    const overflowDamage = result.replayEvents.find((event) => event.eventType === 'overflow_damage');
    expect(overflowDamage?.payload).toMatchObject({
      targetCardInstanceId: 'back-target',
      targetPosition: { row: 'back', column: 2 },
      hp_before: 8,
      hp_after: 6,
      alive_after: true
    });
  });

  it('lets aim prioritize the same-line back row before the front row', () => {
    const result = resolveArenaV2Turn({
      matchId: 'match-aim',
      mode: 'quick',
      turnNo: 3,
      seed: 'seed',
      players: [
        {
          seatNo: 0,
          userId: 'user-1',
          deckId: 'deck-1',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['left-draw'],
          graveyardCardInstanceIds: [],
          boardState: [{ cardInstanceId: 'aim-attacker', position: { row: 'front', column: 0 }, createdTurn: 1 }]
        },
        {
          seatNo: 1,
          userId: 'user-2',
          deckId: 'deck-2',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['right-draw'],
          graveyardCardInstanceIds: [],
          boardState: [
            { cardInstanceId: 'front-target', position: { row: 'front', column: 0 }, createdTurn: 1 },
            { cardInstanceId: 'back-target', position: { row: 'back', column: 0 }, createdTurn: 1 }
          ]
        }
      ],
      cardInstances: [
        runtimeCard('aim-attacker', 0, 3, 6, 'sniper', [{ type: 'aim' }]),
        runtimeCard('front-target', 1, 0, 6),
        runtimeCard('back-target', 1, 0, 6),
        runtimeCard('left-draw', 0),
        runtimeCard('right-draw', 1)
      ],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    expect(result.cardInstances.find((card) => card.id === 'front-target')?.damageTaken).toBe(0);
    expect(result.cardInstances.find((card) => card.id === 'back-target')?.damageTaken).toBe(3);
  });

  it('lets taunt pull same-line attacks away from a non-taunt front card', () => {
    const result = resolveArenaV2Turn({
      matchId: 'match-taunt',
      mode: 'quick',
      turnNo: 3,
      seed: 'seed',
      players: [
        {
          seatNo: 0,
          userId: 'user-1',
          deckId: 'deck-1',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['left-draw'],
          graveyardCardInstanceIds: [],
          boardState: [{ cardInstanceId: 'attacker', position: { row: 'front', column: 1 }, createdTurn: 1 }]
        },
        {
          seatNo: 1,
          userId: 'user-2',
          deckId: 'deck-2',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['right-draw'],
          graveyardCardInstanceIds: [],
          boardState: [
            { cardInstanceId: 'front-target', position: { row: 'front', column: 1 }, createdTurn: 1 },
            { cardInstanceId: 'taunt-target', position: { row: 'back', column: 1 }, createdTurn: 1 }
          ]
        }
      ],
      cardInstances: [
        runtimeCard('attacker', 0, 3, 6),
        runtimeCard('front-target', 1, 0, 6),
        runtimeCard('taunt-target', 1, 0, 6, 'guardian', [{ type: 'taunt' }]),
        runtimeCard('left-draw', 0),
        runtimeCard('right-draw', 1)
      ],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    expect(result.cardInstances.find((card) => card.id === 'front-target')?.damageTaken).toBe(0);
    expect(result.cardInstances.find((card) => card.id === 'taunt-target')?.damageTaken).toBe(3);
  });

  it('applies full front-row overflow to the back row when the attacker has pierce', () => {
    const result = resolveArenaV2Turn({
      matchId: 'match-pierce',
      mode: 'quick',
      turnNo: 3,
      seed: 'seed',
      players: [
        {
          seatNo: 0,
          userId: 'user-1',
          deckId: 'deck-1',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['left-draw'],
          graveyardCardInstanceIds: [],
          boardState: [{ cardInstanceId: 'pierce-attacker', position: { row: 'front', column: 2 }, createdTurn: 1 }]
        },
        {
          seatNo: 1,
          userId: 'user-2',
          deckId: 'deck-2',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['right-draw'],
          graveyardCardInstanceIds: [],
          boardState: [
            { cardInstanceId: 'front-target', position: { row: 'front', column: 2 }, createdTurn: 1 },
            { cardInstanceId: 'back-target', position: { row: 'back', column: 2 }, createdTurn: 1 }
          ]
        }
      ],
      cardInstances: [
        runtimeCard('pierce-attacker', 0, 7, 8, 'charge', [{ type: 'pierce' }]),
        runtimeCard('front-target', 1, 0, 3),
        runtimeCard('back-target', 1, 0, 8),
        runtimeCard('left-draw', 0),
        runtimeCard('right-draw', 1)
      ],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    expect(result.cardInstances.find((card) => card.id === 'back-target')?.damageTaken).toBe(4);
  });

  it('blocks normal overflow from a defeated specter front row card', () => {
    const result = resolveArenaV2Turn({
      matchId: 'match-specter-overflow',
      mode: 'quick',
      turnNo: 3,
      seed: 'seed',
      players: [
        {
          seatNo: 0,
          userId: 'user-1',
          deckId: 'deck-1',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['left-draw'],
          graveyardCardInstanceIds: [],
          boardState: [{ cardInstanceId: 'attacker', position: { row: 'front', column: 2 }, createdTurn: 1 }]
        },
        {
          seatNo: 1,
          userId: 'user-2',
          deckId: 'deck-2',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['right-draw'],
          graveyardCardInstanceIds: [],
          boardState: [
            { cardInstanceId: 'specter-target', position: { row: 'front', column: 2 }, createdTurn: 1 },
            { cardInstanceId: 'back-target', position: { row: 'back', column: 2 }, createdTurn: 1 }
          ]
        }
      ],
      cardInstances: [
        runtimeCard('attacker', 0, 7, 8),
        runtimeCard('specter-target', 1, 0, 3, 'specter'),
        runtimeCard('back-target', 1, 0, 8),
        runtimeCard('left-draw', 0),
        runtimeCard('right-draw', 1)
      ],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    expect(result.players.find((player) => player.seatNo === 1)?.graveyardCardInstanceIds).toContain('specter-target');
    expect(result.cardInstances.find((card) => card.id === 'back-target')?.damageTaken).toBe(0);
  });

  it('absorbs combat damage with shield before card health damage', () => {
    const result = resolveArenaV2Turn({
      matchId: 'match-shield',
      mode: 'quick',
      turnNo: 3,
      seed: 'seed',
      players: [
        {
          seatNo: 0,
          userId: 'user-1',
          deckId: 'deck-1',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['left-draw'],
          graveyardCardInstanceIds: [],
          boardState: [{ cardInstanceId: 'attacker', position: { row: 'front', column: 0 }, createdTurn: 1 }]
        },
        {
          seatNo: 1,
          userId: 'user-2',
          deckId: 'deck-2',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['right-draw'],
          graveyardCardInstanceIds: [],
          boardState: [{ cardInstanceId: 'shield-target', position: { row: 'front', column: 0 }, createdTurn: 1 }]
        }
      ],
      cardInstances: [
        runtimeCard('attacker', 0, 4, 6),
        runtimeCard('shield-target', 1, 0, 5, 'guardian', [{ type: 'shield', value: 3 }]),
        runtimeCard('left-draw', 0),
        runtimeCard('right-draw', 1)
      ],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    expect(result.cardInstances.find((card) => card.id === 'shield-target')?.damageTaken).toBe(1);
    expect(result.replayEvents.map((event) => event.eventType)).toContain('shield_absorb');
    expect(result.replayEvents.find((event) => event.eventType === 'shield_absorb')?.payload).toMatchObject({
      sourceSeatNo: 0,
      sourcePosition: { row: 'front', column: 0 },
      targetSeatNo: 1,
      targetPosition: { row: 'front', column: 0 }
    });
  });

  it('applies drain after health damage and counter after being damaged', () => {
    const damagedAttacker = runtimeCard('drain-attacker', 0, 3, 6, 'charge', [{ type: 'drain', value: 2 }]);
    damagedAttacker.damageTaken = 3;

    const result = resolveArenaV2Turn({
      matchId: 'match-drain-counter',
      mode: 'quick',
      turnNo: 3,
      seed: 'seed',
      players: [
        {
          seatNo: 0,
          userId: 'user-1',
          deckId: 'deck-1',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['left-draw'],
          graveyardCardInstanceIds: [],
          boardState: [{ cardInstanceId: 'drain-attacker', position: { row: 'front', column: 1 }, createdTurn: 1 }]
        },
        {
          seatNo: 1,
          userId: 'user-2',
          deckId: 'deck-2',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['right-draw'],
          graveyardCardInstanceIds: [],
          boardState: [{ cardInstanceId: 'counter-target', position: { row: 'front', column: 1 }, createdTurn: 1 }]
        }
      ],
      cardInstances: [
        damagedAttacker,
        runtimeCard('counter-target', 1, 0, 8, 'guardian', [{ type: 'counter', value: 1 }]),
        runtimeCard('left-draw', 0),
        runtimeCard('right-draw', 1)
      ],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    expect(result.cardInstances.find((card) => card.id === 'counter-target')?.damageTaken).toBe(3);
    expect(result.cardInstances.find((card) => card.id === 'drain-attacker')?.damageTaken).toBe(2);
    expect(result.replayEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining(['drain', 'counter']));
    expect(result.replayEvents.find((event) => event.eventType === 'counter')?.payload).toMatchObject({
      sourceSeatNo: 1,
      sourcePosition: { row: 'front', column: 1 },
      targetSeatNo: 0,
      targetPosition: { row: 'front', column: 1 }
    });
  });

  it('prevents the targeted card attack step with stun', () => {
    const result = resolveArenaV2Turn({
      matchId: 'match-stun',
      mode: 'quick',
      turnNo: 3,
      seed: 'seed',
      players: [
        {
          seatNo: 0,
          userId: 'user-1',
          deckId: 'deck-1',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['left-draw'],
          graveyardCardInstanceIds: [],
          boardState: [{ cardInstanceId: 'stun-attacker', position: { row: 'front', column: 1 }, createdTurn: 1 }]
        },
        {
          seatNo: 1,
          userId: 'user-2',
          deckId: 'deck-2',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['right-draw'],
          graveyardCardInstanceIds: [],
          boardState: [{ cardInstanceId: 'stunned-target', position: { row: 'front', column: 1 }, createdTurn: 1 }]
        }
      ],
      cardInstances: [
        runtimeCard('stun-attacker', 0, 1, 6, 'trick', [{ type: 'stun' }]),
        runtimeCard('stunned-target', 1, 5, 6),
        runtimeCard('left-draw', 0),
        runtimeCard('right-draw', 1)
      ],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    expect(result.cardInstances.find((card) => card.id === 'stun-attacker')?.damageTaken).toBe(0);
    expect(result.cardInstances.find((card) => card.id === 'stunned-target')?.damageTaken).toBe(1);
    expect(result.replayEvents.map((event) => event.eventType)).toContain('stun_skip');
    expect(result.replayEvents.find((event) => event.eventType === 'stun')?.payload).toMatchObject({
      sourceSeatNo: 0,
      sourcePosition: { row: 'front', column: 1 },
      targetSeatNo: 1,
      targetPosition: { row: 'front', column: 1 }
    });
  });

  it('silences the target keyword effects for the current combat', () => {
    const result = resolveArenaV2Turn({
      matchId: 'match-silence-revive',
      mode: 'quick',
      turnNo: 3,
      seed: 'seed',
      players: [
        {
          seatNo: 0,
          userId: 'user-1',
          deckId: 'deck-1',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['left-draw'],
          graveyardCardInstanceIds: [],
          boardState: [{ cardInstanceId: 'silence-attacker', position: { row: 'front', column: 0 }, createdTurn: 1 }]
        },
        {
          seatNo: 1,
          userId: 'user-2',
          deckId: 'deck-2',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['right-draw'],
          graveyardCardInstanceIds: [],
          boardState: [{ cardInstanceId: 'revive-target', position: { row: 'front', column: 0 }, createdTurn: 1 }]
        }
      ],
      cardInstances: [
        runtimeCard('silence-attacker', 0, 5, 6, 'trick', [{ type: 'silence' }]),
        runtimeCard('revive-target', 1, 0, 3, 'support', [{ type: 'revive' }]),
        runtimeCard('left-draw', 0),
        runtimeCard('right-draw', 1)
      ],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    expect(result.players.find((player) => player.seatNo === 1)?.graveyardCardInstanceIds).toContain('revive-target');
    expect(result.replayEvents.map((event) => event.eventType)).not.toContain('revive');
  });

  it('moves same-line targets with push and pull when the destination is empty', () => {
    const result = resolveArenaV2Turn({
      matchId: 'match-push-pull',
      mode: 'quick',
      turnNo: 3,
      seed: 'seed',
      players: [
        {
          seatNo: 0,
          userId: 'user-1',
          deckId: 'deck-1',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['left-draw'],
          graveyardCardInstanceIds: [],
          boardState: [
            { cardInstanceId: 'push-attacker', position: { row: 'front', column: 0 }, createdTurn: 1 },
            { cardInstanceId: 'pull-attacker', position: { row: 'front', column: 2 }, createdTurn: 1 }
          ]
        },
        {
          seatNo: 1,
          userId: 'user-2',
          deckId: 'deck-2',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['right-draw'],
          graveyardCardInstanceIds: [],
          boardState: [
            { cardInstanceId: 'push-target', position: { row: 'front', column: 0 }, createdTurn: 1 },
            { cardInstanceId: 'pull-target', position: { row: 'back', column: 2 }, createdTurn: 1 }
          ]
        }
      ],
      cardInstances: [
        runtimeCard('push-attacker', 0, 1, 6, 'charge', [{ type: 'push' }]),
        runtimeCard('pull-attacker', 0, 1, 6, 'charge', [{ type: 'pull' }, { type: 'aim' }]),
        runtimeCard('push-target', 1, 0, 6),
        runtimeCard('pull-target', 1, 0, 6),
        runtimeCard('left-draw', 0),
        runtimeCard('right-draw', 1)
      ],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    const rightBoard = result.players.find((player) => player.seatNo === 1)?.boardState || [];
    expect(rightBoard.find((card) => card.cardInstanceId === 'push-target')?.position).toEqual({ row: 'back', column: 0 });
    expect(rightBoard.find((card) => card.cardInstanceId === 'pull-target')?.position).toEqual({ row: 'front', column: 2 });
    expect(result.replayEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining(['push', 'pull']));
    expect(result.replayEvents.find((event) => event.eventType === 'push')?.payload).toMatchObject({
      sourceSeatNo: 0,
      sourcePosition: { row: 'front', column: 0 },
      targetSeatNo: 1,
      targetPosition: { row: 'back', column: 0 }
    });
    expect(result.replayEvents.find((event) => event.eventType === 'pull')?.payload).toMatchObject({
      sourceSeatNo: 0,
      sourcePosition: { row: 'front', column: 2 },
      targetSeatNo: 1,
      targetPosition: { row: 'front', column: 2 }
    });
  });

  it('runs defeat effects for vengeance, spirit damage, residue shield, and graveyard recovery', () => {
    const oldGrave = runtimeCard('old-grave', 1);
    oldGrave.zone = 'graveyard';

    const result = resolveArenaV2Turn({
      matchId: 'match-defeat-effects',
      mode: 'quick',
      turnNo: 3,
      seed: 'seed',
      players: [
        {
          seatNo: 0,
          userId: 'user-1',
          deckId: 'deck-1',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['left-draw'],
          graveyardCardInstanceIds: [],
          boardState: [{ cardInstanceId: 'attacker', position: { row: 'front', column: 1 }, createdTurn: 1 }]
        },
        {
          seatNo: 1,
          userId: 'user-2',
          deckId: 'deck-2',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['right-draw'],
          graveyardCardInstanceIds: ['old-grave'],
          boardState: [
            { cardInstanceId: 'effect-target', position: { row: 'front', column: 1 }, createdTurn: 1 },
            { cardInstanceId: 'ally-back', position: { row: 'back', column: 1 }, createdTurn: 1 }
          ]
        }
      ],
      cardInstances: [
        runtimeCard('attacker', 0, 5, 6),
        runtimeCard('effect-target', 1, 0, 3, 'support', [
          { type: 'vengeance', value: 2 },
          { type: 'spirit', value: 1 },
          { type: 'residue', value: 2 },
          { type: 'graveyard_recover' }
        ]),
        runtimeCard('ally-back', 1, 0, 6),
        oldGrave,
        runtimeCard('left-draw', 0),
        runtimeCard('right-draw', 1)
      ],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    expect(result.cardInstances.find((card) => card.id === 'attacker')?.damageTaken).toBe(2);
    expect(result.players.find((player) => player.seatNo === 0)?.playerHealth).toBe(29);
    expect(result.players.find((player) => player.seatNo === 1)?.handCardInstanceIds).toContain('old-grave');
    expect(result.replayEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining(['vengeance', 'spirit_damage', 'residue', 'graveyard_recover']));
    expect(result.replayEvents.find((event) => event.eventType === 'vengeance')?.payload).toMatchObject({
      sourceSeatNo: 1,
      sourcePosition: { row: 'front', column: 1 },
      targetSeatNo: 0,
      targetPosition: { row: 'front', column: 1 }
    });
    expect(result.replayEvents.find((event) => event.eventType === 'residue')?.payload).toMatchObject({
      sourceSeatNo: 1,
      sourcePosition: { row: 'front', column: 1 },
      targetSeatNo: 1,
      targetPosition: { row: 'back', column: 1 }
    });
  });

  it('increments fatigue damage by each empty-deck draw attempt', () => {
    const result = resolveArenaV2Turn({
      matchId: 'match-fatigue',
      mode: 'quick',
      turnNo: 3,
      seed: 'seed',
      players: [
        {
          seatNo: 0,
          userId: 'user-1',
          deckId: 'deck-1',
          playerHealth: 30,
          fatigueCount: 2,
          handCardInstanceIds: [],
          deckCardInstanceIds: [],
          graveyardCardInstanceIds: [],
          boardState: []
        },
        {
          seatNo: 1,
          userId: 'user-2',
          deckId: 'deck-2',
          playerHealth: 30,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['right-draw'],
          graveyardCardInstanceIds: [],
          boardState: []
        }
      ],
      cardInstances: [runtimeCard('right-draw', 1)],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    const fatigue = result.replayEvents.find((event) => event.eventType === 'fatigue');
    expect(result.players.find((player) => player.seatNo === 0)?.playerHealth).toBe(27);
    expect(result.players.find((player) => player.seatNo === 0)?.fatigueCount).toBe(3);
    expect(fatigue?.payload).toMatchObject({ seatNo: 0, fatigueCount: 3, damage: 3 });
  });

  it('continues sudden death when health differs but no direct attack damage was taken', () => {
    const result = resolveArenaV2Turn({
      matchId: 'match-sudden-health-gap',
      mode: 'quick',
      turnNo: 10,
      seed: 'seed',
      players: [
        {
          seatNo: 0,
          userId: 'user-1',
          deckId: 'deck-1',
          playerHealth: 22,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['left-draw'],
          graveyardCardInstanceIds: [],
          boardState: []
        },
        {
          seatNo: 1,
          userId: 'user-2',
          deckId: 'deck-2',
          playerHealth: 18,
          handCardInstanceIds: [],
          deckCardInstanceIds: ['right-draw'],
          graveyardCardInstanceIds: [],
          boardState: []
        }
      ],
      cardInstances: [runtimeCard('left-draw', 0), runtimeCard('right-draw', 1)],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    expect(result.nextStatus).toBe('turn_planning');
    expect(result.nextTurnNo).toBe(11);
    expect(result.winnerUserId).toBeNull();
  });

  it('ends sudden death when only one player takes positive direct attack damage', () => {
    const result = resolveArenaV2Turn({
      matchId: 'match-sudden-one-direct',
      mode: 'quick',
      turnNo: 10,
      seed: 'seed',
      players: [
        {
          seatNo: 0,
          userId: 'user-1',
          deckId: 'deck-1',
          playerHealth: 20,
          handCardInstanceIds: [],
          deckCardInstanceIds: [],
          graveyardCardInstanceIds: [],
          boardState: [{ cardInstanceId: 'attacker', position: { row: 'front', column: 0 }, createdTurn: 1 }]
        },
        {
          seatNo: 1,
          userId: 'user-2',
          deckId: 'deck-2',
          playerHealth: 20,
          handCardInstanceIds: [],
          deckCardInstanceIds: [],
          graveyardCardInstanceIds: [],
          boardState: []
        }
      ],
      cardInstances: [runtimeCard('attacker', 0, 2, 5)],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    expect(result.nextStatus).toBe('completed');
    expect(result.winnerUserId).toBe('user-1');
  });

  it('uses larger direct attack damage as the sudden death loss candidate when both players are hit', () => {
    const result = resolveArenaV2Turn({
      matchId: 'match-sudden-direct-compare',
      mode: 'quick',
      turnNo: 10,
      seed: 'seed',
      players: [
        {
          seatNo: 0,
          userId: 'user-1',
          deckId: 'deck-1',
          playerHealth: 20,
          handCardInstanceIds: [],
          deckCardInstanceIds: [],
          graveyardCardInstanceIds: [],
          boardState: [{ cardInstanceId: 'left-attacker', position: { row: 'front', column: 0 }, createdTurn: 1 }]
        },
        {
          seatNo: 1,
          userId: 'user-2',
          deckId: 'deck-2',
          playerHealth: 20,
          handCardInstanceIds: [],
          deckCardInstanceIds: [],
          graveyardCardInstanceIds: [],
          boardState: [{ cardInstanceId: 'right-attacker', position: { row: 'front', column: 1 }, createdTurn: 1 }]
        }
      ],
      cardInstances: [runtimeCard('left-attacker', 0, 5, 5), runtimeCard('right-attacker', 1, 2, 5)],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    expect(result.nextStatus).toBe('completed');
    expect(result.winnerUserId).toBe('user-1');
  });

  it('ends on turn 9 when health is not tied, preserving sudden death only for ties', () => {
    const result = resolveArenaV2Turn({
      matchId: 'match-3',
      mode: 'quick',
      turnNo: 9,
      seed: 'seed',
      players: [
        {
          seatNo: 0,
          userId: 'user-1',
          deckId: 'deck-1',
          playerHealth: 18,
          handCardInstanceIds: [],
          deckCardInstanceIds: [],
          graveyardCardInstanceIds: [],
          boardState: []
        },
        {
          seatNo: 1,
          userId: 'user-2',
          deckId: 'deck-2',
          playerHealth: 12,
          handCardInstanceIds: [],
          deckCardInstanceIds: [],
          graveyardCardInstanceIds: [],
          boardState: []
        }
      ],
      cardInstances: [],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    expect(result.nextStatus).toBe('completed');
    expect(result.winnerUserId).toBe('user-1');
  });
});
