import { getDbMode, getMysqlDb, getSqliteDb, getSupabaseClient } from './db';
import { normalizeImageBlindKey } from '../utils/imageBlindKey';

export interface UserImageBlind {
  image_key: string;
  image_url: string | null;
  created_at?: string | null;
}

const MAX_BLINDS_PER_USER = Math.max(50, Math.min(2000, Number(process.env.USER_IMAGE_BLIND_MAX_PER_USER || 500)));

export const listUserImageBlinds = async (userId: string): Promise<UserImageBlind[]> => {
  const mode = getDbMode();
  if (mode === 'MYSQL') {
    return getMysqlDb().all<UserImageBlind>(
      'SELECT image_key, image_url, created_at FROM user_image_blinds WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
      userId,
      MAX_BLINDS_PER_USER
    );
  }
  if (mode === 'SUPABASE') {
    const { data, error } = await getSupabaseClient()
      .from('user_image_blinds')
      .select('image_key, image_url, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(MAX_BLINDS_PER_USER);
    if (error) throw error;
    return data || [];
  }
  return getSqliteDb()
    .prepare('SELECT image_key, image_url, created_at FROM user_image_blinds WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, MAX_BLINDS_PER_USER) as UserImageBlind[];
};

export const addUserImageBlind = async (userId: string, imageUrl: string): Promise<UserImageBlind> => {
  const imageKey = normalizeImageBlindKey(imageUrl);
  if (!imageKey) throw new Error('INVALID_IMAGE_URL');

  const mode = getDbMode();
  if (mode === 'MYSQL') {
    const existing = await getMysqlDb().get<UserImageBlind>(
      'SELECT image_key, image_url, created_at FROM user_image_blinds WHERE user_id = ? AND image_key = ?',
      userId,
      imageKey
    );
    const countRow = await getMysqlDb().get<{ count: number }>('SELECT COUNT(*) AS count FROM user_image_blinds WHERE user_id = ?', userId);
    if (!existing && Number(countRow?.count || 0) >= MAX_BLINDS_PER_USER) throw new Error('BLIND_LIMIT_EXCEEDED');
    await getMysqlDb().run(
      `INSERT INTO user_image_blinds (user_id, image_key, image_url, created_at)
       VALUES (?, ?, ?, UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE image_url = VALUES(image_url), created_at = UTC_TIMESTAMP()`,
      userId,
      imageKey,
      imageUrl
    );
    return { image_key: imageKey, image_url: imageUrl };
  }
  if (mode === 'SUPABASE') {
    const { data: existing } = await getSupabaseClient()
      .from('user_image_blinds')
      .select('image_key')
      .eq('user_id', userId)
      .eq('image_key', imageKey)
      .maybeSingle();
    const { count } = await getSupabaseClient()
      .from('user_image_blinds')
      .select('image_key', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (!existing && Number(count || 0) >= MAX_BLINDS_PER_USER) throw new Error('BLIND_LIMIT_EXCEEDED');
    const { error } = await getSupabaseClient()
      .from('user_image_blinds')
      .upsert({ user_id: userId, image_key: imageKey, image_url: imageUrl, created_at: new Date().toISOString() }, { onConflict: 'user_id,image_key' });
    if (error) throw error;
    return { image_key: imageKey, image_url: imageUrl };
  }

  const db = getSqliteDb();
  const existing = db.prepare('SELECT image_key FROM user_image_blinds WHERE user_id = ? AND image_key = ?').get(userId, imageKey) as any;
  const countRow = db.prepare('SELECT COUNT(*) AS count FROM user_image_blinds WHERE user_id = ?').get(userId) as any;
  if (!existing && Number(countRow?.count || 0) >= MAX_BLINDS_PER_USER) throw new Error('BLIND_LIMIT_EXCEEDED');
  db.prepare(
    `INSERT INTO user_image_blinds (user_id, image_key, image_url, created_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, image_key) DO UPDATE SET image_url = excluded.image_url, created_at = datetime('now')`
  ).run(userId, imageKey, imageUrl);
  return { image_key: imageKey, image_url: imageUrl };
};

const findEquivalentImageBlindKeys = async (userId: string, imageKey: string): Promise<string[]> => {
  const items = await listUserImageBlinds(userId);
  const keys = new Set<string>();
  for (const item of items) {
    const storedKey = String(item.image_key || '').trim();
    const storedUrlKey = normalizeImageBlindKey(item.image_url);
    const normalizedStoredKey = normalizeImageBlindKey(storedKey);
    if (storedKey === imageKey || normalizedStoredKey === imageKey || storedUrlKey === imageKey) {
      keys.add(storedKey || imageKey);
    }
  }
  return Array.from(keys).filter(Boolean);
};

export const removeUserImageBlind = async (userId: string, imageKeyOrUrl: string): Promise<boolean> => {
  const imageKey = normalizeImageBlindKey(imageKeyOrUrl);
  if (!imageKey) return false;

  const mode = getDbMode();
  if (mode === 'MYSQL') {
    const result = await getMysqlDb().run('DELETE FROM user_image_blinds WHERE user_id = ? AND image_key = ?', userId, imageKey);
    if (result.changes > 0) return true;
    const equivalentKeys = await findEquivalentImageBlindKeys(userId, imageKey);
    for (const key of equivalentKeys) {
      const fallback = await getMysqlDb().run('DELETE FROM user_image_blinds WHERE user_id = ? AND image_key = ?', userId, key);
      if (fallback.changes > 0) return true;
    }
    return false;
  }
  if (mode === 'SUPABASE') {
    const { data, error } = await getSupabaseClient()
      .from('user_image_blinds')
      .delete()
      .eq('user_id', userId)
      .eq('image_key', imageKey)
      .select('image_key');
    if (error) throw error;
    if ((data || []).length > 0) return true;
    const equivalentKeys = await findEquivalentImageBlindKeys(userId, imageKey);
    for (const key of equivalentKeys) {
      const { data: fallbackData, error: fallbackError } = await getSupabaseClient()
        .from('user_image_blinds')
        .delete()
        .eq('user_id', userId)
        .eq('image_key', key)
        .select('image_key');
      if (fallbackError) throw fallbackError;
      if ((fallbackData || []).length > 0) return true;
    }
    return false;
  }
  const result = getSqliteDb().prepare('DELETE FROM user_image_blinds WHERE user_id = ? AND image_key = ?').run(userId, imageKey);
  if (result.changes > 0) return true;
  const equivalentKeys = await findEquivalentImageBlindKeys(userId, imageKey);
  for (const key of equivalentKeys) {
    const fallback = getSqliteDb().prepare('DELETE FROM user_image_blinds WHERE user_id = ? AND image_key = ?').run(userId, key);
    if (fallback.changes > 0) return true;
  }
  return false;
};
