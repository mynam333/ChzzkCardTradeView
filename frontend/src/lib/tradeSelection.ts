export const TRADE_SELECTION_PAGE_SIZE = 48;

export type TradeSelection = Record<string, number>;

export type TradeSelectionOption = {
  key: string;
  maxCount: number;
};

interface TradeInventoryCard {
  id: number;
  channel_id: string;
  star?: number | null;
  is_locked?: boolean;
  border?: unknown | null;
  name_effect?: unknown | null;
}

const normalizeCount = (value: unknown): number => {
  const parsed = Math.floor(Number(value));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
};

export const selectAllTradeResults = (
  current: TradeSelection,
  results: readonly TradeSelectionOption[]
): TradeSelection => {
  const next = { ...current };
  for (const result of results) {
    const maxCount = normalizeCount(result.maxCount);
    if (maxCount > 0) next[result.key] = maxCount;
    else delete next[result.key];
  }
  return next;
};

export const clearTradeResults = (
  current: TradeSelection,
  results: readonly Pick<TradeSelectionOption, 'key'>[]
): TradeSelection => {
  const next = { ...current };
  for (const result of results) delete next[result.key];
  return next;
};

export const clampTradeSelection = (
  current: TradeSelection,
  options: readonly TradeSelectionOption[]
): TradeSelection => {
  const maxByKey = new Map(options.map((option) => [option.key, normalizeCount(option.maxCount)]));
  const next: TradeSelection = {};
  for (const [key, rawCount] of Object.entries(current)) {
    const maxCount = maxByKey.get(key) || 0;
    const count = Math.min(normalizeCount(rawCount), maxCount);
    if (count > 0) next[key] = count;
  }
  return next;
};

export const summarizeTradeSelection = (
  selection: TradeSelection,
  results?: readonly TradeSelectionOption[]
) => {
  const maxByKey = results
    ? new Map(results.map((result) => [result.key, normalizeCount(result.maxCount)]))
    : null;
  let groupCount = 0;
  let cardCount = 0;
  for (const [key, rawCount] of Object.entries(selection)) {
    if (maxByKey && !maxByKey.has(key)) continue;
    const count = maxByKey
      ? Math.min(normalizeCount(rawCount), maxByKey.get(key) || 0)
      : normalizeCount(rawCount);
    if (count <= 0) continue;
    groupCount += 1;
    cardCount += count;
  }
  return { groupCount, cardCount };
};

export const getTradeResultCapacity = (results: readonly TradeSelectionOption[]) =>
  results.reduce((sum, result) => sum + normalizeCount(result.maxCount), 0);

export const selectionIncludesEquippedCosmetics = (
  selection: Readonly<TradeSelection>,
  cards: readonly TradeInventoryCard[],
  pendingCardIds: ReadonlySet<number>
) => {
  const remaining = new Map<string, number>();
  for (const [key, count] of Object.entries(selection)) {
    const normalized = normalizeCount(count);
    if (normalized > 0) remaining.set(key, normalized);
  }
  if (remaining.size === 0) return false;

  for (const card of cards) {
    const key = `${card.channel_id}#${card.star ?? 0}`;
    const count = remaining.get(key) || 0;
    if (count === 0 || card.is_locked || pendingCardIds.has(card.id)) continue;
    if (count === 1) remaining.delete(key);
    else remaining.set(key, count - 1);
    if (card.border || card.name_effect) return true;
    if (remaining.size === 0) return false;
  }
  return false;
};

export const paginateTradeResults = <T>(
  results: readonly T[],
  requestedPage: number,
  pageSize = TRADE_SELECTION_PAGE_SIZE
) => {
  const safePageSize = Math.max(1, Math.floor(pageSize) || TRADE_SELECTION_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(results.length / safePageSize));
  const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), totalPages);
  const start = (page - 1) * safePageSize;
  return {
    page,
    totalPages,
    items: results.slice(start, start + safePageSize)
  };
};
