import { getDbMode, getMysqlDb, getSqliteDb } from './db';
import { ARENA_CURRENT_SEASON_ID } from './arenaDeckService';
import { ensureArenaMatchTables } from './arenaMatchService';

type RawArenaAuditMatchRow = {
  id: number | string | bigint;
  season_id: string;
  match_type: string;
  player_a_id: string;
  player_b_id: string | null;
  winner_user_id: string | null;
  player_a_round_wins: number;
  player_b_round_wins: number;
  draw_rounds: number;
  round_count: number;
  summary_json: string;
  created_at: string;
};

type AuditMatch = {
  match_id: string;
  created_at: string;
  player_a_id: string;
  player_b_id: string;
  winner_user_id: string | null;
  loser_user_id: string | null;
  score: string;
  round_count: number;
  duration_ms: number;
  is_short: boolean;
  is_sweep: boolean;
};

type AccountAudit = {
  user_id: string;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  short_matches: number;
  sweep_matches: number;
  total_duration_ms: number;
  opponents: Map<string, number>;
  evidence: AuditMatch[];
};

type PairAudit = {
  pair_key: string;
  user_a_id: string;
  user_b_id: string;
  matches: number;
  user_a_wins: number;
  user_b_wins: number;
  draws: number;
  short_matches: number;
  sweep_matches: number;
  total_duration_ms: number;
  evidence: AuditMatch[];
};

const AUDIT_DEFAULT_LIMIT = Math.max(100, Math.min(2000, Number(process.env.ARENA_ABUSE_AUDIT_MATCH_LIMIT || 800)));
const AUDIT_MAX_LIMIT = Math.max(100, Math.min(3000, Number(process.env.ARENA_ABUSE_AUDIT_MAX_LIMIT || 1500)));
const SHORT_MATCH_MS = Math.max(20_000, Number(process.env.ARENA_ABUSE_SHORT_MATCH_MS || 75_000));
const MIN_PAIR_MATCHES = Math.max(3, Number(process.env.ARENA_ABUSE_MIN_PAIR_MATCHES || 4));

let auditCache: { expiresAt: number; key: string; data: any } | null = null;
let auditInFlight: Promise<any> | null = null;

const normalizeLimit = (input: unknown) =>
  Math.max(50, Math.min(AUDIT_MAX_LIMIT, Number.parseInt(String(input || AUDIT_DEFAULT_LIMIT), 10) || AUDIT_DEFAULT_LIMIT));

const parseJson = <T>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const safeRate = (part: number, total: number) => total > 0 ? part / total : 0;
const pairKey = (a: string, b: string) => [a, b].sort().join('::');

const getRoundDurationMs = (summary: any) => {
  const rounds = Array.isArray(summary?.round_results) ? summary.round_results : [];
  return rounds.reduce((total: number, round: any) => total + Math.max(0, Number(round?.duration_ms || 0)), 0);
};

const loadRecentRankedMatches = async (limit: number): Promise<RawArenaAuditMatchRow[]> => {
  await ensureArenaMatchTables();
  const query = `SELECT id, season_id, match_type, player_a_id, player_b_id, winner_user_id,
      player_a_round_wins, player_b_round_wins, draw_rounds, round_count, summary_json, created_at
    FROM arena_matches
    WHERE season_id = ? AND match_type = 'RANKED' AND player_b_id IS NOT NULL
    ORDER BY id DESC
    LIMIT ?`;
  if (getDbMode() === 'MYSQL') {
    return getMysqlDb().all<RawArenaAuditMatchRow>(query, ARENA_CURRENT_SEASON_ID, limit);
  }
  return getSqliteDb().prepare(query).all(ARENA_CURRENT_SEASON_ID, limit) as RawArenaAuditMatchRow[];
};

const pushEvidence = (items: AuditMatch[], match: AuditMatch) => {
  items.push(match);
  items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || Number(b.match_id) - Number(a.match_id));
  if (items.length > 8) items.length = 8;
};

const getAccount = (accounts: Map<string, AccountAudit>, userId: string) => {
  const existing = accounts.get(userId);
  if (existing) return existing;
  const created: AccountAudit = {
    user_id: userId,
    matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    short_matches: 0,
    sweep_matches: 0,
    total_duration_ms: 0,
    opponents: new Map<string, number>(),
    evidence: []
  };
  accounts.set(userId, created);
  return created;
};

const getPair = (pairs: Map<string, PairAudit>, a: string, b: string) => {
  const key = pairKey(a, b);
  const [userA, userB] = key.split('::');
  const existing = pairs.get(key);
  if (existing) return existing;
  const created: PairAudit = {
    pair_key: key,
    user_a_id: userA,
    user_b_id: userB,
    matches: 0,
    user_a_wins: 0,
    user_b_wins: 0,
    draws: 0,
    short_matches: 0,
    sweep_matches: 0,
    total_duration_ms: 0,
    evidence: []
  };
  pairs.set(key, created);
  return created;
};

const addAccountMatch = (account: AccountAudit, opponentId: string, result: 'win' | 'loss' | 'draw', match: AuditMatch) => {
  account.matches += 1;
  if (result === 'win') account.wins += 1;
  else if (result === 'loss') account.losses += 1;
  else account.draws += 1;
  if (match.is_short) account.short_matches += 1;
  if (match.is_sweep) account.sweep_matches += 1;
  account.total_duration_ms += match.duration_ms;
  account.opponents.set(opponentId, (account.opponents.get(opponentId) || 0) + 1);
  pushEvidence(account.evidence, match);
};

const scoreAccount = (account: AccountAudit) => {
  const topOpponent = Array.from(account.opponents.entries()).sort((a, b) => b[1] - a[1])[0] || ['', 0];
  const topOpponentRate = safeRate(topOpponent[1], account.matches);
  const shortRate = safeRate(account.short_matches, account.matches);
  const sweepRate = safeRate(account.sweep_matches, account.matches);
  const decided = account.wins + account.losses;
  const oneSidedRate = decided > 0 ? Math.max(account.wins, account.losses) / decided : 0;
  const averageDurationMs = account.matches > 0 ? Math.round(account.total_duration_ms / account.matches) : 0;
  let score = 0;
  if (account.matches >= 12) score += 10;
  if (topOpponent[1] >= 8) score += 24;
  else if (topOpponent[1] >= 5) score += 16;
  else if (topOpponent[1] >= 3) score += 8;
  if (topOpponentRate >= 0.7 && account.matches >= 5) score += 18;
  else if (topOpponentRate >= 0.5 && account.matches >= 5) score += 10;
  if (oneSidedRate >= 0.9 && decided >= 6) score += 22;
  else if (oneSidedRate >= 0.75 && decided >= 5) score += 14;
  if (shortRate >= 0.7 && account.matches >= 4) score += 18;
  else if (shortRate >= 0.45 && account.matches >= 4) score += 10;
  if (sweepRate >= 0.65 && account.matches >= 4) score += 12;
  if (averageDurationMs > 0 && averageDurationMs <= SHORT_MATCH_MS) score += 8;

  const flags = [
    topOpponent[1] >= MIN_PAIR_MATCHES ? `동일 상대 ${topOpponent[1]}회` : '',
    topOpponentRate >= 0.5 && account.matches >= 5 ? `상대 집중 ${Math.round(topOpponentRate * 100)}%` : '',
    oneSidedRate >= 0.75 && decided >= 5 ? `일방 승패 ${Math.round(oneSidedRate * 100)}%` : '',
    shortRate >= 0.45 && account.matches >= 4 ? `짧은 전투 ${Math.round(shortRate * 100)}%` : '',
    sweepRate >= 0.65 && account.matches >= 4 ? `스윕 ${Math.round(sweepRate * 100)}%` : ''
  ].filter(Boolean);

  return {
    suspicion_score: clamp(score, 0, 100),
    risk_level: score >= 70 ? 'high' : score >= 45 ? 'medium' : score >= 25 ? 'low' : 'watch',
    flags,
    top_opponent_id: topOpponent[0] || null,
    top_opponent_matches: topOpponent[1],
    top_opponent_rate: Number(topOpponentRate.toFixed(4)),
    short_match_rate: Number(shortRate.toFixed(4)),
    sweep_rate: Number(sweepRate.toFixed(4)),
    one_sided_rate: Number(oneSidedRate.toFixed(4)),
    average_duration_ms: averageDurationMs
  };
};

const serializePair = (pair: PairAudit) => {
  const dominantWins = Math.max(pair.user_a_wins, pair.user_b_wins);
  const dominantUserId = pair.user_a_wins === pair.user_b_wins ? null : pair.user_a_wins > pair.user_b_wins ? pair.user_a_id : pair.user_b_id;
  const oneSidedRate = safeRate(dominantWins, Math.max(1, pair.user_a_wins + pair.user_b_wins));
  const shortRate = safeRate(pair.short_matches, pair.matches);
  const averageDurationMs = pair.matches > 0 ? Math.round(pair.total_duration_ms / pair.matches) : 0;
  const score =
    (pair.matches >= 8 ? 28 : pair.matches >= MIN_PAIR_MATCHES ? 18 : 0)
    + (oneSidedRate >= 0.85 && pair.matches >= MIN_PAIR_MATCHES ? 28 : oneSidedRate >= 0.7 && pair.matches >= MIN_PAIR_MATCHES ? 16 : 0)
    + (shortRate >= 0.65 && pair.matches >= MIN_PAIR_MATCHES ? 18 : shortRate >= 0.4 && pair.matches >= MIN_PAIR_MATCHES ? 10 : 0)
    + (safeRate(pair.sweep_matches, pair.matches) >= 0.6 && pair.matches >= MIN_PAIR_MATCHES ? 10 : 0);
  return {
    ...pair,
    opponents: undefined,
    suspicion_score: clamp(score, 0, 100),
    risk_level: score >= 65 ? 'high' : score >= 42 ? 'medium' : score >= 24 ? 'low' : 'watch',
    dominant_user_id: dominantUserId,
    one_sided_rate: Number(oneSidedRate.toFixed(4)),
    short_match_rate: Number(shortRate.toFixed(4)),
    sweep_rate: Number(safeRate(pair.sweep_matches, pair.matches).toFixed(4)),
    average_duration_ms: averageDurationMs,
    evidence: pair.evidence
  };
};

export const getArenaAbuseAudit = async (limitInput?: unknown) => {
  const limit = normalizeLimit(limitInput);
  const cacheKey = `${ARENA_CURRENT_SEASON_ID}:${limit}`;
  const now = Date.now();
  if (auditCache && auditCache.key === cacheKey && auditCache.expiresAt > now) return auditCache.data;
  if (auditInFlight) return auditInFlight;

  auditInFlight = (async () => {
    const rows = await loadRecentRankedMatches(limit);
    const accounts = new Map<string, AccountAudit>();
    const pairs = new Map<string, PairAudit>();

    for (const row of rows) {
      if (!row.player_b_id) continue;
      const summary = parseJson<any>(row.summary_json, {});
      const durationMs = getRoundDurationMs(summary);
      const playerAWins = Number(row.player_a_round_wins || 0);
      const playerBWins = Number(row.player_b_round_wins || 0);
      const loserUserId = row.winner_user_id
        ? row.winner_user_id === row.player_a_id ? row.player_b_id : row.player_a_id
        : null;
      const match: AuditMatch = {
        match_id: String(row.id),
        created_at: new Date(row.created_at).toISOString(),
        player_a_id: row.player_a_id,
        player_b_id: row.player_b_id,
        winner_user_id: row.winner_user_id || null,
        loser_user_id: loserUserId,
        score: `${playerAWins}:${playerBWins}`,
        round_count: Number(row.round_count || 0),
        duration_ms: durationMs,
        is_short: durationMs > 0 && durationMs <= SHORT_MATCH_MS,
        is_sweep: (playerAWins >= 3 && playerBWins === 0) || (playerBWins >= 3 && playerAWins === 0)
      };

      const pair = getPair(pairs, row.player_a_id, row.player_b_id);
      pair.matches += 1;
      pair.total_duration_ms += durationMs;
      if (match.is_short) pair.short_matches += 1;
      if (match.is_sweep) pair.sweep_matches += 1;
      if (!row.winner_user_id) pair.draws += 1;
      else if (row.winner_user_id === pair.user_a_id) pair.user_a_wins += 1;
      else if (row.winner_user_id === pair.user_b_id) pair.user_b_wins += 1;
      pushEvidence(pair.evidence, match);

      addAccountMatch(
        getAccount(accounts, row.player_a_id),
        row.player_b_id,
        !row.winner_user_id ? 'draw' : row.winner_user_id === row.player_a_id ? 'win' : 'loss',
        match
      );
      addAccountMatch(
        getAccount(accounts, row.player_b_id),
        row.player_a_id,
        !row.winner_user_id ? 'draw' : row.winner_user_id === row.player_b_id ? 'win' : 'loss',
        match
      );
    }

    const serializedPairs = Array.from(pairs.values())
      .filter((pair) => pair.matches >= MIN_PAIR_MATCHES)
      .map(serializePair)
      .filter((pair) => pair.suspicion_score >= 18)
      .sort((a, b) => b.suspicion_score - a.suspicion_score || b.matches - a.matches)
      .slice(0, 40);

    const suspects = Array.from(accounts.values())
      .map((account) => {
        const scored = scoreAccount(account);
        return {
          user_id: account.user_id,
          matches: account.matches,
          wins: account.wins,
          losses: account.losses,
          draws: account.draws,
          unique_opponents: account.opponents.size,
          evidence: account.evidence,
          ...scored
        };
      })
      .filter((account) => account.suspicion_score >= 22)
      .sort((a, b) => b.suspicion_score - a.suspicion_score || b.matches - a.matches)
      .slice(0, 60);

    const data = {
      season_id: ARENA_CURRENT_SEASON_ID,
      source: 'arena_matches_recent_ranked_limited',
      generated_at: new Date().toISOString(),
      scanned_matches: rows.length,
      limit,
      thresholds: {
        short_match_ms: SHORT_MATCH_MS,
        min_pair_matches: MIN_PAIR_MATCHES,
        cache_ttl_ms: 60_000,
        query_policy: 'latest_ranked_matches_limit_only'
      },
      summary: {
        suspect_accounts: suspects.length,
        suspicious_pairs: serializedPairs.length,
        high_risk_accounts: suspects.filter((item) => item.risk_level === 'high').length,
        medium_risk_accounts: suspects.filter((item) => item.risk_level === 'medium').length
      },
      suspects,
      suspicious_pairs: serializedPairs,
      recommendations: [
        'high 계정은 최근 증거 경기와 동일 상대 반복을 확인한 뒤 7일 이상 제재를 검토합니다.',
        'medium 계정은 1일 제재 또는 경고 후 다음 감사에서 재발 여부를 확인합니다.',
        '짧은 전투 시간만으로 제재하지 말고 일방 승패와 동일 상대 반복이 함께 있는지 확인합니다.',
        '감사 결과는 제한된 최신 매치 기반이므로 최종 판단 전에 계정 프로필과 최근 경기 리플레이를 함께 확인합니다.'
      ]
    };
    auditCache = { key: cacheKey, expiresAt: Date.now() + 60_000, data };
    return data;
  })().finally(() => {
    auditInFlight = null;
  });

  return auditInFlight;
};
