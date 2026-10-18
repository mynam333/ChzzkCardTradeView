import { getSupabaseClient } from "../../services/db";
import { 
  IUserRepository, 
  IStreamerRepository, 
  ICouponRepository, 
  IReportRepository,
  IAnnouncementRepository,
  IUserCardRepository,
  ITradeRepository,
  INotificationRepository,
  ISystemConfigRepository,
  User,
  UserRanking,
  Streamer,
  StreamerScheduleResult,
  Coupon,
  CardReport,
  Announcement,
  Trade,
  AppNotification
} from '../interfaces';

// system_configs는 관리자만 가끔 바꾸는 값인데 getUserMe/getDrawSettings 등 핫패스에서
// 요청마다 여러 번 조회되어 Supabase 왕복이 누적됩니다. 짧은 TTL 캐시 + in-flight 코얼레싱으로
// 반복 왕복을 제거하고, set() 시 즉시 무효화해 관리자 변경이 곧바로 반영되게 합니다.
// 값이 없는 키는 NOT_FOUND 센티넬로 캐싱하되, 반환 시 호출자별 defaultValue로 치환합니다.
const CONFIG_NOT_FOUND = Symbol('config-not-found');
type CachedConfigValue = string | typeof CONFIG_NOT_FOUND;

export class SupabaseSystemConfigRepository implements ISystemConfigRepository {
  private static readonly CACHE_TTL_MS = Math.max(
    1_000,
    Number(process.env.SYSTEM_CONFIG_CACHE_TTL_MS || 30_000)
  );
  private cache = new Map<string, { value: CachedConfigValue; expiresAt: number }>();
  private inFlight = new Map<string, Promise<CachedConfigValue>>();

  private getClient() {
    return getSupabaseClient();
  }

  private async load(key: string): Promise<CachedConfigValue> {
    try {
      const { data, error } = await this.getClient()
        .from('system_configs')
        .select('value')
        .eq('key', key)
        .maybeSingle();

      if (error || !data) return CONFIG_NOT_FOUND;
      return data.value as string;
    } catch (e) {
      // 일시 오류는 캐싱하지 않고 호출자 defaultValue로 폴백 (다음 호출에서 재시도)
      throw e;
    }
  }

  async get(key: string, defaultValue: string, options?: { fresh?: boolean }): Promise<string> {
    if (options?.fresh) {
      try {
        const value = await this.load(key);
        this.cache.set(key, {
          value,
          expiresAt: Date.now() + SupabaseSystemConfigRepository.CACHE_TTL_MS
        });
        return value === CONFIG_NOT_FOUND ? defaultValue : value;
      } catch {
        return defaultValue;
      }
    }

    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.value === CONFIG_NOT_FOUND ? defaultValue : cached.value;
    }

    let request = this.inFlight.get(key);
    if (!request) {
      request = this.load(key)
        .then((value) => {
          this.cache.set(key, {
            value,
            expiresAt: Date.now() + SupabaseSystemConfigRepository.CACHE_TTL_MS
          });
          return value;
        })
        .finally(() => {
          this.inFlight.delete(key);
        });
      this.inFlight.set(key, request);
    }

    try {
      const value = await request;
      return value === CONFIG_NOT_FOUND ? defaultValue : value;
    } catch (e) {
      // 조회 실패 시 호출자 기본값으로 폴백 (캐시에 남기지 않음)
      return defaultValue;
    }
  }

  async set(key: string, value: string): Promise<void> {
    const { error } = await this.getClient()
      .from('system_configs')
      .upsert({ key, value }, { onConflict: 'key' });

    if (error) throw error;
    // 변경 즉시 캐시에 반영해 관리자 설정 변경이 곧바로 보이도록 함
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + SupabaseSystemConfigRepository.CACHE_TTL_MS
    });
  }
}
