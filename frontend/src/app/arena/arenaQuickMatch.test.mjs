import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createIdleArenaQuickMatchSnapshot,
  formatArenaQuickMatchElapsed,
  getArenaQuickMatchPollDelayMs,
  getArenaQuickMatchProposalProgress,
  isCurrentArenaQuickMatchOperation,
  isCurrentArenaQuickMatchRequest,
  mergeArenaQuickMatchSnapshot,
  normalizeArenaQuickMatchResponse
} from './arenaQuickMatch.ts';

test('legacy queue payloads normalize joined time and expanding MMR range', () => {
  const snapshot = normalizeArenaQuickMatchResponse({
    status: 'waiting',
    ticket: {
      id: 'queue-1',
      joinedAt: '2026-07-26T00:00:00.000Z',
      searchMinMmr: 1180,
      searchMaxMmr: 1420
    }
  });

  assert.equal(snapshot.phase, 'searching');
  assert.equal(snapshot.queueId, 'queue-1');
  assert.equal(snapshot.searchStartedAtMs, Date.parse('2026-07-26T00:00:00.000Z'));
  assert.equal(snapshot.minMmr, 1180);
  assert.equal(snapshot.maxMmr, 1420);
});

test('snake-case pending proposals normalize IDs, deadline, range, and server clock offset', () => {
  const receivedAtMs = Date.parse('2026-07-26T00:00:00.000Z');
  const snapshot = normalizeArenaQuickMatchResponse({
    status: 'pending_acceptance',
    pending: {
      id: 'proposal-7',
      accept_deadline_at: '2026-07-26T00:00:25.000Z'
    },
    search_started_at: '2026-07-25T23:59:45.000Z',
    current_mmr_range: { min: 1210, max: 1490 },
    server_now: '2026-07-26T00:00:15.000Z',
    opponent: { displayName: 'should-not-leak', mmr: 9000, deck: ['hidden'] }
  }, receivedAtMs);

  assert.equal(snapshot.phase, 'proposal');
  assert.equal(snapshot.proposalId, 'proposal-7');
  assert.equal(snapshot.acceptDeadlineAtMs, Date.parse('2026-07-26T00:00:25.000Z'));
  assert.equal(snapshot.serverClockOffsetMs, 15_000);
  assert.equal(snapshot.minMmr, 1210);
  assert.equal(snapshot.maxMmr, 1490);
  assert.equal(Object.hasOwn(snapshot, 'opponent'), false);
});

test('minimal acceptance responses retain the active proposal deadline and search metadata', () => {
  const previous = {
    ...createIdleArenaQuickMatchSnapshot(),
    phase: 'proposal',
    rawStatus: 'pending_acceptance',
    queueId: 'queue-2',
    proposalId: 'proposal-2',
    searchStartedAtMs: 1_000,
    acceptDeadlineAtMs: 11_000,
    serverClockOffsetMs: 500,
    minMmr: 1000,
    maxMmr: 1300
  };
  const accepted = normalizeArenaQuickMatchResponse({ acceptance: { accepted: true } }, 4_000);
  const merged = mergeArenaQuickMatchSnapshot(previous, accepted, 4_500);

  assert.equal(merged.phase, 'accepted');
  assert.equal(merged.queueId, 'queue-2');
  assert.equal(merged.proposalId, 'proposal-2');
  assert.equal(merged.acceptDeadlineAtMs, 11_000);
  assert.equal(merged.searchStartedAtMs, 1_000);
  assert.equal(merged.serverClockOffsetMs, 500);
  assert.equal(merged.minMmr, 1000);
  assert.equal(merged.maxMmr, 1300);
});

test('new or unidentified proposals without a deadline fail closed instead of reusing stale confirmation data', () => {
  const previous = {
    ...createIdleArenaQuickMatchSnapshot(),
    phase: 'proposal',
    rawStatus: 'pending_acceptance',
    proposalId: 'proposal-old',
    acceptDeadlineAtMs: 20_000
  };

  const newProposal = mergeArenaQuickMatchSnapshot(
    previous,
    normalizeArenaQuickMatchResponse({ status: 'proposal', proposalId: 'proposal-new' }, 5_000),
    5_000
  );
  const unidentifiedProposal = mergeArenaQuickMatchSnapshot(
    previous,
    normalizeArenaQuickMatchResponse({ status: 'proposal' }, 5_000),
    5_000
  );

  assert.equal(newProposal.proposalId, 'proposal-new');
  assert.equal(newProposal.acceptDeadlineAtMs, null);
  assert.equal(unidentifiedProposal.proposalId, null);
  assert.equal(unidentifiedProposal.acceptDeadlineAtMs, null);
});

test('opponent timeout transitions back to searching while preserving the original queue clock', () => {
  const previous = {
    ...createIdleArenaQuickMatchSnapshot(),
    phase: 'accepted',
    rawStatus: 'accepted',
    searchStartedAtMs: 3_000,
    minMmr: 1100,
    maxMmr: 1500
  };
  const timeout = normalizeArenaQuickMatchResponse({
    status: 'waiting',
    transitionReason: 'opponent_timeout'
  }, 8_000);
  const merged = mergeArenaQuickMatchSnapshot(previous, timeout, 8_000);

  assert.equal(merged.phase, 'searching');
  assert.equal(merged.transitionReason, 'opponent_timeout');
  assert.equal(merged.searchStartedAtMs, 3_000);
  assert.equal(merged.minMmr, 1100);
  assert.equal(merged.maxMmr, 1500);
});

test('an unanswered proposal becomes a terminal error instead of an indefinite pending state', () => {
  const snapshot = normalizeArenaQuickMatchResponse({
    status: 'accept_timeout',
    proposalId: 'proposal-expired',
    transitionReason: 'proposal_expired'
  });

  assert.equal(snapshot.phase, 'error');
  assert.equal(snapshot.transitionReason, 'proposal_expired');
});

test('legacy matched payloads normalize their match destination', () => {
  const snapshot = normalizeArenaQuickMatchResponse({
    status: 'matched',
    ticket: { matchedMatchId: 'match-9' }
  });

  assert.equal(snapshot.phase, 'matched');
  assert.equal(snapshot.matchId, 'match-9');
});

test('elapsed and ten-second proposal clocks stay deterministic at their boundaries', () => {
  assert.equal(formatArenaQuickMatchElapsed(1_000, 66_999), '01:05');
  assert.deepEqual(getArenaQuickMatchProposalProgress(null, 5_000), {
    remainingMs: 0,
    remainingSeconds: 0,
    progress: 0
  });
  assert.deepEqual(getArenaQuickMatchProposalProgress(15_000, 5_000), {
    remainingMs: 10_000,
    remainingSeconds: 10,
    progress: 1
  });
  assert.deepEqual(getArenaQuickMatchProposalProgress(15_000, 10_001), {
    remainingMs: 4_999,
    remainingSeconds: 5,
    progress: 0.4999
  });
  assert.deepEqual(getArenaQuickMatchProposalProgress(15_000, 16_000), {
    remainingMs: 0,
    remainingSeconds: 0,
    progress: 0
  });
});

test('only the newest request ID may update polling state', () => {
  assert.equal(isCurrentArenaQuickMatchRequest(4, 4), true);
  assert.equal(isCurrentArenaQuickMatchRequest(3, 4), false);
  assert.equal(isCurrentArenaQuickMatchOperation(4, 4, 7, 7), true);
  assert.equal(isCurrentArenaQuickMatchOperation(4, 4, 6, 7), false);
  assert.equal(isCurrentArenaQuickMatchOperation(3, 4, 7, 7), false);
});

test('polling remains active in hidden tabs and keeps visible search latency below one second', () => {
  assert.equal(getArenaQuickMatchPollDelayMs('searching', 'visible'), 900);
  assert.equal(getArenaQuickMatchPollDelayMs('proposal', 'visible'), 750);
  assert.equal(getArenaQuickMatchPollDelayMs('searching', 'hidden'), 1_150);
  assert.equal(getArenaQuickMatchPollDelayMs('proposal', 'hidden'), 1_150);
  assert.equal(getArenaQuickMatchPollDelayMs('searching', 'visible', 2), 3_600);
  assert.equal(getArenaQuickMatchPollDelayMs('searching', 'hidden', 4), 9_200);
});

test('cancelled terminal payloads override stale proposal fields and clear them during merge', () => {
  const previous = {
    ...createIdleArenaQuickMatchSnapshot(),
    phase: 'proposal',
    rawStatus: 'proposed',
    proposalId: 'proposal-stale',
    acceptDeadlineAtMs: 20_000
  };
  const cancelled = normalizeArenaQuickMatchResponse({
    status: 'cancelled',
    proposalId: 'proposal-stale',
    acceptDeadlineAt: 20_000
  });
  const merged = mergeArenaQuickMatchSnapshot(previous, cancelled, 10_000);

  assert.equal(cancelled.phase, 'error');
  assert.equal(cancelled.proposalId, null);
  assert.equal(cancelled.acceptDeadlineAtMs, null);
  assert.match(cancelled.message, /탐색이 취소/);
  assert.equal(merged.phase, 'error');
  assert.equal(merged.proposalId, null);
  assert.equal(merged.acceptDeadlineAtMs, null);
});

test('invalid deck terminal aliases never reopen a stale confirmation proposal', () => {
  const payloads = [
    { status: 'invalid_deck', proposalId: 'proposal-stale', acceptDeadlineAt: 20_000 },
    { status: 'cancelled', transitionReason: 'invalid_deck', proposalId: 'proposal-stale' },
    { status: 'error', error: 'ArenaV2DeckInvalid', proposalId: 'proposal-stale' }
  ];

  for (const payload of payloads) {
    const snapshot = normalizeArenaQuickMatchResponse(payload);
    assert.equal(snapshot.phase, 'error');
    assert.equal(snapshot.proposalId, null);
    assert.equal(snapshot.acceptDeadlineAtMs, null);
    assert.match(snapshot.message, /덱.*대전 규칙/);
  }
});

test('active conflict aliases become explicit errors while preserving backend guidance', () => {
  const conflict = normalizeArenaQuickMatchResponse({
    state: 'active-conflict',
    proposalId: 'proposal-stale',
    message: '이미 진행 중인 대전을 먼저 확인해 주세요.'
  });
  const nestedCode = normalizeArenaQuickMatchResponse({
    status: 'error',
    error: { code: 'ArenaV2QuickActiveConflict' },
    proposalId: 'proposal-stale'
  });
  const backendCode = normalizeArenaQuickMatchResponse({
    error: 'ArenaV2AlreadyActive',
    proposalId: 'proposal-stale'
  });

  assert.equal(conflict.phase, 'error');
  assert.equal(conflict.proposalId, null);
  assert.equal(conflict.message, '이미 진행 중인 대전을 먼저 확인해 주세요.');
  assert.equal(nestedCode.phase, 'error');
  assert.equal(nestedCode.proposalId, null);
  assert.match(nestedCode.message, /이미 진행 중인 빠른대전/);
  assert.equal(backendCode.phase, 'error');
  assert.equal(backendCode.proposalId, null);
  assert.match(backendCode.message, /이미 진행 중인 빠른대전/);
});

test('an opponent invalid deck reason requeues instead of terminating or restoring stale proposal data', () => {
  const snapshot = normalizeArenaQuickMatchResponse({
    status: 'waiting',
    transitionReason: 'opponent_invalid_deck',
    proposalId: 'proposal-stale',
    acceptDeadlineAt: 20_000
  });

  assert.equal(snapshot.phase, 'searching');
  assert.equal(snapshot.transitionReason, 'opponent_invalid_deck');
  assert.equal(snapshot.proposalId, null);
  assert.equal(snapshot.acceptDeadlineAtMs, null);
});
