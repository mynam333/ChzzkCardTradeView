export type InventoryAvailabilityState = 'loading' | 'ready' | 'error';

export type InventoryReservations = {
  cards: Record<string, number>;
  cardsByStar: Record<string, number>;
  points: number;
};

type CompactInventoryPayload = {
  version: 1;
  cards: unknown[];
  streamers: unknown[];
  cosmetics: unknown[];
};

const hasOwn = (value: object, key: PropertyKey) =>
  Object.prototype.hasOwnProperty.call(value, key);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const restoreTableReference = (
  card: Record<string, unknown>,
  refKey: string,
  targetKey: string,
  table: unknown[],
  unwrap: (entry: Record<string, unknown>) => unknown = (entry) => entry
) => {
  if (!hasOwn(card, refKey)) return false;
  const reference = card[refKey];
  delete card[refKey];
  delete card[targetKey];
  if (reference === -1) return true;
  if (reference === null) {
    card[targetKey] = null;
    return true;
  }
  if (!Number.isInteger(reference) || Number(reference) < 0 || Number(reference) >= table.length) {
    throw new TypeError(`Invalid compact inventory reference: ${refKey}`);
  }
  const entry = table[Number(reference)];
  if (!isRecord(entry)) throw new TypeError(`Invalid compact inventory table entry: ${refKey}`);
  const value = unwrap(entry);
  if (!isRecord(value)) throw new TypeError(`Invalid compact inventory table value: ${refKey}`);
  card[targetKey] = value;
  return true;
};

const restoreNaturalReference = (
  card: Record<string, unknown>,
  targetKey: string,
  idKey: string,
  table: ReadonlyMap<string, Record<string, unknown>>
) => {
  if (!hasOwn(card, idKey)) return;
  const id = card[idKey];
  if (id === null) {
    card[targetKey] = null;
    return;
  }
  const value = table.get(String(id));
  if (!value) throw new TypeError(`Missing compact inventory table entry: ${targetKey}`);
  card[targetKey] = value;
};

/** Expands the opt-in compact wire format while preserving the legacy array contract. */
export const expandInventoryCards = <T extends object>(payload: unknown): T[] => {
  if (Array.isArray(payload)) return payload as T[];
  if (!isRecord(payload) || payload.version !== 1) {
    throw new TypeError('Unsupported inventory response');
  }

  const compact = payload as CompactInventoryPayload;
  if (!Array.isArray(compact.cards) || !Array.isArray(compact.streamers) || !Array.isArray(compact.cosmetics)) {
    throw new TypeError('Invalid compact inventory tables');
  }

  const streamersByChannel = new Map<string, Record<string, unknown>>();
  for (const entry of compact.streamers) {
    if (!isRecord(entry)) throw new TypeError('Invalid compact streamer table entry');
    if (entry.channel_id === null || entry.channel_id === undefined) continue;
    const key = String(entry.channel_id);
    if (!streamersByChannel.has(key)) streamersByChannel.set(key, entry);
  }
  const bordersById = new Map<string, Record<string, unknown>>();
  const nameEffectsById = new Map<string, Record<string, unknown>>();
  for (const entry of compact.cosmetics) {
    if (!isRecord(entry) || (entry.kind !== 'border' && entry.kind !== 'name_effect') || !isRecord(entry.value)) {
      throw new TypeError('Invalid compact cosmetic table entry');
    }
    const id = entry.value.id;
    if (id === null || id === undefined) continue;
    const target = entry.kind === 'border' ? bordersById : nameEffectsById;
    const key = String(id);
    if (!target.has(key)) target.set(key, entry.value);
  }

  return compact.cards.map((rawCard) => {
    if (!isRecord(rawCard)) throw new TypeError('Invalid compact inventory card');
    const card = { ...rawCard };
    if (!restoreTableReference(card, 'streamer_ref', 'streamer', compact.streamers)) {
      restoreNaturalReference(card, 'streamer', 'channel_id', streamersByChannel);
    }
    if (!restoreTableReference(card, 'border_ref', 'border', compact.cosmetics, (entry) => entry.value)) {
      restoreNaturalReference(card, 'border', 'border_item_id', bordersById);
    }
    if (!restoreTableReference(card, 'name_effect_ref', 'name_effect', compact.cosmetics, (entry) => entry.value)) {
      restoreNaturalReference(card, 'name_effect', 'name_effect_item_id', nameEffectsById);
    }
    return card as T;
  });
};

type TradeOffer = {
  cards?: Array<{ channel_id?: string; star?: number | null; count?: number }>;
  point?: number;
};

type ActiveTrade = {
  sender_id?: string;
  receiver_id?: string;
  status?: string;
  sender_offer?: TradeOffer;
  receiver_offer?: TradeOffer;
};

export class InventoryLoadHttpError extends Error {
  status: number;

  constructor(status: number) {
    super(`Inventory request failed with status ${status}`);
    this.name = 'InventoryLoadHttpError';
    this.status = status;
  }
}

export const loadJsonWithDeadline = async <T>(
  request: (signal: AbortSignal) => Promise<Response>,
  options: { timeoutMs: number; parentSignal?: AbortSignal }
): Promise<T> => {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(options.parentSignal?.reason);
  if (options.parentSignal?.aborted) abortFromParent();
  else options.parentSignal?.addEventListener('abort', abortFromParent, { once: true });

  const timeout = globalThis.setTimeout(() => {
    controller.abort(new DOMException('Inventory request deadline exceeded', 'TimeoutError'));
  }, options.timeoutMs);

  try {
    controller.signal.throwIfAborted();
    const response = await request(controller.signal);
    controller.signal.throwIfAborted();
    const payload = await response.json() as T;
    controller.signal.throwIfAborted();
    if (!response.ok) throw new InventoryLoadHttpError(response.status);
    return payload;
  } finally {
    globalThis.clearTimeout(timeout);
    options.parentSignal?.removeEventListener('abort', abortFromParent);
  }
};

export const buildInventoryReservations = (
  trades: readonly ActiveTrade[],
  userId: string
): InventoryReservations => {
  const cards: Record<string, number> = {};
  const cardsByStar: Record<string, number> = {};
  let points = 0;

  const reserve = (offer?: TradeOffer) => {
    if (!offer) return;
    for (const card of offer.cards || []) {
      const channelId = String(card.channel_id || '').trim();
      const count = Math.max(0, Math.floor(Number(card.count) || 0));
      if (!channelId || count === 0) continue;
      const star = Math.max(0, Math.floor(Number(card.star) || 0));
      cards[channelId] = (cards[channelId] || 0) + count;
      const groupKey = `${channelId}#${star}`;
      cardsByStar[groupKey] = (cardsByStar[groupKey] || 0) + count;
    }
    points += Math.max(0, Math.floor(Number(offer.point) || 0));
  };

  for (const trade of trades) {
    if (trade.sender_id === userId) reserve(trade.sender_offer);
    if (trade.receiver_id === userId && trade.status === 'CONFIRMED') reserve(trade.receiver_offer);
  }

  return { cards, cardsByStar, points };
};
