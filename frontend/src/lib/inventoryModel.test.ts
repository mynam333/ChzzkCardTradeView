import { describe, expect, it } from 'vitest';
import {
  buildInventoryModel,
  filterAndSortInventoryGroups,
  getSelectableKeys,
  inventoryCardKey,
  inventorySingleCardKey,
  parseInventoryCardKey,
  type InventoryCard
} from './inventoryModel';

const makeCard = (id: number, overrides: Partial<InventoryCard> = {}): InventoryCard => ({
  id,
  channel_id: 'channel-a',
  star: 0,
  acquired_at: new Date(1_700_000_000_000 + id * 1_000).toISOString(),
  streamer: {
    channel_id: 'channel-a',
    name: '가나다',
    base_value: 100,
    is_active: false
  },
  ...overrides
});

describe('inventory model indexing', () => {
  it('일반 카드는 채널+별로 묶고 코스메틱 장착 카드는 카드별 단독 그룹으로 유지한다', () => {
    const cards = [
      makeCard(1),
      makeCard(2),
      makeCard(3, { border: { id: 10 } }),
      makeCard(4, { name_effect: { id: 20 } }),
      makeCard(5, { star: 1 })
    ];

    const model = buildInventoryModel(cards);

    expect(model.groups.map(({ key, totalCount, count, kind }) => ({ key, totalCount, count, kind }))).toEqual([
      { key: 'channel-a#0', totalCount: 2, count: 2, kind: 'normal' },
      { key: 'card:3', totalCount: 1, count: 1, kind: 'cosmetic' },
      { key: 'card:4', totalCount: 1, count: 1, kind: 'cosmetic' },
      { key: 'channel-a#1', totalCount: 1, count: 1, kind: 'normal' }
    ]);
    expect(model.getCardByKey(inventorySingleCardKey(3))?.id).toBe(3);
    expect(model.groupKeyByCardId.get(2)).toBe(inventoryCardKey('channel-a', 0));
    expect(model.cardsById.get(5)?.star).toBe(1);
  });

  it('잠금과 마켓 대기가 겹친 카드는 한 번만 제외하고 일반 그룹 예약과 코스메틱 정책을 구분한다', () => {
    const cards = [
      makeCard(1),
      makeCard(2, { is_locked: true }),
      makeCard(3),
      makeCard(4, { is_locked: true }),
      makeCard(5, { border: { id: 1 } }),
      makeCard(6, { border: { id: 2 }, is_locked: true })
    ];
    const model = buildInventoryModel(cards, {
      pendingCardIds: [2, 3, 6],
      reservedByGroup: { 'channel-a#0': 1 }
    });
    const normal = model.getGroup('channel-a#0');

    expect(normal).toMatchObject({
      count: 4,
      lockedCount: 2,
      pendingMarketCount: 2,
      reservedCount: 1,
      availableCount: 0
    });
    expect(model.getAvailableGroupCards('channel-a#0')).toEqual([]);
    expect(model.getAvailableGroupCards('card:5').map((card) => card.id)).toEqual([5]);
    expect(model.getAvailableGroupCards('card:6')).toEqual([]);
    // 전체 6장 - (잠금 또는 대기 중인 고유 카드 4장) - 예약 1장
    expect(model.getAvailableCount('channel-a', 0)).toBe(1);
  });

  it('그룹 대표 카드가 판매 중이어도 다른 physical card를 추가 등록 대상으로 제공한다', () => {
    const cards = [
      makeCard(1),
      makeCard(2),
      makeCard(3, { is_locked: true }),
      makeCard(4)
    ];
    const model = buildInventoryModel(cards, {
      pendingCardIds: [1, 3],
      reservedByGroup: { 'channel-a#0': 1 }
    });
    const group = model.getGroup('channel-a#0');

    expect(group).toMatchObject({
      card: { id: 1 },
      totalCount: 4,
      count: 4,
      pendingMarketCount: 2,
      lockedCount: 1,
      reservedCount: 1,
      availableCount: 1
    });
    expect(model.getAvailableGroupCards('channel-a#0').map((card) => card.id)).toEqual([4]);
    expect(model.getAvailableCount('channel-a', 0)).toBe(1);
  });

  it('선택 키는 코스메틱을 보존하지만 일괄 판매 수량에서는 코스메틱과 가용 수량 0 그룹을 제외한다', () => {
    const cards = [
      makeCard(1),
      makeCard(2),
      makeCard(3, { channel_id: 'sold-out', is_locked: true }),
      makeCard(4, { border: { id: 10 } })
    ];
    const model = buildInventoryModel(cards);
    const keys = getSelectableKeys(model.groups);

    expect(keys).toEqual(['channel-a#0', 'sold-out#0', 'card:4']);
    expect(model.getCardsForKeys([...keys, 'channel-a#0']).map((card) => card.id)).toEqual([1, 2, 3, 4]);
    expect(model.getBulkSellQuantities(keys)).toEqual({ 'channel-a#0': 2 });
  });

  it('채널 ID 안의 # 문자와 마지막 별 구분자를 안전하게 파싱한다', () => {
    expect(parseInventoryCardKey('channel#with#hash#4')).toEqual({
      channelId: 'channel#with#hash',
      star: 4
    });
  });
});

describe('inventory filtering and stable group sorting', () => {
  it('획득 오름차순/내림차순에 맞는 그룹 대표 카드를 선택하고 즐겨찾기를 우선한다', () => {
    const old = makeCard(1, { acquired_at: '2024-01-01T00:00:00.000Z' });
    const newest = makeCard(2, { acquired_at: '2024-03-01T00:00:00.000Z' });
    const favorite = makeCard(3, {
      acquired_at: '2024-02-01T00:00:00.000Z',
      favorite_order: 0
    });
    const other = makeCard(4, {
      channel_id: 'channel-b',
      acquired_at: '2025-01-01T00:00:00.000Z',
      streamer: { channel_id: 'channel-b', name: '라마바', base_value: 500 }
    });
    const model = buildInventoryModel([old, newest, favorite, other]);

    const descending = filterAndSortInventoryGroups(model.groups, { sortBy: 'acquired-desc' });
    const ascending = filterAndSortInventoryGroups(model.groups, { sortBy: 'acquired-asc' });

    expect(descending.map((group) => group.key)).toEqual(['channel-a#0', 'channel-b#0']);
    expect(descending[0].card.id).toBe(3);
    expect(ascending[0].card.id).toBe(3);

    const withoutFavorite = buildInventoryModel([old, newest, other]);
    expect(filterAndSortInventoryGroups(withoutFavorite.groups, { sortBy: 'acquired-desc' })[0].card.id).toBe(4);
    expect(filterAndSortInventoryGroups(withoutFavorite.groups, { sortBy: 'acquired-asc' })[0].card.id).toBe(1);
  });

  it('카드 수 많은 순으로 정렬하고 동률은 최초 그룹 순서를 안정적으로 보존한다', () => {
    const cards = [
      makeCard(1, { channel_id: 'one' }),
      makeCard(2, { channel_id: 'two' }),
      makeCard(3, { channel_id: 'two' }),
      makeCard(4, { channel_id: 'three' }),
      makeCard(5, { channel_id: 'three' }),
      makeCard(6, { channel_id: 'three' }),
      makeCard(7, { channel_id: 'two' })
    ];
    const result = filterAndSortInventoryGroups(buildInventoryModel(cards).groups, { sortBy: 'count-desc' });

    expect(result.map((group) => `${group.key}:${group.count}`)).toEqual([
      'two#0:3',
      'three#0:3',
      'one#0:1'
    ]);
  });

  it('카드 수 정렬에서도 기존 즐겨찾기 고정을 카드 수보다 우선한다', () => {
    const cards = [
      makeCard(1, { channel_id: 'favorite', favorite_order: 0 }),
      makeCard(2, { channel_id: 'many' }),
      makeCard(3, { channel_id: 'many' }),
      makeCard(4, { channel_id: 'many' })
    ];
    const result = filterAndSortInventoryGroups(buildInventoryModel(cards).groups, { sortBy: 'count-desc' });

    expect(result.map((group) => `${group.key}:${group.count}`)).toEqual([
      'favorite#0:1',
      'many#0:3'
    ]);
  });

  it('검색과 방송 필터를 그룹 전체에 적용하며 필터에 맞는 카드를 대표로 선택한다', () => {
    const cards = [
      makeCard(1, { streamer: { name: '오프라인 이름', base_value: 100, is_active: false } }),
      makeCard(2, { streamer: { name: '라이브 이름', base_value: 100, is_active: true } }),
      makeCard(3, {
        channel_id: 'other',
        streamer: { name: '다른 채널', base_value: 100, is_active: true }
      })
    ];
    const result = filterAndSortInventoryGroups(buildInventoryModel(cards).groups, {
      query: 'ㄹㅇㅂ',
      liveFilter: 'live',
      isStreamerLive: (streamer) => streamer.is_active === true
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ key: 'channel-a#0', totalCount: 2, count: 1 });
    expect(result[0].card.id).toBe(2);
  });

  it('2,500장 이상에서도 전체 필터 결과와 선택 키를 페이지 제한 없이 정확히 만든다', () => {
    const cards = Array.from({ length: 2_760 }, (_, index) => {
      const channel = `channel-${Math.floor(index / 4)}`;
      return makeCard(index + 1, {
        channel_id: channel,
        star: index % 2,
        streamer: {
          channel_id: channel,
          name: `스트리머 ${Math.floor(index / 4)}`,
          base_value: 100 + index,
          is_active: index % 8 === 0
        }
      });
    });
    const model = buildInventoryModel(cards, {
      pendingCardIds: cards.filter((card) => card.id % 101 === 0).map((card) => card.id)
    });
    const visible = filterAndSortInventoryGroups(model.groups, { sortBy: 'count-desc' });
    const allKeys = getSelectableKeys(visible);

    expect(model.cardsById.size).toBe(2_760);
    expect(model.groups).toHaveLength(1_380);
    expect(visible).toHaveLength(1_380);
    expect(allKeys).toHaveLength(1_380);
    expect(allKeys.slice(0, 60)).toHaveLength(60);
    expect(new Set(allKeys).size).toBe(1_380);
  });
});
