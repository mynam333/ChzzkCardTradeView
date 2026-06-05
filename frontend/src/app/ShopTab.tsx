'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useApp } from './AppContext';
import { apiFetch } from '@/lib/api';
import { parseStyle, nameEffectStyle, borderClass, borderStyle, cardImage } from '@/lib/cosmetics';
import { CosmeticFrame } from './CosmeticFrame';
import { CosmeticName } from './CosmeticName';
import { Sparkles, Coins, ShoppingBag, Store, Search, ChevronLeft, ChevronRight, ArrowRightLeft, Clock, Trash2, X, Layers } from 'lucide-react';

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
}

export const ShopTab: React.FC = () => {
  const { user, updatePoints, refreshUserData, toast, setActiveTab } = useApp();

  const searchParams = useSearchParams();
  const router = useRouter();

  // ---- 가챠(소환) ----
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawnCard, setDrawnCard] = useState<any | null>(null);
  
  // ---- 대분류 탭 ----
  const [subTab, setSubTab] = useState<'gacha_shop' | 'market' | 'history'>('gacha_shop');

  // ---- 상점 ----
  const [items, setItems] = useState<ShopItem[]>([]);
  const [owned, setOwned] = useState<Record<number, number>>({});
  const [purchased, setPurchased] = useState<Record<number, number>>({});
  const [cosmeticPage, setCosmeticPage] = useState(1);

  // ---- 오픈마켓 ----
  const [marketListings, setMarketListings] = useState<any[]>([]);
  const [marketTotal, setMarketTotal] = useState(0);
  const [marketSearch, setMarketSearch] = useState('');
  const [marketSort, setMarketSort] = useState<'latest' | 'oldest' | 'price_desc' | 'price_asc'>('latest');
  const [marketPage, setMarketPage] = useState(1);
  const [myListings, setMyListings] = useState<any[]>([]);
  const [isLoadingMarket, setIsLoadingMarket] = useState(false);
  const [purchasingListingId, setPurchasingListingId] = useState<number | null>(null);
  const [cancellingListingId, setCancellingListingId] = useState<number | null>(null);

  // ---- 거래 이력 ----
  const [marketHistory, setMarketHistory] = useState<any[]>([]);
  const [marketHistoryPage, setMarketHistoryPage] = useState(1);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // URL category 쿼리 파라미터를 기반으로 초기 shopType 결정
  const categoryParam = searchParams.get('category');
  const initialShopType = (categoryParam === 'name_effect' || categoryParam === 'border')
    ? categoryParam
    : 'border';

  const [shopType, setShopType] = useState<'border' | 'name_effect'>(initialShopType);
  const [buying, setBuying] = useState<number | null>(null);

  // 외부(뒤로가기 등)에서 URL 파라미터가 바뀔 때 상태 동기화
  useEffect(() => {
    const param = searchParams.get('category');
    if (param === 'border' || param === 'name_effect') {
      setShopType(param);
    }
  }, [searchParams]);

  // 카테고리 전환 시 URL 쿼리 파라미터 동기화
  const handleShopTypeChange = (type: 'border' | 'name_effect') => {
    setShopType(type);
    const newParams = new URLSearchParams(window.location.search);
    newParams.set('category', type);
    router.replace(`/shop?${newParams.toString()}`);
  };

  useEffect(() => {
    fetchItems();
    if (user) { fetchOwned(); fetchPurchased(); }
  }, [user]);

  // 1. 마운트 시 즉시 최신 정보 가져오기 및 주기적(10초) 폴링
  useEffect(() => {
    if (!user) return;
    
    // 마운트 시 즉각 데이터 리프레시
    refreshUserData();

    // 10초 주기 백그라운드 갱신 인터벌
    const intervalId = setInterval(() => {
      refreshUserData();
    }, 10000);

    return () => clearInterval(intervalId);
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
    try {
      const res = await apiFetch('/shop/items');
      if (res.ok) setItems(await res.json());
    } catch { /* noop */ }
  };
  const fetchOwned = async () => {
    try {
      const res = await apiFetch('/shop/inventory');
      if (res.ok) {
        const list = await res.json();
        const map: Record<number, number> = {};
        for (const c of list) map[c.id] = c.quantity;
        setOwned(map);
      }
    } catch { /* noop */ }
  };
  const fetchPurchased = async () => {
    try {
      const res = await apiFetch('/shop/purchases');
      if (res.ok) setPurchased(await res.json());
    } catch { /* noop */ }
  };

  const fetchMarketListings = async () => {
    setIsLoadingMarket(true);
    try {
      const query = new URLSearchParams({
        page: String(marketPage),
        limit: '12',
        sort: marketSort,
      });
      if (marketSearch.trim()) {
        query.append('search', marketSearch.trim());
      }
      const res = await apiFetch(`/market/listings?${query.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setMarketListings(data.listings || []);
        setMarketTotal(data.total || 0);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingMarket(false);
    }
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

  const fetchMarketHistory = async () => {
    if (!user) return;
    setIsLoadingHistory(true);
    try {
      const res = await apiFetch('/market/history');
      if (res.ok) {
        setMarketHistory(await res.json());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (subTab === 'market') {
      fetchMarketListings();
    }
  }, [subTab, marketPage, marketSort]);

  useEffect(() => {
    if (subTab === 'market') {
      const handler = setTimeout(() => {
        setMarketPage(1);
        fetchMarketListings();
      }, 300);
      return () => clearTimeout(handler);
    }
  }, [marketSearch]);

  useEffect(() => {
    if (subTab === 'market' && user) {
      fetchMyListings();
    }
  }, [subTab, user]);

  useEffect(() => {
    if (subTab === 'history' && user) {
      setMarketHistoryPage(1);
      fetchMarketHistory();
    }
  }, [subTab, user]);

  useEffect(() => {
    setCosmeticPage(1);
  }, [shopType, items]);

  const handleBuyMarketItem = async (listingId: number, price: number, streamerName: string) => {
    if (!user) {
      toast('로그인이 필요합니다.', 'warning');
      return;
    }
    if (user.point < price) {
      toast('포인트가 부족합니다.', 'warning');
      return;
    }

    setPurchasingListingId(listingId);
    try {
      const res = await apiFetch(`/market/buy/${listingId}`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        toast(`'${streamerName}' 카드 구매가 완료되었습니다.`, 'success');
        updatePoints(-price);
        refreshUserData();
        fetchMarketListings();
        fetchMyListings();
      } else {
        toast(data.message || '구매에 실패했습니다.', 'error');
      }
    } catch {
      toast('서버와의 통신 오류가 발생했습니다.', 'error');
    } finally {
      setPurchasingListingId(null);
    }
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

  const isFreeDraw = user?.isFreeDrawEligible ?? false;

  const handleDraw = async () => {
    if (!user) { toast('로그인이 필요합니다.', 'warning'); return; }
    const drawCost = user.drawCost ?? 10000;
    if (!isFreeDraw && user.point < drawCost) {
      toast(`포인트가 부족합니다. (1회 뽑기: ${drawCost.toLocaleString()} P)`, 'warning');
      return;
    }
    setIsDrawing(true);
    setDrawnCard(null);
    try {
      const res = await apiFetch('/cards/draw', { method: 'POST' });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.message || '카드 뽑기 요청에 실패했습니다.');
      }
      const data = await res.json();
      setTimeout(() => {
        setDrawnCard(data.card.streamer);
        setIsDrawing(false);
        if (!data.is_free) updatePoints(-drawCost);
        refreshUserData();
        // SSR 및 Turbopack의 CJS 모듈 바인딩 이슈 우회를 위해 동적 임포트 적용
        import('canvas-confetti').then((module) => {
          const confetti = module.default;
          confetti({ particleCount: 90, spread: 70, origin: { y: 0.6 }, colors: ['#10b981', '#3b82f6'] });
        }).catch((err) => console.error('Confetti 로드 실패:', err));
      }, 1200);
    } catch (e: any) {
      setIsDrawing(false);
      toast(e.message || '서버와의 통신 오류가 발생했습니다.', 'error');
    }
  };

  const handleBuy = async (item: ShopItem) => {
    if (!user) { toast('로그인이 필요합니다.', 'warning'); return; }
    setBuying(item.id);
    try {
      const res = await apiFetch('/shop/buy', { method: 'POST', body: JSON.stringify({ item_id: item.id }) });
      const data = await res.json();
      if (res.ok) {
        toast(`'${item.name}' 구매 완료!`, 'success');
        updatePoints(-item.price);
        refreshUserData();
        fetchOwned();
        fetchPurchased();
      } else {
        toast(data.message || '구매 실패', 'error');
      }
    } catch {
      toast('서버와의 통신 오류가 발생했습니다.', 'error');
    } finally {
      setBuying(null);
    }
  };

  const filtered = items.filter((i) => i.type === shopType);
  const cosmeticTotal = filtered.length;
  const cosmeticTotalPages = Math.ceil(cosmeticTotal / 8);
  const paginatedCosmetics = filtered.slice((cosmeticPage - 1) * 8, cosmeticPage * 8);

  const marketTotalPages = Math.ceil(marketTotal / 12);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* 대분류 탭 (아이콘 및 입체적인 캡슐 버튼 스타일로 시인성 개선) */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-3">
        {([
          ['gacha_shop', '소환 및 일반 상점', Store],
          ['market', '오픈마켓 (유저 거래)', ArrowRightLeft],
          ['history', '거래 이력 (영수증)', Clock]
        ] as const).map(([tabId, label, Icon]) => {
          const isActive = subTab === tabId;
          return (
            <button
              key={tabId}
              onClick={() => setSubTab(tabId)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition-all duration-200 cursor-pointer ${
                isActive
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
      <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
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
                <>매 자정 기준 <strong className="text-primary font-bold">{user?.freeDrawInterval ?? 24}시간마다</strong> 초기화되는 <strong className="text-primary font-bold">1회 무료 소환</strong> 기회를 제공합니다.</>
              )}
              <br />무료 기회 소진 이후 1회 소환 비용은 <strong className="text-foreground font-bold">{(user?.drawCost ?? 10000).toLocaleString()} 포인트</strong>입니다.
            </p>
          </div>
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={handleDraw}
              disabled={isDrawing}
              className="group relative flex h-28 w-44 cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-br from-sky-400 via-emerald-500 to-teal-500 dark:from-primary dark:via-emerald-500 dark:to-teal-600 font-bold text-primary-foreground shadow-md shadow-emerald-500/15 dark:shadow-lg dark:shadow-primary/20 transition-all hover:scale-105 active:scale-95 disabled:pointer-events-none"
            >
              <Sparkles className="h-8 w-8 animate-pulse text-white" />
              <div className="text-center">
                <span className="text-sm tracking-wide text-white/90">스트리머 소환</span>
                {isFreeDraw ? (
                  <p className="text-[10px] text-yellow-300 font-black flex items-center justify-center gap-1">✨ 무료 뽑기 가능</p>
                ) : (
                  <p className="text-[10px] text-emerald-100 flex items-center justify-center gap-1"><Coins className="h-3 w-3" /> {(user?.drawCost ?? 10000).toLocaleString()} P</p>
                )}
              </div>
            </button>
          </div>
        </div>

        {(isDrawing || drawnCard) && (
          <div className="mt-8 flex flex-col items-center justify-center border-t border-border/50 pt-8 animate-in fade-in duration-200">
            {isDrawing ? (
              <div className="flex flex-col items-center gap-3 py-12">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
                <p className="text-xs font-semibold text-muted-foreground">치지직 스트리머 카드 팩 개봉 중...</p>
              </div>
            ) : drawnCard ? (
              <div className="flex flex-col items-center">
                <span className="text-xs font-bold text-primary mb-3">축하합니다! 소환 성공 (보관함에서 확인)</span>
                <div className="relative flex h-80 w-52 flex-col justify-between overflow-hidden rounded-2xl bg-card p-4 shadow-xl border border-border/80">
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
                      <span className="text-sm font-black text-emerald-400">{(drawnCard.base_value || 0).toLocaleString()} P</span>
                    </div>
                  </div>
                </div>
                <button onClick={() => setDrawnCard(null)} className="mt-4 rounded-lg bg-secondary px-4 py-1.5 text-xs font-bold hover:bg-secondary/80 text-muted-foreground">닫기</button>
              </div>
            ) : null}
          </div>
        )}
      </section>

      {/* 상점 */}
      <section className="rounded-3xl border border-border bg-card p-6 shadow-sm space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-black flex items-center gap-2"><Store className="h-5.5 w-5.5 text-primary" /> 코스메틱 상점</h2>
          {user && <span className="text-xs font-bold text-yellow-500 flex items-center gap-1"><Coins className="h-3.5 w-3.5" /> {user.point.toLocaleString()} P</span>}
        </div>
        <p className="text-xs text-muted-foreground">포인트로 카드 테두리와 이름 이펙트를 구매하세요. 구매한 코스메틱은 보관함에서 카드에 장착할 수 있습니다.</p>

        {/* 종류 탭 (아이콘 추가로 시각적 조화성 증대) */}
        <div className="flex rounded-lg bg-secondary p-1 w-fit border border-border/40">
          {([
            ['border', '테두리', Layers],
            ['name_effect', '이름 이펙트', Sparkles]
          ] as const).map(([t, label, Icon]) => (
            <button
              key={t}
              onClick={() => handleShopTypeChange(t)}
              className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-bold transition-all duration-150 ${
                shopType === t
                  ? 'bg-card text-foreground shadow-sm font-extrabold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {paginatedCosmetics.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-10">판매 중인 {shopType === 'border' ? '테두리' : '이름 이펙트'}가 없습니다.</p>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {paginatedCosmetics.map((item) => {
                const limited = item.purchase_limit > 0;
                const bought = purchased[item.id] || 0;
                const soldOut = limited && bought >= item.purchase_limit;
                return (
                <div key={item.id} className="rounded-2xl border border-border bg-secondary/20 p-4 flex flex-col items-center gap-3">
                  {/* 미리보기 */}
                  {item.type === 'border' ? (
                    <div className="relative overflow-hidden rounded-xl border border-border/80 bg-gradient-to-br from-secondary to-card" style={{ width: '64px', height: '102.4px' }}>
                      <div style={{
                        width: '224px',
                        height: '358.4px',
                        transform: 'scale(calc(64 / 224))',
                        transformOrigin: 'top left',
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        pointerEvents: 'none',
                        containerType: 'inline-size',
                        ...(borderClass(item) ? {} : (borderStyle(item) || {}))
                      }}>
                        <CosmeticFrame border={item} />
                      </div>
                    </div>
                  ) : (
                    <div className="h-20 flex items-center justify-center">
                      <CosmeticName effect={item} className="text-lg font-black">{item.name}</CosmeticName>
                    </div>
                  )}
                  <div className="text-center">
                    <p className="text-xs font-bold truncate max-w-[8rem]">{item.name}</p>
                    {item.description && <p className="text-[10px] text-muted-foreground line-clamp-2">{item.description}</p>}
                  </div>
                  <div className="flex items-center gap-1 text-xs font-black text-yellow-500"><Coins className="h-3.5 w-3.5" /> {item.price.toLocaleString()}</div>
                  <div className="flex items-center gap-2">
                    {owned[item.id] ? (
                      <span className="text-[10px] font-bold text-emerald-500">보유 {owned[item.id]}개</span>
                    ) : null}
                    {limited && (
                      <span className={`text-[10px] font-bold ${soldOut ? 'text-rose-500' : 'text-muted-foreground'}`}>구매 {bought}/{item.purchase_limit}</span>
                    )}
                  </div>
                  <button
                    onClick={() => handleBuy(item)}
                    disabled={buying === item.id || soldOut}
                    className="w-full rounded-lg bg-primary py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-1"
                  >
                    <ShoppingBag className="h-3.5 w-3.5" /> {soldOut ? '구매 완료' : buying === item.id ? '구매 중...' : '구매'}
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

        <button onClick={() => setActiveTab('inventory')} className="w-full rounded-xl bg-secondary py-2.5 text-xs font-bold text-muted-foreground hover:bg-secondary/80 transition">
          보관함으로 이동하여 카드에 장착하기 →
        </button>
      </section>
    </div>
  ) : subTab === 'market' ? (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 오픈마켓 영역 */}
      <section className="rounded-3xl border border-border bg-card p-6 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-xl font-black flex items-center gap-2">
              <Store className="h-5.5 w-5.5 text-primary" /> 오픈마켓 장터
            </h2>
            <p className="text-xs text-muted-foreground">다른 유저들이 올린 카드를 구매하거나 내 카드를 판매하세요. (거래 완료 시 5%의 수수료 차감)</p>
          </div>
          {user && (
            <span className="text-xs font-bold text-yellow-500 flex items-center gap-1 self-start sm:self-auto">
              <Coins className="h-3.5 w-3.5" /> {user.point.toLocaleString()} P
            </span>
          )}
        </div>

        {/* 필터 & 검색 */}
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative w-full sm:flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="스트리머 또는 판매자 검색..."
              value={marketSearch}
              onChange={(e) => setMarketSearch(e.target.value)}
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
            onChange={(e: any) => { setMarketPage(1); setMarketSort(e.target.value); }}
            className="w-full sm:w-44 rounded-lg border border-border bg-card px-3 py-2 text-xs focus:border-primary focus:outline-none"
          >
            <option value="latest">최신 등록순</option>
            <option value="oldest">오래된 순</option>
            <option value="price_desc">높은 가격순</option>
            <option value="price_asc">낮은 가격순</option>
          </select>
        </div>

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
                
                return (
                  <div key={listing.id} className="flex flex-col gap-2 p-2 bg-secondary/10 border border-border/60 rounded-2xl shadow-sm hover:shadow-md transition">
                    {/* 카드 프레임 */}
                    <div
                      style={{
                        containerType: 'inline-size',
                        ...(borderClass(border) ? {} : (borderStyle(border) || {}))
                      }}
                      className={`group relative flex aspect-[5/8] w-full flex-col justify-between overflow-hidden rounded-xl bg-card shadow-sm border border-border/80 ${star >= 1 ? `card-star card-star-${star}` : ''}`}
                    >
                      <CosmeticFrame border={border} />
                      <div className="absolute inset-0 z-0">
                        <img
                          src={cardImage(streamer, star)}
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
                          <span className="rounded bg-black/50 px-1 py-0.5 text-[8px] font-black text-white/90">No.{String(listing.card?.serial_number || 1).padStart(4, '0')}</span>
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
                        <span className="font-black text-yellow-500 flex items-center shrink-0">
                          <Coins className="h-3 w-3 mr-0.5" /> {listing.price.toLocaleString()}
                        </span>
                      </div>
                      
                      {user && user.id === listing.seller_id ? (
                        <button
                          disabled
                          className="w-full rounded-lg bg-zinc-800 py-1.5 text-[10px] font-bold text-zinc-500 cursor-not-allowed text-center"
                        >
                          내 등록 매물
                        </button>
                      ) : (
                        <button
                          onClick={() => handleBuyMarketItem(listing.id, listing.price, streamer?.name || '스트리머')}
                          disabled={purchasingListingId === listing.id}
                          className="w-full rounded-lg bg-primary py-1.5 text-[10px] font-bold text-primary-foreground hover:bg-primary/95 transition flex items-center justify-center gap-1 shadow-sm active:scale-95 disabled:opacity-50"
                        >
                          <ShoppingBag className="h-3 w-3" />
                          {purchasingListingId === listing.id ? '구매 중...' : '구매하기'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 오픈마켓 페이지네이션 바 */}
            {marketTotalPages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-4 border-t border-border/30">
                <button
                  onClick={() => setMarketPage(p => Math.max(1, p - 1))}
                  disabled={marketPage === 1}
                  className="rounded-lg border border-border bg-card p-1.5 hover:bg-secondary/40 disabled:opacity-30 disabled:pointer-events-none transition"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                {Array.from({ length: marketTotalPages }).map((_, i) => {
                  const p = i + 1;
                  return (
                    <button
                      key={p}
                      onClick={() => setMarketPage(p)}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition ${marketPage === p ? 'bg-primary text-primary-foreground' : 'bg-card border border-border text-foreground hover:bg-secondary/40'}`}
                    >
                      {p}
                    </button>
                  );
                })}
                <button
                  onClick={() => setMarketPage(p => Math.min(marketTotalPages, p + 1))}
                  disabled={marketPage === marketTotalPages}
                  className="rounded-lg border border-border bg-card p-1.5 hover:bg-secondary/40 disabled:opacity-30 disabled:pointer-events-none transition"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 내가 등록한 판매 카드 관리 내역 */}
      {user && (
        <section className="rounded-3xl border border-border bg-card p-6 shadow-sm space-y-4">
          <h3 className="text-base font-bold flex items-center gap-2">
            <ArrowRightLeft className="h-4.5 w-4.5 text-primary" /> 내 등록 매물 관리 ({myListings.length}건)
          </h3>
          {myListings.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">등록된 판매 매물이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border/80 text-muted-foreground">
                    <th className="py-2.5">카드 정보</th>
                    <th className="py-2.5">판매가</th>
                    <th className="py-2.5">정산액 (수수료 5% 제함)</th>
                    <th className="py-2.5">상태</th>
                    <th className="py-2.5 text-right">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {myListings.map((l) => {
                    const streamer = l.card?.streamer;
                    const star = l.card?.star ?? 0;
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
                              <span className="text-[9px] text-muted-foreground">No.{String(l.card?.serial_number || 1).padStart(4, '0')}</span>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 font-bold text-yellow-500">{l.price.toLocaleString()} P</td>
                        <td className="py-3 text-muted-foreground font-semibold">
                          {l.status === 'SOLD' ? `${l.settled_amount.toLocaleString()} P` : '-'}
                        </td>
                        <td className="py-3">
                          {l.status === 'PENDING' && (
                            <span className="rounded bg-sky-500/10 px-2 py-0.5 font-bold text-sky-500 text-[10px]">판매 중</span>
                          )}
                          {l.status === 'SOLD' && (
                            <span className="rounded bg-emerald-500/10 px-2 py-0.5 font-bold text-emerald-500 text-[10px]">판매 완료</span>
                          )}
                          {l.status === 'CANCELLED' && (
                            <span className="rounded bg-zinc-500/10 px-2 py-0.5 font-bold text-zinc-500 text-[10px]">등록 취소됨</span>
                          )}
                        </td>
                        <td className="py-3 text-right">
                          {l.status === 'PENDING' && (
                            <button
                              onClick={() => handleCancelMarketItem(l.id)}
                              disabled={cancellingListingId === l.id}
                              className="rounded-lg bg-rose-600/10 hover:bg-rose-600/20 px-2.5 py-1 text-[10px] font-bold text-rose-500 transition disabled:opacity-50"
                            >
                              등록 취소
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
      )}
    </div>
  ) : (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 거래 이력 (영수증) 영역 */}
      <section className="rounded-3xl border border-border bg-card p-6 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-xl font-black flex items-center gap-2">
              <Clock className="h-5.5 w-5.5 text-primary" /> 거래 이력 (영수증)
            </h2>
            <p className="text-xs text-muted-foreground">내가 오픈마켓에서 구매했거나 판매 완료한 최근 거래 내역입니다.</p>
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
          const paginatedHistory = marketHistory.slice(
            (marketHistoryPage - 1) * historyPerPage,
            marketHistoryPage * historyPerPage
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
                      <th className="py-2.5">정산/지출</th>
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

                      if (l.status === 'SOLD') {
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
                        ? new Date(l.updated_at).toLocaleString('ko-KR')
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
                                <span className="text-[9px] text-muted-foreground">No.{String(l.card?.serial_number || 1).padStart(4, '0')}</span>
                                {l.with_cosmetics && (
                                  <span className="rounded bg-primary/10 border border-primary/20 px-1 py-0.2 text-[8px] font-black text-primary">
                                    코스메틱 포함
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-3 font-bold text-yellow-500">{l.price.toLocaleString()} P</td>
                          <td className="py-3 font-semibold text-[11px]"><span className={actionPointColor}>{actionPoint}</span></td>
                          <td className="py-3 text-muted-foreground text-[10px]">{formattedDate}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 영수증 페이지네이션 */}
              {historyTotalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-4 pt-2">
                  <button
                    onClick={() => setMarketHistoryPage(p => Math.max(1, p - 1))}
                    disabled={marketHistoryPage === 1}
                    className="rounded-lg border border-border bg-card p-1.5 hover:bg-secondary/40 disabled:opacity-30 disabled:pointer-events-none transition"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  {Array.from({ length: historyTotalPages }).map((_, i) => {
                    const p = i + 1;
                    return (
                      <button
                        key={p}
                        onClick={() => setMarketHistoryPage(p)}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition ${marketHistoryPage === p ? 'bg-primary text-primary-foreground' : 'bg-card border border-border text-foreground hover:bg-secondary/40'}`}
                      >
                        {p}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setMarketHistoryPage(p => Math.min(historyTotalPages, p + 1))}
                    disabled={marketHistoryPage === historyTotalPages}
                    className="rounded-lg border border-border bg-card p-1.5 hover:bg-secondary/40 disabled:opacity-30 disabled:pointer-events-none transition"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          );
        })()}
      </section>
    </div>
  )}
</div>
);
};
