import type { ArenaReplayPayloadDto } from '@chikapo/arena-contract';

type ArenaReplayEvent = ArenaReplayPayloadDto['rounds'][number]['events'][number];
type ArenaReplayUnitState = NonNullable<ArenaReplayPayloadDto['rounds'][number]['unit_states']>[number];

export type ArenaBattleTurn = {
  id: string;
  primary: ArenaReplayEvent;
  events: ArenaReplayEvent[];
  actor?: string;
  targetIds: string[];
  actionType: 'start' | 'attack' | 'skill' | 'heal' | 'guard' | 'control' | 'retire' | 'effect';
  skillName?: string;
  vfxKind?: string;
  damageType?: string;
  skillId?: string;
  skillType?: string;
  effectTags?: string[];
  value: number;
};

export type ArenaBattleTurnSummaryItem = {
  key: 'damage' | 'heal' | 'shield' | 'control' | 'retire' | 'effect';
  label: string;
  value: string;
};

export type ArenaBattleTimelineIssue = {
  severity: 'info' | 'warning' | 'error';
  roundNo: number;
  turnIndex: number;
  eventIndex: number;
  code: string;
  message: string;
};

export type ArenaBattleTimelineDiagnostic = {
  schema: 'arena-battle-timeline-diagnostic-v1';
  generatedAt: string;
  roundCount: number;
  turnCount: number;
  eventCount: number;
  issueCount: number;
  errorCount: number;
  warningCount: number;
  issues: ArenaBattleTimelineIssue[];
  rounds: Array<{
    roundNo: number;
    turnCount: number;
    eventCount: number;
    durationMs?: number;
    winner?: string;
    issues: ArenaBattleTimelineIssue[];
  }>;
};

const normalizeCombatToken = (value?: string | null) => String(value || '').trim().toLowerCase();

const formatSummaryNumber = (value: number) => value.toLocaleString('ko-KR');

const getEventTargets = (event: ArenaReplayEvent): string[] => {
  const targets = Array.isArray(event.targets) ? event.targets.filter(Boolean).map(String) : [];
  if (String(event.type || '').toUpperCase() === 'DEATH' && event.actor) return [...targets, String(event.actor)];
  return targets;
};

const mergeUniqueTargets = (events: ArenaReplayEvent[]) => {
  const seen = new Set<string>();
  const targets: string[] = [];
  events.forEach((event) => {
    getEventTargets(event).forEach((target) => {
      if (!seen.has(target)) {
        seen.add(target);
        targets.push(target);
      }
    });
  });
  return targets;
};

const getTurnActionType = (events: ArenaReplayEvent[]): ArenaBattleTurn['actionType'] => {
  const text = events.map((event) => `${event.type || ''} ${event.message || ''}`).join(' ').toLowerCase();
  if (text.includes('round_start')) return 'start';
  if (text.includes('skill_cast') || text.includes('skill') || text.includes('스킬')) return 'skill';
  if (text.includes('heal') || text.includes('회복')) return 'heal';
  if (text.includes('shield') || text.includes('guard') || text.includes('보호') || text.includes('방어')) return 'guard';
  if (text.includes('stun') || text.includes('slow') || text.includes('control') || text.includes('delay') || text.includes('기절') || text.includes('지연')) return 'control';
  if (text.includes('death') || text.includes('전투 불능')) return 'retire';
  if (text.includes('basic_attack') || text.includes('damage')) return 'attack';
  return 'effect';
};

const getTurnValue = (events: ArenaReplayEvent[]) => {
  const resultEvents = events.filter((event) => {
    const type = String(event.type || '').toUpperCase();
    return type === 'DAMAGE' || type === 'HEAL' || type === 'SHIELD_GAIN' || type === 'BUFF_GAIN';
  });
  const valueEvents = resultEvents.length > 0
    ? resultEvents
    : events.filter((event) => {
      const type = String(event.type || '').toUpperCase();
      return type !== 'ROUND_START' && type !== 'SKILL_CAST' && type !== 'BASIC_ATTACK';
    });
  return valueEvents.reduce((total, event) => total + Math.max(0, Number(event.value || 0)), 0);
};

export const buildArenaBattleTurns = (events: ArenaReplayEvent[]): ArenaBattleTurn[] => {
  const turns: ArenaBattleTurn[] = [];
  let current: ArenaReplayEvent[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const primary = current[0];
    const skillCast = current.find((event) => String(event.type || '').toUpperCase() === 'SKILL_CAST');
    const value = getTurnValue(current);
    const effectTags = Array.from(new Set(current.flatMap((event) => Array.isArray(event.effect_tags) ? event.effect_tags.map(String) : []))).slice(0, 8);
    const vfxEvent = current.find((event) => event.vfx_kind);
    const damageEvent = current.find((event) => event.damage_type);
    const skillEvent = current.find((event) => event.skill_id || event.skill_type);
    turns.push({
      id: `${primary.t}-${primary.type}-${turns.length}`,
      primary,
      events: current,
      actor: primary.actor,
      targetIds: mergeUniqueTargets(current),
      actionType: getTurnActionType(current),
      skillName: skillCast?.message,
      vfxKind: vfxEvent?.vfx_kind,
      damageType: damageEvent?.damage_type,
      skillId: skillEvent?.skill_id,
      skillType: skillEvent?.skill_type,
      effectTags,
      value
    });
    current = [];
  };

  events.forEach((event) => {
    const type = String(event.type || '').toUpperCase();
    const startsAction = type === 'ROUND_START' || type === 'BASIC_ATTACK' || type === 'SKILL_CAST';
    const currentPrimary = current[0];
    const currentTargets = new Set(mergeUniqueTargets(current).map(normalizeCombatToken));
    const eventTargets = getEventTargets(event).map(normalizeCombatToken);
    const canAttachToCurrent = current.length > 0
      && event.t === currentPrimary.t
      && (
        normalizeCombatToken(event.actor) === normalizeCombatToken(currentPrimary.actor)
        || eventTargets.some((target) => currentTargets.has(target))
        || (type === 'DEATH' && currentTargets.has(normalizeCombatToken(event.actor)))
      );

    if (current.length === 0 || startsAction || !canAttachToCurrent) {
      flush();
      current = [event];
      return;
    }
    current.push(event);
  });
  flush();
  return turns;
};

export const summarizeArenaBattleTurn = (turn?: ArenaBattleTurn): ArenaBattleTurnSummaryItem[] => {
  if (!turn) return [];
  const totals = turn.events.reduce((acc, event) => {
    const type = String(event.type || '').toUpperCase();
    const value = Math.max(0, Number(event.value || 0));
    const tagText = [
      event.vfx_kind,
      event.damage_type,
      ...(Array.isArray(event.effect_tags) ? event.effect_tags : []),
      event.message,
      type
    ].filter(Boolean).join(' ').toLowerCase();

    if (type === 'DAMAGE') acc.damage += value;
    if (type === 'HEAL') acc.heal += value;
    if (type === 'SHIELD_GAIN') acc.shield += value;
    if (type === 'DEATH') acc.retire += 1;
    if (
      type.includes('CONTROL')
      || tagText.includes('control')
      || tagText.includes('stun')
      || tagText.includes('slow')
      || tagText.includes('기절')
      || tagText.includes('지연')
      || tagText.includes('제어')
    ) {
      acc.control += 1;
    }
    if (
      tagText.includes('burn')
      || tagText.includes('poison')
      || tagText.includes('화상')
      || tagText.includes('중독')
      || tagText.includes('tempo')
      || tagText.includes('가속')
      || tagText.includes('템포')
    ) {
      acc.effect += 1;
    }
    return acc;
  }, { damage: 0, heal: 0, shield: 0, control: 0, retire: 0, effect: 0 });

  const items: ArenaBattleTurnSummaryItem[] = [];
  if (totals.damage > 0) items.push({ key: 'damage', label: '피해', value: `-${formatSummaryNumber(totals.damage)}` });
  if (totals.heal > 0) items.push({ key: 'heal', label: '회복', value: `+${formatSummaryNumber(totals.heal)}` });
  if (totals.shield > 0) items.push({ key: 'shield', label: '보호', value: `+${formatSummaryNumber(totals.shield)}` });
  if (totals.control > 0) items.push({ key: 'control', label: '제어', value: `${totals.control}회` });
  if (totals.retire > 0) items.push({ key: 'retire', label: '전투불능', value: `${totals.retire}장` });
  if (items.length === 0 && totals.effect > 0) items.push({ key: 'effect', label: '효과', value: `${totals.effect}개` });
  if (items.length === 0 && turn.value > 0) items.push({ key: 'effect', label: '효과', value: formatSummaryNumber(Math.max(0, Number(turn.value || 0))) });
  return items.slice(0, 5);
};

export const validateArenaBattleTimeline = (
  rounds: Array<Pick<ArenaReplayPayloadDto['rounds'][number], 'round_no' | 'events' | 'unit_states' | 'duration_ms' | 'winner_side'>>
): ArenaBattleTimelineDiagnostic => {
  const allIssues: ArenaBattleTimelineIssue[] = [];
  let totalTurns = 0;
  let totalEvents = 0;

  const pushIssue = (
    issues: ArenaBattleTimelineIssue[],
    severity: ArenaBattleTimelineIssue['severity'],
    roundNo: number,
    turnIndex: number,
    eventIndex: number,
    code: string,
    message: string
  ) => {
    const issue = { severity, roundNo, turnIndex, eventIndex, code, message };
    issues.push(issue);
    allIssues.push(issue);
  };

  const roundReports = (rounds || []).map((round) => {
    const roundNo = Number(round.round_no || 0);
    const events = round.events || [];
    const turns = buildArenaBattleTurns(events as ArenaReplayEvent[]);
    const issues: ArenaBattleTimelineIssue[] = [];
    totalTurns += turns.length;
    totalEvents += events.length;

    let previousT = -Infinity;
    const deadTokens = new Set<string>();
    const knownTokens = new Set<string>();
    (round.unit_states || []).forEach((state: ArenaReplayUnitState) => {
      [state.id, state.card_id, state.channel_id].filter(Boolean).forEach((token) => knownTokens.add(normalizeCombatToken(token)));
    });

    events.forEach((event, eventIndex) => {
      const t = Number(event.t || 0);
      if (t < previousT) {
        pushIssue(issues, 'error', roundNo, -1, eventIndex, 'NON_MONOTONIC_TIME', '전투 이벤트 시간이 이전 이벤트보다 작습니다.');
      }
      previousT = Math.max(previousT, t);

      const type = String(event.type || '').toUpperCase();
      const actorToken = normalizeCombatToken(event.actor);
      if (actorToken && deadTokens.has(actorToken) && type !== 'DEATH') {
        pushIssue(issues, 'error', roundNo, -1, eventIndex, 'DEAD_ACTOR_ACTED', '전투불능 처리된 카드가 이후 이벤트의 행동자로 등장합니다.');
      }
      if (actorToken && knownTokens.size > 0 && !knownTokens.has(actorToken)) {
        pushIssue(issues, 'warning', roundNo, -1, eventIndex, 'UNKNOWN_ACTOR_TOKEN', '행동자 토큰이 라운드 유닛 목록과 직접 매칭되지 않습니다.');
      }
      (event.targets || []).forEach((target) => {
        const targetToken = normalizeCombatToken(target);
        if (targetToken && knownTokens.size > 0 && !knownTokens.has(targetToken)) {
          pushIssue(issues, 'warning', roundNo, -1, eventIndex, 'UNKNOWN_TARGET_TOKEN', '대상 토큰이 라운드 유닛 목록과 직접 매칭되지 않습니다.');
        }
      });
      if (type === 'DEATH') {
        const tokens = [event.actor, ...(event.targets || [])].map(normalizeCombatToken).filter(Boolean);
        tokens.forEach((token) => deadTokens.add(token));
      }
      if (['DAMAGE', 'HEAL', 'SHIELD_GAIN'].includes(type)) {
        const hpAfter = Number(event.hp_after);
        if (Number.isFinite(hpAfter) && hpAfter < 0) {
          pushIssue(issues, 'error', roundNo, -1, eventIndex, 'NEGATIVE_HP', '이벤트의 hp_after가 0보다 작습니다.');
        }
      }
    });

    turns.forEach((turn, turnIndex) => {
      if (turn.actionType !== 'start' && !turn.actor) {
        pushIssue(issues, 'warning', roundNo, turnIndex, -1, 'MISSING_ACTOR', '전투 턴에 행동자가 없습니다.');
      }
      if (!['start', 'guard', 'heal'].includes(turn.actionType) && turn.targetIds.length === 0) {
        pushIssue(issues, 'warning', roundNo, turnIndex, -1, 'MISSING_TARGET', '공격/스킬 턴에 대상이 없습니다.');
      }
    });

    if (events.length > 0 && turns.length === 0) {
      pushIssue(issues, 'error', roundNo, -1, -1, 'NO_TURNS_BUILT', '이벤트가 있지만 전투 턴으로 변환되지 않았습니다.');
    }

    return {
      roundNo,
      turnCount: turns.length,
      eventCount: events.length,
      durationMs: round.duration_ms,
      winner: round.winner_side,
      issues
    };
  });

  const errorCount = allIssues.filter((issue) => issue.severity === 'error').length;
  const warningCount = allIssues.filter((issue) => issue.severity === 'warning').length;
  return {
    schema: 'arena-battle-timeline-diagnostic-v1',
    generatedAt: new Date().toISOString(),
    roundCount: rounds.length,
    turnCount: totalTurns,
    eventCount: totalEvents,
    issueCount: allIssues.length,
    errorCount,
    warningCount,
    issues: allIssues,
    rounds: roundReports
  };
};
