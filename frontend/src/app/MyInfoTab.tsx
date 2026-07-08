'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
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
  Crown,
  AlertTriangle,
  Trash2,
  Sparkles,
  Send,
  RefreshCw,
  History
} from 'lucide-react';
import { API_BASE_URL, apiFetch } from '@/lib/api';
import type { AssetEventAssetType, AssetEventListResponse, AssetEventLogEntry } from '@/lib/types';
import { formatLocalDateTime } from '@/lib/time';
import { subscribeToPush, isPushSupported } from '@/lib/push';
import { ProfileModal } from './ProfileModal';
import { cardImage } from '@/lib/cosmetics';
import { UserTitleBadge, UserTitleList } from './UserTitleBadge';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ImageCropModal } from './ImageCropModal';
import {
  LEGACY_PENDING_COUPON_STORAGE_KEY,
  normalizeCouponDeepLinkCode,
  PENDING_COUPON_STORAGE_KEY
} from '@/lib/couponDeepLink';
import { startChikapoTutorial } from './TutorialGuide';

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

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type ClaimedCouponReward = {
  type: 'point' | 'card' | 'cosmetic' | 'minigame_ticket' | 'free_draw_ticket' | 'title';
  points?: number;
  channel_id?: string | null;
  item_id?: number | null;
  title_id?: number | null;
  quantity?: number;
  label?: string;
};

export const MyInfoTab: React.FC = () => {
  const { user, setUser, logout, updatePoints, refreshUserData, toast } = useApp();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pwaAutoTriggeredRef = useRef(false);
  const [myInfoView, setMyInfoView] = useState<'profile' | 'records'>(
    searchParams.get('tab') === 'records' ? 'records' : 'profile'
  );

  // 쿠폰 사용 입력 상태
  const [couponCode, setCouponCode] = useState('');
  const [lastCouponClaim, setLastCouponClaim] = useState<{ message: string; rewards: ClaimedCouponReward[] } | null>(null);
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

  // 내 자산 변동 기록
  const [assetEvents, setAssetEvents] = useState<AssetEventLogEntry[]>([]);
  const [assetEventsNextBeforeId, setAssetEventsNextBeforeId] = useState<number | null>(null);
  const [assetEventsLoading, setAssetEventsLoading] = useState(false);
  const [assetEventType, setAssetEventType] = useState<AssetEventAssetType | 'ALL'>('ALL');

  // 스트리머 프로필 커스텀 이미지 업로드 상태 (지연 업로드)
  const [previewBlob, setPreviewBlob] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [imageDisclaimerChecked, setImageDisclaimerChecked] = useState(false);
  const [uploadStar, setUploadStar] = useState(0); // 업로드 대상 별(0~5성) 슬롯
  const [privacyModalOpen, setPrivacyModalOpen] = useState(false);
  const [titleSaving, setTitleSaving] = useState(false);
  const [titleRefreshing, setTitleRefreshing] = useState(false);
  const [statusMessage, setStatusMessage] = useState(user?.statusMessage || '');
  const [statusSaving, setStatusSaving] = useState(false);
  const [deleteRequesting, setDeleteRequesting] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawText, setWithdrawText] = useState('');
  const [withdrawUserId, setWithdrawUserId] = useState('');
  const [withdrawIrreversible, setWithdrawIrreversible] = useState(false);
  const [withdrawInteractionRestrictionAccepted, setWithdrawInteractionRestrictionAccepted] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

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
      setStatusMessage(user.statusMessage || '');
    }
  }, [user]);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setDeferredInstallPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  useEffect(() => {
    const currentUrl = new URL(window.location.href);
    const queryCoupon = normalizeCouponDeepLinkCode(currentUrl.searchParams.get('coupon'));
    const storedCoupon = normalizeCouponDeepLinkCode(
      localStorage.getItem(PENDING_COUPON_STORAGE_KEY)
      || localStorage.getItem(LEGACY_PENDING_COUPON_STORAGE_KEY)
    );
    const incomingCoupon = queryCoupon || storedCoupon;

    if (!incomingCoupon) return;

    pendingCouponRef.current = incomingCoupon;
    setCouponCode(incomingCoupon);
    localStorage.setItem(PENDING_COUPON_STORAGE_KEY, incomingCoupon);
    localStorage.removeItem(LEGACY_PENDING_COUPON_STORAGE_KEY);

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
      localStorage.removeItem(PENDING_COUPON_STORAGE_KEY);
      localStorage.removeItem(LEGACY_PENDING_COUPON_STORAGE_KEY);
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

  const handleMyInfoViewChange = (view: 'profile' | 'records') => {
    setMyInfoView(view);
    const params = new URLSearchParams(window.location.search);
    if (view === 'records') params.set('tab', 'records');
    else params.delete('tab');
    const query = params.toString();
    router.push(query ? `/my-info?${query}` : '/my-info');
  };

  const fetchMyAssetEvents = async (reset = true) => {
    if (!reset && !assetEventsNextBeforeId) return;
    try {
      setAssetEventsLoading(true);
      const params = new URLSearchParams({ limit: '50' });
      if (!reset && assetEventsNextBeforeId) params.set('before_id', String(assetEventsNextBeforeId));
      if (assetEventType !== 'ALL') params.set('asset_type', assetEventType);
      const res = await apiFetch(`/users/me/asset-events?${params.toString()}`);
      if (!res.ok) {
        toast('기록을 불러오지 못했습니다.', 'error');
        return;
      }
      const data = await res.json() as AssetEventListResponse;
      setAssetEvents((prev) => reset ? (data.entries || []) : [...prev, ...(data.entries || [])]);
      setAssetEventsNextBeforeId(data.next_before_id || null);
    } catch {
      toast('서버와의 통신 오류가 발생했습니다.', 'error');
    } finally {
      setAssetEventsLoading(false);
    }
  };

  useEffect(() => {
    const tab = searchParams.get('tab');
    setMyInfoView(tab === 'records' ? 'records' : 'profile');
  }, [searchParams]);

  useEffect(() => {
    if (!user || myInfoView !== 'records') return;
    fetchMyAssetEvents(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, myInfoView, assetEventType]);

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

  const handleRefreshTitles = async () => {
    setTitleRefreshing(true);
    try {
      const res = await apiFetch('/titles/subscriptions/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast(data.message || '칭호 목록을 새로고침하지 못했습니다.', 'error');
        return;
      }
      setUser((prev) => prev ? {
        ...prev,
        titles: data.titles || [],
        ownedTitles: data.owned_titles || data.titles || []
      } : prev);
      toast('구독 상태와 보유 칭호를 새로 확인했습니다.', 'success');
    } catch {
      toast('서버와의 통신 오류가 발생했습니다.', 'error');
    } finally {
      setTitleRefreshing(false);
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

  const handleSaveStatusMessage = async () => {
    setStatusSaving(true);
    try {
      const res = await apiFetch('/users/me/status-message', {
        method: 'PUT',
        body: JSON.stringify({ status_message: statusMessage })
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.message || '상태 메시지 저장에 실패했습니다.', 'error');
        return;
      }
      await refreshUserData(false);
      toast(data.message || '상태 메시지를 저장했습니다.', 'success');
    } catch {
      toast('서버와의 통신 오류가 발생했습니다.', 'error');
    } finally {
      setStatusSaving(false);
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
        <div className="cute-surface max-w-md rounded-[2rem] p-8">
          <User className="mx-auto h-12 w-12 text-primary animate-pulse mb-4" />
          <h2 className="cute-outline-soft text-2xl font-black text-foreground">로그인이 필요한 기능입니다</h2>
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            나의 프로필 정보 조회, 대표 카드 설정, 스트리머 카드 이미지 커스텀 관리, 쿠폰 리딤을 이용하시려면 치지직 간편 로그인을 진행해 주세요.
          </p>
          <button
            onClick={handleLogin}
            className="cute-wiggle-hover mt-6 w-full rounded-2xl bg-primary py-3 text-xs font-black text-primary-foreground transition"
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

  const couponRewardText = (reward: ClaimedCouponReward) => {
    if (reward.type === 'point') return `${(reward.points || 0).toLocaleString()}P`;
    if (reward.type === 'card') return `${reward.label || reward.channel_id || '스트리머'} 카드 ×${(reward.quantity || 0).toLocaleString()}`;
    if (reward.type === 'cosmetic') return `${reward.label || `아이템#${reward.item_id}`} ×${(reward.quantity || 0).toLocaleString()}`;
    if (reward.type === 'title') return `${reward.label || `칭호#${reward.title_id}`} 칭호`;
    if (reward.type === 'minigame_ticket') return `추가 미니게임 티켓 ×${(reward.quantity || 0).toLocaleString()}`;
    return `추가 무료 소환 티켓 ×${(reward.quantity || 0).toLocaleString()}`;
  };

  const assetTypeLabel: Record<AssetEventAssetType | 'ALL', string> = {
    ALL: '전체',
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
    if (event.asset_type === 'ticket') {
      return `티켓 x${Number(event.quantity || 1).toLocaleString()}`;
    }
    return event.description || event.reason;
  };

  const assetEventRelationLabel = (event: AssetEventLogEntry) => {
    if (event.from_user_id || event.to_user_id) {
      const from = event.from_user_id === user.id ? '나' : (event.from_username || event.from_user_id || '출발 없음');
      const to = event.to_user_id === user.id ? '나' : (event.to_username || event.to_user_id || '도착 없음');
      return `${from} -> ${to}`;
    }
    if (event.counterparty_user_id) {
      return `상대: ${event.counterparty_user_id === user.id ? '나' : (event.counterparty_username || event.counterparty_user_id)}`;
    }
    return null;
  };

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
        const rewards = Array.isArray(data.rewards) ? data.rewards as ClaimedCouponReward[] : [];
        if (data.points_added) updatePoints(Number(data.points_added));
        if (rewards.some((reward) => reward.type === 'card') || data.reward_type === 'card') fetchInventory();
        if (rewards.some((reward) => reward.type === 'title') || data.reward_type === 'title') refreshUserData().catch(() => undefined);
        setLastCouponClaim({ message: data.message || '쿠폰 보상이 지급되었습니다.', rewards });
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
    const installPrompt = deferredInstallPrompt;
    if (installPrompt) {
      setDeferredInstallPrompt(null);
      installPrompt.prompt().catch(() => { /* 설치 프롬프트 실패는 푸시 구독을 막지 않습니다. */ });
    }
    const result = await subscribeToPush();
    toast(result.ok
      ? (installPrompt ? '푸시 알림 구독을 완료했고 앱 설치도 함께 요청했습니다.' : '실시간 푸시 알림 구독이 완료되었습니다!')
      : result.message);
  };

  // 본인에게 테스트 푸시를 보내 구독이 정상 등록됐는지 확인
  const handleTestPush = async () => {
    try {
      let res = await apiFetch('/push/test', { method: 'POST' });
      if (res.status === 400) {
        const data = await res.clone().json().catch(() => ({}));
        if (data?.error === 'NoSubscription' && isPushSupported() && Notification.permission === 'granted') {
          const subscribeResult = await subscribeToPush();
          if (subscribeResult.ok) {
            res = await apiFetch('/push/test', { method: 'POST' });
          } else {
            toast(subscribeResult.message);
            return;
          }
        }
      }
      const data = await res.json().catch(() => ({}));
      toast(data.message || (res.ok ? '테스트 푸시를 전송했습니다.' : '테스트 전송에 실패했습니다.'));
    } catch {
      toast('서버와의 통신 오류가 발생했습니다.');
    }
  };

  // 주소에 ?pwasub 가 있으면 접속 시 자동으로 알림 받기 + 앱 설치를 실행하고 파라미터를 정리합니다.
  useEffect(() => {
    if (pwaAutoTriggeredRef.current) return;
    if (searchParams.get('pwasub') === null) return;
    pwaAutoTriggeredRef.current = true;
    handleEnablePush();
    router.replace('/my-info');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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

  const handleRequestOwnCardDeletion = async () => {
    if (!user || deleteRequesting) return;
    if (!window.confirm('본인 스트리머 카드 삭제 요청을 관리자에게 접수할까요? 접수 후 관리자가 확인하고 조치합니다.')) return;

    setDeleteRequesting(true);
    try {
      const res = await apiFetch(`/cards/${user.id}/report`, {
        method: 'POST',
        body: JSON.stringify({
          star: 0,
          reason: '[본인 카드 삭제 요청] 스트리머 본인이 카드 및 관련 이미지 삭제를 요청했습니다.'
        })
      });
      const data = await res.json();
      if (res.ok) {
        toast('본인 카드 삭제 요청이 관리자에게 접수되었습니다.', 'success');
      } else {
        toast(data.message || '삭제 요청 접수에 실패했습니다.', res.status === 409 ? 'warning' : 'error');
      }
    } catch {
      toast('서버와의 통신 오류가 발생했습니다.', 'error');
    } finally {
      setDeleteRequesting(false);
    }
  };

  const canWithdraw =
    withdrawText === '회원 탈퇴'
    && withdrawUserId === user.id
    && withdrawIrreversible
    && withdrawInteractionRestrictionAccepted;

  const handleWithdrawAccount = async () => {
    if (!canWithdraw || withdrawing) return;
    setWithdrawing(true);
    try {
      const res = await apiFetch('/users/me', {
        method: 'DELETE',
        body: JSON.stringify({
          confirmationText: withdrawText,
          userIdConfirm: withdrawUserId,
          irreversible: withdrawIrreversible,
          interactionRestrictionAccepted: withdrawInteractionRestrictionAccepted
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast(data.message || '회원 탈퇴가 완료되었습니다.', 'success');
        logout();
      } else {
        toast(data.message || '회원 탈퇴 처리에 실패했습니다.', 'error');
      }
    } catch {
      toast('서버와의 통신 오류가 발생했습니다.', 'error');
    } finally {
      setWithdrawing(false);
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
      <div className="flex rounded-2xl bg-secondary/45 p-1">
        {[
          { id: 'profile' as const, label: '프로필', icon: User },
          { id: 'records' as const, label: '기록', icon: History }
        ].map((tab) => {
          const Icon = tab.icon;
          const active = myInfoView === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleMyInfoViewChange(tab.id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black transition ${active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {myInfoView === 'records' && (
        <section className="cute-surface rounded-[2rem] p-6 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-black flex items-center gap-2">
                <History className="h-4.5 w-4.5 text-primary" /> 내 자산 기록
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                내 계정이 직접 관련된 카드, 포인트, 코스메틱, 티켓 변동만 표시됩니다.
              </p>
            </div>
            <button
              type="button"
              onClick={() => fetchMyAssetEvents(true)}
              className="cute-wiggle-hover inline-flex items-center justify-center gap-1.5 rounded-2xl bg-secondary px-4 py-2 text-xs font-black text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${assetEventsLoading ? 'animate-spin' : ''}`} />
              새로고침
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {Object.entries(assetTypeLabel).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setAssetEventType(value as AssetEventAssetType | 'ALL')}
                className={`rounded-full px-3 py-1.5 text-[11px] font-black transition ${assetEventType === value ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {assetEventsLoading && assetEvents.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">기록을 불러오는 중입니다.</div>
            ) : assetEvents.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">표시할 기록이 없습니다.</div>
            ) : (
              assetEvents.map((event) => {
                const relation = assetEventRelationLabel(event);
                return (
                  <article key={event.id} className="rounded-2xl border border-border bg-card/75 p-4 shadow-sm">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-black text-primary">
                            {assetTypeLabel[event.asset_type] || event.asset_type} · {assetActionLabel[event.action] || event.action}
                          </span>
                          <span className="text-[10px] text-muted-foreground">{event.created_at ? formatLocalDateTime(event.created_at) : '시간 없음'}</span>
                        </div>
                        <p className="mt-2 text-sm font-black text-foreground">{assetEventSubject(event)}</p>
                        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                          {relation && <span>{relation}</span>}
                          {event.source_id && <span>출처 ID: {event.source_id}</span>}
                          {event.balance_after != null && <span>잔액: {event.balance_after.toLocaleString()}P</span>}
                        </div>
                        {(event.description || event.reason) && (
                          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{event.description || event.reason}</p>
                        )}
                      </div>
                      <div className="shrink-0 text-left text-[10px] text-muted-foreground sm:text-right">
                        {event.card_id && <p>card #{event.card_id}</p>}
                        {event.item_id && <p>item #{event.item_id}</p>}
                        {event.channel_id && <p className="max-w-[180px] truncate">{event.channel_id}</p>}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          {assetEventsNextBeforeId && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => fetchMyAssetEvents(false)}
                disabled={assetEventsLoading}
                className="rounded-2xl border border-border px-5 py-2 text-xs font-black text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                더 보기
              </button>
            </div>
          )}
        </section>
      )}

      {myInfoView === 'profile' && (
        <>

      {/* 프로필 + 대표 카드 */}
      <section data-tour="my-info-profile" className="cute-surface rounded-[2rem] p-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="flex items-center gap-4 flex-1">
            <img src={user.avatarUrl} alt="Avatar" className="h-16 w-16 rounded-full border border-primary/20 bg-secondary object-cover" />
            <div>
              <h2 className="text-xl font-bold flex flex-wrap items-center gap-2">
                {user.username}
                <span className="cute-pill rounded-full px-2 py-0.5 text-[10px] font-black">{user.role}</span>
                <UserTitleList titles={user.titles} />
              </h2>
              <p className="text-xs text-muted-foreground mt-1">계정 고유 식별코드: {user.id}</p>
              <p className="cute-number-font mt-1 text-xs font-black text-primary">{user.point.toLocaleString()} P 보유</p>
            </div>
          </div>

          {/* 대표 카드 */}
          <div className="flex items-center gap-3">
            {representativeCard?.streamer ? (
              <div className="relative h-24 w-16 overflow-hidden rounded-2xl border-2 border-primary/55 shadow">
                <img
                  src={cardImage(representativeCard.streamer, representativeCard.star || 0)}
                  alt={representativeCard.streamer.name}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-sky-950/70 px-1 py-0.5">
                  <p className="text-[8px] font-bold text-white truncate">{representativeCard.streamer.name}</p>
                </div>
                <span className="absolute right-0.5 top-0.5 rounded-full bg-white/82 px-1 text-[8px] font-black text-primary dark:bg-sky-950/70">
                  {representativeCard.star || 0}★
                </span>
              </div>
            ) : (
              <div className="flex h-24 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-border px-1 text-center text-[9px] text-muted-foreground">
                대표 카드<br />미설정
              </div>
            )}
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setRepModalOpen(true)}
                className="cute-wiggle-hover rounded-2xl bg-secondary px-3 py-2 text-[11px] font-black text-foreground hover:bg-secondary/80"
              >
                대표 카드 설정
              </button>
              <button
                onClick={() => setProfileModalOpen(true)}
                className="cute-wiggle-hover flex items-center justify-center gap-1 rounded-2xl bg-primary px-3 py-2 text-[11px] font-black text-primary-foreground"
              >
                <Share2 className="h-3 w-3" /> 프로필 공유
              </button>
            </div>
          </div>
        </div>
      </section>

      <section data-tour="my-info-status" className="cute-surface rounded-[2rem] p-6 space-y-3">
        <h3 className="text-base font-bold flex items-center gap-2"><User className="h-4.5 w-4.5 text-primary" /> 프로필 상태 메시지</h3>
        <p className="text-xs text-muted-foreground">랭킹과 프로필 공유 화면에 표시될 짧은 소개 문구입니다. 최대 80자까지 입력할 수 있습니다.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={statusMessage}
            maxLength={80}
            onChange={(event) => setStatusMessage(event.target.value)}
            placeholder="예: 유아루 카드 수집 중!"
            className="flex-1 rounded-2xl border border-border bg-secondary/50 px-3 py-2 text-xs font-bold focus:border-primary focus:outline-none"
          />
          <button
            type="button"
            disabled={statusSaving}
            onClick={handleSaveStatusMessage}
            className="cute-wiggle-hover rounded-2xl bg-primary px-5 py-2 text-xs font-black text-primary-foreground disabled:opacity-50"
          >
            {statusSaving ? '저장 중...' : '저장'}
          </button>
        </div>
        <p className="text-right text-[10px] font-bold text-muted-foreground">{statusMessage.length}/80</p>
      </section>

      {/* 보유 칭호 및 대표 칭호 장착 */}
      <section data-tour="my-info-titles" className="cute-surface rounded-[2rem] p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-black">
              <Crown className="h-4 w-4 text-primary" /> 보유 칭호
            </h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              장착한 칭호 1개가 프로필, 내 정보와 메인 사이드바에 표시됩니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              disabled={titleRefreshing || titleSaving}
              onClick={handleRefreshTitles}
              className="cute-wiggle-hover inline-flex items-center gap-1.5 rounded-2xl border border-primary/20 bg-primary/8 px-3 py-2 text-[10px] font-black text-primary shadow-sm transition hover:border-primary/35 hover:bg-primary/12 disabled:cursor-wait disabled:opacity-60 dark:border-primary/25 dark:bg-primary/12"
              title="구독 상태와 보유 칭호를 새로 확인합니다"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${titleRefreshing ? 'animate-spin' : ''}`} />
              <span>{titleRefreshing ? '확인 중...' : '새로고침'}</span>
            </button>
            {user.titles.length > 0 && (
            <button
              disabled={titleSaving || titleRefreshing}
              onClick={() => handleEquipTitle(null)}
              className="cute-wiggle-hover rounded-2xl bg-secondary px-3 py-2 text-[10px] font-black text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              장착 해제
            </button>
            )}
          </div>
        </div>

        {user.ownedTitles.length === 0 ? (
          <div className="mt-4 rounded-[1.75rem] border border-dashed border-border bg-secondary/25 px-4 py-8 text-center">
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
                  className={`cute-card-pop relative flex min-h-24 flex-col justify-between rounded-2xl border p-4 ${equipped
                      ? 'border-primary/55 bg-primary/8 shadow-[0_0_20px_rgba(22,136,240,0.14)]'
                      : 'border-border bg-secondary/25 hover:border-primary/40'
                    }`}
                >
                  {equipped && (
                    <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-primary/12 px-2 py-1 text-[9px] font-black text-primary">
                      <Check className="h-2.5 w-2.5" /> 장착 중
                    </span>
                  )}
                  <div className="flex min-h-8 items-center pr-16">
                    <UserTitleBadge title={title} />
                  </div>
                  <button
                    disabled={titleSaving || titleRefreshing || equipped}
                    onClick={() => handleEquipTitle(title.id)}
                    className={`cute-wiggle-hover mt-4 w-full rounded-2xl py-2 text-[10px] font-black transition disabled:cursor-default ${equipped
                        ? 'bg-primary/10 text-primary'
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
                        className={`cute-card-pop relative flex cursor-pointer flex-col items-center rounded-2xl border p-2 ${selected ? 'border-primary ring-2 ring-primary/25' : 'border-border/60 hover:bg-secondary/50'}`}
                      >
                        <img src={cardImage(s, star)} alt={s.name} className="h-12 w-12 rounded-full object-cover border border-border/80" />
                        <span className="mt-1.5 text-[10px] font-bold truncate max-w-full">{s.name}</span>
                        <span className="text-[9px] font-black text-primary">{star}★</span>
                        {selected && <Check className="absolute right-1 top-1 h-3.5 w-3.5 text-primary" />}
                      </div>
                    );
                  })}
                </div>
              )}
              {user.representativeCardChannelId && (
                <button
                  onClick={() => handleSetRepresentative(null)}
                  className="mt-4 w-full rounded-2xl bg-secondary py-2 text-xs font-bold text-muted-foreground hover:bg-secondary/80"
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
        <section data-tour="my-info-images" className="cute-surface rounded-[2rem] p-6 space-y-4">
          <h3 className="text-base font-bold flex items-center gap-2">
            <Camera className="h-4.5 w-4.5 text-primary" /> 스트리머 고유 카드 이미지 관리
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            0성부터 5성까지 별 등급별 카드 이미지를 각각 등록할 수 있습니다. (WebP 최대 1280px 자동 변환, 5:8 비율)<br />
            특정 성에 이미지를 등록하지 않으면 <strong className="text-foreground/80">바로 아래 등급의 이미지</strong>가 자동 적용되며, 더 낮은 등급도 없으면 기본 치지직 프로필이 노출됩니다.
          </p>
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-black text-red-500">본인 카드 삭제 요청</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  본인 카드가 서비스에 노출되는 것을 원하지 않으면 관리자에게 삭제 검토를 요청할 수 있습니다.
                </p>
              </div>
              <button
                type="button"
                onClick={handleRequestOwnCardDeletion}
                disabled={deleteRequesting}
                className="shrink-0 rounded-2xl bg-red-500 px-4 py-2 text-[11px] font-black text-white transition hover:bg-red-600 disabled:pointer-events-none disabled:opacity-50"
              >
                {deleteRequesting ? '요청 접수 중...' : '삭제 요청 보내기'}
              </button>
            </div>
          </div>

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
                  className="cute-card-pop group relative flex aspect-[5/8] cursor-pointer flex-col justify-between overflow-hidden rounded-2xl border border-border bg-secondary shadow-sm hover:border-primary"
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
                    <span className="rounded-full bg-sky-950/60 px-1.5 py-0.5 text-[9px] font-black text-white">
                      {st === 0 ? '0성' : '★'.repeat(st)}
                    </span>
                    <div className="flex items-center gap-1">
                      {ownImage ? (
                        <span className="rounded bg-emerald-500/90 px-1 py-0.5 text-[7px] font-black text-white">등록</span>
                      ) : inherited ? (
                        <span className="rounded bg-sky-500/90 px-1 py-0.5 text-[7px] font-black text-white">상속</span>
                      ) : (
                        <span className="rounded-full bg-primary/12 px-1 py-0.5 text-[7px] font-black text-primary">기본</span>
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
      <section data-tour="my-info-coupon" ref={couponSectionRef} className="cute-surface rounded-[2rem] p-6 space-y-4">
        <h3 className="text-base font-bold flex items-center gap-2"><Tag className="h-4.5 w-4.5 text-primary" /> 리딤 쿠폰 등록</h3>
        <p className="text-xs text-muted-foreground">발급된 쿠폰 코드를 입력하시면 설정된 보상이 한 번에 지급됩니다.</p>
        <div className="flex gap-2">
          <input ref={couponInputRef} type="text" lang="ko-KR" inputMode="text" autoCapitalize="none" spellCheck={false} placeholder="쿠폰 키 입력 (예: WELCOME2026)" value={couponCode}
            onChange={(e) => setCouponCode(e.target.value)}
            className="flex-1 rounded-2xl border border-border bg-secondary/50 px-3 py-2 text-xs focus:border-primary focus:outline-none" />
          <button onClick={handleClaimCoupon} className="cute-wiggle-hover rounded-2xl bg-primary px-5 py-2 text-xs font-black text-primary-foreground">등록</button>
        </div>
        {lastCouponClaim && (
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3">
            <p className="text-[11px] font-black text-primary">최근 쿠폰 보상</p>
            {lastCouponClaim.rewards.length > 0 ? (
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {lastCouponClaim.rewards.map((reward, index) => (
                  <div key={`${reward.type}-${index}`} className="rounded-xl bg-card/80 px-3 py-2 text-[11px] font-bold text-foreground shadow-sm">
                    {couponRewardText(reward)}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">{lastCouponClaim.message}</p>
            )}
          </div>
        )}
      </section>

      {/* 알림 & 앱 설치 */}
      <section data-tour="my-info-push" className="cute-surface rounded-[2rem] p-6 space-y-4">
        <h3 className="text-base font-bold flex items-center gap-2"><BellRing className="h-4.5 w-4.5 text-primary" /> 실시간 푸시 알림</h3>
        <p className="text-xs text-muted-foreground">알림을 허용하면 공지·이벤트·카드 삭제 보상·신고 처리 관련 소식을 푸시로 받아볼 수 있습니다. 설치 가능한 환경에서는 앱 설치도 함께 요청합니다.</p>
        <div className="flex flex-wrap gap-2.5">
          <button
            onClick={handleEnablePush}
            className="cute-wiggle-hover inline-flex items-center gap-1.5 rounded-2xl bg-gradient-to-r from-sky-500 to-blue-600 px-5 py-2.5 text-xs font-black text-white shadow-sm shadow-blue-500/25 transition hover:-translate-y-0.5"
          >
            <BellRing className="h-4 w-4" /> 알림 받기 및 앱 설치
          </button>
          <button
            onClick={handleTestPush}
            className="cute-wiggle-hover inline-flex items-center gap-1.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-green-600 px-5 py-2.5 text-xs font-black text-white shadow-sm shadow-emerald-500/25 transition hover:-translate-y-0.5"
          >
            <Send className="h-4 w-4" /> 푸시 알림 테스트
          </button>
        </div>
      </section>

      {/* 튜토리얼 다시 보기 */}
      <section data-tour="my-info-tutorial" className="cute-surface rounded-[2rem] p-6 space-y-4">
        <h3 className="text-base font-bold flex items-center gap-2"><Sparkles className="h-4.5 w-4.5 text-primary" /> 사이트 튜토리얼</h3>
        <p className="text-xs text-muted-foreground">
          치카포의 메인, 상점, 보관함, 미니게임, 랭킹, 내 정보 기능을 대화형 안내로 다시 둘러볼 수 있습니다.
        </p>
        <button
          type="button"
          onClick={startChikapoTutorial}
          className="cute-wiggle-hover rounded-2xl border border-primary/20 bg-primary/10 px-5 py-2.5 text-xs font-black text-primary transition hover:-translate-y-0.5 hover:bg-primary hover:text-primary-foreground dark:bg-primary/15"
        >
          튜토리얼 다시 보기
        </button>
      </section>

      {/* 유저 차단 관리 */}
      <section data-tour="my-info-blocks" className="cute-surface rounded-[2rem] p-6 space-y-4">
        <h3 className="text-base font-bold flex items-center gap-2"><Ban className="h-4.5 w-4.5 text-rose-500" /> 유저 차단 관리</h3>
        <p className="text-xs text-muted-foreground">차단한 유저는 회원님에게 <strong className="text-foreground/80">교환 제안과 친구 신청을 보낼 수 없습니다.</strong></p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="차단할 유저명 입력"
            value={blockSearch}
            onChange={(e) => setBlockSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleBlock(); }}
            className="flex-1 rounded-2xl border border-border bg-secondary/50 px-3 py-2 text-xs focus:border-primary focus:outline-none"
          />
          <button onClick={handleBlock} disabled={blocking} className="rounded-lg bg-rose-500 px-5 py-2 text-xs font-bold text-white hover:bg-rose-600 disabled:opacity-50">
            {blocking ? '처리 중...' : '차단'}
          </button>
        </div>

        {blockedUsers.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[11px] font-bold text-muted-foreground">차단 목록 ({blockedUsers.length})</p>
            {blockedUsers.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-2 rounded-2xl bg-secondary/35 px-3 py-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <img src={b.avatar_url} alt={b.username} className="h-8 w-8 rounded-full border border-border object-cover" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold truncate">{b.username}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{b.id}</p>
                  </div>
                </div>
                <button onClick={() => handleUnblock(b.id)} className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-[10px] font-bold text-foreground hover:bg-secondary/80">
                  차단 해제
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-3">차단한 유저가 없습니다.</p>
        )}
      </section>

      {/* 회원 탈퇴 */}
      <section data-tour="my-info-privacy" className="cute-surface rounded-[2rem] border border-rose-500/20 bg-rose-500/[0.03] p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h3 className="text-base font-black flex items-center gap-2 text-rose-500">
              <AlertTriangle className="h-4.5 w-4.5" /> 회원 탈퇴
            </h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              회원 탈퇴 시 계정, 보유 카드, 코스메틱, 쿠폰 사용 기록, 차단 정보, 알림, 미니게임 기록 등 일반 서비스 데이터가 삭제됩니다.
              단, 감사·분쟁 대응·상대방 대화 보존에 필요한 기록은 처리방침에 따라 제한적으로 보관될 수 있습니다.
              완료 후에는 복구할 수 없으며, 같은 치지직 계정으로 재가입하더라도 24시간 동안 오픈마켓·교환·보상 수령 등 상호작용이 제한됩니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setWithdrawOpen((v) => !v)}
            className="cute-wiggle-hover shrink-0 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-black text-rose-500 transition hover:bg-rose-500/15"
          >
            {withdrawOpen ? '탈퇴 접기' : '회원 탈퇴 열기'}
          </button>
        </div>

        {withdrawOpen && (
          <div className="space-y-4 rounded-[1.5rem] border border-rose-500/25 bg-card/75 p-4 shadow-sm">
            <div className="rounded-2xl bg-rose-500/10 p-3 text-[11px] leading-relaxed text-rose-600 dark:text-rose-200">
              <p className="font-black">탈퇴 전 확인해 주세요.</p>
              <p className="mt-1">
                판매 중인 매물과 진행 중인 교환 정보도 정리됩니다. 구매 이력에서 회원님을 식별하는 정보는 제거되며,
                탈퇴 직후 같은 세션으로는 서비스를 이용할 수 없습니다. 상대방의 1:1 톡방에는 대화 확인과 분쟁 대응에 필요한 내역이 남을 수 있습니다.
              </p>
              <p className="mt-1 font-black">
                어뷰징 방지를 위해 탈퇴 후 같은 치지직 계정으로 재가입하더라도 24시간 동안 오픈마켓, 교환, 보상 수령 등 유저·경제 상호작용이 제한됩니다.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-[11px] font-black text-muted-foreground">계정 ID 확인</span>
                <input
                  type="text"
                  value={withdrawUserId}
                  onChange={(e) => setWithdrawUserId(e.target.value)}
                  placeholder={user.id}
                  className="w-full rounded-2xl border border-border bg-secondary/50 px-3 py-2 text-xs font-bold focus:border-rose-400 focus:outline-none"
                />
                <span className="block text-[10px] text-muted-foreground">현재 계정 ID를 그대로 입력하세요.</span>
              </label>
              <label className="space-y-1.5">
                <span className="text-[11px] font-black text-muted-foreground">확인 문구</span>
                <input
                  type="text"
                  value={withdrawText}
                  onChange={(e) => setWithdrawText(e.target.value)}
                  placeholder="회원 탈퇴"
                  className="w-full rounded-2xl border border-border bg-secondary/50 px-3 py-2 text-xs font-bold focus:border-rose-400 focus:outline-none"
                />
                <span className="block text-[10px] text-muted-foreground"><b>회원 탈퇴</b>를 정확히 입력하세요.</span>
              </label>
            </div>

            <label className="flex cursor-pointer items-start gap-2 rounded-2xl border border-border/70 bg-secondary/35 p-3">
              <input
                type="checkbox"
                checked={withdrawIrreversible}
                onChange={(e) => setWithdrawIrreversible(e.target.checked)}
                className="mt-0.5 rounded border-border"
              />
              <span className="text-[11px] font-bold leading-relaxed text-foreground/90">
                탈퇴 후 데이터 복구가 불가능하며, 일반 서비스 데이터는 삭제되지만 감사·분쟁 대응·상대방 대화 보존에 필요한 기록은 처리방침에 따라 제한적으로 보관될 수 있음을 이해했습니다.
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-3">
              <input
                type="checkbox"
                checked={withdrawInteractionRestrictionAccepted}
                onChange={(e) => setWithdrawInteractionRestrictionAccepted(e.target.checked)}
                className="mt-0.5 rounded border-border"
              />
              <span className="text-[11px] font-bold leading-relaxed text-rose-600 dark:text-rose-200">
                탈퇴 후 재가입하더라도 24시간 동안 유저·경제 상호작용이 제한되며, 제한 확인과 감사 추적을 위해 탈퇴 계정 ID, 탈퇴 시각, 탈퇴 당시 닉네임·프로필·포인트 스냅샷이 최소한으로 보관되는 것을 이해했습니다.
              </span>
            </label>

            <button
              type="button"
              onClick={handleWithdrawAccount}
              disabled={!canWithdraw || withdrawing}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-500 px-5 py-3 text-xs font-black text-white shadow-md shadow-rose-500/15 transition hover:bg-rose-600 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-45"
            >
              <Trash2 className="h-4 w-4" />
              {withdrawing ? '탈퇴 처리 중...' : '회원 탈퇴 영구 실행'}
            </button>
          </div>
        )}
      </section>

      {/* 로그아웃 */}
      <button onClick={logout} className="w-full rounded-2xl bg-secondary py-3 text-center text-xs font-bold text-muted-foreground hover:bg-secondary/80 transition">
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
        </>
      )}
    </div>
  );
};

const PRIVACY_POLICY_CONTENT = `
# 개인정보 처리방침

본 서비스(이하 "서비스")는 이용자의 개인정보를 중요시하며, "개인정보 보호법" 등 대한민국의 개인정보 보호 법령을 준수합니다. 본 방침은 서비스를 이용하는 모든 이용자에게 적용됩니다.

* **개정 고지일**: 2026년 7월 8일
* **최종 개정일자**: 2026년 7월 8일
* **시행일자**: 2026년 7월 8일

## 개정 이력
* **2026년 7월 8일**: 외부 제품 분석 도구 연동을 제거하고 자체 인사이트 수집·집계 항목, 보관 기준 및 위탁 범위를 반영
* **2026년 6월 18일**: 서비스 이용 통계 및 기능 개선을 위한 인사이트 수집 항목, 처리 목적 및 보유 기준을 반영
* **2026년 6월 11일**: 친구 관계 정보, 1:1 톡 메시지 및 메타데이터, 신고·제재 기록, 포인트·거래 감사 기록, 백업 보관 기준, 운영자 열람 제한 및 보유기간을 처리방침에 명시적으로 반영

## 1. 개인정보의 수집 및 이용 목적
서비스는 네이버 치지직 간편 로그인 연동 기능을 통하여 원활한 게임 환경을 제공하기 위해 필요한 최소한의 개인정보를 수집 및 이용합니다.
* **이용자 식별 및 로그인 연동**: 치지직 닉네임, 프로필 이미지, 고유 채널 ID를 통한 본인 인증, 로그인 세션 유지, 재가입 계정 식별
* **게임 콘텐츠 서비스 제공**: 게임 내 획득 포인트 관리, 보유 카드 목록, 가챠 결과 저장, 카드 거래, 오픈마켓 거래, 경매 입찰 및 정산 이력 관리, 친구 관계 및 1:1 톡 제공
* **커뮤니케이션 기능 제공**: 친구 신청·수락·삭제, 1:1 메시지 송수신, 대화 내역 표시, 읽음 여부 표시, 친구 삭제 후 상대방 대화 내역 확인 제공
* **거래 무결성 및 분쟁 대응**: 포인트 증감 원장, 거래 상대방, 거래·입찰·환불·쿠폰·상점 구매 등 포인트 변동 사유를 보관하여 오류 정정, 분쟁 확인, 계정 탈취 및 포인트 조작 의심 내역 조사에 활용
* **신고·제재 및 부정 이용 방지**: 신고 접수 및 처리 결과 안내, 제재 이력 관리, 불량 이용자 차단, 악의적 트래픽 모니터링, 비정상 요청 제한, 어뷰징 거래 제어, 서비스 안정성 확보
* **서비스 이용 통계 및 기능 개선**: 접속 시간대, 페이지 체류 시간, 기기·브라우저 환경, 주요 기능 이용 흐름을 분석하여 UI/UX 개선, 장애 파악, 기능 우선순위 판단에 활용

채팅 정보는 메시지 송수신, 대화 내역 제공, 신고 처리, 분쟁 대응, 부정 이용 방지 및 서비스 안정성 확보를 위해서만 이용합니다. 채팅 내용을 광고, 추천 알고리즘, AI 학습 목적으로 이용하지 않으며, 서비스 이용 통계 분석 이벤트에도 1:1 톡 메시지 내용, 검색어 원문, 쿠폰 코드, 비밀번호 등 내용 데이터는 포함하지 않습니다.

## 2. 수집하는 개인정보 항목
서비스가 수집 및 저장하는 개인정보 항목은 다음과 같습니다. 일부 항목은 회원가입 시 항상 수집되는 정보가 아니라, 해당 기능 이용 과정에서 생성 또는 수집될 수 있습니다.
* **로그인 연동 필수 항목**: 치지직 채널 ID, 닉네임, 프로필 이미지 URL
* **게임 플레이 관련 정보**: 포인트 현황, 카드 보유 내역, 카드 교환 제안 및 거래 승인·거절 로그, 오픈마켓 등록·구매·판매·경매 입찰·정산·환불 내역, 쿠폰 사용 내역, 상점 구매 내역, 미니게임 보상 내역, 대표 카드, 상태 메시지, 칭호 및 코스메틱 보유·장착 내역
* **친구 관계 정보**: 친구 신청·수락·거절 내역, 친구 목록, 친구 추가·삭제 내역, 차단 목록
* **커뮤니케이션 정보**: 1:1 톡 메시지 내용, 발신자 및 수신자 식별자, 채팅방 ID, 전송 일시, 읽음 여부, 채팅방 닫힘·삭제 상태
* **신고 및 제재 정보**: 신고자 및 신고 대상 식별자, 신고 사유, 신고 내용, 처리 결과, 제재 사유, 제재 기간 및 만료 시각
* **포인트 감사 정보**: 포인트 증감 금액, 증감 후 잔액, 변동 사유, 관련 거래·쿠폰·상점·카드·경매 식별자, 거래 상대방 채널 ID, 처리 시각
* **서비스 이용기록 및 부정 이용 방지 정보**: 접속 요청 기록, IP 주소, 기기·브라우저 정보, 쿠키, 비정상 요청 탐지 및 제한 기록, 소프트밴 등 요청 제한 기록
* **서비스 이용 통계 정보**: 접속 페이지 경로, 페이지 진입·이탈 시각, 체류 시간, 활성 상태 확인 이벤트, 기기 유형(PC/모바일/태블릿), 브라우저, 운영체제, 화면 크기, 언어 및 시간대, 로그인 여부, 내부 이용자 식별자, 역할 정보, 주요 메뉴 이동 및 알림 클릭 등 기능 이용 이벤트, 비식별 처리된 IP 해시
* **탈퇴 후 최소 보관 정보**: 재가입 계정의 상호작용 제한 및 감사 추적을 위한 탈퇴 채널 ID, 탈퇴 시각, 탈퇴 당시 닉네임·프로필 이미지 URL·포인트 스냅샷

## 3. 개인정보의 보유 및 이용 기간
이용자의 개인정보 및 게임 데이터는 서비스 이용 기간 동안 원칙적으로 안전하게 보관되며, 목적 달성 또는 탈퇴 요청 시 아래 기준에 따라 파기하거나 분리 보관합니다.
* **계정 및 프로필 정보**: 회원 탈퇴 시 지체 없이 파기합니다.
* **보유 카드, 코스메틱, 쿠폰, 알림, 푸시 구독, 미니게임 기록 등 일반 서비스 데이터**: 회원 탈퇴 시 지체 없이 파기합니다.
* **친구 관계 정보**: 친구 관계 삭제 또는 회원 탈퇴 시 지체 없이 파기합니다. 다만 친구 신청 처리 내역은 중복 신청 방지, 분쟁 대응 및 부정 이용 방지를 위해 필요한 범위에서 보관될 수 있습니다.
* **1:1 톡 메시지 및 채팅 메타데이터**: 원칙적으로 회원 탈퇴 시 파기합니다. 다만 상대방의 대화 내역 보존, 톡방 닫힘 후 상대방 확인, 신고 처리, 분쟁 대응, 부정 이용 방지를 위해 필요한 경우 내부 기준에 따라 보관될 수 있으며, 상대방이 닫힌 톡방을 삭제하면 해당 이용자의 화면에서는 더 이상 표시되지 않습니다.
* **신고 및 제재 기록**: 신고 처리, 반복 신고·허위 신고 방지, 제재 회피 방지, 분쟁 대응을 위해 조치일 또는 수집일로부터 최대 3년간 보관할 수 있습니다.
* **포인트 감사 원장 및 거래 감사 로그**: 포인트 조작, 계정 탈취, 거래 분쟁, 정산 오류 확인을 위해 생성일로부터 최대 5년간 보관할 수 있습니다.
* **탈퇴 후 최소 보관 정보**: 재가입 계정의 24시간 상호작용 제한, 부정 이용 방지, 거래 무결성 확인, 분쟁 대응을 위해 탈퇴 채널 ID, 탈퇴 시각, 탈퇴 당시 닉네임·프로필 이미지 URL·포인트 스냅샷을 최대 3년간 분리 보관할 수 있습니다.
* **접속 로그 및 비정상 요청 제한 기록**: 보안, 장애 조사, 부정 이용 방지를 위해 생성일로부터 최대 1년간 보관할 수 있습니다.
* **서비스 이용 통계 정보**: 서비스 개선과 장애 분석을 위해 원시 분석 이벤트는 기본 120일간 보관한 뒤 삭제하며, 시간 단위 집계 데이터는 장기 추세 확인을 위해 통계 형태로 보관할 수 있습니다.
* **백업 데이터**: 데이터 복구와 장애 대응을 위해 백업 파일은 기본 7일간 보관하며, 환경 설정에 따라 보관기간이 달라질 수 있습니다. 백업 데이터는 복구·장애 대응 외 목적으로 사용하지 않습니다.
* **법령상 보관**: 관계 법령에 따라 보존할 필요가 있는 경우 해당 법령에서 정한 기간 동안 보관할 수 있습니다.

## 4. 개인정보의 제3자 제공
서비스는 이용자의 개인정보를 제3자에게 제공하지 않습니다. 다만, 법령의 규정에 의거하거나 수사 목적으로 법령에 정해진 절차와 방법에 따라 수사기관의 요구가 있는 경우 등 예외적인 상황에 한하여 제공할 수 있습니다.

## 5. 채팅 내용 및 운영자 열람 제한
서비스는 원칙적으로 회원 간 1:1 톡 내용을 임의로 열람하지 않습니다. 다만 다음의 경우 필요한 범위에서 최소한으로 확인할 수 있습니다.
* 이용자의 신고 접수 및 신고 처리
* 법령상 의무 이행 또는 수사기관의 적법한 요청 대응
* 서비스 장애 조사 및 복구
* 계정 탈취, 포인트 조작, 사기, 어뷰징 등 부정 이용 방지
* 거래·채팅 관련 분쟁 대응

운영자 접근은 필요한 관리자에게 제한되며, 채팅 원문을 광고, 추천, AI 학습 목적으로 사용하지 않습니다.

## 6. 개인정보의 처리 위탁 및 국외 이전
서비스는 안전한 서버 인프라 호스팅 및 원활한 데이터 관리를 위해 다음과 같이 개인정보 처리를 위탁하고 있으며, 시스템 호스팅의 구조상 국외 이전이 수반됩니다.

**[클라우드 인프라 제공]**
* **위탁 대상자 (수탁자)**: Oracle America, Inc. (Oracle Cloud Infrastructure)
* **위탁 업무 내용**: 어플리케이션 호스팅 서버 운영 및 백엔드 인프라 제공
* **이전되는 개인정보 항목**: 치지직 연동 정보(채널 ID, 닉네임, 프로필 이미지 URL) 및 게임 내 서비스 이용 데이터, 친구·채팅·신고·제재·감사 기록
* **이전 국가**: 서버 리전 소재 국가
* **개인정보 보유 및 이용 기간**: 위탁 계약 종료 시, 이용자의 서비스 탈퇴 시 또는 본 방침의 보유기간 만료 시까지

**[데이터베이스 데이터 보관 및 관리]**
* **위탁 대상자 (수탁자)**: Oracle America, Inc. (Oracle Cloud Infrastructure) 및 서비스 운영 환경에 따라 Supabase, Inc.
* **위탁 업무 내용**: 데이터베이스 호스팅 및 회원/게임/거래/감사 데이터 보관
* **이전되는 개인정보 항목**: 치지직 연동 정보(채널 ID, 닉네임, 프로필 이미지 URL) 및 게임 내 서비스 이용 데이터, 친구·채팅·신고·제재·감사 기록
* **이전 국가**: 서버 리전 소재 국가
* **개인정보 보유 및 이용 기간**: 위탁 계약 종료 시, 이용자의 서비스 탈퇴 시 또는 본 방침의 보유기간 만료 시까지

**[프론트엔드 호스팅 및 보안]**
* **위탁 대상자 (수탁자)**: Cloudflare, Inc.
* **위탁 업무 내용**: 프론트엔드 정적 페이지 호스팅, CDN, 보안 보호
* **이전되는 개인정보 항목**: 접속 페이지, 접속 시각, 기기·브라우저 정보, 네트워크 접속 정보 등 웹 서비스 제공 및 보안 보호에 필요한 정보
* **이전 국가**: Cloudflare 인프라 소재 국가
* **개인정보 보유 및 이용 기간**: 위탁 계약 종료 시 또는 Cloudflare 서비스 설정·정책에 따른 보관기간까지

## 7. 개인정보의 파기절차 및 파기방법
* **파기절차**: 수집 목적이 달성되었거나 이용자의 파기 요청이 접수된 경우, 내부 방침 및 법령에 따라 지체 없이 파기 절차를 밟습니다. 단, 거래 무결성, 분쟁 대응, 부정 이용 방지를 위해 별도 보관이 필요한 감사 기록은 일반 계정 정보와 분리하여 제한적으로 보관합니다.
* **파기방법**: 전자적 파일 형태로 저장된 개인정보는 기록을 재생할 수 없는 기술적 방법(데이터베이스 레코드 영구 삭제 또는 복구 불가능한 익명화·분리 보관)을 사용하여 파기합니다.
* **백업 파기**: 백업 파일은 보관기간 만료 후 자동 또는 수동으로 삭제하며, 복구 과정에서 복원된 개인정보도 본 방침의 보유기간 및 파기 기준을 따릅니다.

## 8. 개인정보의 기술적·관리적 보호대책
서비스는 이용자의 개인정보를 취급함에 있어 분실, 도난, 유출, 변조 또는 훼손되지 않도록 안전성 확보를 위해 다음과 같은 기술적·관리적 대책을 강구하고 있습니다.
* **전송 구간 암호화**: 모든 통신 및 데이터 전송은 SSL/TLS 보안 프로토콜을 통하여 암호화되어 전송됩니다.
* **접근 통제**: 데이터베이스 및 백엔드 서버 인프라에 대한 접근은 인가된 관리자 계정으로만 제한되며, 접근 통제 보안 시스템을 통해 엄격하게 보호됩니다.
* **관리자 접근 제한**: 포인트 감사 원장, 거래 감사 로그, 신고·제재 기록, 채팅 관련 정보는 부정 이용 조사, 오류 정정, 분쟁 대응, 신고 처리 등 운영상 필요한 경우에 한해 제한적으로 조회됩니다.
* **DB 및 백업 접근 제한**: 운영 서버 환경 변수, DB 접속 정보, DB 백업 파일에 대한 접근은 운영상 필요한 관리자에게만 제한합니다.
* **네트워크 보안**: 비정상적인 트래픽 및 해킹 시도를 탐지 및 차단하기 위한 보안 모니터링을 상시 운영합니다.
* **분석 데이터 최소화**: 서비스 이용 통계 분석에서는 자동 폼 입력 수집 및 세션 리플레이를 비활성화하고, 채팅 내용·검색어 원문·쿠폰 코드 등 내용 데이터가 전송되지 않도록 제한합니다.

## 9. 이용자의 권리 및 그 행사방법
이용자는 언제든지 본인의 개인정보 조회, 수정, 혹은 삭제(탈퇴)를 요청할 권리가 있습니다.
* 권리 행사는 개발자 SNS(𝕏 DM)를 통해 본인 확인 증명(네이버 치지직 로그인 상태 등) 후 요청하실 수 있으며, 접수 즉시 지체 없이 처리해 드립니다.
* 법령 또는 본 방침에 따라 별도 보관이 필요한 감사·신고·제재·분쟁 대응 기록은 열람·삭제 요청이 제한될 수 있으며, 이 경우 제한 사유를 안내합니다.

## 10. 개인정보 처리방침의 변경
본 개인정보 처리방침은 서비스 기능의 추가, 법령 및 보안 기술의 변경에 따라 개정될 수 있습니다.
* **변경 고지**: 처리방침이 변경되는 경우 서비스 내 공지사항 또는 개인정보 처리방침 화면을 통하여 변경 내용과 시행일자를 공개합니다. 단순한 문구 정비, 법령·보안 기준 반영, 이용자 권리를 침해하지 않는 기능 설명 보완 등 이용자에게 불리하지 않은 변경은 고지한 날부터 시행할 수 있습니다.
* **중요 변경**: 수집 항목 또는 이용 목적의 실질적 확대, 보유기간의 중대한 연장, 제3자 제공·국외 이전의 확대, 이용자 권리 제한 등 이용자에게 불리하거나 민감도가 높은 변경은 합리적인 사전 고지 기간을 두거나 관련 법령에 따른 별도 동의 절차를 검토합니다.
* **이전 방침 확인**: 이용자는 시행일자를 기준으로 이전의 처리방침 이력 및 변경 사항을 공지사항 탭 등에서 상시 대조할 수 있습니다.

## 11. 개인정보 보호 책임자 및 문의처
* **담당자**: 유아루
* **문의 채널 (𝕏)**: @Chzzk_YuAru (https://x.com/Chzzk_YuAru)
* **시행일자**: 2026년 6월 18일
`;
