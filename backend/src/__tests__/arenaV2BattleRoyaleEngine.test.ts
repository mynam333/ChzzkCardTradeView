import { describe, expect, it } from 'vitest';

import {
  resolveArenaV2Turn,
  validateArenaV2TurnAction,
  type ArenaV2RuntimeCardInstance,
  type ArenaV2RuntimePlayer
} from '../services/arenaV2Engine.js';

const player = (
  seatNo: number,
  userId: string,
  boardState: ArenaV2RuntimePlayer['boardState'] = [],
  mulliganState: unknown = {}
): ArenaV2RuntimePlayer => ({
  seatNo,
  userId,
  deckId: `deck-${userId}`,
  playerHealth: 30,
  handCardInstanceIds: [],
  deckCardInstanceIds: [],
  graveyardCardInstanceIds: [],
  boardState,
  mulliganState
});

const card = (
  id: string,
  ownerSeatNo: number,
  attack: number,
  health: number,
  row: 'front' | 'back' = 'front',
  column: 0 | 1 | 2 = 0
): ArenaV2RuntimeCardInstance => ({
  id,
  ownerSeatNo,
  cardVersionId: `version-${id}`,
  zone: 'board',
  position: { row, column },
  currentAttack: attack,
  currentHealth: health,
  damageTaken: 0,
  statusEffects: [],
  createdTurn: 1
});

describe('arena v2 battle royale combat contract', () => {
  it('completes exactly one combat as one round and persists the winner-order aggregates', () => {
    const leftCard = card('left', 0, 4, 5);
    const result = resolveArenaV2Turn({
      matchId: 'br-round-1',
      mode: 'battle_royale_8',
      turnNo: 1,
      seed: 'fixed',
      players: [
        player(0, 'user-left', [{ cardInstanceId: leftCard.id, position: { row: 'front', column: 0 }, createdTurn: 1 }]),
        player(1, 'user-right')
      ],
      cardInstances: [leftCard],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    expect(result.nextStatus).toBe('completed');
    expect(result.nextTurnNo).toBe(1);
    expect(result.winnerUserId).toBe('user-left');
    expect(result.replayEvents.some((item) => item.eventType === 'draw')).toBe(false);
    expect(result.replayEvents.some((item) => item.eventType === 'turn_end')).toBe(false);
    expect((result.summary.battleRoyaleRound as any).roundStats).toEqual([
      { seatNo: 0, userId: 'user-left', health: 30, directDamageDealt: 4, defeatedCardCount: 0 },
      { seatNo: 1, userId: 'user-right', health: 26, directDamageDealt: 0, defeatedCardCount: 0 }
    ]);
  });

  it('uses opponent cards defeated after action application as the final tie-breaker', () => {
    const leftCard = card('left', 0, 3, 10);
    const rightCard = card('right', 1, 3, 3);
    const result = resolveArenaV2Turn({
      matchId: 'br-defeated-tie-break',
      mode: 'battle_royale_8',
      turnNo: 4,
      seed: 'fixed',
      players: [
        player(0, 'user-left', [{ cardInstanceId: leftCard.id, position: { row: 'front', column: 0 }, createdTurn: 1 }]),
        player(1, 'user-right', [{ cardInstanceId: rightCard.id, position: { row: 'front', column: 0 }, createdTurn: 1 }])
      ],
      cardInstances: [leftCard, rightCard],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    expect(result.players.map((item) => item.playerHealth)).toEqual([29, 29]);
    expect(result.winnerUserId).toBe('user-left');
    expect((result.summary.battleRoyaleRound as any).roundStats[0].defeatedCardCount).toBe(1);
  });

  it('draws exactly one real deck card for each surviving player after the combat', () => {
    const leftDraw = { ...card('left-draw', 0, 0, 1), zone: 'deck', position: null };
    const leftLater = { ...card('left-later', 0, 0, 1), zone: 'deck', position: null };
    const rightDraw = { ...card('right-draw', 1, 0, 1), zone: 'deck', position: null };
    const rightLater = { ...card('right-later', 1, 0, 1), zone: 'deck', position: null };
    const leftPlayer = player(0, 'user-left');
    const rightPlayer = player(1, 'user-right');
    leftPlayer.deckCardInstanceIds = [leftDraw.id, leftLater.id];
    rightPlayer.deckCardInstanceIds = [rightDraw.id, rightLater.id];

    const result = resolveArenaV2Turn({
      matchId: 'br-round-draw',
      mode: 'battle_royale_8',
      turnNo: 1,
      seed: 'fixed',
      players: [leftPlayer, rightPlayer],
      cardInstances: [leftDraw, leftLater, rightDraw, rightLater],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    const drawEvents = result.replayEvents.filter((item) => item.eventType === 'draw');
    expect(drawEvents).toHaveLength(2);
    expect(drawEvents.map((item) => item.payload)).toEqual([
      { seatNo: 0, cardInstanceId: leftDraw.id, handCount: 1, deckCount: 1 },
      { seatNo: 1, cardInstanceId: rightDraw.id, handCount: 1, deckCount: 1 }
    ]);
    expect(result.players.map((item) => ({
      seatNo: item.seatNo,
      hand: item.handCardInstanceIds,
      deck: item.deckCardInstanceIds,
      health: item.playerHealth
    }))).toEqual([
      { seatNo: 0, hand: [leftDraw.id], deck: [leftLater.id], health: 30 },
      { seatNo: 1, hand: [rightDraw.id], deck: [rightLater.id], health: 30 }
    ]);
    expect(result.cardInstances.find((item) => item.id === leftDraw.id)).toMatchObject({ zone: 'hand', position: null });
    expect(result.cardInstances.find((item) => item.id === rightDraw.id)).toMatchObject({ zone: 'hand', position: null });
  });

  it('counts card_defeated events even when graveyard recovery offsets the graveyard size', () => {
    const leftCard = card('left-recover-tie-break', 0, 3, 10);
    const rightCard = card('right-recover-tie-break', 1, 3, 3);
    rightCard.card = {
      id: rightCard.cardVersionId,
      cost: 3,
      attack: 3,
      health: 3,
      displayName: '묘지 회수 카드',
      cardClass: 'specter',
      keywords: [{ type: 'graveyard_recover' }]
    };
    const recoveredCard = { ...card('right-old-grave', 1, 0, 1), zone: 'graveyard', position: null };
    const leftPlayer = player(0, 'user-left', [
      { cardInstanceId: leftCard.id, position: { row: 'front', column: 0 }, createdTurn: 1 }
    ]);
    const rightPlayer = player(1, 'user-right', [
      { cardInstanceId: rightCard.id, position: { row: 'front', column: 0 }, createdTurn: 1 }
    ]);
    rightPlayer.graveyardCardInstanceIds = [recoveredCard.id];

    const result = resolveArenaV2Turn({
      matchId: 'br-graveyard-recover-tie-break',
      mode: 'battle_royale_8',
      turnNo: 4,
      seed: 'fixed',
      players: [leftPlayer, rightPlayer],
      cardInstances: [leftCard, rightCard, recoveredCard],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    const rightResult = result.players.find((item) => item.seatNo === 1);
    const roundStats = (result.summary.battleRoyaleRound as any).roundStats;
    expect(result.replayEvents.filter((item) => item.eventType === 'card_defeated')).toHaveLength(1);
    expect(result.replayEvents.find((item) => item.eventType === 'graveyard_recover')?.payload).toMatchObject({
      sourceCardInstanceId: rightCard.id,
      recoveredCardInstanceId: recoveredCard.id,
      seatNo: 1
    });
    expect(rightResult?.graveyardCardInstanceIds).toEqual([rightCard.id]);
    expect(rightResult?.handCardInstanceIds).toEqual([recoveredCard.id]);
    expect(roundStats).toMatchObject([
      { seatNo: 0, defeatedCardCount: 1 },
      { seatNo: 1, defeatedCardCount: 0 }
    ]);
    expect(result.winnerUserId).toBe('user-left');
  });

  it('applies the round-10 direct-attack multiplier after the back-row penalty', () => {
    const frontCard = card('front', 0, 7, 5, 'front', 0);
    const backCard = card('back', 0, 7, 5, 'back', 1);
    const result = resolveArenaV2Turn({
      matchId: 'br-round-10',
      mode: 'battle_royale_8',
      turnNo: 10,
      seed: 'fixed',
      players: [
        player(0, 'user-left', [
          { cardInstanceId: frontCard.id, position: { row: 'front', column: 0 }, createdTurn: 1 },
          { cardInstanceId: backCard.id, position: { row: 'back', column: 1 }, createdTurn: 1 }
        ]),
        player(1, 'user-right')
      ],
      cardInstances: [frontCard, backCard],
      actionsBySeatNo: { 0: [{ type: 'end' }], 1: [{ type: 'end' }] }
    });

    const directAttacks = result.replayEvents.filter((item) => item.eventType === 'direct_attack');
    const fatigueEvents = result.replayEvents.filter((item) => item.eventType === 'fatigue');
    expect(directAttacks.map((item) => item.payload.damage)).toEqual([8, 7]);
    expect(fatigueEvents).toHaveLength(2);
    expect(fatigueEvents.find((item) => item.payload.seatNo === 1)?.payload).toMatchObject({
      damage: 1,
      playerHealthBefore: 15,
      playerHealthAfter: 14,
      hp_before: 15,
      hp_after: 14,
      alive_after: true
    });
    expect(result.players.find((item) => item.seatNo === 1)?.playerHealth).toBe(14);
  });

  it('validates and consumes exactly one free tactical move from the previous loss', () => {
    const boardCard = card('moving', 0, 0, 5);
    const validationInput = {
      turnNo: 2,
      availableCost: 1,
      handCardInstanceIds: ['hand'],
      boardCards: [{ cardInstanceId: boardCard.id, position: { row: 'front' as const, column: 0 as const }, createdTurn: 1 }],
      cardInstancesById: {
        moving: { id: 'moving', cardVersionId: 'moving-version', cost: 1, createdTurn: 1 },
        hand: { id: 'hand', cardVersionId: 'hand-version', cost: 1, createdTurn: 2 }
      },
      actions: [
        { type: 'move' as const, cardInstanceId: 'moving', from: { row: 'front' as const, column: 0 as const }, to: { row: 'front' as const, column: 1 as const } },
        { type: 'place' as const, cardInstanceId: 'hand', to: { row: 'front' as const, column: 0 as const } }
      ]
    };
    expect(validateArenaV2TurnAction(validationInput).valid).toBe(false);
    expect(validateArenaV2TurnAction({ ...validationInput, freeTacticalMoveCount: 1 }).valid).toBe(true);

    const result = resolveArenaV2Turn({
      matchId: 'br-free-move',
      mode: 'battle_royale_8',
      turnNo: 2,
      seed: 'fixed',
      players: [
        player(
          0,
          'user-left',
          [{ cardInstanceId: boardCard.id, position: { row: 'front', column: 0 }, createdTurn: 1 }],
          { freeTacticalMoveCount: 1 }
        ),
        player(1, 'user-right')
      ],
      cardInstances: [boardCard],
      actionsBySeatNo: {
        0: [{ type: 'move', cardInstanceId: 'moving', from: { row: 'front', column: 0 }, to: { row: 'front', column: 1 } }],
        1: [{ type: 'end' }]
      }
    });

    expect(result.replayEvents.find((item) => item.eventType === 'move')?.payload).toMatchObject({
      cost: 0,
      usedFreeTacticalMove: true
    });
    expect((result.players[0].mulliganState as any).freeTacticalMoveCount).toBe(0);
  });
});
