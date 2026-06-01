'use client';

import React, { useState, useEffect } from 'react';
import { useApp } from './AppContext';
import {
  User,
  Tag,
  BellRing,
  Camera,
  X,
  Upload,
  Star,
  Download,
  Check
} from 'lucide-react';
import { API_BASE_URL, apiFetch } from '@/lib/api';
import { subscribeToPush, isPushSupported } from '@/lib/push';

interface UserCard {
  id: number;
  channel_id: string;
  serial_number: number;
  acquired_at: string;
  streamer?: {
    channel_id: string;
    name: string;
    logo_url: string;
    custom_image_url: string | null;
    base_value: number;
  };
}

export const MyInfoTab: React.FC = () => {
  const { user, logout, updatePoints, refreshUserData, canInstall, promptInstall } = useApp();

  // 쿠폰 사용 입력 상태
  const [couponCode, setCouponCode] = useState('');

  // 보유 카드 (대표 카드 선택용)
  const [inventory, setInventory] = useState<UserCard[]>([]);
  const [repModalOpen, setRepModalOpen] = useState(false);

  // 스트리머 프로필 커스텀 이미지 업로드 상태 (지연 업로드)
  const [previewBlob, setPreviewBlob] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [imageDisclaimerChecked, setImageDisclaimerChecked] = useState(false);

  useEffect(() => {
    if (user) fetchInventory();
  }, [user]);

  const fetchInventory = async () => {
    try {
      const res = await apiFetch('/users/me/cards');
      if (res.ok) setInventory(await res.json());
    } catch (e) {
      console.error('인벤토리 조회 실패:', e);
    }
  };

  const handleLogin = async () => {
    try {
      const redirectUri = `${window.location.origin}/auth/chzzk/callback`;
      const response = await apiFetch(`/auth/chzzk/url?redirect_uri=${encodeURIComponent(redirectUri)}`);
      if (!response.ok) throw new Error('로그인 URL 획득 실패');
      const data = await response.json();
      if (data.auth_url) window.location.href = data.auth_url;
    } catch (e) {
      console.error(e);
      alert('치지직 로그인 주소 요청 중 에러가 발생했습니다.');
    }
  };

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in duration-300">
        <div className="max-w-md rounded-3xl border border-border bg-card p-8 shadow-lg">
          <User className="mx-auto h-12 w-12 text-primary animate-pulse mb-4" />
          <h2 className="text-xl font-black text-foreground">로그인이 필요한 기능입니다</h2>
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            나의 프로필 정보 조회, 대표 카드 설정, 스트리머 카드 이미지 커스텀 관리, 쿠폰 리딤을 이용하시려면 치지직 간편 로그인을 진행해 주세요.
          </p>
          <button
            onClick={handleLogin}
            className="mt-6 w-full rounded-xl bg-primary py-3 text-xs font-bold text-primary-foreground hover:bg-primary/95 transition shadow-md shadow-primary/25"
          >
            치지직 연동 로그인 시작하기
          </button>
        </div>
      </div>
    );
  }

  // 대표 카드 채널 ID로 카드 데이터 찾기 (중복 보유 시 첫 장)
  const representativeCard = inventory.find(c => c.channel_id === user.representativeCardChannelId);
  // 보유 채널별 대표 후보 (중복 제거)
  const uniqueByChannel = Array.from(
    new Map(inventory.map(c => [c.channel_id, c])).values()
  );

  const handleClaimCoupon = async () => {
    if (!couponCode.trim()) {
      alert('쿠폰 코드를 입력해 주세요.');
      return;
    }
    try {
      const res = await apiFetch('/coupons/claim', { method: 'POST', body: JSON.stringify({ code: couponCode }) });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        if (data.points_added) updatePoints(data.points_added);
        // 카드 보상이면 보관함 갱신
        if (data.reward_type === 'card') fetchInventory();
        setCouponCode('');
      } else {
        alert(data.message || '쿠폰 등록 실패');
      }
    } catch (e) {
      alert('서버와의 통신 오류가 발생했습니다.');
    }
  };

  const handleEnablePush = async () => {
    if (!isPushSupported()) {
      alert('이 브라우저는 웹 푸시 알림을 지원하지 않습니다.');
      return;
    }
    const result = await subscribeToPush();
    alert(result.ok ? '실시간 푸시 알림 구독이 완료되었습니다!' : result.message);
  };

  const handleSetRepresentative = async (channelId: string | null) => {
    try {
      const res = await apiFetch('/users/me/representative', { method: 'POST', body: JSON.stringify({ channel_id: channelId }) });
      const data = await res.json();
      if (res.ok) {
        await refreshUserData();
        setRepModalOpen(false);
      } else {
        alert(data.message || '대표 카드 설정 실패');
      }
    } catch (e) {
      alert('서버와의 통신 오류가 발생했습니다.');
    }
  };

  // 이미지 선택 시 blob 생성하여 지연 렌더링 (Lazy Preview) 및 모달 오픈
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setPreviewBlob(URL.createObjectURL(file));
      setUploadModalOpen(true);
      setImageDisclaimerChecked(false);
    }
  };

  const handleUploadImage = async () => {
    if (!imageFile) { alert('변경할 카드의 이미지를 선택해 주세요.'); return; }
    if (!imageDisclaimerChecked) { alert('이미지 등록 책임 동의 체크박스를 확인해 주세요.'); return; }

    setUploading(true);
    const formData = new FormData();
    formData.append('image', imageFile);
    formData.append('channel_id', user.id);

    const token = localStorage.getItem('cctv_jwt_token');
    try {
      // 멀티파트 업로드는 apiFetch(JSON) 대신 직접 fetch 사용
      const res = await fetch(`${API_BASE_URL}/streamers/me/image`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        alert('이미지가 성공적으로 저장 완료되었습니다.');
        setImageFile(null);
        setUploadModalOpen(false);
        refreshUserData();
        fetchInventory();
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

  return (
    <div className="space-y-8 animate-in fade-in duration-300">

      {/* 프로필 + 대표 카드 */}
      <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="flex items-center gap-4 flex-1">
            <img src={user.avatarUrl} alt="Avatar" className="h-16 w-16 rounded-full border border-primary/20 bg-secondary" />
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2">
                {user.username} <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">{user.role}</span>
              </h2>
              <p className="text-xs text-muted-foreground mt-1">계정 고유 식별코드: {user.id}</p>
              <p className="text-xs text-yellow-500 font-bold mt-1">{user.point.toLocaleString()} P 보유</p>
            </div>
          </div>

          {/* 대표 카드 */}
          <div className="flex items-center gap-3">
            {representativeCard?.streamer ? (
              <div className="relative h-24 w-16 overflow-hidden rounded-xl border-2 border-amber-500 shadow">
                <img
                  src={representativeCard.streamer.custom_image_url || representativeCard.streamer.logo_url}
                  alt={representativeCard.streamer.name}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5">
                  <p className="text-[8px] font-bold text-white truncate">{representativeCard.streamer.name}</p>
                </div>
                <Star className="absolute right-0.5 top-0.5 h-3 w-3 fill-amber-400 text-amber-400" />
              </div>
            ) : (
              <div className="flex h-24 w-16 items-center justify-center rounded-xl border-2 border-dashed border-border text-[9px] text-muted-foreground text-center px-1">
                대표 카드<br />미설정
              </div>
            )}
            <button
              onClick={() => setRepModalOpen(true)}
              className="rounded-lg bg-secondary px-3 py-2 text-[11px] font-bold text-foreground hover:bg-secondary/80"
            >
              대표 카드<br />설정
            </button>
          </div>
        </div>
      </section>

      {/* 대표 카드 선택 모달 */}
      {repModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h3 className="text-base font-bold flex items-center gap-2"><Star className="h-4.5 w-4.5 text-amber-500" /> 대표 카드 선택</h3>
              <button onClick={() => setRepModalOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-4">
              {uniqueByChannel.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">보유한 카드가 없습니다.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2.5 max-h-72 overflow-y-auto pr-1">
                  {uniqueByChannel.map((card) => {
                    const s = card.streamer;
                    if (!s) return null;
                    const selected = user.representativeCardChannelId === card.channel_id;
                    return (
                      <div
                        key={card.channel_id}
                        onClick={() => handleSetRepresentative(card.channel_id)}
                        className={`relative cursor-pointer flex flex-col items-center rounded-xl border p-2 transition ${selected ? 'border-amber-500 ring-2 ring-amber-500/30' : 'border-border/60 hover:bg-secondary/50'}`}
                      >
                        <img src={s.custom_image_url || s.logo_url} alt={s.name} className="h-12 w-12 rounded-full object-cover border border-border/80" />
                        <span className="mt-1.5 text-[10px] font-bold truncate max-w-full">{s.name}</span>
                        {selected && <Check className="absolute right-1 top-1 h-3.5 w-3.5 text-amber-500" />}
                      </div>
                    );
                  })}
                </div>
              )}
              {user.representativeCardChannelId && (
                <button
                  onClick={() => handleSetRepresentative(null)}
                  className="mt-4 w-full rounded-lg bg-secondary py-2 text-xs font-bold text-muted-foreground hover:bg-secondary/80"
                >
                  대표 카드 해제
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 스트리머 본인 전용 카드 이미지 편집 */}
      <section className="rounded-3xl border border-border bg-card p-6 shadow-sm space-y-4">
        <h3 className="text-base font-bold flex items-center gap-2">
          <Camera className="h-4.5 w-4.5 text-primary" /> 스트리머 고유 카드 이미지 관리
        </h3>
        <p className="text-xs text-muted-foreground">
          본인 스트리머 카드 이미지를 커스텀으로 변경할 수 있습니다. (WebP 최대 1280px 자동 변환)
        </p>
        <div className="flex flex-col sm:flex-row items-center gap-6 pt-2">
          <div className="relative flex h-60 w-36 flex-col justify-between overflow-hidden rounded-xl border border-border bg-secondary p-3 shadow-md">
            <div className="absolute inset-0 z-0">
              <img src={previewBlob || user.avatarUrl} alt="Card Preview" className="h-full w-full object-cover opacity-80" />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/35 z-10"></div>
            </div>
            <div className="relative z-20 flex justify-between">
              <span className="rounded bg-primary px-1.5 py-0.5 text-[8px] font-bold text-primary-foreground">LIVE</span>
            </div>
            <div className="relative z-20 space-y-0.5 text-white">
              <h4 className="text-xs font-bold truncate drop-shadow">{user.username}</h4>
              <p className="text-[8px] text-zinc-300">No.0001</p>
            </div>
          </div>
          <div className="flex-1 w-full">
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-border rounded-xl cursor-pointer bg-secondary/20 hover:bg-secondary/40 transition">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <Upload className="w-8 h-8 text-muted-foreground mb-2" />
                <p className="text-xs text-muted-foreground">클릭하여 이미지 파일 선택</p>
              </div>
              <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
            </label>
          </div>
        </div>

        {/* 업로드 동의 모달 */}
        {uploadModalOpen && previewBlob && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <h3 className="text-base font-bold flex items-center gap-2"><Camera className="h-4.5 w-4.5 text-primary" /> 스트리머 카드 이미지 업로드</h3>
                <button onClick={() => { setUploadModalOpen(false); setPreviewBlob(null); setImageFile(null); setImageDisclaimerChecked(false); }} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
              </div>
              <div className="mt-4 space-y-4 flex flex-col items-center">
                <div className="relative flex h-60 w-36 flex-col justify-between overflow-hidden rounded-xl border border-border bg-secondary p-3 shadow-md">
                  <div className="absolute inset-0 z-0">
                    <img src={previewBlob} alt="Card Preview Modal" className="h-full w-full object-cover opacity-80" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/35 z-10"></div>
                  </div>
                  <div className="relative z-20 flex justify-between">
                    <span className="rounded bg-primary px-1.5 py-0.5 text-[8px] font-bold text-primary-foreground">LIVE</span>
                  </div>
                  <div className="relative z-20 space-y-0.5 text-white">
                    <h4 className="text-xs font-bold truncate drop-shadow">{user.username}</h4>
                    <p className="text-[8px] text-zinc-300">No.0001</p>
                  </div>
                </div>
                <div className="rounded-lg bg-secondary/30 border border-border/50 p-3 space-y-2.5 w-full">
                  <div className="text-[0.62rem] text-muted-foreground leading-relaxed">
                    <p className="font-bold text-foreground/80 mb-1">⚠️ 이미지 등록 법적 책임 조항</p>
                    해당 스트리머 커스텀 카드 이미지 등록으로 인해 발생하는 모든 초상권, 저작권, 퍼블리시티권 분쟁 등 법적 책임은 등록자 본인에게 전적으로 귀속됨을 확인합니다.
                  </div>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="checkbox" checked={imageDisclaimerChecked} onChange={(e) => setImageDisclaimerChecked(e.target.checked)} className="mt-0.5 rounded border-border" />
                    <span className="text-[0.65rem] font-semibold text-foreground/90">내용을 확인했으며, 모든 법적 책임 귀속에 동의합니다.</span>
                  </label>
                </div>
              </div>
              <div className="mt-6 flex items-center justify-end gap-2 border-t border-border/60 pt-4">
                <button onClick={() => { setUploadModalOpen(false); setPreviewBlob(null); setImageFile(null); setImageDisclaimerChecked(false); }} className="rounded-lg px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground hover:bg-secondary/80">취소</button>
                <button onClick={handleUploadImage} disabled={uploading || !imageDisclaimerChecked} className="rounded-lg bg-primary px-5 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none">
                  {uploading ? '저장 중...' : '카드 이미지 최종 저장'}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 쿠폰 입력 */}
      <section className="rounded-3xl border border-border bg-card p-6 shadow-sm space-y-4">
        <h3 className="text-base font-bold flex items-center gap-2"><Tag className="h-4.5 w-4.5 text-primary" /> 리딤 쿠폰 등록</h3>
        <p className="text-xs text-muted-foreground">발급된 쿠폰 코드를 입력하시면 포인트가 즉시 지급됩니다.</p>
        <div className="flex gap-2">
          <input type="text" placeholder="쿠폰 키 입력 (예: WELCOME2026)" value={couponCode}
            onChange={(e) => setCouponCode(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs focus:border-primary focus:outline-none" />
          <button onClick={handleClaimCoupon} className="rounded-lg bg-primary px-5 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90">등록</button>
        </div>
      </section>

      {/* 알림 & 앱 설치 */}
      <section className="rounded-3xl border border-border bg-card p-6 shadow-sm space-y-4">
        <h3 className="text-base font-bold flex items-center gap-2"><BellRing className="h-4.5 w-4.5 text-primary" /> 실시간 푸시 알림 & 앱 설치</h3>
        <p className="text-xs text-muted-foreground">알림을 허용하면 공지·이벤트 소식을 푸시로 받아볼 수 있습니다. PWA로 설치하면 백그라운드 알림 수신이 가능합니다.</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={handleEnablePush} className="rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition shadow-sm">
            알림 받기 (구독하기)
          </button>
          {canInstall && (
            <button onClick={promptInstall} className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-5 py-2.5 text-xs font-bold text-primary hover:bg-primary/20 transition">
              <Download className="h-4 w-4" /> 앱 설치하기
            </button>
          )}
        </div>
      </section>

      {/* 로그아웃 */}
      <button onClick={logout} className="w-full rounded-xl bg-secondary py-3 text-center text-xs font-bold text-muted-foreground hover:bg-secondary/80 transition">
        계정 세션 로그아웃
      </button>
    </div>
  );
};
