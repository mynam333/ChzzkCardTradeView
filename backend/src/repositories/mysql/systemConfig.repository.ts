import { getMysqlDb } from '../../services/db';
import { ISystemConfigRepository } from '../interfaces';

export class MysqlSystemConfigRepository implements ISystemConfigRepository {
  private static readonly CACHE_TTL_MS = Math.max(1_000, Number(process.env.SYSTEM_CONFIG_CACHE_TTL_MS || 30_000));
  private cache = new Map<string, { value: string; expiresAt: number }>();
  private inFlight = new Map<string, Promise<string>>();

  private getDb() {
    return getMysqlDb();
  }

  async get(key: string, defaultValue: string): Promise<string> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const request = (async () => {
      try {
        const row = await this.getDb().get('SELECT value FROM system_configs WHERE `key` = ?', key);
        const value = row ? row.value : defaultValue;
        this.cache.set(key, { value, expiresAt: Date.now() + MysqlSystemConfigRepository.CACHE_TTL_MS });
        if (this.cache.size > 200) {
          for (const [cacheKey, item] of this.cache) {
            if (item.expiresAt <= Date.now()) this.cache.delete(cacheKey);
          }
        }
        return value;
      } catch {
        return defaultValue;
      }
    })().finally(() => {
      this.inFlight.delete(key);
    });

    this.inFlight.set(key, request);
    return request;
  }

  async set(key: string, value: string): Promise<void> {
    try {
      await this.getDb().run(`
        INSERT INTO system_configs (\`key\`, value)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE value = VALUES(value)
      `, key, value);
    } finally {
      this.cache.delete(key);
      this.inFlight.delete(key);
    }
  }
}
