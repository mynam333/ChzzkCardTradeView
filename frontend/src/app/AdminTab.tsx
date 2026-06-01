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
  RefreshCw
} from 'lucide-react';
import { apiFetch } from '@/lib/api';

type AdminSubTab = 'dashboard' | 'coupons' | 'announcements' | 'push' | 'reports' | 'streamers';

export const AdminTab: React.FC = () => {
  const { user } = useApp();
  const [subTab, setSubTab] = useState<AdminSubTab>('dashboard');

  // 대시보드
  const [stats, setStats] = useState<any | null>(null);

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
  const fetchCouponStreamers = async () => {
    if (couponStreamers.length > 0) return;
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
      alert('지급할 스트리머 카드를 선택해 주세요.');
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
        alert(`쿠폰이 발급되었습니다.\n코드: ${data.code}`);
        setCouponForm({ code: '', coupon_type: 'single', reward_type: 'point', points: 1000, reward_channel_id: '', reward_quantity: 1, max_uses: 1, expires_at: '' });
        setCouponStreamerSearch('');
        fetchCoupons();
      } else {
        alert(data.message || '쿠폰 발급 오류');
      }
    } catch { alert('서버 통신 에러'); }
  };

  const handleCreateAnnouncement = async () => {
    if (!noticeForm.title.trim() || !noticeForm.content.trim()) {
      alert('제목과 내용을 입력해 주세요.');
      return;
    }
    try {
      const res = await apiFetch('/admin/announcements', { method: 'POST', body: JSON.stringify(noticeForm) });
      if (res.ok) {
        alert('공지사항이 등록되었습니다.');
        setNoticeForm({ title: '', content: '', is_popup: false });
        fetchAnnouncements();
      } else alert('등록 실패');
    } catch { alert('서버 통신 에러'); }
  };

  const handleDeleteAnnouncement = async (id: number) => {
    if (!confirm('이 공지사항을 삭제하시겠습니까?')) return;
    try {
      const res = await apiFetch(`/admin/announcements/${id}`, { method: 'DELETE' });
      if (res.ok) {
        alert('삭제되었습니다.');
        fetchAnnouncements();
      } else alert('삭제 실패');
    } catch { alert('서버 통신 에러'); }
  };

  const handleSchedulePush = async () => {
    if (!pushForm.title.trim() || !pushForm.body.trim()) {
      alert('알림 제목과 본문을 입력해 주세요.');
      return;
    }
    try {
      const res = await apiFetch('/admin/push/schedule', { method: 'POST', body: JSON.stringify(pushForm) });
      const data = await res.json();
      if (res.ok) {
        alert(data.message || '푸시가 등록되었습니다.');
        setPushForm({ title: '', body: '', scheduled_at: '' });
      } else alert('푸시 등록 실패');
    } catch { alert('서버 통신 에러'); }
  };

  const handleResolveReport = async (reportId: number, status: 'resolved' | 'rejected') => {
    try {
      const res = await apiFetch(`/admin/reports/${reportId}/resolve`, { method: 'POST', body: JSON.stringify({ status }) });
      if (res.ok) {
        alert(`신고가 ${status === 'resolved' ? '처리' : '기각'}되었습니다.`);
        fetchReports();
      } else alert('처리 실패');
    } catch { alert('서버 통신 에러'); }
  };

  const handleBanUser = async (userId: string, duration: string) => {
    if (!userId.trim()) { alert('대상 유저 ID가 필요합니다.'); return; }
    try {
      const res = await apiFetch(`/admin/users/${userId}/ban`, { method: 'POST', body: JSON.stringify({ duration }) });
      const data = await res.json();
      alert(data.message || '처리되었습니다.');
    } catch { alert('서버 통신 에러'); }
  };

  const handleUnbanUser = async (userId: string) => {
    if (!userId.trim()) { alert('대상 유저 ID가 필요합니다.'); return; }
    try {
      const res = await apiFetch(`/admin/users/${userId}/unban`, { method: 'POST' });
      const data = await res.json();
      alert(data.message || '해제되었습니다.');
    } catch { alert('서버 통신 에러'); }
  };

  const handleStreamerImageAction = async (action: 'reset' | 'ban' | 'unban') => {
    if (!streamerChannelId.trim()) { alert('스트리머 채널 ID를 입력해 주세요.'); return; }
    try {
      const res = await apiFetch(`/admin/streamers/${streamerChannelId}/image/${action}`, { method: 'POST' });
      const data = await res.json();
      alert(data.message || '처리되었습니다.');
    } catch { alert('서버 통신 에러'); }
  };

  const subTabs: { id: AdminSubTab; label: string; icon: typeof Tag }[] = [
    { id: 'dashboard', label: '대시보드', icon: LayoutDashboard },
    { id: 'coupons', label: '쿠폰', icon: Tag },
    { id: 'announcements', label: '공지', icon: Megaphone },
    { id: 'push', label: '푸시', icon: BellRing },
    { id: 'reports', label: '신고·밴', icon: AlertTriangle },
    { id: 'streamers', label: '스트리머 이미지', icon: ImageIcon }
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
                  <button onClick={() => handleDeleteAnnouncement(a.id)} className="shrink-0 rounded bg-red-500/10 p-1.5 text-red-500 hover:bg-red-500/20">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
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
      {subTab === 'streamers' && (
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
          <h3 className="text-sm font-bold flex items-center gap-1.5"><ImageIcon className="h-4 w-4" /> 스트리머 커스텀 이미지 제어</h3>
          <p className="text-xs text-muted-foreground">채널 ID를 입력하고 작업을 선택하세요.</p>
          <input type="text" placeholder="스트리머 채널 ID" value={streamerChannelId}
            onChange={(e) => setStreamerChannelId(e.target.value)}
            className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs" />
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => handleStreamerImageAction('reset')} className="rounded bg-secondary px-3 py-1.5 text-[11px] font-bold hover:bg-secondary/80">기본 이미지로 초기화</button>
            <button onClick={() => handleStreamerImageAction('ban')} className="rounded bg-red-500/10 px-3 py-1.5 text-[11px] font-bold text-red-500 hover:bg-red-500/20">이미지 차단</button>
            <button onClick={() => handleStreamerImageAction('unban')} className="rounded bg-emerald-500/10 px-3 py-1.5 text-[11px] font-bold text-emerald-500 hover:bg-emerald-500/20">차단 해제</button>
          </div>
        </section>
      )}
    </div>
  );
};
