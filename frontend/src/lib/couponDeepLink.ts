export const PENDING_COUPON_STORAGE_KEY = 'chikapo_pending_coupon';
export const LEGACY_PENDING_COUPON_STORAGE_KEY = 'cctv_pending_coupon';

export const normalizeCouponDeepLinkCode = (value: string | null | undefined): string =>
  (value || '').trim().toUpperCase();

export const buildCouponDeepLink = (couponCode: string): string =>
  `/my-info?coupon=${encodeURIComponent(normalizeCouponDeepLinkCode(couponCode))}`;
