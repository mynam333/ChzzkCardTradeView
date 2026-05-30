'use client';

import React, { useState, useEffect } from 'react';
import { useApp } from './AppContext';
import { 
  Sparkles, 
  Search, 
  Coins, 
  HelpCircle, 
  Upload, 
  UserMinus, 
  Check, 
  RefreshCw,
  Clock,
  ArrowRightLeft,
  X,
  Plus,
  Layers
} from 'lucide-react';
import canvasConfetti from 'canvas-confetti';

interface Streamer {
  channel_id: string;
  name: string;
  logo_url: string;
  custom_image_url: string | null;
  base_value: number;
  follower_count: number;
}

interface UserCard {
  id: number;
  channel_id: string;
  serial_number: number;
  acquired_at: string;
  streamer?: Streamer;
}

export const GachaTab: React.FC = () => {
  const { user, updatePoints } = useApp();
  const [streamers, setStreamers] = useState<Streamer[]>([]);
  const [inventory, setInventory] = useState<UserCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // 1:1 교환 모달 상태
  const [tradeTargetUser, setTradeTargetUser] = useState('');
  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [selectedOfferCards, setSelectedOfferCards] = useState<number[]>([]); // 유저 보유 카드 일련 ID 목록
  
  // 뽑기 연출 애니메이션 상태
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawnCard, setDrawnCard] = useState<Streamer | null>(null);

  useEffect(() => {
    fetchStreamers();
    fetchInventory();
  }, []);

  const fetchStreamers = async () => {
    try {
      const res = await fetch('http://localhost:5000/api/streamers');
      if (res.ok) {
        const data = await res.json();
        setStreamers(data);
      }
    } catch (e) {
      // offline fallback
      setStreamers([
        { channel_id: 'ch1', name: '풍월량', logo_url: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=p1', custom_image_url: null, base_value: 8000, follower_count: 580000 },
        { channel_id: 'ch2', name: '우왁굳', logo_url: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=p2', custom_image_url: null, base_value: 9500, follower_count: 650000 },
        { channel_id: 'ch3', name: '한동숙', logo_url: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=p3', custom_image_url: null, base_value: 7500, follower_count: 420000 },
        { channel_id: 'ch4', name: '녹두로', logo_url: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=p4', custom_image_url: null, base_value: 4500, follower_count: 230000 },
        { channel_id: 'ch5', name: '서새봄', logo_url: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=p5', custom_image_url: null, base_value: 5100, follower_count: 310000 }
      ]);
    }
  };

  const fetchInventory = () => {
    // 로컬 세션 또는 Mock 인벤토리 로드
    const savedInv = localStorage.getItem(`inventory_${user?.id}`);
    if (savedInv) {
      setInventory(JSON.parse(savedInv));
    } else {
      setInventory([]);
    }
    setLoading(false);
  };

  // 등급 없이 오직 가치(base_value) 기준으로 비주얼 오라 레벨 구분
  const getCardBorderClass = (val: number) => {
    if (val >= 8000) return 'border-2 border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.4)] hologram-effect';
    if (val >= 5000) return 'border-2 border-fuchsia-500 shadow-[0_0_10px_rgba(217,70,239,0.35)]';
    if (val >= 3000) return 'border-2 border-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.3)]';
    return 'border border-border/80';
  };

  const getCardBadge = (val: number) => {
    if (val >= 8000) return <span className="rounded bg-gradient-to-r from-amber-500 to-orange-500 px-1.5 py-0.5 text-[9px] font-black text-white">LEGENDRY</span>;
    if (val >= 5000) return <span className="rounded bg-gradient-to-r from-fuchsia-500 to-purple-500 px-1.5 py-0.5 text-[9px] font-black text-white">EPIC</span>;
    if (val >= 3000) return <span className="rounded bg-blue-500 px-1.5 py-0.5 text-[9px] font-black text-white">RARE</span>;
    return <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">COMMON</span>;
  };

  const handleDraw = async () => {
    if (!user) return;
    const drawCost = 1000;
    if (user.point < drawCost) {
      alert('포인트가 부족합니다. (1회 뽑기: 1,000 P)');
      return;
    }

    setIsDrawing(true);
    setDrawnCard(null);

    // 1.5초 룰렛 연출 효과 부여
    setTimeout(() => {
      if (streamers.length === 0) return;
      const targetIndex = Math.floor(Math.random() * streamers.length);
      const chosen = streamers[targetIndex];

      setDrawnCard(chosen);
      setIsDrawing(false);
      updatePoints(-drawCost);

      // 신규 카드 인벤토리 보관 처리
      const newCard: UserCard = {
        id: Date.now(),
        channel_id: chosen.channel_id,
        serial_number: Math.floor(Math.random() * 900) + 100,
        acquired_at: new Date().toISOString(),
        streamer: chosen
      };

      const updatedInv = [newCard, ...inventory];
      setInventory(updatedInv);
      localStorage.setItem(`inventory_${user.id}`, JSON.stringify(updatedInv));

      // 팡파레 효과 (가치가 높은 카드를 뽑은 경우 더 크게 연출)
      canvasConfetti({
        particleCount: chosen.base_value >= 8000 ? 120 : 60,
        spread: 70,
        origin: { y: 0.6 },
        colors: chosen.base_value >= 8000 ? ['#f59e0b', '#10b981', '#3b82f6'] : ['#10b981', '#3b82f6']
      });

    }, 1200);
  };

  const handleOpenTrade = () => {
    if (inventory.length === 0) {
      alert('교환할 카드가 인벤토리에 없습니다.');
      return;
    }
    setTradeModalOpen(true);
  };

  const executeTrade = () => {
    if (!tradeTargetUser.trim()) {
      alert('상대방 치지직 닉네임을 입력해 주세요.');
      return;
    }
    if (selectedOfferCards.length === 0) {
      alert('제안할 카드를 최소 1장 선택해 주세요.');
      return;
    }

    // 1:1 거래 시나리오 성공 시뮬레이션
    alert(`[${tradeTargetUser}] 님에게 카드 ${selectedOfferCards.length}개에 대한 1:1 교환 요청을 발송했습니다!`);
    
    // 인벤토리에서 거래 보낸 카드 차감
    const remaining = inventory.filter(card => !selectedOfferCards.includes(card.id));
    setInventory(remaining);
    localStorage.setItem(`inventory_${user?.id}`, JSON.stringify(remaining));

    // 정리
    setSelectedOfferCards([]);
    setTradeTargetUser('');
    setTradeModalOpen(false);
  };

  const toggleSelectCard = (id: number) => {
    if (selectedOfferCards.includes(id)) {
      setSelectedOfferCards(selectedOfferCards.filter(cid => cid !== id));
    } else {
      setSelectedOfferCards([...selectedOfferCards, id]);
    }
  };

  // 검색 필터링
  const filteredInventory = inventory.filter(card => 
    card.streamer?.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      
      {/* 1:1 교환 거래 팝업 */}
      {tradeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h3 className="text-base font-bold flex items-center gap-2">
                <ArrowRightLeft className="h-4.5 w-4.5 text-primary" /> 1:1 스트리머 카드 교환 제안
              </h3>
              <button onClick={() => setTradeModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-bold text-muted-foreground block mb-1.5">상대방 치지직 닉네임 입력</label>
                <input 
                  type="text" 
                  value={tradeTargetUser}
                  onChange={(e) => setTradeTargetUser(e.target.value)}
                  placeholder="상대의 닉네임을 입력해 주세요"
                  className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-muted-foreground block mb-2">교환 제안할 보유 카드 선택</label>
                <div className="grid grid-cols-3 gap-2.5 max-h-48 overflow-y-auto pr-1">
                  {inventory.map((card) => {
                    const streamer = card.streamer;
                    const isSelected = selectedOfferCards.includes(card.id);
                    if (!streamer) return null;
                    return (
                      <div 
                        key={card.id}
                        onClick={() => toggleSelectCard(card.id)}
                        className={`cursor-pointer relative flex flex-col items-center justify-center p-2.5 rounded-xl border transition ${
                          isSelected ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-border/60 bg-secondary/30 hover:bg-secondary/60'
                        }`}
                      >
                        <img src={streamer.custom_image_url || streamer.logo_url} alt={streamer.name} className="h-10 w-10 rounded-full border border-border/80 object-cover" />
                        <span className="text-[10px] font-bold text-foreground mt-1.5 truncate max-w-full">{streamer.name}</span>
                        <span className="text-[8.5px] text-muted-foreground">No.{card.serial_number}</span>
                        {isSelected && (
                          <div className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                            <Check className="h-2.5 w-2.5" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2 border-t border-border/60 pt-4">
              <button 
                onClick={() => setTradeModalOpen(false)}
                className="rounded-lg px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground hover:bg-secondary/80"
              >
                취소
              </button>
              <button 
                onClick={executeTrade}
                className="rounded-lg bg-primary px-5 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90"
              >
                교환 요청 보내기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 가챠 보드 영역 */}
      <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-2 text-center md:text-left">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
              <Sparkles className="h-3 w-3" /> CHZZK CARD GACHA
            </span>
            <h2 className="text-2xl font-black tracking-tight text-foreground md:text-3xl">치지직 카드 즉시 소환</h2>
            <p className="text-xs text-muted-foreground max-w-md leading-relaxed">
              1,000 포인트를 사용하여 무작위 치지직 스트리머 카드를 획득합니다. 실시간 시세를 가진 카드가 생성되며 인벤토리에 자동 영구 소장됩니다.
            </p>
          </div>

          {/* 소환 버튼 */}
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={handleDraw}
              disabled={isDrawing}
              className="group relative flex h-28 w-44 cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-emerald-500 to-teal-600 font-bold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:scale-105 active:scale-95 disabled:pointer-events-none"
            >
              <Sparkles className="h-8 w-8 animate-pulse text-white" />
              <div className="text-center">
                <span className="text-sm tracking-wide text-white/90">스트리머 소환</span>
                <p className="text-[10px] text-emerald-100 flex items-center justify-center gap-1"><Coins className="h-3 w-3" /> 1,000 P</p>
              </div>
            </button>
          </div>
        </div>

        {/* 뽑기 카드 렌더링 영역 */}
        {(isDrawing || drawnCard) && (
          <div className="mt-8 flex flex-col items-center justify-center border-t border-border/50 pt-8 animate-in fade-in duration-200">
            {isDrawing ? (
              <div className="flex flex-col items-center gap-3 py-12">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
                <p className="text-xs font-semibold text-muted-foreground">치지직 스트리머 카드 팩 개봉 중...</p>
              </div>
            ) : drawnCard ? (
              <div className="flex flex-col items-center">
                <span className="text-xs font-bold text-primary mb-3">축하합니다! 소환 성공</span>
                
                {/* 실시간 포토카드 프레임 */}
                <div className={`relative flex h-80 w-52 flex-col justify-between overflow-hidden rounded-2xl bg-card p-4 shadow-xl ${getCardBorderClass(drawnCard.base_value)}`}>
                  
                  {/* 카드 배경 이미지 (커스텀 또는 기본 로고) */}
                  <div className="absolute inset-0 z-0">
                    <img 
                      src={drawnCard.custom_image_url || drawnCard.logo_url} 
                      alt={drawnCard.name}
                      className="h-full w-full object-cover opacity-80 transition duration-300 group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-black/20 z-10"></div>
                  </div>

                  {/* 카드 상단 정보 */}
                  <div className="relative z-20 flex items-center justify-between">
                    {getCardBadge(drawnCard.base_value)}
                    <span className="rounded bg-black/50 px-2 py-0.5 text-[9px] font-black text-white/90">No.999</span>
                  </div>

                  {/* 카드 하단 정보 */}
                  <div className="relative z-20 space-y-1.5 text-white">
                    <h3 className="text-base font-black tracking-tight text-white drop-shadow-md">{drawnCard.name}</h3>
                    <p className="text-[9.5px] text-zinc-300 drop-shadow-md">{(drawnCard.follower_count || 0).toLocaleString()} 팔로워</p>
                    
                    <div className="flex items-center justify-between border-t border-white/20 pt-2">
                      <span className="text-[9px] text-zinc-400">시세 가치</span>
                      <span className="text-sm font-black text-emerald-400">{(drawnCard.base_value || 0).toLocaleString()} P</span>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={() => setDrawnCard(null)}
                  className="mt-4 rounded-lg bg-secondary px-4 py-1.5 text-xs font-bold hover:bg-secondary/80 text-muted-foreground"
                >
                  닫기
                </button>
              </div>
            ) : null}
          </div>
        )}
      </section>

      {/* 인벤토리 (보관함) 영역 */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center justify-between w-full sm:w-auto">
            <h3 className="text-base font-bold flex items-center gap-2">
              <Layers className="h-4.5 w-4.5 text-primary" /> 나의 카드 보관함 ({inventory.length}장)
            </h3>
            <button 
              onClick={handleOpenTrade}
              className="sm:hidden rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 flex items-center gap-1"
            >
              <ArrowRightLeft className="h-3.5 w-3.5" /> 1:1 교환
            </button>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="스트리머 검색"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full sm:w-56 rounded-lg border border-border bg-card pl-8 pr-3 py-1.5 text-xs focus:border-primary focus:outline-none"
              />
            </div>
            
            <button 
              onClick={handleOpenTrade}
              className="hidden sm:flex rounded-lg bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 items-center gap-1.5 shadow-sm"
            >
              <ArrowRightLeft className="h-3.5 w-3.5" /> 1:1 교환 제안
            </button>
          </div>
        </div>

        {/* 보관함 카드 그리드 */}
        {filteredInventory.length === 0 ? (
          <div className="rounded-2xl border border-border/80 border-dashed py-12 text-center text-xs text-muted-foreground">
            {searchQuery ? '검색된 카드가 없습니다.' : '보유 중인 스트리머 카드가 없습니다. 상단에서 소환을 완료해 주세요!'}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {filteredInventory.map((card) => {
              const streamer = card.streamer;
              if (!streamer) return null;
              return (
                <div 
                  key={card.id}
                  className={`group relative flex aspect-[5/8] w-full flex-col justify-between overflow-hidden rounded-xl bg-card p-3 shadow-md transition duration-300 hover:-translate-y-1 hover:shadow-lg ${getCardBorderClass(streamer.base_value)}`}
                >
                  {/* 카드 이미지 배경 */}
                  <div className="absolute inset-0 z-0">
                    <img 
                      src={streamer.custom_image_url || streamer.logo_url} 
                      alt={streamer.name}
                      className="h-full w-full object-cover opacity-80 transition duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-black/25 z-10"></div>
                  </div>

                  {/* 카드 상단 정보 */}
                  <div className="relative z-20 flex items-center justify-between">
                    {getCardBadge(streamer.base_value)}
                    <span className="rounded bg-black/40 px-1.5 py-0.5 text-[8px] font-black text-white/90">No.{card.serial_number}</span>
                  </div>

                  {/* 카드 하단 정보 */}
                  <div className="relative z-20 space-y-1 text-white">
                    <h4 className="text-sm font-bold tracking-tight truncate drop-shadow">{streamer.name}</h4>
                    <p className="text-[8.5px] text-zinc-300 drop-shadow">{(streamer.follower_count || 0).toLocaleString()} 팔로워</p>
                    
                    <div className="flex items-center justify-between border-t border-white/10 pt-1">
                      <span className="text-[8.5px] text-zinc-400">시세 가치</span>
                      <span className="text-xs font-black text-emerald-400">{(streamer.base_value || 0).toLocaleString()} P</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

    </div>
  );
};
