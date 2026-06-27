type ArenaPerformanceSample = {
  route: string;
  renderer: string;
  quality: string;
  init_ms: number;
  replay_ms: number;
  event_count: number;
  dropped_frames: number;
  created_at: string;
};

const MAX_RECENT_SAMPLES = Math.max(20, Math.min(500, Number(process.env.ARENA_PERF_RECENT_SAMPLE_LIMIT || 120)));
const MAX_ROUTE_LENGTH = 120;
const samples: ArenaPerformanceSample[] = [];
const aggregate = {
  total: 0,
  initMs: 0,
  replayMs: 0,
  eventCount: 0,
  droppedFrames: 0
};

const clampNumber = (value: unknown, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(min, Math.min(max, parsed));
};

export const recordArenaPerformanceSample = (input: Record<string, unknown>) => {
  const sample: ArenaPerformanceSample = {
    route: String(input.route || '').slice(0, MAX_ROUTE_LENGTH) || '/arena/matches',
    renderer: String(input.renderer || 'pixi').slice(0, 24),
    quality: String(input.quality || 'auto').slice(0, 24),
    init_ms: Math.round(clampNumber(input.init_ms, 0, 60_000)),
    replay_ms: Math.round(clampNumber(input.replay_ms, 0, 600_000)),
    event_count: Math.round(clampNumber(input.event_count, 0, 5_000)),
    dropped_frames: Math.round(clampNumber(input.dropped_frames, 0, 50_000)),
    created_at: new Date().toISOString()
  };

  samples.unshift(sample);
  if (samples.length > MAX_RECENT_SAMPLES) samples.length = MAX_RECENT_SAMPLES;
  aggregate.total += 1;
  aggregate.initMs += sample.init_ms;
  aggregate.replayMs += sample.replay_ms;
  aggregate.eventCount += sample.event_count;
  aggregate.droppedFrames += sample.dropped_frames;
  return sample;
};

export const getArenaPerformanceTelemetry = () => {
  const total = Math.max(1, aggregate.total);
  const byQuality = samples.reduce<Record<string, number>>((acc, sample) => {
    acc[sample.quality] = (acc[sample.quality] || 0) + 1;
    return acc;
  }, {});
  return {
    source: 'process_memory_sampled',
    persisted: false,
    sample_count: aggregate.total,
    recent_limit: MAX_RECENT_SAMPLES,
    averages: {
      init_ms: Math.round(aggregate.initMs / total),
      replay_ms: Math.round(aggregate.replayMs / total),
      event_count: Math.round(aggregate.eventCount / total),
      dropped_frames: Math.round(aggregate.droppedFrames / total)
    },
    by_quality: byQuality,
    recent: samples.slice(0, 20)
  };
};
