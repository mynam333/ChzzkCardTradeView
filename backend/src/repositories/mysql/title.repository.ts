import { getMysqlDb } from '../../services/db';
import { ITitleRepository, UserTitle } from '../interfaces';

type MysqlUserTitleRow = Omit<UserTitle, 'is_equipped'> & { is_equipped: number };
type MysqlUserTitleWithUserRow = MysqlUserTitleRow & { user_id: string };

const subscriptionVisibilitySql = `
  AND (
    NOT EXISTS (
      SELECT 1
        FROM subscription_title_rules str
       WHERE str.title_id = t.id
         AND str.active = 1
    )
    OR EXISTS (
      SELECT 1
        FROM subscription_title_rules str
        JOIN subscription_title_states sts
          ON sts.rule_id = str.id
         AND sts.user_id COLLATE utf8mb4_unicode_ci = ut.user_id COLLATE utf8mb4_unicode_ci
         AND sts.is_subscribed = 1
         AND sts.checked_until > UTC_TIMESTAMP()
       WHERE str.title_id = t.id
         AND str.active = 1
    )
  )
`;

const isSubscriptionVisibilityError = (err: any): boolean => {
  const message = String(err?.message || '');
  return (
    err?.code === 'ER_NO_SUCH_TABLE' ||
    err?.code === 'ER_BAD_FIELD_ERROR' ||
    message.includes('subscription_title_') ||
    message.includes('Illegal mix of collations')
  );
};

export class MysqlTitleRepository implements ITitleRepository {
  private getDb() {
    return getMysqlDb();
  }

  async findAll(): Promise<UserTitle[]> {
    return this.getDb().all('SELECT * FROM titles ORDER BY id DESC');
  }

  async findById(id: number): Promise<UserTitle | null> {
    return (await this.getDb().get<UserTitle>('SELECT * FROM titles WHERE id = ?', id)) || null;
  }

  async findByUserId(userId: string): Promise<UserTitle[]> {
    let rows: MysqlUserTitleRow[];
    try {
      rows = await this.getDb().all<MysqlUserTitleRow>(`
        SELECT t.*, ut.awarded_at, ut.is_equipped
        FROM user_titles ut
        JOIN titles t ON t.id = ut.title_id
        WHERE ut.user_id = ?
        ${subscriptionVisibilitySql}
        ORDER BY ut.is_equipped DESC, ut.awarded_at ASC, t.id ASC
      `, userId);
    } catch (err) {
      if (!isSubscriptionVisibilityError(err)) throw err;
      console.warn('[MysqlTitleRepository] 구독 칭호 표시 조건 조회 실패, 일반 칭호 조회로 폴백:', (err as any)?.message || err);
      rows = await this.getDb().all<MysqlUserTitleRow>(`
        SELECT t.*, ut.awarded_at, ut.is_equipped
        FROM user_titles ut
        JOIN titles t ON t.id = ut.title_id
        WHERE ut.user_id = ?
        ORDER BY ut.is_equipped DESC, ut.awarded_at ASC, t.id ASC
      `, userId);
    }
    return rows.map((row) => ({ ...row, is_equipped: row.is_equipped === 1 }));
  }

  async findByUserIds(userIds: string[]): Promise<Record<string, UserTitle[]>> {
    const result: Record<string, UserTitle[]> = {};
    for (const id of userIds) result[id] = [];
    if (userIds.length === 0) return result;
    const placeholders = userIds.map(() => '?').join(', ');
    let rows: MysqlUserTitleWithUserRow[];
    try {
      rows = await this.getDb().all<MysqlUserTitleWithUserRow>(`
        SELECT ut.user_id, t.*, ut.awarded_at, ut.is_equipped
        FROM user_titles ut
        JOIN titles t ON t.id = ut.title_id
        WHERE ut.user_id IN (${placeholders})
        ${subscriptionVisibilitySql}
        ORDER BY ut.is_equipped DESC, ut.awarded_at ASC, t.id ASC
      `, userIds);
    } catch (err) {
      if (!isSubscriptionVisibilityError(err)) throw err;
      console.warn('[MysqlTitleRepository] 구독 칭호 표시 조건 일괄 조회 실패, 일반 칭호 조회로 폴백:', (err as any)?.message || err);
      rows = await this.getDb().all<MysqlUserTitleWithUserRow>(`
        SELECT ut.user_id, t.*, ut.awarded_at, ut.is_equipped
        FROM user_titles ut
        JOIN titles t ON t.id = ut.title_id
        WHERE ut.user_id IN (${placeholders})
        ORDER BY ut.is_equipped DESC, ut.awarded_at ASC, t.id ASC
      `, userIds);
    }
    for (const row of rows) {
      const { user_id, ...title } = row;
      (result[user_id] ||= []).push({ ...title, is_equipped: title.is_equipped === 1 });
    }
    return result;
  }

  async create(title: Pick<UserTitle, 'name' | 'description' | 'css' | 'icon_name' | 'icon_color'>): Promise<UserTitle> {
    const info = await this.getDb().run(
      'INSERT INTO titles (name, description, css, icon_name, icon_color) VALUES (?, ?, ?, ?, ?)',
      title.name, title.description, title.css, title.icon_name, title.icon_color
    );
    return (await this.findById(Number(info.insertId)))!;
  }

  async update(id: number, title: Partial<Pick<UserTitle, 'name' | 'description' | 'css' | 'icon_name' | 'icon_color'>>): Promise<UserTitle | null> {
    const current = await this.findById(id);
    if (!current) return null;
    await this.getDb().run(
      'UPDATE titles SET name = ?, description = ?, css = ?, icon_name = ?, icon_color = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?',
      title.name ?? current.name,
      title.description === undefined ? current.description : title.description,
      title.css ?? current.css,
      title.icon_name === undefined ? current.icon_name : title.icon_name,
      title.icon_color ?? current.icon_color,
      id
    );
    return this.findById(id);
  }

  async delete(id: number): Promise<void> {
    await this.getDb().run('DELETE FROM titles WHERE id = ?', id);
  }

  async award(userId: string, titleId: number): Promise<void> {
    await this.getDb().run('INSERT IGNORE INTO user_titles (user_id, title_id) VALUES (?, ?)', userId, titleId);
  }

  async awardMany(userIds: string[], titleId: number): Promise<void> {
    if (userIds.length === 0) return;
    await this.getDb().transaction(async (tx) => {
      for (const userId of userIds) {
        await tx.run('INSERT IGNORE INTO user_titles (user_id, title_id) VALUES (?, ?)', userId, titleId);
      }
    });
  }

  async revoke(userId: string, titleId: number): Promise<void> {
    await this.getDb().run('DELETE FROM user_titles WHERE user_id = ? AND title_id = ?', userId, titleId);
  }

  async revokeMany(userIds: string[], titleId: number): Promise<void> {
    if (userIds.length === 0) return;
    const placeholders = userIds.map(() => '?').join(', ');
    await this.getDb().run(`DELETE FROM user_titles WHERE title_id = ? AND user_id IN (${placeholders})`, [titleId, ...userIds]);
  }

  async equip(userId: string, titleId: number | null): Promise<boolean> {
    return this.getDb().transaction(async (tx) => {
      if (titleId !== null) {
        let owned = null;
        try {
          owned = await tx.get(`
            SELECT 1
              FROM user_titles ut
              JOIN titles t ON t.id = ut.title_id
             WHERE ut.user_id = ?
               AND ut.title_id = ?
               ${subscriptionVisibilitySql}
          `, userId, titleId);
        } catch (err) {
          if (!isSubscriptionVisibilityError(err)) throw err;
          console.warn('[MysqlTitleRepository] 구독 칭호 장착 조건 조회 실패, 일반 보유 조건으로 폴백:', (err as any)?.message || err);
          owned = await tx.get('SELECT 1 FROM user_titles WHERE user_id = ? AND title_id = ?', userId, titleId);
        }
        if (!owned) return false;
      }
      await tx.run('UPDATE user_titles SET is_equipped = 0 WHERE user_id = ?', userId);
      if (titleId !== null) {
        await tx.run('UPDATE user_titles SET is_equipped = 1 WHERE user_id = ? AND title_id = ?', userId, titleId);
      }
      return true;
    });
  }
}
