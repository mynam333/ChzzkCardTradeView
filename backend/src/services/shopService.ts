/**
 * shopService.ts - 상점(코스메틱) 데이터 액세스. SQLite/Supabase 양 모드를 인라인 처리합니다.
 * 코스메틱: 'border'(테두리) | 'name_effect'(이름 이펙트) | 'emote'(아레나 이모트).
 * 카드 장착은 border/name_effect만 허용하며 emote는 아레나 전용 로드아웃에서만 사용합니다.
 */
import { getDbMode, getMysqlDb, getSqlDialect, getSqliteDb, getSupabaseClient } from './db';
import { recordMysqlPointLedger, recordSqlitePointLedger } from './pointLedger';
import { recordMysqlAssetEvent, recordSqliteAssetEvent } from './assetEventLog';
import { toSqlDateTime } from '../repositories/mysql/dateUtils';

export interface ShopItem {
  id: number;
  type: 'border' | 'name_effect' | 'emote';
  name: string;
  description: string | null;
  price: number;
  style_json: string | null;
  font_url: string | null;
  font_family: string | null;
  active: boolean;
  purchase_limit: number; // 1인 최대 구매 갯수 (0 = 무제한)
  listed_at?: string | null;
  sale_start_at?: string | null;
  sale_end_at?: string | null;
  limited_total_quantity?: number;
  sold_quantity?: number;
  created_at?: string | null;
}

export type ArenaEmoteSlot = ShopItem | null;

export interface ArenaCosmeticLoadout {
  emoteSlots: ArenaEmoteSlot[];
}

const ARENA_EMOTE_SLOT_COUNT = 8;

const mapSqliteItem = (r: any): ShopItem => ({
  id: r.id, type: r.type, name: r.name, description: r.description,
  price: r.price, style_json: r.style_json, font_url: r.font_url,
  font_family: r.font_family, active: r.active === 1,
  purchase_limit: r.purchase_limit ?? 0,
  listed_at: r.listed_at ?? null,
  sale_start_at: r.sale_start_at ?? null,
  sale_end_at: r.sale_end_at ?? null,
  limited_total_quantity: r.limited_total_quantity ?? 0,
  sold_quantity: r.sold_quantity ?? 0,
  created_at: r.created_at ?? null
});

const SHOP_ITEM_SELECT_COLUMNS = [
  'id',
  'type',
  'name',
  'description',
  'price',
  'style_json',
  'font_url',
  'font_family',
  'active',
  'purchase_limit',
  'listed_at',
  'sale_start_at',
  'sale_end_at',
  'limited_total_quantity',
  'sold_quantity',
  'created_at'
].join(', ');
const ACTIVE_ITEMS_CACHE_TTL_MS = 15_000;
let activeItemsCache: { expiresAt: number; data: ShopItem[] } | null = null;
let activeItemsInFlight: Promise<ShopItem[]> | null = null;

export const invalidateActiveShopItemsCache = () => {
  activeItemsCache = null;
};

const toDbDateTime = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return toSqlDateTime(date, getDbMode() === 'MYSQL' ? getSqlDialect() : 'mysql');
};

const nowDbDateTime = () => toDbDateTime(new Date().toISOString());

const parseShopDateMs = (value: string | null | undefined): number => {
  if (!value) return NaN;
  const text = String(value).trim();
  if (!text) return NaN;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) return new Date(text).getTime();
  return new Date(`${text.replace(' ', 'T')}+09:00`).getTime();
};

const getItemSaleFailureReason = (item: any, now = Date.now()): string | null => {
  const startMs = parseShopDateMs(item.sale_start_at);
  if (Number.isFinite(startMs) && now < startMs) return 'SALE_NOT_STARTED';
  const endMs = parseShopDateMs(item.sale_end_at);
  if (Number.isFinite(endMs) && now > endMs) return 'SALE_ENDED';
  const total = Number(item.limited_total_quantity || 0);
  const sold = Number(item.sold_quantity || 0);
  if (total > 0 && sold >= total) return 'SOLD_OUT';
  return null;
};

const resultNeedsCatalogRefresh = (reason: string) => reason === 'OK';

// ---- 아이템 카탈로그 ----
const fetchActiveItemsFromDb = async (): Promise<ShopItem[]> => {
  if (getDbMode() === 'SUPABASE') {
    const { data } = await getSupabaseClient()
      .from('shop_items')
      .select(SHOP_ITEM_SELECT_COLUMNS)
      .eq('active', true)
      .order('listed_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false });
    return (data || []) as unknown as ShopItem[];
  }
  if (getDbMode() === 'MYSQL') {
    const rows = await getMysqlDb().all(`
      SELECT ${SHOP_ITEM_SELECT_COLUMNS}
        FROM shop_items
       WHERE active = 1
       ORDER BY listed_at DESC, id DESC
    `);
    return rows.map(mapSqliteItem);
  }
  return getSqliteDb().prepare(`
    SELECT ${SHOP_ITEM_SELECT_COLUMNS}
      FROM shop_items
     WHERE active = 1
     ORDER BY listed_at DESC, id DESC
  `).all().map(mapSqliteItem);
};

export const getActiveItems = async (): Promise<ShopItem[]> => {
  const now = Date.now();
  if (activeItemsCache && activeItemsCache.expiresAt > now) {
    return activeItemsCache.data;
  }
  if (activeItemsInFlight) {
    return activeItemsInFlight;
  }

  activeItemsInFlight = fetchActiveItemsFromDb()
    .then((data) => {
      activeItemsCache = { data, expiresAt: Date.now() + ACTIVE_ITEMS_CACHE_TTL_MS };
      return data;
    })
    .finally(() => {
      activeItemsInFlight = null;
    });

  return activeItemsInFlight;
};

export const getAllItems = async (): Promise<ShopItem[]> => {
  if (getDbMode() === 'SUPABASE') {
    const { data } = await getSupabaseClient().from('shop_items').select('*').order('id', { ascending: false });
    return (data || []) as ShopItem[];
  }
  if (getDbMode() === 'MYSQL') {
    const rows = await getMysqlDb().all('SELECT * FROM shop_items ORDER BY id DESC');
    return rows.map(mapSqliteItem);
  }
  return getSqliteDb().prepare('SELECT * FROM shop_items ORDER BY id DESC').all().map(mapSqliteItem);
};

export const getItem = async (id: number): Promise<ShopItem | null> => {
  if (getDbMode() === 'SUPABASE') {
    const { data } = await getSupabaseClient().from('shop_items').select('*').eq('id', id).maybeSingle();
    return (data as ShopItem) || null;
  }
  if (getDbMode() === 'MYSQL') {
    const r = await getMysqlDb().get('SELECT * FROM shop_items WHERE id = ?', id);
    return r ? mapSqliteItem(r) : null;
  }
  const r = getSqliteDb().prepare('SELECT * FROM shop_items WHERE id = ?').get(id);
  return r ? mapSqliteItem(r) : null;
};

export const createItem = async (item: Omit<ShopItem, 'id' | 'active'> & { active?: boolean }): Promise<void> => {
  const active = item.active !== false;
  const limit = Math.max(0, Math.floor(Number(item.purchase_limit) || 0));
  const totalQuantity = Math.max(0, Math.floor(Number(item.limited_total_quantity) || 0));
  const saleStartAt = toDbDateTime(item.sale_start_at);
  const saleEndAt = toDbDateTime(item.sale_end_at);
  const listedAt = active ? nowDbDateTime() : null;
  if (getDbMode() === 'SUPABASE') {
    await getSupabaseClient().from('shop_items').insert([{
      type: item.type, name: item.name, description: item.description ?? null, price: item.price,
      style_json: item.style_json ?? null, font_url: item.font_url ?? null, font_family: item.font_family ?? null, active, purchase_limit: limit,
      listed_at: listedAt, sale_start_at: saleStartAt, sale_end_at: saleEndAt, limited_total_quantity: totalQuantity, sold_quantity: 0
    }]);
  } else if (getDbMode() === 'MYSQL') {
    await getMysqlDb().run(
      'INSERT INTO shop_items (type, name, description, price, style_json, font_url, font_family, active, purchase_limit, listed_at, sale_start_at, sale_end_at, limited_total_quantity, sold_quantity) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      item.type, item.name, item.description ?? null, item.price, item.style_json ?? null, item.font_url ?? null, item.font_family ?? null, active ? 1 : 0, limit, listedAt, saleStartAt, saleEndAt, totalQuantity, 0
    );
  } else {
    getSqliteDb().prepare(
      'INSERT INTO shop_items (type, name, description, price, style_json, font_url, font_family, active, purchase_limit, listed_at, sale_start_at, sale_end_at, limited_total_quantity, sold_quantity) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(item.type, item.name, item.description ?? null, item.price, item.style_json ?? null, item.font_url ?? null, item.font_family ?? null, active ? 1 : 0, limit, listedAt, saleStartAt, saleEndAt, totalQuantity, 0);
  }
  invalidateActiveShopItemsCache();
};

export const updateItem = async (id: number, item: Partial<ShopItem>): Promise<void> => {
  if (getDbMode() === 'SUPABASE') {
    const payload: any = {};
    const cur = await getSupabaseClient().from('shop_items').select('active, listed_at').eq('id', id).maybeSingle();
    for (const k of ['type', 'name', 'description', 'price', 'style_json', 'font_url', 'font_family', 'active', 'purchase_limit', 'sale_start_at', 'sale_end_at', 'limited_total_quantity', 'sold_quantity'] as const) {
      if (item[k] !== undefined) payload[k] = item[k];
    }
    if (item.active !== undefined) {
      const wasActive = !!cur.data?.active;
      payload.listed_at = item.active ? (wasActive ? cur.data?.listed_at ?? nowDbDateTime() : nowDbDateTime()) : null;
    }
    if (payload.sale_start_at !== undefined) payload.sale_start_at = toDbDateTime(payload.sale_start_at);
    if (payload.sale_end_at !== undefined) payload.sale_end_at = toDbDateTime(payload.sale_end_at);
    if (payload.limited_total_quantity !== undefined) payload.limited_total_quantity = Math.max(0, Math.floor(Number(payload.limited_total_quantity) || 0));
    await getSupabaseClient().from('shop_items').update(payload).eq('id', id);
  } else if (getDbMode() === 'MYSQL') {
    const cur = await getMysqlDb().get('SELECT * FROM shop_items WHERE id = ?', id) as any;
    if (!cur) return;
    const merged = {
      type: item.type ?? cur.type, name: item.name ?? cur.name, description: item.description ?? cur.description,
      price: item.price ?? cur.price, style_json: item.style_json ?? cur.style_json,
      font_url: item.font_url ?? cur.font_url, font_family: item.font_family ?? cur.font_family,
      active: item.active !== undefined ? (item.active ? 1 : 0) : cur.active,
      purchase_limit: item.purchase_limit !== undefined ? Math.max(0, Math.floor(Number(item.purchase_limit) || 0)) : (cur.purchase_limit ?? 0),
      listed_at: item.active !== undefined
        ? (item.active ? (cur.active ? (cur.listed_at ?? nowDbDateTime()) : nowDbDateTime()) : null)
        : (cur.listed_at ?? (cur.active ? cur.created_at ?? null : null)),
      sale_start_at: item.sale_start_at !== undefined ? toDbDateTime(item.sale_start_at) : (cur.sale_start_at ?? null),
      sale_end_at: item.sale_end_at !== undefined ? toDbDateTime(item.sale_end_at) : (cur.sale_end_at ?? null),
      limited_total_quantity: item.limited_total_quantity !== undefined ? Math.max(0, Math.floor(Number(item.limited_total_quantity) || 0)) : (cur.limited_total_quantity ?? 0),
      sold_quantity: item.sold_quantity !== undefined ? Math.max(0, Math.floor(Number(item.sold_quantity) || 0)) : (cur.sold_quantity ?? 0)
    };
    await getMysqlDb().run(
      'UPDATE shop_items SET type=?, name=?, description=?, price=?, style_json=?, font_url=?, font_family=?, active=?, purchase_limit=?, listed_at=?, sale_start_at=?, sale_end_at=?, limited_total_quantity=?, sold_quantity=? WHERE id=?',
      merged.type, merged.name, merged.description, merged.price, merged.style_json, merged.font_url, merged.font_family, merged.active, merged.purchase_limit, merged.listed_at, merged.sale_start_at, merged.sale_end_at, merged.limited_total_quantity, merged.sold_quantity, id
    );
  } else {
    const cur = getSqliteDb().prepare('SELECT * FROM shop_items WHERE id = ?').get(id) as any;
    if (!cur) return;
    const merged = {
      type: item.type ?? cur.type, name: item.name ?? cur.name, description: item.description ?? cur.description,
      price: item.price ?? cur.price, style_json: item.style_json ?? cur.style_json,
      font_url: item.font_url ?? cur.font_url, font_family: item.font_family ?? cur.font_family,
      active: item.active !== undefined ? (item.active ? 1 : 0) : cur.active,
      purchase_limit: item.purchase_limit !== undefined ? Math.max(0, Math.floor(Number(item.purchase_limit) || 0)) : (cur.purchase_limit ?? 0),
      listed_at: item.active !== undefined
        ? (item.active ? (cur.active ? (cur.listed_at ?? nowDbDateTime()) : nowDbDateTime()) : null)
        : (cur.listed_at ?? (cur.active ? cur.created_at ?? null : null)),
      sale_start_at: item.sale_start_at !== undefined ? toDbDateTime(item.sale_start_at) : (cur.sale_start_at ?? null),
      sale_end_at: item.sale_end_at !== undefined ? toDbDateTime(item.sale_end_at) : (cur.sale_end_at ?? null),
      limited_total_quantity: item.limited_total_quantity !== undefined ? Math.max(0, Math.floor(Number(item.limited_total_quantity) || 0)) : (cur.limited_total_quantity ?? 0),
      sold_quantity: item.sold_quantity !== undefined ? Math.max(0, Math.floor(Number(item.sold_quantity) || 0)) : (cur.sold_quantity ?? 0)
    };
    getSqliteDb().prepare(
      'UPDATE shop_items SET type=?, name=?, description=?, price=?, style_json=?, font_url=?, font_family=?, active=?, purchase_limit=?, listed_at=?, sale_start_at=?, sale_end_at=?, limited_total_quantity=?, sold_quantity=? WHERE id=?'
    ).run(merged.type, merged.name, merged.description, merged.price, merged.style_json, merged.font_url, merged.font_family, merged.active, merged.purchase_limit, merged.listed_at, merged.sale_start_at, merged.sale_end_at, merged.limited_total_quantity, merged.sold_quantity, id);
  }
  invalidateActiveShopItemsCache();
};

// ---- 보유 코스메틱 ----
export const getUserCosmetics = async (userId: string): Promise<(ShopItem & { quantity: number })[]> => {
  if (getDbMode() === 'SUPABASE') {
    const { data, error } = await getSupabaseClient()
      .from('user_cosmetics')
      .select('quantity, item:shop_items(*)')
      .eq('user_id', userId)
      .gt('quantity', 0);
    
    if (error) {
      console.error('[Supabase] getUserCosmetics - 조인 쿼리 실패:', error.message);
      return [];
    }
    return (data || []).map((r: any) => ({ ...(r.item), quantity: r.quantity }));
  }

  if (getDbMode() === 'MYSQL') {
    const rows = await getMysqlDb().all(`
      SELECT
        si.id, si.type, si.name, si.description, si.price,
        si.style_json, si.font_url, si.font_family, si.active, si.purchase_limit, si.listed_at,
        si.sale_start_at, si.sale_end_at, si.limited_total_quantity, si.sold_quantity,
        uc.quantity
      FROM user_cosmetics uc
      JOIN shop_items si ON uc.item_id = si.id
      WHERE uc.user_id = ? AND uc.quantity > 0
    `, userId) as any[];
    return rows.map((r) => ({ ...mapSqliteItem(r), quantity: r.quantity }));
  }

  // SQLite 모드: uc.id와 si.id 컬럼명 충돌로 인해 si.id가 uc.id로 덮어씌워지는 현상을 해결하기 위해 컬럼을 명시적으로 SELECT
  const rows = getSqliteDb().prepare(`
    SELECT 
      si.id, si.type, si.name, si.description, si.price, 
      si.style_json, si.font_url, si.font_family, si.active, si.purchase_limit, si.listed_at,
      si.sale_start_at, si.sale_end_at, si.limited_total_quantity, si.sold_quantity,
      uc.quantity 
    FROM user_cosmetics uc
    JOIN shop_items si ON uc.item_id = si.id
    WHERE uc.user_id = ? AND uc.quantity > 0
  `).all(userId) as any[];
  return rows.map((r) => ({ ...mapSqliteItem(r), quantity: r.quantity }));
};

/** 상점 목록 표시용 보유 수량 맵. 코스메틱 상세 조인을 피해서 payload와 DB 비용을 낮춥니다. */
export const getUserCosmeticCounts = async (userId: string): Promise<Record<number, number>> => {
  const map: Record<number, number> = {};
  if (getDbMode() === 'SUPABASE') {
    const { data } = await getSupabaseClient()
      .from('user_cosmetics')
      .select('item_id, quantity')
      .eq('user_id', userId)
      .gt('quantity', 0);
    for (const r of data || []) map[r.item_id] = (map[r.item_id] || 0) + (r.quantity || 0);
    return map;
  }
  if (getDbMode() === 'MYSQL') {
    const rows = await getMysqlDb().all(
      'SELECT item_id, quantity FROM user_cosmetics WHERE user_id = ? AND quantity > 0',
      userId
    ) as any[];
    for (const r of rows) map[r.item_id] = (map[r.item_id] || 0) + (r.quantity || 0);
    return map;
  }
  const rows = getSqliteDb().prepare(
    'SELECT item_id, quantity FROM user_cosmetics WHERE user_id = ? AND quantity > 0'
  ).all(userId) as any[];
  for (const r of rows) map[r.item_id] = (map[r.item_id] || 0) + (r.quantity || 0);
  return map;
};

const addCosmetic = async (userId: string, itemId: number, delta: number): Promise<void> => {
  if (getDbMode() === 'SUPABASE') {
    const client = getSupabaseClient();
    const { data } = await client.from('user_cosmetics').select('quantity').eq('user_id', userId).eq('item_id', itemId).maybeSingle();
    const next = Math.max(0, (data?.quantity || 0) + delta);
    await client.from('user_cosmetics').upsert({ user_id: userId, item_id: itemId, quantity: next }, { onConflict: 'user_id,item_id' });
  } else if (getDbMode() === 'MYSQL') {
    await getMysqlDb().run(`
      INSERT INTO user_cosmetics (user_id, item_id, quantity) VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE quantity = GREATEST(0, quantity + ?)
    `, userId, itemId, Math.max(0, delta), delta);
  } else {
    getSqliteDb().prepare(`
      INSERT INTO user_cosmetics (user_id, item_id, quantity) VALUES (?, ?, ?)
      ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = MAX(0, quantity + ?)
    `).run(userId, itemId, Math.max(0, delta), delta);
  }
};

/** 유저의 아이템별 구매 횟수 맵 (상점 UI용) */
export const getUserPurchases = async (userId: string): Promise<Record<number, number>> => {
  const map: Record<number, number> = {};
  if (getDbMode() === 'SUPABASE') {
    const { data } = await getSupabaseClient().from('shop_purchases').select('item_id, count').eq('user_id', userId);
    for (const r of data || []) map[r.item_id] = (map[r.item_id] || 0) + (r.count || 0);
    return map;
  }
  if (getDbMode() === 'MYSQL') {
    const rows = await getMysqlDb().all('SELECT item_id, count FROM shop_purchases WHERE user_id = ?', userId) as any[];
    for (const r of rows) map[r.item_id] = (map[r.item_id] || 0) + (r.count || 0);
    return map;
  }
  const rows = getSqliteDb().prepare('SELECT item_id, count FROM shop_purchases WHERE user_id = ?').all(userId) as any[];
  for (const r of rows) map[r.item_id] = (map[r.item_id] || 0) + (r.count || 0);
  return map;
};

const normalizeArenaEmoteSlots = (raw: unknown): Array<number | null> => {
  const source = Array.isArray(raw) ? raw : [];
  return Array.from({ length: ARENA_EMOTE_SLOT_COUNT }, (_, index) => {
    const value = source[index];
    if (value === null || value === undefined || value === '') return null;
    const id = Number(value);
    return Number.isFinite(id) && id > 0 ? Math.floor(id) : null;
  });
};

const itemMapById = (items: ShopItem[]) => new Map(items.map((item) => [Number(item.id), item]));

export const getArenaCosmeticShopItems = async (): Promise<ShopItem[]> => {
  const items = await getActiveItems();
  return items.filter((item) => item.type === 'emote');
};

export const getArenaUserCosmeticCounts = async (userId: string): Promise<Record<number, number>> => {
  const counts = await getUserCosmeticCounts(userId);
  const emoteItems = await getArenaCosmeticShopItems();
  const emoteIds = new Set(emoteItems.map((item) => Number(item.id)));
  const filtered: Record<number, number> = {};
  for (const [rawId, count] of Object.entries(counts)) {
    const id = Number(rawId);
    if (emoteIds.has(id)) filtered[id] = count;
  }
  return filtered;
};

export const getArenaUserPurchases = async (userId: string): Promise<Record<number, number>> => {
  const purchases = await getUserPurchases(userId);
  const emoteItems = await getArenaCosmeticShopItems();
  const emoteIds = new Set(emoteItems.map((item) => Number(item.id)));
  const filtered: Record<number, number> = {};
  for (const [rawId, count] of Object.entries(purchases)) {
    const id = Number(rawId);
    if (emoteIds.has(id)) filtered[id] = count;
  }
  return filtered;
};

const getOwnedArenaEmoteItems = async (userId: string): Promise<ShopItem[]> => {
  const items = await getUserCosmetics(userId);
  return items.filter((item) => item.type === 'emote' && Number(item.quantity || 0) > 0);
};

const getRawArenaLoadoutRow = async (userId: string): Promise<any | null> => {
  if (getDbMode() === 'SUPABASE') {
    const { data } = await getSupabaseClient()
      .from('arena_user_cosmetic_loadouts')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    return data || null;
  }
  if (getDbMode() === 'MYSQL') {
    return await getMysqlDb().get('SELECT * FROM arena_user_cosmetic_loadouts WHERE user_id = ?', userId) as any || null;
  }
  return getSqliteDb().prepare('SELECT * FROM arena_user_cosmetic_loadouts WHERE user_id = ?').get(userId) as any || null;
};

export const getArenaCosmeticLoadout = async (userId: string): Promise<ArenaCosmeticLoadout> => {
  const row = await getRawArenaLoadoutRow(userId);
  const ownedItems = itemMapById(await getOwnedArenaEmoteItems(userId));
  const emoteSlots = Array.from({ length: ARENA_EMOTE_SLOT_COUNT }, (_, index) => {
    const id = Number(row?.[`emote_slot_${index + 1}_item_id`] || 0);
    return id > 0 ? ownedItems.get(id) || null : null;
  });
  return { emoteSlots };
};

export const updateArenaCosmeticLoadout = async (userId: string, input: { emoteSlots?: unknown }): Promise<{ ok: boolean; reason: string; loadout?: ArenaCosmeticLoadout }> => {
  const slots = normalizeArenaEmoteSlots(input.emoteSlots);
  const ownedItems = itemMapById(await getOwnedArenaEmoteItems(userId));
  for (const id of slots) {
    if (id && !ownedItems.has(id)) return { ok: false, reason: 'NOT_OWNED' };
  }

  const params = [userId, ...slots];
  if (getDbMode() === 'SUPABASE') {
    const payload: any = { user_id: userId, updated_at: new Date().toISOString() };
    slots.forEach((id, index) => { payload[`emote_slot_${index + 1}_item_id`] = id; });
    await getSupabaseClient().from('arena_user_cosmetic_loadouts').upsert(payload, { onConflict: 'user_id' });
  } else if (getDbMode() === 'MYSQL') {
    await getMysqlDb().run(`
      INSERT INTO arena_user_cosmetic_loadouts
        (user_id, emote_slot_1_item_id, emote_slot_2_item_id, emote_slot_3_item_id, emote_slot_4_item_id, emote_slot_5_item_id, emote_slot_6_item_id, emote_slot_7_item_id, emote_slot_8_item_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        emote_slot_1_item_id = VALUES(emote_slot_1_item_id),
        emote_slot_2_item_id = VALUES(emote_slot_2_item_id),
        emote_slot_3_item_id = VALUES(emote_slot_3_item_id),
        emote_slot_4_item_id = VALUES(emote_slot_4_item_id),
        emote_slot_5_item_id = VALUES(emote_slot_5_item_id),
        emote_slot_6_item_id = VALUES(emote_slot_6_item_id),
        emote_slot_7_item_id = VALUES(emote_slot_7_item_id),
        emote_slot_8_item_id = VALUES(emote_slot_8_item_id),
        updated_at = CURRENT_TIMESTAMP
    `, params);
  } else {
    getSqliteDb().prepare(`
      INSERT INTO arena_user_cosmetic_loadouts
        (user_id, emote_slot_1_item_id, emote_slot_2_item_id, emote_slot_3_item_id, emote_slot_4_item_id, emote_slot_5_item_id, emote_slot_6_item_id, emote_slot_7_item_id, emote_slot_8_item_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        emote_slot_1_item_id = excluded.emote_slot_1_item_id,
        emote_slot_2_item_id = excluded.emote_slot_2_item_id,
        emote_slot_3_item_id = excluded.emote_slot_3_item_id,
        emote_slot_4_item_id = excluded.emote_slot_4_item_id,
        emote_slot_5_item_id = excluded.emote_slot_5_item_id,
        emote_slot_6_item_id = excluded.emote_slot_6_item_id,
        emote_slot_7_item_id = excluded.emote_slot_7_item_id,
        emote_slot_8_item_id = excluded.emote_slot_8_item_id,
        updated_at = datetime('now')
    `).run(...params);
  }
  return { ok: true, reason: 'OK', loadout: await getArenaCosmeticLoadout(userId) };
};

export const getArenaEquippedEmote = async (userId: string, itemId: number): Promise<ShopItem | null> => {
  const loadout = await getArenaCosmeticLoadout(userId);
  return loadout.emoteSlots.find((item) => Number(item?.id || 0) === itemId) || null;
};

/** 특정 아이템의 모든 구매 횟수 초기화 (관리자) */
export const resetPurchases = async (itemId: number): Promise<void> => {
  if (getDbMode() === 'SUPABASE') {
    await getSupabaseClient().from('shop_purchases').delete().eq('item_id', itemId);
  } else if (getDbMode() === 'MYSQL') {
    await getMysqlDb().run('DELETE FROM shop_purchases WHERE item_id = ?', itemId);
  } else {
    getSqliteDb().prepare('DELETE FROM shop_purchases WHERE item_id = ?').run(itemId);
  }
};

// ---- 무상 지급 (쿠폰 등) ----
export const grantCosmetic = async (userId: string, itemId: number, quantity: number = 1): Promise<{ ok: boolean; reason: string }> => {
  const item = await getItem(itemId);
  if (!item) return { ok: false, reason: 'NOT_FOUND' };
  const qty = Math.max(1, Math.floor(quantity) || 1);
  await addCosmetic(userId, itemId, qty);
  return { ok: true, reason: 'OK' };
};

// ---- 구매 ----
export const buyItem = async (userId: string, itemId: number): Promise<{ ok: boolean; reason: string; catalogChanged?: boolean }> => {
  if (getDbMode() === 'SUPABASE') {
    const { data, error } = await getSupabaseClient().rpc('buy_shop_item_atomic', {
      p_user_id: userId,
      p_item_id: itemId
    });
    if (error) {
      console.error('[Supabase] buy_shop_item_atomic RPC 실패:', error.message);
      return { ok: false, reason: 'RPC_ERROR' };
    }
    const reason = String(data);
    const result = { ok: reason === 'OK', reason, catalogChanged: resultNeedsCatalogRefresh(reason) };
    if (result.catalogChanged) invalidateActiveShopItemsCache();
    return result;
  }

  if (getDbMode() === 'MYSQL') {
    try {
      let shouldInvalidateCatalog = false;
      const result = await getMysqlDb().transaction(async (tx) => {
      const item = await tx.get('SELECT * FROM shop_items WHERE id = ? AND active = 1', itemId) as any;
      if (!item) return { ok: false, reason: 'NOT_FOUND' };
      const saleFailure = getItemSaleFailureReason(item);
      if (saleFailure) return { ok: false, reason: saleFailure };
      if ((item.purchase_limit || 0) > 0) {
        const boughtRow = await tx.get('SELECT COALESCE(count, 0) AS c FROM shop_purchases WHERE user_id = ? AND item_id = ? FOR UPDATE', userId, itemId) as any;
        if ((boughtRow?.c || 0) >= item.purchase_limit) return { ok: false, reason: 'LIMIT_REACHED' };
      }
      const paid = await tx.run('UPDATE users SET point = point - ? WHERE id = ? AND point >= ?', item.price, userId, item.price);
      if (paid.changes === 0) return { ok: false, reason: 'INSUFFICIENT_POINT' };
      await recordMysqlPointLedger(tx, {
        userId,
        amount: -Number(item.price || 0),
        sourceType: 'shop_purchase',
        sourceId: itemId,
        reason: 'shop_purchase',
        description: `상점 아이템 구매: ${item.name || itemId}`,
        metadata: { item_id: itemId, item_name: item.name, price: item.price }
      });
      await tx.run(`
        INSERT INTO user_cosmetics (user_id, item_id, quantity) VALUES (?, ?, 1)
        ON DUPLICATE KEY UPDATE quantity = quantity + 1
      `, userId, itemId);
      await recordMysqlAssetEvent(tx, {
        userId,
        assetType: 'cosmetic',
        action: 'add',
        quantity: 1,
        sourceType: 'shop_purchase',
        sourceId: itemId,
        reason: 'shop_cosmetic_purchase',
        description: `상점 아이템 구매 지급: ${item.name || itemId}`,
        itemId,
        itemType: item.type,
        metadata: { item_id: itemId, item_name: item.name, price: item.price }
      });
      if ((item.limited_total_quantity || 0) > 0) {
        const stock = await tx.run(
          'UPDATE shop_items SET sold_quantity = sold_quantity + 1 WHERE id = ? AND sold_quantity < limited_total_quantity',
          itemId
        );
        if (stock.changes === 0) {
          throw new Error('SHOP_STOCK_RACE');
        }
        shouldInvalidateCatalog = true;
      }
      if ((item.purchase_limit || 0) > 0) {
        await tx.run(`
          INSERT INTO shop_purchases (user_id, item_id, count) VALUES (?, ?, 1)
          ON DUPLICATE KEY UPDATE count = count + 1
        `, userId, itemId);
      }
      return { ok: true, reason: 'OK' };
      });
      if (result.ok && shouldInvalidateCatalog) invalidateActiveShopItemsCache();
      return { ...result, catalogChanged: result.ok && shouldInvalidateCatalog };
    } catch (err: any) {
      if (err?.message === 'SHOP_STOCK_RACE') return { ok: false, reason: 'SOLD_OUT' };
      throw err;
    }
  }

  const db = getSqliteDb();
  try {
    let shouldInvalidateCatalog = false;
    const result = db.transaction(() => {
    const item = db.prepare('SELECT * FROM shop_items WHERE id = ? AND active = 1').get(itemId) as any;
    if (!item) return { ok: false, reason: 'NOT_FOUND' };
    const saleFailure = getItemSaleFailureReason(item);
    if (saleFailure) return { ok: false, reason: saleFailure };

    if ((item.purchase_limit || 0) > 0) {
      const boughtRow = db.prepare('SELECT COALESCE(count, 0) AS c FROM shop_purchases WHERE user_id = ? AND item_id = ?')
        .get(userId, itemId) as any;
      if ((boughtRow?.c || 0) >= item.purchase_limit) return { ok: false, reason: 'LIMIT_REACHED' };
    }

    const paid = db.prepare('UPDATE users SET point = point - ? WHERE id = ? AND point >= ?')
      .run(item.price, userId, item.price);
    if (paid.changes === 0) return { ok: false, reason: 'INSUFFICIENT_POINT' };
    recordSqlitePointLedger(db, {
      userId,
      amount: -Number(item.price || 0),
      sourceType: 'shop_purchase',
      sourceId: itemId,
      reason: 'shop_purchase',
      description: `상점 아이템 구매: ${item.name || itemId}`,
      metadata: { item_id: itemId, item_name: item.name, price: item.price }
    });

    db.prepare(`
      INSERT INTO user_cosmetics (user_id, item_id, quantity) VALUES (?, ?, 1)
      ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + 1
    `).run(userId, itemId);
    recordSqliteAssetEvent(db, {
      userId,
      assetType: 'cosmetic',
      action: 'add',
      quantity: 1,
      sourceType: 'shop_purchase',
      sourceId: itemId,
      reason: 'shop_cosmetic_purchase',
      description: `상점 아이템 구매 지급: ${item.name || itemId}`,
      itemId,
      itemType: item.type,
      metadata: { item_id: itemId, item_name: item.name, price: item.price }
    });

    if ((item.limited_total_quantity || 0) > 0) {
      const stock = db.prepare('UPDATE shop_items SET sold_quantity = sold_quantity + 1 WHERE id = ? AND sold_quantity < limited_total_quantity').run(itemId);
      if (stock.changes === 0) throw new Error('SHOP_STOCK_RACE');
      shouldInvalidateCatalog = true;
    }

    if ((item.purchase_limit || 0) > 0) {
      db.prepare(`
        INSERT INTO shop_purchases (user_id, item_id, count) VALUES (?, ?, 1)
        ON CONFLICT(user_id, item_id) DO UPDATE SET count = count + 1
      `).run(userId, itemId);
    }

    return { ok: true, reason: 'OK' };
    })();
    if (result.ok && shouldInvalidateCatalog) invalidateActiveShopItemsCache();
    return { ...result, catalogChanged: result.ok && shouldInvalidateCatalog };
  } catch (err: any) {
    if (err?.message === 'SHOP_STOCK_RACE') return { ok: false, reason: 'SOLD_OUT' };
    throw err;
  }
};

// ---- 카드 슬롯 조회/설정 ----
const slotColumn = (type: 'border' | 'name_effect') => (type === 'border' ? 'border_item_id' : 'name_effect_item_id');

// ---- 장착 ----
export const equipCosmetic = async (userId: string, cardId: number, itemId: number): Promise<{ ok: boolean; reason: string }> => {
  const item = await getItem(itemId);
  if (!item) return { ok: false, reason: 'ITEM_NOT_FOUND' };
  if (item.type !== 'border' && item.type !== 'name_effect') return { ok: false, reason: 'ITEM_TYPE_MISMATCH' };
  const equipType: 'border' | 'name_effect' = item.type;

  if (getDbMode() === 'SUPABASE') {
    const { data: card, error: cardError } = await getSupabaseClient()
      .from('user_cards')
      .select('is_locked')
      .eq('id', cardId)
      .eq('user_id', userId)
      .maybeSingle();
    if (cardError) throw cardError;
    if (!card) return { ok: false, reason: 'CARD_NOT_FOUND' };
    if (card.is_locked) return { ok: false, reason: 'CARD_LOCKED' };
    const { data, error } = await getSupabaseClient().rpc('equip_cosmetic_atomic', {
      p_user_id: userId,
      p_card_id: cardId,
      p_item_id: itemId
    });
    if (error) {
      console.error('[Supabase] equip_cosmetic_atomic RPC 실패:', error.message);
      return { ok: false, reason: 'RPC_ERROR' };
    }
    const reason = String(data);
    return { ok: reason === 'OK', reason };
  }

  if (getDbMode() === 'MYSQL') {
    return getMysqlDb().transaction(async (tx) => {
      const col = slotColumn(equipType);
      const card = await tx.get(`SELECT ${col} AS current, COALESCE(is_locked, 0) AS is_locked FROM user_cards WHERE id = ? AND user_id = ? FOR UPDATE`, cardId, userId) as any;
      if (!card) return { ok: false, reason: 'CARD_NOT_FOUND' };
      if (Number(card.is_locked || 0) !== 0) return { ok: false, reason: 'CARD_LOCKED' };
      if (card.current === itemId) return { ok: true, reason: 'OK' };
      const owned = await tx.get('SELECT COALESCE(quantity, 0) AS q FROM user_cosmetics WHERE user_id = ? AND item_id = ? FOR UPDATE', userId, itemId) as any;
      if ((owned?.q || 0) < 1) return { ok: false, reason: 'NOT_OWNED' };
      if (card.current) {
        await tx.run(`
          INSERT INTO user_cosmetics (user_id, item_id, quantity) VALUES (?, ?, 1)
          ON DUPLICATE KEY UPDATE quantity = quantity + 1
        `, userId, card.current);
        await recordMysqlAssetEvent(tx, {
          userId,
          assetType: 'cosmetic',
          action: 'unequip',
          quantity: 1,
          sourceType: 'shop_equip',
          sourceId: cardId,
          reason: 'cosmetic_replace_return',
          description: '코스메틱 교체로 기존 장착품 반환',
          cardId,
          itemId: Number(card.current),
          itemType: item.type
        });
      }
      await tx.run('UPDATE user_cosmetics SET quantity = GREATEST(0, quantity - 1) WHERE user_id = ? AND item_id = ?', userId, itemId);
      await tx.run(`UPDATE user_cards SET ${col} = ? WHERE id = ? AND user_id = ?`, itemId, cardId, userId);
      await recordMysqlAssetEvent(tx, {
        userId,
        assetType: 'cosmetic',
        action: 'equip',
        quantity: 1,
        sourceType: 'shop_equip',
        sourceId: cardId,
        reason: 'cosmetic_equip',
        description: '카드 코스메틱 장착',
        cardId,
        itemId,
        itemType: item.type
      });
      return { ok: true, reason: 'OK' };
    });
  }

  const db = getSqliteDb();
  return db.transaction(() => {
    const col = slotColumn(equipType);
    const card = db.prepare(`SELECT ${col} AS current, COALESCE(is_locked, 0) AS is_locked FROM user_cards WHERE id = ? AND user_id = ?`)
      .get(cardId, userId) as any;
    if (!card) return { ok: false, reason: 'CARD_NOT_FOUND' };
    if (Number(card.is_locked || 0) !== 0) return { ok: false, reason: 'CARD_LOCKED' };
    if (card.current === itemId) return { ok: true, reason: 'OK' };

    const owned = db.prepare('SELECT COALESCE(quantity, 0) AS q FROM user_cosmetics WHERE user_id = ? AND item_id = ?')
      .get(userId, itemId) as any;
    if ((owned?.q || 0) < 1) return { ok: false, reason: 'NOT_OWNED' };

    if (card.current) {
      db.prepare(`
        INSERT INTO user_cosmetics (user_id, item_id, quantity) VALUES (?, ?, 1)
        ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + 1
      `).run(userId, card.current);
      recordSqliteAssetEvent(db, {
        userId,
        assetType: 'cosmetic',
        action: 'unequip',
        quantity: 1,
        sourceType: 'shop_equip',
        sourceId: cardId,
        reason: 'cosmetic_replace_return',
        description: '코스메틱 교체로 기존 장착품 반환',
        cardId,
        itemId: Number(card.current),
        itemType: item.type
      });
    }
    db.prepare('UPDATE user_cosmetics SET quantity = MAX(0, quantity - 1) WHERE user_id = ? AND item_id = ?')
      .run(userId, itemId);
    db.prepare(`UPDATE user_cards SET ${col} = ? WHERE id = ? AND user_id = ?`)
      .run(itemId, cardId, userId);
    recordSqliteAssetEvent(db, {
      userId,
      assetType: 'cosmetic',
      action: 'equip',
      quantity: 1,
      sourceType: 'shop_equip',
      sourceId: cardId,
      reason: 'cosmetic_equip',
      description: '카드 코스메틱 장착',
      cardId,
      itemId,
      itemType: item.type
    });
    return { ok: true, reason: 'OK' };
  })();
};

// ---- 해제 (보유로 반환) ----
export const unequipCosmetic = async (userId: string, cardId: number, type: 'border' | 'name_effect'): Promise<{ ok: boolean; reason: string }> => {
  if (getDbMode() === 'SUPABASE') {
    const { data: card, error: cardError } = await getSupabaseClient()
      .from('user_cards')
      .select('is_locked')
      .eq('id', cardId)
      .eq('user_id', userId)
      .maybeSingle();
    if (cardError) throw cardError;
    if (!card) return { ok: false, reason: 'CARD_NOT_FOUND' };
    if (card.is_locked) return { ok: false, reason: 'CARD_LOCKED' };
    const { data, error } = await getSupabaseClient().rpc('unequip_cosmetic_atomic', {
      p_user_id: userId,
      p_card_id: cardId,
      p_type: type
    });
    if (error) {
      console.error('[Supabase] unequip_cosmetic_atomic RPC 실패:', error.message);
      return { ok: false, reason: 'RPC_ERROR' };
    }
    const reason = String(data);
    return { ok: reason === 'OK', reason };
  }

  if (getDbMode() === 'MYSQL') {
    return getMysqlDb().transaction(async (tx) => {
      const col = slotColumn(type);
      const card = await tx.get(`SELECT ${col} AS current, COALESCE(is_locked, 0) AS is_locked FROM user_cards WHERE id = ? AND user_id = ? FOR UPDATE`, cardId, userId) as any;
      if (!card) return { ok: false, reason: 'CARD_NOT_FOUND' };
      if (Number(card.is_locked || 0) !== 0) return { ok: false, reason: 'CARD_LOCKED' };
      if (!card.current) return { ok: true, reason: 'OK' };
      await tx.run(`
        INSERT INTO user_cosmetics (user_id, item_id, quantity) VALUES (?, ?, 1)
        ON DUPLICATE KEY UPDATE quantity = quantity + 1
      `, userId, card.current);
      await tx.run(`UPDATE user_cards SET ${col} = NULL WHERE id = ? AND user_id = ?`, cardId, userId);
      await recordMysqlAssetEvent(tx, {
        userId,
        assetType: 'cosmetic',
        action: 'unequip',
        quantity: 1,
        sourceType: 'shop_unequip',
        sourceId: cardId,
        reason: 'cosmetic_unequip',
        description: '카드 코스메틱 해제 반환',
        cardId,
        itemId: Number(card.current),
        itemType: type
      });
      return { ok: true, reason: 'OK' };
    });
  }

  const db = getSqliteDb();
  return db.transaction(() => {
    const col = slotColumn(type);
    const card = db.prepare(`SELECT ${col} AS current, COALESCE(is_locked, 0) AS is_locked FROM user_cards WHERE id = ? AND user_id = ?`)
      .get(cardId, userId) as any;
    if (!card) return { ok: false, reason: 'CARD_NOT_FOUND' };
    if (Number(card.is_locked || 0) !== 0) return { ok: false, reason: 'CARD_LOCKED' };
    if (!card.current) return { ok: true, reason: 'OK' };

    db.prepare(`
      INSERT INTO user_cosmetics (user_id, item_id, quantity) VALUES (?, ?, 1)
      ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + 1
    `).run(userId, card.current);
    db.prepare(`UPDATE user_cards SET ${col} = NULL WHERE id = ? AND user_id = ?`).run(cardId, userId);
    recordSqliteAssetEvent(db, {
      userId,
      assetType: 'cosmetic',
      action: 'unequip',
      quantity: 1,
      sourceType: 'shop_unequip',
      sourceId: cardId,
      reason: 'cosmetic_unequip',
      description: '카드 코스메틱 해제 반환',
      cardId,
      itemId: Number(card.current),
      itemType: type
    });
    return { ok: true, reason: 'OK' };
  })();
};
