import { getDbMode } from '../services/db';
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
  IMarketRepository,
  IMinigameRepository,
  ITitleRepository
} from './interfaces';
import {
  SqliteUserRepository,
  SqliteStreamerRepository,
  SqliteCouponRepository,
  SqliteReportRepository,
  SqliteAnnouncementRepository,
  SqliteUserCardRepository,
  SqliteTradeRepository,
  SqliteNotificationRepository,
  SqliteSystemConfigRepository,
  SqliteMarketRepository,
  SqliteMinigameRepository,
  SqliteTitleRepository
} from './sqliteRepository';
import {
  SupabaseUserRepository,
  SupabaseStreamerRepository,
  SupabaseCouponRepository,
  SupabaseReportRepository,
  SupabaseAnnouncementRepository,
  SupabaseUserCardRepository,
  SupabaseTradeRepository,
  SupabaseNotificationRepository,
  SupabaseSystemConfigRepository,
  SupabaseMarketRepository,
  SupabaseMinigameRepository,
  SupabaseTitleRepository
} from './supabaseRepository';
import {
  MysqlUserRepository,
  MysqlStreamerRepository,
  MysqlCouponRepository,
  MysqlReportRepository,
  MysqlAnnouncementRepository,
  MysqlUserCardRepository,
  MysqlTradeRepository,
  MysqlNotificationRepository,
  MysqlSystemConfigRepository,
  MysqlMarketRepository,
  MysqlMinigameRepository,
  MysqlTitleRepository
} from './mysqlRepository';

// 전역 싱글톤 리포지토리 변수 선언
export let userRepository: IUserRepository;
export let streamerRepository: IStreamerRepository;
export let couponRepository: ICouponRepository;
export let reportRepository: IReportRepository;
export let announcementRepository: IAnnouncementRepository;
export let userCardRepository: IUserCardRepository;
export let tradeRepository: ITradeRepository;
export let notificationRepository: INotificationRepository;
export let systemConfigRepository: ISystemConfigRepository;
export let marketRepository: IMarketRepository;
export let minigameRepository: IMinigameRepository;
export let titleRepository: ITitleRepository;

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
    tradeRepository = new SupabaseTradeRepository();
    notificationRepository = new SupabaseNotificationRepository();
    systemConfigRepository = new SupabaseSystemConfigRepository();
    marketRepository = new SupabaseMarketRepository();
    minigameRepository = new SupabaseMinigameRepository();
    titleRepository = new SupabaseTitleRepository();
    console.log('[Repository] Supabase 리포지토리 레이어가 활성화되었습니다.');
  } else if (mode === 'MYSQL') {
    userRepository = new MysqlUserRepository();
    streamerRepository = new MysqlStreamerRepository();
    couponRepository = new MysqlCouponRepository();
    reportRepository = new MysqlReportRepository();
    announcementRepository = new MysqlAnnouncementRepository();
    userCardRepository = new MysqlUserCardRepository();
    tradeRepository = new MysqlTradeRepository();
    notificationRepository = new MysqlNotificationRepository();
    systemConfigRepository = new MysqlSystemConfigRepository();
    marketRepository = new MysqlMarketRepository();
    minigameRepository = new MysqlMinigameRepository();
    titleRepository = new MysqlTitleRepository();
    console.log('[Repository] MySQL 리포지토리 레이어가 활성화되었습니다.');
  } else {
    userRepository = new SqliteUserRepository();
    streamerRepository = new SqliteStreamerRepository();
    couponRepository = new SqliteCouponRepository();
    reportRepository = new SqliteReportRepository();
    announcementRepository = new SqliteAnnouncementRepository();
    userCardRepository = new SqliteUserCardRepository();
    tradeRepository = new SqliteTradeRepository();
    notificationRepository = new SqliteNotificationRepository();
    systemConfigRepository = new SqliteSystemConfigRepository();
    marketRepository = new SqliteMarketRepository();
    minigameRepository = new SqliteMinigameRepository();
    titleRepository = new SqliteTitleRepository();
    console.log('[Repository] 로컬 SQLite 리포지토리 레이어가 활성화되었습니다.');
  }
};

export * from './interfaces';
export * from './sqliteRepository';
export * from './supabaseRepository';
export * from './mysqlRepository';
