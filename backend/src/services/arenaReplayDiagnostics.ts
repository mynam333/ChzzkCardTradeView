import type { ArenaReplayPayloadDto } from '@chikapo/arena-contract';

type ReplayRound = ArenaReplayPayloadDto['rounds'][number];
type ReplayEvent = ReplayRound['events'][number];

export type ArenaReplayDiagnosticIssue = {
  severity: 'info' | 'warning' | 'error';
  round_no: number;
  event_index: number;
  code: string;
  message: string;
};

export type ArenaReplayDiagnosticReport = {
  schema: 'arena-replay-diagnostic-v1';
  replay_schema_version: 2;
  match_id: string;
  generated_at: string;
  round_count: number;
  event_count: number;
  issue_count: number;
  warning_count: number;
  error_count: number;
  storage_policy: {
    mode: 'event_log_with_snapshots';
    required_round_fields: string[];
    required_event_fields: string[];
    hp_event_fields: string[];
    death_event_fields: string[];
  };
  issues: ArenaReplayDiagnosticIssue[];
  rounds: Array<{
    round_no: number;
    event_count: number;
    issue_count: number;
    warning_count: number;
    error_count: number;
    truncated: boolean;
    omitted_event_count: number;
  }>;
};

const allowedEventTypes = new Set([
  'ROUND_START',
  'BASIC_ATTACK',
  'SKILL_CAST',
  'DAMAGE',
  'HEAL',
  'SHIELD_GAIN',
  'DEATH',
  'ROUND_RESULT'
]);

const resultEventTypes = new Set(['DAMAGE', 'HEAL', 'SHIELD_GAIN']);
const actionEventTypes = new Set(['BASIC_ATTACK', 'SKILL_CAST']);
const normalizeToken = (value?: string | null) => String(value || '').trim().toLowerCase();

const pushIssue = (
  issues: ArenaReplayDiagnosticIssue[],
  severity: ArenaReplayDiagnosticIssue['severity'],
  round_no: number,
  event_index: number,
  code: string,
  message: string
) => {
  issues.push({ severity, round_no, event_index, code, message });
};

export const validateArenaReplayPayload = (payload: Partial<ArenaReplayPayloadDto> | null | undefined): ArenaReplayDiagnosticReport => {
  const issues: ArenaReplayDiagnosticIssue[] = [];
  const rounds = Array.isArray(payload?.rounds) ? payload.rounds : [];
  if (!payload?.match_id) {
    pushIssue(issues, 'warning', 0, -1, 'MISSING_MATCH_ID', '리플레이에 match_id가 없습니다.');
  }
  if (!Array.isArray(payload?.rounds)) {
    pushIssue(issues, 'error', 0, -1, 'MISSING_ROUNDS', '리플레이 rounds 배열이 없습니다.');
  }

  let eventCount = 0;
  const roundReports = rounds.map((round: ReplayRound) => {
    const roundIssues: ArenaReplayDiagnosticIssue[] = [];
    const roundNo = Number(round.round_no || 0);
    const events = Array.isArray(round.events) ? round.events : [];
    const unitStates = Array.isArray(round.unit_states) ? round.unit_states : [];
    const knownTokens = new Set<string>();
    const deadTokens = new Set<string>();
    let previousT = -Infinity;
    eventCount += events.length;

    if (!roundNo) pushIssue(roundIssues, 'error', roundNo, -1, 'MISSING_ROUND_NO', '라운드 번호가 없습니다.');
    if (!Number.isFinite(Number(round.duration_ms))) pushIssue(roundIssues, 'warning', roundNo, -1, 'MISSING_DURATION', '라운드 duration_ms가 없습니다.');
    if (!['player', 'bot', 'draw'].includes(String(round.winner_side || ''))) pushIssue(roundIssues, 'error', roundNo, -1, 'INVALID_WINNER', 'winner_side가 player, bot, draw 중 하나가 아닙니다.');
    if (!Array.isArray(round.events)) pushIssue(roundIssues, 'error', roundNo, -1, 'MISSING_EVENTS', '라운드 events 배열이 없습니다.');

    unitStates.forEach((state) => {
      [state.id, state.card_id, state.channel_id].filter(Boolean).forEach((token) => knownTokens.add(normalizeToken(token)));
      if (!Number.isFinite(Number(state.max_hp)) || Number(state.max_hp) <= 0) pushIssue(roundIssues, 'warning', roundNo, -1, 'INVALID_UNIT_MAX_HP', '유닛 max_hp가 올바르지 않습니다.');
      if (!Number.isFinite(Number(state.final_hp))) pushIssue(roundIssues, 'warning', roundNo, -1, 'INVALID_UNIT_FINAL_HP', '유닛 final_hp가 올바르지 않습니다.');
    });

    events.forEach((event: ReplayEvent, eventIndex: number) => {
      const type = String(event.type || '').toUpperCase();
      const t = Number(event.t);
      if (!Number.isFinite(t)) pushIssue(roundIssues, 'error', roundNo, eventIndex, 'MISSING_EVENT_TIME', '전투 이벤트 t가 없습니다.');
      if (Number.isFinite(t) && t < previousT) pushIssue(roundIssues, 'error', roundNo, eventIndex, 'NON_MONOTONIC_TIME', '전투 이벤트 시간이 이전 이벤트보다 작습니다.');
      if (Number.isFinite(t)) previousT = Math.max(previousT, t);
      if (!allowedEventTypes.has(type)) pushIssue(roundIssues, 'error', roundNo, eventIndex, 'UNKNOWN_EVENT_TYPE', `알 수 없는 이벤트 타입입니다: ${type || '-'}`);

      const actor = normalizeToken(event.actor);
      const targets = Array.isArray(event.targets) ? event.targets.map(normalizeToken).filter(Boolean) : [];
      if (actionEventTypes.has(type) && !actor) pushIssue(roundIssues, 'error', roundNo, eventIndex, 'ACTION_WITHOUT_ACTOR', '행동 이벤트에 actor가 없습니다.');
      if (['BASIC_ATTACK', 'DAMAGE', 'HEAL', 'SHIELD_GAIN'].includes(type) && targets.length === 0) pushIssue(roundIssues, 'error', roundNo, eventIndex, 'TARGET_EVENT_WITHOUT_TARGET', '대상 이벤트에 targets가 없습니다.');
      if (actor && deadTokens.has(actor) && type !== 'DEATH') pushIssue(roundIssues, 'error', roundNo, eventIndex, 'DEAD_ACTOR_ACTED', '전투불능 처리된 카드가 이후 행동자로 등장합니다.');
      if (knownTokens.size > 0 && actor && !knownTokens.has(actor)) pushIssue(roundIssues, 'warning', roundNo, eventIndex, 'UNKNOWN_ACTOR', 'actor가 unit_states와 직접 매칭되지 않습니다.');
      targets.forEach((target) => {
        if (knownTokens.size > 0 && !knownTokens.has(target)) pushIssue(roundIssues, 'warning', roundNo, eventIndex, 'UNKNOWN_TARGET', 'target이 unit_states와 직접 매칭되지 않습니다.');
      });

      if (resultEventTypes.has(type)) {
        const value = Number(event.value);
        if (!Number.isFinite(value) || value < 0) pushIssue(roundIssues, 'error', roundNo, eventIndex, 'INVALID_RESULT_VALUE', '피해/회복/보호 이벤트 value가 올바르지 않습니다.');
        if (!Number.isFinite(Number(event.hp_after)) && type !== 'SHIELD_GAIN') pushIssue(roundIssues, 'warning', roundNo, eventIndex, 'MISSING_HP_AFTER', '피해/회복 이벤트에 hp_after가 없습니다.');
        if (Number.isFinite(Number(event.hp_after)) && Number(event.hp_after) < 0) pushIssue(roundIssues, 'error', roundNo, eventIndex, 'NEGATIVE_HP_AFTER', 'hp_after가 0보다 작습니다.');
      }

      if (type === 'SKILL_CAST' && !event.skill_id) pushIssue(roundIssues, 'warning', roundNo, eventIndex, 'SKILL_WITHOUT_ID', '스킬 이벤트에 skill_id가 없습니다.');
      if (type === 'DEATH') {
        const deathTokens = [actor, ...targets].filter(Boolean);
        if (deathTokens.length === 0) pushIssue(roundIssues, 'error', roundNo, eventIndex, 'DEATH_WITHOUT_TOKEN', '전투불능 이벤트에 actor 또는 target이 없습니다.');
        deathTokens.forEach((token) => deadTokens.add(token));
        if (event.alive_after !== false) pushIssue(roundIssues, 'warning', roundNo, eventIndex, 'DEATH_WITHOUT_ALIVE_FALSE', 'DEATH 이벤트의 alive_after가 false가 아닙니다.');
      }
    });

    issues.push(...roundIssues);
    const warningCount = roundIssues.filter((issue) => issue.severity === 'warning').length;
    const errorCount = roundIssues.filter((issue) => issue.severity === 'error').length;
    return {
      round_no: roundNo,
      event_count: events.length,
      issue_count: roundIssues.length,
      warning_count: warningCount,
      error_count: errorCount,
      truncated: Boolean(round.replay_truncated),
      omitted_event_count: Number(round.timeline_summary?.omitted_event_count || 0)
    };
  });

  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  return {
    schema: 'arena-replay-diagnostic-v1',
    replay_schema_version: 2,
    match_id: String(payload?.match_id || ''),
    generated_at: new Date().toISOString(),
    round_count: rounds.length,
    event_count: eventCount,
    issue_count: issues.length,
    warning_count: warningCount,
    error_count: errorCount,
    storage_policy: {
      mode: 'event_log_with_snapshots',
      required_round_fields: ['round_no', 'duration_ms', 'winner_side', 'unit_states', 'events'],
      required_event_fields: ['t', 'type'],
      hp_event_fields: ['targets', 'value', 'hp_after'],
      death_event_fields: ['actor_or_targets', 'alive_after=false']
    },
    issues,
    rounds: roundReports
  };
};
