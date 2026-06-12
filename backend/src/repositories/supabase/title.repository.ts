import { getSupabaseClient } from '../../services/db';
import { ITitleRepository, UserTitle } from '../interfaces';

export class SupabaseTitleRepository implements ITitleRepository {
  private getClient() {
    return getSupabaseClient();
  }

  private async filterVisibleSubscriptionTitleRows<T extends { user_id: string; title: any; awarded_at: string; is_equipped: boolean }>(rows: T[]): Promise<T[]> {
    if (rows.length === 0) return [];
    const titleIds = [...new Set(rows.map((row) => Number(row.title?.id)).filter(Boolean))];
    const { data: rules, error: rulesError } = await this.getClient()
      .from('subscription_title_rules')
      .select('id, title_id')
      .eq('active', true)
      .in('title_id', titleIds);
    if (rulesError) throw rulesError;
    const activeRules = rules || [];
    if (activeRules.length === 0) {
      return rows;
    }

    const ruleIds = activeRules.map((rule: any) => Number(rule.id));
    const titleRuleMap = new Map<number, number[]>();
    for (const rule of activeRules as any[]) {
      const titleId = Number(rule.title_id);
      titleRuleMap.set(titleId, [...(titleRuleMap.get(titleId) || []), Number(rule.id)]);
    }

    const userIds = [...new Set(rows.map((row) => row.user_id))];
    const { data: states, error: statesError } = await this.getClient()
      .from('subscription_title_states')
      .select('user_id, rule_id')
      .in('user_id', userIds)
      .in('rule_id', ruleIds)
      .eq('is_subscribed', true)
      .gt('checked_until', new Date().toISOString());
    if (statesError) throw statesError;
    const activeStateKeys = new Set((states || []).map((state: any) => `${state.user_id}:${state.rule_id}`));

    return rows.filter((row) => {
      const titleId = Number(row.title?.id);
      const requiredRuleIds = titleRuleMap.get(titleId);
      if (!requiredRuleIds || requiredRuleIds.length === 0) return true;
      return requiredRuleIds.some((ruleId) => activeStateKeys.has(`${row.user_id}:${ruleId}`));
    });
  }

  async findAll(): Promise<UserTitle[]> {
    const { data, error } = await this.getClient().from('titles').select('*').order('id', { ascending: false });
    if (error) throw error;
    return (data || []) as UserTitle[];
  }

  async findById(id: number): Promise<UserTitle | null> {
    const { data, error } = await this.getClient().from('titles').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data as UserTitle | null;
  }

  async findByUserId(userId: string): Promise<UserTitle[]> {
    const { data, error } = await this.getClient()
      .from('user_titles')
      .select('awarded_at, is_equipped, title:titles(*)')
      .eq('user_id', userId)
      .order('is_equipped', { ascending: false })
      .order('awarded_at', { ascending: true });
    if (error) throw error;
    const visibleRows = await this.filterVisibleSubscriptionTitleRows((data || []).map((row: any) => ({ ...row, user_id: userId })));
    return visibleRows.map((row: any) => ({ ...row.title, awarded_at: row.awarded_at, is_equipped: row.is_equipped })) as UserTitle[];
  }

  async findByUserIds(userIds: string[]): Promise<Record<string, UserTitle[]>> {
    const result: Record<string, UserTitle[]> = {};
    for (const id of userIds) result[id] = [];
    if (userIds.length === 0) return result;

    const { data, error } = await this.getClient()
      .from('user_titles')
      .select('user_id, awarded_at, is_equipped, title:titles(*)')
      .in('user_id', userIds)
      .order('is_equipped', { ascending: false })
      .order('awarded_at', { ascending: true });
    if (error) throw error;
    const visibleRows = await this.filterVisibleSubscriptionTitleRows((data || []) as any[]);
    for (const row of visibleRows) {
      (result[row.user_id] ||= []).push({ ...(row.title as any), awarded_at: row.awarded_at, is_equipped: row.is_equipped });
    }
    return result;
  }

  async create(title: Pick<UserTitle, 'name' | 'description' | 'css' | 'icon_name' | 'icon_color'>): Promise<UserTitle> {
    const { data, error } = await this.getClient().from('titles').insert(title).select().single();
    if (error) throw error;
    return data as UserTitle;
  }

  async update(id: number, title: Partial<Pick<UserTitle, 'name' | 'description' | 'css' | 'icon_name' | 'icon_color'>>): Promise<UserTitle | null> {
    const { data, error } = await this.getClient()
      .from('titles')
      .update({ ...title, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data as UserTitle | null;
  }

  async delete(id: number): Promise<void> {
    const { error } = await this.getClient().from('titles').delete().eq('id', id);
    if (error) throw error;
  }

  async award(userId: string, titleId: number): Promise<void> {
    const { error } = await this.getClient()
      .from('user_titles')
      .upsert({ user_id: userId, title_id: titleId }, { onConflict: 'user_id,title_id', ignoreDuplicates: true });
    if (error) throw error;
  }

  async awardMany(userIds: string[], titleId: number): Promise<void> {
    if (userIds.length === 0) return;
    const rows = userIds.map((userId) => ({ user_id: userId, title_id: titleId }));
    const { error } = await this.getClient()
      .from('user_titles')
      .upsert(rows, { onConflict: 'user_id,title_id', ignoreDuplicates: true });
    if (error) throw error;
  }

  async revoke(userId: string, titleId: number): Promise<void> {
    const { error } = await this.getClient()
      .from('user_titles')
      .delete()
      .eq('user_id', userId)
      .eq('title_id', titleId);
    if (error) throw error;
  }

  async revokeMany(userIds: string[], titleId: number): Promise<void> {
    if (userIds.length === 0) return;
    const { error } = await this.getClient()
      .from('user_titles')
      .delete()
      .eq('title_id', titleId)
      .in('user_id', userIds);
    if (error) throw error;
  }

  async equip(userId: string, titleId: number | null): Promise<boolean> {
    if (titleId !== null) {
      const { data, error } = await this.getClient()
        .from('user_titles')
        .select('user_id, awarded_at, is_equipped, title:titles(*)')
        .eq('user_id', userId)
        .eq('title_id', titleId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return false;
      const visibleRows = await this.filterVisibleSubscriptionTitleRows([data as any]);
      if (visibleRows.length === 0) return false;
    }

    const { error: clearError } = await this.getClient()
      .from('user_titles')
      .update({ is_equipped: false })
      .eq('user_id', userId)
      .eq('is_equipped', true);
    if (clearError) throw clearError;

    if (titleId !== null) {
      const { error } = await this.getClient()
        .from('user_titles')
        .update({ is_equipped: true })
        .eq('user_id', userId)
        .eq('title_id', titleId);
      if (error) throw error;
    }
    return true;
  }
}
