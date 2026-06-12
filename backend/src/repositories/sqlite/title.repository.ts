import { getSqliteDb } from '../../services/db';
import { ITitleRepository, UserTitle } from '../interfaces';

type SqliteUserTitleRow = Omit<UserTitle, 'is_equipped'> & { is_equipped: number };
type SqliteUserTitleWithUserRow = SqliteUserTitleRow & { user_id: string };

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
         AND sts.user_id = ut.user_id
         AND sts.is_subscribed = 1
         AND sts.checked_until > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE str.title_id = t.id
         AND str.active = 1
    )
  )
`;

export class SqliteTitleRepository implements ITitleRepository {
  private getDb() {
    return getSqliteDb();
  }

  async findAll(): Promise<UserTitle[]> {
    return this.getDb().prepare('SELECT * FROM titles ORDER BY id DESC').all() as UserTitle[];
  }

  async findById(id: number): Promise<UserTitle | null> {
    return (this.getDb().prepare('SELECT * FROM titles WHERE id = ?').get(id) as UserTitle | undefined) || null;
  }

  async findByUserId(userId: string): Promise<UserTitle[]> {
    const rows = this.getDb().prepare(`
      SELECT t.*, ut.awarded_at, ut.is_equipped
      FROM user_titles ut
      JOIN titles t ON t.id = ut.title_id
      WHERE ut.user_id = ?
      ${subscriptionVisibilitySql}
      ORDER BY ut.is_equipped DESC, ut.awarded_at ASC, t.id ASC
    `).all(userId) as SqliteUserTitleRow[];
    return rows.map((row) => ({ ...row, is_equipped: row.is_equipped === 1 }));
  }

  async findByUserIds(userIds: string[]): Promise<Record<string, UserTitle[]>> {
    const result: Record<string, UserTitle[]> = {};
    for (const id of userIds) result[id] = [];
    if (userIds.length === 0) return result;

    const placeholders = userIds.map(() => '?').join(', ');
    const rows = this.getDb().prepare(`
      SELECT ut.user_id, t.*, ut.awarded_at, ut.is_equipped
      FROM user_titles ut
      JOIN titles t ON t.id = ut.title_id
      WHERE ut.user_id IN (${placeholders})
      ${subscriptionVisibilitySql}
      ORDER BY ut.is_equipped DESC, ut.awarded_at ASC, t.id ASC
    `).all(...userIds) as SqliteUserTitleWithUserRow[];

    for (const row of rows) {
      const { user_id, ...title } = row;
      (result[user_id] ||= []).push({ ...title, is_equipped: title.is_equipped === 1 });
    }
    return result;
  }

  async create(title: Pick<UserTitle, 'name' | 'description' | 'css' | 'icon_name' | 'icon_color'>): Promise<UserTitle> {
    const info = this.getDb().prepare(`
      INSERT INTO titles (name, description, css, icon_name, icon_color)
      VALUES (?, ?, ?, ?, ?)
    `).run(title.name, title.description, title.css, title.icon_name, title.icon_color);
    return (await this.findById(Number(info.lastInsertRowid)))!;
  }

  async update(id: number, title: Partial<Pick<UserTitle, 'name' | 'description' | 'css' | 'icon_name' | 'icon_color'>>): Promise<UserTitle | null> {
    const current = await this.findById(id);
    if (!current) return null;
    this.getDb().prepare(`
      UPDATE titles
      SET name = ?, description = ?, css = ?, icon_name = ?, icon_color = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
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
    this.getDb().prepare('DELETE FROM titles WHERE id = ?').run(id);
  }

  async award(userId: string, titleId: number): Promise<void> {
    this.getDb().prepare(`
      INSERT INTO user_titles (user_id, title_id)
      VALUES (?, ?)
      ON CONFLICT(user_id, title_id) DO NOTHING
    `).run(userId, titleId);
  }

  async awardMany(userIds: string[], titleId: number): Promise<void> {
    if (userIds.length === 0) return;
    const statement = this.getDb().prepare(`
      INSERT INTO user_titles (user_id, title_id)
      VALUES (?, ?)
      ON CONFLICT(user_id, title_id) DO NOTHING
    `);
    this.getDb().transaction((ids: string[]) => {
      for (const userId of ids) statement.run(userId, titleId);
    })(userIds);
  }

  async revoke(userId: string, titleId: number): Promise<void> {
    this.getDb().prepare('DELETE FROM user_titles WHERE user_id = ? AND title_id = ?').run(userId, titleId);
  }

  async revokeMany(userIds: string[], titleId: number): Promise<void> {
    if (userIds.length === 0) return;
    const placeholders = userIds.map(() => '?').join(', ');
    this.getDb().prepare(`
      DELETE FROM user_titles
      WHERE title_id = ? AND user_id IN (${placeholders})
    `).run(titleId, ...userIds);
  }

  async equip(userId: string, titleId: number | null): Promise<boolean> {
    return this.getDb().transaction(() => {
      if (titleId !== null) {
        const owned = this.getDb().prepare(`
          SELECT 1
            FROM user_titles ut
            JOIN titles t ON t.id = ut.title_id
           WHERE ut.user_id = ?
             AND ut.title_id = ?
             ${subscriptionVisibilitySql}
        `).get(userId, titleId);
        if (!owned) return false;
      }
      this.getDb().prepare('UPDATE user_titles SET is_equipped = 0 WHERE user_id = ?').run(userId);
      if (titleId !== null) {
        this.getDb().prepare('UPDATE user_titles SET is_equipped = 1 WHERE user_id = ? AND title_id = ?').run(userId, titleId);
      }
      return true;
    })();
  }
}
