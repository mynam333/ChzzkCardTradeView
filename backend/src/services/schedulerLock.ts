import crypto from 'crypto';
import { getDbMode, getMysqlDb, getSqliteDb, getSupabaseClient } from './db';

type ReleaseLock = () => Promise<void>;

const encodeLockValue = (token: string, expiresAt: string): string =>
  JSON.stringify({ token, expiresAt });

const parseLockValue = (value: string | null | undefined): { token?: string; expiresAt?: string } => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return {
      token: typeof parsed.token === 'string' ? parsed.token : undefined,
      expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : undefined
    };
  } catch {
    return {};
  }
};

/**
 * 여러 서버 인스턴스가 같은 백그라운드 작업을 동시에 실행하지 않도록 DB lease를 획득합니다.
 * Supabase 모드는 init-db-postgres.sql의 try_acquire_scheduler_lock RPC가 적용되어 있어야 합니다.
 */
export const acquireSchedulerLock = async (key: string, ttlMs: number): Promise<ReleaseLock | null> => {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  if (getDbMode() === 'SUPABASE') {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('try_acquire_scheduler_lock', {
      p_key: key,
      p_token: token,
      p_expires_at: expiresAt
    });

    if (error) {
      console.warn(`[SchedulerLock] Supabase lock RPC 실패(${key}):`, error.message);
      return null;
    }
    if (data !== true) return null;

    return async () => {
      try {
        await client.rpc('release_scheduler_lock', { p_key: key, p_token: token });
      } catch {
        // release 실패는 TTL 만료로 복구됩니다.
      }
    };
  }

  if (getDbMode() === 'MYSQL') {
    const db = getMysqlDb();
    const acquired = await db.transaction(async (tx) => {
      const row = await tx.get('SELECT value FROM system_configs WHERE `key` = ? FOR UPDATE', key);
      const current = parseLockValue(row?.value);
      const currentExpires = current.expiresAt ? new Date(current.expiresAt).getTime() : 0;
      if (current.token && currentExpires > Date.now()) return false;
      await tx.run(`
        INSERT INTO system_configs (\`key\`, value) VALUES (?, ?)
        ON DUPLICATE KEY UPDATE value = VALUES(value)
      `, key, encodeLockValue(token, expiresAt));
      return true;
    });

    if (!acquired) return null;

    return async () => {
      await db.transaction(async (tx) => {
        const row = await tx.get('SELECT value FROM system_configs WHERE `key` = ? FOR UPDATE', key);
        const current = parseLockValue(row?.value);
        if (current.token === token) {
          await tx.run('DELETE FROM system_configs WHERE `key` = ?', key);
        }
      });
    };
  }

  const db = getSqliteDb();
  const acquired = db.transaction(() => {
    const row = db.prepare('SELECT value FROM system_configs WHERE key = ?').get(key) as { value?: string } | undefined;
    const current = parseLockValue(row?.value);
    const currentExpires = current.expiresAt ? new Date(current.expiresAt).getTime() : 0;

    if (current.token && currentExpires > Date.now()) {
      return false;
    }

    db.prepare(`
      INSERT INTO system_configs (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, encodeLockValue(token, expiresAt));
    return true;
  })();

  if (!acquired) return null;

  return async () => {
    db.transaction(() => {
      const row = db.prepare('SELECT value FROM system_configs WHERE key = ?').get(key) as { value?: string } | undefined;
      const current = parseLockValue(row?.value);
      if (current.token === token) {
        db.prepare('DELETE FROM system_configs WHERE key = ?').run(key);
      }
    })();
  };
};
