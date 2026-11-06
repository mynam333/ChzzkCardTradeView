export const USER_CARDS_COMPACT_VERSION = 1 as const;
export const USER_CARDS_COMPACT_ABSENT_REF = -1 as const;

type CompactRefKey = 'streamer_ref' | 'border_ref' | 'name_effect_ref';
type CosmeticKind = 'border' | 'name_effect';

export type CompactCosmeticEntry = {
  kind: CosmeticKind;
  value: unknown;
};

export type UserCardsCompactResponse = {
  version: typeof USER_CARDS_COMPACT_VERSION;
  cards: Array<Record<string, unknown>>;
  streamers: unknown[];
  cosmetics: CompactCosmeticEntry[];
};

type NaturalEntry = {
  signature: string;
  index: number;
};

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const wireSignature = (value: unknown) => JSON.stringify([value]);

const assertNoReservedRefs = (card: Record<string, unknown>) => {
  for (const key of ['streamer_ref', 'border_ref', 'name_effect_ref'] as const) {
    if (hasOwn(card, key)) throw new Error(`USER_CARDS_COMPACT_RESERVED_FIELD:${key}`);
  }
};

const registerNaturalValue = (
  naturalKey: string,
  value: unknown,
  values: unknown[],
  entriesByNaturalKey: Map<string, Map<string, NaturalEntry>>
): { index: number; conflicted: boolean } => {
  const signature = wireSignature(value);
  let entries = entriesByNaturalKey.get(naturalKey);
  if (!entries) {
    entries = new Map();
    entriesByNaturalKey.set(naturalKey, entries);
  }
  const existing = entries.get(signature);
  if (existing) return { index: existing.index, conflicted: entries.size > 1 };

  const index = values.length;
  values.push(value);
  entries.set(signature, { signature, index });
  return { index, conflicted: entries.size > 1 };
};

const moveStreamer = (
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  streamers: unknown[],
  entriesByChannel: Map<string, Map<string, NaturalEntry>>
) => {
  const refKey: CompactRefKey = 'streamer_ref';
  if (!hasOwn(source, 'streamer') || source.streamer === undefined) {
    target[refKey] = USER_CARDS_COMPACT_ABSENT_REF;
    return;
  }
  if (source.streamer === null) {
    target[refKey] = null;
    return;
  }

  const naturalKey = String(source.channel_id ?? '');
  const streamerChannelId = typeof source.streamer === 'object' && source.streamer
    ? String((source.streamer as Record<string, unknown>).channel_id ?? '')
    : '';
  const registered = registerNaturalValue(naturalKey, source.streamer, streamers, entriesByChannel);
  // 정상 데이터는 기존 channel_id로 table lookup이 가능하므로 per-card ref가 없습니다.
  // 불일치 또는 같은 channel의 상충 snapshot만 index를 명시해 lossless하게 보존합니다.
  if (!naturalKey || streamerChannelId !== naturalKey || registered.conflicted) {
    target[refKey] = registered.index;
  }
};

const moveCosmetic = (
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  nestedKey: CosmeticKind,
  itemIdKey: 'border_item_id' | 'name_effect_item_id',
  refKey: Extract<CompactRefKey, 'border_ref' | 'name_effect_ref'>,
  cosmetics: CompactCosmeticEntry[],
  entriesByItem: Map<string, Map<string, NaturalEntry>>
) => {
  if (!hasOwn(source, nestedKey) || source[nestedKey] === undefined) {
    target[refKey] = USER_CARDS_COMPACT_ABSENT_REF;
    return;
  }
  const value = source[nestedKey];
  const cardItemId = source[itemIdKey];
  if (value === null) {
    // natural null 추론은 item_id가 실제 own-property null인 정상 row에서만 안전합니다.
    // item_id가 absent/undefined인 partial row도 legacy nested=null을 잃지 않도록 명시합니다.
    if (!hasOwn(source, itemIdKey) || cardItemId !== null) target[refKey] = null;
    return;
  }

  const naturalKey = `${nestedKey}:${String(cardItemId ?? '')}`;
  const valueId = typeof value === 'object' && value
    ? (value as Record<string, unknown>).id
    : undefined;
  const signature = wireSignature(value);
  let entries = entriesByItem.get(naturalKey);
  if (!entries) {
    entries = new Map();
    entriesByItem.set(naturalKey, entries);
  }
  let registered = entries.get(signature);
  if (!registered) {
    registered = { signature, index: cosmetics.length };
    cosmetics.push({ kind: nestedKey, value });
    entries.set(signature, registered);
  }
  if (
    cardItemId === null
    || cardItemId === undefined
    || String(valueId ?? '') !== String(cardItemId)
    || entries.size > 1
  ) {
    target[refKey] = registered.index;
  }
};

export const compactUserCards = (cards: readonly Record<string, unknown>[]): UserCardsCompactResponse => {
  const streamers: unknown[] = [];
  const cosmetics: CompactCosmeticEntry[] = [];
  const streamerEntries = new Map<string, Map<string, NaturalEntry>>();
  const cosmeticEntries = new Map<string, Map<string, NaturalEntry>>();

  const compactCards = cards.map((source) => {
    assertNoReservedRefs(source);
    const target = { ...source };
    delete target.streamer;
    delete target.border;
    delete target.name_effect;
    moveStreamer(source, target, streamers, streamerEntries);
    moveCosmetic(source, target, 'border', 'border_item_id', 'border_ref', cosmetics, cosmeticEntries);
    moveCosmetic(source, target, 'name_effect', 'name_effect_item_id', 'name_effect_ref', cosmetics, cosmeticEntries);
    return target;
  });

  return {
    version: USER_CARDS_COMPACT_VERSION,
    cards: compactCards,
    streamers,
    cosmetics
  };
};
