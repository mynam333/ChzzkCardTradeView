import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  USER_CARDS_COMPACT_ABSENT_REF,
  compactUserCards,
  type UserCardsCompactResponse
} from '../services/userCardsCompactService';

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

const expandCompact = (compact: UserCardsCompactResponse): Array<Record<string, unknown>> => {
  const streamersByChannel = new Map<string, unknown>();
  compact.streamers.forEach((streamer) => {
    const channelId = String((streamer as any)?.channel_id ?? '');
    if (channelId && !streamersByChannel.has(channelId)) streamersByChannel.set(channelId, streamer);
  });
  const cosmeticsByKindAndId = new Map<string, unknown>();
  compact.cosmetics.forEach((entry) => {
    const id = (entry.value as any)?.id;
    const key = `${entry.kind}:${String(id ?? '')}`;
    if (id != null && !cosmeticsByKindAndId.has(key)) cosmeticsByKindAndId.set(key, entry.value);
  });

  const resolve = (
    card: Record<string, unknown>,
    refKey: 'streamer_ref' | 'border_ref' | 'name_effect_ref',
    naturalValue: () => unknown,
    tableValue: (index: number) => unknown
  ): { present: boolean; value?: unknown } => {
    if (!hasOwn(card, refKey)) return { present: true, value: naturalValue() };
    const ref = card[refKey];
    if (ref === USER_CARDS_COMPACT_ABSENT_REF) return { present: false };
    if (ref === null) return { present: true, value: null };
    return { present: true, value: tableValue(Number(ref)) };
  };

  return compact.cards.map((card) => {
    const expanded = { ...card };
    delete expanded.streamer_ref;
    delete expanded.border_ref;
    delete expanded.name_effect_ref;
    const streamer = resolve(
      card,
      'streamer_ref',
      () => streamersByChannel.get(String(card.channel_id ?? '')),
      (index) => compact.streamers[index]
    );
    const border = resolve(
      card,
      'border_ref',
      () => card.border_item_id == null ? null : cosmeticsByKindAndId.get(`border:${String(card.border_item_id)}`),
      (index) => compact.cosmetics[index]?.value
    );
    const nameEffect = resolve(
      card,
      'name_effect_ref',
      () => card.name_effect_item_id == null ? null : cosmeticsByKindAndId.get(`name_effect:${String(card.name_effect_item_id)}`),
      (index) => compact.cosmetics[index]?.value
    );
    if (streamer.present) expanded.streamer = streamer.value;
    if (border.present) expanded.border = border.value;
    if (nameEffect.present) expanded.name_effect = nameEffect.value;
    return expanded;
  });
};

const wireValue = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('compact user-card response', () => {
  it('round-trips every legacy wire field while deduplicating exact nested snapshots', () => {
    const sharedStreamer = {
      channel_id: 'channel-a',
      name: '스트리머 A',
      custom_images: [null, '/uploads/a.webp'],
      base_value: 1234
    };
    const sharedBorder = { id: 7, name: null, style_json: '{"border":"red"}' };
    const cards: Array<Record<string, unknown>> = [
      {
        id: 1,
        user_id: 'user',
        channel_id: 'channel-a',
        border_item_id: 7,
        name_effect_item_id: null,
        streamer: { ...sharedStreamer },
        border: { ...sharedBorder },
        name_effect: null
      },
      {
        id: 2,
        user_id: 'user',
        channel_id: 'channel-a',
        border_item_id: 7,
        name_effect_item_id: 8,
        streamer: { ...sharedStreamer },
        border: { ...sharedBorder },
        name_effect: { id: 8, style_json: { color: 'blue' }, font_url: null, font_family: 'Test' }
      },
      {
        id: 3,
        user_id: 'user',
        channel_id: 'channel-a',
        border_item_id: null,
        name_effect_item_id: null,
        streamer: { ...sharedStreamer, base_value: 9999 },
        border: undefined
      },
      {
        id: 4,
        user_id: 'user',
        channel_id: 'missing-channel',
        border_item_id: 9,
        name_effect_item_id: null,
        streamer: null,
        border: null,
        name_effect: undefined
      },
      {
        id: 5,
        channel_id: 'partial-channel',
        streamer: null,
        border: null,
        name_effect: null
      }
    ];
    cards.push({ ...cards[0] });

    const compact = compactUserCards(cards);
    const expanded = expandCompact(wireValue(compact));

    expect(wireValue(expanded)).toEqual(wireValue(cards));
    expect(compact.cards).toHaveLength(cards.length);
    expect(compact.streamers).toHaveLength(2);
    expect(compact.cosmetics).toHaveLength(2);
    expect(compact.cards[0]).not.toHaveProperty('streamer_ref');
    expect(compact.cards[2]).toMatchObject({ streamer_ref: 1, border_ref: USER_CARDS_COMPACT_ABSENT_REF });
    expect(compact.cards[3]).toMatchObject({ streamer_ref: null, border_ref: null, name_effect_ref: USER_CARDS_COMPACT_ABSENT_REF });
    expect(compact.cards[4]).toMatchObject({ streamer_ref: null, border_ref: null, name_effect_ref: null });
    expect(expanded[0].streamer).toBe(expanded[1].streamer);
    expect(expanded[0].border).toBe(expanded[1].border);
  });

  it('keeps string and object cosmetic styles as distinct lossless snapshots', () => {
    const cards = [
      { id: 1, channel_id: 'a', border_item_id: 5, name_effect_item_id: null, streamer: { channel_id: 'a' }, border: { id: 5, style_json: '{"x":1}' }, name_effect: null },
      { id: 2, channel_id: 'a', border_item_id: 5, name_effect_item_id: null, streamer: { channel_id: 'a' }, border: { id: 5, style_json: { x: 1 } }, name_effect: null }
    ];
    const compact = compactUserCards(cards);

    expect(compact.cosmetics).toHaveLength(2);
    expect(compact.cards[0]).not.toHaveProperty('border_ref');
    expect(compact.cards[1]).toHaveProperty('border_ref', 1);
    expect(wireValue(expandCompact(wireValue(compact)))).toEqual(wireValue(cards));
  });

  it('rejects repository rows that collide with reserved compact reference fields', () => {
    expect(() => compactUserCards([{ id: 1, streamer_ref: 0 }])).toThrow('USER_CARDS_COMPACT_RESERVED_FIELD:streamer_ref');
  });

  it.each([
    ['repeated metadata', false],
    ['unique-heavy metadata', true]
  ])('does not increase raw or gzip bytes for %s', (_label, uniqueMetadata) => {
    const cards = Array.from({ length: 3000 }, (_, index) => {
      const metadataIndex = uniqueMetadata ? index : index % 60;
      const channelId = `channel-${metadataIndex}`;
      return {
        id: index + 1,
        user_id: 'benchmark-user',
        channel_id: channelId,
        serial_number: index + 1,
        star: index % 6,
        border_item_id: index % 5 === 0 ? metadataIndex + 1 : null,
        name_effect_item_id: index % 7 === 0 ? metadataIndex + 10_000 : null,
        is_hidden: false,
        is_locked: false,
        favorite_order: null,
        favorite_at: null,
        acquired_at: '2026-11-06T01:02:03.000Z',
        streamer: {
          channel_id: channelId,
          name: `스트리머 ${metadataIndex}`,
          logo_url: `https://cdn.example/${metadataIndex}/logo.png`,
          custom_images: Array.from({ length: 6 }, (_, star) => `https://cdn.example/${metadataIndex}/star-${star}.webp`),
          base_value: 123_456 + metadataIndex,
          follower_count: 234_567 + metadataIndex
        },
        border: index % 5 === 0
          ? { id: metadataIndex + 1, name: `border-${metadataIndex}`, style_json: `{"x":${metadataIndex}}` }
          : null,
        name_effect: index % 7 === 0
          ? { id: metadataIndex + 10_000, name: `name-${metadataIndex}`, style_json: { x: metadataIndex }, font_url: null, font_family: 'Test' }
          : null
      };
    });
    const legacyBytes = Buffer.from(JSON.stringify(cards));
    const compactBytes = Buffer.from(JSON.stringify(compactUserCards(cards)));

    expect(compactBytes.byteLength).toBeLessThanOrEqual(legacyBytes.byteLength);
    expect(gzipSync(compactBytes).byteLength).toBeLessThanOrEqual(gzipSync(legacyBytes).byteLength);
  });
});
