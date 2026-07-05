'use client';

import React, { useRef, useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { useApp } from './AppContext';
import { apiFetch } from '@/lib/api';
import { fuzzyScore } from '@/lib/search';
import { isDesktopEasterEggSurface, resolveEasterEggTerminalCode } from '@/lib/easterEgg';
import { borderClass, borderStyle, cardImage, streamerProfileImage } from '@/lib/cosmetics';
import { CosmeticFrame } from './CosmeticFrame';
import { CosmeticName } from './CosmeticName';
import { CardPreview } from './CardPreview';
import { BlindableCardImage } from './BlindableCardImage';
import { Sparkles, Coins, ShoppingBag, Store, Search, ChevronLeft, ChevronRight, ArrowRightLeft, Clock, Trash2, X, Layers, Ticket, Bell, Gavel, Hourglass, BadgePercent } from 'lucide-react';
import { formatLocalDateTime, parseAppDate } from '@/lib/time';

interface ShopItem {
  id: number;
  type: 'border' | 'name_effect';
  name: string;
  description: string | null;
  price: number;
  style_json: string | null;
  font_url: string | null;
  font_family: string | null;
  purchase_limit: number;
  listed_at?: string | null;
  created_at?: string | null;
  sale_start_at?: string | null;
  sale_end_at?: string | null;
  limited_total_quantity?: number;
  sold_quantity?: number;
}

const getShopSaleState = (item: ShopItem, now = Date.now()) => {
  const startMs = parseAppDate(item.sale_start_at)?.getTime() ?? NaN;
  const endMs = parseAppDate(item.sale_end_at)?.getTime() ?? NaN;
  const total = Math.max(0, Number(item.limited_total_quantity || 0));
  const sold = Math.max(0, Number(item.sold_quantity || 0));
  const isLimited = Number.isFinite(startMs) || Number.isFinite(endMs) || total > 0;
  const notStarted = Number.isFinite(startMs) && now < startMs;
  const ended = Number.isFinite(endMs) && now > endMs;
  const totalSoldOut = total > 0 && sold >= total;
  const targetMs = notStarted ? startMs : Number.isFinite(endMs) ? endMs : NaN;
  const leftMs = Number.isFinite(targetMs) ? Math.max(0, targetMs - now) : NaN;
  return { isLimited, notStarted, ended, total, sold, totalSoldOut, leftMs };
};

const getShopListedTime = (item: ShopItem) =>
  parseAppDate(item.listed_at || item.created_at)?.getTime() ?? 0;

const formatSaleLeft = (ms: number) => {
  if (!Number.isFinite(ms)) return '';
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}일 ${hours}시간`;
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  return `${minutes}분`;
};

const formatStreamerSerial = (streamer: { serial_number?: number | null } | null | undefined): string =>
  streamer?.serial_number == null
    ? '----'
    : String(streamer.serial_number).padStart(4, '0');

const GACHA_PARTICLES = Array.from({ length: 28 }, (_, i) => {
  const x = Math.cos(i * 1.74) * (54 + (i % 6) * 15);
  const y = Math.sin(i * 2.18) * (42 + (i % 5) * 13);
  return {
    id: i,
    x,
    y,
    x2: x * 1.24,
    y2: y * 1.24,
    size: 3 + (i % 4) * 1.5,
    delay: (i % 9) * 0.08,
    duration: 1.3 + (i % 5) * 0.16
  };
});

// 백그라운드 폴링 시 변경된 매물만 갱신하기 위한 비교/머지 헬퍼.
// 동일 내용의 매물은 기존 객체 참조를 유지해 불필요한 카드 리렌더(및 입장 애니메이션 재생)를 막습니다.
const MARKET_LISTING_VOLATILE_KEYS = [
  'price', 'status', 'current_bid', 'current_bidder_id', 'current_bidder_username',
  'buy_now_price', 'auction_ends_at', 'fee_rate', 'updated_at'
];
const marketListingsEqual = (a: any, b: any): boolean =>
  MARKET_LISTING_VOLATILE_KEYS.every((key) => a?.[key] === b?.[key]);

const mergeMarketListings = (prev: any[], next: any[]): any[] => {
  const prevById = new Map(prev.map((listing) => [listing.id, listing]));
  let changed = prev.length !== next.length;
  const merged = next.map((incoming, index) => {
    const existing = prevById.get(incoming.id);
    if (existing && marketListingsEqual(existing, incoming)) {
      if (prev[index] !== existing) changed = true; // 순서만 바뀐 경우
      return existing; // 내용 동일 → 기존 참조 유지
    }
    changed = true;
    return incoming;
  });
  // 아무 변화가 없으면 동일 배열 참조를 반환해 리렌더 자체를 건너뜁니다.
  return changed ? merged : prev;
};

type MarketRealtimeDetail = {
  reason?: string;
  listingId?: number;
  listing?: any;
  listings?: any[];
  listingIds?: number[];
};

const applyRealtimeListingPatch = (prev: any[], patch: any, removeClosed = true): any[] => {
  if (!patch?.id) return prev;
  const id = Number(patch.id);
  const index = prev.findIndex((listing) => Number(listing.id) === id);
  if (removeClosed && patch.status && patch.status !== 'PENDING') {
    return index >= 0 ? prev.filter((listing) => Number(listing.id) !== id) : prev;
  }
  if (index < 0) return prev;
  const next = [...prev];
  next[index] = { ...next[index], ...patch };
  return marketListingsEqual(prev[index], next[index]) ? prev : next;
};

// 경매 남은 시간(ms)을 한눈에 보기 좋은 문자열로 변환합니다.
const formatRemaining = (ms: number): string => {
  if (ms <= 0) return '마감';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (days > 0) return `${days}일 ${hours}시간`;
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  if (minutes > 0) return `${minutes}분 ${String(seconds).padStart(2, '0')}초`;
  return `${seconds}초`;
};

const getPaginationItems = (currentPage: number, totalPages: number): Array<number | 'ellipsis'> => {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, totalPages]);
  for (let page = currentPage - 2; page <= currentPage + 2; page++) {
    if (page > 1 && page < totalPages) pages.add(page);
  }

  const sorted = Array.from(pages).sort((a, b) => a - b);
  const result: Array<number | 'ellipsis'> = [];
  sorted.forEach((page, index) => {
    const previous = sorted[index - 1];
    if (previous && page - previous > 1) result.push('ellipsis');
    result.push(page);
  });
  return result;
};

const mergeStreamerOptions = (prev: any[], next: any[]): any[] => {
  if (!Array.isArray(next) || next.length === 0) return prev;

  const byId = new Map<string, any>();
  for (const streamer of prev) {
    const key = String(streamer?.channel_id || streamer?.id || streamer?.name || '');
    if (key) byId.set(key, streamer);
  }
  for (const streamer of next) {
    const key = String(streamer?.channel_id || streamer?.id || streamer?.name || '');
    if (!key) continue;
    byId.set(key, { ...byId.get(key), ...streamer });
  }

  return Array.from(byId.values()).sort((a, b) => {
    const valueDiff = Number(b?.total_value ?? b?.base_value ?? 0) - Number(a?.total_value ?? a?.base_value ?? 0);
    if (valueDiff !== 0) return valueDiff;
    return String(a?.name || '').localeCompare(String(b?.name || ''), 'ko-KR');
  });
};

const getStreamerOptionSearchScore = (streamer: any, query: string): number | null => {
  const nameScore = fuzzyScore(streamer?.name || '', query);
  const channelScore = fuzzyScore(streamer?.channel_id || '', query);
  if (nameScore === null && channelScore === null) return null;
  return Math.min(
    nameScore ?? Number.MAX_SAFE_INTEGER,
    channelScore === null ? Number.MAX_SAFE_INTEGER : channelScore + 200
  );
};

const getSortedStreamerOptionMatches = (streamers: any[], query: string, limit = 8): any[] => {
  const keyword = query.trim();
  if (!keyword) return [];

  return streamers
    .map((streamer) => ({ streamer, score: getStreamerOptionSearchScore(streamer, keyword) }))
    .filter((item): item is { streamer: any; score: number } => item.score !== null)
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return String(a.streamer?.name || '').localeCompare(String(b.streamer?.name || ''), 'ko-KR');
    })
    .slice(0, limit)
    .map((item) => item.streamer);
};

export const ShopTab: React.FC = () => {
  const { user, updatePoints, refreshUserData, toast, setActiveTab, blindImage, unblindImage, isImageBlinded } = useApp();

  const searchParams = useSearchParams();
  const router = useRouter();
  const subTabParam = searchParams.get('tab');
  const initialSubTab = (subTabParam === 'market' || subTabParam === 'my_listings' || subTabParam === 'history' || subTabParam === 'gacha_shop')
    ? subTabParam
    : 'gacha_shop';
  const marketSortParam = searchParams.get('sort');
  const initialMarketSort = (marketSortParam === 'oldest' || marketSortParam === 'price_desc' || marketSortParam === 'price_asc' || marketSortParam === 'ending_soon' || marketSortParam === 'bid_desc')
    ? marketSortParam
    : 'latest';
  const marketTypeParam = searchParams.get('type');
  const initialMarketType = (marketTypeParam === 'fixed' || marketTypeParam === 'auction' || marketTypeParam === 'bidding')
    ? marketTypeParam
    : 'all';
  const marketPageParam = Number(searchParams.get('page') || '1');
  const initialMarketPage = Number.isFinite(marketPageParam) && marketPageParam > 0 ? Math.floor(marketPageParam) : 1;
  const historyScopeParam = searchParams.get('scope');
  const initialHistoryScope = historyScopeParam === 'mine' ? 'mine' : 'all';
  const historyPageParam = Number(searchParams.get('historyPage') || '1');
  const initialHistoryPage = Number.isFinite(historyPageParam) && historyPageParam > 0 ? Math.floor(historyPageParam) : 1;

  // ---- 가챠(소환) ----
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingCount, setDrawingCount] = useState<1 | 10>(1);
  const [drawnCard, setDrawnCard] = useState<any | null>(null);
  const [drawnCards, setDrawnCards] = useState<any[]>([]);

  // ---- 대분류 탭 ----
  const [subTab, setSubTab] = useState<'gacha_shop' | 'market' | 'my_listings' | 'history'>(initialSubTab);

  // ---- 상점 ----
  const [items, setItems] = useState<ShopItem[]>([]);
  const [owned, setOwned] = useState<Record<number, number>>({});
  const [purchased, setPurchased] = useState<Record<number, number>>({});
  const [cosmeticPage, setCosmeticPage] = useState(1);
  const [previewCosmetic, setPreviewCosmetic] = useState<ShopItem | null>(null);

  // ---- 오픈마켓 ----
  const [marketListings, setMarketListings] = useState<any[]>([]);
  const [marketTotal, setMarketTotal] = useState(0);
  const [marketSearch, setMarketSearch] = useState('');
  const [marketSort, setMarketSort] = useState<'latest' | 'oldest' | 'price_desc' | 'price_asc' | 'ending_soon' | 'bid_desc'>(initialMarketSort);
  const [marketType, setMarketType] = useState<'all' | 'fixed' | 'auction' | 'bidding'>(initialMarketType);
  const [marketPage, setMarketPage] = useState(initialMarketPage);
  const [marketPageInput, setMarketPageInput] = useState(String(initialMarketPage));
  const [myListings, setMyListings] = useState<any[]>([]);
  const [isLoadingMarket, setIsLoadingMarket] = useState(false);
  const [purchasingListingId, setPurchasingListingId] = useState<number | null>(null);
  const [marketBuyConfirm, setMarketBuyConfirm] = useState<{
    listingId: number;
    price: number;
    streamerName: string;
  } | null>(null);
  const [auctionBuyConfirm, setAuctionBuyConfirm] = useState<{
    listingId: number;
    price: number;
    streamerName: string;
  } | null>(null);
  const [biddingListingId, setBiddingListingId] = useState<number | null>(null);
  const [bidInputs, setBidInputs] = useState<Record<number, string>>({});
  const [cancellingListingId, setCancellingListingId] = useState<number | null>(null);
  const [hidingListingId, setHidingListingId] = useState<number | null>(null);
  const [marketWatches, setMarketWatches] = useState<any[]>([]);
  const [imageBlindMenu, setImageBlindMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    imageUrl: string;
    name: string;
  }>({ open: false, x: 0, y: 0, imageUrl: '', name: '' });
  const [watchChannelId, setWatchChannelId] = useState('');
  const [watchStar, setWatchStar] = useState('');
  const [watchMaxPrice, setWatchMaxPrice] = useState('');
  const [watchBusy, setWatchBusy] = useState(false);
  // 관심 매물 알림: 스트리머 이름 검색(유연 매칭) 자동완성용 상태
  const [streamerOptions, setStreamerOptions] = useState<any[]>([]);
  const [watchStreamerQuery, setWatchStreamerQuery] = useState('');
  const [watchStreamerOpen, setWatchStreamerOpen] = useState(false);
  // 경매 남은 시간 실시간 카운트다운용 1초 틱
  const [nowTs, setNowTs] = useState(() => Date.now());
  const marketRefreshTimerRef = useRef<number | null>(null);
  const lastMarketRefreshAtRef = useRef(0);
  const shopRefreshTimerRef = useRef<number | null>(null);
  const lastShopRefreshAtRef = useRef(0);
  const hasMarketCountdown = React.useMemo(
    () => marketListings.some((listing) => listing.listing_type === 'auction' && listing.auction_ends_at),
    [marketListings]
  );
  const hasShopCountdown = React.useMemo(
    () => items.some((item) => item.sale_start_at || item.sale_end_at),
    [items]
  );

  // ---- 거래 이력 ----
  const [marketHistory, setMarketHistory] = useState<any[]>([]);
  const [marketHistoryPage, setMarketHistoryPage] = useState(initialHistoryPage);
  const [marketHistoryPageInput, setMarketHistoryPageInput] = useState(String(initialHistoryPage));
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyScope, setHistoryScope] = useState<'all' | 'mine'>(initialHistoryScope); // 전체 / 내 거래 이력

  // URL category 쿼리 파라미터를 기반으로 초기 shopType 결정
  const categoryParam = searchParams.get('category');
  const initialShopType = (categoryParam === 'name_effect' || categoryParam === 'border')
    ? categoryParam
    : 'border';

  const [shopType, setShopType] = useState<'border' | 'name_effect'>(initialShopType);
  const [shopSearch, setShopSearch] = useState('');
  const [shopSort, setShopSort] = useState<'latest' | 'price_asc' | 'price_desc' | 'name_asc'>('latest');
  const [buying, setBuying] = useState<number | null>(null);

  // 외부(뒤로가기 등)에서 URL 파라미터가 바뀔 때 상태 동기화
  useEffect(() => {
    const param = searchParams.get('category');
    if (param === 'border' || param === 'name_effect') {
      setShopType(param);
    }
  }, [searchParams]);

  useEffect(() => {
    const param = searchParams.get('tab');
    if (param === 'gacha_shop' || param === 'market' || param === 'my_listings' || param === 'history') {
      setSubTab(param);
    }
    const sortParam = searchParams.get('sort');
    setMarketSort(
      sortParam === 'oldest' || sortParam === 'price_desc' || sortParam === 'price_asc' || sortParam === 'ending_soon' || sortParam === 'bid_desc'
        ? sortParam
        : 'latest'
    );
    const typeParam = searchParams.get('type');
    setMarketType(typeParam === 'fixed' || typeParam === 'auction' || typeParam === 'bidding' ? typeParam : 'all');
    const pageParam = Number(searchParams.get('page') || '1');
    setMarketPage(Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1);
    setHistoryScope(searchParams.get('scope') === 'mine' ? 'mine' : 'all');
    const historyPageParam = Number(searchParams.get('historyPage') || '1');
    setMarketHistoryPage(Number.isFinite(historyPageParam) && historyPageParam > 0 ? Math.floor(historyPageParam) : 1);
  }, [searchParams]);

  useEffect(() => {
    const close = () => setImageBlindMenu((prev) => prev.open ? { ...prev, open: false } : prev);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, []);

  const pushShopRoute = (updates: Record<string, string | number | null | undefined>) => {
    const newParams = new URLSearchParams(window.location.search);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') newParams.delete(key);
      else newParams.set(key, String(value));
    });
    const query = newParams.toString();
    router.push(query ? `/shop?${query}` : '/shop');
  };

  // 카테고리 전환 시 URL 쿼리 파라미터 동기화
  const handleShopTypeChange = (type: 'border' | 'name_effect') => {
    setShopType(type);
    const newParams = new URLSearchParams(window.location.search);
    newParams.set('category', type);
    router.replace(`/shop?${newParams.toString()}`);
  };

  const handleSubTabChange = (tab: 'gacha_shop' | 'market' | 'my_listings' | 'history') => {
    setSubTab(tab);
    pushShopRoute({ tab, page: null });
  };

  const handleMarketSortChange = (sort: 'latest' | 'oldest' | 'price_desc' | 'price_asc' | 'ending_soon' | 'bid_desc') => {
    setMarketSort(sort);
    setMarketPage(1);
    pushShopRoute({ tab: 'market', sort: sort === 'latest' ? null : sort, page: null });
  };

  const handleMarketTypeChange = (type: 'all' | 'fixed' | 'auction' | 'bidding') => {
    setMarketType(type);
    setMarketPage(1);
    pushShopRoute({ tab: 'market', type: type === 'all' ? null : type, page: null });
  };

  const handleMarketPageChange = (page: number) => {
    const nextPage = Math.max(1, Math.floor(page));
    setMarketPage(nextPage);
    setMarketPageInput(String(nextPage));
    pushShopRoute({ tab: 'market', page: nextPage === 1 ? null : nextPage });
  };

  const handleMarketSearchChange = (value: string) => {
    const terminalCode = isDesktopEasterEggSurface() ? resolveEasterEggTerminalCode(value) : null;
    if (terminalCode) {
      setMarketSearch('');
      window.dispatchEvent(new CustomEvent('chikapo:easter-egg-command', {
        detail: { command: 'terminalCode', code: terminalCode }
      }));
      return;
    }
    setMarketSearch(value);
  };

  const handleHistoryScopeChange = (scope: 'all' | 'mine') => {
    setHistoryScope(scope);
    setMarketHistoryPage(1);
    setMarketHistoryPageInput('1');
    pushShopRoute({ tab: 'history', scope: scope === 'all' ? null : scope, historyPage: null });
  };

  const handleHistoryPageChange = (page: number) => {
    const nextPage = Math.max(1, Math.floor(page));
    setMarketHistoryPage(nextPage);
    setMarketHistoryPageInput(String(nextPage));
    pushShopRoute({ tab: 'history', historyPage: nextPage === 1 ? null : nextPage });
  };

  useEffect(() => {
    if (!user?.id) {
      setItems([]);
      setOwned({});
      setPurchased({});
      return;
    }
    fetchItems();
    fetchOwned();
    fetchPurchased();
  }, [user?.id]);

  // 1. 마운트 시 최신 정보 1회 가져오기.
  // 무료 소환 리셋은 아래 nextFreeDrawAt 타이머로 정확히 갱신하므로 주기 폴링은 하지 않습니다.
  useEffect(() => {
    if (!user) return;

    refreshUserData();
  }, [user?.id]); // 유저가 변경될 때마다 갱신 주기 재설정

  // 2. 차기 무료 뽑기 리셋 시각(nextFreeDrawAt) 정각 감지 타이머
  useEffect(() => {
    if (!user || !user.nextFreeDrawAt) return;

    const nextTime = new Date(user.nextFreeDrawAt).getTime();
    const diffMs = nextTime - Date.now();

    // 리셋 시각이 미래의 시점인 경우 타이머 예약
    if (diffMs > 0) {
      // 틱 오차 보정을 위해 1초(1000ms) 정도 마진을 두어 실행
      const timeoutId = setTimeout(() => {
        refreshUserData();
      }, diffMs + 1000);

      return () => clearTimeout(timeoutId);
    }
  }, [user?.nextFreeDrawAt]);

  const fetchItems = async () => {
    lastShopRefreshAtRef.current = Date.now();
    try {
      const res = await apiFetch('/shop/items');
      if (res.ok) setItems(await res.json());
    } catch { /* noop */ }
  };
  const fetchOwned = async () => {
    try {
      const res = await apiFetch('/shop/inventory-counts');
      if (res.ok) {
        setOwned(await res.json());
      }
    } catch { /* noop */ }
  };

  const scheduleShopRefresh = (delayMs = 500, minGapMs = 2500) => {
    const elapsed = Date.now() - lastShopRefreshAtRef.current;
    const wait = elapsed >= minGapMs ? delayMs : Math.max(delayMs, minGapMs - elapsed);
    if (shopRefreshTimerRef.current !== null) {
      window.clearTimeout(shopRefreshTimerRef.current);
    }
    shopRefreshTimerRef.current = window.setTimeout(() => {
      shopRefreshTimerRef.current = null;
      fetchItems();
      if (user?.id) fetchPurchased();
    }, wait);
  };
  const fetchPurchased = async () => {
    try {
      const res = await apiFetch('/shop/purchases');
      if (res.ok) setPurchased(await res.json());
    } catch { /* noop */ }
  };

  // silent=true(백그라운드 폴링)일 때는 로딩 스켈레톤을 띄우지 않고 변경분만 조용히 반영합니다.
  // → 경매 정보(시작가·남은 시간 등) 갱신은 받아오되, 10초마다 리스트가 통째로 새로고침되는 현상 방지.
  const fetchMarketListings = async (silent = false) => {
    lastMarketRefreshAtRef.current = Date.now();
    if (!silent) setIsLoadingMarket(true);
    try {
      const query = new URLSearchParams({
        page: String(marketPage),
        limit: '12',
        sort: marketSort,
      });
      if (marketType !== 'all') {
        query.append('type', marketType);
      }
      if (marketSearch.trim()) {
        query.append('search', marketSearch.trim());
      }
      const res = await apiFetch(`/market/listings?${query.toString()}`);
      if (res.ok) {
        const data = await res.json();
        const incoming = data.listings || [];
        // 폴링(silent)은 변경된 매물만 머지해 카드 리렌더/애니메이션 재생을 막고,
        // 명시적 로드는 그대로 교체합니다.
        setMarketListings((prev) => (silent ? mergeMarketListings(prev, incoming) : incoming));
        setMarketTotal(data.total || 0);
      }
    } catch (err) {
      console.error(err);
    } finally {
      if (!silent) setIsLoadingMarket(false);
    }
  };

  useEffect(() => {
    setMarketPageInput(String(marketPage));
  }, [marketPage]);

  useEffect(() => {
    setMarketHistoryPageInput(String(marketHistoryPage));
  }, [marketHistoryPage]);

  const goToMarketPage = () => {
    const parsed = Math.floor(Number(marketPageInput));
    if (!Number.isFinite(parsed)) {
      setMarketPageInput(String(marketPage));
      return;
    }
    const nextPage = Math.min(Math.max(1, parsed), Math.max(1, marketTotalPages));
    handleMarketPageChange(nextPage);
  };

  const goToHistoryPage = (totalPages: number) => {
    const parsed = Math.floor(Number(marketHistoryPageInput));
    const maxPage = Math.max(1, totalPages);
    if (!Number.isFinite(parsed)) {
      setMarketHistoryPageInput(String(Math.min(marketHistoryPage, maxPage)));
      return;
    }
    handleHistoryPageChange(Math.min(Math.max(1, parsed), maxPage));
  };

  const scheduleMarketRefresh = (delayMs = 1200, minGapMs = 3500) => {
    if (marketRefreshTimerRef.current !== null) {
      window.clearTimeout(marketRefreshTimerRef.current);
    }
    const elapsed = Date.now() - lastMarketRefreshAtRef.current;
    const wait = Math.max(delayMs, minGapMs - elapsed);
    marketRefreshTimerRef.current = window.setTimeout(() => {
      marketRefreshTimerRef.current = null;
      fetchMarketListings(true);
    }, wait);
  };

  const applyMarketRealtimeEvent = (detail: MarketRealtimeDetail | null | undefined) => {
    if (!detail) return;
    if (detail.listing) {
      setMarketListings((prev) => applyRealtimeListingPatch(prev, detail.listing));
      setMyListings((prev) => {
        const idx = prev.findIndex((listing) => Number(listing.id) === Number(detail.listing.id));
        if (idx < 0) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], ...detail.listing };
        return next;
      });
    }
    if (Array.isArray(detail.listings)) {
      for (const listing of detail.listings) {
        setMarketListings((prev) => applyRealtimeListingPatch(prev, listing));
        setMyListings((prev) => applyRealtimeListingPatch(prev, listing, false));
      }
    }
    if (Array.isArray(detail.listingIds) && detail.listingIds.length > 0) {
      const ids = new Set(detail.listingIds.map(Number));
      setMarketListings((prev) => prev.filter((listing) => !ids.has(Number(listing.id))));
    }
  };

  const shouldRefreshMarketAfterRealtime = (detail: MarketRealtimeDetail | null | undefined) => {
    if (!detail) return true;
    if (detail.reason === 'auction_bid' && detail.listing?.id) {
      return marketType === 'bidding' || marketSort === 'bid_desc' || marketSort === 'price_desc' || marketSort === 'price_asc';
    }
    return true;
  };

  const fetchMyListings = async () => {
    try {
      const res = await apiFetch('/market/my');
      if (res.ok) {
        setMyListings(await res.json());
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchMarketWatches = async () => {
    if (!user) return;
    try {
      const res = await apiFetch('/market/watches');
      if (res.ok) setMarketWatches(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  // silent=true(백그라운드 폴링)일 때는 로딩 스켈레톤 없이 변경분만 조용히 반영합니다.
  const fetchMarketHistory = async (silent = false) => {
    if (!user) return;
    if (!silent) setIsLoadingHistory(true);
    try {
      const res = await apiFetch(`/market/history?scope=${historyScope}`);
      if (res.ok) {
        const data = (await res.json()) || [];
        setMarketHistory((prev) => (silent ? mergeMarketListings(prev, data) : data));
      }
    } catch (err) {
      console.error(err);
    } finally {
      if (!silent) setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (subTab === 'market') {
      fetchMarketListings();
    }
  }, [subTab, marketPage, marketSort, marketType]);

  // 경매 남은 시간은 초 단위로 보여야 하므로 마켓 탭에서 실제 경매가 있을 때만 1초 틱을 켭니다.
  useEffect(() => {
    if (subTab !== 'market' || !hasMarketCountdown) return;
    setNowTs(Date.now());
    const timer = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [subTab, hasMarketCountdown]);

  useEffect(() => {
    if (subTab !== 'market' || marketListings.length === 0) return;
    const now = Date.now();
    const nextAuctionEndMs = marketListings.reduce<number | null>((nearest, listing) => {
      if (listing.listing_type !== 'auction') return nearest;
      const endsAt = parseAppDate(listing.auction_ends_at)?.getTime();
      if (typeof endsAt !== 'number' || !Number.isFinite(endsAt) || endsAt <= now) return nearest;
      return nearest === null ? endsAt : Math.min(nearest, endsAt);
    }, null);
    if (nextAuctionEndMs === null) return;
    const timer = window.setTimeout(() => {
      setNowTs(Date.now());
      scheduleMarketRefresh(0, 0);
    }, Math.min(Math.max(0, nextAuctionEndMs - now + 500), 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [subTab, marketListings, marketType, marketSort, marketSearch, marketPage]);

  // 코스메틱 상점의 한정판매 문구는 분 단위 표시라 1초 리렌더가 불필요합니다.
  useEffect(() => {
    if (subTab !== 'gacha_shop' || !hasShopCountdown) return;
    setNowTs(Date.now());
    const timer = window.setInterval(() => setNowTs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [subTab, hasShopCountdown]);

  useEffect(() => {
    if (subTab !== 'gacha_shop') return;
    const handleShopUpdated = () => {
      if (document.visibilityState !== 'visible') return;
      scheduleShopRefresh(250, 1500);
    };
    const handleVisible = () => {
      if (document.visibilityState === 'visible') scheduleShopRefresh(200, 0);
    };

    window.addEventListener('chikapo:shop-updated', handleShopUpdated);
    document.addEventListener('visibilitychange', handleVisible);
    const fallbackMs = typeof EventSource === 'undefined' ? 30_000 : 300_000;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') scheduleShopRefresh(200, 0);
    }, fallbackMs);

    return () => {
      if (shopRefreshTimerRef.current !== null) {
        window.clearTimeout(shopRefreshTimerRef.current);
        shopRefreshTimerRef.current = null;
      }
      window.removeEventListener('chikapo:shop-updated', handleShopUpdated);
      document.removeEventListener('visibilitychange', handleVisible);
      window.clearInterval(timer);
    };
  }, [subTab, user?.id]);

  useEffect(() => {
    if (subTab !== 'gacha_shop' || items.length === 0) return;
    const now = Date.now();
    const nextBoundaryMs = items.reduce<number | null>((nearest, item) => {
      const candidates = [
        parseAppDate(item.sale_start_at)?.getTime(),
        parseAppDate(item.sale_end_at)?.getTime()
      ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > now);
      const next = candidates.length ? Math.min(...candidates) : null;
      if (next === null) return nearest;
      return nearest === null ? next : Math.min(nearest, next);
    }, null);
    if (nextBoundaryMs === null) return;

    const delayMs = Math.min(Math.max(0, nextBoundaryMs - now + 500), 2_147_483_647);
    const timer = window.setTimeout(() => {
      setNowTs(Date.now());
      scheduleShopRefresh(200, 0);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [subTab, items]);

  // 관심 매물 알림의 스트리머 이름 검색용 목록 로드 (마켓 탭 진입 시 1회)
  useEffect(() => {
    if (subTab !== 'market' || !user?.id || streamerOptions.length > 0) return;
    apiFetch('/streamers/ranking?mode=value&limit=all')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setStreamerOptions((prev) => mergeStreamerOptions(prev, Array.isArray(data) ? data : [])))
      .catch(() => { /* 검색 목록 로드 실패는 무시 */ });
  }, [subTab, user?.id, streamerOptions.length]);

  // 전체 목록 로딩 전 입력했거나 서버 설정상 전체 후보가 잘린 경우에도 현재 입력어로 보강 검색합니다.
  useEffect(() => {
    if (subTab !== 'market' || !user?.id) return;
    const keyword = watchStreamerQuery.trim();
    if (!keyword) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const query = new URLSearchParams({
          mode: 'value',
          q: keyword,
          limit: '50'
        });
        const res = await apiFetch(`/streamers/ranking?${query.toString()}`);
        const data = res.ok ? await res.json() : [];
        if (!cancelled && Array.isArray(data)) {
          setStreamerOptions((prev) => mergeStreamerOptions(prev, data));
        }
      } catch {
        /* 검색 보강 실패는 자동완성만 비워질 수 있으므로 조용히 무시 */
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [subTab, user?.id, watchStreamerQuery]);

  useEffect(() => {
    if (subTab !== 'market') return;
    const handleMarketUpdated = (event: Event) => {
      const detail = (event as CustomEvent<MarketRealtimeDetail>).detail;
      applyMarketRealtimeEvent(detail);
      if (!shouldRefreshMarketAfterRealtime(detail)) {
        return;
      }
      scheduleMarketRefresh(detail?.reason === 'auction_bid' ? 300 : 700, detail?.reason === 'auction_bid' ? 0 : 3500);
    };
    const handleVisible = () => {
      if (document.visibilityState === 'visible') scheduleMarketRefresh(200, 0);
    };
    window.addEventListener('chikapo:market-updated', handleMarketUpdated);
    document.addEventListener('visibilitychange', handleVisible);
    const fallbackMs = typeof EventSource === 'undefined' ? 15_000 : 120_000;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      fetchMarketListings(true); // 스트림이 끊긴 환경을 위한 fallback
    }, fallbackMs);
    return () => {
      if (marketRefreshTimerRef.current !== null) {
        window.clearTimeout(marketRefreshTimerRef.current);
        marketRefreshTimerRef.current = null;
      }
      window.removeEventListener('chikapo:market-updated', handleMarketUpdated);
      document.removeEventListener('visibilitychange', handleVisible);
      window.clearInterval(timer);
    };
  }, [subTab, marketPage, marketSort, marketType, marketSearch, user?.id]);

  useEffect(() => {
    if (subTab === 'market') {
      const handler = setTimeout(() => {
        setMarketPage(1);
        const params = new URLSearchParams(window.location.search);
        if (params.has('page')) {
          params.delete('page');
          const query = params.toString();
          router.replace(query ? `/shop?${query}` : '/shop');
        }
        fetchMarketListings();
      }, 300);
      return () => clearTimeout(handler);
    }
  }, [marketSearch]);

  useEffect(() => {
    if ((subTab === 'market' || subTab === 'my_listings') && user) {
      fetchMyListings();
      if (subTab === 'market') fetchMarketWatches();
    }
  }, [subTab, user]);

  useEffect(() => {
    if (subTab !== 'my_listings' || !user) return;
    let refreshTimer: number | null = null;
    const scheduleRefresh = (event?: Event) => {
      const detail = event ? (event as CustomEvent<MarketRealtimeDetail>).detail : null;
      applyMarketRealtimeEvent(detail);
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => fetchMyListings(), 500);
    };
    window.addEventListener('chikapo:market-updated', scheduleRefresh);
    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.removeEventListener('chikapo:market-updated', scheduleRefresh);
    };
  }, [subTab, user?.id]);

  // 탭 진입 / 유저 변경 / 범위(전체·내거래) 변경 시에만 스켈레톤과 함께 로드.
  // (deps를 user 객체가 아닌 user?.id로 두어 10초마다의 user 갱신으로 재로딩되지 않게 함)
  useEffect(() => {
    if (subTab === 'history' && user) {
      setMarketHistoryPage(1);
      fetchMarketHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, user?.id, historyScope]);

  // 거래 이력 백그라운드 폴링: 실시간성이 낮아 60초로 제한하고 숨겨진 탭에서는 멈춥니다.
  useEffect(() => {
    if (subTab !== 'history' || !user) return;
    let refreshTimer: number | null = null;
    const scheduleRefresh = (event?: Event) => {
      const detail = event ? (event as CustomEvent<MarketRealtimeDetail>).detail : null;
      applyMarketRealtimeEvent(detail);
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => fetchMarketHistory(true), 500);
    };
    window.addEventListener('chikapo:market-updated', scheduleRefresh);
    const fallbackMs = typeof EventSource === 'undefined' ? 60_000 : 300_000;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchMarketHistory(true);
    }, fallbackMs);
    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.removeEventListener('chikapo:market-updated', scheduleRefresh);
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, user?.id, historyScope]);

  useEffect(() => {
    setCosmeticPage(1);
  }, [shopType, items, shopSearch, shopSort]);

  useEffect(() => {
    const handleShopSubTab = (event: Event) => {
      const subTabId = (event as CustomEvent<{ subTab?: 'gacha_shop' | 'market' | 'my_listings' | 'history' }>).detail?.subTab;
      if (subTabId === 'gacha_shop' || subTabId === 'market' || subTabId === 'my_listings' || subTabId === 'history') {
        handleSubTabChange(subTabId);
      }
    };

    window.addEventListener('chikapo:tutorial-shop-subtab', handleShopSubTab);
    window.addEventListener('chikapo:shop-subtab', handleShopSubTab);
    return () => {
      window.removeEventListener('chikapo:tutorial-shop-subtab', handleShopSubTab);
      window.removeEventListener('chikapo:shop-subtab', handleShopSubTab);
    };
  }, []);

  const handleBuyMarketItem = async (listingId: number, price: number, streamerName: string) => {
    if (!user) {
      toast('로그인이 필요합니다.', 'warning');
      return;
    }
    if (user.point < price) {
      toast('포인트가 부족합니다.', 'warning');
      return;
    }

    // 낙관적 포인트 차감
    updatePoints(-price);
    setPurchasingListingId(listingId);
    try {
      const res = await apiFetch(`/market/buy/${listingId}`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        toast(`'${streamerName}' 카드 구매가 완료되었습니다.`, 'success');
        refreshUserData();
        fetchMarketListings();
        fetchMyListings();
      } else {
        // 실패 시 롤백
        updatePoints(price);
        toast(data.message || '구매에 실패했습니다.', 'error');
      }
    } catch {
      // 통신 에러 시 롤백
      updatePoints(price);
      toast('서버와의 통신 오류가 발생했습니다.', 'error');
    } finally {
      setPurchasingListingId(null);
    }
  };

  const openMarketBuyConfirm = (listingId: number, price: number, streamerName: string) => {
    if (!user) {
      toast('로그인이 필요합니다.', 'warning');
      return;
    }
    if (user.point < price) {
      toast('포인트가 부족합니다.', 'warning');
      return;
    }
    setMarketBuyConfirm({ listingId, price, streamerName });
  };

  const confirmMarketBuyNow = () => {
    if (!marketBuyConfirm) return;
    const target = marketBuyConfirm;
    setMarketBuyConfirm(null);
    handleBuyMarketItem(target.listingId, target.price, target.streamerName);
  };

  const openAuctionBuyConfirm = (listingId: number, price: number, streamerName: string) => {
    if (!user) {
      toast('로그인이 필요합니다.', 'warning');
      return;
    }
    if (user.point < price) {
      toast('포인트가 부족합니다.', 'warning');
      return;
    }
    setAuctionBuyConfirm({ listingId, price, streamerName });
  };

  const confirmAuctionBuyNow = () => {
    if (!auctionBuyConfirm) return;
    const target = auctionBuyConfirm;
    setAuctionBuyConfirm(null);
    handleBuyMarketItem(target.listingId, target.price, target.streamerName);
  };

  const handleCancelMarketItem = async (listingId: number) => {
    setCancellingListingId(listingId);
    try {
      const res = await apiFetch(`/market/cancel/${listingId}`, { method: 'POST' });
      if (res.ok) {
        toast('판매 등록이 취소되었습니다.', 'success');
        fetchMarketListings();
        fetchMyListings();
        refreshUserData();
      } else {
        const data = await res.json();
        toast(data.message || '취소에 실패했습니다.', 'error');
      }
    } catch {
      toast('서버와의 통신 오류가 발생했습니다.', 'error');
    } finally {
      setCancellingListingId(null);
    }
  };

  const handleHideMyListing = async (listingId: number) => {
    setHidingListingId(listingId);
    try {
      const res = await apiFetch(`/market/my/${listingId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast('내 등록 매물 관리에서 삭제했습니다.', 'success');
        setMyListings(prev => prev.filter(item => item.id !== listingId));
      } else {
        toast(data.message || '삭제에 실패했습니다.', 'error');
      }
    } catch {
      toast('서버와의 통신 오류가 발생했습니다.', 'error');
    } finally {
      setHidingListingId(null);
    }
  };

  const handlePlaceBid = async (listing: any) => {
    if (!user) {
      toast('로그인이 필요합니다.', 'warning');
      return;
    }
    const amount = Math.floor(Number(bidInputs[listing.id]));
    const minBid = Number(listing.starting_bid || listing.price || 0);
    if (!Number.isFinite(amount) || amount < minBid) {
      toast(`최소 입찰가는 ${minBid.toLocaleString()} P 입니다.`, 'warning');
      return;
    }
    if (user.point < amount) {
      toast('입찰 가능한 포인트가 부족합니다.', 'warning');
      return;
    }

    setBiddingListingId(listing.id);
    try {
      const res = await apiFetch(`/market/bid/${listing.id}`, {
        method: 'POST',
        body: JSON.stringify({ amount })
      });
      const data = await res.json();
      if (res.ok) {
        toast('입찰이 등록되었습니다.', 'success');
        setBidInputs(prev => ({ ...prev, [listing.id]: '' }));
        if (data?.listing) {
          applyMarketRealtimeEvent({ reason: 'auction_bid', listing: data.listing });
        }
        if (marketSort === 'bid_desc') {
          scheduleMarketRefresh(300, 0);
        }
        refreshUserData();
      } else {
        toast(data.message || '입찰에 실패했습니다.', 'error');
      }
    } catch {
      toast('서버와의 통신 오류가 발생했습니다.', 'error');
    } finally {
      setBiddingListingId(null);
    }
  };

  const handleCreateWatch = async (payload?: { channel_id?: string; star?: number; max_price?: number }) => {
    if (!user) {
      toast('로그인이 필요합니다.', 'warning');
      return;
    }
    // 우선순위: 명시 payload → 자동완성에서 선택된 channel_id → 검색어 유연 매칭으로 추정
    let channelId = payload?.channel_id || watchChannelId.trim();
    if (!channelId && watchStreamerQuery.trim()) {
      const matched = getSortedStreamerOptionMatches(streamerOptions, watchStreamerQuery, 1)[0];
      if (matched) channelId = matched.channel_id;
    }
    if (!channelId) {
      toast('알림 받을 스트리머를 검색해 선택해주세요.', 'warning');
      return;
    }
    const star = payload?.star ?? (watchStar === '' ? null : Number(watchStar));
    const maxPrice = payload?.max_price ?? (watchMaxPrice.trim() ? Math.floor(Number(watchMaxPrice)) : null);
    setWatchBusy(true);
    try {
      const res = await apiFetch('/market/watches', {
        method: 'POST',
        body: JSON.stringify({
          channel_id: channelId,
          star,
          max_price: maxPrice && maxPrice > 0 ? maxPrice : null
        })
      });
      const data = await res.json();
      if (res.ok) {
        toast('관심 매물 알림을 등록했습니다.', 'success');
        setWatchChannelId('');
        setWatchStreamerQuery('');
        setWatchStreamerOpen(false);
        setWatchStar('');
        setWatchMaxPrice('');
        fetchMarketWatches();
      } else {
        toast(data.message || '알림 등록에 실패했습니다.', 'error');
      }
    } catch {
      toast('서버와의 통신 오류가 발생했습니다.', 'error');
    } finally {
      setWatchBusy(false);
    }
  };

  const handleDeleteWatch = async (watchId: number) => {
    try {
      const res = await apiFetch(`/market/watches/${watchId}`, { method: 'DELETE' });
      if (res.ok) {
        toast('관심 매물 알림을 삭제했습니다.', 'success');
        fetchMarketWatches();
      } else {
        const data = await res.json();
        toast(data.message || '삭제에 실패했습니다.', 'error');
      }
    } catch {
      toast('서버와의 통신 오류가 발생했습니다.', 'error');
    }
  };

  const isFreeDraw = user?.isFreeDrawEligible ?? false;
  const resetFreeTickets = user?.freeDrawTickets ?? 0;
  const bonusFreeTickets = user?.bonusFreeDrawTickets ?? 0;
  const totalFreeTickets = user?.freeDrawInterval === 0 ? Infinity : resetFreeTickets + bonusFreeTickets;

  const handleDraw = async (count: 1 | 10 = 1) => {
    if (!user) { toast('로그인이 필요합니다.', 'warning'); return; }
    const drawCost = user.drawCost ?? 10000;
    const availableTickets = user.freeDrawInterval === 0 ? Infinity : totalFreeTickets;
    const paidDraws = user.freeDrawInterval === 0 ? 0 : Math.max(0, count - (Number.isFinite(availableTickets) ? Number(availableTickets) : count));
    const requiredPoint = paidDraws * drawCost;
    if (user.point < requiredPoint) {
      toast(`포인트가 부족합니다. (${count === 10 ? '10연차' : '1회'} 필요 포인트: ${requiredPoint.toLocaleString()} P)`, 'warning');
      return;
    }

    // 낙관적 포인트 차감
    if (requiredPoint > 0) updatePoints(-requiredPoint);
    setIsDrawing(true);
    setDrawingCount(count);
    setDrawnCard(null);
    setDrawnCards([]);
    try {
      const res = await apiFetch(count === 10 ? '/cards/draw-many' : '/cards/draw', {
        method: 'POST',
        ...(count === 10 ? { body: JSON.stringify({ count: 10 }) } : {})
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.message || '카드 뽑기 요청에 실패했습니다.');
      }
      const data = await res.json();
      setTimeout(() => {
        if (count === 10) {
          const nextDrawnCards = (data.cards || []).map((card: any) => ({
            ...card.streamer,
            card_id: card.id,
            card_serial_number: card.serial_number,
            is_free: card.is_free,
            free_draw_source: card.free_draw_source
          }));
          setDrawnCards(nextDrawnCards);
          if (nextDrawnCards[0]) {
            window.dispatchEvent(new CustomEvent('chikapo:gacha-result', {
              detail: { card: nextDrawnCards[0] }
            }));
          }
        } else {
          const nextDrawnCard = { ...data.card.streamer, free_draw_source: data.free_draw_source, is_free: data.is_free };
          setDrawnCard(nextDrawnCard);
          window.dispatchEvent(new CustomEvent('chikapo:gacha-result', {
            detail: { card: nextDrawnCard }
          }));
        }
        setIsDrawing(false);
        refreshUserData();
        // SSR 및 Turbopack의 CJS 모듈 바인딩 이슈 우회를 위해 동적 임포트 적용
        import('canvas-confetti').then((module) => {
          const confetti = module.default;
          const colors = ['#38bdf8', '#8b5cf6', '#22c55e', '#facc15', '#ffffff'];
          confetti({ particleCount: count === 10 ? 220 : 120, spread: count === 10 ? 96 : 78, startVelocity: 42, scalar: 1.05, origin: { x: 0.5, y: 0.56 }, colors });
          confetti({ particleCount: 55, angle: 62, spread: 58, startVelocity: 38, scalar: 0.85, origin: { x: 0.12, y: 0.72 }, colors });
          confetti({ particleCount: 55, angle: 118, spread: 58, startVelocity: 38, scalar: 0.85, origin: { x: 0.88, y: 0.72 }, colors });
        }).catch((err) => console.error('Confetti 로드 실패:', err));
      }, count === 10 ? 3200 : 2200);
    } catch (e: any) {
      // 실패 시 롤백
      if (requiredPoint > 0) updatePoints(requiredPoint);
      setIsDrawing(false);
      toast(e.message || '서버와의 통신 오류가 발생했습니다.', 'error');
    }
  };

  const handleBuy = async (item: ShopItem) => {
    if (!user) { toast('로그인이 필요합니다.', 'warning'); return; }
    if (buying !== null) return;
    const saleState = getShopSaleState(item, nowTs);
    if (saleState.notStarted) { toast('아직 판매가 시작되지 않은 한정 상품입니다.', 'warning'); return; }
    if (saleState.ended) { toast('판매 기간이 종료된 한정 상품입니다.', 'warning'); return; }
    if (saleState.totalSoldOut) { toast('준비된 한정 수량이 모두 판매되었습니다.', 'warning'); return; }
    const price = Math.max(0, Number(item.price) || 0);
    if (user.point < price) { toast('포인트가 부족합니다.', 'warning'); return; }

    // 낙관적 포인트 차감
    updatePoints(-price);
    setBuying(item.id);
    try {
      const res = await apiFetch('/shop/buy', { method: 'POST', body: JSON.stringify({ item_id: item.id }) });
      const data = await res.json();
      if (res.ok) {
        toast(`'${item.name}' 구매 완료!`, 'success');
        refreshUserData();
        fetchOwned();
        fetchPurchased();
        if (data?.catalogChanged) {
          scheduleShopRefresh(150, 0);
        }
      } else {
        // 실패 시 롤백
        updatePoints(price);
        toast(data.message || '구매 실패', 'error');
      }
    } catch {
      // 에러 시 롤백
      updatePoints(price);
      toast('서버와의 통신 오류가 발생했습니다.', 'error');
    } finally {
      setBuying(null);
    }
  };

  const filtered = items
    .filter((i) => i.type === shopType)
    .filter((item) => {
      const query = shopSearch.trim();
      if (!query) return true;
      return fuzzyScore(item.name || '', query) !== null || fuzzyScore(item.description || '', query) !== null;
    })
    .sort((a, b) => {
      if (shopSort === 'price_asc') return a.price - b.price;
      if (shopSort === 'price_desc') return b.price - a.price;
      if (shopSort === 'name_asc') return a.name.localeCompare(b.name);
      const listedDiff = getShopListedTime(b) - getShopListedTime(a);
      return listedDiff || b.id - a.id;
    });
  const cosmeticTotal = filtered.length;
  const cosmeticTotalPages = Math.ceil(cosmeticTotal / 8);
  const paginatedCosmetics = filtered.slice((cosmeticPage - 1) * 8, cosmeticPage * 8);

  const marketTotalPages = Math.ceil(marketTotal / 12);
  const tenDrawPaidCount = user?.freeDrawInterval === 0
    ? 0
    : Math.max(0, 10 - (Number.isFinite(totalFreeTickets) ? Number(totalFreeTickets) : 10));
  const tenDrawPointCost = tenDrawPaidCount * (user?.drawCost ?? 10000);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* 대분류 탭 (아이콘 및 입체적인 캡슐 버튼 스타일로 시인성 개선) */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-3">
        {([
          ['gacha_shop', '소환 및 일반 상점', Store],
          ['market', '오픈마켓 (유저 거래)', ArrowRightLeft],
          ['my_listings', '내 등록 매물 관리', Layers],
          ['history', '거래 이력 (영수증)', Clock]
        ] as const).map(([tabId, label, Icon]) => {
          const isActive = subTab === tabId;
          return (
            <button
              key={tabId}
              onClick={() => handleSubTabChange(tabId)}
              className={`cute-wiggle-hover flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition-all duration-200 ${isActive
                  ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20 scale-105'
                  : 'bg-secondary/40 text-muted-foreground hover:bg-secondary/80 hover:text-foreground'
                }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          );
        })}
      </div>

      {subTab === 'gacha_shop' ? (
        <div className="space-y-8 animate-in fade-in duration-200">
          {/* 가챠 보드 (상점 최상단) */}
          <section data-tour="shop-gacha-board" className="cute-surface rounded-[2rem] p-6">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="space-y-2 text-center md:text-left">
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                  <Sparkles className="h-3 w-3" /> CHZZK CARD GACHA
                </span>
                <h2 className="text-2xl font-black tracking-tight text-foreground md:text-3xl">치지직 카드 즉시 소환</h2>
                <p className="text-xs text-muted-foreground max-w-md leading-relaxed">
                  {user?.freeDrawInterval === 0 ? (
                    <>쿨타임 없는 <strong className="text-primary font-bold">무제한 무료 소환</strong> 기회를 제공합니다.</>
                  ) : (
                    <>매 자정 기준 <strong className="text-primary font-bold">{user?.freeDrawInterval ?? 24}시간마다</strong> 무료 소환 기회가 1회 충전되며 <strong className="text-primary font-bold">최대 {user?.freeDrawMaxStack ?? 1}회</strong>까지 중첩됩니다.</>
                  )}
                  <br />무료 기회 소진 이후 1회 소환 비용은 <strong className="text-foreground font-bold">{(user?.drawCost ?? 10000).toLocaleString()} 포인트</strong>입니다.
                </p>
                {user && user.freeDrawInterval !== 0 && (
                  <div className="mt-3 flex flex-wrap justify-center gap-2 md:justify-start">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-black text-primary">
                      <Sparkles className="h-3.5 w-3.5" /> 충전 기회 {resetFreeTickets}/{user.freeDrawMaxStack ?? 1}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/25 bg-violet-400/10 px-3 py-1 text-[11px] font-black text-violet-500 dark:text-violet-200">
                      <Ticket className="h-3.5 w-3.5" /> 추가 티켓 {bonusFreeTickets}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex w-full flex-col items-center gap-2 sm:w-auto">
                <button
                  data-tour="shop-gacha-button"
                  onClick={() => handleDraw(1)}
                  disabled={isDrawing}
                  className="cute-wiggle-hover group relative flex h-28 w-full cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-sky-400 via-emerald-500 to-teal-500 font-bold text-primary-foreground shadow-md shadow-emerald-500/15 transition-all hover:scale-105 active:scale-95 disabled:pointer-events-none sm:w-44 dark:from-primary dark:via-emerald-500 dark:to-teal-600 dark:shadow-lg dark:shadow-primary/20"
                >
                  <Sparkles className="h-8 w-8 animate-pulse text-white" />
                  <div className="text-center">
                    <span className="text-sm tracking-wide text-white/90">스트리머 소환</span>
                    {user?.freeDrawInterval === 0 ? (
                      <p className="text-[10px] text-yellow-300 font-black flex items-center justify-center gap-1">✨ 무제한 무료</p>
                    ) : isFreeDraw ? (
                      <p className="text-[10px] text-yellow-300 font-black flex items-center justify-center gap-1">✨ 무료 티켓 {Number.isFinite(totalFreeTickets) ? totalFreeTickets : '∞'}장</p>
                    ) : (
                      <p className="cute-number-font flex items-center justify-center gap-1 text-[10px] text-emerald-100"><Coins className="h-3 w-3" /> {(user?.drawCost ?? 10000).toLocaleString()} P</p>
                    )}
                  </div>
                </button>
                <button
                  onClick={() => handleDraw(10)}
                  disabled={isDrawing}
                  className="cute-wiggle-hover group relative flex w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-2xl border border-violet-300/40 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-sky-500 px-4 py-3 text-xs font-black text-white shadow-md shadow-violet-500/15 transition hover:scale-[1.03] active:scale-95 disabled:pointer-events-none disabled:opacity-60 sm:w-44"
                >
                  <span className="absolute inset-0 bg-white/0 transition group-hover:bg-white/10" />
                  <Sparkles className="relative h-4 w-4" />
                  <span className="relative">10연차 소환</span>
                  <span className="relative rounded-full bg-white/18 px-1.5 py-0.5 text-[9px]">
                    {user?.freeDrawInterval === 0
                      ? '무료'
                      : Number.isFinite(totalFreeTickets) && totalFreeTickets >= 10
                        ? '티켓 10장'
                        : `${tenDrawPointCost.toLocaleString()}P`}
                  </span>
                </button>
              </div>
            </div>

            {(isDrawing || drawnCard || drawnCards.length > 0) && (
              <div className="mt-8 flex flex-col items-center justify-center border-t border-border/50 pt-8 animate-in fade-in duration-200">
                <AnimatePresence mode="wait">
                  {isDrawing ? (
                    <motion.div
                      key="drawing"
                      initial={{ opacity: 0, y: 18, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -18, scale: 1.04, filter: 'blur(8px)' }}
                      transition={{ duration: 0.32, ease: 'easeOut' }}
                      className="gacha-stage flex flex-col items-center gap-4 py-12"
                    >
                      <div className="gacha-portal">
                        <div className="gacha-burst" />
                        <div className="gacha-orbit" />
                        <div className="gacha-orbit gacha-orbit-two" />
                        {GACHA_PARTICLES.map((p) => (
                          <span
                            key={p.id}
                            className="gacha-particle"
                            style={{
                              '--x': `${p.x}px`,
                              '--y': `${p.y}px`,
                              '--x2': `${p.x2}px`,
                              '--y2': `${p.y2}px`,
                              '--size': `${p.size}px`,
                              '--delay': `${p.delay}s`,
                              '--duration': `${p.duration}s`
                            } as React.CSSProperties}
                          />
                        ))}
                        <motion.div
                          className="gacha-pack"
                          animate={{
                            y: [0, -16, 6, -9, 0],
                            rotate: [-4, 6, -8, 4, -4],
                            scale: [1, 1.08, 0.98, 1.06, 1]
                          }}
                          transition={{ duration: 1.24, repeat: Infinity, ease: 'easeInOut' }}
                        >
                          <div className="gacha-pack-top" />
                          <Sparkles className="h-9 w-9 text-white drop-shadow-lg" />
                          <span>CHIKAPO</span>
                        </motion.div>
                      </div>
                      <motion.p
                        className="text-xs font-black text-primary"
                        animate={{ opacity: [0.58, 1, 0.58] }}
                        transition={{ duration: 1.05, repeat: Infinity }}
                      >
                        {drawingCount === 10 ? '10개의 카드팩을 동시에 개봉하는 중...' : '카드팩 에너지를 모으는 중...'}
                      </motion.p>
                    </motion.div>
                  ) : drawnCards.length > 0 ? (
                    <motion.div
                      key="multi-result"
                      initial={{ opacity: 0, y: 24, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
                      className="w-full"
                    >
                      <div className="mb-4 text-center">
                        <span className="inline-flex rounded-full border border-violet-300/35 bg-violet-500/10 px-3 py-1 text-xs font-black text-violet-600 shadow-sm dark:text-violet-200">
                          10연차 소환 완료! 보관함에서 모두 확인할 수 있어요
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
                        {drawnCards.map((card, index) => (
                          <motion.div
                            key={`${card.channel_id}-${card.card_id || index}`}
                            initial={{ opacity: 0, y: 18, rotateY: -18 }}
                            animate={{ opacity: 1, y: 0, rotateY: 0 }}
                            transition={{ delay: index * 0.045, duration: 0.28 }}
                            className="relative flex aspect-[5/7] min-h-44 flex-col justify-between overflow-hidden rounded-2xl border border-border/80 bg-card p-2.5 shadow-md"
                            style={{ transformStyle: 'preserve-3d' }}
                          >
                            <img src={card.custom_image_url || card.logo_url} alt={card.name} className="absolute inset-0 h-full w-full object-cover opacity-80" />
                            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-black/15" />
                            <div className="relative z-10 flex justify-between">
                              <span className="rounded bg-black/45 px-1.5 py-0.5 text-[8px] font-black text-white/85">#{index + 1}</span>
                              {card.is_free && <span className="rounded bg-yellow-300 px-1.5 py-0.5 text-[8px] font-black text-yellow-950">FREE</span>}
                            </div>
                            <div className="relative z-10 mt-auto text-white">
                              <h4 className="truncate text-xs font-black drop-shadow-md">{card.name}</h4>
                              <div className="mt-1 flex items-center justify-between border-t border-white/20 pt-1">
                                <span className="text-[9px] text-zinc-300">시세</span>
                                <span className="cute-number-font text-[11px] font-black text-emerald-300">{(card.base_value || 0).toLocaleString()}P</span>
                              </div>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                      <button onClick={() => setDrawnCards([])} className="mx-auto mt-4 block rounded-lg bg-secondary px-4 py-1.5 text-xs font-bold text-muted-foreground hover:bg-secondary/80">닫기</button>
                    </motion.div>
                  ) : drawnCard ? (
                    <motion.div
                      key="result"
                      initial={{ opacity: 0, y: 24, scale: 0.92 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
                      className="gacha-result-wrap flex flex-col items-center"
                    >
                      <motion.span
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.18 }}
                        className="mb-3 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-black text-primary shadow-sm"
                      >
                        {drawnCard.is_free ? '무료 소환 성공!' : '소환 성공!'} 보관함에서 확인할 수 있어요
                      </motion.span>
                    <motion.div
                      data-tour="shop-gacha-result-card"
                      className="gacha-result-card relative flex h-80 w-52 flex-col justify-between overflow-hidden rounded-[1.75rem] border border-border/80 bg-card p-4 shadow-xl"
                      initial={{ rotateY: -28, rotateX: 12, scale: 0.82, y: 24 }}
                      animate={{ rotateY: 0, rotateX: 0, scale: 1, y: 0 }}
                      whileHover={{ rotateY: 5, rotateX: -4, y: -6, scale: 1.02 }}
                      transition={{ duration: 0.62, ease: [0.16, 1, 0.3, 1] }}
                      style={{ transformStyle: 'preserve-3d' }}
                    >
                      <div className="absolute inset-0 z-0">
                        <img src={drawnCard.custom_image_url || drawnCard.logo_url} alt={drawnCard.name} className="h-full w-full object-cover opacity-80" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-black/20 z-10"></div>
                      </div>
                      <div className="relative z-20 flex items-center justify-between w-full">
                        {drawnCard.is_active ? (
                          <span className="rounded bg-red-600 px-1.5 py-0.5 text-[8px] font-bold text-white">LIVE</span>
                        ) : (
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[8px] font-bold text-zinc-400">OFFLINE</span>
                        )}
                        <span className="rounded bg-black/50 px-2 py-0.5 text-[9px] font-black text-white/90">No.{String(drawnCard.serial_number || 1).padStart(4, '0')}</span>
                      </div>
                      <div className="relative z-20 space-y-1.5 text-white mt-auto">
                        <h3 className="text-base font-black tracking-tight text-white drop-shadow-md">{drawnCard.name}</h3>
                        <p className="text-[9.5px] text-zinc-300 drop-shadow-md">{(drawnCard.follower_count || 0).toLocaleString()} 팔로워</p>
                        <div className="flex items-center justify-between border-t border-white/20 pt-2">
                          <span className="text-[9px] text-zinc-400">시세 가치</span>
                          <span className="cute-number-font text-sm font-black text-emerald-400">{(drawnCard.base_value || 0).toLocaleString()} P</span>
                        </div>
                      </div>
                    </motion.div>
                    <button onClick={() => setDrawnCard(null)} className="mt-4 rounded-lg bg-secondary px-4 py-1.5 text-xs font-bold hover:bg-secondary/80 text-muted-foreground">닫기</button>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            )}
          </section>

          {/* 상점 */}
          <section data-tour="shop-cosmetics" className="cute-surface rounded-[2rem] p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="cute-outline-soft flex items-center gap-2 text-2xl font-black"><Store className="h-5.5 w-5.5 text-primary" /> 코스메틱 상점</h2>
              {user && <span className="cute-number-font flex items-center gap-1 text-xs font-bold text-primary"><Coins className="h-3.5 w-3.5" /> {user.point.toLocaleString()} P</span>}
            </div>
            <p className="text-xs text-muted-foreground">포인트로 카드 테두리와 이름 이펙트를 구매하세요. 구매한 코스메틱은 보관함에서 카드에 장착할 수 있습니다.</p>

            {/* 종류 탭 (아이콘 추가로 시각적 조화성 증대) */}
            <div data-tour="shop-cosmetic-tools" className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex rounded-lg bg-secondary p-1 w-fit border border-border/40">
                {([
                  ['border', '테두리', Layers],
                  ['name_effect', '이름 이펙트', Sparkles]
                ] as const).map(([t, label, Icon]) => (
                  <button
                    key={t}
                    onClick={() => handleShopTypeChange(t)}
                    className={`cute-wiggle-hover flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-bold transition-all duration-150 ${shopType === t
                        ? 'bg-card text-foreground shadow-sm font-extrabold'
                        : 'text-muted-foreground hover:text-foreground'
                      }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <input
                    value={shopSearch}
                    onChange={(event) => setShopSearch(event.target.value)}
                    placeholder="상품 검색"
                    className="w-full rounded-2xl border border-border bg-secondary/45 py-2 pl-9 pr-3 text-xs font-bold focus:border-primary focus:outline-none sm:w-52"
                  />
                </div>
                <select
                  value={shopSort}
                  onChange={(event) => setShopSort(event.target.value as typeof shopSort)}
                  className="rounded-2xl border border-border bg-secondary/45 px-3 py-2 text-xs font-bold text-foreground focus:border-primary focus:outline-none"
                >
                  <option value="latest">최신 등록순</option>
                  <option value="price_asc">낮은 가격순</option>
                  <option value="price_desc">높은 가격순</option>
                  <option value="name_asc">이름순</option>
                </select>
              </div>
            </div>

            {paginatedCosmetics.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-10">판매 중인 {shopType === 'border' ? '테두리' : '이름 이펙트'}가 없습니다.</p>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-2 items-stretch gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {paginatedCosmetics.map((item) => {
                    const limited = item.purchase_limit > 0;
                    const bought = purchased[item.id] || 0;
                    const soldOut = limited && bought >= item.purchase_limit;
                    const saleState = getShopSaleState(item, nowTs);
                    const saleBlocked = saleState.notStarted || saleState.ended || saleState.totalSoldOut;
                    const stockLeft = Math.max(0, saleState.total - saleState.sold);
                    const stockPercent = saleState.total > 0
                      ? Math.max(0, Math.min(100, (stockLeft / saleState.total) * 100))
                      : 100;
                    return (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setPreviewCosmetic(item)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setPreviewCosmetic(item);
                          }
                        }}
                        className={`shop-cosmetic-card cute-card-pop grid min-h-[17.25rem] cursor-pointer grid-rows-[5.5rem_minmax(3.25rem,auto)_1fr_auto] rounded-[1.25rem] border p-3 text-center transition hover:border-primary/40 ${saleState.isLimited
                          ? 'border-amber-300/55 bg-gradient-to-b from-amber-100/45 via-secondary/25 to-card shadow-[0_14px_35px_rgba(245,158,11,0.12)] dark:border-amber-300/20 dark:from-amber-400/10 dark:via-secondary/20 dark:to-card'
                          : 'border-border bg-secondary/25 hover:bg-secondary/35'
                        }`}
                      >
                        {/* 미리보기 */}
                        <div className="relative flex h-[5.5rem] items-center justify-center">
                          {saleState.isLimited && (
                            <span className="absolute left-0 top-0 z-10 inline-flex items-center gap-1 rounded-full border border-amber-300/60 bg-amber-300/20 px-2 py-0.5 text-[8px] font-black text-amber-700 shadow-sm dark:border-amber-200/20 dark:bg-amber-300/15 dark:text-amber-200">
                              <BadgePercent className="h-2.5 w-2.5" /> 한정
                            </span>
                          )}
                          {item.type === 'border' ? (
                            <div className="cosmetic-list-preview relative h-[5.2rem] w-[3.25rem] overflow-visible">
                              <div
                                className="pointer-events-none absolute left-0 top-0"
                                style={{
                                  width: '224px',
                                  height: '358.4px',
                                  transform: 'scale(calc(52 / 224))',
                                  transformOrigin: 'top left'
                                }}
                              >
                                <CardPreview border={item} className="cosmetic-list-preview" />
                              </div>
                            </div>
                          ) : (
                            <div className="cosmetic-list-preview flex h-[5.2rem] w-full min-w-0 items-center justify-center px-2">
                              <CosmeticName
                                effect={item}
                                className="block max-w-full text-center text-base font-black leading-tight [overflow-wrap:anywhere] sm:text-lg"
                              >
                                {item.name}
                              </CosmeticName>
                            </div>
                          )}
                        </div>
                        <div className="flex min-h-[3.25rem] flex-col items-center justify-start px-0.5 pt-1.5">
                          <p className="w-full truncate text-xs font-bold leading-5">{item.name}</p>
                          <p className="mt-0.5 line-clamp-2 min-h-[2rem] text-[9px] leading-4 text-muted-foreground">
                            {item.description || ''}
                          </p>
                        </div>
                        <div className="flex flex-col items-center justify-end gap-1.5 pb-1.5">
                          {saleState.isLimited && (
                            <div className="w-full rounded-xl border border-amber-300/45 bg-amber-50/70 px-2 py-1 text-left dark:border-amber-300/15 dark:bg-amber-300/10">
                              <div className="flex items-center justify-between gap-2 text-[9px] font-black">
                                <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-200">
                                  <Hourglass className="h-3 w-3" />
                                  {saleState.notStarted
                                    ? `${formatSaleLeft(saleState.leftMs)} 후 시작`
                                    : saleState.ended
                                      ? '판매 종료'
                                      : saleState.leftMs
                                        ? `${formatSaleLeft(saleState.leftMs)} 남음`
                                        : '기간 한정'}
                                </span>
                                {saleState.total > 0 && (
                                  <span className={saleState.totalSoldOut ? 'text-rose-500' : 'text-amber-700 dark:text-amber-200'}>
                                    {stockLeft}/{saleState.total}
                                  </span>
                                )}
                              </div>
                              {saleState.total > 0 && (
                                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-amber-200/60 dark:bg-amber-950/60">
                                  <div
                                    className={`h-full rounded-full ${stockPercent <= 20 ? 'bg-rose-500' : 'bg-gradient-to-r from-amber-400 to-emerald-400'}`}
                                    style={{ width: `${stockPercent}%` }}
                                  />
                                </div>
                              )}
                            </div>
                          )}
                          <div className="cute-number-font flex h-5 items-center justify-center gap-1 text-[11px] font-black text-primary"><Coins className="h-3.5 w-3.5" /> {item.price.toLocaleString()}</div>
                          <div className="flex h-4 items-center justify-center gap-2">
                            {owned[item.id] ? (
                              <span className="text-[9px] font-bold text-emerald-500">보유 {owned[item.id]}개</span>
                            ) : null}
                            {limited && (
                              <span className={`text-[9px] font-bold ${soldOut ? 'text-rose-500' : 'text-muted-foreground'}`}>구매 {bought}/{item.purchase_limit}</span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            handleBuy(item);
                          }}
                          disabled={buying === item.id || soldOut || saleBlocked}
                          className="cute-wiggle-hover flex h-8 w-full items-center justify-center gap-1 rounded-xl bg-primary text-[11px] font-bold text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
                        >
                          <ShoppingBag className="h-3.5 w-3.5" /> {saleState.notStarted ? '판매 예정' : saleState.ended ? '판매 종료' : saleState.totalSoldOut ? '품절' : soldOut ? '구매 완료' : buying === item.id ? '구매 중...' : '구매'}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* 코스메틱 페이지네이션 바 */}
                {cosmeticTotalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 mt-4 pt-2">
                    <button
                      onClick={() => setCosmeticPage(p => Math.max(1, p - 1))}
                      disabled={cosmeticPage === 1}
                      className="rounded-lg border border-border bg-card p-1.5 hover:bg-secondary/40 disabled:opacity-30 disabled:pointer-events-none transition"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    {Array.from({ length: cosmeticTotalPages }).map((_, i) => {
                      const p = i + 1;
                      return (
                        <button
                          key={p}
                          onClick={() => setCosmeticPage(p)}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition ${cosmeticPage === p ? 'bg-primary text-primary-foreground' : 'bg-card border border-border text-foreground hover:bg-secondary/40'}`}
                        >
                          {p}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setCosmeticPage(p => Math.min(cosmeticTotalPages, p + 1))}
                      disabled={cosmeticPage === cosmeticTotalPages}
                      className="rounded-lg border border-border bg-card p-1.5 hover:bg-secondary/40 disabled:opacity-30 disabled:pointer-events-none transition"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            )}

            <button onClick={() => setActiveTab('inventory')} className="w-full rounded-2xl bg-secondary py-2.5 text-xs font-bold text-muted-foreground transition hover:bg-secondary/80">
              보관함으로 이동하여 카드에 장착하기 →
            </button>
          </section>
        </div>
      ) : subTab === 'market' ? (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* 오픈마켓 영역 */}
          <section data-tour="shop-market" className="cute-surface rounded-[2rem] p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h2 className="cute-outline-soft flex items-center gap-2 text-2xl font-black">
                  <Store className="h-5.5 w-5.5 text-primary" /> 오픈마켓 장터
                </h2>
                <p className="text-xs text-muted-foreground">다른 유저들이 올린 카드를 구매하거나 내 카드를 판매하세요.<br />판매 등록은 보관함의 우클릭 메뉴에서 가능합니다. 즉시 판매는 5%, 경매는 진행 시간에 따라 수수료가 달라집니다.</p>
              </div>
              {user && (
                <span className="cute-number-font flex items-center gap-1 self-start text-xs font-bold text-primary sm:self-auto">
                  <Coins className="h-3.5 w-3.5" /> {user.point.toLocaleString()} P
                </span>
              )}
            </div>

            {/* 필터 & 검색 */}
            <div data-tour="shop-market-filters" className="flex flex-col sm:flex-row items-center gap-3">
              <div className="relative w-full sm:flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="스트리머 또는 판매자 검색..."
                  value={marketSearch}
                  onChange={(e) => handleMarketSearchChange(e.target.value)}
                  className="w-full rounded-lg border border-border bg-secondary/20 pl-9 pr-3 py-2 text-xs focus:border-primary focus:outline-none"
                />
                {marketSearch && (
                  <button onClick={() => setMarketSearch('')} className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <select
                value={marketSort}
                onChange={(e) => handleMarketSortChange(e.target.value as 'latest' | 'oldest' | 'price_desc' | 'price_asc' | 'ending_soon' | 'bid_desc')}
                className="w-full sm:w-44 rounded-lg border border-border bg-card px-3 py-2 text-xs focus:border-primary focus:outline-none"
              >
                <option value="latest">최신 등록순</option>
                <option value="oldest">오래된 순</option>
                <option value="price_desc">높은 가격순</option>
                <option value="price_asc">낮은 가격순</option>
                <option value="ending_soon">마감 임박순</option>
                <option value="bid_desc">시작가 높은순</option>
              </select>
              <select
                value={marketType}
                onChange={(e) => handleMarketTypeChange(e.target.value as 'all' | 'fixed' | 'auction' | 'bidding')}
                className="w-full sm:w-36 rounded-lg border border-border bg-card px-3 py-2 text-xs focus:border-primary focus:outline-none"
              >
                <option value="all">전체 매물</option>
                <option value="fixed">즉시 판매</option>
                <option value="auction">경매</option>
                <option value="bidding">내 입찰</option>
              </select>
            </div>

            {user && (
              <div data-tour="shop-market-watch" className="rounded-[1.5rem] border border-sky-200/70 bg-sky-50/70 p-4 dark:border-sky-400/15 dark:bg-sky-400/10">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-black text-sky-700 dark:text-sky-200">
                      <Bell className="h-4 w-4" /> 관심 매물 알림
                    </h3>
                    <p className="mt-1 text-[11px] font-medium text-sky-700/70 dark:text-sky-100/65">
                      지정한 카드가 장터에 올라오면 사이트 알림과 푸시 알림으로 알려드려요.
                    </p>
                  </div>
                  <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-[1fr_110px_130px_auto] lg:max-w-2xl">
                    <div className="relative">
                      <input
                        value={watchStreamerQuery}
                        onChange={(event) => {
                          setWatchStreamerQuery(event.target.value);
                          setWatchChannelId(''); // 검색어가 바뀌면 이전 선택 해제
                          setWatchStreamerOpen(true);
                        }}
                        onFocus={() => setWatchStreamerOpen(true)}
                        placeholder="스트리머 이름 검색 (초성·띄어쓰기 무시)"
                        className={`w-full rounded-2xl border bg-white/80 px-3 py-2 text-xs font-bold text-sky-950 placeholder:text-sky-700/45 focus:outline-none dark:bg-sky-950/30 dark:text-sky-50 ${watchChannelId ? 'border-sky-400 dark:border-sky-300/40' : 'border-sky-200 focus:border-sky-400 dark:border-sky-300/20'}`}
                      />
                      {watchStreamerOpen && watchStreamerQuery.trim() && (
                        <>
                          {/* 바깥 클릭 시 닫기 */}
                          <div className="fixed inset-0 z-20" onClick={() => setWatchStreamerOpen(false)} />
                          <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-2xl border border-sky-200 bg-white p-1 shadow-xl dark:border-sky-300/20 dark:bg-sky-950">
                            {(() => {
                              const suggestions = getSortedStreamerOptionMatches(streamerOptions, watchStreamerQuery, 8);
                              if (suggestions.length === 0) {
                                return <p className="px-3 py-3 text-center text-[11px] font-bold text-sky-700/60 dark:text-sky-100/50">검색 결과가 없습니다.</p>;
                              }
                              return suggestions.map((s) => (
                                <button
                                  key={s.channel_id}
                                  type="button"
                                  onClick={() => {
                                    setWatchChannelId(s.channel_id);
                                    setWatchStreamerQuery(s.name);
                                    setWatchStreamerOpen(false);
                                  }}
                                  className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs font-bold text-sky-950 transition hover:bg-sky-100 dark:text-sky-50 dark:hover:bg-sky-400/15"
                                >
                                  <img src={streamerProfileImage(s)} alt={s.name} className="h-6 w-6 shrink-0 rounded-full border border-sky-200 object-cover dark:border-sky-300/20" />
                                  <span className="truncate">{s.name}</span>
                                </button>
                              ));
                            })()}
                          </div>
                        </>
                      )}
                    </div>
                    <select
                      value={watchStar}
                      onChange={(event) => setWatchStar(event.target.value)}
                      className="rounded-2xl border border-sky-200 bg-white/80 px-3 py-2 text-xs font-bold text-sky-950 focus:border-sky-400 focus:outline-none dark:border-sky-300/20 dark:bg-sky-950/30 dark:text-sky-50"
                    >
                      <option value="">모든 등급</option>
                      {[0, 1, 2, 3, 4, 5].map((star) => (
                        <option key={star} value={star}>{star === 0 ? '일반' : `${star}성`}</option>
                      ))}
                    </select>
                    <input
                      value={watchMaxPrice}
                      onChange={(event) => setWatchMaxPrice(event.target.value)}
                      type="number"
                      min="0"
                      placeholder="최대 가격"
                      className="rounded-2xl border border-sky-200 bg-white/80 px-3 py-2 text-xs font-bold text-sky-950 placeholder:text-sky-700/45 focus:border-sky-400 focus:outline-none dark:border-sky-300/20 dark:bg-sky-950/30 dark:text-sky-50"
                    />
                    <button
                      onClick={() => handleCreateWatch()}
                      disabled={watchBusy}
                      className="cute-wiggle-hover rounded-2xl bg-sky-500 px-4 py-2 text-xs font-black text-white shadow-sm shadow-sky-400/20 transition hover:bg-sky-600 disabled:opacity-50"
                    >
                      등록
                    </button>
                  </div>
                </div>
                {marketWatches.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {marketWatches.map((watch) => (
                      <button
                        key={watch.id}
                        onClick={() => handleDeleteWatch(watch.id)}
                        className="rounded-full border border-sky-200 bg-white/75 px-3 py-1 text-[10px] font-black text-sky-700 transition hover:bg-rose-50 hover:text-rose-500 dark:border-sky-300/15 dark:bg-sky-950/25 dark:text-sky-100"
                        title="클릭하면 삭제됩니다"
                      >
                        {watch.streamer?.name || watch.channel_id} · {watch.star == null ? '모든 등급' : watch.star === 0 ? '일반' : `${watch.star}성`}
                        {watch.max_price ? ` · ${Number(watch.max_price).toLocaleString()}P 이하` : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {isLoadingMarket ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
                <p className="text-xs text-muted-foreground">매물 불러오는 중...</p>
              </div>
            ) : marketListings.length === 0 ? (
              <div className="rounded-2xl border border-border/80 border-dashed py-16 text-center text-xs text-muted-foreground">
                등록된 카드 매물이 없습니다.
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {marketListings.map((listing) => {
                    const streamer = listing.card?.streamer;
                    const star = listing.card?.star ?? 0;
                    const border = listing.card?.border;
                    const isAuction = listing.listing_type === 'auction';
                    const startBid = Number(listing.starting_bid || listing.price || 0);
                    const buyNowPrice = Number(listing.buy_now_price || (isAuction ? 0 : listing.price) || 0);
                    const minBid = startBid;
                    const endsAt = parseAppDate(listing.auction_ends_at);
                    const remainingMs = endsAt ? endsAt.getTime() - nowTs : 0;
                    const isEnded = !!endsAt && remainingMs <= 0;
                    const isUrgent = isAuction && !isEnded && remainingMs <= 3 * 60_000; // 3분 이하
                    const isSoon = isAuction && !isEnded && remainingMs < 5 * 60_000;   // 5분 미만
                    const listingImageUrl = cardImage(streamer, star);

                    return (
                      <div key={listing.id} className="cute-card-pop flex flex-col gap-2 rounded-[1.75rem] border border-border/60 bg-secondary/20 p-2 shadow-sm hover:border-primary/30 hover:shadow-md">
                        {/* 카드 프레임 */}
                        <div
                          style={{
                            containerType: 'inline-size',
                            ...(borderClass(border) ? {} : (borderStyle(border) || {}))
                          }}
                          className={`group relative flex aspect-[5/8] w-full flex-col justify-between overflow-hidden rounded-xl bg-card shadow-sm border border-border/80 ${star >= 1 ? `card-star card-star-${star}` : ''}`}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setImageBlindMenu({
                              open: true,
                              x: Math.min(event.clientX, window.innerWidth - 220),
                              y: Math.min(event.clientY, window.innerHeight - 96),
                              imageUrl: listingImageUrl,
                              name: streamer?.name || '카드 이미지'
                            });
                          }}
                        >
                          <CosmeticFrame border={border} />
                          <div className="absolute inset-0 z-0">
                            <BlindableCardImage
                              src={listingImageUrl}
                              alt={streamer?.name || 'card'}
                              loading="lazy"
                              className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                            />
                          </div>
                          <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-transparent z-15 pointer-events-none"></div>

                          <div className="relative z-20 flex h-full w-full flex-col justify-between p-2 pointer-events-none text-white">
                            <div className="flex justify-between items-center w-full">
                              {streamer?.is_active ? (
                                <span className="rounded bg-red-600 px-1 py-0.5 text-[7px] font-bold text-white flex items-center gap-0.5 animate-pulse">
                                  <span className="h-0.5 w-0.5 rounded-full bg-white"></span> LIVE
                                </span>
                              ) : (
                                <span className="rounded bg-zinc-800 px-1 py-0.5 text-[7px] font-bold text-zinc-400">OFFLINE</span>
                              )}
                              <span className="rounded bg-black/50 px-1 py-0.5 text-[8px] font-black text-white/90">No.{formatStreamerSerial(streamer)}</span>
                            </div>
                            <div className="mt-auto space-y-0.5">
                              <h4 className="text-[11px] font-black truncate drop-shadow-md">
                                <CosmeticName effect={listing.card?.name_effect}>{streamer?.name}</CosmeticName>
                              </h4>
                              <div className="flex items-center gap-0.5">
                                {star > 0 ? (
                                  Array.from({ length: star }).map((_, i) => (
                                    <span key={i} className="text-yellow-400 text-[8px]">★</span>
                                  ))
                                ) : (
                                  <span className="text-zinc-500 text-[8px]">일반</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* 가격 및 구매 처리 */}
                        <div className="px-1 py-0.5 space-y-1.5">
                          <div className="flex items-center justify-between gap-1 text-[10px]">
                            <span className="text-muted-foreground truncate" title={listing.seller_username}>판매: {listing.seller_username}</span>
                            <span className={`cute-number-font flex shrink-0 items-center font-black ${isAuction ? 'text-violet-500' : 'text-primary'}`}>
                              {isAuction ? <Gavel className="h-3 w-3 mr-0.5" /> : <Coins className="h-3 w-3 mr-0.5" />}
                              {(isAuction ? startBid : listing.price).toLocaleString()}
                            </span>
                          </div>
                          {isAuction && (
                            <div className="space-y-1.5 rounded-xl border border-violet-200/70 bg-violet-50/80 p-2 dark:border-violet-300/15 dark:bg-violet-400/10">
                              {/* 남은 시간 — 가장 눈에 띄게(긴급도별 색상/펄스) */}
                              <div
                                className={`flex items-center justify-center gap-1 rounded-lg px-2 py-1 text-[11px] font-black tabular-nums ${
                                  isEnded
                                    ? 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300'
                                    : isUrgent
                                      ? 'animate-pulse bg-red-500 text-white shadow-sm shadow-red-500/30'
                                      : isSoon
                                        ? 'bg-amber-400 text-amber-950'
                                        : 'bg-violet-500/15 text-violet-700 dark:bg-violet-400/15 dark:text-violet-100'
                                }`}
                                title={endsAt ? formatLocalDateTime(endsAt) : ''}
                              >
                                <Clock className="h-3 w-3 shrink-0" />
                                {isEnded ? '마감 처리 중' : `${formatRemaining(remainingMs)} 남음`}
                              </div>
                              {/* 시작가 */}
                              <div className="flex items-center justify-between text-[10px] font-bold text-violet-700 dark:text-violet-200">
                                <span>시작가</span>
                                <span className="cute-number-font">{startBid.toLocaleString()} P</span>
                              </div>
                              {/* 비공개 입찰 안내 */}
                              <div className="flex items-center justify-between gap-1 text-[9px] font-semibold text-violet-700/70 dark:text-violet-100/60">
                                <span className="truncate">입찰 정보 비공개</span>
                                {isUrgent && <span className="shrink-0 font-black text-red-500">마감 임박</span>}
                              </div>
                            </div>
                          )}

                          {user && user.id === listing.seller_id ? (
                            <button
                              disabled
                              className="w-full rounded-lg bg-secondary py-1.5 text-[10px] font-bold text-muted-foreground cursor-not-allowed text-center dark:bg-zinc-800 dark:text-zinc-500"
                            >
                              내 등록 매물
                            </button>
                          ) : (
                            <div className="space-y-1.5">
                              {isAuction && !isEnded && (
                                <div className="flex gap-1">
                                  <input
                                    type="number"
                                    min={minBid}
                                    value={bidInputs[listing.id] || ''}
                                    onChange={(event) => setBidInputs(prev => ({ ...prev, [listing.id]: event.target.value }))}
                                    placeholder={`${minBid.toLocaleString()}P`}
                                    className="min-w-0 flex-1 rounded-xl border border-border bg-card px-2 py-1.5 text-[10px] font-bold focus:border-primary focus:outline-none"
                                  />
                                  <button
                                    onClick={() => handlePlaceBid(listing)}
                                    disabled={biddingListingId === listing.id}
                                    className="cute-wiggle-hover rounded-xl bg-violet-500 px-2 py-1.5 text-[10px] font-black text-white shadow-sm transition hover:bg-violet-600 disabled:opacity-50"
                                  >
                                    입찰
                                  </button>
                                </div>
                              )}
                              {(!isAuction || buyNowPrice > 0) && (
                                <button
                                  onClick={() => {
                                    const finalPrice = isAuction ? buyNowPrice : listing.price;
                                    const streamerName = streamer?.name || '스트리머';
                                    if (isAuction) {
                                      openAuctionBuyConfirm(listing.id, finalPrice, streamerName);
                                    } else {
                                      openMarketBuyConfirm(listing.id, finalPrice, streamerName);
                                    }
                                  }}
                                  disabled={purchasingListingId === listing.id || (isAuction && buyNowPrice <= 0)}
                                  className="cute-wiggle-hover flex w-full items-center justify-center gap-1 rounded-2xl bg-primary py-1.5 text-[10px] font-bold text-primary-foreground shadow-sm transition hover:bg-primary/95 active:scale-95 disabled:opacity-50"
                                >
                                  <ShoppingBag className="h-3 w-3" />
                                  {purchasingListingId === listing.id ? '처리 중...' : isAuction ? `${buyNowPrice.toLocaleString()}P 즉시낙찰` : '구매하기'}
                                </button>
                              )}
                              {streamer?.channel_id && (
                                <button
                                  onClick={() => handleCreateWatch({ channel_id: streamer.channel_id, star, max_price: isAuction ? buyNowPrice || startBid : listing.price })}
                                  disabled={watchBusy}
                                  className="flex w-full items-center justify-center gap-1 rounded-2xl border border-sky-200 bg-sky-50 py-1.5 text-[10px] font-black text-sky-600 transition hover:bg-sky-100 disabled:opacity-50 dark:border-sky-300/15 dark:bg-sky-400/10 dark:text-sky-200"
                                >
                                  <Bell className="h-3 w-3" /> 이 카드 알림
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 오픈마켓 페이지네이션 바 */}
                {marketTotalPages > 1 && (
                  <div className="flex flex-col items-center justify-center gap-3 border-t border-border/30 pt-4 sm:flex-row sm:flex-wrap">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => handleMarketPageChange(marketPage - 1)}
                        disabled={marketPage === 1}
                        className="rounded-lg border border-border bg-card p-1.5 hover:bg-secondary/40 disabled:opacity-30 disabled:pointer-events-none transition"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      {getPaginationItems(marketPage, marketTotalPages).map((item, index) => {
                        if (item === 'ellipsis') {
                          return <span key={`ellipsis-${index}`} className="px-1 text-xs font-black text-muted-foreground">...</span>;
                        }
                        const p = item;
                        return (
                          <button
                            key={p}
                            onClick={() => handleMarketPageChange(p)}
                            className={`px-3 py-1 rounded-lg text-xs font-bold transition ${marketPage === p ? 'bg-primary text-primary-foreground' : 'bg-card border border-border text-foreground hover:bg-secondary/40'}`}
                          >
                            {p}
                          </button>
                        );
                      })}
                      <button
                        onClick={() => handleMarketPageChange(marketPage + 1)}
                        disabled={marketPage === marketTotalPages}
                        className="rounded-lg border border-border bg-card p-1.5 hover:bg-secondary/40 disabled:opacity-30 disabled:pointer-events-none transition"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                    <form
                      className="flex items-center gap-1.5"
                      onSubmit={(event) => {
                        event.preventDefault();
                        goToMarketPage();
                      }}
                    >
                      <input
                        type="number"
                        min={1}
                        max={marketTotalPages}
                        value={marketPageInput}
                        onChange={(event) => setMarketPageInput(event.target.value)}
                        onBlur={goToMarketPage}
                        className="h-8 w-16 rounded-lg border border-border bg-card px-2 text-center text-xs font-black focus:border-primary focus:outline-none"
                        aria-label="이동할 오픈마켓 페이지"
                      />
                      <span className="text-[11px] font-bold text-muted-foreground">/ {marketTotalPages.toLocaleString()}</span>
                      <button
                        type="submit"
                        className="h-8 rounded-lg border border-border bg-card px-3 text-xs font-black text-foreground transition hover:bg-secondary/40"
                      >
                        이동
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      ) : subTab === 'my_listings' ? (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* 내가 등록한 판매 카드 관리 내역 */}
          <section data-tour="shop-my-listings" className="cute-surface rounded-[2rem] p-6 space-y-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-base font-bold flex items-center gap-2">
                    <ArrowRightLeft className="h-4.5 w-4.5 text-primary" /> 내 등록 매물 관리 ({myListings.length}건)
                  </h3>
                  <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
                    판매 중인 매물은 등록 취소할 수 있고, 취소/완료된 매물은 이 화면에서 삭제해 숨길 수 있습니다. DB 기록은 유지됩니다.
                  </p>
                </div>
              </div>
              {myListings.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">등록된 판매 매물이 없습니다.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-border/80 text-muted-foreground">
                        <th className="py-2.5">카드 정보</th>
                        <th className="py-2.5">가격/입찰</th>
                        <th className="py-2.5">정산액</th>
                        <th className="py-2.5">상태</th>
                        <th className="py-2.5 text-right">관리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {myListings.map((l) => {
                        const streamer = l.card?.streamer;
                        const star = l.card?.star ?? 0;
                        const isAuction = l.listing_type === 'auction';
                        const startBid = Number(l.starting_bid || l.price || 0);
                        const feeRate = Number(l.fee_rate ?? 5);
                        return (
                          <tr key={l.id} className="border-b border-border/40 hover:bg-secondary/10">
                            <td className="py-3 flex items-center gap-2">
                              <img src={streamer?.logo_url || ''} className="h-7 w-7 rounded-md object-cover border border-border/60" />
                              <div className="flex flex-col">
                                <span className="font-bold text-[11px] text-foreground">{streamer?.name || '스트리머'}</span>
                                <div className="flex items-center gap-1">
                                  <span className="text-[9px] text-yellow-500">
                                    {star > 0 ? Array.from({ length: star }).map(() => '★').join('') : '일반'}
                                  </span>
                                  <span className="text-[9px] text-muted-foreground">No.{formatStreamerSerial(streamer)}</span>
                                </div>
                              </div>
                            </td>
                            <td className="py-3">
                              <div className={`font-black ${isAuction ? 'text-violet-500' : 'text-yellow-500'}`}>
                                {isAuction ? `${startBid.toLocaleString()} P 시작` : `${l.price.toLocaleString()} P`}
                              </div>
                              {isAuction && (
                                <div className="mt-0.5 text-[9px] font-bold text-muted-foreground">
                                  {l.buy_now_price ? `즉시 ${Number(l.buy_now_price).toLocaleString()} P` : '입찰 전용'}
                                </div>
                              )}
                            </td>
                            <td className="py-3 text-muted-foreground font-semibold">
                              {l.status === 'SOLD' ? (
                                <div className="flex flex-col">
                                  <span>{l.settled_amount.toLocaleString()} P</span>
                                  <span className="text-[9px] font-bold text-rose-500">수수료 {feeRate}%</span>
                                </div>
                              ) : '-'}
                            </td>
                            <td className="py-3">
                              {l.status === 'PENDING' && (
                                <div className="flex flex-col items-start gap-0.5">
                                  <span className="rounded bg-sky-500/10 px-2 py-0.5 font-bold text-sky-500 text-[10px]">판매 중</span>
                                  {isAuction && l.auction_ends_at && (() => {
                                    const rem = (parseAppDate(l.auction_ends_at)?.getTime() ?? 0) - nowTs;
                                    return (
                                      <span className={`text-[9px] font-black tabular-nums ${rem <= 0 ? 'text-zinc-400' : rem < 60_000 ? 'text-red-500' : 'text-violet-500'}`}>
                                        {rem <= 0 ? '마감 처리 중' : `${formatRemaining(rem)} 남음`}
                                      </span>
                                    );
                                  })()}
                                </div>
                              )}
                              {l.status === 'SOLD' && (
                                <span className="rounded bg-emerald-500/10 px-2 py-0.5 font-bold text-emerald-500 text-[10px]">판매 완료</span>
                              )}
                              {l.status === 'CANCELLED' && (
                                <span className="rounded bg-zinc-500/10 px-2 py-0.5 font-bold text-zinc-500 text-[10px]">등록 취소됨</span>
                              )}
                              {l.status === 'AUCTION_ENDED' && (
                                <span className="rounded bg-violet-500/10 px-2 py-0.5 font-bold text-violet-500 text-[10px]">경매 종료</span>
                              )}
                            </td>
                            <td className="py-3 text-right">
                              {l.status === 'PENDING' ? (
                                <div className="flex flex-col items-end gap-1">
                                  <button
                                    onClick={() => handleCancelMarketItem(l.id)}
                                    disabled={cancellingListingId === l.id}
                                    className="rounded-lg bg-rose-600/10 px-2.5 py-1 text-[10px] font-bold text-rose-500 transition hover:bg-rose-600/20 disabled:pointer-events-none disabled:opacity-45"
                                  >
                                    {cancellingListingId === l.id ? '취소 중...' : '등록 취소'}
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleHideMyListing(l.id)}
                                  disabled={hidingListingId === l.id}
                                  className="rounded-lg bg-secondary px-2.5 py-1 text-[10px] font-bold text-muted-foreground transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-50 dark:hover:bg-rose-500/10"
                                >
                                  {hidingListingId === l.id ? '삭제 중...' : '목록 삭제'}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
        </div>
      ) : (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* 거래 이력 (영수증) 영역 */}
          <section className="cute-surface rounded-[2rem] p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-xl font-black flex items-center gap-2">
                  <Clock className="h-5.5 w-5.5 text-primary" /> 거래 이력 (영수증)
                </h2>
                <p className="text-xs text-muted-foreground">
                  {historyScope === 'all'
                    ? '오픈마켓에서 완료된 전체 거래 내역입니다.'
                    : '내가 오픈마켓에서 구매했거나 판매 완료한 최근 거래 내역입니다.'}
                </p>
              </div>
              {/* 전체 / 내 거래 이력 토글 */}
              <div className="flex self-start rounded-2xl border border-border bg-secondary/60 p-1">
                {([['all', '전체'], ['mine', '내 거래 이력']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => handleHistoryScopeChange(key)}
                    className={`cute-wiggle-hover rounded-xl px-3 py-1.5 text-xs font-bold transition ${historyScope === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {isLoadingHistory ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
                <p className="text-xs text-muted-foreground">이력 불러오는 중...</p>
              </div>
            ) : marketHistory.length === 0 ? (
              <div className="rounded-2xl border border-border/80 border-dashed py-16 text-center text-xs text-muted-foreground">
                최근 거래 내역이 없습니다.
              </div>
            ) : (() => {
              const historyPerPage = 10;
              const historyTotalPages = Math.ceil(marketHistory.length / historyPerPage);
              const historyCurrentPage = Math.min(Math.max(1, marketHistoryPage), Math.max(1, historyTotalPages));
              const paginatedHistory = marketHistory.slice(
                (historyCurrentPage - 1) * historyPerPage,
                historyCurrentPage * historyPerPage
              );

              return (
                <div className="space-y-6">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-border/80 text-muted-foreground">
                          <th className="py-2.5">거래 종류</th>
                          <th className="py-2.5">카드 정보</th>
                          <th className="py-2.5">거래 금액</th>
                          <th className="py-2.5">{historyScope === 'all' ? '판매자 → 구매자' : '정산/지출'}</th>
                          <th className="py-2.5">거래 일시</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedHistory.map((l) => {
                          const isSeller = l.seller_id === user?.id;
                          const isBuyer = l.buyer_id === user?.id;
                          const streamer = l.card?.streamer;
                          const star = l.card?.star ?? 0;

                          let typeLabel = '';
                          let typeColor = '';
                          let actionPoint = '';
                          let actionPointColor = '';

                          if (historyScope === 'all') {
                            // 전체 거래 장부: 모두 완료된(SOLD) 거래
                            typeLabel = '거래 완료';
                            typeColor = 'bg-emerald-500/10 text-emerald-500';
                          } else if (l.status === 'SOLD') {
                            if (isSeller) {
                              typeLabel = '판매 완료';
                              typeColor = 'bg-emerald-500/10 text-emerald-500';
                              actionPoint = `+${l.settled_amount.toLocaleString()} P`;
                              actionPointColor = 'text-emerald-500 font-extrabold';
                            } else if (isBuyer) {
                              typeLabel = '구매 완료';
                              typeColor = 'bg-sky-500/10 text-sky-500';
                              actionPoint = `-${l.price.toLocaleString()} P`;
                              actionPointColor = 'text-sky-500 font-extrabold';
                            }
                          } else if (l.status === 'CANCELLED') {
                            typeLabel = '등록 취소';
                            typeColor = 'bg-zinc-500/10 text-zinc-500';
                            actionPoint = '-';
                            actionPointColor = 'text-muted-foreground';
                          }

                          const formattedDate = l.updated_at
                            ? formatLocalDateTime(l.updated_at)
                            : '-';

                          return (
                            <tr key={l.id} className="border-b border-border/40 hover:bg-secondary/10">
                              <td className="py-3">
                                <span className={`rounded px-2.5 py-0.5 font-bold text-[10px] ${typeColor}`}>
                                  {typeLabel}
                                </span>
                              </td>
                              <td className="py-3 flex items-center gap-2">
                                <img src={streamer?.logo_url || ''} className="h-7 w-7 rounded-md object-cover border border-border/60" />
                                <div className="flex flex-col">
                                  <span className="font-bold text-[11px] text-foreground">{streamer?.name || '스트리머'}</span>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[9px] text-yellow-500">
                                      {star > 0 ? Array.from({ length: star }).map(() => '★').join('') : '일반'}
                                    </span>
                                    <span className="text-[9px] text-muted-foreground">No.{formatStreamerSerial(streamer)}</span>
                                    {l.with_cosmetics && (
                                      <span className="rounded bg-primary/10 border border-primary/20 px-1 py-0.2 text-[8px] font-black text-primary">
                                        코스메틱 포함
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="py-3 font-bold text-yellow-500">{l.price.toLocaleString()} P</td>
                              <td className="py-3 font-semibold text-[11px]">
                                {historyScope === 'all' ? (
                                  <span className="text-muted-foreground">
                                    {l.seller_username || '?'} <span className="text-primary">→</span> {l.buyer_username || '?'}
                                  </span>
                                ) : (
                                  <span className={actionPointColor}>{actionPoint}</span>
                                )}
                              </td>
                              <td className="py-3 text-muted-foreground text-[10px]">{formattedDate}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* 영수증 페이지네이션 */}
                  {historyTotalPages > 1 && (
                    <div className="mt-4 flex flex-col items-center justify-center gap-3 border-t border-border/30 pt-4 sm:flex-row sm:flex-wrap">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleHistoryPageChange(historyCurrentPage - 1)}
                          disabled={historyCurrentPage === 1}
                          className="rounded-lg border border-border bg-card p-1.5 hover:bg-secondary/40 disabled:opacity-30 disabled:pointer-events-none transition"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        {getPaginationItems(historyCurrentPage, historyTotalPages).map((item, index) => {
                          if (item === 'ellipsis') {
                            return <span key={`history-ellipsis-${index}`} className="px-1 text-xs font-black text-muted-foreground">...</span>;
                          }
                          const p = item;
                          return (
                            <button
                              key={p}
                              onClick={() => handleHistoryPageChange(p)}
                              className={`px-3 py-1 rounded-lg text-xs font-bold transition ${historyCurrentPage === p ? 'bg-primary text-primary-foreground' : 'bg-card border border-border text-foreground hover:bg-secondary/40'}`}
                            >
                              {p}
                            </button>
                          );
                        })}
                        <button
                          onClick={() => handleHistoryPageChange(historyCurrentPage + 1)}
                          disabled={historyCurrentPage === historyTotalPages}
                          className="rounded-lg border border-border bg-card p-1.5 hover:bg-secondary/40 disabled:opacity-30 disabled:pointer-events-none transition"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                      <form
                        className="flex items-center gap-1.5"
                        onSubmit={(event) => {
                          event.preventDefault();
                          goToHistoryPage(historyTotalPages);
                        }}
                      >
                        <input
                          type="number"
                          min={1}
                          max={historyTotalPages}
                          value={marketHistoryPageInput}
                          onChange={(event) => setMarketHistoryPageInput(event.target.value)}
                          onBlur={() => goToHistoryPage(historyTotalPages)}
                          className="h-8 w-16 rounded-lg border border-border bg-card px-2 text-center text-xs font-black focus:border-primary focus:outline-none"
                          aria-label="이동할 거래 이력 페이지"
                        />
                        <span className="text-[11px] font-bold text-muted-foreground">/ {historyTotalPages.toLocaleString()}</span>
                        <button
                          type="submit"
                          className="h-8 rounded-lg border border-border bg-card px-3 text-xs font-black text-foreground transition hover:bg-secondary/40"
                        >
                          이동
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              );
            })()}
          </section>
        </div>
      )}

      {imageBlindMenu.open && (
        <div
          className="fixed z-[95] w-52 overflow-hidden rounded-2xl border border-border bg-card/95 p-1.5 text-xs shadow-2xl backdrop-blur-md animate-in fade-in duration-100"
          style={{ left: imageBlindMenu.x, top: imageBlindMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="px-3 py-2">
            <p className="truncate text-[10px] font-black text-muted-foreground">{imageBlindMenu.name}</p>
          </div>
          <button
            type="button"
            onClick={async () => {
              if (isImageBlinded(imageBlindMenu.imageUrl)) await unblindImage(imageBlindMenu.imageUrl);
              else await blindImage(imageBlindMenu.imageUrl);
              setImageBlindMenu((prev) => ({ ...prev, open: false }));
            }}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-black text-foreground transition hover:bg-secondary/80"
          >
            {isImageBlinded(imageBlindMenu.imageUrl) ? '👁️ 이미지 블라인드 해제' : '🚫 같은 이미지 블라인드'}
          </button>
        </div>
      )}

      {marketBuyConfirm && (
        <div
          className="modal-backdrop modal-backdrop-center z-[90] bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setMarketBuyConfirm(null)}
        >
          <div
            className="modal-panel modal-panel-sm modal-panel-scroll rounded-2xl border border-border bg-card p-5 text-center shadow-2xl animate-in zoom-in-95 duration-200 sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/12 text-primary">
              <ShoppingBag className="h-6 w-6" />
            </div>
            <h4 className="text-base font-black text-foreground">구매 확인</h4>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              <b className="text-foreground">{marketBuyConfirm.streamerName}</b> 카드를 구매할까요?
              확인하면 포인트가 차감되고 카드가 보관함으로 이동합니다.
            </p>
            <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-left">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-bold text-muted-foreground">구매 가격</span>
                <span className="cute-number-font inline-flex items-center gap-1 font-black text-primary">
                  <Coins className="h-3.5 w-3.5" />
                  {marketBuyConfirm.price.toLocaleString()} P
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 text-[11px]">
                <span className="font-bold text-muted-foreground">구매 후 예상 보유 포인트</span>
                <span className="cute-number-font font-black text-foreground">
                  {Math.max(0, (user?.point || 0) - marketBuyConfirm.price).toLocaleString()} P
                </span>
              </div>
            </div>
            <div className="mt-5 flex justify-center gap-2">
              <button
                onClick={() => setMarketBuyConfirm(null)}
                className="rounded-xl bg-secondary px-4 py-2 text-xs font-bold text-muted-foreground transition hover:bg-secondary/80"
              >
                취소
              </button>
              <button
                onClick={confirmMarketBuyNow}
                disabled={purchasingListingId === marketBuyConfirm.listingId}
                className="cute-wiggle-hover inline-flex items-center gap-1 rounded-xl bg-primary px-4 py-2 text-xs font-black text-primary-foreground shadow-sm shadow-primary/20 transition hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
              >
                <ShoppingBag className="h-3.5 w-3.5" />
                {purchasingListingId === marketBuyConfirm.listingId ? '처리 중...' : '구매하기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {auctionBuyConfirm && (
        <div
          className="modal-backdrop modal-backdrop-center z-[90] bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setAuctionBuyConfirm(null)}
        >
          <div
            className="modal-panel modal-panel-sm modal-panel-scroll rounded-2xl border border-border bg-card p-5 text-center shadow-2xl animate-in zoom-in-95 duration-200 sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/12 text-violet-500">
              <Gavel className="h-6 w-6" />
            </div>
            <h4 className="text-base font-black text-foreground">즉시 낙찰 확인</h4>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              <b className="text-foreground">{auctionBuyConfirm.streamerName}</b> 경매를 즉시 낙찰할까요?
              확인하면 입찰 마감까지 기다리지 않고 바로 거래가 체결됩니다.
            </p>
            <div className="mt-4 rounded-2xl border border-violet-200/70 bg-violet-50/80 px-4 py-3 text-left dark:border-violet-300/15 dark:bg-violet-400/10">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-bold text-muted-foreground">즉시 낙찰가</span>
                <span className="cute-number-font inline-flex items-center gap-1 font-black text-violet-600 dark:text-violet-200">
                  <Coins className="h-3.5 w-3.5" />
                  {auctionBuyConfirm.price.toLocaleString()} P
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 text-[11px]">
                <span className="font-bold text-muted-foreground">낙찰 후 예상 보유 포인트</span>
                <span className="cute-number-font font-black text-foreground">
                  {Math.max(0, (user?.point || 0) - auctionBuyConfirm.price).toLocaleString()} P
                </span>
              </div>
            </div>
            <div className="mt-5 flex justify-center gap-2">
              <button
                onClick={() => setAuctionBuyConfirm(null)}
                className="rounded-xl bg-secondary px-4 py-2 text-xs font-bold text-muted-foreground transition hover:bg-secondary/80"
              >
                취소
              </button>
              <button
                onClick={confirmAuctionBuyNow}
                className="cute-wiggle-hover inline-flex items-center gap-1 rounded-xl bg-violet-500 px-4 py-2 text-xs font-black text-white shadow-sm shadow-violet-500/20 transition hover:bg-violet-600"
              >
                <Gavel className="h-3.5 w-3.5" />
                즉시 낙찰
              </button>
            </div>
          </div>
        </div>
      )}

      {previewCosmetic && (
        <div
          className="modal-backdrop modal-backdrop-center z-[90] bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setPreviewCosmetic(null)}
        >
          <div
            className="relative animate-in zoom-in-95 duration-200"
            onClick={(event) => event.stopPropagation()}
          >
            <div
              style={{
                width: '224px',
                height: '358.4px',
                transform: 'scale(min(calc(82vh / 358.4px), calc(92vw / 224px)))',
                transformOrigin: 'center'
              }}
            >
              <CardPreview
                border={previewCosmetic.type === 'border' ? previewCosmetic : null}
                nameEffect={previewCosmetic.type === 'name_effect' ? previewCosmetic : null}
                withComet
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
