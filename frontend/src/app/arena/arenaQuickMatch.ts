export type ArenaQuickMatchPhase = 'idle' | 'joining' | 'searching' | 'proposal' | 'accepted' | 'matched' | 'error';

export type ArenaQuickMatchSnapshot = {
  phase: ArenaQuickMatchPhase;
  rawStatus: string;
  queueId: string | null;
  proposalId: string | null;
  matchId: string | null;
  searchStartedAtMs: number | null;
  acceptDeadlineAtMs: number | null;
  serverClockOffsetMs: number | null;
  minMmr: number | null;
  maxMmr: number | null;
  acceptedBySelf: boolean;
  opponentAccepted: boolean;
  transitionReason:
    | 'opponent_timeout'
    | 'opponent_cancelled'
    | 'opponent_invalid_deck'
    | 'proposal_expired'
    | 'cancelled_proposal'
    | 'invalid_deck'
    | null;
  message: string | null;
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null
);

const collectRecords = (value: unknown): UnknownRecord[] => {
  const root = asRecord(value);
  if (!root) return [];
  const records: UnknownRecord[] = [root];
  const seen = new Set<UnknownRecord>(records);
  for (const key of ['acceptance', 'proposal', 'pending', 'ticket', 'queue', 'matchmaking']) {
    const record = asRecord(root[key]);
    if (record && !seen.has(record)) {
      seen.add(record);
      records.push(record);
    }
  }
  for (const record of [...records]) {
    for (const key of ['acceptance', 'proposal', 'pending']) {
      const nested = asRecord(record[key]);
      if (nested && !seen.has(nested)) {
        seen.add(nested);
        records.push(nested);
      }
    }
  }
  return records;
};

const firstValue = (records: UnknownRecord[], names: string[]) => {
  for (const record of records) {
    for (const name of names) {
      const value = record[name];
      if (value !== undefined && value !== null && value !== '') return value;
    }
  }
  return undefined;
};

const readString = (records: UnknownRecord[], names: string[]) => {
  const value = firstValue(records, names);
  return value === undefined ? null : String(value).trim() || null;
};

const readNumber = (records: UnknownRecord[], names: string[]) => {
  const value = firstValue(records, names);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const readBoolean = (records: UnknownRecord[], names: string[]) => {
  const value = firstValue(records, names);
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return false;
};

const readTimestamp = (records: UnknownRecord[], names: string[]) => {
  const value = firstValue(records, names);
  if (value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  const numeric = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeStatus = (status: string | null) => String(status || 'none').trim().toLowerCase().replace(/[\s-]+/g, '_');

const searchingStatuses = new Set(['waiting', 'searching', 'queued', 'pending', 'requeued', 'retrying', 'expanding']);
const proposalStatuses = new Set(['proposal', 'proposed', 'match_found', 'found', 'pending_acceptance', 'acceptance_pending', 'confirming']);
const acceptedStatuses = new Set(['accepted', 'self_accepted', 'waiting_opponent', 'opponent_pending', 'acceptance_waiting']);
const matchedStatuses = new Set(['matched', 'ready', 'confirmed', 'completed']);
const retryStatuses = new Set([
  'opponent_timeout',
  'opponent_timed_out',
  'opponent_invalid_deck',
  'proposal_expired',
  'acceptance_expired',
  're_searching'
]);
const terminalStatuses = new Set(['accept_timeout', 'cancelled', 'canceled', 'declined', 'expired', 'error', 'failed']);

const compactStatus = (status: string) => status.replace(/_/g, '');

const isInvalidDeckStatus = (status: string) => {
  const compact = compactStatus(status);
  return compact.includes('invaliddeck') || compact.includes('deckinvalid');
};

const isOpponentInvalidDeckStatus = (status: string) => {
  const compact = compactStatus(status);
  return compact.includes('opponentinvaliddeck') || compact.includes('opponentdeckinvalid');
};

const isActiveConflictStatus = (status: string) => {
  const compact = compactStatus(status);
  return compact.includes('activeconflict')
    || compact.includes('conflictactive')
    || compact.includes('alreadyinqueue')
    || compact.includes('alreadyqueued')
    || compact.includes('alreadyactive')
    || compact.includes('quickactive');
};

const terminalMessage = (
  rawStatus: string,
  errorStatus: string,
  transitionStatus: string,
  backendMessage: string | null
) => {
  if (backendMessage) return backendMessage;
  const ownInvalidDeck = [rawStatus, errorStatus, transitionStatus]
    .some((status) => isInvalidDeckStatus(status) && !isOpponentInvalidDeckStatus(status));
  if (ownInvalidDeck) {
    return '사용 중인 덱이 현재 대전 규칙을 통과하지 못해 탐색이 종료되었습니다. 덱을 수정하거나 다른 유효한 덱을 선택해 주세요.';
  }
  if ([rawStatus, errorStatus].some(isActiveConflictStatus)) {
    return '이미 진행 중인 빠른대전 탐색 또는 대전이 있습니다. 기존 상태를 확인한 뒤 다시 시도해 주세요.';
  }
  if (rawStatus === 'accept_timeout') return '매칭 확인 시간이 지나 탐색이 종료되었습니다. 다시 탐색해 주세요.';
  if (rawStatus === 'expired') return '빠른대전 탐색 시간이 만료되었습니다. 다시 탐색해 주세요.';
  if (rawStatus === 'cancelled' || rawStatus === 'canceled') {
    return '빠른대전 탐색이 취소되었습니다. 다시 찾으려면 아래 버튼을 눌러 주세요.';
  }
  return '매칭 제안이 종료되었습니다. 다시 탐색해 주세요.';
};

const readRange = (records: UnknownRecord[]) => {
  const value = firstValue(records, ['currentMmrRange', 'current_mmr_range', 'estimatedRange', 'estimated_range', 'searchRange', 'search_range']);
  if (Array.isArray(value)) {
    const min = Number(value[0]);
    const max = Number(value[1]);
    return { minMmr: Number.isFinite(min) ? min : null, maxMmr: Number.isFinite(max) ? max : null };
  }
  const range = asRecord(value);
  const rangeRecords = range ? [range, ...records] : records;
  return {
    minMmr: readNumber(rangeRecords, ['minMmr', 'min_mmr', 'min', 'searchMinMmr', 'search_min_mmr']),
    maxMmr: readNumber(rangeRecords, ['maxMmr', 'max_mmr', 'max', 'searchMaxMmr', 'search_max_mmr'])
  };
};

export const createIdleArenaQuickMatchSnapshot = (): ArenaQuickMatchSnapshot => ({
  phase: 'idle',
  rawStatus: 'none',
  queueId: null,
  proposalId: null,
  matchId: null,
  searchStartedAtMs: null,
  acceptDeadlineAtMs: null,
  serverClockOffsetMs: null,
  minMmr: null,
  maxMmr: null,
  acceptedBySelf: false,
  opponentAccepted: false,
  transitionReason: null,
  message: null
});

export const normalizeArenaQuickMatchResponse = (value: unknown, receivedAtMs = Date.now()): ArenaQuickMatchSnapshot => {
  const records = collectRecords(value);
  if (!records.length) return createIdleArenaQuickMatchSnapshot();
  const rawStatus = normalizeStatus(readString(records, ['status', 'state', 'phase']));
  const errorRecord = asRecord(firstValue(records, ['error', 'failure']));
  const errorRecords = errorRecord ? [errorRecord, ...records] : records;
  const errorStatus = normalizeStatus(readString(errorRecords, ['errorCode', 'error_code', 'code', 'error', 'reason']));
  const queueId = readString(records, ['queueId', 'queue_id', 'ticketId', 'ticket_id', 'id']);
  const proposalRecord = asRecord(records[0]?.proposal) || asRecord(records[0]?.pending);
  const proposalId = readString(records, ['proposalId', 'proposal_id', 'matchProposalId', 'match_proposal_id'])
    || (proposalRecord ? readString([proposalRecord], ['id']) : null);
  const matchId = readString(records, ['matchId', 'match_id', 'matchedMatchId', 'matched_match_id']);
  const acceptedBySelf = readBoolean(records, ['acceptedBySelf', 'accepted_by_self', 'selfAccepted', 'self_accepted', 'viewerAccepted', 'viewer_accepted', 'accepted']);
  const opponentAccepted = readBoolean(records, ['opponentAccepted', 'opponent_accepted', 'otherAccepted', 'other_accepted']);
  const requiresAcceptance = readBoolean(records, ['requiresAcceptance', 'requires_acceptance', 'confirmationRequired', 'confirmation_required']);
  const { minMmr, maxMmr } = readRange(records);
  const isRetry = retryStatuses.has(rawStatus);
  const rawTransitionReason = normalizeStatus(readString(records, [
    'transitionReason',
    'transition_reason',
    'lastTransitionReason',
    'last_transition_reason'
  ]));
  const transitionStatus = rawTransitionReason === 'none' ? rawStatus : rawTransitionReason;
  const transitionReason: ArenaQuickMatchSnapshot['transitionReason'] = isOpponentInvalidDeckStatus(transitionStatus)
    ? 'opponent_invalid_deck'
    : transitionStatus === 'opponent_cancelled' || transitionStatus === 'opponent_canceled'
      ? 'opponent_cancelled'
      : transitionStatus.includes('opponent') && (transitionStatus.includes('timeout') || transitionStatus.includes('timed_out'))
        ? 'opponent_timeout'
        : transitionStatus === 'cancelled_proposal' || transitionStatus === 'canceled_proposal'
          ? 'cancelled_proposal'
          : isInvalidDeckStatus(transitionStatus)
            ? 'invalid_deck'
            : transitionStatus.includes('expired') || rawStatus === 'accept_timeout' ? 'proposal_expired' : null;
  const ownInvalidDeck = [rawStatus, errorStatus, rawTransitionReason]
    .some((status) => isInvalidDeckStatus(status) && !isOpponentInvalidDeckStatus(status));
  const activeConflict = [rawStatus, errorStatus].some(isActiveConflictStatus);
  const isTerminal = terminalStatuses.has(rawStatus)
    || terminalStatuses.has(errorStatus)
    || ownInvalidDeck
    || activeConflict;
  const hasProposal = Boolean(proposalId || requiresAcceptance || acceptedBySelf || proposalStatuses.has(rawStatus) || acceptedStatuses.has(rawStatus));
  const serverNowMs = readTimestamp(records, ['serverNow', 'server_now', 'serverTime', 'server_time']);
  let phase: ArenaQuickMatchPhase = 'idle';
  if (matchId && matchedStatuses.has(rawStatus)) phase = 'matched';
  else if (isTerminal) phase = 'error';
  else if (isRetry || searchingStatuses.has(rawStatus)) phase = 'searching';
  else if (hasProposal && (acceptedBySelf || acceptedStatuses.has(rawStatus))) phase = 'accepted';
  else if (hasProposal) phase = 'proposal';
  else if (matchId) phase = 'matched';

  const hasActiveProposal = phase === 'proposal' || phase === 'accepted';
  const backendMessage = readString(records, ['message', 'statusMessage', 'status_message']);
  return {
    phase,
    rawStatus,
    queueId,
    proposalId: hasActiveProposal ? proposalId : null,
    matchId,
    searchStartedAtMs: readTimestamp(records, ['searchStartedAt', 'search_started_at', 'joinedAt', 'joined_at', 'createdAt', 'created_at']),
    acceptDeadlineAtMs: hasActiveProposal
      ? readTimestamp(records, ['acceptDeadlineAt', 'accept_deadline_at', 'proposalExpiresAt', 'proposal_expires_at', 'deadlineAt', 'deadline_at'])
      : null,
    serverClockOffsetMs: serverNowMs === null ? null : serverNowMs - receivedAtMs,
    minMmr,
    maxMmr,
    acceptedBySelf,
    opponentAccepted,
    transitionReason,
    message: phase === 'error'
      ? terminalMessage(rawStatus, errorStatus, rawTransitionReason, backendMessage)
      : backendMessage
  };
};

export const mergeArenaQuickMatchSnapshot = (
  previous: ArenaQuickMatchSnapshot,
  incoming: ArenaQuickMatchSnapshot,
  nowMs: number
): ArenaQuickMatchSnapshot => {
  const hasAcceptancePhase = incoming.phase === 'proposal' || incoming.phase === 'accepted';
  const canReusePreviousProposal = incoming.phase === 'accepted'
    && (previous.phase === 'proposal' || previous.phase === 'accepted');
  const proposalId = hasAcceptancePhase
    ? incoming.proposalId ?? (canReusePreviousProposal ? previous.proposalId : null)
    : null;
  const sameProposal = Boolean(proposalId && proposalId === previous.proposalId);
  return {
    ...incoming,
    queueId: incoming.queueId ?? (incoming.phase === 'idle' ? null : previous.queueId),
    proposalId,
    searchStartedAtMs: incoming.searchStartedAtMs ?? previous.searchStartedAtMs ?? (incoming.phase === 'idle' ? null : nowMs),
    acceptDeadlineAtMs: hasAcceptancePhase
      ? incoming.acceptDeadlineAtMs ?? (sameProposal ? previous.acceptDeadlineAtMs : null)
      : null,
    serverClockOffsetMs: incoming.serverClockOffsetMs ?? previous.serverClockOffsetMs,
    minMmr: incoming.minMmr ?? previous.minMmr,
    maxMmr: incoming.maxMmr ?? previous.maxMmr
  };
};

export const formatArenaQuickMatchElapsed = (startedAtMs: number | null, nowMs: number) => {
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - (startedAtMs ?? nowMs)) / 1000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export const getArenaQuickMatchProposalProgress = (deadlineAtMs: number | null, nowMs: number) => {
  if (!deadlineAtMs) return { remainingMs: 0, remainingSeconds: 0, progress: 0 };
  const remainingMs = Math.max(0, deadlineAtMs - nowMs);
  return {
    remainingMs,
    remainingSeconds: Math.ceil(remainingMs / 1000),
    progress: Math.max(0, Math.min(1, remainingMs / 10_000))
  };
};

export const isCurrentArenaQuickMatchRequest = (requestId: number, latestRequestId: number) => requestId === latestRequestId;

export const isCurrentArenaQuickMatchOperation = (
  requestId: number,
  latestRequestId: number,
  requestEpoch: number,
  currentEpoch: number
) => requestId === latestRequestId && requestEpoch === currentEpoch;

export const getArenaQuickMatchPollDelayMs = (
  phase: ArenaQuickMatchPhase,
  visibilityState: string,
  failures = 0
) => {
  const baseDelay = visibilityState === 'hidden'
    ? 1_150
    : phase === 'searching' ? 900 : 750;
  return Math.min(9_200, baseDelay * 2 ** Math.min(Math.max(0, failures), 3));
};
