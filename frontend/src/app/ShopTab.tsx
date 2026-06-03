'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useApp } from './AppContext';
import { apiFetch } from '@/lib/api';
import { parseStyle, nameEffectStyle, borderClass } from '@/lib/cosmetics';
import { CosmeticFrame } from './CosmeticFrame';
import { CosmeticName } from './CosmeticName';
import { Sparkles, Coins, ShoppingBag, Store } from 'lucide-react';
import canvasConfetti from 'canvas-confetti';

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

  // ---- 상점 ----
  const [items, setItems] = useState<ShopItem[]>([]);
  const [owned, setOwned] = useState<Record<number, number>>({});
  const [purchased, setPurchased] = useState<Record<number, number>>({});

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
        canvasConfetti({ particleCount: 90, spread: 70, origin: { y: 0.6 }, colors: ['#10b981', '#3b82f6'] });
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

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
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

        {/* 종류 탭 */}
        <div className="flex rounded-lg bg-secondary p-1 w-fit">
          {([['border', '테두리'], ['name_effect', '이름 이펙트']] as const).map(([t, label]) => (
            <button key={t} onClick={() => handleShopTypeChange(t)}
              className={`rounded-md px-3.5 py-1.5 text-xs font-bold transition ${shopType === t ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
              {label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-10">판매 중인 {shopType === 'border' ? '테두리' : '이름 이펙트'}가 없습니다.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {filtered.map((item) => {
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
                      ...(borderClass(item) ? {} : (parseStyle(item.style_json) || {}))
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
        )}

        <button onClick={() => setActiveTab('inventory')} className="w-full rounded-xl bg-secondary py-2.5 text-xs font-bold text-muted-foreground hover:bg-secondary/80 transition">
          보관함으로 이동하여 카드에 장착하기 →
        </button>
      </section>
    </div>
  );
};
