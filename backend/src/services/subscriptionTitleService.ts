import { getDbMode, getMysqlDb, getSqliteDb, getSupabaseClient } from './db';
import { getValidUserAccessToken } from './chzzkService';
import { titleRepository } from '../repositories';

export type SubscriptionTitleRule = {
  id: number;
  broadcaster_channel_id: string;
  broadcaster_name: string | null;
  title_id: number;
  active: boolean;
  created_at?: string;
  updated_at?: string;
  title_name?: string | null;
};

const DEFAULT_CHECK_TTL_MS = 6 * 60 * 60 * 1000;
const ERROR_RETRY_MS = 30 * 60 * 1000;
const SUBSCRIBER_PAGE_SIZE = 50;

const subscriberListCache = new Map<string, { expiresAt: number; subscribers: Set<string> }>();

const getCheckTtlMs = () => {
  const hours = Number(process.env.CHZZK_SUBSCRIPTION_CHECK_TTL_HOURS || 6);
  return Math.max(1, Math.min(72, Number.isFinite(hours) ? hours : 6)) * 60 * 60 * 1000;
};

const getSubscriberListCacheMs = () => {
  const seconds = Number(process.env.CHZZK_SUBSCRIBER_LIST_CACHE_SECONDS || 600);
  return Math.max(30, Math.min(3600, Number.isFinite(seconds) ? seconds : 600)) * 1000;
};

const getSubscriberListMaxPages = () => {
  const pages = Number(process.env.CHZZK_SUBSCRIBER_LIST_MAX_PAGES || 200);
  return Math.max(1, Math.min(1000, Number.isFinite(pages) ? Math.floor(pages) : 200));
};

const toMysqlDateTime = (date: Date) => date.toISOString().slice(0, 19).replace('T', ' ');

const mapRule = (row: any): SubscriptionTitleRule => ({
  id: Number(row.id),
  broadcaster_channel_id: String(row.broadcaster_channel_id),
  broadcaster_name: row.broadcaster_name ?? null,
  title_id: Number(row.title_id),
  active: row.active === true || row.active === 1,
  created_at: row.created_at,
  updated_at: row.updated_at,
  title_name: row.title_name ?? null
});

const subscriptionGrantSource = (ruleId: number) => `subscription:${ruleId}`;

const extractSubscriberRows = (payload: any): any[] => {
  const candidates = [
    payload?.content?.data,
    payload?.content?.subscribers,
    payload?.content,
    payload?.data,
    payload?.subscribers
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
};

const fetchSubscriberSet = async (
  accessToken: string,
  broadcasterChannelId: string
): Promise<{ ok: true; subscribers: Set<string> } | { ok: false; reason: string }> => {
  const cacheKey = broadcasterChannelId;
  const cached = subscriberListCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ok: true, subscribers: cached.subscribers };
  }

  const subscribers = new Set<string>();
  const maxPages = getSubscriberListMaxPages();

  for (let page = 0; page < maxPages; page++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const url = `https://openapi.chzzk.naver.com/open/v1/channels/subscribers?page=${page}&size=${SUBSCRIBER_PAGE_SIZE}&sort=RECENT`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chikapo-App/1.0',
          Accept: 'application/json'
        },
        signal: controller.signal
      });
      if (!res.ok) return { ok: false, reason: `HTTP_${res.status}` };

      const payload = await res.json();
      const rows = extractSubscriberRows(payload);
      for (const row of rows) {
        const channelId = row?.channelId || row?.channel_id || row?.subscriberChannelId || row?.userChannelId;
        if (channelId) subscribers.add(String(channelId));
      }

      if (rows.length < SUBSCRIBER_PAGE_SIZE) break;
    } catch (err: any) {
      return { ok: false, reason: err?.name === 'AbortError' ? 'TIMEOUT' : (err?.message || 'REQUEST_FAILED') };
    } finally {
      clearTimeout(timeout);
    }
  }

  subscriberListCache.set(cacheKey, {
    expiresAt: Date.now() + getSubscriberListCacheMs(),
    subscribers
  });
  return { ok: true, subscribers };
};

const verifyChzzkSubscription = async (
  accessToken: string,
  userId: string,
  broadcasterChannelId: string
): Promise<{ ok: true; subscribed: boolean } | { ok: false; reason: string }> => {
  const result = await fetchSubscriberSet(accessToken, broadcasterChannelId);
  if (!result.ok) return result;
  return { ok: true, subscribed: result.subscribers.has(userId) };
};

export const listSubscriptionTitleRules = async (): Promise<SubscriptionTitleRule[]> => {
  const mode = getDbMode();
  if (mode === 'MYSQL') {
    const rows = await getMysqlDb().all(`
      SELECT r.*, t.name AS title_name
        FROM subscription_title_rules r
        LEFT JOIN titles t ON t.id = r.title_id
       ORDER BY r.active DESC, r.id DESC
    `);
    return rows.map(mapRule);
  }
  if (mode === 'SUPABASE') {
    const { data, error } = await getSupabaseClient()
      .from('subscription_title_rules')
      .select('*, title:titles(name)')
      .order('active', { ascending: false })
      .order('id', { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => mapRule({ ...row, title_name: row.title?.name ?? null }));
  }
  const rows = getSqliteDb().prepare(`
    SELECT r.*, t.name AS title_name
      FROM subscription_title_rules r
      LEFT JOIN titles t ON t.id = r.title_id
     ORDER BY r.active DESC, r.id DESC
  `).all() as any[];
  return rows.map(mapRule);
};

export const saveSubscriptionTitleRule = async (input: {
  id?: number;
  broadcaster_channel_id: string;
  broadcaster_name?: string | null;
  title_id: number;
  active: boolean;
}): Promise<SubscriptionTitleRule> => {
  const broadcasterChannelId = input.broadcaster_channel_id.trim();
  const broadcasterName = input.broadcaster_name?.trim() || null;
  const titleId = Number(input.title_id);
  if (!broadcasterChannelId || broadcasterChannelId.length > 191) throw new Error('치지직 채널 ID를 입력해 주세요.');
  if (!Number.isInteger(titleId) || titleId <= 0) throw new Error('칭호를 선택해 주세요.');
  if (!(await titleRepository.findById(titleId))) throw new Error('존재하지 않는 칭호입니다.');

  const mode = getDbMode();
  const previousRule = input.id ? (await getSubscriptionTitleRuleById(input.id)) : null;
  if (mode === 'MYSQL') {
    if (input.id) {
      await getMysqlDb().run(
        `UPDATE subscription_title_rules
            SET broadcaster_channel_id = ?, broadcaster_name = ?, title_id = ?, active = ?, updated_at = UTC_TIMESTAMP()
          WHERE id = ?`,
        broadcasterChannelId, broadcasterName, titleId, input.active ? 1 : 0, input.id
      );
      const row = await getMysqlDb().get('SELECT * FROM subscription_title_rules WHERE id = ?', input.id);
      const nextRule = mapRule(row);
      await cleanupStaleSubscriptionRuleGrant(previousRule, nextRule);
      return nextRule;
    }
    const result = await getMysqlDb().run(
      `INSERT INTO subscription_title_rules (broadcaster_channel_id, broadcaster_name, title_id, active)
       VALUES (?, ?, ?, ?)`,
      broadcasterChannelId, broadcasterName, titleId, input.active ? 1 : 0
    );
    const row = await getMysqlDb().get('SELECT * FROM subscription_title_rules WHERE id = ?', result.insertId);
    return mapRule(row);
  }

  if (mode === 'SUPABASE') {
    const payload = { broadcaster_channel_id: broadcasterChannelId, broadcaster_name: broadcasterName, title_id: titleId, active: input.active };
    const query = input.id
      ? getSupabaseClient().from('subscription_title_rules').update(payload).eq('id', input.id)
      : getSupabaseClient().from('subscription_title_rules').insert(payload);
    const { data, error } = await query.select('*').single();
    if (error) throw error;
    const nextRule = mapRule(data);
    await cleanupStaleSubscriptionRuleGrant(previousRule, nextRule);
    return nextRule;
  }

  if (input.id) {
    getSqliteDb().prepare(
      `UPDATE subscription_title_rules
          SET broadcaster_channel_id = ?, broadcaster_name = ?, title_id = ?, active = ?, updated_at = datetime('now')
        WHERE id = ?`
    ).run(broadcasterChannelId, broadcasterName, titleId, input.active ? 1 : 0, input.id);
    const nextRule = mapRule(getSqliteDb().prepare('SELECT * FROM subscription_title_rules WHERE id = ?').get(input.id));
    await cleanupStaleSubscriptionRuleGrant(previousRule, nextRule);
    return nextRule;
  }
  const result = getSqliteDb().prepare(
    `INSERT INTO subscription_title_rules (broadcaster_channel_id, broadcaster_name, title_id, active)
     VALUES (?, ?, ?, ?)`
  ).run(broadcasterChannelId, broadcasterName, titleId, input.active ? 1 : 0);
  return mapRule(getSqliteDb().prepare('SELECT * FROM subscription_title_rules WHERE id = ?').get(result.lastInsertRowid));
};

export const deleteSubscriptionTitleRule = async (id: number): Promise<void> => {
  if (!Number.isInteger(id) || id <= 0) throw new Error('규칙 ID가 올바르지 않습니다.');
  const mode = getDbMode();
  const previousRule = await getSubscriptionTitleRuleById(id);
  if (previousRule) {
    await deleteSubscriptionGrantsForRule(previousRule.id, previousRule.title_id);
    await deleteSubscriptionStatesForRule(previousRule.id);
  }
  if (mode === 'MYSQL') await getMysqlDb().run('DELETE FROM subscription_title_rules WHERE id = ?', id);
  else if (mode === 'SUPABASE') {
    const { error } = await getSupabaseClient().from('subscription_title_rules').delete().eq('id', id);
    if (error) throw error;
  } else getSqliteDb().prepare('DELETE FROM subscription_title_rules WHERE id = ?').run(id);
};

const getState = async (userId: string, ruleId: number): Promise<any | null> => {
  const mode = getDbMode();
  if (mode === 'MYSQL') return getMysqlDb().get('SELECT * FROM subscription_title_states WHERE user_id = ? AND rule_id = ?', userId, ruleId);
  if (mode === 'SUPABASE') {
    const { data } = await getSupabaseClient().from('subscription_title_states').select('*').eq('user_id', userId).eq('rule_id', ruleId).maybeSingle();
    return data || null;
  }
  return getSqliteDb().prepare('SELECT * FROM subscription_title_states WHERE user_id = ? AND rule_id = ?').get(userId, ruleId);
};

const upsertState = async (userId: string, ruleId: number, subscribed: boolean, checkedUntil: Date, errorMessage: string | null) => {
  const mode = getDbMode();
  if (mode === 'MYSQL') {
    await getMysqlDb().run(
      `INSERT INTO subscription_title_states (user_id, rule_id, is_subscribed, checked_at, checked_until, last_error)
       VALUES (?, ?, ?, UTC_TIMESTAMP(), ?, ?)
       ON DUPLICATE KEY UPDATE
         is_subscribed = VALUES(is_subscribed),
         checked_at = UTC_TIMESTAMP(),
         checked_until = VALUES(checked_until),
         last_error = VALUES(last_error)`,
      userId, ruleId, subscribed ? 1 : 0, toMysqlDateTime(checkedUntil), errorMessage
    );
    return;
  }
  if (mode === 'SUPABASE') {
    const { error } = await getSupabaseClient().from('subscription_title_states').upsert({
      user_id: userId,
      rule_id: ruleId,
      is_subscribed: subscribed,
      checked_at: new Date().toISOString(),
      checked_until: checkedUntil.toISOString(),
      last_error: errorMessage
    }, { onConflict: 'user_id,rule_id' });
    if (error) throw error;
    return;
  }
  getSqliteDb().prepare(
    `INSERT INTO subscription_title_states (user_id, rule_id, is_subscribed, checked_at, checked_until, last_error)
     VALUES (?, ?, ?, datetime('now'), ?, ?)
     ON CONFLICT(user_id, rule_id) DO UPDATE SET
       is_subscribed = excluded.is_subscribed,
       checked_at = datetime('now'),
       checked_until = excluded.checked_until,
       last_error = excluded.last_error`
  ).run(userId, ruleId, subscribed ? 1 : 0, checkedUntil.toISOString(), errorMessage);
};

const getSubscriptionTitleRuleById = async (id: number): Promise<SubscriptionTitleRule | null> => {
  if (!Number.isInteger(id) || id <= 0) return null;
  const mode = getDbMode();
  if (mode === 'MYSQL') {
    const row = await getMysqlDb().get('SELECT * FROM subscription_title_rules WHERE id = ?', id);
    return row ? mapRule(row) : null;
  }
  if (mode === 'SUPABASE') {
    const { data, error } = await getSupabaseClient().from('subscription_title_rules').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? mapRule(data) : null;
  }
  const row = getSqliteDb().prepare('SELECT * FROM subscription_title_rules WHERE id = ?').get(id);
  return row ? mapRule(row) : null;
};

const awardSubscriptionTitle = async (userId: string, ruleId: number, titleId: number): Promise<void> => {
  const mode = getDbMode();
  const source = subscriptionGrantSource(ruleId);
  if (mode === 'MYSQL') {
    await getMysqlDb().run(
      `INSERT IGNORE INTO user_titles (user_id, title_id, grant_source)
       VALUES (?, ?, ?)`,
      userId, titleId, source
    );
    return;
  }
  if (mode === 'SUPABASE') {
    const { error } = await getSupabaseClient()
      .from('user_titles')
      .upsert({ user_id: userId, title_id: titleId, grant_source: source }, { onConflict: 'user_id,title_id', ignoreDuplicates: true });
    if (error) throw error;
    return;
  }
  getSqliteDb().prepare(
    `INSERT INTO user_titles (user_id, title_id, grant_source)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, title_id) DO NOTHING`
  ).run(userId, titleId, source);
};

const revokeSubscriptionTitle = async (userId: string, ruleId: number, titleId: number): Promise<void> => {
  const mode = getDbMode();
  const source = subscriptionGrantSource(ruleId);
  if (mode === 'MYSQL') {
    await getMysqlDb().run('DELETE FROM user_titles WHERE user_id = ? AND title_id = ? AND grant_source = ?', userId, titleId, source);
    return;
  }
  if (mode === 'SUPABASE') {
    const { error } = await getSupabaseClient()
      .from('user_titles')
      .delete()
      .eq('user_id', userId)
      .eq('title_id', titleId)
      .eq('grant_source', source);
    if (error) throw error;
    return;
  }
  getSqliteDb().prepare('DELETE FROM user_titles WHERE user_id = ? AND title_id = ? AND grant_source = ?').run(userId, titleId, source);
};

const deleteSubscriptionGrantsForRule = async (ruleId: number, titleId: number): Promise<void> => {
  const mode = getDbMode();
  const source = subscriptionGrantSource(ruleId);
  if (mode === 'MYSQL') {
    await getMysqlDb().run('DELETE FROM user_titles WHERE title_id = ? AND grant_source = ?', titleId, source);
    return;
  }
  if (mode === 'SUPABASE') {
    const { error } = await getSupabaseClient()
      .from('user_titles')
      .delete()
      .eq('title_id', titleId)
      .eq('grant_source', source);
    if (error) throw error;
    return;
  }
  getSqliteDb().prepare('DELETE FROM user_titles WHERE title_id = ? AND grant_source = ?').run(titleId, source);
};

const deleteSubscriptionStatesForRule = async (ruleId: number): Promise<void> => {
  const mode = getDbMode();
  if (mode === 'MYSQL') {
    await getMysqlDb().run('DELETE FROM subscription_title_states WHERE rule_id = ?', ruleId);
    return;
  }
  if (mode === 'SUPABASE') {
    const { error } = await getSupabaseClient().from('subscription_title_states').delete().eq('rule_id', ruleId);
    if (error) throw error;
    return;
  }
  getSqliteDb().prepare('DELETE FROM subscription_title_states WHERE rule_id = ?').run(ruleId);
};

const cleanupStaleSubscriptionRuleGrant = async (
  previousRule: SubscriptionTitleRule | null,
  nextRule: SubscriptionTitleRule
): Promise<void> => {
  if (!previousRule) return;
  const shouldReset =
    !nextRule.active ||
    previousRule.title_id !== nextRule.title_id ||
    previousRule.broadcaster_channel_id !== nextRule.broadcaster_channel_id;
  if (!shouldReset) return;
  await deleteSubscriptionGrantsForRule(previousRule.id, previousRule.title_id);
  await deleteSubscriptionStatesForRule(previousRule.id);
};

export const syncUserSubscriptionTitles = async (userId: string, force = false): Promise<void> => {
  let rules: SubscriptionTitleRule[] = [];
  try {
    rules = (await listSubscriptionTitleRules()).filter((rule) => rule.active);
  } catch (err: any) {
    console.warn('[SubscriptionTitle] 구독 칭호 규칙 조회 실패:', err?.message || err);
    return;
  }
  if (rules.length === 0) return;
  const now = Date.now();

  for (const rule of rules) {
    const state = await getState(userId, rule.id);
    const checkedUntilMs = state?.checked_until ? new Date(state.checked_until).getTime() : 0;
    if (!force && checkedUntilMs > now) continue;

    const accessToken = await getValidUserAccessToken(rule.broadcaster_channel_id);
    if (!accessToken) {
      await upsertState(userId, rule.id, false, new Date(now + ERROR_RETRY_MS), 'NO_BROADCASTER_ACCESS_TOKEN');
      await revokeSubscriptionTitle(userId, rule.id, rule.title_id);
      continue;
    }

    const result = await verifyChzzkSubscription(accessToken, userId, rule.broadcaster_channel_id);
    if (!result.ok) {
      const previousSubscribed = state?.is_subscribed === true || state?.is_subscribed === 1;
      await upsertState(userId, rule.id, previousSubscribed, new Date(now + ERROR_RETRY_MS), result.reason);
      continue;
    }

    await upsertState(userId, rule.id, result.subscribed, new Date(now + (getCheckTtlMs() || DEFAULT_CHECK_TTL_MS)), null);
    if (result.subscribed) await awardSubscriptionTitle(userId, rule.id, rule.title_id);
    else await revokeSubscriptionTitle(userId, rule.id, rule.title_id);
  }
};
