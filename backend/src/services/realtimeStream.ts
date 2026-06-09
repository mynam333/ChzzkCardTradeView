import { Response } from 'express';

export type RealtimeTopic = 'market' | 'ranking' | 'maintenance';

type RealtimeClient = {
  id: number;
  res: Response;
  topics: Set<RealtimeTopic>;
};

const clients = new Map<number, RealtimeClient>();
let nextClientId = 1;

const ALL_TOPICS: RealtimeTopic[] = ['market', 'ranking', 'maintenance'];

const writeEvent = (res: Response, event: string, data: unknown) => {
  res.write(`event: ${event}\n`);
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

export const subscribeRealtimeStream = (res: Response, rawTopics?: unknown) => {
  const id = nextClientId++;
  const topics = parseTopics(rawTopics);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();

  clients.set(id, { id, res, topics });
  writeEvent(res, 'connected', { ok: true, topics: Array.from(topics), ts: Date.now() });

  const heartbeat = setInterval(() => {
    if (!res.destroyed) writeEvent(res, 'heartbeat', { ts: Date.now() });
  }, 25_000);

  res.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(id);
  });
};

export const publishRealtimeEvent = (topic: RealtimeTopic, data: Record<string, unknown> = {}) => {
  const payload = {
    ...data,
    topic,
    ts: Date.now()
  };

  for (const [id, client] of clients) {
    if (client.res.destroyed) {
      clients.delete(id);
      continue;
    }
    if (client.topics.has(topic)) {
      writeEvent(client.res, topic, payload);
    }
  }
};
