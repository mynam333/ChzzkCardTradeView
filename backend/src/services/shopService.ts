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
}

const mapSqliteItem = (r: any): ShopItem => ({
  id: r.id, type: r.type, name: r.name, description: r.description,
  price: r.price, style_json: r.style_json, font_url: r.font_url,
  font_family: r.font_family, active: r.active === 1
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
  if (getDbMode() === 'SUPABASE') {
    await getSupabaseClient().from('shop_items').insert([{
      type: item.type, name: item.name, description: item.description ?? null, price: item.price,
      style_json: item.style_json ?? null, font_url: item.font_url ?? null, font_family: item.font_family ?? null, active
    }]);
  } else {
    getSqliteDb().prepare(
      'INSERT INTO shop_items (type, name, description, price, style_json, font_url, font_family, active) VALUES (?,?,?,?,?,?,?,?)'
    ).run(item.type, item.name, item.description ?? null, item.price, item.style_json ?? null, item.font_url ?? null, item.font_family ?? null, active ? 1 : 0);
  }
};

export const updateItem = async (id: number, item: Partial<ShopItem>): Promise<void> => {
  if (getDbMode() === 'SUPABASE') {
    const payload: any = {};
    for (const k of ['type', 'name', 'description', 'price', 'style_json', 'font_url', 'font_family', 'active'] as const) {
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
      active: item.active !== undefined ? (item.active ? 1 : 0) : cur.active
    };
    getSqliteDb().prepare(
      'UPDATE shop_items SET type=?, name=?, description=?, price=?, style_json=?, font_url=?, font_family=?, active=? WHERE id=?'
    ).run(merged.type, merged.name, merged.description, merged.price, merged.style_json, merged.font_url, merged.font_family, merged.active, id);
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
    const { data } = await getSupabaseClient().from('user_cosmetics').select('quantity').eq('user_id', userId).eq('item_id', itemId).maybeSingle();
    return data?.quantity || 0;
  }
  const r = getSqliteDb().prepare('SELECT quantity FROM user_cosmetics WHERE user_id = ? AND item_id = ?').get(userId, itemId) as any;
  return r?.quantity || 0;
};

// ---- 구매 ----
export const buyItem = async (userId: string, itemId: number): Promise<{ ok: boolean; reason: string }> => {
  const item = await getItem(itemId);
  if (!item || !item.active) return { ok: false, reason: 'NOT_FOUND' };
  const paid = await userRepository.tryDeductPoint(userId, item.price);
  if (!paid) return { ok: false, reason: 'INSUFFICIENT_POINT' };
  await addCosmetic(userId, itemId, 1);
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
