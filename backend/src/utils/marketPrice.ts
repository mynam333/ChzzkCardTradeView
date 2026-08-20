const marketPriceFormatter = new Intl.NumberFormat('ko-KR', {
  maximumFractionDigits: 0
});

export const formatMarketPrice = (value: unknown): string => {
  const amount = typeof value === 'number' ? value : Number(value);
  return marketPriceFormatter.format(Number.isFinite(amount) ? Math.trunc(amount) : 0);
};
