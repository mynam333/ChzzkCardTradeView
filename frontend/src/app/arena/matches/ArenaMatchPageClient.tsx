'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Eye,
  FastForward,
  FileClock,
  GripVertical,
  RefreshCw,
  Share2,
  ShieldCheck,
  Sparkles,
  Swords,
  Target,
  Trophy,
  X
} from 'lucide-react';
import { ArenaLayout } from '../../ArenaLayout';
import type { ArenaSiteTab } from '../../ArenaTab';
import { useApp } from '../../AppContext';
import { StreamerTooltip } from '../../StreamerTooltip';
import { API_BASE_URL, apiFetch } from '@/lib/api';
import {
  arenaStatDescriptions,
  getArenaClassDescription,
  getArenaSkillDescription
} from '@/lib/arenaRuleDescriptions';
import {
  buildArenaBattleTurns,
  summarizeArenaBattleTurn,
  validateArenaBattleTimeline,
  type ArenaBattleTimelineDiagnostic,
  type ArenaBattleTurnSummaryItem,
  type ArenaBattleTurn
} from '@/lib/arenaBattleTimeline';
import {
  ARENA_PREVIEW_LOADOUT,
  ARENA_PREVIEW_RULES_CATALOG,
  ARENA_VFX_PREVIEW_MATCH_ID,
  buildArenaPreviewMatch,
  buildArenaPreviewReplay
} from '@/lib/arenaBattlePreview';
import { borderClass, borderStyle, ensureCosmeticCss, ensureFont, nameEffectClass, nameEffectStyle, proxiedImage } from '@/lib/cosmetics';
import { ArenaPixiBattleRenderer } from './ArenaPixiBattleRenderer';
import type {
  ArenaDeckSnapshotDto,
  ArenaMatchViewDto,
  ArenaReplayPayloadDto,
  ArenaRoundResultDto,
  ArenaRoundPlanDto,
  ArenaRulesCatalogDto,
  ArenaSnapshotCardDto
} from '@chikapo/arena-contract';

export { buildArenaBattleTurns, summarizeArenaBattleTurn, validateArenaBattleTimeline };
export type { ArenaBattleTimelineDiagnostic, ArenaBattleTimelineIssue, ArenaBattleTurn, ArenaBattleTurnSummaryItem } from '@/lib/arenaBattleTimeline';

type RoundWaitState = {
  roundNo: number;
  deadlineAt: string;
};

export type RoundRevealState = {
  roundNo: number;
  stage: 'battle' | 'result';
  winner: 'player' | 'bot' | 'draw';
  completed: boolean;
  result: ArenaMatchViewDto['result'];
};

const ARENA_ROUND_SELECTION_TIMEOUT_MS = 60_000;

const arenaTabHref: Record<ArenaSiteTab, string> = {
  play: '/arena/play',
  inventory: '/arena/inventory',
  ranking: '/arena/ranking',
  style: '/arena/style',
  admin: '/arena/admin'
};

const tacticOptions = [
  ['balanced', '균형'],
  ['aggressive', '공격'],
  ['guard', '수비'],
  ['tempo', '템포'],
  ['counter', '역습'],
  ['finisher', '마무리']
] as const;

const focusOptions = [
  ['frontline_first', '전열 우선'],
  ['backline_first', '후열 우선'],
  ['lowest_hp', '약한 적'],
  ['highest_attack', '고화력']
] as const;

export const resultLabel = (result?: ArenaMatchViewDto['result']) => (
  result === 'win' ? '승리' : result === 'loss' ? '패배' : result === 'draw' ? '무승부' : '진행 중'
);

const normalizeArenaProgressStatus = (status?: unknown) => String(status || '').trim().toLowerCase();
export const isArenaMatchCompleted = (match?: Pick<ArenaMatchViewDto, 'summary' | 'round_count' | 'player_a_round_wins' | 'player_b_round_wins'> | null) => {
  const status = normalizeArenaProgressStatus(match?.summary?.progress_status);
  if (status === 'completed') return true;
  if (status === 'in_progress') return false;
  return Number(match?.player_a_round_wins || 0) >= 3 || Number(match?.player_b_round_wins || 0) >= 3 || Number(match?.round_count || 0) >= 5;
};

export const winnerLabel = (winner?: string) => (
  winner === 'player' ? '내 라운드 승리' : winner === 'bot' ? '상대 라운드 승리' : '라운드 무승부'
);

const arenaSkillSlotLabels: Record<string, string> = {
  active: '액티브',
  passive: '패시브',
  ultimate: '궁극기'
};

export type SelectedRoundSlot = {
  card_id: string;
  row: 0 | 1;
  col: 0 | 1 | 2;
};

export type ArenaRuleSkill = {
  id: string;
  name?: string;
  type?: string;
  description?: string;
};

export type ArenaRuleClass = {
  id?: string;
  class_id?: string;
  name?: string;
  description?: string;
  role?: string;
};

type ArenaShopItem = {
  id: number;
  type: 'border' | 'name_effect' | 'emote';
  name: string;
  description?: string | null;
  style_json?: string | null;
  font_url?: string | null;
  font_family?: string | null;
};

export type ArenaCosmeticLoadout = {
  user_id: string;
  border_item_id: number | null;
  name_effect_item_id: number | null;
  border_item?: ArenaShopItem | null;
  name_effect_item?: ArenaShopItem | null;
  updated_at?: string | null;
};

const ARENA_ACTIVE_SLOT_COUNT = 6;
const ARENA_VFX_PARTICLES = Array.from({ length: 16 }, (_, index) => index);
const ARENA_CARD_HIT_SPARKS = [
  { x: -36, y: -18, rotate: -28, delay: 0 },
  { x: 34, y: -22, rotate: 22, delay: 0.025 },
  { x: -24, y: 24, rotate: 18, delay: 0.045 },
  { x: 30, y: 20, rotate: -18, delay: 0.065 },
  { x: -8, y: -34, rotate: 8, delay: 0.08 },
  { x: 10, y: 32, rotate: -8, delay: 0.095 }
];
export const ARENA_BATTLE_TURN_MS = 820;
const ARENA_BATTLE_RESULT_SETTLE_MS = 420;
const ARENA_BATTLE_MIN_REVEAL_MS = 1200;

const buildArenaRealtimeSocketUrl = () => {
  if (typeof window === 'undefined') return '';
  const explicit = process.env.NEXT_PUBLIC_ARENA_WS_URL;
  if (explicit) return explicit;
  if (API_BASE_URL.startsWith('http://') || API_BASE_URL.startsWith('https://')) {
    const url = new URL(API_BASE_URL);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/arena/realtime';
    url.search = '';
    return url.toString();
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/arena/realtime`;
};

const statLabels: Array<[keyof NonNullable<ArenaSnapshotCardDto['stats']>, string, string]> = [
  ['hp', 'HP', '체력'],
  ['attack', 'ATK', '공격'],
  ['defense', 'DEF', '방어'],
  ['speed', 'SPD', '속도'],
  ['focus', 'FOC', '집중']
];

const turnSummaryToneClass: Record<ArenaBattleTurnSummaryItem['key'], string> = {
  damage: 'bg-rose-500/10 text-rose-700 dark:text-rose-100',
  heal: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-100',
  shield: 'bg-sky-500/10 text-sky-700 dark:text-sky-100',
  control: 'bg-violet-500/10 text-violet-700 dark:text-violet-100',
  retire: 'bg-slate-500/10 text-slate-700 dark:text-slate-100',
  effect: 'bg-primary/10 text-primary'
};

const ArenaInfoTooltip: React.FC<{
  label: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}> = ({ label, description, children, className }) => (
  <StreamerTooltip
    as="span"
    className={`inline-flex min-w-0 ${className || ''}`.trim()}
    edgeGuard={{ right: 320, bottom: 180 }}
    content={(
      <span className="block max-w-[18rem] text-left">
        <span className="block text-[10px] font-black text-primary">{label}</span>
        <span className="mt-1 block text-[11px] font-bold leading-relaxed text-foreground/85">{description}</span>
      </span>
    )}
  >
    {children}
  </StreamerTooltip>
);

const getSkillDescription = (skill: NonNullable<ArenaSnapshotCardDto['skills']>[number], skillLookup: Map<string, ArenaRuleSkill>) => {
  const catalogSkill = skillLookup.get(skill.id) || [...skillLookup.values()].find((item) => item.name === skill.name);
  return getArenaSkillDescription({ ...catalogSkill, ...skill });
};

const getClassDescription = (card: ArenaSnapshotCardDto, classLookup: Map<string, ArenaRuleClass>) => {
  const catalogClass = classLookup.get(card.class_id) || [...classLookup.values()].find((item) => item.name === card.class_name);
  return getArenaClassDescription({
    ...catalogClass,
    id: catalogClass?.id || card.class_id,
    class_id: catalogClass?.class_id || card.class_id,
    name: catalogClass?.name || card.class_name
  });
};

export const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
};

const getRoundPlan = (deck: ArenaDeckSnapshotDto | undefined, roundNo: number): ArenaRoundPlanDto | undefined =>
  deck?.round_plans?.find((plan) => plan.round_no === roundNo) || deck?.round_plans?.[0];

export const getRoundCards = (deck: ArenaDeckSnapshotDto | undefined, roundNo: number): ArenaSnapshotCardDto[] => {
  if (!deck?.cards?.length) return [];
  const plan = getRoundPlan(deck, roundNo);
  if (!plan?.slots?.length) return deck.cards.slice(0, 6);
  const byId = new Map(deck.cards.map((card) => [card.card_id, card]));
  const planned = plan.slots
    .map((slot) => byId.get(slot.card_id))
    .filter((card): card is ArenaSnapshotCardDto => Boolean(card));
  return planned.length > 0 ? planned : deck.cards.slice(0, 6);
};

export const getRoundSlots = (deck: ArenaDeckSnapshotDto | undefined, roundNo: number): SelectedRoundSlot[] => {
  if (!deck?.cards?.length) return [];
  const cardIds = new Set(deck.cards.map((card) => card.card_id));
  const plan = getRoundPlan(deck, roundNo);
  const planned = (plan?.slots || [])
    .filter((slot) => cardIds.has(slot.card_id))
    .slice(0, ARENA_ACTIVE_SLOT_COUNT)
    .map((slot, index) => ({
      card_id: slot.card_id,
      row: (Number.isInteger(slot.row) && slot.row >= 0 && slot.row <= 1 ? slot.row : index < 3 ? 1 : 0) as 0 | 1,
      col: (Number.isInteger(slot.col) && slot.col >= 0 && slot.col <= 2 ? slot.col : index % 3) as 0 | 1 | 2
    }));
  if (planned.length > 0) return planned;
  return deck.cards.slice(0, ARENA_ACTIVE_SLOT_COUNT).map((card, index) => ({
    card_id: card.card_id,
    row: (index < 3 ? 1 : 0) as 0 | 1,
    col: (index % 3) as 0 | 1 | 2
  }));
};

const getInputSlots = (deck: ArenaDeckSnapshotDto | undefined, value: unknown): SelectedRoundSlot[] => {
  if (!deck?.cards?.length || !Array.isArray(value)) return [];
  const cardIds = new Set(deck.cards.map((card) => card.card_id));
  const seen = new Set<string>();
  const slots: SelectedRoundSlot[] = [];
  value.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const cardId = String((raw as any).card_id || '').trim();
    if (!cardId || seen.has(cardId) || !cardIds.has(cardId)) return;
    seen.add(cardId);
    const rowValue = Number((raw as any).row);
    const colValue = Number((raw as any).col);
    slots.push({
      card_id: cardId,
      row: (Number.isInteger(rowValue) && rowValue >= 0 && rowValue <= 1 ? rowValue : index < 3 ? 1 : 0) as 0 | 1,
      col: (Number.isInteger(colValue) && colValue >= 0 && colValue <= 2 ? colValue : index % 3) as 0 | 1 | 2
    });
  });
  return orderRoundSlots(slots).slice(0, ARENA_ACTIVE_SLOT_COUNT);
};

const orderRoundSlots = (slots: SelectedRoundSlot[]) =>
  [...slots].sort((a, b) => (b.row - a.row) || (a.col - b.col));

const getOpponentDeck = (match: ArenaMatchViewDto | null): ArenaDeckSnapshotDto | undefined =>
  match?.summary?.opponent_deck || match?.summary?.bot_deck;

const getNextRoundNo = (match: ArenaMatchViewDto | null) =>
  match?.summary?.current_round_no || Math.min(5, (match?.round_count || 0) + 1);

const MatchCard: React.FC<{
  card: ArenaSnapshotCardDto;
  side: 'player' | 'opponent';
  skillLookup: Map<string, ArenaRuleSkill>;
  classLookup: Map<string, ArenaRuleClass>;
}> = ({ card, side, skillLookup, classLookup }) => (
  <article className={`arena-status-row min-w-0 overflow-hidden rounded-3xl border p-3 shadow-sm ${
    side === 'player'
      ? 'border-rose-200/80 bg-gradient-to-br from-white/90 to-rose-50/80 dark:border-rose-300/20 dark:from-white/10 dark:to-rose-300/10'
      : 'border-pink-200/80 bg-gradient-to-br from-white/88 to-pink-50/80 dark:border-pink-300/20 dark:from-white/10 dark:to-pink-300/10'
  }`}>
    <div className="flex items-center gap-3">
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-2xl bg-white/80 shadow-sm dark:bg-white/10">
        {card.image_url ? <img src={card.image_url} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-black text-foreground">{card.name}</p>
        <p className="mt-0.5 truncate text-[10px] font-bold text-muted-foreground">
          <ArenaInfoTooltip label={card.class_name} description={getClassDescription(card, classLookup)}>
            <span className="cursor-help truncate">{card.class_name}</span>
          </ArenaInfoTooltip>
        </p>
      </div>
    </div>
    {card.skills?.length ? (
      <div className="mt-3 flex flex-wrap gap-1">
        {card.skills.slice(0, 3).map((skill) => (
          <ArenaInfoTooltip
            key={skill.id}
            label={`${skill.name} (${arenaSkillSlotLabels[skill.type] || skill.type})`}
            description={getSkillDescription(skill, skillLookup)}
          >
            <span className="inline-flex max-w-full cursor-help items-center gap-1 rounded-full bg-white/66 px-2 py-0.5 text-[9px] font-black text-primary dark:bg-white/10">
              <span className="shrink-0 text-muted-foreground">{arenaSkillSlotLabels[skill.type] || skill.type}</span>
              <span className="truncate">{skill.name}</span>
            </span>
          </ArenaInfoTooltip>
        ))}
      </div>
    ) : null}
    {card.stats ? (
      <div className="mt-3 grid grid-cols-5 gap-1 text-center">
        {statLabels.map(([statKey, shortLabel, label]) => (
          <ArenaInfoTooltip key={statKey} label={`${label} ${card.stats?.[statKey] ?? 0}`} description={arenaStatDescriptions[statKey]}>
            <div className="cursor-help rounded-2xl bg-white/64 px-1 py-1.5 dark:bg-white/10">
              <p className="text-[8px] font-black text-muted-foreground">{shortLabel}</p>
              <p className="text-[10px] font-black text-foreground">{card.stats?.[statKey] ?? 0}</p>
            </div>
          </ArenaInfoTooltip>
        ))}
      </div>
    ) : null}
  </article>
);

const FormationSlotBoard: React.FC<{
  deck: ArenaDeckSnapshotDto | undefined;
  slots: SelectedRoundSlot[];
  draggingCardId: string | null;
  disabled: boolean;
  onSlotDrop: (index: number, cardId: string) => void;
  onSlotDragStart: (cardId: string) => void;
  onDragEnd: () => void;
  onClearSlot: (cardId: string) => void;
}> = ({ deck, slots, draggingCardId, disabled, onSlotDrop, onSlotDragStart, onDragEnd, onClearSlot }) => {
  const byId = React.useMemo(() => new Map((deck?.cards || []).map((card) => [card.card_id, card])), [deck?.cards]);
  const ordered = orderRoundSlots(slots);

  return (
    <div className="rounded-[1.75rem] border border-rose-200/70 bg-white/66 p-3 dark:border-rose-300/20 dark:bg-white/8">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-black text-primary">출전 배치</p>
          <p className="mt-0.5 text-[10px] font-bold text-muted-foreground">상단이 전열, 하단이 후열입니다.</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${slots.length === ARENA_ACTIVE_SLOT_COUNT ? 'bg-primary/10 text-primary' : 'bg-amber-100 text-amber-700 dark:bg-amber-300/10 dark:text-amber-100'}`}>
          {slots.length}/{ARENA_ACTIVE_SLOT_COUNT}
        </span>
      </div>
      <div className="space-y-2">
        {[
          { label: '전열', row: 1 as const },
          { label: '후열', row: 0 as const }
        ].map(({ label, row }, displayRowIndex) => (
          <div key={row} className="grid grid-cols-[2.5rem_repeat(3,minmax(0,1fr))] gap-2">
            <div className={`flex items-center justify-center rounded-2xl text-[9px] font-black ${row === 1 ? 'bg-primary/10 text-primary' : 'bg-secondary/52 text-muted-foreground'}`}>{label}</div>
            {[0, 1, 2].map((col) => {
              const slotIndex = displayRowIndex * 3 + col;
              const slot = ordered.find((item) => item.row === row && item.col === col);
              const card = slot ? byId.get(slot.card_id) : null;
              const isDragging = draggingCardId && slot?.card_id === draggingCardId;
              return (
                <button
                  key={`${row}-${col}`}
                  type="button"
                  disabled={disabled}
                  onClick={() => slot?.card_id && onClearSlot(slot.card_id)}
                  onDragOver={(event) => {
                    if (!disabled) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    if (disabled) return;
                    event.preventDefault();
                    const cardId = event.dataTransfer.getData('text/plain') || draggingCardId;
                    if (cardId) onSlotDrop(slotIndex, cardId);
                  }}
                  className={`group min-h-20 rounded-3xl border p-2 text-left transition ${
                    card
                      ? 'border-primary/25 bg-gradient-to-br from-white to-rose-50 shadow-sm dark:from-white/10 dark:to-rose-300/10'
                      : 'border-dashed border-rose-200 bg-rose-50/45 dark:border-rose-300/20 dark:bg-rose-300/8'
                  } ${isDragging ? 'opacity-45' : ''} ${disabled ? 'cursor-default' : 'hover:-translate-y-0.5 hover:border-primary/45'}`}
                  aria-label={card ? `${card.name} 슬롯 제거` : `${label} ${col + 1} 슬롯`}
                >
                  {card ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        draggable={!disabled}
                        onDragStart={(event) => {
                          event.dataTransfer.setData('text/plain', card.card_id);
                          onSlotDragStart(card.card_id);
                        }}
                        onDragEnd={onDragEnd}
                        className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/80 text-primary shadow-sm dark:bg-white/10"
                      >
                        {card.image_url ? <img src={card.image_url} alt="" className="h-full w-full object-cover" loading="lazy" /> : <GripVertical className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-black text-foreground">{card.name}</span>
                        <span className="mt-0.5 block truncate text-[9px] font-bold text-muted-foreground">{card.class_name}</span>
                        {!disabled ? <span className="mt-1 block text-[9px] font-black text-primary opacity-0 transition group-hover:opacity-100">클릭 제거</span> : null}
                      </span>
                    </span>
                  ) : (
                    <span className="flex h-full min-h-14 items-center justify-center text-[10px] font-black text-muted-foreground">비어 있음</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

const getCardBySlots = (
  cards: ArenaSnapshotCardDto[],
  slots: SelectedRoundSlot[]
): Array<{ card: ArenaSnapshotCardDto; slot: SelectedRoundSlot; visualIndex: number }> => {
  const byId = new Map(cards.map((card) => [card.card_id, card]));
  const planned = orderRoundSlots(slots)
    .map((slot, index) => {
      const card = byId.get(slot.card_id);
      return card ? { card, slot, visualIndex: index } : null;
    })
    .filter((item): item is { card: ArenaSnapshotCardDto; slot: SelectedRoundSlot; visualIndex: number } => Boolean(item));
  if (planned.length > 0) return planned;
  return cards.slice(0, ARENA_ACTIVE_SLOT_COUNT).map((card, index) => ({
    card,
    slot: {
      card_id: card.card_id,
      row: (index < 3 ? 1 : 0) as 0 | 1,
      col: (index % 3) as 0 | 1 | 2
    },
    visualIndex: index
  }));
};

type ArenaReplayEvent = ArenaReplayPayloadDto['rounds'][number]['events'][number];
type ArenaReplayUnitState = NonNullable<ArenaReplayPayloadDto['rounds'][number]['unit_states']>[number];
type ArenaReplayRound = ArenaReplayPayloadDto['rounds'][number];
type ArenaRoundHighlight = {
  roundNo: number;
  winner: string;
  title: string;
  subtitle: string;
  decisiveLabel: string;
  decisiveDetail: string;
  topSkillLabel: string;
  topSkillDetail: string;
  damageTotal: number;
  healTotal: number;
  shieldTotal: number;
  playerRetired: number;
  opponentRetired: number;
  issueCount: number;
};

const normalizeCombatToken = (value?: string | null) => String(value || '').trim().toLowerCase();

export const getArenaBattleRevealDurationMs = (turnCount: number) =>
  Math.max(ARENA_BATTLE_MIN_REVEAL_MS, Math.max(1, turnCount) * ARENA_BATTLE_TURN_MS + ARENA_BATTLE_RESULT_SETTLE_MS);

const eventMatchesCard = (value: string | undefined, card: ArenaSnapshotCardDto) => {
  const token = normalizeCombatToken(value);
  if (!token) return false;
  return [card.name, card.card_id, card.channel_id].some((candidate) => {
    const normalized = normalizeCombatToken(candidate);
    return normalized && (token === normalized || token.includes(normalized) || normalized.includes(token));
  });
};

const combatElementMatchesToken = (element: Element, value: string | undefined) => {
  const token = normalizeCombatToken(value);
  if (!token) return false;
  const target = element as HTMLElement;
  return [target.dataset.cardId, target.dataset.channelId, target.dataset.cardName].some((candidate) => {
    const normalized = normalizeCombatToken(candidate);
    return normalized && (token === normalized || token.includes(normalized) || normalized.includes(token));
  });
};

const eventMentionsCard = (
  event: ArenaReplayEvent | undefined,
  card: ArenaSnapshotCardDto
) => {
  if (!event) return false;
  return eventMatchesCard(event.actor, card)
    || (event.targets || []).some((target) => eventMatchesCard(target, card))
    || eventMatchesCard(event.message, card);
};

const eventActorMentionsCard = (
  event: ArenaReplayEvent | undefined,
  card: ArenaSnapshotCardDto
) => {
  return eventMatchesCard(event?.actor, card);
};

const eventTargetsCard = (
  event: ArenaReplayEvent | undefined,
  card: ArenaSnapshotCardDto
) => {
  if (!event) return false;
  return (event.targets || []).some((target) => eventMatchesCard(target, card));
};

const eventKillsCard = (
  event: ArenaReplayEvent | undefined,
  card: ArenaSnapshotCardDto
) => {
  if (!event || String(event.type || '').toUpperCase() !== 'DEATH') return false;
  return eventMatchesCard(event.actor, card) || eventTargetsCard(event, card) || eventMatchesCard(event.message, card);
};

const unitStateMatchesCard = (state: ArenaReplayUnitState | undefined, side: 'player' | 'opponent', card: ArenaSnapshotCardDto) => {
  if (!state || state.side !== (side === 'player' ? 'player' : 'bot')) return false;
  return [state.card_id, state.channel_id, state.id].some((value) => eventMatchesCard(value, card));
};

const findUnitState = (unitStates: ArenaReplayUnitState[] | undefined, side: 'player' | 'opponent', card: ArenaSnapshotCardDto) =>
  (unitStates || []).find((state) => unitStateMatchesCard(state, side, card));

const turnTargetsCard = (turn: ArenaBattleTurn | undefined, card: ArenaSnapshotCardDto) => {
  if (!turn) return false;
  return turn.targetIds.some((target) => eventMatchesCard(target, card))
    || turn.events.some((event) => eventMentionsCard(event, card) && !eventActorMentionsCard(event, card));
};

const isControlEvent = (event?: ArenaReplayEvent) => {
  const text = `${event?.type || ''} ${event?.message || ''}`.toLowerCase();
  return ['stun', 'slow', 'control', 'delay', 'debuff', '침묵', '기절', '지연', '약화'].some((token) => text.includes(token));
};

const getEventVfxKind = (event?: ArenaReplayEvent, turn?: ArenaBattleTurn) => {
  const text = `${turn?.actionType || ''} ${event?.type || ''} ${event?.actor || ''} ${event?.message || ''}`.toLowerCase();
  if (['ultimate', 'ult', '궁극'].some((token) => text.includes(token))) return 'ultimate';
  if (['heal', 'recover', 'regen', '회복', '재생'].some((token) => text.includes(token))) return 'heal';
  if (['shield', 'guard', 'barrier', 'protect', '방어', '보호', '장벽'].some((token) => text.includes(token))) return 'guard';
  if (['burn', 'fire', 'ignite', '화상', '불꽃'].some((token) => text.includes(token))) return 'burn';
  if (['poison', 'venom', '독', '중독'].some((token) => text.includes(token))) return 'poison';
  if (['stun', 'slow', 'control', 'delay', 'debuff', '침묵', '기절', '지연', '약화'].some((token) => text.includes(token))) return 'control';
  if (['speed', 'haste', 'tempo', 'quick', '속도', '템포', '가속'].some((token) => text.includes(token))) return 'tempo';
  if (['skill', 'cast', '스킬'].some((token) => text.includes(token))) return 'skill';
  return 'attack';
};

const getCardMaxHealth = (card: ArenaSnapshotCardDto) =>
  Math.max(1, Math.round(700 + Number(card.stats?.hp || 1) * 12));

const estimateCardHealth = (
  card: ArenaSnapshotCardDto,
  side: 'player' | 'opponent',
  events: ArenaReplayEvent[],
  eventIndex: number,
  retired: boolean,
  unitStates?: ArenaReplayUnitState[]
) => {
  const unitState = findUnitState(unitStates, side, card);
  const max = Math.max(1, Number(unitState?.max_hp || getCardMaxHealth(card)));
  if (retired || unitState?.alive === false && eventIndex >= events.length - 1) {
    const finalRemaining = Math.max(0, Number(unitState?.final_hp || 0));
    return { max, remaining: finalRemaining, percent: Math.max(0, Math.min(100, Math.round((finalRemaining / max) * 100))) };
  }
  const visibleEvents = events.slice(0, Math.max(0, eventIndex + 1));
  const remaining = visibleEvents.reduce((hp, event) => {
    const type = String(event.type || '').toUpperCase();
    if (eventKillsCard(event, card)) return 0;
    const eventHpAfter = Number(event.hp_after);
    if (['DAMAGE', 'HEAL', 'SHIELD_GAIN'].includes(type) && eventTargetsCard(event, card) && Number.isFinite(eventHpAfter)) {
      return Math.max(0, Math.min(max, Math.round(eventHpAfter)));
    }
    if (type === 'DAMAGE' && eventTargetsCard(event, card)) {
      return Math.max(0, hp - Math.max(0, Number(event.value || 0)));
    }
    if (type === 'HEAL' && eventTargetsCard(event, card)) {
      return Math.min(max, hp + Math.max(0, Number(event.value || 0)));
    }
    return hp;
  }, Math.max(0, Math.min(max, Number(unitState?.start_hp || max))));
  const displayRemaining = Math.max(0, remaining);
  return { max, remaining: displayRemaining, percent: Math.max(0, Math.min(100, Math.round((displayRemaining / max) * 100))) };
};

const getTurnValueForCard = (turn: ArenaBattleTurn | undefined, card: ArenaSnapshotCardDto) => {
  if (!turn) return 0;
  return turn.events.reduce((total, event) => {
    const type = String(event.type || '').toUpperCase();
    if (!['DAMAGE', 'HEAL', 'SHIELD_GAIN'].includes(type) || !eventTargetsCard(event, card)) return total;
    return total + Math.max(0, Number(event.value || 0));
  }, 0);
};

const buildCombatNameResolver = (cards: ArenaSnapshotCardDto[]) => {
  const entries = cards.flatMap((card) => [
    [normalizeCombatToken(card.card_id), card.name] as const,
    [normalizeCombatToken(card.channel_id), card.name] as const,
    [normalizeCombatToken(card.name), card.name] as const
  ]);
  const lookup = new Map(entries.filter(([key]) => Boolean(key)));
  return (value?: string) => {
    const normalized = normalizeCombatToken(value);
    if (!normalized) return '';
    return lookup.get(normalized) || value || '';
  };
};

const buildArenaRoundHighlights = (
  rounds: ArenaReplayRound[],
  playerDeck?: ArenaDeckSnapshotDto,
  opponentDeck?: ArenaDeckSnapshotDto,
  diagnostics?: ArenaBattleTimelineDiagnostic['rounds']
): ArenaRoundHighlight[] => {
  const allCards = [...(playerDeck?.cards || []), ...(opponentDeck?.cards || [])];
  const resolveName = buildCombatNameResolver(allCards);
  const diagnosticByRound = new Map((diagnostics || []).map((round) => [Number(round.roundNo), round]));

  return (rounds || [])
    .slice()
    .sort((a, b) => Number(a.round_no || 0) - Number(b.round_no || 0))
    .slice(0, 5)
    .map((round) => {
      const events = round.events || [];
      const turns = buildArenaBattleTurns(events as ArenaReplayEvent[]);
      const valueEvents = events.map((event) => ({
        event,
        type: String(event.type || '').toUpperCase(),
        value: Math.max(0, Number(event.value || 0))
      }));
      const damageEvents = valueEvents.filter((item) => item.type === 'DAMAGE' && item.value > 0);
      const healEvents = valueEvents.filter((item) => item.type === 'HEAL' && item.value > 0);
      const shieldEvents = valueEvents.filter((item) => item.type === 'SHIELD_GAIN' && item.value > 0);
      const deathEvent = [...events].reverse().find((event) => String(event.type || '').toUpperCase() === 'DEATH');
      const biggestDamage = [...damageEvents].sort((a, b) => b.value - a.value)[0]?.event;
      const topSkillTurn = [...turns]
        .filter((turn) => turn.actionType === 'skill')
        .sort((a, b) => b.value - a.value)[0];
      const decisiveEvent = deathEvent || biggestDamage || topSkillTurn?.primary || events[events.length - 1];
      const decisiveActor = resolveName(decisiveEvent?.actor) || decisiveEvent?.actor || '전투 카드';
      const decisiveTarget = decisiveEvent?.targets?.map(resolveName).filter(Boolean).slice(0, 2).join(', ');
      const decisiveValue = Math.max(0, Number(decisiveEvent?.value || 0));
      const decisiveType = String(decisiveEvent?.type || '').toUpperCase();
      const decisiveLabel = decisiveType === 'DEATH'
        ? `${decisiveActor} 전투불능`
        : decisiveTarget
          ? `${decisiveActor} -> ${decisiveTarget}`
          : decisiveActor;
      const decisiveDetail = decisiveType === 'DEATH'
        ? decisiveEvent?.message || '마지막 전투불능이 라운드 흐름을 결정했습니다.'
        : decisiveValue > 0
          ? `${decisiveValue.toLocaleString()} 효과 · ${decisiveEvent?.message || decisiveType || '주요 행동'}`
          : decisiveEvent?.message || '라운드 후반 행동이 승부를 갈랐습니다.';
      const topSkillLabel = topSkillTurn?.skillName || topSkillTurn?.primary.message || '주요 스킬 없음';
      const topSkillActor = resolveName(topSkillTurn?.actor) || topSkillTurn?.actor || '카드';
      const topSkillDetail = topSkillTurn
        ? `${topSkillActor} · ${Math.max(0, Number(topSkillTurn.value || 0)).toLocaleString()} 효과`
        : '기본 공격과 배치 싸움으로 진행된 라운드입니다.';
      const playerRetired = (round.unit_states || []).filter((state) => state.side === 'player' && !state.alive).length;
      const opponentRetired = (round.unit_states || []).filter((state) => state.side === 'bot' && !state.alive).length;
      const winner = round.winner_side || 'draw';
      const advantageText = winner === 'player'
        ? `${opponentRetired}장을 전투불능으로 만들며 우위를 잡았습니다.`
        : winner === 'bot'
          ? `${playerRetired}장이 전투불능이 되며 흐름을 내줬습니다.`
          : '양쪽 모두 결정적인 우위를 만들지 못했습니다.';
      const diagnostic = diagnosticByRound.get(Number(round.round_no || 0));

      return {
        roundNo: Number(round.round_no || 0),
        winner,
        title: `${Number(round.round_no || 0)}라운드 · ${winnerLabel(winner)}`,
        subtitle: advantageText,
        decisiveLabel,
        decisiveDetail,
        topSkillLabel,
        topSkillDetail,
        damageTotal: damageEvents.reduce((total, item) => total + item.value, 0),
        healTotal: healEvents.reduce((total, item) => total + item.value, 0),
        shieldTotal: shieldEvents.reduce((total, item) => total + item.value, 0),
        playerRetired,
        opponentRetired,
        issueCount: diagnostic?.issues.length || 0
      };
    });
};

const getTurnActionLabel = (turn?: ArenaBattleTurn) => {
  if (!turn) return '전투 대기';
  if (turn.actionType === 'start') return '라운드 시작';
  if (turn.actionType === 'skill') return turn.skillName || '스킬 사용';
  if (turn.actionType === 'heal') return '회복';
  if (turn.actionType === 'guard') return '보호';
  if (turn.actionType === 'control') return '제어 효과';
  if (turn.actionType === 'retire') return '전투 불능';
  if (turn.actionType === 'attack') return '기본 공격';
  return '전투 효과';
};

const getTurnCaption = (turn: ArenaBattleTurn | undefined, resolveName: (value?: string) => string) => {
  if (!turn) return '카드 배치와 전술 선택이 전투 흐름을 만듭니다.';
  if (turn.actionType === 'start') return turn.primary.message || '라운드가 시작되었습니다.';
  const actorName = resolveName(turn.actor) || turn.primary.actor || '전투 카드';
  const targetNames = turn.targetIds.map(resolveName).filter(Boolean);
  const targetLabel = targetNames.length > 0 ? targetNames.slice(0, 2).join(', ') : '대상';
  const turnText = turn.events.map((event) => `${event.type || ''} ${event.message || ''}`).join(' ').toLowerCase();
  const positiveEffect = turn.actionType === 'heal'
    || turn.actionType === 'guard'
    || turnText.includes('heal')
    || turnText.includes('shield')
    || turnText.includes('guard')
    || turnText.includes('회복')
    || turnText.includes('보호');
  const suffix = turn.value > 0
    ? positiveEffect
      ? ` +${turn.value}`
      : ` ${turn.value}`
    : '';
  return `${actorName} → ${targetLabel}${suffix}`;
};

const findCombatCardSide = (
  value: string | undefined,
  playerCards: ArenaSnapshotCardDto[],
  opponentCards: ArenaSnapshotCardDto[]
) => {
  if (!value) return null;
  if (playerCards.some((card) => eventMatchesCard(value, card))) return 'player';
  if (opponentCards.some((card) => eventMatchesCard(value, card))) return 'opponent';
  return null;
};

const getTurnVfxKind = (turn?: ArenaBattleTurn) => {
  if (!turn) return 'idle';
  const text = turn.events.map((event) => `${event.type || ''} ${event.message || ''}`).join(' ').toLowerCase();
  if (turn.actionType === 'heal' || text.includes('heal') || text.includes('회복')) return 'heal';
  if (turn.actionType === 'guard' || text.includes('shield') || text.includes('guard') || text.includes('보호')) return 'guard';
  if (turn.actionType === 'control' || text.includes('stun') || text.includes('slow') || text.includes('기절') || text.includes('지연')) return 'control';
  if (text.includes('ultimate') || text.includes('ult') || text.includes('궁극')) return 'ultimate';
  if (turn.actionType === 'skill' || text.includes('skill_cast')) return 'skill';
  if (turn.actionType === 'retire' || text.includes('death')) return 'retire';
  if (turn.actionType === 'attack') return 'attack';
  return 'effect';
};

const ArenaCombatPortrait: React.FC<{
  label: string;
  caption: string;
  avatarUrl?: string | null;
  loadout?: ArenaCosmeticLoadout | null;
  side: 'player' | 'opponent';
}> = ({ label, caption, avatarUrl, loadout, side }) => {
  const border = loadout?.border_item || null;
  const nameEffect = loadout?.name_effect_item || null;
  const borderClassName = borderClass(border);
  const nameClassName = nameEffectClass(nameEffect);
  return (
    <div className={`arena-combat-portrait is-${side}`}>
      <div className={`arena-combat-portrait-frame ${borderClassName}`.trim()} style={borderClassName ? undefined : borderStyle(border)}>
        {avatarUrl ? (
          <img src={proxiedImage(avatarUrl, { width: 96, quality: 78 })} alt="" className="h-full w-full rounded-[1.15rem] object-cover" referrerPolicy="no-referrer" />
        ) : (
          <span className="text-lg font-black text-primary">{label.slice(0, 1)}</span>
        )}
      </div>
      <div className="min-w-0">
        <p className={`truncate text-xs font-black text-foreground ${nameClassName}`.trim()} style={nameClassName ? undefined : nameEffectStyle(nameEffect)}>
          {label}
        </p>
        <p className="mt-0.5 truncate text-[10px] font-bold text-muted-foreground">{caption}</p>
      </div>
    </div>
  );
};

const ArenaCombatCard: React.FC<{
  card: ArenaSnapshotCardDto;
  side: 'player' | 'opponent';
  slot: SelectedRoundSlot;
  visualIndex: number;
  activeTurn?: ArenaBattleTurn;
  activeEvent?: ArenaReplayEvent;
  battleEvents: ArenaReplayEvent[];
  unitStates?: ArenaReplayUnitState[];
  battleEventIndex: number;
  roundReveal: RoundRevealState | null;
  retired: boolean;
  skillLookup: Map<string, ArenaRuleSkill>;
  classLookup: Map<string, ArenaRuleClass>;
}> = ({ card, side, slot, visualIndex, activeTurn, activeEvent, battleEvents, unitStates, battleEventIndex, roundReveal, retired, skillLookup, classLookup }) => {
  const cardRef = React.useRef<HTMLElement | null>(null);
  const isBattle = roundReveal?.stage === 'battle';
  const rawActing = Boolean(isBattle && activeTurn && activeTurn.actor && eventMatchesCard(activeTurn.actor, card));
  const rawTargeted = Boolean(isBattle && activeTurn && turnTargetsCard(activeTurn, card));
  const activeTurnEventIndices = activeTurn?.events.map((event) => battleEvents.indexOf(event)).filter((index) => index >= 0) || [];
  const activeTurnStartCursor = activeTurnEventIndices.length > 0 ? Math.min(...activeTurnEventIndices) : battleEventIndex;
  const activeEventCursor = activeTurnEventIndices.length > 0 ? Math.max(...activeTurnEventIndices) : battleEventIndex;
  const healthBeforeTurn = estimateCardHealth(card, side, battleEvents, activeTurnStartCursor - 1, retired, unitStates);
  const eliminatedBeforeTurn = isBattle && healthBeforeTurn.remaining <= 0;
  const acting = rawActing && !eliminatedBeforeTurn;
  const targeted = rawTargeted && !eliminatedBeforeTurn;
  const activeTurnText = activeTurn?.events.map((event) => `${event.type || ''} ${event.message || ''}`).join(' ').toLowerCase() || '';
  const turnHasHeal = activeTurnText.includes('heal') || activeTurnText.includes('회복');
  const turnHasGuard = activeTurnText.includes('shield') || activeTurnText.includes('guard') || activeTurnText.includes('보호') || activeTurnText.includes('방어');
  const turnHasDamage = activeTurnText.includes('damage') || activeTurnText.includes('basic_attack') || activeTurnText.includes('death');
  const healed = targeted && turnHasHeal;
  const guarded = targeted && !healed && turnHasGuard;
  const hit = targeted && !acting && !healed && !guarded && (turnHasDamage || ['attack', 'skill', 'control', 'retire', 'effect'].includes(activeTurn?.actionType || ''));
  const skillEvent = acting && activeTurn?.actionType === 'skill';
  const controlEvent = targeted && (activeTurn?.actionType === 'control' || activeTurn?.events.some(isControlEvent));
  const vfxKind = acting || targeted || controlEvent ? getEventVfxKind(activeEvent, activeTurn) : 'idle';
  const health = estimateCardHealth(card, side, battleEvents, activeEventCursor, retired, unitStates);
  const displayRetired = retired || (isBattle && health.remaining <= 0);
  const currentValue = getTurnValueForCard(activeTurn, card);
  const waitingTurn = Boolean(isBattle && activeTurn && !acting && !targeted && !eliminatedBeforeTurn);
  const turnParity = battleEventIndex % 2 === 0 ? 'is-turn-even' : 'is-turn-odd';
  const actionClass = activeTurn?.actionType ? `is-action-${activeTurn.actionType}` : 'is-action-idle';
  const heavyImpact = Boolean(activeTurn && ['skill', 'control', 'retire'].includes(activeTurn.actionType)) || vfxKind === 'ultimate';
  const statusLabel = retired
    ? 'RETIRE'
    : healed
      ? `+${currentValue || 'HEAL'}`
      : guarded
        ? `+${currentValue || 'GUARD'}`
        : hit
          ? `-${currentValue || 'HIT'}`
          : controlEvent
            ? '상태 이상'
            : skillEvent
              ? (activeTurn?.skillName || 'SKILL')
              : acting
                ? '공격'
                : '';
  React.useLayoutEffect(() => {
    const element = cardRef.current;
    if (!element) return;
    const strikeProperties = ['--strike-windup-x', '--strike-windup-y', '--strike-near-x', '--strike-near-y', '--strike-hit-x', '--strike-hit-y', '--strike-smash-x', '--strike-smash-y', '--strike-exit-x', '--strike-exit-y', '--strike-recoil-x', '--strike-recoil-y', '--strike-angle'];
    if (!acting || activeTurn?.actionType !== 'attack') {
      strikeProperties.forEach((property) => element.style.removeProperty(property));
      return;
    }
    strikeProperties.forEach((property) => element.style.removeProperty(property));
    const targetElement = Array.from(document.querySelectorAll('[data-arena-combat-card="true"]'))
      .find((candidate) => candidate !== element && activeTurn.targetIds.some((target) => combatElementMatchesToken(candidate, target))) as HTMLElement | undefined;
    if (!targetElement) return;
    const actorRect = element.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    const actorCenterX = actorRect.left + actorRect.width / 2;
    const actorCenterY = actorRect.top + actorRect.height / 2;
    const targetCenterX = targetRect.left + targetRect.width / 2;
    const targetCenterY = targetRect.top + targetRect.height / 2;
    const centerDx = targetCenterX - actorCenterX;
    const centerDy = targetCenterY - actorCenterY;
    const distance = Math.max(1, Math.hypot(centerDx, centerDy));
    const unitX = centerDx / distance;
    const unitY = centerDy / distance;
    const actorHalfOnPath = Math.abs(unitX) * actorRect.width / 2 + Math.abs(unitY) * actorRect.height / 2;
    const targetHalfOnPath = Math.abs(unitX) * targetRect.width / 2 + Math.abs(unitY) * targetRect.height / 2;
    const contactDistance = Math.max(0, distance - actorHalfOnPath * 0.82 - targetHalfOnPath * 0.72);
    const smashDistance = Math.min(distance, contactDistance + Math.min(18, Math.max(8, targetHalfOnPath * 0.22)));
    const hitX = unitX * contactDistance;
    const hitY = unitY * contactDistance;
    const smashX = unitX * smashDistance;
    const smashY = unitY * smashDistance;
    const strikeAngle = Math.round(Math.atan2(unitY, unitX) * 180 / Math.PI);
    element.style.setProperty('--strike-windup-x', `${Math.round(unitX * -10)}px`);
    element.style.setProperty('--strike-windup-y', `${Math.round(unitY * -10)}px`);
    element.style.setProperty('--strike-near-x', `${Math.round(hitX * 0.78)}px`);
    element.style.setProperty('--strike-near-y', `${Math.round(hitY * 0.78)}px`);
    element.style.setProperty('--strike-hit-x', `${Math.round(hitX)}px`);
    element.style.setProperty('--strike-hit-y', `${Math.round(hitY)}px`);
    element.style.setProperty('--strike-smash-x', `${Math.round(smashX)}px`);
    element.style.setProperty('--strike-smash-y', `${Math.round(smashY)}px`);
    element.style.setProperty('--strike-angle', `${strikeAngle}deg`);
    element.style.setProperty('--strike-exit-x', `${Math.round(hitX * 0.56)}px`);
    element.style.setProperty('--strike-exit-y', `${Math.round(hitY * 0.56)}px`);
    element.style.setProperty('--strike-recoil-x', `${Math.round(unitX * -8)}px`);
    element.style.setProperty('--strike-recoil-y', `${Math.round(unitY * -8)}px`);
  }, [acting, activeTurn?.id, activeTurn?.actionType, activeTurn?.targetIds, battleEventIndex]);
  return (
    <article
      ref={cardRef}
      data-arena-combat-card="true"
      data-card-id={card.card_id}
      data-channel-id={card.channel_id}
      data-card-name={card.name}
      data-retired={displayRetired ? 'true' : undefined}
      className={`arena-combat-card is-${side} ${slot.row === 1 ? 'is-frontline' : 'is-backline'} ${turnParity} ${actionClass} ${acting ? 'is-acting' : ''} ${targeted ? 'is-targeted' : ''} ${waitingTurn ? 'is-waiting-turn' : ''} ${hit ? 'is-hit' : ''} ${healed ? 'is-healed' : ''} ${guarded ? 'is-guarded' : ''} ${skillEvent ? 'is-skill' : ''} ${controlEvent ? 'is-control' : ''} ${heavyImpact ? 'is-heavy-impact' : ''} vfx-${vfxKind} ${displayRetired ? 'is-retired' : ''}`.trim()}
      style={{ ['--combat-delay' as any]: `${visualIndex * 90}ms` }}
    >
      <div className="arena-combat-card-media">
        {card.image_url ? <img src={card.image_url} alt="" className="h-full w-full object-contain" loading="lazy" /> : null}
      </div>
      <div className="arena-combat-card-body">
        <p className="truncate text-[10px] font-black text-foreground">{card.name}</p>
        <ArenaInfoTooltip label={card.class_name} description={getClassDescription(card, classLookup)}>
          <span className="mt-0.5 block cursor-help truncate text-[9px] font-bold text-muted-foreground">{card.class_name}</span>
        </ArenaInfoTooltip>
        <div className="mt-1 flex items-center gap-1">
          {(card.skills || []).slice(0, 3).map((skill) => (
            <ArenaInfoTooltip key={skill.id} label={`${skill.name} (${arenaSkillSlotLabels[skill.type] || skill.type})`} description={getSkillDescription(skill, skillLookup)}>
              <span className="h-1.5 w-1.5 cursor-help rounded-full bg-primary/80 shadow-sm shadow-primary/30" />
            </ArenaInfoTooltip>
          ))}
        </div>
      </div>
      <div className="arena-combat-hp">
        <span style={{ width: `${health.percent}%` }} />
      </div>
      <div className="arena-combat-hp-text">{health.remaining}/{health.max}</div>
      <div className="arena-combat-turn-timer" aria-hidden="true" />
      {statusLabel ? (
        <div
          key={`${card.card_id}-${battleEventIndex}-${statusLabel}`}
          className={`arena-combat-float ${hit ? 'is-damage' : healed ? 'is-heal' : guarded ? 'is-guard' : retired ? 'is-retire' : controlEvent ? 'is-control' : 'is-action'}`}
        >
          {statusLabel}
        </div>
      ) : null}
      <div className="arena-combat-contact-flash" aria-hidden="true" />
      <div className="arena-combat-vfx" />
      <div className="arena-combat-strike-edge" aria-hidden="true" />
      <div className="arena-combat-energy-ring" aria-hidden="true" />
      <div className="arena-combat-speed-lines" aria-hidden="true" />
      <div key={`${card.card_id}-${activeTurn?.id || battleEventIndex}-sparks`} className="arena-combat-hit-sparks is-motion-sparks" aria-hidden="true">
        {hit ? ARENA_CARD_HIT_SPARKS.map((spark, index) => (
          <motion.span
            key={index}
            initial={{ opacity: 0, x: '-50%', y: '-50%', scale: 0.28, rotate: 0 }}
            animate={{ opacity: [0, 1, 0], x: `calc(-50% + ${spark.x}px)`, y: `calc(-50% + ${spark.y}px)`, scale: [0.45, 1.18, 0.1], rotate: spark.rotate }}
            transition={{ duration: vfxKind === 'ultimate' ? 0.42 : 0.34, delay: 0.2 + spark.delay, ease: [0.12, 0.86, 0.18, 1] }}
          />
        )) : null}
      </div>
    </article>
  );
};

const ArenaCombatFormation: React.FC<{
  side: 'player' | 'opponent';
  cards: ArenaSnapshotCardDto[];
  slots: SelectedRoundSlot[];
  revealed?: boolean;
  activeTurn?: ArenaBattleTurn;
  activeEvent?: ArenaReplayEvent;
  battleEvents: ArenaReplayEvent[];
  unitStates?: ArenaReplayUnitState[];
  battleEventIndex: number;
  roundReveal: RoundRevealState | null;
  remainingUnits?: number;
  skillLookup: Map<string, ArenaRuleSkill>;
  classLookup: Map<string, ArenaRuleClass>;
}> = ({ side, cards, slots, revealed = true, activeTurn, activeEvent, battleEvents, unitStates, battleEventIndex, roundReveal, remainingUnits, skillLookup, classLookup }) => {
  const positioned = getCardBySlots(cards, slots);
  const displayRows = side === 'opponent'
    ? [{ label: '후열', row: 0 as const }, { label: '전열', row: 1 as const }]
    : [{ label: '전열', row: 1 as const }, { label: '후열', row: 0 as const }];
  return (
    <div className={`arena-combat-formation is-${side}`} aria-label={side === 'player' ? '내 전투 진영' : '상대 전투 진영'}>
      <div className="arena-combat-lane-labels" aria-hidden="true">
        {displayRows.map((row) => <span key={row.row} className={row.row === 1 ? 'is-frontline' : ''}>{row.label}</span>)}
      </div>
      <div className="arena-combat-grid">
        {displayRows.map(({ row }) => [0, 1, 2].map((col) => {
          const item = positioned.find((entry) => entry.slot.row === row && entry.slot.col === col);
          return (
            <div key={`${row}-${col}`} className={`arena-combat-cell ${row === 1 ? 'is-frontline' : 'is-backline'}`}>
              {!revealed && side === 'opponent' ? (
                <div className="arena-combat-card is-hidden-card">
                  <div className="arena-hidden-card-mark">?</div>
                  <p className="text-[10px] font-black text-muted-foreground">비공개</p>
                </div>
              ) : item ? (
                <ArenaCombatCard
                  card={item.card}
                  side={side}
                  slot={item.slot}
                  visualIndex={item.visualIndex}
                  activeTurn={activeTurn}
                  activeEvent={activeEvent}
                  battleEvents={battleEvents}
                  unitStates={unitStates}
                  battleEventIndex={battleEventIndex}
                  roundReveal={roundReveal}
                  retired={roundReveal?.stage === 'result' && (findUnitState(unitStates, side, item.card)?.alive === false || (!findUnitState(unitStates, side, item.card) && battleEvents.some((event) => eventKillsCard(event, item.card))))}
                  skillLookup={skillLookup}
                  classLookup={classLookup}
                />
              ) : null}
            </div>
          );
        }))}
      </div>
    </div>
  );
};

export const ArenaBattleStage: React.FC<{
  match: ArenaMatchViewDto;
  playerCards: ArenaSnapshotCardDto[];
  opponentCards: ArenaSnapshotCardDto[];
  playerSlots: SelectedRoundSlot[];
  opponentSlots: SelectedRoundSlot[];
  activeTurn?: ArenaBattleTurn;
  activeEvent?: ArenaReplayEvent;
  battleEvents: ArenaReplayEvent[];
  unitStates?: ArenaReplayUnitState[];
  battleEventIndex: number;
  revealOpponent: boolean;
  roundReveal: RoundRevealState | null;
  roundResult?: ArenaRoundResultDto;
  skillLookup: Map<string, ArenaRuleSkill>;
  classLookup: Map<string, ArenaRuleClass>;
  user: any;
  loadout: ArenaCosmeticLoadout | null;
  displayPlayerRoundWins?: number;
  displayOpponentRoundWins?: number;
}> = ({ match, playerCards, opponentCards, playerSlots, opponentSlots, activeTurn, activeEvent, battleEvents, unitStates, battleEventIndex, revealOpponent, roundReveal, roundResult, skillLookup, classLookup, user, loadout, displayPlayerRoundWins, displayOpponentRoundWins }) => {
  return (
    <div className={`arena-battle-stage ${roundReveal?.stage === 'battle' ? 'is-playing' : ''} ${roundReveal?.stage === 'result' ? 'is-result' : ''}`}>
      <div className="arena-battle-stage-bg" />
      <ArenaPixiBattleRenderer
        match={match}
        playerCards={playerCards}
        opponentCards={opponentCards}
        playerSlots={playerSlots}
        opponentSlots={opponentSlots}
        activeTurn={activeTurn}
        battleEvents={battleEvents}
        unitStates={unitStates}
        battleEventIndex={battleEventIndex}
        revealOpponent={revealOpponent}
        roundReveal={roundReveal}
        roundResult={roundResult}
        skillLookup={skillLookup}
        classLookup={classLookup}
        user={user}
        loadout={loadout}
        displayPlayerRoundWins={displayPlayerRoundWins}
        displayOpponentRoundWins={displayOpponentRoundWins}
      />
    </div>
  );
};

const StateNotice: React.FC<{
  title: string;
  description: string;
  variant?: 'default' | 'error';
  actionLabel?: string;
  onAction?: () => void;
  loading?: boolean;
}> = ({ title, description, variant = 'default', actionLabel, onAction, loading }) => (
  <div className={`arena-status-row rounded-[2rem] border p-5 ${
    variant === 'error'
      ? 'border-red-200 bg-red-50/80 dark:border-red-300/20 dark:bg-red-300/10'
      : 'border-border bg-card/70'
  }`}>
    <div className="flex items-start gap-3">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
        variant === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-300/10 dark:text-red-100' : 'bg-primary/10 text-primary'
      }`}>
        {variant === 'error' ? <AlertCircle className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-black text-foreground">{title}</p>
        <p className="mt-1 text-xs font-bold leading-relaxed text-muted-foreground">{description}</p>
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            disabled={loading}
            className="cute-wiggle-hover mt-3 inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-xs font-black text-primary-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  </div>
);

const SkeletonRows = () => (
  <div className="grid gap-3">
    {[0, 1, 2].map((item) => (
      <div key={item} className="h-24 animate-pulse rounded-[2rem] border border-border bg-secondary/45" />
    ))}
  </div>
);

export const ArenaMatchPageClient: React.FC<{ matchId?: string | null }> = ({ matchId }) => {
  const router = useRouter();
  const { user, toast } = useApp();

  const [match, setMatch] = React.useState<ArenaMatchViewDto | null>(null);
  const [replay, setReplay] = React.useState<ArenaReplayPayloadDto | null>(null);
  const [rules, setRules] = React.useState<ArenaRulesCatalogDto | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [roundLoading, setRoundLoading] = React.useState(false);
  const [roundWait, setRoundWait] = React.useState<RoundWaitState | null>(null);
  const [roundWaitNow, setRoundWaitNow] = React.useState(() => Date.now());
  const [roundReveal, setRoundReveal] = React.useState<RoundRevealState | null>(null);
  const [tacticStyle, setTacticStyle] = React.useState('balanced');
  const [focusRule, setFocusRule] = React.useState('frontline_first');
  const [strategyChipId, setStrategyChipId] = React.useState('none');
  const [selectedSlots, setSelectedSlots] = React.useState<SelectedRoundSlot[]>([]);
  const [draggingCardId, setDraggingCardId] = React.useState<string | null>(null);
  const [battleEventIndex, setBattleEventIndex] = React.useState(0);
  const [cosmeticLoadout, setCosmeticLoadout] = React.useState<ArenaCosmeticLoadout | null>(null);
  const [shareLoading, setShareLoading] = React.useState(false);
  const [resultModalOpen, setResultModalOpen] = React.useState(false);
  const [selectedReplayRoundNo, setSelectedReplayRoundNo] = React.useState<number | null>(null);
  const [replayPlaybackActive, setReplayPlaybackActive] = React.useState(false);
  const [roundSkipRequested, setRoundSkipRequested] = React.useState(false);
  const [roundSkipStatus, setRoundSkipStatus] = React.useState<{ roundNo: number; skipped: number; required: number; ready: boolean } | null>(null);
  const [arenaRealtimeReady, setArenaRealtimeReady] = React.useState(false);
  const revealTimerRef = React.useRef<number | null>(null);
  const arenaRealtimeRef = React.useRef<WebSocket | null>(null);
  const arenaRealtimeReconnectRef = React.useRef<number | null>(null);
  const finishBattleRevealRef = React.useRef<((source?: 'local' | 'both') => void) | null>(null);
  const pageStartedAtRef = React.useRef(typeof performance !== 'undefined' ? performance.now() : Date.now());
  const performanceSampleSentRef = React.useRef(false);

  const moveArenaTab = React.useCallback((tab: ArenaSiteTab) => {
    router.push(arenaTabHref[tab] || '/arena/play');
  }, [router]);

  const applyMatchDefaults = React.useCallback((nextMatch: ArenaMatchViewDto | null) => {
    if (!nextMatch) return;
    const nextRoundNo = getNextRoundNo(nextMatch);
    const nextPlan = getRoundPlan(nextMatch.summary?.player_deck, nextRoundNo);
    setTacticStyle(nextPlan?.tactic_style || 'balanced');
    setFocusRule(nextPlan?.focus_rule || 'frontline_first');
    setStrategyChipId(nextMatch.summary?.player_deck?.strategy_chip_id || 'none');
    const pending = nextMatch.summary?.pending_round_input;
    const pendingSideInput = pending?.round_no === nextRoundNo
      ? nextMatch.player_b_id === user?.id
        ? (pending.player_b as { slots?: unknown } | undefined)
        : (pending.player_a as { slots?: unknown } | undefined)
      : undefined;
    const pendingSlots = getInputSlots(nextMatch.summary?.player_deck, pendingSideInput?.slots);
    setSelectedSlots(pendingSlots.length > 0 ? pendingSlots : getRoundSlots(nextMatch.summary?.player_deck, nextRoundNo));
    setRoundWait(pending?.deadline_at ? { roundNo: pending.round_no, deadlineAt: pending.deadline_at } : null);
  }, [user?.id]);

  const loadMatch = React.useCallback(async () => {
    if (!matchId) return;
    setLoading(true);
    setError(null);
    try {
      if (matchId === ARENA_VFX_PREVIEW_MATCH_ID) {
        const previewMatch = buildArenaPreviewMatch('ultimate', 1, ARENA_VFX_PREVIEW_MATCH_ID);
        setMatch(previewMatch);
        setRules(ARENA_PREVIEW_RULES_CATALOG);
        setReplay(buildArenaPreviewReplay('ultimate', ARENA_VFX_PREVIEW_MATCH_ID));
        applyMatchDefaults(previewMatch);
        setLoading(false);
        return;
      }

      const [matchRes, rulesRes] = await Promise.all([
        apiFetch(`/arena/matches/${encodeURIComponent(matchId)}`),
        apiFetch('/arena/rules/catalog')
      ]);
      const matchData = await matchRes.json().catch(() => ({}));
      if (!matchRes.ok) throw new Error(matchData.message || '아레나 매치를 불러오지 못했습니다.');
      const nextMatch = (matchData.data?.match || matchData.data) as ArenaMatchViewDto | null;
      setMatch(nextMatch);
      applyMatchDefaults(nextMatch);

      const rulesData = await rulesRes.json().catch(() => ({}));
      if (rulesRes.ok) setRules(rulesData.data || null);

      if (nextMatch && isArenaMatchCompleted(nextMatch)) {
        const replayRes = await apiFetch(`/arena/matches/${encodeURIComponent(nextMatch.id)}/replay`);
        const replayData = await replayRes.json().catch(() => ({}));
        if (replayRes.ok) setReplay(replayData.data || null);
      } else {
        setReplay({ match_id: nextMatch?.id || matchId, match_format: 'best_of_five', rounds_to_win: 3, replay_storage: 'tick_events', rounds: [] });
      }
    } catch (err: any) {
      setError(err?.message || '아레나 매치를 불러오지 못했습니다.');
      setMatch(null);
    } finally {
      setLoading(false);
    }
  }, [applyMatchDefaults, matchId]);

  React.useEffect(() => {
    loadMatch();
    return () => {
      if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
    };
  }, [loadMatch]);

  React.useEffect(() => {
    if (!roundWait) return;
    setRoundWaitNow(Date.now());
    const timer = window.setInterval(() => setRoundWaitNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [roundWait?.deadlineAt, roundWait?.roundNo]);

  React.useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    apiFetch('/arena/cosmetics/loadout')
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })).catch(() => ({ ok: res.ok, data: {} })))
      .then(({ ok, data }) => {
        if (!cancelled && ok) setCosmeticLoadout((data as any).data || null);
      })
      .catch(() => {
        if (!cancelled) setCosmeticLoadout(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  React.useEffect(() => {
    ensureCosmeticCss(cosmeticLoadout?.border_item || null);
    ensureCosmeticCss(cosmeticLoadout?.name_effect_item || null);
    ensureFont(cosmeticLoadout?.name_effect_item?.font_url, cosmeticLoadout?.name_effect_item?.font_family);
  }, [cosmeticLoadout?.border_item, cosmeticLoadout?.name_effect_item]);

  const nextRoundNo = getNextRoundNo(match);
  const isLocalPreviewMatch = matchId === ARENA_VFX_PREVIEW_MATCH_ID || match?.id === ARENA_VFX_PREVIEW_MATCH_ID;
  const battleUser = isLocalPreviewMatch
    ? { id: 'arena-vfx-preview', username: 'VFX 프리뷰', profile_image_url: '/arena-icon.png', avatarUrl: '/arena-icon.png' }
    : user;
  const battleLoadout = isLocalPreviewMatch ? ARENA_PREVIEW_LOADOUT : cosmeticLoadout;
  const completed = isArenaMatchCompleted(match);
  const playerDeck = match?.summary?.player_deck;
  const opponentDeck = getOpponentDeck(match);
  const combatNameResolver = React.useMemo(
    () => buildCombatNameResolver([...(playerDeck?.cards || []), ...(opponentDeck?.cards || [])]),
    [opponentDeck?.cards, playerDeck?.cards]
  );
  const playerCardById = React.useMemo(() => new Map((playerDeck?.cards || []).map((card) => [card.card_id, card])), [playerDeck?.cards]);
  const skillLookup = React.useMemo(() => new Map(((rules?.skills || []) as ArenaRuleSkill[]).map((skill) => [skill.id, skill])), [rules?.skills]);
  const classLookup = React.useMemo(() => {
    const pairs = ((rules?.classes || []) as ArenaRuleClass[]).flatMap((cardClass) => {
      const keys = [cardClass.id, cardClass.class_id].filter(Boolean) as string[];
      return keys.map((key) => [key, cardClass] as const);
    });
    return new Map(pairs);
  }, [rules?.classes]);
  const orderedSelectedSlots = orderRoundSlots(selectedSlots);
  const selectedPlayerCards = orderedSelectedSlots
    .map((slot) => playerCardById.get(slot.card_id))
    .filter((card): card is ArenaSnapshotCardDto => Boolean(card));
  const playerCards = selectedPlayerCards.length > 0 ? selectedPlayerCards : getRoundCards(playerDeck, nextRoundNo);
  const roundResults = match?.summary?.round_results || [];
  const replayRounds = React.useMemo(
    () => (replay?.rounds || []).slice().sort((a, b) => Number(a.round_no || 0) - Number(b.round_no || 0)),
    [replay?.rounds]
  );
  const latestReplayRound = replayRounds[replayRounds.length - 1];
  const selectedReplayRound = React.useMemo(() => {
    if (roundReveal?.roundNo) {
      return replayRounds.find((round) => Number(round.round_no) === Number(roundReveal.roundNo)) || latestReplayRound;
    }
    if (selectedReplayRoundNo !== null) {
      return replayRounds.find((round) => Number(round.round_no) === selectedReplayRoundNo) || latestReplayRound;
    }
    return latestReplayRound;
  }, [latestReplayRound, replayRounds, roundReveal?.roundNo, selectedReplayRoundNo]);
  const battleRoundNo = roundReveal?.roundNo || (selectedReplayRound?.round_no ?? nextRoundNo);
  const visibleEvents = (selectedReplayRound?.events || []).slice(-18).reverse();
  const activeBattleEvents = selectedReplayRound?.events || [];
  const activeUnitStates = selectedReplayRound?.unit_states || [];
  const activeBattleTurns = React.useMemo(() => buildArenaBattleTurns(activeBattleEvents), [activeBattleEvents]);
  const activeBattleTurn = activeBattleTurns.length > 0 ? activeBattleTurns[Math.min(battleEventIndex, activeBattleTurns.length - 1)] : undefined;
  const activeBattleEvent = activeBattleTurn?.primary;
  const activeBattleTurnSummary = React.useMemo(() => summarizeArenaBattleTurn(activeBattleTurn), [activeBattleTurn]);
  const battleRevealDurationMs = getArenaBattleRevealDurationMs(activeBattleTurns.length);
  const waitMs = roundWait ? Math.max(0, new Date(roundWait.deadlineAt).getTime() - roundWaitNow) : 0;
  const waitSec = Math.ceil(waitMs / 1000);
  const canForceRound = Boolean(roundWait && waitMs <= 0);
  const battlefield = match?.summary?.battlefield_rule;
  const tacticChips = rules?.tactic_chips || [];
  const selectionLocked = completed || roundLoading || Boolean(roundWait) || roundReveal?.stage === 'battle';
  const canCommitWithSelection = selectedSlots.length === ARENA_ACTIVE_SLOT_COUNT || canForceRound;
  const revealOpponentFormation = completed || Boolean(roundReveal) || roundResults.some((round) => Number(round.round_no) === Number(battleRoundNo));
  const playerBattleCards = revealOpponentFormation ? getRoundCards(playerDeck, battleRoundNo) : playerCards;
  const opponentCards = revealOpponentFormation ? getRoundCards(opponentDeck, battleRoundNo) : [];
  const opponentSlots = revealOpponentFormation ? getRoundSlots(opponentDeck, battleRoundNo) : [];
  const selectedRoundResult = roundResults.find((round) => Number(round.round_no) === Number(battleRoundNo));
  const latestRoundResult = selectedRoundResult || [...roundResults].sort((a, b) => Number(b.round_no || 0) - Number(a.round_no || 0))[0];
  const battleInProgress = roundReveal?.stage === 'battle';
  const visibleRoundResults = battleInProgress && roundReveal?.roundNo
    ? roundResults.filter((round) => Number(round.round_no) < Number(roundReveal.roundNo))
    : roundResults;
  const visibleScore = battleInProgress
    ? visibleRoundResults.reduce((score, round) => {
      if (round.winner_side === 'player') return { ...score, player: score.player + 1 };
      if (round.winner_side === 'bot') return { ...score, opponent: score.opponent + 1 };
      return score;
    }, { player: 0, opponent: 0 })
    : { player: Number(match?.player_a_round_wins || 0), opponent: Number(match?.player_b_round_wins || 0) };
  const scoreLabel = `${visibleScore.player}:${visibleScore.opponent}`;
  const visibleReplayEvents = battleInProgress ? [] : visibleEvents;
  const displayCompleted = completed && !battleInProgress;
  const isLiveRankedPvp = match?.match_type === 'RANKED' && Boolean(match.player_b_id) && !displayCompleted;
  const matchStatusLabel = battleInProgress ? '전투 중' : displayCompleted ? '완료' : roundWait ? '상대 대기' : '전술 준비';
  const currentActionLabel = battleInProgress && activeBattleTurn
    ? getTurnActionLabel(activeBattleTurn)
    : replayPlaybackActive && activeBattleTurn
      ? `리플레이 · ${getTurnActionLabel(activeBattleTurn)}`
      : displayCompleted
        ? '라운드 리플레이 확인'
        : roundWait
          ? canForceRound ? '기본 플랜 진행 가능' : '상대 선택 대기'
          : '출전 카드와 전술 선택';
  const currentActionCaption = battleInProgress && activeBattleTurn
    ? getTurnCaption(activeBattleTurn, combatNameResolver)
    : replayPlaybackActive && activeBattleTurn
      ? getTurnCaption(activeBattleTurn, combatNameResolver)
      : displayCompleted
        ? '완료된 라운드를 선택해 전투 흐름을 다시 볼 수 있습니다.'
        : roundWait
          ? `${waitSec}초 남음 · 시간이 끝나면 기본 선택으로 진행됩니다.`
          : `${ARENA_ACTIVE_SLOT_COUNT}장 출전 카드와 이번 라운드 전술을 확정하세요.`;
  const currentTurnLabel = activeBattleTurns.length > 0
    ? `${Math.min(battleEventIndex + 1, activeBattleTurns.length)}/${activeBattleTurns.length}`
    : '-';
  const battleDiagnostic = React.useMemo(
    () => validateArenaBattleTimeline(replay?.rounds || []),
    [replay?.rounds]
  );
  const finalMvpCard = React.useMemo(() => {
    const cards = playerDeck?.cards || [];
    if (cards.length === 0) return null;
    const scoreCard = (card: ArenaSnapshotCardDto) => {
      const stats = card.stats || { hp: 0, attack: 0, defense: 0, speed: 0, focus: 0 };
      const skillBonus = (card.skills || []).reduce((total, skill) => total + (skill.type === 'ultimate' ? 8 : skill.type === 'active' ? 5 : 3), 0);
      return Number(stats.attack || 0) * 1.25 + Number(stats.focus || 0) * 0.9 + Number(stats.speed || 0) * 0.75 + Number(stats.defense || 0) * 0.55 + skillBonus;
    };
    return [...cards].sort((a, b) => scoreCard(b) - scoreCard(a))[0] || null;
  }, [playerDeck?.cards]);
  const resultTone = match?.result === 'win' ? 'win' : match?.result === 'loss' ? 'loss' : 'draw';
  const resultModalTitle = resultTone === 'win' ? '승리' : resultTone === 'loss' ? '패배' : '무승부';
  const resultModalMessage = resultTone === 'win'
    ? '라운드 선택과 배치가 마지막까지 흐름을 잡았습니다.'
    : resultTone === 'loss'
      ? '다음 라운드 플랜과 덱 조합을 다듬어 다시 도전할 수 있습니다.'
      : '팽팽한 승부였습니다. 한 장의 배치 변화가 다음 결과를 바꿀 수 있습니다.';
  const roundResultTrail = React.useMemo(() => (
    roundResults
      .slice()
      .sort((a, b) => Number(a.round_no || 0) - Number(b.round_no || 0))
      .slice(0, 5)
  ), [roundResults]);
  const modalScoreSlots = React.useMemo(() => (
    Array.from({ length: 5 }, (_, index) => {
      const round = roundResultTrail[index];
      return {
        index,
        winner: round?.winner_side || null,
        roundNo: round?.round_no || index + 1
      };
    })
  ), [roundResultTrail]);
  const roundHighlights = React.useMemo(
    () => buildArenaRoundHighlights(replay?.rounds || [], playerDeck, opponentDeck, battleDiagnostic.rounds),
    [battleDiagnostic.rounds, opponentDeck, playerDeck, replay?.rounds]
  );
  const replayRoundReveal = React.useMemo<RoundRevealState | null>(() => {
    if (!displayCompleted || !selectedReplayRound || !match) return null;
    return {
      roundNo: Number(selectedReplayRound.round_no || 0),
      stage: replayPlaybackActive ? 'battle' : 'result',
      winner: selectedReplayRound.winner_side || 'draw',
      completed: true,
      result: match.result
    };
  }, [displayCompleted, match, replayPlaybackActive, selectedReplayRound]);
  const displayRoundReveal = roundReveal || replayRoundReveal;
  const replayProgressPercent = activeBattleTurns.length > 1
    ? Math.round((Math.min(battleEventIndex, activeBattleTurns.length - 1) / (activeBattleTurns.length - 1)) * 100)
    : activeBattleTurns.length === 1 ? 100 : 0;
  const selectedReplayOmittedCount = Number(selectedReplayRound?.timeline_summary?.omitted_event_count || 0);
  const selectedReplayOriginalCount = Number(selectedReplayRound?.original_event_count || selectedReplayRound?.events?.length || 0);
  const selectedReplayTruncated = Boolean(selectedReplayRound?.replay_truncated || selectedReplayOmittedCount > 0);

  React.useEffect(() => {
    if (!match || !replay || performanceSampleSentRef.current || isLocalPreviewMatch) return;
    const eventCount = (replay.rounds || []).reduce((total, round) => total + (round.events?.length || 0), 0);
    const replayMs = (replay.rounds || []).reduce((total, round) => total + Math.max(0, Number(round.duration_ms || 0)), 0);
    const sendSample = () => {
      performanceSampleSentRef.current = true;
      void apiFetch('/arena/telemetry/performance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          route: '/arena/matches',
          renderer: 'pixi',
          quality: typeof window !== 'undefined' ? window.localStorage.getItem('arena:vfx-quality') || 'auto' : 'auto',
          init_ms: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - pageStartedAtRef.current),
          replay_ms: replayMs,
          event_count: eventCount,
          dropped_frames: 0
        })
      }).catch(() => undefined);
    };
    const timer = window.setTimeout(sendSample, 1500);
    return () => window.clearTimeout(timer);
  }, [isLocalPreviewMatch, match, replay]);

  React.useEffect(() => {
    if (roundReveal?.stage === 'result' && roundReveal.completed) {
      setResultModalOpen(true);
    }
  }, [roundReveal?.completed, roundReveal?.stage]);

  React.useEffect(() => {
    if (replayRounds.length === 0) {
      setSelectedReplayRoundNo(null);
      setReplayPlaybackActive(false);
      return;
    }
    const latestRoundNo = Number(replayRounds[replayRounds.length - 1]?.round_no || 0);
    const hasSelected = selectedReplayRoundNo !== null
      && replayRounds.some((round) => Number(round.round_no) === selectedReplayRoundNo);
    if (!hasSelected) {
      setSelectedReplayRoundNo(latestRoundNo);
    }
  }, [replayRounds, selectedReplayRoundNo]);

  React.useEffect(() => {
    if (roundReveal?.stage === 'battle') return;
    setBattleEventIndex(0);
    setReplayPlaybackActive(false);
  }, [selectedReplayRound?.round_no, roundReveal?.stage]);

  React.useEffect(() => {
    if (roundReveal?.stage !== 'battle' || activeBattleTurns.length === 0) {
      setBattleEventIndex(0);
      return;
    }
    setBattleEventIndex(0);
    const timer = window.setInterval(() => {
      setBattleEventIndex((prev) => {
        if (prev >= activeBattleTurns.length - 1) return prev;
        return prev + 1;
      });
    }, ARENA_BATTLE_TURN_MS);
    return () => window.clearInterval(timer);
  }, [roundReveal?.roundNo, roundReveal?.stage, activeBattleTurns.length]);

  React.useEffect(() => {
    if (!replayPlaybackActive || roundReveal?.stage === 'battle' || activeBattleTurns.length === 0) return;
    const timer = window.setInterval(() => {
      setBattleEventIndex((prev) => {
        if (prev >= activeBattleTurns.length - 1) {
          window.clearInterval(timer);
          setReplayPlaybackActive(false);
          return activeBattleTurns.length - 1;
        }
        return prev + 1;
      });
    }, Math.max(420, Math.round(ARENA_BATTLE_TURN_MS * 0.62)));
    return () => window.clearInterval(timer);
  }, [activeBattleTurns.length, replayPlaybackActive, roundReveal?.stage]);

  const finishBattleReveal = React.useCallback((source: 'local' | 'both' = 'local') => {
    if (roundReveal?.stage !== 'battle') return;
    if (revealTimerRef.current !== null) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    setBattleEventIndex(Math.max(0, activeBattleTurns.length - 1));
    setRoundReveal((prev) => prev ? { ...prev, stage: 'result' } : prev);
    setRoundSkipRequested(false);
    setRoundSkipStatus(null);
    toast(
      source === 'both'
        ? '양쪽이 모두 스킵해 라운드 결과를 표시합니다.'
        : roundReveal.completed
          ? `세트 ${resultLabel(roundReveal.result)}로 경기가 종료되었습니다.`
          : `${roundReveal.roundNo}라운드 결과를 표시합니다.`,
      'success'
    );
  }, [activeBattleTurns.length, roundReveal, toast]);

  React.useEffect(() => {
    finishBattleRevealRef.current = finishBattleReveal;
  }, [finishBattleReveal]);

  React.useEffect(() => {
    setRoundSkipRequested(false);
    setRoundSkipStatus(null);
  }, [roundReveal?.roundNo, roundReveal?.stage]);

  React.useEffect(() => {
    if (!isLiveRankedPvp || !match?.id || typeof WebSocket === 'undefined') {
      setArenaRealtimeReady(false);
      arenaRealtimeRef.current?.close();
      arenaRealtimeRef.current = null;
      return;
    }

    let cancelled = false;
    let reconnectAttempts = 0;

    const connect = () => {
      if (cancelled) return;
      const socket = new WebSocket(buildArenaRealtimeSocketUrl());
      arenaRealtimeRef.current = socket;

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'ready') {
            socket.send(JSON.stringify({ type: 'join', match_id: match.id }));
            return;
          }
          if (payload.type === 'joined' && payload.match_id === match.id) {
            setArenaRealtimeReady(true);
            return;
          }
          if (payload.type === 'arena_round_skip_status' && payload.match_id === match.id) {
            const roundNo = Number(payload.round_no);
            const status = {
              roundNo,
              skipped: Math.max(0, Number(payload.skipped_count || 0)),
              required: Math.max(1, Number(payload.required_count || 2)),
              ready: Boolean(payload.ready)
            };
            setRoundSkipStatus(status);
            if (status.ready) {
              setRoundReveal((prev) => {
                if (prev?.stage !== 'battle' || Number(prev.roundNo) !== roundNo) return prev;
                window.setTimeout(() => finishBattleRevealRef.current?.('both'), 0);
                return prev;
              });
            }
          }
        } catch {
          // malformed realtime payloads are ignored
        }
      };

      socket.onopen = () => {
        reconnectAttempts = 0;
      };
      socket.onclose = () => {
        if (arenaRealtimeRef.current === socket) arenaRealtimeRef.current = null;
        setArenaRealtimeReady(false);
        if (cancelled) return;
        const delay = Math.min(10_000, 900 + reconnectAttempts * 1200);
        reconnectAttempts += 1;
        arenaRealtimeReconnectRef.current = window.setTimeout(connect, delay);
      };
      socket.onerror = () => socket.close();
    };

    connect();
    return () => {
      cancelled = true;
      if (arenaRealtimeReconnectRef.current !== null) {
        window.clearTimeout(arenaRealtimeReconnectRef.current);
        arenaRealtimeReconnectRef.current = null;
      }
      arenaRealtimeRef.current?.close();
      arenaRealtimeRef.current = null;
      setArenaRealtimeReady(false);
    };
  }, [isLiveRankedPvp, match?.id]);

  const skipBattleReveal = React.useCallback(() => {
    if (roundReveal?.stage !== 'battle') return;
    if (isLiveRankedPvp) {
      if (roundSkipRequested) return;
      const socket = arenaRealtimeRef.current;
      if (!arenaRealtimeReady || !socket || socket.readyState !== WebSocket.OPEN) {
        toast('PvP에서는 상대와 연결된 뒤 둘 다 스킵해야 결과로 넘어갈 수 있습니다.', 'error');
        return;
      }
      setRoundSkipRequested(true);
      setRoundSkipStatus({
        roundNo: roundReveal.roundNo,
        skipped: Math.max(1, roundSkipStatus?.skipped || 1),
        required: Math.max(2, roundSkipStatus?.required || 2),
        ready: false
      });
      socket.send(JSON.stringify({ type: 'skip_round_reveal', match_id: match?.id, round_no: roundReveal.roundNo }));
      toast('스킵 요청을 보냈습니다. 상대도 스킵하면 결과로 넘어갑니다.', 'success');
      return;
    }
    finishBattleReveal('local');
  }, [arenaRealtimeReady, finishBattleReveal, isLiveRankedPvp, match?.id, roundReveal, roundSkipRequested, roundSkipStatus?.required, roundSkipStatus?.skipped, toast]);

  const skipReplayToEnd = React.useCallback(() => {
    if (activeBattleTurns.length === 0) return;
    setReplayPlaybackActive(false);
    setBattleEventIndex(activeBattleTurns.length - 1);
  }, [activeBattleTurns.length]);

  const placeCardInSlot = React.useCallback((slotIndex: number, cardId: string) => {
    setSelectedSlots((prev) => {
      const nextPosition = {
        row: (slotIndex < 3 ? 1 : 0) as 0 | 1,
        col: (slotIndex % 3) as 0 | 1 | 2
      };
      const movingSlot = prev.find((slot) => slot.card_id === cardId);
      const targetSlot = prev.find((slot) => slot.row === nextPosition.row && slot.col === nextPosition.col);
      if (movingSlot && movingSlot.row === nextPosition.row && movingSlot.col === nextPosition.col) return prev;
      if (movingSlot && targetSlot) {
        return orderRoundSlots(prev.map((slot) => {
          if (slot.card_id === cardId) return { ...slot, ...nextPosition };
          if (slot.card_id === targetSlot.card_id) return { ...slot, row: movingSlot.row, col: movingSlot.col };
          return slot;
        }));
      }
      if (movingSlot) {
        return orderRoundSlots(prev.map((slot) => slot.card_id === cardId ? { ...slot, ...nextPosition } : slot));
      }
      const withoutTarget = prev.filter((slot) => !(slot.row === nextPosition.row && slot.col === nextPosition.col));
      return orderRoundSlots([...withoutTarget, { card_id: cardId, ...nextPosition }]).slice(0, ARENA_ACTIVE_SLOT_COUNT);
    });
  }, []);

  const toggleDeckCard = React.useCallback((cardId: string) => {
    if (selectionLocked) return;
    setSelectedSlots((prev) => {
      if (prev.some((slot) => slot.card_id === cardId)) return prev.filter((slot) => slot.card_id !== cardId);
      const usedPositions = new Set(prev.map((slot) => `${slot.row}:${slot.col}`));
      const emptyIndex = [0, 1, 2, 3, 4, 5].find((index) => {
        const row = index < 3 ? 1 : 0;
        const col = index % 3;
        return !usedPositions.has(`${row}:${col}`);
      });
      if (emptyIndex != null) {
        return orderRoundSlots([...prev, { card_id: cardId, row: emptyIndex < 3 ? 1 : 0, col: (emptyIndex % 3) as 0 | 1 | 2 }]);
      }
      return orderRoundSlots([...prev.slice(1), { card_id: cardId, row: prev[0]?.row ?? 1, col: prev[0]?.col ?? 0 }]);
    });
  }, [selectionLocked]);

  const commitRound = async (forceAutoCommit = false) => {
    if (!match?.id || roundLoading || completed) return;
    if (!forceAutoCommit && !canForceRound && selectedSlots.length !== ARENA_ACTIVE_SLOT_COUNT) {
      toast(`출전 카드를 ${ARENA_ACTIVE_SLOT_COUNT}장 선택해야 라운드를 시작할 수 있습니다.`, 'error');
      return;
    }
    setRoundLoading(true);
    setRoundReveal(null);
    setRoundSkipRequested(false);
    setRoundSkipStatus(null);
    if (revealTimerRef.current !== null) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    try {
      const res = await apiFetch(`/arena/matches/${encodeURIComponent(match.id)}/rounds/commit`, {
        method: 'POST',
        body: JSON.stringify({
          round_no: nextRoundNo,
          tactic_style: tacticStyle,
          focus_rule: focusRule,
          strategy_chip_id: strategyChipId,
          auto_commit: forceAutoCommit || canForceRound,
          slots: orderRoundSlots(selectedSlots).map((slot) => ({
            card_id: slot.card_id,
            row: slot.row,
            col: slot.col
          }))
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || '라운드 확정에 실패했습니다.');
      const nextMatch = (data.data?.match || null) as ArenaMatchViewDto | null;
      const nextReplay = (data.data?.replay || null) as ArenaReplayPayloadDto | null;
      if (nextMatch) setMatch(nextMatch);
      if (nextReplay) setReplay(nextReplay);

      if (data.data?.round_status?.status === 'waiting') {
        const deadlineAt = data.data.round_status.deadline_at || nextMatch?.summary?.pending_round_input?.deadline_at;
        if (deadlineAt) {
          setRoundWait({ roundNo: nextRoundNo, deadlineAt });
          setRoundWaitNow(Date.now());
          toast('상대의 라운드 선택을 기다립니다.', 'success');
        }
        return;
      }

      setRoundWait(null);
      const latestRound = [...(nextMatch?.summary?.round_results || [])].sort((a, b) => Number(b.round_no || 0) - Number(a.round_no || 0))[0];
      const reveal: RoundRevealState = {
        roundNo: nextRoundNo,
        stage: 'battle',
        winner: latestRound?.winner_side || 'draw',
        completed: isArenaMatchCompleted(nextMatch),
        result: isArenaMatchCompleted(nextMatch) ? (nextMatch?.result || 'draw') : null
      };
      setRoundReveal(reveal);
      applyMatchDefaults(nextMatch);
      const committedRoundEvents = nextReplay?.rounds?.[nextReplay.rounds.length - 1]?.events || [];
      const committedTurnCount = buildArenaBattleTurns(committedRoundEvents).length;
      const revealDurationMs = getArenaBattleRevealDurationMs(committedTurnCount);
      revealTimerRef.current = window.setTimeout(() => {
        setBattleEventIndex(Math.max(0, committedTurnCount - 1));
        setRoundReveal({ ...reveal, stage: 'result' });
        setRoundSkipRequested(false);
        setRoundSkipStatus(null);
        toast(reveal.completed ? `세트 ${resultLabel(reveal.result)}로 경기가 종료되었습니다.` : `${reveal.roundNo}라운드가 종료되었습니다.`, 'success');
        revealTimerRef.current = null;
      }, revealDurationMs);
    } catch (err: any) {
      toast(err?.message || '라운드 확정에 실패했습니다.', 'error');
    } finally {
      setRoundLoading(false);
    }
  };

  const createShareLink = async () => {
    if (!match?.id || shareLoading) return;
    if (isLocalPreviewMatch) {
      toast('로컬 QA 매치는 관전 링크를 만들지 않습니다.', 'info');
      return;
    }
    setShareLoading(true);
    try {
      const res = await apiFetch(`/arena/matches/${encodeURIComponent(match.id)}/share`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || '관전 공유 링크 생성에 실패했습니다.');
      const token = data.data?.token;
      const url = token ? `${window.location.origin}/arena/spectate?share=${encodeURIComponent(token)}` : '';
      if (url && navigator.clipboard) await navigator.clipboard.writeText(url);
      toast(url ? '관전 링크를 복사했습니다.' : '관전 링크를 생성했습니다.', 'success');
    } catch (err: any) {
      toast(err?.message || '관전 공유 링크 생성에 실패했습니다.', 'error');
    } finally {
      setShareLoading(false);
    }
  };

  return (
    <ArenaLayout activeTab="play" onTabChange={moveArenaTab}>
      <div className="space-y-5">
        <section className="arena-match-hero arena-panel-soft cute-surface overflow-hidden rounded-[2.25rem] p-5 md:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <span className="cute-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-black">
                <Swords className="h-3.5 w-3.5" />
                아레나 게임
              </span>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-foreground md:text-5xl">
                {loading ? '매치를 불러오는 중' : displayCompleted ? `세트 ${resultLabel(match?.result)}` : `${nextRoundNo}라운드 전술 준비`}
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-bold leading-relaxed text-muted-foreground">
                {match?.id ? `매치 ID ${match.id} · ${match.match_type === 'RANKED' ? '빠른대전' : '봇 연습전'} · ${formatDateTime(match.created_at)}` : '라운드마다 선택을 바꾸고 전투 결과를 확인합니다.'}
              </p>
              <div className="arena-current-action mt-4 max-w-2xl rounded-[1.65rem] px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`arena-action-dot ${battleInProgress ? 'is-live' : displayCompleted ? 'is-done' : 'is-ready'}`} />
                  <p className="text-sm font-black text-foreground">{currentActionLabel}</p>
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-black text-primary">턴 {currentTurnLabel}</span>
                </div>
                <p className="mt-1 text-xs font-bold leading-relaxed text-muted-foreground">{currentActionCaption}</p>
              </div>
            </div>
            <div className="arena-match-hud-grid grid gap-2 rounded-[2rem] border border-white/70 bg-white/70 p-2 shadow-sm dark:border-white/10 dark:bg-white/10">
              <div className="arena-match-hud-card rounded-2xl px-4 py-3 text-center">
                <p className="text-[10px] font-black text-muted-foreground">라운드</p>
                <p className="mt-1 text-xl font-black text-foreground">R{battleRoundNo || nextRoundNo}</p>
              </div>
              <div className="arena-match-hud-card rounded-2xl px-4 py-3 text-center">
                <p className="text-[10px] font-black text-muted-foreground">스코어</p>
                <p className="mt-1 text-xl font-black text-foreground">{scoreLabel}</p>
              </div>
              <div className="arena-match-hud-card rounded-2xl px-4 py-3 text-center">
                <p className="text-[10px] font-black text-muted-foreground">목표</p>
                <p className="mt-1 text-xl font-black text-foreground">3승</p>
              </div>
              <div className="arena-match-hud-card rounded-2xl px-4 py-3 text-center">
                <p className="text-[10px] font-black text-muted-foreground">상태</p>
                <p className="mt-1 text-sm font-black text-primary">{matchStatusLabel}</p>
              </div>
            </div>
          </div>
        </section>

        {loading ? (
          <SkeletonRows />
        ) : error ? (
          <StateNotice
            variant="error"
            title="게임 페이지를 열 수 없습니다"
            description={error}
            actionLabel="다시 불러오기"
            onAction={loadMatch}
            loading={loading}
          />
        ) : !match ? (
          <StateNotice title="매치가 없습니다" description="이미 종료되었거나 접근 권한이 없는 매치일 수 있습니다." actionLabel="플레이로 이동" onAction={() => router.push('/arena/play')} />
        ) : (
          <>
            <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="arena-panel-soft cute-surface rounded-[2rem] p-4 md:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black text-primary">전장</p>
                    <h2 className="mt-1 text-xl font-black text-foreground">{battlefield?.name || '기본 전장'}</h2>
                    <p className="mt-1 text-xs font-bold text-muted-foreground">{battlefield?.description || '이번 라운드의 전장 규칙이 적용됩니다.'}</p>
                  </div>
                  {displayCompleted ? (
                    <button
                      type="button"
                      onClick={createShareLink}
                      disabled={shareLoading || isLocalPreviewMatch}
                      className="cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-xs font-black text-primary-foreground disabled:opacity-50"
                    >
                      <Share2 className="h-4 w-4" />
                      {isLocalPreviewMatch ? '로컬 QA 매치' : shareLoading ? '생성 중' : '관전 링크 복사'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={loadMatch}
                      disabled={loading || roundLoading}
                      className="cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl border border-border bg-secondary/70 px-4 py-2.5 text-xs font-black text-foreground disabled:opacity-50"
                    >
                      <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                      동기화
                    </button>
                  )}
                </div>

                {roundReveal ? (
                  <div className={`arena-round-reveal mt-4 rounded-[2rem] border p-5 ${
                    roundReveal.stage === 'battle'
                      ? 'is-battle border-rose-200 bg-rose-50/80 dark:border-rose-300/20 dark:bg-rose-300/10'
                      : 'is-result border-primary/20 bg-primary/10'
                  }`}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-[10px] font-black text-muted-foreground">R{roundReveal.roundNo}</p>
                        <p className="mt-1 text-2xl font-black text-foreground">
                          {roundReveal.stage === 'battle'
                            ? '전투가 펼쳐지는 중'
                            : roundReveal.completed
                              ? `세트 ${resultLabel(roundReveal.result)}`
                              : winnerLabel(roundReveal.winner)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 self-start sm:self-center">
                        {roundReveal.stage === 'battle' ? (
                          <button
                            type="button"
                            onClick={skipBattleReveal}
                            disabled={isLiveRankedPvp && roundSkipRequested}
                            className="arena-polished-button cute-wiggle-hover inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl border border-white/70 bg-white/76 px-3 text-xs font-black text-foreground transition hover:-translate-y-0.5 hover:text-primary disabled:cursor-wait disabled:opacity-70 dark:border-white/10 dark:bg-white/10"
                          >
                            <FastForward className="h-3.5 w-3.5" />
                            {isLiveRankedPvp
                              ? roundSkipRequested
                                ? `상대 대기 ${roundSkipStatus?.skipped ?? 1}/${roundSkipStatus?.required ?? 2}`
                                : '둘 다 스킵'
                              : '결과만 보기'}
                          </button>
                        ) : null}
                        <div className="arena-round-orb flex h-14 w-14 items-center justify-center rounded-3xl bg-white/80 text-primary shadow-sm dark:bg-white/10">
                          <Swords className="h-6 w-6" />
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/70 dark:bg-white/10">
                      <div className={`h-full rounded-full ${roundReveal.stage === 'battle' ? 'arena-battle-progress bg-rose-500' : 'bg-primary'}`} style={roundReveal.stage === 'battle' ? { animationDuration: `${battleRevealDurationMs}ms` } : undefined} />
                    </div>
                    {roundReveal.stage === 'battle' && isLiveRankedPvp ? (
                      <p className="mt-2 text-[11px] font-bold text-muted-foreground">
                        {roundSkipRequested
                          ? `내 스킵 요청이 전달되었습니다. 상대도 스킵하면 즉시 결과로 넘어갑니다.`
                          : `PvP에서는 양쪽이 모두 스킵해야 결과로 넘어갑니다.`}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {displayCompleted ? (
                  <div className="arena-premium-panel mt-4 overflow-hidden rounded-[2rem] p-5">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <p className="text-[10px] font-black text-primary">매치 결과</p>
                        <h2 className="mt-1 text-3xl font-black text-foreground">{resultLabel(match.result)}</h2>
                        <p className="mt-2 text-xs font-bold leading-relaxed text-muted-foreground">
                          {roundResults.length}라운드 진행 · 최종 스코어 {match.player_a_round_wins}:{match.player_b_round_wins}
                        </p>
                      </div>
                      {finalMvpCard ? (
                        <div className="arena-premium-metric flex min-w-0 items-center gap-3 rounded-[1.75rem] p-3">
                          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-3xl bg-secondary">
                            {finalMvpCard.image_url ? <img src={finalMvpCard.image_url} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
                          </div>
                          <div className="min-w-0">
                            <p className="text-[10px] font-black text-primary">MVP 카드</p>
                            <p className="mt-1 truncate text-sm font-black text-foreground">{finalMvpCard.name}</p>
                            <p className="mt-1 truncate text-[10px] font-bold text-muted-foreground">{finalMvpCard.class_name}</p>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-3">
                      <div className="arena-premium-metric rounded-2xl px-3 py-3 text-center">
                        <p className="text-[10px] font-black text-muted-foreground">전투 턴</p>
                        <p className="mt-1 text-xl font-black text-foreground">{battleDiagnostic.turnCount}</p>
                      </div>
                      <div className="arena-premium-metric rounded-2xl px-3 py-3 text-center">
                        <p className="text-[10px] font-black text-muted-foreground">전투 이벤트</p>
                        <p className="mt-1 text-xl font-black text-foreground">{battleDiagnostic.eventCount}</p>
                      </div>
                      <div className="arena-premium-metric rounded-2xl px-3 py-3 text-center">
                        <p className="text-[10px] font-black text-muted-foreground">로그 상태</p>
                        <p className={`mt-1 text-sm font-black ${battleDiagnostic.errorCount > 0 ? 'text-red-600 dark:text-red-200' : battleDiagnostic.warningCount > 0 ? 'text-amber-600 dark:text-amber-200' : 'text-primary'}`}>
                          {battleDiagnostic.errorCount > 0 ? '확인 필요' : battleDiagnostic.warningCount > 0 ? '주의' : '정상'}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}

                {battleDiagnostic.issueCount > 0 && !battleInProgress ? (
                  <div className="arena-warning-ribbon mt-4 rounded-[1.5rem] p-4 pl-6 text-xs font-bold leading-relaxed">
                    전투 로그 진단에서 {battleDiagnostic.issueCount}건의 확인 항목을 찾았습니다. 설정 페이지의 디버그 export에 같은 진단 결과가 포함됩니다.
                  </div>
                ) : null}

                <div className="mt-4">
                  <ArenaBattleStage
                    match={match}
                    playerCards={playerBattleCards}
                    opponentCards={opponentCards}
                    playerSlots={revealOpponentFormation ? getRoundSlots(playerDeck, battleRoundNo) : (selectedSlots.length > 0 ? selectedSlots : getRoundSlots(playerDeck, nextRoundNo))}
                    opponentSlots={opponentSlots}
                    activeTurn={activeBattleTurn}
                    activeEvent={activeBattleEvent}
                    battleEvents={activeBattleEvents}
                    unitStates={activeUnitStates}
                    battleEventIndex={battleEventIndex}
                    revealOpponent={revealOpponentFormation}
                    roundReveal={displayRoundReveal}
                    roundResult={latestRoundResult}
                    skillLookup={skillLookup}
                    classLookup={classLookup}
                    user={battleUser}
                    loadout={battleLoadout}
                    displayPlayerRoundWins={visibleScore.player}
                    displayOpponentRoundWins={visibleScore.opponent}
                  />
                </div>

                {!displayCompleted ? (
                  <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
                    <FormationSlotBoard
                      deck={playerDeck}
                      slots={selectedSlots}
                      draggingCardId={draggingCardId}
                      disabled={selectionLocked}
                      onSlotDrop={placeCardInSlot}
                      onSlotDragStart={setDraggingCardId}
                      onDragEnd={() => setDraggingCardId(null)}
                      onClearSlot={(cardId) => setSelectedSlots((prev) => prev.filter((slot) => slot.card_id !== cardId))}
                    />
                    <div className="arena-premium-panel rounded-[1.75rem] p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-[10px] font-black text-muted-foreground">내 덱 10장</p>
                        <p className="text-[10px] font-bold text-muted-foreground">클릭 선택 · 드래그 배치</p>
                      </div>
                      <div className="arena-compact-scroll grid max-h-72 gap-2 overflow-y-auto pr-1">
                        {(playerDeck?.cards || []).map((card) => {
                          const selected = selectedSlots.some((slot) => slot.card_id === card.card_id);
                          return (
                            <button
                              key={card.card_id}
                              type="button"
                              draggable={!selectionLocked}
                              onClick={() => toggleDeckCard(card.card_id)}
                              onDragStart={(event) => {
                                event.dataTransfer.setData('text/plain', card.card_id);
                                setDraggingCardId(card.card_id);
                              }}
                              onDragEnd={() => setDraggingCardId(null)}
                              disabled={selectionLocked}
                              className={`arena-status-row min-w-0 rounded-2xl border px-2.5 py-2 text-left transition ${
                                selected
                                  ? 'border-primary/35 bg-primary text-primary-foreground shadow-sm'
                                  : 'border-transparent bg-white/70 text-foreground hover:-translate-y-0.5 hover:border-primary/25 hover:bg-primary/10 dark:bg-white/10'
                              } disabled:cursor-default disabled:opacity-75`}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="h-9 w-9 shrink-0 overflow-hidden rounded-2xl bg-white/80 shadow-sm dark:bg-white/10">
                                  {card.image_url ? <img src={card.image_url} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[11px] font-black">{card.name}</span>
                                  <span className={`mt-0.5 block truncate text-[9px] font-bold ${selected ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>{card.class_name}</span>
                                </span>
                                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black ${selected ? 'bg-white/20 text-primary-foreground' : 'bg-primary/10 text-primary'}`}>
                                  {selected ? '출전' : '대기'}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <aside className="space-y-4">
                <div className="arena-panel-soft cute-surface rounded-[2rem] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black text-primary">라운드 선택</p>
                      <h2 className="mt-1 text-lg font-black text-foreground">{battleInProgress ? '전투 진행 중' : displayCompleted ? '경기 종료' : `R${nextRoundNo} 준비`}</h2>
                    </div>
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      {displayCompleted ? <Trophy className="h-5 w-5" /> : <Target className="h-5 w-5" />}
                    </div>
                  </div>

                  {roundWait ? (
                    <div className="mt-4 rounded-3xl border border-red-200 bg-red-50/80 p-4 dark:border-red-300/20 dark:bg-red-300/10">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-black text-red-700 dark:text-red-100">상대 선택 대기</p>
                          <p className="mt-1 text-xl font-black text-foreground">{canForceRound ? '선택 시간 종료' : `${waitSec}초 남음`}</p>
                        </div>
                        <Clock3 className="h-6 w-6 text-red-600 dark:text-red-100" />
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70 dark:bg-white/10">
                        <div
                          className="h-full rounded-full bg-red-400 transition-all duration-500"
                          style={{ width: `${canForceRound ? 100 : Math.max(8, Math.min(100, 100 - (waitMs / ARENA_ROUND_SELECTION_TIMEOUT_MS) * 100))}%` }}
                        />
                      </div>
                    </div>
                  ) : null}

                  {!displayCompleted ? (
                    <div className="mt-4 space-y-3">
                      <div className="grid grid-cols-3 gap-1.5">
                        {tacticOptions.map(([id, label]) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setTacticStyle(id)}
                            className={`rounded-2xl px-2 py-2.5 text-[11px] font-black transition ${tacticStyle === id ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-white/70 text-muted-foreground hover:bg-primary/10 hover:text-primary dark:bg-white/10'}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {focusOptions.map(([id, label]) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setFocusRule(id)}
                            className={`rounded-2xl px-2 py-2.5 text-[11px] font-black transition ${focusRule === id ? 'bg-rose-500 text-white shadow-sm' : 'bg-white/70 text-muted-foreground hover:bg-rose-100 hover:text-rose-700 dark:bg-white/10 dark:hover:bg-rose-300/15 dark:hover:text-rose-100'}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {tacticChips.length > 0 ? (
                        <select
                          value={strategyChipId}
                          onChange={(event) => setStrategyChipId(event.target.value)}
                          className="h-11 w-full rounded-2xl border border-border bg-white/80 px-3 text-xs font-black text-foreground outline-none focus:border-primary dark:bg-card/80"
                        >
                          {tacticChips.map((chip) => (
                            <option key={chip.id} value={chip.id}>{chip.name}</option>
                          ))}
                        </select>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => commitRound()}
                        disabled={roundLoading || Boolean(roundWait && !canForceRound) || roundReveal?.stage === 'battle' || !canCommitWithSelection}
                        className="arena-primary-cta cute-wiggle-hover flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-black text-primary-foreground shadow-lg shadow-primary/20 disabled:opacity-50"
                      >
                        <Swords className="h-4 w-4" />
                        {roundLoading || roundReveal?.stage === 'battle'
                          ? '전투 중'
                          : roundWait
                            ? canForceRound ? '기본 플랜으로 진행' : '상대 선택 대기'
                            : selectedSlots.length !== ARENA_ACTIVE_SLOT_COUNT
                              ? `출전 카드 ${ARENA_ACTIVE_SLOT_COUNT}장 선택 필요`
                              : '라운드 시작'}
                      </button>
                    </div>
                  ) : (
                      <div className="arena-premium-panel mt-4 rounded-3xl p-4">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-5 w-5 text-primary" />
                        <p className="text-sm font-black text-foreground">경기가 종료되었습니다</p>
                      </div>
                      <p className="mt-2 text-xs font-bold leading-relaxed text-muted-foreground">
                        라운드를 선택해 전투 장면을 다시 재생하거나 관전 링크를 공유할 수 있습니다.
                      </p>
                    </div>
                  )}
                </div>

                <div className="arena-panel-soft cute-surface rounded-[2rem] p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <FileClock className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-black text-foreground">{displayCompleted ? '라운드 리플레이' : '라운드 기록'}</h2>
                  </div>
                  {visibleRoundResults.length === 0 ? (
                    <p className="text-xs font-bold leading-relaxed text-muted-foreground">아직 완료된 라운드가 없습니다.</p>
                  ) : (
                    <div className="space-y-2">
                      {visibleRoundResults.map((round) => (
                        <button
                          key={round.round_no}
                          type="button"
                          onClick={() => {
                            setSelectedReplayRoundNo(Number(round.round_no));
                            setReplayPlaybackActive(false);
                            setBattleEventIndex(0);
                          }}
                          className={`arena-replay-round-button flex w-full items-center justify-between gap-2 rounded-2xl px-3 py-2 text-left transition ${
                            Number(selectedReplayRound?.round_no) === Number(round.round_no)
                              ? 'is-selected bg-primary text-primary-foreground shadow-sm'
                              : 'bg-secondary/55 text-foreground hover:-translate-y-0.5 hover:bg-primary/10 hover:text-primary'
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block text-xs font-black">R{round.round_no}</span>
                            <span className={`mt-0.5 block text-[9px] font-bold ${Number(selectedReplayRound?.round_no) === Number(round.round_no) ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>
                              피해 {Number(round.player_total_damage || 0).toLocaleString()} / {Number(round.bot_total_damage || 0).toLocaleString()}
                            </span>
                          </span>
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${Number(selectedReplayRound?.round_no) === Number(round.round_no) ? 'bg-white/20 text-primary-foreground' : 'bg-primary/10 text-primary'}`}>
                            {winnerLabel(round.winner_side)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {displayCompleted && selectedReplayRound ? (
                    <div className="arena-replay-control arena-premium-panel mt-4 rounded-[1.5rem] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-black text-primary">선택한 리플레이</p>
                          <p className="mt-0.5 text-sm font-black text-foreground">R{selectedReplayRound.round_no} · {winnerLabel(selectedReplayRound.winner_side)}</p>
                        </div>
                        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-black text-primary">
                          {replayProgressPercent}%
                        </span>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-rose-100 dark:bg-white/10">
                        <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${replayProgressPercent}%` }} />
                      </div>
                      {selectedReplayTruncated ? (
                        <div className="arena-warning-ribbon mt-3 rounded-2xl px-3 py-2 pl-5 text-[11px] font-bold leading-relaxed">
                          이 라운드는 저장 상한으로 일부 이벤트가 생략되었습니다.
                          {selectedReplayOmittedCount > 0 ? ` 생략 ${selectedReplayOmittedCount.toLocaleString()}개` : ''}
                          {selectedReplayOriginalCount > 0 ? ` · 원본 ${selectedReplayOriginalCount.toLocaleString()}개` : ''}
                        </div>
                      ) : null}
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <button
                          type="button"
                          onClick={() => {
                            if (battleEventIndex >= activeBattleTurns.length - 1) setBattleEventIndex(0);
                            setReplayPlaybackActive((prev) => !prev);
                          }}
                          disabled={activeBattleTurns.length === 0}
                          className="arena-primary-cta arena-polished-button cute-wiggle-hover inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl bg-primary px-3 text-xs font-black text-primary-foreground disabled:opacity-50"
                        >
                          <Swords className="h-3.5 w-3.5" />
                          {replayPlaybackActive ? '일시정지' : '재생'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setBattleEventIndex(0);
                            setReplayPlaybackActive(false);
                          }}
                          disabled={activeBattleTurns.length === 0}
                          className="arena-polished-button cute-wiggle-hover inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl border border-white/70 bg-white/74 px-3 text-xs font-black text-foreground transition hover:-translate-y-0.5 hover:text-primary disabled:opacity-50 dark:border-white/10 dark:bg-white/10"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          처음부터
                        </button>
                        <button
                          type="button"
                          onClick={skipReplayToEnd}
                          disabled={activeBattleTurns.length === 0}
                          className="arena-polished-button cute-wiggle-hover inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl border border-white/70 bg-white/74 px-3 text-xs font-black text-foreground transition hover:-translate-y-0.5 hover:text-primary disabled:opacity-50 dark:border-white/10 dark:bg-white/10"
                        >
                          <FastForward className="h-3.5 w-3.5" />
                          마지막 장면
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </aside>
            </section>

            <section className="arena-panel-soft cute-surface rounded-[2rem] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Eye className="h-5 w-5 text-primary" />
                  <h2 className="text-base font-black text-foreground">{selectedReplayRound ? `R${selectedReplayRound.round_no} 전투 로그` : '전투 로그'}</h2>
                </div>
                <span className="rounded-full bg-secondary/70 px-3 py-1 text-[10px] font-black text-muted-foreground">
                  {replay?.rounds?.length || 0}라운드 저장
                </span>
              </div>
              {battleInProgress ? (
                <StateNotice title="전투가 진행 중입니다" description="라운드 결과와 전체 로그는 전투 연출이 끝난 뒤 표시됩니다." />
              ) : visibleReplayEvents.length === 0 ? (
                <StateNotice title="아직 재생할 전투 로그가 없습니다" description="라운드를 시작하면 공격, 스킬, 피해 흐름이 이곳에 쌓입니다." />
              ) : (
                <div className="arena-compact-scroll mt-4 grid max-h-[34rem] gap-2 overflow-y-auto pr-1">
                  {displayCompleted && activeBattleTurn ? (
                    <div className="arena-replay-now arena-premium-panel rounded-[1.5rem] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[10px] font-black text-primary">현재 장면</p>
                          <p className="mt-0.5 truncate text-sm font-black text-foreground">{getTurnActionLabel(activeBattleTurn)}</p>
                        </div>
                        <span className="rounded-full bg-white/70 px-2.5 py-1 text-[10px] font-black text-primary dark:bg-white/10">
                          {Math.min(battleEventIndex + 1, activeBattleTurns.length)} / {activeBattleTurns.length}
                        </span>
                      </div>
                      <p className="mt-2 text-xs font-bold leading-relaxed text-muted-foreground">
                        {getTurnCaption(activeBattleTurn, combatNameResolver)}
                      </p>
                      {activeBattleTurnSummary.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {activeBattleTurnSummary.map((item) => (
                            <span
                              key={`${item.key}-${item.label}`}
                              className={`rounded-full px-2.5 py-1 text-[10px] font-black ${turnSummaryToneClass[item.key]}`}
                            >
                              {item.label} {item.value}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {selectedReplayTruncated ? (
                        <p className="mt-2 text-[10px] font-black text-amber-700 dark:text-amber-200">
                          일부 이벤트 생략됨
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {visibleReplayEvents.map((event, index) => (
                    <div key={`${event.t}-${event.type}-${index}`} className="arena-status-row arena-premium-metric flex items-center justify-between gap-3 rounded-2xl px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-black text-foreground">{event.message || event.type}</p>
                        <p className="mt-0.5 text-[10px] font-bold text-muted-foreground">{event.actor || '시스템'} · {Math.round(event.t / 100) / 10}s</p>
                      </div>
                      {typeof event.value === 'number' ? (
                        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-black text-primary">{event.value}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
      {resultModalOpen && match && displayCompleted ? (
        <div className={`arena-result-modal-backdrop is-${resultTone} fixed inset-0 z-[80] flex items-center justify-center px-4 py-6`}>
          <div className={`arena-result-modal is-${resultTone} relative w-full max-w-3xl overflow-x-hidden overflow-y-auto rounded-[2.35rem] border p-4 shadow-[0_34px_110px_rgba(136,19,55,0.34)] md:p-5`}>
            <div className="arena-result-modal-aura" />
            <div className="arena-result-modal-sheen" />
            <div className="arena-result-modal-sparks" aria-hidden="true">
              {Array.from({ length: 14 }, (_, index) => (
                <span key={index} style={{ '--spark-index': index } as React.CSSProperties} />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setResultModalOpen(false)}
              className="absolute right-4 top-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/70 bg-white/75 text-muted-foreground transition hover:-translate-y-0.5 hover:text-primary dark:border-white/10 dark:bg-white/10"
              aria-label="결과 모달 닫기"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="relative grid gap-4 lg:grid-cols-[1fr_1.18fr]">
              <div className="arena-result-stage rounded-[2rem] border border-white/70 bg-white/62 p-4 dark:border-white/10 dark:bg-white/8">
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-white/76 px-3 py-1 text-[11px] font-black text-primary shadow-sm dark:bg-white/10">
                  <Trophy className="h-4 w-4" />
                  매치 종료
                </div>
                <div className="mt-4">
                  <p className="arena-result-kicker text-[10px] font-black uppercase tracking-[0.18em] text-primary">best of five</p>
                  <h2 className="arena-result-title mt-1 text-5xl font-black tracking-tight md:text-6xl">
                    {resultModalTitle}
                  </h2>
                  <p className="mt-3 text-sm font-bold leading-relaxed text-muted-foreground">
                    {resultModalMessage}
                  </p>
                </div>

                <div className="arena-result-score mt-5 rounded-[1.75rem] border border-white/70 bg-white/72 p-3 shadow-sm dark:border-white/10 dark:bg-white/10">
                  <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
                    <div>
                      <p className="text-[10px] font-black text-muted-foreground">내 점수</p>
                      <p className="text-4xl font-black text-foreground">{match.player_a_round_wins}</p>
                    </div>
                    <div className="pb-2 text-2xl font-black text-primary">:</div>
                    <div className="text-right">
                      <p className="text-[10px] font-black text-muted-foreground">상대</p>
                      <p className="text-4xl font-black text-foreground">{match.player_b_round_wins}</p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-5 gap-1.5">
                    {modalScoreSlots.map((slot) => (
                      <span
                        key={`${slot.roundNo}-${slot.index}`}
                        className={`arena-result-round-dot ${slot.winner === 'player' ? 'is-player' : slot.winner === 'bot' ? 'is-opponent' : slot.winner === 'draw' ? 'is-draw' : 'is-empty'}`}
                        aria-label={`라운드 ${slot.roundNo}`}
                      />
                    ))}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="rounded-2xl bg-white/64 px-3 py-2 dark:bg-white/10">
                    <p className="text-[10px] font-black text-muted-foreground">턴</p>
                    <p className="mt-0.5 text-lg font-black text-foreground">{battleDiagnostic.turnCount}</p>
                  </div>
                  <div className="rounded-2xl bg-white/64 px-3 py-2 dark:bg-white/10">
                    <p className="text-[10px] font-black text-muted-foreground">이벤트</p>
                    <p className="mt-0.5 text-lg font-black text-foreground">{battleDiagnostic.eventCount}</p>
                  </div>
                  <div className="rounded-2xl bg-white/64 px-3 py-2 dark:bg-white/10">
                    <p className="text-[10px] font-black text-muted-foreground">진단</p>
                    <p className={`mt-1 text-xs font-black ${battleDiagnostic.errorCount > 0 ? 'text-red-600 dark:text-red-200' : battleDiagnostic.warningCount > 0 ? 'text-amber-600 dark:text-amber-200' : 'text-primary'}`}>
                      {battleDiagnostic.errorCount > 0 ? '확인' : battleDiagnostic.warningCount > 0 ? '주의' : '정상'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="arena-result-mvp-panel rounded-[2rem] border border-white/70 bg-white/72 p-4 shadow-sm dark:border-white/10 dark:bg-white/10">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black text-primary">MVP 카드</p>
                    <h3 className="mt-1 text-xl font-black text-foreground">하이라이트</h3>
                  </div>
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                <div className="mt-4">
                  {finalMvpCard ? (
                    <div className="arena-result-mvp-card">
                      <div className="arena-result-mvp-image">
                        {finalMvpCard.image_url ? <img src={finalMvpCard.image_url} alt="" loading="lazy" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-lg font-black text-foreground">{finalMvpCard.name}</p>
                        <p className="mt-1 truncate text-xs font-bold text-primary">{finalMvpCard.class_name}</p>
                        <div className="mt-3 grid grid-cols-3 gap-1.5">
                          {[
                            ['ATK', finalMvpCard.stats?.attack],
                            ['DEF', finalMvpCard.stats?.defense],
                            ['SPD', finalMvpCard.stats?.speed]
                          ].map(([label, value]) => (
                            <div key={String(label)} className="rounded-2xl bg-white/70 px-2 py-2 text-center dark:bg-white/10">
                              <p className="text-[9px] font-black text-muted-foreground">{label}</p>
                              <p className="mt-0.5 text-sm font-black text-foreground">{value ?? '-'}</p>
                            </div>
                          ))}
                        </div>
                        <p className="mt-3 line-clamp-2 text-[11px] font-bold leading-relaxed text-muted-foreground">
                          {finalMvpCard.skills?.slice(0, 3).map((skill) => skill.name).join(' · ') || '스킬 정보 없음'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs font-bold text-muted-foreground">표시할 카드가 없습니다.</p>
                  )}
                </div>
                <div className="arena-result-highlights mt-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black text-primary">라운드 하이라이트</p>
                      <p className="mt-1 text-xs font-bold text-muted-foreground">승부를 가른 행동을 요약했습니다.</p>
                    </div>
                    <FileClock className="h-4 w-4 text-primary" />
                  </div>
                  {roundHighlights.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {roundHighlights.map((highlight) => (
                        <div key={highlight.roundNo} className={`arena-result-highlight-card is-${highlight.winner}`}>
                          <div className="arena-result-highlight-rail" />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-black text-foreground">{highlight.title}</p>
                              <span className="rounded-full bg-white/74 px-2.5 py-1 text-[10px] font-black text-primary dark:bg-white/10">
                                피해 {highlight.damageTotal.toLocaleString()}
                              </span>
                            </div>
                            <p className="mt-1 text-[11px] font-bold leading-relaxed text-muted-foreground">{highlight.subtitle}</p>
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              <div className="rounded-2xl bg-white/58 px-3 py-2 dark:bg-white/8">
                                <p className="text-[9px] font-black text-muted-foreground">결정 장면</p>
                                <p className="mt-0.5 truncate text-[11px] font-black text-foreground">{highlight.decisiveLabel}</p>
                                <p className="mt-0.5 line-clamp-2 text-[10px] font-bold leading-relaxed text-muted-foreground">{highlight.decisiveDetail}</p>
                              </div>
                              <div className="rounded-2xl bg-white/58 px-3 py-2 dark:bg-white/8">
                                <p className="text-[9px] font-black text-muted-foreground">주요 스킬</p>
                                <p className="mt-0.5 truncate text-[11px] font-black text-foreground">{highlight.topSkillLabel}</p>
                                <p className="mt-0.5 text-[10px] font-bold text-muted-foreground">{highlight.topSkillDetail}</p>
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <span className="rounded-full bg-rose-500/10 px-2.5 py-1 text-[10px] font-black text-primary">내 전투불능 {highlight.playerRetired}</span>
                              <span className="rounded-full bg-rose-500/10 px-2.5 py-1 text-[10px] font-black text-primary">상대 전투불능 {highlight.opponentRetired}</span>
                              {highlight.healTotal > 0 ? (
                                <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-black text-emerald-700 dark:text-emerald-200">회복 {highlight.healTotal.toLocaleString()}</span>
                              ) : null}
                              {highlight.shieldTotal > 0 ? (
                                <span className="rounded-full bg-sky-500/10 px-2.5 py-1 text-[10px] font-black text-sky-700 dark:text-sky-200">보호 {highlight.shieldTotal.toLocaleString()}</span>
                              ) : null}
                              {highlight.issueCount > 0 ? (
                                <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[10px] font-black text-amber-700 dark:text-amber-200">진단 {highlight.issueCount}</span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-[1.5rem] border border-dashed border-primary/20 bg-white/54 p-4 text-xs font-bold text-muted-foreground dark:bg-white/8">
                      라운드 리플레이가 아직 없어 하이라이트를 표시할 수 없습니다.
                    </div>
                  )}
                </div>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row lg:flex-col">
                  <button
                    type="button"
                    onClick={createShareLink}
                    disabled={shareLoading || isLocalPreviewMatch}
                    className="arena-primary-cta cute-wiggle-hover inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-black text-primary-foreground shadow-lg shadow-primary/20 disabled:opacity-50"
                  >
                    <Share2 className="h-4 w-4" />
                    {isLocalPreviewMatch ? '로컬 QA 매치' : shareLoading ? '생성 중' : '관전 링크 복사'}
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => router.push('/arena/play')}
                      className="cute-wiggle-hover inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/70 bg-white/75 px-4 text-sm font-black text-foreground transition hover:-translate-y-0.5 hover:text-primary dark:border-white/10 dark:bg-white/10"
                    >
                      <Swords className="h-4 w-4" />
                      다시 플레이
                    </button>
                    <button
                      type="button"
                      onClick={() => router.push('/arena/inventory')}
                      className="cute-wiggle-hover inline-flex min-h-12 items-center justify-center rounded-2xl border border-white/70 bg-white/55 px-4 text-sm font-black text-muted-foreground transition hover:-translate-y-0.5 hover:text-primary dark:border-white/10 dark:bg-white/5"
                    >
                      덱 수정
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </ArenaLayout>
  );
};
