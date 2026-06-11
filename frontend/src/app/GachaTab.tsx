'use client';

import React, { useState, useEffect } from 'react';
import { useApp } from './AppContext';
import {
  Search,
  HelpCircle,
  Upload,
  UserMinus,
  Check,
  RefreshCw,
  Clock,
  ArrowRightLeft,
  X,
  Layers,
  Store,
  Coins,
  Star,
  EyeOff
} from 'lucide-react';
import { apiFetch, isAuthed } from '@/lib/api';
import { borderStyle, borderClass, nameEffectStyle, cardImage } from '@/lib/cosmetics';
import { FIXED_MARKET_FEE_RATE, calculateMarketFee, getAuctionFeeRate } from '@/lib/marketFee';
import { StreamerDetailModal } from './StreamerDetailModal';
import { fuzzySearch } from '@/lib/search';
import { CosmeticFrame } from './CosmeticFrame';
import { CosmeticName } from './CosmeticName';
import { ReportCardModal } from './ReportCardModal';
import { CometCard } from '@/components/ui/comet-card';
import { formatLocalDate } from '@/lib/time';

interface Streamer {
  channel_id: string;
  name: string;
  logo_url: string;
  custom_image_url: string | null;
  custom_images?: (string | null)[] | null; // 0~5성별 커스텀 카드 이미지
  base_value: number;
  follower_count: number;
  is_active?: boolean;
  serial_number?: number; // 스트리머 카드 고유 시리얼(전 카피 공통, 1~9999)
}

interface CosmeticRef { id: number; style_json?: string | null; font_url?: string | null; font_family?: string | null; }
interface UserCard {
  id: number;
  channel_id: string;
  serial_number: number;
  star?: number;
  border?: CosmeticRef | null;
  name_effect?: CosmeticRef | null;
  is_hidden?: boolean;
  favorite_order?: number | null;
  favorite_at?: string | null;
  acquired_at: string;
  streamer?: Streamer;
}

interface FuseMaterial {
  star: number;
  count: number;
}

interface FuseModalState {
  card: UserCard;
  streamer: Streamer;
  star: number;
}

// 별 등급에 따른 가치 배율 (백엔드 starValueMultiplier와 동일)
const starMult = (star: number) => 1 + (star || 0) * 0.8;
const cardKey = (channelId: string, star: number) => `${channelId}#${star}`;
const parseCardKey = (key: string) => {
  const separator = key.lastIndexOf('#');
  return {
    channelId: key.slice(0, separator),
    star: Number(key.slice(separator + 1)) || 0
  };
};
const FUSE_STARS = [0, 1, 2, 3, 4] as const;
const fuseMaterialGain = (star: number) => star + 1;
const calculateFuseResultStar = (baseStar: number, materials: FuseMaterial[]) =>
  baseStar + materials.reduce((sum, material) => sum + (fuseMaterialGain(material.star) * material.count), 0);

const CONTEXT_MENU_MARGIN = 8;
const CONTEXT_MENU_FALLBACK_SIZE = { width: 208, height: 320 };

const clampContextMenuPosition = (x: number, y: number, width = CONTEXT_MENU_FALLBACK_SIZE.width, height = CONTEXT_MENU_FALLBACK_SIZE.height) => {
  if (typeof window === 'undefined') return { x, y };

  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const minX = viewportLeft + CONTEXT_MENU_MARGIN;
  const minY = viewportTop + CONTEXT_MENU_MARGIN;
  const maxX = viewportLeft + viewportWidth - width - CONTEXT_MENU_MARGIN;
  const maxY = viewportTop + viewportHeight - height - CONTEXT_MENU_MARGIN;

  return {
    x: Math.round(Math.min(Math.max(x, minX), Math.max(minX, maxX))),
    y: Math.round(Math.min(Math.max(y, minY), Math.max(minY, maxY))),
  };
};


export const GachaTab: React.FC = () => {
  const { user, refreshUserData, toast } = useApp();
  const broadcastModeStorageKey = `chikapo_inventory_broadcast_mode:${user?.id || 'guest'}`;
  const broadcastModeLoadedKeyRef = React.useRef<string | null>(null);
  const skipNextBroadcastModeSaveRef = React.useRef(false);
  const [streamers, setStreamers] = useState<Streamer[]>([]);
  const [inventory, setInventory] = useState<UserCard[]>([]);
  const [broadcastMode, setBroadcastMode] = useState(false);
  // 코스메틱 장착
  const [myCosmetics, setMyCosmetics] = useState<any[]>([]);
  const [equipCard, setEquipCard] = useState<UserCard | null>(null);

  // 이미지 신고 모달 (세부 상태는 ReportCardModal 컴포넌트가 자체 관리)
  const [reportCard, setReportCard] = useState<UserCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // 1:1 교환 모달 상태
  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [offerPoint, setOfferPoint] = useState(0); // 내가 함께 제시할 포인트
  const [requestPoint, setRequestPoint] = useState(0); // 상대에게 요청할 포인트
  const [offerCards, setOfferCards] = useState<{ [channelId: string]: number }>({}); // 내가 제시할 카드 { channel_id: count }
  const [requestCards, setRequestCards] = useState<{ [channelId: string]: number }>({}); // 상대에게 요청할 카드 { channel_id: count }
  const [tradeBusy, setTradeBusy] = useState(false);
  // 상대 검색/선택 및 상대 보유 카드
  const [receiverSearch, setReceiverSearch] = useState('');
  const [receiverResults, setReceiverResults] = useState<any[]>([]);
  const [selectedReceiver, setSelectedReceiver] = useState<{ id: string; username: string; avatar_url?: string } | null>(null);
  const [partnerCollection, setPartnerCollection] = useState<any[]>([]);
  const [offerSearch, setOfferSearch] = useState('');
  const [requestSearch, setRequestSearch] = useState('');

  // 받은/보낸 교환 목록 (인박스)
  const [activeTrades, setActiveTrades] = useState<any[]>([]);
  const [tradeHistory, setTradeHistory] = useState<any[]>([]);
  const [tradeRequestSearch, setTradeRequestSearch] = useState('');
  // 교환 이력 모달 + 페이지네이션
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);

  // 스트리머 상세 + 시세 그래프 모달 (공용 StreamerDetailModal 사용, channel_id만 보관)
  const [detailStreamer, setDetailStreamer] = useState<{ channel_id: string } | null>(null);

  // 카드 확대(상세) 모달 — 테두리/이름 효과가 적용된 카드를 크게 표시
  const [zoomCard, setZoomCard] = useState<UserCard | null>(null);
  const [fuseModal, setFuseModal] = useState<FuseModalState | null>(null);
  const [fuseMaterials, setFuseMaterials] = useState<Record<number, number>>({});
  const [fuseBusy, setFuseBusy] = useState(false);

  // ---- 오픈마켓 관련 보관함 상태 ----
  const [marketPendingCardIds, setMarketPendingCardIds] = useState<number[]>([]);
  const [myMarketListings, setMyMarketListings] = useState<any[]>([]);
  const [marketRegisterCard, setMarketRegisterCard] = useState<UserCard | null>(null);
  const [marketPriceInput, setMarketPriceInput] = useState('');
  const [marketListingType, setMarketListingType] = useState<'fixed' | 'auction'>('fixed');
  const [marketStartingBidInput, setMarketStartingBidInput] = useState('');
  const [marketAuctionHours, setMarketAuctionHours] = useState(24);
  const [withCosmetics, setWithCosmetics] = useState(false);
  const [marketRegisterBusy, setMarketRegisterBusy] = useState(false);
  const [marketCancelBusy, setMarketCancelBusy] = useState(false);
  
  // 1:1 교환 예약량 상태 ( available 계산용 )
  const [reservations, setReservations] = useState<{ cards: Record<string, number>; cardsByStar: Record<string, number>; points: number }>({ cards: {}, cardsByStar: {}, points: 0 });


  // 알림 피드백: 전역 토스트로 통일 (title은 메시지 앞에 간단히 덧붙임)
  const showAlert = (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') => {
    toast(title ? `${title} · ${message}` : message, type);
  };
  // 기존 setAlertModal({open,title,message,type}) 호출을 토스트로 라우팅하는 호환 shim
  const setAlertModal = (a: { open?: boolean; title?: string; message?: string; type?: 'success' | 'error' | 'warning' | 'info' }) => {
    if (a?.message) showAlert(a.title || '', a.message, a.type || 'info');
  };

  // 카드 정렬 및 필터링 상태 추가
  const [sortBy, setSortBy] = useState<'name-asc' | 'name-desc' | 'acquired-desc' | 'acquired-asc' | 'value-desc' | 'value-asc'>('acquired-desc');
  const [liveFilter, setLiveFilter] = useState<'all' | 'live' | 'offline'>('all');

  // 우클릭 컨텍스트 메뉴 상태
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    open: boolean;
    channel_id: string;
    star: number;
    card: UserCard | null;
  }>({ x: 0, y: 0, open: false, channel_id: '', star: 0, card: null });
  const contextMenuRef = React.useRef<HTMLDivElement | null>(null);

  // 카드 선택 모드 및 선택된 채널+별 키 목록
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedCardKeys, setSelectedCardKeys] = useState<string[]>([]);

  // 단일 판매 모달 및 확인 모달 상태
  const [sellModalOpen, setSellModalOpen] = useState(false);
  const [sellConfirmOpen, setSellConfirmOpen] = useState(false);
  const [sellQuantity, setSellQuantity] = useState(1);
  const [sellingStreamer, setSellingStreamer] = useState<Streamer | null>(null);
  const [sellingStar, setSellingStar] = useState(0);

  // 일괄 판매 모달 및 확인 모달 상태
  const [bulkSellModalOpen, setBulkSellModalOpen] = useState(false);
  const [bulkSellConfirmOpen, setBulkSellConfirmOpen] = useState(false);
  // 일괄 판매 항목 설정: { [channelId#star]: count }
  const [bulkSellQuantities, setBulkSellQuantities] = useState<{ [key: string]: number }>({});

  // 모바일 롱프레스 타이머 레프
  const longPressTimer = React.useRef<any>(null);
  const longPressStartPoint = React.useRef<{ x: number; y: number; scrollX: number; scrollY: number } | null>(null);
  // 롱프레스로 메뉴가 떠서 직후의 클릭(확대 모달)을 무시해야 하는지 여부
  const longPressFired = React.useRef<boolean>(false);
  const LONG_PRESS_CANCEL_DISTANCE = 12;

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressStartPoint.current = null;
  };

  const inventoryCardImage = (streamer?: Streamer | null, star: number = 0) =>
    cardImage(streamer, broadcastMode ? 0 : star);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(broadcastModeStorageKey);
    skipNextBroadcastModeSaveRef.current = true;
    setBroadcastMode(saved === 'true');
    broadcastModeLoadedKeyRef.current = broadcastModeStorageKey;
  }, [broadcastModeStorageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (broadcastModeLoadedKeyRef.current !== broadcastModeStorageKey) return;
    if (skipNextBroadcastModeSaveRef.current) {
      skipNextBroadcastModeSaveRef.current = false;
      return;
    }
    window.localStorage.setItem(broadcastModeStorageKey, broadcastMode ? 'true' : 'false');
  }, [broadcastMode, broadcastModeStorageKey]);

  // 전역 클릭 시 컨텍스트 메뉴 닫기
  useEffect(() => {
    const handleGlobalClick = () => {
      // 롱프레스 직후 발생하는 클릭은 메뉴를 닫지 않고 1회 소비 (모바일에서 메뉴가 즉시 닫히는 것 방지)
      if (longPressFired.current) {
        longPressFired.current = false;
        return;
      }
      setContextMenu(prev => prev.open ? { ...prev, open: false } : prev);
    };
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  useEffect(() => {
    if (!contextMenu.open) return;

    const repositionContextMenu = () => {
      const menu = contextMenuRef.current;
      if (!menu) return;

      const rect = menu.getBoundingClientRect();
      const next = clampContextMenuPosition(contextMenu.x, contextMenu.y, rect.width, rect.height);
      if (next.x !== contextMenu.x || next.y !== contextMenu.y) {
        setContextMenu(prev => prev.open ? { ...prev, x: next.x, y: next.y } : prev);
      }
    };

    const frame = window.requestAnimationFrame(repositionContextMenu);
    window.addEventListener('resize', repositionContextMenu);
    window.visualViewport?.addEventListener('resize', repositionContextMenu);
    window.visualViewport?.addEventListener('scroll', repositionContextMenu);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', repositionContextMenu);
      window.visualViewport?.removeEventListener('resize', repositionContextMenu);
      window.visualViewport?.removeEventListener('scroll', repositionContextMenu);
    };
  }, [contextMenu.open, contextMenu.x, contextMenu.y]);

  useEffect(() => {
    if (user) {
      fetchStreamers();
      fetchInventory();
      fetchActiveTrades();
      fetchTradeHistory();
      fetchMyCosmetics();
      fetchMarketPending();
    }
  }, [user]);

  // 진행 중 거래의 예약 카드/포인트 집계
  useEffect(() => {
    if (!user) return;
    const cards: Record<string, number> = {};
    const cardsByStar: Record<string, number> = {};
    let points = 0;

    const reserve = (offer: any) => {
      if (!offer) return;
      for (const c of offer.cards || []) {
        const key = c.channel_id;
        const compKey = `${c.channel_id}#${c.star ?? 0}`;
        cards[key] = (cards[key] || 0) + c.count;
        cardsByStar[compKey] = (cardsByStar[compKey] || 0) + c.count;
      }
      points += offer.point || 0;
    };

    for (const t of activeTrades) {
      if (t.sender_id === user.id) reserve(t.sender_offer);
      if (t.receiver_id === user.id && t.status === 'CONFIRMED') reserve(t.receiver_offer);
    }
    setReservations({ cards, cardsByStar, points });
  }, [activeTrades, user?.id]);

  // 장착 모달을 열 때마다 보유 코스메틱을 최신화 (상점 구매 후 등 상태 불일치로 "미보유" 오류 방지)
  useEffect(() => {
    if (equipCard) fetchMyCosmetics();
  }, [equipCard?.id]);

  const fetchMarketPending = async () => {
    if (!isAuthed()) return;
    try {
      const res = await apiFetch('/market/my');
      if (res.ok) {
        const data = await res.json();
        setMyMarketListings(data);
        const pendingIds = data.filter((l: any) => l.status === 'PENDING').map((l: any) => l.user_card_id);
        setMarketPendingCardIds(pendingIds);
      }
    } catch (e) {
      console.error('마켓 판매 중인 목록 로드 실패:', e);
    }
  };

  const getAvailableCount = (channelId: string, star: number) => {
    const owned = inventory.filter(c => c.channel_id === channelId && (c.star ?? 0) === star);
    const total = owned.length;
    const key = `${channelId}#${star}`;
    const reserved = reservations.cardsByStar[key] || 0;
    const pendingMarket = owned.filter(c => marketPendingCardIds.includes(c.id)).length;
    return Math.max(0, total - reserved - pendingMarket);
  };

  const getFuseMaterialMax = (channelId: string, baseStar: number, materialStar: number) => {
    const targetReserve = materialStar === baseStar ? 1 : 0;
    return Math.max(0, getAvailableCount(channelId, materialStar) - targetReserve);
  };

  const getSelectedFuseMaterials = (counts = fuseMaterials): FuseMaterial[] =>
    FUSE_STARS
      .map((star) => ({ star, count: Math.max(0, Math.floor(Number(counts[star]) || 0)) }))
      .filter((material) => material.count > 0);

  const hasFuseMaterial = (channelId: string, baseStar: number) =>
    FUSE_STARS.some((materialStar) => getFuseMaterialMax(channelId, baseStar, materialStar) > 0);

  const openFuseModal = (card: UserCard, streamer: Streamer, star: number) => {
    const initial: Record<number, number> = {};
    const firstValidStar = FUSE_STARS.find((materialStar) =>
      getFuseMaterialMax(streamer.channel_id, star, materialStar) > 0
      && star + fuseMaterialGain(materialStar) <= 5
    );
    if (firstValidStar !== undefined) initial[firstValidStar] = 1;
    setFuseMaterials(initial);
    setFuseModal({ card, streamer, star });
  };

  const adjustFuseMaterial = (materialStar: number, delta: number) => {
    if (!fuseModal) return;
    const max = getFuseMaterialMax(fuseModal.streamer.channel_id, fuseModal.star, materialStar);
    setFuseMaterials((prev) => {
      const nextValue = Math.max(0, Math.min(max, (prev[materialStar] || 0) + delta));
      const next = { ...prev };
      if (nextValue <= 0) delete next[materialStar];
      else next[materialStar] = nextValue;
      return next;
    });
  };

  const fetchMyCosmetics = async () => {
    try {
      const res = await apiFetch('/shop/inventory');
      if (res.ok) setMyCosmetics(await res.json());
    } catch { /* noop */ }
  };

  // 카드에 코스메틱 장착
  const handleEquip = async (cardId: number, itemId: number) => {
    try {
      const res = await apiFetch(`/cards/${cardId}/equip`, { method: 'POST', body: JSON.stringify({ item_id: itemId }) });
      const data = await res.json();
      if (res.ok) {
        showAlert('장착 완료', data.message || '장착되었습니다.', 'success');
        fetchInventory(); fetchMyCosmetics();
      } else showAlert('장착 실패', data.message || '실패했습니다.', 'error');
    } catch { showAlert('통신 오류', '서버와의 통신 중 오류가 발생했습니다.', 'error'); }
  };

  // 카드에서 코스메틱 해제(반환)
  const handleUnequip = async (cardId: number, type: 'border' | 'name_effect') => {
    try {
      const res = await apiFetch(`/cards/${cardId}/unequip`, { method: 'POST', body: JSON.stringify({ type }) });
      const data = await res.json();
      if (res.ok) {
        showAlert('해제 완료', data.message || '해제되었습니다.', 'info');
        fetchInventory(); fetchMyCosmetics();
      } else showAlert('해제 실패', data.message || '실패했습니다.', 'error');
    } catch { showAlert('통신 오류', '서버와의 통신 중 오류가 발생했습니다.', 'error'); }
  };

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in duration-300">
        <div className="max-w-md rounded-3xl border border-border bg-card p-8 shadow-lg">
          <Layers className="mx-auto h-12 w-12 text-primary animate-pulse mb-4" />
          <h2 className="text-xl font-black text-foreground">로그인이 필요한 기능입니다</h2>
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            스트리머 카드 소환(GACHA) 및 보관함 인벤토리, 1:1 교환을 이용하시려면 치지직 간편 로그인을 진행해 주세요.
          </p>
        </div>
      </div>
    );
  }

  const fetchStreamers = async () => {
    try {
      const res = await apiFetch('/streamers');
      if (res.ok) {
        const data = await res.json();
        setStreamers(data);
      }
    } catch (e) {
      console.error('스트리머 목록 로드 실패:', e);
    }
  };

  const fetchInventory = async () => {
    if (!isAuthed()) return;
    try {
      // API 병렬 호출을 적용하여 보관함 로딩 지연을 최소화합니다.
      const [res] = await Promise.all([
        apiFetch('/users/me/cards'),
        fetchMarketPending()
      ]);
      if (res.ok) {
        const data = await res.json();
        setInventory(data);
      }
    } catch (e) {
      console.error('인벤토리 조회 실패:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleMarketCancel = async (cardId: number) => {
    const listing = myMarketListings.find(l => l.user_card_id === cardId && l.status === 'PENDING');
    if (!listing) return;
    setMarketCancelBusy(true);
    try {
      const res = await apiFetch(`/market/cancel/${listing.id}`, { method: 'POST' });
      if (res.ok) {
        showAlert('취소 성공', '오픈마켓 카드 등록이 취소되었습니다.', 'success');
        refreshUserData();
        fetchInventory();
      } else {
        const data = await res.json();
        showAlert('취소 실패', data.message || '오류가 발생했습니다.', 'error');
      }
    } catch {
      showAlert('통신 오류', '서버와의 통신에 실패했습니다.', 'error');
    } finally {
      setMarketCancelBusy(false);
    }
  };
  const handleMarketRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!marketRegisterCard) return;
    const buyNowPrice = Math.floor(Number(marketPriceInput)) || 0;
    const startingBid = Math.floor(Number(marketStartingBidInput)) || 0;
    if (marketListingType === 'fixed' && buyNowPrice < 100) {
      showAlert('등록 실패', '최소 판매 가격은 100 P 이상입니다.', 'warning');
      return;
    }
    if (marketListingType === 'auction' && startingBid < 100) {
      showAlert('등록 실패', '경매 시작가는 100 P 이상이어야 합니다.', 'warning');
      return;
    }
    if (marketListingType === 'auction' && buyNowPrice > 0 && buyNowPrice < startingBid) {
      showAlert('등록 실패', '즉시 구매가는 경매 시작가보다 낮을 수 없습니다.', 'warning');
      return;
    }

    setMarketRegisterBusy(true);
    try {
      const res = await apiFetch('/market/list', {
        method: 'POST',
        body: JSON.stringify({
          user_card_id: marketRegisterCard.id,
          listing_type: marketListingType,
          price: marketListingType === 'fixed' ? buyNowPrice : startingBid,
          buy_now_price: marketListingType === 'auction' && buyNowPrice > 0 ? buyNowPrice : undefined,
          starting_bid: marketListingType === 'auction' ? startingBid : undefined,
          auction_hours: marketListingType === 'auction' ? marketAuctionHours : undefined,
          with_cosmetics: withCosmetics
        })
      });
      const data = await res.json();
      if (res.ok) {
        showAlert('등록 성공', marketListingType === 'auction' ? '카드가 경매 매물로 등록되었습니다.' : '카드가 오픈마켓에 판매 등록되었습니다.', 'success');
        setMarketRegisterCard(null);
        setMarketListingType('fixed');
        setMarketStartingBidInput('');
        setMarketPriceInput('');
        setMarketAuctionHours(24);
        setWithCosmetics(false);
        refreshUserData();
        fetchInventory();
      } else {
        showAlert('등록 실패', data.message || '등록에 실패했습니다.', 'error');
      }
    } catch {
      showAlert('통신 오류', '서버와의 통신에 실패했습니다.', 'error');
    } finally {
      setMarketRegisterBusy(false);
    }
  };


  // KST 자정 무료 뽑기 가능 여부 판단 헬퍼

  const handleOpenTrade = () => {
    resetTradeForm();
    setTradeModalOpen(true);
  };

  // 상대 검색 (디바운스 없이 버튼/엔터/입력 변경 시 호출)
  const searchReceivers = async (kw: string) => {
    setReceiverSearch(kw);
    if (kw.trim().length < 1) { setReceiverResults([]); return; }
    try {
      const res = await apiFetch(`/users/search?keyword=${encodeURIComponent(kw.trim())}`);
      if (res.ok) setReceiverResults(await res.json());
    } catch { /* 무시 */ }
  };

  // 상대 선택 → 상대 보유 카드 컬렉션 로드
  const selectReceiver = async (u: { id: string; username: string; avatar_url?: string }) => {
    setSelectedReceiver(u);
    setReceiverResults([]);
    setReceiverSearch(u.username);
    setRequestCards({});
    setPartnerCollection([]);
    try {
      const res = await apiFetch(`/users/${u.id}/collection`);
      if (res.ok) setPartnerCollection(await res.json());
    } catch { /* 무시 */ }
  };

  // 내 보유 카드 channel_id + 별(star)별 묶음 (같은 스트리머라도 성별로 분리)
  const myCollection = (() => {
    const map: { [key: string]: { key: string; channel_id: string; star: number; count: number; streamer: any } } = {};
    for (const c of inventory) {
      if (!c.streamer) continue;
      const star = c.star || 0;
      const key = `${c.channel_id}#${star}`;
      if (!map[key]) map[key] = { key, channel_id: c.channel_id, star, count: 0, streamer: c.streamer };
      map[key].count += 1;
    }
    return Object.values(map).sort((a, b) => {
      const an = a.streamer?.name || '', bn = b.streamer?.name || '';
      return an === bn ? a.star - b.star : an.localeCompare(bn);
    });
  })();

  const adjustOfferCard = (key: string, delta: number, max: number) => {
    setOfferCards(prev => {
      const next = { ...prev };
      const v = Math.max(0, Math.min(max, (next[key] || 0) + delta));
      if (v <= 0) delete next[key];
      else next[key] = v;
      return next;
    });
  };

  // 진행 중(보낸/받은) 교환 목록 조회
  const fetchActiveTrades = async () => {
    try {
      const res = await apiFetch('/trades/active');
      if (res.ok) {
        setActiveTrades(await res.json());
      }
    } catch (e) {
      console.error('교환 목록 조회 실패:', e);
    }
  };

  // 종료된 교환 이력 조회
  const fetchTradeHistory = async () => {
    try {
      const res = await apiFetch('/trades/history');
      if (res.ok) setTradeHistory(await res.json());
    } catch (e) {
      console.error('교환 이력 조회 실패:', e);
    }
  };

  // 스트리머 상세 + 시세 그래프 열기 (실제 로딩/차트는 공용 StreamerDetailModal이 담당)
  const openStreamerDetail = (channelId: string) => {
    setDetailStreamer({ channel_id: channelId });
  };

  const shortChannelId = (channelId: string) => (
    channelId.length > 14 ? `${channelId.slice(0, 6)}...${channelId.slice(-4)}` : channelId
  );

  const tradeStreamerName = (channelId: string, serverName?: string | null) => {
    if (serverName) return serverName;

    const fromStreamers = streamers.find((s) => s.channel_id === channelId);
    if (fromStreamers?.name) return fromStreamers.name;

    const fromInventory = inventory.find((card) => card.channel_id === channelId);
    if (fromInventory?.streamer?.name) return fromInventory.streamer.name;

    const fromPartner = partnerCollection.find((card: any) => card.channel_id === channelId);
    if (fromPartner?.streamer?.name) return fromPartner.streamer.name;

    return `채널 ${shortChannelId(channelId)}`;
  };

  const renderTradeOffer = (offer: any) => {
    const cards = Array.isArray(offer?.cards) ? offer.cards : [];
    const items: { key: string; label: string; meta: string }[] = cards.map((c: any) => {
      const star = Number(c.star || 0);
      const starLabel = star > 0 ? `${star}성` : '일반';
      return {
        key: `${c.channel_id}#${star}`,
        label: tradeStreamerName(String(c.channel_id || ''), c.streamer_name),
        meta: `${starLabel} ${Number(c.count || 0).toLocaleString()}장`
      };
    });

    if (Number(offer?.point || 0) > 0) {
      items.push({
        key: 'point',
        label: `${Number(offer.point || 0).toLocaleString()} P`,
        meta: '포인트'
      });
    }

    if (items.length === 0) {
      return <p className="text-muted-foreground">없음</p>;
    }

    return (
      <div className="space-y-1">
        {items.map((item) => (
          <div key={item.key} className="min-w-0 rounded-md bg-background/40 px-2 py-1">
            <p className="truncate font-bold text-foreground/85">{item.label}</p>
            <p className="text-[10px] font-semibold text-muted-foreground">{item.meta}</p>
          </div>
        ))}
      </div>
    );
  };

  const resetTradeForm = () => {
    setOfferCards({});
    setOfferPoint(0);
    setRequestPoint(0);
    setRequestCards({});
    setReceiverSearch('');
    setReceiverResults([]);
    setSelectedReceiver(null);
    setPartnerCollection([]);
    setOfferSearch('');
    setRequestSearch('');
  };

  const executeTrade = async () => {
    if (!selectedReceiver) {
      showAlert('상대 지정 필요', '교환할 상대를 검색해서 선택해 주세요.', 'warning');
      return;
    }

    // 복합키(channel#star)를 { channel_id, star, count }로 분해
    const parseKey = ([key, count]: [string, number]) => {
      const [channel_id, starStr] = key.split('#');
      return { channel_id, star: Number(starStr) || 0, count };
    };
    const offerList = Object.entries(offerCards).filter(([, c]) => c > 0).map(parseKey);
    const reqList = Object.entries(requestCards).filter(([, c]) => c > 0).map(parseKey);

    if (offerList.length === 0 && offerPoint <= 0 && reqList.length === 0 && requestPoint <= 0) {
      showAlert('내용 부족', '제시하거나 요청할 카드/포인트를 최소 한 가지 이상 지정해 주세요.', 'warning');
      return;
    }

    setTradeBusy(true);
    try {
      const res = await apiFetch('/trades', {
        method: 'POST',
        body: JSON.stringify({
          receiver_id: selectedReceiver.id,
          sender_offer: { cards: offerList, point: offerPoint },
          receiver_offer: { cards: reqList, point: requestPoint }
        })
      });
      const data = await res.json();
      if (res.ok) {
        showAlert('교환 제안 완료', data.message || '교환을 제안했습니다.', 'success');
        resetTradeForm();
        setTradeModalOpen(false);
        fetchActiveTrades();
      } else {
        showAlert('교환 제안 실패', data.message || '교환 제안에 실패했습니다.', 'error');
      }
    } catch (e) {
      showAlert('통신 오류', '서버와의 통신 중 오류가 발생했습니다.', 'error');
    } finally {
      setTradeBusy(false);
    }
  };

  // 교환 1단계: 수신자가 조건에 동의 (PENDING → CONFIRMED)
  const handleConfirmTrade = async (tradeId: number) => {
    try {
      const res = await apiFetch(`/trades/${tradeId}/confirm`, { method: 'POST' });
      const data = await res.json();
      showAlert(res.ok ? '동의 완료' : '처리 실패', data.message || '', res.ok ? 'success' : 'error');
      fetchActiveTrades();
    } catch (e) {
      showAlert('통신 오류', '서버와의 통신 중 오류가 발생했습니다.', 'error');
    }
  };

  // 교환 2단계: 제안자가 최종 승인하여 체결 (CONFIRMED → ACCEPTED)
  const handleFinalizeTrade = async (tradeId: number) => {
    try {
      const res = await apiFetch(`/trades/${tradeId}/finalize`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showAlert('교환 체결', data.message || '교환이 체결되었습니다.', 'success');
        fetchActiveTrades();
        fetchTradeHistory();
        fetchInventory();
        refreshUserData();
      } else {
        showAlert('교환 실패', data.message || '교환 체결에 실패했습니다.', 'error');
        fetchActiveTrades();
      }
    } catch (e) {
      showAlert('통신 오류', '서버와의 통신 중 오류가 발생했습니다.', 'error');
    }
  };

  // 교환 거절(받은) / 취소(보낸)
  const handleRejectTrade = async (tradeId: number) => {
    try {
      const res = await apiFetch(`/trades/${tradeId}/reject`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showAlert('처리 완료', data.message || '처리되었습니다.', 'info');
        fetchActiveTrades();
      } else {
        showAlert('처리 실패', data.message || '처리에 실패했습니다.', 'error');
      }
    } catch (e) {
      showAlert('통신 오류', '서버와의 통신 중 오류가 발생했습니다.', 'error');
    }
  };

  // 카드 한계돌파 (선택한 같은 스트리머 카드들을 재료로 소모)
  const handleFuse = async (channelId: string, star: number, materials?: FuseMaterial[]) => {
    setFuseBusy(true);
    try {
      const body: any = { channel_id: channelId, star };
      if (materials && materials.length > 0) body.materials = materials;
      const res = await apiFetch('/cards/fuse', { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json();
      if (res.ok) {
        showAlert('한계돌파 성공', data.message || '한계돌파에 성공했습니다.', 'success');
        setFuseModal(null);
        setFuseMaterials({});
        fetchInventory();
      } else {
        showAlert('한계돌파 실패', data.message || '한계돌파에 실패했습니다.', 'error');
      }
    } catch {
      showAlert('통신 오류', '서버와의 통신 중 오류가 발생했습니다.', 'error');
    } finally {
      setFuseBusy(false);
    }
  };

  // 이미지 신고 모달 열기 (우클릭 메뉴 → 이미지 신고)
  const openReport = (card: UserCard) => setReportCard(card);

  // 요청 카드 수량 증감 (상대 보유량 상한) — key = channel#star
  const adjustRequestCard = (key: string, delta: number, max: number) => {
    setRequestCards(prev => {
      const next = { ...prev };
      const v = Math.max(0, Math.min(max, (next[key] || 0) + delta));
      if (v <= 0) delete next[key];
      else next[key] = v;
      return next;
    });
  };


  // 단일 카드 판매 실행
  const executeSell = async () => {
    if (!sellingStreamer) return;
    try {
      const res = await apiFetch('/cards/sell', {
        method: 'POST',
        body: JSON.stringify({
          items: [{ channelId: sellingStreamer.channel_id, star: sellingStar, count: sellQuantity }]
        })
      });

      const data = await res.json();
      if (res.ok) {
        setAlertModal({
          open: true,
          title: '판매 완료',
          message: data.message || '카드가 정상적으로 판매되었습니다.',
          type: 'success'
        });
        setSellConfirmOpen(false);
        setSellModalOpen(false);
        setSellingStreamer(null);
        setSellingStar(0);
        fetchInventory();
        refreshUserData();
      } else {
        setAlertModal({
          open: true,
          title: '판매 실패',
          message: data.message || '카드 판매 도중 오류가 발생했습니다.',
          type: 'error'
        });
      }
    } catch (e) {
      console.error(e);
      toast('서버 전송 중 에러가 발생했습니다.');
    }
  };

  // 일괄 카드 판매 실행
  const executeBulkSell = async () => {
    const items = Object.entries(bulkSellQuantities)
      .map(([key, count]) => ({ ...parseCardKey(key), count }))
      .filter(item => item.count > 0);

    if (items.length === 0) {
      toast('판매할 카드가 선택되지 않았습니다.');
      return;
    }

    try {
      const res = await apiFetch('/cards/sell', {
        method: 'POST',
        body: JSON.stringify({ items })
      });

      const data = await res.json();
      if (res.ok) {
        setAlertModal({
          open: true,
          title: '일괄 판매 완료',
          message: data.message || '선택한 모든 카드가 일괄 판매되었습니다.',
          type: 'success'
        });
        setBulkSellConfirmOpen(false);
        setBulkSellModalOpen(false);
        setSelectedCardKeys([]);
        setSelectionMode(false);
        fetchInventory();
        refreshUserData();
      } else {
        setAlertModal({
          open: true,
          title: '일괄 판매 실패',
          message: data.message || '일괄 판매 실패',
          type: 'error'
        });
      }
    } catch (e) {
      console.error(e);
      toast('서버 전송 중 에러가 발생했습니다.');
    }
  };

  // 카드 수량 계산 헬퍼
  const getCardCountInInventory = (channelId: string, star: number) => {
    return getAvailableCount(channelId, star);
  };

  const handleToggleHidden = async (card: UserCard) => {
    try {
      const res = await apiFetch(`/cards/${card.id}/visibility`, {
        method: 'PATCH',
        body: JSON.stringify({ hidden: !card.is_hidden })
      });
      const data = await res.json();
      showAlert(res.ok ? '설정 완료' : '설정 실패', data.message || '', res.ok ? 'success' : 'error');
      if (res.ok) fetchInventory();
    } catch {
      showAlert('통신 오류', '카드 숨김 설정 중 오류가 발생했습니다.', 'error');
    }
  };

  const handleToggleFavorite = async (card: UserCard) => {
    try {
      const res = await apiFetch(`/cards/${card.id}/favorite`, {
        method: 'PATCH',
        body: JSON.stringify({ favorite: card.favorite_order == null })
      });
      const data = await res.json();
      showAlert(res.ok ? '설정 완료' : '설정 실패', data.message || '', res.ok ? 'success' : 'error');
      if (res.ok) fetchInventory();
    } catch {
      showAlert('통신 오류', '즐겨찾기 설정 중 오류가 발생했습니다.', 'error');
    }
  };

  const getCardByKey = (key: string) => {
    const { channelId, star } = parseCardKey(key);
    return inventory.find(c => c.channel_id === channelId && (c.star || 0) === star) || null;
  };

  // 검색 및 라이브 여부 필터링 후, 지정한 기준대로 정렬 처리
  const getProcessedInventory = () => {
    // 1. 검색어 및 라이브 상태 필터링
    let result = inventory.filter(card => {
      const streamer = card.streamer;
      if (!streamer) return false;

      // 이름 검색 필터 (초성 매칭 및 띄어쓰기 무시 유사도 매칭 적용)
      const matchesSearch = fuzzySearch(streamer.name, searchQuery);

      // 라이브 상태 필터 (DB 필드 또는 객체의 is_active 속성 매칭)
      const isActive = streamer.is_active || (streamer as any).isLive;
      const matchesLive =
        liveFilter === 'all' ? true :
          liveFilter === 'live' ? isActive === true :
            isActive !== true;

      return matchesSearch && matchesLive;
    });

    // 2. 정렬 정렬
    return [...result].sort((a, b) => {
      const favA = a.favorite_order ?? Number.POSITIVE_INFINITY;
      const favB = b.favorite_order ?? Number.POSITIVE_INFINITY;
      if (favA !== favB) return favA - favB;

      const nameA = a.streamer?.name || '';
      const nameB = b.streamer?.name || '';
      const valA = a.streamer?.base_value || 0;
      const valB = b.streamer?.base_value || 0;
      const timeA = new Date(a.acquired_at || 0).getTime();
      const timeB = new Date(b.acquired_at || 0).getTime();
      const idA = a.id || 0;
      const idB = b.id || 0;

      switch (sortBy) {
        case 'name-asc':
          return nameA.localeCompare(nameB);
        case 'name-desc':
          return nameB.localeCompare(nameA);
        case 'acquired-desc':
          // 획득순 내림차순 (최신순 - ID 또는 시간 기준)
          return timeB - timeA || idB - idA;
        case 'acquired-asc':
          // 획득순 오름차순 (과거순)
          return timeA - timeB || idA - idB;
        case 'value-desc':
          return valB - valA;
        case 'value-asc':
          return valA - valB;
        default:
          return timeB - timeA;
      }
    });
  };

  const filteredInventory = getProcessedInventory();

  return (
    <div className="space-y-8 animate-in fade-in duration-300">

      {/* 1:1 교환 거래 팝업 */}
      {tradeModalOpen && (
        <div className="modal-backdrop z-[80] bg-black/60 backdrop-blur-sm">
          <div className="modal-panel modal-panel-lg modal-panel-scroll rounded-2xl border border-border bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-200 sm:p-6">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h3 className="text-base font-bold flex items-center gap-2">
                <ArrowRightLeft className="h-4.5 w-4.5 text-primary" /> 1:1 스트리머 카드 교환 제안
              </h3>
              <button onClick={() => setTradeModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4 max-h-[65vh] overflow-y-auto pr-1">
              {/* 상대 검색/선택 */}
              <div>
                <label className="text-xs font-bold text-muted-foreground block mb-1.5">교환 상대 검색</label>
                {selectedReceiver ? (
                  <div className="flex items-center justify-between rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <img src={selectedReceiver.avatar_url} alt={selectedReceiver.username} className="h-8 w-8 rounded-full object-cover border border-border/60" />
                      <span className="text-sm font-bold truncate">{selectedReceiver.username}</span>
                    </div>
                    <button onClick={() => { setSelectedReceiver(null); setReceiverSearch(''); setPartnerCollection([]); setRequestCards({}); }} className="text-xs text-muted-foreground hover:text-foreground">변경</button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      value={receiverSearch}
                      onChange={(e) => searchReceivers(e.target.value)}
                      placeholder="상대 닉네임 검색"
                      className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                    />
                    {receiverResults.length > 0 && (
                      <div className="mt-1.5 space-y-1 max-h-40 overflow-y-auto rounded-lg border border-border bg-card p-1">
                        {receiverResults.map((u) => (
                          <button key={u.id} onClick={() => selectReceiver(u)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-secondary/60 transition">
                            <img src={u.avatar_url} alt={u.username} className="h-7 w-7 rounded-full object-cover border border-border/60" />
                            <span className="text-xs font-bold truncate">{u.username}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* 내가 제시: 보유 카드(검색) + 포인트 */}
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2.5">
                <p className="text-xs font-black text-emerald-500">내가 제시</p>
                <input
                  type="text"
                  value={offerSearch}
                  onChange={(e) => setOfferSearch(e.target.value)}
                  placeholder="내 보유 카드 검색"
                  className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-xs focus:border-primary focus:outline-none"
                />
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {myCollection.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground py-1">보유한 카드가 없습니다.</p>
                  ) : myCollection
                    .filter((c) => fuzzySearch(c.streamer?.name || '', offerSearch))
                    .map((c) => (
                      <div key={c.key} className="flex items-center justify-between rounded-lg bg-secondary/30 px-2 py-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <img src={inventoryCardImage(c.streamer, c.star)} alt={c.streamer.name} className="h-7 w-7 rounded-full object-cover border border-border/60" />
                          <span className="text-[11px] font-bold truncate">{c.streamer.name}</span>
                          {c.star > 0 && <span className="shrink-0 rounded bg-amber-400/20 px-1 text-[9px] font-black text-amber-500">{c.star}★</span>}
                          <span className="shrink-0 text-[9px] text-muted-foreground">보유 {c.count}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => adjustOfferCard(c.key, -1, c.count)} className="h-5 w-5 rounded bg-secondary text-xs font-bold">-</button>
                          <span className="w-5 text-center text-xs font-bold">{offerCards[c.key] || 0}</span>
                          <button onClick={() => adjustOfferCard(c.key, 1, c.count)} className="h-5 w-5 rounded bg-primary text-primary-foreground text-xs font-bold">+</button>
                        </div>
                      </div>
                    ))}
                </div>
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground block mb-1">제시할 포인트 (보유 {user.point.toLocaleString()})</label>
                  <input type="number" min={0} value={offerPoint}
                    onChange={(e) => setOfferPoint(Math.max(0, Number(e.target.value)))}
                    className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-xs focus:border-primary focus:outline-none" />
                </div>
              </div>

              {/* 내가 요청: 상대 보유 카드(검색) + 포인트 */}
              <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 space-y-2.5">
                <p className="text-xs font-black text-sky-500">상대에게 요청</p>
                {!selectedReceiver ? (
                  <p className="text-[10px] text-muted-foreground py-1">먼저 교환 상대를 선택하면 상대의 보유 카드를 요청할 수 있어요.</p>
                ) : (
                  <>
                    <input
                      type="text"
                      value={requestSearch}
                      onChange={(e) => setRequestSearch(e.target.value)}
                      placeholder="상대 보유 카드 검색"
                      className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-xs focus:border-primary focus:outline-none"
                    />
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {partnerCollection.length === 0 ? (
                        <p className="text-[10px] text-muted-foreground py-1">상대가 보유한 카드가 없습니다.</p>
                      ) : partnerCollection
                        .filter((c) => fuzzySearch(c.streamer?.name || '', requestSearch))
                        .map((c) => {
                          const key = `${c.channel_id}#${c.star || 0}`;
                          return (
                          <div key={key} className="flex items-center justify-between rounded-lg bg-secondary/30 px-2 py-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <img src={inventoryCardImage(c.streamer, c.star || 0)} alt={c.streamer?.name} className="h-7 w-7 rounded-full object-cover border border-border/60" />
                              <span className="text-[11px] font-bold truncate">{c.streamer?.name}</span>
                              {(c.star || 0) > 0 && <span className="shrink-0 rounded bg-amber-400/20 px-1 text-[9px] font-black text-amber-500">{c.star}★</span>}
                              <span className="shrink-0 text-[9px] text-muted-foreground">보유 {c.count}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => adjustRequestCard(key, -1, c.count)} className="h-5 w-5 rounded bg-secondary text-xs font-bold">-</button>
                              <span className="w-5 text-center text-xs font-bold">{requestCards[key] || 0}</span>
                              <button onClick={() => adjustRequestCard(key, 1, c.count)} className="h-5 w-5 rounded bg-primary text-primary-foreground text-xs font-bold">+</button>
                            </div>
                          </div>
                          );
                        })}
                    </div>
                  </>
                )}
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground block mb-1">요청할 포인트</label>
                  <input type="number" min={0} value={requestPoint}
                    onChange={(e) => setRequestPoint(Math.max(0, Number(e.target.value)))}
                    className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-xs focus:border-primary focus:outline-none" />
                </div>
              </div>
            </div>

            <p className="mt-4 text-[10px] leading-relaxed text-muted-foreground">
              ※ 카드에 장착된 코스메틱(테두리·이름 효과)은 카드와 함께 상대에게 소유권이 넘어갑니다.
            </p>

            <div className="mt-2 flex items-center justify-end gap-2 border-t border-border/60 pt-4">
              <button
                onClick={() => { resetTradeForm(); setTradeModalOpen(false); }}
                className="rounded-lg px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground hover:bg-secondary/80"
              >
                취소
              </button>
              <button
                onClick={executeTrade}
                disabled={tradeBusy}
                className="rounded-lg bg-primary px-5 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {tradeBusy ? '전송 중...' : '교환 요청 보내기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 스트리머 상세 + 시세 그래프 모달 (공용 컴포넌트) */}
      {detailStreamer && (
        <StreamerDetailModal channelId={detailStreamer.channel_id} onClose={() => setDetailStreamer(null)} />
      )}

      {/* 교환 인박스 (받은/보낸 진행 중 교환) */}
      {activeTrades.length > 0 && (
        <section className="rounded-3xl border border-border bg-card p-6 shadow-sm space-y-3">
          <h3 className="text-base font-black flex items-center gap-2">
            <ArrowRightLeft className="h-4.5 w-4.5 text-primary" /> 진행 중인 교환 ({activeTrades.length})
          </h3>
          <div className="space-y-2.5">
            {activeTrades.map((t) => {
              const incoming = t.direction === 'incoming';
              const counterpartName = incoming ? (t.sender_username || t.sender_id) : (t.receiver_username || t.receiver_id);
              const confirmed = t.status === 'CONFIRMED';
              // 단계 안내 라벨
              const stageLabel = confirmed
                ? (incoming ? '내가 동의함 · 제안자 최종 승인 대기' : '상대가 동의함 · 내 최종 승인 필요')
                : (incoming ? '검토 요청됨' : '상대 동의 대기 중');
              return (
                <div key={t.id} className="rounded-xl border border-border/60 bg-secondary/20 p-3.5">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className={`text-[10px] font-black rounded px-2 py-0.5 ${incoming ? 'bg-sky-500/15 text-sky-500' : 'bg-amber-500/15 text-amber-500'}`}>
                      {incoming ? '받은 교환' : '보낸 교환'}
                    </span>
                    <span className="min-w-0 truncate text-right text-[11px] font-bold text-muted-foreground">상대: {counterpartName}</span>
                  </div>
                  <p className={`text-[10px] font-bold mb-1 ${confirmed ? 'text-emerald-500' : 'text-muted-foreground'}`}>
                    [{confirmed ? '2단계' : '1단계'}] {stageLabel}
                  </p>
                  {/* Double-Lock 거래 진행 상태 타임라인 바 */}
                  <div className="my-3.5 flex items-center justify-between relative px-4">
                    <div className="absolute top-1/2 left-4 right-4 h-0.5 bg-border/60 -translate-y-1/2 z-0"></div>
                    <div 
                      className="absolute top-1/2 left-4 h-0.5 bg-primary -translate-y-1/2 z-0 transition-all duration-300"
                      style={{ width: confirmed ? 'calc(100% - 2rem)' : '50%' }}
                    ></div>

                    {/* 1단계: 제안 전송 */}
                    <div className="flex flex-col items-center z-10">
                      <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center text-[10px] font-black text-primary-foreground shadow-sm ring-4 ring-card">
                        ✓
                      </div>
                      <span className="text-[9px] font-bold text-foreground mt-1 bg-card px-1">제안 전송</span>
                    </div>

                    {/* 2단계: 동의 수락 */}
                    <div className="flex flex-col items-center z-10">
                      <div className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-black shadow-sm ring-4 ring-card transition-colors duration-200 ${
                        confirmed 
                          ? 'bg-primary text-primary-foreground' 
                          : 'bg-secondary text-muted-foreground border border-border/80'
                      }`}>
                        {confirmed ? '✓' : '2'}
                      </div>
                      <span className={`text-[9px] font-bold mt-1 bg-card px-1 ${confirmed ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {incoming ? '내 동의' : '상대 동의'}
                      </span>
                    </div>

                    {/* 3단계: 최종 승인 */}
                    <div className="flex flex-col items-center z-10">
                      <div className="h-5 w-5 rounded-full bg-secondary text-muted-foreground border border-border/80 flex items-center justify-center text-[10px] font-black shadow-sm ring-4 ring-card">
                        3
                      </div>
                      <span className="text-[9px] font-bold text-muted-foreground mt-1 bg-card px-1">
                        최종 승인
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2">
                    <div className="min-w-0 rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-2">
                      <p className="font-bold text-emerald-500 mb-0.5">{incoming ? '상대 제시' : '내 제시'}</p>
                      {renderTradeOffer(t.sender_offer)}
                    </div>
                    <div className="min-w-0 rounded-lg bg-sky-500/5 border border-sky-500/20 p-2">
                      <p className="font-bold text-sky-500 mb-0.5">{incoming ? '나에게 요청' : '상대에게 요청'}</p>
                      {renderTradeOffer(t.receiver_offer)}
                    </div>
                  </div>
                  <p className="mt-2 text-[9.5px] leading-relaxed text-muted-foreground">
                    ※ 카드에 장착된 코스메틱(테두리·이름 효과)은 카드와 함께 소유권이 이전됩니다.
                  </p>
                  <div className="mt-2 flex justify-end gap-2">
                    {/* 수신자: PENDING이면 '동의' 가능. 제안자: CONFIRMED면 '최종 승인' 가능. 양측 항상 취소/거절 가능 */}
                    <button onClick={() => handleRejectTrade(t.id)} className="rounded-lg bg-secondary px-3 py-1.5 text-[11px] font-bold text-muted-foreground hover:bg-secondary/80">
                      {incoming ? '거절' : '취소'}
                    </button>
                    {incoming && !confirmed && (
                      <button onClick={() => handleConfirmTrade(t.id)} className="rounded-lg bg-primary px-4 py-1.5 text-[11px] font-bold text-primary-foreground hover:bg-primary/90">동의 (1단계)</button>
                    )}
                    {!incoming && confirmed && (
                      <button onClick={() => handleFinalizeTrade(t.id)} className="rounded-lg bg-emerald-600 px-4 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-700">최종 승인 (2단계)</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 교환 이력 모달 (5개 단위 페이지네이션) — 보관함의 '교환 이력' 버튼으로 열림 */}
      {historyModalOpen && (() => {
        const statusLabel: Record<string, string> = { ACCEPTED: '체결', REJECTED: '거절', CANCELLED: '취소' };
        const statusColor: Record<string, string> = { ACCEPTED: 'text-emerald-500', REJECTED: 'text-rose-500', CANCELLED: 'text-muted-foreground' };
        const accepted = tradeHistory.filter((t) => t.status === 'ACCEPTED').length;
        const rejected = tradeHistory.filter((t) => t.status === 'REJECTED').length;
        const cancelled = tradeHistory.filter((t) => t.status === 'CANCELLED').length;
        const PER = 5;
        const totalPages = Math.max(1, Math.ceil(tradeHistory.length / PER));
        const page = Math.min(historyPage, totalPages);
        const paged = tradeHistory.slice((page - 1) * PER, page * PER);
        const fmtDate = (iso?: string) => {
          return formatLocalDate(iso, '');
        };
        return (
          <div className="modal-backdrop z-[80] bg-black/60 backdrop-blur-sm" onClick={() => setHistoryModalOpen(false)}>
            <div className="modal-panel modal-panel-md modal-panel-scroll rounded-2xl border border-border bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-200 sm:p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <h3 className="text-base font-bold flex items-center gap-2"><Clock className="h-4.5 w-4.5 text-primary" /> 교환 이력 ({tradeHistory.length})</h3>
                <button onClick={() => setHistoryModalOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
              </div>
              {/* 통계 요약 */}
              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-emerald-500/10 p-2.5 text-center"><p className="text-lg font-black text-emerald-500">{accepted}</p><p className="text-[10px] text-muted-foreground">체결</p></div>
                <div className="rounded-lg bg-rose-500/10 p-2.5 text-center"><p className="text-lg font-black text-rose-500">{rejected}</p><p className="text-[10px] text-muted-foreground">거절</p></div>
                <div className="rounded-lg bg-secondary p-2.5 text-center"><p className="text-lg font-black text-muted-foreground">{cancelled}</p><p className="text-[10px] text-muted-foreground">취소</p></div>
              </div>
              <div className="mt-3 space-y-2">
                {paged.length === 0 && (
                  <p className="py-8 text-center text-xs text-muted-foreground">교환 이력이 없습니다.</p>
                )}
                {paged.map((t) => {
                  const incoming = t.direction === 'incoming';
                  const counterpart = incoming ? (t.sender_username || t.sender_id) : (t.receiver_username || t.receiver_id);
                  return (
                    <div key={t.id} className="rounded-xl border border-border/60 bg-secondary/20 p-3">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-[11px] font-bold text-muted-foreground">
                          {incoming ? '받음' : '보냄'} · {counterpart}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[9px] text-muted-foreground">{fmtDate(t.completed_at || t.created_at)}</span>
                          <span className={`text-[11px] font-black ${statusColor[t.status]}`}>{statusLabel[t.status] || t.status}</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-1.5 text-[10px] sm:grid-cols-2">
                        <div className="min-w-0 rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-1.5">
                          <p className="font-bold text-emerald-500 mb-0.5">{incoming ? '상대 제시' : '내 제시'}</p>
                          {renderTradeOffer(t.sender_offer)}
                        </div>
                        <div className="min-w-0 rounded-lg bg-sky-500/5 border border-sky-500/20 p-1.5">
                          <p className="font-bold text-sky-500 mb-0.5">{incoming ? '나에게 요청' : '상대에게 요청'}</p>
                          {renderTradeOffer(t.receiver_offer)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* 페이지네이션 */}
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-center gap-2">
                  <button onClick={() => setHistoryPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                    className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none">이전</button>
                  <span className="text-xs font-bold text-muted-foreground">{page} / {totalPages}</span>
                  <button onClick={() => setHistoryPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                    className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none">다음</button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* 인벤토리 (보관함) 영역 */}
      <section data-tour="inventory-list" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center justify-between w-full sm:w-auto">
            <div className="flex min-w-0 items-center gap-2.5">
              <h3 className="text-base font-bold flex items-center gap-2">
                <Layers className="h-4.5 w-4.5 text-primary" /> 나의 카드 보관함 ({inventory.length}장)
              </h3>
              <button
                type="button"
                onClick={() => setBroadcastMode((prev) => !prev)}
                className={`group inline-flex shrink-0 items-center gap-1.5 rounded-full border px-1.5 py-1 text-[10px] font-black shadow-sm transition ${
                  broadcastMode
                    ? 'border-sky-300/70 bg-sky-400/15 text-sky-600 shadow-sky-500/10 dark:border-sky-400/30 dark:bg-sky-400/12 dark:text-sky-200'
                    : 'border-border bg-card/80 text-muted-foreground hover:bg-secondary/70'
                }`}
                aria-pressed={broadcastMode}
                title="방송 모드: 보유 카드를 모두 0성 이미지로 표시합니다"
              >
                <span>방송</span>
                <span className={`relative h-4 w-7 rounded-full transition ${broadcastMode ? 'bg-sky-500' : 'bg-muted-foreground/25'}`}>
                  <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${broadcastMode ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                </span>
              </button>
            </div>
            <div className="flex items-center gap-2 sm:hidden">
              <button
                onClick={handleOpenTrade}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 flex items-center gap-1"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" /> 1:1 교환
              </button>
              <button
                onClick={() => { setHistoryPage(1); setHistoryModalOpen(true); }}
                className="rounded-lg bg-secondary border border-border/80 px-3 py-1.5 text-xs font-bold text-foreground hover:bg-secondary/80 flex items-center gap-1"
              >
                <Clock className="h-3.5 w-3.5" /> 이력
              </button>
            </div>
          </div>

          <div data-tour="inventory-filters" className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto mt-2 sm:mt-0">
            {/* 라이브 상태 필터링 */}
            <select
              value={liveFilter}
              onChange={(e: any) => setLiveFilter(e.target.value)}
              className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
            >
              <option value="all">전체 방송 상태</option>
              <option value="live">🟢 방송 중</option>
              <option value="offline">⚫ 방송 아님</option>
            </select>

            {/* 정렬 방식 필터링 */}
            <select
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
              className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
            >
              <option value="acquired-desc">최신 획득순</option>
              <option value="acquired-asc">과거 획득순</option>
              <option value="name-asc">이름 가나다순</option>
              <option value="name-desc">이름 역순</option>
              <option value="value-desc">가치 높은순</option>
              <option value="value-asc">가치 낮은순</option>
            </select>

            <div className="relative flex-1 sm:flex-initial">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="스트리머 검색"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full sm:w-44 rounded-lg border border-border bg-card pl-8 pr-3 py-1.5 text-xs focus:border-primary focus:outline-none"
              />
            </div>

            <button
              data-tour="inventory-trade-actions"
              onClick={handleOpenTrade}
              className="hidden sm:flex rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 items-center gap-1 shadow-sm"
            >
              <ArrowRightLeft className="h-3.5 w-3.5" /> 교환 제안
            </button>

            <button
              onClick={() => { setHistoryPage(1); setHistoryModalOpen(true); }}
              className="hidden sm:flex rounded-lg bg-secondary border border-border/80 px-3 py-2 text-xs font-bold text-foreground hover:bg-secondary/80 items-center gap-1 shadow-sm"
            >
              <Clock className="h-3.5 w-3.5" /> 교환 이력
            </button>
          </div>
        </div>

        {/* 보관함 카드 그리드 (로딩 중 상태 추가하여 빈 안내 문구 오노출 해결) */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
            <p className="text-xs text-muted-foreground">보유 카드 목록을 불러오는 중입니다...</p>
          </div>
        ) : filteredInventory.length === 0 ? (
          <div className="rounded-2xl border border-border/80 border-dashed py-12 text-center text-xs text-muted-foreground">
            {searchQuery ? '검색된 카드가 없습니다.' : '보유 중인 스트리머 카드가 없습니다. 상단에서 소환을 완료해 주세요!'}
          </div>
        ) : (() => {
          // 중복 카드 그룹화 (채널 ID 기준으로 그룹화)
          // 최신 획득순/정렬 상태에 따라 최초 대표 카드 1장을 정하고, 개수 카운트
          // 채널 + 별 등급 단위로 그룹화 (서로 다른 별은 별도 스택으로 표시·합성)
          interface GroupedCard {
            card: UserCard;
            count: number;
            star: number;
          }
          const groupKey = (card: UserCard) => `${card.channel_id}__${card.star || 0}`;
          const groupedMap: { [key: string]: GroupedCard } = {};

          filteredInventory.forEach(card => {
            const key = groupKey(card);
            if (!groupedMap[key]) {
              groupedMap[key] = { card, count: 1, star: card.star || 0 };
            } else {
              groupedMap[key].count += 1;
            }
          });

          // 원래 정렬 순서를 보존하여 렌더링하기 위해, 정렬 결과 중 처음 나타난 순서대로 배열 변환
          const groupedList: GroupedCard[] = [];
          const seen = new Set<string>();
          filteredInventory.forEach(card => {
            const key = groupKey(card);
            if (!seen.has(key)) {
              seen.add(key);
              groupedList.push(groupedMap[key]);
            }
          });

          return (
            <div className="relative">
              {/* 선택 모드 안내 바 */}
              {selectionMode && (
                <div data-tour="inventory-bulk-actions" className="mb-4 flex items-center justify-between rounded-xl bg-primary/10 border border-primary/20 p-3.5 animate-in slide-in-from-top-3 duration-200">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-primary animate-ping"></span>
                    <span className="text-[0.75rem] font-bold text-foreground">
                      카드를 다중 선택 중입니다 ({selectedCardKeys.length}개 선택됨)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (selectedCardKeys.length === 0) {
                          toast('선택된 카드가 없습니다.');
                          return;
                        }
                        // 선택된 카드 정보 기반으로 일괄 판매 초기화
                        const quantities: { [key: string]: number } = {};
                        selectedCardKeys.forEach(key => {
                          const { channelId, star } = parseCardKey(key);
                          quantities[key] = getCardCountInInventory(channelId, star);
                        });
                        setBulkSellQuantities(quantities);
                        setBulkSellModalOpen(true);
                      }}
                      className="rounded-lg bg-primary px-3 py-1.5 text-[0.7rem] font-extrabold text-primary-foreground hover:bg-primary/95 transition shadow-sm"
                    >
                      선택 카드 일괄판매
                    </button>
                    <button
                      onClick={() => {
                        setSelectedCardKeys([]);
                        setSelectionMode(false);
                      }}
                      className="rounded-lg bg-secondary px-3 py-1.5 text-[0.7rem] font-bold text-muted-foreground hover:bg-secondary/80 transition"
                    >
                      취소
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {groupedList.map(({ card, count, star }) => {
                  const streamer = card.streamer;
                  if (!streamer) return null;

                  const key = cardKey(streamer.channel_id, star);
                  const isSelected = selectedCardKeys.includes(key);
                  const cardValue = Math.round((streamer.base_value || 0) * starMult(star));
                  const owned = inventory.filter(c => c.channel_id === streamer.channel_id && (c.star ?? 0) === star);
                  const avail = getAvailableCount(streamer.channel_id, star);
                  const pendingMarketCount = owned.filter(c => marketPendingCardIds.includes(c.id)).length;

                  // 우클릭 이벤트 핸들러
                  const handleContextMenu = (e: React.MouseEvent) => {
                    e.preventDefault();
                    if (selectionMode) {
                      // 다중 선택 상태일 때의 우클릭 액션: 일괄 판매 모달 바로 트리거
                      const quantities: { [key: string]: number } = {};
                      selectedCardKeys.forEach(selectedKey => {
                        const parsed = parseCardKey(selectedKey);
                        quantities[selectedKey] = getCardCountInInventory(parsed.channelId, parsed.star);
                      });
                      setBulkSellQuantities(quantities);
                      setBulkSellModalOpen(true);
                      return;
                    }
                    const owned = inventory.filter(c => c.channel_id === streamer.channel_id && (c.star ?? 0) === star);
                    const pendingCard = owned.find(c => marketPendingCardIds.includes(c.id));
                    const key = `${streamer.channel_id}#${star}`;
                    const reserved = reservations.cardsByStar[key] || 0;
                    const availableCards = owned.filter(c => !marketPendingCardIds.includes(c.id));
                    const availableCard = availableCards.length > reserved ? availableCards[reserved] : null;

                    const menuPosition = clampContextMenuPosition(e.clientX, e.clientY);
                    setContextMenu({
                      x: menuPosition.x,
                      y: menuPosition.y,
                      open: true,
                      channel_id: streamer.channel_id,
                      star: star,
                      card: availableCard || pendingCard || card
                    });
                  };

                  // 카드 클릭 이벤트 핸들러
                  const handleCardClick = (e: React.MouseEvent) => {
                    if (selectionMode) {
                      e.preventDefault();
                      if (isSelected) {
                        setSelectedCardKeys(selectedCardKeys.filter(selectedKey => selectedKey !== key));
                      } else {
                        setSelectedCardKeys([...selectedCardKeys, key]);
                      }
                    } else {
                      // 롱프레스로 메뉴가 떴다면 직후의 클릭은 무시 (확대 모달이 뜨지 않도록)
                      // 플래그 리셋은 전역 클릭 핸들러에서 처리하여 메뉴가 닫히지 않게 함
                      if (longPressFired.current) return;
                      // 다중 선택 모드가 아닐 때 카드 클릭 시 확대(상세) 카드 모달 오픈 (시세 상세는 우클릭 메뉴)
                      setZoomCard(card);
                    }
                  };

                  // 마우스 및 터치 롱프레스 핸들링 (모바일에서 길게 누르면 우클릭 메뉴 표시)
                  const startPress = (e: React.MouseEvent | React.TouchEvent) => {
                    if ('button' in e && e.button !== 0) return;
                    cancelLongPress();
                    longPressFired.current = false;
                    // 터치/마우스 좌표 추출 (메뉴 위치용)
                    const point = 'touches' in e ? e.touches[0] : (e as React.MouseEvent);
                    if (!point) return;
                    const x = point?.clientX ?? 0;
                    const y = point?.clientY ?? 0;
                    longPressStartPoint.current = {
                      x,
                      y,
                      scrollX: window.scrollX,
                      scrollY: window.scrollY
                    };
                    longPressTimer.current = setTimeout(() => {
                      const startPoint = longPressStartPoint.current;
                      const scrollDistance = startPoint
                        ? Math.hypot(window.scrollX - startPoint.scrollX, window.scrollY - startPoint.scrollY)
                        : 0;
                      if (!startPoint || scrollDistance > LONG_PRESS_CANCEL_DISTANCE) {
                        cancelLongPress();
                        return;
                      }
                      if (selectionMode) {
                        cancelLongPress();
                        return;
                      }
                      longPressFired.current = true;
                      longPressTimer.current = null;
                      const menuPosition = clampContextMenuPosition(x, y);
                      const owned = inventory.filter(c => c.channel_id === streamer.channel_id && (c.star ?? 0) === star);
                      const pendingCard = owned.find(c => marketPendingCardIds.includes(c.id));
                      const key = `${streamer.channel_id}#${star}`;
                      const reserved = reservations.cardsByStar[key] || 0;
                      const availableCards = owned.filter(c => !marketPendingCardIds.includes(c.id));
                      const availableCard = availableCards.length > reserved ? availableCards[reserved] : null;
                      setContextMenu({
                        x: menuPosition.x,
                        y: menuPosition.y,
                        open: true,
                        channel_id: streamer.channel_id,
                        star: star,
                        card: availableCard || pendingCard || card
                      });
                      if (navigator.vibrate) navigator.vibrate(40);
                    }, 500);
                  };

                  const movePress = (e: React.TouchEvent) => {
                    const startPoint = longPressStartPoint.current;
                    const point = e.touches[0];
                    if (!startPoint || !point) return;

                    const touchDistance = Math.hypot(point.clientX - startPoint.x, point.clientY - startPoint.y);
                    const scrollDistance = Math.hypot(window.scrollX - startPoint.scrollX, window.scrollY - startPoint.scrollY);
                    if (touchDistance > LONG_PRESS_CANCEL_DISTANCE || scrollDistance > LONG_PRESS_CANCEL_DISTANCE) {
                      cancelLongPress();
                    }
                  };

                  const endPress = () => {
                    cancelLongPress();
                  };

                  return (
                    <div
                      key={card.id}
                      onContextMenu={handleContextMenu}
                      onClick={handleCardClick}
                      onMouseDown={startPress}
                      onMouseUp={endPress}
                      onMouseLeave={endPress}
                      onTouchStart={startPress}
                      onTouchMove={movePress}
                      onTouchEnd={endPress}
                      onTouchCancel={endPress}
                      style={{
                        containerType: 'inline-size',
                        ...(borderClass(card.border) ? {} : (borderStyle(card.border) || {}))
                      }}
                      className={`group relative flex aspect-[5/8] w-full flex-col justify-between overflow-hidden rounded-xl bg-card shadow-md transition duration-300 hover:-translate-y-1 hover:shadow-lg select-none cursor-pointer border border-border/80 ${star >= 1 ? `card-star card-star-${star}` : ''} ${isSelected ? 'ring-4 ring-primary ring-offset-2 ring-offset-background scale-[0.98]' : ''}`}
                    >
                      {/* 프리미엄 테두리 코스메틱 오버레이 */}
                      <CosmeticFrame border={card.border} />

                      {/* 다중 선택 모드 체크박스 오버레이 */}
                      {selectionMode && (
                        <div className="absolute top-2.5 left-2.5 z-30 flex h-5 w-5 items-center justify-center rounded-md border border-primary bg-background shadow transition">
                          {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                        </div>
                      )}

                      <button
                        data-tour="inventory-favorite-badge"
                        type="button"
                        title={card.favorite_order == null ? '즐겨찾기 고정' : '즐겨찾기 해제'}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          handleToggleFavorite(card);
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                        onTouchStart={(event) => event.stopPropagation()}
                        className={`absolute right-2 top-10 z-30 flex h-8 w-8 items-center justify-center rounded-full border border-white/35 shadow-lg backdrop-blur-md transition-all ${
                          card.favorite_order == null
                            ? 'bg-black/20 text-white/70 opacity-0 hover:scale-110 hover:bg-amber-400/90 hover:text-white group-hover:opacity-100'
                            : 'bg-amber-400 text-white opacity-100 ring-2 ring-white/80'
                        }`}
                      >
                        <Star className={`h-4 w-4 ${card.favorite_order == null ? '' : 'fill-current'}`} />
                      </button>

                      {card.is_hidden && (
                        <span className="absolute left-2 top-10 z-30 inline-flex items-center gap-1 rounded-full border border-white/25 bg-slate-950/55 px-2 py-1 text-[9px] font-black text-white shadow-md backdrop-blur-md">
                          <EyeOff className="h-3 w-3" /> 숨김
                        </span>
                      )}

                      {/* 카드 이미지 배경 */}
                      <div className="absolute inset-0 z-0">
                        <img
                          src={inventoryCardImage(streamer, star)}
                          alt={streamer.name}
                          loading="lazy"
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                        />
                      </div>
                      
                      {/* 하단 그라데이션 오버레이 (카드 테두리(z-10)보다 위에 배치하여 테두리 하단도 어둡게 덮음) */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/15 to-transparent z-15 pointer-events-none"></div>

                      {/* 카드 콘텐츠 패딩 랩퍼 */}
                      <div className="relative z-20 flex h-full w-full flex-col justify-between p-3 pointer-events-none">
                        {/* 카드 상단 정보 */}
                        <div className="flex items-center justify-between w-full pointer-events-auto">
                          {streamer.is_active || (streamer as any).isLive ? (
                            <span className="rounded bg-red-600 px-1.5 py-0.5 text-[8px] font-bold text-white flex items-center gap-0.5 animate-pulse">
                              <span className="h-1 w-1 rounded-full bg-white"></span> LIVE
                            </span>
                          ) : (
                            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[8px] font-bold text-zinc-400">
                              OFFLINE
                            </span>
                          )}

                          <div className="flex items-center gap-1">
                            {pendingMarketCount > 0 && (
                              <span className="rounded bg-sky-500 px-1.5 py-0.5 text-[8px] font-bold text-white flex items-center gap-0.5" title="오픈마켓 판매 중인 수량">
                                🏪 {pendingMarketCount}
                              </span>
                            )}
                            {(count > 1 || avail < count) && (
                              <span className={`rounded px-1.5 py-0.5 text-[8.5px] font-extrabold shadow-sm ${avail === 0 ? 'bg-zinc-700 text-zinc-400' : avail < count ? 'bg-amber-500/90 text-black animate-pulse' : 'bg-primary text-primary-foreground'}`}>
                                {avail}/{count}
                              </span>
                            )}
                            <span className="rounded bg-black/40 px-1.5 py-0.5 text-[8px] font-black text-white/90">
                              No.{String(streamer.serial_number ?? 0).padStart(4, '0')}
                            </span>
                          </div>
                        </div>

                        {/* 카드 하단 정보 */}
                        <div className="space-y-1 text-white block mt-auto pointer-events-auto">
                          {/* 별 등급 표시 */}
                          {star > 0 && (
                            <div className="flex items-center gap-0.5 drop-shadow">
                              {Array.from({ length: star }, (_, i) => (
                                <span key={i} className="text-amber-300 text-[10px] leading-none">★</span>
                              ))}
                            </div>
                          )}
                          <CosmeticName effect={card.name_effect} className="block text-sm font-bold tracking-tight truncate drop-shadow">{streamer.name}</CosmeticName>
                          <p className="text-[8.5px] text-zinc-300 drop-shadow">{(streamer.follower_count || 0).toLocaleString()} 팔로워</p>

                          <div className="flex items-center justify-between border-t border-white/10 pt-1">
                            <span className="text-[8.5px] text-zinc-400">{star > 0 ? `${star}성 가치` : '시세 가치'}</span>
                            <span className="text-xs font-black text-emerald-400">{cardValue.toLocaleString()} P</span>
                          </div>

                          {/* 한계돌파 버튼 (같은 스트리머 카드를 재료로 소모) */}
                          {(() => {
                            if (selectionMode || star >= 5) return null;
                            const canFuse = avail >= 1 && hasFuseMaterial(streamer.channel_id, star);
                            if (!canFuse) return null;
                            return (
                              <button
                                onClick={(e) => { e.stopPropagation(); openFuseModal(card, streamer, star); }}
                                className="mt-1 w-full rounded-md bg-amber-500/90 py-1 text-[9px] font-black text-black hover:bg-amber-400 transition"
                              >
                                ⭐ 한계돌파 강화
                              </button>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </section>

      {/* 한계돌파 강화 모달 */}
      {fuseModal && (() => {
        const { card, streamer, star } = fuseModal;
        const selectedMaterials = getSelectedFuseMaterials();
        const resultStar = calculateFuseResultStar(star, selectedMaterials);
        const selectedCount = selectedMaterials.reduce((sum, material) => sum + material.count, 0);
        const exceedsMax = resultStar > 5;
        const canSubmit = selectedCount > 0 && !exceedsMax && resultStar > star && !fuseBusy;
        const resultValue = Math.round((streamer.base_value || 0) * starMult(Math.min(resultStar, 5)));

        return (
          <div
            className="modal-backdrop modal-backdrop-center z-[90] bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => {
              if (!fuseBusy) {
                setFuseModal(null);
                setFuseMaterials({});
              }
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-[min(94vw,760px)] max-h-[88vh] overflow-y-auto rounded-[2rem] border border-border/80 bg-card p-4 shadow-2xl sm:p-6 animate-in zoom-in-95 duration-200"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.2em] text-primary">Limit Break</p>
                  <h3 className="mt-1 text-xl font-black text-foreground">한계돌파 강화</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    같은 스트리머 카드를 재료로 사용해 별 등급을 올립니다. 결과는 최대 5성을 넘을 수 없습니다.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!fuseBusy) {
                      setFuseModal(null);
                      setFuseMaterials({});
                    }
                  }}
                  className="rounded-full border border-border bg-background/80 p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  disabled={fuseBusy}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid gap-5 md:grid-cols-[240px,1fr]">
                <div className="rounded-[1.5rem] border border-border/70 bg-muted/30 p-4">
                  <p className="mb-3 text-center text-xs font-black text-foreground">결과 미리보기</p>
                  <div className="mx-auto w-40">
                    <div
                      style={{
                        height: '256px',
                        containerType: 'inline-size',
                        ...(borderClass(card.border) ? {} : (borderStyle(card.border) || {}))
                      }}
                      className={`relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xl ${resultStar >= 1 && resultStar <= 5 ? `card-star card-star-${resultStar}` : ''}`}
                    >
                      <CosmeticFrame border={card.border} />
                      <div className="absolute inset-0 z-0 flex items-center justify-center bg-gradient-to-br from-slate-200 via-slate-300 to-slate-400 text-7xl font-black text-slate-500 dark:from-slate-700 dark:via-slate-800 dark:to-slate-950 dark:text-slate-500">
                        ?
                      </div>
                      <div className="absolute inset-0 z-10 bg-gradient-to-t from-black/85 via-black/15 to-transparent pointer-events-none" />
                      <div className="relative z-20 flex h-full flex-col justify-between p-3 text-white">
                        <div className="flex justify-end">
                          <span className="rounded bg-black/45 px-1.5 py-0.5 text-[8px] font-black text-white/90">
                            No.{String(streamer.serial_number ?? 0).padStart(4, '0')}
                          </span>
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-0.5 drop-shadow">
                            {Array.from({ length: Math.max(0, Math.min(resultStar, 5)) }, (_, i) => (
                              <span key={i} className="text-amber-300 text-[11px] leading-none">★</span>
                            ))}
                          </div>
                          <CosmeticName effect={card.name_effect} className="block truncate text-sm font-black drop-shadow">
                            {streamer.name}
                          </CosmeticName>
                          <div className="flex items-center justify-between border-t border-white/15 pt-1">
                            <span className="text-[8.5px] text-zinc-300">예상 가치</span>
                            <span className="text-xs font-black text-emerald-300">{resultValue.toLocaleString()} P</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 rounded-2xl bg-background/75 p-3 text-center">
                    <p className="text-xs font-black text-foreground">
                      {star}성 → <span className={exceedsMax ? 'text-destructive' : 'text-primary'}>{resultStar}성</span>
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">일러스트는 한계돌파 완료 후 공개됩니다.</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="rounded-[1.5rem] border border-primary/20 bg-primary/5 p-3">
                    <p className="text-sm font-black text-foreground">{streamer.name} {star}성 카드 강화</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      같은 별의 카드를 재료로 쓸 때는 대상 카드 1장을 제외한 수량만 선택할 수 있습니다.
                    </p>
                  </div>

                  <div className="space-y-2">
                    {FUSE_STARS.map((materialStar) => {
                      const max = getFuseMaterialMax(streamer.channel_id, star, materialStar);
                      const current = fuseMaterials[materialStar] || 0;
                      return (
                        <div
                          key={materialStar}
                          className={`flex items-center justify-between gap-3 rounded-2xl border p-3 transition ${
                            max > 0 ? 'border-border bg-background/80' : 'border-border/50 bg-muted/35 opacity-60'
                          }`}
                        >
                          <div>
                            <p className="text-sm font-black text-foreground">{materialStar}성 재료</p>
                            <p className="text-[11px] text-muted-foreground">
                              사용 가능 {max.toLocaleString()}장 · 1장당 +{fuseMaterialGain(materialStar)}성
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => adjustFuseMaterial(materialStar, -1)}
                              disabled={current <= 0 || fuseBusy}
                              className="h-8 w-8 rounded-full border border-border bg-muted text-sm font-black text-foreground transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min={0}
                              max={max}
                              value={current}
                              disabled={max <= 0 || fuseBusy}
                              onChange={(e) => {
                                const nextValue = Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0)));
                                setFuseMaterials((prev) => {
                                  const next = { ...prev };
                                  if (nextValue <= 0) delete next[materialStar];
                                  else next[materialStar] = nextValue;
                                  return next;
                                });
                              }}
                              className="h-8 w-16 rounded-xl border border-border bg-card text-center text-sm font-black text-foreground outline-none focus:border-primary"
                            />
                            <button
                              type="button"
                              onClick={() => adjustFuseMaterial(materialStar, 1)}
                              disabled={current >= max || fuseBusy}
                              className="h-8 w-8 rounded-full border border-border bg-muted text-sm font-black text-foreground transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {(selectedCount === 0 || exceedsMax) && (
                    <div className={`rounded-2xl border p-3 text-xs font-bold leading-relaxed ${
                      exceedsMax
                        ? 'border-destructive/30 bg-destructive/10 text-destructive'
                        : 'border-amber-400/30 bg-amber-400/10 text-amber-700 dark:text-amber-200'
                    }`}>
                      {exceedsMax
                        ? `현재 선택은 ${resultStar}성이 되어 최고 등급(5성)을 초과합니다. 재료 수량을 줄여 주세요.`
                        : '한계돌파에 사용할 재료 카드를 선택해 주세요.'}
                    </div>
                  )}

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => handleFuse(streamer.channel_id, star, selectedMaterials)}
                      disabled={!canSubmit}
                      className="flex-1 rounded-2xl bg-primary px-4 py-3 text-sm font-black text-primary-foreground shadow-lg shadow-primary/20 transition hover:scale-[1.01] hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
                    >
                      {fuseBusy ? '한계돌파 중...' : `${Math.min(resultStar, 5)}성으로 한계돌파`}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!fuseBusy) {
                          setFuseModal(null);
                          setFuseMaterials({});
                        }
                      }}
                      disabled={fuseBusy}
                      className="rounded-2xl border border-border bg-background px-4 py-3 text-sm font-black text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      취소
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 카드 확대(상세) 모달 — 카드 외 영역 클릭 시 닫힘 */}
      {zoomCard && (() => {
        const live = inventory.find((c) => c.id === zoomCard.id) || zoomCard;
        const s = live.streamer;
        if (!s) return null;
        const star = live.star || 0;
        const value = Math.round((s.base_value || 0) * starMult(star));
        return (
          <div
            className="modal-backdrop modal-backdrop-center z-[80] bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => setZoomCard(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '224px',
                height: '358.4px',
                transform: 'scale(min(calc(82vh / 358.4px), calc(92vw / 224px)))',
                transformOrigin: 'center',
              }}
              className="animate-in zoom-in-95 duration-200"
            >
              <CometCard rotateDepth={8} translateDepth={10} className="h-full w-full">
                <div
                  style={{
                    width: '224px',
                    height: '358.4px',
                    containerType: 'inline-size',
                    ...(borderClass(live.border) ? {} : (borderStyle(live.border) || {}))
                  }}
                  className={`relative flex flex-col justify-between overflow-hidden rounded-xl bg-card shadow-2xl border border-border/80 animate-in zoom-in-95 duration-200 ${star >= 1 ? `card-star card-star-${star}` : ''}`}
                >
                  {/* 프리미엄 테두리 코스메틱 오버레이 */}
                  <CosmeticFrame border={live.border} />

                  {/* 카드 이미지 배경 */}
                  <div className="absolute inset-0 z-0">
                    <img src={inventoryCardImage(s, star)} alt={s.name} className="h-full w-full object-cover" />
                  </div>
                  
                  {/* 하단 그라데이션 오버레이 (카드 테두리(z-10)보다 위에 배치하여 테두리 하단도 어둡게 덮음) */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/15 to-transparent z-15 pointer-events-none"></div>

                  {/* 카드 콘텐츠 패딩 랩퍼 */}
                  <div className="relative z-20 flex h-full w-full flex-col justify-between p-3 pointer-events-none">
                    {/* 상단 정보 */}
                    <div className="flex items-center justify-between w-full pointer-events-auto">
                      {s.is_active || (s as any).isLive ? (
                        <span className="rounded bg-red-600 px-1.5 py-0.5 text-[8px] font-bold text-white flex items-center gap-0.5 animate-pulse">
                          <span className="h-1 w-1 rounded-full bg-white"></span> LIVE
                        </span>
                      ) : (
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[8px] font-bold text-zinc-400">OFFLINE</span>
                      )}
                      <span className="rounded bg-black/40 px-1.5 py-0.5 text-[8px] font-black text-white/90">
                        No.{String(s.serial_number ?? 0).padStart(4, '0')}
                      </span>
                    </div>

                    {/* 하단 정보 */}
                    <div className="space-y-1 text-white block mt-auto pointer-events-auto">
                      {star > 0 && (
                        <div className="flex items-center gap-0.5 drop-shadow">
                          {Array.from({ length: star }, (_, i) => (
                            <span key={i} className="text-amber-300 text-[10px] leading-none">★</span>
                          ))}
                        </div>
                      )}
                      <CosmeticName effect={live.name_effect} className="block text-sm font-bold tracking-tight truncate drop-shadow">{s.name}</CosmeticName>
                      <p className="text-[8.5px] text-zinc-300 drop-shadow">{(s.follower_count || 0).toLocaleString()} 팔로워</p>
                      <div className="flex items-center justify-between border-t border-white/10 pt-1">
                        <span className="text-[8.5px] text-zinc-400">{star > 0 ? `${star}성 가치` : '시세 가치'}</span>
                        <span className="text-xs font-black text-emerald-400">{value.toLocaleString()} P</span>
                      </div>
                    </div>
                  </div>
                </div>
              </CometCard>
            </div>
          </div>
        );
      })()}

      {/* 우클릭 컨텍스트 메뉴 오버레이 */}
      {contextMenu.open && (() => {
        const channelId = contextMenu.channel_id;
        const star = contextMenu.star;
        const owned = inventory.filter(c => c.channel_id === channelId && (c.star ?? 0) === star);
        const pendingCard = owned.find(c => marketPendingCardIds.includes(c.id));
        
        // 가용한 카드 찾기
        const key = `${channelId}#${star}`;
        const reserved = reservations.cardsByStar[key] || 0;
        const availableCards = owned.filter(c => !marketPendingCardIds.includes(c.id));
        const availableCard = availableCards.length > reserved ? availableCards[reserved] : null;

        // 대표로 사용할 카드 객체
        const displayCard = availableCard || pendingCard || contextMenu.card;
        if (!displayCard) return null;

        return (
          <div
            ref={contextMenuRef}
            className="fixed z-50 max-h-[calc(100dvh-1rem)] w-52 max-w-[calc(100dvw-1rem)] overflow-x-hidden overflow-y-auto rounded-xl border border-border bg-card/95 py-1.5 shadow-xl backdrop-blur-md animate-in fade-in duration-100"
            style={{
              left: `${contextMenu.x}px`,
              top: `${contextMenu.y}px`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                if (displayCard.streamer) openStreamerDetail(displayCard.streamer.channel_id);
                setContextMenu(prev => ({ ...prev, open: false }));
              }}
              className="w-full text-left px-4 py-2 text-xs font-bold text-foreground hover:bg-secondary/80 flex items-center gap-2"
            >
              📈 스트리머 시세 상세
            </button>
            <button
              onClick={() => {
                if (displayCard.streamer) {
                  const targetUrl = displayCard.streamer.is_active
                    ? `https://chzzk.naver.com/live/${displayCard.streamer.channel_id}`
                    : `https://chzzk.naver.com/${displayCard.streamer.channel_id}`;
                  window.open(targetUrl, '_blank');
                }
                setContextMenu(prev => ({ ...prev, open: false }));
              }}
              className="w-full text-left px-4 py-2 text-xs font-bold text-foreground hover:bg-secondary/80 flex items-center gap-2"
            >
              📺 스트리머 채널 이동
            </button>
            <button
              onClick={() => {
                if (displayCard.streamer) {
                  setSelectionMode(true);
                  setSelectedCardKeys([cardKey(displayCard.streamer.channel_id, displayCard.star || 0)]);
                }
                setContextMenu(prev => ({ ...prev, open: false }));
              }}
              className="w-full text-left px-4 py-2 text-xs font-bold text-foreground hover:bg-secondary/80 flex items-center gap-2"
              >
                ✔️ 다중 선택 모드
              </button>
            <button
              onClick={() => {
                handleToggleFavorite(displayCard);
                setContextMenu(prev => ({ ...prev, open: false }));
              }}
              className="w-full text-left px-4 py-2 text-xs font-bold text-foreground hover:bg-secondary/80 flex items-center gap-2"
            >
              {displayCard.favorite_order == null ? '⭐ 즐겨찾기 고정' : '☆ 즐겨찾기 해제'}
            </button>
            <button
              onClick={() => {
                handleToggleHidden(displayCard);
                setContextMenu(prev => ({ ...prev, open: false }));
              }}
              className="w-full text-left px-4 py-2 text-xs font-bold text-foreground hover:bg-secondary/80 flex items-center gap-2"
            >
              {displayCard.is_hidden ? '👁️ 외부 공개 켜기' : '🙈 외부 공개 숨기기'}
            </button>
            <button
              onClick={() => {
                if (!availableCard) {
                  showAlert('작업 불가', '가용한 카드가 없습니다. (판매 중이거나 교환 예약됨)', 'warning');
                } else {
                  setEquipCard(availableCard);
                }
                setContextMenu(prev => ({ ...prev, open: false }));
              }}
              className={`w-full text-left px-4 py-2 text-xs font-bold flex items-center gap-2 ${!availableCard ? 'text-zinc-500 cursor-not-allowed opacity-55' : 'text-foreground hover:bg-secondary/80'}`}
            >
              🎨 코스메틱 장착
            </button>
            <button
              onClick={() => {
                if (!availableCard) {
                  showAlert('작업 불가', '가용한 카드가 없습니다. (판매 중이거나 교환 예약됨)', 'warning');
                } else {
                  setSellingStreamer(displayCard.streamer || null);
                  setSellingStar(displayCard.star || 0);
                  setSellQuantity(1);
                  setSellModalOpen(true);
                }
                setContextMenu(prev => ({ ...prev, open: false }));
              }}
              className={`w-full text-left px-4 py-2 text-xs font-bold flex items-center gap-2 ${!availableCard ? 'text-zinc-500 cursor-not-allowed opacity-55' : 'text-foreground hover:bg-secondary/80'}`}
            >
              💰 카드 판매하기
            </button>

            {availableCard && (
              <button
                onClick={() => {
                  setMarketRegisterCard(availableCard);
                  setMarketPriceInput('');
                  setMarketListingType('fixed');
                  setMarketStartingBidInput('');
                  setMarketAuctionHours(24);
                  setWithCosmetics(false);
                  setContextMenu(prev => ({ ...prev, open: false }));
                }}
                className="w-full text-left px-4 py-2 text-xs font-bold text-foreground hover:bg-secondary/80 flex items-center gap-2"
              >
                🏪 마켓 판매 등록
              </button>
            )}

            {pendingCard && (
              <button
                onClick={() => {
                  handleMarketCancel(pendingCard.id);
                  setContextMenu(prev => ({ ...prev, open: false }));
                }}
                disabled={marketCancelBusy}
                className="w-full text-left px-4 py-2 text-xs font-bold text-rose-500 hover:bg-rose-500/10 flex items-center gap-2"
              >
                🏪 마켓 판매 취소
              </button>
            )}

            <button
              onClick={() => {
                if (displayCard) openReport(displayCard);
                setContextMenu(prev => ({ ...prev, open: false }));
              }}
              className="w-full text-left px-4 py-2 text-xs font-bold text-red-500 hover:bg-red-500/10 flex items-center gap-2 border-t border-border/50"
            >
              🚩 이미지 신고
            </button>
          </div>
        );
      })()}

      {/* 이미지 신고 모달 (자기완결형 컴포넌트로 분리) */}
      {reportCard && (
        <ReportCardModal card={reportCard} onClose={() => setReportCard(null)} onResult={showAlert} />
      )}

      {/* 코스메틱 장착 모달 */}
      {equipCard && (() => {
        const live = inventory.find((c) => c.id === equipCard.id) || equipCard;
        const borders = myCosmetics.filter((m) => m.type === 'border');
        const effects = myCosmetics.filter((m) => m.type === 'name_effect');
        const renderSlot = (type: 'border' | 'name_effect', label: string, equipped: any, items: any[]) => (
          <div className="rounded-xl border border-border bg-secondary/20 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold">{label}</p>
              {equipped && (
                <button onClick={() => handleUnequip(live.id, type)} className="text-[10px] font-bold text-rose-500 hover:underline">해제(반환)</button>
              )}
            </div>
            {items.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">보유한 {label}이(가) 없습니다. 상점에서 구매하세요.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 max-h-40 overflow-y-auto pr-1">
                {items.map((it) => {
                  const isOn = equipped?.id === it.id;
                  return (
                    <button key={it.id} onClick={() => handleEquip(live.id, it.id)}
                      className={`rounded-lg border p-2 flex flex-col items-center gap-1 transition ${isOn ? 'border-primary ring-2 ring-primary/30' : 'border-border/60 hover:bg-secondary/50'}`}>
                      {type === 'border'
                        ? <div className="relative overflow-hidden rounded bg-card border border-border/80" style={{ width: '32px', height: '51.2px' }}>
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
                              ...(borderClass(it) ? {} : (borderStyle(it) || {}))
                            }}>
                              <CosmeticFrame border={it} />
                            </div>
                          </div>
                        : <CosmeticName effect={it} className="text-sm font-black truncate max-w-full">{it.name}</CosmeticName>}
                      <span className="text-[9px] text-muted-foreground truncate max-w-full">{it.name} ×{it.quantity}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
        return (
          <div className="modal-backdrop z-[80] bg-black/60 backdrop-blur-sm" onClick={() => setEquipCard(null)}>
            <div className="modal-panel modal-panel-md modal-panel-scroll rounded-2xl border border-border bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-200 sm:p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <h3 className="text-base font-bold">코스메틱 장착</h3>
                <button onClick={() => setEquipCard(null)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
              </div>
              {/* 카드 미리보기 */}
              <div className="mt-4 flex justify-center">
                <div style={{ width: '112px', height: '179.2px', position: 'relative', overflow: 'hidden' }}>
                  <div style={{
                    width: '224px',
                    height: '358.4px',
                    transform: 'scale(0.5)',
                    transformOrigin: 'top left',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    containerType: 'inline-size',
                    ...(borderClass(live.border) ? {} : (borderStyle(live.border) || {}))
                  }}
                    className={`relative flex flex-col justify-between overflow-hidden rounded-xl bg-card shadow-md border border-border/80 ${(live.star || 0) >= 1 ? `card-star card-star-${live.star}` : ''}`}
                  >
                    <CosmeticFrame border={live.border} />
                    <div className="absolute inset-0 z-0">
                      <img src={inventoryCardImage(live.streamer, live.star || 0)} alt={live.streamer?.name} className="h-full w-full object-cover opacity-80" />
                    </div>
                    
                    {/* 하단 그라데이션 오버레이 (카드 테두리(z-10)보다 위에 배치하여 테두리 하단도 어둡게 덮음) */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/15 to-transparent z-15 pointer-events-none"></div>

                    {/* 카드 콘텐츠 패딩 랩퍼 */}
                    <div className="relative z-20 flex h-full w-full flex-col justify-between p-3 pointer-events-none">
                      {/* 카드 상단 정보 */}
                      <div className="flex items-center justify-between w-full pointer-events-auto">
                        {live.streamer?.is_active || (live.streamer as any)?.isLive ? (
                          <span className="rounded bg-red-600 px-1.5 py-0.5 text-[8px] font-bold text-white flex items-center gap-0.5 animate-pulse">
                            <span className="h-1 w-1 rounded-full bg-white"></span> LIVE
                          </span>
                        ) : (
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[8px] font-bold text-zinc-400">OFFLINE</span>
                        )}
                        <span className="rounded bg-black/40 px-1.5 py-0.5 text-[8px] font-black text-white/90">
                          No.{String(live.streamer?.serial_number ?? 0).padStart(4, '0')}
                        </span>
                      </div>

                      {/* 카드 하단 정보 */}
                      <div className="space-y-1 text-white block mt-auto pointer-events-auto">
                        {(live.star || 0) > 0 && (
                          <div className="flex items-center gap-0.5 drop-shadow">
                            {Array.from({ length: live.star || 0 }, (_, i) => (
                              <span key={i} className="text-amber-300 text-[10px] leading-none">★</span>
                            ))}
                          </div>
                        )}
                        <CosmeticName effect={live.name_effect} className="block text-sm font-bold tracking-tight truncate drop-shadow">{live.streamer?.name}</CosmeticName>
                        <p className="text-[8.5px] text-zinc-300 drop-shadow">{(live.streamer?.follower_count || 0).toLocaleString()} 팔로워</p>
                        <div className="flex items-center justify-between border-t border-white/10 pt-1">
                          <span className="text-[8.5px] text-zinc-400">{(live.star || 0) > 0 ? `${live.star}성 가치` : '시세 가치'}</span>
                          <span className="text-xs font-black text-emerald-400">{Math.round((live.streamer?.base_value || 0) * starMult(live.star || 0)).toLocaleString()} P</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {renderSlot('border', '테두리', live.border, borders)}
                {renderSlot('name_effect', '이름 이펙트', live.name_effect, effects)}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 단일 판매 설정 모달 */}
      {sellModalOpen && sellingStreamer && (
        <div className="modal-backdrop modal-backdrop-center z-[80] bg-black/60 backdrop-blur-sm">
          <div className="modal-panel modal-panel-sm modal-panel-scroll rounded-2xl border border-border bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-200 sm:p-6">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2 border-b border-border/60 pb-3">
              💰 카드 시스템 판매
            </h3>

            <div className="mt-4 flex items-center gap-4 bg-secondary/30 p-3.5 rounded-xl border border-border/50">
              <img
                src={inventoryCardImage(sellingStreamer, sellingStar)}
                alt={sellingStreamer.name}
                className="h-12 w-12 rounded-full border border-border/80 object-cover"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-black text-foreground truncate">{sellingStreamer.name}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {sellingStar}성 보유량: <span className="font-bold text-foreground">{getCardCountInInventory(sellingStreamer.channel_id, sellingStar)}</span>장
                </p>
                <p className="text-[10px] text-emerald-500 font-bold mt-0.5">
                  개당 시세: {Math.round(sellingStreamer.base_value * starMult(sellingStar)).toLocaleString()} P
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground">판매 수량 설정</label>
              <div className="flex items-center gap-2">
                <button
                  disabled={sellQuantity <= 1}
                  onClick={() => setSellQuantity(prev => prev - 1)}
                  className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-foreground disabled:opacity-40"
                >
                  -
                </button>
                <input
                  type="number"
                  min="1"
                  max={getCardCountInInventory(sellingStreamer.channel_id, sellingStar)}
                  value={sellQuantity}
                  onChange={(e) => {
                    const val = Math.max(1, Math.min(getCardCountInInventory(sellingStreamer.channel_id, sellingStar), Number(e.target.value) || 1));
                    setSellQuantity(val);
                  }}
                  className="w-16 text-center rounded-lg border border-border bg-secondary/50 px-2 py-1 text-xs font-bold focus:outline-none"
                />
                <button
                  disabled={sellQuantity >= getCardCountInInventory(sellingStreamer.channel_id, sellingStar)}
                  onClick={() => setSellQuantity(prev => prev + 1)}
                  className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-foreground disabled:opacity-40"
                >
                  +
                </button>
                <button
                  onClick={() => setSellQuantity(getCardCountInInventory(sellingStreamer.channel_id, sellingStar))}
                  className="ml-auto rounded-lg bg-secondary border border-border px-2.5 py-1.5 text-[9.5px] font-bold text-foreground hover:bg-secondary/80"
                >
                  최대
                </button>
              </div>
            </div>

            <div className="mt-4 border-t border-border/50 pt-3 flex items-center justify-between text-xs">
              <span className="font-bold text-muted-foreground">예상 획득 포인트</span>
              <span className="font-black text-emerald-500 text-sm">
                {(Math.round(sellingStreamer.base_value * starMult(sellingStar)) * sellQuantity).toLocaleString()} P
              </span>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setSellModalOpen(false);
                  setSellingStreamer(null);
                  setSellingStar(0);
                }}
                className="rounded-lg bg-secondary px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-secondary/80"
              >
                취소
              </button>
              <button
                onClick={() => setSellConfirmOpen(true)}
                className="rounded-lg bg-primary px-5 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 shadow-sm"
              >
                판매하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 단일 판매 확인 모달 */}
      {sellConfirmOpen && sellingStreamer && (
        <div className="modal-backdrop modal-backdrop-center z-[90] bg-black/75 backdrop-blur-sm">
          <div className="modal-panel modal-panel-sm modal-panel-scroll rounded-2xl border border-border bg-card p-5 text-center shadow-2xl animate-in zoom-in-95 duration-200 sm:p-6">
            <h4 className="text-sm font-black text-foreground mb-3">⚠️ 판매 최종 확인</h4>
            <div className="text-xs text-muted-foreground leading-relaxed py-2">
              정말로 <strong className="text-foreground">{sellingStreamer.name}</strong> 카드{' '}
              <strong className="text-primary font-bold">{sellingStar}성 {sellQuantity}장</strong>을 판매하시겠습니까?
              <p className="mt-2 text-foreground font-semibold">
                획득 예정 포인트: <span className="text-emerald-500 font-extrabold">{(Math.round(sellingStreamer.base_value * starMult(sellingStar)) * sellQuantity).toLocaleString()} P</span>
              </p>
              <p className="text-[10px] text-red-500/80 mt-1">※ 판매 완료된 카드는 되돌릴 수 없습니다.</p>
            </div>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={() => setSellConfirmOpen(false)}
                className="w-1/2 rounded-lg bg-secondary py-2 text-xs font-bold text-muted-foreground hover:bg-secondary/85"
              >
                돌아가기
              </button>
              <button
                onClick={executeSell}
                className="w-1/2 rounded-lg bg-primary py-2 text-xs font-bold text-primary-foreground hover:bg-primary/95"
              >
                수락 및 판매 완료
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 일괄 판매 설정 모달 */}
      {bulkSellModalOpen && (
        <div className="modal-backdrop z-[80] bg-black/60 backdrop-blur-sm">
          <div className="modal-panel modal-panel-md modal-panel-scroll rounded-2xl border border-border bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-200 sm:p-6">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2 border-b border-border/60 pb-3">
              💰 선택 카드 일괄 판매 설정
            </h3>

            <div className="mt-4 space-y-3.5 max-h-60 overflow-y-auto pr-1">
              {Object.entries(bulkSellQuantities).map(([key, count]) => {
                const card = getCardByKey(key);
                if (!card?.streamer) return null;
                const { channelId, star } = parseCardKey(key);
                const streamer = card.streamer;
                const maxCount = getCardCountInInventory(channelId, star);

                return (
                  <div key={key} className="flex items-center justify-between gap-3 bg-secondary/30 p-2.5 rounded-xl border border-border/50">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <img
                        src={inventoryCardImage(streamer, star)}
                        alt={streamer.name}
                        className="h-8 w-8 rounded-full border border-border/60 object-cover"
                      />
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-foreground truncate">{streamer.name}</p>
                        <p className="text-[9px] text-muted-foreground">{star}성 보유: {maxCount}장</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        disabled={count <= 0}
                        onClick={() => {
                          setBulkSellQuantities(prev => ({ ...prev, [key]: Math.max(0, count - 1) }));
                        }}
                        className="h-6 w-6 rounded bg-secondary flex items-center justify-center text-xs font-bold disabled:opacity-40"
                      >
                        -
                      </button>
                      <span className="w-8 text-center text-xs font-bold text-foreground">
                        {count}
                      </span>
                      <button
                        disabled={count >= maxCount}
                        onClick={() => {
                          setBulkSellQuantities(prev => ({ ...prev, [key]: Math.min(maxCount, count + 1) }));
                        }}
                        className="h-6 w-6 rounded bg-secondary flex items-center justify-center text-xs font-bold disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 border-t border-border/50 pt-3 flex items-center justify-between text-xs">
              <span className="font-bold text-muted-foreground">총 예상 획득 포인트</span>
              <span className="font-black text-emerald-500 text-sm">
                {Object.entries(bulkSellQuantities).reduce((acc, [key, count]) => {
                  const card = getCardByKey(key);
                  const star = parseCardKey(key).star;
                  return acc + (card?.streamer ? Math.round(card.streamer.base_value * starMult(star)) * count : 0);
                }, 0).toLocaleString()} P
              </span>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={() => setBulkSellModalOpen(false)}
                className="rounded-lg bg-secondary px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-secondary/80"
              >
                취소
              </button>
              <button
                onClick={() => {
                  const totalCount = Object.values(bulkSellQuantities).reduce((a, b) => a + b, 0);
                  if (totalCount === 0) {
                    toast('판매할 카드가 1개 이상 존재해야 합니다.');
                    return;
                  }
                  setBulkSellConfirmOpen(true);
                }}
                className="rounded-lg bg-primary px-5 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 shadow-sm"
              >
                판매 진행
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 일괄 판매 확인 모달 */}
      {bulkSellConfirmOpen && (
        <div className="modal-backdrop modal-backdrop-center z-[90] bg-black/75 backdrop-blur-sm">
          <div className="modal-panel modal-panel-sm modal-panel-scroll rounded-2xl border border-border bg-card p-5 text-center shadow-2xl animate-in zoom-in-95 duration-200 sm:p-6">
            <h4 className="text-sm font-black text-foreground mb-3">⚠️ 일괄 판매 최종 확인</h4>
            <div className="text-xs text-muted-foreground leading-relaxed py-2">
              선택한 스트리머 카드 총 <strong className="text-primary font-bold">
                {Object.values(bulkSellQuantities).reduce((a, b) => a + b, 0)}장
              </strong>을 일괄 판매하시겠습니까?
              <p className="mt-2 text-foreground font-semibold">
                총 획득 예정 포인트: <span className="text-emerald-500 font-extrabold">
                  {Object.entries(bulkSellQuantities).reduce((acc, [key, count]) => {
                    const card = getCardByKey(key);
                    const star = parseCardKey(key).star;
                    return acc + (card?.streamer ? Math.round(card.streamer.base_value * starMult(star)) * count : 0);
                  }, 0).toLocaleString()} P
                </span>
              </p>
              <p className="text-[10px] text-red-500/80 mt-1">※ 판매 완료된 카드는 되돌릴 수 없습니다.</p>
            </div>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={() => setBulkSellConfirmOpen(false)}
                className="w-1/2 rounded-lg bg-secondary py-2 text-xs font-bold text-muted-foreground hover:bg-secondary/85"
              >
                돌아가기
              </button>
              <button
                onClick={executeBulkSell}
                className="w-1/2 rounded-lg bg-primary py-2 text-xs font-bold text-primary-foreground hover:bg-primary/95"
              >
                수락 및 일괄 판매 완료
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 오픈마켓 판매 등록 가격 입력 모달 */}
      {marketRegisterCard && (() => {
        const streamer = marketRegisterCard.streamer;
        if (!streamer) return null;
        const star = marketRegisterCard.star || 0;
        const baseVal = streamer.base_value || 0;
        const cardVal = Math.round(baseVal * starMult(star));
        const buyNowPrice = Math.floor(Number(marketPriceInput)) || 0;
        const startingBid = Math.floor(Number(marketStartingBidInput)) || 0;
        const settlementBase = marketListingType === 'auction' ? Math.max(startingBid, buyNowPrice || startingBid) : buyNowPrice;
        const feeRate = marketListingType === 'auction' ? getAuctionFeeRate(marketAuctionHours) : FIXED_MARKET_FEE_RATE;
        const { fee, settlement } = calculateMarketFee(settlementBase, feeRate);

        return (
          <div className="modal-backdrop modal-backdrop-center z-[80] bg-black/60 backdrop-blur-sm" onClick={() => setMarketRegisterCard(null)}>
            <div className="modal-panel modal-panel-sm modal-panel-scroll rounded-2xl border border-border bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-200 sm:p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                  🏪 오픈마켓 카드 등록
                </h3>
                <button onClick={() => setMarketRegisterCard(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 flex items-center gap-4 bg-secondary/30 p-3.5 rounded-xl border border-border/50">
                <div style={{ width: '48px', height: '76.8px', position: 'relative', overflow: 'hidden' }} className="shrink-0 rounded-lg">
                  <div style={{
                    width: '224px',
                    height: '358.4px',
                    transform: 'scale(calc(48 / 224))',
                    transformOrigin: 'top left',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    containerType: 'inline-size',
                    ...(borderClass(marketRegisterCard.border) ? {} : (borderStyle(marketRegisterCard.border) || {}))
                  }}
                    className={`relative flex flex-col justify-between overflow-hidden rounded-xl bg-card shadow-md border border-border/80 ${star >= 1 ? `card-star card-star-${star}` : ''}`}
                  >
                    <CosmeticFrame border={marketRegisterCard.border} />
                    <div className="absolute inset-0 z-0">
                      <img src={inventoryCardImage(streamer, star)} alt={streamer.name} className="h-full w-full object-cover opacity-80" />
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/15 to-transparent z-15 pointer-events-none"></div>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black text-foreground truncate">
                    <CosmeticName effect={marketRegisterCard.name_effect}>{streamer.name}</CosmeticName>
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    No.{String(streamer.serial_number ?? 0).padStart(4, '0')} · {star}성 카드
                  </p>
                  <p className="text-[10px] text-emerald-500 font-bold mt-0.5">
                    시세 가치: {cardVal.toLocaleString()} P
                  </p>
                </div>
              </div>

              <form onSubmit={handleMarketRegisterSubmit} className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-2 rounded-2xl bg-secondary/30 p-1.5">
                  {([
                    ['fixed', '즉시 판매'],
                    ['auction', '경매 판매']
                  ] as const).map(([type, label]) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setMarketListingType(type)}
                      className={`rounded-xl px-3 py-2 text-xs font-black transition ${
                        marketListingType === type
                          ? 'bg-card text-primary shadow-sm ring-1 ring-primary/20'
                          : 'text-muted-foreground hover:bg-card/60 hover:text-foreground'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {marketListingType === 'auction' && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-muted-foreground">경매 시작가 (최소 100 P)</label>
                      <div className="relative">
                        <input
                          type="number"
                          min="100"
                          value={marketStartingBidInput}
                          onChange={(e) => setMarketStartingBidInput(e.target.value)}
                          className="w-full rounded-lg border border-border bg-secondary/50 pl-3 pr-8 py-2 text-xs font-bold focus:border-primary focus:outline-none"
                          placeholder="시작가"
                          required
                        />
                        <span className="absolute right-3 top-2.5 text-xs font-bold text-muted-foreground">P</span>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-muted-foreground">진행 시간</label>
                      <select
                        value={marketAuctionHours}
                        onChange={(e) => setMarketAuctionHours(Number(e.target.value))}
                        className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs font-bold focus:border-primary focus:outline-none"
                      >
                        {[1, 2, 3, 6, 12, 24, 48, 72].map((hour) => (
                          <option key={hour} value={hour}>{hour}시간 · 수수료 {getAuctionFeeRate(hour)}%</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted-foreground">
                    {marketListingType === 'auction' ? '즉시 구매가 (선택, 비우면 입찰만 가능)' : '판매 희망 가격 (최소 100 P)'}
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      min={marketListingType === 'auction' ? 0 : 100}
                      value={marketPriceInput}
                      onChange={(e) => setMarketPriceInput(e.target.value)}
                      className="w-full rounded-lg border border-border bg-secondary/50 pl-3 pr-8 py-2 text-xs font-bold focus:border-primary focus:outline-none"
                      placeholder={marketListingType === 'auction' ? '즉시 구매가' : '가격을 입력하세요'}
                      required={marketListingType === 'fixed'}
                    />
                    <span className="absolute right-3 top-2.5 text-xs font-bold text-muted-foreground">P</span>
                  </div>
                </div>

                {/* 코스메틱 패키지 거래 체크박스 */}
                {(() => {
                  const hasCosmetics = !!(marketRegisterCard.border || marketRegisterCard.name_effect);
                  return (
                    <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-secondary/20 p-2.5">
                      <input
                        type="checkbox"
                        id="withCosmetics"
                        checked={withCosmetics}
                        disabled={!hasCosmetics}
                        onChange={(e) => setWithCosmetics(e.target.checked)}
                        className="h-4 w-4 rounded border-border bg-secondary text-primary focus:ring-primary disabled:opacity-50"
                      />
                      <label 
                        htmlFor="withCosmetics" 
                        className={`text-xs font-bold select-none cursor-pointer ${hasCosmetics ? 'text-foreground' : 'text-muted-foreground'}`}
                      >
                        장착된 코스메틱 포함하여 판매 {!hasCosmetics && '(장착된 효과 없음)'}
                      </label>
                    </div>
                  );
                })()}

                <div className="rounded-xl bg-secondary/20 border border-border/40 p-3 space-y-1.5 text-xs">
                  {marketListingType === 'auction' && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">경매 시작가</span>
                      <span className="font-bold text-foreground">{startingBid.toLocaleString()} P</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">수수료 ({feeRate}%)</span>
                    <span className="text-rose-500 font-bold">-{fee.toLocaleString()} P</span>
                  </div>
                  <div className="flex justify-between border-t border-border/40 pt-1.5 font-bold">
                    <span>{marketListingType === 'auction' ? '즉시 구매 시 정산 예상' : '정산 예정 금액'}</span>
                    <span className="text-emerald-500 font-black">{settlement.toLocaleString()} P</span>
                  </div>
                </div>

                <div className="text-[10px] text-red-500/80 leading-relaxed">
                  ※ 오픈마켓에 등록하면 거래 체결 혹은 취소 전까지는 교환/합성/판매를 할 수 없습니다. 코스메틱 포함을 체크하지 않고 등록 시 장착된 코스메틱은 회수되어 판매자 보관함으로 반환됩니다.
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setMarketRegisterCard(null)}
                    className="rounded-lg bg-secondary px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-secondary/80"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    disabled={marketRegisterBusy || (marketListingType === 'fixed' ? buyNowPrice < 100 : startingBid < 100)}
                    className="rounded-lg bg-primary px-5 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 shadow-sm disabled:opacity-50"
                  >
                    {marketRegisterBusy ? '등록 중...' : '마켓에 등록'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

    </div>
  );
};
