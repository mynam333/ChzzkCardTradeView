type SqlReader = {
  get: <T = any>(sql: string, ...args: any[]) => Promise<T | undefined>;
};

type SqlRunner = {
  run: (sql: string, ...args: any[]) => Promise<any>;
};

/**
 * PostgreSQL 전용 랭킹 staging을 만듭니다.
 * 보이는 카드 그룹을 먼저 한 번만 집계하고, 유저별 자산 합계는 그 작은 결과에서 계산합니다.
 * TEMP 테이블은 bulk load 중 인덱스를 유지하지 않고 적재 후 sync에 필요한 unique index만 만듭니다.
 */
export const buildPostgresUserRankingSnapshotStaging = async (tx: SqlRunner): Promise<void> => {
  await tx.run('CREATE TEMP TABLE user_asset_ranking_cards_next (LIKE user_asset_ranking_cards INCLUDING DEFAULTS) ON COMMIT DROP');
  await tx.run(`
    INSERT INTO user_asset_ranking_cards_next (user_id, channel_id, star, card_count)
    SELECT uc.user_id, uc.channel_id, COALESCE(uc.star, 0) AS star, COUNT(*) AS card_count
      FROM user_cards uc
      JOIN users u ON u.id = uc.user_id
     WHERE uc.is_hidden IS NOT TRUE
       AND (u.banned_until IS NULL OR u.banned_until <= NOW())
     GROUP BY uc.user_id, uc.channel_id, COALESCE(uc.star, 0)
  `);
  await tx.run(`
    CREATE UNIQUE INDEX user_asset_ranking_cards_next_key
      ON user_asset_ranking_cards_next (user_id, channel_id, star)
  `);

  await tx.run('CREATE TEMP TABLE user_asset_rankings_next (LIKE user_asset_rankings INCLUDING DEFAULTS) ON COMMIT DROP');
  await tx.run(`
    INSERT INTO user_asset_rankings_next
      (user_id, username, avatar_url, role, point, last_free_draw, banned_until, ban_reason, status_message, last_seen_at, created_at,
       card_count, cards_value, total_asset, total_rank, cards_rank, snapshot_at)
    WITH CardValues AS (
      SELECT rc.user_id,
             SUM(rc.card_count) AS card_count,
             COALESCE(SUM(rc.card_count * s.base_value * (1 + rc.star * 0.8)), 0) AS cards_value_raw
        FROM user_asset_ranking_cards_next rc
        LEFT JOIN streamers s ON s.channel_id = rc.channel_id
       GROUP BY rc.user_id
    ),
    UserCardValues AS (
      SELECT u.id, u.username, u.avatar_url, u.role, u.point, u.last_free_draw, u.banned_until, u.ban_reason,
             u.status_message, u.last_seen_at, u.created_at,
             COALESCE(cv.card_count, 0) AS card_count,
             COALESCE(cv.cards_value_raw, 0) AS cards_value_raw
        FROM users u
        LEFT JOIN CardValues cv ON cv.user_id = u.id
       WHERE u.banned_until IS NULL OR u.banned_until <= NOW()
    ),
    RankedUsers AS (
      SELECT *,
             ROW_NUMBER() OVER (ORDER BY (point + cards_value_raw) DESC, id ASC) AS total_rank,
             ROW_NUMBER() OVER (ORDER BY cards_value_raw DESC, id ASC) AS cards_rank
        FROM UserCardValues
    )
    SELECT id, username, avatar_url, role, point, last_free_draw, banned_until, ban_reason, status_message, last_seen_at, created_at,
           card_count, ROUND(cards_value_raw)::BIGINT, (point + ROUND(cards_value_raw))::BIGINT, total_rank, cards_rank, NOW()
      FROM RankedUsers
  `);
  await tx.run(`
    CREATE UNIQUE INDEX user_asset_rankings_next_key
      ON user_asset_rankings_next (user_id)
  `);
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
