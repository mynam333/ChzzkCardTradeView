type SqlReader = {
  get: <T = any>(sql: string, ...args: any[]) => Promise<T | undefined>;
};

type SqlRunner = {
  run: (sql: string, ...args: any[]) => Promise<any>;
};

export const snapshotTimestampMs = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const timestamp = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

export const readLatestUserRankingSnapshotAt = async (db: SqlReader): Promise<number | null> => {
  const row = await db.get<{ snapshot_at?: unknown }>(
    'SELECT MAX(snapshot_at) AS snapshot_at FROM user_asset_rankings'
  );
  return snapshotTimestampMs(row?.snapshot_at);
};

export const isUserRankingSnapshotFresh = (
  snapshotAt: number | null,
  minimumAgeMs: number,
  nowMs = Date.now()
): boolean => snapshotAt !== null && snapshotAt + Math.max(0, minimumAgeMs) > nowMs;

/**
 * PostgreSQL 랭킹 스냅샷을 staging 테이블과 차이가 있는 행만 반영합니다.
 * 전체 DELETE/INSERT는 카드 필터 테이블의 모든 행을 매 갱신마다 사문화시켜
 * 과도한 WAL과 autovacuum을 만들기 때문에 사용하지 않습니다.
 */
export const syncPostgresUserRankingSnapshotTables = async (tx: SqlRunner): Promise<void> => {
  await tx.run(`
    INSERT INTO user_asset_rankings AS existing
      (user_id, username, avatar_url, role, point, last_free_draw, banned_until, ban_reason, status_message, last_seen_at, created_at,
       card_count, cards_value, total_asset, total_rank, cards_rank, snapshot_at)
    SELECT user_id, username, avatar_url, role, point, last_free_draw, banned_until, ban_reason, status_message, last_seen_at, created_at,
           card_count, cards_value, total_asset, total_rank, cards_rank, snapshot_at
      FROM user_asset_rankings_next
    ON CONFLICT (user_id) DO UPDATE SET
      username = EXCLUDED.username,
      avatar_url = EXCLUDED.avatar_url,
      role = EXCLUDED.role,
      point = EXCLUDED.point,
      last_free_draw = EXCLUDED.last_free_draw,
      banned_until = EXCLUDED.banned_until,
      ban_reason = EXCLUDED.ban_reason,
      status_message = EXCLUDED.status_message,
      last_seen_at = EXCLUDED.last_seen_at,
      created_at = EXCLUDED.created_at,
      card_count = EXCLUDED.card_count,
      cards_value = EXCLUDED.cards_value,
      total_asset = EXCLUDED.total_asset,
      total_rank = EXCLUDED.total_rank,
      cards_rank = EXCLUDED.cards_rank,
      snapshot_at = EXCLUDED.snapshot_at
    WHERE ROW(
      existing.username, existing.avatar_url, existing.role, existing.point, existing.last_free_draw,
      existing.banned_until, existing.ban_reason, existing.status_message, existing.last_seen_at, existing.created_at,
      existing.card_count, existing.cards_value, existing.total_asset, existing.total_rank, existing.cards_rank
    ) IS DISTINCT FROM ROW(
      EXCLUDED.username, EXCLUDED.avatar_url, EXCLUDED.role, EXCLUDED.point, EXCLUDED.last_free_draw,
      EXCLUDED.banned_until, EXCLUDED.ban_reason, EXCLUDED.status_message, EXCLUDED.last_seen_at, EXCLUDED.created_at,
      EXCLUDED.card_count, EXCLUDED.cards_value, EXCLUDED.total_asset, EXCLUDED.total_rank, EXCLUDED.cards_rank
    )
  `);

  await tx.run(`
    INSERT INTO user_asset_ranking_cards AS existing (user_id, channel_id, star, card_count)
    SELECT user_id, channel_id, star, card_count
      FROM user_asset_ranking_cards_next
    ON CONFLICT (user_id, channel_id, star) DO UPDATE SET
      card_count = EXCLUDED.card_count
    WHERE existing.card_count IS DISTINCT FROM EXCLUDED.card_count
  `);

  await tx.run(`
    DELETE FROM user_asset_ranking_cards AS existing
     WHERE NOT EXISTS (
       SELECT 1
         FROM user_asset_ranking_cards_next AS next
        WHERE next.user_id = existing.user_id
          AND next.channel_id = existing.channel_id
          AND next.star = existing.star
     )
  `);

  await tx.run(`
    DELETE FROM user_asset_rankings AS existing
     WHERE NOT EXISTS (
       SELECT 1
         FROM user_asset_rankings_next AS next
        WHERE next.user_id = existing.user_id
     )
  `);

  // 변경 행이 하나도 없어도 MAX(snapshot_at)이 마지막 성공 시각을 나타내게 합니다.
  await tx.run(`
    UPDATE user_asset_rankings
       SET snapshot_at = NOW()
     WHERE user_id = (
       SELECT user_id
         FROM user_asset_rankings
        ORDER BY user_id
        LIMIT 1
     )
  `);
};
