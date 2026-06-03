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
  Database
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { parseStyle, nameEffectStyle, cardImage, borderClass } from '@/lib/cosmetics';
import { CosmeticFrame } from './CosmeticFrame';
import { CosmeticName } from './CosmeticName';

type AdminSubTab = 'dashboard' | 'users' | 'coupons' | 'announcements' | 'push' | 'reports' | 'streamers' | 'shop' | 'maintenance';

export const AdminTab: React.FC = () => {
  const { user, toast } = useApp();
  const searchParams = useSearchParams();
  const router = useRouter();

  // URL tab 쿼리 파라미터를 기반으로 초기 subTab 결정
  const tabParam = searchParams.get('tab') as AdminSubTab | null;
  const initialSubTab: AdminSubTab = (
    tabParam === 'dashboard' ||
    tabParam === 'users' ||
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
      'dashboard', 'users', 'coupons', 'announcements', 
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

  // 유저 목록 (서버 검색 + 페이지네이션)
  const [users, setUsers] = useState<any[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [userPage, setUserPage] = useState(1);
  const [userTotal, setUserTotal] = useState(0);
  const [userTotalPages, setUserTotalPages] = useState(1);
  const [usersLoading, setUsersLoading] = useState(false);

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
  const [orphans, setOrphans] = useState<any[]>([]);
  const [orphanInfo, setOrphanInfo] = useState<{ total_files: number; referenced: number } | null>(null);
  const [selectedOrphans, setSelectedOrphans] = useState<string[]>([]);
  const [orphanLoading, setOrphanLoading] = useState(false);
  const [deletingOrphans, setDeletingOrphans] = useState(false);

  // 상점 관리
  const [shopItems, setShopItems] = useState<any[]>([]);
  const emptyShopForm = { id: 0, type: 'border' as 'border' | 'name_effect', name: '', description: '', price: 1000, style_json: '', font_url: '', font_family: '', active: true, purchase_limit: 0 };
  const [shopForm, setShopForm] = useState({ ...emptyShopForm });

  // 쿠폰
  const [coupons, setCoupons] = useState<any[]>([]);
  const [couponStreamers, setCouponStreamers] = useState<any[]>([]);
  const [couponStreamerSearch, setCouponStreamerSearch] = useState('');
  const [couponForm, setCouponForm] = useState({
    code: '',
    coupon_type: 'single' as 'single' | 'multi',
    reward_type: 'point' as 'point' | 'card' | 'cosmetic',
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
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [noticeForm, setNoticeForm] = useState({ title: '', content: '', is_popup: false });

  // 푸시
  const [pushForm, setPushForm] = useState({ title: '', body: '', scheduled_at: '' });

  // 신고/밴
  const [reports, setReports] = useState<any[]>([]);
  const [banUserId, setBanUserId] = useState('');

  // 스트리머 이미지 관리
  const [streamerChannelId, setStreamerChannelId] = useState('');

  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    if (!isAdmin) return;
    if (subTab === 'dashboard') fetchStats();
    if (subTab === 'coupons') { fetchCoupons(); fetchCouponStreamers(); fetchCouponCosmetics(); }
    if (subTab === 'announcements') fetchAnnouncements();
    if (subTab === 'reports') fetchReports();
    if (subTab === 'streamers') fetchCouponStreamers(true);
    if (subTab === 'shop') fetchShopItems();
    if (subTab === 'maintenance') { fetchResetInfo(); fetchOrphans(); }
  }, [subTab, isAdmin]);

  // 유저 탭: 검색어 디바운스(닉네임/ID) → 1페이지부터 재조회
  useEffect(() => {
    if (!isAdmin || subTab !== 'users') return;
    const t = setTimeout(() => {
      setUserPage(1);
      fetchUsers(1, userSearch);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userSearch, subTab, isAdmin]);

  // 유저 탭: 페이지 변경 시 재조회
  useEffect(() => {
    if (!isAdmin || subTab !== 'users') return;
    fetchUsers(userPage, userSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userPage]);

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
  const USERS_PER_PAGE = 20;
  const fetchUsers = async (page = userPage, keyword = userSearch) => {
    setUsersLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(USERS_PER_PAGE) });
      if (keyword.trim()) params.set('q', keyword.trim());
      const res = await apiFetch(`/admin/users?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
        setUserTotal(data.total || 0);
        setUserTotalPages(data.total_pages || 1);
      }
    } catch { /* noop */ } finally {
      setUsersLoading(false);
    }
  };

  // 닉네임/ID 클립보드 복사 (HTTPS 미지원 환경 폴백 포함)
  const copyText = async (text: string, label: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      toast(`${label} 복사됨: ${text}`);
    } catch {
      toast('복사에 실패했습니다.');
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
        setNoticeForm({ title: '', content: '', is_popup: false });
        fetchAnnouncements();
      } else toast('등록 실패');
    } catch { toast('서버 통신 에러'); }
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
    try {
      const res = await apiFetch('/admin/push/schedule', { method: 'POST', body: JSON.stringify(pushForm) });
      const data = await res.json();
      if (res.ok) {
        toast(data.message || '푸시가 등록되었습니다.');
        setPushForm({ title: '', body: '', scheduled_at: '' });
      } else toast('푸시 등록 실패');
    } catch { toast('서버 통신 에러'); }
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

  const handleBanUser = async (userId: string, duration: string) => {
    if (!userId.trim()) { toast('대상 유저 ID가 필요합니다.'); return; }
    try {
      const res = await apiFetch(`/admin/users/${userId}/ban`, { method: 'POST', body: JSON.stringify({ duration }) });
      const data = await res.json();
      toast(data.message || '처리되었습니다.');
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

  // ---- 상점 관리 ----
  const fetchShopItems = async () => {
    try {
      const res = await apiFetch('/admin/shop/items');
      if (res.ok) setShopItems(await res.json());
    } catch { /* noop */ }
  };

  const submitShopItem = async () => {
    if (!shopForm.name.trim()) { toast('이름을 입력해 주세요.'); return; }
    if (shopForm.style_json.trim()) {
      try { JSON.parse(shopForm.style_json); } catch { toast('스타일(JSON) 형식이 올바르지 않습니다.', 'error'); return; }
    }
    const payload = {
      type: shopForm.type, name: shopForm.name, description: shopForm.description || null,
      price: Math.max(0, Number(shopForm.price) || 0), style_json: shopForm.style_json || null,
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
      const res = await apiFetch('/admin/reset', { method: 'POST', body: JSON.stringify({ categories: selectedCats }) });
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
      const res = await apiFetch('/admin/uploads/orphans/delete', { method: 'POST', body: JSON.stringify({ paths: selectedOrphans }) });
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
      const res = await apiFetch(`/admin/streamers/${delTarget.channel_id}/delete`, { method: 'POST' });
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

      {/* 유저 목록 */}
      {subTab === 'users' && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-bold"><Users className="h-4 w-4" /> 유저 목록 ({userTotal.toLocaleString()})</h3>
              <button onClick={() => fetchUsers(userPage, userSearch)} className="text-xs text-muted-foreground hover:text-foreground"><RefreshCw className="h-3.5 w-3.5" /></button>
            </div>

            {/* 검색 */}
            <input
              type="text"
              placeholder="닉네임 또는 채널 ID로 검색"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              className="mb-1 w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs"
            />
            <p className="mb-3 text-[10px] text-muted-foreground">프로필 이미지·닉네임·채널 ID를 클릭하면 복사됩니다.</p>

            <div className="space-y-2">
              {usersLoading ? (
                <p className="py-8 text-center text-xs text-muted-foreground">불러오는 중…</p>
              ) : users.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">{userSearch.trim() ? '검색 결과가 없습니다.' : '유저가 없습니다.'}</p>
              ) : users.map((u) => (
                <div key={u.id} className="flex items-center gap-3 rounded-lg bg-secondary/30 p-2.5">
                  {/* 프로필 이미지 (클릭 시 닉네임 복사) */}
                  <button
                    type="button"
                    onClick={() => copyText(u.username, '닉네임')}
                    title="닉네임 복사"
                    className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-border bg-secondary"
                  >
                    {u.avatar_url
                      ? <img src={u.avatar_url} alt={u.username} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                      : <span className="flex h-full w-full items-center justify-center text-[10px] font-bold text-muted-foreground">{(u.username || '?').slice(0, 2)}</span>}
                  </button>
                  <div className="min-w-0 flex-1">
                    {/* 닉네임 (클릭 복사) */}
                    <button
                      type="button"
                      onClick={() => copyText(u.username, '닉네임')}
                      title="닉네임 복사"
                      className="flex max-w-full items-center gap-1.5 text-left"
                    >
                      <span className="truncate text-xs font-bold text-foreground hover:underline">{u.username}</span>
                      {u.role === 'ADMIN' && <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-bold text-sky-500">ADMIN</span>}
                      {u.banned_until && new Date(u.banned_until).getTime() > Date.now() && (
                        <span className="shrink-0 rounded bg-red-500/15 px-1.5 py-0.5 text-[9px] font-bold text-red-500">정지</span>
                      )}
                    </button>
                    {/* 채널 ID (클릭 복사) */}
                    <button
                      type="button"
                      onClick={() => copyText(u.id, '채널 ID')}
                      title="채널 ID 복사"
                      className="block max-w-full truncate text-left text-[10px] text-muted-foreground hover:text-foreground hover:underline"
                    >{u.id}</button>
                  </div>
                </div>
              ))}
            </div>

            {/* 페이지네이션 */}
            {userTotalPages > 1 && (
              <div className="mt-4 flex items-center justify-center gap-2">
                <button
                  onClick={() => setUserPage((p) => Math.max(1, p - 1))}
                  disabled={userPage <= 1 || usersLoading}
                  className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                >이전</button>
                <span className="text-xs font-bold text-muted-foreground">{userPage} / {userTotalPages}</span>
                <button
                  onClick={() => setUserPage((p) => Math.min(userTotalPages, p + 1))}
                  disabled={userPage >= userTotalPages || usersLoading}
                  className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                >다음</button>
              </div>
            )}
          </div>
        </section>
      )}

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
                  ? `🃏 ${streamerName(c.reward_channel_id)} 카드 ×${c.reward_quantity}`
                  : c.reward_type === 'cosmetic'
                  ? `🎨 ${couponCosmetics.find((it) => it.id === c.reward_item_id)?.name || `아이템#${c.reward_item_id}`} ×${c.reward_quantity}`
                  : `💰 ${(c.points || 0).toLocaleString()}P`;
                return (
                  <div key={c.id} className="flex items-center justify-between rounded-lg bg-secondary/30 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold font-mono truncate">{c.code}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {c.coupon_type === 'single' ? '일회성' : '다회성'} · {reward}
                        {c.expires_at ? ` · ~${new Date(c.expires_at).toLocaleDateString('ko-KR')}` : ' · 무기한'}
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
            <h3 className="text-sm font-bold flex items-center gap-1.5"><Megaphone className="h-4 w-4" /> 공지/팝업 등록</h3>
            <input type="text" placeholder="공지 제목" value={noticeForm.title}
              onChange={(e) => setNoticeForm({ ...noticeForm, title: e.target.value })}
              className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
            <textarea placeholder="공지 본문 (마크다운 지원: **굵게**, [링크텍스트](링크URL), - 글머리기호)" value={noticeForm.content}
              onChange={(e) => setNoticeForm({ ...noticeForm, content: e.target.value })}
              className="w-full h-24 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={noticeForm.is_popup}
                onChange={(e) => setNoticeForm({ ...noticeForm, is_popup: e.target.checked })} /> 메인 화면 오버레이 팝업으로 노출
            </label>
            <button onClick={handleCreateAnnouncement} className="w-full rounded-lg bg-primary py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90">공지 등록</button>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h3 className="text-sm font-bold mb-3">등록된 공지 ({announcements.length})</h3>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {announcements.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">등록된 공지가 없습니다.</p>
              ) : announcements.map((a) => (
                <div key={a.id} className="flex items-start justify-between gap-3 rounded-lg bg-secondary/30 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-bold flex items-center gap-1.5">
                      {a.title}
                      {a.is_popup && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">팝업</span>}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">{a.content}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => handleTogglePopup(a)}
                      className={`rounded px-2 py-1.5 text-[10px] font-bold transition ${a.is_popup ? 'bg-amber-500/15 text-amber-500 hover:bg-amber-500/25' : 'bg-secondary text-muted-foreground hover:bg-secondary/80'}`}
                      title="팝업 노출 토글"
                    >
                      {a.is_popup ? '팝업 해제' : '팝업 등록'}
                    </button>
                    <button onClick={() => handleDeleteAnnouncement(a.id)} className="rounded bg-red-500/10 p-1.5 text-red-500 hover:bg-red-500/20">
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
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
          <h3 className="text-sm font-bold flex items-center gap-1.5"><BellRing className="h-4 w-4" /> PWA 푸시 알림 발송</h3>
          <p className="text-xs text-muted-foreground">발송 시각을 비우면 즉시(다음 1분 이내) 발송됩니다.</p>
          <input type="text" placeholder="알림 제목" value={pushForm.title}
            onChange={(e) => setPushForm({ ...pushForm, title: e.target.value })}
            className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
          <input type="text" placeholder="알림 본문" value={pushForm.body}
            onChange={(e) => setPushForm({ ...pushForm, body: e.target.value })}
            className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
          <input type="datetime-local" value={pushForm.scheduled_at}
            onChange={(e) => setPushForm({ ...pushForm, scheduled_at: e.target.value })}
            className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
          <button onClick={handleSchedulePush} className="w-full rounded-lg bg-primary py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90">발송 등록</button>
        </section>
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
                    <img src={rep.reported_image_url} alt="snapshot" className="h-12 w-12 rounded border border-border object-cover" />
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold">신고 #{rep.id} · 대상: {rep.channel_id}</p>
                      <p className="text-[10px] text-muted-foreground">상태: {rep.status} / 사유: {rep.reason}</p>
                      <p className="text-[10px] text-muted-foreground truncate">신고자: {rep.reporter_id}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5 border-t border-border/40 pt-2">
                    <button onClick={() => handleBanUser(rep.reporter_id, '7d')} className="rounded bg-red-500/10 px-2 py-1 text-[10px] text-red-500 hover:bg-red-500/20">신고자 7일 밴</button>
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
            <div className="flex flex-wrap gap-1.5">
              {[['1d', '1일'], ['7d', '7일'], ['30d', '30일'], ['permanent', '영구']].map(([d, label]) => (
                <button key={d} onClick={() => handleBanUser(banUserId, d)} className="rounded bg-red-500/10 px-3 py-1.5 text-[11px] font-bold text-red-500 hover:bg-red-500/20">{label} 밴</button>
              ))}
              <button onClick={() => handleUnbanUser(banUserId)} className="rounded bg-emerald-500/10 px-3 py-1.5 text-[11px] font-bold text-emerald-500 hover:bg-emerald-500/20">밴 해제</button>
            </div>
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
                <h3 className="text-sm font-bold flex items-center gap-1.5"><ImageIcon className="h-4 w-4" /> 커스텀 이미지 스트리머 ({customStreamers.length})</h3>
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
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => !deleting && setDelTarget(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200 text-center" onClick={(e) => e.stopPropagation()}>
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
                <input type="text" placeholder="웹폰트 URL (선택)" value={shopForm.font_url}
                  onChange={(e) => setShopForm({ ...shopForm, font_url: e.target.value })}
                  className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
                <input type="text" placeholder="font-family (선택)" value={shopForm.font_family}
                  onChange={(e) => setShopForm({ ...shopForm, font_family: e.target.value })}
                  className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
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
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => !resetting && setResetConfirmOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200 text-center" onClick={(e) => e.stopPropagation()}>
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
