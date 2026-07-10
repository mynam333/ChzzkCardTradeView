'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  ArrowDownAZ,
  BookOpen,
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
  Search,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Swords,
  Target,
  Trophy,
  Users,
  X,
  Zap
} from 'lucide-react';
import { API_BASE_URL, apiFetch } from '@/lib/api';
import {
  arenaCosmeticTypeDescriptions,
  arenaCosmeticTypeLabels,
  arenaCosmeticTypes,
  arenaLoadoutCosmeticTypes,
  getArenaCosmeticRarity,
  getArenaCosmeticStyleVars,
  isArenaCosmeticType,
  parseArenaCosmeticStyle,
  type ArenaCosmeticType,
  type ArenaLoadoutCosmeticType
} from '@/lib/arenaCosmetics';
import { useApp } from '../AppContext';
import { ArenaEmotePieMenu } from './ArenaEmotePieMenu';
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

type InventorySelectionFilter = 'all' | 'selected' | 'unselected';
type InventorySortKey = 'name_asc' | 'class_asc' | 'cost_asc' | 'cost_desc' | 'attack_desc' | 'health_desc' | 'selected_first';
type ArenaAdminSubTab = 'overview' | 'season' | 'rewards' | 'matches' | 'safety' | 'cosmetics' | 'diagnostics';

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

type ArenaCosmeticItem = {
  id: number;
  type: ArenaCosmeticType;
  name: string;
  description: string | null;
  price: number;
  style_json: string | null;
  purchase_limit: number;
  sale_start_at?: string | null;
  sale_end_at?: string | null;
  limited_total_quantity?: number;
  sold_quantity?: number;
  active?: boolean;
};

type ArenaCosmeticLoadout = {
  emoteSlots: Array<ArenaCosmeticItem | null>;
  equipped: Record<ArenaLoadoutCosmeticType, ArenaCosmeticItem | null>;
};

type ArenaAdminCosmeticForm = {
  id: number;
  type: ArenaCosmeticType;
  name: string;
  description: string;
  price: number;
  style_json: string;
  active: boolean;
  purchase_limit: number;
  sale_start_at: string;
  sale_end_at: string;
  limited_total_quantity: number;
  sold_quantity: number;
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
const arenaCardPageSize = 100;

const phases = [
  { id: 'move', label: '이동', icon: Move, hint: '시작 카드 1회' },
  { id: 'place', label: '배치', icon: Plus, hint: '빈 칸에 소환' },
  { id: 'replace', label: '교체', icon: Hand, hint: '새 카드만 가능' },
  { id: 'end', label: '종료', icon: Check, hint: '선택 확정' }
];

const arenaAdminTabs: Array<{ id: ArenaAdminSubTab; label: string; description: string; icon: typeof Activity }> = [
  { id: 'overview', label: '개요', description: '현재 시즌과 핵심 상태', icon: Activity },
  { id: 'season', label: '시즌', description: '생성 및 상태 전환', icon: Gauge },
  { id: 'rewards', label: '정산', description: '보상 확인과 지급 보류', icon: Trophy },
  { id: 'matches', label: '대전', description: '큐와 리플레이 보류', icon: Swords },
  { id: 'safety', label: '안전', description: '운영 플래그 기록', icon: Shield },
  { id: 'cosmetics', label: '치장', description: '상점 등록과 판매 상태', icon: Sparkles },
  { id: 'diagnostics', label: '진단', description: '시스템 응답과 데이터 점검', icon: BookOpen }
];

const arenaAdminOpsFlags = [
  { flag: 'quick_match_enabled', label: '빠른대전' },
  { flag: 'battle_royale_8_enabled', label: '8인전' },
  { flag: 'bot_match_enabled', label: '연습전' },
  { flag: 'reward_grant_enabled', label: '보상 지급' },
  { flag: 'streamer_card_edit_enabled', label: '스트리머 카드 편집' },
  { flag: 'arena_cosmetics_enabled', label: '치장 상점' },
  { flag: 'arena_emotes_enabled', label: '인게임 이모트' }
];

const emptyArenaAdminCosmeticForm: ArenaAdminCosmeticForm = {
  id: 0,
  type: 'emote',
  name: '',
  description: '',
  price: 1000,
  style_json: '{"schema_version":1,"emoji":"✨","rarity":"common"}',
  active: true,
  purchase_limit: 0,
  sale_start_at: '',
  sale_end_at: '',
  limited_total_quantity: 0,
  sold_quantity: 0
};

const emptyArenaEquippedCosmetics = (): Record<ArenaLoadoutCosmeticType, ArenaCosmeticItem | null> => ({
  card_frame: null,
  name_flare: null,
  hit_vfx: null,
  summon_vfx: null,
  ready_stamp: null,
  nameplate: null,
  ko_text: null
});

const emptyArenaCosmeticLoadout = (): ArenaCosmeticLoadout => ({
  emoteSlots: Array.from({ length: 8 }, () => null),
  equipped: emptyArenaEquippedCosmetics()
});

const wikiCoreRules = [
  { label: '기본 체력', value: '30', detail: '봇전, 빠른대전, 8인전 모두 30 체력에서 시작합니다.' },
  { label: '덱 크기', value: '14~20장', detail: '덱이 작을수록 원하는 카드를 빨리 뽑지만, 피로 피해 위험이 커집니다.' },
  { label: '필드', value: '2 x 3', detail: '전열 3칸과 후열 3칸, 총 6칸을 사용합니다.' },
  { label: '턴 제한', value: '40초', detail: '양쪽이 모두 완료하면 제한 시간을 기다리지 않고 바로 전투로 넘어갑니다.' },
  { label: '코스트', value: '1~9', detail: '1턴 1코스트에서 시작해 매 턴 1씩 늘고, 9 이후에는 9로 고정됩니다.' },
  { label: '승리 조건', value: '체력 0 또는 9턴 판정', detail: '상대 체력을 0 이하로 만들거나 9턴 종료 후 체력이 더 높으면 승리합니다. 동률은 서든데스로 이어집니다.' }
];

const wikiFlowSections = [
  {
    title: '대전 시작과 멀리건',
    icon: Hand,
    points: [
      '대전 시작 시 각 플레이어는 덱에서 5장을 뽑습니다.',
      '시작 손패 중 최대 3장을 한 번만 교체할 수 있습니다.',
      '멀리건으로 고른 카드는 덱으로 돌아가고, 덱을 섞은 뒤 같은 수만큼 다시 뽑습니다.',
      '1턴 시작에는 추가 드로우가 없고, 2턴부터 매 턴 시작 시 1장씩 뽑습니다.'
    ]
  },
  {
    title: '배치 단계',
    icon: Plus,
    points: [
      '손패 카드는 내 필드의 빈 칸에 놓을 수 있고, 카드 코스트만큼 비용을 씁니다.',
      '한 턴에 여러 장을 배치할 수 있지만, 제출 전 최종 행동만 실제로 처리됩니다.',
      '상대 필드에는 직접 배치할 수 없습니다.',
      '이미 카드가 있는 칸에는 일반 배치가 아니라 교체 행동으로만 새 카드를 놓을 수 있습니다.'
    ]
  },
  {
    title: '전술 이동',
    icon: Move,
    points: [
      '전술 이동은 이전 턴부터 필드에 있던 내 카드 1장을 빈 칸으로 옮기는 행동입니다.',
      '기본 비용은 1코스트이며, 턴당 1회만 사용할 수 있습니다.',
      '이번 턴 새로 배치한 카드는 같은 턴에 전술 이동할 수 없습니다.',
      '8인전에서 패배한 플레이어는 다음 라운드 첫 전술 이동 비용이 0이 됩니다.'
    ]
  },
  {
    title: '교체',
    icon: RefreshCw,
    points: [
      '교체는 기존 필드 카드가 있는 칸에 손패의 새 카드를 놓는 행동입니다.',
      '비용은 새 카드의 코스트만큼 사용합니다.',
      '기존 카드는 묘지로 이동하며, 교체로 묘지에 간 카드는 전투불능 효과를 발동하지 않습니다.',
      '교체는 필드를 다시 짜기 위한 손실 행동이므로, 핵심 카드를 버리게 되는지 확인해야 합니다.'
    ]
  },
  {
    title: '전투 판정',
    icon: Swords,
    points: [
      '배치가 끝나면 양쪽 최종 행동이 동시에 적용되고 필드가 공개됩니다.',
      '카드는 기본적으로 같은 라인만 공격합니다.',
      '기본 타겟 우선순위는 상대 전열 카드, 상대 후열 카드, 상대 플레이어 순서입니다.',
      '전열 카드들이 먼저 동시에 공격하고, 피해와 전투불능 처리가 끝난 뒤 후열 카드들이 공격합니다.'
    ]
  },
  {
    title: '피해와 묘지',
    icon: HeartPulse,
    points: [
      '카드가 받은 체력 피해는 필드에 남아 있는 동안 계속 유지됩니다.',
      '전열 카드가 기본 공격으로 쓰러지고 피해가 남으면, 같은 라인의 후열 카드에게 남은 피해의 절반이 전달됩니다.',
      '관통이 있으면 후열에 전달되는 초과 피해가 절반이 아니라 전부 적용됩니다.',
      '덱이 빈 상태에서 드로우를 시도하면 피로 피해를 받습니다.'
    ]
  }
];

const wikiKeywordGroups = [
  {
    title: '방어와 생존',
    items: [
      ['도발', '같은 라인에서 상대 공격을 끌어오는 핵심 방어 키워드입니다.'],
      ['보호막', '전투 중 피해를 대신 흡수하고, 전투가 끝나면 사라집니다.'],
      ['반격', '같은 라인에서 공격받았을 때 공격자에게 피해를 되돌립니다.'],
      ['흡혈', '실제 체력 피해를 줬을 때 회복으로 이어지는 생존 키워드입니다.'],
      ['부활', '전투마다 1회만 허용되는 고위험 생존 효과입니다.']
    ]
  },
  {
    title: '공격과 돌파',
    items: [
      ['관통', '전열을 쓰러뜨린 뒤 남은 피해를 같은 라인 후열까지 온전히 전달합니다.'],
      ['추격', '상대 카드를 전투불능으로 만든 뒤 추가 압박을 이어갑니다.'],
      ['직접 압박', '상대 플레이어를 직접 공격할 때 피해를 높입니다.'],
      ['후열 압박', '후열 카드를 때릴 때 피해가 증가합니다.'],
      ['광역 피해', '한 공격 단계에서 여러 대상에게 영향을 주는 강한 공격 효과입니다.']
    ]
  },
  {
    title: '제어와 방해',
    items: [
      ['조준', '같은 라인에서 후열을 우선 노리는 공격 규칙입니다.'],
      ['침묵', '이번 전투 동안 상대 카드의 주요 효과를 막습니다.'],
      ['기절', '이번 공격 단계의 행동을 끊는 강한 제어 효과입니다.'],
      ['밀치기', '같은 라인 전열 카드를 후열로 밀어 위치를 흔듭니다.'],
      ['끌어오기', '같은 라인 후열 카드를 전열로 끌어내 압박합니다.'],
      ['약화', '이번 전투 동안 대상의 위력을 낮춥니다.']
    ]
  },
  {
    title: '지원과 자원',
    items: [
      ['전투 드로우', '전투 중 카드를 뽑습니다. 손패 8장 제한은 그대로 적용됩니다.'],
      ['응급 회복', '필드 카드의 누적 피해를 일부 회복합니다.'],
      ['보호 지원', '같은 라인 아군에게 보호막을 제공합니다.'],
      ['공격 지원', '같은 라인 아군의 첫 피해를 높입니다.'],
      ['묘지 회수', '묘지의 카드를 손패로 되돌립니다. 되돌아온 카드는 최대 체력 상태입니다.']
    ]
  },
  {
    title: '망령과 사망',
    items: [
      ['복수', '아군 손실 이후 반격 흐름을 만드는 키워드입니다.'],
      ['원혼', '묘지와 전투불능 상황을 이용해 후반 압박을 만듭니다.'],
      ['잔영', '카드가 사라진 뒤에도 일부 영향이 남는 계열입니다.'],
      ['묘지 강화', '묘지 카드 수 조건으로 위력이 커지는 효과입니다.']
    ]
  }
];

const wikiModeSections = [
  ['봇전', '알고리즘 기반 봇과 겨루는 연습 모드입니다. 기본 규칙은 빠른대전과 같고 MMR에는 반영되지 않습니다.'],
  ['빠른대전', '1:1 온라인 대전입니다. MMR 기반으로 매칭되며 시즌 랭킹과 보상 기준이 됩니다.'],
  ['8인전', '8명이 참가해 라운드마다 1:1 전투를 반복합니다. 체력이 0 이하가 되면 탈락하고 마지막 생존자가 승리합니다.']
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

const toArenaDateTimeInput = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (next: number) => String(next).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const arenaDateTimeInputToIso = (value: string) => value ? new Date(value).toISOString() : null;

const minifyArenaCss = (css: string) => css
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')
  .replace(/\s*([{}:;,])\s*/g, '$1')
  .trim();

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

const arenaKeywordLabels: Record<string, string> = {
  rush: '돌진',
  taunt: '도발',
  direct_pressure: '직격 압박',
  heal: '회복',
  draw: '드로우',
  deathrattle: '유언',
  silence: '침묵',
  aim: '조준',
  shield: '보호막',
  guard: '수호',
  stun: '기절',
  weaken: '약화',
  push: '밀치기',
  pull: '끌어오기',
  poison: '중독',
  burn: '화상',
  freeze: '빙결',
  stealth: '은신',
  lifesteal: '흡혈',
  pierce: '관통',
  splash: '광역',
  cleave: '연격',
  counter: '반격',
  charge: '돌격',
  support: '지원',
  boost: '강화',
  debuff: '약화',
  buff: '버프',
  summon: '소환',
  revive: '부활',
  vengeance: '복수',
  grudge: '원혼',
  remnant: '잔영',
  grave_recover: '묘지 회수',
  battle_draw: '전투 드로우',
  emergency_heal: '응급 회복',
  guard_support: '보호 지원',
  attack_support: '공격 지원',
  backline_pressure: '후열 압박',
  pursuit: '추격',
  weakpoint: '약점 공격',
  aoe_damage: '광역 피해',
  discard: '폐기',
  copy: '복제',
  discover: '발견'
};

const arenaKeywordTokenLabels: Record<string, string> = {
  direct: '직격',
  pressure: '압박',
  death: '사망',
  rattle: '유언',
  final: '최후',
  strike: '타격',
  double: '이중',
  draw: '드로우',
  heal: '회복',
  power: '전력',
  attack: '공격',
  health: '체력',
  random: '무작위',
  enemy: '적',
  ally: '아군',
  card: '카드',
  hand: '손패',
  deck: '덱',
  lane: '라인'
};

const formatArenaKeyword = (keyword?: string) => {
  const raw = String(keyword || '').trim();
  if (!raw) return '';
  const normalized = raw.toLowerCase();
  if (arenaKeywordLabels[normalized]) return arenaKeywordLabels[normalized];
  return raw
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((token) => arenaKeywordTokenLabels[token.toLowerCase()] || token)
    .join(' ');
};

const getBackendAssetOrigin = () => {
  try {
    if (/^https?:\/\//i.test(API_BASE_URL)) return new URL(API_BASE_URL).origin;
    if (typeof window !== 'undefined') return new URL(API_BASE_URL, window.location.origin).origin;
  } catch {
    return '';
  }
  return '';
};

const resolveBackendImageUrl = (value?: string | null) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw) && raw.includes('/uploads/')) {
    const backendOrigin = getBackendAssetOrigin();
    if (!backendOrigin) return raw;
    try {
      const parsed = new URL(raw);
      const uploadsIndex = parsed.pathname.indexOf('/uploads/');
      return uploadsIndex >= 0 ? `${backendOrigin}${parsed.pathname.slice(uploadsIndex)}${parsed.search}` : raw;
    } catch {
      return raw;
    }
  }
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/uploads/') || raw.startsWith('uploads/')) {
    const backendOrigin = getBackendAssetOrigin();
    const cleanPath = raw.startsWith('/') ? raw : `/${raw}`;
    return backendOrigin ? `${backendOrigin}${cleanPath}` : cleanPath;
  }
  if (raw.startsWith('/')) return raw;
  return '';
};

const isImageSource = (value?: string | null) => Boolean(resolveBackendImageUrl(value));
const getArenaEmoteVisual = (item?: { style_json?: string | null; name?: string | null } | null) => {
  const style = parseArenaCosmeticStyle(item?.style_json);
  const imageUrl = resolveBackendImageUrl(typeof style.image_url === 'string' ? style.image_url : '');
  const emoji = typeof style.emoji === 'string' && style.emoji.trim() ? style.emoji.trim() : '';
  return { imageUrl, emoji: emoji || '✦' };
};
const cardTooltip = (card: ArenaV2Card, classLabel: string) => {
  const keywordText = card.keywords.length ? card.keywords.map(formatArenaKeyword).filter(Boolean).join(', ') : '특수 효과 없음';
  return `${card.displayName}\n클래스: ${classLabel}\n효과: ${keywordText}\n공격력: ${card.attack}\n체력: ${card.health}`;
};

const hydrateStreamerCardForm = (card: ArenaV2Card | null) => ({
  displayName: card?.displayName || '',
  cardClass: legalCardClasses.includes(card?.cardClass || '') ? card?.cardClass || 'charge' : 'charge',
  cost: String(card?.cost ?? 2),
  attack: String(card?.attack ?? 1),
  health: String(card?.health ?? 4),
  keywordsText: card?.keywords?.join(', ') || ''
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
  const imageUrl = resolveBackendImageUrl(card.artAssetId);
  if (imageUrl) {
    return <img src={imageUrl} alt={card.displayName} className="h-full w-full object-cover" loading="lazy" />;
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
  const keywords = card.keywords.map(formatArenaKeyword).filter(Boolean).slice(0, compact ? 1 : 3);
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
          {keywords.length ? keywords.map((keyword, index) => <span key={`${keyword}-${index}`} title={`효과 키워드: ${keyword}`}>{keyword}</span>) : <span title="특수 효과 없음">기본</span>}
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

const ArenaEmoteBadge: React.FC<{ item?: ArenaCosmeticItem | null; emptyLabel?: string }> = ({ item, emptyLabel = '비어 있음' }) => {
  if (!item) {
    return <span className="arena-v2-emote-empty">{emptyLabel}</span>;
  }
  const visual = getArenaEmoteVisual(item);
  return (
    <span className="arena-v2-emote-badge" title={item.name}>
      {visual.imageUrl ? <img src={visual.imageUrl} alt={item.name} /> : <b>{visual.emoji}</b>}
    </span>
  );
};

const ArenaCosmeticPreview: React.FC<{ item: ArenaCosmeticItem; compact?: boolean }> = ({ item, compact = false }) => {
  const style = parseArenaCosmeticStyle(item.style_json);
  const visual = getArenaEmoteVisual(item);
  const label = typeof style.label === 'string' && style.label.trim() ? style.label.trim() : item.name;
  return (
  <div
    className={`arena-v2-cosmetic-preview is-${item.type} ${compact ? 'is-compact' : ''}`}
    style={getArenaCosmeticStyleVars(item) as React.CSSProperties}
  >
    {item.type === 'emote' ? (
      <span className="arena-v2-emote-badge is-preview">
        {visual.imageUrl ? <img src={visual.imageUrl} alt={item.name} /> : <b>{visual.emoji}</b>}
      </span>
    ) : item.type === 'card_frame' ? (
      <div className="arena-v2-cosmetic-card-demo">
        <span className="demo-cost">5</span>
        <span className="demo-name">ARENA</span>
        <span className="demo-art" />
        <span className="demo-atk">4</span>
        <span className="demo-hp">8</span>
      </div>
    ) : item.type === 'name_flare' ? (
      <strong className="arena-v2-cosmetic-name-demo">{label}</strong>
    ) : item.type === 'hit_vfx' ? (
      <div className="arena-v2-cosmetic-hit-demo"><span /><i /><b>42</b></div>
    ) : item.type === 'summon_vfx' ? (
      <div className="arena-v2-cosmetic-summon-demo"><span /><i /></div>
    ) : item.type === 'ready_stamp' ? (
      <div className="arena-v2-cosmetic-ready-demo"><span>{label}</span></div>
    ) : item.type === 'nameplate' ? (
      <div className="arena-v2-cosmetic-nameplate-demo"><span>{label}</span><b>MMR 1320</b></div>
    ) : (
      <div className="arena-v2-cosmetic-ko-demo"><span>{label}</span></div>
    )}
  </div>
  );
};

export const ArenaV2Experience: React.FC<{ activeTab: ArenaSiteTab }> = ({ activeTab }) => {
  const router = useRouter();
  const { user, toast } = useApp();
  const [season, setSeason] = React.useState<ArenaV2Season | null>(null);
  const [cards, setCards] = React.useState<ArenaV2Card[]>([]);
  const [cardPage, setCardPage] = React.useState({ nextOffset: 0, hasMore: false });
  const [loadingMoreCards, setLoadingMoreCards] = React.useState(false);
  const [decks, setDecks] = React.useState<ArenaV2Deck[]>([]);
  const [selectedCardIds, setSelectedCardIds] = React.useState<string[]>([]);
  const [selectedDeckId, setSelectedDeckId] = React.useState<string>('');
  const [inventorySearch, setInventorySearch] = React.useState('');
  const [inventoryClassFilter, setInventoryClassFilter] = React.useState('all');
  const [inventoryKeywordFilter, setInventoryKeywordFilter] = React.useState('all');
  const [inventorySelectionFilter, setInventorySelectionFilter] = React.useState<InventorySelectionFilter>('all');
  const [inventorySort, setInventorySort] = React.useState<InventorySortKey>('name_asc');
  const [wikiQuery, setWikiQuery] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [notice, setNotice] = React.useState<string>('');
  const [rankings, setRankings] = React.useState<ArenaV2RankingItem[]>([]);
  const [rewardState, setRewardState] = React.useState<any>(null);
  const [myStreamerCard, setMyStreamerCard] = React.useState<ArenaV2MyStreamerCard | null>(null);
  const [queueStatus, setQueueStatus] = React.useState<{ quick?: any; battleRoyale?: any }>({});
  const [arenaCosmetics, setArenaCosmetics] = React.useState<ArenaCosmeticItem[]>([]);
  const [arenaAdminCosmeticItems, setArenaAdminCosmeticItems] = React.useState<ArenaCosmeticItem[]>([]);
  const [arenaCosmeticCounts, setArenaCosmeticCounts] = React.useState<Record<number, number>>({});
  const [arenaCosmeticPurchases, setArenaCosmeticPurchases] = React.useState<Record<number, number>>({});
  const [arenaCosmeticLoadout, setArenaCosmeticLoadout] = React.useState<ArenaCosmeticLoadout>(emptyArenaCosmeticLoadout);
  const [arenaEmoteSlotDraft, setArenaEmoteSlotDraft] = React.useState<Array<ArenaCosmeticItem | null>>(() => Array.from({ length: 8 }, () => null));
  const [selectedArenaEmoteSlot, setSelectedArenaEmoteSlot] = React.useState(0);
  const [arenaCosmeticCategory, setArenaCosmeticCategory] = React.useState<'all' | ArenaCosmeticType>('all');
  const [savingArenaCosmetic, setSavingArenaCosmetic] = React.useState(false);
  const [adminCosmeticUploading, setAdminCosmeticUploading] = React.useState(false);
  const [adminCosmeticForm, setAdminCosmeticForm] = React.useState<ArenaAdminCosmeticForm>({ ...emptyArenaAdminCosmeticForm });
  const [streamerCardForm, setStreamerCardForm] = React.useState(hydrateStreamerCardForm(null));
  const [adminSubTab, setAdminSubTab] = React.useState<ArenaAdminSubTab>('overview');
  const [arenaAdminStatus, setArenaAdminStatus] = React.useState<any | null>(null);
  const [adminRewardPreview, setAdminRewardPreview] = React.useState<any | null>(null);
  const [adminRewardGrantId, setAdminRewardGrantId] = React.useState('');
  const [adminRewardHoldReason, setAdminRewardHoldReason] = React.useState('');
  const [adminReplayMatchId, setAdminReplayMatchId] = React.useState('');
  const [adminReplayHoldReason, setAdminReplayHoldReason] = React.useState('');
  const [adminReplayHoldUntil, setAdminReplayHoldUntil] = React.useState('');
  const [adminOpsReason, setAdminOpsReason] = React.useState('');
  const [adminActionLoading, setAdminActionLoading] = React.useState('');
  const [adminSeasonForm, setAdminSeasonForm] = React.useState({
    seasonKey: '',
    name: '',
    startsAt: '',
    endsAt: '',
    cardPoolVersion: 'cards-v1',
    balanceVersion: 'balance-v1'
  });

  const boardCards = cards.slice(0, 6);
  const deckCount = selectedCardIds.length;
  const deckReady = deckCount >= 14 && deckCount <= 20;
  const selectedDeck = decks.find((deck) => deck.id === selectedDeckId);
  const cardLoadSentinelRef = React.useRef<HTMLDivElement | null>(null);
  const deferredInventorySearch = React.useDeferredValue(inventorySearch);
  const selectedCardIdSet = React.useMemo(() => new Set(selectedCardIds), [selectedCardIds]);
  const availableInventoryClasses = React.useMemo(() => {
    const classSet = new Set([...legalCardClasses, ...cards.map((card) => card.cardClass).filter(Boolean)]);
    return Array.from(classSet).sort((a, b) => {
      const aIndex = legalCardClasses.indexOf(a);
      const bIndex = legalCardClasses.indexOf(b);
      if (aIndex >= 0 || bIndex >= 0) return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
      return (classTone[a]?.label || a).localeCompare(classTone[b]?.label || b, 'ko-KR');
    });
  }, [cards]);
  const availableInventoryKeywords = React.useMemo(() => {
    const keywordMap = new Map<string, string>();
    for (const card of cards) {
      for (const keyword of card.keywords) {
        const raw = String(keyword || '').trim();
        if (!raw) continue;
        keywordMap.set(raw.toLowerCase(), formatArenaKeyword(raw));
      }
    }
    return Array.from(keywordMap.entries()).sort((a, b) => a[1].localeCompare(b[1], 'ko-KR'));
  }, [cards]);
  const filteredInventoryCards = React.useMemo(() => {
    const query = deferredInventorySearch.trim().toLowerCase();
    const nextCards = cards.filter((card) => {
      const tone = classTone[card.cardClass] || classTone.tempo;
      const keywordLabels = card.keywords.map(formatArenaKeyword).filter(Boolean);
      const selected = selectedCardIdSet.has(card.id);
      if (inventoryClassFilter !== 'all' && card.cardClass !== inventoryClassFilter) return false;
      if (inventoryKeywordFilter !== 'all' && !card.keywords.some((keyword) => String(keyword || '').trim().toLowerCase() === inventoryKeywordFilter)) return false;
      if (inventorySelectionFilter === 'selected' && !selected) return false;
      if (inventorySelectionFilter === 'unselected' && selected) return false;
      if (!query) return true;
      const searchText = [
        card.displayName,
        card.streamerId,
        tone.label,
        tone.hint,
        card.cardClass,
        card.cost,
        card.attack,
        card.health,
        ...card.keywords,
        ...keywordLabels
      ].join(' ').toLowerCase();
      return searchText.includes(query);
    });
    const compareName = (a: ArenaV2Card, b: ArenaV2Card) => a.displayName.localeCompare(b.displayName, 'ko-KR');
    return nextCards.sort((a, b) => {
      if (inventorySort === 'selected_first') {
        const selectedDelta = Number(selectedCardIdSet.has(b.id)) - Number(selectedCardIdSet.has(a.id));
        return selectedDelta || compareName(a, b);
      }
      if (inventorySort === 'class_asc') {
        const classDelta = (classTone[a.cardClass]?.label || a.cardClass).localeCompare(classTone[b.cardClass]?.label || b.cardClass, 'ko-KR');
        return classDelta || compareName(a, b);
      }
      if (inventorySort === 'cost_asc') return (a.cost - b.cost) || compareName(a, b);
      if (inventorySort === 'cost_desc') return (b.cost - a.cost) || compareName(a, b);
      if (inventorySort === 'attack_desc') return (b.attack - a.attack) || compareName(a, b);
      if (inventorySort === 'health_desc') return (b.health - a.health) || compareName(a, b);
      return compareName(a, b);
    });
  }, [cards, deferredInventorySearch, inventoryClassFilter, inventoryKeywordFilter, inventorySelectionFilter, inventorySort, selectedCardIdSet]);

  const buildArenaCardPath = React.useCallback((seasonId: string, offset = 0) => {
    const cardBasePath = user ? '/arena/cards/owned' : '/arena/cards';
    return `${cardBasePath}?seasonId=${encodeURIComponent(seasonId)}&limit=${arenaCardPageSize}&offset=${offset}`;
  }, [user]);

  const loadArenaCardsPage = React.useCallback(async (seasonId: string, offset = 0, mode: 'replace' | 'append' = 'replace') => {
    const cardJson = await fetchArenaJson(buildArenaCardPath(seasonId, offset));
    const normalized = Array.isArray(cardJson?.cards) ? cardJson.cards.map(normalizeCard).filter(Boolean) as ArenaV2Card[] : [];
    setCards((current) => {
      if (mode === 'replace') return normalized;
      const seen = new Set(current.map((card) => card.id));
      return [...current, ...normalized.filter((card) => !seen.has(card.id))];
    });
    setCardPage({
      nextOffset: Number(cardJson?.page?.nextOffset ?? offset + normalized.length),
      hasMore: Boolean(cardJson?.page?.hasMore)
    });
    return normalized;
  }, [buildArenaCardPath]);

  const loadArenaCosmetics = React.useCallback(async () => {
    if (!user) {
      setArenaCosmetics([]);
      setArenaCosmeticCounts({});
      setArenaCosmeticPurchases({});
      setArenaCosmeticLoadout(emptyArenaCosmeticLoadout());
      setArenaEmoteSlotDraft(Array.from({ length: 8 }, () => null));
      return;
    }
    const [itemsRes, countsRes, purchasesRes, loadoutRes] = await Promise.all([
      apiFetch('/arena/cosmetics/shop-items'),
      apiFetch('/arena/cosmetics/inventory-counts'),
      apiFetch('/arena/cosmetics/purchases'),
      apiFetch('/arena/cosmetics/loadout')
    ]);
    const itemsJson = itemsRes.ok ? await itemsRes.json().catch(() => ({})) : {};
    setArenaCosmetics(Array.isArray(itemsJson?.items) ? itemsJson.items : []);
    setArenaCosmeticCounts(countsRes.ok ? await countsRes.json().catch(() => ({})) : {});
    setArenaCosmeticPurchases(purchasesRes.ok ? await purchasesRes.json().catch(() => ({})) : {});
    const loadoutJson = loadoutRes.ok ? await loadoutRes.json().catch(() => ({})) : {};
    const nextLoadout: ArenaCosmeticLoadout = {
      emoteSlots: Array.from({ length: 8 }, (_, index) => loadoutJson?.emoteSlots?.[index] || null),
      equipped: Object.fromEntries(arenaLoadoutCosmeticTypes.map((type) => [type, loadoutJson?.equipped?.[type] || null])) as Record<ArenaLoadoutCosmeticType, ArenaCosmeticItem | null>
    };
    setArenaCosmeticLoadout(nextLoadout);
    setArenaEmoteSlotDraft(nextLoadout.emoteSlots);
  }, [user]);

  const loadArenaAdminCosmetics = React.useCallback(async () => {
    if (user?.role !== 'ADMIN') {
      setArenaAdminCosmeticItems([]);
      return;
    }
    const res = await apiFetch('/admin/shop/items');
    const json = res.ok ? await res.json().catch(() => []) : [];
    const items = Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : [];
    setArenaAdminCosmeticItems(items.filter((item: { type?: unknown }) => isArenaCosmeticType(item?.type)));
  }, [user?.role]);

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
        const normalized = await loadArenaCardsPage(nextSeason.id, 0, 'replace');
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
        const [rewardRes, quickRes, battleRoyaleRes, myCardRes] = await Promise.all([
          apiFetch(`/arena/rewards/current?seasonId=${encodeURIComponent(nextSeason.id)}`),
          apiFetch(`/arena/matchmaking/quick/status?seasonId=${encodeURIComponent(nextSeason.id)}`),
          apiFetch(`/arena/battle-royales/queue/status?seasonId=${encodeURIComponent(nextSeason.id)}`),
          apiFetch(`/arena/streamer-card/me?seasonId=${encodeURIComponent(nextSeason.id)}`)
        ]);
        setRewardState(rewardRes.ok ? await rewardRes.json().catch(() => null) : null);
        setQueueStatus({
          quick: quickRes.ok ? await quickRes.json().catch(() => null) : null,
          battleRoyale: battleRoyaleRes.ok ? await battleRoyaleRes.json().catch(() => null) : null
        });
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
        await loadArenaCosmetics().catch(() => undefined);
      } else {
        setDecks([]);
        setRewardState(null);
        setQueueStatus({});
        if (user) {
          const myCardRes = await apiFetch('/arena/streamer-card/me');
          if (myCardRes.ok) {
            const myCardJson = await myCardRes.json().catch(() => null);
            const card = normalizeCard(myCardJson?.card);
            const nextMyCard = {
              streamer: myCardJson?.streamer,
              card,
              canEdit: myCardJson?.canEdit === true
            };
            setMyStreamerCard(nextMyCard);
            setStreamerCardForm(hydrateStreamerCardForm(card));
          } else {
            setMyStreamerCard(null);
            setStreamerCardForm(hydrateStreamerCardForm(null));
          }
        } else {
          setMyStreamerCard(null);
          setStreamerCardForm(hydrateStreamerCardForm(null));
        }
        await loadArenaCosmetics().catch(() => undefined);
      }
      const rankingsPath = nextSeason?.id ? `/arena/rankings?seasonId=${encodeURIComponent(nextSeason.id)}&limit=100` : '/arena/rankings?limit=100';
      const rankingsRes = await apiFetch(rankingsPath);
      const rankingsJson = rankingsRes.ok ? await rankingsRes.json().catch(() => ({})) : {};
      setRankings(Array.isArray(rankingsJson?.items) ? rankingsJson.items : []);

      if (user?.role === 'ADMIN') {
        const adminStatusRes = await apiFetch('/admin/arena/system');
        const adminStatusJson = adminStatusRes.ok ? await adminStatusRes.json().catch(() => null) : null;
        setArenaAdminStatus(adminStatusJson?.data || adminStatusJson);
        await loadArenaAdminCosmetics().catch(() => undefined);
      } else {
        setArenaAdminStatus(null);
        setArenaAdminCosmeticItems([]);
      }
    } catch (err: any) {
      setCards([]);
      setNotice(err?.message || '카드 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }, [loadArenaAdminCosmetics, loadArenaCardsPage, loadArenaCosmetics, user]);

  React.useEffect(() => {
    void loadArenaV2();
  }, [loadArenaV2]);

  React.useEffect(() => {
    if (activeTab === 'my-card' && !loading && !myStreamerCard) {
      router.replace('/arena/play');
    }
  }, [activeTab, loading, myStreamerCard, router]);

  React.useEffect(() => {
    if (activeTab !== 'inventory' || !season?.id || !cardPage.hasMore || loadingMoreCards) return;
    const target = cardLoadSentinelRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setLoadingMoreCards(true);
      void loadArenaCardsPage(season.id, cardPage.nextOffset, 'append')
        .catch((err: any) => {
          setNotice(err?.message || '카드를 더 불러오지 못했습니다.');
        })
        .finally(() => setLoadingMoreCards(false));
    }, { rootMargin: '480px 0px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [activeTab, cardPage.hasMore, cardPage.nextOffset, loadArenaCardsPage, loadingMoreCards, season?.id]);

  const toggleCard = (card: ArenaV2Card) => {
    setSelectedCardIds((current) => {
      if (current.includes(card.id)) return current.filter((id) => id !== card.id);
      if (current.length >= 20) return current;
      return [...current, card.id];
    });
  };

  const resetInventoryFilters = () => {
    setInventorySearch('');
    setInventoryClassFilter('all');
    setInventoryKeywordFilter('all');
    setInventorySelectionFilter('all');
    setInventorySort('name_asc');
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
          keywords: parseKeywordEditorText(streamerCardForm.keywordsText)
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
      setAdminActionLoading(dryRun ? 'reward-dry-run' : 'reward-grant');
      const res = await apiFetch(`/admin/arena/seasons/${encodeURIComponent(season.id)}/grant-rewards`, {
        method: 'POST',
        body: JSON.stringify({ dryRun, reason: dryRun ? 'preview' : 'season-settlement' })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '보상 작업 실패');
      setAdminRewardPreview(json?.preview || json);
      toast(dryRun ? `보상 대상 ${json?.preview?.totalPlayers ?? 0}명 확인` : `보상 ${json?.granted ?? 0}건 준비 완료`, 'success');
    } catch (error: any) {
      toast(error?.message || '보상 작업 중 문제가 발생했습니다.', 'error');
    } finally {
      setAdminActionLoading('');
    }
  };

  const previewAdminRewards = async () => {
    if (!season?.id) return;
    try {
      setAdminActionLoading('reward-preview');
      const res = await apiFetch(`/admin/arena/seasons/${encodeURIComponent(season.id)}/reward-preview`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '보상 대상 확인 실패');
      setAdminRewardPreview(json?.preview || json);
      toast(`정산 대상 ${json?.totalPlayers ?? json?.preview?.totalPlayers ?? 0}명을 확인했습니다.`, 'success');
    } catch (error: any) {
      toast(error?.message || '보상 대상을 확인하지 못했습니다.', 'error');
    } finally {
      setAdminActionLoading('');
    }
  };

  const recordAdminOpsFlag = async (flag: string, enabled: boolean) => {
    try {
      setAdminActionLoading(`${flag}:${enabled ? 'on' : 'off'}`);
      const res = await apiFetch(`/admin/arena/system/flags/${encodeURIComponent(flag)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled, reason: adminOpsReason.trim() || 'arena-admin-panel' })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '운영 플래그 변경 실패');
      toast(`${flag} 상태를 ${enabled ? '활성' : '비활성'}으로 기록했습니다.`, 'success');
      setArenaAdminStatus((current: any) => ({
        ...(current || {}),
        lastOpsFlag: json
      }));
    } catch (error: any) {
      toast(error?.message || '운영 플래그 변경 중 문제가 발생했습니다.', 'error');
    } finally {
      setAdminActionLoading('');
    }
  };

  const holdAdminRewardGrant = async () => {
    const grantId = adminRewardGrantId.trim();
    if (!grantId) return;
    try {
      setAdminActionLoading('reward-hold');
      const res = await apiFetch(`/admin/arena/rewards/${encodeURIComponent(grantId)}/hold`, {
        method: 'POST',
        body: JSON.stringify({ reason: adminRewardHoldReason.trim() || 'admin-review' })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '보상 보류 실패');
      toast('보상 지급을 보류했습니다.', 'success');
    } catch (error: any) {
      toast(error?.message || '보상 보류 중 문제가 발생했습니다.', 'error');
    } finally {
      setAdminActionLoading('');
    }
  };

  const releaseAdminRewardGrant = async () => {
    const grantId = adminRewardGrantId.trim();
    if (!grantId) return;
    try {
      setAdminActionLoading('reward-release');
      const res = await apiFetch(`/admin/arena/rewards/${encodeURIComponent(grantId)}/release`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '보상 보류 해제 실패');
      toast('보상 보류를 해제했습니다.', 'success');
    } catch (error: any) {
      toast(error?.message || '보상 보류 해제 중 문제가 발생했습니다.', 'error');
    } finally {
      setAdminActionLoading('');
    }
  };

  const holdAdminReplay = async () => {
    const matchId = adminReplayMatchId.trim();
    if (!matchId) return;
    try {
      setAdminActionLoading('replay-hold');
      const body: Record<string, string> = { reason: adminReplayHoldReason.trim() || 'admin-review' };
      if (adminReplayHoldUntil) body.holdUntil = new Date(adminReplayHoldUntil).toISOString();
      const res = await apiFetch(`/admin/arena/matches/${encodeURIComponent(matchId)}/replay-hold`, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '리플레이 보류 실패');
      toast('리플레이 보류를 등록했습니다.', 'success');
    } catch (error: any) {
      toast(error?.message || '리플레이 보류 중 문제가 발생했습니다.', 'error');
    } finally {
      setAdminActionLoading('');
    }
  };

  const mergeAdminCosmeticStyleJson = (patch: Record<string, unknown>) => {
    const current = parseArenaCosmeticStyle(adminCosmeticForm.style_json);
    setAdminCosmeticForm((form) => ({
      ...form,
      style_json: JSON.stringify({ ...current, ...patch })
    }));
  };

  const uploadAdminArenaEmoteAsset = async (file: File | null | undefined) => {
    if (!file || adminCosmeticUploading) return;
    if (!file.type.startsWith('image/')) {
      toast('이미지 파일만 업로드할 수 있습니다.', 'error');
      return;
    }
    try {
      setAdminCosmeticUploading(true);
      const formData = new FormData();
      formData.append('image', file);
      const res = await apiFetch('/admin/arena/cosmetics/emote-assets', {
        method: 'POST',
        body: formData
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '이모트 이미지를 업로드하지 못했습니다.');
      const imageUrl = json?.data?.image_url;
      if (!imageUrl) throw new Error('업로드된 이미지 주소를 확인하지 못했습니다.');
      mergeAdminCosmeticStyleJson({ image_url: imageUrl });
      toast(json?.data?.animated ? '움짤 이모트 이미지를 업로드했습니다.' : '이모트 이미지를 업로드했습니다.', 'success');
    } catch (error: any) {
      toast(error?.message || '이모트 이미지를 업로드하지 못했습니다.', 'error');
    } finally {
      setAdminCosmeticUploading(false);
    }
  };

  const saveAdminArenaCosmetic = async () => {
    if (!adminCosmeticForm.name.trim()) {
      toast('치장 이름을 입력해 주세요.', 'error');
      return;
    }
    let processedStyleJson: string | null = adminCosmeticForm.style_json || null;
    if (adminCosmeticForm.style_json.trim()) {
      try {
        const parsed = JSON.parse(adminCosmeticForm.style_json);
        if (parsed.css && typeof parsed.css === 'string') parsed.css = minifyArenaCss(parsed.css);
        processedStyleJson = JSON.stringify(parsed);
      } catch {
        toast('스타일 JSON 형식이 올바르지 않습니다.', 'error');
        return;
      }
    }
    try {
      setAdminActionLoading('cosmetic-save');
      const payload = {
        type: adminCosmeticForm.type,
        name: adminCosmeticForm.name.trim(),
        description: adminCosmeticForm.description.trim() || null,
        price: Math.max(0, Number(adminCosmeticForm.price) || 0),
        style_json: processedStyleJson,
        font_url: null,
        font_family: null,
        active: adminCosmeticForm.active,
        purchase_limit: Math.max(0, Number(adminCosmeticForm.purchase_limit) || 0),
        sale_start_at: arenaDateTimeInputToIso(adminCosmeticForm.sale_start_at),
        sale_end_at: arenaDateTimeInputToIso(adminCosmeticForm.sale_end_at),
        limited_total_quantity: Math.max(0, Number(adminCosmeticForm.limited_total_quantity) || 0)
      };
      const url = adminCosmeticForm.id ? `/admin/shop/items/${adminCosmeticForm.id}` : '/admin/shop/items';
      const res = await apiFetch(url, { method: 'POST', body: JSON.stringify(payload) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '치장 상품을 저장하지 못했습니다.');
      toast(adminCosmeticForm.id ? '아레나 치장을 수정했습니다.' : '아레나 치장을 등록했습니다.', 'success');
      setAdminCosmeticForm({ ...emptyArenaAdminCosmeticForm });
      await Promise.all([
        loadArenaAdminCosmetics().catch(() => undefined),
        loadArenaCosmetics().catch(() => undefined)
      ]);
    } catch (error: any) {
      toast(error?.message || '치장 상품 저장 중 문제가 발생했습니다.', 'error');
    } finally {
      setAdminActionLoading('');
    }
  };

  const editAdminArenaCosmetic = (item: ArenaCosmeticItem) => {
    setAdminSubTab('cosmetics');
    setAdminCosmeticForm({
      id: item.id,
      type: item.type,
      name: item.name || '',
      description: item.description || '',
      price: Number(item.price || 0),
      style_json: item.style_json || (item.type === 'emote' ? '{"schema_version":1,"emoji":"✨","rarity":"common"}' : '{"schema_version":1,"rarity":"common","primary_color":"#f2556b","secondary_color":"#17adc0","accent_color":"#ffd166"}'),
      active: item.active !== false,
      purchase_limit: Number(item.purchase_limit || 0),
      sale_start_at: toArenaDateTimeInput(item.sale_start_at),
      sale_end_at: toArenaDateTimeInput(item.sale_end_at),
      limited_total_quantity: Number(item.limited_total_quantity || 0),
      sold_quantity: Number(item.sold_quantity || 0)
    });
  };

  const toggleAdminArenaCosmetic = async (item: ArenaCosmeticItem) => {
    try {
      setAdminActionLoading(`cosmetic-toggle-${item.id}`);
      const res = await apiFetch(`/admin/shop/items/${item.id}`, {
        method: 'POST',
        body: JSON.stringify({ active: item.active === false })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '치장 판매 상태를 변경하지 못했습니다.');
      toast(item.active === false ? '치장 판매를 켰습니다.' : '치장 판매를 껐습니다.', 'success');
      await Promise.all([
        loadArenaAdminCosmetics().catch(() => undefined),
        loadArenaCosmetics().catch(() => undefined)
      ]);
    } catch (error: any) {
      toast(error?.message || '치장 판매 상태 변경 중 문제가 발생했습니다.', 'error');
    } finally {
      setAdminActionLoading('');
    }
  };

  const buyArenaCosmetic = async (item: ArenaCosmeticItem) => {
    if (!user) {
      toast('로그인 후 구매할 수 있습니다.', 'error');
      return;
    }
    try {
      setSavingArenaCosmetic(true);
      const res = await apiFetch('/arena/cosmetics/buy', {
        method: 'POST',
        body: JSON.stringify({ item_id: item.id })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '구매하지 못했습니다.');
      toast(json?.message || '구매가 완료되었습니다.', 'success');
      await loadArenaCosmetics();
    } catch (error: any) {
      toast(error?.message || '구매하지 못했습니다.', 'error');
    } finally {
      setSavingArenaCosmetic(false);
    }
  };

  const saveArenaEmoteSlots = async () => {
    try {
      setSavingArenaCosmetic(true);
      const res = await apiFetch('/arena/cosmetics/loadout', {
        method: 'PATCH',
        body: JSON.stringify({ emoteSlots: arenaEmoteSlotDraft.map((item) => item?.id || null) })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '장착 정보를 저장하지 못했습니다.');
      const savedSlots = Array.from({ length: 8 }, (_, index) => json?.emoteSlots?.[index] || null) as Array<ArenaCosmeticItem | null>;
      setArenaCosmeticLoadout((current) => ({
        emoteSlots: savedSlots,
        equipped: Object.fromEntries(arenaLoadoutCosmeticTypes.map((type) => [type, json?.equipped?.[type] || current.equipped[type]])) as Record<ArenaLoadoutCosmeticType, ArenaCosmeticItem | null>
      }));
      setArenaEmoteSlotDraft(savedSlots);
      toast('이모트 휠을 저장했습니다.', 'success');
    } catch (error: any) {
      toast(error?.message || '장착 정보를 저장하지 못했습니다.', 'error');
    } finally {
      setSavingArenaCosmetic(false);
    }
  };

  const equipArenaEmote = (item: ArenaCosmeticItem) => {
    if (item.type !== 'emote') return;
    if (!arenaCosmeticCounts[item.id]) {
      toast('보유한 이모트만 장착할 수 있습니다.', 'error');
      return;
    }
    setArenaEmoteSlotDraft((current) => {
      const next = Array.from({ length: 8 }, (_, index) => current[index] || null);
      const existingIndex = next.findIndex((slot) => slot?.id === item.id);
      if (existingIndex >= 0) next[existingIndex] = null;
      next[selectedArenaEmoteSlot] = item;
      return next;
    });
  };

  const clearArenaEmoteSlot = (index: number) => {
    setArenaEmoteSlotDraft((current) => current.map((item, slotIndex) => slotIndex === index ? null : item));
  };

  const equipArenaLoadoutCosmetic = async (item: ArenaCosmeticItem) => {
    if (item.type === 'emote') return;
    if (!arenaCosmeticCounts[item.id]) {
      toast('보유한 치장만 장착할 수 있습니다.', 'error');
      return;
    }
    const nextItemId = arenaCosmeticLoadout.equipped[item.type]?.id === item.id ? null : item.id;
    try {
      setSavingArenaCosmetic(true);
      const res = await apiFetch('/arena/cosmetics/loadout', {
        method: 'PATCH',
        body: JSON.stringify({ equipped: { [item.type]: nextItemId } })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '치장 정보를 저장하지 못했습니다.');
      setArenaCosmeticLoadout((current) => ({
        ...current,
        equipped: Object.fromEntries(arenaLoadoutCosmeticTypes.map((type) => [type, json?.equipped?.[type] || null])) as Record<ArenaLoadoutCosmeticType, ArenaCosmeticItem | null>
      }));
      toast(nextItemId ? `${item.name} 치장을 장착했습니다.` : `${item.name} 치장을 해제했습니다.`, 'success');
    } catch (error: any) {
      toast(error?.message || '치장 정보를 저장하지 못했습니다.', 'error');
    } finally {
      setSavingArenaCosmetic(false);
    }
  };

  const renderPlay = () => (
    <div className={`arena-v2-shell arena-v2-page is-play ${styles.arenaV2Scope}`}>
      <section className="arena-v2-topbar">
        <div className="min-w-0">
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
            {Array.from({ length: 3 }, (_, index) => <BoardSlot key={`op-front-${index}`} card={boardCards[index]} lane="전열" index={index} side="opponent" />)}
            {Array.from({ length: 3 }, (_, index) => <BoardSlot key={`op-back-${index}`} card={index === 1 ? undefined : boardCards[index + 3]} lane="후열" index={index} side="opponent" />)}
          </div>
          <div className="arena-v2-lane-divider"><span>전열이 먼저 맞붙고, 후열이 빈틈을 노립니다</span></div>
          <div className="arena-v2-board" aria-label="내 2행 3열 보드">
            {Array.from({ length: 3 }, (_, index) => <BoardSlot key={`self-front-${index}`} card={index === 2 ? undefined : boardCards[index]} lane="전열" index={index} side="player" />)}
            {Array.from({ length: 3 }, (_, index) => <BoardSlot key={`self-back-${index}`} card={boardCards[index + 3]} lane="후열" index={index} side="player" />)}
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

      <section className="arena-v2-hand-rail" aria-label="덱 구성 이동">
        <div className="arena-v2-hand-header">
          <div>
            <h3>덱 구성은 보관함에서 진행합니다</h3>
            <span>보유 카드 전체를 확인하고 카드 정보를 비교하면서 덱을 저장하세요.</span>
          </div>
          <div className={`arena-v2-deck-meter ${deckReady ? 'is-ready' : ''}`}>
            <strong>{deckCount}</strong>
            <span>/ 14~20</span>
          </div>
          <button type="button" onClick={() => router.push('/arena/inventory')} className="arena-v2-secondary-button">
            <Layers3 className="h-4 w-4" /> 보관함 열기
          </button>
        </div>
      </section>
    </div>
  );

  const issueText = (issue: string | { code?: string; message?: string }) =>
    typeof issue === 'string' ? issue : issue.message || issue.code || '확인 필요';

  const inventoryFilterActive = Boolean(inventorySearch.trim()) || inventoryClassFilter !== 'all' || inventoryKeywordFilter !== 'all' || inventorySelectionFilter !== 'all' || inventorySort !== 'name_asc';

  const renderInventory = () => (
    <section className={`arena-v2-shell arena-v2-page is-inventory ${styles.arenaV2Scope}`}>
      <section className="arena-v2-topbar">
        <div>
          <h2>덱과 카드 보관함</h2>
          <p>{season ? `${season.name} · ${seasonStatusLabel(season.status)}` : '새 시즌 준비 중'} · 저장 덱 {decks.length}개 · 카드 {filteredInventoryCards.length}/{cards.length}장</p>
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
                  <button type="button" onClick={() => setSelectedCardIds(deck.cardVersionIds)}>불러오기</button>
                  <button type="button" onClick={() => revalidateDeck(deck.id)}>상태 확인</button>
                  <button type="button" onClick={() => deleteDeck(deck.id)}>삭제</button>
                </div>
              )) : <p>저장된 덱이 없습니다. 아래 카드 보관함에서 14~20장을 선택해 저장합니다.</p>}
            </div>
          </div>
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">덱 구성</span>
            <div className="arena-v2-hand-header arena-v2-builder-header">
              <div>
                <p>{filteredInventoryCards.length}장 표시 · 전체 {cards.length}장 중 {deckCount}장 선택됨 · 한 스트리머는 한 장만 사용할 수 있습니다.</p>
              </div>
              <div className={`arena-v2-deck-meter ${deckReady ? 'is-ready' : ''}`}>
                <strong>{deckCount}</strong>
                <span>/ 14~20</span>
              </div>
              <button type="button" onClick={saveDeck} disabled={saving || !deckReady} className="arena-v2-secondary-button">
                <Save className="h-4 w-4" /> 덱 저장
              </button>
            </div>
            <div className="arena-v2-inventory-tools" aria-label="카드 보관함 검색과 필터">
              <label className="arena-v2-search-field">
                <Search className="h-4 w-4" />
                <input
                  value={inventorySearch}
                  onChange={(event) => setInventorySearch(event.target.value)}
                  placeholder="카드명, 클래스, 효과 검색"
                  aria-label="카드 검색"
                />
              </label>
              <label className="arena-v2-filter-field">
                <SlidersHorizontal className="h-4 w-4" />
                <select value={inventoryClassFilter} onChange={(event) => setInventoryClassFilter(event.target.value)} aria-label="클래스 필터">
                  <option value="all">전체 클래스</option>
                  {availableInventoryClasses.map((cardClass) => (
                    <option key={cardClass} value={cardClass}>{classTone[cardClass]?.label || cardClass}</option>
                  ))}
                </select>
              </label>
              <label className="arena-v2-filter-field">
                <Sparkles className="h-4 w-4" />
                <select value={inventoryKeywordFilter} onChange={(event) => setInventoryKeywordFilter(event.target.value)} aria-label="효과 키워드 필터">
                  <option value="all">전체 효과</option>
                  {availableInventoryKeywords.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="arena-v2-filter-field">
                <Check className="h-4 w-4" />
                <select value={inventorySelectionFilter} onChange={(event) => setInventorySelectionFilter(event.target.value as InventorySelectionFilter)} aria-label="선택 상태 필터">
                  <option value="all">전체 카드</option>
                  <option value="selected">선택됨</option>
                  <option value="unselected">미선택</option>
                </select>
              </label>
              <label className="arena-v2-filter-field">
                <ArrowDownAZ className="h-4 w-4" />
                <select value={inventorySort} onChange={(event) => setInventorySort(event.target.value as InventorySortKey)} aria-label="카드 정렬">
                  <option value="name_asc">이름순</option>
                  <option value="class_asc">클래스순</option>
                  <option value="cost_asc">비용 낮은순</option>
                  <option value="cost_desc">비용 높은순</option>
                  <option value="attack_desc">공격력 높은순</option>
                  <option value="health_desc">체력 높은순</option>
                  <option value="selected_first">선택 카드 먼저</option>
                </select>
              </label>
              <button type="button" onClick={resetInventoryFilters} disabled={!inventoryFilterActive} className="arena-v2-filter-reset">
                <X className="h-4 w-4" /> 초기화
              </button>
            </div>
            <div className="arena-v2-card-grid" aria-label="보유 아레나 카드 전체 목록">
              {filteredInventoryCards.length ? filteredInventoryCards.map((card) => (
                <ArenaV2CardView key={card.id} card={card} selected={selectedCardIdSet.has(card.id)} onClick={() => toggleCard(card)} />
              )) : <p>{cards.length ? '조건에 맞는 카드가 없습니다.' : '아레나에서 사용할 보유 카드가 없습니다.'}</p>}
            </div>
            <div ref={cardLoadSentinelRef} className="arena-v2-card-loader" aria-live="polite">
              {loadingMoreCards ? '카드를 더 불러오는 중입니다.' : cardPage.hasMore ? '아래로 스크롤하면 카드를 더 불러옵니다.' : cards.length ? '모든 보유 카드를 불러왔습니다.' : ''}
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

  const normalizedWikiQuery = wikiQuery.trim().toLocaleLowerCase('ko-KR');
  const wikiMatches = (...parts: Array<string | undefined>) => !normalizedWikiQuery || parts.join(' ').toLocaleLowerCase('ko-KR').includes(normalizedWikiQuery);
  const filteredWikiCoreRules = wikiCoreRules.filter((rule) => wikiMatches(rule.label, rule.value, rule.detail));
  const filteredWikiModes = wikiModeSections.filter(([title, detail]) => wikiMatches(title, detail));
  const filteredWikiFlows = wikiFlowSections.filter((section) => wikiMatches(section.title, ...section.points));
  const filteredWikiClasses = legalCardClasses.filter((cardClass) => {
    const tone = classTone[cardClass] || classTone.tempo;
    return wikiMatches(cardClass, tone.label, tone.hint);
  });
  const filteredWikiKeywordGroups = wikiKeywordGroups
    .map((group) => ({ ...group, items: group.items.filter(([keyword, detail]) => wikiMatches(group.title, keyword, detail)) }))
    .filter((group) => group.items.length > 0);
  const wikiShowField = wikiMatches('필드와 라인', '좌 라인 중 라인 우 라인 도발 조준 밀치기 끌어오기 위치');
  const wikiShowDeckTips = wikiMatches(
    '덱 구성 팁',
    '14장 핵심 카드 접근성 피로 피해',
    '20장 안정적 조합',
    '전열 후열 직접 공격',
    '8코스트 9코스트 저코스트'
  );
  const wikiHasResults = filteredWikiCoreRules.length > 0
    || filteredWikiModes.length > 0
    || filteredWikiFlows.length > 0
    || filteredWikiClasses.length > 0
    || filteredWikiKeywordGroups.length > 0
    || wikiShowField
    || wikiShowDeckTips;

  const renderWiki = () => (
    <section className={`arena-v2-shell arena-v2-page is-wiki ${styles.arenaV2Scope}`}>
      <section className="arena-v2-topbar">
        <div>
          <h2>게임 플레이 위키</h2>
          <p>덱 구성부터 전투 판정까지, 실제 플레이 중 알아야 하는 규칙을 확인합니다.</p>
        </div>
        <div className="arena-v2-top-actions">
          <button type="button" onClick={() => router.push('/arena/play')} className="arena-v2-secondary-button">
            <Swords className="h-4 w-4" /> 플레이로 이동
          </button>
          <button type="button" onClick={() => router.push('/arena/inventory')} className="arena-v2-secondary-button">
            <Layers3 className="h-4 w-4" /> 덱 구성
          </button>
        </div>
      </section>

      <label className="arena-v2-wiki-search">
        <Search className="h-4 w-4" />
        <input
          value={wikiQuery}
          onChange={(event) => setWikiQuery(event.target.value)}
          placeholder="규칙, 클래스, 효과 검색"
          aria-label="아레나 위키 검색"
        />
        {wikiQuery ? (
          <button type="button" onClick={() => setWikiQuery('')} aria-label="위키 검색어 지우기">
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </label>

      <nav className="arena-v2-wiki-index" aria-label="위키 목차">
        <a href="#wiki-start">처음 시작</a>
        <a href="#wiki-core">핵심 규칙</a>
        <a href="#wiki-flow">턴 흐름</a>
        <a href="#wiki-field">필드와 라인</a>
        <a href="#wiki-classes">카드 클래스</a>
        <a href="#wiki-keywords">효과 키워드</a>
        <a href="#wiki-deck-tips">덱 구성 팁</a>
      </nav>

      <section className="arena-v2-stage">
        <aside id="wiki-start" className="arena-v2-command-panel" aria-label="아레나 핵심 규칙 요약">
          <StatTile icon={HeartPulse} label="기본 체력" value="30" tone="green" />
          <StatTile icon={Layers3} label="덱 크기" value="14~20" tone="cyan" />
          <StatTile icon={Clock3} label="턴 제한" value="40초" tone="gold" />
          <div className="arena-v2-panel-section arena-v2-wiki-start">
            <span className="arena-v2-panel-label">처음 읽는 순서</span>
            <div className="arena-v2-replay-list">
              <span><BookOpen className="h-3.5 w-3.5" /> 덱은 14~20장으로 만들고, 한 스트리머 카드는 덱에 1장만 넣습니다.</span>
              <span><Move className="h-3.5 w-3.5" /> 전술 이동은 이전 턴부터 있던 카드만 빈 칸으로 옮길 수 있습니다.</span>
              <span><Swords className="h-3.5 w-3.5" /> 전투는 같은 라인의 전열, 후열, 플레이어 순서로 진행됩니다.</span>
            </div>
          </div>
        </aside>

        <div className="arena-v2-board-wrap">
          <div id="wiki-core" className={`arena-v2-panel-section ${filteredWikiCoreRules.length ? '' : 'is-search-empty'}`}>
            <span className="arena-v2-panel-label">핵심 규칙</span>
            <div className="arena-v2-action-stack">
              {filteredWikiCoreRules.map((rule) => (
                <div key={rule.label} className="arena-v2-action-order">
                  <span>{rule.label}</span>
                  <span>{rule.value}</span>
                  <span>{rule.detail}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={`arena-v2-panel-section ${filteredWikiModes.length ? '' : 'is-search-empty'}`}>
            <span className="arena-v2-panel-label">모드</span>
            <div className="arena-v2-action-stack">
              {filteredWikiModes.map(([title, detail]) => (
                <div key={title} className="arena-v2-action-order">
                  <span>{title}</span>
                  <span>{detail}</span>
                </div>
              ))}
            </div>
          </div>

          <div id="wiki-flow" className={`arena-v2-panel-section ${filteredWikiFlows.length ? '' : 'is-search-empty'}`}>
            <span className="arena-v2-panel-label">턴 흐름과 행동</span>
            <p>아레나 한 턴은 드로우, 코스트 지급, 배치 제출, 동시 공개, 자동 전투, 승패 처리 순서로 진행됩니다.</p>
          </div>

          {filteredWikiFlows.map((section) => {
            const Icon = section.icon;
            return (
              <article key={section.title} className="arena-v2-panel-section">
                <span className="arena-v2-panel-label"><Icon className="h-3.5 w-3.5" /> {section.title}</span>
                <div className="arena-v2-replay-list">
                  {section.points.map((point) => <span key={point}>{point}</span>)}
                </div>
              </article>
            );
          })}

          <div id="wiki-field" className={`arena-v2-panel-section ${wikiShowField ? '' : 'is-search-empty'}`}>
            <span className="arena-v2-panel-label">필드와 라인</span>
            <div className="arena-v2-board" aria-label="위키용 2행 3열 필드 예시">
              {['전열 좌', '전열 중', '전열 우', '후열 좌', '후열 중', '후열 우'].map((slot, index) => (
                <div key={slot} className={`arena-v2-slot ${index < 3 ? 'is-player' : 'is-opponent'}`}>
                  <div className="arena-v2-slot-label">{slot}</div>
                  <span className="arena-v2-empty-slot">{index % 3 === 0 ? '좌 라인' : index % 3 === 1 ? '중 라인' : '우 라인'}</span>
                </div>
              ))}
            </div>
            <p>각 세로 줄이 하나의 라인입니다. 도발, 조준, 밀치기, 끌어오기처럼 위치를 따지는 효과는 다른 라인에 영향을 주지 않습니다.</p>
          </div>

          <div id="wiki-classes" className={`arena-v2-panel-section ${filteredWikiClasses.length ? '' : 'is-search-empty'}`}>
            <span className="arena-v2-panel-label">카드 클래스</span>
            <div className="arena-v2-action-stack">
              {filteredWikiClasses.map((cardClass) => {
                const tone = classTone[cardClass] || classTone.tempo;
                const Icon = tone.icon;
                return (
                  <div key={cardClass} className="arena-v2-action-order">
                    <span><Icon className="h-3.5 w-3.5" /> {tone.label}</span>
                    <span>{tone.hint}</span>
                    <span>{cardClass === 'charge' ? '전열 첫 카드 피해 +1' : cardClass === 'guardian' ? '전열 첫 체력 피해 1 감소' : cardClass === 'sniper' ? '후열에서 상대 후열 우선 공격' : cardClass === 'support' ? '같은 라인 아군 첫 피해 1 대신 받음' : cardClass === 'trick' ? '처음 피해 준 카드에게 약화 1' : cardClass === 'specter' ? '전열 사망 시 일반 초과 피해 차단' : '처음 받는 키워드 효과 1개 무효화'}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div id="wiki-keywords" className={`arena-v2-panel-section ${filteredWikiKeywordGroups.length ? '' : 'is-search-empty'}`}>
            <span className="arena-v2-panel-label">효과 키워드</span>
            <p>키워드는 카드의 특수 효과입니다. 같은 라인 제한이 있는 효과는 다른 라인의 카드나 플레이어에게 영향을 주지 않습니다.</p>
          </div>

          {filteredWikiKeywordGroups.map((group) => (
            <article key={group.title} className="arena-v2-panel-section">
              <span className="arena-v2-panel-label">{group.title}</span>
              <div className="arena-v2-replay-list">
                {group.items.map(([keyword, detail]) => <span key={keyword}><Sparkles className="h-3.5 w-3.5" /> {keyword} · {detail}</span>)}
              </div>
            </article>
          ))}

          <div id="wiki-deck-tips" className={`arena-v2-panel-section ${wikiShowDeckTips ? '' : 'is-search-empty'}`}>
            <span className="arena-v2-panel-label">덱 구성 팁</span>
            <div className="arena-v2-replay-list">
              <span>14장 덱은 핵심 카드 접근성이 높지만, 장기전에서 피로 피해가 빨리 옵니다.</span>
              <span>20장 덱은 안정적이지만 원하는 조합을 늦게 찾을 수 있습니다.</span>
              <span>전열을 버틸 카드, 후열 압박 카드, 직접 공격 대응 카드가 모두 있어야 라인 싸움이 안정적입니다.</span>
              <span>8~9코스트 카드는 강하지만 초반 손패에 잡히면 행동이 막힐 수 있으니 저코스트 카드와 함께 구성하세요.</span>
            </div>
          </div>
          {!wikiHasResults ? (
            <div className="arena-v2-empty-state" role="status">
              <Search className="h-5 w-5" />
              <strong>검색 결과가 없습니다.</strong>
              <span>다른 규칙명, 클래스 또는 효과 키워드로 찾아보세요.</span>
            </div>
          ) : null}
        </div>
      </section>
    </section>
  );

  const renderRanking = () => (
    <section className={`arena-v2-shell arena-v2-page is-ranking ${styles.arenaV2Scope}`}>
      <section className="arena-v2-topbar">
        <div>
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
            <div className="arena-v2-action-stack arena-v2-ranking-list">
              {rankings.length ? rankings.map((item) => (
                <div key={`${item.rank}-${item.userId}`} className="arena-v2-action-order">
                  <span>#{item.rank}</span>
                  <span>{item.displayName || item.userId}</span>
                  <span>{item.mmr}점</span>
                  <span>{item.tier}</span>
                  <span>{item.wins}승 {item.losses}패 {item.draws}무</span>
                </div>
              )) : (
                <div className="arena-v2-empty-state arena-v2-ranking-empty">
                  <Trophy className="h-6 w-6" />
                  <strong>아직 랭킹 데이터가 없습니다.</strong>
                  <span>시즌이 시작되면 첫 경기부터 순위가 기록됩니다.</span>
                  <button type="button" onClick={() => router.push('/arena/play')} className="arena-v2-primary-button">플레이로 이동</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </section>
  );

  const renderStyle = () => {
    const selectedEmote = arenaEmoteSlotDraft[selectedArenaEmoteSlot] || null;
    const draftSignature = arenaEmoteSlotDraft.map((item) => item?.id || null).join(',');
    const savedSignature = arenaCosmeticLoadout.emoteSlots.map((item) => item?.id || null).join(',');
    const emoteDraftDirty = draftSignature !== savedSignature;
    const filteredCosmetics = arenaCosmeticCategory === 'all'
      ? arenaCosmetics
      : arenaCosmetics.filter((item) => item.type === arenaCosmeticCategory);
    const rarityLabels = { common: '일반', rare: '레어', epic: '에픽', legendary: '레전더리' } as const;

    return (
      <section className={`arena-v2-shell arena-v2-page is-style ${styles.arenaV2Scope}`}>
        <section className="arena-v2-topbar">
          <div>
            <h2>아레나 치장 상점</h2>
            <p>전투 성능은 그대로 유지하고, 인게임에서 확실히 체감되는 연출만 판매합니다.</p>
          </div>
          <div className="arena-v2-top-actions">
            <span className="arena-v2-point-balance"><Sparkles className="h-4 w-4" /> {Number(user?.point || 0).toLocaleString()} P</span>
            <button type="button" onClick={loadArenaCosmetics} className="arena-v2-secondary-button">
              <RefreshCw className={`h-4 w-4 ${savingArenaCosmetic ? 'animate-spin' : ''}`} /> 상점 새로고침
            </button>
          </div>
        </section>

        <section className="arena-v2-style-studio">
          <div className="arena-v2-pie-editor">
            <div className="arena-v2-style-section-heading">
              <div>
                <h3>이모트 휠 편집</h3>
                <p>슬롯을 고른 뒤 보유 이모트를 배치하면 매치 파이 메뉴에 같은 위치로 반영됩니다.</p>
              </div>
              <span>{arenaEmoteSlotDraft.filter(Boolean).length}/8 장착</span>
            </div>
            <div className="arena-v2-pie-editor-body">
              <ArenaEmotePieMenu
                slots={arenaEmoteSlotDraft}
                selectedIndex={selectedArenaEmoteSlot}
                onSelect={setSelectedArenaEmoteSlot}
                disabled={savingArenaCosmetic}
                centerLabel="휠 편집"
                ariaLabel="아레나 이모트 휠 편집"
              />
              <aside className="arena-v2-pie-inspector">
                <span>선택 슬롯</span>
                <strong>{selectedArenaEmoteSlot + 1}번 슬롯</strong>
                <div className="arena-v2-pie-selected-emote">
                  <ArenaEmoteBadge item={selectedEmote} emptyLabel="배치할 이모트를 선택하세요" />
                  <div>
                    <b>{selectedEmote?.name || '빈 슬롯'}</b>
                    <small>{selectedEmote ? '이모트' : '카탈로그의 보유 이모트를 선택하세요.'}</small>
                  </div>
                </div>
                <button type="button" className="arena-v2-primary-button" onClick={saveArenaEmoteSlots} disabled={!emoteDraftDirty || savingArenaCosmetic}>
                  <Save className="h-4 w-4" /> {savingArenaCosmetic ? '저장 중' : '휠 저장'}
                </button>
                <button type="button" className="arena-v2-secondary-button" onClick={() => clearArenaEmoteSlot(selectedArenaEmoteSlot)} disabled={!selectedEmote || savingArenaCosmetic}>
                  <X className="h-4 w-4" /> 선택 슬롯 비우기
                </button>
                <button type="button" className="arena-v2-text-button" onClick={() => setArenaEmoteSlotDraft(arenaCosmeticLoadout.emoteSlots)} disabled={!emoteDraftDirty || savingArenaCosmetic}>
                  저장 상태로 되돌리기
                </button>
              </aside>
            </div>
          </div>

          <div className="arena-v2-equipped-cosmetics">
            <div className="arena-v2-style-section-heading">
              <div>
                <h3>장착 중인 아이템</h3>
                <p>이모트를 제외한 치장은 종류별로 하나씩 장착됩니다.</p>
              </div>
            </div>
            <div className="arena-v2-equipped-list">
              {arenaLoadoutCosmeticTypes.map((type) => {
                const item = arenaCosmeticLoadout.equipped[type];
                return (
                  <div key={type} className={item ? 'has-item' : ''}>
                    <span>{arenaCosmeticTypeLabels[type]}</span>
                    {item ? <ArenaCosmeticPreview item={item} compact /> : <i aria-hidden="true" />}
                    <strong>{item?.name || '미장착'}</strong>
                    {item ? <button type="button" onClick={() => equipArenaLoadoutCosmetic(item)} disabled={savingArenaCosmetic}>해제</button> : null}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="arena-v2-style-catalog">
          <div className="arena-v2-catalog-toolbar">
            <div>
              <h3>등록된 아이템</h3>
              <p>관리자가 등록하고 판매를 활성화한 치장만 표시됩니다.</p>
            </div>
            <nav aria-label="아레나 치장 종류">
              <button type="button" aria-pressed={arenaCosmeticCategory === 'all'} className={arenaCosmeticCategory === 'all' ? 'is-active' : ''} onClick={() => setArenaCosmeticCategory('all')}>전체</button>
              {arenaCosmeticTypes.map((type) => (
                <button key={type} type="button" aria-pressed={arenaCosmeticCategory === type} className={arenaCosmeticCategory === type ? 'is-active' : ''} onClick={() => setArenaCosmeticCategory(type)}>
                  {arenaCosmeticTypeLabels[type]}
                </button>
              ))}
            </nav>
          </div>

          {filteredCosmetics.length ? (
            <div className="arena-v2-store-grid">
              {filteredCosmetics.map((item) => {
                const owned = Number(arenaCosmeticCounts[item.id] || 0);
                const purchased = Number(arenaCosmeticPurchases[item.id] || 0);
                const purchaseLimit = Math.max(0, Number(item.purchase_limit || 0));
                const totalQuantity = Math.max(0, Number(item.limited_total_quantity || 0));
                const soldQuantity = Math.max(0, Number(item.sold_quantity || 0));
                const soldOut = totalQuantity > 0 && soldQuantity >= totalQuantity;
                const limitReached = purchaseLimit > 0 && purchased >= purchaseLimit;
                const equipped = item.type === 'emote'
                  ? arenaEmoteSlotDraft.some((slot) => slot?.id === item.id)
                  : arenaCosmeticLoadout.equipped[item.type]?.id === item.id;
                const rarity = getArenaCosmeticRarity(item);
                return (
                  <article key={item.id} className={`arena-v2-store-card is-${rarity} ${equipped ? 'is-equipped' : ''}`}>
                    <ArenaCosmeticPreview item={item} />
                    <div className="arena-v2-store-card-body">
                      <div className="arena-v2-store-card-labels">
                        <span>{arenaCosmeticTypeLabels[item.type]}</span>
                        <span>{rarityLabels[rarity]}</span>
                        {totalQuantity > 0 ? <span>{soldOut ? '품절' : `한정 ${Math.max(0, totalQuantity - soldQuantity).toLocaleString()}개`}</span> : null}
                      </div>
                      <strong>{item.name}</strong>
                      <p>{item.description || arenaCosmeticTypeDescriptions[item.type]}</p>
                      <div className="arena-v2-store-card-meta">
                        <b>{Number(item.price || 0).toLocaleString()} P</b>
                        <span>{owned ? `보유 ${owned}` : '미보유'}</span>
                      </div>
                      {owned ? (
                        <button
                          type="button"
                          className={equipped ? 'is-equipped' : ''}
                          onClick={() => item.type === 'emote' ? equipArenaEmote(item) : equipArenaLoadoutCosmetic(item)}
                          disabled={savingArenaCosmetic}
                        >
                          {item.type === 'emote'
                            ? equipped ? `${selectedArenaEmoteSlot + 1}번 슬롯으로 이동` : `${selectedArenaEmoteSlot + 1}번 슬롯에 장착`
                            : equipped ? '장착 해제' : '장착'}
                        </button>
                      ) : (
                        <button type="button" onClick={() => buyArenaCosmetic(item)} disabled={savingArenaCosmetic || limitReached || soldOut}>
                          {soldOut ? '품절' : limitReached ? '구매 제한 도달' : '구매'}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="arena-v2-store-empty" role="status">
              <Sparkles className="h-5 w-5" />
              <strong>이 종류로 판매 중인 치장이 없습니다.</strong>
              <span>관리자 페이지에서 상품을 등록하고 판매를 활성화하면 이곳에 표시됩니다.</span>
            </div>
          )}
        </section>
      </section>
    );
  };

  const renderMyCard = () => (
    <section className={`arena-v2-shell arena-v2-page is-my-card ${styles.arenaV2Scope}`}>
      <section className="arena-v2-topbar">
        <div>
          <h2>내 카드</h2>
          <p>등록된 스트리머가 자신의 아레나 카드 능력치와 효과를 시즌 비용 안에서 조정합니다.</p>
        </div>
        <button type="button" onClick={loadArenaV2} className="arena-v2-secondary-button">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 새로고침
        </button>
      </section>
      {!myStreamerCard ? (
        <section className="arena-v2-stage">
          <div className="arena-v2-board-wrap">
            <div className="arena-v2-panel-section">
              <span className="arena-v2-panel-label">접근 권한</span>
              <p>등록된 스트리머만 내 카드를 설정할 수 있습니다.</p>
            </div>
          </div>
        </section>
      ) : (
      <section className="arena-v2-stage">
        <aside className="arena-v2-command-panel">
          <div className="arena-v2-panel-section">
            <span className="arena-v2-panel-label">카드 설정</span>
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
                    artAssetId: myStreamerCard.card.artAssetId
                  }}
                />
              </div>
            </div>
          ) : null}
        </div>
      </section>
      )}
    </section>
  );

  const renderAdmin = () => {
    const rewardPreviewPlayers = adminRewardPreview?.totalPlayers ?? adminRewardPreview?.players?.length ?? 0;
    const rewardPreviewItems = Array.isArray(adminRewardPreview?.items) ? adminRewardPreview.items.length : Array.isArray(adminRewardPreview?.rewardItems) ? adminRewardPreview.rewardItems.length : 0;
    const equippedEmotes = arenaCosmeticLoadout.emoteSlots.filter(Boolean).length;
    const equippedCosmetics = arenaLoadoutCosmeticTypes.filter((type) => Boolean(arenaCosmeticLoadout.equipped[type])).length;
    const shopCosmetics = arenaCosmetics.length;
    return (
      <section className={`arena-v2-shell arena-v2-page is-admin ${styles.arenaV2Scope}`}>
        <section className="arena-v2-topbar">
          <div>
            <h2>아레나 관리자 콘솔</h2>
            <p>{season ? `${season.name} · ${seasonStatusLabel(season.status)}` : '시즌 없이도 카드, 덱, 상점 상태를 점검할 수 있습니다.'}</p>
          </div>
          <button type="button" onClick={loadArenaV2} className="arena-v2-secondary-button">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 새로고침
          </button>
        </section>

        <section className="arena-v2-stage arena-v2-admin-stage">
          <aside className="arena-v2-command-panel">
            <div className="arena-v2-admin-tabs">
              {arenaAdminTabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    className={adminSubTab === tab.id ? 'is-active' : ''}
                    onClick={() => setAdminSubTab(tab.id)}
                  >
                    <Icon className="h-4 w-4" />
                    <span>
                      <strong>{tab.label}</strong>
                      <small>{tab.description}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="arena-v2-board-wrap">
            {adminSubTab === 'overview' && (
              <>
                <div className="arena-v2-admin-kpis">
                  {[
                    ['시즌', season ? seasonStatusLabel(season.status) : '없음'],
                    ['보유 카드', `${cards.length.toLocaleString()}장`],
                    ['덱', `${decks.length.toLocaleString()}개`],
                    ['치장 상품', `${shopCosmetics.toLocaleString()}개`]
                  ].map(([label, value]) => (
                    <div key={label} className="arena-v2-stat">
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
                <div className="arena-v2-panel-section">
                  <span className="arena-v2-panel-label">운영 상태</span>
                  <div className="arena-v2-replay-list">
                    <span>API · {arenaAdminStatus?.status || '확인 대기'} {arenaAdminStatus?.arenaVersion ? `· ${arenaAdminStatus.arenaVersion}` : ''}</span>
                    <span>규칙 · {arenaAdminStatus?.rulesVersion || 'arena-v2-gdd'}</span>
                    <span>빠른대전 · {requestStatusLabel(queueStatus.quick?.status)} {queueStatus.quick?.matchId ? '· 매칭 완료' : ''}</span>
                    <span>8인전 · {requestStatusLabel(queueStatus.battleRoyale?.status)} {queueStatus.battleRoyale?.participantCount != null ? `· ${queueStatus.battleRoyale.participantCount}/8` : ''}</span>
                  </div>
                </div>
                <div className="arena-v2-admin-grid">
                  <div className="arena-v2-panel-section">
                    <span className="arena-v2-panel-label">바로가기</span>
                    <div className="arena-v2-queue-actions">
                      <button type="button" onClick={() => setAdminSubTab('season')}>시즌 관리</button>
                      <button type="button" onClick={() => setAdminSubTab('rewards')}>정산 관리</button>
                      <button type="button" onClick={() => setAdminSubTab('safety')}>운영 플래그</button>
                      <button type="button" onClick={() => setAdminSubTab('cosmetics')}>치장 상점</button>
                    </div>
                  </div>
                  <div className="arena-v2-panel-section">
                    <span className="arena-v2-panel-label">현재 관리자 기준</span>
                    <div className="arena-v2-replay-list">
                      <span>계정 · {user?.username || user?.id || '-'}</span>
                      <span>권한 · {user?.role || '-'}</span>
                      <span>장착 이모트 · {equippedEmotes}/8</span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {adminSubTab === 'season' && (
              <div className="arena-v2-admin-grid">
                <div className="arena-v2-panel-section">
                  <span className="arena-v2-panel-label">시즌 생성</span>
                  <input className="arena-v2-select" placeholder="시즌 코드" value={adminSeasonForm.seasonKey} onChange={(event) => setAdminSeasonForm((current) => ({ ...current, seasonKey: event.target.value }))} />
                  <input className="arena-v2-select" placeholder="시즌 이름" value={adminSeasonForm.name} onChange={(event) => setAdminSeasonForm((current) => ({ ...current, name: event.target.value }))} />
                  <input className="arena-v2-select" type="datetime-local" value={adminSeasonForm.startsAt} onChange={(event) => setAdminSeasonForm((current) => ({ ...current, startsAt: event.target.value }))} />
                  <input className="arena-v2-select" type="datetime-local" value={adminSeasonForm.endsAt} onChange={(event) => setAdminSeasonForm((current) => ({ ...current, endsAt: event.target.value }))} />
                  <button type="button" className="arena-v2-primary-button" onClick={createAdminSeason}>시즌 생성</button>
                </div>
                <div className="arena-v2-panel-section">
                  <span className="arena-v2-panel-label">상태 전환</span>
                  <div className="arena-v2-queue-actions">
                    {['scheduled', 'active', 'locked', 'settling', 'closed', 'cancelled'].map((status) => (
                      <button key={status} type="button" onClick={() => transitionSeason(status)} disabled={!season?.id}>{seasonStatusLabel(status)}</button>
                    ))}
                  </div>
                  <p>현재 시즌: {season?.name || '-'} · {season ? seasonStatusLabel(season.status) : '없음'}</p>
                </div>
              </div>
            )}

            {adminSubTab === 'rewards' && (
              <>
                <div className="arena-v2-admin-kpis">
                  <div className="arena-v2-stat"><span>정산 대상</span><strong>{rewardPreviewPlayers.toLocaleString()}명</strong></div>
                  <div className="arena-v2-stat"><span>보상 항목</span><strong>{rewardPreviewItems.toLocaleString()}개</strong></div>
                  <div className="arena-v2-stat"><span>내 보상</span><strong>{rewardState?.claimable ? '수령 가능' : '대기'}</strong></div>
                </div>
                <div className="arena-v2-admin-grid">
                  <div className="arena-v2-panel-section">
                    <span className="arena-v2-panel-label">시즌 보상 정산</span>
                    <div className="arena-v2-queue-actions">
                      <button type="button" onClick={previewAdminRewards} disabled={!season?.id || Boolean(adminActionLoading)}>{adminActionLoading === 'reward-preview' ? '확인 중' : '대상 확인'}</button>
                      <button type="button" onClick={() => grantRewards(true)} disabled={!season?.id || Boolean(adminActionLoading)}>{adminActionLoading === 'reward-dry-run' ? '검산 중' : '검산 실행'}</button>
                      <button type="button" onClick={() => grantRewards(false)} disabled={!season?.id || Boolean(adminActionLoading)}>보상 준비</button>
                    </div>
                    <p>보상 확정 전 대상 확인과 검산을 먼저 실행하세요.</p>
                  </div>
                  <div className="arena-v2-panel-section">
                    <span className="arena-v2-panel-label">개별 보상 보류</span>
                    <input className="arena-v2-select" placeholder="grant ID" value={adminRewardGrantId} onChange={(event) => setAdminRewardGrantId(event.target.value)} />
                    <input className="arena-v2-select" placeholder="보류 사유" value={adminRewardHoldReason} onChange={(event) => setAdminRewardHoldReason(event.target.value)} />
                    <div className="arena-v2-queue-actions">
                      <button type="button" onClick={holdAdminRewardGrant} disabled={!adminRewardGrantId.trim() || Boolean(adminActionLoading)}>보류</button>
                      <button type="button" onClick={releaseAdminRewardGrant} disabled={!adminRewardGrantId.trim() || Boolean(adminActionLoading)}>해제</button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {adminSubTab === 'matches' && (
              <div className="arena-v2-admin-grid">
                <div className="arena-v2-panel-section">
                  <span className="arena-v2-panel-label">대전 대기 상태</span>
                  <div className="arena-v2-replay-list">
                    <span>빠른대전 · {requestStatusLabel(queueStatus.quick?.status)} {queueStatus.quick?.matchId ? `· ${queueStatus.quick.matchId}` : ''}</span>
                    <span>8인전 · {requestStatusLabel(queueStatus.battleRoyale?.status)} {queueStatus.battleRoyale?.participantCount != null ? `· ${queueStatus.battleRoyale.participantCount}/8` : ''}</span>
                    <span>공식 덱 · {decks.filter((deck) => deck.isValid).length.toLocaleString()}개 사용 가능</span>
                  </div>
                </div>
                <div className="arena-v2-panel-section">
                  <span className="arena-v2-panel-label">리플레이 보류</span>
                  <input className="arena-v2-select" placeholder="match ID" value={adminReplayMatchId} onChange={(event) => setAdminReplayMatchId(event.target.value)} />
                  <input className="arena-v2-select" placeholder="보류 사유" value={adminReplayHoldReason} onChange={(event) => setAdminReplayHoldReason(event.target.value)} />
                  <input className="arena-v2-select" type="datetime-local" value={adminReplayHoldUntil} onChange={(event) => setAdminReplayHoldUntil(event.target.value)} />
                  <button type="button" className="arena-v2-primary-button" onClick={holdAdminReplay} disabled={!adminReplayMatchId.trim() || Boolean(adminActionLoading)}>리플레이 보류</button>
                </div>
              </div>
            )}

            {adminSubTab === 'safety' && (
              <div className="arena-v2-panel-section">
                <span className="arena-v2-panel-label">운영 플래그</span>
                <input className="arena-v2-select" placeholder="변경 사유" value={adminOpsReason} onChange={(event) => setAdminOpsReason(event.target.value)} />
                <div className="arena-v2-admin-flag-list">
                  {arenaAdminOpsFlags.map((item) => (
                    <div key={item.flag} className="arena-v2-admin-flag">
                      <div>
                        <strong>{item.label}</strong>
                        <span>{item.flag}</span>
                      </div>
                      <div className="arena-v2-queue-actions">
                        <button type="button" onClick={() => recordAdminOpsFlag(item.flag, true)} disabled={Boolean(adminActionLoading)}>활성</button>
                        <button type="button" onClick={() => recordAdminOpsFlag(item.flag, false)} disabled={Boolean(adminActionLoading)}>비활성</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {adminSubTab === 'cosmetics' && (
              <>
                <div className="arena-v2-admin-kpis">
                  <div className="arena-v2-stat"><span>등록 치장</span><strong>{arenaAdminCosmeticItems.length.toLocaleString()}개</strong></div>
                  <div className="arena-v2-stat"><span>판매 중</span><strong>{arenaAdminCosmeticItems.filter((item) => item.active !== false).length.toLocaleString()}개</strong></div>
                  <div className="arena-v2-stat"><span>내 장착 상태</span><strong>{equippedEmotes + equippedCosmetics}/15</strong></div>
                </div>
                <div className="arena-v2-admin-grid">
                  <div className="arena-v2-panel-section">
                    <span className="arena-v2-panel-label">{adminCosmeticForm.id ? `치장 수정 #${adminCosmeticForm.id}` : '아레나 치장 등록'}</span>
                    <select
                      className="arena-v2-select"
                      value={adminCosmeticForm.type}
                      onChange={(event) => setAdminCosmeticForm((form) => ({ ...form, type: event.target.value as ArenaCosmeticType }))}
                      aria-label="치장 종류"
                    >
                      {arenaCosmeticTypes.map((type) => <option key={type} value={type}>{arenaCosmeticTypeLabels[type]}</option>)}
                    </select>
                    <input className="arena-v2-select" placeholder="치장 이름" value={adminCosmeticForm.name} onChange={(event) => setAdminCosmeticForm((form) => ({ ...form, name: event.target.value }))} />
                    <input className="arena-v2-select" placeholder="설명" value={adminCosmeticForm.description} onChange={(event) => setAdminCosmeticForm((form) => ({ ...form, description: event.target.value }))} />
                    <div className="arena-v2-admin-form-grid">
                      <input className="arena-v2-select" type="number" min={0} value={adminCosmeticForm.price} onChange={(event) => setAdminCosmeticForm((form) => ({ ...form, price: Math.max(0, Number(event.target.value) || 0) }))} aria-label="가격" />
                      <input className="arena-v2-select" type="number" min={0} value={adminCosmeticForm.purchase_limit} onChange={(event) => setAdminCosmeticForm((form) => ({ ...form, purchase_limit: Math.max(0, Number(event.target.value) || 0) }))} aria-label="계정별 구매 제한" />
                      <input className="arena-v2-select" type="number" min={0} value={adminCosmeticForm.limited_total_quantity} onChange={(event) => setAdminCosmeticForm((form) => ({ ...form, limited_total_quantity: Math.max(0, Number(event.target.value) || 0) }))} aria-label="총 판매 제한" />
                    </div>
                    <div className="arena-v2-admin-form-grid">
                      <input className="arena-v2-select" type="datetime-local" value={adminCosmeticForm.sale_start_at} onChange={(event) => setAdminCosmeticForm((form) => ({ ...form, sale_start_at: event.target.value }))} aria-label="판매 시작" />
                      <input className="arena-v2-select" type="datetime-local" value={adminCosmeticForm.sale_end_at} onChange={(event) => setAdminCosmeticForm((form) => ({ ...form, sale_end_at: event.target.value }))} aria-label="판매 종료" />
                    </div>
                    {adminCosmeticForm.type === 'emote' ? (
                      <div className="arena-v2-admin-cosmetic-tools">
                        <label>
                          {adminCosmeticUploading ? '업로드 중' : '이미지 업로드'}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                            onChange={(event) => {
                              void uploadAdminArenaEmoteAsset(event.target.files?.[0]);
                              event.currentTarget.value = '';
                            }}
                          />
                        </label>
                        <input
                          className="arena-v2-select"
                          placeholder="이모지 대체 표시"
                          value={String(parseArenaCosmeticStyle(adminCosmeticForm.style_json).emoji || '')}
                          onChange={(event) => mergeAdminCosmeticStyleJson({ emoji: event.target.value })}
                        />
                      </div>
                    ) : (
                      <div className="arena-v2-admin-form-grid">
                        <input className="arena-v2-select" placeholder="주 색상 #f2556b" value={String(parseArenaCosmeticStyle(adminCosmeticForm.style_json).primary_color || '')} onChange={(event) => mergeAdminCosmeticStyleJson({ primary_color: event.target.value })} />
                        <input className="arena-v2-select" placeholder="보조 색상 #17adc0" value={String(parseArenaCosmeticStyle(adminCosmeticForm.style_json).secondary_color || '')} onChange={(event) => mergeAdminCosmeticStyleJson({ secondary_color: event.target.value })} />
                        <input className="arena-v2-select" placeholder="강조 색상 #ffd166" value={String(parseArenaCosmeticStyle(adminCosmeticForm.style_json).accent_color || '')} onChange={(event) => mergeAdminCosmeticStyleJson({ accent_color: event.target.value })} />
                      </div>
                    )}
                    <textarea
                      className="arena-v2-select arena-v2-admin-textarea"
                      value={adminCosmeticForm.style_json}
                      onChange={(event) => setAdminCosmeticForm((form) => ({ ...form, style_json: event.target.value }))}
                      placeholder='{"schema_version":1,"rarity":"epic","primary_color":"#f2556b"}'
                    />
                    <label className="arena-v2-admin-check">
                      <input type="checkbox" checked={adminCosmeticForm.active} onChange={(event) => setAdminCosmeticForm((form) => ({ ...form, active: event.target.checked }))} />
                      판매 활성화
                    </label>
                    <div className="arena-v2-queue-actions">
                      <button type="button" onClick={saveAdminArenaCosmetic} disabled={adminActionLoading === 'cosmetic-save'}>{adminActionLoading === 'cosmetic-save' ? '저장 중' : adminCosmeticForm.id ? '수정 저장' : '치장 등록'}</button>
                      <button type="button" onClick={() => setAdminCosmeticForm({ ...emptyArenaAdminCosmeticForm })}>초기화</button>
                    </div>
                  </div>

                  <div className="arena-v2-panel-section">
                    <span className="arena-v2-panel-label">등록 미리보기</span>
                    <div className="arena-v2-admin-emote-preview">
                      <ArenaCosmeticPreview item={{
                        id: adminCosmeticForm.id,
                        type: adminCosmeticForm.type,
                        name: adminCosmeticForm.name || '치장 이름',
                        description: adminCosmeticForm.description || null,
                        price: adminCosmeticForm.price,
                        style_json: adminCosmeticForm.style_json || null,
                        purchase_limit: adminCosmeticForm.purchase_limit,
                        active: adminCosmeticForm.active
                      }} />
                      <strong>{adminCosmeticForm.name || '치장 이름'}</strong>
                      <small>{arenaCosmeticTypeLabels[adminCosmeticForm.type]} · {adminCosmeticForm.price.toLocaleString()} P · {adminCosmeticForm.active ? '판매 중' : '비활성'}</small>
                    </div>
                    <div className="arena-v2-replay-list">
                      <span>JSON 스키마와 등록 예시는 game_docs/arena_cosmetics/ARENA_COSMETIC_REGISTRATION_EXAMPLES.md를 따릅니다.</span>
                      <span>{arenaCosmeticTypeDescriptions[adminCosmeticForm.type]}</span>
                    </div>
                  </div>
                </div>

                <div className="arena-v2-panel-section">
                  <span className="arena-v2-panel-label">아레나 치장 목록</span>
                  <div className="arena-v2-admin-cosmetic-list">
                    {arenaAdminCosmeticItems.length === 0 ? (
                      <span>등록된 아레나 치장이 없습니다.</span>
                    ) : arenaAdminCosmeticItems.map((item) => (
                        <article key={item.id} className="arena-v2-admin-cosmetic-item">
                          <ArenaCosmeticPreview item={item} compact />
                          <div>
                            <strong>{item.name}</strong>
                            <small>{arenaCosmeticTypeLabels[item.type]} · {Number(item.price || 0).toLocaleString()} P · 판매 {Number(item.sold_quantity || 0).toLocaleString()}{item.limited_total_quantity ? `/${Number(item.limited_total_quantity).toLocaleString()}` : ''}</small>
                          </div>
                          <div className="arena-v2-queue-actions">
                            <button type="button" onClick={() => editAdminArenaCosmetic(item)}>수정</button>
                            <button type="button" onClick={() => toggleAdminArenaCosmetic(item)} disabled={adminActionLoading === `cosmetic-toggle-${item.id}`}>{item.active === false ? '활성' : '비활성'}</button>
                          </div>
                        </article>
                    ))}
                  </div>
                </div>
              </>
            )}

            {adminSubTab === 'diagnostics' && (
              <div className="arena-v2-admin-grid">
                <div className="arena-v2-panel-section">
                  <span className="arena-v2-panel-label">데이터 점검</span>
                  <div className="arena-v2-replay-list">
                    <span>카드 로드 · {cards.length.toLocaleString()}장</span>
                    <span>카드 추가 페이지 · {cardPage.hasMore ? `offset ${cardPage.nextOffset}` : '완료'}</span>
                    <span>랭킹 샘플 · {rankings.length.toLocaleString()}명</span>
                    <span>공지 · {notice || '없음'}</span>
                  </div>
                </div>
                <div className="arena-v2-panel-section">
                  <span className="arena-v2-panel-label">시스템 응답</span>
                  <pre className="arena-v2-admin-json">{JSON.stringify(arenaAdminStatus || {}, null, 2)}</pre>
                </div>
              </div>
            )}
          </div>
        </section>
      </section>
    );
  };

  if (activeTab === 'inventory') return renderInventory();
  if (activeTab === 'wiki') return renderWiki();
  if (activeTab === 'ranking') return renderRanking();
  if (activeTab === 'style') return renderStyle();
  if (activeTab === 'my-card') return renderMyCard();
  if (activeTab === 'admin') return renderAdmin();
  return renderPlay();
};
