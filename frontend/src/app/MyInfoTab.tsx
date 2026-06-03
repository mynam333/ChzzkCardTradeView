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
  Check,
  Share2,
  Ban
} from 'lucide-react';
import { API_BASE_URL, apiFetch } from '@/lib/api';
import { subscribeToPush, isPushSupported } from '@/lib/push';
import { ProfileModal } from './ProfileModal';
import { cardImage } from '@/lib/cosmetics';

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
  const { user, logout, updatePoints, refreshUserData, toast } = useApp();

  // 쿠폰 사용 입력 상태
  const [couponCode, setCouponCode] = useState('');

  // 보유 카드 (대표 카드 선택용)
  const [inventory, setInventory] = useState<UserCard[]>([]);
  const [repModalOpen, setRepModalOpen] = useState(false);

  // 본인 계정이 카드로 등록된 스트리머인지 여부 (이미지 관리 노출 조건)
  const [isStreamer, setIsStreamer] = useState(false);
  // 본인 스트리머 데이터(별별 커스텀 이미지 custom_images 포함)
  const [myStreamer, setMyStreamer] = useState<any | null>(null);

  // 프로필 카드(공유용) 모달
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  // 유저 차단
  const [blockSearch, setBlockSearch] = useState('');
  const [blockedUsers, setBlockedUsers] = useState<{ id: string; username: string; avatar_url: string }[]>([]);
  const [blocking, setBlocking] = useState(false);

  // 스트리머 프로필 커스텀 이미지 업로드 상태 (지연 업로드)
  const [previewBlob, setPreviewBlob] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [imageDisclaimerChecked, setImageDisclaimerChecked] = useState(false);
  const [uploadStar, setUploadStar] = useState(0); // 업로드 대상 별(0~5성) 슬롯

  useEffect(() => {
    if (user) {
      fetchInventory();
      checkStreamerRegistration();
      fetchBlocks();
    }
  }, [user]);

  const fetchBlocks = async () => {
    try {
      const res = await apiFetch('/users/me/blocks');
      if (res.ok) setBlockedUsers(await res.json());
    } catch { /* noop */ }
  };

  const handleBlock = async () => {
    const name = blockSearch.trim();
    if (!name) { toast('차단할 유저명을 입력해 주세요.', 'warning'); return; }
    setBlocking(true);
    try {
      const res = await apiFetch('/users/me/blocks', { method: 'POST', body: JSON.stringify({ username: name }) });
      const data = await res.json();
      if (res.ok) {
        toast(data.message || '차단했습니다.', 'success');
        setBlockSearch('');
        fetchBlocks();
      } else {
        toast(data.message || '차단 실패', 'error');
      }
    } catch {
      toast('서버와의 통신 오류가 발생했습니다.', 'error');
    } finally {
      setBlocking(false);
    }
  };

  const handleUnblock = async (targetId: string) => {
    try {
      const res = await apiFetch(`/users/me/blocks/${targetId}`, { method: 'DELETE' });
      if (res.ok) {
        toast('차단을 해제했습니다.', 'info');
        fetchBlocks();
      } else {
        toast('차단 해제 실패', 'error');
      }
    } catch {
      toast('서버와의 통신 오류가 발생했습니다.', 'error');
    }
  };

  const fetchInventory = async () => {
    try {
      const res = await apiFetch('/users/me/cards');
      if (res.ok) setInventory(await res.json());
    } catch (e) {
      console.error('인벤토리 조회 실패:', e);
    }
  };

  // 내 채널 ID가 스트리머로 등록되어 있는지 확인 (등록된 경우에만 카드 이미지 관리 노출)
  const checkStreamerRegistration = async () => {
    if (!user) return;
    try {
      const res = await apiFetch(`/streamers/${user.id}`);
      setIsStreamer(res.ok);
      if (res.ok) {
        const data = await res.json();
        setMyStreamer(data.streamer || data);
      } else {
        setMyStreamer(null);
      }
    } catch {
      setIsStreamer(false);
      setMyStreamer(null);
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
      toast('치지직 로그인 주소 요청 중 에러가 발생했습니다.');
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
      toast('쿠폰 코드를 입력해 주세요.');
      return;
    }
    try {
      const res = await apiFetch('/coupons/claim', { method: 'POST', body: JSON.stringify({ code: couponCode }) });
      const data = await res.json();
      if (res.ok) {
        toast(data.message);
        if (data.points_added) updatePoints(data.points_added);
        // 카드 보상이면 보관함 갱신
        if (data.reward_type === 'card') fetchInventory();
        setCouponCode('');
      } else {
        toast(data.message || '쿠폰 등록 실패');
      }
    } catch (e) {
      toast('서버와의 통신 오류가 발생했습니다.');
    }
  };

  const handleEnablePush = async () => {
    if (!isPushSupported()) {
      toast('이 브라우저는 웹 푸시 알림을 지원하지 않습니다.');
      return;
    }
    const result = await subscribeToPush();
    toast(result.ok ? '실시간 푸시 알림 구독이 완료되었습니다!' : result.message);
  };

  const handleSetRepresentative = async (channelId: string | null) => {
    try {
      const res = await apiFetch('/users/me/representative', { method: 'POST', body: JSON.stringify({ channel_id: channelId }) });
      const data = await res.json();
      if (res.ok) {
        await refreshUserData();
        setRepModalOpen(false);
      } else {
        toast(data.message || '대표 카드 설정 실패');
      }
    } catch (e) {
      toast('서버와의 통신 오류가 발생했습니다.');
    }
  };

  // 등록한 별 이미지 직접 삭제(초기화)
  const handleDeleteImage = async (star: number) => {
    try {
      const res = await apiFetch('/streamers/me/image/reset', { method: 'POST', body: JSON.stringify({ channel_id: user.id, star }) });
      const data = await res.json();
      if (res.ok) {
        toast(`${star}성 카드 이미지를 삭제했습니다.`, 'success');
        fetchInventory();
        checkStreamerRegistration();
      } else {
        toast(data.message || '이미지 삭제 실패', 'error');
      }
    } catch {
      toast('서버와의 통신 오류가 발생했습니다.', 'error');
    }
  };

  // 이미지 선택 시 blob 생성하여 지연 렌더링 (Lazy Preview) 및 모달 오픈
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>, star: number) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadStar(star);
      setImageFile(file);
      setPreviewBlob(URL.createObjectURL(file));
      setUploadModalOpen(true);
      setImageDisclaimerChecked(false);
    }
    // 같은 파일 재선택을 허용하기 위해 입력값 초기화
    e.target.value = '';
  };

  const handleUploadImage = async () => {
    if (!imageFile) { toast('변경할 카드의 이미지를 선택해 주세요.'); return; }
    if (!imageDisclaimerChecked) { toast('이미지 등록 책임 동의 체크박스를 확인해 주세요.'); return; }

    setUploading(true);
    const formData = new FormData();
    formData.append('image', imageFile);
    formData.append('channel_id', user.id);
    formData.append('star', String(uploadStar));

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
        toast(`${uploadStar}성 카드 이미지가 저장되었습니다.`, 'success');
        setPreviewBlob(null);
        setImageFile(null);
        setUploadModalOpen(false);
        refreshUserData();
        fetchInventory();
        checkStreamerRegistration(); // 별별 이미지 상태 동기화
      } else {
        toast(data.message || '이미지 저장 권한 오류 또는 차단 상태입니다.');
      }
    } catch (e) {
      toast('서버 전송 중 에러가 발생했습니다.');
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
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setRepModalOpen(true)}
                className="rounded-lg bg-secondary px-3 py-2 text-[11px] font-bold text-foreground hover:bg-secondary/80"
              >
                대표 카드 설정
              </button>
              <button
                onClick={() => setProfileModalOpen(true)}
                className="flex items-center justify-center gap-1 rounded-lg bg-primary px-3 py-2 text-[11px] font-bold text-primary-foreground hover:bg-primary/90"
              >
                <Share2 className="h-3 w-3" /> 프로필 공유
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 프로필 카드(공유용) 모달 */}
      {profileModalOpen && <ProfileModal userId={user.id} onClose={() => setProfileModalOpen(false)} />}

      {/* 대표 카드 선택 모달 */}
      {repModalOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
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

      {/* 스트리머 본인 전용 카드 이미지 편집 (카드로 등록된 스트리머 계정에서만 노출) */}
      {isStreamer && (
      <section className="rounded-3xl border border-border bg-card p-6 shadow-sm space-y-4">
        <h3 className="text-base font-bold flex items-center gap-2">
          <Camera className="h-4.5 w-4.5 text-primary" /> 스트리머 고유 카드 이미지 관리
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          0성부터 5성까지 별 등급별 카드 이미지를 각각 등록할 수 있습니다. (WebP 최대 1280px 자동 변환, 5:8 비율)<br />
          특정 성에 이미지를 등록하지 않으면 <strong className="text-foreground/80">바로 아래 등급의 이미지</strong>가 자동 적용되며, 더 낮은 등급도 없으면 기본 치지직 프로필이 노출됩니다.
        </p>

        {/* 0~5성 슬롯 그리드 */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 pt-1">
          {[0, 1, 2, 3, 4, 5].map((st) => {
            const imgs: (string | null)[] = myStreamer?.custom_images || [myStreamer?.custom_image_url ?? null];
            const ownImage = imgs[st] || null;                      // 이 성에 직접 등록된 이미지
            const resolved = cardImage(myStreamer, st);             // 실제 적용되는 이미지(상속 포함)
            const inherited = !ownImage && resolved && resolved !== myStreamer?.logo_url; // 하위 성에서 상속
            return (
              <div
                key={st}
                onClick={(e) => {
                  const target = e.target as HTMLElement;
                  // 클릭된 요소가 삭제 버튼(button)이 아닌 경우에만 파일 업로드를 트리거
                  if (!target.closest('button')) {
                    const fileInput = e.currentTarget.querySelector('input[type="file"]') as HTMLInputElement;
                    fileInput?.click();
                  }
                }}
                className="group relative flex aspect-[5/8] cursor-pointer flex-col justify-between overflow-hidden rounded-xl border border-border bg-secondary shadow-sm transition hover:border-primary"
              >
                <div className="absolute inset-0 z-0">
                  {resolved ? (
                    <img src={resolved} alt={`${st}성`} className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full bg-secondary" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/30 z-10" />
                </div>
                {/* 상단 별 표시 + 상태 칩 */}
                <div className="relative z-20 flex items-start justify-between p-1.5">
                  <span className="rounded bg-black/45 px-1.5 py-0.5 text-[9px] font-black text-amber-300">
                    {st === 0 ? '0성' : '★'.repeat(st)}
                  </span>
                  <div className="flex items-center gap-1">
                    {ownImage ? (
                      <span className="rounded bg-emerald-500/90 px-1 py-0.5 text-[7px] font-black text-white">등록</span>
                    ) : inherited ? (
                      <span className="rounded bg-sky-500/90 px-1 py-0.5 text-[7px] font-black text-white">상속</span>
                    ) : (
                      <span className="rounded bg-zinc-700/90 px-1 py-0.5 text-[7px] font-black text-zinc-300">기본</span>
                    )}
                    {ownImage && (
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteImage(st); }}
                        title={`${st}성 이미지 삭제`}
                        className="flex h-4 w-4 items-center justify-center rounded-full bg-red-500/90 text-[9px] font-black text-white hover:bg-red-600"
                      >×</button>
                    )}
                  </div>
                </div>
                {/* 하단 변경 안내 */}
                <div className="relative z-20 flex items-center justify-center gap-1 p-1.5 text-white opacity-90 group-hover:opacity-100">
                  <Upload className="h-3 w-3" />
                  <span className="text-[9px] font-bold">{ownImage ? '변경' : '등록'}</span>
                </div>
                <input type="file" accept="image/*" onChange={(e) => handleImageChange(e, st)} className="hidden" />
              </div>
            );
          })}
        </div>

        {/* 업로드 동의 모달 */}
        {uploadModalOpen && previewBlob && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <h3 className="text-base font-bold flex items-center gap-2"><Camera className="h-4.5 w-4.5 text-primary" /> {uploadStar === 0 ? '0성' : `${uploadStar}성`} 카드 이미지 업로드</h3>
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
                    <div className="flex gap-0.5">{uploadStar > 0 && Array.from({ length: uploadStar }, (_, i) => <span key={i} className="text-amber-300 text-[10px] leading-none">★</span>)}</div>
                    <h4 className="text-xs font-bold truncate drop-shadow">{user.username}</h4>
                    <p className="text-[8px] text-zinc-300">{uploadStar === 0 ? '0성 카드' : `${uploadStar}성 카드`}</p>
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
      )}

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
        <h3 className="text-base font-bold flex items-center gap-2"><BellRing className="h-4.5 w-4.5 text-primary" /> 실시간 푸시 알림</h3>
        <p className="text-xs text-muted-foreground">알림을 허용하면 공지·이벤트 소식을 푸시로 받아볼 수 있습니다. (PWA 설치 시 백그라운드 수신)</p>
        <button onClick={handleEnablePush} className="rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition shadow-sm">
          알림 받기 (구독하기)
        </button>
      </section>

      {/* 유저 차단 관리 */}
      <section className="rounded-3xl border border-border bg-card p-6 shadow-sm space-y-4">
        <h3 className="text-base font-bold flex items-center gap-2"><Ban className="h-4.5 w-4.5 text-rose-500" /> 유저 차단 관리</h3>
        <p className="text-xs text-muted-foreground">차단한 유저는 회원님에게 <strong className="text-foreground/80">교환을 제안할 수 없습니다.</strong></p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="차단할 유저명 입력"
            value={blockSearch}
            onChange={(e) => setBlockSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleBlock(); }}
            className="flex-1 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs focus:border-primary focus:outline-none"
          />
          <button onClick={handleBlock} disabled={blocking} className="rounded-lg bg-rose-500 px-5 py-2 text-xs font-bold text-white hover:bg-rose-600 disabled:opacity-50">
            {blocking ? '처리 중...' : '차단'}
          </button>
        </div>

        {blockedUsers.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[11px] font-bold text-muted-foreground">차단 목록 ({blockedUsers.length})</p>
            {blockedUsers.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-2 rounded-lg bg-secondary/30 px-3 py-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <img src={b.avatar_url} alt={b.username} className="h-8 w-8 rounded-full border border-border object-cover" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold truncate">{b.username}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{b.id}</p>
                  </div>
                </div>
                <button onClick={() => handleUnblock(b.id)} className="shrink-0 rounded bg-secondary px-2.5 py-1 text-[10px] font-bold text-foreground hover:bg-secondary/80">
                  차단 해제
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-3">차단한 유저가 없습니다.</p>
        )}
      </section>

      {/* 로그아웃 */}
      <button onClick={logout} className="w-full rounded-xl bg-secondary py-3 text-center text-xs font-bold text-muted-foreground hover:bg-secondary/80 transition">
        계정 세션 로그아웃
      </button>

      {/* 개발자 SNS (새 창) — 일반 링크라 팝업 차단에 걸리지 않음 */}
      <div className="pt-1 text-right">
        <a
          href="https://x.com/Chzzk_YuAru"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-[11px] font-bold text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <span className="text-sm leading-none">𝕏</span>
          개발자 SNS
        </a>
      </div>
    </div>
  );
};
