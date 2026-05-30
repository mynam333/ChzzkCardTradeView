'use client';

import React, { useState, useEffect } from 'react';
import { useApp } from './AppContext';
import { 
  User, 
  Settings, 
  ShieldAlert, 
  Image as ImageIcon, 
  Plus, 
  Tag, 
  BellRing, 
  Clock, 
  Camera, 
  UserX,
  X,
  FileText,
  AlertTriangle,
  Upload
} from 'lucide-react';
import { API_BASE_URL, apiFetch } from '@/lib/api';

export const MyInfoTab: React.FC = () => {
  const { user, logout, updatePoints } = useApp();

  // 쿠폰 사용 입력 상태
  const [couponCode, setCouponCode] = useState('');
  
  // 스트리머 프로필 커스텀 이미지 업로드 상태 (지연 업로드)
  const [previewBlob, setPreviewBlob] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // 어드민 콘솔 제어 상태
  const [couponForm, setCouponForm] = useState({
    code: '',
    coupon_type: 'single' as 'single' | 'multi',
    points: 1000,
    max_uses: 1
  });
  
  const [noticeForm, setNoticeForm] = useState({
    title: '',
    content: '',
    is_popup: false
  });

  const [pushForm, setPushForm] = useState({
    title: '',
    body: '',
    scheduled_at: ''
  });

  const [reports, setReports] = useState<any[]>([]);

  useEffect(() => {
    if (user?.role === 'ADMIN') {
      fetchAdminReports();
    }
  }, [user]);

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in duration-300">
        <div className="max-w-md rounded-3xl border border-border bg-card p-8 shadow-lg">
          <User className="mx-auto h-12 w-12 text-primary animate-pulse mb-4" />
          <h2 className="text-xl font-black text-foreground">로그인이 필요한 기능입니다</h2>
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            나의 프로필 정보 조회, 스트리머 카드 이미지 커스텀 관리, 쿠폰 리딤을 이용하시려면 치지직 간편 로그인을 진행해 주세요.
          </p>
        </div>
      </div>
    );
  }

  const fetchAdminReports = async () => {
    try {
      const res = await apiFetch('/admin/reports');
      if (res.ok) {
        const data = await res.json();
        setReports(data);
      }
    } catch (e) {
      console.error('관리자 신고 목록 조회 실패:', e);
      setReports([]);
    }
  };

  // 쿠폰Claim 처리
  const handleClaimCoupon = async () => {
    if (!couponCode.trim()) {
      alert('쿠폰 코드를 입력해 주세요.');
      return;
    }

    try {
      const res = await apiFetch('/coupons/claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ code: couponCode })
      });

      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        updatePoints(data.points_added);
        setCouponCode('');
      } else {
        alert(data.message || '쿠폰 등록 실패');
      }
    } catch (e) {
      alert('서버와의 통신 오류가 발생했습니다.');
    }
  };

  // 이미지 선택 시 blob 생성하여 지연 렌더링 (Lazy Preview)
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      const blobUrl = URL.createObjectURL(file);
      setPreviewBlob(blobUrl);
    }
  };

  // 최종 이미지 '저장' 버튼을 누를 시 API 호출 (WebP 1280px 리사이즈 및 검증은 백엔드에서 처리)
  const handleUploadImage = async () => {
    if (!imageFile) {
      alert('변경할 카드의 이미지를 선택해 주세요.');
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('image', imageFile);

    const token = localStorage.getItem('cctv_jwt_token');
    try {
      const res = await fetch(`${API_BASE_URL}/streamers/me/image`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      const data = await res.json();
      if (res.ok) {
        alert('이미지가 성공적으로 저장 완료되었습니다.');
        setImageFile(null);
      } else {
        alert(data.message || '이미지 저장 권한 오류 또는 차단 상태입니다.');
      }
    } catch (e) {
      alert('서버 전송 중 에러가 발생했습니다.');
      setImageFile(null);
    } finally {
      setUploading(false);
    }
  };

  // 쿠폰 발급 (ADMIN)
  const handleCreateCoupon = async () => {
    try {
      const res = await apiFetch('/admin/coupons', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(couponForm)
      });
      if (res.ok) {
        const data = await res.json();
        alert(`쿠폰이 성공적으로 발급되었습니다.\n코드: ${data.code}`);
      } else {
        alert('쿠폰 발급 오류');
      }
    } catch (e) {
      alert('서버와 통신 에러가 발생했습니다.');
    }
  };

  // 공지사항 작성 (ADMIN)
  const handleCreateAnnouncement = async () => {
    try {
      const res = await apiFetch('/admin/announcements', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(noticeForm)
      });
      if (res.ok) {
        alert('공지사항이 등록되었습니다.');
        setNoticeForm({ title: '', content: '', is_popup: false });
      }
    } catch (e) {
      alert('등록 실패');
    }
  };

  // 푸시 알림 발송 (ADMIN)
  const handleSchedulePush = async () => {
    try {
      const res = await apiFetch('/admin/push/schedule', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(pushForm)
      });
      if (res.ok) {
        alert('푸시 발송 예약이 설정되었습니다.');
        setPushForm({ title: '', body: '', scheduled_at: '' });
      }
    } catch (e) {
      alert('푸시 등록 에러');
    }
  };

  // 신고 해결/기각 (ADMIN)
  const handleResolveReport = async (reportId: number, status: 'resolved' | 'rejected') => {
    try {
      const res = await apiFetch(`/admin/reports/${reportId}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        alert(`신고가 ${status === 'resolved' ? '처리' : '기각'}되었습니다.`);
        fetchAdminReports();
      }
    } catch (e) {
      alert('처리 중 에러 발생');
    }
  };

  // 악성 유저 밴 차단 (ADMIN)
  const handleBanUser = async (userId: string, duration: string) => {
    try {
      const res = await apiFetch(`/admin/users/${userId}/ban`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ duration })
      });
      const data = await res.json();
      alert(data.message);
    } catch (e) {
      alert(`차단 요청 중 에러가 발생했습니다.`);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      
      {/* 닉네임 섹션 */}
      <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <img src={user?.avatarUrl} alt="Avatar" className="h-16 w-16 rounded-full border border-primary/20 bg-secondary" />
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              {user?.username} <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">{user?.role}</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-1">계정 고유 식별코드: {user?.id}</p>
          </div>
        </div>
      </section>

      {/* 스트리머 본인 전용 카드 이미지 편집 컨트롤 */}
      <section className="rounded-3xl border border-border bg-card p-6 shadow-sm space-y-4">
        <h3 className="text-base font-bold flex items-center gap-2">
          <Camera className="h-4.5 w-4.5 text-primary" /> 스트리머 고유 카드 이미지 관리
        </h3>
        <p className="text-xs text-muted-foreground">
          자기 스트리머 카드 이미지를 커스텀으로 변경할 수 있습니다. 저장 완료 버튼을 누르기 전까지는 임시 Blob 미리보기 상태로 렌더링되어 지연 업로드됩니다. (WebP 최대 1280px 자동 변환)
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-6 pt-2">
          {/* 포토카드 프레임 프리뷰 */}
          <div className="relative flex h-60 w-36 flex-col justify-between overflow-hidden rounded-xl border border-border bg-secondary p-3 shadow-md">
            <div className="absolute inset-0 z-0">
              <img 
                src={previewBlob || user?.avatarUrl} 
                alt="Card Preview"
                className="h-full w-full object-cover opacity-80"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/35 z-10"></div>
            </div>
            
            <div className="relative z-20 flex justify-between">
              <span className="rounded bg-primary px-1.5 py-0.5 text-[8px] font-bold text-primary-foreground">LIVE</span>
            </div>

            <div className="relative z-20 space-y-0.5 text-white">
              <h4 className="text-xs font-bold truncate drop-shadow">{user?.username}</h4>
              <p className="text-[8px] text-zinc-300">No.777</p>
            </div>
          </div>

          <div className="flex-1 space-y-3.5 w-full">
            <div className="flex items-center justify-center w-full">
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-border rounded-xl cursor-pointer bg-secondary/20 hover:bg-secondary/40 transition">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-8 h-8 text-muted-foreground mb-2" />
                  <p className="text-xs text-muted-foreground">클릭하여 이미지 파일 선택</p>
                </div>
                <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
              </label>
            </div>

            {previewBlob && (
              <div className="flex gap-2">
                <button
                  onClick={() => { setPreviewBlob(null); setImageFile(null); }}
                  className="flex-1 rounded-lg bg-secondary py-2 text-xs font-bold text-muted-foreground hover:bg-secondary/80"
                >
                  초기화
                </button>
                <button
                  onClick={handleUploadImage}
                  disabled={uploading}
                  className="flex-1 rounded-lg bg-primary py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90"
                >
                  {uploading ? '저장 중...' : '카드 이미지 최종 저장'}
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 쿠폰 입력 영역 */}
      <section className="rounded-3xl border border-border bg-card p-6 shadow-sm space-y-4">
        <h3 className="text-base font-bold flex items-center gap-2">
          <Tag className="h-4.5 w-4.5 text-primary" /> 리딤 쿠폰 등록
        </h3>
        <p className="text-xs text-muted-foreground">발급된 쿠폰 코드를 입력하시면 포인트가 즉시 지급됩니다.</p>
        <div className="flex gap-2">
          <input 
            type="text" 
            placeholder="쿠폰 키 입력 (예: MOCK-1000)" 
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs focus:border-primary focus:outline-none"
          />
          <button 
            onClick={handleClaimCoupon}
            className="rounded-lg bg-primary px-5 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90"
          >
            등록
          </button>
        </div>
      </section>

      {/* 관리자 제어 콘솔 (ADMIN 일때만 보임) */}
      {user?.role === 'ADMIN' && (
        <section className="rounded-3xl border-2 border-red-500/20 bg-card p-6 shadow-md space-y-6">
          <div className="flex items-center gap-2 border-b border-border pb-3 text-red-500">
            <ShieldAlert className="h-5 w-5" />
            <h3 className="font-extrabold text-foreground text-base">CCTV 어드민 관리자 통제 패널</h3>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* 쿠폰 발행 */}
            <div className="space-y-3 bg-secondary/20 p-4 rounded-xl border border-border/50">
              <h4 className="text-xs font-bold flex items-center gap-1.5"><Tag className="h-4 w-4" /> 리딤 쿠폰 발행</h4>
              <div className="space-y-2">
                <input 
                  type="text" 
                  placeholder="쿠폰 코드 (미입력 시 랜덤 생성)"
                  value={couponForm.code}
                  onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value })}
                  className="w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs"
                />
                <div className="flex gap-2">
                  <select 
                    value={couponForm.coupon_type}
                    onChange={(e) => setCouponForm({ ...couponForm, coupon_type: e.target.value as any })}
                    className="flex-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs"
                  >
                    <option value="single">일회성 (1회 즉시 소멸)</option>
                    <option value="multi">다회성 (사용 횟수 기정)</option>
                  </select>
                  <input 
                    type="number" 
                    placeholder="최대 사용"
                    value={couponForm.max_uses}
                    onChange={(e) => setCouponForm({ ...couponForm, max_uses: Number(e.target.value) })}
                    className="w-16 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs"
                  />
                </div>
                <input 
                  type="number" 
                  placeholder="지급 포인트 크기"
                  value={couponForm.points}
                  onChange={(e) => setCouponForm({ ...couponForm, points: Number(e.target.value) })}
                  className="w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs"
                />
                <button 
                  onClick={handleCreateCoupon}
                  className="w-full rounded-lg bg-primary py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90"
                >
                  쿠폰 발행 및 DB 등록
                </button>
              </div>
            </div>

            {/* 공지사항 생성 */}
            <div className="space-y-3 bg-secondary/20 p-4 rounded-xl border border-border/50">
              <h4 className="text-xs font-bold flex items-center gap-1.5"><ImageIcon className="h-4 w-4" /> 플랫폼 소식 & 팝업 공지 등록</h4>
              <div className="space-y-2">
                <input 
                  type="text" 
                  placeholder="공지 제목"
                  value={noticeForm.title}
                  onChange={(e) => setNoticeForm({ ...noticeForm, title: e.target.value })}
                  className="w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs"
                />
                <textarea 
                  placeholder="공지 본문 내용"
                  value={noticeForm.content}
                  onChange={(e) => setNoticeForm({ ...noticeForm, content: e.target.value })}
                  className="w-full h-16 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs"
                />
                <label className="flex items-center gap-2 text-xs">
                  <input 
                    type="checkbox" 
                    checked={noticeForm.is_popup}
                    onChange={(e) => setNoticeForm({ ...noticeForm, is_popup: e.target.checked })}
                  /> 메인 화면 오버레이 팝업으로 등록
                </label>
                <button 
                  onClick={handleCreateAnnouncement}
                  className="w-full rounded-lg bg-primary py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90"
                >
                  공지 등록하기
                </button>
              </div>
            </div>

            {/* PWA 알림 예약 */}
            <div className="space-y-3 bg-secondary/20 p-4 rounded-xl border border-border/50">
              <h4 className="text-xs font-bold flex items-center gap-1.5"><BellRing className="h-4 w-4" /> PWA 푸시 알림 예약 전송</h4>
              <div className="space-y-2">
                <input 
                  type="text" 
                  placeholder="알림 제목"
                  value={pushForm.title}
                  onChange={(e) => setPushForm({ ...pushForm, title: e.target.value })}
                  className="w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs"
                />
                <input 
                  type="text" 
                  placeholder="알림 본문"
                  value={pushForm.body}
                  onChange={(e) => setPushForm({ ...pushForm, body: e.target.value })}
                  className="w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs"
                />
                <input 
                  type="datetime-local" 
                  value={pushForm.scheduled_at}
                  onChange={(e) => setPushForm({ ...pushForm, scheduled_at: e.target.value })}
                  className="w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs"
                />
                <button 
                  onClick={handleSchedulePush}
                  className="w-full rounded-lg bg-primary py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90"
                >
                  예약 전송 등록
                </button>
              </div>
            </div>

            {/* 카드 신고 내역 콘솔 */}
            <div className="space-y-3 bg-secondary/20 p-4 rounded-xl border border-border/50">
              <h4 className="text-xs font-bold flex items-center gap-1.5 text-red-500"><AlertTriangle className="h-4 w-4" /> 카드 이미지 신고 접수 리스트</h4>
              <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
                {reports.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground text-center py-6">접수된 신고 건이 없습니다.</p>
                ) : (
                  reports.map((rep) => (
                    <div key={rep.id} className="p-3 bg-card rounded-lg border border-border space-y-2">
                      <div className="flex items-center gap-3">
                        {/* 신고 당시 스냅샷 이미지 보존형 뷰어 */}
                        <img src={rep.reported_image_url} alt="Report Snapshot" className="h-10 w-10 rounded border border-border/80 object-cover" />
                        <div>
                          <p className="text-[10px] font-bold text-foreground">신고 ID: {rep.id} (스트리머: {rep.channel_id})</p>
                          <p className="text-[9.5px] text-muted-foreground">사유: {rep.reason}</p>
                        </div>
                      </div>
                      
                      <div className="flex justify-between items-center gap-2 pt-1 border-t border-border/40">
                        <div className="flex gap-1">
                          <button 
                            onClick={() => handleBanUser(rep.reporter_id, '7d')}
                            className="rounded bg-red-500/10 px-2 py-0.5 text-[9px] text-red-500 hover:bg-red-500/20"
                          >
                            리포터 밴
                          </button>
                          <button 
                            onClick={() => handleResolveReport(rep.id, 'resolved')}
                            className="rounded bg-primary/10 px-2 py-0.5 text-[9px] text-primary hover:bg-primary/20"
                          >
                            신고 승인
                          </button>
                        </div>
                        <button 
                          onClick={() => handleResolveReport(rep.id, 'rejected')}
                          className="rounded bg-secondary px-2 py-0.5 text-[9px] text-muted-foreground hover:bg-secondary/80"
                        >
                          기각
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 로그아웃 */}
      <button 
        onClick={logout}
        className="w-full rounded-xl bg-secondary py-3 text-center text-xs font-bold text-muted-foreground hover:bg-secondary/80 transition"
      >
        계정 세션 로그아웃
      </button>

    </div>
  );
};
