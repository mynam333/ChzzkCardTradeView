export type ArenaV2ModeDto = 'bot' | 'quick' | 'battle_royale_8';
export type ArenaV2SeasonStatusDto = 'draft' | 'scheduled' | 'active' | 'locked' | 'settling' | 'closed' | 'cancelled';
export type ArenaV2MatchStatusDto =
  | 'created'
  | 'mulligan'
  | 'turn_planning'
  | 'action_locked'
  | 'combat_resolving'
  | 'turn_result'
  | 'completed'
  | 'cancelled';
export type ArenaV2QueueStatusDto =
  | 'waiting'
  | 'proposed'
  | 'accepted'
  | 'matched'
  | 'cancelled'
  | 'declined'
  | 'accept_timeout'
  | 'expired';

export interface ArenaV2QuickQueueTicketDto {
  id: string;
  seasonId: string;
  userId: string;
  deckId: string;
  mmr: number;
  status: ArenaV2QueueStatusDto;
  searchMinMmr: number;
  searchMaxMmr: number;
  currentSearchRange: number;
  currentMmrRange: { minMmr: number; maxMmr: number };
  proposalId: string | null;
  acceptDeadlineAt: string | null;
  acceptedAt: string | null;
  acceptedBySelf: boolean;
  opponentAccepted: boolean;
  requiresAcceptance: boolean;
  matchedMatchId: string | null;
  joinedAt: string;
  updatedAt: string;
  expiresAt: string;
  priorityPenalty: number;
  timeoutStrikes: number;
  transitionReason: 'opponent_timeout' | 'opponent_cancelled' | 'opponent_invalid_deck' | 'proposal_expired' | 'cancelled_proposal' | 'invalid_deck' | null;
}

export interface ArenaV2QuickQueueResponseDto {
  status: ArenaV2QueueStatusDto | 'none';
  serverNow: string;
  queueId?: string;
  joinedAt?: string;
  acceptDeadlineAt?: string | null;
  proposalId?: string | null;
  acceptedBySelf?: boolean;
  opponentAccepted?: boolean;
  requiresAcceptance?: boolean;
  transitionReason?: ArenaV2QuickQueueTicketDto['transitionReason'];
  estimatedRange?: { minMmr: number; maxMmr: number };
  matchId?: string | null;
  ticket: ArenaV2QuickQueueTicketDto | null;
}
export type ArenaV2BoardRowDto = 'front' | 'back';
export type ArenaV2BoardColumnDto = 0 | 1 | 2;

export interface ArenaV2BoardPositionDto {
  row: ArenaV2BoardRowDto;
  column: ArenaV2BoardColumnDto;
}

export type ArenaV2CardClassDto = 'charge' | 'guardian' | 'sniper' | 'support' | 'trick' | 'specter' | 'tech';
export type ArenaV2CardStatusDto = 'draft' | 'active' | 'disabled';

export interface ArenaV2KeywordDto {
  type: string;
  value?: number;
  limit?: string;
}

export interface ArenaV2CardVersionDto {
  id: string;
  streamerId: string;
  displayName: string;
  seasonId: string;
  version: number;
  cardClass: ArenaV2CardClassDto;
  cost: number;
  attack: number;
  health: number;
  keywords: ArenaV2KeywordDto[];
  status: ArenaV2CardStatusDto;
  artAssetId?: string | null;
  balanceScore?: number;
  validationResult?: ArenaV2ValidationResultDto | null;
  ownedCount?: number;
  ownedStars?: number[];
  streamer?: {
    channelId: string;
    name: string;
    logoUrl?: string | null;
    customImageUrl?: string | null;
    isImageBanned?: boolean;
  };
}

export interface ArenaV2DeckDto {
  id: string;
  userId: string;
  seasonId: string;
  name: string;
  modeScope: 'all' | 'quick' | 'battle_royale_8' | 'bot';
  cardVersionIds: string[];
  isValid: boolean;
}

export interface ArenaV2CardInstanceDto {
  id: string;
  ownerSeatNo: number;
  cardVersionId: string;
  card?: ArenaV2CardVersionDto;
  zone: 'deck' | 'hand' | 'board' | 'graveyard' | 'banished' | string;
  position: ArenaV2BoardPositionDto | null;
  currentAttack: number;
  currentHealth: number;
  damageTaken: number;
  statusEffects: unknown[];
  createdTurn: number;
}

export interface ArenaV2MatchPlayerDto {
  seatNo: number;
  userId: string | null;
  deckId: string | null;
  playerHealth: number;
  fatigueCount: number;
  handCardInstanceIds: string[];
  handCount: number;
  deckCount: number;
  graveyardCardInstanceIds: string[];
  boardState: Array<{ cardInstanceId: string; position: ArenaV2BoardPositionDto; createdTurn: number }>;
  mulliganState: unknown;
  finalRank: number | null;
}

export type ArenaV2ViewerRoleDto = 'participant' | 'spectator';

export interface ArenaV2PhaseTimingDto {
  replayDurationMs: number;
  replayEndsAt: string | null;
  introDurationMs: number;
  planningStartsAt: string | null;
  turnDeadlineAt: string | null;
  serverNow: string;
}

export interface ArenaV2ViewerResultDto {
  outcome: 'win' | 'loss' | 'draw';
  mmrBefore: number | null;
  mmrAfter: number | null;
  mmrDelta: number | null;
  tierBefore: string | null;
  tierAfter: string | null;
  unrated: boolean;
  placement: number | null;
  sharedPlacement: boolean;
  canSpectate: boolean;
  nextMatchId: string | null;
}

export interface ArenaV2MatchViewDto {
  id: string;
  seasonId: string | null;
  mode: ArenaV2ModeDto;
  status: ArenaV2MatchStatusDto;
  battleRoyaleId: string | null;
  roundNo: number;
  turnNo: number;
  rulesVersion: string;
  cardPoolVersion: string;
  startedAt: string;
  finishedAt: string | null;
  winnerUserId: string | null;
  resultSummary: unknown;
  viewerRole: ArenaV2ViewerRoleDto;
  phaseTiming: ArenaV2PhaseTimingDto | null;
  viewerResult: ArenaV2ViewerResultDto | null;
  selfSeatNo: number | null;
  players: ArenaV2MatchPlayerDto[];
  cardInstances: ArenaV2CardInstanceDto[];
}

export type ArenaV2TurnActionDto =
  | { type: 'place'; cardInstanceId: string; to: ArenaV2BoardPositionDto }
  | { type: 'move'; cardInstanceId: string; from: ArenaV2BoardPositionDto; to: ArenaV2BoardPositionDto }
  | { type: 'replace'; handCardInstanceId: string; target: ArenaV2BoardPositionDto }
  | { type: 'end' };

export interface ArenaV2SubmitTurnActionRequestDto {
  turnNo: number;
  revision: number;
  isFinal: boolean;
  actions: ArenaV2TurnActionDto[];
}

export interface ArenaV2SubmitTurnActionResponseDto {
  submissionId: string;
  validation: ArenaV2ValidationResultDto;
  accepted: boolean;
  match: ArenaV2MatchViewDto | null;
}

export interface ArenaV2ValidationIssueDto {
  code: string;
  message: string;
}

export interface ArenaV2ValidationResultDto {
  valid: boolean;
  errors: ArenaV2ValidationIssueDto[];
  warnings: ArenaV2ValidationIssueDto[];
}
