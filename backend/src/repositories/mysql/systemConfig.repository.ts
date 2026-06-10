import { getMysqlDb } from '../../services/db';
import { ISystemConfigRepository } from '../interfaces';

export class MysqlSystemConfigRepository implements ISystemConfigRepository {
  private getDb() {
    return getMysqlDb();
  }

  async get(key: string, defaultValue: string): Promise<string> {
    try {
      const row = await this.getDb().get('SELECT value FROM system_configs WHERE `key` = ?', key);
      return row ? row.value : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  async set(key: string, value: string): Promise<void> {
    await this.getDb().run(`
      INSERT INTO system_configs (\`key\`, value)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE value = VALUES(value)
    `, key, value);
  }
}
