// Supabase 리포지토리 배럴 — 도메인별 파일로 분리되었습니다.
// (STAR_IMAGE_COLUMNS/withStarImages는 supabase 내부 전용이라 배럴에서 재노출하지 않음)
export { SupabaseUserRepository } from "./supabase/user.repository";
export { SupabaseStreamerRepository } from "./supabase/streamer.repository";
export { SupabaseCouponRepository } from "./supabase/coupon.repository";
export { SupabaseReportRepository } from "./supabase/report.repository";
export { SupabaseAnnouncementRepository } from "./supabase/announcement.repository";
export { SupabaseUserCardRepository } from "./supabase/userCard.repository";
export { SupabaseTradeRepository } from "./supabase/trade.repository";
export { SupabaseNotificationRepository } from "./supabase/notification.repository";
export { SupabaseSystemConfigRepository } from "./supabase/systemConfig.repository";
export { SupabaseMarketRepository } from "./supabase/market.repository";
export { SupabaseMinigameRepository } from "./supabase/minigame.repository";
