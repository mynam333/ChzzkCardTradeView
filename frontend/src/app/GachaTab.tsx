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
  Plus,
  Layers,
  BarChart3
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { borderStyle, nameEffectStyle } from '@/lib/cosmetics';

interface Streamer {
  channel_id: string;
  name: string;
  logo_url: string;
  custom_image_url: string | null;
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
  acquired_at: string;
  streamer?: Streamer;
}

// 별 등급에 따른 가치 배율 (백엔드 starValueMultiplier와 동일)
const starMult = (star: number) => 1 + (star || 0) * 0.6;

export const GachaTab: React.FC = () => {
  const { user, refreshUserData, toast } = useApp();
  const [streamers, setStreamers] = useState<Streamer[]>([]);
  const [inventory, setInventory] = useState<UserCard[]>([]);
  // 코스메틱 장착
  const [myCosmetics, setMyCosmetics] = useState<any[]>([]);
  const [equipCard, setEquipCard] = useState<UserCard | null>(null);
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

  // 스트리머 상세 + 시세 그래프 모달
  const [detailStreamer, setDetailStreamer] = useState<any | null>(null);
  const [detailHistory, setDetailHistory] = useState<{ value: number; recorded_at: string }[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailChannelId, setDetailChannelId] = useState<string | null>(null);
  const [detailRange, setDetailRange] = useState<'24h' | '7d'>('7d');
  const [detailHover, setDetailHover] = useState<number | null>(null);


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
    card: UserCard | null;
  }>({ x: 0, y: 0, open: false, card: null });

  // 카드 선택 모드 및 선택된 채널 ID 목록 (수집 갯수 단위로 묶여있으므로 channel_id 기반 일괄 선택 지원)
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);

  // 단일 판매 모달 및 확인 모달 상태
  const [sellModalOpen, setSellModalOpen] = useState(false);
  const [sellConfirmOpen, setSellConfirmOpen] = useState(false);
  const [sellQuantity, setSellQuantity] = useState(1);
  const [sellingStreamer, setSellingStreamer] = useState<Streamer | null>(null);

  // 일괄 판매 모달 및 확인 모달 상태
  const [bulkSellModalOpen, setBulkSellModalOpen] = useState(false);
  const [bulkSellConfirmOpen, setBulkSellConfirmOpen] = useState(false);
  // 일괄 판매 항목 설정: { [channelId]: count }
  const [bulkSellQuantities, setBulkSellQuantities] = useState<{ [key: string]: number }>({});

  // 모바일 롱프레스 타이머 레프
  const longPressTimer = React.useRef<any>(null);

  // 전역 클릭 시 컨텍스트 메뉴 닫기
  useEffect(() => {
    const handleGlobalClick = () => {
      setContextMenu(prev => prev.open ? { ...prev, open: false } : prev);
    };
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  useEffect(() => {
    if (user) {
      fetchStreamers();
      fetchInventory();
      fetchActiveTrades();
      fetchTradeHistory();
      fetchMyCosmetics();
    }
  }, [user]);

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
    if (!localStorage.getItem('cctv_jwt_token')) return;
    try {
      const res = await apiFetch('/users/me/cards');
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

  // KST 자정 무료 뽑기 가능 여부 판단 헬퍼
  // 스트리머 등록 모달 상태
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [streamerSearchKeyword, setStreamerSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedStreamer, setSelectedStreamer] = useState<any | null>(null);
  const [disclaimerChecked, setDisclaimerChecked] = useState(false);
  const [registering, setRegistering] = useState(false);

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

  // 내 보유 카드 channel_id별 묶음
  const myCollection = (() => {
    const map: { [cid: string]: { channel_id: string; count: number; streamer: any } } = {};
    for (const c of inventory) {
      if (!c.streamer) continue;
      if (!map[c.channel_id]) map[c.channel_id] = { channel_id: c.channel_id, count: 0, streamer: c.streamer };
      map[c.channel_id].count += 1;
    }
    return Object.values(map);
  })();

  const adjustOfferCard = (channelId: string, delta: number, max: number) => {
    setOfferCards(prev => {
      const next = { ...prev };
      const v = Math.max(0, Math.min(max, (next[channelId] || 0) + delta));
      if (v <= 0) delete next[channelId];
      else next[channelId] = v;
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

  // 스트리머 상세 + 시세 그래프 열기
  // 지정 범위(24h/7d)로 스트리머 상세+그래프 로드
  const loadStreamerDetail = async (channelId: string, range: '24h' | '7d') => {
    setDetailLoading(true);
    setDetailHistory([]);
    try {
      const res = await apiFetch(`/streamers/${channelId}?range=${range}`);
      if (res.ok) {
        const data = await res.json();
        setDetailStreamer(data.streamer);
        setDetailHistory(data.history || []);
      } else {
        showAlert('조회 실패', '스트리머 상세 정보를 불러오지 못했습니다.', 'error');
        setDetailStreamer(null);
      }
    } catch (e) {
      showAlert('통신 오류', '서버와의 통신 중 오류가 발생했습니다.', 'error');
      setDetailStreamer(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const openStreamerDetail = (channelId: string) => {
    setDetailChannelId(channelId);
    setDetailRange('7d');
    setDetailStreamer({ channel_id: channelId, loading: true });
    loadStreamerDetail(channelId, '7d');
  };

  const changeDetailRange = (range: '24h' | '7d') => {
    if (!detailChannelId || range === detailRange) return;
    setDetailRange(range);
    loadStreamerDetail(detailChannelId, range);
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

    const offerList = Object.entries(offerCards).filter(([, c]) => c > 0).map(([channel_id, count]) => ({ channel_id, count }));
    const reqList = Object.entries(requestCards).filter(([, c]) => c > 0).map(([channel_id, count]) => ({ channel_id, count }));

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

  // 카드 합성 (같은 스트리머·같은 별 2장 → 별+1)
  const handleFuse = async (channelId: string, star: number) => {
    try {
      const res = await apiFetch('/cards/fuse', { method: 'POST', body: JSON.stringify({ channel_id: channelId, star }) });
      const data = await res.json();
      if (res.ok) {
        showAlert('합성 성공', data.message || '합성되었습니다.', 'success');
        fetchInventory();
      } else {
        showAlert('합성 실패', data.message || '합성에 실패했습니다.', 'error');
      }
    } catch {
      showAlert('통신 오류', '서버와의 통신 중 오류가 발생했습니다.', 'error');
    }
  };

  // 요청 카드 수량 증감 (상대 보유량 상한)
  const adjustRequestCard = (channelId: string, delta: number, max: number) => {
    setRequestCards(prev => {
      const next = { ...prev };
      const v = Math.max(0, Math.min(max, (next[channelId] || 0) + delta));
      if (v <= 0) delete next[channelId];
      else next[channelId] = v;
      return next;
    });
  };

  // 신규 스트리머 검색 API 호출
  const handleSearchStreamer = async () => {
    if (!streamerSearchKeyword.trim()) {
      toast('검색할 스트리머 명칭을 입력해 주세요.');
      return;
    }
    setSearching(true);
    setSelectedStreamer(null);
    try {
      const res = await apiFetch(`/streamers/search?keyword=${encodeURIComponent(streamerSearchKeyword)}`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data);
      } else {
        toast('스트리머 검색에 실패했습니다.');
      }
    } catch (e) {
      console.error(e);
      toast('통신 중 오류가 발생했습니다.');
    } finally {
      setSearching(false);
    }
  };

  // 신규 스트리머 카드 등록 API 호출
  const handleRegisterStreamer = async () => {
    if (!selectedStreamer) {
      setAlertModal({
        open: true,
        title: '등록 오류',
        message: '등록할 스트리머를 리스트에서 선택해 주세요.',
        type: 'error'
      });
      return;
    }

    // README 명세 기준 팔로워 150명 미만 프론트 단 1차 차단 필터
    if (selectedStreamer.followerCount !== undefined && Number(selectedStreamer.followerCount) < 150) {
      setAlertModal({
        open: true,
        title: '등록 불가',
        message: `팔로워 수 150명 이상인 스트리머만 등록할 수 있습니다. (현재: ${Number(selectedStreamer.followerCount).toLocaleString()}명)`,
        type: 'warning'
      });
      return;
    }

    if (!disclaimerChecked) {
      setAlertModal({
        open: true,
        title: '동의 필요',
        message: '등록 책임 조항 및 약관 동의를 완료해 주세요.',
        type: 'warning'
      });
      return;
    }

    setRegistering(true);
    try {
      const res = await apiFetch('/streamers/register', {
        method: 'POST',
        body: JSON.stringify({
          channelId: selectedStreamer.channelId,
          channelName: selectedStreamer.channelName,
          channelImageUrl: selectedStreamer.channelImageUrl,
          followerCount: selectedStreamer.followerCount
        })
      });

      const data = await res.json();
      if (res.ok) {
        setAlertModal({
          open: true,
          title: '등록 완료',
          message: data.message || '성공적으로 스트리머 카드가 등록되었습니다!',
          type: 'success'
        });
        setRegisterModalOpen(false);
        // 상태 초기화 및 스트리머 데이터 갱신
        setSelectedStreamer(null);
        setSearchResults([]);
        setStreamerSearchKeyword('');
        setDisclaimerChecked(false);
        fetchStreamers();
      } else {
        setAlertModal({
          open: true,
          title: '등록 실패',
          message: data.message || '스트리머 등록에 실패했습니다.',
          type: 'error'
        });
      }
    } catch (e) {
      console.error(e);
      setAlertModal({
        open: true,
        title: '통신 오류',
        message: '서버 전송 중 에러가 발생했습니다.',
        type: 'error'
      });
    } finally {
      setRegistering(false);
    }
  };

  // 단일 카드 판매 실행
  const executeSell = async () => {
    if (!sellingStreamer) return;
    try {
      const res = await apiFetch('/cards/sell', {
        method: 'POST',
        body: JSON.stringify({
          items: [{ channelId: sellingStreamer.channel_id, count: sellQuantity }]
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
      .map(([channelId, count]) => ({ channelId, count }))
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
        setSelectedChannelIds([]);
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
  const getCardCountInInventory = (channelId: string) => {
    return inventory.filter(c => c.channel_id === channelId).length;
  };

  // 카드 객체 찾기 헬퍼
  const getStreamerByChannelId = (channelId: string) => {
    return inventory.find(c => c.channel_id === channelId)?.streamer || null;
  };

  // 검색 및 라이브 여부 필터링 후, 지정한 기준대로 정렬 처리
  const getProcessedInventory = () => {
    // 1. 검색어 및 라이브 상태 필터링
    let result = inventory.filter(card => {
      const streamer = card.streamer;
      if (!streamer) return false;

      // 이름 검색 필터
      const matchesSearch = streamer.name.toLowerCase().includes(searchQuery.toLowerCase());

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

      {/* 신규 스트리머 카드 등록 팝업 모달 */}
      {registerModalOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h3 className="text-base font-bold flex items-center gap-2">
                <Plus className="h-4.5 w-4.5 text-primary" /> 신규 스트리머 카드 등록
              </h3>
              <button
                onClick={() => {
                  setRegisterModalOpen(false);
                  setSelectedStreamer(null);
                  setSearchResults([]);
                  setStreamerSearchKeyword('');
                  setDisclaimerChecked(false);
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={streamerSearchKeyword}
                  onChange={(e) => setStreamerSearchKeyword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSearchStreamer(); }}
                  placeholder="치지직 스트리머 이름을 입력하세요"
                  className="flex-1 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs focus:border-primary focus:outline-none"
                />
                <button
                  onClick={handleSearchStreamer}
                  disabled={searching}
                  className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90"
                >
                  {searching ? '검색 중...' : '검색'}
                </button>
              </div>

              {/* 검색 결과 리스트 */}
              {searchResults.length > 0 && (
                <div className="border border-border/80 rounded-xl max-h-48 overflow-y-auto p-1.5 space-y-1">
                  {searchResults.map((ch) => {
                    const isSelected = selectedStreamer?.channelId === ch.channelId;
                    return (
                      <div
                        key={ch.channelId}
                        onClick={() => setSelectedStreamer(ch)}
                        className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition ${isSelected ? 'bg-primary/10 border border-primary/40' : 'hover:bg-secondary/60 border border-transparent'
                          }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <img src={ch.channelImageUrl} alt={ch.channelName} className="h-8 w-8 rounded-full border border-border/60 object-cover" />
                          <div>
                            <p className="text-xs font-bold text-foreground">{ch.channelName}</p>
                            <p className="text-[9.5px] text-muted-foreground">{(ch.followerCount || 0).toLocaleString()} 팔로워</p>
                          </div>
                        </div>
                        {isSelected && <Check className="h-4 w-4 text-primary" />}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 하단 약관 및 동의 체크 */}
              <div className="rounded-lg bg-secondary/30 border border-border/50 p-3 space-y-2.5">
                <div className="text-[0.62rem] text-muted-foreground leading-relaxed">
                  <p className="font-bold text-foreground/80 mb-1">⚠️ 신규 스트리머 카드 등록 책임 조항</p>
                  본 서비스를 통해 신규 스트리머의 정보를 등록하여 카드를 활성화하는 모든 행위의 주체는 사용자 본인이며, 이로 인해 발생할 수 있는 초상권, 저작권, 퍼블리시티권 분쟁을 포함한 민형사상의 모든 법적 책임은 카드 등록자 본인에게 전적으로 귀속됩니다.
                </div>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={disclaimerChecked}
                    onChange={(e) => setDisclaimerChecked(e.target.checked)}
                    className="mt-0.5 rounded border-border"
                  />
                  <span className="text-[0.65rem] font-semibold text-foreground/90">
                    위 조항의 내용을 충분히 숙지하였으며 책임을 확인했습니다.
                  </span>
                </label>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2 border-t border-border/60 pt-4">
              <button
                onClick={() => {
                  setRegisterModalOpen(false);
                  setSelectedStreamer(null);
                  setSearchResults([]);
                  setStreamerSearchKeyword('');
                  setDisclaimerChecked(false);
                }}
                className="rounded-lg px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground hover:bg-secondary/80"
              >
                취소
              </button>
              <button
                onClick={handleRegisterStreamer}
                disabled={registering || !selectedStreamer || !disclaimerChecked}
                className="rounded-lg bg-primary px-5 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
              >
                {registering ? '등록 중...' : '스트리머 등록 완료'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 1:1 교환 거래 팝업 */}
      {tradeModalOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200">
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
                    .filter((c) => offerSearch.trim() === '' ? true : c.streamer.name.toLowerCase().includes(offerSearch.toLowerCase()))
                    .map((c) => (
                      <div key={c.channel_id} className="flex items-center justify-between rounded-lg bg-secondary/30 px-2 py-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <img src={c.streamer.custom_image_url || c.streamer.logo_url} alt={c.streamer.name} className="h-7 w-7 rounded-full object-cover border border-border/60" />
                          <span className="text-[11px] font-bold truncate">{c.streamer.name}</span>
                          <span className="text-[9px] text-muted-foreground">보유 {c.count}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => adjustOfferCard(c.channel_id, -1, c.count)} className="h-5 w-5 rounded bg-secondary text-xs font-bold">-</button>
                          <span className="w-5 text-center text-xs font-bold">{offerCards[c.channel_id] || 0}</span>
                          <button onClick={() => adjustOfferCard(c.channel_id, 1, c.count)} className="h-5 w-5 rounded bg-primary text-primary-foreground text-xs font-bold">+</button>
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
                        .filter((c) => requestSearch.trim() === '' ? true : c.streamer?.name?.toLowerCase().includes(requestSearch.toLowerCase()))
                        .map((c) => (
                          <div key={c.channel_id} className="flex items-center justify-between rounded-lg bg-secondary/30 px-2 py-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <img src={c.streamer?.custom_image_url || c.streamer?.logo_url} alt={c.streamer?.name} className="h-7 w-7 rounded-full object-cover border border-border/60" />
                              <span className="text-[11px] font-bold truncate">{c.streamer?.name}</span>
                              <span className="text-[9px] text-muted-foreground">보유 {c.count}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => adjustRequestCard(c.channel_id, -1, c.count)} className="h-5 w-5 rounded bg-secondary text-xs font-bold">-</button>
                              <span className="w-5 text-center text-xs font-bold">{requestCards[c.channel_id] || 0}</span>
                              <button onClick={() => adjustRequestCard(c.channel_id, 1, c.count)} className="h-5 w-5 rounded bg-primary text-primary-foreground text-xs font-bold">+</button>
                            </div>
                          </div>
                        ))}
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

            <div className="mt-6 flex items-center justify-end gap-2 border-t border-border/60 pt-4">
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

      {/* 스트리머 상세 + 시세 그래프 모달 */}
      {detailStreamer && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setDetailStreamer(null)}>
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h3 className="text-base font-bold flex items-center gap-2"><BarChart3 className="h-4.5 w-4.5 text-primary" /> 스트리머 시세 상세</h3>
              <button onClick={() => setDetailStreamer(null)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>

            {detailLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="flex items-center gap-3">
                  <img src={detailStreamer.custom_image_url || detailStreamer.logo_url} alt={detailStreamer.name} className="h-14 w-14 rounded-full object-cover border border-border" />
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-black truncate">{detailStreamer.name}</h4>
                    <p className="text-[11px] text-muted-foreground">{(detailStreamer.follower_count || 0).toLocaleString()} 팔로워 · {detailStreamer.is_active ? '🟢 방송 중' : '⚫ 오프라인'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-primary">{(detailStreamer.base_value || 0).toLocaleString()} P</p>
                    {(() => {
                      const prev = detailStreamer.prev_value ?? detailStreamer.base_value ?? 1000;
                      const diff = (detailStreamer.base_value || 0) - prev;
                      const rate = prev > 0 ? (diff / prev) * 100 : 0;
                      const cls = diff > 0 ? 'text-rose-500' : diff < 0 ? 'text-blue-500' : 'text-muted-foreground';
                      const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '-';
                      return <p className={`text-[11px] font-bold ${cls}`}>{arrow} {rate.toFixed(1)}% (24h)</p>;
                    })()}
                  </div>
                </div>

                {/* 그래프 기간 토글 */}
                <div className="flex items-center justify-end gap-1">
                  {(['24h', '7d'] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => changeDetailRange(r)}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition ${detailRange === r ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
                    >
                      {r === '24h' ? '24시간' : '7일'}
                    </button>
                  ))}
                </div>

                {/* SVG 라인 차트 (hover 시 해당 시점 강조 + 툴팁) */}
                {detailHistory.length >= 2 ? (() => {
                  const W = 460, H = 140, P = 8;
                  const n = detailHistory.length;
                  const values = detailHistory.map(h => h.value);
                  const min = Math.min(...values), max = Math.max(...values);
                  const range = max - min || 1;
                  const coords = detailHistory.map((h, i) => ({
                    x: P + (i / (n - 1)) * (W - 2 * P),
                    y: H - P - ((h.value - min) / range) * (H - 2 * P)
                  }));
                  const pts = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
                  const up = values[n - 1] >= values[0];
                  const stroke = up ? '#f43f5e' : '#3b82f6';

                  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const ratio = (e.clientX - rect.left) / rect.width;
                    const idx = Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))));
                    setDetailHover(idx);
                  };
                  const hovered = detailHover !== null && detailHover < n ? detailHover : null;
                  const fmtTime = (iso: string) => {
                    const d = new Date(iso.includes('T') || iso.includes('Z') ? iso : iso.replace(' ', 'T') + 'Z');
                    return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                  };

                  return (
                    <div className="rounded-xl border border-border bg-secondary/20 p-3">
                      <div className="relative">
                        <svg
                          viewBox={`0 0 ${W} ${H}`}
                          className="w-full h-auto"
                          preserveAspectRatio="none"
                          onMouseMove={onMove}
                          onMouseLeave={() => setDetailHover(null)}
                        >
                          <polyline points={pts} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                          {hovered !== null && (
                            <>
                              <line x1={coords[hovered].x} y1={P} x2={coords[hovered].x} y2={H - P} stroke="currentColor" strokeWidth="1" className="text-muted-foreground/40" strokeDasharray="3 3" />
                              <circle cx={coords[hovered].x} cy={coords[hovered].y} r="4" fill={stroke} stroke="#fff" strokeWidth="1.5" />
                            </>
                          )}
                        </svg>
                        {hovered !== null && (
                          <div
                            className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-foreground px-2 py-1 text-[10px] font-bold text-background shadow-lg whitespace-nowrap"
                            style={{ left: `${(coords[hovered].x / W) * 100}%` }}
                          >
                            {fmtTime(detailHistory[hovered].recorded_at)} · {values[hovered].toLocaleString()}P
                          </div>
                        )}
                      </div>
                      <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
                        <span>{new Date(detailHistory[0].recorded_at).toLocaleDateString('ko-KR')}</span>
                        <span>최저 {min.toLocaleString()}P · 최고 {max.toLocaleString()}P</span>
                        <span>{new Date(detailHistory[n - 1].recorded_at).toLocaleDateString('ko-KR')}</span>
                      </div>
                    </div>
                  );
                })() : (
                  <div className="rounded-xl border border-border bg-secondary/20 p-6 text-center text-[11px] text-muted-foreground">
                    아직 시세 그래프를 그릴 만큼의 데이터가 쌓이지 않았습니다.<br />(시세는 2분마다 기록됩니다)
                  </div>
                )}

                {/* 치지직 방송국 바로가기 */}
                <a
                  href={detailStreamer.is_active ? `https://chzzk.naver.com/live/${detailStreamer.channel_id}` : `https://chzzk.naver.com/${detailStreamer.channel_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#00ffa3] py-2.5 text-xs font-black text-black hover:brightness-95 transition"
                >
                  치지직 방송국 바로가기
                </a>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-lg bg-secondary/30 p-2.5"><p className="text-muted-foreground">활동 점수</p><p className="font-bold">{(detailStreamer.activity_score || 0).toLocaleString()}</p></div>
                  <div className="rounded-lg bg-secondary/30 p-2.5"><p className="text-muted-foreground">누적 방송 시간</p><p className="font-bold">{Math.floor((detailStreamer.broadcast_minutes || 0) / 60)}시간 {(detailStreamer.broadcast_minutes || 0) % 60}분</p></div>
                </div>
              </div>
            )}
          </div>
        </div>
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
              const summarize = (offer: any) => {
                const parts: string[] = [];
                const cardCount = (offer?.cards || []).reduce((a: number, c: any) => a + c.count, 0);
                if (cardCount > 0) parts.push(`카드 ${cardCount}장`);
                if (offer?.point > 0) parts.push(`${offer.point.toLocaleString()} P`);
                return parts.length ? parts.join(' + ') : '없음';
              };
              const counterpartName = incoming ? (t.sender_username || t.sender_id) : (t.receiver_username || t.receiver_id);
              const confirmed = t.status === 'CONFIRMED';
              // 단계 안내 라벨
              const stageLabel = confirmed
                ? (incoming ? '내가 동의함 · 제안자 최종 승인 대기' : '상대가 동의함 · 내 최종 승인 필요')
                : (incoming ? '검토 요청됨' : '상대 동의 대기 중');
              return (
                <div key={t.id} className="rounded-xl border border-border/60 bg-secondary/20 p-3.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`text-[10px] font-black rounded px-2 py-0.5 ${incoming ? 'bg-sky-500/15 text-sky-500' : 'bg-amber-500/15 text-amber-500'}`}>
                      {incoming ? '받은 교환' : '보낸 교환'}
                    </span>
                    <span className="text-[11px] font-bold text-muted-foreground truncate">상대: {counterpartName}</span>
                  </div>
                  <p className={`text-[10px] font-bold mb-2 ${confirmed ? 'text-emerald-500' : 'text-muted-foreground'}`}>
                    [{confirmed ? '2단계' : '1단계'}] {stageLabel}
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-2">
                      <p className="font-bold text-emerald-500 mb-0.5">{incoming ? '상대 제시' : '내 제시'}</p>
                      <p className="text-muted-foreground">{summarize(t.sender_offer)}</p>
                    </div>
                    <div className="rounded-lg bg-sky-500/5 border border-sky-500/20 p-2">
                      <p className="font-bold text-sky-500 mb-0.5">{incoming ? '나에게 요청' : '상대에게 요청'}</p>
                      <p className="text-muted-foreground">{summarize(t.receiver_offer)}</p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex justify-end gap-2">
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

      {/* 교환 이력 + 통계 */}
      {tradeHistory.length > 0 && (() => {
        const accepted = tradeHistory.filter((t) => t.status === 'ACCEPTED').length;
        const rejected = tradeHistory.filter((t) => t.status === 'REJECTED').length;
        const cancelled = tradeHistory.filter((t) => t.status === 'CANCELLED').length;
        const statusLabel: Record<string, string> = { ACCEPTED: '체결', REJECTED: '거절', CANCELLED: '취소' };
        const statusColor: Record<string, string> = { ACCEPTED: 'text-emerald-500', REJECTED: 'text-rose-500', CANCELLED: 'text-muted-foreground' };
        return (
          <section className="rounded-3xl border border-border bg-card p-6 shadow-sm space-y-3">
            <h3 className="text-base font-black flex items-center gap-2"><Clock className="h-4.5 w-4.5 text-primary" /> 교환 이력</h3>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-emerald-500/10 p-2.5 text-center"><p className="text-lg font-black text-emerald-500">{accepted}</p><p className="text-[10px] text-muted-foreground">체결</p></div>
              <div className="rounded-lg bg-rose-500/10 p-2.5 text-center"><p className="text-lg font-black text-rose-500">{rejected}</p><p className="text-[10px] text-muted-foreground">거절</p></div>
              <div className="rounded-lg bg-secondary p-2.5 text-center"><p className="text-lg font-black text-muted-foreground">{cancelled}</p><p className="text-[10px] text-muted-foreground">취소</p></div>
            </div>
            <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
              {tradeHistory.map((t) => {
                const incoming = t.direction === 'incoming';
                const counterpart = incoming ? (t.sender_username || t.sender_id) : (t.receiver_username || t.receiver_id);
                return (
                  <div key={t.id} className="flex items-center justify-between rounded-lg bg-secondary/20 px-3 py-2 text-[11px]">
                    <span className="truncate">{incoming ? '받음' : '보냄'} · {counterpart}</span>
                    <span className={`font-bold ${statusColor[t.status]}`}>{statusLabel[t.status] || t.status}</span>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })()}

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

          <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto mt-2 sm:mt-0">
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
              onClick={() => setRegisterModalOpen(true)}
              className="rounded-lg bg-secondary border border-border/80 px-3 py-2 text-xs font-bold text-foreground hover:bg-secondary/80 items-center gap-1 shadow-sm flex"
            >
              <Plus className="h-3.5 w-3.5" /> 스트리머 등록
            </button>

            <button
              onClick={handleOpenTrade}
              className="hidden sm:flex rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 items-center gap-1 shadow-sm"
            >
              <ArrowRightLeft className="h-3.5 w-3.5" /> 교환 제안
            </button>
          </div>
        </div>

        {/* 보관함 카드 그리드 */}
        {filteredInventory.length === 0 ? (
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
                <div className="mb-4 flex items-center justify-between rounded-xl bg-primary/10 border border-primary/20 p-3.5 animate-in slide-in-from-top-3 duration-200">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-primary animate-ping"></span>
                    <span className="text-[0.75rem] font-bold text-foreground">
                      카드를 다중 선택 중입니다 ({selectedChannelIds.length}개 선택됨)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (selectedChannelIds.length === 0) {
                          toast('선택된 카드가 없습니다.');
                          return;
                        }
                        // 선택된 카드 정보 기반으로 일괄 판매 초기화
                        const quantities: { [key: string]: number } = {};
                        selectedChannelIds.forEach(cid => {
                          quantities[cid] = getCardCountInInventory(cid);
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
                        setSelectedChannelIds([]);
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

                  const isSelected = selectedChannelIds.includes(streamer.channel_id);
                  const cardValue = Math.round((streamer.base_value || 0) * starMult(star));

                  // 우클릭 이벤트 핸들러
                  const handleContextMenu = (e: React.MouseEvent) => {
                    e.preventDefault();
                    if (selectionMode) {
                      // 다중 선택 상태일 때의 우클릭 액션: 일괄 판매 모달 바로 트리거
                      const quantities: { [key: string]: number } = {};
                      selectedChannelIds.forEach(cid => {
                        quantities[cid] = getCardCountInInventory(cid);
                      });
                      setBulkSellQuantities(quantities);
                      setBulkSellModalOpen(true);
                      return;
                    }
                    setContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      open: true,
                      card: card
                    });
                  };

                  // 카드 클릭 이벤트 핸들러
                  const handleCardClick = (e: React.MouseEvent) => {
                    if (selectionMode) {
                      e.preventDefault();
                      if (isSelected) {
                        setSelectedChannelIds(selectedChannelIds.filter(cid => cid !== streamer.channel_id));
                      } else {
                        setSelectedChannelIds([...selectedChannelIds, streamer.channel_id]);
                      }
                    } else {
                      // 다중 선택 모드가 아닐 때 카드 클릭 시 시세 상세 모달 오픈 (방송국 이동은 모달 내 버튼으로)
                      openStreamerDetail(streamer.channel_id);
                    }
                  };

                  // 마우스 및 터치 터치 롱프레스 핸들링 (모바일 지원용)
                  const startPress = () => {
                    longPressTimer.current = setTimeout(() => {
                      if (!selectionMode) {
                        setSelectionMode(true);
                        setSelectedChannelIds([streamer.channel_id]);
                        if (navigator.vibrate) {
                          navigator.vibrate(50);
                        }
                      }
                    }, 800);
                  };

                  const endPress = () => {
                    if (longPressTimer.current) {
                      clearTimeout(longPressTimer.current);
                    }
                  };

                  return (
                    <div
                      key={card.id}
                      onContextMenu={handleContextMenu}
                      onClick={handleCardClick}
                      onMouseDown={startPress}
                      onMouseUp={endPress}
                      onTouchStart={startPress}
                      onTouchEnd={endPress}
                      style={borderStyle(card.border)}
                      className={`group relative flex aspect-[5/8] w-full flex-col justify-between overflow-hidden rounded-xl bg-card p-3 shadow-md transition duration-300 hover:-translate-y-1 hover:shadow-lg select-none cursor-pointer border border-border/80 ${star >= 1 ? `card-star card-star-${star}` : ''} ${isSelected ? 'ring-4 ring-primary ring-offset-2 ring-offset-background scale-[0.98]' : ''}`}
                    >
                      {/* 다중 선택 모드 체크박스 오버레이 */}
                      {selectionMode && (
                        <div className="absolute top-2.5 left-2.5 z-30 flex h-5 w-5 items-center justify-center rounded-md border border-primary bg-background shadow transition">
                          {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                        </div>
                      )}

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
                      <div className="relative z-20 flex items-center justify-between w-full">
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
                          {count > 1 && (
                            <span className="rounded bg-primary px-1.5 py-0.5 text-[8.5px] font-extrabold text-primary-foreground animate-bounce">
                              ×{count}
                            </span>
                          )}
                          <span className="rounded bg-black/40 px-1.5 py-0.5 text-[8px] font-black text-white/90">
                            No.{String(streamer.serial_number ?? 0).padStart(4, '0')}
                          </span>
                        </div>
                      </div>

                      {/* 카드 하단 정보 */}
                      <div className="relative z-20 space-y-1 text-white block mt-auto">
                        {/* 별 등급 표시 */}
                        {star > 0 && (
                          <div className="flex items-center gap-0.5 drop-shadow">
                            {Array.from({ length: star }, (_, i) => (
                              <span key={i} className="text-amber-300 text-[10px] leading-none">★</span>
                            ))}
                          </div>
                        )}
                        <h4 className="text-sm font-bold tracking-tight truncate drop-shadow" style={nameEffectStyle(card.name_effect)}>{streamer.name}</h4>
                        <p className="text-[8.5px] text-zinc-300 drop-shadow">{(streamer.follower_count || 0).toLocaleString()} 팔로워</p>

                        <div className="flex items-center justify-between border-t border-white/10 pt-1">
                          <span className="text-[8.5px] text-zinc-400">{star > 0 ? `${star}성 가치` : '시세 가치'}</span>
                          <span className="text-xs font-black text-emerald-400">{cardValue.toLocaleString()} P</span>
                        </div>

                        {/* 합성 버튼 (같은 별 2장 이상 & 5성 미만) */}
                        {!selectionMode && count >= 2 && star < 5 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleFuse(streamer.channel_id, star); }}
                            className="mt-1 w-full rounded-md bg-amber-500/90 py-1 text-[9px] font-black text-black hover:bg-amber-400 transition"
                          >
                            ⭐ 합성 ({star}★→{star + 1}★)
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </section>

      {/* 우클릭 컨텍스트 메뉴 오버레이 */}
      {contextMenu.open && contextMenu.card && (
        <div
          className="fixed z-50 rounded-xl border border-border bg-card/95 py-1.5 shadow-xl backdrop-blur-md animate-in fade-in duration-100 min-w-36"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              if (contextMenu.card) {
                setSellingStreamer(contextMenu.card.streamer || null);
                setSellQuantity(1);
                setSellModalOpen(true);
              }
              setContextMenu(prev => ({ ...prev, open: false }));
            }}
            className="w-full text-left px-4 py-2 text-xs font-bold text-foreground hover:bg-secondary/80 flex items-center gap-2"
          >
            💰 카드 판매하기
          </button>
          <button
            onClick={() => {
              if (contextMenu.card) setEquipCard(contextMenu.card);
              setContextMenu(prev => ({ ...prev, open: false }));
            }}
            className="w-full text-left px-4 py-2 text-xs font-bold text-foreground hover:bg-secondary/80 flex items-center gap-2"
          >
            🎨 코스메틱 장착
          </button>
          <button
            onClick={() => {
              if (contextMenu.card?.streamer) {
                setSelectionMode(true);
                setSelectedChannelIds([contextMenu.card.streamer.channel_id]);
              }
              setContextMenu(prev => ({ ...prev, open: false }));
            }}
            className="w-full text-left px-4 py-2 text-xs font-bold text-foreground hover:bg-secondary/80 flex items-center gap-2"
          >
            ✔️ 다중 선택 모드
          </button>
          <button
            onClick={() => {
              if (contextMenu.card?.streamer) {
                const targetUrl = contextMenu.card.streamer.is_active
                  ? `https://chzzk.naver.com/live/${contextMenu.card.streamer.channel_id}`
                  : `https://chzzk.naver.com/${contextMenu.card.streamer.channel_id}`;
                window.open(targetUrl, '_blank');
              }
              setContextMenu(prev => ({ ...prev, open: false }));
            }}
            className="w-full text-left px-4 py-2 text-xs font-bold text-foreground hover:bg-secondary/80 flex items-center gap-2 border-t border-border/50"
          >
            📺 스트리머 채널 이동
          </button>
        </div>
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
                        ? <div className="h-10 w-8 rounded bg-card border border-border/80" style={borderStyle(it)} />
                        : <span className="text-sm font-black truncate max-w-full" style={nameEffectStyle(it)}>{it.name}</span>}
                      <span className="text-[9px] text-muted-foreground truncate max-w-full">{it.name} ×{it.quantity}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
        return (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setEquipCard(null)}>
            <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <h3 className="text-base font-bold">코스메틱 장착</h3>
                <button onClick={() => setEquipCard(null)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
              </div>
              {/* 카드 미리보기 */}
              <div className="mt-4 flex justify-center">
                <div className="relative flex h-44 w-28 flex-col justify-end overflow-hidden rounded-xl bg-card p-2 border border-border/80" style={borderStyle(live.border)}>
                  <img src={live.streamer?.custom_image_url || live.streamer?.logo_url} alt={live.streamer?.name} className="absolute inset-0 h-full w-full object-cover opacity-80" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                  <h4 className="relative z-10 text-xs font-black text-white truncate drop-shadow" style={nameEffectStyle(live.name_effect)}>{live.streamer?.name}</h4>
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
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2 border-b border-border/60 pb-3">
              💰 카드 시스템 판매
            </h3>

            <div className="mt-4 flex items-center gap-4 bg-secondary/30 p-3.5 rounded-xl border border-border/50">
              <img
                src={sellingStreamer.custom_image_url || sellingStreamer.logo_url}
                alt={sellingStreamer.name}
                className="h-12 w-12 rounded-full border border-border/80 object-cover"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-black text-foreground truncate">{sellingStreamer.name}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  보유량: <span className="font-bold text-foreground">{getCardCountInInventory(sellingStreamer.channel_id)}</span>장
                </p>
                <p className="text-[10px] text-emerald-500 font-bold mt-0.5">
                  개당 시세: {sellingStreamer.base_value.toLocaleString()} P
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
                  max={getCardCountInInventory(sellingStreamer.channel_id)}
                  value={sellQuantity}
                  onChange={(e) => {
                    const val = Math.max(1, Math.min(getCardCountInInventory(sellingStreamer.channel_id), Number(e.target.value) || 1));
                    setSellQuantity(val);
                  }}
                  className="w-16 text-center rounded-lg border border-border bg-secondary/50 px-2 py-1 text-xs font-bold focus:outline-none"
                />
                <button
                  disabled={sellQuantity >= getCardCountInInventory(sellingStreamer.channel_id)}
                  onClick={() => setSellQuantity(prev => prev + 1)}
                  className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-foreground disabled:opacity-40"
                >
                  +
                </button>
                <button
                  onClick={() => setSellQuantity(getCardCountInInventory(sellingStreamer.channel_id))}
                  className="ml-auto rounded-lg bg-secondary border border-border px-2.5 py-1.5 text-[9.5px] font-bold text-foreground hover:bg-secondary/80"
                >
                  최대
                </button>
              </div>
            </div>

            <div className="mt-4 border-t border-border/50 pt-3 flex items-center justify-between text-xs">
              <span className="font-bold text-muted-foreground">예상 획득 포인트</span>
              <span className="font-black text-emerald-500 text-sm">
                {(sellingStreamer.base_value * sellQuantity).toLocaleString()} P
              </span>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setSellModalOpen(false);
                  setSellingStreamer(null);
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200 text-center">
            <h4 className="text-sm font-black text-foreground mb-3">⚠️ 판매 최종 확인</h4>
            <div className="text-xs text-muted-foreground leading-relaxed py-2">
              정말로 <strong className="text-foreground">{sellingStreamer.name}</strong> 카드{' '}
              <strong className="text-primary font-bold">{sellQuantity}장</strong>을 판매하시겠습니까?
              <p className="mt-2 text-foreground font-semibold">
                획득 예정 포인트: <span className="text-emerald-500 font-extrabold">{(sellingStreamer.base_value * sellQuantity).toLocaleString()} P</span>
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
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2 border-b border-border/60 pb-3">
              💰 선택 카드 일괄 판매 설정
            </h3>

            <div className="mt-4 space-y-3.5 max-h-60 overflow-y-auto pr-1">
              {Object.entries(bulkSellQuantities).map(([channelId, count]) => {
                const streamer = getStreamerByChannelId(channelId);
                const maxCount = getCardCountInInventory(channelId);
                if (!streamer) return null;

                return (
                  <div key={channelId} className="flex items-center justify-between gap-3 bg-secondary/30 p-2.5 rounded-xl border border-border/50">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <img
                        src={streamer.custom_image_url || streamer.logo_url}
                        alt={streamer.name}
                        className="h-8 w-8 rounded-full border border-border/60 object-cover"
                      />
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-foreground truncate">{streamer.name}</p>
                        <p className="text-[9px] text-muted-foreground">보유: {maxCount}장</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        disabled={count <= 0}
                        onClick={() => {
                          setBulkSellQuantities(prev => ({ ...prev, [channelId]: Math.max(0, count - 1) }));
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
                          setBulkSellQuantities(prev => ({ ...prev, [channelId]: Math.min(maxCount, count + 1) }));
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
                {Object.entries(bulkSellQuantities).reduce((acc, [channelId, count]) => {
                  const streamer = getStreamerByChannelId(channelId);
                  return acc + (streamer ? streamer.base_value * count : 0);
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200 text-center">
            <h4 className="text-sm font-black text-foreground mb-3">⚠️ 일괄 판매 최종 확인</h4>
            <div className="text-xs text-muted-foreground leading-relaxed py-2">
              선택한 스트리머 카드 총 <strong className="text-primary font-bold">
                {Object.values(bulkSellQuantities).reduce((a, b) => a + b, 0)}장
              </strong>을 일괄 판매하시겠습니까?
              <p className="mt-2 text-foreground font-semibold">
                총 획득 예정 포인트: <span className="text-emerald-500 font-extrabold">
                  {Object.entries(bulkSellQuantities).reduce((acc, [channelId, count]) => {
                    const streamer = getStreamerByChannelId(channelId);
                    return acc + (streamer ? streamer.base_value * count : 0);
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

    </div>
  );
};
