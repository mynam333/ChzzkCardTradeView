export const MAX_MARKET_PRICE = 999_999_999;

export const sanitizeMarketPriceInput = (value: string): string =>
  value.replace(/\D/g, '').slice(0, 9);
