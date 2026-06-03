'use client';

import React, { useState, useEffect } from 'react';
import { useApp } from './AppContext';
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
  Store
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { parseStyle, nameEffectStyle, cardImage, borderClass } from '@/lib/cosmetics';
import { CosmeticFrame } from './CosmeticFrame';

type AdminSubTab = 'dashboard' | 'coupons' | 'announcements' | 'push' | 'reports' | 'streamers' | 'shop';

export const AdminTab: React.FC = () => {
  const { user, toast } = useApp();
  const [subTab, setSubTab] = useState<AdminSubTab>('dashboard');

  // 대시보드
  const [stats, setStats] = useState<any | null>(null);

  // 스트리머 이미지 검색/페이지네이션
  const [streamerSearch, setStreamerSearch] = useState('');
  const [streamerPage, setStreamerPage] = useState(1);

  // 상점 관리
  const [shopItems, setShopItems] = useState<any[]>([]);
  const emptyShopForm = { id: 0, type: 'border' as 'border' | 'name_effect', name: '', description: '', price: 1000, style_json: '', font_url: '', font_family: '', active: true };
  const [shopForm, setShopForm] = useState({ ...emptyShopForm });

  // 쿠폰
  const [coupons, setCoupons] = useState<any[]>([]);
  const [couponStreamers, setCouponStreamers] = useState<any[]>([]);
  const [couponStreamerSearch, setCouponStreamerSearch] = useState('');
  const [couponForm, setCouponForm] = useState({
    code: '',
    coupon_type: 'single' as 'single' | 'multi',
    reward_type: 'point' as 'point' | 'card',
    points: 1000,
    reward_channel_id: '',
    reward_quantity: 1,
    max_uses: 1,
    expires_at: ''
  });

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
    if (subTab === 'coupons') { fetchCoupons(); fetchCouponStreamers(); }
    if (subTab === 'announcements') fetchAnnouncements();
    if (subTab === 'reports') fetchReports();
    if (subTab === 'streamers') fetchCouponStreamers(true);
    if (subTab === 'shop') fetchShopItems();
  }, [subTab, isAdmin]);

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
        setCouponForm({ code: '', coupon_type: 'single', reward_type: 'point', points: 1000, reward_channel_id: '', reward_quantity: 1, max_uses: 1, expires_at: '' });
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
      font_url: shopForm.font_url || null, font_family: shopForm.font_family || null, active: shopForm.active
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
      font_family: item.font_family || '', active: item.active
    });
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
    { id: 'coupons', label: '쿠폰', icon: Tag },
    { id: 'announcements', label: '공지', icon: Megaphone },
    { id: 'push', label: '푸시', icon: BellRing },
    { id: 'reports', label: '신고·밴', icon: AlertTriangle },
    { id: 'streamers', label: '스트리머 이미지', icon: ImageIcon },
    { id: 'shop', label: '상점 관리', icon: Store }
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
              onClick={() => setSubTab(t.id)}
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
              </select>
            </div>

            {couponForm.reward_type === 'point' ? (
              <input type="number" min={1} placeholder="지급 포인트" value={couponForm.points}
                onChange={(e) => setCouponForm({ ...couponForm, points: Number(e.target.value) })}
                className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
            ) : (
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
            <textarea placeholder="공지 본문" value={noticeForm.content}
              onChange={(e) => setNoticeForm({ ...noticeForm, content: e.target.value })}
              className="w-full h-20 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
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
          </section>
        );
      })()}

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

            {/* 커스텀 CSS 테두리 (클래스명 + CSS 코드 전문) */}
            {shopForm.type === 'border' && (() => {
              const parsed = (() => { try { return JSON.parse(shopForm.style_json || '{}'); } catch { return {}; } })();
              const curClass = typeof parsed?.class === 'string' ? parsed.class : '';
              const curCss = typeof parsed?.css === 'string' ? parsed.css : '';
              const setCustom = (cls: string, css: string) => {
                const c = cls.trim();
                if (!c && !css.trim()) { setShopForm({ ...shopForm, style_json: '' }); return; }
                const obj: any = { class: c || 'cb-custom' };
                if (css.trim()) obj.css = css;
                setShopForm({ ...shopForm, style_json: JSON.stringify(obj) });
              };
              return (
                <div className="rounded-lg border border-dashed border-border/70 bg-secondary/20 p-3 space-y-2">
                  <p className="text-[11px] font-bold text-muted-foreground">커스텀 CSS 테두리 (직접 작성)</p>
                  <input
                    type="text"
                    placeholder="적용 클래스명 (예: cb-mydragon) — .cosmetic-frame 에 함께 부여됩니다"
                    value={curClass}
                    onChange={(e) => setCustom(e.target.value, curCss)}
                    className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs font-mono"
                  />
                  <textarea
                    rows={6}
                    placeholder={'.cb-mydragon { background-image: url("data:image/svg+xml,..."); box-shadow: 0 0 12px gold; }\n.cb-mydragon::after { /* 애니메이션 등 */ }\n@keyframes ... { }'}
                    value={curCss}
                    onChange={(e) => setCustom(curClass, e.target.value)}
                    className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[11px] font-mono leading-relaxed"
                  />
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    위 <b>클래스명</b>과 <b>CSS 코드</b>를 입력하면 입력한 CSS가 그대로 주입되어 카드 위 오버레이(<code>.cosmetic-frame .클래스명</code>)에 적용됩니다.
                    예시 파일(<code>card-borders/*.css</code>)의 코드를 복사해 붙여넣으면 즉시 동작합니다. 작성법은 루트의 <code>CARD_BORDER_GUIDE.md</code>를 참고하세요.
                    <br />※ 클래스명과 <code>@keyframes</code> 이름은 다른 테두리와 겹치지 않게 고유하게 지정하세요.
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
                <div className="relative h-20 w-12 overflow-hidden rounded-xl border border-border/80 bg-gradient-to-br from-secondary to-card" style={borderClass({ style_json: shopForm.style_json }) ? undefined : parseStyle(shopForm.style_json)}>
                  <CosmeticFrame border={{ style_json: shopForm.style_json }} />
                </div>
              ) : (
                <span className="text-lg font-black" style={nameEffectStyle({ style_json: shopForm.style_json, font_url: shopForm.font_url, font_family: shopForm.font_family })}>
                  {shopForm.name || '미리보기'}
                </span>
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
                      <div className="relative h-14 w-9 shrink-0 overflow-hidden rounded-lg border border-border/80 bg-gradient-to-br from-secondary to-card" style={borderClass(item) ? undefined : parseStyle(item.style_json)}>
                        <CosmeticFrame border={item} />
                      </div>
                    ) : (
                      <span className="shrink-0 text-base font-black px-1" style={nameEffectStyle(item)}>{item.name}</span>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-bold truncate flex items-center gap-1.5">
                        {item.name}
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">{item.type === 'border' ? '테두리' : '이름 이펙트'}</span>
                        {!item.active && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[9px] font-bold text-red-500">비활성</span>}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">{item.price.toLocaleString()} P · {item.description || '설명 없음'}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button onClick={() => editShopItem(item)} className="rounded bg-secondary px-2 py-1 text-[10px] font-bold hover:bg-secondary/80">수정</button>
                    <button onClick={() => toggleShopActive(item)}
                      className={`rounded px-2 py-1 text-[10px] font-bold ${item.active ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20' : 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20'}`}>
                      {item.active ? '비활성화' : '활성화'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
