'use client';

import React, { useState, useEffect } from 'react';
import { useApp } from './AppContext';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  ShieldAlert,
  LayoutDashboard,
  Tag,
  Megaphone,
  BellRing,
  AlertTriangle,
  Image as ImageIcon,
  Users,
  ArrowRightLeft,
  Layers,
  Trash2,
  RefreshCw,
  Store,
  Database,
  Gamepad2,
  Edit,
  Pin,
  Award,
  Ticket,
  Trophy,
  Activity,
  BarChart3,
  ExternalLink,
  Clock3,
  MonitorSmartphone,
  MousePointerClick,
  ShieldCheck
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import type {
  AdminReport,
  OrphanImage,
  ShopItem,
  Coupon,
  CouponReward,
  CouponRewardType,
  Announcement,
  AdminTrade,
  AdminTradeListResponse,
  TradeOffer,
  TradeStatus,
  AssetEventAssetType,
  AssetEventLogEntry,
  AssetEventListResponse,
  AssetEventSuspect,
  AssetEventSuspectResponse,
  UserTitle
} from '@/lib/types';
import { AdminUsersTab } from './AdminUsersTab';
import { parseStyle, nameEffectStyle, cardImage, borderClass, streamerProfileImage } from '@/lib/cosmetics';
import { fuzzyScore } from '@/lib/search';
import { CosmeticFrame } from './CosmeticFrame';
import { CosmeticName } from './CosmeticName';
import { AdminTitlesTab } from './AdminTitlesTab';
import { AdminAchievementsTab } from './AdminAchievementsTab';
import { formatLocalDateTime, formatLocalDateTimeInput, localDateTimeInputToIso } from '@/lib/time';
import { analyticsSettings } from '@/lib/analytics';

type AdminSubTab = 'dashboard' | 'insights' | 'users' | 'titles' | 'achievements' | 'coupons' | 'announcements' | 'push' | 'reports' | 'trades' | 'asset-events' | 'streamers' | 'shop' | 'arena' | 'maintenance';
type PushTargetType = 'default' | 'coupon';
type InsightsRange = '24h' | '7d' | '30d';

interface AdminInsights {
  enabled: boolean;
  range: InsightsRange;
  generated_at: string;
  cached_until: string | null;
  summary: {
    page_views: number;
    sessions: number;
    visitors: number;
    active_sessions_5m: number;
    avg_duration_seconds: number;
  };
  hourly: Array<{ bucket: string; views: number; sessions: number; visitors: number }>;
  active_hourly: Array<{ bucket: string; active_sessions: number; heartbeats: number }>;
  pages: Array<{ path: string; route_group: string; views: number; sessions: number; avg_duration_seconds: number; duration_samples: number }>;
  devices: Array<{ device_type: string; browser_name: string; os_name: string; views: number; sessions: number }>;
  route_groups: Array<{ route_group: string; views: number; sessions: number }>;
  navigation: Array<{ from_tab: string; to_tab: string; surface: string; count: number }>;
  notifications: Array<{ group_key: string; opens: number }>;
}

interface PushFormState {
  title: string;
  body: string;
  scheduled_at: string;
  target_type: PushTargetType;
  coupon_code: string;
}

const emptyPushForm: PushFormState = {
  title: '',
  body: '',
  scheduled_at: '',
  target_type: 'default',
  coupon_code: ''
};

const emptyCouponRewardDraft = {
  type: 'point' as CouponRewardType,
  points: 1000,
  channel_id: '',
  item_id: 0,
  title_id: 0,
  quantity: 1
};

const getAdminStreamerSearchScore = (streamer: any, query: string): number | null => {
  const nameScore = fuzzyScore(streamer?.name || '', query);
  const channelScore = fuzzyScore(streamer?.channel_id || '', query);
  if (nameScore === null && channelScore === null) return null;
  return Math.min(
    nameScore ?? Number.MAX_SAFE_INTEGER,
    channelScore === null ? Number.MAX_SAFE_INTEGER : channelScore + 200
  );
};

const filterAdminStreamers = (streamers: any[], query: string): any[] => {
  const keyword = query.trim();
  if (!keyword) return streamers;

  return streamers
    .map((streamer) => ({ streamer, score: getAdminStreamerSearchScore(streamer, keyword) }))
    .filter((item): item is { streamer: any; score: number } => item.score !== null)
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return String(a.streamer?.name || '').localeCompare(String(b.streamer?.name || ''), 'ko-KR');
    })
    .map((item) => item.streamer);
};

const insightRangeLabel: Record<InsightsRange, string> = {
  '24h': '최근 24시간',
  '7d': '최근 7일',
  '30d': '최근 30일'
};

const formatInsightDuration = (seconds: number) => {
  const safe = Math.max(0, Math.round(Number(seconds) || 0));
  if (safe < 60) return `${safe}초`;
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  if (minutes < 60) return rest ? `${minutes}분 ${rest}초` : `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const minuteRest = minutes % 60;
  return minuteRest ? `${hours}시간 ${minuteRest}분` : `${hours}시간`;
};

const routeGroupLabel = (routeGroup: string) => {
  const labels: Record<string, string> = {
    main: '메인',
    shop: '상점',
    inventory: '보관함',
    ranking: '랭킹',
    friends: '친구',
    'my-info': '내 정보',
    admin: '관리자',
    arcade: '미니게임',
    login: '로그인',
    maintenance: '점검'
  };
  return labels[routeGroup] || routeGroup || '기타';
};

export const AdminTab: React.FC = () => {
  const { user, toast, checkMaintenanceStatus } = useApp();
  const searchParams = useSearchParams();
  const router = useRouter();

  // URL tab 쿼리 파라미터를 기반으로 초기 subTab 결정
  const tabParam = searchParams.get('tab') as AdminSubTab | null;
  const initialSubTab: AdminSubTab = (
    tabParam === 'dashboard' ||
    tabParam === 'insights' ||
    tabParam === 'users' ||
    tabParam === 'titles' ||
    tabParam === 'achievements' ||
    tabParam === 'coupons' ||
    tabParam === 'announcements' ||
    tabParam === 'push' ||
    tabParam === 'reports' ||
    tabParam === 'trades' ||
    tabParam === 'asset-events' ||
    tabParam === 'streamers' ||
    tabParam === 'shop' ||
    tabParam === 'arena' ||
    tabParam === 'maintenance'
  ) ? tabParam : 'dashboard';

  const [subTab, setSubTab] = useState<AdminSubTab>(initialSubTab);

  // 외부(뒤로가기 등)에서 URL 파라미터가 바뀔 때 상태 동기화
  useEffect(() => {
    const param = searchParams.get('tab') as AdminSubTab | null;
    if (param && [
      'dashboard', 'insights', 'users', 'titles', 'achievements', 'coupons', 'announcements',
      'push', 'reports', 'trades', 'asset-events', 'streamers', 'shop', 'arena', 'maintenance'
    ].includes(param)) {
      setSubTab(param);
    }
  }, [searchParams]);

  // 서브 탭 전환 시 URL 쿼리 파라미터 동기화
  const handleSubTabChange = (tab: AdminSubTab) => {
    setSubTab(tab);
    const newParams = new URLSearchParams(window.location.search);
    newParams.set('tab', tab);
    router.push(`/admin?${newParams.toString()}`);
  };

  // 대시보드
  const [stats, setStats] = useState<any | null>(null);
  const [insightsRange, setInsightsRange] = useState<InsightsRange>('7d');
  const [insights, setInsights] = useState<AdminInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState('');
  const [arenaOps, setArenaOps] = useState<any | null>(null);
  const [arenaStats, setArenaStats] = useState<any | null>(null);
  const [arenaQuick, setArenaQuick] = useState<any | null>(null);
  const [arenaCups, setArenaCups] = useState<any | null>(null);
  const [arenaJobs, setArenaJobs] = useState<any[]>([]);
  const [arenaLoading, setArenaLoading] = useState(false);
  const [arenaActionLoading, setArenaActionLoading] = useState('');

  // 스트리머 이미지 검색/페이지네이션
  const [streamerSearch, setStreamerSearch] = useState('');
  const [streamerPage, setStreamerPage] = useState(1);

  // 스트리머 카드 삭제(폐기) 검색/페이지네이션/확인
  const [delSearch, setDelSearch] = useState('');
  const [delPage, setDelPage] = useState(1);
  const [delTarget, setDelTarget] = useState<any | null>(null);
  const [delPreventReregistration, setDelPreventReregistration] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 유지보수: DB 초기화 + 미사용 이미지
  const [resetInfo, setResetInfo] = useState<any[]>([]);
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [orphans, setOrphans] = useState<OrphanImage[]>([]);
  const [orphanInfo, setOrphanInfo] = useState<{ total_files: number; referenced: number } | null>(null);
  const [selectedOrphans, setSelectedOrphans] = useState<string[]>([]);
  const [orphanLoading, setOrphanLoading] = useState(false);
  const [deletingOrphans, setDeletingOrphans] = useState(false);

  // 상점 관리
  const [shopItems, setShopItems] = useState<ShopItem[]>([]);
  const emptyShopForm = { id: 0, type: 'border' as ShopItem['type'], name: '', description: '', price: 1000, style_json: '', font_url: '', font_family: '', active: true, purchase_limit: 0, sale_start_at: '', sale_end_at: '', limited_total_quantity: 0, sold_quantity: 0 };
  const [shopForm, setShopForm] = useState({ ...emptyShopForm });
  const [shopEmoteUploading, setShopEmoteUploading] = useState(false);
  const [freeDrawInterval, setFreeDrawInterval] = useState('24');
  const [freeDrawMaxStack, setFreeDrawMaxStack] = useState('1');
  const [isSavingInterval, setIsSavingInterval] = useState(false);
  const [minigameTicketChargeMinutes, setMinigameTicketChargeMinutes] = useState('240');
  const [isSavingMinigameTicketCharge, setIsSavingMinigameTicketCharge] = useState(false);
  const [drawCost, setDrawCost] = useState('10000');           // 뽑기 1회 비용 (P)
  const [isSavingCost, setIsSavingCost] = useState(false);    // 뽑기 비용 저장 중 여부

  // 쿠폰
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [couponStreamers, setCouponStreamers] = useState<any[]>([]);
  const [couponStreamerSearch, setCouponStreamerSearch] = useState('');
  const [couponForm, setCouponForm] = useState({
    code: '',
    coupon_type: 'single' as 'single' | 'multi',
    rewards: [] as CouponReward[],
    max_uses: 1,
    expires_at: ''
  });
  const [couponRewardDraft, setCouponRewardDraft] = useState({ ...emptyCouponRewardDraft });
  // 쿠폰 코스메틱 보상용 상점 아이템 목록
  const [couponCosmetics, setCouponCosmetics] = useState<any[]>([]);
  const [couponTitles, setCouponTitles] = useState<UserTitle[]>([]);

  // 공지
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const emptyNoticeForm = { title: '', content: '', is_popup: false, is_pinned: false };
  const [noticeForm, setNoticeForm] = useState({ ...emptyNoticeForm });
  const [editingNoticeId, setEditingNoticeId] = useState<number | null>(null);

  // 푸시
  const [pushForm, setPushForm] = useState<PushFormState>({ ...emptyPushForm });
  const [scheduledPushes, setScheduledPushes] = useState<any[]>([]);
  const [sentPushes, setSentPushes] = useState<any[]>([]);
  const [sentPushesPage, setSentPushesPage] = useState(1);
  const [sentPushesTotalPages, setSentPushesTotalPages] = useState(1);
  const [editingPushId, setEditingPushId] = useState<number | null>(null);
  const [editingForm, setEditingForm] = useState<PushFormState>({ ...emptyPushForm });

  // 신고/밴
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [preventReregistrationByReport, setPreventReregistrationByReport] = useState<Record<number, boolean>>({});
  const [banUserId, setBanUserId] = useState('');
  const [banReason, setBanReason] = useState('');

  // 1:1 거래 감사
  const [adminTrades, setAdminTrades] = useState<AdminTrade[]>([]);
  const [adminTradesSearch, setAdminTradesSearch] = useState('');
  const [adminTradesStatus, setAdminTradesStatus] = useState<TradeStatus | 'ALL'>('ALL');
  const [adminTradesPage, setAdminTradesPage] = useState(1);
  const [adminTradesTotalPages, setAdminTradesTotalPages] = useState(1);
  const [adminTradesTotal, setAdminTradesTotal] = useState(0);
  const [adminTradesLoading, setAdminTradesLoading] = useState(false);

  // 자산 감사 기록
  const [assetEvents, setAssetEvents] = useState<AssetEventLogEntry[]>([]);
  const [assetEventsNextBeforeId, setAssetEventsNextBeforeId] = useState<number | null>(null);
  const [assetEventsLoading, setAssetEventsLoading] = useState(false);
  const [assetEventSearch, setAssetEventSearch] = useState('');
  const [assetEventType, setAssetEventType] = useState<AssetEventAssetType | 'ALL'>('ALL');
  const [assetEventSource, setAssetEventSource] = useState('ALL');
  const [assetSuspects, setAssetSuspects] = useState<AssetEventSuspect[]>([]);
  const [assetSuspectSearch, setAssetSuspectSearch] = useState('');
  const [assetSuspectsLoading, setAssetSuspectsLoading] = useState(false);

  // 스트리머 이미지 관리
  const [streamerChannelId, setStreamerChannelId] = useState('');
  const [imageResetConfirm, setImageResetConfirm] = useState<{ channelId: string; name?: string; star?: number; imageUrl?: string | null } | null>(null);
  const [resettingStreamerImage, setResettingStreamerImage] = useState(false);
  const [missingProfileStreamers, setMissingProfileStreamers] = useState<any[]>([]);
  const [missingProfileSummary, setMissingProfileSummary] = useState({
    count: 0,
    total_cards: 0,
    total_affected_users: 0
  });
  const [missingProfileLoading, setMissingProfileLoading] = useState(false);
  const [deletingMissingProfiles, setDeletingMissingProfiles] = useState(false);

  // 서비스 점검 설정 상태
  const [mStartAt, setMStartAt] = useState('');
  const [mEndAt, setMEndAt] = useState('');
  const [mActive, setMActive] = useState(false);
  const [isSavingMaintenance, setIsSavingMaintenance] = useState(false);

  // 제재 유저 관리 상태
  const [bannedUsers, setBannedUsers] = useState<any[]>([]);
  const [bannedSearch, setBannedSearch] = useState('');
  const [bannedPage, setBannedPage] = useState(1);
  const [bannedTotalPages, setBannedTotalPages] = useState(1);
  const [bannedSortBy, setBannedSortBy] = useState('banned_until');
  const [bannedSortOrder, setBannedSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedBannedUserIds, setSelectedBannedUserIds] = useState<string[]>([]);
  const [bulkBanDuration, setBulkBanDuration] = useState('1d');
  const [bulkBanReason, setBulkBanReason] = useState('');
  const [isBannedUsersLoading, setIsBannedUsersLoading] = useState(false);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);

  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    if (!isAdmin) return;
    if (subTab === 'dashboard') fetchStats();
    if (subTab === 'coupons') { fetchCoupons(); fetchCouponStreamers(); fetchCouponCosmetics(); fetchCouponTitles(); }
    if (subTab === 'announcements') fetchAnnouncements();
    if (subTab === 'reports') {
      fetchReports();
      fetchBannedUsers(1, bannedSearch, bannedSortBy, bannedSortOrder);
    }
    if (subTab === 'trades') {
      fetchAdminTrades(adminTradesPage, adminTradesSearch, adminTradesStatus);
    }
    if (subTab === 'asset-events') {
      fetchAssetEvents(true);
      fetchAssetSuspects();
    }
    if (subTab === 'streamers') {
      fetchCouponStreamers(true);
      fetchMissingProfileStreamers();
    }
    if (subTab === 'shop') {
      fetchShopItems();
      fetchFreeDrawInterval();
      fetchMinigameTicketChargeInterval();
      fetchDrawCost();
    }
    if (subTab === 'arena') {
      fetchArenaAdminData();
    }
    if (subTab === 'push') {
      fetchScheduledPushes();
      fetchSentPushes(sentPushesPage);
    }
    if (subTab === 'maintenance') {
      fetchResetInfo();
      fetchOrphans();
      fetchMaintenanceStatus();
    }
  }, [subTab, isAdmin, sentPushesPage]);

  useEffect(() => {
    if (!isAdmin || subTab !== 'insights') return;
    fetchInsights(insightsRange);
  }, [insightsRange, subTab, isAdmin]);

  useEffect(() => {
    if (!isAdmin || subTab !== 'trades') return;
    const t = setTimeout(() => {
      setAdminTradesPage(1);
      fetchAdminTrades(1, adminTradesSearch, adminTradesStatus);
    }, 300);
    return () => clearTimeout(t);
  }, [adminTradesSearch, adminTradesStatus, subTab, isAdmin]);

  useEffect(() => {
    if (!isAdmin || subTab !== 'trades') return;
    fetchAdminTrades(adminTradesPage, adminTradesSearch, adminTradesStatus);
  }, [adminTradesPage]);

  useEffect(() => {
    if (!isAdmin || subTab !== 'asset-events') return;
    const t = setTimeout(() => {
      fetchAssetEvents(true);
    }, 300);
    return () => clearTimeout(t);
  }, [assetEventSearch, assetEventType, assetEventSource, subTab, isAdmin]);

  useEffect(() => {
    if (!isAdmin || subTab !== 'asset-events') return;
    const t = setTimeout(() => {
      fetchAssetSuspects(assetSuspectSearch);
    }, 350);
    return () => clearTimeout(t);
  }, [assetSuspectSearch, subTab, isAdmin]);

  // 제재 유저 검색/정렬 변경 시 재조회 (디바운스 포함)
  useEffect(() => {
    if (!isAdmin || subTab !== 'reports') return;
    const t = setTimeout(() => {
      setBannedPage(1);
      fetchBannedUsers(1, bannedSearch, bannedSortBy, bannedSortOrder);
    }, 300);
    return () => clearTimeout(t);
  }, [bannedSearch, bannedSortBy, bannedSortOrder, subTab, isAdmin]);

  // 제재 유저 페이지 변경 시 재조회
  useEffect(() => {
    if (!isAdmin || subTab !== 'reports') return;
    fetchBannedUsers(bannedPage, bannedSearch, bannedSortBy, bannedSortOrder);
  }, [bannedPage]);

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ShieldAlert className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-xl font-black">접근 권한이 없습니다</h2>
        <p className="mt-2 text-xs text-muted-foreground">관리자(ADMIN) 권한이 있는 계정만 접근할 수 있습니다.</p>
      </div>
    );
  }

  // ---- API 호출 ----
  const fetchStats = async () => {
    try {
      const res = await apiFetch('/admin/stats');
      if (res.ok) setStats(await res.json());
    } catch { /* noop */ }
  };
  const fetchInsights = async (range: InsightsRange = insightsRange) => {
    setInsightsLoading(true);
    setInsightsError('');
    try {
      const res = await apiFetch(`/admin/insights?range=${encodeURIComponent(range)}`);
      const data = await res.json();
      if (!res.ok) {
        setInsightsError(data.message || '사이트 인사이트를 불러오지 못했습니다.');
        return;
      }
      setInsights(data as AdminInsights);
    } catch {
      setInsightsError('사이트 인사이트 조회 중 통신 오류가 발생했습니다.');
    } finally {
      setInsightsLoading(false);
    }
  };

  const fetchArenaAdminData = async () => {
    setArenaLoading(true);
    try {
      const [opsRes, statsRes, quickRes, cupsRes, jobsRes] = await Promise.all([
        apiFetch('/admin/arena/system'),
        apiFetch('/admin/arena/stats?limit=300'),
        apiFetch('/admin/arena/quick-match'),
        apiFetch('/admin/arena/cups'),
        apiFetch('/admin/arena/jobs?limit=8')
      ]);
      if (opsRes.ok) {
        const opsData = await opsRes.json();
        setArenaOps(opsData.data || opsData);
      }
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setArenaStats(statsData.data || statsData);
      }
      if (quickRes.ok) {
        const quickData = await quickRes.json();
        setArenaQuick(quickData.data || quickData);
      }
      if (jobsRes.ok) {
        const jobsData = await jobsRes.json();
        setArenaJobs(jobsData.data?.items || jobsData.items || []);
      }
      if (cupsRes.ok) {
        const cupsData = await cupsRes.json();
        setArenaCups(cupsData.data || cupsData);
      }
    } catch {
      toast('아레나 관리자 정보를 불러오지 못했습니다.', 'error');
    } finally {
      setArenaLoading(false);
    }
  };

  const runArenaAdminAction = async (kind: 'stats' | 'rankings' | 'prune' | 'recoverCup' | 'recoverQuick') => {
    setArenaActionLoading(kind);
    try {
      const endpoint = kind === 'stats'
        ? '/admin/arena/stats/rebuild'
        : kind === 'rankings'
          ? '/admin/arena/rankings/rebuild'
          : kind === 'recoverCup'
            ? '/admin/arena/cups/recover-queue'
            : kind === 'recoverQuick'
              ? '/admin/arena/quick-match/recover-queue'
            : '/admin/arena/matches/prune-logs';
      const body = kind === 'prune'
        ? { retention_days: 7, limit: 200 }
        : kind === 'recoverCup' || kind === 'recoverQuick'
          ? {}
          : { limit: 1000 };
      const res = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Arena admin action failed');
      toast(kind === 'stats' ? '아레나 통계 스냅샷 재생성 작업을 등록했습니다.' : kind === 'rankings' ? '아레나 랭킹 스냅샷 재생성 작업을 등록했습니다.' : kind === 'recoverCup' ? '아레나 컵 큐를 복구했습니다.' : kind === 'recoverQuick' ? '아레나 빠른대전 큐를 복구했습니다.' : '아레나 리플레이 정리 작업을 등록했습니다.', 'success');
      await fetchArenaAdminData();
    } catch (err: any) {
      toast(err?.message || '아레나 관리자 작업에 실패했습니다.', 'error');
    } finally {
      setArenaActionLoading('');
    }
  };
  const fetchCoupons = async () => {
    try {
      const res = await apiFetch('/admin/coupons');
      if (res.ok) setCoupons(await res.json());
    } catch { /* noop */ }
  };
  const fetchCouponCosmetics = async () => {
    try {
      const res = await apiFetch('/admin/shop/items');
      if (res.ok) setCouponCosmetics(await res.json());
    } catch { /* noop */ }
  };
  const fetchCouponTitles = async () => {
    try {
      const res = await apiFetch('/admin/titles');
      if (res.ok) setCouponTitles(await res.json());
    } catch { /* noop */ }
  };
  const fetchCouponStreamers = async (force = false) => {
    if (!force && couponStreamers.length > 0) return;
    try {
      const res = await apiFetch('/streamers');
      if (res.ok) setCouponStreamers(await res.json());
    } catch { /* noop */ }
  };
  async function fetchMissingProfileStreamers() {
    setMissingProfileLoading(true);
    try {
      const res = await apiFetch('/admin/streamers/missing-profile-images');
      if (res.ok) {
        const data = await res.json();
        setMissingProfileStreamers(data.streamers || []);
        setMissingProfileSummary({
          count: data.count || 0,
          total_cards: data.total_cards || 0,
          total_affected_users: data.total_affected_users || 0
        });
      }
    } catch { /* noop */ } finally { setMissingProfileLoading(false); }
  }
  // 카드 보상 쿠폰 목록 표시용 채널ID→이름 매핑
  const streamerName = (channelId: string) =>
    couponStreamers.find((s) => s.channel_id === channelId)?.name || channelId;
  const couponItemName = (itemId?: number | null) =>
    couponCosmetics.find((it) => it.id === itemId)?.name || `아이템#${itemId}`;
  const couponTitleName = (titleId?: number | null) =>
    couponTitles.find((title) => title.id === titleId)?.name || `칭호#${titleId}`;
  const couponRewards = (coupon: Coupon): CouponReward[] => {
    if (Array.isArray(coupon.rewards) && coupon.rewards.length > 0) return coupon.rewards;
    if (coupon.reward_type === 'point') return [{ type: 'point', points: coupon.points || 0 }];
    if (coupon.reward_type === 'card') return [{ type: 'card', channel_id: coupon.reward_channel_id, quantity: coupon.reward_quantity || 0 }];
    if (coupon.reward_type === 'cosmetic') return [{ type: 'cosmetic', item_id: coupon.reward_item_id, quantity: coupon.reward_quantity || 0 }];
    if (coupon.reward_type === 'title') return [{ type: 'title', title_id: coupon.reward_item_id || null }];
    return [{ type: coupon.reward_type, quantity: coupon.reward_quantity || 0 }];
  };
  const rewardText = (reward: CouponReward) => {
    if (reward.type === 'point') return `💰 ${(reward.points || 0).toLocaleString()}P`;
    if (reward.type === 'card') return `🃏 ${reward.label || streamerName(reward.channel_id || '')} 카드 ×${(reward.quantity || 0).toLocaleString()}`;
    if (reward.type === 'cosmetic') return `🎨 ${reward.label || couponItemName(reward.item_id)} ×${(reward.quantity || 0).toLocaleString()}`;
    if (reward.type === 'title') return `🏅 ${reward.label || couponTitleName(reward.title_id)} 칭호`;
    if (reward.type === 'minigame_ticket') return `🎮 추가 미니게임 티켓 ×${(reward.quantity || 0).toLocaleString()}`;
    return `🎟 추가 무료 소환 티켓 ×${(reward.quantity || 0).toLocaleString()}`;
  };
  const addCouponReward = () => {
    const type = couponRewardDraft.type;
    let reward: CouponReward | null = null;
    if (type === 'point') {
      if (!couponRewardDraft.points || couponRewardDraft.points <= 0) {
        toast('지급할 포인트를 입력해 주세요.');
        return;
      }
      reward = { type, points: Number(couponRewardDraft.points) };
    } else if (type === 'card') {
      if (!couponRewardDraft.channel_id) {
        toast('지급할 스트리머 카드를 선택해 주세요.');
        return;
      }
      if (!couponRewardDraft.quantity || couponRewardDraft.quantity <= 0) {
        toast('지급할 카드 수량을 입력해 주세요.');
        return;
      }
      reward = { type, channel_id: couponRewardDraft.channel_id, quantity: Number(couponRewardDraft.quantity) };
    } else if (type === 'cosmetic') {
      if (!couponRewardDraft.item_id) {
        toast('지급할 코스메틱 아이템을 선택해 주세요.');
        return;
      }
      if (!couponRewardDraft.quantity || couponRewardDraft.quantity <= 0) {
        toast('지급할 코스메틱 수량을 입력해 주세요.');
        return;
      }
      reward = { type, item_id: Number(couponRewardDraft.item_id), quantity: Number(couponRewardDraft.quantity) };
    } else if (type === 'title') {
      if (!couponRewardDraft.title_id) {
        toast('지급할 칭호를 선택해 주세요.');
        return;
      }
      reward = { type, title_id: Number(couponRewardDraft.title_id) };
    } else {
      if (!couponRewardDraft.quantity || couponRewardDraft.quantity <= 0) {
        toast(type === 'free_draw_ticket' ? '지급할 추가 무료 소환 티켓 수량을 입력해 주세요.' : '지급할 추가 미니게임 티켓 수량을 입력해 주세요.');
        return;
      }
      reward = { type, quantity: Number(couponRewardDraft.quantity) };
    }
    setCouponForm((prev) => ({ ...prev, rewards: [...prev.rewards, reward!] }));
  };
  const removeCouponReward = (index: number) => {
    setCouponForm((prev) => ({ ...prev, rewards: prev.rewards.filter((_, i) => i !== index) }));
  };
  const fetchAnnouncements = async () => {
    try {
      const res = await apiFetch('/announcements');
      if (res.ok) setAnnouncements(await res.json());
    } catch { /* noop */ }
  };
  const fetchReports = async () => {
    try {
      const res = await apiFetch('/admin/reports');
      if (res.ok) setReports(await res.json());
    } catch { /* noop */ }
  };
  const fetchAdminTrades = async (page = adminTradesPage, keyword = adminTradesSearch, status = adminTradesStatus) => {
    try {
      setAdminTradesLoading(true);
      const params = new URLSearchParams({
        page: String(page),
        limit: '30',
        status
      });
      const trimmed = keyword.trim();
      if (trimmed) params.set('search', trimmed);
      const res = await apiFetch(`/admin/trades?${params.toString()}`);
      if (!res.ok) {
        toast('1:1 거래 내역을 불러오지 못했습니다.');
        return;
      }
      const data = await res.json() as AdminTradeListResponse;
      setAdminTrades(data.items || []);
      setAdminTradesTotal(data.total || 0);
      setAdminTradesTotalPages(data.total_pages || 1);
      setAdminTradesPage(data.page || page);
    } catch {
      toast('서버 통신 에러');
    } finally {
      setAdminTradesLoading(false);
    }
  };

  const fetchAssetEvents = async (reset = true) => {
    if (!reset && !assetEventsNextBeforeId) return;
    try {
      setAssetEventsLoading(true);
      const params = new URLSearchParams({ limit: '50' });
      if (!reset && assetEventsNextBeforeId) params.set('before_id', String(assetEventsNextBeforeId));
      if (assetEventType !== 'ALL') params.set('asset_type', assetEventType);
      if (assetEventSource !== 'ALL') params.set('source_type', assetEventSource);
      const trimmed = assetEventSearch.trim();
      if (trimmed) params.set('search', trimmed);
      const res = await apiFetch(`/admin/asset-events?${params.toString()}`);
      if (!res.ok) {
        toast('자산 기록을 불러오지 못했습니다.', 'error');
        return;
      }
      const data = await res.json() as AssetEventListResponse;
      setAssetEvents((prev) => reset ? (data.entries || []) : [...prev, ...(data.entries || [])]);
      setAssetEventsNextBeforeId(data.next_before_id || null);
    } catch {
      toast('서버 통신 에러', 'error');
    } finally {
      setAssetEventsLoading(false);
    }
  };

  const fetchAssetSuspects = async (searchOverride = assetSuspectSearch) => {
    try {
      setAssetSuspectsLoading(true);
      const params = new URLSearchParams({ days: '7', limit: '50' });
      const keyword = searchOverride.trim();
      if (keyword) params.set('search', keyword);
      const res = await apiFetch(`/admin/asset-events/suspects?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json() as AssetEventSuspectResponse;
      setAssetSuspects(data.items || []);
    } catch {
      /* noop */
    } finally {
      setAssetSuspectsLoading(false);
    }
  };

  const handleCreateCoupon = async () => {
    if (couponForm.rewards.length === 0) {
      toast('쿠폰에 지급할 보상을 1개 이상 추가해 주세요.');
      return;
    }
    // 만료 일시는 datetime-local → ISO 변환
    const payload = {
      ...couponForm,
      expires_at: localDateTimeInputToIso(couponForm.expires_at)
    };
    try {
      const res = await apiFetch('/admin/coupons', { method: 'POST', body: JSON.stringify(payload) });
      const data = await res.json();
      if (res.ok) {
        toast(`쿠폰이 발급되었습니다.\n코드: ${data.code}`);
        setCouponForm({ code: '', coupon_type: 'single', rewards: [], max_uses: 1, expires_at: '' });
        setCouponRewardDraft({ ...emptyCouponRewardDraft });
        setCouponStreamerSearch('');
        fetchCoupons();
      } else {
        toast(data.message || '쿠폰 발급 오류');
      }
    } catch { toast('서버 통신 에러'); }
  };

  const handleCreateAnnouncement = async () => {
    if (!noticeForm.title.trim() || !noticeForm.content.trim()) {
      toast('제목과 내용을 입력해 주세요.');
      return;
    }
    try {
      const res = await apiFetch('/admin/announcements', { method: 'POST', body: JSON.stringify(noticeForm) });
      if (res.ok) {
        toast('공지사항이 등록되었습니다.');
        setNoticeForm({ ...emptyNoticeForm });
        fetchAnnouncements();
      } else toast('등록 실패');
    } catch { toast('서버 통신 에러'); }
  };

  const handleUpdateAnnouncement = async () => {
    if (!editingNoticeId) return;
    if (!noticeForm.title.trim() || !noticeForm.content.trim()) {
      toast('제목과 내용을 입력해 주세요.');
      return;
    }
    try {
      const res = await apiFetch(`/admin/announcements/${editingNoticeId}`, {
        method: 'PUT',
        body: JSON.stringify(noticeForm)
      });
      if (res.ok) {
        toast('공지사항이 수정되었습니다.');
        setNoticeForm({ ...emptyNoticeForm });
        setEditingNoticeId(null);
        fetchAnnouncements();
      } else toast('수정 실패');
    } catch { toast('서버 통신 에러'); }
  };

  const handleStartEditAnnouncement = (a: Announcement) => {
    setEditingNoticeId(a.id);
    setNoticeForm({
      title: a.title,
      content: a.content,
      is_popup: !!a.is_popup,
      is_pinned: !!a.is_pinned
    });
  };

  const handleCancelEditAnnouncement = () => {
    setEditingNoticeId(null);
    setNoticeForm({ ...emptyNoticeForm });
  };

  const handleTogglePopup = async (a: any) => {
    try {
      const res = await apiFetch(`/admin/announcements/${a.id}/popup`, {
        method: 'POST',
        body: JSON.stringify({ is_popup: !a.is_popup, popup_expires_at: a.popup_expires_at || null })
      });
      const data = await res.json();
      if (res.ok) {
        toast(data.message || '변경되었습니다.', 'success');
        fetchAnnouncements();
      } else toast(data.message || '변경 실패', 'error');
    } catch { toast('서버 통신 에러', 'error'); }
  };

  const handleTogglePinned = async (a: Announcement) => {
    try {
      const res = await apiFetch(`/admin/announcements/${a.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_pinned: !a.is_pinned })
      });
      if (res.ok) {
        toast(a.is_pinned ? '공지 고정을 해제했습니다.' : '공지를 맨 위에 고정했습니다.', 'success');
        fetchAnnouncements();
      } else {
        const data = await res.json();
        toast(data.message || '고정 상태 변경 실패', 'error');
      }
    } catch {
      toast('서버 통신 에러', 'error');
    }
  };

  const handleDeleteAnnouncement = async (id: number) => {
    if (!confirm('이 공지사항을 삭제하시겠습니까?')) return;
    try {
      const res = await apiFetch(`/admin/announcements/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast('삭제되었습니다.');
        fetchAnnouncements();
      } else toast('삭제 실패');
    } catch { toast('서버 통신 에러'); }
  };

  const handleSchedulePush = async () => {
    if (!pushForm.title.trim() || !pushForm.body.trim()) {
      toast('알림 제목과 본문을 입력해 주세요.');
      return;
    }
    if (pushForm.target_type === 'coupon' && !pushForm.coupon_code.trim()) {
      toast('푸시에 사용할 쿠폰 코드를 입력해 주세요.');
      return;
    }
    try {
      const payload = {
        title: pushForm.title,
        body: pushForm.body,
        scheduled_at: localDateTimeInputToIso(pushForm.scheduled_at),
        coupon_code: pushForm.target_type === 'coupon' ? pushForm.coupon_code : ''
      };
      const res = await apiFetch('/admin/push/schedule', { method: 'POST', body: JSON.stringify(payload) });
      const data = await res.json();
      if (res.ok) {
        toast(data.message || '푸시가 등록되었습니다.');
        setPushForm({ ...emptyPushForm });
        fetchScheduledPushes();
        fetchSentPushes(sentPushesPage);
      } else toast(data.message || '푸시 등록 실패');
    } catch { toast('서버 통신 에러'); }
  };

  const fetchScheduledPushes = async () => {
    try {
      const res = await apiFetch('/admin/push/scheduled');
      if (res.ok) setScheduledPushes(await res.json());
    } catch { /* noop */ }
  };

  const fetchSentPushes = async (page = sentPushesPage) => {
    try {
      const res = await apiFetch(`/admin/push/sent?page=${page}&limit=10`);
      if (res.ok) {
        const data = await res.json();
        setSentPushes(data.notifications || []);
        setSentPushesTotalPages(data.total_pages || 1);
      }
    } catch { /* noop */ }
  };

  const handleUpdatePush = async (id: number) => {
    if (!editingForm.title.trim() || !editingForm.body.trim()) {
      toast('알림 제목과 본문을 입력해 주세요.');
      return;
    }
    if (editingForm.target_type === 'coupon' && !editingForm.coupon_code.trim()) {
      toast('푸시에 사용할 쿠폰 코드를 입력해 주세요.');
      return;
    }
    try {
      const payload = {
        title: editingForm.title,
        body: editingForm.body,
        scheduled_at: localDateTimeInputToIso(editingForm.scheduled_at),
        coupon_code: editingForm.target_type === 'coupon' ? editingForm.coupon_code : ''
      };
      const res = await apiFetch(`/admin/push/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        toast('예약된 푸시 알림이 수정되었습니다.');
        setEditingPushId(null);
        fetchScheduledPushes();
        fetchSentPushes(sentPushesPage);
      } else {
        toast(data.message || '푸시 수정 실패');
      }
    } catch { toast('서버 통신 에러'); }
  };

  const handleDeletePush = async (id: number) => {
    if (!confirm('이 푸시 예약을 취소(삭제)하시겠습니까?')) return;
    try {
      const res = await apiFetch(`/admin/push/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        toast('푸시 예약이 취소되었습니다.');
        fetchScheduledPushes();
      } else {
        toast(data.message || '푸시 취소 실패');
      }
    } catch { toast('서버 통신 에러'); }
  };

  const startEditPush = (push: any) => {
    setEditingPushId(push.id);
    setEditingForm({
      title: push.title,
      body: push.body,
      scheduled_at: formatLocalDateTimeInput(push.scheduled_at),
      target_type: push.coupon_code ? 'coupon' : 'default',
      coupon_code: push.coupon_code || ''
    });
  };

  const handleResolveReport = async (
    reportId: number,
    status: 'resolved' | 'rejected',
    resolution?: { action?: string; detail?: string }
  ) => {
    try {
      const res = await apiFetch(`/admin/reports/${reportId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          status,
          resolution_action: resolution?.action,
          resolution_detail: resolution?.detail
        })
      });
      if (res.ok) {
        toast(`신고가 ${status === 'resolved' ? '처리' : '기각'}되었습니다.`);
        fetchReports();
      } else toast('처리 실패');
    } catch { toast('서버 통신 에러'); }
  };

  const isSelfDeletionReport = (report: AdminReport) => report.reason.startsWith('[본인 카드 삭제 요청]');

  const handleDeleteStreamerFromReport = async (report: AdminReport) => {
    const preventReregistration = preventReregistrationByReport[report.id] === true;
    const extraWarning = preventReregistration
      ? '\n\n재등록 금지가 함께 적용되어 이후 같은 채널 ID로 카드 등록이 차단됩니다.'
      : '';
    if (!window.confirm(`[${report.streamer_name || report.channel_id}] 카드를 삭제하고 보유자에게 보상 지급 후 신고를 처리할까요?${extraWarning}`)) return;
    try {
      const res = await apiFetch(`/admin/streamers/${report.channel_id}/delete`, {
        method: 'POST',
        body: JSON.stringify({
          confirmation: report.channel_id,
          prevent_reregistration: preventReregistration
        })
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.message || '카드 삭제 처리에 실패했습니다.', 'error');
        return;
      }
      toast(data.message || '카드 삭제 요청을 처리했습니다.', 'success');
      fetchReports();
      setPreventReregistrationByReport((prev) => {
        const next = { ...prev };
        delete next[report.id];
        return next;
      });
      fetchCouponStreamers(true);
      fetchStats();
    } catch {
      toast('서버 통신 에러', 'error');
    }
  };

  const handleReportedImageAction = async (report: AdminReport, action: 'reset' | 'ban') => {
    const label = action === 'reset'
      ? `${report.star || 0}성 신고 이미지를 기본 이미지로 초기화`
      : '해당 스트리머의 이미지 업로드 권한 차단 및 전체 이미지 초기화';
    if (!window.confirm(`[${report.streamer_name || report.channel_id}] ${label}할까요?`)) return;

    try {
      const body = action === 'reset' ? JSON.stringify({ star: report.star || 0 }) : undefined;
      const res = await apiFetch(`/admin/streamers/${report.channel_id}/image/${action}`, {
        method: 'POST',
        ...(body ? { body } : {})
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.message || '이미지 조치에 실패했습니다.', 'error');
        return;
      }
      toast(data.message || '이미지 조치를 완료했습니다.', 'success');
      await handleResolveReport(report.id, 'resolved', {
        action: label,
        detail: action === 'reset'
          ? `${report.star || 0}성 신고 이미지가 기본 이미지로 초기화되었습니다.`
          : '해당 스트리머의 이미지 업로드 권한이 차단되었고 등록된 카드 이미지가 초기화되었습니다.'
      });
      fetchCouponStreamers(true);
    } catch {
      toast('서버 통신 에러', 'error');
    }
  };

  const handleOpenReportPuzzlePractice = (report: AdminReport) => {
    const params = new URLSearchParams({
      practice: 'puzzle',
      channel: report.channel_id,
      star: String(report.star || 0),
      image: report.reported_image_url
    });
    window.open(`/arcade?${params.toString()}`, '_blank', 'noopener,noreferrer');
  };

  const handleExcludeReportImageFromPuzzle = async (report: AdminReport) => {
    if (!window.confirm(`신고 #${report.id}의 스냅샷 이미지를 3x4 퍼즐 일반 출제에서 제외할까요?\n\n같은 이미지 URL 계열도 함께 제외됩니다.`)) return;

    try {
      const res = await apiFetch(`/admin/reports/${report.id}/puzzle-exclude`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast(data.message || '퍼즐 제외 등록에 실패했습니다.', 'error');
        return;
      }
      toast(data.message || '3x4 퍼즐 제외 목록에 등록했습니다.', 'success');
      fetchReports();
    } catch {
      toast('서버 통신 에러', 'error');
    }
  };

  const handleBanUser = async (userId: string, duration: string, reason: string = '') => {
    if (!userId.trim()) { toast('대상 유저 ID가 필요합니다.'); return; }
    try {
      const res = await apiFetch(`/admin/users/${userId}/ban`, { method: 'POST', body: JSON.stringify({ duration, reason }) });
      const data = await res.json();
      toast(data.message || '처리되었습니다.');
      if (res.ok && userId === banUserId) {
        setBanUserId('');
        setBanReason('');
      }
    } catch { toast('서버 통신 에러'); }
  };

  const handleUnbanUser = async (userId: string) => {
    if (!userId.trim()) { toast('대상 유저 ID가 필요합니다.'); return; }
    try {
      const res = await apiFetch(`/admin/users/${userId}/unban`, { method: 'POST' });
      const data = await res.json();
      toast(data.message || '해제되었습니다.');
    } catch { toast('서버 통신 에러'); }
  };

  const fetchBannedUsers = async (page = bannedPage, keyword = bannedSearch, sortBy = bannedSortBy, sortOrder = bannedSortOrder) => {
    setIsBannedUsersLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '10',
        sortBy,
        sortOrder
      });
      if (keyword.trim()) params.set('q', keyword.trim());

      const res = await apiFetch(`/admin/users/banned?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setBannedUsers(data.users || []);
        setBannedTotalPages(data.total_pages || 1);
      }
    } catch { /* noop */ } finally {
      setIsBannedUsersLoading(false);
    }
  };

  const handleBulkBanUpdate = async () => {
    if (selectedBannedUserIds.length === 0) {
      toast('제재를 수정할 대상을 1명 이상 선택해 주세요.', 'warning');
      return;
    }
    if (!confirm(`선택한 ${selectedBannedUserIds.length}명의 제재 상태를 변경하시겠습니까?`)) {
      return;
    }
    setIsBulkUpdating(true);
    try {
      const res = await apiFetch('/admin/users/banned/bulk-update', {
        method: 'POST',
        body: JSON.stringify({
          userIds: selectedBannedUserIds,
          duration: bulkBanDuration,
          reason: bulkBanReason
        })
      });
      const data = await res.json();
      if (res.ok) {
        toast(data.message || '일괄 수정이 완료되었습니다.', 'success');
        setSelectedBannedUserIds([]);
        setBulkBanReason('');
        fetchBannedUsers(bannedPage, bannedSearch, bannedSortBy, bannedSortOrder);
      } else {
        toast(data.message || '수정 중 실패했습니다.', 'error');
      }
    } catch {
      toast('서버 통신 에러', 'error');
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const toggleSelectAllBanned = () => {
    if (selectedBannedUserIds.length === bannedUsers.length) {
      setSelectedBannedUserIds([]);
    } else {
      setSelectedBannedUserIds(bannedUsers.map(u => u.id));
    }
  };

  const toggleSelectBannedUser = (id: string) => {
    setSelectedBannedUserIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // ---- 상점 관리 ----
  const fetchShopItems = async () => {
    try {
      const res = await apiFetch('/admin/shop/items');
      if (res.ok) setShopItems(await res.json());
    } catch { /* noop */ }
  };

  const fetchFreeDrawInterval = async () => {
    try {
      const res = await apiFetch('/admin/config/free-draw');
      if (res.ok) {
        const data = await res.json();
        setFreeDrawInterval(String(data.interval ?? '24'));
        setFreeDrawMaxStack(String(data.maxStack ?? '1'));
      }
    } catch { /* noop */ }
  };

  const handleSaveFreeDrawInterval = async () => {
    const num = parseFloat(freeDrawInterval);
    if (isNaN(num) || num < 0) {
      toast('올바른 0 이상의 숫자를 지정해야 합니다.', 'error');
      return;
    }
    const maxStack = parseInt(freeDrawMaxStack, 10);
    if (isNaN(maxStack) || maxStack < 1) {
      toast('최대 중첩 횟수는 1 이상의 정수여야 합니다.', 'error');
      return;
    }
    setIsSavingInterval(true);
    try {
      const res = await apiFetch('/admin/config/free-draw', {
        method: 'POST',
        body: JSON.stringify({ interval: num, maxStack })
      });
      const data = await res.json();
      if (res.ok) {
        toast(data.message || '무료 뽑기 초기화 간격이 변경되었습니다.', 'success');
        fetchFreeDrawInterval();
      } else {
        toast(data.message || '설정 저장 실패', 'error');
      }
    } catch {
      toast('서버 통신 에러', 'error');
    } finally {
      setIsSavingInterval(false);
    }
  };

  const fetchMinigameTicketChargeInterval = async () => {
    try {
      const res = await apiFetch('/admin/config/minigame-ticket-charge');
      if (res.ok) {
        const data = await res.json();
        setMinigameTicketChargeMinutes(String(data.intervalMinutes ?? '240'));
      }
    } catch { /* noop */ }
  };

  const handleSaveMinigameTicketChargeInterval = async () => {
    const num = parseInt(minigameTicketChargeMinutes, 10);
    if (isNaN(num) || num < 1) {
      toast('미니게임 동전 충전 간격은 1분 이상의 정수여야 합니다.', 'error');
      return;
    }
    setIsSavingMinigameTicketCharge(true);
    try {
      const res = await apiFetch('/admin/config/minigame-ticket-charge', {
        method: 'POST',
        body: JSON.stringify({ intervalMinutes: num })
      });
      const data = await res.json();
      if (res.ok) {
        toast(data.message || '미니게임 동전 충전 간격이 변경되었습니다.', 'success');
        fetchMinigameTicketChargeInterval();
      } else {
        toast(data.message || '설정 저장 실패', 'error');
      }
    } catch {
      toast('서버 통신 에러', 'error');
    } finally {
      setIsSavingMinigameTicketCharge(false);
    }
  };

  const fetchDrawCost = async () => {
    try {
      const res = await apiFetch('/admin/config/draw-cost');
      if (res.ok) {
        const data = await res.json();
        setDrawCost(String(data.cost ?? '10000'));
      }
    } catch { /* noop */ }
  };

  const handleSaveDrawCost = async () => {
    const num = parseInt(drawCost, 10);
    if (isNaN(num) || num < 0) {
      toast('올바른 0 이상의 정수를 지정해야 합니다.', 'error');
      return;
    }
    setIsSavingCost(true);
    try {
      const res = await apiFetch('/admin/config/draw-cost', {
        method: 'POST',
        body: JSON.stringify({ cost: num })
      });
      const data = await res.json();
      if (res.ok) {
        toast(data.message || '뽑기 비용이 변경되었습니다.', 'success');
        fetchDrawCost();
      } else {
        toast(data.message || '설정 저장 실패', 'error');
      }
    } catch {
      toast('서버 통신 에러', 'error');
    } finally {
      setIsSavingCost(false);
    }
  };

  const minifyCss = (css: string): string => {
    // 1. 주석 제거
    let minified = css.replace(/\/\*[\s\S]*?\*\//g, '');
    
    // 2. url() 패턴 보호 (특히 Base64 인코딩이나 SVG data URI가 포함된 곳)
    const urls: string[] = [];
    minified = minified.replace(/url\((['"]?)(data:[\w+\/]+;base64,[\s\S]*?|data:image\/svg\+xml[\s\S]*?)\1\)/gi, (match) => {
      urls.push(match);
      return `___URL_PLACEHOLDER_${urls.length - 1}___`;
    });

    // 3. url 외 영역 공백 및 줄바꿈 압축
    minified = minified
      .replace(/\s+/g, ' ')               // 다중 공백 -> 단일 공백
      .replace(/\s*([\{\}:;\,])\s*/g, '$1') // 기호 주변 공백 제거
      .trim();

    // 4. 보호된 url 복원 및 url 내부 공백 제거 (SVG 내부는 연속된 공백과 줄바꿈을 공백 하나로 치환 가능)
    minified = minified.replace(/___URL_PLACEHOLDER_(\d+)___/g, (_, index) => {
      const originalUrl = urls[parseInt(index, 10)];
      return originalUrl.replace(/\s+/g, ' ');
    });

    return minified;
  };

  const mergeShopStyleJson = (patch: Record<string, unknown>) => {
    let parsed: Record<string, unknown> = {};
    if (shopForm.style_json.trim()) {
      try {
        parsed = JSON.parse(shopForm.style_json);
      } catch {
        parsed = {};
      }
    }
    setShopForm({ ...shopForm, style_json: JSON.stringify({ ...parsed, ...patch }) });
  };

  const uploadArenaEmoteAsset = async (file: File | null | undefined) => {
    if (!file || shopEmoteUploading) return;
    if (!file.type.startsWith('image/')) {
      toast('이미지 파일만 업로드할 수 있습니다.', 'error');
      return;
    }
    setShopEmoteUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await apiFetch('/admin/arena/cosmetics/emote-assets', {
        method: 'POST',
        body: formData
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || '이모트 이미지를 업로드하지 못했습니다.');
      const imageUrl = data?.data?.image_url;
      if (!imageUrl) throw new Error('업로드 URL을 확인하지 못했습니다.');
      mergeShopStyleJson({ image_url: imageUrl });
      toast(data?.data?.animated ? '움짤 이모트 이미지를 업로드했습니다.' : '이모트 이미지를 업로드했습니다.', 'success');
    } catch (err: any) {
      toast(err?.message || '이모트 이미지를 업로드하지 못했습니다.', 'error');
    } finally {
      setShopEmoteUploading(false);
    }
  };

  const submitShopItem = async () => {
    if (!shopForm.name.trim()) { toast('이름을 입력해 주세요.'); return; }
    
    let processedStyleJson = shopForm.style_json || null;
    if (shopForm.style_json.trim()) {
      try {
        const parsed = JSON.parse(shopForm.style_json);
        if (parsed.css && typeof parsed.css === 'string') {
          parsed.css = minifyCss(parsed.css);
        }
        processedStyleJson = JSON.stringify(parsed);
      } catch {
        toast('스타일(JSON) 형식이 올바르지 않습니다.', 'error');
        return;
      }
    }

    const payload = {
      type: shopForm.type, name: shopForm.name, description: shopForm.description || null,
      price: Math.max(0, Number(shopForm.price) || 0), style_json: processedStyleJson,
      font_url: shopForm.font_url || null, font_family: shopForm.font_family || null, active: shopForm.active,
      purchase_limit: Math.max(0, Number(shopForm.purchase_limit) || 0),
      sale_start_at: shopForm.sale_start_at ? localDateTimeInputToIso(shopForm.sale_start_at) : null,
      sale_end_at: shopForm.sale_end_at ? localDateTimeInputToIso(shopForm.sale_end_at) : null,
      limited_total_quantity: Math.max(0, Number(shopForm.limited_total_quantity) || 0)
    };
    try {
      const url = shopForm.id ? `/admin/shop/items/${shopForm.id}` : '/admin/shop/items';
      const res = await apiFetch(url, { method: 'POST', body: JSON.stringify(payload) });
      const data = await res.json();
      if (res.ok) {
        toast(shopForm.id ? '아이템이 수정되었습니다.' : '아이템이 추가되었습니다.', 'success');
        setShopForm({ ...emptyShopForm });
        fetchShopItems();
      } else toast(data.message || '저장 실패', 'error');
    } catch { toast('서버 통신 에러', 'error'); }
  };

  const toggleShopActive = async (item: any) => {
    try {
      const res = await apiFetch(`/admin/shop/items/${item.id}`, { method: 'POST', body: JSON.stringify({ active: !item.active }) });
      if (res.ok) { toast(item.active ? '비활성화했습니다.' : '활성화했습니다.', 'info'); fetchShopItems(); }
      else toast('변경 실패', 'error');
    } catch { toast('서버 통신 에러', 'error'); }
  };

  const editShopItem = (item: any) => {
    setShopForm({
      id: item.id, type: item.type, name: item.name, description: item.description || '',
      price: item.price, style_json: item.style_json || '', font_url: item.font_url || '',
      font_family: item.font_family || '', active: item.active, purchase_limit: item.purchase_limit || 0,
      sale_start_at: item.sale_start_at ? formatLocalDateTimeInput(item.sale_start_at) : '',
      sale_end_at: item.sale_end_at ? formatLocalDateTimeInput(item.sale_end_at) : '',
      limited_total_quantity: item.limited_total_quantity || 0,
      sold_quantity: item.sold_quantity || 0
    });
  };

  // ---- 유지보수 ----
  const fetchMaintenanceStatus = async () => {
    try {
      const res = await apiFetch('/maintenance/status');
      if (res.ok) {
        const data = await res.json();
        setMActive(!!data.active);
        setMStartAt(formatLocalDateTimeInput(data.startAt));
        setMEndAt(formatLocalDateTimeInput(data.endAt));
      }
    } catch { /* noop */ }
  };

  const saveMaintenanceStatus = async (active: boolean) => {
    setIsSavingMaintenance(true);
    try {
      const startAtIso = localDateTimeInputToIso(mStartAt);
      const endAtIso = localDateTimeInputToIso(mEndAt);

      const res = await apiFetch('/admin/maintenance/status', {
        method: 'POST',
        body: JSON.stringify({
          active,
          startAt: startAtIso,
          endAt: endAtIso
        })
      });

      const data = await res.json();
      if (res.ok) {
        toast(active ? '서비스 점검이 시작되었습니다.' : '서비스 점검이 종료되었습니다.', 'success');
        setMActive(!!data.active);
        await checkMaintenanceStatus(); // 전역 점검 상태 동기화
      } else {
        toast(data.message || '점검 설정 변경 실패', 'error');
      }
    } catch {
      toast('서버 통신 에러', 'error');
    } finally {
      setIsSavingMaintenance(false);
    }
  };

  const fetchResetInfo = async () => {
    try {
      const res = await apiFetch('/admin/reset/info');
      if (res.ok) setResetInfo(await res.json());
    } catch { /* noop */ }
  };
  const fetchOrphans = async () => {
    setOrphanLoading(true);
    try {
      const res = await apiFetch('/admin/uploads/orphans');
      if (res.ok) {
        const data = await res.json();
        setOrphans(data.orphans || []);
        setOrphanInfo({ total_files: data.total_files || 0, referenced: data.referenced || 0 });
        setSelectedOrphans([]);
      }
    } catch { /* noop */ } finally { setOrphanLoading(false); }
  };
  const toggleCat = (id: string) => {
    setSelectedCats((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };
  const handleResetData = async () => {
    setResetting(true);
    try {
      const res = await apiFetch('/admin/reset', { method: 'POST', body: JSON.stringify({ categories: selectedCats, confirmation: 'RESET' }) });
      const data = await res.json();
      if (res.ok) {
        toast(data.message || '초기화되었습니다.', 'success');
        setSelectedCats([]);
        setResetConfirmOpen(false);
        fetchResetInfo();
      } else toast(data.message || '초기화 실패', 'error');
    } catch { toast('서버 통신 에러', 'error'); } finally { setResetting(false); }
  };
  const toggleOrphan = (rel: string) => {
    setSelectedOrphans((prev) => prev.includes(rel) ? prev.filter((x) => x !== rel) : [...prev, rel]);
  };
  const toggleAllOrphans = () => {
    setSelectedOrphans((prev) => prev.length === orphans.length ? [] : orphans.map((o) => o.rel));
  };
  const handleDeleteOrphans = async () => {
    if (selectedOrphans.length === 0) { toast('삭제할 이미지를 선택해 주세요.', 'warning'); return; }
    setDeletingOrphans(true);
    try {
      const res = await apiFetch('/admin/uploads/orphans/delete', { method: 'POST', body: JSON.stringify({ paths: selectedOrphans, confirmation: 'DELETE_ORPHANS' }) });
      const data = await res.json();
      if (res.ok) { toast(data.message || '삭제되었습니다.', 'success'); fetchOrphans(); }
      else toast(data.message || '삭제 실패', 'error');
    } catch { toast('서버 통신 에러', 'error'); } finally { setDeletingOrphans(false); }
  };

  const resetItemPurchases = async (item: any) => {
    try {
      const res = await apiFetch(`/admin/shop/items/${item.id}/reset-purchases`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) { toast(data.message || '구매 제한이 초기화되었습니다.', 'success'); fetchShopItems(); }
      else toast(data.message || '초기화 실패', 'error');
    } catch { toast('서버 통신 에러', 'error'); }
  };

  const handleDeleteStreamer = async () => {
    if (!delTarget) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/admin/streamers/${delTarget.channel_id}/delete`, {
        method: 'POST',
        body: JSON.stringify({
          confirmation: delTarget.channel_id,
          prevent_reregistration: delPreventReregistration
        })
      });
      const data = await res.json();
      if (res.ok) {
        toast(data.message || '스트리머 카드를 삭제했습니다.', 'success');
        setDelTarget(null);
        setDelPreventReregistration(false);
        fetchCouponStreamers(true);
      } else {
        toast(data.message || '삭제 실패', 'error');
      }
    } catch {
      toast('서버 통신 에러', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteMissingProfileStreamers = async () => {
    if (missingProfileStreamers.length === 0) {
      toast('프로필 이미지가 설정되지 않은 스트리머가 없습니다.', 'info');
      return;
    }
    const confirmation = window.prompt('프로필 이미지가 없는 스트리머 카드를 모두 삭제하고 보상 지급을 진행하려면 DELETE_MISSING_PROFILE_IMAGES 를 입력하세요.');
    if (confirmation !== 'DELETE_MISSING_PROFILE_IMAGES') {
      toast('확인 값이 일치하지 않아 취소했습니다.', 'warning');
      return;
    }

    setDeletingMissingProfiles(true);
    try {
      const res = await apiFetch('/admin/streamers/missing-profile-images/delete', {
        method: 'POST',
        body: JSON.stringify({ confirmation })
      });
      const data = await res.json();
      if (res.ok) {
        toast(data.message || '프로필 이미지 미설정 스트리머를 삭제했습니다.', 'success');
        fetchCouponStreamers(true);
        fetchMissingProfileStreamers();
        fetchStats();
      } else {
        toast(data.message || '일괄 삭제 실패', 'error');
      }
    } catch {
      toast('서버 통신 에러', 'error');
    } finally {
      setDeletingMissingProfiles(false);
    }
  };

  const handleStreamerImageAction = async (action: 'reset' | 'ban' | 'unban', channelId?: string, star?: number): Promise<boolean> => {
    const target = (channelId || streamerChannelId).trim();
    if (!target) { toast('스트리머 채널 ID를 입력해 주세요.'); return false; }
    try {
      const body = action === 'reset' && star !== undefined ? JSON.stringify({ star }) : undefined;
      const res = await apiFetch(`/admin/streamers/${target}/image/${action}`, { method: 'POST', ...(body ? { body } : {}) });
      const data = await res.json();
      if (!res.ok) {
        toast(data.message || '처리에 실패했습니다.', 'error');
        return false;
      }
      toast(data.message || '처리되었습니다.', 'success');
      fetchCouponStreamers(true); // 목록 갱신
      return true;
    } catch {
      toast('서버 통신 에러', 'error');
      return false;
    }
  };

  const openStreamerImageResetConfirm = (target?: { channelId?: string; name?: string; star?: number; imageUrl?: string | null }) => {
    const channelId = (target?.channelId || streamerChannelId).trim();
    if (!channelId) {
      toast('스트리머 채널 ID를 입력해 주세요.', 'warning');
      return;
    }
    setImageResetConfirm({
      channelId,
      name: target?.name,
      star: target?.star,
      imageUrl: target?.imageUrl ?? null
    });
  };

  const confirmStreamerImageReset = async () => {
    if (!imageResetConfirm) return;
    setResettingStreamerImage(true);
    try {
      const ok = await handleStreamerImageAction('reset', imageResetConfirm.channelId, imageResetConfirm.star);
      if (ok) setImageResetConfirm(null);
    } finally {
      setResettingStreamerImage(false);
    }
  };

  const tradeStatusMeta: Record<TradeStatus, { label: string; className: string }> = {
    PENDING: { label: '대기', className: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
    CONFIRMED: { label: '동의됨', className: 'bg-sky-500/10 text-sky-600 border-sky-500/20' },
    ACCEPTED: { label: '체결', className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
    REJECTED: { label: '거절', className: 'bg-red-500/10 text-red-500 border-red-500/20' },
    CANCELLED: { label: '취소', className: 'bg-secondary text-muted-foreground border-border' }
  };

  const summarizeTradeOffer = (offer?: TradeOffer | null): string => {
    if (!offer) return '없음';
    const parts: string[] = [];
    const point = Number(offer.point || 0);
    if (point > 0) parts.push(`${point.toLocaleString()}P`);
    const cardTotal = (offer.cards || []).reduce((sum, card) => sum + (Number(card.count) || 0), 0);
    if (cardTotal > 0) parts.push(`카드 ${cardTotal.toLocaleString()}장`);
    return parts.length ? parts.join(' · ') : '없음';
  };

  const renderTradeOfferDetail = (offer?: TradeOffer | null) => {
    const cards = offer?.cards || [];
    if (cards.length === 0) return null;
    return (
      <div className="mt-1 flex flex-wrap gap-1">
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
          offer?.with_cosmetics
            ? 'border-violet-400/25 bg-violet-400/10 text-violet-600 dark:text-violet-300'
            : 'border-border bg-secondary/60 text-muted-foreground'
        }`}>
          {offer?.with_cosmetics ? '코스메틱 포함' : '코스메틱 제외'}
        </span>
        {cards.slice(0, 4).map((card, index) => (
          <span key={`${card.channel_id}-${card.star ?? 0}-${index}`} className="rounded-full bg-secondary/70 px-2 py-0.5 text-[10px] text-muted-foreground">
            {card.streamer_name || card.channel_id} {card.star ?? 0}성 x{card.count}
            {card.cosmetics?.length ? ` · ${card.cosmetics
              .flatMap((entry) => [entry.border?.name, entry.name_effect?.name])
              .filter(Boolean)
              .slice(0, 2)
              .join(', ')}` : ''}
          </span>
        ))}
        {cards.length > 4 && (
          <span className="rounded-full bg-secondary/70 px-2 py-0.5 text-[10px] text-muted-foreground">외 {cards.length - 4}종</span>
        )}
      </div>
    );
  };

  const assetTypeLabel: Record<AssetEventAssetType | 'ALL', string> = {
    ALL: '전체 자산',
    card: '카드',
    point: '포인트',
    cosmetic: '코스메틱',
    ticket: '티켓',
    title: '칭호',
    unknown: '기타'
  };

  const assetActionLabel: Record<string, string> = {
    add: '추가',
    remove: '차감',
    move: '이동',
    delete: '삭제',
    update: '수정',
    spend: '사용',
    refund: '환불',
    reserve: '예약',
    release: '해제',
    equip: '장착',
    unequip: '해제/반환'
  };

  const assetSourceLabel: Record<string, string> = {
    ALL: '전체 출처',
    gacha_draw: '카드 소환',
    card_sell: '카드 판매',
    card_fuse: '카드 합성',
    coupon: '쿠폰',
    minigame: '미니게임',
    shop_purchase: '상점 구매',
    shop_equip: '코스메틱 장착',
    shop_unequip: '코스메틱 해제',
    market_listing: '마켓 등록',
    market_purchase: '마켓 구매',
    market_sale: '마켓 판매',
    market_bid: '경매 입찰',
    market_bid_refund: '입찰 환불',
    card_delete_refund: '카드 삭제 보상',
    admin_streamer_delete: '관리자 카드 삭제',
    trade: '1:1 거래',
    manual_adjustment: '수동 조정',
    admin_reset: '관리자 초기화',
    unknown: '기타'
  };

  const assetEventSubject = (event: AssetEventLogEntry) => {
    if (event.asset_type === 'point') {
      const amount = Number(event.amount || 0);
      return `${amount > 0 ? '+' : ''}${amount.toLocaleString()}P`;
    }
    if (event.asset_type === 'card') {
      const name = event.streamer_name || event.channel_id || '카드';
      const serial = event.serial_number ? ` #${event.serial_number}` : '';
      return `${name} ${event.star ?? 0}성${serial}`;
    }
    if (event.asset_type === 'cosmetic') {
      return event.item_name || (event.item_id ? `아이템 #${event.item_id}` : '코스메틱');
    }
    if (event.asset_type === 'ticket') return `티켓 x${Number(event.quantity || 1).toLocaleString()}`;
    return event.description || event.reason;
  };

  const assetEventActorLabel = (event: AssetEventLogEntry) =>
    event.username || event.user_id || event.from_username || event.from_user_id || '대상 없음';

  const assetEventRelationLabel = (event: AssetEventLogEntry) => {
    if (event.from_user_id || event.to_user_id) {
      const from = event.from_username || event.from_user_id || '출발 없음';
      const to = event.to_username || event.to_user_id || '도착 없음';
      return `${from} -> ${to}`;
    }
    if (event.counterparty_user_id) {
      return `상대: ${event.counterparty_username || event.counterparty_user_id}`;
    }
    return null;
  };

  const assetSuspicionSeverityLabel: Record<string, string> = {
    critical: '매우 높음',
    high: '높음',
    medium: '중간',
    low: '낮음'
  };

  const assetSuspicionSeverityClass = (severity: string) => {
    if (severity === 'critical') return 'bg-red-600/15 text-red-500 border-red-500/25';
    if (severity === 'high') return 'bg-red-500/10 text-red-500 border-red-500/20';
    if (severity === 'medium') return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
    return 'bg-secondary text-muted-foreground border-border';
  };

  const subTabs: { id: AdminSubTab; label: string; icon: typeof Tag }[] = [
    { id: 'dashboard', label: '대시보드', icon: LayoutDashboard },
    { id: 'insights', label: '인사이트', icon: BarChart3 },
    { id: 'users', label: '유저', icon: Users },
    { id: 'titles', label: '칭호', icon: Award },
    { id: 'achievements', label: '업적', icon: Trophy },
    { id: 'coupons', label: '쿠폰', icon: Tag },
    { id: 'announcements', label: '공지', icon: Megaphone },
    { id: 'push', label: '푸시', icon: BellRing },
    { id: 'reports', label: '신고·밴', icon: AlertTriangle },
    { id: 'trades', label: '1:1 거래', icon: ArrowRightLeft },
    { id: 'asset-events', label: '자산 기록', icon: Activity },
    { id: 'streamers', label: '스트리머 이미지', icon: ImageIcon },
    { id: 'shop', label: '상점 관리', icon: Store },
    { id: 'arena', label: '아레나', icon: Gamepad2 },
    { id: 'maintenance', label: 'DB 초기화', icon: Database }
  ];

  const maxHourlyViews = Math.max(1, ...(insights?.hourly || []).map((item) => item.views));
  const maxPageViews = Math.max(1, ...(insights?.pages || []).map((item) => item.views));
  const maxDeviceViews = Math.max(1, ...(insights?.devices || []).map((item) => item.views));
  const maxRouteViews = Math.max(1, ...(insights?.route_groups || []).map((item) => item.views));

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center gap-2 text-red-500">
        <ShieldAlert className="h-6 w-6" />
        <h2 className="text-xl font-black text-foreground">치카포 관리자 통제 센터</h2>
      </div>

      {/* 하위 탭 네비 */}
      <div className="flex flex-wrap gap-1.5 rounded-xl bg-secondary/40 p-1.5">
        {subTabs.map((t) => {
          const Icon = t.icon;
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => handleSubTabChange(t.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition ${active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {/* 대시보드 */}
      {subTab === 'dashboard' && (
        <section className="space-y-4">
          <div className="flex justify-end">
            <button onClick={fetchStats} className="flex items-center gap-1 rounded-lg bg-secondary px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
              <RefreshCw className="h-3.5 w-3.5" /> 새로고침
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { label: '총 유저 수', value: stats?.user_count, icon: Users, color: 'text-sky-500' },
              { label: '등록 스트리머', value: stats?.streamer_count, icon: Layers, color: 'text-fuchsia-500' },
              { label: '배포된 카드', value: stats?.card_distributed, icon: Layers, color: 'text-emerald-500' },
              { label: '체결된 교환', value: stats?.completed_trades, icon: ArrowRightLeft, color: 'text-amber-500' },
              { label: '대기 신고', value: stats?.pending_reports, icon: AlertTriangle, color: 'text-red-500' }
            ].map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.label} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{s.label}</span>
                    <Icon className={`h-4 w-4 ${s.color}`} />
                  </div>
                  <p className="mt-2 text-2xl font-black text-foreground">
                    {stats ? (s.value ?? 0).toLocaleString() : '—'}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {subTab === 'insights' && (
        <section className="space-y-5">
          <div className="overflow-hidden rounded-[2rem] border border-primary/15 bg-gradient-to-br from-primary/10 via-card to-sky-400/10 p-5 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-primary">
                  <BarChart3 className="h-5 w-5" />
                  <h3 className="text-base font-black text-foreground">사이트 인사이트</h3>
                </div>
                <p className="mt-2 max-w-2xl text-xs font-bold leading-relaxed text-muted-foreground">
                  PostHog Query API에서 방문 시간대, 페이지 체류 시간, 기기·브라우저 분포, 핵심 기능 이용 흐름을 읽어옵니다.
                  백엔드는 PostHog 결과를 짧게 캐시하므로 치카포 MySQL에는 분석 부하가 생기지 않습니다.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-2xl border border-border bg-card/80 p-1 shadow-sm">
                  {(['24h', '7d', '30d'] as InsightsRange[]).map((range) => (
                    <button
                      key={range}
                      type="button"
                      onClick={() => setInsightsRange(range)}
                      className={`rounded-xl px-3 py-1.5 text-[11px] font-black transition ${insightsRange === range ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      {insightRangeLabel[range]}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => fetchInsights(insightsRange)}
                  disabled={insightsLoading}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-border bg-card px-3 py-2 text-xs font-black text-muted-foreground shadow-sm transition hover:-translate-y-0.5 hover:text-foreground disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${insightsLoading ? 'animate-spin' : ''}`} />
                  새로고침
                </button>
                <a
                  href={analyticsSettings.dashboardUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-2 text-xs font-black text-primary-foreground shadow-md shadow-primary/20 transition hover:-translate-y-0.5 hover:bg-primary/95"
                >
                  PostHog
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          </div>

          {insightsError && (
            <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 p-4 text-xs font-bold text-rose-600 dark:text-rose-200">
              {insightsError}
            </div>
          )}

          {insights && !insights.enabled && (
            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-xs font-bold leading-relaxed text-amber-700 dark:text-amber-200">
              PostHog 서버 조회 설정이 아직 없습니다. 백엔드 환경변수에 POSTHOG_PROJECT_ID와 POSTHOG_PERSONAL_API_KEY를 넣으면 이 화면에 실제 인사이트가 표시됩니다.
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            {[
              { label: '페이지뷰', value: insights?.summary.page_views, icon: BarChart3, color: 'text-sky-500' },
              { label: '세션', value: insights?.summary.sessions, icon: Activity, color: 'text-emerald-500' },
              { label: '방문자', value: insights?.summary.visitors, icon: Users, color: 'text-fuchsia-500' },
              { label: '현재 활성', value: insights?.summary.active_sessions_5m, icon: MonitorSmartphone, color: 'text-amber-500' },
              { label: '평균 체류', value: insights ? formatInsightDuration(insights.summary.avg_duration_seconds) : null, icon: Clock3, color: 'text-primary' }
            ].map((metric) => {
              const Icon = metric.icon;
              return (
                <div key={metric.label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-black text-foreground">{metric.label}</span>
                    <Icon className={`h-4 w-4 ${metric.color}`} />
                  </div>
                  <p className="mt-2 text-2xl font-black text-foreground">
                    {typeof metric.value === 'number' ? metric.value.toLocaleString() : (metric.value || '—')}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-sm font-black">
                  <BarChart3 className="h-4 w-4 text-sky-500" />
                  시간대별 접속 흐름
                </h3>
                <span className="text-[10px] font-bold text-muted-foreground">
                  {insights?.generated_at ? `갱신 ${formatLocalDateTime(insights.generated_at)}` : '데이터 대기'}
                </span>
              </div>
              <div className="space-y-2">
                {(insights?.hourly || []).slice(-24).map((row) => (
                  <div key={row.bucket} className="grid grid-cols-[5.5rem_1fr_5rem] items-center gap-2">
                    <span className="text-[10px] font-bold text-muted-foreground">{formatLocalDateTime(row.bucket, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: undefined })}</span>
                    <div className="h-3 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-gradient-to-r from-primary to-sky-300" style={{ width: `${Math.max(4, Math.min(100, (row.views / maxHourlyViews) * 100))}%` }} />
                    </div>
                    <span className="text-right text-[11px] font-black text-foreground">{row.views.toLocaleString()}</span>
                  </div>
                ))}
                {(!insights || insights.hourly.length === 0) && (
                  <p className="py-8 text-center text-xs font-bold text-muted-foreground">아직 집계된 방문 데이터가 없습니다.</p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h3 className="flex items-center gap-1.5 text-sm font-black">
                <MonitorSmartphone className="h-4 w-4 text-fuchsia-500" />
                기기·브라우저
              </h3>
              <div className="mt-4 space-y-2">
                {(insights?.devices || []).slice(0, 10).map((row) => (
                  <div key={`${row.device_type}-${row.browser_name}-${row.os_name}`} className="rounded-xl bg-secondary/30 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] font-black text-foreground">{row.device_type} · {row.browser_name}</span>
                      <span className="text-[10px] font-black text-muted-foreground">{row.views.toLocaleString()}뷰</span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-background/70">
                      <div className="h-full rounded-full bg-fuchsia-400" style={{ width: `${Math.max(4, Math.min(100, (row.views / maxDeviceViews) * 100))}%` }} />
                    </div>
                    <p className="mt-1 text-[10px] font-bold text-muted-foreground">{row.os_name} · 세션 {row.sessions.toLocaleString()}</p>
                  </div>
                ))}
                {(!insights || insights.devices.length === 0) && (
                  <p className="py-8 text-center text-xs font-bold text-muted-foreground">기기 데이터가 없습니다.</p>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h3 className="flex items-center gap-1.5 text-sm font-black">
                <Clock3 className="h-4 w-4 text-emerald-500" />
                페이지별 조회·체류
              </h3>
              <div className="mt-4 space-y-2">
                {(insights?.pages || []).slice(0, 12).map((row) => (
                  <div key={row.path} className="rounded-xl border border-border/60 bg-secondary/20 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-black text-foreground">{row.path}</p>
                        <p className="mt-0.5 text-[10px] font-bold text-muted-foreground">{routeGroupLabel(row.route_group)} · 세션 {row.sessions.toLocaleString()}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs font-black text-foreground">{row.views.toLocaleString()}뷰</p>
                        <p className="text-[10px] font-bold text-muted-foreground">{row.duration_samples > 0 ? formatInsightDuration(row.avg_duration_seconds) : '체류 없음'}</p>
                      </div>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-background/70">
                      <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-primary" style={{ width: `${Math.max(4, Math.min(100, (row.views / maxPageViews) * 100))}%` }} />
                    </div>
                  </div>
                ))}
                {(!insights || insights.pages.length === 0) && (
                  <p className="py-8 text-center text-xs font-bold text-muted-foreground">페이지 데이터가 없습니다.</p>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <h3 className="flex items-center gap-1.5 text-sm font-black">
                  <Layers className="h-4 w-4 text-primary" />
                  화면 그룹
                </h3>
                <div className="mt-4 space-y-2">
                  {(insights?.route_groups || []).map((row) => (
                    <div key={row.route_group} className="rounded-xl bg-secondary/30 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-black">{routeGroupLabel(row.route_group)}</span>
                        <span className="text-[10px] font-black text-muted-foreground">{row.views.toLocaleString()}뷰</span>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-background/70">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, Math.min(100, (row.views / maxRouteViews) * 100))}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <h3 className="flex items-center gap-1.5 text-sm font-black">
                  <MousePointerClick className="h-4 w-4 text-amber-500" />
                  메뉴 이동
                </h3>
                <div className="mt-4 space-y-2">
                  {(insights?.navigation || []).slice(0, 8).map((row) => (
                    <div key={`${row.from_tab}-${row.to_tab}-${row.surface}`} className="flex items-center justify-between rounded-xl bg-secondary/30 px-3 py-2">
                      <span className="truncate text-[11px] font-bold">{routeGroupLabel(row.from_tab)} → {routeGroupLabel(row.to_tab)} <span className="text-muted-foreground">({row.surface})</span></span>
                      <span className="shrink-0 text-[10px] font-black text-foreground">{row.count.toLocaleString()}</span>
                    </div>
                  ))}
                  {(!insights || insights.navigation.length === 0) && (
                    <p className="py-6 text-center text-xs font-bold text-muted-foreground">메뉴 이동 데이터가 없습니다.</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h3 className="flex items-center gap-1.5 text-sm font-black">
                <BellRing className="h-4 w-4 text-sky-500" />
                알림 클릭 그룹
              </h3>
              <div className="mt-4 space-y-2">
                {(insights?.notifications || []).slice(0, 10).map((row) => (
                  <div key={row.group_key} className="flex items-center justify-between rounded-xl bg-secondary/30 px-3 py-2">
                    <span className="truncate text-[11px] font-bold">{row.group_key}</span>
                    <span className="shrink-0 text-[10px] font-black text-foreground">{row.opens.toLocaleString()}회</span>
                  </div>
                ))}
                {(!insights || insights.notifications.length === 0) && (
                  <p className="py-6 text-center text-xs font-bold text-muted-foreground">알림 클릭 데이터가 없습니다.</p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h3 className="flex items-center gap-1.5 text-sm font-black">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                수집·보안 상태
              </h3>
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                <div className="rounded-xl bg-secondary/35 px-3 py-2">
                  <span className="text-[10px] font-bold text-muted-foreground">브라우저 수집</span>
                  <p className={`mt-0.5 text-xs font-black ${analyticsSettings.enabled ? 'text-emerald-600' : 'text-amber-600'}`}>{analyticsSettings.enabled ? 'PostHog 이벤트 전송 활성' : 'NEXT_PUBLIC_POSTHOG_KEY 미설정'}</p>
                </div>
                <div className="rounded-xl bg-secondary/35 px-3 py-2">
                  <span className="text-[10px] font-bold text-muted-foreground">서버 조회</span>
                  <p className={`mt-0.5 text-xs font-black ${insights?.enabled ? 'text-emerald-600' : 'text-amber-600'}`}>{insights?.enabled ? 'PostHog Query API 연결' : '백엔드 키 미설정'}</p>
                </div>
                <div className="rounded-xl bg-secondary/35 px-3 py-2">
                  <span className="text-[10px] font-bold text-muted-foreground">Cloudflare Web Analytics</span>
                  <p className={`mt-0.5 text-xs font-black ${analyticsSettings.cloudflareEnabled ? 'text-emerald-600' : 'text-muted-foreground'}`}>{analyticsSettings.cloudflareEnabled ? '토큰 방식 활성' : '선택 설정'}</p>
                </div>
                <div className="rounded-xl bg-secondary/35 px-3 py-2">
                  <span className="text-[10px] font-bold text-muted-foreground">PostHog Host</span>
                  <p className="mt-0.5 truncate text-xs font-black text-foreground">{analyticsSettings.postHogHost}</p>
                </div>
              </div>
              <p className="mt-4 rounded-2xl border border-primary/15 bg-primary/5 px-3 py-2.5 text-[11px] font-bold leading-relaxed text-muted-foreground">
                자동 클릭/폼 캡처와 세션 리플레이는 꺼져 있습니다. 닉네임, 채팅 내용, 검색어 원문, 쿠폰 코드 같은 내용 데이터는 분석 이벤트에 포함하지 않습니다.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* 유저 목록 (자기완결형 컴포넌트로 분리) */}
      {subTab === 'users' && <AdminUsersTab />}
      {subTab === 'titles' && <AdminTitlesTab />}
      {subTab === 'achievements' && <AdminAchievementsTab />}

      {/* 쿠폰 */}
      {subTab === 'coupons' && (
        <section className="space-y-5">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
            <h3 className="text-sm font-bold flex items-center gap-1.5"><Tag className="h-4 w-4" /> 리딤 쿠폰 발행</h3>

            <input type="text" placeholder="쿠폰 코드 (미입력 시 랜덤 생성)" value={couponForm.code}
              onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value })}
              className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />

            {/* 사용 방식 */}
            <div>
              <label className="text-[11px] font-bold text-muted-foreground block mb-1">사용 방식</label>
              <div className="flex gap-2">
                <select value={couponForm.coupon_type}
                  onChange={(e) => setCouponForm({ ...couponForm, coupon_type: e.target.value as any })}
                  className="flex-1 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs">
                  <option value="single">일회성 (선착순 발급 갯수 제한)</option>
                  <option value="multi">다회성 (기간 내 1인 1회·무제한)</option>
                </select>
                {couponForm.coupon_type === 'single' && (
                  <input type="number" min={1} placeholder="발급 갯수" value={couponForm.max_uses}
                    onChange={(e) => setCouponForm({ ...couponForm, max_uses: Number(e.target.value) })}
                    className="w-24 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" title="발급 갯수" />
                )}
              </div>
            </div>

            {/* 보상 추가 */}
            <div className="space-y-3 rounded-xl border border-border/70 bg-secondary/20 p-3">
              <div>
                <label className="text-[11px] font-bold text-muted-foreground block mb-1">추가할 보상 종류</label>
                <select value={couponRewardDraft.type}
                  onChange={(e) => setCouponRewardDraft({ ...emptyCouponRewardDraft, type: e.target.value as CouponRewardType })}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-xs">
                  <option value="point">재화 (포인트)</option>
                  <option value="card">스트리머 카드</option>
                  <option value="cosmetic">코스메틱 아이템</option>
                  <option value="minigame_ticket">추가 미니게임 티켓</option>
                  <option value="free_draw_ticket">추가 무료 소환 티켓</option>
                  <option value="title">칭호</option>
                </select>
              </div>

              {couponRewardDraft.type === 'point' && (
                <input type="number" min={1} placeholder="지급 포인트" value={couponRewardDraft.points}
                  onChange={(e) => setCouponRewardDraft({ ...couponRewardDraft, points: Number(e.target.value) })}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-xs" />
              )}

              {couponRewardDraft.type === 'card' && (
              <div className="space-y-2 rounded-lg border border-border/60 bg-card/70 p-2.5">
                <input type="text" placeholder="스트리머 검색" value={couponStreamerSearch}
                  onChange={(e) => setCouponStreamerSearch(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-xs" />
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {filterAdminStreamers(couponStreamers, couponStreamerSearch)
                    .slice(0, 20)
                    .map((s) => (
                      <button key={s.channel_id}
                        onClick={() => setCouponRewardDraft({ ...couponRewardDraft, channel_id: s.channel_id })}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${couponRewardDraft.channel_id === s.channel_id ? 'bg-primary/15 ring-1 ring-primary/40' : 'hover:bg-secondary/60'}`}>
                        <img src={streamerProfileImage(s)} alt={s.name} className="h-6 w-6 rounded-full object-cover" />
                        <span className="text-[11px] font-bold truncate">{s.name}</span>
                      </button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">지급 수량</span>
                  <input type="number" min={1} value={couponRewardDraft.quantity}
                    onChange={(e) => setCouponRewardDraft({ ...couponRewardDraft, quantity: Number(e.target.value) })}
                    className="w-20 rounded-lg border border-border bg-card px-2 py-1.5 text-xs" />
                </div>
              </div>
              )}

              {couponRewardDraft.type === 'cosmetic' && (
              <div className="space-y-2 rounded-lg border border-border/60 bg-card/70 p-2.5">
                {couponCosmetics.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground py-2 text-center">등록된 코스메틱 아이템이 없습니다. 상점 관리에서 먼저 추가하세요.</p>
                ) : (
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {couponCosmetics.map((it) => (
                      <button key={it.id}
                        onClick={() => setCouponRewardDraft({ ...couponRewardDraft, item_id: it.id })}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${couponRewardDraft.item_id === it.id ? 'bg-primary/15 ring-1 ring-primary/40' : 'hover:bg-secondary/60'}`}>
                        {it.type === 'border' ? (
                          <div className="relative h-7 w-5 shrink-0 overflow-hidden rounded bg-gradient-to-br from-secondary to-card border border-border/70"
                            style={{
                              containerType: 'inline-size',
                              ...(borderClass(it) ? {} : (parseStyle(it.style_json) || {}))
                            }}
                          >
                            <CosmeticFrame border={it} />
                          </div>
                        ) : (
                          <CosmeticName effect={it} className="shrink-0 text-sm font-black px-1">{it.name}</CosmeticName>
                        )}
                        <span className="text-[11px] font-bold truncate flex-1">{it.name}</span>
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground shrink-0">{it.type === 'border' ? '테두리' : '이름효과'}</span>
                        {!it.active && <span className="rounded bg-red-500/15 px-1 text-[8px] font-bold text-red-500 shrink-0">비활성</span>}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">지급 수량</span>
                  <input type="number" min={1} value={couponRewardDraft.quantity}
                    onChange={(e) => setCouponRewardDraft({ ...couponRewardDraft, quantity: Number(e.target.value) })}
                    className="w-20 rounded-lg border border-border bg-card px-2 py-1.5 text-xs" />
                </div>
              </div>
              )}

              {couponRewardDraft.type === 'title' && (
              <div className="space-y-2 rounded-lg border border-border/60 bg-card/70 p-2.5">
                {couponTitles.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground py-2 text-center">등록된 칭호가 없습니다. 칭호 탭에서 먼저 추가하세요.</p>
                ) : (
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {couponTitles.map((title) => (
                      <button key={title.id}
                        onClick={() => setCouponRewardDraft({ ...couponRewardDraft, title_id: title.id })}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition ${couponRewardDraft.title_id === title.id ? 'bg-primary/15 ring-1 ring-primary/40' : 'hover:bg-secondary/60'}`}>
                        <span className="truncate text-[11px] font-bold">{title.name}</span>
                        <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">#{title.id}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              )}

              {couponRewardDraft.type === 'minigame_ticket' && (
              <div className="overflow-hidden rounded-xl border border-sky-500/25 bg-gradient-to-br from-sky-500/10 via-secondary/20 to-primary/10 p-3">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-sky-500/15 p-2 text-sky-400 ring-1 ring-sky-500/25">
                    <Gamepad2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-black text-foreground">추가 미니게임 티켓</p>
                    <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                      기본 5장 충전 한도와 별도로 누적됩니다. 유저가 게임을 시작하면 이 추가 티켓이 기본 티켓보다 먼저 소모됩니다.
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-border/50 bg-card/70 px-3 py-2">
                  <span className="text-[11px] font-bold text-muted-foreground">지급 수량</span>
                  <input type="number" min={1} value={couponRewardDraft.quantity}
                    onChange={(e) => setCouponRewardDraft({ ...couponRewardDraft, quantity: Number(e.target.value) })}
                    className="ml-auto w-24 rounded-lg border border-border bg-secondary/40 px-2 py-1.5 text-xs font-bold" />
                  <span className="text-[10px] font-black text-sky-400">tickets</span>
                </div>
              </div>
              )}

              {couponRewardDraft.type === 'free_draw_ticket' && (
              <div className="overflow-hidden rounded-xl border border-violet-500/25 bg-gradient-to-br from-violet-500/10 via-secondary/20 to-sky-500/10 p-3">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-violet-500/15 p-2 text-violet-400 ring-1 ring-violet-500/25">
                    <Ticket className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-black text-foreground">추가 무료 소환 티켓</p>
                    <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                      리셋 주기 충전분과 별도로 누적됩니다. 스트리머 소환 시 주기 충전분을 먼저 쓰고, 남은 추가 티켓을 이어서 사용합니다.
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-border/50 bg-card/70 px-3 py-2">
                  <span className="text-[11px] font-bold text-muted-foreground">지급 수량</span>
                  <input type="number" min={1} value={couponRewardDraft.quantity}
                    onChange={(e) => setCouponRewardDraft({ ...couponRewardDraft, quantity: Number(e.target.value) })}
                    className="ml-auto w-24 rounded-lg border border-border bg-secondary/40 px-2 py-1.5 text-xs font-bold" />
                  <span className="text-[10px] font-black text-violet-400">tickets</span>
                </div>
              </div>
              )}

              <button type="button" onClick={addCouponReward} className="w-full rounded-lg border border-primary/30 bg-primary/10 py-2 text-xs font-bold text-primary hover:bg-primary hover:text-primary-foreground">
                보상 추가
              </button>
            </div>

            <div className="rounded-xl border border-border/70 bg-card p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-bold text-muted-foreground">지급될 보상 ({couponForm.rewards.length})</span>
                {couponForm.rewards.length > 0 && (
                  <button type="button" onClick={() => setCouponForm({ ...couponForm, rewards: [] })} className="text-[10px] font-bold text-muted-foreground hover:text-destructive">
                    전체 비우기
                  </button>
                )}
              </div>
              {couponForm.rewards.length === 0 ? (
                <p className="rounded-lg bg-secondary/30 px-3 py-4 text-center text-[11px] text-muted-foreground">추가된 보상이 없습니다.</p>
              ) : (
                <div className="space-y-1.5">
                  {couponForm.rewards.map((reward, index) => (
                    <div key={`${reward.type}-${index}`} className="flex items-center justify-between gap-2 rounded-lg bg-secondary/35 px-3 py-2">
                      <span className="min-w-0 truncate text-[11px] font-bold">{index + 1}. {rewardText(reward)}</span>
                      <button type="button" onClick={() => removeCouponReward(index)} className="shrink-0 rounded bg-background px-2 py-1 text-[10px] font-bold text-muted-foreground hover:text-destructive">
                        삭제
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 사용 가능 기간 (만료 일시) */}
            <div>
              <label className="text-[11px] font-bold text-muted-foreground block mb-1">사용 가능 만료 일시 (비우면 무기한)</label>
              <input type="datetime-local" value={couponForm.expires_at}
                onChange={(e) => setCouponForm({ ...couponForm, expires_at: e.target.value })}
                className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
            </div>

            <button onClick={handleCreateCoupon} className="w-full rounded-lg bg-primary py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90">쿠폰 발행</button>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold">발급된 쿠폰 ({coupons.length})</h3>
              <button onClick={fetchCoupons} className="text-xs text-muted-foreground hover:text-foreground"><RefreshCw className="h-3.5 w-3.5" /></button>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {coupons.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">발급된 쿠폰이 없습니다.</p>
              ) : coupons.map((c) => {
                const rewards = couponRewards(c);
                return (
                  <div key={c.id} className="flex items-center justify-between rounded-lg bg-secondary/30 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold font-mono truncate">{c.code}</p>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">
                        {c.coupon_type === 'single' ? '일회성' : '다회성'} · {rewards.map(rewardText).join(' · ')}
                        {c.expires_at ? ` · ~${formatLocalDateTime(c.expires_at, { hour12: true })}` : ' · 무기한'}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] font-bold text-primary ml-2">
                      {c.coupon_type === 'single' ? `${c.used_count}/${c.max_uses}` : `${c.used_count} 사용`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* 공지 */}
      {subTab === 'announcements' && (
        <section className="space-y-5">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
            <h3 className="text-sm font-bold flex items-center gap-1.5">
              <Megaphone className="h-4 w-4" /> 
              {editingNoticeId ? '공지/팝업 수정' : '공지/팝업 등록'}
            </h3>
            <input type="text" placeholder="공지 제목" value={noticeForm.title}
              onChange={(e) => setNoticeForm({ ...noticeForm, title: e.target.value })}
              className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
            <textarea placeholder="공지 본문 (마크다운 완전 지원: **굵게**, ~~취소선~~, \*이스케이프\* 등)" value={noticeForm.content}
              onChange={(e) => setNoticeForm({ ...noticeForm, content: e.target.value })}
              className="w-full h-24 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={noticeForm.is_popup}
                onChange={(e) => setNoticeForm({ ...noticeForm, is_popup: e.target.checked })} /> 메인 화면 레이어 팝업으로 노출
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={noticeForm.is_pinned}
                onChange={(e) => setNoticeForm({ ...noticeForm, is_pinned: e.target.checked })} /> 플랫폼 새소식 맨 위에 고정
            </label>
            {editingNoticeId ? (
              <div className="flex gap-2">
                <button onClick={handleUpdateAnnouncement} className="flex-1 rounded-lg bg-primary py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90">수정 완료</button>
                <button onClick={handleCancelEditAnnouncement} className="flex-1 rounded-lg bg-secondary py-2 text-xs font-bold text-muted-foreground hover:bg-secondary/80">수정 취소</button>
              </div>
            ) : (
              <button onClick={handleCreateAnnouncement} className="w-full rounded-lg bg-primary py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90">공지 등록</button>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h3 className="text-sm font-bold mb-3">등록된 공지 ({announcements.length})</h3>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {announcements.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">등록된 공지가 없습니다.</p>
              ) : announcements.map((a) => (
                <div key={a.id} className="flex flex-col gap-2 rounded-lg bg-secondary/30 px-3 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold flex items-center gap-1.5">
                      {a.title}
                      {a.is_pinned && <span className="inline-flex items-center gap-0.5 rounded bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-bold text-sky-600 dark:text-sky-400"><Pin className="h-2.5 w-2.5 fill-current" />고정</span>}
                      {a.is_popup && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">팝업</span>}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">{a.content}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    <button
                      onClick={() => handleTogglePinned(a)}
                      className={`rounded px-2 py-1.5 text-[10px] font-bold transition ${a.is_pinned ? 'bg-sky-500/15 text-sky-600 hover:bg-sky-500/25 dark:text-sky-400' : 'bg-secondary text-muted-foreground hover:bg-secondary/80'}`}
                      title="플랫폼 새소식 상단 고정 토글"
                    >
                      {a.is_pinned ? '고정 해제' : '맨 위 고정'}
                    </button>
                    <button
                      onClick={() => handleTogglePopup(a)}
                      className={`rounded px-2 py-1.5 text-[10px] font-bold transition ${a.is_popup ? 'bg-amber-500/15 text-amber-500 hover:bg-amber-500/25' : 'bg-secondary text-muted-foreground hover:bg-secondary/80'}`}
                      title="팝업 노출 토글"
                    >
                      {a.is_popup ? '팝업 해제' : '팝업 등록'}
                    </button>
                    <button
                      onClick={() => handleStartEditAnnouncement(a)}
                      className="rounded bg-secondary p-1.5 text-foreground hover:bg-secondary/80"
                      title="공지 수정"
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => handleDeleteAnnouncement(a.id)} className="rounded bg-red-500/10 p-1.5 text-red-500 hover:bg-red-500/20" title="공지 삭제">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 푸시 */}
      {subTab === 'push' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 좌측: 푸시 발송 폼 & 예약 목록 */}
          <div className="space-y-6">
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
              <h3 className="text-sm font-bold flex items-center gap-1.5"><BellRing className="h-4 w-4" /> PWA 푸시 알림 발송</h3>
              <p className="text-xs text-muted-foreground">발송 시각을 비우면 즉시(다음 1분 이내) 발송됩니다.</p>
              <input type="text" placeholder="알림 제목" value={pushForm.title}
                onChange={(e) => setPushForm({ ...pushForm, title: e.target.value })}
                className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
              <input type="text" placeholder="알림 본문" value={pushForm.body}
                onChange={(e) => setPushForm({ ...pushForm, body: e.target.value })}
                className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold text-muted-foreground">알림 클릭 동작</label>
                <select
                  value={pushForm.target_type}
                  onChange={(e) => {
                    const targetType = e.target.value as PushTargetType;
                    setPushForm({
                      ...pushForm,
                      target_type: targetType,
                      coupon_code: targetType === 'coupon' ? pushForm.coupon_code : ''
                    });
                  }}
                  className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs"
                >
                  <option value="default">일반 알림 - 메인 페이지로 이동</option>
                  <option value="coupon">쿠폰 사용 - 내 정보 쿠폰란으로 이동</option>
                </select>
                {pushForm.target_type === 'coupon' && (
                  <input
                    type="text"
                    value={pushForm.coupon_code}
                    onChange={(e) => setPushForm({ ...pushForm, coupon_code: e.target.value.toUpperCase() })}
                    placeholder="사용할 쿠폰 코드 입력"
                    autoComplete="off"
                    className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 font-mono text-xs uppercase"
                  />
                )}
                <p className="text-[10px] text-muted-foreground">
                  쿠폰 사용을 선택하면 직접 입력한 코드가 알림 클릭 후 쿠폰란에 자동 입력됩니다.
                </p>
              </div>
              <input type="datetime-local" value={pushForm.scheduled_at}
                onChange={(e) => setPushForm({ ...pushForm, scheduled_at: e.target.value })}
                className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
              <button onClick={handleSchedulePush} className="w-full rounded-lg bg-primary py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90">발송 등록</button>
            </section>

            {/* 예약된 푸시 알림 목록 */}
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-bold flex items-center gap-1.5">⏰ 예약된 푸시 알림 ({scheduledPushes.length})</h3>
                <button onClick={fetchScheduledPushes} className="text-xs text-muted-foreground hover:text-foreground"><RefreshCw className="h-3.5 w-3.5" /></button>
              </div>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {scheduledPushes.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">예약된 푸시 알림이 없습니다.</p>
                ) : (
                  scheduledPushes.map((p) => {
                    const isEditing = editingPushId === p.id;
                    const dateStr = p.scheduled_at
                      ? formatLocalDateTime(p.scheduled_at)
                      : '즉시 발송 예정';
                    return (
                      <div key={p.id} className="p-3 bg-secondary/25 border border-border/40 rounded-xl space-y-2">
                        {isEditing ? (
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={editingForm.title}
                              onChange={(e) => setEditingForm({ ...editingForm, title: e.target.value })}
                              className="w-full rounded-lg border border-border bg-card px-2 py-1 text-xs"
                              placeholder="수정할 제목"
                            />
                            <input
                              type="text"
                              value={editingForm.body}
                              onChange={(e) => setEditingForm({ ...editingForm, body: e.target.value })}
                              className="w-full rounded-lg border border-border bg-card px-2 py-1 text-xs"
                              placeholder="수정할 본문"
                            />
                            <select
                              value={editingForm.target_type}
                              onChange={(e) => {
                                const targetType = e.target.value as PushTargetType;
                                setEditingForm({
                                  ...editingForm,
                                  target_type: targetType,
                                  coupon_code: targetType === 'coupon' ? editingForm.coupon_code : ''
                                });
                              }}
                              className="w-full rounded-lg border border-border bg-card px-2 py-1 text-xs"
                            >
                              <option value="default">일반 알림 - 메인 페이지로 이동</option>
                              <option value="coupon">쿠폰 사용 - 내 정보 쿠폰란으로 이동</option>
                            </select>
                            {editingForm.target_type === 'coupon' && (
                              <input
                                type="text"
                                value={editingForm.coupon_code}
                                onChange={(e) => setEditingForm({ ...editingForm, coupon_code: e.target.value.toUpperCase() })}
                                placeholder="사용할 쿠폰 코드 입력"
                                autoComplete="off"
                                className="w-full rounded-lg border border-border bg-card px-2 py-1 font-mono text-xs uppercase"
                              />
                            )}
                            <input
                              type="datetime-local"
                              value={editingForm.scheduled_at}
                              onChange={(e) => setEditingForm({ ...editingForm, scheduled_at: e.target.value })}
                              className="w-full rounded-lg border border-border bg-card px-2 py-1 text-xs"
                            />
                            <div className="flex gap-1.5 justify-end">
                              <button onClick={() => setEditingPushId(null)} className="rounded bg-secondary px-2.5 py-1 text-[10px] font-bold">취소</button>
                              <button onClick={() => handleUpdatePush(p.id)} className="rounded bg-primary text-primary-foreground px-3 py-1 text-[10px] font-bold">저장</button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-primary font-mono">예약 대기 (ID: {p.id})</span>
                              <span className="text-[10px] text-muted-foreground">{dateStr}</span>
                            </div>
                            <h4 className="text-xs font-bold text-foreground mt-1">{p.title}</h4>
                            <p className="text-[11px] text-muted-foreground mt-0.5 whitespace-pre-wrap">{p.body}</p>
                            {p.coupon_code && (
                              <span className="mt-1.5 inline-flex rounded-md bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-bold text-primary">
                                쿠폰: {p.coupon_code}
                              </span>
                            )}
                            <div className="flex justify-end gap-1.5 mt-2 border-t border-border/20 pt-2">
                              <button onClick={() => startEditPush(p)} className="rounded bg-secondary hover:bg-secondary/80 px-2.5 py-1 text-[10px] font-bold text-foreground">수정</button>
                              <button onClick={() => handleDeletePush(p.id)} className="rounded bg-red-500/10 hover:bg-red-500/20 px-2.5 py-1 text-[10px] font-bold text-red-500">예약 취소</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </div>

          {/* 우측: 발송 완료된 푸시 이력 */}
          <div className="space-y-6">
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-bold flex items-center gap-1.5">📬 발송 완료된 알림 이력</h3>
                <button onClick={() => fetchSentPushes(sentPushesPage)} className="text-xs text-muted-foreground hover:text-foreground"><RefreshCw className="h-3.5 w-3.5" /></button>
              </div>
              <div className="space-y-2.5 max-h-[36rem] overflow-y-auto">
                {sentPushes.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">발송된 알림 내역이 없습니다.</p>
                ) : (
                  sentPushes.map((p) => {
                    // 등록 시각이 아닌 실제 발송 시각(sent_at)을 우선 표시 (과거 데이터는 created_at로 폴백)
                    const sentTimeSource = p.sent_at || p.created_at;
                    const sentTimeStr = sentTimeSource
                      ? formatLocalDateTime(sentTimeSource)
                      : '기록 없음';
                    return (
                      <div key={p.id} className="p-3 bg-secondary/15 border border-border/20 rounded-xl space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[9.5px] rounded bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 font-bold">발송 완료</span>
                          <span className="text-[10px] text-muted-foreground">{sentTimeStr}</span>
                        </div>
                        <h4 className="text-xs font-bold text-foreground mt-1.5">{p.title}</h4>
                        <p className="text-[11px] text-muted-foreground whitespace-pre-wrap">{p.body}</p>
                        {p.coupon_code && (
                          <span className="mt-1 inline-flex rounded-md bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-bold text-primary">
                            쿠폰: {p.coupon_code}
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* 페이지네이션 */}
              {sentPushesTotalPages > 1 && (
                <div className="mt-4 flex items-center justify-center gap-2">
                  <button
                    onClick={() => setSentPushesPage((p) => Math.max(1, p - 1))}
                    disabled={sentPushesPage <= 1}
                    className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                  >이전</button>
                  <span className="text-xs font-bold text-muted-foreground">{sentPushesPage} / {sentPushesTotalPages}</span>
                  <button
                    onClick={() => setSentPushesPage((p) => Math.min(sentPushesTotalPages, p + 1))}
                    disabled={sentPushesPage >= sentPushesTotalPages}
                    className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                  >다음</button>
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* 신고·밴 */}
      {subTab === 'reports' && (
        <section className="space-y-5">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold flex items-center gap-1.5 text-red-500"><AlertTriangle className="h-4 w-4" /> 카드 신고 접수 내역</h3>
              <button onClick={fetchReports} className="text-xs text-muted-foreground hover:text-foreground"><RefreshCw className="h-3.5 w-3.5" /></button>
            </div>
            <div className="space-y-2.5 max-h-96 overflow-y-auto">
              {reports.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">접수된 신고가 없습니다.</p>
              ) : reports.map((rep) => (
                <div key={rep.id} className="p-3 bg-secondary/30 rounded-lg space-y-2">
                  <div className="flex items-center gap-3">
                    <a href={rep.reported_image_url} target="_blank" rel="noopener noreferrer" className="shrink-0" title="원본 이미지 새 창으로 열기">
                      <img src={rep.reported_image_url} alt="snapshot" className="h-16 w-16 rounded border border-border object-cover" />
                    </a>
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-[11px] font-bold flex items-center gap-1.5">
                        신고 #{rep.id}
                        <span className="rounded bg-amber-400/20 px-1 text-[9px] font-black text-amber-500">{rep.star || 0}★</span>
                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${rep.status === 'pending' ? 'bg-red-500/15 text-red-500' : rep.status === 'resolved' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-secondary text-muted-foreground'}`}>{rep.status}</span>
                        {rep.puzzle_excluded ? (
                          <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-bold text-sky-500">퍼즐 제외됨</span>
                        ) : null}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        대상 스트리머: <span className="font-bold text-foreground">{rep.streamer_name || '(알 수 없음)'}</span> · {rep.channel_id}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        신고자: <span className="font-bold text-foreground">{rep.reporter_username || '(알 수 없음)'}</span> · {rep.reporter_id}
                      </p>
                      <p className="text-[10px] text-muted-foreground"><span className="text-foreground">사유:</span> {rep.reason}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5 border-t border-border/40 pt-2">
                    <button onClick={() => handleOpenReportPuzzlePractice(rep)} className="rounded bg-indigo-500/10 px-2 py-1 text-[10px] font-bold text-indigo-500 hover:bg-indigo-500/20">3x4 연습</button>
                    <button
                      onClick={() => handleExcludeReportImageFromPuzzle(rep)}
                      disabled={rep.puzzle_excluded === true}
                      className="rounded bg-sky-500/10 px-2 py-1 text-[10px] font-bold text-sky-500 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {rep.puzzle_excluded ? '퍼즐 제외 완료' : '퍼즐 제외'}
                    </button>
                    <button onClick={() => handleBanUser(rep.reporter_id, '7d', '허위/악성 신고 누적으로 인한 제재')} className="rounded bg-red-500/10 px-2 py-1 text-[10px] text-red-500 hover:bg-red-500/20">신고자 7일 밴</button>
                    {rep.status === 'pending' && isSelfDeletionReport(rep) ? (
                      <div className="flex flex-wrap items-center justify-end gap-1.5 rounded-lg border border-red-500/20 bg-red-500/5 px-2 py-1">
                        <label className="flex cursor-pointer select-none items-center gap-1.5 text-[10px] font-bold text-red-500">
                          <input
                            type="checkbox"
                            checked={preventReregistrationByReport[rep.id] === true}
                            onChange={(event) => {
                              const checked = event.target.checked;
                              setPreventReregistrationByReport((prev) => ({
                                ...prev,
                                [rep.id]: checked
                              }));
                            }}
                            className="h-3.5 w-3.5 rounded border-red-300 text-red-500"
                          />
                          재등록 금지
                        </label>
                        <button onClick={() => handleDeleteStreamerFromReport(rep)} className="rounded bg-red-500 px-2 py-1 text-[10px] font-bold text-white hover:bg-red-600">카드 삭제 처리</button>
                      </div>
                    ) : null}
                    {rep.status === 'pending' && !isSelfDeletionReport(rep) ? (
                      <>
                        <button onClick={() => handleReportedImageAction(rep, 'reset')} className="rounded bg-amber-500/10 px-2 py-1 text-[10px] text-amber-600 hover:bg-amber-500/20">{rep.star || 0}성 이미지 초기화</button>
                        <button onClick={() => handleReportedImageAction(rep, 'ban')} className="rounded bg-red-500/10 px-2 py-1 text-[10px] text-red-500 hover:bg-red-500/20">이미지 차단</button>
                      </>
                    ) : null}
                    <button onClick={() => handleResolveReport(rep.id, 'resolved', { detail: '관리자가 신고 내용을 확인했으며 별도 이미지 조치 없이 검토 완료 처리했습니다.' })} className="rounded bg-primary/10 px-2 py-1 text-[10px] text-primary hover:bg-primary/20">검토 완료</button>
                    <button onClick={() => handleResolveReport(rep.id, 'rejected')} className="rounded bg-secondary px-2 py-1 text-[10px] text-muted-foreground hover:bg-secondary/80">기각</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
            <h3 className="text-sm font-bold flex items-center gap-1.5"><Users className="h-4 w-4" /> 유저 직접 제재</h3>
            <input type="text" placeholder="대상 유저 ID(channelId)" value={banUserId}
              onChange={(e) => setBanUserId(e.target.value)}
              className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
            <input type="text" placeholder="제재 사유 (선택)" value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
            <div className="flex flex-wrap gap-1.5">
              {[['1d', '1일'], ['7d', '7일'], ['30d', '30일'], ['permanent', '영구']].map(([d, label]) => (
                <button key={d} onClick={() => handleBanUser(banUserId, d, banReason)} className="rounded bg-red-500/10 px-3 py-1.5 text-[11px] font-bold text-red-500 hover:bg-red-500/20">{label} 밴</button>
              ))}
              <button onClick={() => handleUnbanUser(banUserId)} className="rounded bg-emerald-500/10 px-3 py-1.5 text-[11px] font-bold text-emerald-500 hover:bg-emerald-500/20">밴 해제</button>
            </div>
          </div>

          {/* 제재된 유저 목록 및 관리 */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-border/50 pb-2">
              <h3 className="text-sm font-bold flex items-center gap-1.5 text-red-500">
                <Users className="h-4 w-4" /> 제재 중인 유저 관리
              </h3>
              <button
                onClick={() => fetchBannedUsers(bannedPage, bannedSearch, bannedSortBy, bannedSortOrder)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* 필터 및 검색 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                type="text"
                placeholder="닉네임 또는 유저 ID 검색"
                value={bannedSearch}
                onChange={(e) => setBannedSearch(e.target.value)}
                className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs w-full"
              />
              <div className="flex gap-2">
                <select
                  value={bannedSortBy}
                  onChange={(e) => setBannedSortBy(e.target.value)}
                  className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs flex-1"
                >
                  <option value="banned_until">제재 해제일</option>
                  <option value="username">닉네임</option>
                  <option value="id">유저 ID</option>
                  <option value="created_at">가입일</option>
                </select>
                <select
                  value={bannedSortOrder}
                  onChange={(e) => setBannedSortOrder(e.target.value as any)}
                  className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs w-24"
                >
                  <option value="desc">내림차순</option>
                  <option value="asc">오름차순</option>
                </select>
              </div>
              <div className="text-[10px] text-muted-foreground flex items-center">
                ※ 제재 해제일이 현재 시간보다 미래인 유저들만 표시됩니다.
              </div>
            </div>

            {/* 일괄 수정 컨트롤 */}
            {selectedBannedUserIds.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3 animate-in fade-in duration-200">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-500">
                    선택된 유저 {selectedBannedUserIds.length}명 제재 상태 일괄 수정
                  </span>
                  <button
                    onClick={() => setSelectedBannedUserIds([])}
                    className="text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    선택 해제
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <select
                    value={bulkBanDuration}
                    onChange={(e) => setBulkBanDuration(e.target.value)}
                    className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs w-32"
                  >
                    <option value="1d">1일 정지</option>
                    <option value="7d">7일 정지</option>
                    <option value="30d">30일 정지</option>
                    <option value="permanent">영구 정지</option>
                    <option value="unban">제재 해제 (정상화)</option>
                  </select>
                  <input
                    type="text"
                    placeholder="제재 변경 사유"
                    value={bulkBanReason}
                    onChange={(e) => setBulkBanReason(e.target.value)}
                    className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs flex-1 min-w-[150px]"
                  />
                  <button
                    onClick={handleBulkBanUpdate}
                    disabled={isBulkUpdating}
                    className="rounded-lg bg-amber-600 hover:bg-amber-700 text-white px-4 py-1.5 text-xs font-bold disabled:opacity-50 transition"
                  >
                    {isBulkUpdating ? '수정 중...' : '일괄 수정 적용'}
                  </button>
                </div>
              </div>
            )}

            {/* 테이블 목록 */}
            <div className="overflow-x-auto rounded-xl border border-border/60">
              <table className="w-full text-xs text-left border-collapse bg-secondary/10">
                <thead>
                  <tr className="border-b border-border/80 bg-secondary/50 text-[10px] font-bold text-muted-foreground">
                    <th className="p-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={bannedUsers.length > 0 && selectedBannedUserIds.length === bannedUsers.length}
                        onChange={toggleSelectAllBanned}
                        className="rounded border-border focus:ring-0"
                      />
                    </th>
                    <th className="p-3">닉네임 / ID</th>
                    <th className="p-3">제재 상태</th>
                    <th className="p-3">제재 해제 일시</th>
                    <th className="p-3">제재 사유</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {isBannedUsersLoading ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-muted-foreground font-bold">
                        로딩 중...
                      </td>
                    </tr>
                  ) : bannedUsers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-muted-foreground">
                        현재 제재 중인 유저가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    bannedUsers.map((u) => {
                      const expiration = u.banned_until ? new Date(u.banned_until) : null;
                      const isPermanent = expiration ? expiration.getFullYear() > 2099 : false;
                      const formattedExp = expiration
                        ? isPermanent
                          ? '영구 정지'
                          : formatLocalDateTime(expiration)
                        : '-';

                      let timeLeftStr = '';
                      if (expiration && !isPermanent) {
                        const diff = expiration.getTime() - Date.now();
                        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                        const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
                        if (days > 0) timeLeftStr = `${days}일 ${hours}시간 남음`;
                        else timeLeftStr = `${hours}시간 남음`;
                      }

                      return (
                        <tr key={u.id} className="hover:bg-secondary/20 transition-colors">
                          <td className="p-3 text-center">
                            <input
                              type="checkbox"
                              checked={selectedBannedUserIds.includes(u.id)}
                              onChange={() => toggleSelectBannedUser(u.id)}
                              className="rounded border-border focus:ring-0"
                            />
                          </td>
                          <td className="p-3 min-w-[150px]">
                            <div className="flex items-center gap-2">
                              {u.avatar_url ? (
                                <img
                                  src={u.avatar_url}
                                  alt={u.username}
                                  className="h-6 w-6 rounded-full object-cover shrink-0"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className="h-6 w-6 rounded-full bg-secondary flex items-center justify-center text-[8px] font-bold text-muted-foreground shrink-0">
                                  {(u.username || '?').slice(0, 2)}
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="font-bold text-foreground truncate">{u.username}</p>
                                <p className="text-[10px] text-muted-foreground truncate">{u.id}</p>
                              </div>
                            </div>
                          </td>
                          <td className="p-3 font-semibold">
                            {isPermanent ? (
                              <span className="text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded text-[10px]">
                                영구 정지
                              </span>
                            ) : (
                              <span className="text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded text-[10px]">
                                {timeLeftStr || '만료 임박'}
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-muted-foreground font-mono text-[10.5px]">
                            {formattedExp}
                          </td>
                          <td className="p-3 text-foreground break-all max-w-[200px]">
                            {u.ban_reason || <span className="text-muted-foreground italic">사유 없음</span>}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* 페이지네이션 */}
            {bannedTotalPages > 1 && (
              <div className="mt-4 flex items-center justify-center gap-2">
                <button
                  onClick={() => setBannedPage((p) => Math.max(1, p - 1))}
                  disabled={bannedPage <= 1 || isBannedUsersLoading}
                  className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                >
                  이전
                </button>
                <span className="text-xs font-bold text-muted-foreground">
                  {bannedPage} / {bannedTotalPages}
                </span>
                <button
                  onClick={() => setBannedPage((p) => Math.min(bannedTotalPages, p + 1))}
                  disabled={bannedPage >= bannedTotalPages || isBannedUsersLoading}
                  className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                >
                  다음
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {subTab === 'trades' && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-sm font-bold flex items-center gap-1.5">
                  <ArrowRightLeft className="h-4 w-4 text-primary" /> 유저간 1:1 거래 내역
                </h3>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  참여 유저 ID 또는 닉네임으로 후보를 먼저 좁힌 뒤 거래 내역을 조회합니다.
                </p>
              </div>
              <button
                onClick={() => fetchAdminTrades(adminTradesPage, adminTradesSearch, adminTradesStatus)}
                className="flex items-center justify-center gap-1 rounded-lg bg-secondary px-3 py-2 text-xs font-bold text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${adminTradesLoading ? 'animate-spin' : ''}`} /> 새로고침
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_160px]">
              <input
                type="text"
                placeholder="참여 유저 ID 또는 닉네임 검색"
                value={adminTradesSearch}
                onChange={(e) => setAdminTradesSearch(e.target.value)}
                className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs"
              />
              <select
                value={adminTradesStatus}
                onChange={(e) => setAdminTradesStatus(e.target.value as TradeStatus | 'ALL')}
                className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs"
              >
                <option value="ALL">전체 상태</option>
                <option value="PENDING">대기</option>
                <option value="CONFIRMED">동의됨</option>
                <option value="ACCEPTED">체결</option>
                <option value="REJECTED">거절</option>
                <option value="CANCELLED">취소</option>
              </select>
            </div>

            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>총 {adminTradesTotal.toLocaleString()}건</span>
              <span>페이지당 30건</span>
            </div>

            <div className="space-y-2">
              {adminTradesLoading && adminTrades.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">거래 내역을 불러오는 중입니다.</div>
              ) : adminTrades.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">조건에 맞는 1:1 거래 내역이 없습니다.</div>
              ) : (
                adminTrades.map((trade) => {
                  const status = tradeStatusMeta[trade.status] || tradeStatusMeta.PENDING;
                  const createdAt = trade.completed_at || trade.updated_at || trade.created_at;
                  return (
                    <article key={trade.id} className="rounded-xl border border-border bg-secondary/20 p-4">
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-black text-foreground">#{trade.id}</span>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${status.className}`}>{status.label}</span>
                            <span className="text-[10px] text-muted-foreground">{createdAt ? formatLocalDateTime(createdAt) : '시간 없음'}</span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                            <span className="rounded-lg bg-card px-2 py-1">
                              <b>{trade.sender_username || '탈퇴/미확인 유저'}</b>
                              <span className="ml-1 text-[10px] text-muted-foreground">{trade.sender_id}</span>
                            </span>
                            <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="rounded-lg bg-card px-2 py-1">
                              <b>{trade.receiver_username || '탈퇴/미확인 유저'}</b>
                              <span className="ml-1 text-[10px] text-muted-foreground">{trade.receiver_id}</span>
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                        <div className="rounded-lg bg-card/70 p-3">
                          <p className="text-[10px] font-bold text-muted-foreground">제안자 제공</p>
                          <p className="mt-1 text-xs font-black text-foreground">{summarizeTradeOffer(trade.sender_offer)}</p>
                          {renderTradeOfferDetail(trade.sender_offer)}
                        </div>
                        <div className="rounded-lg bg-card/70 p-3">
                          <p className="text-[10px] font-bold text-muted-foreground">상대 제공</p>
                          <p className="mt-1 text-xs font-black text-foreground">{summarizeTradeOffer(trade.receiver_offer)}</p>
                          {renderTradeOfferDetail(trade.receiver_offer)}
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                disabled={adminTradesPage <= 1 || adminTradesLoading}
                onClick={() => setAdminTradesPage((prev) => Math.max(1, prev - 1))}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold disabled:opacity-40"
              >
                이전
              </button>
              <span className="text-xs text-muted-foreground">
                {adminTradesPage} / {adminTradesTotalPages}
              </span>
              <button
                disabled={adminTradesPage >= adminTradesTotalPages || adminTradesLoading}
                onClick={() => setAdminTradesPage((prev) => Math.min(adminTradesTotalPages, prev + 1))}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold disabled:opacity-40"
              >
                다음
              </button>
            </div>
          </div>
        </section>
      )}

      {subTab === 'asset-events' && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-sm font-bold flex items-center gap-1.5">
                  <Activity className="h-4 w-4 text-primary" /> 전체 자산 변동 기록
                </h3>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  카드, 포인트, 코스메틱, 티켓의 추가·이동·삭제·환불·장착 내역을 자산 단위로 확인합니다.
                </p>
              </div>
              <button
                onClick={() => { fetchAssetEvents(true); fetchAssetSuspects(); }}
                className="flex items-center justify-center gap-1 rounded-lg bg-secondary px-3 py-2 text-xs font-bold text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${assetEventsLoading || assetSuspectsLoading ? 'animate-spin' : ''}`} /> 새로고침
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_150px_170px]">
              <input
                type="text"
                placeholder="유저 ID, 닉네임, 카드/아이템/출처 검색"
                value={assetEventSearch}
                onChange={(e) => setAssetEventSearch(e.target.value)}
                className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs"
              />
              <select
                value={assetEventType}
                onChange={(e) => setAssetEventType(e.target.value as AssetEventAssetType | 'ALL')}
                className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs"
              >
                {Object.entries(assetTypeLabel).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <select
                value={assetEventSource}
                onChange={(e) => setAssetEventSource(e.target.value)}
                className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs"
              >
                {Object.entries(assetSourceLabel).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-2">
                {assetEventsLoading && assetEvents.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">자산 기록을 불러오는 중입니다.</div>
                ) : assetEvents.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">조건에 맞는 자산 기록이 없습니다.</div>
                ) : (
                  assetEvents.map((event) => {
                    const relation = assetEventRelationLabel(event);
                    const action = assetActionLabel[event.action] || event.action;
                    const source = assetSourceLabel[event.source_type] || event.source_type;
                    return (
                      <article key={event.id} className="rounded-xl border border-border bg-secondary/20 p-4">
                        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-black text-foreground">#{event.id}</span>
                              <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                                {assetTypeLabel[event.asset_type] || event.asset_type} · {action}
                              </span>
                              <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{source}</span>
                              <span className="text-[10px] text-muted-foreground">{event.created_at ? formatLocalDateTime(event.created_at) : '시간 없음'}</span>
                            </div>
                            <p className="mt-2 text-sm font-black text-foreground">{assetEventSubject(event)}</p>
                            <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                              <span>대상: {assetEventActorLabel(event)}</span>
                              {relation && <span>{relation}</span>}
                              {event.source_id && <span>출처 ID: {event.source_id}</span>}
                              {event.balance_after != null && <span>잔액: {event.balance_after.toLocaleString()}P</span>}
                            </div>
                            {(event.description || event.reason) && (
                              <p className="mt-2 text-[11px] text-muted-foreground">{event.description || event.reason}</p>
                            )}
                          </div>
                          <div className="shrink-0 text-right text-[10px] text-muted-foreground">
                            {event.card_id && <p>card #{event.card_id}</p>}
                            {event.item_id && <p>item #{event.item_id}</p>}
                            {event.channel_id && <p className="max-w-[180px] truncate">{event.channel_id}</p>}
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}

                {assetEventsNextBeforeId && (
                  <div className="flex justify-center pt-2">
                    <button
                      onClick={() => fetchAssetEvents(false)}
                      disabled={assetEventsLoading}
                      className="rounded-lg border border-border px-4 py-2 text-xs font-bold text-muted-foreground hover:text-foreground disabled:opacity-40"
                    >
                      더 보기
                    </button>
                  </div>
                )}
              </div>

              <aside className="space-y-3">
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-black text-amber-700 dark:text-amber-200">정교 의심도 분석</h4>
                      <p className="mt-1 text-[10px] text-muted-foreground">최근 7일 · 관계 흐름 우선</p>
                    </div>
                    <span className="rounded-full border border-amber-500/20 bg-card px-2 py-0.5 text-[10px] font-black text-amber-600 dark:text-amber-200">
                      {assetSuspectSearch.trim() ? '검색 상세' : '상위 후보'}
                    </span>
                  </div>

                  <input
                    type="text"
                    placeholder="계정 ID 또는 닉네임으로 의심도 검색"
                    value={assetSuspectSearch}
                    onChange={(e) => setAssetSuspectSearch(e.target.value)}
                    className="mt-3 w-full rounded-lg border border-amber-500/20 bg-card/80 px-3 py-2 text-xs outline-none focus:border-amber-500/50"
                  />

                  <div className="mt-3 space-y-2">
                    {assetSuspectsLoading ? (
                      <p className="text-[11px] text-muted-foreground">의심도 계산 중입니다.</p>
                    ) : assetSuspects.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">현재 기준으로 표시할 후보가 없습니다.</p>
                    ) : (
                      assetSuspects.slice(0, 10).map((suspect) => {
                        const topCounterparty = suspect.counterparties?.[0];
                        const categories = suspect.categories || [];
                        return (
                          <div key={suspect.user_id} className="rounded-xl border border-border/70 bg-card/85 p-3 shadow-sm">
                            <div className="flex items-start justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => setAssetEventSearch(suspect.user_id)}
                                className="min-w-0 text-left"
                                title="이 계정의 자산 기록 필터링"
                              >
                                <p className="truncate text-xs font-black text-foreground">{suspect.username || '미확인 유저'}</p>
                                <p className="truncate text-[10px] text-muted-foreground">{suspect.user_id}</p>
                              </button>
                              <div className="shrink-0 text-right">
                                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${assetSuspicionSeverityClass(suspect.severity)}`}>
                                  {assetSuspicionSeverityLabel[suspect.severity] || suspect.severity}
                                </span>
                                <p className="mt-1 text-[10px] font-black text-foreground">{Math.round(suspect.risk_score || 0)}점</p>
                              </div>
                            </div>

                            {categories.length > 0 ? (
                              <div className="mt-3 space-y-1.5">
                                {categories.slice(0, 3).map((category) => (
                                  <div key={category.id} className="rounded-lg bg-secondary/45 p-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[10px] font-black text-foreground">{category.label}</span>
                                      <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-black ${assetSuspicionSeverityClass(category.severity)}`}>
                                        {category.score}점
                                      </span>
                                    </div>
                                    {category.reasons?.[0] && <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{category.reasons[0]}</p>}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-2 text-[11px] text-muted-foreground">검색된 계정의 최근 기록은 있으나 높은 의심 신호는 없습니다.</p>
                            )}

                            {topCounterparty && (
                              <div className="mt-3 rounded-lg border border-border/70 bg-secondary/20 p-2 text-[10px] text-muted-foreground">
                                <p className="font-black text-foreground">집중 상대: {topCounterparty.username || topCounterparty.user_id}</p>
                                <div className="mt-1 grid grid-cols-2 gap-1">
                                  <span>관계 이벤트 {topCounterparty.events.toLocaleString()}건</span>
                                  <span>카드 {topCounterparty.card_in.toLocaleString()}↓ / {topCounterparty.card_out.toLocaleString()}↑</span>
                                  <span>포인트 유입 {topCounterparty.point_in.toLocaleString()}P</span>
                                  <span>포인트 유출 {topCounterparty.point_out.toLocaleString()}P</span>
                                </div>
                              </div>
                            )}

                            <div className="mt-3 grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
                              <span>전체 이벤트 {suspect.total_events.toLocaleString()}건</span>
                              <span>관계 이벤트 {suspect.relation_events.toLocaleString()}건</span>
                              <span>순포인트 {suspect.point_net.toLocaleString()}P</span>
                              <span>카드 이동 {suspect.card_moves.toLocaleString()}건</span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-secondary/20 p-4">
                  <h4 className="text-xs font-black text-foreground">검토 주의사항</h4>
                  <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    <li>로그는 기능 배포 이후부터 누적되며, 과거 누락분은 기존 거래/포인트 원장과 함께 확인해야 합니다.</li>
                    <li>의심 요약은 자동 후보 추출입니다. 제재 전에는 거래 원장, 신고, 접속 제한 기록, 실제 보유 상태를 교차 확인해야 합니다.</li>
                    <li>동명이인 가능성이 있으므로 닉네임보다 계정 고유 ID와 카드 channel_id를 기준으로 판단해야 합니다.</li>
                    <li>경매 예약금, 환불, 코스메틱 제외 거래의 반환 이벤트는 정상 흐름에서도 짧은 시간에 여러 건 발생할 수 있습니다.</li>
                  </ul>
                </div>
              </aside>
            </div>
          </div>
        </section>
      )}

      {/* 스트리머 이미지 */}
      {subTab === 'streamers' && (() => {
        const hasAnyCustom = (s: any) => (s.custom_images && s.custom_images.some(Boolean)) || s.custom_image_url;
        const allCustom = couponStreamers.filter((s) => hasAnyCustom(s) || s.is_image_banned);
        const kw = streamerSearch.trim();
        const customStreamers = filterAdminStreamers(allCustom, kw);
        const PER_PAGE = 6;
        const totalPages = Math.max(1, Math.ceil(customStreamers.length / PER_PAGE));
        const page = Math.min(streamerPage, totalPages);
        const paged = customStreamers.slice((page - 1) * PER_PAGE, page * PER_PAGE);
        return (
          <section className="space-y-5">
            {/* 커스텀 이미지 보유/차단 스트리머 별별 제어 */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold flex items-center gap-1.5"><ImageIcon className="h-4 w-4" /> 커스텀 스트리머 이미지 관리 ({customStreamers.length})</h3>
                <button onClick={() => fetchCouponStreamers(true)} className="text-xs text-muted-foreground hover:text-foreground"><RefreshCw className="h-3.5 w-3.5" /></button>
              </div>
              {/* 검색 */}
              <input
                type="text"
                placeholder="스트리머 이름 또는 채널 ID 검색"
                value={streamerSearch}
                onChange={(e) => { setStreamerSearch(e.target.value); setStreamerPage(1); }}
                className="mb-3 w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs"
              />
              <div className="space-y-3">
                {customStreamers.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">{kw ? '검색 결과가 없습니다.' : '커스텀 이미지를 등록했거나 차단된 스트리머가 없습니다.'}</p>
                ) : paged.map((s) => {
                  const imgs: (string | null)[] = s.custom_images || [s.custom_image_url ?? null];
                  return (
                    <div key={s.channel_id} className="rounded-lg bg-secondary/30 p-3 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-bold truncate flex items-center gap-1.5">
                            {s.name}
                            {s.is_image_banned && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[9px] font-bold text-red-500">차단됨</span>}
                          </p>
                          <p className="text-[10px] text-muted-foreground truncate">{s.channel_id}</p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <button onClick={() => openStreamerImageResetConfirm({ channelId: s.channel_id, name: s.name })} className="rounded bg-secondary px-2 py-1 text-[10px] font-bold hover:bg-secondary/80">전체 초기화</button>
                          {s.is_image_banned ? (
                            <button onClick={() => handleStreamerImageAction('unban', s.channel_id)} className="rounded bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-500 hover:bg-emerald-500/20">해제</button>
                          ) : (
                            <button onClick={() => handleStreamerImageAction('ban', s.channel_id)} className="rounded bg-red-500/10 px-2 py-1 text-[10px] font-bold text-red-500 hover:bg-red-500/20">차단</button>
                          )}
                        </div>
                      </div>
                      {/* 0~5성 썸네일 + 개별 초기화 */}
                      <div className="grid grid-cols-6 gap-1.5">
                        {[0, 1, 2, 3, 4, 5].map((st) => {
                          const own = imgs[st] || null;
                          const resolved = cardImage(s, st);
                          return (
                            <div key={st} className="relative">
                              <div className="aspect-[5/8] overflow-hidden rounded-md border border-border/70 bg-secondary">
                                {resolved ? <img src={resolved} alt={`${st}성`} className="h-full w-full object-cover" /> : null}
                              </div>
                              <span className="absolute left-0.5 top-0.5 rounded bg-black/55 px-1 text-[7px] font-black text-amber-300">{st}★</span>
                              {own ? (
                                <button
                                  onClick={() => openStreamerImageResetConfirm({ channelId: s.channel_id, name: s.name, star: st, imageUrl: own })}
                                  title={`${st}성 이미지 초기화`}
                                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-black text-white shadow hover:bg-red-600"
                                >×</button>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 페이지네이션 */}
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-center gap-2">
                  <button
                    onClick={() => setStreamerPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
                  >이전</button>
                  <span className="text-xs font-bold text-muted-foreground">{page} / {totalPages}</span>
                  <button
                    onClick={() => setStreamerPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
                  >다음</button>
                </div>
              )}
            </div>

            {/* 프로필 이미지 미설정 스트리머 정리 */}
            <div className="rounded-2xl border border-amber-500/30 bg-card p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-bold flex items-center gap-1.5 text-amber-500">
                    <AlertTriangle className="h-4 w-4" /> 프로필 이미지 미설정 스트리머
                  </h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    치지직 프로필 이미지가 없는 스트리머는 신규 등록이 차단됩니다. 기존 등록분은 보유자에게 추가 무료 소환 티켓 1장씩 지급한 뒤 한 번에 삭제할 수 있습니다.
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    onClick={fetchMissingProfileStreamers}
                    disabled={missingProfileLoading || deletingMissingProfiles}
                    className="rounded-lg bg-secondary px-3 py-2 text-xs font-bold text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    {missingProfileLoading ? '조회 중...' : '새로고침'}
                  </button>
                  <button
                    onClick={handleDeleteMissingProfileStreamers}
                    disabled={deletingMissingProfiles || missingProfileLoading || missingProfileStreamers.length === 0}
                    className="rounded-lg bg-red-500 px-3 py-2 text-xs font-bold text-white hover:bg-red-600 disabled:pointer-events-none disabled:opacity-50"
                  >
                    {deletingMissingProfiles ? '삭제 중...' : '전체 삭제·보상'}
                  </button>
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-lg bg-secondary/40 px-3 py-2">
                  <p className="text-[10px] font-bold text-muted-foreground">대상 스트리머</p>
                  <p className="text-sm font-black">{missingProfileSummary.count.toLocaleString()}명</p>
                </div>
                <div className="rounded-lg bg-secondary/40 px-3 py-2">
                  <p className="text-[10px] font-bold text-muted-foreground">삭제될 카드</p>
                  <p className="text-sm font-black">{missingProfileSummary.total_cards.toLocaleString()}장</p>
                </div>
                <div className="rounded-lg bg-secondary/40 px-3 py-2">
                  <p className="text-[10px] font-bold text-muted-foreground">보상 대상</p>
                  <p className="text-sm font-black">{missingProfileSummary.total_affected_users.toLocaleString()}건</p>
                </div>
              </div>

              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                {missingProfileStreamers.length === 0 ? (
                  <p className="py-5 text-center text-xs text-muted-foreground">
                    {missingProfileLoading ? '조회 중입니다.' : '프로필 이미지가 설정되지 않은 스트리머가 없습니다.'}
                  </p>
                ) : missingProfileStreamers.map((s) => (
                  <div key={s.channel_id} className="flex items-center justify-between gap-3 rounded-lg bg-secondary/30 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold">{s.name}</p>
                      <p className="truncate text-[10px] text-muted-foreground">{s.channel_id}</p>
                    </div>
                    <div className="shrink-0 text-right text-[10px] font-bold text-muted-foreground">
                      <p>카드 {(s.card_count || 0).toLocaleString()}장</p>
                      <p>보상 {(s.affected_users || 0).toLocaleString()}건</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 수동 채널 ID 직접 제어 (보조) */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
              <h3 className="text-sm font-bold flex items-center gap-1.5"><ImageIcon className="h-4 w-4" /> 채널 ID 직접 제어</h3>
              <input type="text" placeholder="스트리머 채널 ID" value={streamerChannelId}
                onChange={(e) => setStreamerChannelId(e.target.value)}
                className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => openStreamerImageResetConfirm()} className="rounded bg-secondary px-3 py-1.5 text-[11px] font-bold hover:bg-secondary/80">기본 이미지로 초기화</button>
                <button onClick={() => handleStreamerImageAction('ban')} className="rounded bg-red-500/10 px-3 py-1.5 text-[11px] font-bold text-red-500 hover:bg-red-500/20">이미지 차단</button>
                <button onClick={() => handleStreamerImageAction('unban')} className="rounded bg-emerald-500/10 px-3 py-1.5 text-[11px] font-bold text-emerald-500 hover:bg-emerald-500/20">차단 해제</button>
              </div>
            </div>

            {/* 스트리머 카드 삭제(폐기) — 보유자에게 추가 무료 소환 티켓 보상 후 카드/스트리머 제거 */}
            {(() => {
              const list = filterAdminStreamers(couponStreamers, delSearch)
                .slice()
                .sort((a, b) => delSearch.trim()
                  ? 0
                  : (b.base_value || 0) - (a.base_value || 0));
              const PER = 8;
              const totalPages = Math.max(1, Math.ceil(list.length / PER));
              const page = Math.min(delPage, totalPages);
              const paged = list.slice((page - 1) * PER, page * PER);
              return (
                <div className="rounded-2xl border border-red-500/30 bg-card p-5 shadow-sm">
                  <h3 className="text-sm font-bold flex items-center gap-1.5 text-red-500"><Trash2 className="h-4 w-4" /> 스트리머 카드 삭제(폐기)</h3>
                  <p className="mt-1 mb-3 text-[11px] text-muted-foreground leading-relaxed">
                    삭제 시 해당 카드를 1장 이상 보유한 모든 유저에게 <b className="text-foreground/80">추가 무료 소환 티켓 1장</b>을 지급한 뒤 카드를 제거하고 스트리머를 폐기합니다. 필요하면 재등록 금지도 함께 적용할 수 있습니다. <b className="text-red-500">되돌릴 수 없습니다.</b>
                  </p>
                  <input
                    type="text"
                    placeholder="스트리머 이름 또는 채널 ID 검색"
                    value={delSearch}
                    onChange={(e) => { setDelSearch(e.target.value); setDelPage(1); }}
                    className="mb-3 w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs"
                  />
                  <div className="space-y-2">
                    {paged.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-6">스트리머가 없습니다.</p>
                    ) : paged.map((s) => (
                      <div key={s.channel_id} className="flex items-center justify-between gap-2 rounded-lg bg-secondary/30 px-3 py-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <img src={streamerProfileImage(s)} alt={s.name} className="h-9 w-9 rounded object-cover border border-border" />
                          <div className="min-w-0">
                            <p className="text-xs font-bold truncate">{s.name}</p>
                            <p className="text-[10px] text-muted-foreground truncate">현재 시세 {(s.base_value || 0).toLocaleString()} P · {s.channel_id}</p>
                          </div>
                        </div>
                        <button onClick={() => setDelTarget(s)} className="shrink-0 rounded bg-red-500/10 px-2.5 py-1 text-[10px] font-bold text-red-500 hover:bg-red-500/20">카드 삭제</button>
                      </div>
                    ))}
                  </div>
                  {totalPages > 1 && (
                    <div className="mt-3 flex items-center justify-center gap-2">
                      <button onClick={() => setDelPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                        className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none">이전</button>
                      <span className="text-xs font-bold text-muted-foreground">{page} / {totalPages}</span>
                      <button onClick={() => setDelPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                        className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none">다음</button>
                    </div>
                  )}
                </div>
              );
            })()}
          </section>
        );
      })()}

      {/* 커스텀 스트리머 이미지 삭제 확인 모달 */}
      {imageResetConfirm && (
        <div
          className="modal-backdrop modal-backdrop-center z-[90] bg-black/70 backdrop-blur-sm"
          onClick={() => {
            if (!resettingStreamerImage) setImageResetConfirm(null);
          }}
        >
          <div className="modal-panel modal-panel-sm modal-panel-scroll rounded-2xl border border-border bg-card p-5 text-center shadow-2xl animate-in zoom-in-95 duration-200 sm:p-6" onClick={(e) => e.stopPropagation()}>
            <Trash2 className="mx-auto mb-3 h-9 w-9 text-red-500" />
            <h4 className="mb-2 text-sm font-black text-foreground">커스텀 이미지 삭제</h4>
            {imageResetConfirm.imageUrl ? (
              <div className="mx-auto mb-3 aspect-[5/8] w-20 overflow-hidden rounded-xl border border-border bg-secondary shadow-sm">
                <img src={imageResetConfirm.imageUrl} alt="삭제할 커스텀 이미지" className="h-full w-full object-cover" />
              </div>
            ) : null}
            <p className="text-xs leading-relaxed text-muted-foreground">
              <b className="text-foreground">{imageResetConfirm.name || imageResetConfirm.channelId}</b>
              {imageResetConfirm.star !== undefined
                ? ` ${imageResetConfirm.star}성 커스텀 이미지를 기본 이미지로 되돌립니다.`
                : '의 모든 커스텀 이미지를 기본 이미지로 되돌립니다.'}
              <br />
              삭제된 커스텀 이미지는 복구할 수 없습니다.
            </p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <button
                onClick={() => setImageResetConfirm(null)}
                disabled={resettingStreamerImage}
                className="rounded-lg bg-secondary px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-secondary/80 disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={confirmStreamerImageReset}
                disabled={resettingStreamerImage}
                className="rounded-lg bg-red-500 px-5 py-2 text-xs font-bold text-white hover:bg-red-600 disabled:opacity-50"
              >
                {resettingStreamerImage ? '삭제 중...' : imageResetConfirm.star !== undefined ? '이미지 삭제' : '전체 삭제'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 스트리머 카드 삭제 확인 모달 */}
      {delTarget && (
        <div
          className="modal-backdrop modal-backdrop-center z-[90] bg-black/70 backdrop-blur-sm"
          onClick={() => {
            if (deleting) return;
            setDelTarget(null);
            setDelPreventReregistration(false);
          }}
        >
          <div className="modal-panel modal-panel-sm modal-panel-scroll rounded-2xl border border-border bg-card p-5 text-center shadow-2xl animate-in zoom-in-95 duration-200 sm:p-6" onClick={(e) => e.stopPropagation()}>
            <Trash2 className="mx-auto h-9 w-9 text-red-500 mb-3" />
            <h4 className="text-sm font-black text-foreground mb-2">스트리머 카드 삭제</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              <b className="text-foreground">{delTarget.name}</b> 카드를 모든 보유자에게서 삭제합니다.<br />
              보유자에게는 <b className="text-emerald-500">추가 무료 소환 티켓 1장</b>이 지급됩니다.<br />
              <b className="text-red-500">이 작업은 되돌릴 수 없습니다.</b>
            </p>
            <label className="mt-4 flex items-start gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-left text-[11px] leading-relaxed text-muted-foreground dark:bg-red-500/10">
              <input
                type="checkbox"
                checked={delPreventReregistration}
                onChange={(event) => setDelPreventReregistration(event.target.checked)}
                disabled={deleting}
                className="mt-0.5"
              />
              <span>
                <b className="block text-xs text-red-500">삭제 후 재등록 금지</b>
                권리자 요청 등으로 폐기하는 경우 선택하세요. 적용하면 같은 채널 ID의 스트리머 카드를 다시 등록할 수 없습니다.
              </span>
            </label>
            <div className="mt-5 flex items-center justify-center gap-2">
              <button
                onClick={() => {
                  setDelTarget(null);
                  setDelPreventReregistration(false);
                }}
                disabled={deleting}
                className="rounded-lg bg-secondary px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-secondary/80 disabled:opacity-50"
              >
                취소
              </button>
              <button onClick={handleDeleteStreamer} disabled={deleting} className="rounded-lg bg-red-500 px-5 py-2 text-xs font-bold text-white hover:bg-red-600 disabled:opacity-50">
                {deleting ? '삭제 중...' : delPreventReregistration ? '삭제·보상·재등록 금지' : '삭제하고 보상 지급'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 상점 관리 */}
      {subTab === 'shop' && (
        <section className="space-y-5">
          {/* 무료 뽑기 초기화 간격 설정 */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
            <h3 className="text-sm font-bold flex items-center gap-1.5">
              <RefreshCw className="h-4 w-4 text-primary" />
              무료 뽑기 리셋 주기 설정
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              KST 자정(00:00)을 기준으로 n시간마다 정각에 무료 뽑기를 리셋합니다.<br />
              예) <b>1</b>시간 → 00:00, 01:00, 02:00 ... KST 매 정각 리셋<br />
              예) <b>6</b>시간 → 00:00, 06:00, 12:00, 18:00 KST 리셋<br />
              <b>0</b>으로 설정 시 대기 없이 무제한 무료 뽑기가 가능합니다.<br />
              최대 중첩 횟수는 주기 충전 무료 소환 기회가 쌓일 수 있는 상한입니다.
            </p>
            <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
              <div className="relative flex-1">
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={freeDrawInterval}
                  onChange={(e) => setFreeDrawInterval(e.target.value)}
                  className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                  placeholder="예: 24 (시간 단위)"
                />
                <span className="absolute right-3 top-2 text-[10px] text-muted-foreground font-bold">시간</span>
              </div>
              <div className="relative flex-1">
                <input
                  type="number"
                  step="1"
                  min="1"
                  value={freeDrawMaxStack}
                  onChange={(e) => setFreeDrawMaxStack(e.target.value)}
                  className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                  placeholder="예: 3"
                />
                <span className="absolute right-3 top-2 text-[10px] text-muted-foreground font-bold">최대 중첩</span>
              </div>
              <button
                onClick={handleSaveFreeDrawInterval}
                disabled={isSavingInterval}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all shadow-md active:scale-95"
              >
                {isSavingInterval ? '저장 중...' : '설정 저장'}
              </button>
            </div>
          </div>

          {/* 미니게임 동전 충전 간격 설정 */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
            <h3 className="text-sm font-bold flex items-center gap-1.5">
              <Gamepad2 className="h-4 w-4 text-sky-500" />
              미니게임 동전 충전 간격 설정
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              미니게임 기본 동전이 1개 충전되는 시간을 분 단위로 설정합니다. 기본값은 <b>240분(4시간)</b>입니다.<br />
              이미 충전 대기 중인 유저의 동전은 삭제하거나 초기화하지 않고, 다음 상태 조회 시 새 간격 기준으로 남은 시간이 재계산됩니다.
            </p>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="number"
                  step="1"
                  min="1"
                  value={minigameTicketChargeMinutes}
                  onChange={(e) => setMinigameTicketChargeMinutes(e.target.value)}
                  className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none"
                  placeholder="예: 240"
                />
                <span className="absolute right-3 top-2 text-[10px] text-muted-foreground font-bold">분</span>
              </div>
              <button
                onClick={handleSaveMinigameTicketChargeInterval}
                disabled={isSavingMinigameTicketCharge}
                className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-bold text-white hover:bg-sky-600 disabled:opacity-50 transition-all shadow-md active:scale-95"
              >
                {isSavingMinigameTicketCharge ? '저장 중...' : '설정 저장'}
              </button>
            </div>
          </div>

          {/* 뽑기 비용 설정 */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
            <h3 className="text-sm font-bold flex items-center gap-1.5">
              <Store className="h-4 w-4 text-amber-500" />
              뽑기 1회 비용 설정
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              유료 가챠 1회에 소모되는 포인트를 설정합니다. <b>0</b>으로 설정 시 모든 뽑기가 무료가 됩니다.
            </p>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={drawCost}
                  onChange={(e) => setDrawCost(e.target.value)}
                  className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none"
                  placeholder="예: 10000"
                />
                <span className="absolute right-3 top-2 text-[10px] text-muted-foreground font-bold">P</span>
              </div>
              <button
                onClick={handleSaveDrawCost}
                disabled={isSavingCost}
                className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-white hover:bg-amber-600 disabled:opacity-50 transition-all shadow-md active:scale-95"
              >
                {isSavingCost ? '저장 중...' : '설정 저장'}
              </button>
            </div>
          </div>

          {/* 아이템 추가/수정 폼 */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
            <h3 className="text-sm font-bold flex items-center gap-1.5">
              <Store className="h-4 w-4" /> {shopForm.id ? `아이템 수정 (#${shopForm.id})` : '코스메틱 아이템 추가'}
            </h3>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px] xl:items-start">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-bold text-muted-foreground block mb-1">종류</label>
                    <select value={shopForm.type} onChange={(e) => setShopForm({ ...shopForm, type: e.target.value as any })}
                      className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs">
                      <option value="border">테두리</option>
                      <option value="name_effect">이름 이펙트</option>
                      <option value="emote">아레나 이모트</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-muted-foreground block mb-1">가격 (P)</label>
                    <input type="number" min={0} value={shopForm.price}
                      onChange={(e) => setShopForm({ ...shopForm, price: Number(e.target.value) })}
                      className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
                  </div>
                </div>

                <input type="text" placeholder="아이템 이름" value={shopForm.name}
                  onChange={(e) => setShopForm({ ...shopForm, name: e.target.value })}
                  className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
                <input type="text" placeholder="설명 (선택)" value={shopForm.description}
                  onChange={(e) => setShopForm({ ...shopForm, description: e.target.value })}
                  className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />

                <div>
                  <label className="text-[11px] font-bold text-muted-foreground block mb-1">1인 최대 구매 갯수 (0 = 무제한)</label>
                  <input type="number" min={0} value={shopForm.purchase_limit}
                    onChange={(e) => setShopForm({ ...shopForm, purchase_limit: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
                </div>

                <div className="rounded-2xl border border-amber-300/35 bg-amber-50/55 p-3 space-y-3 dark:border-amber-300/15 dark:bg-amber-300/10">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-black text-amber-700 dark:text-amber-200">한정판매 설정</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">기간 또는 전체 수량 중 하나만 설정해도 한정 상품으로 표시됩니다.</p>
                    </div>
                    {shopForm.id && shopForm.limited_total_quantity > 0 ? (
                      <span className="rounded-full bg-amber-300/20 px-2 py-0.5 text-[10px] font-black text-amber-700 dark:text-amber-200">
                        판매 {shopForm.sold_quantity || 0}/{shopForm.limited_total_quantity}
                      </span>
                    ) : null}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <label className="text-[10px] font-bold text-muted-foreground block mb-1">판매 시작</label>
                      <input
                        type="datetime-local"
                        value={shopForm.sale_start_at}
                        onChange={(e) => setShopForm({ ...shopForm, sale_start_at: e.target.value })}
                        className="w-full rounded-lg border border-border bg-card/70 px-3 py-2 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-muted-foreground block mb-1">판매 종료</label>
                      <input
                        type="datetime-local"
                        value={shopForm.sale_end_at}
                        onChange={(e) => setShopForm({ ...shopForm, sale_end_at: e.target.value })}
                        className="w-full rounded-lg border border-border bg-card/70 px-3 py-2 text-xs"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-muted-foreground block mb-1">전체 선착순 수량 (0 = 제한 없음)</label>
                    <input
                      type="number"
                      min={0}
                      value={shopForm.limited_total_quantity}
                      onChange={(e) => setShopForm({ ...shopForm, limited_total_quantity: Math.max(0, Number(e.target.value) || 0) })}
                      className="w-full rounded-lg border border-border bg-card/70 px-3 py-2 text-xs"
                    />
                  </div>
                </div>

                {/* 커스텀 CSS (테두리/이름 이펙트 공통 · 클래스명 + CSS 코드 전문) */}
                {(() => {
                  const isBorder = shopForm.type === 'border';
                  const isEmote = shopForm.type === 'emote';
                  const parsed = (() => { try { return JSON.parse(shopForm.style_json || '{}'); } catch { return {}; } })();
                  const curClass = typeof parsed?.class === 'string' ? parsed.class : '';
                  const curCss = typeof parsed?.css === 'string' ? parsed.css : '';
                  const curFallbackActive = !!parsed?.fallback_ks_active;
                  const curFallbackCss = typeof parsed?.fallback_ks_css === 'string' ? parsed.fallback_ks_css : '';
                  const setCustom = (cls: string, css: string, fallbackActive = curFallbackActive, fallbackCss = curFallbackCss) => {
                    const c = cls.trim();
                    if (!c && !css.trim() && !fallbackActive && !fallbackCss.trim()) { setShopForm({ ...shopForm, style_json: '' }); return; }
                    const obj: any = { class: c || (isBorder ? 'cb-custom' : isEmote ? 'ae-custom' : 'ne-custom') };
                    if (css.trim()) obj.css = css;
                    if (fallbackActive) obj.fallback_ks_active = true;
                    if (fallbackCss.trim()) obj.fallback_ks_css = fallbackCss;
                    setShopForm({ ...shopForm, style_json: JSON.stringify(obj) });
                  };
                  return (
                    <div className="rounded-lg border border-dashed border-border/70 bg-secondary/20 p-3 space-y-2">
                      <p className="text-[11px] font-bold text-muted-foreground">커스텀 CSS {isBorder ? '테두리' : isEmote ? '아레나 이모트' : '이름 이펙트'} (직접 작성)</p>
                      <input
                        type="text"
                        placeholder={isBorder ? '적용 클래스명 (예: cb-mydragon)' : isEmote ? '적용 클래스명 (예: ae-pop)' : '적용 클래스명 (예: ne-rainbow)'}
                        value={curClass}
                        onChange={(e) => setCustom(e.target.value, curCss)}
                        className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs font-mono"
                      />
                      <textarea
                        rows={6}
                        placeholder={isBorder
                          ? '.cb-mydragon { background-image: url("data:image/svg+xml,..."); box-shadow: 0 0 12px gold; }\n.cb-mydragon::after { /* 애니메이션 등 */ }\n@keyframes ... { }'
                          : isEmote
                            ? '.ae-pop { filter: drop-shadow(0 8px 18px rgba(14,165,233,.28)); animation: ae-pop .9s ease both; }\n@keyframes ae-pop { 0% { transform: scale(.45); opacity:0; } 100% { transform: scale(1); opacity:1; } }'
                          : '.ne-rainbow { background: linear-gradient(90deg,#f0f,#0ff); -webkit-background-clip: text; background-clip: text; color: transparent; }\n@keyframes ... { }'}
                        value={curCss}
                        onChange={(e) => setCustom(curClass, e.target.value)}
                        className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[11px] font-mono leading-relaxed"
                      />
                      <p className="text-[10px] text-muted-foreground leading-relaxed">
                        {isBorder
                          ? <>입력한 CSS가 그대로 주입되어 카드 위 오버레이(<code>.cosmetic-frame .클래스명</code>)에 적용됩니다.</>
                          : isEmote ? <>입력한 CSS가 그대로 주입되어 아레나 이모트 이미지 또는 텍스트에 적용됩니다. <code>{'{"image_url":"https://..."}'}</code> 형태를 함께 사용할 수 있습니다.</>
                          : <>입력한 CSS가 그대로 주입되어 카드 이름 텍스트(<code>.클래스명</code>)에 적용됩니다. (글자 색·그라데이션·그림자·애니메이션 등)</>}
                        <br />※ 클래스명과 <code>@keyframes</code> 이름은 다른 항목과 겹치지 않게 고유하게 지정하세요.
                      </p>

                      {!isBorder && !isEmote && (
                        <div className="pt-2 border-t border-border/40 space-y-2">
                          <label className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground cursor-pointer">
                            <input
                              type="checkbox"
                              checked={curFallbackActive}
                              onChange={(e) => setCustom(curClass, curCss, e.target.checked, curFallbackCss)}
                            />
                            완성형 외 한글 덮어쓰기 (폴백) 활성화
                          </label>
                          {curFallbackActive && (
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-muted-foreground block">폴백용 웹폰트 CSS (@font-face 정의)</label>
                              <textarea
                                rows={4}
                                placeholder={`@font-face {\n  font-family: 'GMarketSans';\n  src: url('https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2001@1.1/GmarketSansBold.woff') format('woff');\n  font-weight: 700;\n  font-display: swap;\n}`}
                                value={curFallbackCss}
                                onChange={(e) => setCustom(curClass, curCss, curFallbackActive, e.target.value)}
                                className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[10px] font-mono leading-relaxed"
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div>
                  <label className="text-[11px] font-bold text-muted-foreground block mb-1">
                    스타일 (CSS JSON · 고급) <span className="font-normal">이모트 예: {`{"image_url":"https://...","emoji":"✨"}`}</span>
                  </label>
                  <textarea rows={2} placeholder='{"borderColor":"#ff0000"}' value={shopForm.style_json}
                    onChange={(e) => setShopForm({ ...shopForm, style_json: e.target.value })}
                    className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs font-mono" />
                </div>

                {shopForm.type === 'name_effect' && (
                  <div className="grid grid-cols-2 gap-2">
                    <input type="text" placeholder="웹폰트 CSS 또는 .woff2 URL (선택)" value={shopForm.font_url}
                      onChange={(e) => setShopForm({ ...shopForm, font_url: e.target.value })}
                      className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
                    <input type="text" placeholder="font-family (선택)" value={shopForm.font_family}
                      onChange={(e) => setShopForm({ ...shopForm, font_family: e.target.value })}
                      className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
                    <p className="col-span-2 text-[10px] leading-relaxed text-muted-foreground">
                      직접 폰트 파일 URL을 사용할 때는 font-family도 입력하세요. 클래스 기반 효과에도 미리보기와 실제 카드 모두 동일하게 적용됩니다.
                    </p>
                  </div>
                )}

                {shopForm.type === 'emote' && (
                  <div className="rounded-2xl border border-sky-200/70 bg-sky-50/70 p-3 dark:border-sky-300/20 dark:bg-sky-300/10">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-[11px] font-black text-sky-700 dark:text-sky-100">이모트 이미지 업로드</p>
                        <p className="mt-0.5 text-[10px] font-bold text-muted-foreground">GIF 움짤을 포함한 이미지 파일을 사용할 수 있습니다.</p>
                      </div>
                      <label className="cute-wiggle-hover inline-flex cursor-pointer items-center justify-center gap-2 rounded-2xl bg-sky-500 px-3 py-2 text-[11px] font-black text-white shadow-sm transition hover:bg-sky-600">
                        <ImageIcon className="h-3.5 w-3.5" />
                        {shopEmoteUploading ? '업로드 중' : '이미지 선택'}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                          className="hidden"
                          disabled={shopEmoteUploading}
                          onChange={(event) => {
                            void uploadArenaEmoteAsset(event.target.files?.[0]);
                            event.currentTarget.value = '';
                          }}
                        />
                      </label>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
                      <input
                        type="text"
                        placeholder="이모지 대체 표시 예: ✨"
                        value={(() => { try { return String(JSON.parse(shopForm.style_json || '{}')?.emoji || ''); } catch { return ''; } })()}
                        onChange={(event) => mergeShopStyleJson({ emoji: event.target.value })}
                        className="rounded-xl border border-sky-200 bg-white/80 px-3 py-2 text-xs font-bold outline-none focus:border-sky-400 dark:border-sky-300/20 dark:bg-white/10"
                      />
                      <button
                        type="button"
                        onClick={() => mergeShopStyleJson({ image_url: '', emoji: '' })}
                        className="rounded-xl border border-sky-200 bg-white/80 px-3 py-2 text-[10px] font-black text-sky-700 hover:bg-sky-100 dark:border-sky-300/20 dark:bg-white/10 dark:text-sky-100"
                      >
                        이미지 비우기
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 미리보기 */}
              <div className="rounded-2xl border border-border/70 bg-gradient-to-br from-secondary/40 via-card to-primary/5 p-4 shadow-inner xl:sticky xl:top-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-black text-foreground">큰 미리보기</span>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                    {shopForm.type === 'border' ? '테두리' : shopForm.type === 'emote' ? '이모트' : '이름 효과'}
                  </span>
                </div>
                {shopForm.type === 'border' ? (
                  <div className="flex justify-center">
                    <div
                      className="relative aspect-[5/8] w-[min(180px,100%)] overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-br from-slate-950 via-slate-800 to-primary/30 shadow-lg"
                      style={{
                        containerType: 'inline-size',
                        ...(borderClass({ style_json: shopForm.style_json }) ? {} : (parseStyle(shopForm.style_json) || {}))
                      }}
                    >
                      <div className="absolute inset-[10%] rounded-xl bg-gradient-to-br from-white/20 via-white/5 to-black/20" />
                      <div className="absolute inset-x-4 bottom-5 space-y-1">
                        <div className="h-2 rounded-full bg-white/35" />
                        <div className="h-1.5 w-2/3 rounded-full bg-white/20" />
                      </div>
                      <CosmeticFrame border={{ style_json: shopForm.style_json }} />
                    </div>
                  </div>
                ) : shopForm.type === 'emote' ? (
                  <div className="flex min-h-[180px] items-center justify-center rounded-2xl border border-border/70 bg-background/60 px-4 text-center">
                    {(() => {
                      let parsed: any = {};
                      try { parsed = JSON.parse(shopForm.style_json || '{}'); } catch { parsed = {}; }
                      const imageUrl = typeof parsed.image_url === 'string' ? parsed.image_url : '';
                      const emoji = typeof parsed.emoji === 'string' ? parsed.emoji : '';
                      return (
                        <div className="flex h-24 w-24 items-center justify-center rounded-[2rem] border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-pink-50 text-4xl font-black shadow-lg">
                          {imageUrl ? <img src={imageUrl} alt={shopForm.name || 'emote'} className="h-20 w-20 object-contain" /> : emoji || '♪'}
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="flex min-h-[180px] items-center justify-center rounded-2xl border border-border/70 bg-background/60 px-4 text-center">
                    <CosmeticName effect={{ style_json: shopForm.style_json, font_url: shopForm.font_url, font_family: shopForm.font_family }} className="text-2xl font-black">
                      {shopForm.name || '미리보기'}
                    </CosmeticName>
                  </div>
                )}
                <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
                  실제 카드 비율에 가깝게 보여줍니다. 애니메이션 테두리는 이 영역에서 바로 확인할 수 있습니다.
                </p>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs font-bold">
              <input type="checkbox" checked={shopForm.active} onChange={(e) => setShopForm({ ...shopForm, active: e.target.checked })} />
              판매 활성화
            </label>

            <div className="flex gap-2">
              <button onClick={submitShopItem} className="flex-1 rounded-lg bg-primary py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90">
                {shopForm.id ? '수정 저장' : '아이템 추가'}
              </button>
              {shopForm.id ? (
                <button onClick={() => setShopForm({ ...emptyShopForm })} className="rounded-lg bg-secondary px-4 py-2 text-xs font-bold hover:bg-secondary/80">취소</button>
              ) : null}
            </div>
          </div>

          {/* 아이템 목록 */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold flex items-center gap-1.5"><Store className="h-4 w-4" /> 등록된 아이템 ({shopItems.length})</h3>
              <button onClick={fetchShopItems} className="text-xs text-muted-foreground hover:text-foreground"><RefreshCw className="h-3.5 w-3.5" /></button>
            </div>
            <div className="space-y-2 max-h-[28rem] overflow-y-auto">
              {shopItems.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">등록된 아이템이 없습니다.</p>
              ) : shopItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-secondary/30 px-3 py-2">
                  <div className="flex items-center gap-3 min-w-0">
                    {item.type === 'border' ? (
                      <div className="relative shrink-0 overflow-hidden rounded-lg border border-border/80 bg-gradient-to-br from-secondary to-card" style={{ width: '32px', height: '51.2px' }}>
                        <div style={{
                          width: '224px',
                          height: '358.4px',
                          transform: 'scale(calc(32 / 224))',
                          transformOrigin: 'top left',
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          pointerEvents: 'none',
                          containerType: 'inline-size',
                          ...(borderClass(item) ? {} : (parseStyle(item.style_json) || {}))
                         }}>
                          <CosmeticFrame border={item} />
                        </div>
                      </div>
                    ) : item.type === 'emote' ? (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-200 bg-sky-50 text-lg font-black text-sky-600">
                        {(() => {
                          let parsed: any = {};
                          try { parsed = JSON.parse(item.style_json || '{}'); } catch { parsed = {}; }
                          const imageUrl = typeof parsed.image_url === 'string' ? parsed.image_url : '';
                          const emoji = typeof parsed.emoji === 'string' ? parsed.emoji : '';
                          return imageUrl ? <img src={imageUrl} alt={item.name} className="h-8 w-8 object-contain" /> : emoji || '♪';
                        })()}
                      </div>
                    ) : (
                      <CosmeticName effect={item} className="shrink-0 text-base font-black px-1">{item.name}</CosmeticName>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-bold truncate flex items-center gap-1.5">
                        {item.name}
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">{item.type === 'border' ? '테두리' : item.type === 'emote' ? '이모트' : '이름 이펙트'}</span>
                        {!item.active && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[9px] font-bold text-red-500">비활성</span>}
                        {(item.sale_start_at || item.sale_end_at || (item.limited_total_quantity || 0) > 0) && (
                          <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-600">한정</span>
                        )}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {item.price.toLocaleString()} P · {item.purchase_limit > 0 ? `1인 ${item.purchase_limit}개 제한` : '구매 무제한'} · {item.description || '설명 없음'}
                      </p>
                      {(item.sale_start_at || item.sale_end_at || (item.limited_total_quantity || 0) > 0) && (
                        <p className="mt-0.5 text-[10px] font-bold text-amber-600 truncate">
                          {item.sale_start_at ? `시작 ${formatLocalDateTime(item.sale_start_at)}` : '즉시 시작'}
                          {' · '}
                          {item.sale_end_at ? `종료 ${formatLocalDateTime(item.sale_end_at)}` : '종료일 없음'}
                          {(item.limited_total_quantity || 0) > 0 ? ` · 선착순 ${item.sold_quantity || 0}/${item.limited_total_quantity}` : ''}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <div className="flex gap-1">
                      <button onClick={() => editShopItem(item)} className="rounded bg-secondary px-2 py-1 text-[10px] font-bold hover:bg-secondary/80">수정</button>
                      <button onClick={() => toggleShopActive(item)}
                        className={`rounded px-2 py-1 text-[10px] font-bold ${item.active ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20' : 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20'}`}>
                        {item.active ? '비활성화' : '활성화'}
                      </button>
                    </div>
                    {item.purchase_limit > 0 && (
                      <button onClick={() => resetItemPurchases(item)} className="rounded bg-amber-500/10 px-2 py-1 text-[10px] font-bold text-amber-600 hover:bg-amber-500/20">구매제한 초기화</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {subTab === 'arena' && (
        <section className="space-y-5">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-sm font-bold flex items-center gap-1.5">
                  <Gamepad2 className="h-4 w-4 text-primary" /> 치카포 아레나 운영
                </h3>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  매치는 라운드 단위로 확정하고, 화면 조회는 스냅샷과 단건 리플레이를 사용합니다.
                </p>
              </div>
              <button
                onClick={fetchArenaAdminData}
                disabled={arenaLoading}
                className="flex items-center justify-center gap-1 rounded-lg bg-secondary px-3 py-2 text-xs font-bold text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${arenaLoading ? 'animate-spin' : ''}`} /> 새로고침
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-4">
              {[
                { label: '빠른대전', value: arenaOps?.quick_match_enabled ? '활성' : '비활성' },
                { label: '8인 컵', value: arenaCups?.enabled ? '활성' : '비활성' },
                { label: '전투 전송', value: arenaOps?.transport_policy?.battle_transport || 'http_result_with_client_replay' },
                { label: '리플레이 보관', value: `${arenaOps?.replay_policy?.prune_retention_days || 7}일` }
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-border bg-secondary/30 p-4">
                  <p className="text-[10px] font-black text-muted-foreground">{item.label}</p>
                  <p className="mt-1 break-all text-sm font-black text-foreground">{item.value}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-2 md:grid-cols-5">
              <button
                onClick={() => runArenaAdminAction('stats')}
                disabled={Boolean(arenaActionLoading)}
                className="rounded-xl bg-primary px-3 py-2.5 text-xs font-black text-primary-foreground disabled:opacity-50"
              >
                {arenaActionLoading === 'stats' ? '재생성 중...' : '통계 스냅샷 재생성'}
              </button>
              <button
                onClick={() => runArenaAdminAction('rankings')}
                disabled={Boolean(arenaActionLoading)}
                className="rounded-xl border border-border bg-secondary px-3 py-2.5 text-xs font-black text-foreground disabled:opacity-50"
              >
                {arenaActionLoading === 'rankings' ? '재생성 중...' : '랭킹 스냅샷 재생성'}
              </button>
              <button
                onClick={() => runArenaAdminAction('prune')}
                disabled={Boolean(arenaActionLoading)}
                className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs font-black text-amber-600 disabled:opacity-50"
              >
                {arenaActionLoading === 'prune' ? '정리 중...' : '오래된 리플레이 정리'}
              </button>
              <button
                onClick={() => runArenaAdminAction('recoverCup')}
                disabled={Boolean(arenaActionLoading)}
                className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2.5 text-xs font-black text-sky-600 disabled:opacity-50"
              >
                {arenaActionLoading === 'recoverCup' ? '복구 중...' : '컵 큐 복구'}
              </button>
              <button
                onClick={() => runArenaAdminAction('recoverQuick')}
                disabled={Boolean(arenaActionLoading)}
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-xs font-black text-emerald-600 disabled:opacity-50"
              >
                {arenaActionLoading === 'recoverQuick' ? '복구 중...' : '빠른대전 큐 복구'}
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-border bg-secondary/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-xs font-black text-foreground">빠른대전 큐 현황</h4>
                <span className="text-[10px] font-bold text-muted-foreground">{arenaQuick?.enabled ? '활성' : '비활성'}</span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-5">
                {[
                  ['대기', arenaQuick?.queue?.waiting],
                  ['매칭중', arenaQuick?.queue?.matching],
                  ['완료', arenaQuick?.queue?.matched],
                  ['취소', arenaQuick?.queue?.cancelled],
                  ['만료', arenaQuick?.queue?.expired]
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl bg-card/80 px-3 py-2 text-center">
                    <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
                    <p className="mt-1 text-sm font-black text-foreground">{Number(value || 0).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-border bg-secondary/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-xs font-black text-foreground">8인 컵 운영 현황</h4>
                <span className="text-[10px] font-bold text-muted-foreground">총 {arenaCups?.cups_total || 0}회</span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-5">
                {[
                  ['대기', arenaCups?.queue?.waiting],
                  ['매칭중', arenaCups?.queue?.matching],
                  ['완료', arenaCups?.queue?.matched],
                  ['취소', arenaCups?.queue?.cancelled],
                  ['만료', arenaCups?.queue?.expired]
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl bg-card/80 px-3 py-2 text-center">
                    <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
                    <p className="mt-1 text-sm font-black text-foreground">{Number(value || 0).toLocaleString()}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-1.5">
                {(arenaCups?.latest_cups || []).length === 0 ? (
                  <p className="py-3 text-center text-[11px] font-bold text-muted-foreground">최근 완료된 컵이 없습니다.</p>
                ) : (arenaCups?.latest_cups || []).map((cup: any) => (
                  <div key={cup.id} className="flex items-center justify-between gap-2 rounded-xl bg-card/80 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-black text-foreground">컵 #{cup.id} · {cup.status}</p>
                      <p className="text-[10px] font-bold text-muted-foreground">참가 {cup.participant_count || 8}명 · 우승 {cup.champion_user_id || '-'}</p>
                    </div>
                    <span className="shrink-0 text-[10px] font-bold text-muted-foreground">{cup.completed_at ? formatLocalDateTime(cup.completed_at) : '-'}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-border bg-secondary/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-xs font-black text-foreground">최근 관리자 작업</h4>
                <span className="text-[10px] font-bold text-muted-foreground">{arenaJobs.length}개</span>
              </div>
              <div className="mt-3 space-y-1.5">
                {arenaJobs.length === 0 ? (
                  <p className="py-3 text-center text-[11px] font-bold text-muted-foreground">등록된 작업이 없습니다.</p>
                ) : arenaJobs.map((job: any) => (
                  <div key={job.id} className="flex items-center justify-between gap-2 rounded-xl bg-card/80 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-black text-foreground">#{job.id} · {job.job_type}</p>
                      <p className="text-[10px] font-bold text-muted-foreground">{job.error_message || (job.finished_at ? formatLocalDateTime(job.finished_at) : '대기/실행 중')}</p>
                    </div>
                    <span className="shrink-0 rounded bg-secondary px-2 py-1 text-[10px] font-black text-muted-foreground">{job.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-border/50 pb-3">
              <div>
                <h3 className="text-sm font-bold flex items-center gap-1.5">
                  <BarChart3 className="h-4 w-4 text-primary" /> 아레나 밸런스 통계
                </h3>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  요청 시 집계하지 않고 저장된 관리자 스냅샷만 표시합니다.
                </p>
              </div>
              <span className="rounded bg-secondary px-2 py-1 text-[10px] font-bold text-muted-foreground">
                {arenaStats?.source || 'snapshot'}
              </span>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              {(['user_record', 'class_combo', 'class_single', 'skill_single', 'stat_focus', 'deck_size'] as const).map((type) => {
                const labels: Record<string, string> = {
                  user_record: '유저 승패',
                  class_combo: '클래스 조합',
                  class_single: '클래스 단일',
                  skill_single: '스킬',
                  stat_focus: '스탯 성향',
                  deck_size: '덱 크기'
                };
                const items = (arenaStats?.items || []).filter((item: any) => item.snapshot_type === type).slice(0, 8);
                return (
                  <div key={type} className="rounded-2xl border border-border bg-secondary/20 p-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-black text-foreground">{labels[type]}</h4>
                      <span className="text-[10px] font-bold text-muted-foreground">{items.length}개</span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {items.length === 0 ? (
                        <p className="py-4 text-center text-[11px] font-bold text-muted-foreground">스냅샷 데이터가 없습니다.</p>
                      ) : items.map((item: any) => (
                        <div key={`${item.snapshot_type}-${item.metric_key}`} className="rounded-xl bg-card/80 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="min-w-0 truncate text-[11px] font-black text-foreground">{item.label || item.metric_key}</p>
                            <span className="shrink-0 text-[10px] font-black text-primary">{Math.round((item.win_rate || 0) * 100)}%</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between text-[10px] font-bold text-muted-foreground">
                            <span>표본 {item.sample_count || 0}</span>
                            <span>{item.wins || 0}승 {item.losses || 0}패 {item.draws || 0}무</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* 유지보수: DB 초기화 + 미사용 업로드 이미지 */}
      {subTab === 'maintenance' && (
        <section className="space-y-5">
          {/* 서비스 유지보수 및 점검 설정 */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-border/50 pb-2">
              <h3 className="text-sm font-bold flex items-center gap-1.5">
                <ShieldAlert className="h-4 w-4 text-rose-500" />
                서비스 유지보수 및 점검 설정
              </h3>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-muted-foreground">현재 상태:</span>
                {mActive ? (
                  <span className="rounded bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-500">점검 진행 중</span>
                ) : (
                  <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-500">정상 운영 중</span>
                )}
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              서비스 점검 모드를 켜면 ADMIN 권한을 가진 유저를 제외한 모든 접속자가 점검 안내 화면으로 강제 리디렉션됩니다.<br />
              점검 시작 및 예상 종료 일정을 입력한 후 설정을 적용할 수 있습니다.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-muted-foreground block mb-1">점검 시작 날짜</label>
                <input
                  type="datetime-local"
                  value={mStartAt}
                  onChange={(e) => setMStartAt(e.target.value)}
                  className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-muted-foreground block mb-1">점검 종료 예상 날짜</label>
                <input
                  type="datetime-local"
                  value={mEndAt}
                  onChange={(e) => setMEndAt(e.target.value)}
                  className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1 border-t border-border/30">
              {mActive ? (
                <button
                  onClick={() => saveMaintenanceStatus(false)}
                  disabled={isSavingMaintenance}
                  className="flex-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 py-2.5 text-xs font-bold text-white disabled:opacity-50 transition shadow-md active:scale-[0.98]"
                >
                  {isSavingMaintenance ? '처리 중...' : '점검 종료 (서비스 재개)'}
                </button>
              ) : (
                <button
                  onClick={() => saveMaintenanceStatus(true)}
                  disabled={isSavingMaintenance}
                  className="flex-1 rounded-lg bg-rose-600 hover:bg-rose-700 py-2.5 text-xs font-bold text-white disabled:opacity-50 transition shadow-md active:scale-[0.98]"
                >
                  {isSavingMaintenance ? '처리 중...' : '점검 시작 (차단 활성화)'}
                </button>
              )}
            </div>
          </div>

          {/* DB 부분 초기화 */}
          <div className="rounded-2xl border border-red-500/30 bg-card p-5 shadow-sm">
            <h3 className="text-sm font-bold flex items-center gap-1.5 text-red-500"><Database className="h-4 w-4" /> DB 부분 초기화</h3>
            <p className="mt-1 mb-3 text-[11px] text-muted-foreground leading-relaxed">
              선택한 항목만 초기화합니다. <b className="text-foreground/80">유저 가입/로그인 · 스트리머 등록 · 카드 이미지</b>는 보존됩니다. <b className="text-red-500">되돌릴 수 없습니다.</b>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {resetInfo.map((c) => {
                const on = selectedCats.includes(c.id);
                return (
                  <button key={c.id} onClick={() => toggleCat(c.id)}
                    className={`flex items-start gap-2 rounded-lg border p-2.5 text-left transition ${on ? 'border-red-500 bg-red-500/10' : 'border-border/60 hover:bg-secondary/40'}`}>
                    <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-red-500 bg-red-500 text-white' : 'border-border'}`}>{on ? '✓' : ''}</span>
                    <span className="min-w-0">
                      <span className="block text-xs font-bold truncate">{c.label} <span className="text-[10px] font-normal text-muted-foreground">({c.count.toLocaleString()})</span></span>
                      <span className="block text-[10px] text-muted-foreground leading-snug">{c.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <button onClick={fetchResetInfo} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"><RefreshCw className="h-3.5 w-3.5" /> 새로고침</button>
              <button
                onClick={() => setResetConfirmOpen(true)}
                disabled={selectedCats.length === 0}
                className="rounded-lg bg-red-500 px-4 py-2 text-xs font-bold text-white hover:bg-red-600 disabled:opacity-40 disabled:pointer-events-none"
              >
                선택 항목 초기화 ({selectedCats.length})
              </button>
            </div>
          </div>

          {/* 미사용 업로드 이미지 */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold flex items-center gap-1.5"><ImageIcon className="h-4 w-4" /> 미사용 업로드 이미지 ({orphans.length})</h3>
              <button onClick={fetchOrphans} className="text-xs text-muted-foreground hover:text-foreground"><RefreshCw className="h-3.5 w-3.5" /></button>
            </div>
            <p className="mb-3 text-[11px] text-muted-foreground leading-relaxed">
              현재 어떤 스트리머 카드에도 연결되지 않은 업로드 이미지입니다.
              {orphanInfo && <> (전체 {orphanInfo.total_files}개 중 사용 {orphanInfo.referenced}개)</>}
            </p>
            {orphanLoading ? (
              <p className="text-xs text-muted-foreground text-center py-8">불러오는 중...</p>
            ) : orphans.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">미사용 이미지가 없습니다. 🎉</p>
            ) : (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <button onClick={toggleAllOrphans} className="rounded bg-secondary px-2.5 py-1 text-[11px] font-bold hover:bg-secondary/80">
                    {selectedOrphans.length === orphans.length ? '전체 해제' : '전체 선택'}
                  </button>
                  <span className="text-[11px] text-muted-foreground">{selectedOrphans.length}개 선택됨</span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 max-h-80 overflow-y-auto">
                  {orphans.map((o) => {
                    const on = selectedOrphans.includes(o.rel);
                    return (
                      <button key={o.rel} onClick={() => toggleOrphan(o.rel)}
                        className={`relative aspect-square overflow-hidden rounded-lg border-2 transition ${on ? 'border-red-500 ring-2 ring-red-500/30' : 'border-border/60 hover:border-border'}`}
                        title={o.rel}>
                        <img src={o.url} alt={o.rel} className="h-full w-full object-cover" />
                        {on && <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-black text-white">✓</span>}
                        <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-[8px] text-white">{(o.size / 1024).toFixed(0)}KB</span>
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={handleDeleteOrphans}
                  disabled={deletingOrphans || selectedOrphans.length === 0}
                  className="mt-3 w-full rounded-lg bg-red-500 py-2 text-xs font-bold text-white hover:bg-red-600 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-1"
                >
                  <Trash2 className="h-3.5 w-3.5" /> {deletingOrphans ? '삭제 중...' : `선택한 ${selectedOrphans.length}개 영구 삭제`}
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {/* DB 초기화 확인 모달 */}
      {resetConfirmOpen && (
        <div className="modal-backdrop modal-backdrop-center z-[90] bg-black/70 backdrop-blur-sm" onClick={() => !resetting && setResetConfirmOpen(false)}>
          <div className="modal-panel modal-panel-sm modal-panel-scroll rounded-2xl border border-border bg-card p-5 text-center shadow-2xl animate-in zoom-in-95 duration-200 sm:p-6" onClick={(e) => e.stopPropagation()}>
            <Database className="mx-auto h-9 w-9 text-red-500 mb-3" />
            <h4 className="text-sm font-black text-foreground mb-2">선택 항목 초기화</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              다음 항목을 초기화합니다:<br />
              <b className="text-foreground">{resetInfo.filter((c) => selectedCats.includes(c.id)).map((c) => c.label).join(', ')}</b><br />
              <b className="text-red-500">이 작업은 되돌릴 수 없습니다.</b>
            </p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <button onClick={() => setResetConfirmOpen(false)} disabled={resetting} className="rounded-lg bg-secondary px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-secondary/80 disabled:opacity-50">취소</button>
              <button onClick={handleResetData} disabled={resetting} className="rounded-lg bg-red-500 px-5 py-2 text-xs font-bold text-white hover:bg-red-600 disabled:opacity-50">
                {resetting ? '초기화 중...' : '초기화 실행'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
