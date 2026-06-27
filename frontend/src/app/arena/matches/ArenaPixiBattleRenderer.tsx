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
import { resolveArenaVfxPreset, type ArenaVfxPresetKind } from '@/lib/arenaVfxPresets';
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

const CARD_STYLE = {
  player: {
    fillTop: 0xfffffb,
    fillBottom: 0xffeef2,
    rail: 0xfb7185,
    chip: 0xfff5f6,
    glow: 0xffa3ad
  },
  opponent: {
    fillTop: 0xfffffb,
    fillBottom: 0xffeaf1,
    rail: 0xf472b6,
    chip: 0xfff1f6,
    glow: 0xf9a8d4
  }
};

const roleAccent: Record<string, number> = {
  frontline: 0xfb7185,
  damage: 0xf43f5e,
  control: 0xa78bfa,
  support: 0x4ade80,
  tempo: 0x60a5fa
};

const roleLabels: Record<string, string> = {
  frontline: '전열',
  damage: '딜러',
  control: '제어',
  support: '지원',
  tempo: '템포'
};

const skillGlyphs: Record<string, string> = {
  active: 'A',
  passive: 'P',
  ultimate: 'U'
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

const roleDescriptions: Record<string, string> = {
  frontline: '전열에서 피해를 받아내고 상대의 공격 흐름을 붙잡는 역할입니다.',
  damage: '핵심 대상에게 피해를 누적해 라운드 승리 조건을 앞당기는 역할입니다.',
  control: '둔화, 약화, 방해 효과로 상대 전술의 템포를 흔드는 역할입니다.',
  support: '회복, 보호막, 버프를 통해 팀 전체의 안정성을 높이는 역할입니다.',
  tempo: '행동 순서와 배치 변수를 활용해 라운드 흐름을 바꾸는 역할입니다.'
};

const skillTypeDescriptions: Record<string, string> = {
  active: '라운드 중 조건을 만족하면 직접 발동해 피해, 회복, 보호, 방해 같은 즉시 효과를 만듭니다.',
  passive: '전투 내내 조건부로 적용되어 카드의 역할과 스탯 운용을 보조합니다.',
  ultimate: '에너지가 충분할 때 전세를 크게 바꾸는 강한 한 번의 효과입니다.'
};

const MAX_TEXTURE_CACHE_ENTRIES = 90;
const textureCache = new Map<string, Promise<PixiTexture>>();

const normalizeCombatToken = (value?: string | null) => String(value || '').trim().toLowerCase();

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const colorForAction = (turn?: ArenaBattleTurn) => {
  return visualProfileForTurn(turn).color;
};

type TurnVisualKind = ArenaVfxPresetKind;

const getTurnVisualKind = (turn?: ArenaBattleTurn): TurnVisualKind => {
  return visualProfileForTurn(turn).kind;
};

const visualProfileForTurn = (turn?: ArenaBattleTurn) => {
  const text = turn ? `${turn.actionType || ''} ${turn.skillName || ''} ${turn.events.map((event) => `${event.type || ''} ${event.message || ''}`).join(' ')}` : '';
  const preset = resolveArenaVfxPreset({
    vfxKind: turn?.vfxKind,
    damageType: turn?.damageType,
    actionType: turn?.actionType,
    skillType: turn?.skillType,
    effectTags: turn?.effectTags,
    text
  });
  if (turn?.actionType === 'attack' && preset.kind === 'effect') return { ...preset, kind: 'attack' as const };
  if (turn?.actionType === 'skill' && preset.kind === 'effect') return { ...preset, kind: 'skill' as const };
  return preset;
};

const turnPhaseLabel = (stage: BattleStageKind, turn?: ArenaBattleTurn, progress = 0) => {
  if (stage === 'result') return '결산';
  if (stage !== 'battle') return '준비';
  if (!turn || turn.actionType === 'start') return '개전';
  if (progress < 0.22) return '시전';
  if (progress < 0.58) return turn.actionType === 'attack' ? '돌진' : '발사';
  if (progress < 0.78) return '충돌';
  return '정리';
};

const statusLabelForTurn = (turn?: ArenaBattleTurn) => {
  return turn ? visualProfileForTurn(turn).label : '';
};

const actionGlyphForTurn = (turn?: ArenaBattleTurn) => {
  return turn ? visualProfileForTurn(turn).glyph : '•';
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

const resolvePixiImageUrls = (
  url: string,
  options: { width?: number; quality?: number }
) => {
  const proxied = proxiedImage(url, options);
  return Array.from(new Set([url, proxied].filter(Boolean)));
};

const loadImageElementTexture = async (PIXI: PixiModule, url: string) => {
  const response = await fetch(url, {
    cache: 'force-cache',
    credentials: 'same-origin'
  });
  if (!response.ok) throw new Error(`IMAGE_FETCH_${response.status}`);
  const blob = await response.blob();
  if (blob.type && !blob.type.startsWith('image/')) throw new Error('IMAGE_FETCH_NOT_IMAGE');
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('IMAGE_ELEMENT_LOAD_FAILED'));
      image.src = objectUrl;
    });
    try {
      await image.decode?.();
    } catch {
      // onload is enough for older or already-decoded images.
    }
    return PIXI.Texture.from(image) as PixiTexture;
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
};

const loadTextureCached = (PIXI: PixiModule, urls: string | string[]) => {
  const candidates = Array.isArray(urls) ? urls.filter(Boolean) : [urls].filter(Boolean);
  const cacheKey = candidates.join('|');
  const cached = textureCache.get(cacheKey);
  if (cached) return cached;
  if (textureCache.size >= MAX_TEXTURE_CACHE_ENTRIES) {
    const oldestKey = textureCache.keys().next().value;
    if (oldestKey) textureCache.delete(oldestKey);
  }
  const promise = (async () => {
    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        return await loadImageElementTexture(PIXI, candidate);
      } catch (error) {
        lastError = error;
      }
      try {
        return await PIXI.Assets.load(candidate) as PixiTexture;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('IMAGE_LOAD_FAILED');
  })();
  textureCache.set(cacheKey, promise);
  return promise;
};

const renderPixiFrame = (app: PixiApp) => {
  try {
    app.render();
  } catch {
    try {
      app.renderer.render({ container: app.stage });
    } catch {
      // Rendering is best-effort here; the next ticker frame can still recover.
    }
  }
};

const schedulePixiFrame = (app: PixiApp) => {
  if (typeof window === 'undefined') {
    renderPixiFrame(app);
    return;
  }
  const anyApp = app as PixiApp & { __arenaRenderFrame?: number };
  if (anyApp.__arenaRenderFrame) return;
  anyApp.__arenaRenderFrame = window.requestAnimationFrame(() => {
    anyApp.__arenaRenderFrame = undefined;
    renderPixiFrame(app);
  });
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
  const catalogClass = classLookup.get(card.class_id) || [...classLookup.values()].find((item) => item.name === card.class_name);
  if (catalogClass?.description) return catalogClass.description;
  const role = String(catalogClass?.role || (card as any).class_role || '').trim();
  if (role && roleDescriptions[role]) return roleDescriptions[role];
  const stats = card.stats || {};
  const topStat = (Object.entries(stats).sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0]?.[0] || '') as keyof typeof statDescriptions;
  const statHint = statDescriptions[topStat] || '카드의 전투 역할과 기본 스탯 성향을 결정합니다.';
  return `${card.class_name || '클래스'}는 ${statHint}`;
};

const getSkillDescription = (skill: NonNullable<ArenaSnapshotCardDto['skills']>[number], skillLookup: Map<string, ArenaRuleSkill>) => {
  const catalogSkill = skillLookup.get(skill.id) || [...skillLookup.values()].find((item) => item.name === skill.name);
  if (catalogSkill?.description) return catalogSkill.description;
  const slotLabel = arenaSkillSlotLabels[skill.type] || skill.type || '스킬';
  const typeHint = skillTypeDescriptions[skill.type] || '라운드 계산 중 카드의 역할과 스탯에 맞춰 적용됩니다.';
  return `${skill.name}은 ${slotLabel} 슬롯 스킬입니다. ${typeHint}`;
};

const getCardRole = (card: ArenaSnapshotCardDto, classLookup: Map<string, ArenaRuleClass>) => {
  const catalogClass = classLookup.get(card.class_id) || [...classLookup.values()].find((item) => item.name === card.class_name);
  const role = String(catalogClass?.role || (card as any).class_role || '').trim();
  if (role) return role;
  const classText = `${card.class_id} ${card.class_name}`.toLowerCase();
  if (['guardian', 'shield', 'knight', 'wall', '방패', '수호', '전열'].some((token) => classText.includes(token))) return 'frontline';
  if (['heal', 'bard', 'support', '치유', '지원'].some((token) => classText.includes(token))) return 'support';
  if (['mage', 'curse', 'control', '교란', '서리', '저주'].some((token) => classText.includes(token))) return 'control';
  if (['tempo', 'switch', 'trapper', '환영', '템포'].some((token) => classText.includes(token))) return 'tempo';
  return 'damage';
};

const shortenName = (value: string, max = 12) => {
  const text = String(value || '').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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
  const badgeWidth = mode === 'actor' ? 62 : 64;
  const badgeX = mode === 'actor' ? card.x + 10 : card.x + card.width - badgeWidth - 10;
  const badgeY = card.y - 17;
  drawRoundRect(PIXI, parent, badgeX, badgeY, badgeWidth, 20, 999, mode === 'actor' ? color : PASTEL.white, mode === 'actor' ? 0.94 : 0.9, { color, alpha: 0.72, width: 1.4 });
  addText(PIXI, parent, mode === 'actor' ? 'ACTION' : 'TARGET', badgeX + 12, badgeY + 5, {
    fill: mode === 'actor' ? PASTEL.white : color,
    fontSize: 9,
    fontWeight: '900',
    fontFamily: 'Arial, sans-serif'
  });
};

const drawActionFocus = (
  PIXI: PixiModule,
  parent: PixiContainer,
  actor: PositionedCard | undefined,
  targets: PositionedCard[],
  color: number,
  turnProgress: number
) => {
  if (!actor && targets.length === 0) return;
  const focus = new PIXI.Graphics();
  const pulse = 0.5 + Math.sin(turnProgress * Math.PI) * 0.5;
  const drawGlow = (card: PositionedCard, intensity: number) => {
    const cx = card.x + card.width / 2;
    const cy = card.y + card.height / 2;
    focus.ellipse(cx, cy, card.width * (0.72 + pulse * 0.08), card.height * (0.62 + pulse * 0.06))
      .fill({ color, alpha: 0.055 * intensity });
    focus.roundRect(card.x - 10, card.y - 10, card.width + 20, card.height + 20, 30)
      .stroke({ color, alpha: 0.14 * intensity + pulse * 0.08, width: 2 });
  };
  if (actor) drawGlow(actor, 0.9);
  targets.forEach((target) => drawGlow(target, 1.15));
  if (actor && targets[0]) {
    const ax = actor.x + actor.width / 2;
    const ay = actor.y + actor.height / 2;
    targets.slice(0, 3).forEach((target, index) => {
      const tx = target.x + target.width / 2;
      const ty = target.y + target.height / 2;
      const midX = (ax + tx) / 2;
      const midY = (ay + ty) / 2;
      const bend = (index - 1) * 8;
      focus.moveTo(ax, ay)
        .quadraticCurveTo(midX - (ty - ay) * 0.08 + bend, midY + (tx - ax) * 0.08, tx, ty)
        .stroke({ color: PASTEL.white, alpha: 0.24, width: 7, cap: 'round' });
      focus.moveTo(ax, ay)
        .quadraticCurveTo(midX - (ty - ay) * 0.08 + bend, midY + (tx - ax) * 0.08, tx, ty)
        .stroke({ color, alpha: 0.34, width: 3, cap: 'round' });
      const angle = Math.atan2(ty - ay, tx - ax);
      const arrowX = tx - Math.cos(angle) * target.width * 0.34;
      const arrowY = ty - Math.sin(angle) * target.height * 0.34;
      focus.moveTo(arrowX, arrowY)
        .lineTo(arrowX - Math.cos(angle - 0.55) * 18, arrowY - Math.sin(angle - 0.55) * 18)
        .lineTo(arrowX - Math.cos(angle + 0.55) * 18, arrowY - Math.sin(angle + 0.55) * 18)
        .lineTo(arrowX, arrowY)
        .fill({ color, alpha: 0.58 });
    });
  }
  parent.addChild(focus);
};

const drawStageBanner = (
  PIXI: PixiModule,
  parent: PixiContainer,
  layout: BattleResponsiveLayout,
  width: number,
  height: number,
  stage: BattleStageKind,
  activeTurn: ArenaBattleTurn | undefined,
  roundReveal: RoundRevealState | null,
  roundResult?: ArenaRoundResultDto
) => {
  const showBattleStart = stage === 'battle' && activeTurn?.actionType === 'start';
  const showResult = stage === 'result';
  if (!showBattleStart && !showResult) return;

  const color = showResult
    ? roundReveal?.winner === 'player'
      ? PASTEL.rose
      : roundReveal?.winner === 'bot'
        ? 0xec4899
        : PASTEL.violet
    : PASTEL.rose;
  const title = showResult
    ? roundReveal?.winner === 'player'
      ? '라운드 승리'
      : roundReveal?.winner === 'bot'
        ? '라운드 패배'
        : '라운드 무승부'
    : '라운드 시작';
  const playerDamage = Number(roundResult?.player_total_damage || 0);
  const opponentDamage = Number(roundResult?.bot_total_damage || 0);
  const caption = showResult
    ? `피해 ${playerDamage} : ${opponentDamage} · 생존 ${roundResult?.player_remaining_units ?? 0} : ${roundResult?.bot_remaining_units ?? 0}`
    : '선택한 전술대로 전투가 전개됩니다';
  const bannerWidth = clamp(width * 0.56, 260, 520);
  const bannerHeight = clamp(height * 0.12, 64, 92);
  const x = (width - bannerWidth) / 2;
  const y = clamp(layout.centerLineY - bannerHeight / 2, layout.opponentFrontTop + layout.cardHeight + 6, layout.playerFrontTop - bannerHeight - 6);
  const banner = new PIXI.Container();
  parent.addChild(banner);

  const aura = new PIXI.Graphics();
  aura.ellipse(width / 2, y + bannerHeight / 2, bannerWidth * 0.62, bannerHeight * 0.92)
    .fill({ color, alpha: showResult ? 0.16 : 0.11 });
  aura.ellipse(width / 2, y + bannerHeight / 2, bannerWidth * 0.42, bannerHeight * 0.54)
    .fill({ color: PASTEL.white, alpha: 0.16 });
  banner.addChild(aura);

  const panel = new PIXI.Graphics();
  panel.roundRect(x, y, bannerWidth, bannerHeight, 30)
    .fill({ color: PASTEL.white, alpha: 0.9 })
    .stroke({ color, alpha: 0.52, width: 2.2 });
  panel.roundRect(x + 7, y + 7, bannerWidth - 14, bannerHeight - 14, 24)
    .stroke({ color: PASTEL.white, alpha: 0.72, width: 1.3 });
  panel.moveTo(x + 20, y + bannerHeight - 18)
    .lineTo(x + bannerWidth - 20, y + 18)
    .stroke({ color, alpha: 0.08, width: 12, cap: 'round' });
  banner.addChild(panel);

  const leftWing = new PIXI.Graphics();
  const rightWing = new PIXI.Graphics();
  leftWing.moveTo(x - 34, y + bannerHeight / 2)
    .lineTo(x + 24, y + 13)
    .lineTo(x + 20, y + bannerHeight - 12)
    .fill({ color, alpha: 0.18 });
  rightWing.moveTo(x + bannerWidth + 34, y + bannerHeight / 2)
    .lineTo(x + bannerWidth - 24, y + 13)
    .lineTo(x + bannerWidth - 20, y + bannerHeight - 12)
    .fill({ color, alpha: 0.18 });
  banner.addChild(leftWing, rightWing);

  const titleText = new PIXI.Text({
    text: title,
    style: {
      fill: PASTEL.text,
      fontSize: clamp(bannerHeight * 0.32, 22, 32),
      fontWeight: '900',
      fontFamily: 'Arial, sans-serif',
      stroke: { color: PASTEL.white, width: 4 }
    }
  });
  titleText.anchor.set(0.5);
  titleText.position.set(width / 2, y + bannerHeight * 0.42);
  banner.addChild(titleText);

  const captionText = new PIXI.Text({
    text: caption,
    style: {
      fill: PASTEL.muted,
      fontSize: clamp(bannerHeight * 0.13, 10, 12),
      fontWeight: '900',
      fontFamily: 'Arial, sans-serif'
    }
  });
  captionText.anchor.set(0.5);
  captionText.position.set(width / 2, y + bannerHeight * 0.72);
  banner.addChild(captionText);

  const sparkleCount = showResult ? 18 : 10;
  for (let index = 0; index < sparkleCount; index += 1) {
    const angle = (Math.PI * 2 * index) / sparkleCount;
    const sx = width / 2 + Math.cos(angle) * bannerWidth * (0.38 + (index % 3) * 0.045);
    const sy = y + bannerHeight / 2 + Math.sin(angle) * bannerHeight * (0.42 + (index % 2) * 0.12);
    const sparkle = new PIXI.Graphics();
    sparkle.moveTo(sx, sy - 5).lineTo(sx + 4, sy).lineTo(sx, sy + 5).lineTo(sx - 4, sy)
      .fill({ color: index % 2 === 0 ? PASTEL.white : color, alpha: showResult ? 0.72 : 0.46 });
    banner.addChild(sparkle);
  }
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
  mat.roundRect(minX - 12, minY - 14, maxX - minX + 24, maxY - minY + 28, 32)
    .fill({ color: side === 'player' ? 0xfff1f2 : 0xfdf2f8, alpha: 0.42 })
    .stroke({ color, alpha: 0.2, width: 1.5 });
  mat.roundRect(minX - 6, minY - 8, maxX - minX + 12, maxY - minY + 16, 26)
    .stroke({ color: PASTEL.white, alpha: 0.46, width: 1 });
  const splitY = minY + (maxY - minY) / 2;
  mat.moveTo(minX + 8, splitY)
    .lineTo(maxX - 8, splitY)
    .stroke({ color, alpha: 0.18, width: 1.5, cap: 'round' });
  mat.moveTo(minX + 18, side === 'player' ? maxY + 10 : minY - 10)
    .lineTo(maxX - 18, side === 'player' ? maxY + 10 : minY - 10)
    .stroke({ color, alpha: 0.22, width: 3, cap: 'round' });
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
  const short = height < 660;
  const marginX = clamp(width * (compact ? 0.032 : 0.042), compact ? 10 : 18, compact ? 18 : 38);
  const cardGap = clamp(width * (compact ? 0.012 : 0.016), 6, compact ? 10 : 16);
  const rowGap = clamp(height * (short ? 0.01 : 0.014), short ? 4 : 6, compact ? 10 : 14);
  const cardWidth = Math.floor((width - marginX * 2 - cardGap * 2) / 3);
  const portraitWidth = clamp(width * (compact ? 0.54 : 0.34), compact ? 164 : 210, compact ? 224 : 250);
  const portraitHeight = clamp(height * 0.072, compact ? 36 : 44, compact ? 48 : 54);
  const portraitGap = clamp(height * 0.014, 6, 13);
  const topReserved = portraitHeight + portraitGap + clamp(height * 0.012, 6, 12);
  const bottomReserved = portraitHeight + portraitGap + clamp(height * 0.014, 7, 14);
  const desiredMiddleGap = clamp(height * (compact ? 0.12 : 0.13), short ? 48 : compact ? 58 : 70, compact ? 94 : 116);
  const maxCardHeightByCanvas = Math.floor((height - topReserved - bottomReserved - rowGap * 2 - desiredMiddleGap) / 4);
  const maxCardHeightByWidth = Math.floor(cardWidth * (compact ? 0.84 : 0.76));
  const minCardHeight = short ? compact ? 94 : 98 : compact ? 118 : 104;
  const cardHeight = clamp(Math.min(maxCardHeightByCanvas, maxCardHeightByWidth, compact ? 132 : 124), minCardHeight, compact ? 132 : 124);
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
      const resultRetired = stage === 'result'
        ? unitState ? !unitState.alive : battleEvents.some((event) => eventKillsCard(event, card))
        : false;
      const health = estimateCardHealth(card, side, battleEvents, battleEventIndex, resultRetired, unitStates);
      const retired = resultRetired || health.remaining <= 0;
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
        health
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

const drawCard = (
  PIXI: PixiModule,
  zoneLayer: PixiContainer,
  card: PositionedCard,
  activeTurn: ArenaBattleTurn | undefined,
  battleStage: BattleStageKind,
  turnProgress: number,
  quality: RendererQuality,
  skillLookup: Map<string, ArenaRuleSkill>,
  classLookup: Map<string, ArenaRuleClass>,
  hoverZones: HoverZone[],
  requestRender?: () => void
): CardVisual => {
  const root = new PIXI.Container();
  root.position.set(card.x + card.width / 2, card.y + card.height / 2);
  root.pivot.set(card.width / 2, card.height / 2);
  zoneLayer.addChild(root);

  const acting = battleStage === 'battle' && activeTurn?.actor && eventMatchesCard(activeTurn.actor, card.card) && card.health.remaining > 0;
  const targeted = battleStage === 'battle' && turnTargetsCard(activeTurn, card.card);
  const value = getTurnValueForCard(activeTurn, card.card);
  const actionColor = colorForAction(activeTurn);
  const isFrontline = card.slot.row === 1;
  const isInactiveDuringAction = battleStage === 'battle'
    && Boolean(activeTurn)
    && activeTurn?.actionType !== 'start'
    && !acting
    && !targeted
    && card.health.remaining > 0
    && !card.retired;
  const alpha = (card.retired || card.health.remaining <= 0 ? 0.5 : card.hidden ? 0.86 : 1) * (isInactiveDuringAction ? 0.78 : 1);
  const role = getCardRole(card.card, classLookup);
  const roleColor = roleAccent[role] || PASTEL.rose;
  const palette = card.side === 'player' ? CARD_STYLE.player : CARD_STYLE.opponent;
  const borderColor = acting ? actionColor : targeted ? PASTEL.rose : roleColor;
  const cornerRadius = clamp(card.width * 0.12, 18, 26);
  const narrowCard = card.width < 155;

  drawSoftShadow(PIXI, root, 3, 8, card.width - 6, card.height - 9, cornerRadius, targeted ? actionColor : palette.glow, targeted ? 0.24 : 0.14);
  drawRoundRect(PIXI, root, 0, 0, card.width, card.height, cornerRadius, palette.fillBottom, 0.98, { color: borderColor, alpha: acting || targeted ? 0.96 : 0.42, width: acting || targeted ? 2.8 : 1.2 });

  const cardSurface = new PIXI.Graphics();
  cardSurface.roundRect(3, 3, card.width - 6, card.height - 6, cornerRadius - 3)
    .fill({ color: palette.fillTop, alpha: 0.82 });
  cardSurface.roundRect(3, Math.max(4, card.height * 0.45), card.width - 6, card.height * 0.52, cornerRadius - 5)
    .fill({ color: palette.fillBottom, alpha: 0.7 });
  cardSurface.circle(card.width - 20, 18, 34).fill({ color: roleColor, alpha: 0.08 });
  cardSurface.circle(card.width - 30, card.height - 18, 46).fill({ color: roleColor, alpha: 0.045 });
  root.addChild(cardSurface);

  const accentRail = new PIXI.Graphics();
  if (narrowCard) {
    accentRail.roundRect(10, 8, card.width - 20, 5, 999).fill({ color: roleColor, alpha: card.hidden ? 0.38 : 0.86 });
  } else {
    accentRail.roundRect(7, 12, 5, card.height - 24, 999).fill({ color: roleColor, alpha: card.hidden ? 0.35 : 0.82 });
  }
  root.addChild(accentRail);

  const shine = new PIXI.Graphics();
  shine.roundRect(2, 2, card.width - 4, card.height - 4, cornerRadius - 2)
    .stroke({ color: PASTEL.white, alpha: 0.52, width: 1.2 });
  shine.moveTo(10, 9).lineTo(card.width * 0.52, 9).lineTo(card.width * 0.28, 24).lineTo(10, 27).fill({ color: PASTEL.white, alpha: 0.15 });
  shine.moveTo(card.width - 12, 10).lineTo(card.width - 34, 10).lineTo(card.width - 12, 32).fill({ color: PASTEL.white, alpha: 0.12 });
  root.addChild(shine);

  const mediaSize = narrowCard
    ? Math.min(card.width - 24, card.height * 0.43)
    : Math.min(card.height - 24, card.width * 0.43);
  const mediaX = narrowCard ? (card.width - mediaSize) / 2 : 17;
  const mediaY = narrowCard ? 18 : (card.height - mediaSize) / 2;
  drawSoftShadow(PIXI, root, mediaX + 1, mediaY + 4, mediaSize, mediaSize, 20, roleColor, 0.12);
  drawRoundRect(PIXI, root, mediaX, mediaY, mediaSize, mediaSize, 20, PASTEL.white, 0.94, { color: PASTEL.white, alpha: 0.86, width: 2.2 });
  const mediaInner = new PIXI.Graphics();
  mediaInner.roundRect(mediaX + 4, mediaY + 4, mediaSize - 8, mediaSize - 8, 16)
    .fill({ color: palette.chip, alpha: 0.9 })
    .stroke({ color: roleColor, alpha: 0.24, width: 1 });
  mediaInner.circle(mediaX + mediaSize - 12, mediaY + 12, 18).fill({ color: roleColor, alpha: 0.08 });
  root.addChild(mediaInner);
  const mediaLayer = new PIXI.Container();
  const mediaMask = new PIXI.Graphics();
  mediaMask.roundRect(mediaX + 4, mediaY + 4, mediaSize - 8, mediaSize - 8, 14).fill({ color: PASTEL.white, alpha: 1 });
  mediaLayer.mask = mediaMask;
  root.addChild(mediaMask, mediaLayer);

  if (card.hidden) {
    const hiddenMark = new PIXI.Graphics();
    hiddenMark.circle(mediaX + mediaSize / 2, mediaY + mediaSize / 2, mediaSize * 0.34).fill({ color: PASTEL.white, alpha: 0.68 })
      .stroke({ color: roleColor, alpha: 0.42, width: 2 });
    root.addChild(hiddenMark);
    addText(PIXI, root, '?', mediaX + mediaSize / 2 - 8, mediaY + mediaSize / 2 - 18, {
      fill: PASTEL.rose,
      fontSize: 36,
      fontWeight: '900',
      fontFamily: 'Arial, sans-serif'
    });
  } else if (card.card.image_url) {
    const fallbackInitial = addText(PIXI, root, card.card.name.slice(0, 1), mediaX + mediaSize / 2 - 8, mediaY + mediaSize / 2 - 11, {
      fill: PASTEL.rose,
      fontSize: 22,
      fontWeight: '900',
      fontFamily: 'Arial, sans-serif'
    });
    loadTextureCached(PIXI, resolvePixiImageUrls(card.card.image_url, { width: 220, quality: quality === 'high' ? 82 : 68 }))
      .then((texture) => {
        if ((root as any).destroyed) return;
        fallbackInitial.destroy();
        const sprite = new PIXI.Sprite(texture);
        sprite.alpha = alpha;
        fitSprite(sprite, mediaX + 4, mediaY + 4, mediaSize - 8, mediaSize - 8);
        mediaLayer.addChild(sprite);
        const imageGloss = new PIXI.Graphics();
        imageGloss.moveTo(mediaX + 8, mediaY + 8)
          .lineTo(mediaX + mediaSize * 0.78, mediaY + 8)
          .lineTo(mediaX + mediaSize * 0.4, mediaY + mediaSize * 0.38)
          .lineTo(mediaX + 8, mediaY + mediaSize * 0.48)
          .fill({ color: PASTEL.white, alpha: 0.12 });
        mediaLayer.addChild(imageGloss);
        requestRender?.();
      })
      .catch(() => {
        // The fallback initial remains visible when remote image loading fails.
      });
  }

  const infoX = narrowCard ? 10 : mediaX + mediaSize + 10;
  const infoW = narrowCard ? card.width - 20 : card.width - infoX - 10;
  const title = card.hidden ? '상대 카드' : card.card.name;
  const titleY = narrowCard ? mediaY + mediaSize + 7 : 15;
  if (!narrowCard) {
    const titleUnderlay = new PIXI.Graphics();
    titleUnderlay.roundRect(infoX - 3, titleY - 4, Math.min(infoW + 6, card.width - infoX - 7), 23, 10)
      .fill({ color: PASTEL.white, alpha: 0.44 });
    root.addChild(titleUnderlay);
  }
  addText(PIXI, root, shortenName(title, narrowCard ? 7 : card.width < 270 ? 11 : 15), infoX, titleY, {
    fill: PASTEL.text,
    fontSize: narrowCard ? 9 : clamp(card.width * 0.056, 12, 15),
    fontWeight: '900',
    fontFamily: 'Arial, sans-serif',
    wordWrap: true,
    wordWrapWidth: infoW
  });
  const metaY = narrowCard ? titleY + 15 : 38;
  if (!narrowCard) {
    const rowChipW = 34;
    drawRoundRect(PIXI, root, infoX, metaY - 2, rowChipW, 16, 999, roleColor, 0.88);
    addText(PIXI, root, isFrontline ? '전열' : '후열', infoX + 8, metaY + 1, {
      fill: PASTEL.white,
      fontSize: 8,
      fontWeight: '900',
      fontFamily: 'Arial, sans-serif'
    });
    const classChipX = infoX + rowChipW + 5;
    const classChipW = Math.min(infoW - rowChipW - 5, 86);
    drawRoundRect(PIXI, root, classChipX, metaY - 2, classChipW, 16, 999, palette.chip, 0.94, { color: roleColor, alpha: 0.22, width: 1 });
    addText(PIXI, root, card.hidden ? '비공개' : shortenName(card.card.class_name, 8), classChipX + 8, metaY + 1, {
      fill: roleColor,
      fontSize: 9,
      fontWeight: '900',
      fontFamily: 'Arial, sans-serif'
    });
  } else {
    const rowChipW = 32;
    const roleChipW = 38;
    const chipX = (card.width - rowChipW - roleChipW - 4) / 2;
    drawRoundRect(PIXI, root, chipX, 19, rowChipW, 14, 999, roleColor, 0.86);
    addText(PIXI, root, isFrontline ? '전열' : '후열', chipX + 6, 22, {
      fill: PASTEL.white,
      fontSize: 7,
      fontWeight: '900',
      fontFamily: 'Arial, sans-serif'
    });
    drawRoundRect(PIXI, root, chipX + rowChipW + 4, 19, roleChipW, 14, 999, PASTEL.white, 0.76, { color: roleColor, alpha: 0.2, width: 1 });
    addText(PIXI, root, roleLabels[role] || '전투', chipX + rowChipW + 11, 22, {
      fill: roleColor,
      fontSize: 7,
      fontWeight: '900',
      fontFamily: 'Arial, sans-serif'
    });
  }
  if (!card.hidden) {
    hoverZones.push({
      x: card.x + infoX,
      y: card.y + (narrowCard ? 19 : metaY),
      width: infoW,
      height: narrowCard ? 18 : 16,
      label: card.card.class_name,
      description: getClassDescription(card.card, classLookup)
    });
  }

  const skillY = narrowCard ? mediaY + mediaSize - 8 : 59;
  if (!card.hidden) {
    (card.card.skills || []).slice(0, 3).forEach((skill, index) => {
      const dotSize = narrowCard || card.height < 104 ? 15 : 17;
      const skillStartX = narrowCard
        ? (card.width - (dotSize * 3 + 8)) / 2
        : infoX;
      const dotX = skillStartX + index * (dotSize + 4);
      const skillColor = skill.type === 'ultimate' ? PASTEL.amber : skill.type === 'passive' ? PASTEL.blue : PASTEL.rose;
      const dot = new PIXI.Graphics();
      dot.circle(dotX + dotSize / 2, skillY + dotSize / 2, dotSize / 2).fill({ color: PASTEL.white, alpha: 0.92 })
        .stroke({ color: skillColor, alpha: 0.78, width: 1.6 });
      dot.circle(dotX + dotSize / 2, skillY + dotSize / 2, dotSize / 2 - 4).fill({ color: skillColor, alpha: 0.86 });
      root.addChild(dot);
      addText(PIXI, root, skillGlyphs[skill.type] || 'S', dotX + dotSize / 2 - 3.5, skillY + dotSize / 2 - 4.8, {
        fill: PASTEL.white,
        fontSize: dotSize < 18 ? 7 : 8,
        fontWeight: '900',
        fontFamily: 'Arial, sans-serif'
      });
      hoverZones.push({
        x: card.x + dotX - 3,
        y: card.y + skillY - 3,
        width: dotSize + 6,
        height: dotSize + 6,
        label: `${skill.name} (${arenaSkillSlotLabels[skill.type] || skill.type})`,
        description: getSkillDescription(skill, skillLookup)
      });
    });
  }

  const hpY = card.height - 17;
  const hpLabelX = narrowCard ? infoX : infoX + 63;
  addText(PIXI, root, 'HP', infoX, hpY - 14, {
    fill: PASTEL.muted,
    fontSize: 8,
    fontWeight: '900',
    fontFamily: 'Arial, sans-serif'
  });
  addText(PIXI, root, `${card.health.remaining}/${card.health.max}`, hpLabelX + Math.max(0, infoW - (hpLabelX - infoX) - 58), hpY - 14, {
    fill: PASTEL.text,
    fontSize: 8,
    fontWeight: '900',
    fontFamily: 'Arial, sans-serif'
  });
  drawRoundRect(PIXI, root, infoX, hpY, infoW, 8, 999, 0x7f1d1d, 0.12, { color: PASTEL.white, alpha: 0.5, width: 1 });
  drawRoundRect(PIXI, root, infoX + 1.5, hpY + 1.5, Math.max(0, (infoW - 3) * card.health.percent / 100), 5, 999, card.health.percent < 30 ? 0xef4444 : roleColor, 0.96);
  const hpGloss = new PIXI.Graphics();
  hpGloss.roundRect(infoX + 2, hpY + 2, Math.max(0, (infoW - 4) * card.health.percent / 100), 2, 999)
    .fill({ color: PASTEL.white, alpha: 0.32 });
  root.addChild(hpGloss);

  if (!narrowCard && !card.hidden && card.card.stats && card.height >= 118 && infoW >= 104) {
    const statKeys = ['attack', 'defense', 'speed', 'focus'] as const;
    statKeys.forEach((key, index) => {
      const chipW = Math.min(33, Math.max(25, (infoW - 6) / 4));
      const x = infoX + index * (chipW + 2);
      const y = card.height - 36;
      const label = key === 'attack' ? 'ATK' : key === 'defense' ? 'DEF' : key === 'speed' ? 'SPD' : 'FOC';
      drawRoundRect(PIXI, root, x, y - 2, chipW, 14, 999, PASTEL.white, 0.48, { color: roleColor, alpha: 0.12, width: 1 });
      addText(PIXI, root, `${label}`, x + 4, y + 1, {
        fill: PASTEL.muted,
        fontSize: 6.5,
        fontWeight: '900',
        fontFamily: 'Arial, sans-serif'
      });
      addText(PIXI, root, String(card.card.stats?.[key] ?? 0), x + chipW - 13, y + 1, {
        fill: PASTEL.text,
        fontSize: 7,
        fontWeight: '900',
        fontFamily: 'Arial, sans-serif'
      });
      hoverZones.push({
        x: card.x + x,
        y: card.y + y - 2,
        width: chipW,
        height: 15,
        label: `${label} ${card.card.stats?.[key] ?? 0}`,
        description: statDescriptions[key]
      });
    });
  }

  if (targeted && !card.hidden && !(card.retired || card.health.remaining <= 0)) {
    const stateColor = activeTurn?.actionType === 'heal'
      ? PASTEL.green
      : activeTurn?.actionType === 'guard'
        ? PASTEL.blue
        : activeTurn?.actionType === 'control'
          ? PASTEL.violet
          : actionColor;
    const bracket = new PIXI.Graphics();
    const inset = 7;
    const len = Math.min(22, card.width * 0.16);
    bracket.moveTo(inset, inset + len).lineTo(inset, inset).lineTo(inset + len, inset)
      .moveTo(card.width - inset - len, inset).lineTo(card.width - inset, inset).lineTo(card.width - inset, inset + len)
      .moveTo(inset, card.height - inset - len).lineTo(inset, card.height - inset).lineTo(inset + len, card.height - inset)
      .moveTo(card.width - inset - len, card.height - inset).lineTo(card.width - inset, card.height - inset).lineTo(card.width - inset, card.height - inset - len)
      .stroke({ color: stateColor, alpha: 0.78, width: 3, cap: 'round' });
    root.addChild(bracket);
    const badgeText = statusLabelForTurn(activeTurn);
    if (badgeText && !narrowCard) {
      drawRoundRect(PIXI, root, card.width - 54, card.height - 34, 42, 16, 999, PASTEL.white, 0.88, { color: stateColor, alpha: 0.42, width: 1.2 });
      addText(PIXI, root, badgeText, card.width - 45, card.height - 31, {
        fill: stateColor,
        fontSize: 8,
        fontWeight: '900',
        fontFamily: 'Arial, sans-serif'
      });
    }
  }

  if (!card.hidden && card.health.percent > 0 && card.health.percent <= 30 && !(card.retired || card.health.remaining <= 0)) {
    drawRoundRect(PIXI, root, 14, card.height - 34, 34, 15, 999, 0xef4444, 0.9);
    addText(PIXI, root, '위험', 22, card.height - 31, {
      fill: PASTEL.white,
      fontSize: 8,
      fontWeight: '900',
      fontFamily: 'Arial, sans-serif'
    });
  }

  if (card.retired || card.health.remaining <= 0) {
    const veil = new PIXI.Graphics();
    veil.roundRect(0, 0, card.width, card.height, 22).fill({ color: 0x111827, alpha: 0.42 });
    veil.moveTo(18, 16).lineTo(card.width * 0.42, card.height * 0.5).lineTo(24, card.height - 17)
      .moveTo(card.width - 18, 14).lineTo(card.width * 0.58, card.height * 0.5).lineTo(card.width - 26, card.height - 18)
      .stroke({ color: PASTEL.white, alpha: 0.42, width: 2.2, cap: 'round' });
    veil.moveTo(24, 20).lineTo(card.width - 24, card.height - 20).stroke({ color: PASTEL.white, alpha: 0.52, width: 3.2, cap: 'round' });
    root.addChild(veil);
    drawRoundRect(PIXI, root, card.width / 2 - 40, card.height / 2 - 16, 80, 27, 999, 0x111827, 0.58, { color: PASTEL.white, alpha: 0.28, width: 1 });
    addText(PIXI, root, '전투불능', card.width / 2 - 29, card.height / 2 - 8, {
      fill: PASTEL.white,
      fontSize: 13,
      fontWeight: '900',
      fontFamily: 'Arial, sans-serif'
    });
  }

  if (acting) {
    drawTimer(PIXI, root, card.width - 16, 16, 14, 1 - turnProgress, actionColor);
    const actionGlow = new PIXI.Graphics();
    actionGlow.roundRect(-5, -5, card.width + 10, card.height + 10, cornerRadius + 4)
      .stroke({ color: actionColor, alpha: 0.32 + Math.sin(turnProgress * Math.PI) * 0.18, width: 4 });
    root.addChildAt(actionGlow, 0);
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

const drawPortrait = (
  PIXI: PixiModule,
  parent: PixiContainer,
  x: number,
  y: number,
  label: string,
  caption: string,
  imageUrl?: string | null,
  side: CombatSide = 'player',
  loadout?: ArenaCosmeticLoadout | null,
  size?: { width: number; height: number },
  requestRender?: () => void
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
    loadTextureCached(PIXI, resolvePixiImageUrls(imageUrl, { width: 96, quality: 72 }))
      .then((texture) => {
        if ((root as any).destroyed) return;
      const sprite = new PIXI.Sprite(texture);
      fitSprite(sprite, avatarX + 2, avatarY + 2, avatarSize - 4, avatarSize - 4);
      root.addChild(sprite);
        requestRender?.();
      })
      .catch(() => {
        // Text fallback below is enough when remote image loading fails.
      });
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
  allCards: ArenaSnapshotCardDto[],
  turnProgress = 0,
  battleEventIndex = 0,
  battleEventCount = 0
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
  const glyphX = x + hudWidth - 24;
  const glyphY = y + hudHeight - 22;
  const glyphRing = new PIXI.Graphics();
  glyphRing.circle(glyphX, glyphY, 13)
    .fill({ color: PASTEL.white, alpha: 0.72 })
    .stroke({ color: actionColor, alpha: 0.52, width: 1.8 });
  glyphRing.circle(glyphX, glyphY, 7 + Math.sin(turnProgress * Math.PI) * 2)
    .stroke({ color: actionColor, alpha: stage === 'battle' ? 0.36 : 0.16, width: 1.4 });
  parent.addChild(glyphRing);
  const glyph = new PIXI.Text({
    text: actionGlyphForTurn(activeTurn),
    style: {
      fill: actionColor,
      fontSize: 13,
      fontWeight: '900',
      fontFamily: 'Arial, sans-serif'
    }
  });
  glyph.anchor.set(0.5);
  glyph.position.set(glyphX, glyphY - 1);
  parent.addChild(glyph);
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
  const phase = turnPhaseLabel(stage, activeTurn, turnProgress);
  const turnCounter = battleEventCount > 0 ? `${Math.min(battleEventIndex + 1, battleEventCount)}/${battleEventCount}` : '-';
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
  if (stage === 'battle' && activeTurn && hudWidth > 300) {
    const chipY = y + hudHeight - 18;
    drawRoundRect(PIXI, parent, x + hudWidth - 132, chipY, 46, 16, 999, PASTEL.white, 0.72, { color: actionColor, alpha: 0.2, width: 1 });
    addText(PIXI, parent, `턴 ${turnCounter}`, x + hudWidth - 121, chipY + 3, {
      fill: actionColor,
      fontSize: 8,
      fontWeight: '900',
      fontFamily: 'Arial, sans-serif'
    });
    drawRoundRect(PIXI, parent, x + hudWidth - 80, chipY, 56, 16, 999, actionColor, 0.9);
    addText(PIXI, parent, phase, x + hudWidth - 61, chipY + 3, {
      fill: PASTEL.white,
      fontSize: 8,
      fontWeight: '900',
      fontFamily: 'Arial, sans-serif'
    });
  }
  if (stage === 'battle' && hudWidth > 310) {
    const timerX = x + hudWidth - 116;
    const timerW = 82;
    drawRoundRect(PIXI, parent, timerX, y + 17, timerW, 8, 999, 0x7f1d1d, 0.12);
    drawRoundRect(PIXI, parent, timerX + 1, y + 18, Math.max(0, (timerW - 2) * (1 - turnProgress)), 6, 999, actionColor, 0.78);
    addText(PIXI, parent, phase, timerX + 23, y + 29, {
      fill: actionColor,
      fontSize: 9,
      fontWeight: '900',
      fontFamily: 'Arial, sans-serif'
    });
    const pulse = new PIXI.Graphics();
    pulse.circle(x + hudWidth - 18, y + 22, 7).fill({ color: actionColor, alpha: 0.88 }).circle(x + hudWidth - 18, y + 22, 13 + Math.sin(turnProgress * Math.PI) * 3).stroke({ color: actionColor, alpha: 0.28, width: 2 });
    parent.addChild(pulse);
  }
  if (stage === 'battle' && battleEventCount > 1 && hudWidth > 250) {
    const dotCount = Math.min(7, Math.max(3, Math.ceil(battleEventCount / 2)));
    const progress = clamp(battleEventIndex / Math.max(1, battleEventCount - 1), 0, 1);
    const startX = x + 24;
    const dotY = y + hudHeight + 8;
    const railW = Math.min(116, hudWidth - 48);
    const rail = new PIXI.Graphics();
    rail.roundRect(startX, dotY - 3, railW, 6, 999)
      .fill({ color: PASTEL.white, alpha: 0.38 })
      .stroke({ color: actionColor, alpha: 0.12, width: 1 });
    rail.roundRect(startX + 1, dotY - 2, Math.max(4, (railW - 2) * progress), 4, 999)
      .fill({ color: actionColor, alpha: 0.72 });
    parent.addChild(rail);
    for (let index = 0; index < dotCount; index += 1) {
      const dotProgress = dotCount === 1 ? 0 : index / (dotCount - 1);
      const active = progress + 0.001 >= dotProgress;
      const dot = new PIXI.Graphics();
      dot.circle(startX + railW * dotProgress, dotY, active ? 4.2 : 3)
        .fill({ color: active ? actionColor : PASTEL.white, alpha: active ? 0.9 : 0.58 })
        .stroke({ color: active ? PASTEL.white : actionColor, alpha: active ? 0.72 : 0.2, width: 1 });
      parent.addChild(dot);
    }
  }
};

const animate = (
  app: PixiApp,
  durationMs: number,
  update: (progress: number) => void,
  done?: () => void
) => {
  const start = performance.now();
  let disposed = false;
  app.ticker.start();
  const ticker = () => {
    if (disposed) return;
    const progress = Math.min(1, (performance.now() - start) / durationMs);
    try {
      update(progress);
    } catch {
      disposed = true;
      app.ticker.remove(ticker);
      if (app.ticker.count === 0) app.ticker.stop();
      return;
    }
    if (progress >= 1) {
      disposed = true;
      app.ticker.remove(ticker);
      try {
        done?.();
      } catch {
        // Animation cleanup should never break the ticker for the next combat turn.
      }
      renderPixiFrame(app);
      if (app.ticker.count === 0) app.ticker.stop();
    }
  };
  app.ticker.add(ticker);
  return () => {
    disposed = true;
    app.ticker.remove(ticker);
    if (app.ticker.count === 0) app.ticker.stop();
  };
};

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const destroyPixiContainerSafe = (container: PixiContainer) => {
  try {
    if (!(container as any).destroyed) container.destroy({ children: true });
  } catch {
    // A previous render may have already cleaned up this transient effect.
  }
};

const actionValueText = (turn: ArenaBattleTurn | undefined) => {
  const value = Math.max(0, Number(turn?.value || 0));
  if (!turn || value <= 0) return '';
  if (turn.actionType === 'heal' || turn.actionType === 'guard') return `+${value}`;
  return `-${value}`;
};

const playFloatingText = (
  PIXI: PixiModule,
  app: PixiApp,
  layer: PixiContainer,
  text: string,
  x: number,
  y: number,
  color: number
) => {
  if (!text) return;
  const shadow = new PIXI.Text({
    text,
    style: {
      fill: 0x7f1d1d,
      fontSize: 24,
      fontWeight: '900',
      fontFamily: 'Arial, sans-serif',
      stroke: { color: PASTEL.white, width: 4 }
    }
  });
  shadow.anchor.set(0.5);
  shadow.position.set(x + 2, y + 2);
  shadow.alpha = 0.34;
  const label = new PIXI.Text({
    text,
    style: {
      fill: color,
      fontSize: 24,
      fontWeight: '900',
      fontFamily: 'Arial, sans-serif',
      stroke: { color: PASTEL.white, width: 5 }
    }
  });
  label.anchor.set(0.5);
  label.position.set(x, y);
  layer.addChild(shadow, label);
  animate(app, 520, (progress) => {
    const eased = easeOut(progress);
    const pop = progress < 0.22 ? 0.82 + 0.32 * easeOut(progress / 0.22) : 1.14 - 0.14 * easeOut((progress - 0.22) / 0.78);
    label.position.set(x, y - 46 * eased);
    shadow.position.set(x + 2, y + 2 - 46 * eased);
    label.scale.set(pop);
    shadow.scale.set(pop);
    label.alpha = progress < 0.72 ? 1 : 1 - (progress - 0.72) / 0.28;
    shadow.alpha = label.alpha * 0.34;
  }, () => {
    label.destroy();
    shadow.destroy();
  });
};

const playCardMicroPulse = (
  app: PixiApp,
  target: CardVisual,
  unitX: number,
  unitY: number,
  strength = 1
) => {
  const originX = target.card.x + target.card.width / 2;
  const originY = target.card.y + target.card.height / 2;
  animate(app, 280, (progress) => {
    const pulse = Math.sin(progress * Math.PI);
    const shake = Math.sin(progress * Math.PI * 18) * 7 * pulse * strength;
    target.root.position.set(originX + unitX * shake, originY + unitY * shake);
    target.root.rotation = Math.sin(progress * Math.PI * 12) * 0.026 * pulse * strength;
    target.root.scale.set(1 - 0.018 * pulse * strength, 1 + 0.026 * pulse * strength);
  }, () => {
    target.root.position.set(originX, originY);
    target.root.rotation = 0;
    target.root.scale.set(1);
  });
};

const playRetireEffect = (
  PIXI: PixiModule,
  app: PixiApp,
  layer: PixiContainer,
  target: CardVisual,
  color: number,
  quality: RendererQuality
) => {
  const x = target.card.x + target.card.width / 2;
  const y = target.card.y + target.card.height / 2;
  const effect = new PIXI.Container();
  layer.addChild(effect);
  const crack = new PIXI.Graphics();
  const dim = new PIXI.Graphics();
  effect.addChild(dim, crack);
  const count = quality === 'high' ? 18 : 8;
  const shards = Array.from({ length: count }, (_, index) => {
    const shard = new PIXI.Graphics();
    effect.addChild(shard);
    return {
      shard,
      angle: -Math.PI / 2 + (Math.PI * 2 * index) / count,
      distance: 22 + (index % 5) * 13,
      size: 5 + (index % 3) * 2
    };
  });
  animate(app, 620, (progress) => {
    const eased = easeOut(progress);
    const pulse = Math.sin(progress * Math.PI);
    target.root.alpha = 1 - progress * 0.44;
    target.root.scale.set(1 - pulse * 0.035);
    target.root.rotation = Math.sin(progress * Math.PI * 7) * 0.018 * pulse;
    dim.clear();
    dim.roundRect(target.card.x - 8, target.card.y - 8, target.card.width + 16, target.card.height + 16, 26)
      .fill({ color: 0x111827, alpha: 0.1 + progress * 0.22 })
      .stroke({ color, alpha: 0.36 * (1 - progress), width: 3 });
    crack.clear();
    crack.moveTo(x - 34, y - 30).lineTo(x - 7, y - 4).lineTo(x - 24, y + 34)
      .moveTo(x + 32, y - 28).lineTo(x + 8, y - 2).lineTo(x + 24, y + 34)
      .moveTo(x - 46, y + 8).lineTo(x + 46, y - 10)
      .stroke({ color: PASTEL.white, alpha: 0.72 * (1 - progress), width: 3, cap: 'round' });
    shards.forEach(({ shard, angle, distance, size }, index) => {
      shard.clear();
      const drift = distance * eased;
      const wobble = Math.sin(progress * Math.PI * 3 + index) * 8;
      const sx = x + Math.cos(angle) * drift + Math.cos(angle + Math.PI / 2) * wobble;
      const sy = y + Math.sin(angle) * drift + Math.sin(angle + Math.PI / 2) * wobble;
      shard.moveTo(sx, sy - size)
        .lineTo(sx + size * 0.8, sy + size * 0.5)
        .lineTo(sx - size * 0.8, sy + size * 0.6)
        .fill({ color: index % 3 === 0 ? PASTEL.white : color, alpha: 0.82 * (1 - progress) });
    });
  }, () => {
    target.root.alpha = 0.52;
    target.root.scale.set(1);
    target.root.rotation = 0;
    playFloatingText(PIXI, app, layer, '전투불능', x, y - 16, color);
    destroyPixiContainerSafe(effect);
  });
};

const playSecondaryTargetEffects = (
  PIXI: PixiModule,
  app: PixiApp,
  layer: PixiContainer,
  targets: CardVisual[],
  primary: CardVisual,
  turn: ArenaBattleTurn,
  color: number,
  quality: RendererQuality
) => {
  targets.filter((target) => target !== primary).slice(0, quality === 'high' ? 5 : 2).forEach((target, index) => {
    const x = target.card.x + target.card.width / 2;
    const y = target.card.y + target.card.height / 2;
    window.setTimeout(() => {
      if ((target.root as any).destroyed || (layer as any).destroyed) return;
      playImpactBurst(PIXI, app, layer, x, y, color, 0.72, quality, visualProfileForTurn(turn).kind);
      playFloatingText(PIXI, app, layer, actionValueText(turn), x, y - 18, color);
      playCardMicroPulse(app, target, 0.4 + index * 0.1, -0.8, 0.72);
    }, 70 + index * 45);
  });
};

const drawSupportBeam = (
  PIXI: PixiModule,
  layer: PixiContainer,
  actorX: number,
  actorY: number,
  targetX: number,
  targetY: number,
  color: number,
  progress: number
) => {
  const eased = easeOut(progress);
  const beam = new PIXI.Graphics();
  const endX = actorX + (targetX - actorX) * eased;
  const endY = actorY + (targetY - actorY) * eased;
  const wave = Math.sin(progress * Math.PI * 2) * 10;
  const midX = (actorX + endX) / 2 - (targetY - actorY) * 0.04;
  const midY = (actorY + endY) / 2 + (targetX - actorX) * 0.04 + wave;
  beam.moveTo(actorX, actorY)
    .quadraticCurveTo(midX, midY, endX, endY)
    .stroke({ color: PASTEL.white, alpha: 0.42 * (1 - progress * 0.35), width: 8, cap: 'round' });
  beam.moveTo(actorX, actorY)
    .quadraticCurveTo(midX, midY, endX, endY)
    .stroke({ color, alpha: 0.58 * (1 - progress * 0.25), width: 4, cap: 'round' });
  layer.addChild(beam);
  return beam;
};

const drawActionRibbon = (
  PIXI: PixiModule,
  layer: PixiContainer,
  label: string,
  x: number,
  y: number,
  color: number
) => {
  const ribbon = new PIXI.Container();
  ribbon.position.set(x, y);
  const bg = new PIXI.Graphics();
  bg.roundRect(-58, -18, 116, 28, 999)
    .fill({ color: PASTEL.white, alpha: 0.9 })
    .stroke({ color, alpha: 0.72, width: 2 });
  bg.roundRect(-52, -13, 104, 7, 999).fill({ color, alpha: 0.16 });
  ribbon.addChild(bg);
  const text = new PIXI.Text({
    text: label,
    style: {
      fill: color,
      fontSize: 12,
      fontWeight: '900',
      fontFamily: 'Arial, sans-serif'
    }
  });
  text.anchor.set(0.5);
  text.position.set(0, -4);
  ribbon.addChild(text);
  layer.addChild(ribbon);
  return ribbon;
};

const playSignatureEffect = (
  PIXI: PixiModule,
  app: PixiApp,
  layer: PixiContainer,
  x: number,
  y: number,
  profile: ReturnType<typeof visualProfileForTurn>,
  quality: RendererQuality
) => {
  if (quality === 'off') return;
  const effect = new PIXI.Container();
  layer.addChild(effect);
  const primary = new PIXI.Graphics();
  const secondary = new PIXI.Graphics();
  const tertiary = new PIXI.Graphics();
  effect.addChild(primary, secondary, tertiary);
  const particleCount = quality === 'high'
    ? profile.kind === 'ultimate' ? 28 : 16
    : profile.kind === 'ultimate' ? 14 : 8;
  const particles = Array.from({ length: particleCount }, (_, index) => {
    const particle = new PIXI.Graphics();
    effect.addChild(particle);
    return {
      particle,
      angle: (Math.PI * 2 * index) / particleCount,
      distance: 24 + (index % 5) * 10,
      size: 2.6 + (index % 3)
    };
  });
  const duration = profile.kind === 'ultimate' ? 620 : 420;
  animate(app, duration, (progress) => {
    const eased = easeOut(progress);
    const fade = 1 - progress;
    primary.clear();
    secondary.clear();
    tertiary.clear();

    if (profile.kind === 'heal') {
      primary.circle(x, y, 20 + 48 * eased).stroke({ color: profile.color, alpha: 0.46 * fade, width: 5 });
      primary.circle(x, y, 10 + 24 * eased).stroke({ color: PASTEL.white, alpha: 0.4 * fade, width: 2 });
      secondary.moveTo(x, y - 34 - 10 * eased).lineTo(x, y + 34 + 10 * eased).stroke({ color: PASTEL.white, alpha: 0.72 * fade, width: 7, cap: 'round' });
      secondary.moveTo(x - 34 - 10 * eased, y).lineTo(x + 34 + 10 * eased, y).stroke({ color: profile.color, alpha: 0.58 * fade, width: 5, cap: 'round' });
      tertiary.ellipse(x, y + 28 - 28 * eased, 42 + 12 * eased, 9 + 3 * eased)
        .stroke({ color: profile.secondary, alpha: 0.5 * fade, width: 3 });
    } else if (profile.kind === 'guard') {
      primary.roundRect(x - 58 - 10 * eased, y - 44 - 8 * eased, 116 + 20 * eased, 88 + 16 * eased, 26)
        .stroke({ color: profile.color, alpha: 0.52 * fade, width: 5 });
      primary.roundRect(x - 42 - 8 * eased, y - 34 - 6 * eased, 84 + 16 * eased, 68 + 12 * eased, 20)
        .fill({ color: profile.color, alpha: 0.08 * fade });
      secondary.moveTo(x, y - 56).lineTo(x + 44, y - 18).lineTo(x + 28, y + 48).lineTo(x - 34, y + 48).lineTo(x - 48, y - 18).lineTo(x, y - 56)
        .stroke({ color: PASTEL.white, alpha: 0.46 * fade, width: 3, cap: 'round' });
      for (let index = 0; index < 4; index += 1) {
        const laneY = y - 30 + index * 20;
        tertiary.moveTo(x - 48 - 8 * eased, laneY)
          .lineTo(x + 48 + 8 * eased, laneY)
          .stroke({ color: index % 2 === 0 ? PASTEL.white : profile.secondary, alpha: 0.22 * fade, width: 2, cap: 'round' });
      }
    } else if (profile.kind === 'control') {
      const offset = Math.sin(progress * Math.PI * 8) * 5;
      primary.circle(x + offset, y, 26 + 30 * eased).stroke({ color: profile.color, alpha: 0.48 * fade, width: 4 });
      primary.circle(x - offset, y, 12 + 22 * eased).stroke({ color: PASTEL.white, alpha: 0.55 * fade, width: 3 });
      secondary.moveTo(x - 54, y - 30).lineTo(x + 54, y + 30).moveTo(x + 54, y - 30).lineTo(x - 54, y + 30)
        .stroke({ color: profile.secondary, alpha: 0.4 * fade, width: 4, cap: 'round' });
      for (let index = 0; index < 5; index += 1) {
        const linkX = x - 48 + index * 24 + Math.sin(progress * Math.PI * 5 + index) * 3;
        tertiary.roundRect(linkX - 5, y - 8, 10, 16, 4)
          .stroke({ color: index % 2 === 0 ? profile.color : PASTEL.white, alpha: 0.5 * fade, width: 2 });
      }
    } else if (profile.kind === 'burn') {
      primary.moveTo(x - 46, y + 36).lineTo(x - 22, y - 36 - 16 * eased).lineTo(x, y + 14).lineTo(x + 24, y - 44 - 12 * eased).lineTo(x + 48, y + 36)
        .fill({ color: profile.color, alpha: 0.22 * fade });
      secondary.circle(x, y, 24 + 34 * eased).stroke({ color: profile.secondary, alpha: 0.34 * fade, width: 5 });
      tertiary.moveTo(x - 18, y + 26).lineTo(x - 4, y - 28 - 12 * eased).lineTo(x + 11, y + 14).lineTo(x + 27, y - 22 - 8 * eased)
        .stroke({ color: PASTEL.white, alpha: 0.52 * fade, width: 3, cap: 'round' });
    } else if (profile.kind === 'poison') {
      primary.circle(x, y, 18 + 42 * eased).fill({ color: profile.color, alpha: 0.08 * fade }).stroke({ color: profile.color, alpha: 0.42 * fade, width: 4 });
      secondary.circle(x - 20, y + 12, 8 + 12 * eased).stroke({ color: PASTEL.white, alpha: 0.48 * fade, width: 2 });
      secondary.circle(x + 28, y - 16, 6 + 10 * eased).stroke({ color: profile.secondary, alpha: 0.5 * fade, width: 2 });
      tertiary.circle(x + Math.sin(progress * Math.PI * 3) * 18, y + 20 - 34 * eased, 5 + 8 * eased)
        .fill({ color: profile.secondary, alpha: 0.18 * fade })
        .stroke({ color: PASTEL.white, alpha: 0.42 * fade, width: 1.5 });
    } else if (profile.kind === 'tempo') {
      for (let index = 0; index < 5; index += 1) {
        const lane = index - 2;
        primary.moveTo(x - 70 + 88 * eased, y + lane * 13)
          .lineTo(x + 18 + 104 * eased, y + lane * 13 - 8)
          .stroke({ color: index % 2 === 0 ? PASTEL.white : profile.color, alpha: 0.42 * fade, width: 4, cap: 'round' });
      }
      secondary.circle(x, y, 22 + 36 * eased).stroke({ color: profile.secondary, alpha: 0.32 * fade, width: 3 });
      tertiary.moveTo(x - 18, y - 18).lineTo(x + 4, y).lineTo(x - 14, y + 18).lineTo(x + 28, y - 6)
        .stroke({ color: PASTEL.white, alpha: 0.5 * fade, width: 4, cap: 'round' });
    } else if (profile.kind === 'skill') {
      primary.circle(x, y, 20 + 52 * eased).stroke({ color: profile.color, alpha: 0.5 * fade, width: 5 });
      primary.circle(x, y, 34 + 24 * eased).stroke({ color: PASTEL.white, alpha: 0.3 * fade, width: 2 });
      for (let index = 0; index < 6; index += 1) {
        const angle = (Math.PI * 2 * index) / 6 + progress * 0.55;
        secondary.moveTo(x + Math.cos(angle) * 14, y + Math.sin(angle) * 14)
          .lineTo(x + Math.cos(angle) * (58 + 18 * eased), y + Math.sin(angle) * (58 + 18 * eased))
          .stroke({ color: index % 2 === 0 ? profile.secondary : PASTEL.white, alpha: 0.42 * fade, width: 3, cap: 'round' });
      }
      tertiary.moveTo(x - 30, y).lineTo(x, y - 30).lineTo(x + 30, y).lineTo(x, y + 30).lineTo(x - 30, y)
        .stroke({ color: profile.color, alpha: 0.32 * fade, width: 3, cap: 'round' });
    } else if (profile.kind === 'ultimate') {
      primary.circle(x, y, 26 + 78 * eased).stroke({ color: profile.color, alpha: 0.62 * fade, width: 7 });
      primary.circle(x, y, 10 + 34 * eased).fill({ color: PASTEL.white, alpha: 0.3 * fade });
      tertiary.circle(x, y, 54 + 44 * eased).stroke({ color: PASTEL.white, alpha: 0.22 * fade, width: 2 });
      tertiary.rect(x - 90 - 16 * eased, y - 6, 180 + 32 * eased, 12).fill({ color: profile.secondary, alpha: 0.12 * fade });
      for (let index = 0; index < 8; index += 1) {
        const angle = (Math.PI * 2 * index) / 8 + progress * 0.8;
        secondary.moveTo(x + Math.cos(angle) * 20, y + Math.sin(angle) * 20)
          .lineTo(x + Math.cos(angle) * (86 + 34 * eased), y + Math.sin(angle) * (86 + 34 * eased))
          .stroke({ color: index % 2 === 0 ? PASTEL.white : profile.secondary, alpha: 0.5 * fade, width: 4, cap: 'round' });
      }
    } else {
      primary.circle(x, y, 18 + 42 * eased).stroke({ color: profile.color, alpha: 0.42 * fade, width: 4 });
      secondary.moveTo(x - 46, y - 24).lineTo(x + 46, y + 24).stroke({ color: PASTEL.white, alpha: 0.46 * fade, width: 5, cap: 'round' });
      tertiary.moveTo(x - 36, y + 20).lineTo(x + 36, y - 20).stroke({ color: profile.color, alpha: 0.38 * fade, width: 4, cap: 'round' });
    }

    particles.forEach(({ particle, angle, distance, size }, index) => {
      particle.clear();
      const local = clamp((progress - index * 0.012) / 0.88, 0, 1);
      const drift = distance * (0.5 + local);
      const wobble = Math.sin(progress * Math.PI * 3 + index) * 10;
      const px = x + Math.cos(angle) * (drift + wobble);
      const py = y + Math.sin(angle) * (drift + wobble) - (profile.kind === 'heal' ? 34 * local : 0);
      particle.circle(px, py, size * (1 - local * 0.45)).fill({ color: index % 3 === 0 ? PASTEL.white : profile.secondary, alpha: (1 - local) * 0.76 });
    });
  }, () => {
    destroyPixiContainerSafe(effect);
  });
};

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
  const profile = visualProfileForTurn(activeTurn);
  const color = profile.color || colorForAction(activeTurn);
  const hitStrength = profile.hitStop || 1;
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
  const duration = activeTurn.actionType === 'attack'
    ? 520
    : profile.kind === 'ultimate'
      ? 650
      : isProjectile ? 500 : isSupport ? 520 : 600;
  const particles = quality === 'high' ? (profile.kind === 'ultimate' ? 22 : 14) : 7;
  const actionLabel = activeTurn.skillName || getTurnActionLabel(activeTurn);
  const ribbon = drawActionRibbon(
    PIXI,
    effectLayer,
    actionLabel.length > 8 ? `${actionLabel.slice(0, 7)}…` : actionLabel,
    actorX || targetX,
    actorY - 28,
    color
  );
  animate(app, 360, (progress) => {
    const eased = easeOut(progress);
    ribbon.position.y = actorY - 28 - eased * 16;
    ribbon.alpha = progress < 0.72 ? 1 : 1 - (progress - 0.72) / 0.28;
    ribbon.scale.set(0.82 + 0.18 * eased);
  });

  if (activeTurn.actionType === 'retire') {
    playRetireEffect(PIXI, app, effectLayer, target, color, quality);
    window.setTimeout(() => destroyPixiContainerSafe(effectLayer), 900);
    return;
  }

  if (isSupport) {
    const aura = new PIXI.Graphics();
    const beamLayer = new PIXI.Container();
    effectLayer.addChild(beamLayer);
    effectLayer.addChild(aura);
    const motes = Array.from({ length: particles }, (_, index) => {
      const mote = new PIXI.Graphics();
      effectLayer.addChild(mote);
      return { mote, index };
    });
    if (actor && actor !== target) {
      const originScaleX = actor.root.scale.x;
      const originScaleY = actor.root.scale.y;
      animate(app, 240, (progress) => {
        const pulse = Math.sin(progress * Math.PI);
        actor.root.scale.set(originScaleX + pulse * 0.045, originScaleY + pulse * 0.045);
      }, () => {
        actor.root.scale.set(originScaleX, originScaleY);
      });
    }
    animate(app, duration, (progress) => {
      const eased = easeOut(progress);
      const pulse = Math.sin(progress * Math.PI);
      target.root.scale.set(1 + pulse * 0.045, 1 + pulse * 0.045);
      beamLayer.removeChildren().forEach((child) => child.destroy());
      if (actor && actor !== target) {
        drawSupportBeam(PIXI, beamLayer, actorX, actorY, targetX, targetY, color, progress);
      }
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
      target.root.scale.set(1);
      playSignatureEffect(PIXI, app, effectLayer, targetX, targetY, profile, quality);
      playFloatingText(PIXI, app, effectLayer, actionValueText(activeTurn), targetX, targetY - 18, color);
      playSecondaryTargetEffects(PIXI, app, effectLayer, targets, target, activeTurn, color, quality);
      window.setTimeout(() => destroyPixiContainerSafe(effectLayer), 560);
    });
    return;
  }

  if (isProjectile) {
    const trail = new PIXI.Graphics();
    const projectile = new PIXI.Graphics();
    const comet = Array.from({ length: quality === 'high' ? 8 : 4 }, (_, index) => {
      const mote = new PIXI.Graphics();
      effectLayer.addChild(mote);
      return { mote, index };
    });
    effectLayer.addChild(trail, projectile);
    if (actor) {
      const originX = actor.root.position.x;
      const originY = actor.root.position.y;
      animate(app, 220, (progress) => {
        const pulse = Math.sin(progress * Math.PI);
        actor.root.position.set(originX - unitX * 12 * pulse, originY - unitY * 12 * pulse);
        actor.root.rotation = -unitX * 0.018 * pulse;
        actor.root.scale.set(1 + pulse * 0.035, 1 + pulse * 0.035);
      }, () => {
        actor.root.position.set(originX, originY);
        actor.root.rotation = 0;
        actor.root.scale.set(1);
      });
    }
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
      if (activeTurn.actionType === 'control' || profile.kind === 'poison') {
        projectile.circle(x, y, 16).stroke({ color: PASTEL.white, alpha: 0.82, width: 3 })
          .circle(x, y, profile.kind === 'poison' ? 11 : 8).fill({ color, alpha: 0.78 });
        if (profile.kind === 'poison') {
          projectile.circle(x - 12, y + 7, 5).fill({ color: profile.secondary, alpha: 0.72 });
          projectile.circle(x + 10, y - 8, 4).fill({ color: PASTEL.white, alpha: 0.7 });
        } else {
          projectile.moveTo(x - 18, y).lineTo(x + 18, y).stroke({ color, alpha: 0.78, width: 3, cap: 'round' });
          projectile.moveTo(x, y - 18).lineTo(x, y + 18).stroke({ color, alpha: 0.78, width: 3, cap: 'round' });
        }
      } else if (profile.kind === 'burn' || profile.kind === 'ultimate') {
        projectile.moveTo(x + 22, y)
          .lineTo(x - 10, y - 13)
          .lineTo(x - 5, y)
          .lineTo(x - 10, y + 13)
          .fill({ color: PASTEL.white, alpha: 0.88 })
          .stroke({ color, alpha: 0.86, width: 3 });
        projectile.circle(x + 10, y, profile.kind === 'ultimate' ? 9 : 6).fill({ color: profile.secondary, alpha: 0.82 });
      } else {
        projectile.ellipse(x, y, profile.kind === 'tempo' ? 26 : 20, profile.projectileWidth).fill({ color: PASTEL.white, alpha: 0.92 }).stroke({ color, alpha: 0.86, width: 3 });
        projectile.circle(x + 8, y, 5).fill({ color, alpha: 0.88 });
      }
      projectile.rotation = Math.atan2(dy, dx);
      comet.forEach(({ mote, index }) => {
        mote.clear();
        const lag = clamp(progress - index * 0.035, 0, 1);
        const lagEased = easeInOut(lag);
        const lagCurve = Math.sin(lag * Math.PI) * (activeTurn.actionType === 'control' ? 30 : 16);
        const mx = actorX + dx * lagEased - unitY * lagCurve;
        const my = actorY + dy * lagEased + unitX * lagCurve;
        mote.circle(mx, my, 4 - Math.min(2.6, index * 0.28)).fill({ color: index % 2 === 0 ? PASTEL.white : color, alpha: 0.46 * (1 - index / comet.length) });
      });
    }, () => {
      trail.destroy();
      projectile.destroy();
      comet.forEach(({ mote }) => mote.destroy());
      playImpactBurst(PIXI, app, effectLayer, targetX, targetY, color, profile.impactScale, quality, profile.kind);
      playSignatureEffect(PIXI, app, effectLayer, targetX, targetY, profile, quality);
      playFloatingText(PIXI, app, effectLayer, actionValueText(activeTurn), targetX, targetY - 20, color);
      playCardMicroPulse(app, target, unitX, unitY, activeTurn.actionType === 'control' ? 1.18 : 0.92);
      playSecondaryTargetEffects(PIXI, app, effectLayer, targets, target, activeTurn, color, quality);
      window.setTimeout(() => destroyPixiContainerSafe(effectLayer), 620);
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
    const hitFlash = new PIXI.Graphics();
    effectLayer.addChild(attackTrail, contactSpark, hitFlash);
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
      const impactPulse = hitWindow ? Math.sin((progress - 0.46) / 0.26 * Math.PI) * hitStrength : 0;
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
      hitFlash.clear();
      if (impactPulse > 0) {
        const sparkX = targetX - unitX * target.card.width * 0.22;
        const sparkY = targetY - unitY * target.card.height * 0.22;
        const slashAngle = Math.atan2(unitY, unitX) + Math.PI / 2;
        contactSpark.circle(sparkX, sparkY, 16 + impactPulse * 18).stroke({ color, alpha: 0.62 * impactPulse, width: 4 });
        contactSpark.circle(sparkX, sparkY, 5 + impactPulse * 8).fill({ color: PASTEL.white, alpha: 0.72 * impactPulse });
        contactSpark.moveTo(sparkX - 42 * Math.cos(slashAngle), sparkY - 42 * Math.sin(slashAngle))
          .lineTo(sparkX + 42 * Math.cos(slashAngle), sparkY + 42 * Math.sin(slashAngle))
          .stroke({ color: PASTEL.white, alpha: 0.86 * impactPulse, width: 6, cap: 'round' });
        contactSpark.moveTo(sparkX - 30 * unitY - 16 * unitX, sparkY + 30 * unitX - 16 * unitY)
          .lineTo(sparkX + 30 * unitY + 16 * unitX, sparkY - 30 * unitX + 16 * unitY)
          .stroke({ color, alpha: 0.78 * impactPulse, width: 4, cap: 'round' });
        const flashScale = 0.72 + impactPulse * 0.48;
        hitFlash.moveTo(sparkX, sparkY - 34 * flashScale)
          .lineTo(sparkX + 10 * flashScale, sparkY - 8 * flashScale)
          .lineTo(sparkX + 38 * flashScale, sparkY)
          .lineTo(sparkX + 10 * flashScale, sparkY + 8 * flashScale)
          .lineTo(sparkX, sparkY + 34 * flashScale)
          .lineTo(sparkX - 10 * flashScale, sparkY + 8 * flashScale)
          .lineTo(sparkX - 38 * flashScale, sparkY)
          .lineTo(sparkX - 10 * flashScale, sparkY - 8 * flashScale)
          .closePath()
          .fill({ color: PASTEL.white, alpha: 0.38 * impactPulse })
          .stroke({ color, alpha: 0.6 * impactPulse, width: 2 });
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
      hitFlash.destroy();
      playImpactBurst(PIXI, app, effectLayer, targetX, targetY, color, Math.max(1.16, profile.impactScale), quality, profile.kind);
      playSignatureEffect(PIXI, app, effectLayer, targetX, targetY, profile, quality);
      playFloatingText(PIXI, app, effectLayer, actionValueText(activeTurn), targetX, targetY - 20, color);
      playSecondaryTargetEffects(PIXI, app, effectLayer, targets, target, activeTurn, color, quality);
      window.setTimeout(() => destroyPixiContainerSafe(effectLayer), 660);
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
  quality: RendererQuality,
  kind: TurnVisualKind = 'attack'
) => {
  const burst = new PIXI.Container();
  layer.addChild(burst);
  const ring = new PIXI.Graphics();
  const innerRing = new PIXI.Graphics();
  const core = new PIXI.Graphics();
  const slashA = new PIXI.Graphics();
  const flash = new PIXI.Graphics();
  burst.addChild(ring, innerRing, core, slashA, flash);
  const count = quality === 'high' ? 22 : 10;
  const particles = Array.from({ length: count }, (_, index) => {
    const particle = new PIXI.Graphics();
    burst.addChild(particle);
    return {
      particle,
      angle: (Math.PI * 2 * index) / count,
      distance: 34 + (index % 4) * 13,
      size: 2.4 + (index % 3)
    };
  });
  animate(app, 340, (progress) => {
    const eased = easeOut(progress);
    ring.clear();
    innerRing.clear();
    core.clear();
    slashA.clear();
    flash.clear();
    const fade = 1 - progress;
    ring.circle(x, y, (20 + 62 * eased) * scale).stroke({ color, alpha: 0.72 * fade, width: Math.max(1, 7 * fade) });
    innerRing.circle(x, y, (9 + 28 * eased) * scale).stroke({ color: PASTEL.white, alpha: 0.82 * fade, width: Math.max(1, 4 * fade) });
    core.circle(x, y, (20 + 12 * eased) * scale).fill({ color: PASTEL.white, alpha: 0.54 * fade });
    if (kind === 'guard') {
      flash.roundRect(x - 54 * scale, y - 40 * scale, 108 * scale, 80 * scale, 24 * scale)
        .stroke({ color, alpha: 0.46 * fade, width: 5 });
      slashA.moveTo(x, y - 48 * scale).lineTo(x + 36 * scale, y - 12 * scale).lineTo(x + 22 * scale, y + 42 * scale).lineTo(x - 28 * scale, y + 42 * scale).lineTo(x - 40 * scale, y - 12 * scale).lineTo(x, y - 48 * scale)
        .stroke({ color: PASTEL.white, alpha: 0.65 * fade, width: 4, cap: 'round' });
    } else if (kind === 'heal') {
      flash.circle(x, y, 38 * scale * (0.7 + eased)).stroke({ color, alpha: 0.5 * fade, width: 5 });
      slashA.moveTo(x, y - 46 * scale).lineTo(x, y + 46 * scale).stroke({ color: PASTEL.white, alpha: 0.82 * fade, width: 7, cap: 'round' });
      slashA.moveTo(x - 46 * scale, y).lineTo(x + 46 * scale, y).stroke({ color, alpha: 0.7 * fade, width: 5, cap: 'round' });
    } else if (kind === 'control') {
      for (let index = 0; index < 3; index += 1) {
        const offset = (index - 1) * 18 * scale;
        flash.circle(x + offset, y, (18 + 34 * eased) * scale).stroke({ color: index % 2 === 0 ? color : PASTEL.white, alpha: 0.38 * fade, width: 3 });
      }
      slashA.moveTo(x - 58 * scale, y - 30 * scale).lineTo(x + 58 * scale, y + 30 * scale).moveTo(x + 58 * scale, y - 30 * scale).lineTo(x - 58 * scale, y + 30 * scale)
        .stroke({ color, alpha: 0.72 * fade, width: 4, cap: 'round' });
    } else if (kind === 'ultimate') {
      flash.rect(x - 98 * scale, y - 8 * scale, 196 * scale, 16 * scale).fill({ color: PASTEL.white, alpha: 0.28 * fade });
      flash.rect(x - 8 * scale, y - 98 * scale, 16 * scale, 196 * scale).fill({ color, alpha: 0.22 * fade });
      for (let index = 0; index < 8; index += 1) {
        const angle = (Math.PI * 2 * index) / 8 + progress * 0.4;
        slashA.moveTo(x + Math.cos(angle) * 18 * scale, y + Math.sin(angle) * 18 * scale)
          .lineTo(x + Math.cos(angle) * 86 * scale, y + Math.sin(angle) * 86 * scale)
          .stroke({ color: index % 2 === 0 ? PASTEL.white : color, alpha: 0.72 * fade, width: 4, cap: 'round' });
      }
    } else if (kind === 'burn' || kind === 'poison' || kind === 'tempo') {
      const mainAlpha = kind === 'poison' ? 0.18 : 0.24;
      flash.circle(x, y, (24 + 48 * eased) * scale).fill({ color, alpha: mainAlpha * fade });
      for (let index = 0; index < 4; index += 1) {
        const lane = index - 1.5;
        slashA.moveTo(x - 62 * scale + 36 * eased * scale, y + lane * 13 * scale)
          .lineTo(x + 62 * scale + 64 * eased * scale, y + lane * 13 * scale - 12 * scale)
          .stroke({ color: index % 2 === 0 ? PASTEL.white : color, alpha: 0.52 * fade, width: 4, cap: 'round' });
      }
    } else {
      flash.moveTo(x - 12 * scale, y).lineTo(x - 56 * scale, y - 16 * scale).lineTo(x - 18 * scale, y + 8 * scale)
        .lineTo(x - 58 * scale, y + 22 * scale).lineTo(x - 8 * scale, y + 12 * scale).fill({ color, alpha: 0.22 * fade });
      slashA.moveTo(x - 62 * scale, y - 24 * scale).lineTo(x + 62 * scale, y + 24 * scale).stroke({ color: PASTEL.white, alpha: 0.95 * fade, width: 7, cap: 'round' });
      slashA.moveTo(x - 46 * scale, y + 30 * scale).lineTo(x + 46 * scale, y - 30 * scale).stroke({ color, alpha: 0.78 * fade, width: 5, cap: 'round' });
    }
    particles.forEach(({ particle, angle, distance, size }, index) => {
      particle.clear();
      const wobble = Math.sin(progress * Math.PI * 2 + index) * 7;
      particle.circle(
        x + Math.cos(angle) * (distance * eased + wobble),
        y + Math.sin(angle) * (distance * eased + wobble),
        size * (1 - progress * 0.48)
      ).fill({ color: index % 3 === 0 ? PASTEL.white : color, alpha: 0.9 * fade });
    });
  }, () => {
    burst.destroy({ children: true });
  });
};

const playStageEffect = (
  PIXI: PixiModule,
  app: PixiApp,
  layer: PixiContainer,
  width: number,
  height: number,
  layout: BattleResponsiveLayout,
  stage: BattleStageKind,
  activeTurn: ArenaBattleTurn | undefined,
  roundReveal: RoundRevealState | null,
  quality: RendererQuality
) => {
  const isStart = stage === 'battle' && activeTurn?.actionType === 'start';
  const isResult = stage === 'result';
  if (!isStart && !isResult) return;
  const color = isResult
    ? roundReveal?.winner === 'player'
      ? PASTEL.rose
      : roundReveal?.winner === 'bot'
        ? 0xec4899
        : PASTEL.violet
    : PASTEL.rose;
  const effect = new PIXI.Container();
  layer.addChild(effect);
  const flash = new PIXI.Graphics();
  const sweepA = new PIXI.Graphics();
  const sweepB = new PIXI.Graphics();
  effect.addChild(flash, sweepA, sweepB);
  const centerX = width / 2;
  const centerY = layout.centerLineY;
  const count = quality === 'high' ? 26 : 12;
  const particles = Array.from({ length: count }, (_, index) => {
    const particle = new PIXI.Graphics();
    effect.addChild(particle);
    return {
      particle,
      angle: (Math.PI * 2 * index) / count,
      radius: Math.min(width, height) * (0.12 + (index % 4) * 0.025)
    };
  });

  animate(app, isResult ? 860 : 620, (progress) => {
    const eased = easeOut(progress);
    const fade = 1 - progress;
    flash.clear();
    sweepA.clear();
    sweepB.clear();
    flash.rect(0, 0, width, height).fill({ color: PASTEL.white, alpha: (isResult ? 0.18 : 0.12) * Math.sin(progress * Math.PI) });
    flash.ellipse(centerX, centerY, width * (0.18 + eased * 0.22), height * (0.035 + eased * 0.045))
      .fill({ color, alpha: 0.16 * fade });
    const sweepOffset = width * (progress * 1.28 - 0.14);
    sweepA.moveTo(sweepOffset - 90, centerY - 44)
      .lineTo(sweepOffset + 44, centerY - 20)
      .lineTo(sweepOffset + 88, centerY + 36)
      .lineTo(sweepOffset - 28, centerY + 22)
      .fill({ color: PASTEL.white, alpha: 0.26 * fade });
    sweepB.moveTo(width - sweepOffset + 90, centerY + 44)
      .lineTo(width - sweepOffset - 44, centerY + 20)
      .lineTo(width - sweepOffset - 88, centerY - 36)
      .lineTo(width - sweepOffset + 28, centerY - 22)
      .fill({ color, alpha: 0.18 * fade });
    particles.forEach(({ particle, angle, radius }, index) => {
      particle.clear();
      const local = clamp((progress - (index % 5) * 0.026) / 0.72, 0, 1);
      const spiral = angle + local * (isResult ? 1.2 : 0.65);
      const px = centerX + Math.cos(spiral) * radius * (0.38 + local * 1.1);
      const py = centerY + Math.sin(spiral) * radius * (0.22 + local * 0.7);
      const size = 3.2 + (index % 3) * 1.3;
      particle.moveTo(px, py - size)
        .lineTo(px + size, py)
        .lineTo(px, py + size)
        .lineTo(px - size, py)
        .fill({ color: index % 2 === 0 ? PASTEL.white : color, alpha: (1 - local) * (isResult ? 0.78 : 0.58) });
    });
  }, () => {
    destroyPixiContainerSafe(effect);
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
  const lastActionKeyRef = React.useRef<string | null>(null);
  const lastStageEffectKeyRef = React.useRef<string | null>(null);
  const lastCanvasSizeRef = React.useRef<string | null>(null);
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
    const width = app.renderer.width / app.renderer.resolution;
    const height = app.renderer.height / app.renderer.resolution;
    const canvasSizeKey = `${Math.round(width)}x${Math.round(height)}`;
    const actionKey = stage === 'battle' && activeTurn ? `${match.id}:${activeTurn.id}:${battleEventIndex}` : null;
    const stageEffectKey = stage === 'result'
      ? `${match.id}:result:${roundReveal?.roundNo || match.round_count}:${roundReveal?.winner || 'draw'}`
      : stage === 'battle' && activeTurn?.actionType === 'start'
        ? `${match.id}:start:${activeTurn.id}:${battleEventIndex}`
        : null;
    const sizeChanged = lastCanvasSizeRef.current !== canvasSizeKey;
    const shouldPlayAction = Boolean(actionKey && (lastActionKeyRef.current !== actionKey || sizeChanged));
    const shouldPlayStageEffect = Boolean(stageEffectKey && (lastStageEffectKeyRef.current !== stageEffectKey || sizeChanged));
    if (!actionKey || shouldPlayAction) clearContainer(actionLayer);
    lastCanvasSizeRef.current = canvasSizeKey;
    if (!actionKey) lastActionKeyRef.current = null;
    const layout = computeBattleLayout(width, height);
    const cards = makeLayout(layout, playerCards, opponentCards, playerSlots, opponentSlots, revealOpponent, battleEvents, unitStates, battleEventIndex, roundReveal, roundResult);
    const bg = new PIXI.Graphics();
    bg.rect(0, 0, width, height).fill({ color: 0xfff1f2, alpha: 0.2 });
    bg.circle(width * 0.5, height * 0.5, Math.min(width, height) * 0.42).fill({ color: PASTEL.white, alpha: 0.18 });
    bg.circle(width * 0.22, height * 0.3, Math.min(width, height) * 0.2).fill({ color: PASTEL.roseSoft, alpha: 0.08 });
    bg.circle(width * 0.78, height * 0.72, Math.min(width, height) * 0.24).fill({ color: PASTEL.rose, alpha: 0.07 });
    bg.ellipse(width * 0.5, layout.centerLineY, width * 0.34, Math.max(32, height * 0.045))
      .fill({ color: PASTEL.white, alpha: 0.2 })
      .stroke({ color: PASTEL.roseSoft, alpha: 0.16, width: 1.5 });
    bg.moveTo(width * 0.08, layout.centerLineY).lineTo(width * 0.92, layout.centerLineY).stroke({ color: PASTEL.roseSoft, alpha: 0.28, width: 2.5, cap: 'round' });
    bg.moveTo(width * 0.18, layout.centerLineY - 9).lineTo(width * 0.82, layout.centerLineY - 9).stroke({ color: PASTEL.white, alpha: 0.26, width: 1.5, cap: 'round' });
    bg.moveTo(width * 0.18, layout.centerLineY + 9).lineTo(width * 0.82, layout.centerLineY + 9).stroke({ color: PASTEL.rose, alpha: 0.1, width: 1.5, cap: 'round' });
    scene.addChild(bg);
    drawTeamMat(PIXI, scene, cards.filter((card) => card.side === 'opponent'), 'opponent');
    drawTeamMat(PIXI, scene, cards.filter((card) => card.side === 'player'), 'player');

    const requestFrame = () => schedulePixiFrame(app);
    drawPortrait(PIXI, scene, layout.opponentPortraitX, layout.opponentPortraitY, opponentLabel, `${displayOpponentRoundWins ?? match.player_b_round_wins ?? 0} 라운드 승`, revealOpponent ? opponentAvatar : null, 'opponent', null, { width: layout.portraitWidth, height: layout.portraitHeight }, requestFrame);
    drawPortrait(PIXI, scene, layout.playerPortraitX, layout.playerPortraitY, playerLabel, `${displayPlayerRoundWins ?? match.player_a_round_wins ?? 0} 라운드 승`, user?.avatarUrl, 'player', loadout, { width: layout.portraitWidth, height: layout.portraitHeight }, requestFrame);

    const turnProgress = stage === 'battle' ? Math.min(1, ((Date.now() % PIXI_BATTLE_TURN_MS) / PIXI_BATTLE_TURN_MS)) : 0;
    drawCenterHud(PIXI, scene, layout, stage, activeTurn, roundReveal, allCards, turnProgress, battleEventIndex, battleEvents.length);
    if (stage === 'battle' && activeTurn) {
      const actionColor = colorForAction(activeTurn);
      const actorCard = cards.find((card) => !card.hidden && eventMatchesCard(activeTurn.actor, card.card));
      const targetCards = cards.filter((card) => !card.hidden && activeTurn.targetIds.some((target) => eventMatchesCard(target, card.card)));
      drawActionFocus(PIXI, scene, actorCard, targetCards, actionColor, turnProgress);
      if (actorCard) drawTargetMarker(PIXI, scene, actorCard, actionColor, 'actor');
      targetCards.forEach((card) => drawTargetMarker(PIXI, scene, card, actionColor, 'target'));
    }
    const zoneLayer = new PIXI.Container();
    scene.addChild(zoneLayer);
    const visuals = cards.map((card) => drawCard(PIXI, zoneLayer, card, activeTurn, stage, turnProgress, qualityRef.current, skillLookup, classLookup, hoverZonesRef.current, requestFrame));
    drawStageBanner(PIXI, scene, layout, width, height, stage, activeTurn, roundReveal, roundResult);
    if (renderId !== latestRenderIdRef.current) return;
    renderPixiFrame(app);
    if (shouldPlayStageEffect && qualityRef.current !== 'off') {
      lastStageEffectKeyRef.current = stageEffectKey;
      playStageEffect(PIXI, app, actionLayer, width, height, layout, stage, activeTurn, roundReveal, qualityRef.current);
    }
    if (stage === 'battle' && activeTurn && shouldPlayAction && qualityRef.current !== 'off') {
      lastActionKeyRef.current = actionKey;
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
