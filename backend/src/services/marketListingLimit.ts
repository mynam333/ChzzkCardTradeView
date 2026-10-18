import { systemConfigRepository } from '../repositories';

export const MARKET_LISTING_LIMIT_CONFIG_KEY = 'market_listing_limit';
export const DEFAULT_MARKET_LISTING_LIMIT = 5;
export const MIN_MARKET_LISTING_LIMIT = 1;
export const MAX_MARKET_LISTING_LIMIT = 100;

export const parseMarketListingLimit = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  if (
    !Number.isInteger(parsed)
    || parsed < MIN_MARKET_LISTING_LIMIT
    || parsed > MAX_MARKET_LISTING_LIMIT
  ) {
    return null;
  }
  return parsed;
};

export const getMarketListingLimit = async (): Promise<number> => {
  const stored = await systemConfigRepository.get(
    MARKET_LISTING_LIMIT_CONFIG_KEY,
    String(DEFAULT_MARKET_LISTING_LIMIT),
    { fresh: true }
  );
  return parseMarketListingLimit(stored) ?? DEFAULT_MARKET_LISTING_LIMIT;
};

export const saveMarketListingLimit = async (limit: number): Promise<void> => {
  await systemConfigRepository.set(MARKET_LISTING_LIMIT_CONFIG_KEY, String(limit));
};
