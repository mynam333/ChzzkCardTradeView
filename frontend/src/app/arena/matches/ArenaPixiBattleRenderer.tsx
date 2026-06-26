'use client';

import React from 'react';
import type {
  ArenaMatchViewDto,
  ArenaReplayPayloadDto,
  ArenaRoundResultDto,
  ArenaSnapshotCardDto
} from '@chikapo/arena-contract';
import type { TextStyleOptions } from 'pixi.js';
import { proxiedImage } from '@/lib/cosmetics';
import type { ArenaBattleTurn, ArenaCosmeticLoadout, ArenaRuleClass, ArenaRuleSkill, RoundRevealState, SelectedRoundSlot } from './ArenaMatchPageClient';

type PixiModule = typeof import('pixi.js');
type PixiApp = import('pixi.js').Application;
type PixiContainer = import('pixi.js').Container;
type PixiSprite = import('pixi.js').Sprite;
type PixiTexture = import('pixi.js').Texture;

type CombatSide = 'player' | 'opponent';
type BattleStageKind = 'ready' | 'battle' | 'result';
type RendererQuality = 'off' | 'low' | 'high';

type ArenaReplayEvent = ArenaReplayPayloadDto['rounds'][number]['events'][number];
type ArenaReplayUnitState = NonNullable<ArenaReplayPayloadDto['rounds'][number]['unit_states']>[number];

type PositionedCard = {
  card: ArenaSnapshotCardDto;
  side: CombatSide;
  slot: SelectedRoundSlot;
  x: number;
  y: number;
  width: number;
  height: number;
  retired: boolean;
  hidden: boolean;
  health: { max: number; remaining: number; percent: number };
};

type CardVisual = {
  root: PixiContainer;
  card: PositionedCard;
};

type HoverZone = {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  description: string;
};

type BattleResponsiveLayout = {
  marginX: number;
  cardGap: number;
  rowGap: number;
  cardWidth: number;
  cardHeight: number;
  opponentBackTop: number;
  opponentFrontTop: number;
  playerFrontTop: number;
  playerBackTop: number;
  centerLineY: number;
  hudWidth: number;
  hudHeight: number;
  hudX: number;
  hudY: number;
  portraitWidth: number;
  portraitHeight: number;
  opponentPortraitX: number;
  opponentPortraitY: number;
  playerPortraitX: number;
  playerPortraitY: number;
};

type TooltipState = HoverZone & {
  screenX: number;
  screenY: number;
};

type ArenaPixiBattleRendererProps = {
  match: ArenaMatchViewDto;
  playerCards: ArenaSnapshotCardDto[];
  opponentCards: ArenaSnapshotCardDto[];
  playerSlots: SelectedRoundSlot[];
  opponentSlots: SelectedRoundSlot[];
  activeTurn?: ArenaBattleTurn;
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
};

const PIXI_BATTLE_TURN_MS = 760;
const ACTIVE_SLOT_COUNT = 6;
const PASTEL = {
  rose: 0xf43f5e,
  roseSoft: 0xfda4af,
  rosePale: 0xffe4e6,
  white: 0xffffff,
  text: 0x4a1722,
  muted: 0x9f5460,
  blue: 0x60a5fa,
  green: 0x4ade80,
  violet: 0xa78bfa,
  amber: 0xfacc15,
  slate: 0x334155
};

const arenaSkillSlotLabels: Record<string, string> = {
  active: '액티브',
  passive: '패시브',
  ultimate: '궁극기'
};

const statDescriptions: Record<string, string> = {
  hp: '라운드에서 버틸 수 있는 기본 생존력입니다.',
  attack: '기본 공격과 물리형 피해의 중심 수치입니다.',
  defense: '받는 피해를 줄이고 전열 유지력을 높입니다.',
  speed: '행동 순서와 공격 템포에 영향을 줍니다.',
  focus: '스킬 발동 흐름과 스킬형 효과 안정성에 영향을 줍니다.'
};

const textureCache = new Map<string, Promise<PixiTexture>>();

const normalizeCombatToken = (value?: string | null) => String(value || '').trim().toLowerCase();

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const colorForAction = (turn?: ArenaBattleTurn) => {
  const text = `${turn?.actionType || ''} ${turn?.skillName || ''} ${turn?.events.map((event) => `${event.type || ''} ${event.message || ''}`).join(' ') || ''}`.toLowerCase();
  if (turn?.actionType === 'heal' || text.includes('heal') || text.includes('회복')) return PASTEL.green;
  if (turn?.actionType === 'guard' || text.includes('guard') || text.includes('shield') || text.includes('보호')) return PASTEL.blue;
  if (turn?.actionType === 'control' || text.includes('stun') || text.includes('slow') || text.includes('기절')) return PASTEL.violet;
  if (text.includes('ultimate') || text.includes('ult') || text.includes('궁극')) return PASTEL.amber;
  if (turn?.actionType === 'retire') return PASTEL.slate;
  return PASTEL.rose;
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const detectQuality = (): RendererQuality => {
  if (prefersReducedMotion()) return 'off';
  const savedQuality = window.localStorage?.getItem('arena:vfx-quality');
  if (savedQuality === 'off' || savedQuality === 'low' || savedQuality === 'high') return savedQuality;
  const nav = navigator as Navigator & { deviceMemory?: number; hardwareConcurrency?: number };
  const memory = Number(nav.deviceMemory || 4);
  const cores = Number(nav.hardwareConcurrency || 4);
  if (memory <= 2 || cores <= 2 || window.innerWidth < 560) return 'low';
  return 'high';
};

const loadTextureCached = (PIXI: PixiModule, url: string) => {
  const cached = textureCache.get(url);
  if (cached) return cached;
  const promise = PIXI.Assets.load(url) as Promise<PixiTexture>;
  textureCache.set(url, promise);
  return promise;
};

const clearContainer = (container: PixiContainer) => {
  container.removeChildren().forEach((child) => child.destroy({ children: true }));
};

const eventMatchesCard = (value: string | undefined, card: ArenaSnapshotCardDto) => {
  const token = normalizeCombatToken(value);
  if (!token) return false;
  return [card.name, card.card_id, card.channel_id].some((candidate) => {
    const normalized = normalizeCombatToken(candidate);
    return normalized && (token === normalized || token.includes(normalized) || normalized.includes(token));
  });
};

const eventMentionsCard = (event: ArenaReplayEvent | undefined, card: ArenaSnapshotCardDto) => {
  if (!event) return false;
  return eventMatchesCard(event.actor, card)
    || (event.targets || []).some((target) => eventMatchesCard(target, card))
    || eventMatchesCard(event.message, card);
};

const eventActorMentionsCard = (event: ArenaReplayEvent | undefined, card: ArenaSnapshotCardDto) => {
  return eventMatchesCard(event?.actor, card);
};

const eventTargetsCard = (event: ArenaReplayEvent | undefined, card: ArenaSnapshotCardDto) => {
  if (!event) return false;
  return (event.targets || []).some((target) => eventMatchesCard(target, card));
};

const eventKillsCard = (event: ArenaReplayEvent | undefined, card: ArenaSnapshotCardDto) => {
  if (!event || String(event.type || '').toUpperCase() !== 'DEATH') return false;
  return eventMatchesCard(event.actor, card) || eventTargetsCard(event, card) || eventMatchesCard(event.message, card);
};

const unitStateMatchesCard = (state: ArenaReplayUnitState | undefined, side: CombatSide, card: ArenaSnapshotCardDto) => {
  if (!state || state.side !== (side === 'player' ? 'player' : 'bot')) return false;
  return [state.card_id, state.channel_id, state.id].some((value) => eventMatchesCard(value, card));
};

const findUnitState = (unitStates: ArenaReplayUnitState[] | undefined, side: CombatSide, card: ArenaSnapshotCardDto) =>
  (unitStates || []).find((state) => unitStateMatchesCard(state, side, card));

const turnTargetsCard = (turn: ArenaBattleTurn | undefined, card: ArenaSnapshotCardDto) => {
  if (!turn) return false;
  return turn.targetIds.some((target) => eventMatchesCard(target, card))
    || turn.events.some((event) => eventMentionsCard(event, card) && !eventActorMentionsCard(event, card));
};

const getCardMaxHealth = (card: ArenaSnapshotCardDto) =>
  Math.max(1, Math.round(700 + Number(card.stats?.hp || 1) * 12));

const estimateCardHealth = (
  card: ArenaSnapshotCardDto,
  side: CombatSide,
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
  const dead = visibleEvents.some((event) => eventKillsCard(event, card));
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
  const displayRemaining = !dead && remaining <= 0 ? 1 : remaining;
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

const getCardBySlots = (
  cards: ArenaSnapshotCardDto[],
  slots: SelectedRoundSlot[]
): Array<{ card: ArenaSnapshotCardDto; slot: SelectedRoundSlot; visualIndex: number }> => {
  const byId = new Map(cards.map((card) => [card.card_id, card]));
  const ordered = [...slots].sort((a, b) => (b.row - a.row) || (a.col - b.col));
  const planned = ordered
    .map((slot, index) => {
      const card = byId.get(slot.card_id);
      return card ? { card, slot, visualIndex: index } : null;
    })
    .filter((item): item is { card: ArenaSnapshotCardDto; slot: SelectedRoundSlot; visualIndex: number } => Boolean(item));
  if (planned.length > 0) return planned;
  return cards.slice(0, ACTIVE_SLOT_COUNT).map((card, index) => ({
    card,
    slot: {
      card_id: card.card_id,
      row: (index < 3 ? 1 : 0) as 0 | 1,
      col: (index % 3) as 0 | 1 | 2
    },
    visualIndex: index
  }));
};

const getClassDescription = (card: ArenaSnapshotCardDto, classLookup: Map<string, ArenaRuleClass>) => {
  const catalogClass = classLookup.get(card.class_id);
  if (catalogClass?.description) return catalogClass.description;
  if (catalogClass?.role) return `${catalogClass.role} 성향의 전투 역할입니다.`;
  return '카드의 전투 역할과 기본 스탯 성향을 결정하는 클래스입니다.';
};

const getSkillDescription = (skill: NonNullable<ArenaSnapshotCardDto['skills']>[number], skillLookup: Map<string, ArenaRuleSkill>) => {
  const catalogSkill = skillLookup.get(skill.id);
  return catalogSkill?.description || `${arenaSkillSlotLabels[skill.type] || skill.type} 슬롯의 전투 스킬입니다.`;
};

const resolveName = (cards: ArenaSnapshotCardDto[], value?: string) => {
  const normalized = normalizeCombatToken(value);
  if (!normalized) return '';
  const found = cards.find((card) => [card.card_id, card.channel_id, card.name].some((candidate) => {
    const key = normalizeCombatToken(candidate);
    return key && (normalized === key || normalized.includes(key) || key.includes(normalized));
  }));
  return found?.name || value || '';
};

const stageKind = (roundReveal: RoundRevealState | null): BattleStageKind =>
  roundReveal?.stage === 'battle' ? 'battle' : roundReveal?.stage === 'result' ? 'result' : 'ready';

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

const addText = (
  PIXI: PixiModule,
  parent: PixiContainer,
  text: string,
  x: number,
  y: number,
  style: Partial<TextStyleOptions>
) => {
  const label = new PIXI.Text({ text, style });
  label.position.set(x, y);
  parent.addChild(label);
  return label;
};

const drawRoundRect = (
  PIXI: PixiModule,
  parent: PixiContainer,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: number,
  alpha = 1,
  stroke?: { color: number; alpha: number; width: number }
) => {
  const graphic = new PIXI.Graphics();
  graphic.roundRect(x, y, width, height, radius).fill({ color: fill, alpha });
  if (stroke) graphic.stroke(stroke);
  parent.addChild(graphic);
  return graphic;
};

const drawSoftShadow = (
  PIXI: PixiModule,
  parent: PixiContainer,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  color = 0x9f1239,
  alpha = 0.1
) => {
  const shadow = new PIXI.Graphics();
  shadow.roundRect(x, y, width, height, radius).fill({ color, alpha });
  shadow.position.set(0, 8);
  parent.addChild(shadow);
  return shadow;
};

const drawBoardLabel = (
  PIXI: PixiModule,
  parent: PixiContainer,
  text: string,
  x: number,
  y: number,
  color: number,
  align: 'left' | 'right' = 'left'
) => {
  const labelWidth = 54;
  const boxX = align === 'right' ? x - labelWidth : x;
  drawRoundRect(PIXI, parent, boxX, y, labelWidth, 18, 999, PASTEL.white, 0.58, { color, alpha: 0.28, width: 1 });
  addText(PIXI, parent, text, boxX + 11, y + 4, {
    fill: color,
    fontSize: 9,
    fontWeight: '900',
    fontFamily: 'Arial, sans-serif'
  });
};

const drawTargetMarker = (
  PIXI: PixiModule,
  parent: PixiContainer,
  card: PositionedCard,
  color: number,
  mode: 'actor' | 'target'
) => {
  const marker = new PIXI.Graphics();
  const inset = mode === 'actor' ? -6 : -9;
  marker.roundRect(card.x + inset, card.y + inset, card.width - inset * 2, card.height - inset * 2, 26)
    .stroke({ color, alpha: mode === 'actor' ? 0.54 : 0.76, width: mode === 'actor' ? 3 : 4 });
  marker.roundRect(card.x + inset + 5, card.y + inset + 5, card.width - inset * 2 - 10, card.height - inset * 2 - 10, 22)
    .stroke({ color: PASTEL.white, alpha: mode === 'actor' ? 0.28 : 0.38, width: 1.5 });
  parent.addChild(marker);
};

const drawTeamMat = (
  PIXI: PixiModule,
  parent: PixiContainer,
  cards: PositionedCard[],
  side: CombatSide
) => {
  if (cards.length === 0) return;
  const minX = Math.min(...cards.map((card) => card.x));
  const maxX = Math.max(...cards.map((card) => card.x + card.width));
  const minY = Math.min(...cards.map((card) => card.y));
  const maxY = Math.max(...cards.map((card) => card.y + card.height));
  const color = side === 'player' ? PASTEL.rose : 0xec4899;
  const mat = new PIXI.Graphics();
  mat.roundRect(minX - 10, minY - 12, maxX - minX + 20, maxY - minY + 24, 30)
    .fill({ color: side === 'player' ? 0xfff1f2 : 0xfdf2f8, alpha: 0.36 })
    .stroke({ color, alpha: 0.18, width: 1.5 });
  mat.moveTo(minX - 2, side === 'player' ? minY + (maxY - minY) / 2 : minY + (maxY - minY) / 2)
    .lineTo(maxX + 2, side === 'player' ? minY + (maxY - minY) / 2 : minY + (maxY - minY) / 2)
    .stroke({ color, alpha: 0.18, width: 1 });
  parent.addChild(mat);
  const frontRow = cards.find((card) => card.slot.row === 1);
  const backRow = cards.find((card) => card.slot.row === 0);
  if (frontRow) drawBoardLabel(PIXI, parent, '전열', minX - 2, frontRow.y - 18, color);
  if (backRow) drawBoardLabel(PIXI, parent, '후열', maxX + 2, backRow.y - 18, color, 'right');
};

const fitSprite = (sprite: PixiSprite, x: number, y: number, width: number, height: number) => {
  const sourceWidth = Math.max(1, sprite.texture.width || width);
  const sourceHeight = Math.max(1, sprite.texture.height || height);
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  sprite.scale.set(scale);
  sprite.position.set(x + (width - sourceWidth * scale) / 2, y + (height - sourceHeight * scale) / 2);
};

const computeBattleLayout = (width: number, height: number): BattleResponsiveLayout => {
  const compact = width < 620;
  const marginX = clamp(width * (compact ? 0.032 : 0.042), compact ? 10 : 18, compact ? 18 : 38);
  const cardGap = clamp(width * (compact ? 0.012 : 0.016), 6, compact ? 10 : 16);
  const rowGap = clamp(height * 0.014, 6, compact ? 10 : 14);
  const cardWidth = Math.floor((width - marginX * 2 - cardGap * 2) / 3);
  const portraitWidth = clamp(width * (compact ? 0.54 : 0.34), compact ? 170 : 210, compact ? 224 : 250);
  const portraitHeight = clamp(height * 0.072, compact ? 40 : 44, compact ? 48 : 54);
  const portraitGap = clamp(height * 0.014, 6, 13);
  const topReserved = portraitHeight + portraitGap + clamp(height * 0.012, 6, 12);
  const bottomReserved = portraitHeight + portraitGap + clamp(height * 0.014, 7, 14);
  const desiredMiddleGap = clamp(height * (compact ? 0.12 : 0.13), compact ? 58 : 70, compact ? 94 : 116);
  const maxCardHeightByCanvas = Math.floor((height - topReserved - bottomReserved - rowGap * 2 - desiredMiddleGap) / 4);
  const maxCardHeightByWidth = Math.floor(cardWidth * (compact ? 0.84 : 0.76));
  const cardHeight = Math.max(
    compact ? 68 : 76,
    Math.min(maxCardHeightByCanvas, maxCardHeightByWidth, compact ? 104 : 124)
  );
  const opponentBackTop = topReserved;
  const opponentFrontTop = opponentBackTop + cardHeight + rowGap;
  const playerBackTop = height - bottomReserved - cardHeight;
  const playerFrontTop = playerBackTop - rowGap - cardHeight;
  const opponentBlockBottom = opponentFrontTop + cardHeight;
  const centerLineY = (opponentBlockBottom + playerFrontTop) / 2;
  const middleGap = Math.max(1, playerFrontTop - opponentBlockBottom);
  const hudHeight = Math.min(clamp(height * 0.094, compact ? 54 : 62, compact ? 64 : 74), Math.max(46, middleGap - 10));
  const hudWidth = clamp(width * (compact ? 0.72 : 0.54), compact ? 238 : 290, compact ? width - marginX * 2 : 440);
  const hudX = (width - hudWidth) / 2;
  const hudY = clamp(centerLineY - hudHeight / 2, opponentBlockBottom + 5, playerFrontTop - hudHeight - 5);
  const portraitX = clamp((width - portraitWidth) / 2, marginX, Math.max(marginX, width - portraitWidth - marginX));
  return {
    marginX,
    cardGap,
    rowGap,
    cardWidth,
    cardHeight,
    opponentBackTop,
    opponentFrontTop,
    playerFrontTop,
    playerBackTop,
    centerLineY,
    hudWidth,
    hudHeight,
    hudX,
    hudY,
    portraitWidth,
    portraitHeight,
    opponentPortraitX: portraitX,
    opponentPortraitY: clamp(height * 0.012, 6, 12),
    playerPortraitX: portraitX,
    playerPortraitY: height - portraitHeight - clamp(height * 0.012, 6, 12)
  };
};

const makeLayout = (
  layout: BattleResponsiveLayout,
  playerCards: ArenaSnapshotCardDto[],
  opponentCards: ArenaSnapshotCardDto[],
  playerSlots: SelectedRoundSlot[],
  opponentSlots: SelectedRoundSlot[],
  revealOpponent: boolean,
  battleEvents: ArenaReplayEvent[],
  unitStates: ArenaReplayUnitState[] | undefined,
  battleEventIndex: number,
  roundReveal: RoundRevealState | null,
  roundResult?: ArenaRoundResultDto
) => {
  const stage = stageKind(roundReveal);
  const xForCol = (col: number) => layout.marginX + col * (layout.cardWidth + layout.cardGap);
  const yForSlot = (side: CombatSide, row: 0 | 1) => {
    if (side === 'opponent') return row === 0 ? layout.opponentBackTop : layout.opponentFrontTop;
    return row === 1 ? layout.playerFrontTop : layout.playerBackTop;
  };
  const build = (side: CombatSide, cards: ArenaSnapshotCardDto[], slots: SelectedRoundSlot[], revealed: boolean): PositionedCard[] => {
    const positioned = getCardBySlots(cards, slots);
    return positioned.map(({ card, slot, visualIndex }) => {
      const unitState = findUnitState(unitStates, side, card);
      const retired = stage === 'result'
        ? unitState ? !unitState.alive : battleEvents.some((event) => eventKillsCard(event, card))
        : false;
      return {
        card,
        side,
        slot,
        x: xForCol(slot.col),
        y: yForSlot(side, slot.row),
        width: layout.cardWidth,
        height: layout.cardHeight,
        retired,
        hidden: side === 'opponent' && !revealed,
        health: estimateCardHealth(card, side, battleEvents, battleEventIndex, retired, unitStates)
      };
    });
  };
  return [
    ...build('opponent', opponentCards, opponentSlots, revealOpponent),
    ...build('player', playerCards, playerSlots, true)
  ];
};

const drawTimer = (PIXI: PixiModule, parent: PixiContainer, x: number, y: number, radius: number, progress: number, color: number) => {
  const bg = new PIXI.Graphics();
  bg.circle(x, y, radius).fill({ color: PASTEL.white, alpha: 0.72 }).stroke({ color: PASTEL.roseSoft, alpha: 0.55, width: 2 });
  parent.addChild(bg);
  const ring = new PIXI.Graphics();
  ring.arc(x, y, radius - 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(progress, 0, 1));
  ring.stroke({ color, alpha: 0.98, width: 4, cap: 'round' });
  parent.addChild(ring);
};

const drawCard = async (
  PIXI: PixiModule,
  zoneLayer: PixiContainer,
  card: PositionedCard,
  activeTurn: ArenaBattleTurn | undefined,
  battleStage: BattleStageKind,
  turnProgress: number,
  quality: RendererQuality,
  skillLookup: Map<string, ArenaRuleSkill>,
  classLookup: Map<string, ArenaRuleClass>,
  hoverZones: HoverZone[]
): Promise<CardVisual> => {
  const root = new PIXI.Container();
  root.position.set(card.x + card.width / 2, card.y + card.height / 2);
  root.pivot.set(card.width / 2, card.height / 2);
  zoneLayer.addChild(root);

  const acting = battleStage === 'battle' && activeTurn?.actor && eventMatchesCard(activeTurn.actor, card.card) && card.health.remaining > 0;
  const targeted = battleStage === 'battle' && turnTargetsCard(activeTurn, card.card);
  const value = getTurnValueForCard(activeTurn, card.card);
  const actionColor = colorForAction(activeTurn);
  const isFrontline = card.slot.row === 1;
  const alpha = card.retired || card.health.remaining <= 0 ? 0.5 : card.hidden ? 0.86 : 1;
  const bodyFill = card.side === 'player' ? 0xfff1f2 : 0xffe4e6;
  const borderColor = acting ? actionColor : targeted ? PASTEL.rose : isFrontline ? PASTEL.roseSoft : 0xfecdd3;

  drawSoftShadow(PIXI, root, 3, 3, card.width - 6, card.height - 6, 22, targeted ? actionColor : PASTEL.rose, targeted ? 0.18 : 0.1);
  drawRoundRect(PIXI, root, 0, 0, card.width, card.height, 22, bodyFill, 0.88, { color: borderColor, alpha: acting || targeted ? 0.96 : 0.55, width: acting || targeted ? 3 : 1.5 });
  if (isFrontline) {
    const ribbon = new PIXI.Graphics();
    ribbon.roundRect(8, 7, 42, 14, 999).fill({ color: PASTEL.rose, alpha: 0.82 });
    root.addChild(ribbon);
    addText(PIXI, root, '전열', 18, 9, {
      fill: PASTEL.white,
      fontSize: 8,
      fontWeight: '900',
      fontFamily: 'Arial, sans-serif'
    });
  }
  const shine = new PIXI.Graphics();
  shine.roundRect(1.5, 1.5, card.width - 3, card.height - 3, 20)
    .fill({ color: PASTEL.white, alpha: 0.15 });
  shine.moveTo(0, card.height * 0.16).lineTo(card.width * 0.72, 0).lineTo(card.width, 0).lineTo(0, card.height * 0.42).fill({ color: PASTEL.white, alpha: 0.18 });
  root.addChild(shine);

  const mediaSize = Math.min(card.height - 20, card.width * 0.38);
  const mediaX = 10;
  const mediaY = (card.height - mediaSize) / 2;
  drawRoundRect(PIXI, root, mediaX, mediaY, mediaSize, mediaSize, 18, PASTEL.white, 0.72, { color: PASTEL.roseSoft, alpha: 0.32, width: 1 });

  if (card.hidden) {
    addText(PIXI, root, '?', mediaX + mediaSize / 2 - 8, mediaY + mediaSize / 2 - 18, {
      fill: PASTEL.rose,
      fontSize: 36,
      fontWeight: '900',
      fontFamily: 'Arial, sans-serif'
    });
  } else if (card.card.image_url) {
    try {
      const texture = await loadTextureCached(PIXI, proxiedImage(card.card.image_url, { width: 160, quality: quality === 'high' ? 78 : 62 }));
      const sprite = new PIXI.Sprite(texture);
      sprite.alpha = alpha;
      fitSprite(sprite, mediaX + 4, mediaY + 4, mediaSize - 8, mediaSize - 8);
      root.addChild(sprite);
    } catch {
      addText(PIXI, root, card.card.name.slice(0, 1), mediaX + mediaSize / 2 - 8, mediaY + mediaSize / 2 - 11, {
        fill: PASTEL.rose,
        fontSize: 22,
        fontWeight: '900',
        fontFamily: 'Arial, sans-serif'
      });
    }
  }

  const infoX = mediaX + mediaSize + 10;
  const infoW = card.width - infoX - 10;
  const title = card.hidden ? '상대 카드' : card.card.name;
  addText(PIXI, root, title, infoX, 13, {
    fill: PASTEL.text,
    fontSize: clamp(card.width * 0.06, 11, 14),
    fontWeight: '900',
    fontFamily: 'Arial, sans-serif',
    wordWrap: true,
    wordWrapWidth: infoW
  });
  const classY = 34;
  addText(PIXI, root, card.hidden ? '비공개' : card.card.class_name, infoX, classY, {
    fill: PASTEL.rose,
    fontSize: 10,
    fontWeight: '900',
    fontFamily: 'Arial, sans-serif'
  });
  if (!card.hidden) {
    hoverZones.push({
      x: card.x + infoX,
      y: card.y + classY,
      width: infoW,
      height: 16,
      label: card.card.class_name,
      description: getClassDescription(card.card, classLookup)
    });
  }

  const skillY = card.height - 50;
  if (!card.hidden) {
    (card.card.skills || []).slice(0, 3).forEach((skill, index) => {
      const dotX = infoX + index * 22;
      const dot = new PIXI.Graphics();
      const skillColor = skill.type === 'ultimate' ? PASTEL.amber : skill.type === 'passive' ? PASTEL.blue : PASTEL.rose;
      dot.circle(dotX + 6, skillY + 6, 6).fill({ color: skillColor, alpha: 0.92 })
        .stroke({ color: PASTEL.white, alpha: 0.9, width: 1.5 });
      root.addChild(dot);
      hoverZones.push({
        x: card.x + dotX - 4,
        y: card.y + skillY - 4,
        width: 20,
        height: 20,
        label: `${skill.name} (${arenaSkillSlotLabels[skill.type] || skill.type})`,
        description: getSkillDescription(skill, skillLookup)
      });
    });
  }

  const hpY = card.height - 18;
  drawRoundRect(PIXI, root, infoX, hpY, infoW, 7, 999, 0x7f1d1d, 0.15);
  drawRoundRect(PIXI, root, infoX, hpY, Math.max(0, infoW * card.health.percent / 100), 7, 999, card.health.percent < 30 ? 0xef4444 : PASTEL.rose, 0.95);
  addText(PIXI, root, `${card.health.remaining}/${card.health.max}`, infoX + infoW - 46, hpY - 15, {
    fill: PASTEL.muted,
    fontSize: 9,
    fontWeight: '900',
    fontFamily: 'Arial, sans-serif'
  });

  if (!card.hidden && card.card.stats) {
    const statKeys = ['attack', 'defense', 'speed', 'focus'] as const;
    statKeys.forEach((key, index) => {
      const x = infoX + index * Math.min(34, infoW / 4);
      const y = skillY + 19;
      const label = key === 'attack' ? 'ATK' : key === 'defense' ? 'DEF' : key === 'speed' ? 'SPD' : 'FOC';
      addText(PIXI, root, `${label} ${card.card.stats?.[key] ?? 0}`, x, y, {
        fill: PASTEL.muted,
        fontSize: 8,
        fontWeight: '900',
        fontFamily: 'Arial, sans-serif'
      });
      hoverZones.push({
        x: card.x + x,
        y: card.y + y,
        width: 32,
        height: 12,
        label: `${label} ${card.card.stats?.[key] ?? 0}`,
        description: statDescriptions[key]
      });
    });
  }

  if (card.retired || card.health.remaining <= 0) {
    const veil = new PIXI.Graphics();
    veil.roundRect(0, 0, card.width, card.height, 22).fill({ color: 0x111827, alpha: 0.36 });
    veil.moveTo(20, 15).lineTo(card.width - 20, card.height - 15).stroke({ color: PASTEL.white, alpha: 0.7, width: 4 });
    veil.moveTo(card.width - 20, 15).lineTo(20, card.height - 15).stroke({ color: PASTEL.white, alpha: 0.42, width: 2 });
    root.addChild(veil);
    addText(PIXI, root, 'RETIRE', card.width / 2 - 32, card.height / 2 - 10, {
      fill: PASTEL.white,
      fontSize: 15,
      fontWeight: '900',
      fontFamily: 'Arial, sans-serif'
    });
  }

  if (acting) {
    drawTimer(PIXI, root, card.width - 16, 16, 14, 1 - turnProgress, actionColor);
  }

  if (targeted && value > 0) {
    const badgeFill = activeTurn?.actionType === 'heal' ? PASTEL.green : activeTurn?.actionType === 'guard' ? PASTEL.blue : PASTEL.rose;
    drawRoundRect(PIXI, root, card.width / 2 - 30, -12, 60, 22, 999, badgeFill, 0.96);
    addText(PIXI, root, activeTurn?.actionType === 'heal' || activeTurn?.actionType === 'guard' ? `+${value}` : `-${value}`, card.width / 2 - 14, -8, {
      fill: PASTEL.white,
      fontSize: 12,
      fontWeight: '900',
      fontFamily: 'Arial, sans-serif'
    });
  }

  root.alpha = alpha;
  return { root, card };
};

const drawPortrait = async (
  PIXI: PixiModule,
  parent: PixiContainer,
  x: number,
  y: number,
  label: string,
  caption: string,
  imageUrl?: string | null,
  side: CombatSide = 'player',
  loadout?: ArenaCosmeticLoadout | null,
  size?: { width: number; height: number }
) => {
  const width = size?.width || 220;
  const height = size?.height || 48;
  const avatarSize = clamp(height * 0.7, 28, 38);
  const avatarX = clamp(width * 0.04, 7, 10);
  const avatarY = (height - avatarSize) / 2;
  const textX = avatarX + avatarSize + clamp(width * 0.04, 8, 12);
  const root = new PIXI.Container();
  root.position.set(x, y);
  parent.addChild(root);
  drawRoundRect(PIXI, root, 0, 0, width, height, Math.min(22, height / 2), PASTEL.white, 0.7, { color: side === 'player' ? PASTEL.roseSoft : 0xfbcfe8, alpha: 0.5, width: 1.5 });
  const frameColor = loadout?.border_item ? PASTEL.amber : side === 'player' ? PASTEL.rose : PASTEL.roseSoft;
  drawRoundRect(PIXI, root, avatarX, avatarY, avatarSize, avatarSize, Math.min(14, avatarSize / 2.2), 0xfff1f2, 0.95, { color: frameColor, alpha: 0.82, width: 2 });
  if (imageUrl) {
    try {
      const texture = await loadTextureCached(PIXI, proxiedImage(imageUrl, { width: 96, quality: 72 }));
      const sprite = new PIXI.Sprite(texture);
      fitSprite(sprite, avatarX + 2, avatarY + 2, avatarSize - 4, avatarSize - 4);
      root.addChild(sprite);
    } catch {
      // Text fallback below is enough when remote image loading fails.
    }
  }
  addText(PIXI, root, label, textX, clamp(height * 0.18, 7, 10), {
    fill: PASTEL.text,
    fontSize: clamp(width * 0.055, 11, 13),
    fontWeight: '900',
    fontFamily: 'Arial, sans-serif',
    wordWrap: true,
    wordWrapWidth: Math.max(70, width - textX - 10)
  });
  addText(PIXI, root, caption, textX, clamp(height * 0.55, 23, 29), {
    fill: PASTEL.muted,
    fontSize: clamp(width * 0.04, 9, 10),
    fontWeight: '900',
    fontFamily: 'Arial, sans-serif'
  });
};

const drawCenterHud = (
  PIXI: PixiModule,
  parent: PixiContainer,
  layout: BattleResponsiveLayout,
  stage: BattleStageKind,
  activeTurn: ArenaBattleTurn | undefined,
  roundReveal: RoundRevealState | null,
  allCards: ArenaSnapshotCardDto[]
) => {
  const hudWidth = layout.hudWidth;
  const hudHeight = layout.hudHeight;
  const x = layout.hudX;
  const y = layout.hudY;
  const actionColor = colorForAction(activeTurn);
  drawSoftShadow(PIXI, parent, x + 2, y + 2, hudWidth - 4, hudHeight - 4, 26, actionColor, stage === 'battle' ? 0.16 : 0.09);
  drawRoundRect(PIXI, parent, x, y, hudWidth, hudHeight, 26, PASTEL.white, 0.8, { color: stage === 'battle' ? actionColor : PASTEL.roseSoft, alpha: 0.48, width: stage === 'battle' ? 2.5 : 1.5 });
  const accent = new PIXI.Graphics();
  accent.roundRect(x + 8, y + 8, 4, hudHeight - 16, 999).fill({ color: actionColor, alpha: 0.86 });
  parent.addChild(accent);
  const kicker = stage === 'battle' ? '행동' : stage === 'result' ? '라운드 결과' : '전술 준비';
  const title = stage === 'result'
    ? roundReveal?.winner === 'player'
      ? '내 라운드 승리'
      : roundReveal?.winner === 'bot'
        ? '상대 라운드 승리'
        : '라운드 무승부'
    : stage === 'battle'
      ? getTurnActionLabel(activeTurn)
      : '전술 준비';
  const target = activeTurn?.targetIds.map((id) => resolveName(allCards, id)).filter(Boolean).slice(0, 2).join(', ');
  const caption = stage === 'battle' && activeTurn
    ? `${resolveName(allCards, activeTurn.actor) || '전투 카드'} → ${target || '대상'}`
    : '카드 배치와 전술 선택이 전투 흐름을 만듭니다.';
  addText(PIXI, parent, kicker, x + 22, y + 10, {
    fill: actionColor,
    fontSize: clamp(hudHeight * 0.14, 8, 10),
    fontWeight: '900',
    fontFamily: 'Arial, sans-serif'
  });
  addText(PIXI, parent, title, x + 22, y + clamp(hudHeight * 0.36, 20, 26), {
    fill: PASTEL.text,
    fontSize: clamp(hudHeight * 0.24, 13, 17),
    fontWeight: '900',
    fontFamily: 'Arial, sans-serif',
    wordWrap: true,
    wordWrapWidth: Math.max(120, hudWidth - 54)
  });
  addText(PIXI, parent, caption, x + 22, y + hudHeight - clamp(hudHeight * 0.3, 18, 22), {
    fill: PASTEL.muted,
    fontSize: clamp(hudHeight * 0.14, 8, 10),
    fontWeight: '900',
    fontFamily: 'Arial, sans-serif',
    wordWrap: true,
    wordWrapWidth: Math.max(120, hudWidth - 54)
  });
  if (stage === 'battle' && hudWidth > 310) {
    drawRoundRect(PIXI, parent, x + hudWidth - 108, y + 17, 78, 8, 999, 0x7f1d1d, 0.12);
    drawRoundRect(PIXI, parent, x + hudWidth - 108, y + 17, 54, 8, 999, actionColor, 0.72);
    const pulse = new PIXI.Graphics();
    pulse.circle(x + hudWidth - 18, y + 22, 7).fill({ color: actionColor, alpha: 0.88 }).circle(x + hudWidth - 18, y + 22, 13).stroke({ color: actionColor, alpha: 0.28, width: 2 });
    parent.addChild(pulse);
  }
};

const animate = (
  app: PixiApp,
  durationMs: number,
  update: (progress: number) => void,
  done?: () => void
) => {
  const start = performance.now();
  app.ticker.start();
  const ticker = () => {
    const progress = Math.min(1, (performance.now() - start) / durationMs);
    update(progress);
    if (progress >= 1) {
      app.ticker.remove(ticker);
      done?.();
      if (app.ticker.count === 0) app.ticker.stop();
    }
  };
  app.ticker.add(ticker);
  return () => {
    app.ticker.remove(ticker);
    if (app.ticker.count === 0) app.ticker.stop();
  };
};

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const playAction = (
  PIXI: PixiModule,
  app: PixiApp,
  layer: PixiContainer,
  visuals: CardVisual[],
  activeTurn: ArenaBattleTurn | undefined,
  quality: RendererQuality
) => {
  if (!activeTurn || activeTurn.actionType === 'start') return;
  const actor = visuals.find((visual) => !visual.card.hidden && eventMatchesCard(activeTurn.actor, visual.card.card) && visual.card.health.remaining > 0);
  const targets = visuals.filter((visual) => !visual.card.hidden && activeTurn.targetIds.some((target) => eventMatchesCard(target, visual.card.card)));
  const target = targets[0];
  if (!target) return;
  const color = colorForAction(activeTurn);
  const effectLayer = new PIXI.Container();
  layer.addChild(effectLayer);
  const targetX = target.card.x + target.card.width / 2;
  const targetY = target.card.y + target.card.height / 2;
  const actorX = actor ? actor.card.x + actor.card.width / 2 : targetX;
  const actorY = actor ? actor.card.y + actor.card.height / 2 : targetY;
  const dx = targetX - actorX;
  const dy = targetY - actorY;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const unitX = dx / distance;
  const unitY = dy / distance;
  const isSupport = activeTurn.actionType === 'heal' || activeTurn.actionType === 'guard';
  const isProjectile = activeTurn.actionType === 'skill' || activeTurn.actionType === 'control';
  const duration = isProjectile ? 480 : isSupport ? 520 : 620;
  const particles = quality === 'high' ? 14 : 7;

  if (isSupport) {
    const aura = new PIXI.Graphics();
    effectLayer.addChild(aura);
    const motes = Array.from({ length: particles }, (_, index) => {
      const mote = new PIXI.Graphics();
      effectLayer.addChild(mote);
      return { mote, index };
    });
    animate(app, duration, (progress) => {
      const eased = easeOut(progress);
      aura.clear();
      aura.circle(targetX, targetY, 28 + eased * 58).stroke({ color, alpha: 0.62 * (1 - progress), width: 5 });
      if (activeTurn.actionType === 'guard') aura.roundRect(target.card.x - 8, target.card.y - 8, target.card.width + 16, target.card.height + 16, 26).stroke({ color, alpha: 0.44 * (1 - progress), width: 4 });
      motes.forEach(({ mote, index }) => {
        mote.clear();
        const angle = (Math.PI * 2 * index) / particles;
        const local = clamp((progress - index * 0.025) / 0.74, 0, 1);
        mote.circle(targetX + Math.cos(angle) * 36 * local, targetY + 32 - local * 76, 3.5).fill({ color, alpha: 1 - local });
      });
    }, () => {
      effectLayer.destroy({ children: true });
    });
    return;
  }

  if (isProjectile) {
    const trail = new PIXI.Graphics();
    const projectile = new PIXI.Graphics();
    effectLayer.addChild(trail, projectile);
    animate(app, duration, (progress) => {
      const eased = easeInOut(progress);
      const curve = Math.sin(progress * Math.PI) * (activeTurn.actionType === 'control' ? 34 : 18);
      const normalX = -unitY * curve;
      const normalY = unitX * curve;
      const x = actorX + dx * eased + normalX;
      const y = actorY + dy * eased + normalY;
      trail.clear();
      trail.moveTo(actorX, actorY).lineTo(x, y).stroke({ color, alpha: 0.38, width: activeTurn.actionType === 'control' ? 7 : 5, cap: 'round' });
      projectile.clear();
      projectile.ellipse(x, y, activeTurn.actionType === 'control' ? 20 : 17, 7).fill({ color: PASTEL.white, alpha: 0.92 }).stroke({ color, alpha: 0.86, width: 3 });
      projectile.rotation = Math.atan2(dy, dx);
    }, () => {
      trail.destroy();
      projectile.destroy();
      playImpactBurst(PIXI, app, effectLayer, targetX, targetY, color, activeTurn.actionType === 'control' ? 1.15 : 1, quality);
      window.setTimeout(() => effectLayer.destroy({ children: true }), 420);
    });
    return;
  }

  if (actor) {
    const originX = actor.root.position.x;
    const originY = actor.root.position.y;
    const actorHalf = actor.card.height * 0.42;
    const targetHalf = target.card.height * 0.42;
    const contact = Math.max(0, distance - actorHalf - targetHalf * 0.78);
    const attackTrail = new PIXI.Graphics();
    const contactSpark = new PIXI.Graphics();
    effectLayer.addChild(attackTrail, contactSpark);
    animate(app, duration, (progress) => {
      let travel = 0;
      if (progress < 0.18) {
        travel = -0.18 * easeOut(progress / 0.18);
      } else if (progress < 0.54) {
        travel = -0.18 + 1.24 * easeInOut((progress - 0.18) / 0.36);
      } else if (progress < 0.64) {
        travel = 1.06;
      } else {
        travel = 1.06 * (1 - easeOut((progress - 0.64) / 0.36));
      }
      const hitWindow = progress >= 0.46 && progress <= 0.72;
      const impactPulse = hitWindow ? Math.sin((progress - 0.46) / 0.26 * Math.PI) : 0;
      const travelX = unitX * contact * travel;
      const travelY = unitY * contact * travel;
      actor.root.position.set(originX + travelX, originY + travelY);
      actor.root.rotation = Math.sin(progress * Math.PI * 3.5) * 0.055 + unitX * 0.025;
      actor.root.scale.set(1 + impactPulse * 0.055, 1 - impactPulse * 0.035);

      attackTrail.clear();
      if (progress > 0.2 && progress < 0.66) {
        const trailAlpha = progress < 0.54 ? 0.42 : 0.42 * (1 - (progress - 0.54) / 0.12);
        attackTrail.moveTo(originX - unitX * actor.card.width * 0.35, originY - unitY * actor.card.height * 0.35)
          .lineTo(originX + travelX - unitX * actor.card.width * 0.52, originY + travelY - unitY * actor.card.height * 0.52)
          .stroke({ color: PASTEL.white, alpha: trailAlpha, width: 14, cap: 'round' });
        attackTrail.moveTo(originX - unitX * actor.card.width * 0.16, originY - unitY * actor.card.height * 0.16)
          .lineTo(originX + travelX - unitX * actor.card.width * 0.18, originY + travelY - unitY * actor.card.height * 0.18)
          .stroke({ color, alpha: trailAlpha * 0.78, width: 8, cap: 'round' });
      }

      contactSpark.clear();
      if (impactPulse > 0) {
        const sparkX = targetX - unitX * target.card.width * 0.22;
        const sparkY = targetY - unitY * target.card.height * 0.22;
        contactSpark.circle(sparkX, sparkY, 16 + impactPulse * 18).stroke({ color, alpha: 0.58 * impactPulse, width: 4 });
        contactSpark.moveTo(sparkX - 38 * unitY, sparkY + 38 * unitX).lineTo(sparkX + 38 * unitY, sparkY - 38 * unitX).stroke({ color: PASTEL.white, alpha: 0.72 * impactPulse, width: 5, cap: 'round' });
      }

      if (hitWindow) {
        const shake = Math.sin(progress * Math.PI * 28) * 10 * impactPulse;
        const cross = Math.cos(progress * Math.PI * 24) * 4 * impactPulse;
        target.root.position.set(
          target.card.x + target.card.width / 2 + unitX * shake - unitY * cross,
          target.card.y + target.card.height / 2 + unitY * shake + unitX * cross
        );
        target.root.rotation = Math.sin(progress * Math.PI * 22) * 0.028 * impactPulse;
        target.root.scale.set(1 - impactPulse * 0.025, 1 + impactPulse * 0.04);
        app.stage.position.set(Math.sin(progress * Math.PI * 30) * 2.2 * impactPulse, Math.cos(progress * Math.PI * 26) * 1.6 * impactPulse);
      }
    }, () => {
      actor.root.position.set(originX, originY);
      actor.root.rotation = 0;
      actor.root.scale.set(1);
      target.root.position.set(target.card.x + target.card.width / 2, target.card.y + target.card.height / 2);
      target.root.rotation = 0;
      target.root.scale.set(1);
      app.stage.position.set(0, 0);
      attackTrail.destroy();
      contactSpark.destroy();
      playImpactBurst(PIXI, app, effectLayer, targetX, targetY, color, 1.2, quality);
      window.setTimeout(() => effectLayer.destroy({ children: true }), 480);
    });
  }
};

const playImpactBurst = (
  PIXI: PixiModule,
  app: PixiApp,
  layer: PixiContainer,
  x: number,
  y: number,
  color: number,
  scale: number,
  quality: RendererQuality
) => {
  const burst = new PIXI.Container();
  layer.addChild(burst);
  const ring = new PIXI.Graphics();
  const core = new PIXI.Graphics();
  const slashA = new PIXI.Graphics();
  burst.addChild(ring, core, slashA);
  const count = quality === 'high' ? 16 : 8;
  const particles = Array.from({ length: count }, (_, index) => {
    const particle = new PIXI.Graphics();
    burst.addChild(particle);
    return { particle, angle: (Math.PI * 2 * index) / count, distance: 34 + (index % 3) * 12 };
  });
  animate(app, 340, (progress) => {
    const eased = easeOut(progress);
    ring.clear();
    core.clear();
    slashA.clear();
    ring.circle(x, y, (24 + 52 * eased) * scale).stroke({ color, alpha: 0.72 * (1 - progress), width: Math.max(1, 6 * (1 - progress)) });
    core.circle(x, y, (18 + 10 * eased) * scale).fill({ color: PASTEL.white, alpha: 0.5 * (1 - progress) });
    slashA.moveTo(x - 58 * scale, y - 22 * scale).lineTo(x + 58 * scale, y + 22 * scale).stroke({ color: PASTEL.white, alpha: 0.95 * (1 - progress), width: 7, cap: 'round' });
    slashA.moveTo(x - 42 * scale, y + 28 * scale).lineTo(x + 42 * scale, y - 28 * scale).stroke({ color, alpha: 0.78 * (1 - progress), width: 5, cap: 'round' });
    particles.forEach(({ particle, angle, distance }) => {
      particle.clear();
      particle.circle(x + Math.cos(angle) * distance * eased, y + Math.sin(angle) * distance * eased, 3 * (1 - progress * 0.45)).fill({ color, alpha: 0.9 * (1 - progress) });
    });
  }, () => {
    burst.destroy({ children: true });
  });
};

export const ArenaPixiBattleRenderer: React.FC<ArenaPixiBattleRendererProps> = ({
  match,
  playerCards,
  opponentCards,
  playerSlots,
  opponentSlots,
  activeTurn,
  battleEvents,
  unitStates,
  battleEventIndex,
  revealOpponent,
  roundReveal,
  roundResult,
  skillLookup,
  classLookup,
  user,
  loadout,
  displayPlayerRoundWins,
  displayOpponentRoundWins
}) => {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const appRef = React.useRef<PixiApp | null>(null);
  const pixiRef = React.useRef<PixiModule | null>(null);
  const sceneRef = React.useRef<PixiContainer | null>(null);
  const actionLayerRef = React.useRef<PixiContainer | null>(null);
  const hoverZonesRef = React.useRef<HoverZone[]>([]);
  const latestRenderIdRef = React.useRef(0);
  const lastTurnIdRef = React.useRef<string | null>(null);
  const renderSceneRef = React.useRef<() => void>(() => {});
  const [tooltip, setTooltip] = React.useState<TooltipState | null>(null);
  const qualityRef = React.useRef<RendererQuality>('high');

  const allCards = React.useMemo(() => [...playerCards, ...opponentCards], [playerCards, opponentCards]);
  const stage = stageKind(roundReveal);
  const opponentAvatar = opponentCards[0]?.image_url || `https://api.dicebear.com/10.x/fun-emoji/svg?seed=${encodeURIComponent(match.player_b_id || `arena-bot-${match.id}`)}`;
  const playerLabel = user?.username || '나';
  const opponentLabel = match.match_type === 'RANKED' ? '상대 플레이어' : 'AI 연습 상대';

  const renderScene = React.useCallback(async () => {
    const app = appRef.current;
    const PIXI = pixiRef.current;
    const scene = sceneRef.current;
    const actionLayer = actionLayerRef.current;
    if (!app || !PIXI || !scene || !actionLayer) return;
    const renderId = latestRenderIdRef.current + 1;
    latestRenderIdRef.current = renderId;
    hoverZonesRef.current = [];
    clearContainer(scene);
    clearContainer(actionLayer);
    const width = app.renderer.width / app.renderer.resolution;
    const height = app.renderer.height / app.renderer.resolution;
    const layout = computeBattleLayout(width, height);
    const cards = makeLayout(layout, playerCards, opponentCards, playerSlots, opponentSlots, revealOpponent, battleEvents, unitStates, battleEventIndex, roundReveal, roundResult);
    const bg = new PIXI.Graphics();
    bg.rect(0, 0, width, height).fill({ color: 0xfff1f2, alpha: 0.2 });
    bg.circle(width * 0.5, height * 0.5, Math.min(width, height) * 0.42).fill({ color: PASTEL.white, alpha: 0.18 });
    bg.circle(width * 0.22, height * 0.3, Math.min(width, height) * 0.2).fill({ color: PASTEL.roseSoft, alpha: 0.08 });
    bg.circle(width * 0.78, height * 0.72, Math.min(width, height) * 0.24).fill({ color: PASTEL.rose, alpha: 0.07 });
    bg.moveTo(0, layout.centerLineY).lineTo(width, layout.centerLineY).stroke({ color: PASTEL.roseSoft, alpha: 0.22, width: 2 });
    scene.addChild(bg);
    drawTeamMat(PIXI, scene, cards.filter((card) => card.side === 'opponent'), 'opponent');
    drawTeamMat(PIXI, scene, cards.filter((card) => card.side === 'player'), 'player');

    await Promise.all([
      drawPortrait(PIXI, scene, layout.opponentPortraitX, layout.opponentPortraitY, opponentLabel, `${displayOpponentRoundWins ?? match.player_b_round_wins ?? 0} 라운드 승`, revealOpponent ? opponentAvatar : null, 'opponent', null, { width: layout.portraitWidth, height: layout.portraitHeight }),
      drawPortrait(PIXI, scene, layout.playerPortraitX, layout.playerPortraitY, playerLabel, `${displayPlayerRoundWins ?? match.player_a_round_wins ?? 0} 라운드 승`, user?.avatarUrl, 'player', loadout, { width: layout.portraitWidth, height: layout.portraitHeight })
    ]);
    if (renderId !== latestRenderIdRef.current) return;

    drawCenterHud(PIXI, scene, layout, stage, activeTurn, roundReveal, allCards);
    if (stage === 'battle' && activeTurn) {
      const actionColor = colorForAction(activeTurn);
      const actorCard = cards.find((card) => !card.hidden && eventMatchesCard(activeTurn.actor, card.card));
      const targetCards = cards.filter((card) => !card.hidden && activeTurn.targetIds.some((target) => eventMatchesCard(target, card.card)));
      if (actorCard) drawTargetMarker(PIXI, scene, actorCard, actionColor, 'actor');
      targetCards.forEach((card) => drawTargetMarker(PIXI, scene, card, actionColor, 'target'));
      if (actorCard && targetCards[0]) {
        const line = new PIXI.Graphics();
        line.moveTo(actorCard.x + actorCard.width / 2, actorCard.y + actorCard.height / 2)
          .lineTo(targetCards[0].x + targetCards[0].width / 2, targetCards[0].y + targetCards[0].height / 2)
          .stroke({ color: actionColor, alpha: 0.2, width: 3, cap: 'round' });
        scene.addChild(line);
      }
    }
    const turnProgress = stage === 'battle' ? Math.min(1, ((Date.now() % PIXI_BATTLE_TURN_MS) / PIXI_BATTLE_TURN_MS)) : 0;
    const zoneLayer = new PIXI.Container();
    scene.addChild(zoneLayer);
    const visuals = await Promise.all(cards.map((card) => drawCard(PIXI, zoneLayer, card, activeTurn, stage, turnProgress, qualityRef.current, skillLookup, classLookup, hoverZonesRef.current)));
    if (renderId !== latestRenderIdRef.current) return;
    if (stage === 'battle' && activeTurn && activeTurn.id !== lastTurnIdRef.current && qualityRef.current !== 'off') {
      lastTurnIdRef.current = activeTurn.id;
      playAction(PIXI, app, actionLayer, visuals, activeTurn, qualityRef.current);
    }
  }, [activeTurn, allCards, battleEventIndex, battleEvents, classLookup, displayOpponentRoundWins, displayPlayerRoundWins, loadout, match.id, match.match_type, match.player_a_round_wins, match.player_b_id, match.player_b_round_wins, opponentAvatar, opponentCards, opponentLabel, opponentSlots, playerCards, playerLabel, playerSlots, revealOpponent, roundResult, roundReveal, skillLookup, stage, unitStates, user?.avatarUrl]);

  React.useEffect(() => {
    renderSceneRef.current = renderScene;
  }, [renderScene]);

  React.useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    const setup = async () => {
      const host = hostRef.current;
      if (!host) return;
      qualityRef.current = detectQuality();
      const PIXI = await import('pixi.js');
      if (cancelled || !hostRef.current) return;
      pixiRef.current = PIXI;
      const app = new PIXI.Application();
      const rect = host.getBoundingClientRect();
      await app.init({
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
        backgroundAlpha: 0,
        antialias: qualityRef.current === 'high',
        autoDensity: true,
        resolution: qualityRef.current === 'high' ? Math.min(window.devicePixelRatio || 1, 1.5) : 1,
        powerPreference: qualityRef.current === 'high' ? 'high-performance' : 'low-power'
      });
      if (cancelled || !hostRef.current) {
        app.destroy();
        return;
      }
      app.canvas.className = 'arena-pixi-battle-canvas';
      app.ticker.stop();
      host.appendChild(app.canvas);
      const scene = new PIXI.Container();
      const actionLayer = new PIXI.Container();
      app.stage.addChild(scene, actionLayer);
      appRef.current = app;
      sceneRef.current = scene;
      actionLayerRef.current = actionLayer;
      resizeObserver = new ResizeObserver(([entry]) => {
        if (!entry || !appRef.current) return;
        appRef.current.renderer.resize(Math.max(1, Math.round(entry.contentRect.width)), Math.max(1, Math.round(entry.contentRect.height)));
        renderSceneRef.current();
      });
      resizeObserver.observe(host);
      renderSceneRef.current();
    };
    setup().catch(() => {
      qualityRef.current = 'off';
    });
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (sceneRef.current) clearContainer(sceneRef.current);
      if (actionLayerRef.current) clearContainer(actionLayerRef.current);
      sceneRef.current?.destroy({ children: true });
      actionLayerRef.current?.destroy({ children: true });
      sceneRef.current = null;
      actionLayerRef.current = null;
      appRef.current?.destroy();
      appRef.current = null;
      pixiRef.current = null;
      latestRenderIdRef.current += 1;
    };
  }, []);

  React.useEffect(() => {
    renderScene();
  }, [renderScene]);

  const handlePointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const zone = hoverZonesRef.current.find((item) => x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height);
    if (!zone) {
      setTooltip(null);
      return;
    }
    setTooltip({
      ...zone,
      screenX: clamp(x + 14, 12, Math.max(12, rect.width - 304)),
      screenY: clamp(y - 22, 12, Math.max(12, rect.height - 126))
    });
  }, []);

  return (
    <div
      ref={hostRef}
      className="arena-pixi-battle-renderer"
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setTooltip(null)}
      aria-label="PixiJS 아레나 전투 렌더러"
    >
      <div className="arena-pixi-battle-fallback" aria-hidden="true">
        <span>전투 화면을 준비하는 중</span>
      </div>
      {tooltip ? (
        <div
          className="arena-pixi-tooltip"
          style={{
            left: `${tooltip.screenX}px`,
            top: `${tooltip.screenY}px`
          }}
        >
          <p>{tooltip.label}</p>
          <span>{tooltip.description}</span>
        </div>
      ) : null}
    </div>
  );
};
