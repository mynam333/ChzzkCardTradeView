import { getSupabaseClient } from '../../services/db';
import { ITitleRepository, UserTitle } from '../interfaces';

export class SupabaseTitleRepository implements ITitleRepository {
  private getClient() {
    return getSupabaseClient();
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
    return (data || []).map((row: any) => ({ ...row.title, awarded_at: row.awarded_at, is_equipped: row.is_equipped })) as UserTitle[];
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
    for (const row of data || []) {
      (result[row.user_id] ||= []).push({ ...(row.title as any), awarded_at: row.awarded_at, is_equipped: row.is_equipped });
    }
    return result;
  }

  async create(title: Pick<UserTitle, 'name' | 'css' | 'icon_name' | 'icon_color'>): Promise<UserTitle> {
    const { data, error } = await this.getClient().from('titles').insert(title).select().single();
    if (error) throw error;
    return data as UserTitle;
  }

  async update(id: number, title: Partial<Pick<UserTitle, 'name' | 'css' | 'icon_name' | 'icon_color'>>): Promise<UserTitle | null> {
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
        .select('title_id')
        .eq('user_id', userId)
        .eq('title_id', titleId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return false;
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
