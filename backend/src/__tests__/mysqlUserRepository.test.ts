import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MysqlUserRepository } from '../repositories/mysql/user.repository';
import { PostgresDb } from '../services/postgresDb';

const mocks = vi.hoisted(() => ({
  db: null as PostgresDb | null,
  unsafe: vi.fn()
}));

vi.mock('../services/db', () => ({
  getMysqlDb: () => mocks.db,
  getSqlDialect: () => 'postgres'
}));

vi.mock('../services/pointLedger', () => ({
  recordMysqlPointLedger: vi.fn()
}));

describe('MysqlUserRepository PostgreSQL compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const connection: any = {
      unsafe: mocks.unsafe,
      begin: async (task: (tx: any) => Promise<unknown>) => task(connection)
    };
    mocks.unsafe.mockImplementation(async (sql: string) => {
      if (/COALESCE\s*\(\s*(?:u\.created_at|du\.deleted_at)\s*,\s*''\s*\)/i.test(sql)) {
        throw Object.assign(new Error('invalid input syntax for type timestamp with time zone: ""'), {
          code: '22007'
        });
      }
      if (
        /INSERT\s+INTO\s+market_transaction_audit_logs[\s\S]+CONCAT\s*\(/i.test(sql)
        && !/CONCAT\s*\(\s*'account_deleted:'\s*,\s*ml\.id\s*,\s*':'\s*,\s*CAST\s*\(\s*\$\d+\s+AS\s+TEXT\s*\)\s*\)/i.test(sql)
      ) {
        throw Object.assign(new Error('could not determine data type of parameter $1'), {
          code: '42P18'
        });
      }
      if (/CASE\s+WHEN[\s\S]+THEN\s+1\s+ELSE\s+deleted_for_[ab]\s+END/i.test(sql)) {
        throw Object.assign(new Error('CASE types boolean and integer cannot be matched'), {
          code: '42804'
        });
      }
      if (/SELECT\s+username,\s*avatar_url,\s*point\s+FROM\s+users/i.test(sql)) {
        return [{ username: '탈퇴 테스트', avatar_url: null, point: 1000 }];
      }
      return [];
    });
    mocks.db = new PostgresDb(connection);
  });

  it('회원 탈퇴의 채팅방 정리에서 PostgreSQL BOOLEAN 분기를 사용한다', async () => {
    const repository = new MysqlUserRepository();

    await expect(repository.deleteAccount('delete-user')).resolves.toBeUndefined();

    const statements = mocks.unsafe.mock.calls.map(([sql]) => String(sql));
    const chatRoomUpdate = statements.find((sql) => /UPDATE\s+chat_rooms/i.test(sql));
    expect(chatRoomUpdate).toBeDefined();
    expect(chatRoomUpdate).toMatch(
      /deleted_for_a\s*=\s*CASE\s+WHEN\s+user_a_id\s*=\s*\$\d+\s+THEN\s+TRUE\s+ELSE\s+deleted_for_a\s+END/i
    );
    expect(chatRoomUpdate).toMatch(
      /deleted_for_b\s*=\s*CASE\s+WHEN\s+user_b_id\s*=\s*\$\d+\s+THEN\s+TRUE\s+ELSE\s+deleted_for_b\s+END/i
    );
    expect(chatRoomUpdate).not.toMatch(/THEN\s+1\s+ELSE\s+deleted_for_[ab]/i);
    expect(statements.some((sql) => /DELETE\s+FROM\s+users\s+WHERE\s+id\s*=\s*\$1/i.test(sql))).toBe(true);
  });

  it('회원 탈퇴 감사 키의 동적 ID를 PostgreSQL TEXT로 명시한다', async () => {
    const repository = new MysqlUserRepository();

    await expect(repository.deleteAccount('delete-user')).resolves.toBeUndefined();

    const auditInsert = mocks.unsafe.mock.calls
      .map(([sql]) => String(sql))
      .find((sql) => /INSERT\s+INTO\s+market_transaction_audit_logs/i.test(sql));
    expect(auditInsert).toBeDefined();
    expect(auditInsert).toMatch(
      /CONCAT\s*\(\s*'account_deleted:'\s*,\s*ml\.id\s*,\s*':'\s*,\s*CAST\s*\(\s*\$1\s+AS\s+TEXT\s*\)\s*\)/i
    );
    expect(auditInsert).not.toMatch(
      /CONCAT\s*\(\s*'account_deleted:'\s*,\s*ml\.id\s*,\s*':'\s*,\s*\$1\s*\)/i
    );
  });

  it('관리자 유저 목록은 TIMESTAMPTZ 정렬에 빈 문자열을 사용하지 않는다', async () => {
    const repository = new MysqlUserRepository();

    await expect(repository.listUsers('', 20, 0)).resolves.toEqual({ users: [], total: 0 });

    const listQuery = mocks.unsafe.mock.calls
      .map(([sql]) => String(sql))
      .find((sql) => /FROM\s+deleted_user_accounts\s+du[\s\S]+ORDER\s+BY/i.test(sql));
    expect(listQuery).toBeDefined();
    expect(listQuery).toMatch(/u\.created_at\s+AS\s+sort_at/i);
    expect(listQuery).toMatch(/du\.deleted_at\s+AS\s+sort_at/i);
    expect(listQuery).toMatch(/ORDER\s+BY\s+CASE\s+WHEN\s+sort_at\s+IS\s+NULL\s+THEN\s+1\s+ELSE\s+0\s+END\s+ASC,\s*sort_at\s+DESC/i);
    expect(listQuery).not.toMatch(/COALESCE\s*\(\s*(?:u\.created_at|du\.deleted_at)\s*,\s*''\s*\)/i);
  });
});
