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
  sample?: boolean;
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

const sampleCards: ArenaV2Card[] = [
  { id: 'sample-a', streamerId: 's-a', displayName: '라이트 콜러', cardClass: 'tempo', cost: 2, attack: 2, health: 4, keywords: ['선공', '드로우'], sample: true },
  { id: 'sample-b', streamerId: 's-b', displayName: '스테이지 브레이커', cardClass: 'attack', cost: 3, attack: 5, health: 3, keywords: ['돌파'], sample: true },
  { id: 'sample-c', streamerId: 's-c', displayName: '가드 디렉터', cardClass: 'guard', cost: 4, attack: 3, health: 7, keywords: ['보호', '도발'], sample: true },
  { id: 'sample-d', streamerId: 's-d', displayName: '리듬 메딕', cardClass: 'heal', cost: 3, attack: 2, health: 6, keywords: ['회복'], sample: true },
  { id: 'sample-e', streamerId: 's-e', displayName: '클러치 스나이퍼', cardClass: 'control', cost: 5, attack: 6, health: 4, keywords: ['저격', '침묵'], sample: true },
  { id: 'sample-f', streamerId: 's-f', displayName: '파이널 앵커', cardClass: 'ultimate', cost: 7, attack: 8, health: 8, keywords: ['궁극기'], sample: true }
];

const classTone: Record<string, { label: string; icon: typeof Swords; accent: string; hint: string }> = {
  attack: { label: '공격', icon: Swords, accent: 'coral', hint: '높은 피해와 돌파에 특화된 클래스' },
  tempo: { label: '템포', icon: Zap, accent: 'cyan', hint: '빠른 전개와 카드 순환에 특화된 클래스' },
  guard: { label: '방어', icon: Shield, accent: 'green', hint: '보호와 전열 유지에 특화된 클래스' },
  heal: { label: '지원', icon: Sparkles, accent: 'green', hint: '회복과 보조 효과에 특화된 클래스' },
  control: { label: '제어', icon: Target, accent: 'violet', hint: '침묵, 저격, 위치 제어에 특화된 클래스' },
  ultimate: { label: '결정타', icon: Crown, accent: 'gold', hint: '높은 비용의 승부수에 특화된 클래스' }
};

const phases = [
  { id: 'move', label: '이동', icon: Move, hint: '시작 카드 1회' },
  { id: 'place', label: '배치', icon: Plus, hint: '빈 칸에 소환' },
  { id: 'replace', label: '교체', icon: Hand, hint: '새 카드만 가능' },
  { id: 'end', label: '종료', icon: Check, hint: '서버 확정' }
];

const normalizeCard = (raw: any): ArenaV2Card | null => {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || raw.cardVersionId || raw.card_id || '');
  if (!id) return null;
  const keywords = Array.isArray(raw.keywords) ? raw.keywords.map(String) : [];
  return {
    id,
    streamerId: String(raw.streamerId || raw.streamer_id || raw.channel_id || id),
    displayName: String(raw.displayName || raw.display_name || raw.name || '이름 없는 카드'),
    cardClass: String(raw.cardClass || raw.card_class || raw.class?.role || raw.class?.id || 'tempo'),
    cost: Number(raw.cost ?? raw.stats?.focus ?? 1),
    attack: Number(raw.attack ?? raw.stats?.attack ?? 1),
    health: Number(raw.health ?? raw.hp ?? raw.stats?.hp ?? 1),
    keywords,
    artAssetId: typeof raw.artAssetId === 'string' ? raw.artAssetId : typeof raw.image_url === 'string' ? raw.image_url : null,
    status: typeof raw.status === 'string' ? raw.status : undefined
  };
};

const formatMode = (mode: ArenaV2Deck['modeScope']) => {
  if (mode === 'battle_royale_8') return '8인전';
  if (mode === 'quick') return '빠른대전';
  if (mode === 'bot') return '봇전';
  return '전체';
};

const isUrl = (value?: string | null) => Boolean(value && /^https?:\/\//i.test(value));
const cardTooltip = (card: ArenaV2Card, classLabel: string) => {
  const keywordText = card.keywords.length ? card.keywords.join(', ') : '특수 효과 없음';
  return `${card.displayName}\n클래스: ${classLabel}\n효과: ${keywordText}\n공격력: ${card.attack}\n체력: ${card.health}`;
};

const CardArt: React.FC<{ card: ArenaV2Card; compact?: boolean }> = ({ card, compact }) => {
  const initial = card.displayName.trim().slice(0, 1) || 'A';
  if (isUrl(card.artAssetId)) {
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
  const [cards, setCards] = React.useState<ArenaV2Card[]>(sampleCards);
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
  const [queueStatus, setQueueStatus] = React.useState<{ quick?: any; battleRoyale?: any }>({});
  const [reportForm, setReportForm] = React.useState({ targetType: 'card', targetId: '', reason: '' });
  const [rightForm, setRightForm] = React.useState({ streamerId: '', requestType: 'text_change', payloadText: '' });
  const [adminSeasonForm, setAdminSeasonForm] = React.useState({
    seasonKey: '',
    name: '',
    startsAt: '',
    endsAt: '',
    cardPoolVersion: 'cards-v1',
    balanceVersion: 'balance-v1'
  });

  const realCards = cards.filter((card) => !card.sample);
  const visibleCards = cards.slice(0, 24);
  const boardCards = visibleCards.length >= 6 ? visibleCards.slice(0, 6) : sampleCards;
  const deckCount = selectedCardIds.length;
  const deckReady = deckCount >= 14 && deckCount <= 20 && realCards.length > 0;
  const selectedDeck = decks.find((deck) => deck.id === selectedDeckId);

  const loadArenaV2 = React.useCallback(async () => {
    setLoading(true);
    setNotice('');
    try {
      const seasonRes = await apiFetch('/arena/season/current');
      const seasonJson = seasonRes.ok ? await seasonRes.json() : { season: null };
      const nextSeason: ArenaV2Season | null = seasonJson?.season || null;
      setSeason(nextSeason);

      const cardPath = nextSeason?.id ? `/arena/cards?seasonId=${encodeURIComponent(nextSeason.id)}&limit=48` : '/arena/cards?limit=48';
      const cardRes = await apiFetch(cardPath);
      const cardJson = cardRes.ok ? await cardRes.json() : { cards: [] };
      const normalized = Array.isArray(cardJson?.cards) ? cardJson.cards.map(normalizeCard).filter(Boolean) as ArenaV2Card[] : [];
      setCards(normalized.length ? normalized : sampleCards);

      if (user && nextSeason?.id) {
        const deckRes = await apiFetch(`/arena/decks?seasonId=${encodeURIComponent(nextSeason.id)}`);
        const deckJson = deckRes.ok ? await deckRes.json() : { decks: [] };
        const nextDecks = Array.isArray(deckJson?.decks) ? deckJson.decks as ArenaV2Deck[] : [];
        setDecks(nextDecks);
        setSelectedDeckId((current) => current || nextDecks.find((deck) => deck.isValid)?.id || nextDecks[0]?.id || '');
        const [rewardRes, quickRes, battleRoyaleRes, reportsRes, rightsRes] = await Promise.all([
          apiFetch(`/arena/rewards/current?seasonId=${encodeURIComponent(nextSeason.id)}`),
          apiFetch(`/arena/matchmaking/quick/status?seasonId=${encodeURIComponent(nextSeason.id)}`),
          apiFetch(`/arena/battle-royales/queue/status?seasonId=${encodeURIComponent(nextSeason.id)}`),
          apiFetch('/arena/reports/mine'),
          apiFetch('/arena/streamer-right-requests/mine')
        ]);
        setRewardState(rewardRes.ok ? await rewardRes.json().catch(() => null) : null);
        setQueueStatus({
          quick: quickRes.ok ? await quickRes.json().catch(() => null) : null,
          battleRoyale: battleRoyaleRes.ok ? await battleRoyaleRes.json().catch(() => null) : null
        });
        setReports(reportsRes.ok ? ((await reportsRes.json().catch(() => ({})))?.reports || []) : []);
        setRightRequests(rightsRes.ok ? ((await rightsRes.json().catch(() => ({})))?.requests || []) : []);
      } else {
        setDecks([]);
        setRewardState(null);
        setQueueStatus({});
        setReports([]);
        setRightRequests([]);
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
    } catch {
      setCards(sampleCards);
      setNotice('서버 카드 풀을 불러오지 못해 샘플 보드로 표시 중입니다.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  React.useEffect(() => {
    void loadArenaV2();
  }, [loadArenaV2]);

  const toggleCard = (card: ArenaV2Card) => {
    if (card.sample) {
      setNotice('샘플 카드는 덱에 저장되지 않습니다. 실제 시즌 카드 풀이 필요합니다.');
      return;
    }
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
      setNotice('공식 덱은 실제 카드 14~20장으로만 저장할 수 있습니다.');
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch('/arena/decks', {
        method: 'POST',
        body: JSON.stringify({
          seasonId: season.id,
          name: `V2 덱 ${new Date().toLocaleDateString('ko-KR')}`,
          modeScope: 'all',
          cardVersionIds: selectedCardIds
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '덱 저장 실패');
      toast('아레나 v2 덱을 저장했습니다.', 'success');
      setSelectedCardIds([]);
      await loadArenaV2();
    } catch (error: any) {
      toast(error?.message || '덱 저장 중 오류가 발생했습니다.', 'error');
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
      toast('봇전 매치가 생성되었습니다.', 'success');
      if (createdMatchId) {
        router.push(`/arena/matches/${encodeURIComponent(createdMatchId)}`);
      } else {
        setNotice('매치가 멀리건 단계로 생성되었습니다.');
      }
    } catch (error: any) {
      toast(error?.message || '봇전 생성 중 오류가 발생했습니다.', 'error');
    }
  };

  const joinQueue = async (queue: 'quick' | 'battle_royale_8') => {
    if (!selectedDeckId) {
      setNotice('대전 큐에 진입하려면 먼저 유효한 공식 덱이 필요합니다.');
      return;
    }
    const endpoint = queue === 'quick' ? '/arena/matchmaking/quick/join' : '/arena/battle-royales/join';
    try {
      const res = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ deckId: selectedDeckId, seasonId: season?.id })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '큐 진입 실패');
      const matchedMatchId = json?.ticket?.matchedMatchId;
      if (matchedMatchId) {
        toast('상대가 매칭되었습니다.', 'success');
        router.push(`/arena/matches/${encodeURIComponent(matchedMatchId)}`);
        return;
      }
      toast(queue === 'quick' ? '빠른대전 큐에 진입했습니다.' : '8인전 큐에 진입했습니다.', 'success');
      setNotice(queue === 'quick' ? '빠른대전 상대를 찾는 중입니다.' : json?.ticket?.battleRoyaleId ? '8인전 방이 생성되었습니다.' : '8명이 모이면 1라운드가 생성됩니다.');
    } catch (error: any) {
      toast(error?.message || '큐 진입 중 오류가 발생했습니다.', 'error');
    }
  };

  const revalidateDeck = async (deckId: string) => {
    try {
      const res = await apiFetch(`/arena/decks/${encodeURIComponent(deckId)}/validate`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '덱 재검증 실패');
      toast('덱 검증 상태를 갱신했습니다.', 'success');
      await loadArenaV2();
    } catch (error: any) {
      toast(error?.message || '덱 재검증 중 오류가 발생했습니다.', 'error');
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
      toast(error?.message || '덱 삭제 중 오류가 발생했습니다.', 'error');
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
      if (!res.ok) throw new Error(json?.message || '큐 취소 실패');
      if (json?.matchId) router.push(`/arena/matches/${encodeURIComponent(json.matchId)}`);
      else toast(json?.cancelled ? '대기열을 취소했습니다.' : '이미 매칭된 대기열입니다.', json?.cancelled ? 'success' : 'info');
      await loadArenaV2();
    } catch (error: any) {
      toast(error?.message || '큐 취소 중 오류가 발생했습니다.', 'error');
    }
  };

  const submitReport = async () => {
    if (!reportForm.targetId.trim() || !reportForm.reason.trim()) {
      setNotice('신고 대상 ID와 사유가 필요합니다.');
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
      toast(error?.message || '신고 접수 중 오류가 발생했습니다.', 'error');
    }
  };

  const submitRightRequest = async () => {
    if (!rightForm.streamerId.trim()) {
      setNotice('스트리머 ID가 필요합니다.');
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
      if (!res.ok) throw new Error(json?.message || '권리 요청 실패');
      toast('스트리머 권리 요청을 접수했습니다.', 'success');
      setRightForm({ streamerId: '', requestType: 'text_change', payloadText: '' });
      await loadArenaV2();
    } catch (error: any) {
      toast(error?.message || '권리 요청 중 오류가 발생했습니다.', 'error');
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
      toast(error?.message || '시즌 생성 중 오류가 발생했습니다.', 'error');
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
      toast(error?.message || '시즌 상태 전환 중 오류가 발생했습니다.', 'error');
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
      toast(dryRun ? `보상 미리보기 ${json?.preview?.totalPlayers ?? 0}명` : `보상 grant 생성 ${json?.granted ?? 0}건`, 'success');
    } catch (error: any) {
      toast(error?.message || '보상 작업 중 오류가 발생했습니다.', 'error');
    }
  };

  const renderPlay = () => (
    <div className={`arena-v2-shell ${styles.arenaV2Scope}`}>
      <section className="arena-v2-topbar">
        <div className="min-w-0">
          <p className="arena-v2-kicker">CHIKAPO ARENA V2</p>
          <h2>2x3 보드 기반 실시간 카드 배틀</h2>
          <p>{season ? `${season.name} · ${season.status}` : '활성 시즌 대기 중'} · 덱 14~20장 · 턴 제한 40초</p>
        </div>
        <div className="arena-v2-top-actions">
          <button type="button" onClick={loadArenaV2} className="arena-v2-icon-button" aria-label="아레나 데이터 새로고침">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button type="button" onClick={startBotMatch} className="arena-v2-primary-button">
            <Bot className="h-4 w-4" /> 봇전 시작
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
              <strong>BOT NORMAL</strong>
            </div>
            <div className="arena-v2-resource"><Gauge className="h-4 w-4" /> 6 / 9</div>
          </div>
          <div className="arena-v2-board" aria-label="상대 2행 3열 보드">
            {boardCards.slice(0, 3).map((card, index) => <BoardSlot key={`op-${card.id}`} card={card} lane="전열" index={index} side="opponent" />)}
            {boardCards.slice(3, 6).map((card, index) => <BoardSlot key={`op-b-${card.id}`} card={index === 1 ? undefined : card} lane="후열" index={index} side="opponent" />)}
          </div>
          <div className="arena-v2-lane-divider"><span>전투 해결은 서버 순서대로 처리됩니다</span></div>
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
              <option value="">유효한 덱 없음</option>
              {decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name} · {formatMode(deck.modeScope)}</option>)}
            </select>
            <p>{selectedDeck ? `${selectedDeck.cardVersionIds.length}장 · ${selectedDeck.isValid ? '검증 통과' : '검증 실패'}` : '덱을 저장하면 바로 선택할 수 있습니다.'}</p>
          </div>
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">현재 행동</span>
            <div className="arena-v2-action-order">
              {phases.map((phase) => <span key={phase.id}>{phase.label}</span>)}
            </div>
            <p>클라이언트는 의도만 보내고, 검증과 처리 순서는 서버가 확정합니다.</p>
          </div>
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">대전 큐</span>
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
            <p className="arena-v2-kicker">CARD POOL</p>
            <h3>공식 덱 구성</h3>
            <span>동일 카드 버전과 동일 스트리머 중복은 서버 검증에서 제외됩니다.</span>
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
    typeof issue === 'string' ? issue : issue.message || issue.code || '검증 이슈';

  const renderInventory = () => (
    <section className={`arena-v2-shell ${styles.arenaV2Scope}`}>
      <section className="arena-v2-topbar">
        <div>
          <p className="arena-v2-kicker">DECK INVENTORY</p>
          <h2>덱과 카드 보관함</h2>
          <p>{season ? `${season.name} · ${season.status}` : '활성 시즌 없음'} · 저장 덱 {decks.length}개 · 카드 풀 {realCards.length}장</p>
        </div>
        <button type="button" onClick={loadArenaV2} className="arena-v2-secondary-button">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 새로고침
        </button>
      </section>
      <section className="arena-v2-stage">
        <aside className="arena-v2-command-panel">
          <StatTile icon={Layers3} label="저장 덱" value={`${decks.length}`} tone="cyan" />
          <StatTile icon={Check} label="유효 덱" value={`${decks.filter((deck) => deck.isValid).length}`} tone="green" />
          <StatTile icon={AlertTriangle} label="검증 실패" value={`${decks.filter((deck) => !deck.isValid).length}`} tone="gold" />
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
                  <span>{deck.isValid ? '검증 통과' : '검증 실패'}</span>
                  <button type="button" onClick={() => revalidateDeck(deck.id)}>재검증</button>
                  <button type="button" onClick={() => deleteDeck(deck.id)}>삭제</button>
                </div>
              )) : <p>저장된 v2 덱이 없습니다. 플레이 탭에서 실제 카드 14~20장을 선택해 저장합니다.</p>}
            </div>
          </div>
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">검증 메시지</span>
            <div className="arena-v2-replay-list">
              {decks.flatMap((deck) => (deck.validationResult?.errors || []).map((issue, index) => (
                <span key={`${deck.id}-error-${index}`}><AlertTriangle className="h-3.5 w-3.5" />{deck.name} · {issueText(issue)}</span>
              ))).slice(0, 12)}
              {!decks.some((deck) => (deck.validationResult?.errors || []).length) ? <p>표시할 검증 오류가 없습니다.</p> : null}
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
          <h2>MMR 랭킹과 내 보상</h2>
          <p>{season ? `${season.name} · ${season.status}` : '활성 시즌 없음'} · 빠른대전 결과 기준</p>
        </div>
        <button type="button" onClick={loadArenaV2} className="arena-v2-secondary-button">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 새로고침
        </button>
      </section>
      <section className="arena-v2-stage">
        <aside className="arena-v2-command-panel">
          <StatTile icon={Trophy} label="랭킹 인원" value={`${rankings.length}`} tone="gold" />
          <StatTile icon={Gauge} label="내 MMR" value={`${rewardState?.rating?.mmr ?? 1000}`} tone="cyan" />
          <StatTile icon={Crown} label="최고 등급" value={`${rewardState?.rating?.peakTier ?? 'bronze'}`} tone="green" />
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">보상 상태</span>
            <p>{rewardState?.grant ? `${rewardState.grant.status}${rewardState.grant.holdReason ? ` · ${rewardState.grant.holdReason}` : ''}` : '아직 생성된 보상 grant가 없습니다.'}</p>
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
                  <span>{item.mmr} MMR</span>
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
          <p className="arena-v2-kicker">WIKI · REPORTS · RIGHTS</p>
          <h2>위키, 신고, 스트리머 권리 요청</h2>
          <p>전투 판독성과 운영 증거 보존을 우선하는 v2 운영 흐름입니다.</p>
        </div>
        <button type="button" onClick={loadArenaV2} className="arena-v2-secondary-button">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 새로고침
        </button>
      </section>
      <section className="arena-v2-stage">
        <aside className="arena-v2-command-panel">
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">신고 접수</span>
            <select value={reportForm.targetType} onChange={(event) => setReportForm((current) => ({ ...current, targetType: event.target.value }))} className="arena-v2-select">
              <option value="card">카드</option>
              <option value="match">매치</option>
              <option value="replay">리플레이</option>
              <option value="user">유저</option>
              <option value="battle_royale">8인전</option>
            </select>
            <input value={reportForm.targetId} onChange={(event) => setReportForm((current) => ({ ...current, targetId: event.target.value }))} className="arena-v2-select" placeholder="대상 ID" />
            <input value={reportForm.reason} onChange={(event) => setReportForm((current) => ({ ...current, reason: event.target.value }))} className="arena-v2-select" placeholder="신고 사유" />
            <button type="button" onClick={submitReport} className="arena-v2-primary-button">신고 제출</button>
          </div>
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">권리 요청</span>
            <input value={rightForm.streamerId} onChange={(event) => setRightForm((current) => ({ ...current, streamerId: event.target.value }))} className="arena-v2-select" placeholder="스트리머 ID" />
            <select value={rightForm.requestType} onChange={(event) => setRightForm((current) => ({ ...current, requestType: event.target.value }))} className="arena-v2-select">
              <option value="text_change">문구 변경</option>
              <option value="image_change">이미지 변경</option>
              <option value="card_config">카드 설정</option>
              <option value="disable_version">버전 비활성</option>
              <option value="opt_out">참여 제외</option>
            </select>
            <input value={rightForm.payloadText} onChange={(event) => setRightForm((current) => ({ ...current, payloadText: event.target.value }))} className="arena-v2-select" placeholder="요청 내용 또는 JSON" />
            <button type="button" onClick={submitRightRequest} className="arena-v2-primary-button">권리 요청</button>
          </div>
        </aside>
        <div className="arena-v2-board-wrap">
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">위키</span>
            <div className="arena-v2-replay-list">
              {wikiEntries.length ? wikiEntries.map((entry) => <span key={entry.slug}>{entry.category} · {entry.title}</span>) : <p>위키 항목이 없습니다.</p>}
            </div>
          </div>
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">내 신고/권리 요청</span>
            <div className="arena-v2-replay-list">
              {reports.map((report) => <span key={report.id}>신고 · {report.targetType}:{report.targetId} · {report.status}</span>)}
              {rightRequests.map((request) => <span key={request.id}>권리 · {request.streamerId} · {request.requestType} · {request.status}</span>)}
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
          <p className="arena-v2-kicker">ADMIN OPS</p>
          <h2>시즌 운영과 정산</h2>
          <p>{season ? `${season.name} · ${season.status}` : '생성된 활성 시즌 없음'}</p>
        </div>
        <button type="button" onClick={loadArenaV2} className="arena-v2-secondary-button">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 새로고침
        </button>
      </section>
      <section className="arena-v2-stage">
        <aside className="arena-v2-command-panel">
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">시즌 생성</span>
            <input className="arena-v2-select" placeholder="seasonKey" value={adminSeasonForm.seasonKey} onChange={(event) => setAdminSeasonForm((current) => ({ ...current, seasonKey: event.target.value }))} />
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
                <button key={status} type="button" onClick={() => transitionSeason(status)} disabled={!season?.id}>{status}</button>
              ))}
            </div>
          </div>
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">보상 정산</span>
            <div className="arena-v2-queue-actions">
              <button type="button" onClick={() => grantRewards(true)} disabled={!season?.id}>미리보기</button>
              <button type="button" onClick={() => grantRewards(false)} disabled={!season?.id}>Grant 생성</button>
            </div>
            <p>보상 지급은 arena_v2_reward_grants에 멱등 key로 생성되며 실제 지급기는 pending grant를 소비합니다.</p>
          </div>
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">큐 상태</span>
            <div className="arena-v2-replay-list">
              <span>빠른대전 · {queueStatus.quick?.status || 'none'} {queueStatus.quick?.matchId ? `· ${queueStatus.quick.matchId}` : ''}</span>
              <span>8인전 · {queueStatus.battleRoyale?.status || 'none'} {queueStatus.battleRoyale?.participantCount != null ? `· ${queueStatus.battleRoyale.participantCount}/8` : ''}</span>
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
