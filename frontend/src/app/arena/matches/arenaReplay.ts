export type ArenaReplayEvent = {
  seq: number;
  turnNo: number;
  eventType: string;
  payload: Record<string, unknown>;
};

const replayVisualEventTypes = new Set([
  'line_attack',
  'direct_attack',
  'card_attack',
  'shield_absorb',
  'overflow_damage',
  'counter',
  'silence',
  'stun',
  'push',
  'pull',
  'drain',
  'card_defeated',
  'revive',
  'vengeance',
  'residue',
  'spirit_damage'
]);

export const isReplayVisualEvent = (event: ArenaReplayEvent) => replayVisualEventTypes.has(event.eventType);

const normalizeReplayEvent = (value: unknown): ArenaReplayEvent | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ArenaReplayEvent>;
  const seq = Number(candidate.seq);
  const turnNo = Number(candidate.turnNo);
  if (!Number.isFinite(seq) || !Number.isFinite(turnNo) || typeof candidate.eventType !== 'string') return null;
  return {
    seq,
    turnNo,
    eventType: candidate.eventType,
    payload: candidate.payload && typeof candidate.payload === 'object' ? candidate.payload : {}
  };
};

export const selectLatestReplayScene = (values: unknown) => {
  const allEvents = (Array.isArray(values) ? values : [])
    .map(normalizeReplayEvent)
    .filter((event): event is ArenaReplayEvent => Boolean(event))
    .sort((left, right) => left.seq - right.seq);
  const allVisualEvents = allEvents.filter(isReplayVisualEvent);
  const latestVisualEvent = allVisualEvents[allVisualEvents.length - 1];
  const latestTurnEnd = [...allEvents].reverse().find((event) => event.eventType === 'turn_end');
  const sceneAnchor = !latestTurnEnd || (latestVisualEvent && latestVisualEvent.seq > latestTurnEnd.seq)
    ? latestVisualEvent
    : latestTurnEnd;
  const sceneTurnNo = sceneAnchor?.turnNo
    ?? allEvents.reduce((latest, event) => Math.max(latest, event.turnNo), -1);
  const events = sceneTurnNo >= 0 ? allEvents.filter((event) => event.turnNo === sceneTurnNo) : [];
  return {
    events,
    visualEvents: events.filter(isReplayVisualEvent)
  };
};
