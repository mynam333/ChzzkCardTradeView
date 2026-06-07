'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Ban,
  Crown
} from 'lucide-react';
import { API_BASE_URL, apiFetch } from '@/lib/api';
import { subscribeToPush, isPushSupported } from '@/lib/push';
import { ProfileModal } from './ProfileModal';
import { cardImage } from '@/lib/cosmetics';
import { UserTitleBadge, UserTitleList } from './UserTitleBadge';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ImageCropModal } from './ImageCropModal';
import {
  normalizeCouponDeepLinkCode,
  PENDING_COUPON_STORAGE_KEY
} from '@/lib/couponDeepLink';

interface UserCard {
  id: number;
  channel_id: string;
  serial_number: number;
  star?: number;
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
  const couponSectionRef = useRef<HTMLElement>(null);
  const couponInputRef = useRef<HTMLInputElement>(null);
  const pendingCouponRef = useRef('');

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
  const [uploading, setUploading] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [imageDisclaimerChecked, setImageDisclaimerChecked] = useState(false);
  const [uploadStar, setUploadStar] = useState(0); // 업로드 대상 별(0~5성) 슬롯
  const [privacyModalOpen, setPrivacyModalOpen] = useState(false);
  const [titleSaving, setTitleSaving] = useState(false);

  // 크롭 모달 상태
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [originalImageSrc, setOriginalImageSrc] = useState<string | null>(null);
  // 크롭 완료된 Blob (실제 업로드에 사용)
  const [croppedBlob, setCroppedBlob] = useState<Blob | null>(null);

  useEffect(() => {
    if (user) {
      fetchInventory();
      checkStreamerRegistration();
      fetchBlocks();
    }
  }, [user]);

  useEffect(() => {
    const currentUrl = new URL(window.location.href);
    const queryCoupon = normalizeCouponDeepLinkCode(currentUrl.searchParams.get('coupon'));
    const storedCoupon = normalizeCouponDeepLinkCode(
      localStorage.getItem(PENDING_COUPON_STORAGE_KEY)
    );
    const incomingCoupon = queryCoupon || storedCoupon;

    if (!incomingCoupon) return;

    pendingCouponRef.current = incomingCoupon;
    setCouponCode(incomingCoupon);
    localStorage.setItem(PENDING_COUPON_STORAGE_KEY, incomingCoupon);

    if (currentUrl.searchParams.has('coupon')) {
      currentUrl.searchParams.delete('coupon');
      window.history.replaceState(
        window.history.state,
        '',
        `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`
      );
    }
  }, []);

  useEffect(() => {
    if (!user || !pendingCouponRef.current) return;

    const timer = window.setTimeout(() => {
      couponSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      couponInputRef.current?.focus({ preventScroll: true });
      localStorage.removeItem(PENDING_COUPON_STORAGE_KEY);
      pendingCouponRef.current = '';
    }, 100);

    return () => window.clearTimeout(timer);
  }, [user]);

  const fetchBlocks = async () => {
    try {
      const res = await apiFetch('/users/me/blocks');
      if (res.ok) setBlockedUsers(await res.json());
    } catch { /* noop */ }
  };

  const handleEquipTitle = async (titleId: number | null) => {
    setTitleSaving(true);
    try {
      const res = await apiFetch('/users/me/title', {
        method: 'PUT',
        body: JSON.stringify({ title_id: titleId })
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.message || '칭호 장착 변경에 실패했습니다.', 'error');
        return;
      }
      await refreshUserData(false);
      toast(data.message || '칭호 장착 상태를 변경했습니다.', 'success');
    } catch {
      toast('서버와의 통신 오류가 발생했습니다.', 'error');
    } finally {
      setTitleSaving(false);
    }
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

  // 대표 카드는 채널과 별 등급을 함께 식별합니다.
  const representativeCard = inventory.find(c =>
    c.channel_id === user.representativeCardChannelId
    && (user.representativeCardStar == null || (c.star || 0) === user.representativeCardStar)
  );
  const uniqueCards = Array.from(
    new Map(inventory.map(c => [`${c.channel_id}#${c.star || 0}`, c])).values()
  );

  const handleClaimCoupon = async () => {
    const normalizedCouponCode = couponCode.trim().toUpperCase();
    if (!normalizedCouponCode) {
      toast('쿠폰 코드를 입력해 주세요.');
      return;
    }
    try {
      const res = await apiFetch('/coupons/claim', {
        method: 'POST',
        body: JSON.stringify({ code: normalizedCouponCode })
      });
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

  const handleSetRepresentative = async (channelId: string | null, star: number | null = null) => {
    try {
      const res = await apiFetch('/users/me/representative', {
        method: 'POST',
        body: JSON.stringify({ channel_id: channelId, star })
      });
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

  // 이미지 선택 시 크롭 모달 먼저 오픈 (원본 ObjectURL 저장)
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>, star: number) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadStar(star);
      // 원본 이미지 소스를 크롭 모달에 전달
      const objectUrl = URL.createObjectURL(file);
      setOriginalImageSrc(objectUrl);
      setCropModalOpen(true);
      setImageDisclaimerChecked(false);
    }
    // 같은 파일 재선택을 허용하기 위해 입력값 초기화
    e.target.value = '';
  };

  // 크롭 완료 콜백: croppedBlob을 저장하고 동의 모달 오픈
  const handleCropConfirm = useCallback((blob: Blob) => {
    setCroppedBlob(blob);
    // 크롭된 이미지 미리보기 URL 생성
    setPreviewBlob(URL.createObjectURL(blob));
    setCropModalOpen(false);
    setUploadModalOpen(true);
  }, []);

  // 크롭 취소
  const handleCropCancel = useCallback(() => {
    setCropModalOpen(false);
    if (originalImageSrc) {
      URL.revokeObjectURL(originalImageSrc);
      setOriginalImageSrc(null);
    }
  }, [originalImageSrc]);

  const handleUploadImage = async () => {
    if (!croppedBlob) { toast('변경할 카드의 이미지를 선택해 주세요.'); return; }
    if (!imageDisclaimerChecked) { toast('이미지 등록 책임 동의 체크박스를 확인해 주세요.'); return; }

    setUploading(true);
    const formData = new FormData();
    // 크롭된 Blob을 WebP 파일로 첨부
    formData.append('image', croppedBlob, 'card.webp');
    formData.append('channel_id', user.id);
    formData.append('star', String(uploadStar));

    try {
      // 멀티파트 업로드는 apiFetch(JSON) 대신 직접 fetch 사용 — 인증은 httpOnly 쿠키로 전송
      const res = await fetch(`${API_BASE_URL}/streamers/me/image`, {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });
      const data = await res.json();
      if (res.ok) {
        toast(`${uploadStar}성 카드 이미지가 저장되었습니다.`, 'success');
        // ObjectURL 메모리 해제
        if (previewBlob) URL.revokeObjectURL(previewBlob);
        if (originalImageSrc) URL.revokeObjectURL(originalImageSrc);
        setPreviewBlob(null);
        setCroppedBlob(null);
        setOriginalImageSrc(null);
        setUploadModalOpen(false);
        refreshUserData();
        fetchInventory();
        checkStreamerRegistration(); // 별별 이미지 상태 동기화
      } else {
        toast(data.message || '이미지 저장 권한 오류 또는 차단 상태입니다.');
      }
    } catch (e) {
      toast('서버 전송 중 에러가 발생했습니다.');
      setCroppedBlob(null);
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
            <img src={user.avatarUrl} alt="Avatar" className="h-16 w-16 rounded-full border border-primary/20 bg-secondary object-cover" />
            <div>
              <h2 className="text-xl font-bold flex flex-wrap items-center gap-2">
                {user.username}
                <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">{user.role}</span>
                <UserTitleList titles={user.titles} />
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
                  src={cardImage(representativeCard.streamer, representativeCard.star || 0)}
                  alt={representativeCard.streamer.name}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5">
                  <p className="text-[8px] font-bold text-white truncate">{representativeCard.streamer.name}</p>
                </div>
                <span className="absolute right-0.5 top-0.5 rounded bg-black/60 px-1 text-[8px] font-black text-amber-300">
                  {representativeCard.star || 0}★
                </span>
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

      {/* 보유 칭호 및 대표 칭호 장착 */}
      <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-black">
              <Crown className="h-4 w-4 text-amber-500" /> 보유 칭호
            </h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              장착한 칭호 1개가 프로필, 내 정보와 메인 사이드바에 표시됩니다.
            </p>
          </div>
          {user.titles.length > 0 && (
            <button
              disabled={titleSaving}
              onClick={() => handleEquipTitle(null)}
              className="rounded-lg bg-secondary px-3 py-2 text-[10px] font-bold text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              장착 해제
            </button>
          )}
        </div>

        {user.ownedTitles.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-border bg-secondary/20 px-4 py-8 text-center">
            <Crown className="mx-auto h-7 w-7 text-muted-foreground/40" />
            <p className="mt-2 text-xs font-bold text-muted-foreground">아직 보유한 칭호가 없습니다.</p>
            <p className="mt-1 text-[10px] text-muted-foreground">이벤트와 운영 보상으로 특별한 칭호를 획득할 수 있습니다.</p>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {user.ownedTitles.map((title) => {
              const equipped = user.titles.some((item) => item.id === title.id);
              return (
                <div
                  key={title.id}
                  className={`relative flex min-h-24 flex-col justify-between rounded-2xl border p-4 transition ${
                    equipped
                      ? 'border-amber-400/70 bg-amber-400/5 shadow-[0_0_18px_rgba(251,191,36,0.12)]'
                      : 'border-border bg-secondary/20 hover:border-primary/40'
                  }`}
                >
                  {equipped && (
                    <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-1 text-[9px] font-black text-amber-500">
                      <Check className="h-2.5 w-2.5" /> 장착 중
                    </span>
                  )}
                  <div className="flex min-h-8 items-center pr-16">
                    <UserTitleBadge title={title} />
                  </div>
                  <button
                    disabled={titleSaving || equipped}
                    onClick={() => handleEquipTitle(title.id)}
                    className={`mt-4 w-full rounded-lg py-2 text-[10px] font-bold transition disabled:cursor-default ${
                      equipped
                        ? 'bg-amber-400/10 text-amber-500'
                        : 'bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-50'
                    }`}
                  >
                    {equipped ? '현재 장착됨' : '이 칭호 장착'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 프로필 카드(공유용) 모달 */}
      {profileModalOpen && <ProfileModal userId={user.id} onClose={() => setProfileModalOpen(false)} isOwn />}

      {/* 대표 카드 선택 모달 */}
      {repModalOpen && (
        <div className="modal-backdrop z-[80] bg-black/60 backdrop-blur-sm">
          <div className="modal-panel modal-panel-md modal-panel-scroll rounded-2xl border border-border bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-200 sm:p-6">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h3 className="text-base font-bold flex items-center gap-2"><Star className="h-4.5 w-4.5 text-amber-500" /> 대표 카드 선택</h3>
              <button onClick={() => setRepModalOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-4">
              {uniqueCards.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">보유한 카드가 없습니다.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2.5 max-h-72 overflow-y-auto pr-1">
                  {uniqueCards.map((card) => {
                    const s = card.streamer;
                    if (!s) return null;
                    const star = card.star || 0;
                    const selected = user.representativeCardChannelId === card.channel_id
                      && user.representativeCardStar === star;
                    return (
                      <div
                        key={`${card.channel_id}#${star}`}
                        onClick={() => handleSetRepresentative(card.channel_id, star)}
                        className={`relative cursor-pointer flex flex-col items-center rounded-xl border p-2 transition ${selected ? 'border-amber-500 ring-2 ring-amber-500/30' : 'border-border/60 hover:bg-secondary/50'}`}
                      >
                        <img src={cardImage(s, star)} alt={s.name} className="h-12 w-12 rounded-full object-cover border border-border/80" />
                        <span className="mt-1.5 text-[10px] font-bold truncate max-w-full">{s.name}</span>
                        <span className="text-[9px] font-black text-amber-500">{star}★</span>
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

        {/* 크롭 모달 — 파일 선택 직후 첫 번째로 표시 */}
        {cropModalOpen && originalImageSrc && (
          <ImageCropModal
            imageSrc={originalImageSrc}
            star={uploadStar}
            onConfirm={handleCropConfirm}
            onCancel={handleCropCancel}
          />
        )}

        {/* 업로드 동의 모달 — 크롭 완료 후 두 번째로 표시 */}
        {uploadModalOpen && previewBlob && (
          <div className="modal-backdrop z-[80] bg-black/60 backdrop-blur-sm">
            <div className="modal-panel modal-panel-md modal-panel-scroll rounded-2xl border border-border bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-200 sm:p-6">
              <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <h3 className="text-base font-bold flex items-center gap-2"><Camera className="h-4.5 w-4.5 text-primary" /> {uploadStar === 0 ? '0성' : `${uploadStar}성`} 카드 이미지 업로드</h3>
                <button onClick={() => { setUploadModalOpen(false); setPreviewBlob(null); setCroppedBlob(null); setImageDisclaimerChecked(false); }} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
              </div>
              <div className="mt-4 space-y-4 flex flex-col items-center">
                {/* 크롭된 결과 미리보기 (5:8 비율 카드 형태) */}
                <div className="relative flex h-60 w-[37.5px] flex-col justify-between overflow-hidden rounded-xl border border-border bg-secondary shadow-md" style={{ width: '150px', height: '240px' }}>
                  <div className="absolute inset-0 z-0">
                    <img src={previewBlob} alt="크롭된 카드 미리보기" className="h-full w-full object-cover opacity-90" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/35 z-10"></div>
                  </div>
                  <div className="relative z-20 flex justify-between p-2">
                    <span className="rounded bg-primary px-1.5 py-0.5 text-[8px] font-bold text-primary-foreground">LIVE</span>
                  </div>
                  <div className="relative z-20 space-y-0.5 text-white p-2">
                    <div className="flex gap-0.5">{uploadStar > 0 && Array.from({ length: uploadStar }, (_, i) => <span key={i} className="text-amber-300 text-[10px] leading-none">★</span>)}</div>
                    <h4 className="text-xs font-bold truncate drop-shadow">{user.username}</h4>
                    <p className="text-[8px] text-zinc-300">{uploadStar === 0 ? '0성 카드' : `${uploadStar}성 카드`}</p>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">위 이미지가 카드에 적용됩니다. 다시 편집하려면 취소 후 재업로드 하세요.</p>
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
                <button onClick={() => { setUploadModalOpen(false); setPreviewBlob(null); setCroppedBlob(null); setImageDisclaimerChecked(false); }} className="rounded-lg px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground hover:bg-secondary/80">취소</button>
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
      <section ref={couponSectionRef} className="rounded-3xl border border-border bg-card p-6 shadow-sm space-y-4">
        <h3 className="text-base font-bold flex items-center gap-2"><Tag className="h-4.5 w-4.5 text-primary" /> 리딤 쿠폰 등록</h3>
        <p className="text-xs text-muted-foreground">발급된 쿠폰 코드를 입력하시면 포인트가 즉시 지급됩니다.</p>
        <div className="flex gap-2">
          <input ref={couponInputRef} type="text" placeholder="쿠폰 키 입력 (예: WELCOME2026)" value={couponCode}
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

      {/* 개발자 SNS & 개인정보 처리방침 버튼 영역 */}
      <div className="pt-1 flex justify-end gap-2">
        <button
          onClick={() => setPrivacyModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-[11px] font-bold text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <span>🛡️</span>
          개인정보 처리방침
        </button>
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

      {/* 개인정보 처리방침 모달 */}
      {privacyModalOpen && (
        <div className="modal-backdrop z-[80] bg-black/60 backdrop-blur-sm">
          <div className="modal-panel modal-panel-md modal-panel-scroll rounded-2xl border border-border bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-200 sm:p-6 max-w-lg w-full">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h3 className="text-base font-bold flex items-center gap-2">🛡️ 개인정보 처리방침</h3>
              <button 
                onClick={() => setPrivacyModalOpen(false)} 
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 overflow-y-auto max-h-[60vh] pr-1">
              <MarkdownRenderer content={PRIVACY_POLICY_CONTENT} />
            </div>
            <div className="mt-6 flex justify-end border-t border-border/60 pt-4">
              <button
                onClick={() => setPrivacyModalOpen(false)}
                className="rounded-lg bg-primary px-5 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 shadow-md shadow-primary/10"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const PRIVACY_POLICY_CONTENT = `
# 개인정보 처리방침

본 서비스(이하 "서비스")는 이용자의 개인정보를 중요시하며, "개인정보 보호법" 등 대한민국의 개인정보 보호 법령을 준수합니다. 본 방침은 서비스를 이용하는 모든 이용자에게 적용됩니다.

## 1. 개인정보의 수집 및 이용 목적
서비스는 네이버 치지직 간편 로그인 연동 기능을 통하여 원활한 게임 환경을 제공하기 위해 필요한 최소한의 개인정보를 수집 및 이용합니다.
* **이용자 식별 및 로그인 연동**: 치지직 닉네임, 프로필 이미지, 고유 채널 ID를 통한 본인 인증 및 로그인 세션 유지
* **게임 콘텐츠 서비스 제공**: 게임 내 획득 포인트 관리, 보유 카드 목록, 가챠(뽑기) 결과 저장, 카드 거래(트레이드) 이력 관리 및 유저 간 교환 성사 판정
* **서비스 안전성 및 부정 이용 방지**: 불량 이용자 차단(Block), 악의적 트래픽 모니터링, 어뷰징 거래 제어

## 2. 수집하는 개인정보 항목
서비스가 수집 및 저장하는 개인정보 항목은 다음과 같습니다.
* **네이버 치지직 연동 필수 항목**: 채널 ID, 닉네임, 프로필 이미지 URL
* **게임 플레이 관련 정보**: 포인트 현황, 카드 보유 내역, 카드 교환 제안 및 거래 승인/거절 로그, 유저 차단 목록

## 3. 개인정보의 보유 및 이용 기간
이용자의 개인정보 및 게임 데이터는 서비스 이용 기간 동안 원칙적으로 안전하게 보관됩니다.
* **이용 유지 기간**: 원활한 카드 마켓 운영 및 거래 무결성 확인을 위해 이용자가 명시적으로 탈퇴(데이터 삭제)를 요구하지 않는 한, 로그아웃 혹은 세션 종료 이후에도 데이터베이스에 유지됩니다.
* **즉시 파기**: 이용자가 개발자 채널을 통해 본인 확인 및 연동 데이터의 삭제(회원 탈퇴)를 명시적으로 요청하는 경우, 수집된 모든 관련 개인정보를 지체 없이 영구 파기합니다.

## 4. 개인정보의 제3자 제공
서비스는 이용자의 개인정보를 제3자에게 제공하지 않습니다. 다만, 법령의 규정에 의거하거나 수사 목적으로 법령에 정해진 절차와 방법에 따라 수사기관의 요구가 있는 경우 등 예외적인 상황에 한하여 제공할 수 있습니다.

## 5. 개인정보의 처리 위탁 및 국외 이전
서비스는 안전한 서버 인프라 호스팅 및 원활한 데이터 관리를 위해 다음과 같이 개인정보 처리를 위탁하고 있으며, 시스템 호스팅의 구조상 국외 이전이 수반됩니다.

**[클라우드 인프라 제공]**
* **위탁 대상자 (수탁자)**: Oracle America, Inc. (Oracle Cloud Infrastructure)
* **위탁 업무 내용**: 어플리케이션 호스팅 서버 운영 및 백엔드 인프라 제공
* **이전되는 개인정보 항목**: 치지직 연동 정보(채널 ID, 닉네임, 프로필 이미지 URL) 및 게임 내 서비스 이용 데이터 일체
* **이전 국가**: 서버 리전 소재 국가
* **개인정보 보유 및 이용 기간**: 위탁 계약 종료 시 또는 이용자의 서비스 탈퇴 시까지

**[데이터베이스 데이터 보관 및 관리]**
* **위탁 대상자 (수탁자)**: Supabase, Inc.
* **위탁 업무 내용**: 클라우드 데이터베이스(PostgreSQL) 호스팅 및 회원/게임 데이터 보관
* **이전되는 개인정보 항목**: 치지직 연동 정보(채널 ID, 닉네임, 프로필 이미지 URL) 및 게임 내 서비스 이용 데이터 일체
* **이전 국가**: 서버 리전 소재 국가
* **개인정보 보유 및 이용 기간**: 위탁 계약 종료 시 또는 이용자의 서비스 탈퇴 시까지

## 6. 개인정보의 파기절차 및 파기방법
* **파기절차**: 수집 목적이 달성되었거나 이용자의 파기 요청이 접수된 경우, 내부 방침 및 법령에 따라 지체 없이 파기 절차를 밟습니다.
* **파기방법**: 전자적 파일 형태로 저장된 개인정보는 기록을 재생할 수 없는 기술적 방법(데이터베이스 레코드 영구 삭제)을 사용하여 파기합니다.

## 7. 개인정보의 기술적·관리적 보호대책
서비스는 이용자의 개인정보를 취급함에 있어 분실, 도난, 유출, 변조 또는 훼손되지 않도록 안전성 확보를 위해 다음과 같은 기술적·관리적 대책을 강구하고 있습니다.
* **전송 구간 암호화**: 모든 통신 및 데이터 전송은 SSL/TLS 보안 프로토콜을 통하여 암호화되어 전송됩니다.
* **접근 통제**: 데이터베이스 및 백엔드 서버 인프라에 대한 접근은 인가된 관리자 계정으로만 제한되며, 접근 통제 보안 시스템을 통해 엄격하게 보호됩니다.
* **네트워크 보안**: 비정상적인 트래픽 및 해킹 시도를 탐지 및 차단하기 위한 보안 모니터링을 상시 운영합니다.

## 8. 이용자의 권리 및 그 행사방법
이용자는 언제든지 본인의 개인정보 조회, 수정, 혹은 삭제(탈퇴)를 요청할 권리가 있습니다.
* 권리 행사는 개발자 SNS(𝕏 DM)를 통해 본인 확인 증명(네이버 치지직 로그인 상태 등) 후 요청하실 수 있으며, 접수 즉시 지체 없이 처리해 드립니다.

## 9. 개인정보 처리방침의 변경
본 개인정보 처리방침은 서비스 기능의 추가, 법령 및 보안 기술의 변경에 따라 개정될 수 있습니다.
* **변경 고지**: 처리방침이 변경되는 경우 서비스 내 공지사항을 통하여 시행 최소 7일 전부터 사전 고지합니다.
* **이전 방침 확인**: 이용자는 시행일자를 기준으로 이전의 처리방침 이력 및 변경 사항을 공지사항 탭 등에서 상시 대조할 수 있습니다.

## 10. 개인정보 보호 책임자 및 문의처
* **담당자**: 유아루
* **문의 채널 (𝕏)**: @Chzzk_YuAru (https://x.com/Chzzk_YuAru)
* **시행일자**: 2026년 6월 7일
`;
