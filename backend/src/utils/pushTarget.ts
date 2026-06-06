import { normalizeCouponCode } from './couponCode';

export const buildCouponPushUrl = (couponCode: unknown): string => {
  const normalizedCode = normalizeCouponCode(couponCode);
  if (!normalizedCode) return '/';
  return `/my-info?coupon=${encodeURIComponent(normalizedCode)}`;
};
