import { describe, expect, it } from 'vitest';
import {
  applyArenaV2PendingByeDrawsForClone,
  getArenaV2BattleRoyaleBaseLossDamage,
  resolveArenaV2BattleRoyaleRound,
  scheduleArenaV2BattleRoyaleRound,
  type ArenaV2BattleRoyaleParticipantState
} from '../services/arenaV2BattleRoyale';

const participant = (
  seedNo: number,
  overrides: Partial<ArenaV2BattleRoyaleParticipantState> = {}
): ArenaV2BattleRoyaleParticipantState => ({
  seedNo,
  userId: `user-${seedNo}`,
  deckId: `deck-${seedNo}`,
  status: 'active',
  roundStatus: 'paired',
  health: 30,
  currentRoundNo: 1,
  finalRank: null,
  currentMatchId: `round-1-match-${Math.ceil(seedNo / 2)}`,
  nextMatchId: null,
  stateSourceMatchId: null,
  lastOpponentUserId: seedNo % 2 === 1 ? `user-${seedNo + 1}` : `user-${seedNo - 1}`,
  lastByeRoundNo: null,
  byeCount: 0,
  pendingByeDraws: 0,
  wins: 0,
  lossStreak: 0,
  directDamageDealt: 0,
  freeTacticalMoveNextRound: false,
  frozenCardVersionIds: [`card-${seedNo}`],
  frozenCardPoolVersion: 'pool-1',
  validationHash: `validation-${seedNo}`,
  tieBreaker: `tie-${String(seedNo).padStart(2, '0')}`,
  ...overrides
});

describe('arena v2 battle royale round progression', () => {
  it('keeps a round loser alive when persistent health remains and schedules every survivor again', () => {
    const participants = [
      participant(1, { health: 20 }),
      participant(2, { health: 20 }),
      participant(3, { health: 20 }),
      participant(4, { health: 20 })
    ];

    const result = resolveArenaV2BattleRoyaleRound({
      battleRoyaleId: 'br-1',
      roundNo: 1,
      participants,
      matches: [
        {
          matchId: 'round-1-match-1',
          winnerUserId: 'user-1',
          players: [
            { userId: 'user-1', health: 18, directDamageDealt: 2 },
            { userId: 'user-2', health: 15, directDamageDealt: 0 }
          ]
        },
        {
          matchId: 'round-1-match-2',
          winnerUserId: 'user-3',
          players: [
            { userId: 'user-3', health: 19, directDamageDealt: 1 },
            { userId: 'user-4', health: 14, directDamageDealt: 0 }
          ]
        }
      ]
    });

    expect(result.finished).toBe(false);
    expect(result.participants.find((item) => item.userId === 'user-2')).toMatchObject({
      status: 'active',
      health: 13,
      lossStreak: 1,
      freeTacticalMoveNextRound: true,
      currentRoundNo: 2
    });
    expect(result.pairings.flatMap((pairing) => [pairing.leftUserId, pairing.rightUserId]).sort()).toEqual([
      'user-1', 'user-2', 'user-3', 'user-4'
    ]);
  });

  it('waits for every paired player result before advancing the shared round', () => {
    const participants = [participant(1), participant(2), participant(3), participant(4)];
    expect(() => resolveArenaV2BattleRoyaleRound({
      battleRoyaleId: 'br-1',
      roundNo: 1,
      participants,
      matches: [{
        matchId: 'round-1-match-1',
        winnerUserId: 'user-1',
        players: [
          { userId: 'user-1', health: 30 },
          { userId: 'user-2', health: 20 }
        ]
      }]
    })).toThrow('ArenaV2BattleRoyaleRoundIncomplete');
  });

  it('avoids an immediate rematch before minimizing health distance', () => {
    const schedule = scheduleArenaV2BattleRoyaleRound([
      participant(1, { health: 30, lastOpponentUserId: 'user-2' }),
      participant(2, { health: 29, lastOpponentUserId: 'user-1' }),
      participant(3, { health: 12, lastOpponentUserId: 'user-4' }),
      participant(4, { health: 11, lastOpponentUserId: 'user-3' })
    ], 2);

    const keys = schedule.pairings.map((pairing) => [pairing.leftUserId, pairing.rightUserId].sort().join(':'));
    expect(keys).not.toContain('user-1:user-2');
    expect(keys).not.toContain('user-3:user-4');
  });

  it('chooses the bye together with pairings so an avoidable immediate rematch never occurs', () => {
    const schedule = scheduleArenaV2BattleRoyaleRound([
      participant(1, { lastOpponentUserId: 'user-2' }),
      participant(2, { lastOpponentUserId: 'user-1' }),
      participant(3, { lastOpponentUserId: 'user-4' })
    ], 2);

    expect(schedule.byeUserId).not.toBe('user-3');
    expect(schedule.pairings).toHaveLength(1);
    expect([
      schedule.pairings[0].leftUserId,
      schedule.pairings[0].rightUserId
    ].sort().join(':')).not.toBe('user-1:user-2');
    expect(schedule.participants.find((item) => item.userId === schedule.byeUserId)).toMatchObject({
      pendingByeDraws: 1
    });
  });

  it('gives an odd-player bye to the longest-waiting participant and prevents consecutive byes', () => {
    const first = scheduleArenaV2BattleRoyaleRound([
      participant(1, { lastByeRoundNo: 2, byeCount: 1 }),
      participant(2, { lastByeRoundNo: null, byeCount: 0 }),
      participant(3, { lastByeRoundNo: 1, byeCount: 1 })
    ], 3);
    expect(first.byeUserId).toBe('user-2');

    const second = scheduleArenaV2BattleRoyaleRound(first.participants, 4);
    expect(second.byeUserId).not.toBe('user-2');
    expect(second.participants.find((item) => item.userId === second.byeUserId)).toMatchObject({
      roundStatus: 'bye',
      currentMatchId: null
    });
  });

  it('applies a pending bye draw exactly once when cloning persistent zones', () => {
    const once = applyArenaV2PendingByeDrawsForClone({
      handCardInstanceIds: ['hand-1'],
      deckCardInstanceIds: ['deck-1', 'deck-2'],
      graveyardCardInstanceIds: [],
      pendingDraws: 1
    });
    expect(once).toEqual({
      handCardInstanceIds: ['hand-1', 'deck-1'],
      deckCardInstanceIds: ['deck-2'],
      graveyardCardInstanceIds: [],
      zoneOverrideByInstanceId: { 'deck-1': 'hand' },
      appliedDrawCount: 1
    });

    const noPendingDraw = applyArenaV2PendingByeDrawsForClone({
      handCardInstanceIds: once.handCardInstanceIds,
      deckCardInstanceIds: once.deckCardInstanceIds,
      graveyardCardInstanceIds: once.graveyardCardInstanceIds,
      pendingDraws: 0
    });
    expect(noPendingDraw.handCardInstanceIds).toEqual(['hand-1', 'deck-1']);
    expect(noPendingDraw.deckCardInstanceIds).toEqual(['deck-2']);
  });

  it('orders simultaneous eliminations by GDD criteria and completes with one champion', () => {
    const result = resolveArenaV2BattleRoyaleRound({
      battleRoyaleId: 'br-final',
      roundNo: 7,
      participants: [
        participant(1, { health: 6, wins: 3, directDamageDealt: 20 }),
        participant(2, { health: 8, wins: 2, directDamageDealt: 30 })
      ],
      matches: [{
        matchId: 'final-match',
        winnerUserId: null,
        players: [
          { userId: 'user-1', health: 1 },
          { userId: 'user-2', health: 1 }
        ]
      }]
    });

    expect(result.finished).toBe(true);
    expect(result.winnerUserId).toBe('user-2');
    expect(result.eliminatedUserIds).toEqual(['user-1']);
    expect(result.participants.find((item) => item.userId === 'user-2')).toMatchObject({ status: 'winner', finalRank: 1 });
    expect(result.participants.find((item) => item.userId === 'user-1')).toMatchObject({ status: 'eliminated', finalRank: 2 });
  });

  it('uses the configured round loss-damage bands', () => {
    expect([1, 3, 4, 6, 7, 9, 10, 30].map(getArenaV2BattleRoyaleBaseLossDamage)).toEqual([
      2, 2, 3, 3, 4, 4, 5, 5
    ]);
  });
});
