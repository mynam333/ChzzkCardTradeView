import { Request, Response } from 'express';
import { userRepository } from '../repositories';
import { getDbMode, getSqliteDb, getSupabaseClient } from '../services/db';
import { IS_PRODUCTION } from '../config';

const GACHA_REWARD_KEY = 'tutorial:gacha-free-draw-ticket:v1';
const TUTORIAL_COMPLETED_PREFIX = 'tutorial:completed:';

const normalizeTutorialVersion = (version: unknown): string => {
  const normalized = String(version || '').trim();
  if (!normalized || normalized.length > 80) {
    throw new Error('INVALID_TUTORIAL_VERSION');
  }
  return normalized;
};

const completedRewardKey = (version: string) => `${TUTORIAL_COMPLETED_PREFIX}${version}`;
const isDbStatementTimeout = (err: any): boolean => {
  return err?.code === '57014' || /statement timeout/i.test(String(err?.message || ''));
};

const claimTutorialGachaTicketAtomic = async (
  userId: string
): Promise<{ granted: boolean; bonusFreeDrawTickets: number } | null> => {
  if (getDbMode() !== 'SUPABASE') return null;

  const { data, error } = await getSupabaseClient().rpc('claim_tutorial_gacha_ticket', {
    p_user_id: userId,
    p_reward_key: GACHA_REWARD_KEY
  });

  if (error) {
    const missingFunction = error.code === 'PGRST202' || /claim_tutorial_gacha_ticket/i.test(error.message || '');
    if (missingFunction) {
      console.warn('[TutorialController] claim_tutorial_gacha_ticket RPC 미적용, 폴백 사용:', error.message);
      return null;
    }
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    granted: !!row?.granted,
    bonusFreeDrawTickets: Number(row?.bonus_free_draw_tickets || 0)
  };
};

const claimRewardOnce = async (userId: string, rewardKey: string): Promise<boolean> => {
  const nowIso = new Date().toISOString();

  if (getDbMode() === 'SUPABASE') {
    const { error } = await getSupabaseClient()
      .from('tutorial_rewards')
      .insert({
        user_id: userId,
        reward_key: rewardKey,
        reward_type: 'free_draw_ticket',
        reward_amount: 1,
        created_at: nowIso
      });

    if (!error) return true;
    if (error.code === '23505') return false;
    throw error;
  }

  const result = getSqliteDb()
    .prepare(`
      INSERT OR IGNORE INTO tutorial_rewards
        (user_id, reward_key, reward_type, reward_amount, created_at)
      VALUES (?, ?, 'free_draw_ticket', 1, ?)
    `)
    .run(userId, rewardKey, nowIso);

  return result.changes > 0;
};

const findTutorialCompletion = async (userId: string, version: string): Promise<string | null> => {
  const rewardKey = completedRewardKey(version);

  if (getDbMode() === 'SUPABASE') {
    const { data, error } = await getSupabaseClient()
      .from('tutorial_rewards')
      .select('created_at')
      .eq('user_id', userId)
      .eq('reward_key', rewardKey)
      .maybeSingle();

    if (error) throw error;
    return data?.created_at || null;
  }

  const row = getSqliteDb()
    .prepare('SELECT created_at FROM tutorial_rewards WHERE user_id = ? AND reward_key = ? LIMIT 1')
    .get(userId, rewardKey) as { created_at?: string } | undefined;

  return row?.created_at || null;
};

const markTutorialCompletedOnce = async (userId: string, version: string): Promise<{ completedAt: string; newlyCompleted: boolean }> => {
  const rewardKey = completedRewardKey(version);
  const nowIso = new Date().toISOString();

  if (getDbMode() === 'SUPABASE') {
    const { error } = await getSupabaseClient()
      .from('tutorial_rewards')
      .insert({
        user_id: userId,
        reward_key: rewardKey,
        reward_type: 'tutorial_progress',
        reward_amount: 0,
        created_at: nowIso
      });

    if (!error) return { completedAt: nowIso, newlyCompleted: true };
    if (error.code !== '23505') throw error;

    return {
      completedAt: await findTutorialCompletion(userId, version) || nowIso,
      newlyCompleted: false
    };
  }

  const result = getSqliteDb()
    .prepare(`
      INSERT OR IGNORE INTO tutorial_rewards
        (user_id, reward_key, reward_type, reward_amount, created_at)
      VALUES (?, ?, 'tutorial_progress', 0, ?)
    `)
    .run(userId, rewardKey, nowIso);

  if (result.changes > 0) return { completedAt: nowIso, newlyCompleted: true };
  return {
    completedAt: await findTutorialCompletion(userId, version) || nowIso,
    newlyCompleted: false
  };
};

export const getTutorialProgress = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  try {
    const version = normalizeTutorialVersion(req.query.version);
    const completedAt = await findTutorialCompletion(String(userId), version);
    return res.status(200).json({
      version,
      completed: !!completedAt,
      completed_at: completedAt
    });
  } catch (err: any) {
    if (err?.message === 'INVALID_TUTORIAL_VERSION') {
      return res.status(400).json({ error: 'BadRequest', message: '올바른 튜토리얼 버전이 필요합니다.' });
    }
    console.error('[TutorialController] getTutorialProgress 에러:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: '튜토리얼 진행 상태를 불러오는 중 오류가 발생했습니다.',
      details: IS_PRODUCTION ? undefined : err.message
    });
  }
};

export const markTutorialCompleted = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  try {
    const version = normalizeTutorialVersion(req.body?.version);
    const result = await markTutorialCompletedOnce(String(userId), version);
    return res.status(200).json({
      version,
      completed: true,
      completed_at: result.completedAt,
      newly_completed: result.newlyCompleted
    });
  } catch (err: any) {
    if (err?.message === 'INVALID_TUTORIAL_VERSION') {
      return res.status(400).json({ error: 'BadRequest', message: '올바른 튜토리얼 버전이 필요합니다.' });
    }
    console.error('[TutorialController] markTutorialCompleted 에러:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: '튜토리얼 완료 상태를 저장하는 중 오류가 발생했습니다.',
      details: IS_PRODUCTION ? undefined : err.message
    });
  }
};

export const claimTutorialGachaTicket = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  try {
    const atomicResult = await claimTutorialGachaTicketAtomic(String(userId));
    let granted: boolean;
    let bonusFreeDrawTickets: number;

    if (atomicResult) {
      granted = atomicResult.granted;
      bonusFreeDrawTickets = atomicResult.bonusFreeDrawTickets;
    } else {
      granted = await claimRewardOnce(String(userId), GACHA_REWARD_KEY);
      if (granted) {
        await userRepository.addBonusFreeDrawTickets(String(userId), 1);
      }
      const user = await userRepository.findById(String(userId));
      bonusFreeDrawTickets = Number(user?.bonus_free_draw_tickets || 0);
    }

    return res.status(200).json({
      granted,
      already_claimed: !granted,
      reward_type: 'free_draw_ticket',
      reward_amount: granted ? 1 : 0,
      bonus_free_draw_tickets: bonusFreeDrawTickets,
      message: granted
        ? '튜토리얼 체험용 추가 무료 소환 티켓 1장을 지급했습니다.'
        : '이미 튜토리얼 체험용 무료 소환 티켓을 받은 계정입니다.'
    });
  } catch (err: any) {
    console.error('[TutorialController] claimTutorialGachaTicket 에러:', err);
    if (isDbStatementTimeout(err)) {
      res.set('Retry-After', '3');
      return res.status(503).json({
        error: 'DatabaseBusy',
        message: '튜토리얼 보상 지급이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.',
        details: IS_PRODUCTION ? undefined : err.message
      });
    }
    return res.status(500).json({
      error: 'InternalServerError',
      message: '튜토리얼 보상 지급 중 오류가 발생했습니다.',
      details: IS_PRODUCTION ? undefined : err.message
    });
  }
};
