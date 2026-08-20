export const MAX_MARKET_PRICE = 999_999_999;

const marketPriceFormatter = new Intl.NumberFormat('ko-KR', {
  maximumFractionDigits: 0
});

export const formatMarketPrice = (value: unknown): string => {
  const amount = typeof value === 'number' ? value : Number(value);
  return marketPriceFormatter.format(Number.isFinite(amount) ? Math.trunc(amount) : 0);
};

export const sanitizeMarketPriceInput = (value: string): string =>
  value.replace(/\D/g, '').slice(0, 9);
