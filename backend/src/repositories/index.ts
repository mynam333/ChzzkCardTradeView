import { getDbMode } from '../services/db';
import { 
  IUserRepository, 
  IStreamerRepository, 
  ICouponRepository, 
  IReportRepository,
  IAnnouncementRepository,
  IUserCardRepository
} from './interfaces';
import { 
  SqliteUserRepository, 
  SqliteStreamerRepository, 
  SqliteCouponRepository, 
  SqliteReportRepository,
  SqliteAnnouncementRepository,
  SqliteUserCardRepository
} from './sqliteRepository';
import { 
  SupabaseUserRepository, 
  SupabaseStreamerRepository, 
  SupabaseCouponRepository, 
  SupabaseReportRepository,
  SupabaseAnnouncementRepository,
  SupabaseUserCardRepository
} from './supabaseRepository';

// 전역 싱글톤 리포지토리 변수 선언
export let userRepository: IUserRepository;
export let streamerRepository: IStreamerRepository;
export let couponRepository: ICouponRepository;
export let reportRepository: IReportRepository;
export let announcementRepository: IAnnouncementRepository;
export let userCardRepository: IUserCardRepository;

/**
 * 데이터베이스 커넥션이 확립된 후, 모드에 적합한 레포지토리 인스턴스를 초기화합니다.
 */
export const initRepositories = (): void => {
  const mode = getDbMode();

  if (mode === 'SUPABASE') {
    userRepository = new SupabaseUserRepository();
    streamerRepository = new SupabaseStreamerRepository();
    couponRepository = new SupabaseCouponRepository();
    reportRepository = new SupabaseReportRepository();
    announcementRepository = new SupabaseAnnouncementRepository();
    userCardRepository = new SupabaseUserCardRepository();
    console.log('[Repository] Supabase 리포지토리 레이어가 활성화되었습니다.');
  } else {
    userRepository = new SqliteUserRepository();
    streamerRepository = new SqliteStreamerRepository();
    couponRepository = new SqliteCouponRepository();
    reportRepository = new SqliteReportRepository();
    announcementRepository = new SqliteAnnouncementRepository();
    userCardRepository = new SqliteUserCardRepository();
    console.log('[Repository] 로컬 SQLite 리포지토리 레이어가 활성화되었습니다.');
  }
};
export * from './interfaces';
export * from './sqliteRepository';
export * from './supabaseRepository';
