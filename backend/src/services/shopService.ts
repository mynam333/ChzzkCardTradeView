/**
 * shopService.ts - 상점(코스메틱) 데이터 액세스. SQLite/Supabase 양 모드를 인라인 처리합니다.
 * 코스메틱: 'border'(테두리) | 'name_effect'(이름 이펙트). 카드당 각 1개 장착, 해제 시 보유로 반환.
 */
import { getDbMode, getSqliteDb, getSupabaseClient } from './db';
import { userRepository } from '../repositories';

export interface ShopItem {
  id: number;
  type: 'border' | 'name_effect';
  name: string;
  description: string | null;
  price: number;
  style_json: string | null;
  font_url: string | null;
  font_family: string | null;
  active: boolean;
  purchase_limit: number; // 1인 최대 구매 갯수 (0 = 무제한)
}

const mapSqliteItem = (r: any): ShopItem => ({
  id: r.id, type: r.type, name: r.name, description: r.description,
  price: r.price, style_json: r.style_json, font_url: r.font_url,
  font_family: r.font_family, active: r.active === 1,
  purchase_limit: r.purchase_limit ?? 0
});

// ---- 아이템 카탈로그 ----
export const getActiveItems = async (): Promise<ShopItem[]> => {
  if (getDbMode() === 'SUPABASE') {
    const { data } = await getSupabaseClient().from('shop_items').select('*').eq('active', true).order('id', { ascending: true });
    return (data || []) as ShopItem[];
  }
  return getSqliteDb().prepare('SELECT * FROM shop_items WHERE active = 1 ORDER BY id ASC').all().map(mapSqliteItem);
};

export const getAllItems = async (): Promise<ShopItem[]> => {
  if (getDbMode() === 'SUPABASE') {
    const { data } = await getSupabaseClient().from('shop_items').select('*').order('id', { ascending: false });
    return (data || []) as ShopItem[];
  }
  return getSqliteDb().prepare('SELECT * FROM shop_items ORDER BY id DESC').all().map(mapSqliteItem);
};

export const getItem = async (id: number): Promise<ShopItem | null> => {
  if (getDbMode() === 'SUPABASE') {
    const { data } = await getSupabaseClient().from('shop_items').select('*').eq('id', id).maybeSingle();
    return (data as ShopItem) || null;
  }
  const r = getSqliteDb().prepare('SELECT * FROM shop_items WHERE id = ?').get(id);
  return r ? mapSqliteItem(r) : null;
};

export const createItem = async (item: Omit<ShopItem, 'id' | 'active'> & { active?: boolean }): Promise<void> => {
  const active = item.active !== false;
  const limit = Math.max(0, Math.floor(Number(item.purchase_limit) || 0));
  if (getDbMode() === 'SUPABASE') {
    await getSupabaseClient().from('shop_items').insert([{
      type: item.type, name: item.name, description: item.description ?? null, price: item.price,
      style_json: item.style_json ?? null, font_url: item.font_url ?? null, font_family: item.font_family ?? null, active, purchase_limit: limit
    }]);
  } else {
    getSqliteDb().prepare(
      'INSERT INTO shop_items (type, name, description, price, style_json, font_url, font_family, active, purchase_limit) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(item.type, item.name, item.description ?? null, item.price, item.style_json ?? null, item.font_url ?? null, item.font_family ?? null, active ? 1 : 0, limit);
  }
};

export const updateItem = async (id: number, item: Partial<ShopItem>): Promise<void> => {
  if (getDbMode() === 'SUPABASE') {
    const payload: any = {};
    for (const k of ['type', 'name', 'description', 'price', 'style_json', 'font_url', 'font_family', 'active', 'purchase_limit'] as const) {
      if (item[k] !== undefined) payload[k] = item[k];
    }
    await getSupabaseClient().from('shop_items').update(payload).eq('id', id);
  } else {
    const cur = getSqliteDb().prepare('SELECT * FROM shop_items WHERE id = ?').get(id) as any;
    if (!cur) return;
    const merged = {
      type: item.type ?? cur.type, name: item.name ?? cur.name, description: item.description ?? cur.description,
      price: item.price ?? cur.price, style_json: item.style_json ?? cur.style_json,
      font_url: item.font_url ?? cur.font_url, font_family: item.font_family ?? cur.font_family,
      active: item.active !== undefined ? (item.active ? 1 : 0) : cur.active,
      purchase_limit: item.purchase_limit !== undefined ? Math.max(0, Math.floor(Number(item.purchase_limit) || 0)) : (cur.purchase_limit ?? 0)
    };
    getSqliteDb().prepare(
      'UPDATE shop_items SET type=?, name=?, description=?, price=?, style_json=?, font_url=?, font_family=?, active=?, purchase_limit=? WHERE id=?'
    ).run(merged.type, merged.name, merged.description, merged.price, merged.style_json, merged.font_url, merged.font_family, merged.active, merged.purchase_limit, id);
  }
};

// ---- 보유 코스메틱 ----
export const getUserCosmetics = async (userId: string): Promise<(ShopItem & { quantity: number })[]> => {
  if (getDbMode() === 'SUPABASE') {
    const { data } = await getSupabaseClient()
      .from('user_cosmetics')
      .select('quantity, item:shop_items(*)')
      .eq('user_id', userId)
      .gt('quantity', 0);
    return (data || []).map((r: any) => ({ ...(r.item), quantity: r.quantity }));
  }
  const rows = getSqliteDb().prepare(`
    SELECT uc.quantity, si.* FROM user_cosmetics uc
    JOIN shop_items si ON uc.item_id = si.id
    WHERE uc.user_id = ? AND uc.quantity > 0
  `).all(userId) as any[];
  return rows.map((r) => ({ ...mapSqliteItem(r), quantity: r.quantity }));
};

const addCosmetic = async (userId: string, itemId: number, delta: number): Promise<void> => {
  if (getDbMode() === 'SUPABASE') {
    const client = getSupabaseClient();
    const { data } = await client.from('user_cosmetics').select('quantity').eq('user_id', userId).eq('item_id', itemId).maybeSingle();
    const next = Math.max(0, (data?.quantity || 0) + delta);
    await client.from('user_cosmetics').upsert({ user_id: userId, item_id: itemId, quantity: next }, { onConflict: 'user_id,item_id' });
  } else {
    getSqliteDb().prepare(`
      INSERT INTO user_cosmetics (user_id, item_id, quantity) VALUES (?, ?, ?)
      ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = MAX(0, quantity + ?)
    `).run(userId, itemId, Math.max(0, delta), delta);
  }
};

const getCosmeticQuantity = async (userId: string, itemId: number): Promise<number> => {
  if (getDbMode() === 'SUPABASE') {
    // maybeSingle은 중복 행이 있으면 null을 반환할 수 있어, 전체 합산으로 안전하게 계산
    const { data } = await getSupabaseClient().from('user_cosmetics').select('quantity').eq('user_id', userId).eq('item_id', itemId);
    return (data || []).reduce((s: number, r: any) => s + (r.quantity || 0), 0);
  }
  const r = getSqliteDb().prepare('SELECT COALESCE(SUM(quantity),0) AS q FROM user_cosmetics WHERE user_id = ? AND item_id = ?').get(userId, itemId) as any;
  return r?.q || 0;
};

// ---- 구매 횟수(1인 최대 구매 제한용) ----
const getPurchaseCount = async (userId: string, itemId: number): Promise<number> => {
  if (getDbMode() === 'SUPABASE') {
    const { data } = await getSupabaseClient().from('shop_purchases').select('count').eq('user_id', userId).eq('item_id', itemId);
    return (data || []).reduce((s: number, r: any) => s + (r.count || 0), 0);
  }
  const r = getSqliteDb().prepare('SELECT COALESCE(SUM(count),0) AS c FROM shop_purchases WHERE user_id = ? AND item_id = ?').get(userId, itemId) as any;
  return r?.c || 0;
};

const incrementPurchase = async (userId: string, itemId: number): Promise<void> => {
  if (getDbMode() === 'SUPABASE') {
    const client = getSupabaseClient();
    const { data } = await client.from('shop_purchases').select('count').eq('user_id', userId).eq('item_id', itemId).maybeSingle();
    await client.from('shop_purchases').upsert({ user_id: userId, item_id: itemId, count: (data?.count || 0) + 1 }, { onConflict: 'user_id,item_id' });
  } else {
    getSqliteDb().prepare(`
      INSERT INTO shop_purchases (user_id, item_id, count) VALUES (?, ?, 1)
      ON CONFLICT(user_id, item_id) DO UPDATE SET count = count + 1
    `).run(userId, itemId);
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
  const rows = getSqliteDb().prepare('SELECT item_id, count FROM shop_purchases WHERE user_id = ?').all(userId) as any[];
  for (const r of rows) map[r.item_id] = (map[r.item_id] || 0) + (r.count || 0);
  return map;
};

/** 특정 아이템의 모든 구매 횟수 초기화 (관리자) */
export const resetPurchases = async (itemId: number): Promise<void> => {
  if (getDbMode() === 'SUPABASE') {
    await getSupabaseClient().from('shop_purchases').delete().eq('item_id', itemId);
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
export const buyItem = async (userId: string, itemId: number): Promise<{ ok: boolean; reason: string }> => {
  const item = await getItem(itemId);
  if (!item || !item.active) return { ok: false, reason: 'NOT_FOUND' };
  // 1인 최대 구매 제한 확인
  if (item.purchase_limit && item.purchase_limit > 0) {
    const bought = await getPurchaseCount(userId, itemId);
    if (bought >= item.purchase_limit) return { ok: false, reason: 'LIMIT_REACHED' };
  }
  const paid = await userRepository.tryDeductPoint(userId, item.price);
  if (!paid) return { ok: false, reason: 'INSUFFICIENT_POINT' };
  await addCosmetic(userId, itemId, 1);
  if (item.purchase_limit && item.purchase_limit > 0) await incrementPurchase(userId, itemId);
  return { ok: true, reason: 'OK' };
};

// ---- 카드 슬롯 조회/설정 ----
const slotColumn = (type: 'border' | 'name_effect') => (type === 'border' ? 'border_item_id' : 'name_effect_item_id');

const getCardOwnerAndSlot = async (userId: string, cardId: number, type: 'border' | 'name_effect'): Promise<{ exists: boolean; current: number | null }> => {
  const col = slotColumn(type);
  if (getDbMode() === 'SUPABASE') {
    const { data } = await getSupabaseClient().from('user_cards').select(`id, ${col}`).eq('id', cardId).eq('user_id', userId).maybeSingle();
    if (!data) return { exists: false, current: null };
    return { exists: true, current: (data as any)[col] ?? null };
  }
  const r = getSqliteDb().prepare(`SELECT ${col} as cur FROM user_cards WHERE id = ? AND user_id = ?`).get(cardId, userId) as any;
  if (!r) return { exists: false, current: null };
  return { exists: true, current: r.cur ?? null };
};

const setCardSlot = async (cardId: number, type: 'border' | 'name_effect', itemId: number | null): Promise<void> => {
  const col = slotColumn(type);
  if (getDbMode() === 'SUPABASE') {
    await getSupabaseClient().from('user_cards').update({ [col]: itemId }).eq('id', cardId);
  } else {
    getSqliteDb().prepare(`UPDATE user_cards SET ${col} = ? WHERE id = ?`).run(itemId, cardId);
  }
};

// ---- 장착 ----
export const equipCosmetic = async (userId: string, cardId: number, itemId: number): Promise<{ ok: boolean; reason: string }> => {
  const item = await getItem(itemId);
  if (!item) return { ok: false, reason: 'ITEM_NOT_FOUND' };
  const type = item.type;
  const { exists, current } = await getCardOwnerAndSlot(userId, cardId, type);
  if (!exists) return { ok: false, reason: 'CARD_NOT_FOUND' };
  if (current === itemId) return { ok: true, reason: 'OK' }; // 이미 장착됨
  if ((await getCosmeticQuantity(userId, itemId)) < 1) return { ok: false, reason: 'NOT_OWNED' };

  // 기존 장착품은 보유로 반환
  if (current) await addCosmetic(userId, current, 1);
  await addCosmetic(userId, itemId, -1);
  await setCardSlot(cardId, type, itemId);
  return { ok: true, reason: 'OK' };
};

// ---- 해제 (보유로 반환) ----
export const unequipCosmetic = async (userId: string, cardId: number, type: 'border' | 'name_effect'): Promise<{ ok: boolean; reason: string }> => {
  const { exists, current } = await getCardOwnerAndSlot(userId, cardId, type);
  if (!exists) return { ok: false, reason: 'CARD_NOT_FOUND' };
  if (!current) return { ok: true, reason: 'OK' };
  await addCosmetic(userId, current, 1);
  await setCardSlot(cardId, type, null);
  return { ok: true, reason: 'OK' };
};
