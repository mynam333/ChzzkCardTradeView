'use client';

import React from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Clock3,
  Eye,
  FileClock,
  Hand,
  Lock,
  Move,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Shield,
  Sparkles,
  Trash2,
  Zap
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { resolveArenaAssetUrl } from '@/lib/arenaAssets';
import { parseArenaCosmeticStyle } from '@/lib/arenaCosmetics';
import { arenaCoreTooltips, getArenaBoardSlotTooltip, type ArenaTooltipData } from '@/lib/arenaTooltips';
import { useApp } from '../../AppContext';
import { ArenaLayout } from '../../ArenaLayout';
import { ArenaCard } from '../ArenaCard';
import { ArenaEmotePieMenu } from '../ArenaEmotePieMenu';
import { ArenaTooltip } from '../ArenaTooltip';
import type { ArenaSiteTab } from '../types';
import styles from '../ArenaV2Experience.module.css';
import { ArenaMatchResultModal } from './ArenaMatchResultModal';
import {
  buildReplayPresentationMatch,
  calculateArenaTurnActionCost,
  getArenaFreeTacticalMoveCount,
  getArenaMatchSyncIntervalMs,
  getReplayTurnClock,
  isReplayTurnClockOpen,
  isArenaMatchRequestCurrent,
  isReplayVisualEvent,
  readReplayPayloadNumber,
  resolveReplayDisplayTurnNo,
  resolveReplayPresentationPhase,
  resolveDirectAttackTargetPoint,
  selectLatestReplayScene,
  shouldContinueBattleRoyaleResultSync,
  shouldRevealReplayResult,
  type ArenaReplayEvent as ReplayEvent
} from './arenaReplay';
import type { ArenaV2BoardPositionDto, ArenaV2MatchViewDto, ArenaV2TurnActionDto } from '@chikapo/arena-contract';
import type { TextStyleOptions, Ticker } from 'pixi.js';

type CardInstance = ArenaV2MatchViewDto['cardInstances'][number];
type PixiCardPosition = { ownerSeatNo: number; position: ArenaV2BoardPositionDto };
type CombatCardCue = {
  role?: 'attacker' | 'target';
  dx?: number;
  dy?: number;
  eventType?: string;
  damage?: number;
  seq?: number;
};
type CombatCue = {
  event?: ReplayEvent;
  attackerId?: string;
  targetId?: string;
  damage: number;
  targetSeatNo?: number;
  cardCues: Record<string, CombatCardCue>;
};
type ReplayAnchor = {
  x: number;
  y: number;
  radius: number;
};
type Selection =
  | { source: 'hand'; id: string }
  | { source: 'board'; id: string; position: ArenaV2BoardPositionDto }
  | null;

type ReplayPlaybackMode = 'auto' | 'manual' | null;

type SpectatorMatchOption = {
  id: string;
  roundNo: number | null;
  status: string | null;
};

type ArenaBattleRoyaleState = {
  id: string;
  status?: string;
  currentRoundNo?: number;
  participantState?: Array<Record<string, unknown>>;
  matches?: unknown;
  spectatableMatchIds?: unknown;
  currentMatchId?: string | null;
  viewerResult?: { nextMatchId?: string | null } | null;
};

const ongoingSpectatorMatchStatuses = new Set([
  'created',
  'mulligan',
  'turn_planning',
  'action_locked',
  'combat_resolving',
  'turn_result'
]);

const normalizeSpectatorMatches = (state: ArenaBattleRoyaleState | null): SpectatorMatchOption[] => {
  if (!state || !Array.isArray(state.matches)) return [];
  const spectatableIds = Array.isArray(state.spectatableMatchIds)
    ? new Set(state.spectatableMatchIds.filter((id): id is string => typeof id === 'string' && Boolean(id)))
    : null;
  const excludedIds = new Set(
    [state.currentMatchId, state.viewerResult?.nextMatchId]
      .filter((id): id is string => typeof id === 'string' && Boolean(id))
  );
  const byId = new Map<string, SpectatorMatchOption>();
  for (const item of state.matches) {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : null;
    if (!record || record.spectatable !== true) continue;
    const id = String(record.id || record.matchId || record.match_id || '');
    const status = typeof record.status === 'string' ? record.status : null;
    if (!id || !status || !ongoingSpectatorMatchStatuses.has(status) || excludedIds.has(id)) continue;
    if (spectatableIds && !spectatableIds.has(id)) continue;
    const rawRound = Number(record.roundNo ?? record.round_no);
    const roundNo = Number.isFinite(rawRound) ? rawRound : null;
    byId.set(id, { id, roundNo, status });
  }
  return [...byId.values()].sort((left, right) => (right.roundNo ?? 0) - (left.roundNo ?? 0));
};

type ArenaEmoteItem = {
  id: number;
  type: 'emote';
  name: string;
  style_json: string | null;
};

type ArenaEmoteEvent = {
  id: string;
  kind: 'arena_emote';
  matchId: string;
  userId?: string;
  item: ArenaEmoteItem;
  x: number;
  y: number;
  createdAt: string;
};

type ArenaEmoteWheel = {
  x: number;
  y: number;
  size: number;
  ratioX: number;
  ratioY: number;
} | null;
type ArenaEmoteLoadoutStatus = 'loading' | 'ready' | 'error';

const arenaTabHref: Record<ArenaSiteTab, string> = {
  play: '/arena/play',
  inventory: '/arena/inventory',
  ranking: '/arena/ranking',
  wiki: '/arena/wiki',
  style: '/arena/style',
  'my-card': '/arena/my-card',
  admin: '/arena/admin'
};

const selfBoardPositions: ArenaV2BoardPositionDto[] = [
  { row: 'front', column: 0 },
  { row: 'front', column: 1 },
  { row: 'front', column: 2 },
  { row: 'back', column: 0 },
  { row: 'back', column: 1 },
  { row: 'back', column: 2 }
];

const opponentBoardPositions: ArenaV2BoardPositionDto[] = [
  { row: 'back', column: 0 },
  { row: 'back', column: 1 },
  { row: 'back', column: 2 },
  { row: 'front', column: 0 },
  { row: 'front', column: 1 },
  { row: 'front', column: 2 }
];

const battlePhaseTooltips: Record<string, ArenaTooltipData> = {
  이동: arenaCoreTooltips.move,
  배치: arenaCoreTooltips.place,
  교체: arenaCoreTooltips.replace,
  '전투 기록': {
    eyebrow: '매치 기록',
    title: '최근 전투 장면',
    description: '서버가 확정한 공격, 피해, 보호막, 전투불능 이벤트를 시간 순서로 보여줍니다.',
    note: '연출 재생을 누르면 저장된 이벤트 순서대로 전투 애니메이션을 다시 확인할 수 있습니다.',
    tone: 'cyan'
  }
};

const moveArenaSection = (router: ReturnType<typeof useRouter>, tab: ArenaSiteTab) => {
  router.push(arenaTabHref[tab] || '/arena');
};

const positionKey = (position: ArenaV2BoardPositionDto) => `${position.row}:${position.column}`;
const positionLabel = (position: ArenaV2BoardPositionDto) => `${position.row === 'front' ? '전열' : '후열'} ${position.column + 1}`;
const availableCost = (turnNo: number) => Math.min(9, Math.max(1, turnNo));
const EMOTE_WHEEL_MAX_SIZE = 304;
const EMOTE_WHEEL_VIEWPORT_GUTTER = 12;

const resolveEmoteWheelGeometry = (x: number, y: number) => {
  const availableSize = Math.min(window.innerWidth, window.innerHeight) - EMOTE_WHEEL_VIEWPORT_GUTTER * 2;
  const size = Math.max(1, Math.min(EMOTE_WHEEL_MAX_SIZE, availableSize));
  const radiusWithGutter = size / 2 + EMOTE_WHEEL_VIEWPORT_GUTTER;
  return {
    x: Math.max(radiusWithGutter, Math.min(window.innerWidth - radiusWithGutter, x)),
    y: Math.max(radiusWithGutter, Math.min(window.innerHeight - radiusWithGutter, y)),
    size
  };
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const errorMessage = (error: unknown, fallback: string) => error instanceof Error && error.message ? error.message : fallback;
const replayEventDuration = (event?: ReplayEvent) => {
  if (!event) return 0;
  if (event.eventType === 'line_attack' || event.eventType === 'direct_attack' || event.eventType === 'card_attack') return 820;
  if (event.eventType === 'card_defeated' || event.eventType === 'revive') return 720;
  if (event.eventType === 'fatigue') return 620;
  return 620;
};

const getArenaEmoteVisual = (item?: ArenaEmoteItem | null) => {
  const style = parseArenaCosmeticStyle(item?.style_json);
  const imageUrl = resolveArenaAssetUrl(style.image_url);
  const emoji = typeof style.emoji === 'string' && style.emoji.trim() ? style.emoji.trim() : '✦';
  return { imageUrl, emoji };
};

const boardMotionRow = (seatNo: number, selfSeatNo: number, row: ArenaV2BoardPositionDto['row']) => {
  const isSelf = seatNo === selfSeatNo;
  if (isSelf) return row === 'front' ? 2 : 3;
  return row === 'back' ? 0 : 1;
};

const replayPayloadString = (payload: Record<string, unknown>, names: string[]) => {
  for (const name of names) {
    const value = payload[name];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
};

const replayPayloadNumber = readReplayPayloadNumber;

const getReplayEventCardIds = (replayEvent: ReplayEvent) => {
  const payload = replayEvent.payload || {};
  const isTargetOnlyEvent = replayEvent.eventType === 'card_defeated'
    || replayEvent.eventType === 'revive'
    || replayEvent.eventType === 'drain';
  return {
    attackerId: isTargetOnlyEvent
      ? ''
      : replayPayloadString(payload, ['attackerCardInstanceId', 'sourceCardInstanceId', 'attackerInstanceId', 'cardInstanceId']),
    targetId: isTargetOnlyEvent
      ? replayPayloadString(payload, ['targetCardInstanceId', 'targetInstanceId', 'defeatedCardInstanceId', 'cardInstanceId'])
      : replayPayloadString(payload, ['targetCardInstanceId', 'targetInstanceId', 'defeatedCardInstanceId'])
  };
};

const buildCombatCue = (
  combatEvent: ReplayEvent | undefined,
  cardPositions: Record<string, PixiCardPosition>,
  selfSeatNo: number
): CombatCue => {
  if (!combatEvent) return { damage: 0, cardCues: {} };
  const payload = combatEvent.payload || {};
  const { attackerId, targetId } = getReplayEventCardIds(combatEvent);
  const targetSeatNo = replayPayloadNumber(payload, ['targetSeatNo', 'seatNo']);
  const damage = replayPayloadNumber(payload, ['healthDamage', 'damage', 'shield', 'heal']) || 0;
  const cues: Record<string, CombatCardCue> = {};

  if (attackerId) {
    const source = cardPositions[attackerId];
    const target = targetId ? cardPositions[targetId] : null;
    let dx = 0;
    let dy = typeof targetSeatNo === 'number' && targetSeatNo !== source?.ownerSeatNo
      ? targetSeatNo === selfSeatNo ? 2.25 : -2.25
      : 0;

    if (source && target) {
      dx = Math.max(-2, Math.min(2, target.position.column - source.position.column));
      dy = Math.max(-3, Math.min(3,
        boardMotionRow(target.ownerSeatNo, selfSeatNo, target.position.row)
        - boardMotionRow(source.ownerSeatNo, selfSeatNo, source.position.row)
      ));
    }

    cues[attackerId] = {
      role: 'attacker',
      dx,
      dy,
      eventType: combatEvent.eventType,
      damage,
      seq: combatEvent.seq
    };
  }

  if (targetId) {
    cues[targetId] = {
      role: 'target',
      eventType: combatEvent.eventType,
      damage,
      seq: combatEvent.seq
    };
  }

  return { event: combatEvent, attackerId, targetId, damage, targetSeatNo, cardCues: cues };
};

const actionLabel = (action: ArenaV2TurnActionDto) => {
  if (action.type === 'place') return `배치 · ${positionLabel(action.to)}`;
  if (action.type === 'move') return `이동 · ${positionLabel(action.from)} → ${positionLabel(action.to)}`;
  if (action.type === 'replace') return `교체 · ${positionLabel(action.target)}`;
  return '턴 종료';
};

const matchModeLabel = (mode?: string) => {
  const labels: Record<string, string> = {
    bot: '연습전',
    quick: '빠른대전',
    battle_royale_8: '8인전'
  };
  return labels[String(mode || '')] || '아레나';
};

const matchStatusLabel = (status?: string) => {
  const labels: Record<string, string> = {
    created: '준비 중',
    mulligan: '시작 손패 선택',
    turn_planning: '행동 선택',
    action_locked: '결정 완료',
    combat_resolving: '전투 중',
    turn_result: '결과 확인',
    completed: '경기 종료',
    cancelled: '경기 취소'
  };
  return labels[String(status || '')] || '대기 중';
};

const eventLabel = (eventType?: string) => {
  const labels: Record<string, string> = {
    line_attack: '라인 교전',
    direct_attack: '직접 타격',
    card_attack: '카드 공격',
    shield_absorb: '보호막 흡수',
    card_defeated: '카드 처치',
    turn_start: '턴 시작',
    turn_end: '턴 종료',
    fatigue: '피로 피해',
    fatigue_damage: '피로 피해'
  };
  return labels[String(eventType || '')] || '전투 장면';
};

const MiniCard: React.FC<{
  instance?: CardInstance;
  selected?: boolean;
  pending?: boolean;
  combatCue?: CombatCardCue;
  onClick?: () => void;
}> = ({ instance, selected, pending, combatCue, onClick }) => {
  if (!instance) return <span className="arena-v2-empty-slot">빈 칸</span>;
  const card = instance.card;
  const name = card?.displayName || instance.cardVersionId;
  const remainingHealth = Math.max(0, Number(instance.currentHealth || 0) - Number(instance.damageTaken || 0));
  const damageTaken = Math.max(0, Number(instance.damageTaken || 0));
  const combatClass = combatCue?.role === 'attacker'
    ? `is-combat-attacker ${combatCue.eventType === 'direct_attack' ? 'is-direct-strike' : 'is-line-strike'}`
    : combatCue?.role === 'target'
      ? `is-combat-target ${combatCue.eventType === 'card_defeated'
        ? 'is-combat-destroying'
        : combatCue.eventType === 'shield_absorb' ? 'is-shield-impact' : ''}`
      : '';
  const directionX = Math.max(-2.4, Math.min(2.4, combatCue?.dx || 0));
  const directionY = Math.max(-3, Math.min(3, combatCue?.dy || 0));
  const directionLength = Math.hypot(directionX, directionY) || 1;
  const strikeX = (directionX / directionLength) * 24;
  const strikeY = (directionY / directionLength) * 24;
  const combatStyle = combatCue?.role === 'attacker'
    ? {
        '--arena-v2-strike-pre-x': `${strikeX * -0.12}px`,
        '--arena-v2-strike-pre-y': `${strikeY * -0.12}px`,
        '--arena-v2-strike-mid-x': `${strikeX * 0.76}px`,
        '--arena-v2-strike-mid-y': `${strikeY * 0.76}px`,
        '--arena-v2-strike-hit-x': `${strikeX}px`,
        '--arena-v2-strike-hit-y': `${strikeY}px`,
        '--arena-v2-strike-return-x': `${strikeX * 0.18}px`,
        '--arena-v2-strike-return-y': `${strikeY * 0.18}px`
      } as React.CSSProperties
    : undefined;
  return (
    <ArenaCard
      displayName={name}
      cardClass={card?.cardClass}
      cost={card?.cost ?? 0}
      attack={instance.currentAttack}
      health={remainingHealth}
      keywords={card?.keywords || []}
      artAssetId={card?.artAssetId}
      selected={selected}
      compact
      pending={pending}
      damageTaken={damageTaken}
      className={combatClass}
      style={combatStyle}
      onClick={onClick ? (event) => {
        event.stopPropagation();
        onClick();
      } : undefined}
      disableTooltip={Boolean(combatCue)}
      combatDamage={combatCue?.role === 'target' ? combatCue.damage : undefined}
      combatSequence={combatCue?.seq}
    />
  );
};

const PixiBattleLayer: React.FC<{
  activeColumn?: number | null;
  activeEvent?: ReplayEvent;
  cardPositions: Record<string, PixiCardPosition>;
}> = ({ activeColumn, activeEvent, cardPositions }) => {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const activeEventRef = React.useRef<ReplayEvent | undefined>(activeEvent);
  const activeEventStartedAtRef = React.useRef(0);
  const cardPositionsRef = React.useRef(cardPositions);
  const activeColumnRef = React.useRef(activeColumn);

  React.useEffect(() => {
    activeEventRef.current = activeEvent;
    activeEventStartedAtRef.current = performance.now();
  }, [activeEvent]);

  React.useEffect(() => {
    cardPositionsRef.current = cardPositions;
    activeColumnRef.current = activeColumn;
  }, [activeColumn, cardPositions]);

  React.useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    const setup = async () => {
      const host = hostRef.current;
      if (!host) return;
      const PIXI = await import('pixi.js');
      if (disposed || !hostRef.current) return;

      const app = new PIXI.Application();
      await app.init({
        resizeTo: host,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(2, window.devicePixelRatio || 1)
      });
      if (disposed || !hostRef.current) {
        app.destroy(true);
        return;
      }

      const canvas = app.canvas as HTMLCanvasElement;
      canvas.setAttribute('aria-hidden', 'true');
      canvas.className = 'arena-v2-pixi-canvas';
      host.appendChild(canvas);

      const lanes = new PIXI.Graphics();
      const sweep = new PIXI.Graphics();
      const particles = new PIXI.Graphics();
      const vfx = new PIXI.Graphics();
      const labels = new PIXI.Container();
      app.stage.addChild(lanes, sweep, particles, vfx, labels);

      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const payloadNumber = (payload: Record<string, unknown>, names: string[]) => (
        readReplayPayloadNumber(payload, names) ?? 0
      );

      const payloadOptionalNumber = readReplayPayloadNumber;

      const payloadPosition = (payload: Record<string, unknown>, names: string[]): ArenaV2BoardPositionDto | undefined => {
        for (const name of names) {
          const value = payload[name];
          if (!value || typeof value !== 'object') continue;
          const candidate = value as { row?: unknown; column?: unknown };
          const column = Number(candidate.column);
          if ((candidate.row === 'front' || candidate.row === 'back') && Number.isInteger(column) && column >= 0 && column <= 2) {
            return { row: candidate.row, column: column as ArenaV2BoardPositionDto['column'] };
          }
        }
        return undefined;
      };

      const makeText = (text: string, style: TextStyleOptions) => new PIXI.Text({ text, style });

      const pointFromElement = (element: Element | null): ReplayAnchor | null => {
        if (!(element instanceof HTMLElement)) return null;
        const hostRect = host.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        return {
          x: rect.left - hostRect.left + rect.width / 2,
          y: rect.top - hostRect.top + rect.height / 2,
          radius: Math.max(18, Math.min(rect.width, rect.height) * 0.36)
        };
      };

      const slotPoint = (seatNo: number, position: ArenaV2BoardPositionDto) => pointFromElement(
        host.parentElement?.querySelector(
          `[data-battle-seat="${seatNo}"][data-battle-row="${position.row}"][data-battle-column="${position.column}"]`
        ) || null
      );

      const cardPoint = (cardInstanceId: string) => {
        const elements = host.parentElement?.querySelectorAll<HTMLElement>('[data-battle-card-id]') || [];
        for (const element of elements) {
          if (element.dataset.battleCardId === cardInstanceId) return pointFromElement(element);
        }
        const card = cardPositionsRef.current[cardInstanceId];
        return card ? slotPoint(card.ownerSeatNo, card.position) : null;
      };

      const playerPoint = (seatNo: number) => pointFromElement(
        host.parentElement?.querySelector(`[data-battle-player-seat="${seatNo}"]`) || null
      );

      const directTargetPoint = (seatNo: number, column: number): ReplayAnchor | null => {
        const safeColumn = Math.max(0, Math.min(2, Math.trunc(column)));
        const hostRect = host.getBoundingClientRect();
        return resolveDirectAttackTargetPoint({
          frontAnchor: slotPoint(seatNo, { row: 'front', column: safeColumn as ArenaV2BoardPositionDto['column'] }),
          backAnchor: slotPoint(seatNo, { row: 'back', column: safeColumn as ArenaV2BoardPositionDto['column'] }),
          boardCenterAnchor: {
            x: hostRect.width / 2,
            y: hostRect.height / 2,
            radius: 0
          },
          seatAnchor: playerPoint(seatNo)
        });
      };

      const resolveEventGeometry = (replayEvent: ReplayEvent) => {
        const payload = replayEvent.payload || {};
        const { attackerId, targetId } = getReplayEventCardIds(replayEvent);
        const sourceCard = attackerId ? cardPositionsRef.current[attackerId] : undefined;
        const targetCard = targetId ? cardPositionsRef.current[targetId] : undefined;
        const targetSeatNo = payloadOptionalNumber(payload, ['targetSeatNo', 'seatNo'])
          ?? targetCard?.ownerSeatNo;
        const sourceSeatNo = payloadOptionalNumber(payload, ['attackerSeatNo', 'sourceSeatNo'])
          ?? sourceCard?.ownerSeatNo
          ?? (targetSeatNo === 0 ? 1 : targetSeatNo === 1 ? 0 : undefined);
        const sourcePosition = payloadPosition(payload, ['sourcePosition', 'attackerPosition'])
          ?? ((payload.row === 'front' || payload.row === 'back') && Number.isInteger(Number(payload.column))
            ? { row: payload.row, column: Number(payload.column) as ArenaV2BoardPositionDto['column'] }
            : sourceCard?.position);
        const targetPosition = payloadPosition(payload, ['targetPosition', 'to', 'position'])
          ?? targetCard?.position;
        const sourceSlot = typeof sourceSeatNo === 'number' && sourcePosition
          ? slotPoint(sourceSeatNo, sourcePosition)
          : null;
        const to = targetId
          ? cardPoint(targetId)
            || (typeof targetSeatNo === 'number' && targetPosition ? slotPoint(targetSeatNo, targetPosition) : null)
          : typeof targetSeatNo === 'number'
            ? replayEvent.eventType === 'direct_attack'
              ? directTargetPoint(targetSeatNo, targetPosition?.column ?? sourcePosition?.column ?? 1)
              : targetPosition
                ? slotPoint(targetSeatNo, targetPosition)
                : playerPoint(targetSeatNo)
            : null;
        const from = attackerId
          ? cardPoint(attackerId) || sourceSlot
          : sourceSlot || (replayEvent.eventType === 'fatigue' && to
            ? {
                x: to.x,
                y: to.y + (to.y <= host.getBoundingClientRect().height / 2 ? -1 : 1) * Math.max(48, to.radius * 2.4),
                radius: 8
              }
            : null);
        return { from, to };
      };

      let measuredEventKey = '';
      let measuredGeometry: { from: ReplayAnchor | null; to: ReplayAnchor | null } = { from: null, to: null };
      const measureActiveEvent = () => {
        const replayEvent = activeEventRef.current;
        const eventKey = replayEvent
          ? `${replayEvent.seq}:${replayEvent.eventType}:${activeEventStartedAtRef.current}`
          : '';
        if (eventKey !== measuredEventKey) {
          measuredEventKey = eventKey;
          measuredGeometry = replayEvent ? resolveEventGeometry(replayEvent) : { from: null, to: null };
        }
        return measuredGeometry;
      };

      const render = (tick = 0) => {
        const width = app.renderer.width / app.renderer.resolution;
        const height = app.renderer.height / app.renderer.resolution;
        lanes.clear();
        sweep.clear();
        particles.clear();
        vfx.clear();
        labels.removeChildren().forEach((child) => child.destroy?.());

        const top = 58;
        const bottom = Math.max(top + 10, height - 58);
        const centerY = height * 0.505;
        const laneXs = [width / 3, (width / 3) * 2];
        laneXs.forEach((x: number) => {
          lanes.moveTo(x, top);
          lanes.lineTo(x, bottom);
          lanes.stroke({ width: 2, color: 0x00a7c7, alpha: 0.24 });
          lanes.moveTo(x + 2, top + 14);
          lanes.lineTo(x + 2, bottom - 14);
          lanes.stroke({ width: 1, color: 0xffffff, alpha: 0.46 });
        });

        lanes.moveTo(18, centerY);
        lanes.lineTo(width - 18, centerY);
        lanes.stroke({ width: 3, color: 0xff456b, alpha: 0.22 });
        lanes.moveTo(18, centerY + 5);
        lanes.lineTo(width - 18, centerY + 5);
        lanes.stroke({ width: 2, color: 0x00a7c7, alpha: 0.2 });

        const currentActiveColumn = activeColumnRef.current;
        if (typeof currentActiveColumn === 'number') {
          const laneWidth = width / 3;
          const x = currentActiveColumn * laneWidth + laneWidth / 2;
          sweep.roundRect(x - laneWidth * 0.42, top, laneWidth * 0.84, bottom - top, 12);
          sweep.fill({ color: 0x00a7c7, alpha: 0.075 });
          sweep.roundRect(x - laneWidth * 0.42, top, laneWidth * 0.84, bottom - top, 12);
          sweep.stroke({ width: 2, color: 0x00a7c7, alpha: 0.18 });
        }

        if (!prefersReducedMotion) {
          for (let index = 0; index < 18; index += 1) {
            const seed = index * 43.17;
            const x = ((seed + tick * 0.22) % Math.max(1, width - 42)) + 21;
            const y = top + ((seed * 1.7 + tick * 0.12) % Math.max(1, bottom - top));
            particles.circle(x, y, index % 3 === 0 ? 1.8 : 1.15);
            particles.fill({ color: index % 2 === 0 ? 0x00a7c7 : 0xff456b, alpha: 0.18 });
          }
        }

        const replayEvent = activeEventRef.current;
        if (!replayEvent) return;
        const { from, to } = measureActiveEvent();
        if (!from && !to) return;

        const compactCanvas = width < 560;
        const payload = replayEvent.payload || {};
        const damage = payloadNumber(payload, ['healthDamage', 'damage', 'shield', 'heal']);
        const duration = replayEventDuration(replayEvent);
        const rawAge = duration > 0 ? (performance.now() - activeEventStartedAtRef.current) / duration : 1;
        const age = prefersReducedMotion ? 0.72 : Math.max(0, Math.min(1, rawAge));
        const visibility = prefersReducedMotion
          ? 0.9
          : Math.max(0, Math.min(1, age / 0.1, (1 - age) / 0.16));
        const pulse = prefersReducedMotion ? 0.86 : 0.72 + Math.sin(age * Math.PI * 4) * 0.18;
        const isPositive = ['drain', 'revive', 'residue', 'graveyard_recover'].includes(replayEvent.eventType);
        const isDefeat = replayEvent.eventType === 'card_defeated';
        const isShield = replayEvent.eventType === 'shield_absorb' || replayEvent.eventType === 'residue';
        const color = isPositive ? 0x27ae60 : isDefeat ? 0xff456b : isShield ? 0x00a7c7 : replayEvent.eventType === 'direct_attack' ? 0xff8a34 : 0xff456b;

        if (from && to) {
          const vectorX = to.x - from.x;
          const vectorY = to.y - from.y;
          const vectorLength = Math.max(1, Math.hypot(vectorX, vectorY));
          const unitX = vectorX / vectorLength;
          const unitY = vectorY / vectorLength;
          const arrowEnd = {
            x: to.x - unitX * Math.min(to.radius, vectorLength * 0.28),
            y: to.y - unitY * Math.min(to.radius, vectorLength * 0.28)
          };
          const controlX = (from.x + arrowEnd.x) / 2;
          const controlY = Math.min(from.y, arrowEnd.y) - (compactCanvas ? 18 : 30);
          const travel = prefersReducedMotion ? 1 : Math.min(1, Math.max(0, (age - 0.08) / 0.64));
          const easedTravel = 1 - Math.pow(1 - travel, 3);
          const missileX = (1 - easedTravel) * (1 - easedTravel) * from.x
            + 2 * (1 - easedTravel) * easedTravel * controlX
            + easedTravel * easedTravel * arrowEnd.x;
          const missileY = (1 - easedTravel) * (1 - easedTravel) * from.y
            + 2 * (1 - easedTravel) * easedTravel * controlY
            + easedTravel * easedTravel * arrowEnd.y;
          const lineAlpha = (compactCanvas ? 0.36 : 0.48) * visibility;

          vfx.moveTo(from.x, from.y);
          vfx.quadraticCurveTo(controlX, controlY, arrowEnd.x, arrowEnd.y);
          vfx.stroke({ width: compactCanvas ? 3 : isShield ? 3 : 4, color, alpha: lineAlpha });
          vfx.moveTo(from.x, from.y);
          vfx.quadraticCurveTo(controlX, controlY - (compactCanvas ? 8 : 14), arrowEnd.x, arrowEnd.y);
          vfx.stroke({ width: compactCanvas ? 1 : 2, color: 0xffffff, alpha: lineAlpha * 0.7 });

          const arrowAngle = Math.atan2(arrowEnd.y - controlY, arrowEnd.x - controlX);
          const arrowSize = compactCanvas ? 10 : 14;
          vfx.poly([
            arrowEnd.x,
            arrowEnd.y,
            arrowEnd.x - Math.cos(arrowAngle - 0.55) * arrowSize,
            arrowEnd.y - Math.sin(arrowAngle - 0.55) * arrowSize,
            arrowEnd.x - Math.cos(arrowAngle + 0.55) * arrowSize,
            arrowEnd.y - Math.sin(arrowAngle + 0.55) * arrowSize
          ]);
          vfx.fill({ color, alpha: 0.76 * visibility });

          vfx.circle(from.x, from.y, 4 + pulse * 3);
          vfx.fill({ color, alpha: 0.25 * visibility });
          vfx.circle(missileX, missileY, compactCanvas ? 4 + pulse * 2 : 6 + pulse * 3);
          vfx.fill({ color: 0xffffff, alpha: 0.72 * visibility });
          vfx.circle(missileX, missileY, compactCanvas ? 8 + pulse * 3 : 12 + pulse * 5);
          vfx.stroke({ width: compactCanvas ? 2 : 3, color, alpha: 0.4 * visibility });
        }

        if (to) {
          const reticleRadius = Math.max(compactCanvas ? 16 : 20, Math.min(compactCanvas ? 26 : 34, to.radius * 0.72));
          const ringAlpha = (isDefeat ? 0.78 : 0.64) * visibility;
          vfx.circle(to.x, to.y, reticleRadius + pulse * (compactCanvas ? 3 : 5));
          vfx.stroke({ width: isDefeat ? 4 : 3, color, alpha: ringAlpha });
          vfx.circle(to.x, to.y, reticleRadius * 0.52);
          vfx.stroke({ width: 2, color: 0xffffff, alpha: ringAlpha * 0.82 });
          const crossInner = reticleRadius * 0.72;
          const crossOuter = reticleRadius * 1.22;
          for (const angle of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
            vfx.moveTo(to.x + Math.cos(angle) * crossInner, to.y + Math.sin(angle) * crossInner);
            vfx.lineTo(to.x + Math.cos(angle) * crossOuter, to.y + Math.sin(angle) * crossOuter);
            vfx.stroke({ width: 3, color, alpha: ringAlpha });
          }

          if (!prefersReducedMotion) {
            const burst = compactCanvas ? 5 : 8;
            for (let spark = 0; spark < burst; spark += 1) {
              const angle = (Math.PI * 2 * spark) / burst + age * 0.9;
              const inner = reticleRadius * 0.68;
              const outer = reticleRadius * (1.08 + pulse * 0.25);
              vfx.moveTo(to.x + Math.cos(angle) * inner, to.y + Math.sin(angle) * inner);
              vfx.lineTo(to.x + Math.cos(angle) * outer, to.y + Math.sin(angle) * outer);
              vfx.stroke({ width: compactCanvas ? 2 : 3, color: spark % 2 === 0 ? color : 0xffffff, alpha: 0.46 * visibility });
            }
          }

          if (damage > 0 || isDefeat || replayEvent.eventType === 'direct_attack') {
            const labelText = isDefeat
              ? 'KO'
              : isShield
                ? `방어${damage || ''}`
                : `${isPositive ? '+' : '-'}${damage || ''}`;
            const text = makeText(labelText, {
              fontFamily: 'Inter, Pretendard, system-ui, sans-serif',
              fontSize: compactCanvas ? isDefeat ? 16 : 13 : isDefeat ? 22 : 18,
              fontWeight: '900',
              fill: isPositive ? '#128445' : isShield ? '#00758e' : '#b01f3d',
              stroke: { color: '#ffffff', width: 4 },
              dropShadow: { color: '#172033', alpha: 0.16, blur: 6, distance: 2 }
            });
            text.anchor?.set?.(0.5);
            text.alpha = visibility;
            const verticalLift = replayEvent.eventType === 'direct_attack' ? 0 : compactCanvas ? 22 : 30;
            text.x = Math.min(width - 32, Math.max(32, to.x));
            text.y = Math.min(height - 32, Math.max(32, to.y - verticalLift - (prefersReducedMotion ? 0 : Math.sin(age * Math.PI) * (compactCanvas ? 5 : 8))));
            labels.addChild(text);
          }
        }
      };

      render(0);
      let elapsed = 0;
      app.ticker.add((ticker: Ticker) => {
        elapsed += ticker.deltaMS || 16;
        render(elapsed);
      });

      const observer = new ResizeObserver(() => {
        measuredEventKey = '';
        render(elapsed);
      });
      observer.observe(host);
      if (host.parentElement) observer.observe(host.parentElement);

      cleanup = () => {
        observer.disconnect();
        app.destroy(true, { children: true });
      };
    };

    void setup();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return <div ref={hostRef} className="arena-v2-pixi-layer" aria-hidden="true" />;
};

const ArenaEmoteBurstLayer: React.FC<{ events: ArenaEmoteEvent[] }> = ({ events }) => (
  <div className="arena-v2-emote-burst-layer" aria-hidden="true">
    {events.map((event) => {
      const visual = getArenaEmoteVisual(event.item);
      return (
        <div
          key={event.id}
          className="arena-v2-emote-burst"
          style={{ left: `${event.x * 100}%`, top: `${event.y * 100}%` }}
        >
          <span>
            {visual.imageUrl ? <Image src={visual.imageUrl} alt="" width={70} height={70} unoptimized /> : <b>{visual.emoji}</b>}
          </span>
        </div>
      );
    })}
  </div>
);

const ArenaEmoteWheelMenu: React.FC<{
  wheel: ArenaEmoteWheel;
  slots: Array<ArenaEmoteItem | null>;
  loadoutStatus: ArenaEmoteLoadoutStatus;
  onPick: (item: ArenaEmoteItem) => void;
  onClose: () => void;
}> = ({ wheel, slots, loadoutStatus, onPick, onClose }) => {
  const dialogRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!wheel) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => {
      const firstEnabledSlot = dialogRef.current?.querySelector<HTMLElement>('button:not(:disabled)');
      (firstEnabledSlot || dialogRef.current)?.focus();
    }, 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled)'));
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? activeIndex <= 0 ? focusable.length - 1 : activeIndex - 1
        : activeIndex >= focusable.length - 1 ? 0 : activeIndex + 1;
      event.preventDefault();
      focusable[nextIndex].focus();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose, wheel]);

  if (!wheel) return null;
  const hasEquippedEmote = slots.some(Boolean);
  const centerLabel = loadoutStatus === 'loading'
    ? '불러오는 중'
    : loadoutStatus === 'error'
      ? '로드 실패'
      : hasEquippedEmote
        ? '사용'
        : '장착 필요';
  const centerHint = loadoutStatus === 'loading'
    ? '잠시만요'
    : loadoutStatus === 'error'
      ? '다시 열어 재시도'
      : hasEquippedEmote
        ? '선택'
        : '상점에서 설정';
  const menuStatus = loadoutStatus === 'error'
    ? '장착 정보를 불러오지 못함'
    : hasEquippedEmote
      ? '장착한 이모트 선택'
      : '장착한 이모트 없음';
  return (
    <div
      className="arena-v2-emote-wheel-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="매치 이모트 선택"
      onPointerDown={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div
        ref={dialogRef}
        className="arena-v2-emote-wheel"
        style={{
          left: wheel.x,
          top: wheel.y,
          '--arena-emote-wheel-size': `${wheel.size}px`
        } as React.CSSProperties}
        tabIndex={-1}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <ArenaEmotePieMenu
          slots={slots}
          onPick={(item) => onPick(item as ArenaEmoteItem)}
          centerLabel={centerLabel}
          centerHint={centerHint}
          ariaLabel={`매치 이모트 파이 메뉴, ${menuStatus}`}
          compact
        />
      </div>
    </div>
  );
};

const applyVirtualSelfState = (match: ArenaV2MatchViewDto, actions: ArenaV2TurnActionDto[]) => {
  const selfSeatNo = match.selfSeatNo ?? 0;
  const self = match.players.find((player) => player.seatNo === selfSeatNo);
  const hand = [...(self?.handCardInstanceIds || [])];
  const board = (self?.boardState || []).map((slot) => ({ ...slot, position: { ...slot.position } }));
  const pendingIds = new Set<string>();

  for (const action of actions) {
    if (action.type === 'place') {
      const handIndex = hand.indexOf(action.cardInstanceId);
      if (handIndex >= 0 && !board.some((slot) => positionKey(slot.position) === positionKey(action.to))) {
        hand.splice(handIndex, 1);
        board.push({ cardInstanceId: action.cardInstanceId, position: { ...action.to }, createdTurn: match.turnNo });
        pendingIds.add(action.cardInstanceId);
      }
    } else if (action.type === 'move') {
      const slot = board.find((item) => item.cardInstanceId === action.cardInstanceId);
      if (slot && !board.some((item) => positionKey(item.position) === positionKey(action.to))) {
        slot.position = { ...action.to };
        pendingIds.add(action.cardInstanceId);
      }
    } else if (action.type === 'replace') {
      const handIndex = hand.indexOf(action.handCardInstanceId);
      const slot = board.find((item) => positionKey(item.position) === positionKey(action.target));
      if (handIndex >= 0 && slot) {
        hand.splice(handIndex, 1);
        slot.cardInstanceId = action.handCardInstanceId;
        slot.createdTurn = match.turnNo;
        pendingIds.add(action.handCardInstanceId);
      }
    }
  }

  return { hand, board, pendingIds };
};

export const ArenaV2MatchPageClient: React.FC<{ matchId?: string | null; mode?: 'match' | 'spectate' | 'settings' }> = ({ matchId, mode = 'match' }) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useApp();
  const requestedMatchId = matchId || searchParams.get('match_id') || searchParams.get('id') || '';
  const battleRoyaleId = mode === 'spectate'
    ? searchParams.get('battle_royale_id') || searchParams.get('battleRoyaleId') || ''
    : '';
  const [spectatedMatchId, setSpectatedMatchId] = React.useState(requestedMatchId);
  const resolvedMatchId = mode === 'spectate' ? spectatedMatchId || requestedMatchId : requestedMatchId;
  const [spectatorSeatNo, setSpectatorSeatNo] = React.useState<number | null>(null);
  const [battleRoyale, setBattleRoyale] = React.useState<ArenaBattleRoyaleState | null>(null);
  const [match, setMatch] = React.useState<ArenaV2MatchViewDto | null>(null);
  const [replayEvents, setReplayEvents] = React.useState<ReplayEvent[]>([]);
  const [loading, setLoading] = React.useState(Boolean(resolvedMatchId));
  const [selection, setSelection] = React.useState<Selection>(null);
  const [actions, setActions] = React.useState<ArenaV2TurnActionDto[]>([]);
  const [mulliganIds, setMulliganIds] = React.useState<string[]>([]);
  const [revision, setRevision] = React.useState(0);
  const [activeReplayIndex, setActiveReplayIndex] = React.useState(-1);
  const [replayPlaybackMode, setReplayPlaybackMode] = React.useState<ReplayPlaybackMode>(null);
  const [autoReplaySettled, setAutoReplaySettled] = React.useState(true);
  const [recentScenesOpen, setRecentScenesOpen] = React.useState(false);
  const [turnLoadedAt, setTurnLoadedAt] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());
  const [serverClockOffsetMs, setServerClockOffsetMs] = React.useState(0);
  const [fallbackPlanningStartsAt, setFallbackPlanningStartsAt] = React.useState<number | null>(null);
  const [notice, setNotice] = React.useState('');
  const [emoteSlots, setEmoteSlots] = React.useState<Array<ArenaEmoteItem | null>>(Array(8).fill(null));
  const [emoteLoadoutStatus, setEmoteLoadoutStatus] = React.useState<ArenaEmoteLoadoutStatus>('loading');
  const [emoteWheel, setEmoteWheel] = React.useState<ArenaEmoteWheel>(null);
  const [activeEmotes, setActiveEmotes] = React.useState<ArenaEmoteEvent[]>([]);
  const emoteCooldownRef = React.useRef(0);
  const battlefieldRef = React.useRef<HTMLDivElement | null>(null);
  const lastAutoPlayedReplayRef = React.useRef('');
  const replayRequestIdRef = React.useRef(0);
  const matchRequestGenerationRef = React.useRef(0);
  const resolvedMatchIdRef = React.useRef(resolvedMatchId);

  React.useLayoutEffect(() => {
    if (resolvedMatchIdRef.current === resolvedMatchId) return;
    matchRequestGenerationRef.current += 1;
    replayRequestIdRef.current += 1;
    resolvedMatchIdRef.current = resolvedMatchId;
  }, [resolvedMatchId]);

  const isCurrentMatchRequest = React.useCallback((
    requestGeneration: number,
    requestedId: string,
    responseMatchId?: string | null
  ) => resolvedMatchIdRef.current === requestedId
    && isArenaMatchRequestCurrent(
      matchRequestGenerationRef.current,
      requestGeneration,
      requestedId,
      responseMatchId
    ), []);

  const selectSpectatedMatch = React.useCallback((nextMatchId: string) => {
    matchRequestGenerationRef.current += 1;
    replayRequestIdRef.current += 1;
    resolvedMatchIdRef.current = nextMatchId;
    setSpectatedMatchId(nextMatchId);
  }, []);

  const scopedMatchUrl = React.useCallback((id: string, suffix = '') => {
    const baseUrl = `/arena/matches/${encodeURIComponent(id)}${suffix}`;
    if (mode !== 'spectate' || !battleRoyaleId) return baseUrl;
    return `${baseUrl}?battleRoyaleId=${encodeURIComponent(battleRoyaleId)}`;
  }, [battleRoyaleId, mode]);

  const syncServerClock = React.useCallback((
    nextMatch: ArenaV2MatchViewDto | null | undefined,
    responseServerNow: unknown,
    requestStartedAt: number
  ) => {
    const serverNow = typeof nextMatch?.phaseTiming?.serverNow === 'string'
      ? nextMatch.phaseTiming.serverNow
      : typeof responseServerNow === 'string' ? responseServerNow : '';
    const parsedServerNow = Date.parse(serverNow);
    if (!Number.isFinite(parsedServerNow)) return;
    const responseReceivedAt = Date.now();
    const estimatedClientAtServerStamp = requestStartedAt + (responseReceivedAt - requestStartedAt) / 2;
    setServerClockOffsetMs(parsedServerNow - estimatedClientAtServerStamp);
    setNow(responseReceivedAt);
  }, []);

  const loadReplay = React.useCallback(async (
    id: string,
    requestGeneration = matchRequestGenerationRef.current,
    signal?: AbortSignal
  ) => {
    if (!id || signal?.aborted || !isCurrentMatchRequest(requestGeneration, id)) return false;
    const requestId = replayRequestIdRef.current + 1;
    replayRequestIdRef.current = requestId;
    const requestStartedAt = Date.now();
    const res = await apiFetch(scopedMatchUrl(id, '/replay'), { signal });
    if (signal?.aborted || !isCurrentMatchRequest(requestGeneration, id) || !res.ok) return false;
    const json = await res.json().catch(() => ({}));
    const nextMatch = json?.match as ArenaV2MatchViewDto | undefined;
    if (signal?.aborted
      || requestId !== replayRequestIdRef.current
      || !isCurrentMatchRequest(requestGeneration, id, nextMatch?.id)) return false;
    if (nextMatch) {
      setMatch(nextMatch);
      syncServerClock(nextMatch, json?.serverNow, requestStartedAt);
    }
    const { events: latestEvents, visualEvents } = selectLatestReplayScene(json?.events);
    const visualSignature = `${id}|${visualEvents.map((event) => `${event.seq}:${event.eventType}`).join('|')}`;
    setReplayEvents(latestEvents);
    if (!visualEvents.length) {
      lastAutoPlayedReplayRef.current = '';
      setActiveReplayIndex(-1);
      setReplayPlaybackMode(null);
      setAutoReplaySettled(true);
    } else if (visualSignature !== lastAutoPlayedReplayRef.current) {
      lastAutoPlayedReplayRef.current = visualSignature;
      setActiveReplayIndex(0);
      setReplayPlaybackMode('auto');
      setAutoReplaySettled(false);
      setFallbackPlanningStartsAt(null);
    }
    return true;
  }, [isCurrentMatchRequest, scopedMatchUrl, syncServerClock]);

  const loadMatch = React.useCallback(async (signal?: AbortSignal) => {
    const requestedId = resolvedMatchId;
    const requestGeneration = matchRequestGenerationRef.current + 1;
    matchRequestGenerationRef.current = requestGeneration;
    if (!requestedId) {
      setMatch(null);
      setLoading(false);
      setTurnLoadedAt(Date.now());
      setReplayEvents([]);
      lastAutoPlayedReplayRef.current = '';
      setActiveReplayIndex(-1);
      setReplayPlaybackMode(null);
      setAutoReplaySettled(true);
      setActions([]);
      setSelection(null);
      setNotice('경기를 선택하면 전장이 표시됩니다.');
      return;
    }
    setLoading(true);
    try {
      const replayLoaded = await loadReplay(requestedId, requestGeneration, signal);
      if (signal?.aborted || !isCurrentMatchRequest(requestGeneration, requestedId)) return;
      if (!replayLoaded) {
        const requestStartedAt = Date.now();
        const res = await apiFetch(scopedMatchUrl(requestedId), { signal });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.message || '매치를 불러오지 못했습니다.');
        const nextMatch = json.match as ArenaV2MatchViewDto | undefined;
        if (!nextMatch) throw new Error('매치 응답에 경기 정보가 없습니다.');
        if (signal?.aborted || !isCurrentMatchRequest(requestGeneration, requestedId, nextMatch.id)) return;
        setMatch(nextMatch);
        syncServerClock(nextMatch, json?.serverNow, requestStartedAt);
        setReplayEvents([]);
        setActiveReplayIndex(-1);
        setReplayPlaybackMode(null);
        setAutoReplaySettled(true);
      }
      if (signal?.aborted || !isCurrentMatchRequest(requestGeneration, requestedId)) return;
      setTurnLoadedAt(Date.now());
      setActions([]);
      setSelection(null);
      setNotice('');
    } catch (error: unknown) {
      if (!signal?.aborted && isCurrentMatchRequest(requestGeneration, requestedId)) {
        setNotice(errorMessage(error, '매치를 불러오지 못했습니다.'));
      }
    } finally {
      if (!signal?.aborted && isCurrentMatchRequest(requestGeneration, requestedId)) setLoading(false);
    }
  }, [isCurrentMatchRequest, loadReplay, resolvedMatchId, scopedMatchUrl, syncServerClock]);

  React.useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadMatch(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadMatch]);

  React.useEffect(() => {
    if (mode === 'spectate' && resolvedMatchIdRef.current !== requestedMatchId) {
      selectSpectatedMatch(requestedMatchId);
    }
  }, [mode, requestedMatchId, selectSpectatedMatch]);

  React.useEffect(() => {
    if (mode !== 'spectate' || !battleRoyaleId) return;
    let stopped = false;
    const syncBattleRoyale = async () => {
      try {
        const res = await apiFetch(`/arena/battle-royales/${encodeURIComponent(battleRoyaleId)}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok || stopped || !json?.battleRoyale) return;
        const next = json.battleRoyale as ArenaBattleRoyaleState;
        setBattleRoyale(next);
        const options = normalizeSpectatorMatches(next);
        const nextSpectatedMatchId = spectatedMatchId && options.some((option) => option.id === spectatedMatchId)
          ? spectatedMatchId
          : options[0]?.id || '';
        if (nextSpectatedMatchId !== spectatedMatchId) selectSpectatedMatch(nextSpectatedMatchId);
      } catch {
        // 관전 상태는 다음 동기화에서 복구합니다.
      }
    };
    const timer = window.setInterval(() => void syncBattleRoyale(), 3000);
    void syncBattleRoyale();
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [battleRoyaleId, mode, selectSpectatedMatch, spectatedMatchId]);

  const currentMatchId = match?.id;
  const currentMatchStatus = match?.status;
  const currentTurnNo = match?.turnNo;

  const pendingBattleRoyaleResult = shouldContinueBattleRoyaleResultSync(match);
  const matchSyncIntervalMs = getArenaMatchSyncIntervalMs(currentMatchStatus, pendingBattleRoyaleResult);
  React.useEffect(() => {
    const shouldSync = mode !== 'settings'
      && Boolean(currentMatchId)
      && ((currentMatchStatus !== 'completed' && currentMatchStatus !== 'cancelled') || pendingBattleRoyaleResult);
    if (!shouldSync || !currentMatchId) return;

    let stopped = false;
    const controller = new AbortController();
    let inFlight = false;
    const syncWaitingMatch = async () => {
      const requestGeneration = matchRequestGenerationRef.current;
      if (stopped || controller.signal.aborted
        || inFlight
        || document.visibilityState !== 'visible'
        || !isCurrentMatchRequest(requestGeneration, currentMatchId)) return;
      inFlight = true;
      try {
        const requestStartedAt = Date.now();
        const res = await apiFetch(scopedMatchUrl(currentMatchId), { signal: controller.signal });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || stopped || controller.signal.aborted || !json?.match) return;
        const nextMatch = json.match as ArenaV2MatchViewDto;
        if (stopped || controller.signal.aborted || !isCurrentMatchRequest(requestGeneration, currentMatchId, nextMatch.id)) return;
        syncServerClock(nextMatch, json?.serverNow, requestStartedAt);
        const statusChanged = nextMatch.status !== currentMatchStatus;
        const turnAdvanced = nextMatch.turnNo !== currentTurnNo;
        const enteredPlanning = statusChanged && nextMatch.status === 'turn_planning';
        if (turnAdvanced) {
          setActions([]);
          setSelection(null);
        }
        if (turnAdvanced || enteredPlanning) {
          setTurnLoadedAt(Date.now());
        }
        if (enteredPlanning) setMulliganIds([]);
        const requiresReplay = statusChanged || turnAdvanced || mode === 'spectate' || nextMatch.status === 'combat_resolving';
        const replayLoaded = requiresReplay
          ? await loadReplay(currentMatchId, requestGeneration, controller.signal)
          : false;
        if (stopped || controller.signal.aborted || !isCurrentMatchRequest(requestGeneration, currentMatchId)) return;
        if (!requiresReplay || !replayLoaded) setMatch(nextMatch);
      } catch {
        // 상대 결정을 기다리는 동안의 일시적인 네트워크 실패는 다음 동기화에서 복구합니다.
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => void syncWaitingMatch(), matchSyncIntervalMs);
    const syncOnVisible = () => {
      if (document.visibilityState === 'visible') void syncWaitingMatch();
    };
    document.addEventListener('visibilitychange', syncOnVisible);
    void syncWaitingMatch();
    return () => {
      stopped = true;
      window.clearInterval(timer);
      controller.abort();
      document.removeEventListener('visibilitychange', syncOnVisible);
    };
  }, [currentMatchId, currentMatchStatus, currentTurnNo, isCurrentMatchRequest, loadReplay, matchSyncIntervalMs, mode, pendingBattleRoyaleResult, scopedMatchUrl, syncServerClock]);

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const loadEmoteLoadout = React.useCallback(async (signal?: AbortSignal) => {
    setEmoteLoadoutStatus('loading');
    try {
      const res = await apiFetch('/arena/cosmetics/loadout', { signal });
      if (!res.ok) throw new Error(`ArenaEmoteLoadoutHttp${res.status}`);
      const json = await res.json();
      if (signal?.aborted) return;
      setEmoteSlots(Array.from({ length: 8 }, (_, index) => json?.emoteSlots?.[index] || null));
      setEmoteLoadoutStatus('ready');
    } catch {
      if (signal?.aborted) return;
      setEmoteLoadoutStatus('error');
    }
  }, []);

  React.useEffect(() => {
    if (mode !== 'match') return;
    const controller = new AbortController();
    const syncLoadout = () => {
      if (document.visibilityState === 'visible') void loadEmoteLoadout(controller.signal);
    };
    const initialLoadTimer = window.setTimeout(() => {
      void loadEmoteLoadout(controller.signal);
    }, 0);
    window.addEventListener('focus', syncLoadout);
    document.addEventListener('visibilitychange', syncLoadout);
    return () => {
      window.clearTimeout(initialLoadTimer);
      controller.abort();
      window.removeEventListener('focus', syncLoadout);
      document.removeEventListener('visibilitychange', syncLoadout);
    };
  }, [loadEmoteLoadout, mode]);

  React.useEffect(() => {
    const handleArenaEvent = (event: Event) => {
      const detail = (event as CustomEvent).detail as ArenaEmoteEvent | null;
      if (!detail || detail.kind !== 'arena_emote' || detail.matchId !== resolvedMatchId) return;
      setActiveEmotes((current) => [...current.filter((item) => item.id !== detail.id), detail].slice(-12));
      window.setTimeout(() => {
        setActiveEmotes((current) => current.filter((item) => item.id !== detail.id));
      }, 2600);
    };
    window.addEventListener('chikapo:arena-updated', handleArenaEvent as EventListener);
    return () => window.removeEventListener('chikapo:arena-updated', handleArenaEvent as EventListener);
  }, [resolvedMatchId]);

  const playbackEvents = React.useMemo(
    () => replayEvents.filter(isReplayVisualEvent),
    [replayEvents]
  );
  const completedVisualEventCount = activeReplayIndex >= 0 ? activeReplayIndex : playbackEvents.length;
  const presentationMatch = React.useMemo(
    () => match && activeReplayIndex >= 0
      ? buildReplayPresentationMatch(match, replayEvents, completedVisualEventCount)
      : match,
    [activeReplayIndex, completedVisualEventCount, match, replayEvents]
  );
  const selfSeat = mode === 'spectate'
    ? spectatorSeatNo ?? presentationMatch?.players[0]?.seatNo ?? 0
    : presentationMatch?.selfSeatNo ?? 0;
  const opponentSeat = presentationMatch?.players.find((item) => item.seatNo !== selfSeat)?.seatNo ?? (selfSeat === 0 ? 1 : 0);
  const self = presentationMatch?.players.find((item) => item.seatNo === selfSeat);
  const opponent = presentationMatch?.players.find((item) => item.seatNo === opponentSeat);
  const selfNextFatigue = (self?.fatigueCount ?? 0) + 1;
  const opponentNextFatigue = (opponent?.fatigueCount ?? 0) + 1;
  const instanceById = React.useMemo(() => new Map((presentationMatch?.cardInstances || []).map((item) => [item.id, item])), [presentationMatch]);
  const virtualSelf = React.useMemo(() => {
    if (!presentationMatch) return { hand: [], board: [], pendingIds: new Set<string>() };
    if (mode === 'spectate') {
      const viewpoint = presentationMatch.players.find((player) => player.seatNo === selfSeat);
      return { hand: [], board: viewpoint?.boardState || [], pendingIds: new Set<string>() };
    }
    const effectiveActions = activeReplayIndex >= 0 ? [] : actions;
    return applyVirtualSelfState(presentationMatch, effectiveActions);
  }, [actions, activeReplayIndex, mode, presentationMatch, selfSeat]);
  const selectedColumn = selection?.source === 'board' ? selection.position.column : null;
  const pixiCardPositions = React.useMemo(() => {
    if (!presentationMatch) return {};
    const byId: Record<string, PixiCardPosition> = {};
    for (const player of presentationMatch.players) {
      const boardState = player.seatNo === selfSeat ? virtualSelf.board : player.boardState;
      for (const slot of boardState || []) {
        byId[slot.cardInstanceId] = {
          ownerSeatNo: player.seatNo,
          position: { ...slot.position }
        };
      }
    }
    for (const instance of presentationMatch.cardInstances) {
      if (!byId[instance.id] && instance.position && instance.zone === 'board') {
        byId[instance.id] = {
          ownerSeatNo: instance.ownerSeatNo,
          position: { ...instance.position }
        };
      }
    }
    return byId;
  }, [presentationMatch, selfSeat, virtualSelf.board]);
  const activeReplayEvent = activeReplayIndex >= 0 ? playbackEvents[activeReplayIndex] : undefined;

  React.useEffect(() => {
    if (!activeReplayEvent) return;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = prefersReducedMotion ? 180 : replayEventDuration(activeReplayEvent);
    const timer = window.setTimeout(() => {
      if (activeReplayIndex + 1 < playbackEvents.length) {
        setActiveReplayIndex(activeReplayIndex + 1);
        return;
      }
      setActiveReplayIndex(-1);
      setReplayPlaybackMode(null);
      if (replayPlaybackMode === 'auto') {
        setAutoReplaySettled(true);
        if (!match?.phaseTiming?.planningStartsAt) {
          setFallbackPlanningStartsAt(Date.now() + Math.max(0, match?.phaseTiming?.introDurationMs ?? 1400));
        }
      }
    }, duration);
    return () => window.clearTimeout(timer);
  }, [activeReplayEvent, activeReplayIndex, match?.phaseTiming?.introDurationMs, match?.phaseTiming?.planningStartsAt, playbackEvents.length, replayPlaybackMode]);

  const combatCue = React.useMemo(
    () => buildCombatCue(activeReplayEvent, pixiCardPositions, selfSeat),
    [activeReplayEvent, pixiCardPositions, selfSeat]
  );
  const freeTacticalMoveCount = getArenaFreeTacticalMoveCount(self?.mulliganState);
  const queuedTacticalMoveCount = actions.filter((action) => action.type === 'move').length;
  const freeTacticalMovesLeft = Math.max(0, freeTacticalMoveCount - queuedTacticalMoveCount);
  const getCardActionCost = (cardInstanceId: string) => Number(instanceById.get(cardInstanceId)?.card?.cost || 0);
  const spentCost = calculateArenaTurnActionCost(actions, getCardActionCost, freeTacticalMoveCount);
  const costCap = availableCost(presentationMatch?.turnNo || 1);
  const serverNowMs = now + serverClockOffsetMs;
  const parsedReplayEndsAt = Date.parse(match?.phaseTiming?.replayEndsAt || '');
  const replayEndsAtMs = Number.isFinite(parsedReplayEndsAt) ? parsedReplayEndsAt : null;
  const parsedPlanningStartsAt = Date.parse(match?.phaseTiming?.planningStartsAt || '');
  const planningStartsAtMs = Number.isFinite(parsedPlanningStartsAt)
    ? parsedPlanningStartsAt
    : (fallbackPlanningStartsAt ?? (turnLoadedAt || serverNowMs));
  const parsedDeadlineAt = Date.parse(match?.phaseTiming?.turnDeadlineAt || '');
  const turnDurationMs = Number.isFinite(parsedDeadlineAt) && parsedDeadlineAt > planningStartsAtMs
    ? parsedDeadlineAt - planningStartsAtMs
    : 40_000;
  const turnClock = getReplayTurnClock(serverNowMs, planningStartsAtMs, turnDurationMs);
  const resolvedPresentationPhase = resolveReplayPresentationPhase({
    status: match?.status,
    completedVisualEventCount,
    visualEventCount: playbackEvents.length,
    nowMs: serverNowMs,
    turnIntroStartsAtMs: replayEndsAtMs,
    turnIntroEndsAtMs: planningStartsAtMs
  });
  const presentationPhase = !autoReplaySettled && playbackEvents.length > 0 ? 'replaying' : resolvedPresentationPhase;
  const displayTurnNo = resolveReplayDisplayTurnNo(presentationPhase, match?.turnNo, replayEvents);
  const resultSummary = match?.resultSummary && typeof match.resultSummary === 'object'
    ? match.resultSummary as { lockedSeats?: unknown; mulliganDeadlineAt?: unknown }
    : {};
  const parsedMulliganDeadlineAt = Date.parse(
    typeof resultSummary.mulliganDeadlineAt === 'string'
      ? resultSummary.mulliganDeadlineAt
      : ''
  );
  const mulliganClock = Number.isFinite(parsedMulliganDeadlineAt)
    ? getReplayTurnClock(serverNowMs, parsedMulliganDeadlineAt - 40_000, 40_000)
    : turnClock;
  const timeLeft = Math.min(40, Math.max(0,
    match?.status === 'mulligan' ? mulliganClock.secondsLeft : turnClock.secondsLeft
  ));
  const lockedSeats = Array.isArray(resultSummary.lockedSeats)
    ? resultSummary.lockedSeats.map(Number).filter(Number.isFinite)
    : [];
  const selfHasLockedTurn = lockedSeats.includes(selfSeat);
  const canPlan = mode === 'match'
    && (match?.status === 'turn_planning' || match?.status === 'action_locked')
    && presentationPhase === 'planning'
    && isReplayTurnClockOpen(turnClock)
    && activeReplayIndex < 0
    && !selfHasLockedTurn;
  const canMulligan = mode === 'match'
    && match?.status === 'mulligan'
    && isReplayTurnClockOpen(mulliganClock)
    && activeReplayIndex < 0;

  const addAction = (nextAction: ArenaV2TurnActionDto) => {
    if (!match || !canPlan) return;
    const nextCost = calculateArenaTurnActionCost(
      [...actions, nextAction],
      getCardActionCost,
      freeTacticalMoveCount
    );
    if (nextCost > costCap) {
      setNotice('사용 가능한 코스트를 초과합니다.');
      return;
    }
    setActions((current) => [...current, nextAction]);
    setSelection(null);
    setNotice('');
  };

  const onSelfSlotClick = (position: ArenaV2BoardPositionDto, instance?: CardInstance) => {
    if (mode === 'spectate' || activeReplayIndex >= 0 || presentationPhase !== 'planning') return;
    if (!canPlan) {
      if (instance) setSelection({ source: 'board', id: instance.id, position });
      return;
    }
    if (!selection) {
      if (instance) setSelection({ source: 'board', id: instance.id, position });
      return;
    }
    if (selection.source === 'hand') {
      if (instance) addAction({ type: 'replace', handCardInstanceId: selection.id, target: position });
      else addAction({ type: 'place', cardInstanceId: selection.id, to: position });
      return;
    }
    if (selection.source === 'board') {
      if (!instance) addAction({ type: 'move', cardInstanceId: selection.id, from: selection.position, to: position });
      else if (instance) setSelection({ source: 'board', id: instance.id, position });
    }
  };

  const submitMulligan = async () => {
    if (!match) {
      setNotice('제출할 매치를 먼저 선택해야 합니다.');
      return;
    }
    try {
      const res = await apiFetch(`/arena/matches/${encodeURIComponent(match.id)}/mulligan`, {
        method: 'POST',
        body: JSON.stringify({ replaceCardInstanceIds: mulliganIds })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '멀리건 제출 실패');
      if (json.match) setMatch(json.match);
      setTurnLoadedAt(Date.now());
      setMulliganIds([]);
      toast('멀리건을 제출했습니다.', 'success');
    } catch (error: unknown) {
      setNotice(errorMessage(error, '멀리건 제출에 실패했습니다.'));
    }
  };

  const submitActions = async () => {
    if (!match) {
      setNotice('제출할 매치를 먼저 선택해야 합니다.');
      return;
    }
    const payloadActions = actions.length ? [...actions, { type: 'end' as const }] : [{ type: 'end' as const }];
    try {
      const res = await apiFetch(`/arena/matches/${encodeURIComponent(match.id)}/actions`, {
        method: 'POST',
        body: JSON.stringify({ turnNo: match.turnNo, revision, isFinal: true, actions: payloadActions })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.validation?.errors?.[0]?.message || json?.message || '행동 제출 실패');
      setRevision((value) => value + 1);
      setActions([]);
      setSelection(null);
      if (json.match) setMatch(json.match);
      setTurnLoadedAt(Date.now());
      await loadReplay(match.id);
      toast(json.match?.status === 'completed' ? '경기가 종료되었습니다.' : '이번 턴 행동을 제출했습니다.', 'success');
    } catch (error: unknown) {
      setNotice(errorMessage(error, '행동 제출에 실패했습니다.'));
    }
  };

  const openEmoteWheel = (event: React.MouseEvent<HTMLElement>) => {
    if (mode !== 'match' || !match) return;
    event.preventDefault();
    if (emoteLoadoutStatus === 'error') void loadEmoteLoadout();
    const target = battlefieldRef.current;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const ratioX = clamp01((event.clientX - rect.left) / rect.width);
    const ratioY = clamp01((event.clientY - rect.top) / rect.height);
    const geometry = resolveEmoteWheelGeometry(event.clientX, event.clientY);
    setEmoteWheel({
      ...geometry,
      ratioX,
      ratioY
    });
  };

  const openEmoteWheelAtCenter = () => {
    if (mode !== 'match' || !match) return;
    if (emoteLoadoutStatus === 'error') void loadEmoteLoadout();
    const target = battlefieldRef.current;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const geometry = resolveEmoteWheelGeometry(
      rect.left + rect.width / 2,
      rect.top + Math.min(rect.height / 2, 300)
    );
    setEmoteWheel({
      ...geometry,
      ratioX: 0.5,
      ratioY: 0.5
    });
  };

  const closeEmoteWheel = React.useCallback(() => setEmoteWheel(null), []);

  React.useEffect(() => {
    if (!emoteWheel) return;
    window.addEventListener('resize', closeEmoteWheel);
    window.addEventListener('orientationchange', closeEmoteWheel);
    return () => {
      window.removeEventListener('resize', closeEmoteWheel);
      window.removeEventListener('orientationchange', closeEmoteWheel);
    };
  }, [closeEmoteWheel, emoteWheel]);

  const sendEmote = async (item: ArenaEmoteItem) => {
    if (!match || !emoteWheel) return;
    const nowMs = Date.now();
    if (nowMs - emoteCooldownRef.current < 1800) {
      setNotice('이모트는 잠시 후 다시 사용할 수 있습니다.');
      setEmoteWheel(null);
      return;
    }
    emoteCooldownRef.current = nowMs;
    const wheel = emoteWheel;
    setEmoteWheel(null);
    try {
      const res = await apiFetch(`/arena/matches/${encodeURIComponent(match.id)}/emotes`, {
        method: 'POST',
        body: JSON.stringify({ itemId: item.id, x: wheel.ratioX, y: wheel.ratioY })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '이모트를 사용할 수 없습니다.');
      if (json?.event) {
        setActiveEmotes((current) => [...current.filter((emote) => emote.id !== json.event.id), json.event].slice(-12));
        window.setTimeout(() => {
          setActiveEmotes((current) => current.filter((emote) => emote.id !== json.event.id));
        }, 2600);
      }
    } catch (error: unknown) {
      setNotice(errorMessage(error, '이모트를 사용할 수 없습니다.'));
    }
  };

  const renderBoard = (seatNo: number, interactive: boolean) => {
    const player = seatNo === selfSeat
      ? { boardState: virtualSelf.board }
      : presentationMatch?.players.find((item) => item.seatNo === seatNo);
    const canInteract = interactive && canPlan && activeReplayIndex < 0;
    const boardMap = new Map((player?.boardState || []).map((slot) => [positionKey(slot.position), slot]));
    const positions = seatNo === selfSeat ? selfBoardPositions : opponentBoardPositions;
    return (
      <div className={`arena-v2-board ${canInteract ? 'is-interactive' : ''}`}>
        {positions.map((position) => {
          const slot = boardMap.get(positionKey(position));
          const instance = slot ? instanceById.get(slot.cardInstanceId) : undefined;
          const selected = mode !== 'spectate' && selection?.source === 'board' && selection.id === instance?.id;
          const pending = instance ? virtualSelf.pendingIds.has(instance.id) : false;
          const cardCombatCue = instance ? combatCue.cardCues[instance.id] : undefined;
          return (
            <div
              key={`${seatNo}-${position.row}-${position.column}`}
              role={mode === 'spectate' || activeReplayIndex >= 0 ? 'presentation' : 'button'}
              tabIndex={mode === 'spectate' || activeReplayIndex >= 0 ? -1 : 0}
              data-battle-seat={seatNo}
              data-battle-row={position.row}
              data-battle-column={position.column}
              data-battle-card-id={instance?.id}
              className={`arena-v2-slot ${instance ? 'has-card' : ''} ${canInteract ? 'can-drop' : ''} ${selected ? 'is-selected' : ''} ${pending ? 'is-pending' : ''} ${cardCombatCue?.role === 'target' ? 'is-combat-target-slot' : ''}`}
              onClick={() => canInteract ? onSelfSlotClick(position, instance) : mode !== 'spectate' && activeReplayIndex < 0 && instance && setSelection({ source: 'board', id: instance.id, position })}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  if (canInteract) onSelfSlotClick(position, instance);
                  else if (mode !== 'spectate' && activeReplayIndex < 0 && instance) setSelection({ source: 'board', id: instance.id, position });
                }
              }}
              aria-label={`${seatNo === selfSeat ? '내' : '상대'} ${positionLabel(position)}`}
            >
              <ArenaTooltip data={getArenaBoardSlotTooltip(position.row, position.column, seatNo === selfSeat ? 'self' : 'opponent')} side="top">
                <span className="arena-v2-slot-label">{positionLabel(position)}</span>
              </ArenaTooltip>
              <MiniCard
                key={`${instance?.id || 'empty'}:${cardCombatCue?.seq ?? 'idle'}`}
                instance={instance}
                selected={selected}
                pending={pending}
                combatCue={cardCombatCue}
                onClick={() => canInteract ? onSelfSlotClick(position, instance) : mode !== 'spectate' && activeReplayIndex < 0 && instance && setSelection({ source: 'board', id: instance.id, position })}
              />
            </div>
          );
        })}
      </div>
    );
  };

  const handIds = canMulligan ? (self?.handCardInstanceIds || []) : virtualSelf.hand;
  const hand = handIds.map((id) => instanceById.get(id)).filter(Boolean) as CardInstance[];
  const title = mode === 'spectate' ? '아레나 관전' : mode === 'settings' ? '아레나 관리' : '아레나 매치';
  const subtitle = mode === 'spectate'
    ? '진행된 전투 흐름을 한눈에 확인합니다.'
    : mode === 'settings'
      ? '시즌과 대전 상태를 확인합니다.'
      : match ? `${matchModeLabel(match.mode)} · ${matchStatusLabel(match.status)} · 턴 ${displayTurnNo}` : loading ? '경기를 불러오는 중' : '경기를 선택해 주세요.';

  const spectatorMatchOptions = React.useMemo(
    () => normalizeSpectatorMatches(battleRoyale),
    [battleRoyale]
  );

  const viewerResult = match?.viewerResult;
  const resultPlacement = viewerResult?.placement ?? self?.finalRank ?? null;
  const replayResultReady = mode === 'match'
    && match?.status === 'completed'
    && activeReplayIndex < 0
    && autoReplaySettled
    && shouldRevealReplayResult(match.status, playbackEvents.length, playbackEvents.length);
  const resultOutcome = viewerResult?.outcome
    ?? (match?.winnerUserId == null
      ? 'draw'
      : match.winnerUserId === self?.userId ? 'win' : 'loss');
  const resultBattleRoyaleId = match?.battleRoyaleId || '';
  const nextMatchId = viewerResult?.nextMatchId || '';

  return (
    <ArenaLayout activeTab="play" onTabChange={(tab) => moveArenaSection(router, tab)} immersive>
      <div className={`arena-v2-shell arena-v2-battle-shell arena-v2-page is-match ${styles.arenaV2Scope}`}>
        <section className="arena-v2-topbar arena-v2-battle-topbar">
          <div className="arena-v2-battle-brand min-w-0">
            <button type="button" className="arena-v2-icon-button" onClick={() => router.push('/arena/play')} aria-label="아레나 플레이로 돌아가기">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="arena-v2-battle-brand-copy">
              <h2>{title}</h2>
              <p>{subtitle}</p>
            </div>
          </div>
          <div className="arena-v2-scoreboard" aria-label="전투 점수판">
            <ArenaTooltip data={{ ...arenaCoreTooltips.playerHealth, title: '상대 플레이어 체력' }} side="bottom">
              <div className="arena-v2-score-card is-opponent">
                <span>상대 HP</span>
                <strong>{opponent?.playerHealth ?? 30}</strong>
              </div>
            </ArenaTooltip>
            <ArenaTooltip data={{ ...arenaCoreTooltips.turnTimer, title: `${displayTurnNo}턴 · ${timeLeft}초 남음` }} side="bottom">
              <div className="arena-v2-score-core">
                <span>TURN {displayTurnNo}</span>
                <strong>{timeLeft}</strong>
                <span>SECONDS</span>
              </div>
            </ArenaTooltip>
            <ArenaTooltip data={{ ...arenaCoreTooltips.playerHealth, title: mode === 'spectate' ? '선택 시점 플레이어 체력' : '내 플레이어 체력' }} side="bottom">
              <div className="arena-v2-score-card is-self">
                <span>{mode === 'spectate' ? '선택 시점 HP' : '내 HP'}</span>
                <strong>{self?.playerHealth ?? 30}</strong>
              </div>
            </ArenaTooltip>
          </div>
          <div className="arena-v2-top-actions">
            <ArenaTooltip data={{ ...arenaCoreTooltips.refresh, title: '매치 새로고침', description: '서버에서 현재 턴, 보드, 손패, 행동과 전투 기록을 다시 불러옵니다.' }} side="bottom">
              <button type="button" className="arena-v2-icon-button" onClick={() => void loadMatch()} aria-label="매치 새로고침">
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </ArenaTooltip>
            {mode === 'match' ? (
              <ArenaTooltip data={{
                ...arenaCoreTooltips.emoteWheel,
                description: emoteLoadoutStatus === 'error'
                  ? '이모트 장착 정보를 다시 불러오고 파이 메뉴를 엽니다. 메뉴는 빈 상태에서도 열려 문제 원인을 바로 확인할 수 있습니다.'
                  : emoteSlots.some(Boolean)
                    ? arenaCoreTooltips.emoteWheel.description
                    : '현재 장착된 이모트가 없습니다. 파이 메뉴에서 빈 슬롯을 확인하고 아레나 상점에서 이모트를 장착할 수 있습니다.'
              }} side="bottom">
                <button
                  type="button"
                  className="arena-v2-secondary-button arena-v2-emote-trigger"
                  onClick={openEmoteWheelAtCenter}
                  aria-label="이모트 파이 메뉴 열기"
                >
                  <Sparkles className="h-4 w-4" /> 이모트
                </button>
              </ArenaTooltip>
            ) : null}
            {canMulligan ? (
              <ArenaTooltip data={{
                eyebrow: '대전 시작', title: '멀리건 제출', description: '시작 손패 5장 중 선택한 카드를 덱으로 되돌리고 섞은 뒤 같은 수만큼 다시 뽑습니다.',
                details: [{ label: '교체 가능', value: '최대 3장' }, { label: '횟수', value: '대전 시작 시 1회' }],
                note: '선택하지 않고 제출하면 현재 시작 손패를 그대로 사용합니다.', tone: 'cyan'
              }} side="bottom">
                <button type="button" className="arena-v2-primary-button" onClick={submitMulligan}>
                  <Hand className="h-4 w-4" /> 멀리건 제출
                </button>
              </ArenaTooltip>
            ) : mode === 'match' ? (
              <ArenaTooltip data={arenaCoreTooltips.submit} side="bottom">
                <button type="button" className="arena-v2-primary-button" onClick={submitActions} disabled={!canPlan}>
                  <Send className="h-4 w-4" /> 행동 제출
                </button>
              </ArenaTooltip>
            ) : (
              <button type="button" className="arena-v2-primary-button" onClick={() => router.push('/arena')}>
                <Check className="h-4 w-4" /> 아레나 홈
              </button>
            )}
          </div>
        </section>

        {notice ? <div className="arena-v2-notice"><AlertTriangle className="h-4 w-4" />{notice}</div> : null}

        {mode === 'spectate' ? (
          <section className="arena-v2-spectator-toolbar" aria-label="8인전 관전 설정">
            <div className="arena-v2-spectator-summary">
              <Eye className="h-5 w-5" aria-hidden="true" />
              <div><span>8인전 관전</span><strong>{battleRoyale?.currentRoundNo ? `${battleRoyale.currentRoundNo}라운드` : '진행 경기'}</strong></div>
            </div>
            <div className="arena-v2-spectator-controls">
              <label><span>경기</span><select value={resolvedMatchId} onChange={(event) => {
                const nextId = event.target.value;
                selectSpectatedMatch(nextId);
                setSpectatorSeatNo(null);
                setActions([]);
                setSelection(null);
                const params = new URLSearchParams({ battle_royale_id: battleRoyaleId });
                if (nextId) params.set('match_id', nextId);
                router.replace(`/arena/spectate?${params.toString()}`);
              }}>
                {spectatorMatchOptions.map((option, index) => (
                  <option key={option.id} value={option.id}>{option.roundNo ? `${option.roundNo}라운드` : `경기 ${index + 1}`} · {matchStatusLabel(option.status || undefined)}</option>
                ))}
              </select></label>
              <label><span>시점</span><select value={selfSeat} onChange={(event) => { setSpectatorSeatNo(Number(event.target.value)); setSelection(null); }}>
                {(match?.players || []).map((player) => <option key={player.seatNo} value={player.seatNo}>자리 {player.seatNo + 1}</option>)}
              </select></label>
            </div>
          </section>
        ) : null}

        <section className="arena-v2-mobile-hud" aria-label="모바일 전투 요약">
          <span><Shield className="h-3.5 w-3.5" /> {mode === 'spectate' ? '선택 시점' : '나'} {self?.playerHealth ?? 30}</span>
          <span><Shield className="h-3.5 w-3.5" /> 상대 {opponent?.playerHealth ?? 30}</span>
          <span><FileClock className="h-3.5 w-3.5" /> 피로 {selfNextFatigue}</span>
          <span><Zap className="h-3.5 w-3.5" /> {spentCost}/{costCap}</span>
          <span><Clock3 className="h-3.5 w-3.5" /> {timeLeft}초</span>
        </section>

        <section className="arena-v2-stage arena-v2-match-stage arena-v2-battle-grid">
          <aside className="arena-v2-phase-rail arena-v2-side-ledger">
            {[
              [Move, '이동', freeTacticalMovesLeft > 0 ? `${freeTacticalMovesLeft}회 무료 이동` : '1코스트 · 1회'],
              [Plus, '배치', '빈 칸 소환'],
              [RotateCcw, '교체', '기존 카드 대체'],
              [FileClock, '전투 기록', '최근 장면']
            ].map(([Icon, label, hint], index) => (
              <ArenaTooltip
                key={String(label)}
                data={String(label) === '이동' && freeTacticalMoveCount > 0
                  ? {
                      ...battlePhaseTooltips[String(label)],
                      note: freeTacticalMovesLeft > 0
                        ? `이번 턴 무료 전술 이동이 ${freeTacticalMovesLeft}회 남았습니다.`
                        : '이번 턴 무료 전술 이동을 모두 사용했습니다. 다음 이동부터 1코스트가 필요합니다.'
                    }
                  : battlePhaseTooltips[String(label)]}
                side="right"
                focusable
              >
                <div className={`arena-v2-phase ${index === 1 && canPlan ? 'is-active' : ''}`}>
                  {React.createElement(Icon as typeof Move, { className: 'h-4 w-4' })}
                  <strong>{String(label)}</strong>
                  <span>{String(hint)}</span>
                </div>
              </ArenaTooltip>
            ))}
          </aside>

          <div
            ref={battlefieldRef}
            className={`arena-v2-board-wrap arena-v2-battlefield ${combatCue.event ? 'has-combat-cue' : ''}`}
            onContextMenu={mode === 'match' && presentationPhase === 'planning' ? openEmoteWheel : undefined}
          >
            <PixiBattleLayer activeColumn={selectedColumn} activeEvent={activeReplayEvent} cardPositions={pixiCardPositions} />
            {mode === 'match' ? <ArenaEmoteBurstLayer events={activeEmotes} /> : null}
            {mode === 'match' ? <ArenaEmoteWheelMenu
              wheel={emoteWheel}
              slots={emoteSlots}
              loadoutStatus={emoteLoadoutStatus}
              onPick={sendEmote}
              onClose={closeEmoteWheel}
            /> : null}
            {presentationPhase === 'turn_intro' ? (
              <div key={match?.turnNo} className="arena-v2-turn-intro" role="status" aria-live="assertive">
                <span>NEXT TURN</span><strong>{match?.turnNo ?? 1}턴</strong>
              </div>
            ) : null}
            <div className="arena-v2-player-strip is-opponent">
              <div><span>상대</span><strong>{match?.mode === 'bot' ? '연습 상대' : `자리 ${opponentSeat + 1}`}</strong></div>
              <ArenaTooltip data={{ ...arenaCoreTooltips.playerHealth, title: '상대 체력' }} side="bottom" focusable><div className="arena-v2-resource" data-battle-player-seat={opponentSeat}><Shield className="h-4 w-4" /> {opponent?.playerHealth ?? 30}</div></ArenaTooltip>
              <ArenaTooltip data={{ ...arenaCoreTooltips.hand, title: '상대 손패', description: '상대가 현재 보유한 손패 수입니다. 카드 내용은 공개되지 않습니다.' }} side="bottom" focusable><div className="arena-v2-resource"><Hand className="h-4 w-4" /> 손 {opponent?.handCount ?? 0}</div></ArenaTooltip>
              <ArenaTooltip data={{ ...arenaCoreTooltips.deck, title: '상대 남은 덱' }} side="bottom" focusable><div className="arena-v2-resource"><Hand className="h-4 w-4" /> 덱 {opponent?.deckCount ?? 0}</div></ArenaTooltip>
              <ArenaTooltip data={{ ...arenaCoreTooltips.fatigue, title: '상대 다음 피로 피해' }} side="bottom" focusable><div className="arena-v2-resource"><FileClock className="h-4 w-4" /> 피로 {opponentNextFatigue}</div></ArenaTooltip>
            </div>
            {presentationMatch ? renderBoard(opponentSeat, false) : null}
            <div className="arena-v2-lane-divider"><span>전열이 먼저 맞붙고 후열이 뒤이어 압박합니다</span></div>
            {presentationMatch ? renderBoard(selfSeat, canPlan) : null}
            <div className="arena-v2-player-strip">
              <div><span>{mode === 'spectate' ? '선택 시점' : '나'}</span><strong>자리 {selfSeat + 1}</strong></div>
              <ArenaTooltip data={{ ...arenaCoreTooltips.playerHealth, title: mode === 'spectate' ? '선택 시점 체력' : '내 체력' }} side="top" focusable><div className="arena-v2-resource" data-battle-player-seat={selfSeat}><Shield className="h-4 w-4" /> {self?.playerHealth ?? 30}</div></ArenaTooltip>
              <ArenaTooltip data={{ ...arenaCoreTooltips.deck, title: mode === 'spectate' ? '선택 시점 남은 덱' : '내 남은 덱' }} side="top" focusable><div className="arena-v2-resource"><Hand className="h-4 w-4" /> 덱 {self?.deckCount ?? 0}</div></ArenaTooltip>
              <ArenaTooltip data={{ ...arenaCoreTooltips.fatigue, title: mode === 'spectate' ? '선택 시점 다음 피로 피해' : '내 다음 피로 피해' }} side="top" focusable><div className="arena-v2-resource"><FileClock className="h-4 w-4" /> 피로 {selfNextFatigue}</div></ArenaTooltip>
            </div>
          </div>

          <aside className="arena-v2-command-panel arena-v2-command-console">
            <ArenaTooltip data={arenaCoreTooltips.matchStatus} side="left" focusable><div className="arena-v2-stat arena-v2-accent-cyan"><Eye className="h-4 w-4" /><span>상태</span><strong>{matchStatusLabel(match?.status)}</strong></div></ArenaTooltip>
            <ArenaTooltip data={{ ...arenaCoreTooltips.turnCost, title: `코스트 ${spentCost} / ${costCap}`, description: `이번 턴 사용 예정 ${spentCost}, 사용 가능 상한 ${costCap}입니다.` }} side="left" focusable><div className="arena-v2-stat arena-v2-accent-gold"><Zap className="h-4 w-4" /><span>코스트</span><strong>{spentCost} / {costCap}</strong></div></ArenaTooltip>
            <ArenaTooltip data={arenaCoreTooltips.turnTimer} side="left" focusable><div className="arena-v2-stat arena-v2-accent-green"><Clock3 className="h-4 w-4" /><span>턴 제한</span><strong>{timeLeft}초</strong></div></ArenaTooltip>
            <div className="arena-v2-panel-section">
              <span className="arena-v2-panel-label">행동 순서</span>
              <div className="arena-v2-action-stack">
                {mode === 'spectate'
                  ? <p>관전 중에는 제출 전 행동이 공개되지 않습니다.</p>
                  : actions.length ? actions.map((action, index) => (
                  <button type="button" key={`${action.type}-${index}`} onClick={() => setActions((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                    <span>{index + 1}</span>{actionLabel(action)}<Trash2 className="h-3.5 w-3.5" />
                  </button>
                )) : <p>{canMulligan ? '교체할 손패를 최대 3장 선택합니다.' : '손패 또는 내 필드 카드를 선택한 뒤 슬롯을 누릅니다.'}</p>}
              </div>
            </div>
            <div className="arena-v2-panel-section">
              <span className="arena-v2-panel-label">최근 장면</span>
              <div className="arena-v2-replay-list">
                {playbackEvents.length ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSelection(null);
                      setReplayPlaybackMode('manual');
                      setActiveReplayIndex(0);
                    }}
                    disabled={activeReplayIndex >= 0}
                    aria-live="polite"
                  >
                    <Play className="h-3.5 w-3.5" />
                    {activeReplayIndex >= 0 ? `${replayPlaybackMode === 'manual' ? '다시 재생' : '자동 재생'} ${activeReplayIndex + 1}/${playbackEvents.length}` : '처음부터 다시 재생'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="arena-v2-replay-toggle"
                  aria-expanded={recentScenesOpen}
                  aria-controls="arena-v2-recent-scenes"
                  onClick={() => setRecentScenesOpen((current) => !current)}
                >
                  <FileClock className="h-3.5 w-3.5" />
                  {recentScenesOpen ? '장면 목록 접기' : `장면 목록 펼치 (${replayEvents.length})`}
                  <ChevronDown className={`h-3.5 w-3.5 ${recentScenesOpen ? 'is-open' : ''}`} />
                </button>
                <div id="arena-v2-recent-scenes" className="arena-v2-replay-events" hidden={!recentScenesOpen}>
                  {replayEvents.length ? replayEvents.map((event) => (
                    <span key={`${event.seq}-${event.eventType}`}><Play className="h-3.5 w-3.5" />T{event.turnNo} · {eventLabel(event.eventType)}</span>
                  )) : <p>아직 기록된 이벤트가 없습니다.</p>}
                </div>
              </div>
            </div>
          </aside>
        </section>

        <section className="arena-v2-hand-rail arena-v2-bottom-hand">
          <div className="arena-v2-hand-header">
            <div>
              <h3>{mode === 'spectate' ? '관전 정보 보호' : canMulligan ? '시작 손패 교체' : '손패와 제출 대기 행동'}</h3>
              <span>{mode === 'spectate' ? '손패와 제출 행동은 턴 시작 전까지 공개되지 않습니다.' : canMulligan ? `${mulliganIds.length} / 3 선택` : `덱 ${self?.deckCount ?? 0}장 · 무덤 ${self?.graveyardCardInstanceIds.length ?? 0}장`}</span>
            </div>
            {mode !== 'spectate' ? (
            <button type="button" className="arena-v2-secondary-button" onClick={() => { setActions([]); setSelection(null); }}>
              <Lock className="h-4 w-4" /> 선택 초기화
            </button>
            ) : null}
          </div>
          <div className="arena-v2-card-row is-hand">
            {mode === 'spectate' ? <div className="arena-v2-spectator-privacy"><Eye className="h-5 w-5" /><strong>비공개 정보</strong><span>현재 시점의 손패와 다음 행동은 표시하지 않습니다.</span></div> : hand.length ? hand.map((instance) => {
              const selected = canMulligan ? mulliganIds.includes(instance.id) : selection?.source === 'hand' && selection.id === instance.id;
              return (
                <MiniCard
                  key={instance.id}
                  instance={instance}
                  selected={selected}
                  combatCue={combatCue.cardCues[instance.id]}
                  onClick={() => {
                    if (canMulligan) {
                      setMulliganIds((current) => current.includes(instance.id) ? current.filter((id) => id !== instance.id) : current.length >= 3 ? current : [...current, instance.id]);
                    } else if (canPlan) {
                      setSelection({ source: 'hand', id: instance.id });
                    }
                  }}
                />
              );
            }) : <p>현재 표시할 손패가 없습니다.</p>}
          </div>
        </section>
        <ArenaMatchResultModal
          open={replayResultReady}
          outcome={resultOutcome}
          modeLabel={matchModeLabel(match?.mode)}
          mmrBefore={viewerResult?.mmrBefore}
          mmrAfter={viewerResult?.mmrAfter}
          mmrDelta={viewerResult?.mmrDelta}
          unrated={viewerResult?.unrated}
          placement={resultPlacement}
          sharedPlacement={viewerResult?.sharedPlacement}
          isBattleRoyale={Boolean(resultBattleRoyaleId || match?.mode === 'battle_royale_8')}
          round={match?.roundNo}
          canSpectate={Boolean(viewerResult?.canSpectate && resultBattleRoyaleId)}
          hasNextMatch={Boolean(nextMatchId)}
          onExit={() => router.push('/arena/play')}
          onContinue={nextMatchId
            ? () => router.push(`/arena/matches/${encodeURIComponent(nextMatchId)}`)
            : undefined}
          onSpectate={viewerResult?.canSpectate && resultBattleRoyaleId ? () => {
            const params = new URLSearchParams({ battle_royale_id: resultBattleRoyaleId });
            router.push(`/arena/spectate?${params.toString()}`);
          } : undefined}
        />
      </div>
    </ArenaLayout>
  );
};
