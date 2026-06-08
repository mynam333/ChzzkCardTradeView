import { Request, Response } from 'express';
import { userRepository } from '../repositories';
import { getDbMode, getSqliteDb, getSupabaseClient } from '../services/db';
import { IS_PRODUCTION } from '../config';

const GACHA_REWARD_KEY = 'tutorial:gacha-free-draw-ticket:v1';

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

export const claimTutorialGachaTicket = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  try {
    const granted = await claimRewardOnce(String(userId), GACHA_REWARD_KEY);
    if (granted) {
      await userRepository.addBonusFreeDrawTickets(String(userId), 1);
    }

    const user = await userRepository.findById(String(userId));
    return res.status(200).json({
      granted,
      already_claimed: !granted,
      reward_type: 'free_draw_ticket',
      reward_amount: granted ? 1 : 0,
      bonus_free_draw_tickets: Number(user?.bonus_free_draw_tickets || 0),
      message: granted
        ? '튜토리얼 체험용 추가 무료 소환 티켓 1장을 지급했습니다.'
        : '이미 튜토리얼 체험용 무료 소환 티켓을 받은 계정입니다.'
    });
  } catch (err: any) {
    console.error('[TutorialController] claimTutorialGachaTicket 에러:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: '튜토리얼 보상 지급 중 오류가 발생했습니다.',
      details: IS_PRODUCTION ? undefined : err.message
    });
  }
};
