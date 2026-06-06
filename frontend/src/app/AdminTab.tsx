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
  Award
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import type { AdminReport, OrphanImage, ShopItem, Coupon, Announcement } from '@/lib/types';
import { AdminUsersTab } from './AdminUsersTab';
import { parseStyle, nameEffectStyle, cardImage, borderClass } from '@/lib/cosmetics';
import { CosmeticFrame } from './CosmeticFrame';
import { CosmeticName } from './CosmeticName';
import { AdminTitlesTab } from './AdminTitlesTab';

type AdminSubTab = 'dashboard' | 'users' | 'titles' | 'coupons' | 'announcements' | 'push' | 'reports' | 'streamers' | 'shop' | 'maintenance';
type PushTargetType = 'default' | 'coupon';

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

const couponExpirationFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
});

export const AdminTab: React.FC = () => {
  const { user, toast, checkMaintenanceStatus } = useApp();
  const searchParams = useSearchParams();
  const router = useRouter();

  // URL tab 쿼리 파라미터를 기반으로 초기 subTab 결정
  const tabParam = searchParams.get('tab') as AdminSubTab | null;
  const initialSubTab: AdminSubTab = (
    tabParam === 'dashboard' ||
    tabParam === 'users' ||
    tabParam === 'titles' ||
    tabParam === 'coupons' ||
    tabParam === 'announcements' ||
    tabParam === 'push' ||
    tabParam === 'reports' ||
    tabParam === 'streamers' ||
    tabParam === 'shop' ||
    tabParam === 'maintenance'
  ) ? tabParam : 'dashboard';

  const [subTab, setSubTab] = useState<AdminSubTab>(initialSubTab);

  // 외부(뒤로가기 등)에서 URL 파라미터가 바뀔 때 상태 동기화
  useEffect(() => {
    const param = searchParams.get('tab') as AdminSubTab | null;
    if (param && [
      'dashboard', 'users', 'titles', 'coupons', 'announcements',
      'push', 'reports', 'streamers', 'shop', 'maintenance'
    ].includes(param)) {
      setSubTab(param);
    }
  }, [searchParams]);

  // 서브 탭 전환 시 URL 쿼리 파라미터 동기화
  const handleSubTabChange = (tab: AdminSubTab) => {
    setSubTab(tab);
    const newParams = new URLSearchParams(window.location.search);
    newParams.set('tab', tab);
    router.replace(`/admin?${newParams.toString()}`);
  };

  // 대시보드
  const [stats, setStats] = useState<any | null>(null);

  // 스트리머 이미지 검색/페이지네이션
  const [streamerSearch, setStreamerSearch] = useState('');
  const [streamerPage, setStreamerPage] = useState(1);

  // 스트리머 카드 삭제(폐기) 검색/페이지네이션/확인
  const [delSearch, setDelSearch] = useState('');
  const [delPage, setDelPage] = useState(1);
  const [delTarget, setDelTarget] = useState<any | null>(null);
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
  const emptyShopForm = { id: 0, type: 'border' as 'border' | 'name_effect', name: '', description: '', price: 1000, style_json: '', font_url: '', font_family: '', active: true, purchase_limit: 0 };
  const [shopForm, setShopForm] = useState({ ...emptyShopForm });
  const [freeDrawInterval, setFreeDrawInterval] = useState('24');
  const [isSavingInterval, setIsSavingInterval] = useState(false);
  const [drawCost, setDrawCost] = useState('10000');           // 뽑기 1회 비용 (P)
  const [isSavingCost, setIsSavingCost] = useState(false);    // 뽑기 비용 저장 중 여부

  // 쿠폰
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [couponStreamers, setCouponStreamers] = useState<any[]>([]);
  const [couponStreamerSearch, setCouponStreamerSearch] = useState('');
  const [couponForm, setCouponForm] = useState({
    code: '',
    coupon_type: 'single' as 'single' | 'multi',
    reward_type: 'point' as 'point' | 'card' | 'cosmetic' | 'minigame_ticket',
    points: 1000,
    reward_channel_id: '',
    reward_item_id: 0,
    reward_quantity: 1,
    max_uses: 1,
    expires_at: ''
  });
  // 쿠폰 코스메틱 보상용 상점 아이템 목록
  const [couponCosmetics, setCouponCosmetics] = useState<any[]>([]);

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
  const [banUserId, setBanUserId] = useState('');
  const [banReason, setBanReason] = useState('');

  // 스트리머 이미지 관리
  const [streamerChannelId, setStreamerChannelId] = useState('');

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
    if (subTab === 'coupons') { fetchCoupons(); fetchCouponStreamers(); fetchCouponCosmetics(); }
    if (subTab === 'announcements') fetchAnnouncements();
    if (subTab === 'reports') {
      fetchReports();
      fetchBannedUsers(1, bannedSearch, bannedSortBy, bannedSortOrder);
    }
    if (subTab === 'streamers') fetchCouponStreamers(true);
    if (subTab === 'shop') {
      fetchShopItems();
      fetchFreeDrawInterval();
      fetchDrawCost();
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
  const fetchCouponStreamers = async (force = false) => {
    if (!force && couponStreamers.length > 0) return;
    try {
      const res = await apiFetch('/streamers');
      if (res.ok) setCouponStreamers(await res.json());
    } catch { /* noop */ }
  };
  // 카드 보상 쿠폰 목록 표시용 채널ID→이름 매핑
  const streamerName = (channelId: string) =>
    couponStreamers.find((s) => s.channel_id === channelId)?.name || channelId;
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

  const handleCreateCoupon = async () => {
    if (couponForm.reward_type === 'card' && !couponForm.reward_channel_id) {
      toast('지급할 스트리머 카드를 선택해 주세요.');
      return;
    }
    if (couponForm.reward_type === 'cosmetic' && !couponForm.reward_item_id) {
      toast('지급할 코스메틱 아이템을 선택해 주세요.');
      return;
    }
    if (couponForm.reward_type === 'minigame_ticket' && (!couponForm.reward_quantity || couponForm.reward_quantity <= 0)) {
      toast('지급할 추가 미니게임 티켓 수량을 입력해 주세요.');
      return;
    }
    // 만료 일시는 datetime-local → ISO 변환
    const payload = {
      ...couponForm,
      expires_at: couponForm.expires_at ? new Date(couponForm.expires_at).toISOString() : null
    };
    try {
      const res = await apiFetch('/admin/coupons', { method: 'POST', body: JSON.stringify(payload) });
      const data = await res.json();
      if (res.ok) {
        toast(`쿠폰이 발급되었습니다.\n코드: ${data.code}`);
        setCouponForm({ code: '', coupon_type: 'single', reward_type: 'point', points: 1000, reward_channel_id: '', reward_item_id: 0, reward_quantity: 1, max_uses: 1, expires_at: '' });
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
        scheduled_at: pushForm.scheduled_at,
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
        scheduled_at: editingForm.scheduled_at ? new Date(editingForm.scheduled_at).toISOString() : null,
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
    let localTime = '';
    if (push.scheduled_at) {
      const d = new Date(push.scheduled_at);
      const pad = (n: number) => String(n).padStart(2, '0');
      localTime = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    setEditingForm({
      title: push.title,
      body: push.body,
      scheduled_at: localTime,
      target_type: push.coupon_code ? 'coupon' : 'default',
      coupon_code: push.coupon_code || ''
    });
  };

  const handleResolveReport = async (reportId: number, status: 'resolved' | 'rejected') => {
    try {
      const res = await apiFetch(`/admin/reports/${reportId}/resolve`, { method: 'POST', body: JSON.stringify({ status }) });
      if (res.ok) {
        toast(`신고가 ${status === 'resolved' ? '처리' : '기각'}되었습니다.`);
        fetchReports();
      } else toast('처리 실패');
    } catch { toast('서버 통신 에러'); }
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
      }
    } catch { /* noop */ }
  };

  const handleSaveFreeDrawInterval = async () => {
    const num = parseFloat(freeDrawInterval);
    if (isNaN(num) || num < 0) {
      toast('올바른 0 이상의 숫자를 지정해야 합니다.', 'error');
      return;
    }
    setIsSavingInterval(true);
    try {
      const res = await apiFetch('/admin/config/free-draw', {
        method: 'POST',
        body: JSON.stringify({ interval: num })
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
      purchase_limit: Math.max(0, Number(shopForm.purchase_limit) || 0)
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
      font_family: item.font_family || '', active: item.active, purchase_limit: item.purchase_limit || 0
    });
  };

  // ---- 유지보수 ----
  const fetchMaintenanceStatus = async () => {
    try {
      const res = await apiFetch('/maintenance/status');
      if (res.ok) {
        const data = await res.json();
        setMActive(!!data.active);

        const formatForInput = (isoStr: string | null) => {
          if (!isoStr) return '';
          const d = new Date(isoStr);
          const pad = (n: number) => String(n).padStart(2, '0');
          return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        };

        setMStartAt(formatForInput(data.startAt));
        setMEndAt(formatForInput(data.endAt));
      }
    } catch { /* noop */ }
  };

  const saveMaintenanceStatus = async (active: boolean) => {
    setIsSavingMaintenance(true);
    try {
      const startAtIso = mStartAt ? new Date(mStartAt).toISOString() : null;
      const endAtIso = mEndAt ? new Date(mEndAt).toISOString() : null;

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
        body: JSON.stringify({ confirmation: delTarget.channel_id })
      });
      const data = await res.json();
      if (res.ok) {
        toast(data.message || '스트리머 카드를 삭제했습니다.', 'success');
        setDelTarget(null);
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

  const handleStreamerImageAction = async (action: 'reset' | 'ban' | 'unban', channelId?: string, star?: number) => {
    const target = (channelId || streamerChannelId).trim();
    if (!target) { toast('스트리머 채널 ID를 입력해 주세요.'); return; }
    try {
      const body = action === 'reset' && star !== undefined ? JSON.stringify({ star }) : undefined;
      const res = await apiFetch(`/admin/streamers/${target}/image/${action}`, { method: 'POST', ...(body ? { body } : {}) });
      const data = await res.json();
      toast(data.message || '처리되었습니다.');
      fetchCouponStreamers(true); // 목록 갱신
    } catch { toast('서버 통신 에러'); }
  };

  const subTabs: { id: AdminSubTab; label: string; icon: typeof Tag }[] = [
    { id: 'dashboard', label: '대시보드', icon: LayoutDashboard },
    { id: 'users', label: '유저', icon: Users },
    { id: 'titles', label: '칭호', icon: Award },
    { id: 'coupons', label: '쿠폰', icon: Tag },
    { id: 'announcements', label: '공지', icon: Megaphone },
    { id: 'push', label: '푸시', icon: BellRing },
    { id: 'reports', label: '신고·밴', icon: AlertTriangle },
    { id: 'streamers', label: '스트리머 이미지', icon: ImageIcon },
    { id: 'shop', label: '상점 관리', icon: Store },
    { id: 'maintenance', label: 'DB 초기화', icon: Database }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center gap-2 text-red-500">
        <ShieldAlert className="h-6 w-6" />
        <h2 className="text-xl font-black text-foreground">CCTV 관리자 통제 센터</h2>
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

      {/* 유저 목록 (자기완결형 컴포넌트로 분리) */}
      {subTab === 'users' && <AdminUsersTab />}
      {subTab === 'titles' && <AdminTitlesTab />}

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

            {/* 보상 종류 */}
            <div>
              <label className="text-[11px] font-bold text-muted-foreground block mb-1">보상 종류</label>
              <select value={couponForm.reward_type}
                onChange={(e) => setCouponForm({ ...couponForm, reward_type: e.target.value as any })}
                className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs">
                <option value="point">재화 (포인트)</option>
                <option value="card">스트리머 카드</option>
                <option value="cosmetic">코스메틱 아이템</option>
                <option value="minigame_ticket">추가 미니게임 티켓</option>
              </select>
            </div>

            {couponForm.reward_type === 'point' && (
              <input type="number" min={1} placeholder="지급 포인트" value={couponForm.points}
                onChange={(e) => setCouponForm({ ...couponForm, points: Number(e.target.value) })}
                className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
            )}

            {couponForm.reward_type === 'card' && (
              <div className="space-y-2 rounded-lg border border-border/60 bg-secondary/20 p-2.5">
                <input type="text" placeholder="스트리머 검색" value={couponStreamerSearch}
                  onChange={(e) => setCouponStreamerSearch(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-xs" />
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {couponStreamers
                    .filter((s) => couponStreamerSearch.trim() === '' ? true : s.name.toLowerCase().includes(couponStreamerSearch.toLowerCase()))
                    .slice(0, 20)
                    .map((s) => (
                      <button key={s.channel_id}
                        onClick={() => setCouponForm({ ...couponForm, reward_channel_id: s.channel_id })}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${couponForm.reward_channel_id === s.channel_id ? 'bg-primary/15 ring-1 ring-primary/40' : 'hover:bg-secondary/60'}`}>
                        <img src={s.custom_image_url || s.logo_url} alt={s.name} className="h-6 w-6 rounded-full object-cover" />
                        <span className="text-[11px] font-bold truncate">{s.name}</span>
                      </button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">지급 수량</span>
                  <input type="number" min={1} value={couponForm.reward_quantity}
                    onChange={(e) => setCouponForm({ ...couponForm, reward_quantity: Number(e.target.value) })}
                    className="w-20 rounded-lg border border-border bg-card px-2 py-1.5 text-xs" />
                </div>
              </div>
            )}

            {couponForm.reward_type === 'cosmetic' && (
              <div className="space-y-2 rounded-lg border border-border/60 bg-secondary/20 p-2.5">
                {couponCosmetics.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground py-2 text-center">등록된 코스메틱 아이템이 없습니다. 상점 관리에서 먼저 추가하세요.</p>
                ) : (
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {couponCosmetics.map((it) => (
                      <button key={it.id}
                        onClick={() => setCouponForm({ ...couponForm, reward_item_id: it.id })}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${couponForm.reward_item_id === it.id ? 'bg-primary/15 ring-1 ring-primary/40' : 'hover:bg-secondary/60'}`}>
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
                  <input type="number" min={1} value={couponForm.reward_quantity}
                    onChange={(e) => setCouponForm({ ...couponForm, reward_quantity: Number(e.target.value) })}
                    className="w-20 rounded-lg border border-border bg-card px-2 py-1.5 text-xs" />
                </div>
              </div>
            )}

            {couponForm.reward_type === 'minigame_ticket' && (
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
                  <input type="number" min={1} value={couponForm.reward_quantity}
                    onChange={(e) => setCouponForm({ ...couponForm, reward_quantity: Number(e.target.value) })}
                    className="ml-auto w-24 rounded-lg border border-border bg-secondary/40 px-2 py-1.5 text-xs font-bold" />
                  <span className="text-[10px] font-black text-sky-400">tickets</span>
                </div>
              </div>
            )}

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
                const reward = c.reward_type === 'card'
                  ? `🃏 ${streamerName(c.reward_channel_id || '')} 카드 ×${c.reward_quantity}`
                  : c.reward_type === 'cosmetic'
                  ? `🎨 ${couponCosmetics.find((it) => it.id === c.reward_item_id)?.name || `아이템#${c.reward_item_id}`} ×${c.reward_quantity}`
                  : c.reward_type === 'minigame_ticket'
                  ? `🎮 추가 미니게임 티켓 ×${c.reward_quantity}`
                  : `💰 ${(c.points || 0).toLocaleString()}P`;
                return (
                  <div key={c.id} className="flex items-center justify-between rounded-lg bg-secondary/30 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold font-mono truncate">{c.code}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {c.coupon_type === 'single' ? '일회성' : '다회성'} · {reward}
                        {c.expires_at ? ` · ~${couponExpirationFormatter.format(new Date(c.expires_at))}` : ' · 무기한'}
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
                      ? new Date(p.scheduled_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
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
                    const sentTimeStr = p.created_at
                      ? new Date(p.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
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
                    <button onClick={() => handleBanUser(rep.reporter_id, '7d', '허위/악성 신고 누적으로 인한 제재')} className="rounded bg-red-500/10 px-2 py-1 text-[10px] text-red-500 hover:bg-red-500/20">신고자 7일 밴</button>
                    <button onClick={() => handleResolveReport(rep.id, 'resolved')} className="rounded bg-primary/10 px-2 py-1 text-[10px] text-primary hover:bg-primary/20">신고 승인</button>
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
                          : expiration.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
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

      {/* 스트리머 이미지 */}
      {subTab === 'streamers' && (() => {
        const hasAnyCustom = (s: any) => (s.custom_images && s.custom_images.some(Boolean)) || s.custom_image_url;
        const allCustom = couponStreamers.filter((s) => hasAnyCustom(s) || s.is_image_banned);
        const kw = streamerSearch.trim().toLowerCase();
        const customStreamers = kw
          ? allCustom.filter((s) => (s.name || '').toLowerCase().includes(kw) || (s.channel_id || '').toLowerCase().includes(kw))
          : allCustom;
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
                          <button onClick={() => handleStreamerImageAction('reset', s.channel_id)} className="rounded bg-secondary px-2 py-1 text-[10px] font-bold hover:bg-secondary/80">전체 초기화</button>
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
                                  onClick={() => handleStreamerImageAction('reset', s.channel_id, st)}
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

            {/* 수동 채널 ID 직접 제어 (보조) */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
              <h3 className="text-sm font-bold flex items-center gap-1.5"><ImageIcon className="h-4 w-4" /> 채널 ID 직접 제어</h3>
              <input type="text" placeholder="스트리머 채널 ID" value={streamerChannelId}
                onChange={(e) => setStreamerChannelId(e.target.value)}
                className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => handleStreamerImageAction('reset')} className="rounded bg-secondary px-3 py-1.5 text-[11px] font-bold hover:bg-secondary/80">기본 이미지로 초기화</button>
                <button onClick={() => handleStreamerImageAction('ban')} className="rounded bg-red-500/10 px-3 py-1.5 text-[11px] font-bold text-red-500 hover:bg-red-500/20">이미지 차단</button>
                <button onClick={() => handleStreamerImageAction('unban')} className="rounded bg-emerald-500/10 px-3 py-1.5 text-[11px] font-bold text-emerald-500 hover:bg-emerald-500/20">차단 해제</button>
              </div>
            </div>

            {/* 스트리머 카드 삭제(폐기) — 보유자에게 시세 보상 후 카드/스트리머 제거 */}
            {(() => {
              const kw = delSearch.trim().toLowerCase();
              const list = (kw
                ? couponStreamers.filter((s) => (s.name || '').toLowerCase().includes(kw) || (s.channel_id || '').toLowerCase().includes(kw))
                : couponStreamers
              ).slice().sort((a, b) => (b.base_value || 0) - (a.base_value || 0));
              const PER = 8;
              const totalPages = Math.max(1, Math.ceil(list.length / PER));
              const page = Math.min(delPage, totalPages);
              const paged = list.slice((page - 1) * PER, page * PER);
              return (
                <div className="rounded-2xl border border-red-500/30 bg-card p-5 shadow-sm">
                  <h3 className="text-sm font-bold flex items-center gap-1.5 text-red-500"><Trash2 className="h-4 w-4" /> 스트리머 카드 삭제(폐기)</h3>
                  <p className="mt-1 mb-3 text-[11px] text-muted-foreground leading-relaxed">
                    삭제 시 해당 카드를 보유한 모든 유저에게 <b className="text-foreground/80">삭제 시점 시세(별 등급 반영)</b>만큼 포인트를 지급한 뒤 카드를 제거하고 스트리머를 폐기합니다. <b className="text-red-500">되돌릴 수 없습니다.</b>
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
                          <img src={s.custom_image_url || s.logo_url} alt={s.name} className="h-9 w-9 rounded object-cover border border-border" />
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

      {/* 스트리머 카드 삭제 확인 모달 */}
      {delTarget && (
        <div className="modal-backdrop modal-backdrop-center z-[90] bg-black/70 backdrop-blur-sm" onClick={() => !deleting && setDelTarget(null)}>
          <div className="modal-panel modal-panel-sm modal-panel-scroll rounded-2xl border border-border bg-card p-5 text-center shadow-2xl animate-in zoom-in-95 duration-200 sm:p-6" onClick={(e) => e.stopPropagation()}>
            <Trash2 className="mx-auto h-9 w-9 text-red-500 mb-3" />
            <h4 className="text-sm font-black text-foreground mb-2">스트리머 카드 삭제</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              <b className="text-foreground">{delTarget.name}</b> 카드를 모든 보유자에게서 삭제합니다.<br />
              보유자에게는 <b className="text-emerald-500">현재 시세({(delTarget.base_value || 0).toLocaleString()} P, 별 등급 반영)</b>만큼 포인트가 지급됩니다.<br />
              <b className="text-red-500">이 작업은 되돌릴 수 없습니다.</b>
            </p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <button onClick={() => setDelTarget(null)} disabled={deleting} className="rounded-lg bg-secondary px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-secondary/80 disabled:opacity-50">취소</button>
              <button onClick={handleDeleteStreamer} disabled={deleting} className="rounded-lg bg-red-500 px-5 py-2 text-xs font-bold text-white hover:bg-red-600 disabled:opacity-50">
                {deleting ? '삭제 중...' : '삭제하고 보상 지급'}
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
              <b>0</b>으로 설정 시 대기 없이 무제한 무료 뽑기가 가능합니다.
            </p>
            <div className="flex items-center gap-2">
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
              <button
                onClick={handleSaveFreeDrawInterval}
                disabled={isSavingInterval}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all shadow-md active:scale-95"
              >
                {isSavingInterval ? '저장 중...' : '설정 저장'}
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

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-muted-foreground block mb-1">종류</label>
                <select value={shopForm.type} onChange={(e) => setShopForm({ ...shopForm, type: e.target.value as any })}
                  className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs">
                  <option value="border">테두리</option>
                  <option value="name_effect">이름 이펙트</option>
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

            {/* 커스텀 CSS (테두리/이름 이펙트 공통 · 클래스명 + CSS 코드 전문) */}
            {(() => {
              const isBorder = shopForm.type === 'border';
              const parsed = (() => { try { return JSON.parse(shopForm.style_json || '{}'); } catch { return {}; } })();
              const curClass = typeof parsed?.class === 'string' ? parsed.class : '';
              const curCss = typeof parsed?.css === 'string' ? parsed.css : '';
              const setCustom = (cls: string, css: string) => {
                const c = cls.trim();
                if (!c && !css.trim()) { setShopForm({ ...shopForm, style_json: '' }); return; }
                const obj: any = { class: c || (isBorder ? 'cb-custom' : 'ne-custom') };
                if (css.trim()) obj.css = css;
                setShopForm({ ...shopForm, style_json: JSON.stringify(obj) });
              };
              return (
                <div className="rounded-lg border border-dashed border-border/70 bg-secondary/20 p-3 space-y-2">
                  <p className="text-[11px] font-bold text-muted-foreground">커스텀 CSS {isBorder ? '테두리' : '이름 이펙트'} (직접 작성)</p>
                  <input
                    type="text"
                    placeholder={isBorder ? '적용 클래스명 (예: cb-mydragon)' : '적용 클래스명 (예: ne-rainbow)'}
                    value={curClass}
                    onChange={(e) => setCustom(e.target.value, curCss)}
                    className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs font-mono"
                  />
                  <textarea
                    rows={6}
                    placeholder={isBorder
                      ? '.cb-mydragon { background-image: url("data:image/svg+xml,..."); box-shadow: 0 0 12px gold; }\n.cb-mydragon::after { /* 애니메이션 등 */ }\n@keyframes ... { }'
                      : '.ne-rainbow { background: linear-gradient(90deg,#f0f,#0ff); -webkit-background-clip: text; background-clip: text; color: transparent; }\n@keyframes ... { }'}
                    value={curCss}
                    onChange={(e) => setCustom(curClass, e.target.value)}
                    className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[11px] font-mono leading-relaxed"
                  />
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    {isBorder
                      ? <>입력한 CSS가 그대로 주입되어 카드 위 오버레이(<code>.cosmetic-frame .클래스명</code>)에 적용됩니다.</>
                      : <>입력한 CSS가 그대로 주입되어 카드 이름 텍스트(<code>.클래스명</code>)에 적용됩니다. (글자 색·그라데이션·그림자·애니메이션 등)</>}
                    <br />※ 클래스명과 <code>@keyframes</code> 이름은 다른 항목과 겹치지 않게 고유하게 지정하세요.
                  </p>
                </div>
              );
            })()}

            <div>
              <label className="text-[11px] font-bold text-muted-foreground block mb-1">
                스타일 (CSS JSON · 고급) <span className="font-normal">간단 인라인 예: {`{"borderColor":"#f00","borderWidth":"3px"}`}</span>
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

            {/* 미리보기 */}
            <div className="flex items-center gap-4 rounded-lg bg-secondary/30 p-4">
              <span className="text-[11px] font-bold text-muted-foreground">미리보기</span>
              {shopForm.type === 'border' ? (
                <div className="relative overflow-hidden rounded-xl border border-border/80 bg-gradient-to-br from-secondary to-card" style={{ width: '40px', height: '64px' }}>
                  <div style={{
                    width: '224px',
                    height: '358.4px',
                    transform: 'scale(calc(40 / 224))',
                    transformOrigin: 'top left',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    pointerEvents: 'none',
                    containerType: 'inline-size',
                    ...(borderClass({ style_json: shopForm.style_json }) ? {} : (parseStyle(shopForm.style_json) || {}))
                  }}>
                    <CosmeticFrame border={{ style_json: shopForm.style_json }} />
                  </div>
                </div>
              ) : (
                <CosmeticName effect={{ style_json: shopForm.style_json, font_url: shopForm.font_url, font_family: shopForm.font_family }} className="text-lg font-black">
                  {shopForm.name || '미리보기'}
                </CosmeticName>
              )}
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
                    ) : (
                      <CosmeticName effect={item} className="shrink-0 text-base font-black px-1">{item.name}</CosmeticName>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-bold truncate flex items-center gap-1.5">
                        {item.name}
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">{item.type === 'border' ? '테두리' : '이름 이펙트'}</span>
                        {!item.active && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[9px] font-bold text-red-500">비활성</span>}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {item.price.toLocaleString()} P · {item.purchase_limit > 0 ? `1인 ${item.purchase_limit}개 제한` : '구매 무제한'} · {item.description || '설명 없음'}
                      </p>
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
