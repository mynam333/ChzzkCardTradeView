import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReplayPresentationMatch,
  calculateArenaTurnActionCost,
  getArenaFreeTacticalMoveCount,
  getArenaMatchSyncIntervalMs,
  getReplayTurnClock,
  isReplayTurnClockOpen,
  isArenaMatchRequestCurrent,
  readReplayPayloadNumber,
  resolveReplayDisplayTurnNo,
  resolveReplayPresentationPhase,
  resolveDirectAttackTargetPoint,
  selectLatestReplayScene,
  shouldContinueBattleRoyaleResultSync,
  shouldRevealReplayResult
} from './arenaReplay.ts';

const event = (seq, turnNo, eventType, payload = {}) => ({ seq, turnNo, eventType, payload });

const makeMatch = () => ({
  id: 'match-1',
  seasonId: 'season-1',
  mode: 'quick',
  status: 'turn_planning',
  battleRoyaleId: null,
  roundNo: 1,
  turnNo: 4,
  rulesVersion: 'rules-1',
  cardPoolVersion: 'cards-1',
  startedAt: '2026-07-26T00:00:00.000Z',
  finishedAt: null,
  winnerUserId: null,
  resultSummary: {},
  selfSeatNo: 0,
  players: [
    {
      seatNo: 0,
      userId: 'user-0',
      deckId: 'deck-0',
      playerHealth: 30,
      fatigueCount: 0,
      handCardInstanceIds: ['self-hand'],
      handCount: 1,
      deckCount: 4,
      graveyardCardInstanceIds: [],
      boardState: [{ cardInstanceId: 'attacker', position: { row: 'front', column: 0 }, createdTurn: 1 }],
      mulliganState: {}
    },
    {
      seatNo: 1,
      userId: 'user-1',
      deckId: 'deck-1',
      playerHealth: 27,
      fatigueCount: 0,
      handCardInstanceIds: [],
      handCount: 3,
      deckCount: 4,
      graveyardCardInstanceIds: ['defender'],
      boardState: [],
      mulliganState: {}
    }
  ],
  cardInstances: [
    {
      id: 'attacker',
      ownerSeatNo: 0,
      cardVersionId: 'card-attacker',
      card: {
        id: 'card-attacker',
        streamerId: 's0',
        displayName: '공격자',
        seasonId: 'season-1',
        version: 1,
        cardClass: 'charge',
        cost: 3,
        attack: 4,
        health: 5,
        keywords: [],
        status: 'active'
      },
      zone: 'board',
      position: { row: 'front', column: 0 },
      currentAttack: 4,
      currentHealth: 5,
      damageTaken: 0,
      statusEffects: [],
      createdTurn: 1
    },
    {
      id: 'defender',
      ownerSeatNo: 1,
      cardVersionId: 'card-defender',
      card: {
        id: 'card-defender',
        streamerId: 's1',
        displayName: '수비자',
        seasonId: 'season-1',
        version: 1,
        cardClass: 'guardian',
        cost: 3,
        attack: 2,
        health: 4,
        keywords: [],
        status: 'active'
      },
      zone: 'graveyard',
      position: null,
      currentAttack: 2,
      currentHealth: 4,
      damageTaken: 4,
      statusEffects: [],
      createdTurn: 1
    },
    {
      id: 'self-hand',
      ownerSeatNo: 0,
      cardVersionId: 'card-self-hand',
      zone: 'hand',
      position: null,
      currentAttack: 1,
      currentHealth: 1,
      damageTaken: 0,
      statusEffects: [],
      createdTurn: 0
    }
  ]
});

const boardSlotFor = (match, cardInstanceId) => match.players
  .flatMap((player) => player.boardState)
  .find((slot) => slot.cardInstanceId === cardInstanceId);

const instanceFor = (match, cardInstanceId) => (
  match.cardInstances.find((instance) => instance.id === cardInstanceId)
);

test('다음 턴 드로우가 뒤에 있어도 직전 전투 장면을 선택한다', () => {
  const result = selectLatestReplayScene([
    event(11, 3, 'line_attack'),
    event(12, 3, 'card_defeated'),
    event(13, 4, 'draw'),
    event(14, 4, 'draw'),
    event(15, 3, 'turn_end')
  ]);

  assert.deepEqual(result.visualEvents.map(({ seq }) => seq), [11, 12]);
  assert.deepEqual(result.events.map(({ seq }) => seq), [11, 12, 15]);
});

test('새 턴에 시각 이벤트가 생기면 가장 최근 시각 장면으로 전환한다', () => {
  const result = selectLatestReplayScene([
    event(11, 3, 'line_attack'),
    event(12, 4, 'draw'),
    event(13, 4, 'direct_attack')
  ]);

  assert.deepEqual(result.visualEvents.map(({ seq }) => seq), [13]);
});

test('시각 이벤트가 없어도 마지막 turn_start 이후 해결 배치를 유지한다', () => {
  const result = selectLatestReplayScene([
    event(1, 1, 'turn_start'),
    event(2, 2, 'draw')
  ]);

  assert.deepEqual(result.events.map(({ seq }) => seq), [1, 2]);
  assert.deepEqual(result.visualEvents, []);
});

test('최근 해결 턴이 조용했다면 예전 전투를 다시 재생하지 않는다', () => {
  const result = selectLatestReplayScene([
    event(1, 2, 'line_attack'),
    event(2, 2, 'turn_end'),
    event(3, 3, 'turn_start'),
    event(4, 4, 'draw'),
    event(5, 3, 'turn_end')
  ]);

  assert.deepEqual(result.events.map(({ seq }) => seq), [3, 4, 5]);
  assert.deepEqual(result.visualEvents, []);
});

test('combatSnapshot을 사용하고 비공개 손패 데이터는 복원하지 않는다', () => {
  const postMatch = makeMatch();
  const replayEvents = [
    event(1, 3, 'turn_start', {
      combatSnapshot: {
        players: [
          { seatNo: 0, playerHealth: 30, boardState: postMatch.players[0].boardState },
          {
            seatNo: 1,
            playerHealth: 30,
            handCardInstanceIds: ['opponent-secret'],
            boardState: [{ cardInstanceId: 'defender', position: { row: 'front', column: 0 }, createdTurn: 1 }]
          }
        ],
        cardInstances: [
          {
            id: 'defender',
            ownerSeatNo: 1,
            cardVersionId: 'card-defender',
            zone: 'board',
            position: { row: 'front', column: 0 },
            currentAttack: 2,
            currentHealth: 4,
            damageTaken: 0,
            createdTurn: 1
          },
          {
            id: 'opponent-secret',
            ownerSeatNo: 1,
            cardVersionId: 'secret',
            zone: 'hand',
            position: null,
            currentAttack: 9,
            currentHealth: 9,
            damageTaken: 0,
            createdTurn: 0
          }
        ]
      }
    }),
    event(2, 3, 'line_attack', { targetCardInstanceId: 'defender', healthDamage: 4 }),
    event(3, 3, 'card_defeated', {
      seatNo: 1,
      cardInstanceId: 'defender',
      targetPosition: { row: 'front', column: 0 }
    })
  ];

  const beforeAttack = buildReplayPresentationMatch(postMatch, replayEvents, 0);
  const duringDefeat = buildReplayPresentationMatch(postMatch, replayEvents, 1);
  const afterDefeat = buildReplayPresentationMatch(postMatch, replayEvents, 2);

  assert.deepEqual(boardSlotFor(beforeAttack, 'defender')?.position, { row: 'front', column: 0 });
  assert.equal(instanceFor(beforeAttack, 'defender')?.damageTaken, 0);
  assert.equal(beforeAttack.players[1].playerHealth, 30);
  assert.deepEqual(beforeAttack.players[1].handCardInstanceIds, []);
  assert.equal(instanceFor(beforeAttack, 'opponent-secret'), undefined);

  assert.ok(boardSlotFor(duringDefeat, 'defender'), '파괴 이벤트 재생 중에는 대상 카드가 남아야 한다');
  assert.equal(instanceFor(duringDefeat, 'defender')?.damageTaken, 4);
  assert.equal(boardSlotFor(afterDefeat, 'defender'), undefined);
  assert.equal(instanceFor(afterDefeat, 'defender')?.zone, 'graveyard');

  assert.equal(postMatch.players[1].boardState.length, 0, '원본 매치는 변경하면 안 된다');
  assert.equal(instanceFor(postMatch, 'defender')?.damageTaken, 4);
  assert.notStrictEqual(afterDefeat, postMatch);
});

test('기존 리플레이는 최종 상태에서 파괴, 피해, 이동, 직접 공격을 역산한다', () => {
  const postMatch = makeMatch();
  const replayEvents = [
    event(1, 3, 'push', {
      targetSeatNo: 1,
      targetCardInstanceId: 'defender',
      to: { row: 'back', column: 0 }
    }),
    event(2, 3, 'line_attack', {
      targetSeatNo: 1,
      targetCardInstanceId: 'defender',
      targetPosition: { row: 'back', column: 0 },
      healthDamage: 4
    }),
    event(3, 3, 'card_defeated', {
      seatNo: 1,
      cardInstanceId: 'defender',
      targetPosition: { row: 'back', column: 0 }
    }),
    event(4, 3, 'direct_attack', {
      targetSeatNo: 1,
      column: 0,
      damage: 3,
      targetHealth: 27
    })
  ];

  const initial = buildReplayPresentationMatch(postMatch, replayEvents, 0);
  const afterPush = buildReplayPresentationMatch(postMatch, replayEvents, 1);
  const duringDefeat = buildReplayPresentationMatch(postMatch, replayEvents, 2);
  const afterDefeat = buildReplayPresentationMatch(postMatch, replayEvents, 3);
  const completed = buildReplayPresentationMatch(postMatch, replayEvents, 4);

  assert.deepEqual(boardSlotFor(initial, 'defender')?.position, { row: 'front', column: 0 });
  assert.equal(instanceFor(initial, 'defender')?.damageTaken, 0);
  assert.equal(initial.players[1].playerHealth, 30);
  assert.deepEqual(boardSlotFor(afterPush, 'defender')?.position, { row: 'back', column: 0 });
  assert.ok(boardSlotFor(duringDefeat, 'defender'));
  assert.equal(instanceFor(duringDefeat, 'defender')?.damageTaken, 4);
  assert.equal(boardSlotFor(afterDefeat, 'defender'), undefined);
  assert.equal(afterDefeat.players[1].playerHealth, 30);
  assert.equal(completed.players[1].playerHealth, 27);
  assert.equal(instanceFor(completed, 'defender')?.zone, 'graveyard');
});

test('v2 직접 공격은 레거시 targetHealth보다 전후 체력 경계를 우선한다', () => {
  const postMatch = makeMatch();
  postMatch.players[1].playerHealth = -3;
  const replayEvents = [
    event(1, 3, 'direct_attack', {
      targetSeatNo: 1,
      damage: 5,
      targetHealth: -8,
      playerHealthBefore: null,
      hp_before: 2,
      playerHealthAfter: null,
      hp_after: 0
    }),
    event(2, 3, 'residue', { targetCardInstanceId: 'attacker', shield: 1 })
  ];

  assert.equal(buildReplayPresentationMatch(postMatch, replayEvents, 0).players[1].playerHealth, 2);
  assert.equal(buildReplayPresentationMatch(postMatch, replayEvents, 1).players[1].playerHealth, 0);
  assert.equal(buildReplayPresentationMatch(postMatch, replayEvents, 2).players[1].playerHealth, 0);
});

test('직접 공격 목표는 상대와 내 시점 모두 후열 바깥에 놓인다', () => {
  const boardCenterAnchor = { x: 500, y: 300, radius: 0 };
  const opponentTarget = resolveDirectAttackTargetPoint({
    frontAnchor: { x: 500, y: 220, radius: 20 },
    backAnchor: { x: 500, y: 140, radius: 20 },
    boardCenterAnchor,
    seatAnchor: { x: 500, y: 40, radius: 18 }
  });
  const selfTarget = resolveDirectAttackTargetPoint({
    frontAnchor: { x: 500, y: 380, radius: 20 },
    backAnchor: { x: 500, y: 460, radius: 20 },
    boardCenterAnchor,
    seatAnchor: { x: 500, y: 560, radius: 18 }
  });

  assert.ok(opponentTarget && opponentTarget.y < 140);
  assert.ok(selfTarget && selfTarget.y > 460);
});

test('전열 앵커가 없어도 보드 중심에서 각 좌석 방향으로 후열 바깥을 겨냥한다', () => {
  const boardCenterAnchor = { x: 500, y: 300, radius: 0 };
  const opponentTarget = resolveDirectAttackTargetPoint({
    backAnchor: { x: 500, y: 140, radius: 20 },
    boardCenterAnchor,
    seatAnchor: { x: 500, y: 40, radius: 18 }
  });
  const selfTarget = resolveDirectAttackTargetPoint({
    backAnchor: { x: 500, y: 460, radius: 20 },
    boardCenterAnchor,
    seatAnchor: { x: 500, y: 560, radius: 18 }
  });

  assert.ok(opponentTarget && opponentTarget.y < 140);
  assert.ok(selfTarget && selfTarget.y > 460);
});

test('흡혈은 재생 전 피해량으로 돌아갔다가 이벤트 완료 후 회복된다', () => {
  const postMatch = makeMatch();
  instanceFor(postMatch, 'attacker').damageTaken = 1;
  const replayEvents = [
    event(1, 3, 'drain', { cardInstanceId: 'attacker', heal: 1 }),
    event(2, 3, 'residue', { targetCardInstanceId: 'attacker', shield: 1 })
  ];

  const beforeDrain = buildReplayPresentationMatch(postMatch, replayEvents, 0);
  const afterDrain = buildReplayPresentationMatch(postMatch, replayEvents, 1);

  assert.equal(instanceFor(beforeDrain, 'attacker')?.damageTaken, 2);
  assert.equal(instanceFor(afterDrain, 'attacker')?.damageTaken, 1);
});

test('광역 피해는 각 대상 카드의 실제 체력 피해만 리플레이 상태에 반영한다', () => {
  const postMatch = makeMatch();
  const defender = instanceFor(postMatch, 'defender');
  defender.zone = 'board';
  defender.position = { row: 'front', column: 0 };
  defender.damageTaken = 2;
  postMatch.players[1].boardState = [{ cardInstanceId: 'defender', position: { row: 'front', column: 0 }, createdTurn: 1 }];
  postMatch.players[1].graveyardCardInstanceIds = [];
  const replayEvents = [
    event(1, 3, 'aoe_damage', {
      sourceCardInstanceId: 'attacker',
      targetCardInstanceId: 'defender',
      damage: 3,
      shieldDamage: 1,
      healthDamage: 2
    })
  ];

  const beforeDamage = buildReplayPresentationMatch(postMatch, replayEvents, 0);
  const afterDamage = buildReplayPresentationMatch(postMatch, replayEvents, 1);

  assert.equal(instanceFor(beforeDamage, 'defender')?.damageTaken, 0);
  assert.equal(instanceFor(afterDamage, 'defender')?.damageTaken, 2);
});

test('응급 회복은 애니메이션 완료 시 대상 카드의 누적 피해를 회복한다', () => {
  const postMatch = makeMatch();
  instanceFor(postMatch, 'attacker').damageTaken = 1;
  const replayEvents = [
    event(1, 3, 'emergency_heal', {
      sourceCardInstanceId: 'attacker',
      targetCardInstanceId: 'attacker',
      heal: 2
    })
  ];

  const beforeHeal = buildReplayPresentationMatch(postMatch, replayEvents, 0);
  const afterHeal = buildReplayPresentationMatch(postMatch, replayEvents, 1);

  assert.equal(instanceFor(beforeHeal, 'attacker')?.damageTaken, 3);
  assert.equal(instanceFor(afterHeal, 'attacker')?.damageTaken, 1);
});

test('전투 드로우는 해당 장면이 끝난 뒤에만 덱과 손패 상태를 갱신한다', () => {
  const postMatch = makeMatch();
  postMatch.players[0].handCardInstanceIds.push('battle-drawn');
  postMatch.players[0].handCount = 2;
  postMatch.players[0].deckCount = 3;
  postMatch.cardInstances.push({
    id: 'battle-drawn',
    ownerSeatNo: 0,
    cardVersionId: 'card-battle-drawn',
    zone: 'hand',
    position: null,
    currentAttack: 1,
    currentHealth: 2,
    damageTaken: 0,
    statusEffects: [],
    createdTurn: 0
  });
  const replayEvents = [
    event(1, 3, 'turn_start', {
      combatSnapshot: {
        players: [
          {
            seatNo: 0,
            playerHealth: 30,
            handCount: 1,
            deckCount: 4,
            graveyardCardInstanceIds: [],
            boardState: postMatch.players[0].boardState
          },
          {
            seatNo: 1,
            playerHealth: 27,
            handCount: 3,
            deckCount: 4,
            graveyardCardInstanceIds: ['defender'],
            boardState: []
          }
        ],
        cardInstances: []
      }
    }),
    event(2, 3, 'battle_draw', {
      sourceCardInstanceId: 'attacker',
      sourceSeatNo: 0,
      sourcePosition: { row: 'front', column: 0 },
      cardInstanceId: 'battle-drawn',
      result: 'drawn',
      handCount: 2,
      deckCount: 3
    })
  ];

  const beforeDraw = buildReplayPresentationMatch(postMatch, replayEvents, 0);
  const afterDraw = buildReplayPresentationMatch(postMatch, replayEvents, 1);

  assert.equal(beforeDraw.players[0].handCount, 1);
  assert.equal(beforeDraw.players[0].deckCount, 4);
  assert.equal(beforeDraw.players[0].handCardInstanceIds.includes('battle-drawn'), false);
  assert.equal(instanceFor(beforeDraw, 'battle-drawn')?.zone, 'deck');
  assert.equal(afterDraw.players[0].handCount, 2);
  assert.equal(afterDraw.players[0].deckCount, 3);
  assert.equal(afterDraw.players[0].handCardInstanceIds.includes('battle-drawn'), true);
});

test('다음 턴 일반 드로우 카드는 전투 재생이 끝나기 전까지 덱에 남는다', () => {
  const postMatch = makeMatch();
  postMatch.players[0].handCardInstanceIds.push('turn-drawn');
  postMatch.players[0].handCount = 2;
  postMatch.players[0].deckCount = 3;
  postMatch.cardInstances.push({
    id: 'turn-drawn',
    ownerSeatNo: 0,
    cardVersionId: 'card-turn-drawn',
    zone: 'hand',
    position: null,
    currentAttack: 1,
    currentHealth: 2,
    damageTaken: 0,
    statusEffects: [],
    createdTurn: 0
  });
  const replayEvents = [
    event(1, 3, 'turn_start', {
      combatSnapshot: {
        players: [{
          seatNo: 0,
          playerHealth: 30,
          handCount: 1,
          deckCount: 4,
          graveyardCardInstanceIds: [],
          boardState: postMatch.players[0].boardState
        }],
        cardInstances: []
      }
    }),
    event(2, 3, 'line_attack', {
      cardInstanceId: 'attacker',
      targetCardInstanceId: 'defender',
      healthDamage: 0
    }),
    event(3, 4, 'draw', {
      seatNo: 0,
      cardInstanceId: 'turn-drawn',
      handCount: 2,
      deckCount: 3
    })
  ];

  const duringCombat = buildReplayPresentationMatch(postMatch, replayEvents, 0);
  const afterCombat = buildReplayPresentationMatch(postMatch, replayEvents, 1);

  assert.equal(duringCombat.players[0].handCount, 1);
  assert.equal(duringCombat.players[0].deckCount, 4);
  assert.equal(duringCombat.players[0].handCardInstanceIds.includes('turn-drawn'), false);
  assert.equal(instanceFor(duringCombat, 'turn-drawn')?.zone, 'deck');
  assert.equal(afterCombat.players[0].handCardInstanceIds.includes('turn-drawn'), true);
  assert.equal(instanceFor(afterCombat, 'turn-drawn')?.zone, 'hand');
});

test('다음 턴 손패 초과 카드는 전투 재생이 끝나기 전까지 묘지에 노출되지 않는다', () => {
  const postMatch = makeMatch();
  postMatch.players[0].handCount = 8;
  postMatch.players[0].deckCount = 3;
  postMatch.players[0].graveyardCardInstanceIds.push('turn-overdrawn');
  postMatch.cardInstances.push({
    id: 'turn-overdrawn',
    ownerSeatNo: 0,
    cardVersionId: 'card-turn-overdrawn',
    zone: 'graveyard',
    position: null,
    currentAttack: 1,
    currentHealth: 2,
    damageTaken: 0,
    statusEffects: [],
    createdTurn: 0
  });
  const replayEvents = [
    event(1, 3, 'turn_start', {
      combatSnapshot: {
        players: [{
          seatNo: 0,
          playerHealth: 30,
          handCount: 8,
          deckCount: 4,
          graveyardCardInstanceIds: [],
          boardState: postMatch.players[0].boardState
        }],
        cardInstances: []
      }
    }),
    event(2, 3, 'line_attack', {
      cardInstanceId: 'attacker',
      targetCardInstanceId: 'defender',
      healthDamage: 0
    }),
    event(3, 4, 'overdraw', {
      seatNo: 0,
      cardInstanceId: 'turn-overdrawn'
    })
  ];

  const duringCombat = buildReplayPresentationMatch(postMatch, replayEvents, 0);
  const afterCombat = buildReplayPresentationMatch(postMatch, replayEvents, 1);

  assert.equal(duringCombat.players[0].deckCount, 4);
  assert.equal(duringCombat.players[0].graveyardCardInstanceIds.includes('turn-overdrawn'), false);
  assert.equal(instanceFor(duringCombat, 'turn-overdrawn')?.zone, 'deck');
  assert.equal(afterCombat.players[0].graveyardCardInstanceIds.includes('turn-overdrawn'), true);
  assert.equal(instanceFor(afterCombat, 'turn-overdrawn')?.zone, 'graveyard');
});

test('묘지 회수 카드는 회수 장면이 끝난 뒤 묘지에서 손패로 이동한다', () => {
  const postMatch = makeMatch();
  postMatch.players[0].handCardInstanceIds.push('recovered');
  postMatch.players[0].handCount = 2;
  postMatch.cardInstances.push({
    id: 'recovered',
    ownerSeatNo: 0,
    cardVersionId: 'card-recovered',
    zone: 'hand',
    position: null,
    currentAttack: 2,
    currentHealth: 3,
    damageTaken: 0,
    statusEffects: [],
    createdTurn: 0
  });
  const replayEvents = [
    event(1, 3, 'turn_start', {
      combatSnapshot: {
        players: [
          {
            seatNo: 0,
            playerHealth: 30,
            handCount: 1,
            deckCount: 4,
            graveyardCardInstanceIds: ['recovered'],
            boardState: postMatch.players[0].boardState
          }
        ],
        cardInstances: []
      }
    }),
    event(2, 3, 'graveyard_recover', {
      sourceCardInstanceId: 'attacker',
      sourceSeatNo: 0,
      sourcePosition: { row: 'front', column: 0 },
      recoveredCardInstanceId: 'recovered',
      seatNo: 0,
      handCount: 2,
      graveyardCount: 0
    })
  ];

  const beforeRecover = buildReplayPresentationMatch(postMatch, replayEvents, 0);
  const afterRecover = buildReplayPresentationMatch(postMatch, replayEvents, 1);

  assert.equal(beforeRecover.players[0].handCount, 1);
  assert.equal(beforeRecover.players[0].handCardInstanceIds.includes('recovered'), false);
  assert.equal(beforeRecover.players[0].graveyardCardInstanceIds.includes('recovered'), true);
  assert.equal(instanceFor(beforeRecover, 'recovered')?.zone, 'graveyard');
  assert.equal(afterRecover.players[0].handCount, 2);
  assert.equal(afterRecover.players[0].handCardInstanceIds.includes('recovered'), true);
  assert.equal(afterRecover.players[0].graveyardCardInstanceIds.includes('recovered'), false);
});

test('완료된 8인전은 순위나 다음 경기 확정 전까지만 결과 동기화를 계속한다', () => {
  const pending = {
    ...makeMatch(),
    mode: 'battle_royale_8',
    status: 'completed',
    battleRoyaleId: 'br-1',
    viewerRole: 'participant',
    selfSeatNo: 0,
    viewerResult: null
  };

  assert.equal(shouldContinueBattleRoyaleResultSync(pending), true);
  assert.equal(shouldContinueBattleRoyaleResultSync({ ...pending, status: 'turn_planning' }), false);
  assert.equal(shouldContinueBattleRoyaleResultSync({ ...pending, viewerResult: { placement: null, nextMatchId: null } }), true);
  assert.equal(shouldContinueBattleRoyaleResultSync({ ...pending, viewerResult: { placement: 4, nextMatchId: null } }), false);
  assert.equal(shouldContinueBattleRoyaleResultSync({ ...pending, viewerResult: { placement: null, nextMatchId: 'match-next' } }), false);
  assert.equal(shouldContinueBattleRoyaleResultSync({
    ...pending,
    players: pending.players.map((player) => player.seatNo === 0 ? { ...player, finalRank: 2 } : player)
  }), false);
  assert.equal(shouldContinueBattleRoyaleResultSync({ ...pending, viewerRole: 'spectator', selfSeatNo: null }), false);
});

test('결과 공개와 턴 인트로 단계는 완료된 시각 이벤트 수를 따른다', () => {
  assert.equal(shouldRevealReplayResult('completed', 1, 2), false);
  assert.equal(shouldRevealReplayResult('completed', 2, 2), true);
  assert.equal(resolveReplayPresentationPhase({
    status: 'completed',
    completedVisualEventCount: 1,
    visualEventCount: 2,
    nowMs: 1000
  }), 'replaying');
  assert.equal(resolveReplayPresentationPhase({
    status: 'completed',
    completedVisualEventCount: 2,
    visualEventCount: 2,
    nowMs: 1000
  }), 'result');
  assert.equal(resolveReplayPresentationPhase({
    status: 'turn_planning',
    completedVisualEventCount: 2,
    visualEventCount: 2,
    nowMs: 1000,
    turnIntroStartsAtMs: 1200,
    turnIntroEndsAtMs: 2600
  }), 'replaying');
  assert.equal(resolveReplayPresentationPhase({
    status: 'turn_planning',
    completedVisualEventCount: 2,
    visualEventCount: 2,
    nowMs: 1200,
    turnIntroStartsAtMs: 1200,
    turnIntroEndsAtMs: 2600
  }), 'turn_intro');
  assert.equal(resolveReplayPresentationPhase({
    status: 'turn_planning',
    completedVisualEventCount: 2,
    visualEventCount: 2,
    nowMs: 1000,
    turnIntroEndsAtMs: 1500
  }), 'turn_intro');
  assert.equal(resolveReplayPresentationPhase({
    status: 'turn_planning',
    completedVisualEventCount: 2,
    visualEventCount: 2,
    nowMs: 1500,
    turnIntroEndsAtMs: 1500
  }), 'planning');
});

test('턴 시계는 서버 시작 전에는 멈추고 시작 시각 이후에만 감소한다', () => {
  assert.deepEqual(getReplayTurnClock(900, 1000, 40_000), { hasStarted: false, secondsLeft: 40 });
  assert.deepEqual(getReplayTurnClock(1000, 1000, 40_000), { hasStarted: true, secondsLeft: 40 });
  assert.deepEqual(getReplayTurnClock(40_999, 1000, 40_000), { hasStarted: true, secondsLeft: 1 });
  assert.deepEqual(getReplayTurnClock(41_000, 1000, 40_000), { hasStarted: true, secondsLeft: 0 });
});

test('턴 시계가 시작됐더라도 0초가 되면 계획 상호작용을 닫는다', () => {
  assert.equal(isReplayTurnClockOpen({ hasStarted: false, secondsLeft: 40 }), false);
  assert.equal(isReplayTurnClockOpen({ hasStarted: true, secondsLeft: 1 }), true);
  assert.equal(isReplayTurnClockOpen({ hasStarted: true, secondsLeft: 0 }), false);
  assert.equal(isReplayTurnClockOpen({ hasStarted: true, secondsLeft: -1 }), false);
});

test('리플레이 숫자 파서는 null, 빈 문자열, 비정상 값을 건너뛰고 유효한 별칭을 사용한다', () => {
  assert.equal(readReplayPayloadNumber({ current: null, legacy: 7 }, ['current', 'legacy']), 7);
  assert.equal(readReplayPayloadNumber({ current: '', legacy: '8' }, ['current', 'legacy']), 8);
  assert.equal(readReplayPayloadNumber({ current: 'invalid', legacy: 9 }, ['current', 'legacy']), 9);
  assert.equal(readReplayPayloadNumber({ current: null, legacy: '' }, ['current', 'legacy']), undefined);
});

test('진행 중 경기는 제한시간 이후에도 1초마다 동기화한다', () => {
  assert.equal(getArenaMatchSyncIntervalMs('mulligan'), 1_000);
  assert.equal(getArenaMatchSyncIntervalMs('turn_planning'), 1_000);
  assert.equal(getArenaMatchSyncIntervalMs('action_locked'), 1_000);
  assert.equal(getArenaMatchSyncIntervalMs('combat_resolving'), 1_000);
  assert.equal(getArenaMatchSyncIntervalMs('completed'), 2_000);
  assert.equal(getArenaMatchSyncIntervalMs('completed', true), 3_000);
});

test('피로 피해는 시각 이벤트로 재생되며 서버 health 경계로 플레이어 체력을 복원한다', () => {
  const postMatch = makeMatch();
  postMatch.players[1].playerHealth = 24;
  const replayEvents = [
    event(1, 4, 'fatigue', { seatNo: 1, fatigueCount: 3, damage: 3, health: 24 }),
    event(2, 4, 'residue', { targetCardInstanceId: 'attacker', shield: 1 })
  ];

  assert.deepEqual(selectLatestReplayScene(replayEvents).visualEvents.map(({ eventType }) => eventType), ['fatigue', 'residue']);
  assert.equal(buildReplayPresentationMatch(postMatch, replayEvents, 0).players[1].playerHealth, 27);
  assert.equal(buildReplayPresentationMatch(postMatch, replayEvents, 1).players[1].playerHealth, 24);
});

test('무료 전술 이동은 지정 횟수만 0코스트이고 이후 이동과 카드는 정상 비용을 쓴다', () => {
  const cardCosts = new Map([['card-3', 3], ['card-2', 2]]);
  const actions = [
    { type: 'place', cardInstanceId: 'card-3' },
    { type: 'move', cardInstanceId: 'board-1' },
    { type: 'replace', handCardInstanceId: 'card-2' },
    { type: 'move', cardInstanceId: 'board-2' }
  ];

  assert.equal(getArenaFreeTacticalMoveCount({ freeTacticalMoveCount: 1 }), 1);
  assert.equal(getArenaFreeTacticalMoveCount({ freeTacticalMove: true }), 1);
  assert.equal(calculateArenaTurnActionCost(actions, (id) => cardCosts.get(id) || 0, 1), 6);
  assert.equal(calculateArenaTurnActionCost(actions.slice(0, 2), (id) => cardCosts.get(id) || 0, 1), 3);
});

test('경기 요청 세대나 응답 경기 ID가 다르면 오래된 응답으로 판정한다', () => {
  assert.equal(isArenaMatchRequestCurrent(4, 4, 'match-b', 'match-b'), true);
  assert.equal(isArenaMatchRequestCurrent(4, 3, 'match-b', 'match-b'), false);
  assert.equal(isArenaMatchRequestCurrent(4, 4, 'match-b', 'match-a'), false);
  assert.equal(isArenaMatchRequestCurrent(4, 4, 'match-b', null), true);
});
test('리플레이 중에는 이전 장면 턴을 표시하고 인트로부터 서버의 새 턴을 표시한다', () => {
  const sceneEvents = [
    event(21, 4, 'line_attack'),
    event(22, 4, 'turn_end')
  ];

  assert.equal(resolveReplayDisplayTurnNo('replaying', 5, sceneEvents), 4);
  assert.equal(resolveReplayDisplayTurnNo('turn_intro', 5, sceneEvents), 5);
  assert.equal(resolveReplayDisplayTurnNo('planning', 5, sceneEvents), 5);
  assert.equal(resolveReplayDisplayTurnNo('replaying', 5, []), 5);
});
test('완료된 해결 배치는 N턴 전투와 N+1턴 피로를 같은 장면에서 실제 순서대로 재생한다', () => {
  const battleRoyaleScene = selectLatestReplayScene([
    event(1, 2, 'line_attack', { damage: 1 }),
    event(2, 2, 'turn_end', { nextTurnNo: 3 }),
    event(10, 3, 'turn_start', { turnNo: 3 }),
    event(11, 3, 'line_attack', { damage: 4 }),
    event(12, 3, 'card_defeated', { cardInstanceId: 'defender' }),
    event(13, 3, 'battle_royale_round_result', { winnerSeatNo: 0 }),
    event(14, 4, 'fatigue', { seatNo: 1, damage: 2, health: 0 })
  ]);

  assert.deepEqual(battleRoyaleScene.events.map(({ seq }) => seq), [10, 11, 12, 13, 14]);
  assert.deepEqual(
    battleRoyaleScene.visualEvents.map(({ eventType }) => eventType),
    ['line_attack', 'card_defeated', 'fatigue']
  );
  assert.equal(resolveReplayDisplayTurnNo('replaying', 4, battleRoyaleScene.events), 3);

  const quickFatigueDeathScene = selectLatestReplayScene([
    event(20, 7, 'turn_start', { turnNo: 7 }),
    event(21, 7, 'direct_attack', { targetSeatNo: 1, damage: 2, playerHealthAfter: 1 }),
    event(22, 8, 'fatigue', { seatNo: 1, damage: 1, health: 0 })
  ]);

  assert.deepEqual(quickFatigueDeathScene.events.map(({ seq }) => seq), [20, 21, 22]);
  assert.deepEqual(
    quickFatigueDeathScene.visualEvents.map(({ eventType }) => eventType),
    ['direct_attack', 'fatigue']
  );
  assert.equal(resolveReplayDisplayTurnNo('replaying', 8, quickFatigueDeathScene.events), 7);
});
