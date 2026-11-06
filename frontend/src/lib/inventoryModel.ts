import { fuzzySearch } from './search';

export interface InventoryStreamer {
  channel_id?: string;
  name?: string;
  base_value?: number;
  is_active?: boolean;
}

export interface InventoryCard {
  id: number;
  channel_id: string;
  star?: number | null;
  acquired_at?: string | null;
  favorite_order?: number | null;
  is_hidden?: boolean;
  is_locked?: boolean;
  border?: unknown | null;
  name_effect?: unknown | null;
  streamer?: InventoryStreamer | null;
}

export type InventoryGroupKind = 'normal' | 'cosmetic';

export interface InventoryGroup<Card extends InventoryCard = InventoryCard> {
  key: string;
  kind: InventoryGroupKind;
  card: Card;
  cards: Card[];
  /** 검색/방송 필터와 무관한 실제 보유 수량입니다. */
  totalCount: number;
  count: number;
  star: number;
  originalIndex: number;
  lockedCount: number;
  hiddenCount: number;
  pendingMarketCount: number;
  reservedCount: number;
  availableCards: Card[];
  availableCount: number;
}

export type InventorySort =
  | 'name-asc'
  | 'name-desc'
  | 'acquired-desc'
  | 'acquired-asc'
  | 'value-desc'
  | 'value-asc'
  | 'star-desc'
  | 'star-asc'
  | 'count-desc';

export type InventoryLiveFilter = 'all' | 'live' | 'offline';

export interface InventoryModelOptions {
  pendingCardIds?: Iterable<number>;
  reservedByGroup?: Readonly<Record<string, number>>;
}

export interface FilterInventoryGroupsOptions {
  query?: string;
  liveFilter?: InventoryLiveFilter;
  sortBy?: InventorySort;
  isStreamerLive?: (streamer: InventoryStreamer) => boolean;
}

export interface InventoryModel<Card extends InventoryCard = InventoryCard> {
  groups: InventoryGroup<Card>[];
  groupsByKey: Map<string, InventoryGroup<Card>>;
  cardsById: Map<number, Card>;
  groupKeyByCardId: Map<number, string>;
  getGroup: (key: string) => InventoryGroup<Card> | null;
  getCardByKey: (key: string) => Card | null;
  getAvailableGroupCards: (key: string) => Card[];
  getAvailableCount: (channelId: string, star: number) => number;
  getCardsForKeys: (keys: Iterable<string>) => Card[];
  getBulkSellQuantities: (keys: Iterable<string>) => Record<string, number>;
}

interface ChannelStarAvailability {
  total: number;
  unavailableCardIds: Set<number>;
}

const COSMETIC_KEY_PREFIX = 'card:';

const normalizedStar = (star: number | null | undefined) => star ?? 0;

export const inventoryCardKey = (channelId: string, star: number) => `${channelId}#${star}`;

export const inventorySingleCardKey = (cardId: number) => `${COSMETIC_KEY_PREFIX}${cardId}`;

export const isInventorySingleCardKey = (key: string) => key.startsWith(COSMETIC_KEY_PREFIX);

export const parseInventoryCardKey = (key: string) => {
  const separator = key.lastIndexOf('#');
  return {
    channelId: separator < 0 ? key : key.slice(0, separator),
    star: separator < 0 ? 0 : Number(key.slice(separator + 1)) || 0
  };
};

export const hasEquippedInventoryCosmetic = (card?: InventoryCard | null) =>
  Boolean(card?.border || card?.name_effect);

export const getInventoryGroupKey = (card: InventoryCard) =>
  hasEquippedInventoryCosmetic(card)
    ? inventorySingleCardKey(card.id)
    : inventoryCardKey(card.channel_id, normalizedStar(card.star));

const safeReservationCount = (value: unknown) =>
  Math.max(0, Math.floor(Number(value) || 0));

const buildCardComparator = <Card extends InventoryCard>(sortBy: InventorySort) => (a: Card, b: Card) => {
  const favA = a.favorite_order ?? Number.POSITIVE_INFINITY;
  const favB = b.favorite_order ?? Number.POSITIVE_INFINITY;
  if (favA !== favB) return favA - favB;

  const nameA = a.streamer?.name || '';
  const nameB = b.streamer?.name || '';
  const valueA = a.streamer?.base_value || 0;
  const valueB = b.streamer?.base_value || 0;
  const starA = normalizedStar(a.star);
  const starB = normalizedStar(b.star);
  const timeA = new Date(a.acquired_at || 0).getTime();
  const timeB = new Date(b.acquired_at || 0).getTime();
  const idA = a.id || 0;
  const idB = b.id || 0;
  const byNameAsc = nameA.localeCompare(nameB, 'ko') || timeB - timeA || idB - idA;

  switch (sortBy) {
    case 'name-asc':
      return nameA.localeCompare(nameB);
    case 'name-desc':
      return nameB.localeCompare(nameA);
    case 'acquired-asc':
      return timeA - timeB || idA - idB;
    case 'value-desc':
      return valueB - valueA;
    case 'value-asc':
      return valueA - valueB;
    case 'star-desc':
      return starB - starA || byNameAsc;
    case 'star-asc':
      return starA - starB || byNameAsc;
    case 'count-desc':
      return 0;
    case 'acquired-desc':
    default:
      return timeB - timeA || idB - idA;
  }
};

const chooseRepresentative = <Card extends InventoryCard>(cards: Card[], sortBy: InventorySort) => {
  const compare = buildCardComparator<Card>(sortBy);
  let representative = cards[0];
  for (let index = 1; index < cards.length; index += 1) {
    if (compare(cards[index], representative) < 0) representative = cards[index];
  }
  return representative;
};

export function buildInventoryModel<Card extends InventoryCard>(
  cards: readonly Card[],
  options: InventoryModelOptions = {}
): InventoryModel<Card> {
  const pendingCardIds = new Set(options.pendingCardIds || []);
  const reservedByGroup = options.reservedByGroup || {};
  const groups: InventoryGroup<Card>[] = [];
  const groupsByKey = new Map<string, InventoryGroup<Card>>();
  const cardsById = new Map<number, Card>();
  const groupKeyByCardId = new Map<number, string>();
  const channelStarAvailability = new Map<string, ChannelStarAvailability>();

  for (const card of cards) {
    const star = normalizedStar(card.star);
    const channelStarKey = inventoryCardKey(card.channel_id, star);
    const key = getInventoryGroupKey(card);
    const kind: InventoryGroupKind = hasEquippedInventoryCosmetic(card) ? 'cosmetic' : 'normal';
    const pending = pendingCardIds.has(card.id);

    cardsById.set(card.id, card);
    groupKeyByCardId.set(card.id, key);

    let availability = channelStarAvailability.get(channelStarKey);
    if (!availability) {
      availability = { total: 0, unavailableCardIds: new Set<number>() };
      channelStarAvailability.set(channelStarKey, availability);
    }
    availability.total += 1;
    if (card.is_locked || pending) availability.unavailableCardIds.add(card.id);

    let group = groupsByKey.get(key);
    if (!group) {
      group = {
        key,
        kind,
        card,
        cards: [],
        totalCount: 0,
        count: 0,
        star,
        originalIndex: groups.length,
        lockedCount: 0,
        hiddenCount: 0,
        pendingMarketCount: 0,
        reservedCount: kind === 'normal' ? safeReservationCount(reservedByGroup[channelStarKey]) : 0,
        availableCards: [],
        availableCount: 0
      };
      groupsByKey.set(key, group);
      groups.push(group);
    }

    group.cards.push(card);
    group.totalCount += 1;
    group.count += 1;
    if (card.is_locked) group.lockedCount += 1;
    if (card.is_hidden) group.hiddenCount += 1;
    if (pending) group.pendingMarketCount += 1;
    if (!card.is_locked && !pending) group.availableCards.push(card);
  }

  for (const group of groups) {
    if (group.kind === 'normal' && group.reservedCount > 0) {
      group.availableCards = group.availableCards.slice(group.reservedCount);
    }
    group.availableCount = group.availableCards.length;
  }

  const getAvailableCount = (channelId: string, star: number) => {
    const key = inventoryCardKey(channelId, star);
    const availability = channelStarAvailability.get(key);
    if (!availability) return 0;
    const reserved = safeReservationCount(reservedByGroup[key]);
    return Math.max(0, availability.total - availability.unavailableCardIds.size - reserved);
  };

  const getGroup = (key: string) => groupsByKey.get(key) || null;
  const getCardByKey = (key: string) => getGroup(key)?.card || null;
  const getAvailableGroupCards = (key: string) => getGroup(key)?.availableCards || [];

  const getCardsForKeys = (keys: Iterable<string>) => {
    const selected = new Map<number, Card>();
    for (const key of keys) {
      const group = getGroup(key);
      if (!group) continue;
      for (const card of group.cards) selected.set(card.id, card);
    }
    return Array.from(selected.values());
  };

  const getBulkSellQuantities = (keys: Iterable<string>) => {
    const quantities: Record<string, number> = {};
    for (const key of keys) {
      const group = getGroup(key);
      if (group?.kind === 'normal' && group.availableCount > 0) {
        quantities[key] = group.availableCount;
      }
    }
    return quantities;
  };

  return {
    groups,
    groupsByKey,
    cardsById,
    groupKeyByCardId,
    getGroup,
    getCardByKey,
    getAvailableGroupCards,
    getAvailableCount,
    getCardsForKeys,
    getBulkSellQuantities
  };
}

export function filterAndSortInventoryGroups<Card extends InventoryCard>(
  groups: readonly InventoryGroup<Card>[],
  options: FilterInventoryGroupsOptions = {}
) {
  const query = options.query || '';
  const liveFilter = options.liveFilter || 'all';
  const sortBy = options.sortBy || 'acquired-desc';
  const isStreamerLive = options.isStreamerLive || ((streamer: InventoryStreamer) => streamer.is_active === true);
  const visible: InventoryGroup<Card>[] = [];

  for (const group of groups) {
    const matchingCards = group.cards.filter((card) => {
      const streamer = card.streamer;
      if (!streamer) return false;
      if (!fuzzySearch(streamer.name || '', query)) return false;
      if (liveFilter === 'all') return true;
      const live = isStreamerLive(streamer);
      return liveFilter === 'live' ? live : !live;
    });

    if (matchingCards.length === 0) continue;
    visible.push({
      ...group,
      card: chooseRepresentative(matchingCards, sortBy),
      count: matchingCards.length
    });
  }

  const compareCards = buildCardComparator<Card>(sortBy);
  return visible.sort((a, b) => {
    const favA = a.card.favorite_order ?? Number.POSITIVE_INFINITY;
    const favB = b.card.favorite_order ?? Number.POSITIVE_INFINITY;
    if (favA !== favB) return favA - favB;
    if (sortBy === 'count-desc' && a.count !== b.count) return b.count - a.count;
    return compareCards(a.card, b.card) || a.originalIndex - b.originalIndex;
  });
}

export const getSelectableKeys = <Card extends InventoryCard>(
  groups: readonly InventoryGroup<Card>[]
) => groups.map((group) => group.key);
