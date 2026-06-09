import { Response } from 'express';

export type RealtimeTopic = 'market' | 'ranking' | 'maintenance';

type RealtimeClient = {
  id: number;
  res: Response;
  topics: Set<RealtimeTopic>;
};

type StoredRealtimeEvent = {
  id: number;
  topic: RealtimeTopic;
  data: Record<string, unknown>;
};

const clients = new Map<number, RealtimeClient>();
let nextClientId = 1;
let nextEventId = 1;
const recentEvents: StoredRealtimeEvent[] = [];
const MAX_RECENT_EVENTS = 200;

const ALL_TOPICS: RealtimeTopic[] = ['market', 'ranking', 'maintenance'];

const writeEvent = (res: Response, event: string, data: unknown, id?: number) => {
  if (id !== undefined) res.write(`id: ${id}\n`);
  res.write(`event: ${event}\n`);
  res.write('retry: 3000\n');
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

const parseTopics = (raw: unknown): Set<RealtimeTopic> => {
  if (typeof raw !== 'string' || !raw.trim()) return new Set(ALL_TOPICS);
  const requested = raw
    .split(',')
    .map((topic) => topic.trim())
    .filter((topic): topic is RealtimeTopic => ALL_TOPICS.includes(topic as RealtimeTopic));
  return new Set(requested.length ? requested : ALL_TOPICS);
};

export const subscribeRealtimeStream = (res: Response, rawTopics?: unknown, lastEventId?: unknown) => {
  const id = nextClientId++;
  const topics = parseTopics(rawTopics);
  const replayAfter = typeof lastEventId === 'string' ? Number(lastEventId) : NaN;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();

  clients.set(id, { id, res, topics });
  writeEvent(res, 'connected', { ok: true, topics: Array.from(topics), ts: Date.now() });

  if (Number.isFinite(replayAfter)) {
    for (const event of recentEvents) {
      if (event.id > replayAfter && topics.has(event.topic) && !res.destroyed) {
        writeEvent(res, event.topic, event.data, event.id);
      }
    }
  }

  const heartbeat = setInterval(() => {
    if (!res.destroyed) writeEvent(res, 'heartbeat', { ts: Date.now() });
  }, 25_000);

  res.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(id);
  });
};

export const publishRealtimeEvent = (topic: RealtimeTopic, data: Record<string, unknown> = {}) => {
  const eventId = nextEventId++;
  const payload = {
    ...data,
    topic,
    ts: Date.now()
  };
  recentEvents.push({ id: eventId, topic, data: payload });
  if (recentEvents.length > MAX_RECENT_EVENTS) {
    recentEvents.splice(0, recentEvents.length - MAX_RECENT_EVENTS);
  }

  for (const [id, client] of clients) {
    if (client.res.destroyed) {
      clients.delete(id);
      continue;
    }
    if (client.topics.has(topic)) {
      writeEvent(client.res, topic, payload, eventId);
    }
  }
};
