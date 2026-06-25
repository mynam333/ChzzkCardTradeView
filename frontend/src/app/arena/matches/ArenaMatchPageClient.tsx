'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Eye,
  FileClock,
  GripVertical,
  RefreshCw,
  Share2,
  ShieldCheck,
  Sparkles,
  Swords,
  Target,
  Trophy
} from 'lucide-react';
import { ArenaLayout } from '../../ArenaLayout';
import type { ArenaSiteTab } from '../../ArenaTab';
import { useApp } from '../../AppContext';
import { StreamerTooltip } from '../../StreamerTooltip';
import { apiFetch } from '@/lib/api';
import { borderClass, borderStyle, ensureCosmeticCss, ensureFont, nameEffectClass, nameEffectStyle, proxiedImage } from '@/lib/cosmetics';
import type {
  ArenaDeckSnapshotDto,
  ArenaMatchViewDto,
  ArenaReplayPayloadDto,
  ArenaRoundResultDto,
  ArenaRoundPlanDto,
  ArenaRulesCatalogDto,
  ArenaSnapshotCardDto
} from '@chikapo/arena-contract';

type RoundWaitState = {
  roundNo: number;
  deadlineAt: string;
};

type RoundRevealState = {
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

const resultLabel = (result?: ArenaMatchViewDto['result']) => (
  result === 'win' ? '승리' : result === 'loss' ? '패배' : result === 'draw' ? '무승부' : '진행 중'
);

const normalizeArenaProgressStatus = (status?: unknown) => String(status || '').trim().toLowerCase();
const isArenaMatchCompleted = (match?: Pick<ArenaMatchViewDto, 'summary' | 'round_count' | 'player_a_round_wins' | 'player_b_round_wins'> | null) => {
  const status = normalizeArenaProgressStatus(match?.summary?.progress_status);
  if (status === 'completed') return true;
  if (status === 'in_progress') return false;
  return Number(match?.player_a_round_wins || 0) >= 3 || Number(match?.player_b_round_wins || 0) >= 3 || Number(match?.round_count || 0) >= 5;
};

const winnerLabel = (winner?: string) => (
  winner === 'player' ? '내 라운드 승리' : winner === 'bot' ? '상대 라운드 승리' : '라운드 무승부'
);

const arenaSkillSlotLabels: Record<string, string> = {
  active: '액티브',
  passive: '패시브',
  ultimate: '궁극기'
};

type SelectedRoundSlot = {
  card_id: string;
  row: 0 | 1;
  col: 0 | 1 | 2;
};

type ArenaRuleSkill = {
  id: string;
  name?: string;
  type?: string;
  description?: string;
};

type ArenaRuleClass = {
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

type ArenaCosmeticLoadout = {
  user_id: string;
  border_item_id: number | null;
  name_effect_item_id: number | null;
  border_item?: ArenaShopItem | null;
  name_effect_item?: ArenaShopItem | null;
  updated_at?: string | null;
};

const ARENA_ACTIVE_SLOT_COUNT = 6;

const statLabels: Array<[keyof NonNullable<ArenaSnapshotCardDto['stats']>, string, string]> = [
  ['hp', 'HP', '체력'],
  ['attack', 'ATK', '공격'],
  ['defense', 'DEF', '방어'],
  ['speed', 'SPD', '속도'],
  ['focus', 'FOC', '집중']
];

const statDescriptions: Record<keyof NonNullable<ArenaSnapshotCardDto['stats']>, string> = {
  hp: '라운드에서 버틸 수 있는 기본 생존력입니다.',
  attack: '기본 공격과 물리형 피해의 중심 수치입니다.',
  defense: '받는 피해를 줄이고 전열 유지력을 높입니다.',
  speed: '행동 순서와 공격 템포에 영향을 줍니다.',
  focus: '스킬 발동 흐름과 스킬형 효과 안정성에 영향을 줍니다.'
};

const classRoleDescriptions: Record<string, string> = {
  frontline: '앞줄에서 피해를 받아내고 팀의 전투 시간을 벌어주는 역할입니다.',
  damage: '상대 카드를 빠르게 쓰러뜨리는 주 피해 역할입니다.',
  control: '상태 이상과 행동 지연으로 상대의 전투 흐름을 흔드는 역할입니다.',
  support: '회복, 보호, 강화로 아군 카드의 안정성을 높이는 역할입니다.',
  tempo: '행동 순서와 스킬 흐름을 조절해 라운드 주도권을 잡는 역할입니다.'
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
  const catalogSkill = skillLookup.get(skill.id);
  return catalogSkill?.description || `${arenaSkillSlotLabels[skill.type] || skill.type} 슬롯의 전투 스킬입니다. 라운드 계산에서 카드의 역할과 스탯에 맞춰 적용됩니다.`;
};

const getClassDescription = (card: ArenaSnapshotCardDto, classLookup: Map<string, ArenaRuleClass>) => {
  const catalogClass = classLookup.get(card.class_id);
  if (catalogClass?.description) return catalogClass.description;
  if (catalogClass?.role && classRoleDescriptions[catalogClass.role]) return classRoleDescriptions[catalogClass.role];
  return '카드의 전투 역할과 기본 스탯 성향을 결정하는 클래스입니다.';
};

const formatDateTime = (value?: string | null) => {
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

const getRoundCards = (deck: ArenaDeckSnapshotDto | undefined, roundNo: number): ArenaSnapshotCardDto[] => {
  if (!deck?.cards?.length) return [];
  const plan = getRoundPlan(deck, roundNo);
  if (!plan?.slots?.length) return deck.cards.slice(0, 6);
  const byId = new Map(deck.cards.map((card) => [card.card_id, card]));
  const planned = plan.slots
    .map((slot) => byId.get(slot.card_id))
    .filter((card): card is ArenaSnapshotCardDto => Boolean(card));
  return planned.length > 0 ? planned : deck.cards.slice(0, 6);
};

const getRoundSlots = (deck: ArenaDeckSnapshotDto | undefined, roundNo: number): SelectedRoundSlot[] => {
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
          <ArenaInfoTooltip key={statKey} label={`${label} ${card.stats?.[statKey] ?? 0}`} description={statDescriptions[statKey]}>
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
          <p className="mt-0.5 text-[10px] font-bold text-muted-foreground">가운데 열이 전열, 양쪽 열이 후열입니다.</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${slots.length === ARENA_ACTIVE_SLOT_COUNT ? 'bg-primary/10 text-primary' : 'bg-amber-100 text-amber-700 dark:bg-amber-300/10 dark:text-amber-100'}`}>
          {slots.length}/{ARENA_ACTIVE_SLOT_COUNT}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5 pb-1 text-center text-[9px] font-black text-muted-foreground">
        <span>후열</span>
        <span className="text-primary">전열</span>
        <span>후열</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[0, 1].map((row) => (
          <React.Fragment key={row}>
            {[0, 1, 2].map((col) => {
              const slotIndex = row * 3 + col;
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
                  aria-label={card ? `${card.name} 슬롯 제거` : `${col === 1 ? '전열' : '후열'} ${row + 1} 슬롯`}
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
          </React.Fragment>
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

const eventMentionsCard = (
  event: ArenaReplayPayloadDto['rounds'][number]['events'][number] | undefined,
  card: ArenaSnapshotCardDto
) => {
  if (!event) return false;
  const text = `${event.actor || ''} ${(event.targets || []).join(' ')} ${event.message || ''}`.toLowerCase();
  return text.includes(card.name.toLowerCase()) || text.includes(card.card_id.toLowerCase()) || text.includes(card.channel_id.toLowerCase());
};

const eventActorMentionsCard = (
  event: ArenaReplayPayloadDto['rounds'][number]['events'][number] | undefined,
  card: ArenaSnapshotCardDto
) => {
  if (!event?.actor) return false;
  const actor = event.actor.toLowerCase();
  return actor.includes(card.name.toLowerCase()) || actor.includes(card.card_id.toLowerCase()) || actor.includes(card.channel_id.toLowerCase());
};

const isControlEvent = (event?: ArenaReplayPayloadDto['rounds'][number]['events'][number]) => {
  const text = `${event?.type || ''} ${event?.message || ''}`.toLowerCase();
  return ['stun', 'slow', 'control', 'delay', 'debuff', '침묵', '기절', '지연', '약화'].some((token) => text.includes(token));
};

const getEventVfxKind = (event?: ArenaReplayPayloadDto['rounds'][number]['events'][number]) => {
  const text = `${event?.type || ''} ${event?.actor || ''} ${event?.message || ''}`.toLowerCase();
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

const estimateCardHealth = (
  card: ArenaSnapshotCardDto,
  events: ArenaReplayPayloadDto['rounds'][number]['events'],
  eventIndex: number,
  retired: boolean
) => {
  if (retired) return { max: Math.max(1, Number(card.stats?.hp || 1) * 10), remaining: 0, percent: 0 };
  const max = Math.max(1, Number(card.stats?.hp || 1) * 10);
  const damage = events.slice(0, Math.max(0, eventIndex + 1)).reduce((total, event) => {
    if (!eventMentionsCard(event, card) || eventActorMentionsCard(event, card)) return total;
    return total + Math.max(0, Number(event.value || 0));
  }, 0);
  const remaining = Math.max(0, max - damage);
  return { max, remaining, percent: Math.max(0, Math.min(100, Math.round((remaining / max) * 100))) };
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
  activeEvent?: ArenaReplayPayloadDto['rounds'][number]['events'][number];
  battleEvents: ArenaReplayPayloadDto['rounds'][number]['events'];
  battleEventIndex: number;
  roundReveal: RoundRevealState | null;
  retired: boolean;
  skillLookup: Map<string, ArenaRuleSkill>;
  classLookup: Map<string, ArenaRuleClass>;
}> = ({ card, side, slot, visualIndex, activeEvent, battleEvents, battleEventIndex, roundReveal, retired, skillLookup, classLookup }) => {
  const acting = roundReveal?.stage === 'battle' && eventActorMentionsCard(activeEvent, card);
  const mentioned = roundReveal?.stage === 'battle' && eventMentionsCard(activeEvent, card);
  const hit = mentioned && !acting;
  const skillEvent = acting && String(activeEvent?.type || activeEvent?.message || '').toLowerCase().includes('skill');
  const controlEvent = mentioned && isControlEvent(activeEvent);
  const vfxKind = acting || hit || controlEvent ? getEventVfxKind(activeEvent) : 'idle';
  const health = estimateCardHealth(card, battleEvents, battleEventIndex, retired);
  const currentValue = typeof activeEvent?.value === 'number' && (hit || acting) ? Math.max(0, Number(activeEvent.value || 0)) : 0;
  const statusLabel = retired ? 'RETIRE' : hit ? `-${currentValue || 'HIT'}` : controlEvent ? '상태 이상' : skillEvent ? 'SKILL' : acting ? (vfxKind === 'ultimate' ? 'ULTIMATE' : 'ATTACK') : '';
  return (
    <article
      className={`arena-combat-card is-${side} ${slot.col === 1 ? 'is-frontline' : 'is-backline'} ${acting ? 'is-acting' : ''} ${hit ? 'is-hit' : ''} ${skillEvent ? 'is-skill' : ''} ${controlEvent ? 'is-control' : ''} vfx-${vfxKind} ${retired ? 'is-retired' : ''}`.trim()}
      style={{ ['--combat-delay' as any]: `${visualIndex * 90}ms` }}
    >
      <div className="arena-combat-card-media">
        {card.image_url ? <img src={card.image_url} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
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
      {statusLabel ? <div className={`arena-combat-float ${hit ? 'is-damage' : retired ? 'is-retire' : controlEvent ? 'is-control' : 'is-action'}`}>{statusLabel}</div> : null}
      <div className="arena-combat-vfx" />
    </article>
  );
};

const ArenaCombatFormation: React.FC<{
  side: 'player' | 'opponent';
  cards: ArenaSnapshotCardDto[];
  slots: SelectedRoundSlot[];
  activeEvent?: ArenaReplayPayloadDto['rounds'][number]['events'][number];
  battleEvents: ArenaReplayPayloadDto['rounds'][number]['events'];
  battleEventIndex: number;
  roundReveal: RoundRevealState | null;
  remainingUnits?: number;
  skillLookup: Map<string, ArenaRuleSkill>;
  classLookup: Map<string, ArenaRuleClass>;
}> = ({ side, cards, slots, activeEvent, battleEvents, battleEventIndex, roundReveal, remainingUnits, skillLookup, classLookup }) => {
  const positioned = getCardBySlots(cards, slots);
  const retiredStart = typeof remainingUnits === 'number' ? Math.max(0, positioned.length - Math.max(0, remainingUnits)) : 0;
  return (
    <div className={`arena-combat-formation is-${side}`} aria-label={side === 'player' ? '내 전투 진영' : '상대 전투 진영'}>
      <div className="arena-combat-lane-labels" aria-hidden="true">
        <span>후열</span>
        <span>전열</span>
        <span>후열</span>
      </div>
      <div className="arena-combat-grid">
        {[0, 1].map((row) => [0, 1, 2].map((col) => {
          const item = positioned.find((entry) => entry.slot.row === row && entry.slot.col === col);
          return (
            <div key={`${row}-${col}`} className={`arena-combat-cell ${col === 1 ? 'is-frontline' : 'is-backline'}`}>
              {item ? (
                <ArenaCombatCard
                  card={item.card}
                  side={side}
                  slot={item.slot}
                  visualIndex={item.visualIndex}
                  activeEvent={activeEvent}
                  battleEvents={battleEvents}
                  battleEventIndex={battleEventIndex}
                  roundReveal={roundReveal}
                  retired={roundReveal?.stage === 'result' && item.visualIndex >= Math.max(0, positioned.length - retiredStart)}
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

const ArenaBattleStage: React.FC<{
  match: ArenaMatchViewDto;
  playerCards: ArenaSnapshotCardDto[];
  opponentCards: ArenaSnapshotCardDto[];
  playerSlots: SelectedRoundSlot[];
  opponentSlots: SelectedRoundSlot[];
  activeEvent?: ArenaReplayPayloadDto['rounds'][number]['events'][number];
  battleEvents: ArenaReplayPayloadDto['rounds'][number]['events'];
  battleEventIndex: number;
  roundReveal: RoundRevealState | null;
  roundResult?: ArenaRoundResultDto;
  skillLookup: Map<string, ArenaRuleSkill>;
  classLookup: Map<string, ArenaRuleClass>;
  user: any;
  loadout: ArenaCosmeticLoadout | null;
}> = ({ match, playerCards, opponentCards, playerSlots, opponentSlots, activeEvent, battleEvents, battleEventIndex, roundReveal, roundResult, skillLookup, classLookup, user, loadout }) => {
  const opponentAvatar = opponentCards[0]?.image_url || `https://api.dicebear.com/10.x/fun-emoji/svg?seed=${encodeURIComponent(match.player_b_id || `arena-bot-${match.id}`)}`;
  const playerLabel = user?.username || '나';
  const opponentLabel = match.match_type === 'RANKED' ? '상대 플레이어' : 'AI 연습 상대';
  return (
    <div className={`arena-battle-stage ${roundReveal?.stage === 'battle' ? 'is-playing' : ''} ${roundReveal?.stage === 'result' ? 'is-result' : ''}`}>
      <div className="arena-battle-stage-bg" />
      <div className="arena-battle-row is-opponent-row">
        <ArenaCombatFormation
          side="opponent"
          cards={opponentCards}
          slots={opponentSlots}
          activeEvent={activeEvent}
          battleEvents={battleEvents}
          battleEventIndex={battleEventIndex}
          roundReveal={roundReveal}
          remainingUnits={roundResult?.bot_remaining_units}
          skillLookup={skillLookup}
          classLookup={classLookup}
        />
        <ArenaCombatPortrait label={opponentLabel} caption={`${match.player_b_round_wins || 0} 라운드 승`} avatarUrl={opponentAvatar} side="opponent" />
      </div>
      <div className="arena-battle-centerline">
        <span className="arena-battle-pulse" />
        <div className="min-w-0 text-center">
          <p className="truncate text-[10px] font-black text-primary">{roundReveal?.stage === 'battle' ? 'ACTION' : roundReveal?.stage === 'result' ? winnerLabel(roundReveal.winner) : 'TACTIC READY'}</p>
          <p className="mt-0.5 truncate text-xs font-black text-foreground">{activeEvent?.message || '카드 배치와 전술 선택이 전투 흐름을 만듭니다.'}</p>
        </div>
        <span className="arena-battle-pulse" />
      </div>
      <div className="arena-battle-row is-player-row">
        <ArenaCombatPortrait label={playerLabel} caption={`${match.player_a_round_wins || 0} 라운드 승`} avatarUrl={user?.avatarUrl} loadout={loadout} side="player" />
        <ArenaCombatFormation
          side="player"
          cards={playerCards}
          slots={playerSlots}
          activeEvent={activeEvent}
          battleEvents={battleEvents}
          battleEventIndex={battleEventIndex}
          roundReveal={roundReveal}
          remainingUnits={roundResult?.player_remaining_units}
          skillLookup={skillLookup}
          classLookup={classLookup}
        />
      </div>
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
  const revealTimerRef = React.useRef<number | null>(null);

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
  const completed = isArenaMatchCompleted(match);
  const playerDeck = match?.summary?.player_deck;
  const opponentDeck = getOpponentDeck(match);
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
  const opponentCards = getRoundCards(opponentDeck, nextRoundNo);
  const roundResults = match?.summary?.round_results || [];
  const selectedReplayRound = replay?.rounds?.[replay.rounds.length - 1];
  const visibleEvents = (selectedReplayRound?.events || []).slice(-18).reverse();
  const activeBattleEvents = selectedReplayRound?.events || [];
  const activeBattleEvent = activeBattleEvents.length > 0 ? activeBattleEvents[Math.min(battleEventIndex, activeBattleEvents.length - 1)] : undefined;
  const waitMs = roundWait ? Math.max(0, new Date(roundWait.deadlineAt).getTime() - roundWaitNow) : 0;
  const waitSec = Math.ceil(waitMs / 1000);
  const canForceRound = Boolean(roundWait && waitMs <= 0);
  const battlefield = match?.summary?.battlefield_rule;
  const tacticChips = rules?.tactic_chips || [];
  const scoreLabel = `${match?.player_a_round_wins || 0}:${match?.player_b_round_wins || 0}`;
  const selectionLocked = completed || roundLoading || Boolean(roundWait) || roundReveal?.stage === 'battle';
  const canCommitWithSelection = selectedSlots.length === ARENA_ACTIVE_SLOT_COUNT || canForceRound;
  const opponentSlots = getRoundSlots(opponentDeck, nextRoundNo);
  const latestRoundResult = [...roundResults].sort((a, b) => Number(b.round_no || 0) - Number(a.round_no || 0))[0];

  React.useEffect(() => {
    if (roundReveal?.stage !== 'battle' || activeBattleEvents.length === 0) {
      setBattleEventIndex(0);
      return;
    }
    setBattleEventIndex(0);
    const timer = window.setInterval(() => {
      setBattleEventIndex((prev) => {
        if (prev >= activeBattleEvents.length - 1) return prev;
        return prev + 1;
      });
    }, 320);
    return () => window.clearInterval(timer);
  }, [roundReveal?.roundNo, roundReveal?.stage, activeBattleEvents.length]);

  const placeCardInSlot = React.useCallback((slotIndex: number, cardId: string) => {
    setSelectedSlots((prev) => {
      const nextPosition = {
        row: (Math.floor(slotIndex / 3) === 0 ? 0 : 1) as 0 | 1,
        col: (slotIndex % 3) as 0 | 1 | 2
      };
      const withoutCard = prev.filter((slot) => slot.card_id !== cardId);
      const withoutTarget = withoutCard.filter((slot) => !(slot.row === nextPosition.row && slot.col === nextPosition.col));
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
      revealTimerRef.current = window.setTimeout(() => {
        setRoundReveal({ ...reveal, stage: 'result' });
        toast(reveal.completed ? `세트 ${resultLabel(reveal.result)}로 경기가 종료되었습니다.` : `${reveal.roundNo}라운드가 종료되었습니다.`, 'success');
        revealTimerRef.current = null;
      }, 2200);
    } catch (err: any) {
      toast(err?.message || '라운드 확정에 실패했습니다.', 'error');
    } finally {
      setRoundLoading(false);
    }
  };

  const createShareLink = async () => {
    if (!match?.id || shareLoading) return;
    setShareLoading(true);
    try {
      const res = await apiFetch(`/arena/matches/${encodeURIComponent(match.id)}/share`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || '관전 공유 링크 생성에 실패했습니다.');
      const token = data.data?.token;
      const url = token ? `${window.location.origin}/arena?share=${encodeURIComponent(token)}` : '';
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
        <section className="arena-panel-soft cute-surface overflow-hidden rounded-[2.25rem] p-5 md:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <span className="cute-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-black">
                <Swords className="h-3.5 w-3.5" />
                아레나 게임
              </span>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-foreground md:text-5xl">
                {loading ? '매치를 불러오는 중' : completed ? `세트 ${resultLabel(match?.result)}` : `${nextRoundNo}라운드 전술 준비`}
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-bold leading-relaxed text-muted-foreground">
                {match?.id ? `매치 ID ${match.id} · ${match.match_type === 'RANKED' ? '빠른대전' : '봇 연습전'} · ${formatDateTime(match.created_at)}` : '라운드마다 선택을 바꾸고 전투 결과를 확인합니다.'}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-[2rem] border border-white/70 bg-white/70 p-2 shadow-sm dark:border-white/10 dark:bg-white/10">
              <div className="rounded-2xl bg-secondary/60 px-4 py-3 text-center">
                <p className="text-[10px] font-black text-muted-foreground">스코어</p>
                <p className="mt-1 text-xl font-black text-foreground">{scoreLabel}</p>
              </div>
              <div className="rounded-2xl bg-secondary/60 px-4 py-3 text-center">
                <p className="text-[10px] font-black text-muted-foreground">목표</p>
                <p className="mt-1 text-xl font-black text-foreground">3승</p>
              </div>
              <div className="rounded-2xl bg-secondary/60 px-4 py-3 text-center">
                <p className="text-[10px] font-black text-muted-foreground">상태</p>
                <p className="mt-1 text-sm font-black text-primary">{completed ? '완료' : roundWait ? '대기' : '준비'}</p>
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
                  {completed ? (
                    <button
                      type="button"
                      onClick={createShareLink}
                      disabled={shareLoading}
                      className="cute-wiggle-hover inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-xs font-black text-primary-foreground disabled:opacity-50"
                    >
                      <Share2 className="h-4 w-4" />
                      {shareLoading ? '생성 중' : '관전 링크 복사'}
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
                    <div className="flex items-center justify-between gap-3">
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
                      <div className="arena-round-orb flex h-14 w-14 items-center justify-center rounded-3xl bg-white/80 text-primary shadow-sm dark:bg-white/10">
                        <Swords className="h-6 w-6" />
                      </div>
                    </div>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/70 dark:bg-white/10">
                      <div className={`h-full rounded-full ${roundReveal.stage === 'battle' ? 'arena-battle-progress bg-rose-500' : 'bg-primary'}`} />
                    </div>
                  </div>
                ) : null}

                <div className="mt-4">
                  <ArenaBattleStage
                    match={match}
                    playerCards={playerCards}
                    opponentCards={opponentCards}
                    playerSlots={selectedSlots.length > 0 ? selectedSlots : getRoundSlots(playerDeck, nextRoundNo)}
                    opponentSlots={opponentSlots}
                    activeEvent={activeBattleEvent}
                    battleEvents={activeBattleEvents}
                    battleEventIndex={battleEventIndex}
                    roundReveal={roundReveal}
                    roundResult={latestRoundResult}
                    skillLookup={skillLookup}
                    classLookup={classLookup}
                    user={user}
                    loadout={cosmeticLoadout}
                  />
                </div>

                {!completed ? (
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
                    <div className="rounded-[1.75rem] border border-border bg-secondary/28 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-[10px] font-black text-muted-foreground">내 덱 10장</p>
                        <p className="text-[10px] font-bold text-muted-foreground">클릭 선택 · 드래그 배치</p>
                      </div>
                      <div className="grid max-h-72 gap-2 overflow-y-auto pr-1">
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
                      <h2 className="mt-1 text-lg font-black text-foreground">{completed ? '경기 종료' : `R${nextRoundNo} 준비`}</h2>
                    </div>
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      {completed ? <Trophy className="h-5 w-5" /> : <Target className="h-5 w-5" />}
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

                  {!completed ? (
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
                    <div className="mt-4 rounded-3xl border border-primary/20 bg-primary/10 p-4">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-5 w-5 text-primary" />
                        <p className="text-sm font-black text-foreground">경기가 종료되었습니다</p>
                      </div>
                      <p className="mt-2 text-xs font-bold leading-relaxed text-muted-foreground">
                        아래 라운드 기록에서 결과 흐름을 확인하거나 관전 링크를 공유할 수 있습니다.
                      </p>
                    </div>
                  )}
                </div>

                <div className="arena-panel-soft cute-surface rounded-[2rem] p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <FileClock className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-black text-foreground">라운드 기록</h2>
                  </div>
                  {roundResults.length === 0 ? (
                    <p className="text-xs font-bold leading-relaxed text-muted-foreground">아직 완료된 라운드가 없습니다.</p>
                  ) : (
                    <div className="space-y-2">
                      {roundResults.map((round) => (
                        <div key={round.round_no} className="flex items-center justify-between gap-2 rounded-2xl bg-secondary/55 px-3 py-2">
                          <span className="text-xs font-black text-foreground">R{round.round_no}</span>
                          <span className="text-[10px] font-black text-primary">{winnerLabel(round.winner_side)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </aside>
            </section>

            <section className="arena-panel-soft cute-surface rounded-[2rem] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Eye className="h-5 w-5 text-primary" />
                  <h2 className="text-base font-black text-foreground">전투 로그</h2>
                </div>
                <span className="rounded-full bg-secondary/70 px-3 py-1 text-[10px] font-black text-muted-foreground">
                  {replay?.rounds?.length || 0}라운드 저장
                </span>
              </div>
              {visibleEvents.length === 0 ? (
                <StateNotice title="아직 재생할 전투 로그가 없습니다" description="라운드를 시작하면 공격, 스킬, 피해 흐름이 이곳에 쌓입니다." />
              ) : (
                <div className="mt-4 grid gap-2">
                  {visibleEvents.map((event, index) => (
                    <div key={`${event.t}-${event.type}-${index}`} className="arena-status-row flex items-center justify-between gap-3 rounded-2xl border border-border bg-card/70 px-3 py-2">
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
    </ArenaLayout>
  );
};
