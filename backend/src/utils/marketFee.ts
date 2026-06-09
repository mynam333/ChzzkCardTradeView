export const FIXED_MARKET_FEE_RATE = 5;

export const AUCTION_FEE_RATES: Record<number, number> = {
  1: 1,
  2: 1,
  3: 1,
  6: 2,
  12: 3,
  24: 5,
  48: 10,
  72: 15
};

export const getAuctionFeeRate = (hours: number): number => {
  const normalizedHours = Math.max(1, Math.floor(Number(hours) || 24));
  if (AUCTION_FEE_RATES[normalizedHours] !== undefined) {
    return AUCTION_FEE_RATES[normalizedHours];
  }
  return Math.max(1, Math.min(15, Math.ceil((normalizedHours / 24) * 5)));
};

export const calculateMarketFee = (price: number, feeRate: number): { fee: number; settledAmount: number } => {
  const safePrice = Math.max(0, Math.floor(Number(price) || 0));
  const safeRate = Math.max(0, Math.floor(Number(feeRate) || FIXED_MARKET_FEE_RATE));
  const fee = Math.floor(safePrice * (safeRate / 100));
  return { fee, settledAmount: Math.max(0, safePrice - fee) };
};
