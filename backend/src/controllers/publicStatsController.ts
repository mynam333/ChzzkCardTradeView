import { Request, Response } from 'express';
import { streamerRepository, userCardRepository, userRepository } from '../repositories';
import { IS_PRODUCTION } from '../config';

type PublicLandingStats = {
  user_count: number;
  streamer_count: number;
  card_distributed: number;
};

const PUBLIC_STATS_CACHE_TTL_MS = 60_000;

let cachedStats: { data: PublicLandingStats; expiresAt: number } | null = null;
let inFlightStats: Promise<PublicLandingStats> | null = null;

const loadPublicLandingStats = async (): Promise<PublicLandingStats> => {
  const [userCount, streamerCount, cardCount] = await Promise.all([
    userRepository.count(),
    streamerRepository.count(),
    userCardRepository.count()
  ]);

  return {
    user_count: userCount,
    streamer_count: streamerCount,
    card_distributed: cardCount
  };
};

export const getPublicLandingStats = async (_req: Request, res: Response) => {
  try {
    const now = Date.now();
    res.set('Cache-Control', 'public, max-age=60');

    if (cachedStats && cachedStats.expiresAt > now) {
      return res.status(200).json(cachedStats.data);
    }

    if (!inFlightStats) {
      inFlightStats = loadPublicLandingStats()
        .then((data) => {
          cachedStats = { data, expiresAt: Date.now() + PUBLIC_STATS_CACHE_TTL_MS };
          return data;
        })
        .finally(() => {
          inFlightStats = null;
        });
    }

    const data = await inFlightStats;
    return res.status(200).json(data);
  } catch (err: any) {
    return res.status(500).json({
      error: 'InternalServerError',
      message: '공개 통계 조회 실패',
      details: IS_PRODUCTION ? undefined : err.message
    });
  }
};
