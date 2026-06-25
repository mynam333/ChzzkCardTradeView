import { getDbMode, getMysqlDb, getSqliteDb, getSupabaseClient } from './db';
import {
  buyItem,
  getActiveItems,
  getItem,
  getUserCosmeticCounts,
  getUserPurchases,
  ShopItem
} from './shopService';

export type ArenaCosmeticLoadout = {
  user_id: string;
  border_item_id: number | null;
  name_effect_item_id: number | null;
  emote_slot_1_item_id: number | null;
  emote_slot_2_item_id: number | null;
  emote_slot_3_item_id: number | null;
  emote_slot_4_item_id: number | null;
  border_item?: ShopItem | null;
  name_effect_item?: ShopItem | null;
  emote_slot_1_item?: ShopItem | null;
  emote_slot_2_item?: ShopItem | null;
  emote_slot_3_item?: ShopItem | null;
  emote_slot_4_item?: ShopItem | null;
  updated_at: string | null;
};

type ArenaCosmeticLoadoutPatch = {
  border_item_id?: number | null;
  name_effect_item_id?: number | null;
  emote_slot_1_item_id?: number | null;
  emote_slot_2_item_id?: number | null;
  emote_slot_3_item_id?: number | null;
  emote_slot_4_item_id?: number | null;
};

const ARENA_COSMETIC_TYPES = new Set(['border', 'name_effect', 'emote']);
const ARENA_EMOTE_SLOT_KEYS = [
  'emote_slot_1_item_id',
  'emote_slot_2_item_id',
  'emote_slot_3_item_id',
  'emote_slot_4_item_id'
] as const;

const nowDbDateTime = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

export const listArenaCosmeticShopItems = async (): Promise<ShopItem[]> => {
  const items = await getActiveItems();
  return items.filter((item) => ARENA_COSMETIC_TYPES.has(item.type));
};

export const getArenaCosmeticInventoryCounts = (userId: string) => getUserCosmeticCounts(userId);

export const getArenaCosmeticPurchases = (userId: string) => getUserPurchases(userId);

export const buyArenaCosmeticItem = (userId: string, itemId: number) => buyItem(userId, itemId);

const loadShopItem = async (itemId: number | null | undefined) => {
  if (!itemId) return null;
  return getItem(Number(itemId));
};

export const getArenaCosmeticLoadout = async (userId: string): Promise<ArenaCosmeticLoadout> => {
  let row: any = null;
  if (getDbMode() === 'SUPABASE') {
    const { data } = await getSupabaseClient()
      .from('arena_user_cosmetic_loadouts')
      .select('user_id, border_item_id, name_effect_item_id, emote_slot_1_item_id, emote_slot_2_item_id, emote_slot_3_item_id, emote_slot_4_item_id, updated_at')
      .eq('user_id', userId)
      .maybeSingle();
    row = data || null;
  } else if (getDbMode() === 'MYSQL') {
    row = await getMysqlDb().get(
      'SELECT user_id, border_item_id, name_effect_item_id, emote_slot_1_item_id, emote_slot_2_item_id, emote_slot_3_item_id, emote_slot_4_item_id, updated_at FROM arena_user_cosmetic_loadouts WHERE user_id = ?',
      userId
    );
  } else {
    row = getSqliteDb().prepare(
      'SELECT user_id, border_item_id, name_effect_item_id, emote_slot_1_item_id, emote_slot_2_item_id, emote_slot_3_item_id, emote_slot_4_item_id, updated_at FROM arena_user_cosmetic_loadouts WHERE user_id = ?'
    ).get(userId);
  }

  const borderItemId = row?.border_item_id ? Number(row.border_item_id) : null;
  const nameEffectItemId = row?.name_effect_item_id ? Number(row.name_effect_item_id) : null;
  const emoteSlot1ItemId = row?.emote_slot_1_item_id ? Number(row.emote_slot_1_item_id) : null;
  const emoteSlot2ItemId = row?.emote_slot_2_item_id ? Number(row.emote_slot_2_item_id) : null;
  const emoteSlot3ItemId = row?.emote_slot_3_item_id ? Number(row.emote_slot_3_item_id) : null;
  const emoteSlot4ItemId = row?.emote_slot_4_item_id ? Number(row.emote_slot_4_item_id) : null;
  const [borderItem, nameEffectItem, emoteSlot1Item, emoteSlot2Item, emoteSlot3Item, emoteSlot4Item] = await Promise.all([
    loadShopItem(borderItemId),
    loadShopItem(nameEffectItemId),
    loadShopItem(emoteSlot1ItemId),
    loadShopItem(emoteSlot2ItemId),
    loadShopItem(emoteSlot3ItemId),
    loadShopItem(emoteSlot4ItemId)
  ]);

  return {
    user_id: userId,
    border_item_id: borderItem?.type === 'border' ? borderItemId : null,
    name_effect_item_id: nameEffectItem?.type === 'name_effect' ? nameEffectItemId : null,
    emote_slot_1_item_id: emoteSlot1Item?.type === 'emote' ? emoteSlot1ItemId : null,
    emote_slot_2_item_id: emoteSlot2Item?.type === 'emote' ? emoteSlot2ItemId : null,
    emote_slot_3_item_id: emoteSlot3Item?.type === 'emote' ? emoteSlot3ItemId : null,
    emote_slot_4_item_id: emoteSlot4Item?.type === 'emote' ? emoteSlot4ItemId : null,
    border_item: borderItem?.type === 'border' ? borderItem : null,
    name_effect_item: nameEffectItem?.type === 'name_effect' ? nameEffectItem : null,
    emote_slot_1_item: emoteSlot1Item?.type === 'emote' ? emoteSlot1Item : null,
    emote_slot_2_item: emoteSlot2Item?.type === 'emote' ? emoteSlot2Item : null,
    emote_slot_3_item: emoteSlot3Item?.type === 'emote' ? emoteSlot3Item : null,
    emote_slot_4_item: emoteSlot4Item?.type === 'emote' ? emoteSlot4Item : null,
    updated_at: row?.updated_at || null
  };
};

const assertOwnedArenaCosmetic = async (
  userId: string,
  itemId: number | null | undefined,
  expectedType: ShopItem['type'],
  ownedCounts?: Record<number, number>
): Promise<{ ok: true; itemId: number | null } | { ok: false; reason: string }> => {
  if (itemId == null) return { ok: true, itemId: null };
  const normalized = Number(itemId);
  if (!Number.isInteger(normalized) || normalized <= 0) return { ok: false, reason: 'INVALID_ITEM' };

  const item = await getItem(normalized);
  if (!item || item.type !== expectedType) return { ok: false, reason: 'ITEM_TYPE_MISMATCH' };

  const counts = ownedCounts || await getUserCosmeticCounts(userId);
  if (Number(counts[normalized] || 0) <= 0) return { ok: false, reason: 'NOT_OWNED' };

  return { ok: true, itemId: normalized };
};

export const updateArenaCosmeticLoadout = async (
  userId: string,
  patch: ArenaCosmeticLoadoutPatch
): Promise<{ ok: boolean; reason: string; loadout?: ArenaCosmeticLoadout }> => {
  const current = await getArenaCosmeticLoadout(userId);
  const nextBorder = Object.prototype.hasOwnProperty.call(patch, 'border_item_id')
    ? patch.border_item_id
    : current.border_item_id;
  const nextNameEffect = Object.prototype.hasOwnProperty.call(patch, 'name_effect_item_id')
    ? patch.name_effect_item_id
    : current.name_effect_item_id;
  const nextEmoteSlot1 = Object.prototype.hasOwnProperty.call(patch, 'emote_slot_1_item_id')
    ? patch.emote_slot_1_item_id
    : current.emote_slot_1_item_id;
  const nextEmoteSlot2 = Object.prototype.hasOwnProperty.call(patch, 'emote_slot_2_item_id')
    ? patch.emote_slot_2_item_id
    : current.emote_slot_2_item_id;
  const nextEmoteSlot3 = Object.prototype.hasOwnProperty.call(patch, 'emote_slot_3_item_id')
    ? patch.emote_slot_3_item_id
    : current.emote_slot_3_item_id;
  const nextEmoteSlot4 = Object.prototype.hasOwnProperty.call(patch, 'emote_slot_4_item_id')
    ? patch.emote_slot_4_item_id
    : current.emote_slot_4_item_id;

  const nextEmoteIds = [nextEmoteSlot1, nextEmoteSlot2, nextEmoteSlot3, nextEmoteSlot4]
    .filter((itemId): itemId is number => itemId != null)
    .map(Number);
  if (new Set(nextEmoteIds).size !== nextEmoteIds.length) {
    return { ok: false, reason: 'DUPLICATE_EMOTE_SLOT' };
  }

  const ownedCounts = await getUserCosmeticCounts(userId);
  const [borderCheck, nameEffectCheck, emoteSlot1Check, emoteSlot2Check, emoteSlot3Check, emoteSlot4Check] = await Promise.all([
    assertOwnedArenaCosmetic(userId, nextBorder, 'border', ownedCounts),
    assertOwnedArenaCosmetic(userId, nextNameEffect, 'name_effect', ownedCounts),
    assertOwnedArenaCosmetic(userId, nextEmoteSlot1, 'emote', ownedCounts),
    assertOwnedArenaCosmetic(userId, nextEmoteSlot2, 'emote', ownedCounts),
    assertOwnedArenaCosmetic(userId, nextEmoteSlot3, 'emote', ownedCounts),
    assertOwnedArenaCosmetic(userId, nextEmoteSlot4, 'emote', ownedCounts)
  ]);
  if (!borderCheck.ok) return { ok: false, reason: borderCheck.reason };
  if (!nameEffectCheck.ok) return { ok: false, reason: nameEffectCheck.reason };
  if (!emoteSlot1Check.ok) return { ok: false, reason: emoteSlot1Check.reason };
  if (!emoteSlot2Check.ok) return { ok: false, reason: emoteSlot2Check.reason };
  if (!emoteSlot3Check.ok) return { ok: false, reason: emoteSlot3Check.reason };
  if (!emoteSlot4Check.ok) return { ok: false, reason: emoteSlot4Check.reason };

  const updatedAt = nowDbDateTime();
  if (getDbMode() === 'SUPABASE') {
    await getSupabaseClient()
      .from('arena_user_cosmetic_loadouts')
      .upsert({
        user_id: userId,
        border_item_id: borderCheck.itemId,
        name_effect_item_id: nameEffectCheck.itemId,
        emote_slot_1_item_id: emoteSlot1Check.itemId,
        emote_slot_2_item_id: emoteSlot2Check.itemId,
        emote_slot_3_item_id: emoteSlot3Check.itemId,
        emote_slot_4_item_id: emoteSlot4Check.itemId,
        updated_at: updatedAt
      }, { onConflict: 'user_id' });
  } else if (getDbMode() === 'MYSQL') {
    await getMysqlDb().run(`
      INSERT INTO arena_user_cosmetic_loadouts (user_id, border_item_id, name_effect_item_id, emote_slot_1_item_id, emote_slot_2_item_id, emote_slot_3_item_id, emote_slot_4_item_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        border_item_id = VALUES(border_item_id),
        name_effect_item_id = VALUES(name_effect_item_id),
        emote_slot_1_item_id = VALUES(emote_slot_1_item_id),
        emote_slot_2_item_id = VALUES(emote_slot_2_item_id),
        emote_slot_3_item_id = VALUES(emote_slot_3_item_id),
        emote_slot_4_item_id = VALUES(emote_slot_4_item_id),
        updated_at = VALUES(updated_at)
    `, userId, borderCheck.itemId, nameEffectCheck.itemId, emoteSlot1Check.itemId, emoteSlot2Check.itemId, emoteSlot3Check.itemId, emoteSlot4Check.itemId, updatedAt);
  } else {
    getSqliteDb().prepare(`
      INSERT INTO arena_user_cosmetic_loadouts (user_id, border_item_id, name_effect_item_id, emote_slot_1_item_id, emote_slot_2_item_id, emote_slot_3_item_id, emote_slot_4_item_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        border_item_id = excluded.border_item_id,
        name_effect_item_id = excluded.name_effect_item_id,
        emote_slot_1_item_id = excluded.emote_slot_1_item_id,
        emote_slot_2_item_id = excluded.emote_slot_2_item_id,
        emote_slot_3_item_id = excluded.emote_slot_3_item_id,
        emote_slot_4_item_id = excluded.emote_slot_4_item_id,
        updated_at = excluded.updated_at
    `).run(userId, borderCheck.itemId, nameEffectCheck.itemId, emoteSlot1Check.itemId, emoteSlot2Check.itemId, emoteSlot3Check.itemId, emoteSlot4Check.itemId, updatedAt);
  }

  return { ok: true, reason: 'OK', loadout: await getArenaCosmeticLoadout(userId) };
};

export const getEquippedArenaEmoteItem = async (userId: string, itemId: number): Promise<ShopItem | null> => {
  const normalized = Number(itemId);
  if (!Number.isInteger(normalized) || normalized <= 0) return null;
  const loadout = await getArenaCosmeticLoadout(userId);
  const slotKey = ARENA_EMOTE_SLOT_KEYS.find((key) => loadout[key] === normalized);
  if (!slotKey) return null;
  const itemKey = slotKey.replace('_item_id', '_item') as keyof ArenaCosmeticLoadout;
  const item = loadout[itemKey] as ShopItem | null | undefined;
  return item?.type === 'emote' ? item : null;
};
