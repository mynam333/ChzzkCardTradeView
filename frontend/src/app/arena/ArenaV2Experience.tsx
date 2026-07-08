'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  Bot,
  Check,
  Clock3,
  Crown,
  Gauge,
  Hand,
  HeartPulse,
  Layers3,
  Move,
  Plus,
  RefreshCw,
  Save,
  Shield,
  Sparkles,
  Swords,
  Target,
  Trophy,
  Users,
  Zap
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useApp } from '../AppContext';
import type { ArenaSiteTab } from './types';
import styles from './ArenaV2Experience.module.css';

type ArenaV2Season = {
  id: string;
  name: string;
  status: string;
  modesEnabled?: Record<string, boolean>;
  cardPoolVersion?: string;
  balanceVersion?: string;
};

type ArenaV2Card = {
  id: string;
  streamerId: string;
  displayName: string;
  cardClass: string;
  cost: number;
  attack: number;
  health: number;
  keywords: string[];
  artAssetId?: string | null;
  status?: string;
  ownedCount?: number;
  ownedStars?: number[];
};

type ArenaV2Deck = {
  id: string;
  name: string;
  modeScope: 'all' | 'quick' | 'battle_royale_8' | 'bot';
  cardVersionIds: string[];
  isValid: boolean;
  validationResult?: { valid: boolean; errors?: Array<string | { code?: string; message?: string }>; warnings?: Array<string | { code?: string; message?: string }> };
  updatedAt?: string;
};

type ArenaV2RankingItem = {
  rank: number;
  userId: string;
  displayName?: string;
  mmr: number;
  peakMmr: number;
  tier: string;
  peakTier: string;
  wins: number;
  losses: number;
  draws: number;
};

type ArenaV2WikiEntry = {
  slug: string;
  title: string;
  category: string;
  status: string;
  body?: string[];
};

type ArenaV2Report = {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  status: string;
  adminNote?: string | null;
  createdAt?: string;
};

type ArenaV2RightRequest = {
  id: string;
  streamerId: string;
  requestType: string;
  status: string;
  reviewNote?: string | null;
  createdAt?: string;
};

type ArenaV2MyStreamerCard = {
  streamer?: {
    channelId: string;
    name: string;
    logoUrl?: string | null;
    customImageUrl?: string | null;
    isImageBanned?: boolean;
  };
  card: ArenaV2Card | null;
  canEdit: boolean;
  validation?: { valid?: boolean; errors?: Array<{ code?: string; message?: string }> };
};

const classTone: Record<string, { label: string; icon: typeof Swords; accent: string; hint: string }> = {
  charge: { label: '돌격', icon: Swords, accent: 'coral', hint: '라인 돌파와 직접 압박에 특화된 클래스' },
  guardian: { label: '수호', icon: Shield, accent: 'green', hint: '보호막과 전열 유지에 특화된 클래스' },
  sniper: { label: '저격', icon: Target, accent: 'violet', hint: '조준과 후열 압박에 특화된 클래스' },
  support: { label: '지원', icon: Sparkles, accent: 'green', hint: '회복과 라인 보조에 특화된 클래스' },
  trick: { label: '기만', icon: Zap, accent: 'violet', hint: '약화와 위치 교란에 특화된 클래스' },
  specter: { label: '망령', icon: Crown, accent: 'violet', hint: '묘지와 손실 보상에 특화된 클래스' },
  tech: { label: '기술', icon: Gauge, accent: 'cyan', hint: '카드 순환과 전술 보조에 특화된 클래스' },
  attack: { label: '돌격', icon: Swords, accent: 'coral', hint: '라인 돌파와 직접 압박에 특화된 클래스' },
  tempo: { label: '기술', icon: Gauge, accent: 'cyan', hint: '카드 순환과 전술 보조에 특화된 클래스' },
  guard: { label: '수호', icon: Shield, accent: 'green', hint: '보호막과 전열 유지에 특화된 클래스' },
  heal: { label: '지원', icon: Sparkles, accent: 'green', hint: '회복과 라인 보조에 특화된 클래스' },
  control: { label: '기만', icon: Target, accent: 'violet', hint: '약화와 위치 교란에 특화된 클래스' },
  ultimate: { label: '망령', icon: Crown, accent: 'violet', hint: '묘지와 손실 보상에 특화된 클래스' }
};

const legalCardClasses = ['charge', 'guardian', 'sniper', 'support', 'trick', 'specter', 'tech'];

const phases = [
  { id: 'move', label: '이동', icon: Move, hint: '시작 카드 1회' },
  { id: 'place', label: '배치', icon: Plus, hint: '빈 칸에 소환' },
  { id: 'replace', label: '교체', icon: Hand, hint: '새 카드만 가능' },
  { id: 'end', label: '종료', icon: Check, hint: '선택 확정' }
];

const normalizeCard = (raw: any): ArenaV2Card | null => {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || raw.cardVersionId || raw.card_id || '');
  if (!id) return null;
  const keywords = Array.isArray(raw.keywords)
    ? raw.keywords.map((keyword: any) => typeof keyword === 'string' ? keyword : String(keyword?.type || '')).filter(Boolean)
    : [];
  return {
    id,
    streamerId: String(raw.streamerId || raw.streamer_id || raw.channel_id || id),
    displayName: String(raw.displayName || raw.display_name || raw.name || '이름 없는 카드'),
    cardClass: String(raw.cardClass || raw.card_class || raw.class?.role || raw.class?.id || 'tempo'),
    cost: Number(raw.cost ?? raw.stats?.focus ?? 1),
    attack: Number(raw.attack ?? raw.stats?.attack ?? 1),
    health: Number(raw.health ?? raw.hp ?? raw.stats?.hp ?? 1),
    keywords,
    artAssetId: typeof raw.artAssetId === 'string' ? raw.artAssetId : typeof raw.art_asset_id === 'string' ? raw.art_asset_id : typeof raw.image_url === 'string' ? raw.image_url : null,
    status: typeof raw.status === 'string' ? raw.status : undefined,
    ownedCount: Number.isFinite(Number(raw.ownedCount ?? raw.owned_count)) ? Number(raw.ownedCount ?? raw.owned_count) : undefined,
    ownedStars: Array.isArray(raw.ownedStars)
      ? raw.ownedStars.map((star: any) => Number(star)).filter((star: number) => Number.isFinite(star))
      : undefined
  };
};

const fetchArenaJson = async (path: string, timeoutMs = 15000) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await apiFetch(path, { signal: controller.signal });
    if (!response.ok) {
      const errorJson = await response.json().catch(() => ({}));
      throw new Error(errorJson?.message || '아레나 정보를 불러오지 못했습니다.');
    }
    return await response.json();
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('아레나 정보를 불러오는 데 시간이 오래 걸리고 있습니다. 잠시 후 다시 시도해 주세요.');
    }
    throw err;
  } finally {
    window.clearTimeout(timeout);
  }
};

const formatMode = (mode: ArenaV2Deck['modeScope']) => {
  if (mode === 'battle_royale_8') return '8인전';
  if (mode === 'quick') return '빠른대전';
  if (mode === 'bot') return '봇전';
  return '전체';
};

const seasonStatusLabel = (status?: string) => {
  const labels: Record<string, string> = {
    draft: '준비 중',
    scheduled: '곧 시작',
    active: '진행 중',
    locked: '결과 집계 중',
    settling: '보상 준비 중',
    closed: '종료',
    cancelled: '취소됨'
  };
  return labels[String(status || '')] || status || '시즌 대기 중';
};

const deckStateLabel = (isValid?: boolean) => isValid ? '대전 가능' : '수정 필요';

const rewardStatusLabel = (status?: string) => {
  const labels: Record<string, string> = {
    pending: '수령 준비 중',
    granted: '수령 완료',
    held: '확인 중',
    cancelled: '취소됨'
  };
  return labels[String(status || '')] || status || '아직 받을 보상이 없습니다.';
};

const requestStatusLabel = (status?: string) => {
  const labels: Record<string, string> = {
    received: '접수됨',
    pending: '확인 중',
    approved: '반영됨',
    rejected: '반려됨',
    actioned: '처리됨',
    waiting: '대기 중',
    matched: '매칭 완료',
    expired: '시간 만료',
    none: '대기 없음'
  };
  return labels[String(status || '')] || status || '확인 중';
};

const requestTypeLabel = (type?: string) => {
  const labels: Record<string, string> = {
    text_change: '문구 수정',
    image_change: '이미지 수정',
    card_config: '카드 설정',
    disable_version: '카드 숨김',
    opt_out: '참여 제외'
  };
  return labels[String(type || '')] || type || '요청';
};

const targetTypeLabel = (type?: string) => {
  const labels: Record<string, string> = {
    card: '카드',
    match: '경기',
    replay: '장면',
    user: '사용자',
    battle_royale: '8인전'
  };
  return labels[String(type || '')] || type || '대상';
};

const isImageSource = (value?: string | null) => Boolean(value && (/^https?:\/\//i.test(value) || value.startsWith('/')));
const cardTooltip = (card: ArenaV2Card, classLabel: string) => {
  const keywordText = card.keywords.length ? card.keywords.join(', ') : '특수 효과 없음';
  return `${card.displayName}\n클래스: ${classLabel}\n효과: ${keywordText}\n공격력: ${card.attack}\n체력: ${card.health}`;
};

const hydrateStreamerCardForm = (card: ArenaV2Card | null) => ({
  displayName: card?.displayName || '',
  cardClass: legalCardClasses.includes(card?.cardClass || '') ? card?.cardClass || 'charge' : 'charge',
  cost: String(card?.cost ?? 2),
  attack: String(card?.attack ?? 1),
  health: String(card?.health ?? 4),
  keywordsText: card?.keywords?.join(', ') || '',
  artAssetId: card?.artAssetId || ''
});

const parseKeywordEditorText = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return trimmed
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [type, rawValue] = item.split(':').map((part) => part.trim());
      const valueNumber = Number(rawValue);
      return Number.isInteger(valueNumber) ? { type, value: valueNumber } : { type };
    });
};

const CardArt: React.FC<{ card: ArenaV2Card; compact?: boolean }> = ({ card, compact }) => {
  const initial = card.displayName.trim().slice(0, 1) || 'A';
  if (isImageSource(card.artAssetId)) {
    return <img src={card.artAssetId || ''} alt={card.displayName} className="h-full w-full object-cover" loading="lazy" />;
  }
  return (
    <div className={`arena-v2-art-fallback arena-v2-accent-${classTone[card.cardClass]?.accent || 'cyan'} ${compact ? 'is-compact' : ''}`}>
      <span>{initial}</span>
    </div>
  );
};

const ArenaV2CardView: React.FC<{
  card: ArenaV2Card;
  selected?: boolean;
  compact?: boolean;
  onClick?: () => void;
}> = ({ card, selected, compact, onClick }) => {
  const tone = classTone[card.cardClass] || classTone.tempo;
  const Icon = tone.icon;
  const keywords = card.keywords.slice(0, compact ? 1 : 3);
  const tooltip = cardTooltip(card, tone.label);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`arena-v2-card arena-v2-accent-${tone.accent} ${selected ? 'is-selected' : ''} ${compact ? 'is-compact' : ''}`}
      aria-pressed={selected}
      aria-label={`${card.displayName}, 비용 ${card.cost}, 공격 ${card.attack}, 체력 ${card.health}`}
      data-card-tooltip={tooltip}
    >
      <span className="arena-v2-card-cost" aria-label={`비용 ${card.cost}`}>{card.cost}</span>
      <span className="arena-v2-card-role" title={`클래스: ${tone.label} - ${tone.hint}`} aria-label={`클래스 ${tone.label}`}>
        <Icon className="h-4 w-4" />
        <span>{tone.label}</span>
      </span>
      <span className="arena-v2-card-art">
        <CardArt card={card} compact={compact} />
        <span className="arena-v2-card-keywords">
          {keywords.length ? keywords.map((keyword) => <span key={keyword} title={`효과 키워드: ${keyword}`}>{keyword}</span>) : <span title="특수 효과 없음">기본</span>}
        </span>
      </span>
      <span className="arena-v2-card-readable">
        <span className="arena-v2-card-name">{card.displayName}</span>
        <span className="arena-v2-card-brand" aria-hidden="true">CHIKAPO ARENA</span>
      </span>
      <span className="arena-v2-card-stats">
        <span className="is-atk" title={`공격력 ${card.attack}`} aria-label={`공격력 ${card.attack}`}><Swords className="h-4 w-4" /><b>{card.attack}</b></span>
        <span className="is-hp" title={`체력 ${card.health}`} aria-label={`체력 ${card.health}`}><HeartPulse className="h-4 w-4" /><b>{card.health}</b></span>
      </span>
    </button>
  );
};

const BoardSlot: React.FC<{ card?: ArenaV2Card; lane: string; index: number; side: 'opponent' | 'player' }> = ({ card, lane, index, side }) => (
  <div className={`arena-v2-slot ${card ? 'has-card' : ''} ${side === 'player' ? 'is-player' : 'is-opponent'}`}>
    <div className="arena-v2-slot-label">{lane} {index + 1}</div>
    {card ? <ArenaV2CardView card={card} compact /> : <span className="arena-v2-empty-slot">빈 칸</span>}
  </div>
);

const StatTile: React.FC<{ icon: typeof Activity; label: string; value: string; tone?: string }> = ({ icon: Icon, label, value, tone = 'cyan' }) => (
  <div className={`arena-v2-stat arena-v2-accent-${tone}`}>
    <Icon className="h-4 w-4" />
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

export const ArenaV2Experience: React.FC<{ activeTab: ArenaSiteTab }> = ({ activeTab }) => {
  const router = useRouter();
  const { user, toast } = useApp();
  const [season, setSeason] = React.useState<ArenaV2Season | null>(null);
  const [cards, setCards] = React.useState<ArenaV2Card[]>([]);
  const [decks, setDecks] = React.useState<ArenaV2Deck[]>([]);
  const [selectedCardIds, setSelectedCardIds] = React.useState<string[]>([]);
  const [selectedDeckId, setSelectedDeckId] = React.useState<string>('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [notice, setNotice] = React.useState<string>('');
  const [rankings, setRankings] = React.useState<ArenaV2RankingItem[]>([]);
  const [rewardState, setRewardState] = React.useState<any>(null);
  const [wikiEntries, setWikiEntries] = React.useState<ArenaV2WikiEntry[]>([]);
  const [reports, setReports] = React.useState<ArenaV2Report[]>([]);
  const [rightRequests, setRightRequests] = React.useState<ArenaV2RightRequest[]>([]);
  const [myStreamerCard, setMyStreamerCard] = React.useState<ArenaV2MyStreamerCard | null>(null);
  const [queueStatus, setQueueStatus] = React.useState<{ quick?: any; battleRoyale?: any }>({});
  const [reportForm, setReportForm] = React.useState({ targetType: 'card', targetId: '', reason: '' });
  const [rightForm, setRightForm] = React.useState({ streamerId: '', requestType: 'text_change', payloadText: '' });
  const [streamerCardForm, setStreamerCardForm] = React.useState(hydrateStreamerCardForm(null));
  const [adminSeasonForm, setAdminSeasonForm] = React.useState({
    seasonKey: '',
    name: '',
    startsAt: '',
    endsAt: '',
    cardPoolVersion: 'cards-v1',
    balanceVersion: 'balance-v1'
  });

  const visibleCards = cards.slice(0, 24);
  const boardCards = visibleCards.slice(0, 6);
  const deckCount = selectedCardIds.length;
  const deckReady = deckCount >= 14 && deckCount <= 20;
  const selectedDeck = decks.find((deck) => deck.id === selectedDeckId);

  const loadArenaV2 = React.useCallback(async () => {
    setLoading(true);
    setNotice('');
    try {
      const seasonJson = await fetchArenaJson('/arena/season/current');
      const nextSeason: ArenaV2Season | null = seasonJson?.season || null;
      setSeason(nextSeason);

      if (!nextSeason?.id) {
        setCards([]);
        setNotice('진행 중인 아레나 시즌이 없습니다.');
      } else {
        const cardBasePath = user ? '/arena/cards/owned' : '/arena/cards';
        const cardPath = `${cardBasePath}?seasonId=${encodeURIComponent(nextSeason.id)}&limit=48`;
        const cardJson = await fetchArenaJson(cardPath);
        const normalized = Array.isArray(cardJson?.cards) ? cardJson.cards.map(normalizeCard).filter(Boolean) as ArenaV2Card[] : [];
        setCards(normalized);
        if (!normalized.length) {
          setNotice(user ? '아레나에서 사용할 보유 카드가 없습니다.' : '아직 사용할 수 있는 아레나 카드가 없습니다.');
        }
      }

      if (user && nextSeason?.id) {
        const deckRes = await apiFetch(`/arena/decks?seasonId=${encodeURIComponent(nextSeason.id)}`);
        const deckJson = deckRes.ok ? await deckRes.json() : { decks: [] };
        const nextDecks = Array.isArray(deckJson?.decks) ? deckJson.decks as ArenaV2Deck[] : [];
        setDecks(nextDecks);
        setSelectedDeckId((current) => current || nextDecks.find((deck) => deck.isValid)?.id || nextDecks[0]?.id || '');
        const [rewardRes, quickRes, battleRoyaleRes, reportsRes, rightsRes, myCardRes] = await Promise.all([
          apiFetch(`/arena/rewards/current?seasonId=${encodeURIComponent(nextSeason.id)}`),
          apiFetch(`/arena/matchmaking/quick/status?seasonId=${encodeURIComponent(nextSeason.id)}`),
          apiFetch(`/arena/battle-royales/queue/status?seasonId=${encodeURIComponent(nextSeason.id)}`),
          apiFetch('/arena/reports/mine'),
          apiFetch('/arena/streamer-right-requests/mine'),
          apiFetch(`/arena/streamer-card/me?seasonId=${encodeURIComponent(nextSeason.id)}`)
        ]);
        setRewardState(rewardRes.ok ? await rewardRes.json().catch(() => null) : null);
        setQueueStatus({
          quick: quickRes.ok ? await quickRes.json().catch(() => null) : null,
          battleRoyale: battleRoyaleRes.ok ? await battleRoyaleRes.json().catch(() => null) : null
        });
        setReports(reportsRes.ok ? ((await reportsRes.json().catch(() => ({})))?.reports || []) : []);
        setRightRequests(rightsRes.ok ? ((await rightsRes.json().catch(() => ({})))?.requests || []) : []);
        if (myCardRes.ok) {
          const myCardJson = await myCardRes.json().catch(() => null);
          const card = normalizeCard(myCardJson?.card);
          const nextMyCard = {
            streamer: myCardJson?.streamer,
            card,
            canEdit: myCardJson?.canEdit !== false
          };
          setMyStreamerCard(nextMyCard);
          setStreamerCardForm(hydrateStreamerCardForm(card));
        } else {
          setMyStreamerCard(null);
          setStreamerCardForm(hydrateStreamerCardForm(null));
        }
      } else {
        setDecks([]);
        setRewardState(null);
        setQueueStatus({});
        setReports([]);
        setRightRequests([]);
        setMyStreamerCard(null);
        setStreamerCardForm(hydrateStreamerCardForm(null));
      }
      const rankingsPath = nextSeason?.id ? `/arena/rankings?seasonId=${encodeURIComponent(nextSeason.id)}&limit=100` : '/arena/rankings?limit=100';
      const [rankingsRes, wikiRes] = await Promise.all([
        apiFetch(rankingsPath),
        apiFetch('/arena/wiki')
      ]);
      const rankingsJson = rankingsRes.ok ? await rankingsRes.json().catch(() => ({})) : {};
      const wikiJson = wikiRes.ok ? await wikiRes.json().catch(() => ({})) : {};
      setRankings(Array.isArray(rankingsJson?.items) ? rankingsJson.items : []);
      setWikiEntries(Array.isArray(wikiJson?.entries) ? wikiJson.entries : []);
    } catch (err: any) {
      setCards([]);
      setNotice(err?.message || '카드 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  React.useEffect(() => {
    void loadArenaV2();
  }, [loadArenaV2]);

  const toggleCard = (card: ArenaV2Card) => {
    setSelectedCardIds((current) => {
      if (current.includes(card.id)) return current.filter((id) => id !== card.id);
      if (current.length >= 20) return current;
      return [...current, card.id];
    });
  };

  const saveDeck = async () => {
    if (!user) {
      toast('로그인이 필요합니다.', 'error');
      return;
    }
    if (!season?.id || !deckReady) {
      setNotice('덱은 카드 14~20장으로 구성해야 합니다.');
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch('/arena/decks', {
        method: 'POST',
        body: JSON.stringify({
          seasonId: season.id,
          name: `아레나 덱 ${new Date().toLocaleDateString('ko-KR')}`,
          modeScope: 'all',
          cardVersionIds: selectedCardIds
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '덱 저장 실패');
      toast('아레나 덱을 저장했습니다.', 'success');
      setSelectedCardIds([]);
      await loadArenaV2();
    } catch (error: any) {
      toast(error?.message || '덱 저장 중 문제가 발생했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const startBotMatch = async () => {
    if (!selectedDeckId) {
      setNotice('봇전을 시작하려면 먼저 유효한 공식 덱이 필요합니다.');
      return;
    }
    try {
      const res = await apiFetch('/arena/matches', {
        method: 'POST',
        body: JSON.stringify({ mode: 'bot', deckId: selectedDeckId, seasonId: season?.id, botDifficulty: 'normal' })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '봇전 생성 실패');
      const createdMatchId = json?.match?.matchId || json?.match?.id;
      toast('연습전이 시작되었습니다.', 'success');
      if (createdMatchId) {
        router.push(`/arena/matches/${encodeURIComponent(createdMatchId)}`);
      } else {
        setNotice('시작 손패를 선택할 수 있습니다.');
      }
    } catch (error: any) {
      toast(error?.message || '연습전 시작 중 문제가 발생했습니다.', 'error');
    }
  };

  const joinQueue = async (queue: 'quick' | 'battle_royale_8') => {
    if (!selectedDeckId) {
      setNotice('대전을 시작하려면 먼저 대전 가능한 덱이 필요합니다.');
      return;
    }
    const endpoint = queue === 'quick' ? '/arena/matchmaking/quick/join' : '/arena/battle-royales/join';
    try {
      const res = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ deckId: selectedDeckId, seasonId: season?.id })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '대기열 참가 실패');
      const matchedMatchId = json?.ticket?.matchedMatchId;
      if (matchedMatchId) {
        toast('상대가 매칭되었습니다.', 'success');
        router.push(`/arena/matches/${encodeURIComponent(matchedMatchId)}`);
        return;
      }
      toast(queue === 'quick' ? '빠른대전 상대를 찾기 시작했습니다.' : '8인전 참가를 신청했습니다.', 'success');
      setNotice(queue === 'quick' ? '빠른대전 상대를 찾는 중입니다.' : json?.ticket?.battleRoyaleId ? '8인전 방이 생성되었습니다.' : '8명이 모이면 1라운드가 생성됩니다.');
    } catch (error: any) {
      toast(error?.message || '대기열 참가 중 문제가 발생했습니다.', 'error');
    }
  };

  const revalidateDeck = async (deckId: string) => {
    try {
      const res = await apiFetch(`/arena/decks/${encodeURIComponent(deckId)}/validate`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '덱 상태 확인 실패');
      toast('덱 상태를 확인했습니다.', 'success');
      await loadArenaV2();
    } catch (error: any) {
      toast(error?.message || '덱 상태 확인 중 문제가 발생했습니다.', 'error');
    }
  };

  const deleteDeck = async (deckId: string) => {
    try {
      const res = await apiFetch(`/arena/decks/${encodeURIComponent(deckId)}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '덱 삭제 실패');
      toast('덱을 삭제했습니다.', 'success');
      if (selectedDeckId === deckId) setSelectedDeckId('');
      await loadArenaV2();
    } catch (error: any) {
      toast(error?.message || '덱 삭제 중 문제가 발생했습니다.', 'error');
    }
  };

  const cancelQueue = async (queue: 'quick' | 'battle_royale_8') => {
    const endpoint = queue === 'quick' ? '/arena/matchmaking/quick/cancel' : '/arena/battle-royales/queue/cancel';
    try {
      const res = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ seasonId: season?.id })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '대기 취소 실패');
      if (json?.matchId) router.push(`/arena/matches/${encodeURIComponent(json.matchId)}`);
      else toast(json?.cancelled ? '대기열을 취소했습니다.' : '이미 매칭된 대기열입니다.', json?.cancelled ? 'success' : 'info');
      await loadArenaV2();
    } catch (error: any) {
      toast(error?.message || '대기 취소 중 문제가 발생했습니다.', 'error');
    }
  };

  const submitReport = async () => {
    if (!reportForm.targetId.trim() || !reportForm.reason.trim()) {
      setNotice('신고 대상과 사유가 필요합니다.');
      return;
    }
    try {
      const res = await apiFetch('/arena/reports', {
        method: 'POST',
        body: JSON.stringify(reportForm)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '신고 접수 실패');
      toast('신고가 접수되었습니다.', 'success');
      setReportForm({ targetType: 'card', targetId: '', reason: '' });
      await loadArenaV2();
    } catch (error: any) {
      toast(error?.message || '신고 접수 중 문제가 발생했습니다.', 'error');
    }
  };

  const submitRightRequest = async () => {
    if (!rightForm.streamerId.trim()) {
      setNotice('스트리머 이름이 필요합니다.');
      return;
    }
    let payload: unknown = { note: rightForm.payloadText };
    try {
      if (rightForm.payloadText.trim().startsWith('{')) payload = JSON.parse(rightForm.payloadText);
    } catch {
      payload = { note: rightForm.payloadText };
    }
    try {
      const res = await apiFetch('/arena/streamer-right-requests', {
        method: 'POST',
        body: JSON.stringify({ streamerId: rightForm.streamerId, requestType: rightForm.requestType, payload })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '카드 문의 실패');
      toast('카드 문의를 접수했습니다.', 'success');
      setRightForm({ streamerId: '', requestType: 'text_change', payloadText: '' });
      await loadArenaV2();
    } catch (error: any) {
      toast(error?.message || '카드 문의 중 문제가 발생했습니다.', 'error');
    }
  };

  const saveMyStreamerCard = async () => {
    if (!myStreamerCard?.canEdit) {
      setNotice('현재 시즌 상태에서는 스트리머 카드 설정을 변경할 수 없습니다.');
      return;
    }
    try {
      const res = await apiFetch('/arena/streamer-card/me', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: streamerCardForm.displayName,
          cardClass: streamerCardForm.cardClass,
          cost: Number(streamerCardForm.cost),
          attack: Number(streamerCardForm.attack),
          health: Number(streamerCardForm.health),
          keywords: parseKeywordEditorText(streamerCardForm.keywordsText),
          artAssetId: streamerCardForm.artAssetId || undefined
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.accepted === false) {
        const message = json?.validation?.errors?.[0]?.message || json?.message || '현재 수치 조합으로는 저장할 수 없습니다.';
        setMyStreamerCard((current) => current ? { ...current, validation: json?.validation } : current);
        throw new Error(message);
      }
      toast('스트리머 카드 설정을 저장했습니다.', 'success');
      await loadArenaV2();
    } catch (error: any) {
      toast(error?.message || '스트리머 카드 저장 중 문제가 발생했습니다.', 'error');
    }
  };

  const toggleMyStreamerCard = async (enabled: boolean) => {
    try {
      const res = await apiFetch(enabled ? '/arena/streamer-card/me/enable' : '/arena/streamer-card/me/disable', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '스트리머 카드 상태 변경 실패');
      toast(enabled ? '스트리머 카드를 활성화했습니다.' : '스트리머 카드를 비활성화했습니다.', 'success');
      await loadArenaV2();
    } catch (error: any) {
      toast(error?.message || '스트리머 카드 상태 변경 중 문제가 발생했습니다.', 'error');
    }
  };

  const createAdminSeason = async () => {
    try {
      const res = await apiFetch('/admin/arena/seasons', {
        method: 'POST',
        body: JSON.stringify({
          ...adminSeasonForm,
          modesEnabled: { bot: true, quick: true, battle_royale_8: true },
          mmrTierTable: [],
          rewardTable: []
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '시즌 생성 실패');
      toast('시즌을 생성했습니다.', 'success');
      await loadArenaV2();
    } catch (error: any) {
      toast(error?.message || '시즌 생성 중 문제가 발생했습니다.', 'error');
    }
  };

  const transitionSeason = async (toStatus: string) => {
    if (!season?.id) return;
    try {
      const res = await apiFetch(`/admin/arena/seasons/${encodeURIComponent(season.id)}/transition`, {
        method: 'POST',
        body: JSON.stringify({ toStatus, reason: 'arena-v2-admin-panel' })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '시즌 상태 전환 실패');
      toast(`시즌 상태를 ${toStatus}(으)로 전환했습니다.`, 'success');
      await loadArenaV2();
    } catch (error: any) {
      toast(error?.message || '시즌 상태 전환 중 문제가 발생했습니다.', 'error');
    }
  };

  const grantRewards = async (dryRun: boolean) => {
    if (!season?.id) return;
    try {
      const res = await apiFetch(`/admin/arena/seasons/${encodeURIComponent(season.id)}/grant-rewards`, {
        method: 'POST',
        body: JSON.stringify({ dryRun, reason: dryRun ? 'preview' : 'season-settlement' })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '보상 작업 실패');
      toast(dryRun ? `보상 대상 ${json?.preview?.totalPlayers ?? 0}명 확인` : `보상 ${json?.granted ?? 0}건 준비 완료`, 'success');
    } catch (error: any) {
      toast(error?.message || '보상 작업 중 문제가 발생했습니다.', 'error');
    }
  };

  const renderPlay = () => (
    <div className={`arena-v2-shell ${styles.arenaV2Scope}`}>
      <section className="arena-v2-topbar">
        <div className="min-w-0">
          <p className="arena-v2-kicker">CHIKAPO ARENA</p>
          <h2>스트리머 카드로 라인을 장악하세요</h2>
          <p>{season ? `${season.name} · ${seasonStatusLabel(season.status)}` : '새 시즌 준비 중'} · 덱 14~20장 · 40초 승부</p>
        </div>
        <div className="arena-v2-top-actions">
          <button type="button" onClick={loadArenaV2} className="arena-v2-icon-button" aria-label="아레나 새로고침">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button type="button" onClick={startBotMatch} className="arena-v2-primary-button">
            <Bot className="h-4 w-4" /> 연습전 시작
          </button>
        </div>
      </section>

      {notice ? (
        <div className="arena-v2-notice" role="status">
          <AlertTriangle className="h-4 w-4" />
          <span>{notice}</span>
        </div>
      ) : null}

      <section className="arena-v2-stage">
        <aside className="arena-v2-phase-rail" aria-label="턴 행동 순서">
          {phases.map((phase, index) => {
            const Icon = phase.icon;
            return (
              <div key={phase.id} className={`arena-v2-phase ${index === 1 ? 'is-active' : ''}`}>
                <Icon className="h-4 w-4" />
                <strong>{phase.label}</strong>
                <span>{phase.hint}</span>
              </div>
            );
          })}
        </aside>

        <div className="arena-v2-board-wrap">
          <div className="arena-v2-player-strip is-opponent">
            <div>
              <span>상대</span>
              <strong>연습 상대</strong>
            </div>
            <div className="arena-v2-resource"><Gauge className="h-4 w-4" /> 6 / 9</div>
          </div>
          <div className="arena-v2-board" aria-label="상대 2행 3열 보드">
            {boardCards.slice(0, 3).map((card, index) => <BoardSlot key={`op-${card.id}`} card={card} lane="전열" index={index} side="opponent" />)}
            {boardCards.slice(3, 6).map((card, index) => <BoardSlot key={`op-b-${card.id}`} card={index === 1 ? undefined : card} lane="후열" index={index} side="opponent" />)}
          </div>
          <div className="arena-v2-lane-divider"><span>전열이 먼저 맞붙고, 후열이 빈틈을 노립니다</span></div>
          <div className="arena-v2-board" aria-label="내 2행 3열 보드">
            {boardCards.slice(0, 3).map((card, index) => <BoardSlot key={`pl-${card.id}`} card={index === 2 ? undefined : card} lane="전열" index={index} side="player" />)}
            {boardCards.slice(3, 6).map((card, index) => <BoardSlot key={`pl-b-${card.id}`} card={card} lane="후열" index={index} side="player" />)}
          </div>
          <div className="arena-v2-player-strip">
            <div>
              <span>나</span>
              <strong>{user?.username || '게스트'}</strong>
            </div>
            <div className="arena-v2-resource"><Clock3 className="h-4 w-4" /> 40초</div>
          </div>
        </div>

        <aside className="arena-v2-command-panel" aria-label="매치 상태">
          <StatTile icon={Layers3} label="덱 규칙" value="14~20" tone="gold" />
          <StatTile icon={Users} label="보드" value="2 x 3" tone="cyan" />
          <StatTile icon={Activity} label="비용 상한" value="9" tone="green" />
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">선택 덱</span>
            <select value={selectedDeckId} onChange={(event) => setSelectedDeckId(event.target.value)} className="arena-v2-select" aria-label="봇전에 사용할 덱 선택">
              <option value="">대전 가능한 덱 없음</option>
              {decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name} · {formatMode(deck.modeScope)}</option>)}
            </select>
            <p>{selectedDeck ? `${selectedDeck.cardVersionIds.length}장 · ${deckStateLabel(selectedDeck.isValid)}` : '덱을 저장하면 바로 선택할 수 있습니다.'}</p>
          </div>
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">현재 행동</span>
            <div className="arena-v2-action-order">
              {phases.map((phase) => <span key={phase.id}>{phase.label}</span>)}
            </div>
            <p>카드를 옮기고, 빈 칸에 배치하고, 결정적인 순간에 교체하세요.</p>
          </div>
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">대전 찾기</span>
            <div className="arena-v2-queue-actions">
              <button type="button" onClick={() => joinQueue('quick')}><Swords className="h-4 w-4" /> 빠른대전</button>
              <button type="button" onClick={() => joinQueue('battle_royale_8')}><Users className="h-4 w-4" /> 8인전</button>
            </div>
          </div>
        </aside>
      </section>

      <section className="arena-v2-hand-rail" aria-label="카드 풀과 덱 구성">
        <div className="arena-v2-hand-header">
          <div>
            <p className="arena-v2-kicker">CARD LINEUP</p>
            <h3>공식 덱 구성</h3>
            <span>한 스트리머는 한 장만 선택할 수 있습니다.</span>
          </div>
          <div className={`arena-v2-deck-meter ${deckReady ? 'is-ready' : ''}`}>
            <strong>{deckCount}</strong>
            <span>/ 14~20</span>
          </div>
          <button type="button" onClick={saveDeck} disabled={saving || !deckReady} className="arena-v2-secondary-button">
            <Save className="h-4 w-4" /> 덱 저장
          </button>
        </div>
        <div className="arena-v2-card-row">
          {visibleCards.map((card) => (
            <ArenaV2CardView key={card.id} card={card} selected={selectedCardIds.includes(card.id)} onClick={() => toggleCard(card)} />
          ))}
        </div>
      </section>
    </div>
  );

  const issueText = (issue: string | { code?: string; message?: string }) =>
    typeof issue === 'string' ? issue : issue.message || issue.code || '확인 필요';

  const renderInventory = () => (
    <section className={`arena-v2-shell ${styles.arenaV2Scope}`}>
      <section className="arena-v2-topbar">
        <div>
          <p className="arena-v2-kicker">DECK VAULT</p>
          <h2>덱과 카드 보관함</h2>
          <p>{season ? `${season.name} · ${seasonStatusLabel(season.status)}` : '새 시즌 준비 중'} · 저장 덱 {decks.length}개 · 카드 {cards.length}장</p>
        </div>
        <button type="button" onClick={loadArenaV2} className="arena-v2-secondary-button">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 새로고침
        </button>
      </section>
      <section className="arena-v2-stage">
        <aside className="arena-v2-command-panel">
          <StatTile icon={Layers3} label="저장 덱" value={`${decks.length}`} tone="cyan" />
          <StatTile icon={Check} label="대전 가능" value={`${decks.filter((deck) => deck.isValid).length}`} tone="green" />
          <StatTile icon={AlertTriangle} label="수정 필요" value={`${decks.filter((deck) => !deck.isValid).length}`} tone="gold" />
        </aside>
        <div className="arena-v2-board-wrap">
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">저장된 덱</span>
            <div className="arena-v2-action-stack">
              {decks.length ? decks.map((deck) => (
                <div key={deck.id} className="arena-v2-action-order">
                  <span>{deck.name}</span>
                  <span>{formatMode(deck.modeScope)}</span>
                  <span>{deck.cardVersionIds.length}장</span>
                  <span>{deckStateLabel(deck.isValid)}</span>
                  <button type="button" onClick={() => revalidateDeck(deck.id)}>상태 확인</button>
                  <button type="button" onClick={() => deleteDeck(deck.id)}>삭제</button>
                </div>
              )) : <p>저장된 덱이 없습니다. 플레이 탭에서 카드 14~20장을 선택해 저장합니다.</p>}
            </div>
          </div>
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">덱 점검</span>
            <div className="arena-v2-replay-list">
              {decks.flatMap((deck) => (deck.validationResult?.errors || []).map((issue, index) => (
                <span key={`${deck.id}-error-${index}`}><AlertTriangle className="h-3.5 w-3.5" />{deck.name} · {issueText(issue)}</span>
              ))).slice(0, 12)}
              {!decks.some((deck) => (deck.validationResult?.errors || []).length) ? <p>모든 덱이 대전 준비를 마쳤습니다.</p> : null}
            </div>
          </div>
        </div>
      </section>
    </section>
  );

  const renderRanking = () => (
    <section className={`arena-v2-shell ${styles.arenaV2Scope}`}>
      <section className="arena-v2-topbar">
        <div>
          <p className="arena-v2-kicker">SEASON RANKING</p>
          <h2>시즌 랭킹과 내 보상</h2>
          <p>{season ? `${season.name} · ${seasonStatusLabel(season.status)}` : '새 시즌 준비 중'} · 빠른대전 결과 기준</p>
        </div>
        <button type="button" onClick={loadArenaV2} className="arena-v2-secondary-button">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 새로고침
        </button>
      </section>
      <section className="arena-v2-stage">
        <aside className="arena-v2-command-panel">
          <StatTile icon={Trophy} label="랭킹 인원" value={`${rankings.length}`} tone="gold" />
          <StatTile icon={Gauge} label="내 점수" value={`${rewardState?.rating?.mmr ?? 1000}`} tone="cyan" />
          <StatTile icon={Crown} label="최고 등급" value={`${rewardState?.rating?.peakTier ?? 'bronze'}`} tone="green" />
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">보상 상태</span>
            <p>{rewardState?.grant ? `${rewardStatusLabel(rewardState.grant.status)}${rewardState.grant.holdReason ? ` · ${rewardState.grant.holdReason}` : ''}` : '아직 받을 보상이 없습니다.'}</p>
          </div>
        </aside>
        <div className="arena-v2-board-wrap">
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">랭킹</span>
            <div className="arena-v2-action-stack">
              {rankings.length ? rankings.map((item) => (
                <div key={`${item.rank}-${item.userId}`} className="arena-v2-action-order">
                  <span>#{item.rank}</span>
                  <span>{item.displayName || item.userId}</span>
                  <span>{item.mmr}점</span>
                  <span>{item.tier}</span>
                  <span>{item.wins}승 {item.losses}패 {item.draws}무</span>
                </div>
              )) : <p>아직 랭킹 데이터가 없습니다.</p>}
            </div>
          </div>
        </div>
      </section>
    </section>
  );

  const renderStyle = () => (
    <section className={`arena-v2-shell ${styles.arenaV2Scope}`}>
      <section className="arena-v2-topbar">
        <div>
          <p className="arena-v2-kicker">CARD STUDIO · HELP</p>
          <h2>내 카드와 문의</h2>
          <p>내 스트리머 카드를 꾸미고, 경기 중 불편했던 장면을 편하게 알려주세요.</p>
        </div>
        <button type="button" onClick={loadArenaV2} className="arena-v2-secondary-button">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 새로고침
        </button>
      </section>
      <section className="arena-v2-stage">
        <aside className="arena-v2-command-panel">
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">내 스트리머 카드 설정</span>
            {myStreamerCard ? (
              <>
                <p>{myStreamerCard.streamer?.name || myStreamerCard.streamer?.channelId || '등록 스트리머'} · {myStreamerCard.canEdit ? '편집 가능' : '이번 시즌 수정 마감'}</p>
                <input value={streamerCardForm.displayName} onChange={(event) => setStreamerCardForm((current) => ({ ...current, displayName: event.target.value }))} className="arena-v2-select" placeholder="카드 이름" disabled={!myStreamerCard.canEdit} />
                <select value={streamerCardForm.cardClass} onChange={(event) => setStreamerCardForm((current) => ({ ...current, cardClass: event.target.value }))} className="arena-v2-select" disabled={!myStreamerCard.canEdit}>
                  {legalCardClasses.map((cardClass) => (
                    <option key={cardClass} value={cardClass}>{classTone[cardClass]?.label || cardClass}</option>
                  ))}
                </select>
                <div className="arena-v2-action-order">
                  <input type="number" min={1} max={9} value={streamerCardForm.cost} onChange={(event) => setStreamerCardForm((current) => ({ ...current, cost: event.target.value }))} className="arena-v2-select" aria-label="코스트" disabled={!myStreamerCard.canEdit} />
                  <input type="number" min={0} max={9} value={streamerCardForm.attack} onChange={(event) => setStreamerCardForm((current) => ({ ...current, attack: event.target.value }))} className="arena-v2-select" aria-label="공격력" disabled={!myStreamerCard.canEdit} />
                  <input type="number" min={1} max={20} value={streamerCardForm.health} onChange={(event) => setStreamerCardForm((current) => ({ ...current, health: event.target.value }))} className="arena-v2-select" aria-label="체력" disabled={!myStreamerCard.canEdit} />
                </div>
                <input value={streamerCardForm.keywordsText} onChange={(event) => setStreamerCardForm((current) => ({ ...current, keywordsText: event.target.value }))} className="arena-v2-select" placeholder="효과 키워드: 도발:1, 보호:1" disabled={!myStreamerCard.canEdit} />
                <input value={streamerCardForm.artAssetId} onChange={(event) => setStreamerCardForm((current) => ({ ...current, artAssetId: event.target.value }))} className="arena-v2-select" placeholder="카드 이미지 주소" disabled={!myStreamerCard.canEdit} />
                {myStreamerCard.validation?.errors?.length ? (
                  <div className="arena-v2-replay-list">
                    {myStreamerCard.validation.errors.map((error, index) => <span key={`${error.code || 'error'}-${index}`}>{error.message || error.code}</span>)}
                  </div>
                ) : null}
                <div className="arena-v2-queue-actions">
                  <button type="button" onClick={saveMyStreamerCard} disabled={!myStreamerCard.canEdit}>저장</button>
                  <button type="button" onClick={() => toggleMyStreamerCard(false)}>비활성화</button>
                  <button type="button" onClick={() => toggleMyStreamerCard(true)}>활성화</button>
                </div>
              </>
            ) : (
              <p>내 계정으로 꾸밀 수 있는 스트리머 카드가 없습니다.</p>
            )}
          </div>
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">신고 접수</span>
            <select value={reportForm.targetType} onChange={(event) => setReportForm((current) => ({ ...current, targetType: event.target.value }))} className="arena-v2-select">
              <option value="card">카드</option>
              <option value="match">매치</option>
              <option value="replay">전투 장면</option>
              <option value="user">유저</option>
              <option value="battle_royale">8인전</option>
            </select>
            <input value={reportForm.targetId} onChange={(event) => setReportForm((current) => ({ ...current, targetId: event.target.value }))} className="arena-v2-select" placeholder="카드, 경기, 사용자 이름" />
            <input value={reportForm.reason} onChange={(event) => setReportForm((current) => ({ ...current, reason: event.target.value }))} className="arena-v2-select" placeholder="신고 사유" />
            <button type="button" onClick={submitReport} className="arena-v2-primary-button">신고 제출</button>
          </div>
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">카드 문의</span>
            <input value={rightForm.streamerId} onChange={(event) => setRightForm((current) => ({ ...current, streamerId: event.target.value }))} className="arena-v2-select" placeholder="스트리머 이름" />
            <select value={rightForm.requestType} onChange={(event) => setRightForm((current) => ({ ...current, requestType: event.target.value }))} className="arena-v2-select">
              <option value="text_change">문구 변경</option>
              <option value="image_change">이미지 변경</option>
              <option value="card_config">카드 설정</option>
              <option value="disable_version">버전 비활성</option>
              <option value="opt_out">참여 제외</option>
            </select>
            <input value={rightForm.payloadText} onChange={(event) => setRightForm((current) => ({ ...current, payloadText: event.target.value }))} className="arena-v2-select" placeholder="요청 내용을 입력하세요" />
            <button type="button" onClick={submitRightRequest} className="arena-v2-primary-button">문의 보내기</button>
          </div>
        </aside>
        <div className="arena-v2-board-wrap">
          {myStreamerCard?.card ? (
            <div className="arena-v2-panel-section">
              <span className="arena-v2-panel-label">내 카드 미리보기</span>
              <div className="arena-v2-card-row">
                <ArenaV2CardView
                  card={{
                    ...myStreamerCard.card,
                    displayName: streamerCardForm.displayName || myStreamerCard.card.displayName,
                    cardClass: streamerCardForm.cardClass,
                    cost: Number.isFinite(Number(streamerCardForm.cost)) ? Number(streamerCardForm.cost) : myStreamerCard.card.cost,
                    attack: Number.isFinite(Number(streamerCardForm.attack)) ? Number(streamerCardForm.attack) : myStreamerCard.card.attack,
                    health: Number.isFinite(Number(streamerCardForm.health)) ? Number(streamerCardForm.health) : myStreamerCard.card.health,
                    keywords: parseKeywordEditorText(streamerCardForm.keywordsText).map((keyword: any) => String(keyword.type || '')).filter(Boolean),
                    artAssetId: streamerCardForm.artAssetId || myStreamerCard.card.artAssetId
                  }}
                />
              </div>
            </div>
          ) : null}
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">가이드</span>
            <div className="arena-v2-replay-list">
              {wikiEntries.length ? wikiEntries.map((entry) => <span key={entry.slug}>{entry.category} · {entry.title}</span>) : <p>아직 준비된 가이드가 없습니다.</p>}
            </div>
          </div>
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">내 문의 내역</span>
            <div className="arena-v2-replay-list">
              {reports.map((report) => <span key={report.id}>신고 · {targetTypeLabel(report.targetType)} · {requestStatusLabel(report.status)}</span>)}
              {rightRequests.map((request) => <span key={request.id}>문의 · {requestTypeLabel(request.requestType)} · {requestStatusLabel(request.status)}</span>)}
              {!reports.length && !rightRequests.length ? <p>접수된 내역이 없습니다.</p> : null}
            </div>
          </div>
        </div>
      </section>
    </section>
  );

  const renderAdmin = () => (
    <section className={`arena-v2-shell ${styles.arenaV2Scope}`}>
      <section className="arena-v2-topbar">
        <div>
          <p className="arena-v2-kicker">ARENA CONTROL</p>
          <h2>시즌 운영과 정산</h2>
          <p>{season ? `${season.name} · ${seasonStatusLabel(season.status)}` : '진행 중인 시즌 없음'}</p>
        </div>
        <button type="button" onClick={loadArenaV2} className="arena-v2-secondary-button">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 새로고침
        </button>
      </section>
      <section className="arena-v2-stage">
        <aside className="arena-v2-command-panel">
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">시즌 생성</span>
            <input className="arena-v2-select" placeholder="시즌 코드" value={adminSeasonForm.seasonKey} onChange={(event) => setAdminSeasonForm((current) => ({ ...current, seasonKey: event.target.value }))} />
            <input className="arena-v2-select" placeholder="시즌 이름" value={adminSeasonForm.name} onChange={(event) => setAdminSeasonForm((current) => ({ ...current, name: event.target.value }))} />
            <input className="arena-v2-select" type="datetime-local" value={adminSeasonForm.startsAt} onChange={(event) => setAdminSeasonForm((current) => ({ ...current, startsAt: event.target.value }))} />
            <input className="arena-v2-select" type="datetime-local" value={adminSeasonForm.endsAt} onChange={(event) => setAdminSeasonForm((current) => ({ ...current, endsAt: event.target.value }))} />
            <button type="button" className="arena-v2-primary-button" onClick={createAdminSeason}>시즌 생성</button>
          </div>
        </aside>
        <div className="arena-v2-board-wrap">
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">상태 전환</span>
            <div className="arena-v2-queue-actions">
              {['scheduled', 'active', 'locked', 'settling', 'closed', 'cancelled'].map((status) => (
                <button key={status} type="button" onClick={() => transitionSeason(status)} disabled={!season?.id}>{seasonStatusLabel(status)}</button>
              ))}
            </div>
          </div>
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">보상 정산</span>
            <div className="arena-v2-queue-actions">
              <button type="button" onClick={() => grantRewards(true)} disabled={!season?.id}>대상 확인</button>
              <button type="button" onClick={() => grantRewards(false)} disabled={!season?.id}>보상 준비</button>
            </div>
            <p>시즌 결과에 따라 받을 보상을 준비합니다.</p>
          </div>
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">대전 대기 상태</span>
            <div className="arena-v2-replay-list">
              <span>빠른대전 · {requestStatusLabel(queueStatus.quick?.status)} {queueStatus.quick?.matchId ? '· 매칭 완료' : ''}</span>
              <span>8인전 · {requestStatusLabel(queueStatus.battleRoyale?.status)} {queueStatus.battleRoyale?.participantCount != null ? `· ${queueStatus.battleRoyale.participantCount}/8` : ''}</span>
            </div>
          </div>
        </div>
      </section>
    </section>
  );

  if (activeTab === 'inventory') return renderInventory();
  if (activeTab === 'ranking') return renderRanking();
  if (activeTab === 'style') return renderStyle();
  if (activeTab === 'admin') return renderAdmin();
  return renderPlay();
};
