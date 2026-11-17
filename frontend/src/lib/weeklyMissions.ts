export type WeeklyMissionDifficulty = 'easy' | 'normal' | 'hard';
export type WeeklyMissionStatus = 'in_progress' | 'claimable' | 'claimed';

export type WeeklyMissionCondition = { label: string; progress: number; target: number };

export type WeeklyMission = {
  id: number;
  mission_code: string;
  difficulty: WeeklyMissionDifficulty;
  title: string;
  description: string;
  progress: number;
  target: number;
  conditions: WeeklyMissionCondition[];
  reward_points: number;
  reward_minigame_tickets: number;
  reward_free_draw_tickets: number;
  status: WeeklyMissionStatus;
  claimed_at: string | null;
};

export type WeeklyMissionsPayload = {
  week_key: string;
  starts_at: string;
  ends_at: string;
  server_now: string;
  missions: WeeklyMission[];
  summary: { completed: number; claimed: number; total: number };
};

export type WeeklyMissionClaimPayload = WeeklyMissionsPayload & {
  claim_result: {
    mission_id: number;
    already_claimed: boolean;
    awarded: { points: number; minigame_tickets: number; free_draw_tickets: number };
    new_points: number;
  };
};

const difficulties = new Set<WeeklyMissionDifficulty>(['easy', 'normal', 'hard']);
const statuses = new Set<WeeklyMissionStatus>(['in_progress', 'claimable', 'claimed']);
const finiteNonNegative = (value: unknown) => Number.isFinite(value) && Number(value) >= 0;
const validDate = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));

export const parseWeeklyMissionsPayload = (value: unknown): WeeklyMissionsPayload | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.week_key || '')) ||
    !validDate(payload.starts_at) || !validDate(payload.ends_at) || !validDate(payload.server_now) ||
    !Array.isArray(payload.missions) || !payload.summary || typeof payload.summary !== 'object') return null;

  const missions: WeeklyMission[] = [];
  const ids = new Set<number>();
  for (const raw of payload.missions) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const mission = raw as Record<string, unknown>;
    const id = Number(mission.id);
    const difficulty = mission.difficulty as WeeklyMissionDifficulty;
    const status = mission.status as WeeklyMissionStatus;
    if (!Number.isSafeInteger(id) || id <= 0 || ids.has(id) || !difficulties.has(difficulty) || !statuses.has(status) ||
      typeof mission.mission_code !== 'string' || typeof mission.title !== 'string' || typeof mission.description !== 'string' ||
      !finiteNonNegative(mission.progress) || !finiteNonNegative(mission.target) || Number(mission.target) <= 0 ||
      !Array.isArray(mission.conditions) || !finiteNonNegative(mission.reward_points) ||
      !finiteNonNegative(mission.reward_minigame_tickets) || !finiteNonNegative(mission.reward_free_draw_tickets) ||
      !(mission.claimed_at === null || mission.claimed_at === undefined || validDate(mission.claimed_at))) return null;
    const conditions: WeeklyMissionCondition[] = [];
    for (const rawCondition of mission.conditions) {
      if (!rawCondition || typeof rawCondition !== 'object' || Array.isArray(rawCondition)) return null;
      const condition = rawCondition as Record<string, unknown>;
      if (typeof condition.label !== 'string' || !condition.label.trim() || !finiteNonNegative(condition.progress) ||
        !finiteNonNegative(condition.target) || Number(condition.target) <= 0) return null;
      conditions.push({ label: condition.label, progress: Number(condition.progress), target: Number(condition.target) });
    }
    if (conditions.length === 0) return null;
    ids.add(id);
    missions.push({
      id,
      mission_code: mission.mission_code,
      difficulty,
      title: mission.title,
      description: mission.description,
      progress: Number(mission.progress),
      target: Number(mission.target),
      conditions,
      reward_points: Number(mission.reward_points),
      reward_minigame_tickets: Number(mission.reward_minigame_tickets),
      reward_free_draw_tickets: Number(mission.reward_free_draw_tickets),
      status,
      claimed_at: typeof mission.claimed_at === 'string' ? mission.claimed_at : null
    });
  }

  const summary = payload.summary as Record<string, unknown>;
  if (!finiteNonNegative(summary.completed) || !finiteNonNegative(summary.claimed) || !finiteNonNegative(summary.total)) return null;
  return {
    week_key: String(payload.week_key),
    starts_at: String(payload.starts_at),
    ends_at: String(payload.ends_at),
    server_now: String(payload.server_now),
    missions,
    summary: { completed: Number(summary.completed), claimed: Number(summary.claimed), total: Number(summary.total) }
  };
};

export const getWeeklyServerOffset = (serverNow: string, clientNow = Date.now()) => Date.parse(serverNow) - clientNow;

export const formatWeeklyRemaining = (endsAt: string, serverNowMs: number) => {
  const remainingMs = Math.max(0, Date.parse(endsAt) - serverNowMs);
  if (remainingMs === 0) return '이번 주 마감 · 갱신 중';
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `마감까지 ${days}일 ${hours}시간`;
  if (hours > 0) return `마감까지 ${hours}시간 ${minutes}분`;
  return `마감까지 ${minutes}분`;
};

export const weeklyProgressPercent = (mission: Pick<WeeklyMission, 'progress' | 'target'>) => (
  Math.max(0, Math.min(100, Math.round((mission.progress / mission.target) * 100)))
);
