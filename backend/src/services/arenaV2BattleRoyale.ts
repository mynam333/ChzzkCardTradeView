export type ArenaV2BattleRoyaleParticipantStatus = 'active' | 'eliminated' | 'winner';
export type ArenaV2BattleRoyaleRoundStatus = 'paired' | 'bye' | 'eliminated' | 'winner';

export interface ArenaV2BattleRoyaleParticipantState {
  seedNo: number;
  userId: string;
  deckId: string;
  status: ArenaV2BattleRoyaleParticipantStatus;
  roundStatus: ArenaV2BattleRoyaleRoundStatus;
  health: number;
  currentRoundNo: number;
  finalRank: number | null;
  currentMatchId: string | null;
  nextMatchId: string | null;
  stateSourceMatchId: string | null;
  lastOpponentUserId: string | null;
  lastByeRoundNo: number | null;
  byeCount: number;
  pendingByeDraws: number;
  wins: number;
  lossStreak: number;
  directDamageDealt: number;
  freeTacticalMoveNextRound: boolean;
  frozenCardVersionIds: string[];
  frozenCardPoolVersion: string;
  validationHash: string | null;
  tieBreaker: string;
}

export interface ArenaV2BattleRoyalePairing {
  leftUserId: string;
  rightUserId: string;
}

export interface ArenaV2BattleRoyaleRoundSchedule {
  participants: ArenaV2BattleRoyaleParticipantState[];
  pairings: ArenaV2BattleRoyalePairing[];
  byeUserId: string | null;
}

export interface ArenaV2BattleRoyaleRoundPlayerResult {
  userId: string;
  health: number;
  directDamageDealt?: number;
}

export interface ArenaV2BattleRoyaleRoundMatchResult {
  matchId: string;
  winnerUserId: string | null;
  players: ArenaV2BattleRoyaleRoundPlayerResult[];
}

export interface ArenaV2BattleRoyaleRoundResolution extends ArenaV2BattleRoyaleRoundSchedule {
  finished: boolean;
  winnerUserId: string | null;
  eliminatedUserIds: string[];
  nextRoundNo: number;
}

const nonNegativeInteger = (value: unknown, fallback = 0) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
};

const nullablePositiveInteger = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : null;
};

const nullableString = (value: unknown): string | null => (
  typeof value === 'string' && value ? value : null
);

export const normalizeArenaV2BattleRoyaleParticipant = (
  value: Record<string, unknown>,
  battleRoyaleId: string
): ArenaV2BattleRoyaleParticipantState => {
  const userId = String(value.userId ?? value.user_id ?? '');
  const seedNo = Math.max(1, nonNegativeInteger(value.seedNo ?? value.seed_no, 1));
  const rawStatus = String(value.status || 'active');
  const status: ArenaV2BattleRoyaleParticipantStatus = rawStatus === 'winner'
    ? 'winner'
    : rawStatus === 'eliminated' ? 'eliminated' : 'active';
  const rawRoundStatus = String(value.roundStatus ?? value.round_status ?? 'paired');
  const roundStatus: ArenaV2BattleRoyaleRoundStatus = status === 'winner'
    ? 'winner'
    : status === 'eliminated'
      ? 'eliminated'
      : rawRoundStatus === 'bye' ? 'bye' : 'paired';
  const rawFrozenCardVersionIds = value.frozenCardVersionIds ?? value.frozen_card_version_ids;
  const frozenCardVersionIds = Array.isArray(rawFrozenCardVersionIds)
    ? rawFrozenCardVersionIds.filter((item): item is string => typeof item === 'string' && Boolean(item))
    : [];

  return {
    seedNo,
    userId,
    deckId: String(value.deckId ?? value.deck_id ?? ''),
    status,
    roundStatus,
    health: nonNegativeInteger(value.health ?? value.playerHealth ?? value.player_health, 30),
    currentRoundNo: nonNegativeInteger(value.currentRoundNo ?? value.current_round_no, 0),
    finalRank: nullablePositiveInteger(value.finalRank ?? value.final_rank),
    currentMatchId: nullableString(value.currentMatchId ?? value.current_match_id),
    nextMatchId: nullableString(value.nextMatchId ?? value.next_match_id),
    stateSourceMatchId: nullableString(value.stateSourceMatchId ?? value.state_source_match_id),
    lastOpponentUserId: nullableString(value.lastOpponentUserId ?? value.last_opponent_user_id),
    lastByeRoundNo: nullablePositiveInteger(value.lastByeRoundNo ?? value.last_bye_round_no),
    byeCount: nonNegativeInteger(value.byeCount ?? value.bye_count),
    pendingByeDraws: nonNegativeInteger(value.pendingByeDraws ?? value.pending_bye_draws),
    wins: nonNegativeInteger(value.wins),
    lossStreak: nonNegativeInteger(value.lossStreak ?? value.loss_streak),
    directDamageDealt: nonNegativeInteger(value.directDamageDealt ?? value.direct_damage_dealt),
    freeTacticalMoveNextRound: Boolean(value.freeTacticalMoveNextRound ?? value.free_tactical_move_next_round),
    frozenCardVersionIds,
    frozenCardPoolVersion: String(value.frozenCardPoolVersion ?? value.frozen_card_pool_version ?? ''),
    validationHash: nullableString(value.validationHash ?? value.validation_hash),
    tieBreaker: String(value.tieBreaker ?? value.tie_breaker ?? `${battleRoyaleId}:${String(seedNo).padStart(2, '0')}:${userId}`)
  };
};

export const applyArenaV2PendingByeDrawsForClone = (input: {
  handCardInstanceIds: string[];
  deckCardInstanceIds: string[];
  graveyardCardInstanceIds: string[];
  pendingDraws: number;
  maxHandSize?: number;
}) => {
  const handCardInstanceIds = [...input.handCardInstanceIds];
  const deckCardInstanceIds = [...input.deckCardInstanceIds];
  const graveyardCardInstanceIds = [...input.graveyardCardInstanceIds];
  const zoneOverrideByInstanceId: Record<string, 'hand' | 'graveyard'> = {};
  const pendingDraws = Math.max(0, Math.floor(Number(input.pendingDraws || 0)));
  const maxHandSize = Math.max(1, Math.floor(Number(input.maxHandSize || 8)));
  for (let index = 0; index < pendingDraws; index += 1) {
    const drawnId = deckCardInstanceIds.shift();
    // A bye grants no health damage, including empty-deck fatigue damage.
    if (!drawnId) continue;
    if (handCardInstanceIds.length >= maxHandSize) {
      graveyardCardInstanceIds.push(drawnId);
      zoneOverrideByInstanceId[drawnId] = 'graveyard';
    } else {
      handCardInstanceIds.push(drawnId);
      zoneOverrideByInstanceId[drawnId] = 'hand';
    }
  }
  return {
    handCardInstanceIds,
    deckCardInstanceIds,
    graveyardCardInstanceIds,
    zoneOverrideByInstanceId,
    appliedDrawCount: pendingDraws
  };
};

const participantOrder = (left: ArenaV2BattleRoyaleParticipantState, right: ArenaV2BattleRoyaleParticipantState) => (
  left.seedNo - right.seedNo || left.userId.localeCompare(right.userId)
);

const pairingKey = (pairing: ArenaV2BattleRoyalePairing) => (
  [pairing.leftUserId, pairing.rightUserId].sort().join(':')
);

type PairingCandidate = {
  pairings: ArenaV2BattleRoyalePairing[];
  rematchCount: number;
  healthDistance: number;
  key: string;
};

const betterPairingCandidate = (left: PairingCandidate | null, right: PairingCandidate): PairingCandidate => {
  if (!left) return right;
  if (right.rematchCount !== left.rematchCount) return right.rematchCount < left.rematchCount ? right : left;
  if (right.healthDistance !== left.healthDistance) return right.healthDistance < left.healthDistance ? right : left;
  return right.key.localeCompare(left.key) < 0 ? right : left;
};

const enumeratePairings = (
  participants: ArenaV2BattleRoyaleParticipantState[]
): PairingCandidate => {
  if (participants.length === 0) return { pairings: [], rematchCount: 0, healthDistance: 0, key: '' };
  const [first, ...remaining] = participants;
  let best: PairingCandidate | null = null;
  for (let index = 0; index < remaining.length; index += 1) {
    const opponent = remaining[index];
    const rest = remaining.filter((_, candidateIndex) => candidateIndex !== index);
    const nested = enumeratePairings(rest);
    const pairing: ArenaV2BattleRoyalePairing = {
      leftUserId: first.userId,
      rightUserId: opponent.userId
    };
    const candidate: PairingCandidate = {
      pairings: [pairing, ...nested.pairings],
      rematchCount: nested.rematchCount + (
        first.lastOpponentUserId === opponent.userId || opponent.lastOpponentUserId === first.userId ? 1 : 0
      ),
      healthDistance: nested.healthDistance + Math.abs(first.health - opponent.health),
      key: [pairingKey(pairing), nested.key].filter(Boolean).join('|')
    };
    best = betterPairingCandidate(best, candidate);
  }
  if (!best) throw new Error('ArenaV2BattleRoyalePairingImpossible');
  return best;
};

const selectByeAndPairing = (
  participants: ArenaV2BattleRoyaleParticipantState[],
  roundNo: number
) => {
  const withoutConsecutiveBye = participants.filter((participant) => participant.lastByeRoundNo !== roundNo - 1);
  const candidates = withoutConsecutiveBye.length > 0 ? withoutConsecutiveBye : participants;
  return candidates.map((bye) => ({
    bye,
    pairing: enumeratePairings(participants.filter((participant) => participant.userId !== bye.userId))
  })).sort((left, right) => {
    if (left.pairing.rematchCount !== right.pairing.rematchCount) {
      return left.pairing.rematchCount - right.pairing.rematchCount;
    }
    const leftNeverRested = left.bye.lastByeRoundNo == null;
    const rightNeverRested = right.bye.lastByeRoundNo == null;
    if (leftNeverRested !== rightNeverRested) return leftNeverRested ? -1 : 1;
    const leftRound = left.bye.lastByeRoundNo ?? 0;
    const rightRound = right.bye.lastByeRoundNo ?? 0;
    if (leftRound !== rightRound) return leftRound - rightRound;
    if (left.bye.byeCount !== right.bye.byeCount) return left.bye.byeCount - right.bye.byeCount;
    if (left.pairing.healthDistance !== right.pairing.healthDistance) {
      return left.pairing.healthDistance - right.pairing.healthDistance;
    }
    return participantOrder(left.bye, right.bye) || left.pairing.key.localeCompare(right.pairing.key);
  })[0];
};

export const scheduleArenaV2BattleRoyaleRound = (
  sourceParticipants: ArenaV2BattleRoyaleParticipantState[],
  roundNo: number
): ArenaV2BattleRoyaleRoundSchedule => {
  const participants = sourceParticipants.map((participant) => ({
    ...participant,
    frozenCardVersionIds: [...participant.frozenCardVersionIds],
    nextMatchId: null,
    currentMatchId: participant.status === 'active' ? null : participant.currentMatchId,
    currentRoundNo: participant.status === 'active' ? roundNo : participant.currentRoundNo
  }));
  const active = participants.filter((participant) => participant.status === 'active').sort(participantOrder);
  if (active.length < 2) {
    return { participants, pairings: [], byeUserId: null };
  }

  const byeSelection = active.length % 2 === 1 ? selectByeAndPairing(active, roundNo) : null;
  const bye = byeSelection?.bye ?? null;
  const pairingCandidate = byeSelection?.pairing ?? enumeratePairings(active);
  const byUserId = new Map(participants.map((participant) => [participant.userId, participant]));

  for (const pairing of pairingCandidate.pairings) {
    const left = byUserId.get(pairing.leftUserId);
    const right = byUserId.get(pairing.rightUserId);
    if (!left || !right) throw new Error('ArenaV2BattleRoyaleParticipantMissing');
    left.roundStatus = 'paired';
    right.roundStatus = 'paired';
    left.lastOpponentUserId = right.userId;
    right.lastOpponentUserId = left.userId;
  }
  if (bye) {
    const byeState = byUserId.get(bye.userId);
    if (!byeState) throw new Error('ArenaV2BattleRoyaleParticipantMissing');
    byeState.roundStatus = 'bye';
    byeState.lastOpponentUserId = null;
    byeState.lastByeRoundNo = roundNo;
    byeState.byeCount += 1;
    byeState.pendingByeDraws += 1;
    byeState.freeTacticalMoveNextRound = false;
  }

  return {
    participants: [...byUserId.values()].sort(participantOrder),
    pairings: pairingCandidate.pairings,
    byeUserId: bye?.userId ?? null
  };
};

export const getArenaV2BattleRoyaleBaseLossDamage = (roundNo: number) => {
  if (roundNo <= 3) return 2;
  if (roundNo <= 6) return 3;
  if (roundNo <= 9) return 4;
  return 5;
};

export const getArenaV2BattleRoyaleLossStreakDamage = (lossStreak: number) => {
  if (lossStreak <= 1) return 0;
  if (lossStreak === 2) return 1;
  if (lossStreak === 3) return 2;
  return 3;
};

const simultaneousEliminationOrder = (
  beforeHealthByUserId: Map<string, number>,
  left: ArenaV2BattleRoyaleParticipantState,
  right: ArenaV2BattleRoyaleParticipantState
) => (
  right.health - left.health
  || (beforeHealthByUserId.get(right.userId) || 0) - (beforeHealthByUserId.get(left.userId) || 0)
  || right.wins - left.wins
  || right.directDamageDealt - left.directDamageDealt
  || left.tieBreaker.localeCompare(right.tieBreaker)
);

export const resolveArenaV2BattleRoyaleRound = (input: {
  battleRoyaleId: string;
  roundNo: number;
  participants: ArenaV2BattleRoyaleParticipantState[];
  matches: ArenaV2BattleRoyaleRoundMatchResult[];
}): ArenaV2BattleRoyaleRoundResolution => {
  const participants = input.participants.map((participant) => ({
    ...participant,
    frozenCardVersionIds: [...participant.frozenCardVersionIds]
  }));
  const byUserId = new Map(participants.map((participant) => [participant.userId, participant]));
  const beforeHealthByUserId = new Map(participants.map((participant) => [participant.userId, participant.health]));
  const expectedPairedUserIds = new Set(participants
    .filter((participant) => participant.status === 'active' && participant.roundStatus === 'paired')
    .map((participant) => participant.userId));
  const resolvedUserIds = new Set<string>();
  const baseLossDamage = getArenaV2BattleRoyaleBaseLossDamage(input.roundNo);

  for (const match of input.matches) {
    if (match.players.length !== 2) throw new Error('ArenaV2BattleRoyaleMatchPlayerCountInvalid');
    const [leftResult, rightResult] = match.players;
    const left = byUserId.get(leftResult.userId);
    const right = byUserId.get(rightResult.userId);
    if (!left || !right || left.status !== 'active' || right.status !== 'active') {
      throw new Error('ArenaV2BattleRoyaleMatchParticipantInvalid');
    }
    if (resolvedUserIds.has(left.userId) || resolvedUserIds.has(right.userId)) {
      throw new Error('ArenaV2BattleRoyaleParticipantResolvedTwice');
    }
    if (match.winnerUserId && match.winnerUserId !== left.userId && match.winnerUserId !== right.userId) {
      throw new Error('ArenaV2BattleRoyaleWinnerInvalid');
    }
    resolvedUserIds.add(left.userId);
    resolvedUserIds.add(right.userId);
    left.health = nonNegativeInteger(leftResult.health);
    right.health = nonNegativeInteger(rightResult.health);
    left.directDamageDealt += nonNegativeInteger(leftResult.directDamageDealt);
    right.directDamageDealt += nonNegativeInteger(rightResult.directDamageDealt);

    if (!match.winnerUserId) {
      const drawDamage = Math.floor(baseLossDamage / 2);
      left.health = Math.max(0, left.health - drawDamage);
      right.health = Math.max(0, right.health - drawDamage);
      left.freeTacticalMoveNextRound = false;
      right.freeTacticalMoveNextRound = false;
      continue;
    }

    const winner = match.winnerUserId === left.userId ? left : right;
    const loser = winner === left ? right : left;
    winner.wins += 1;
    winner.lossStreak = 0;
    winner.freeTacticalMoveNextRound = false;
    loser.lossStreak += 1;
    loser.health = Math.max(
      0,
      loser.health - baseLossDamage - getArenaV2BattleRoyaleLossStreakDamage(loser.lossStreak)
    );
    loser.freeTacticalMoveNextRound = loser.health > 0;
  }

  if ([...expectedPairedUserIds].some((userId) => !resolvedUserIds.has(userId))
    || [...resolvedUserIds].some((userId) => !expectedPairedUserIds.has(userId))) {
    throw new Error('ArenaV2BattleRoyaleRoundIncomplete');
  }

  const newlyEliminated = participants.filter((participant) => participant.status === 'active' && participant.health <= 0);
  let survivors = participants.filter((participant) => participant.status === 'active' && participant.health > 0);
  let winnerUserId: string | null = null;

  if (survivors.length === 0 && newlyEliminated.length > 0) {
    const ordered = [...newlyEliminated].sort((left, right) => simultaneousEliminationOrder(beforeHealthByUserId, left, right));
    winnerUserId = ordered[0].userId;
    ordered.forEach((participant, index) => {
      participant.finalRank = index + 1;
      participant.status = index === 0 ? 'winner' : 'eliminated';
      participant.roundStatus = index === 0 ? 'winner' : 'eliminated';
      participant.nextMatchId = null;
    });
    survivors = [ordered[0]];
  } else {
    const orderedEliminated = [...newlyEliminated]
      .sort((left, right) => simultaneousEliminationOrder(beforeHealthByUserId, left, right));
    orderedEliminated.forEach((participant, index) => {
      participant.finalRank = survivors.length + index + 1;
      participant.status = 'eliminated';
      participant.roundStatus = 'eliminated';
      participant.nextMatchId = null;
    });
    if (survivors.length === 1) {
      const winner = survivors[0];
      winner.status = 'winner';
      winner.roundStatus = 'winner';
      winner.finalRank = 1;
      winner.nextMatchId = null;
      winnerUserId = winner.userId;
    }
  }

  const eliminatedUserIds = newlyEliminated
    .filter((participant) => participant.status === 'eliminated')
    .map((participant) => participant.userId);
  const finished = survivors.length === 1;
  const nextRoundNo = finished ? input.roundNo : input.roundNo + 1;
  if (finished) {
    return {
      participants: participants.sort(participantOrder),
      pairings: [],
      byeUserId: null,
      finished: true,
      winnerUserId,
      eliminatedUserIds,
      nextRoundNo
    };
  }

  const schedule = scheduleArenaV2BattleRoyaleRound(participants, nextRoundNo);
  return {
    ...schedule,
    finished: false,
    winnerUserId: null,
    eliminatedUserIds,
    nextRoundNo
  };
};
