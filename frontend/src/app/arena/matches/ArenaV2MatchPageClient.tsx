'use client';

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Bot,
  Check,
  Clock3,
  Crown,
  Eye,
  FileClock,
  Hand,
  HeartPulse,
  Lock,
  Move,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Shield,
  Sparkles,
  Swords,
  Target,
  Trash2,
  Zap
} from 'lucide-react';
import { API_BASE_URL, apiFetch } from '@/lib/api';
import { parseArenaCosmeticStyle } from '@/lib/arenaCosmetics';
import { useApp } from '../../AppContext';
import { ArenaLayout } from '../../ArenaLayout';
import type { ArenaSiteTab } from '../types';
import styles from '../ArenaV2Experience.module.css';
import type { ArenaV2BoardPositionDto, ArenaV2MatchViewDto, ArenaV2TurnActionDto } from '@chikapo/arena-contract';

type CardInstance = ArenaV2MatchViewDto['cardInstances'][number];
type ReplayEvent = { seq: number; turnNo: number; eventType: string; payload: Record<string, unknown> };
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
type Selection =
  | { source: 'hand'; id: string }
  | { source: 'board'; id: string; position: ArenaV2BoardPositionDto }
  | null;

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
  ratioX: number;
  ratioY: number;
} | null;

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

const moveArenaSection = (router: ReturnType<typeof useRouter>, tab: ArenaSiteTab) => {
  router.push(arenaTabHref[tab] || '/arena');
};

const positionKey = (position: ArenaV2BoardPositionDto) => `${position.row}:${position.column}`;
const positionLabel = (position: ArenaV2BoardPositionDto) => `${position.row === 'front' ? '전열' : '후열'} ${position.column + 1}`;
const availableCost = (turnNo: number) => Math.min(9, Math.max(1, turnNo));
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const getBackendAssetOrigin = () => {
  try {
    if (/^https?:\/\//i.test(API_BASE_URL)) return new URL(API_BASE_URL).origin;
    if (typeof window !== 'undefined') return new URL(API_BASE_URL, window.location.origin).origin;
  } catch {
    return '';
  }
  return '';
};

const resolveArenaEmoteImageUrl = (value?: string | null) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/uploads/') || raw.startsWith('uploads/')) {
    const origin = getBackendAssetOrigin();
    const cleanPath = raw.startsWith('/') ? raw : `/${raw}`;
    return origin ? `${origin}${cleanPath}` : cleanPath;
  }
  if (raw.startsWith('/')) return raw;
  return '';
};

const getArenaEmoteVisual = (item?: ArenaEmoteItem | null) => {
  const style = parseArenaCosmeticStyle(item?.style_json);
  const imageUrl = resolveArenaEmoteImageUrl(typeof style.image_url === 'string' ? style.image_url : '');
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

const replayPayloadNumber = (payload: Record<string, unknown>, names: string[]) => {
  for (const name of names) {
    if (!(name in payload)) continue;
    const value = Number(payload[name]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
};

const buildCombatCue = (
  events: ReplayEvent[],
  cardPositions: Record<string, PixiCardPosition>,
  selfSeatNo: number
): CombatCue => {
  const combatEvent = [...events].reverse().find((event) => [
    'line_attack',
    'direct_attack',
    'card_attack',
    'shield_absorb',
    'card_defeated'
  ].includes(event.eventType));
  if (!combatEvent) return { damage: 0, cardCues: {} };
  const payload = combatEvent.payload || {};
  const attackerId = replayPayloadString(payload, ['cardInstanceId', 'attackerCardInstanceId', 'sourceCardInstanceId', 'attackerInstanceId']);
  const targetId = replayPayloadString(payload, ['targetCardInstanceId', 'targetInstanceId', 'defeatedCardInstanceId']);
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

const classTone = (cardClass?: string) => {
  if (cardClass === 'attack' || cardClass === 'charge') return 'coral';
  if (cardClass === 'guard' || cardClass === 'guardian' || cardClass === 'support') return 'green';
  if (cardClass === 'control' || cardClass === 'trick' || cardClass === 'specter' || cardClass === 'sniper') return 'violet';
  return 'cyan';
};

const classLabel = (cardClass?: string) => {
  if (cardClass === 'attack' || cardClass === 'charge') return '돌파';
  if (cardClass === 'guard' || cardClass === 'guardian') return '수비';
  if (cardClass === 'support') return '지원';
  if (cardClass === 'sniper') return '조준';
  if (cardClass === 'control' || cardClass === 'trick') return '기만';
  if (cardClass === 'specter') return '망령';
  if (cardClass === 'tempo') return '템포';
  return '전투';
};

const classIcon = (cardClass?: string) => {
  if (cardClass === 'attack' || cardClass === 'charge') return Swords;
  if (cardClass === 'guard' || cardClass === 'guardian') return Shield;
  if (cardClass === 'support') return Sparkles;
  if (cardClass === 'sniper') return Target;
  if (cardClass === 'control' || cardClass === 'trick') return Target;
  if (cardClass === 'specter') return Crown;
  if (cardClass === 'tempo') return Zap;
  return Zap;
};

const keywordLabel = (type?: string) => {
  if (!type || type === 'preview') return null;
  const labels: Record<string, string> = {
    taunt: '도발',
    pierce: '관통',
    shield: '보호',
    aim: '조준',
    snipe: '조준',
    push: '밀치기',
    pull: '끌기',
    silence: '침묵',
    stun: '기절',
    weaken: '약화',
    drain: '흡혈',
    lifesteal: '흡혈',
    counter: '반격',
    revive: '부활',
    vengeance: '원한',
    grudge: '원한',
    spirit: '원혼',
    haunt: '원혼',
    residue: '잔재',
    remnant: '잔재',
    graveyard_recover: '묘지 회수',
    graveyardRecover: '묘지 회수'
  };
  return labels[type] || type;
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
  const tone = classTone(card?.cardClass);
  const role = classLabel(card?.cardClass);
  const RoleIcon = classIcon(card?.cardClass);
  const name = card?.displayName || instance.cardVersionId;
  const keywordTags = (card?.keywords || [])
    .map((keyword: any) => keywordLabel(keyword?.type))
    .filter(Boolean)
    .slice(0, 2) as string[];
  const primaryKeyword = keywordTags[0] || role;
  const remainingHealth = Math.max(0, Number(instance.currentHealth || 0) - Number(instance.damageTaken || 0));
  const damageTaken = Math.max(0, Number(instance.damageTaken || 0));
  const tooltip = `${name}\n클래스: ${role}\n효과: ${(keywordTags.length ? keywordTags : ['특수 효과 없음']).join(', ')}${damageTaken > 0 ? `\n받은 피해: ${damageTaken}` : ''}\n공격력: ${instance.currentAttack}\n체력: ${remainingHealth}`;
  const combatClass = combatCue?.role === 'attacker'
    ? `is-combat-attacker ${combatCue.eventType === 'direct_attack' ? 'is-direct-strike' : 'is-line-strike'}`
    : combatCue?.role === 'target'
      ? `is-combat-target ${combatCue.eventType === 'shield_absorb' ? 'is-shield-impact' : ''}`
      : '';
  const strikeX = Math.max(-2.4, Math.min(2.4, combatCue?.dx || 0)) * 102;
  const strikeY = Math.max(-3, Math.min(3, combatCue?.dy || 0)) * 94;
  const combatStyle = combatCue?.role === 'attacker'
    ? {
        '--arena-v2-strike-pre-x': `${strikeX * -0.1}%`,
        '--arena-v2-strike-pre-y': `${strikeY * -0.07}%`,
        '--arena-v2-strike-mid-x': `${strikeX * 0.74}%`,
        '--arena-v2-strike-mid-y': `${strikeY * 0.74}%`,
        '--arena-v2-strike-hit-x': `${strikeX * 0.92}%`,
        '--arena-v2-strike-hit-y': `${strikeY * 0.92}%`,
        '--arena-v2-strike-return-x': `${strikeX * 0.16}%`,
        '--arena-v2-strike-return-y': `${strikeY * 0.16}%`
      } as React.CSSProperties
    : undefined;
  return (
    <button
      type="button"
      className={`arena-v2-card arena-v2-accent-${tone} is-compact ${selected ? 'is-selected' : ''} ${pending ? 'is-pending' : ''} ${combatClass}`}
      style={combatStyle}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      aria-pressed={selected}
      aria-label={`${name}, 비용 ${card?.cost ?? 0}, 공격 ${instance.currentAttack}, 체력 ${remainingHealth}`}
      data-card-tooltip={combatCue ? undefined : tooltip}
      data-combat-damage={combatCue?.role === 'target' && combatCue.damage ? `-${combatCue.damage}` : undefined}
      data-combat-seq={combatCue?.seq}
    >
      <span className="arena-v2-card-cost" aria-label={`비용 ${card?.cost ?? 0}`}>{card?.cost ?? 0}</span>
      <span className="arena-v2-card-role" title={`클래스: ${role}`} aria-label={`클래스 ${role}`}>
        <RoleIcon className="h-4 w-4" />
        <span>{role}</span>
      </span>
      <span className="arena-v2-card-art" aria-hidden="true">
        <span className={`arena-v2-art-fallback arena-v2-accent-${tone}`}><span>{role}</span></span>
        <span className="arena-v2-card-keywords">
          {(keywordTags.length ? keywordTags : [role]).map((tag) => <span key={tag} title={`효과 키워드: ${tag}`}>{tag}</span>)}
          {damageTaken > 0 ? <span className="is-damaged" title={`받은 피해 ${damageTaken}`}>피해 {damageTaken}</span> : null}
        </span>
      </span>
      <span className="arena-v2-card-readable">
        <span className="arena-v2-card-name">{name}</span>
        <span className="arena-v2-card-brand" aria-hidden="true">CHIKAPO ARENA</span>
        <span className="arena-v2-card-mini-meta" aria-hidden="true">
          <span>{role}</span>
          <span>{primaryKeyword}</span>
          {damageTaken > 0 ? <span className="is-damaged">피해 {damageTaken}</span> : null}
        </span>
      </span>
      <span className="arena-v2-card-stats">
        <span className="is-atk"><Swords className="h-3.5 w-3.5" /><b>{instance.currentAttack}</b><em>공</em></span>
        <span className="is-hp"><HeartPulse className="h-3.5 w-3.5" /><b>{remainingHealth}</b><em>체</em></span>
      </span>
    </button>
  );
};

const PixiBattleLayer: React.FC<{
  activeColumn?: number | null;
  events: ReplayEvent[];
  cardPositions: Record<string, PixiCardPosition>;
  selfSeatNo: number;
}> = ({ activeColumn, events, cardPositions, selfSeatNo }) => {
  const hostRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    const setup = async () => {
      const host = hostRef.current;
      if (!host) return;
      const PIXI = await import('pixi.js');
      if (disposed || !hostRef.current) return;

      const app = new (PIXI as any).Application();
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

      const lanes = new (PIXI as any).Graphics();
      const sweep = new (PIXI as any).Graphics();
      const particles = new (PIXI as any).Graphics();
      const vfx = new (PIXI as any).Graphics();
      const labels = new (PIXI as any).Container();
      app.stage.addChild(lanes, sweep, particles, vfx, labels);

      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const payloadString = (payload: Record<string, unknown>, names: string[]) => {
        for (const name of names) {
          const value = payload[name];
          if (typeof value === 'string' && value.trim()) return value;
        }
        return '';
      };

      const payloadNumber = (payload: Record<string, unknown>, names: string[]) => {
        for (const name of names) {
          const value = Number(payload[name]);
          if (Number.isFinite(value)) return value;
        }
        return 0;
      };

      const payloadOptionalNumber = (payload: Record<string, unknown>, names: string[]) => {
        for (const name of names) {
          if (!(name in payload)) continue;
          const value = Number(payload[name]);
          if (Number.isFinite(value)) return value;
        }
        return undefined;
      };

      const makeText = (text: string, style: Record<string, unknown>) => {
        try {
          return new (PIXI as any).Text({ text, style });
        } catch {
          return new (PIXI as any).Text(text, style);
        }
      };

      const cardPoint = (cardInstanceId: string, width: number, height: number) => {
        const card = cardPositions[cardInstanceId];
        if (!card) return null;
        const column = Math.min(2, Math.max(0, Number(card.position.column || 0)));
        const rowTop = 82;
        const rowBottom = Math.max(rowTop + 120, height - 82);
        const rowHeight = (rowBottom - rowTop) / 4;
        const isSelf = card.ownerSeatNo === selfSeatNo;
        const rowIndex = isSelf
          ? card.position.row === 'front' ? 2 : 3
          : card.position.row === 'back' ? 0 : 1;
        return {
          x: (column + 0.5) * (width / 3),
          y: rowTop + rowHeight * (rowIndex + 0.5)
        };
      };

      const playerPoint = (seatNo: number, width: number, height: number, column?: number) => ({
        x: typeof column === 'number'
          ? (Math.min(2, Math.max(0, column)) + 0.5) * (width / 3)
          : width * 0.5,
        y: seatNo === selfSeatNo ? height - Math.min(156, height * 0.29) : Math.min(156, height * 0.29)
      });

      const fallbackPoint = (index: number, width: number, height: number) => ({
        x: ((index % 3) + 0.5) * (width / 3),
        y: height * (index % 2 === 0 ? 0.38 : 0.62)
      });

      const render = (tick = 0) => {
        const width = app.renderer.width / app.renderer.resolution;
        const height = app.renderer.height / app.renderer.resolution;
        lanes.clear();
        sweep.clear();
        particles.clear();
        vfx.clear();
        labels.removeChildren().forEach((child: any) => child.destroy?.());

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

        if (typeof activeColumn === 'number') {
          const laneWidth = width / 3;
          const x = activeColumn * laneWidth + laneWidth / 2;
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

        const compactCanvas = width < 560;
        events.slice(compactCanvas ? -4 : -6).forEach((replayEvent, index) => {
          const payload = replayEvent.payload || {};
          const sourceId = payloadString(payload, ['cardInstanceId', 'attackerCardInstanceId', 'sourceCardInstanceId', 'attackerInstanceId']);
          const targetId = payloadString(payload, ['targetCardInstanceId', 'targetInstanceId', 'defeatedCardInstanceId']);
          const damage = payloadNumber(payload, ['healthDamage', 'damage', 'shield', 'heal']);
          const targetSeatNo = payloadOptionalNumber(payload, ['targetSeatNo', 'seatNo']);
          const targetColumn = payloadOptionalNumber(payload, ['column']);
          const from = sourceId ? cardPoint(sourceId, width, height) : null;
          const to = targetId
            ? cardPoint(targetId, width, height)
            : typeof targetSeatNo === 'number' && targetSeatNo >= 0
              ? playerPoint(targetSeatNo, width, height, targetColumn)
              : null;
          const fallback = fallbackPoint(index, width, height);
          const start = from || { x: fallback.x - width * 0.12, y: fallback.y };
          const end = to || fallback;
          const age = prefersReducedMotion ? 1 : ((tick / 850 + index * 0.18) % 1);
          const pulse = prefersReducedMotion ? 0.92 : 0.58 + Math.sin((age + index) * Math.PI * 2) * 0.28;
          const controlY = Math.min(start.y, end.y) - 30 - index * 4;
          const travel = prefersReducedMotion ? 1 : Math.min(1, Math.max(0, (age - 0.08) / 0.64));
          const easedTravel = 1 - Math.pow(1 - travel, 3);
          const missileX = start.x + (end.x - start.x) * easedTravel;
          const missileY = (1 - easedTravel) * (1 - easedTravel) * start.y
            + 2 * (1 - easedTravel) * easedTravel * controlY
            + easedTravel * easedTravel * end.y;
          const isPositive = ['drain', 'revive', 'residue', 'graveyard_recover'].includes(replayEvent.eventType);
          const isDefeat = replayEvent.eventType === 'card_defeated';
          const isShield = replayEvent.eventType === 'shield_absorb' || replayEvent.eventType === 'residue';
          const color = isPositive ? 0x27ae60 : isDefeat ? 0xff456b : isShield ? 0x00a7c7 : replayEvent.eventType === 'direct_attack' ? 0xff8a34 : 0xff456b;
          const lineAlpha = compactCanvas ? 0.14 + pulse * 0.2 : 0.18 + pulse * 0.28;
          const ringAlpha = compactCanvas ? 0.22 + pulse * 0.22 : 0.26 + pulse * 0.32;

          vfx.moveTo(start.x, start.y);
          vfx.quadraticCurveTo((start.x + end.x) / 2, controlY, end.x, end.y);
          vfx.stroke({ width: compactCanvas ? 3 : isShield ? 3 : 4, color, alpha: lineAlpha });
          vfx.moveTo(start.x, start.y);
          vfx.quadraticCurveTo((start.x + end.x) / 2, controlY - (compactCanvas ? 10 : 18), end.x, end.y);
          vfx.stroke({ width: compactCanvas ? 1 : 2, color: 0xffffff, alpha: lineAlpha * 0.72 });
          vfx.circle(start.x, start.y, 4 + pulse * 3);
          vfx.fill({ color, alpha: 0.22 });
          vfx.circle(missileX, missileY, compactCanvas ? 4 + pulse * 3 : 6 + pulse * 4);
          vfx.fill({ color: 0xffffff, alpha: 0.72 });
          vfx.circle(missileX, missileY, compactCanvas ? 9 + pulse * 4 : 14 + pulse * 6);
          vfx.stroke({ width: compactCanvas ? 2 : 3, color, alpha: 0.32 + pulse * 0.2 });
          vfx.circle(end.x, end.y, compactCanvas ? 10 + pulse * 4 : isDefeat ? 24 + pulse * 8 : 14 + pulse * 5);
          vfx.stroke({ width: compactCanvas ? 2 : isDefeat ? 4 : 3, color, alpha: ringAlpha });
          if (!prefersReducedMotion) {
            const burst = compactCanvas ? 5 : 8;
            for (let spark = 0; spark < burst; spark += 1) {
              const angle = (Math.PI * 2 * spark) / burst + age * 0.9;
              const inner = compactCanvas ? 9 : 13;
              const outer = (compactCanvas ? 23 : 34) * (0.62 + pulse * 0.38);
              vfx.moveTo(end.x + Math.cos(angle) * inner, end.y + Math.sin(angle) * inner);
              vfx.lineTo(end.x + Math.cos(angle) * outer, end.y + Math.sin(angle) * outer);
              vfx.stroke({ width: compactCanvas ? 2 : 3, color: spark % 2 === 0 ? color : 0xffffff, alpha: 0.34 + pulse * 0.28 });
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
            const verticalLift = replayEvent.eventType === 'direct_attack' ? 0 : compactCanvas ? 20 : 28;
            text.x = Math.min(width - 32, Math.max(32, end.x));
            text.y = Math.min(height - 32, Math.max(32, end.y - verticalLift - index * 3 - (prefersReducedMotion ? 0 : Math.sin(age * Math.PI) * (compactCanvas ? 5 : 8))));
            labels.addChild(text);
          }
        });
      };

      render(0);
      let elapsed = 0;
      app.ticker.add((ticker: any) => {
        elapsed += ticker.deltaMS || 16;
        render(elapsed);
      });

      const observer = new ResizeObserver(() => render(elapsed));
      observer.observe(host);

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
  }, [activeColumn, cardPositions, events, selfSeatNo]);

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
            {visual.imageUrl ? <img src={visual.imageUrl} alt="" /> : <b>{visual.emoji}</b>}
          </span>
        </div>
      );
    })}
  </div>
);

const ArenaEmoteWheelMenu: React.FC<{
  wheel: ArenaEmoteWheel;
  slots: Array<ArenaEmoteItem | null>;
  onPick: (item: ArenaEmoteItem) => void;
  onClose: () => void;
}> = ({ wheel, slots, onPick, onClose }) => {
  if (!wheel) return null;
  const radius = 82;
  return (
    <div className="arena-v2-emote-wheel-backdrop" onPointerDown={onClose}>
      <div
        className="arena-v2-emote-wheel"
        style={{ left: wheel.x, top: wheel.y }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {Array.from({ length: 8 }, (_, index) => {
          const item = slots[index] || null;
          const angle = -90 + index * 45;
          const x = Math.cos((angle * Math.PI) / 180) * radius;
          const y = Math.sin((angle * Math.PI) / 180) * radius;
          const visual = getArenaEmoteVisual(item);
          return (
            <button
              key={index}
              type="button"
              className={item ? 'has-emote' : ''}
              style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
              disabled={!item}
              onClick={() => item && onPick(item)}
              aria-label={item ? `${item.name} 이모트 사용` : `빈 이모트 슬롯 ${index + 1}`}
            >
              {item ? (visual.imageUrl ? <img src={visual.imageUrl} alt="" /> : <b>{visual.emoji}</b>) : <span>{index + 1}</span>}
            </button>
          );
        })}
        <div className="arena-v2-emote-wheel-core">
          <Sparkles className="h-4 w-4" />
          <span>EMOTE</span>
        </div>
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
  const resolvedMatchId = matchId || searchParams.get('match_id') || searchParams.get('id') || '';
  const [match, setMatch] = React.useState<ArenaV2MatchViewDto | null>(null);
  const [replayEvents, setReplayEvents] = React.useState<ReplayEvent[]>([]);
  const [loading, setLoading] = React.useState(Boolean(resolvedMatchId));
  const [selection, setSelection] = React.useState<Selection>(null);
  const [actions, setActions] = React.useState<ArenaV2TurnActionDto[]>([]);
  const [mulliganIds, setMulliganIds] = React.useState<string[]>([]);
  const [revision, setRevision] = React.useState(0);
  const [animationReplayKey, setAnimationReplayKey] = React.useState(0);
  const [turnLoadedAt, setTurnLoadedAt] = React.useState(Date.now());
  const [now, setNow] = React.useState(Date.now());
  const [notice, setNotice] = React.useState('');
  const [emoteSlots, setEmoteSlots] = React.useState<Array<ArenaEmoteItem | null>>(Array(8).fill(null));
  const [emoteWheel, setEmoteWheel] = React.useState<ArenaEmoteWheel>(null);
  const [activeEmotes, setActiveEmotes] = React.useState<ArenaEmoteEvent[]>([]);
  const emoteCooldownRef = React.useRef(0);
  const battlefieldRef = React.useRef<HTMLDivElement | null>(null);

  const loadReplay = React.useCallback(async (id: string) => {
    if (!id) return;
    const res = await apiFetch(`/arena/matches/${encodeURIComponent(id)}/replay`);
    if (!res.ok) return;
    const json = await res.json().catch(() => ({}));
    setReplayEvents(Array.isArray(json?.events) ? json.events.slice(-8) : []);
  }, []);

  const loadMatch = React.useCallback(async () => {
    if (!resolvedMatchId) {
      setMatch(null);
      setTurnLoadedAt(Date.now());
      setReplayEvents([]);
      setActions([]);
      setSelection(null);
      setNotice('경기를 선택하면 전장이 표시됩니다.');
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch(`/arena/matches/${encodeURIComponent(resolvedMatchId)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || '매치를 불러오지 못했습니다.');
      setMatch(json.match);
      setTurnLoadedAt(Date.now());
      setActions([]);
      setSelection(null);
      setNotice('');
      await loadReplay(resolvedMatchId);
    } catch (error: any) {
      setNotice(error?.message || '매치를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [loadReplay, resolvedMatchId]);

  React.useEffect(() => {
    void loadMatch();
  }, [loadMatch]);

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  React.useEffect(() => {
    if (mode !== 'match') return;
    let alive = true;
    void apiFetch('/arena/cosmetics/loadout')
      .then((res) => res.ok ? res.json() : null)
      .then((json) => {
        if (!alive || !json) return;
        setEmoteSlots(Array.from({ length: 8 }, (_, index) => json?.emoteSlots?.[index] || null));
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [mode]);

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

  const selfSeat = match?.selfSeatNo ?? 0;
  const opponentSeat = selfSeat === 0 ? 1 : 0;
  const self = match?.players.find((item) => item.seatNo === selfSeat);
  const opponent = match?.players.find((item) => item.seatNo === opponentSeat);
  const selfNextFatigue = (self?.fatigueCount ?? 0) + 1;
  const opponentNextFatigue = (opponent?.fatigueCount ?? 0) + 1;
  const instanceById = React.useMemo(() => new Map((match?.cardInstances || []).map((item) => [item.id, item])), [match]);
  const virtualSelf = React.useMemo(() => match ? applyVirtualSelfState(match, actions) : { hand: [], board: [], pendingIds: new Set<string>() }, [actions, match]);
  const selectedColumn = selection?.source === 'board' ? selection.position.column : null;
  const pixiCardPositions = React.useMemo(() => {
    if (!match) return {};
    const byId: Record<string, PixiCardPosition> = {};
    for (const player of match.players) {
      const boardState = player.seatNo === selfSeat ? virtualSelf.board : player.boardState;
      for (const slot of boardState || []) {
        byId[slot.cardInstanceId] = {
          ownerSeatNo: player.seatNo,
          position: { ...slot.position }
        };
      }
    }
    for (const instance of match.cardInstances) {
      if (!byId[instance.id] && instance.position && instance.zone === 'board') {
        byId[instance.id] = {
          ownerSeatNo: instance.ownerSeatNo,
          position: { ...instance.position }
        };
      }
    }
    return byId;
  }, [match, selfSeat, virtualSelf.board]);
  const combatCue = React.useMemo(
    () => buildCombatCue(replayEvents, pixiCardPositions, selfSeat),
    [pixiCardPositions, replayEvents, selfSeat]
  );
  const spentCost = actions.reduce((sum, action) => {
    if (action.type === 'move') return sum + 1;
    if (action.type === 'place') return sum + Number(instanceById.get(action.cardInstanceId)?.card?.cost || 0);
    if (action.type === 'replace') return sum + Number(instanceById.get(action.handCardInstanceId)?.card?.cost || 0);
    return sum;
  }, 0);
  const costCap = availableCost(match?.turnNo || 1);
  const timeLeft = Math.max(0, 40 - Math.floor((now - turnLoadedAt) / 1000));
  const canPlan = mode === 'match' && match?.status === 'turn_planning';
  const canMulligan = mode === 'match' && match?.status === 'mulligan';

  const addAction = (nextAction: ArenaV2TurnActionDto) => {
    if (!match || !canPlan) return;
    const nextCost = spentCost
      + (nextAction.type === 'move' ? 1 : nextAction.type === 'place' ? Number(instanceById.get(nextAction.cardInstanceId)?.card?.cost || 0) : nextAction.type === 'replace' ? Number(instanceById.get(nextAction.handCardInstanceId)?.card?.cost || 0) : 0);
    if (nextCost > costCap) {
      setNotice('사용 가능한 코스트를 초과합니다.');
      return;
    }
    setActions((current) => [...current, nextAction]);
    setSelection(null);
    setNotice('');
  };

  const onSelfSlotClick = (position: ArenaV2BoardPositionDto, instance?: CardInstance) => {
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
    } catch (error: any) {
      setNotice(error?.message || '멀리건 제출에 실패했습니다.');
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
    } catch (error: any) {
      setNotice(error?.message || '행동 제출에 실패했습니다.');
    }
  };

  const openEmoteWheel = (event: React.MouseEvent<HTMLElement>) => {
    if (mode !== 'match' || !match || !emoteSlots.some(Boolean)) return;
    event.preventDefault();
    const target = battlefieldRef.current;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const ratioX = clamp01((event.clientX - rect.left) / rect.width);
    const ratioY = clamp01((event.clientY - rect.top) / rect.height);
    setEmoteWheel({
      x: Math.max(116, Math.min(rect.width - 116, event.clientX - rect.left)),
      y: Math.max(116, Math.min(rect.height - 116, event.clientY - rect.top)),
      ratioX,
      ratioY
    });
  };

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
    } catch (error: any) {
      setNotice(error?.message || '이모트를 사용할 수 없습니다.');
    }
  };

  const renderBoard = (seatNo: number, interactive: boolean) => {
    const player = seatNo === selfSeat
      ? { boardState: virtualSelf.board }
      : match?.players.find((item) => item.seatNo === seatNo);
    const boardMap = new Map((player?.boardState || []).map((slot) => [positionKey(slot.position), slot]));
    const positions = seatNo === selfSeat ? selfBoardPositions : opponentBoardPositions;
    return (
      <div className={`arena-v2-board ${interactive ? 'is-interactive' : ''}`}>
        {positions.map((position) => {
          const slot = boardMap.get(positionKey(position));
          const instance = slot ? instanceById.get(slot.cardInstanceId) : undefined;
          const selected = selection?.source === 'board' && selection.id === instance?.id;
          const pending = instance ? virtualSelf.pendingIds.has(instance.id) : false;
          return (
            <div
              key={`${seatNo}-${position.row}-${position.column}`}
              role="button"
              tabIndex={0}
              className={`arena-v2-slot ${instance ? 'has-card' : ''} ${interactive ? 'can-drop' : ''} ${selected ? 'is-selected' : ''} ${pending ? 'is-pending' : ''} ${instance && combatCue.cardCues[instance.id]?.role === 'target' ? 'is-combat-target-slot' : ''}`}
              onClick={() => interactive ? onSelfSlotClick(position, instance) : instance && setSelection({ source: 'board', id: instance.id, position })}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  if (interactive) onSelfSlotClick(position, instance);
                  else if (instance) setSelection({ source: 'board', id: instance.id, position });
                }
              }}
              aria-label={`${seatNo === selfSeat ? '내' : '상대'} ${positionLabel(position)}`}
            >
              <span className="arena-v2-slot-label">{positionLabel(position)}</span>
              <MiniCard instance={instance} selected={selected} pending={pending} combatCue={instance ? combatCue.cardCues[instance.id] : undefined} onClick={() => interactive ? onSelfSlotClick(position, instance) : instance && setSelection({ source: 'board', id: instance.id, position })} />
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
      : match ? `${matchModeLabel(match.mode)} · ${matchStatusLabel(match.status)} · 턴 ${match.turnNo}` : loading ? '경기를 불러오는 중' : '경기를 선택해 주세요.';

  return (
    <ArenaLayout activeTab="play" onTabChange={(tab) => moveArenaSection(router, tab)} immersive>
      <div className={`arena-v2-shell arena-v2-battle-shell ${styles.arenaV2Scope}`}>
        <section className="arena-v2-topbar arena-v2-battle-topbar">
          <div className="arena-v2-battle-brand min-w-0">
            <p className="arena-v2-kicker">CHIKAPO ARENA</p>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <div className="arena-v2-scoreboard" aria-label="전투 점수판">
            <div className="arena-v2-score-card is-opponent">
              <span>상대 HP</span>
              <strong>{opponent?.playerHealth ?? 30}</strong>
            </div>
            <div className="arena-v2-score-core">
              <span>TURN {match?.turnNo ?? 1}</span>
              <strong>{timeLeft}</strong>
              <span>SECONDS</span>
            </div>
            <div className="arena-v2-score-card is-self">
              <span>내 HP</span>
              <strong>{self?.playerHealth ?? 30}</strong>
            </div>
          </div>
          <div className="arena-v2-top-actions">
            <button type="button" className="arena-v2-icon-button" onClick={loadMatch} aria-label="매치 새로고침">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            {canMulligan ? (
              <button type="button" className="arena-v2-primary-button" onClick={submitMulligan}>
                <Hand className="h-4 w-4" /> 멀리건 제출
              </button>
            ) : mode === 'match' ? (
              <button type="button" className="arena-v2-primary-button" onClick={submitActions} disabled={!canPlan}>
                <Send className="h-4 w-4" /> 행동 제출
              </button>
            ) : (
              <button type="button" className="arena-v2-primary-button" onClick={() => router.push('/arena')}>
                <Check className="h-4 w-4" /> 아레나 홈
              </button>
            )}
          </div>
        </section>

        {notice ? <div className="arena-v2-notice"><AlertTriangle className="h-4 w-4" />{notice}</div> : null}

        <section className="arena-v2-mobile-hud" aria-label="모바일 전투 요약">
          <span><Shield className="h-3.5 w-3.5" /> 나 {self?.playerHealth ?? 30}</span>
          <span><Shield className="h-3.5 w-3.5" /> 상대 {opponent?.playerHealth ?? 30}</span>
          <span><FileClock className="h-3.5 w-3.5" /> 피로 {selfNextFatigue}</span>
          <span><Zap className="h-3.5 w-3.5" /> {spentCost}/{costCap}</span>
          <span><Clock3 className="h-3.5 w-3.5" /> {timeLeft}초</span>
        </section>

        <section className="arena-v2-stage arena-v2-match-stage arena-v2-battle-grid">
          <aside className="arena-v2-phase-rail arena-v2-side-ledger">
            {[
              [Move, '이동', '1코스트 · 1회'],
              [Plus, '배치', '빈 칸 소환'],
              [RotateCcw, '교체', '기존 카드 대체'],
              [FileClock, '전투 기록', '최근 장면']
            ].map(([Icon, label, hint], index) => (
              <div key={String(label)} className={`arena-v2-phase ${index === 1 && canPlan ? 'is-active' : ''}`}>
                {React.createElement(Icon as typeof Move, { className: 'h-4 w-4' })}
                <strong>{String(label)}</strong>
                <span>{String(hint)}</span>
              </div>
            ))}
          </aside>

          <div
            ref={battlefieldRef}
            key={`combat-${combatCue.event?.seq || 'idle'}-${animationReplayKey}`}
            className={`arena-v2-board-wrap arena-v2-battlefield ${combatCue.event ? 'has-combat-cue' : ''}`}
            onContextMenu={openEmoteWheel}
          >
            <PixiBattleLayer activeColumn={selectedColumn} events={replayEvents} cardPositions={pixiCardPositions} selfSeatNo={selfSeat} />
            <ArenaEmoteBurstLayer events={activeEmotes} />
            <ArenaEmoteWheelMenu wheel={emoteWheel} slots={emoteSlots} onPick={sendEmote} onClose={() => setEmoteWheel(null)} />
            <div className="arena-v2-player-strip is-opponent">
              <div><span>상대</span><strong>{match?.mode === 'bot' ? '연습 상대' : `자리 ${opponentSeat + 1}`}</strong></div>
              <div className="arena-v2-resource"><Shield className="h-4 w-4" /> {opponent?.playerHealth ?? 30}</div>
              <div className="arena-v2-resource"><Hand className="h-4 w-4" /> 손 {opponent?.handCount ?? 0}</div>
              <div className="arena-v2-resource"><Hand className="h-4 w-4" /> 덱 {opponent?.deckCount ?? 0}</div>
              <div className="arena-v2-resource"><FileClock className="h-4 w-4" /> 피로 {opponentNextFatigue}</div>
            </div>
            {match ? renderBoard(opponentSeat, false) : null}
            <div className="arena-v2-lane-divider"><span>전열이 먼저 맞붙고 후열이 뒤이어 압박합니다</span></div>
            {match ? renderBoard(selfSeat, canPlan) : null}
            <div className="arena-v2-player-strip">
              <div><span>나</span><strong>자리 {selfSeat + 1}</strong></div>
              <div className="arena-v2-resource"><Shield className="h-4 w-4" /> {self?.playerHealth ?? 30}</div>
              <div className="arena-v2-resource"><Hand className="h-4 w-4" /> 덱 {self?.deckCount ?? 0}</div>
              <div className="arena-v2-resource"><FileClock className="h-4 w-4" /> 피로 {selfNextFatigue}</div>
            </div>
          </div>

          <aside className="arena-v2-command-panel arena-v2-command-console">
            <div className="arena-v2-stat arena-v2-accent-cyan"><Eye className="h-4 w-4" /><span>상태</span><strong>{matchStatusLabel(match?.status)}</strong></div>
            <div className="arena-v2-stat arena-v2-accent-gold"><Zap className="h-4 w-4" /><span>코스트</span><strong>{spentCost} / {costCap}</strong></div>
            <div className="arena-v2-stat arena-v2-accent-green"><Clock3 className="h-4 w-4" /><span>턴 제한</span><strong>{timeLeft}초</strong></div>
            <div className="arena-v2-panel-section">
              <span className="arena-v2-panel-label">행동 순서</span>
              <div className="arena-v2-action-stack">
                {actions.length ? actions.map((action, index) => (
                  <button type="button" key={`${action.type}-${index}`} onClick={() => setActions((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                    <span>{index + 1}</span>{actionLabel(action)}<Trash2 className="h-3.5 w-3.5" />
                  </button>
                )) : <p>{canMulligan ? '교체할 손패를 최대 3장 선택합니다.' : '손패 또는 내 필드 카드를 선택한 뒤 슬롯을 누릅니다.'}</p>}
              </div>
            </div>
            <div className="arena-v2-panel-section">
              <span className="arena-v2-panel-label">최근 장면</span>
              <div className="arena-v2-replay-list">
                {replayEvents.length ? (
                  <button type="button" onClick={() => setAnimationReplayKey((value) => value + 1)}>
                    <Play className="h-3.5 w-3.5" />연출 재생
                  </button>
                ) : null}
                {replayEvents.length ? replayEvents.map((event) => (
                  <span key={`${event.seq}-${event.eventType}`}><Play className="h-3.5 w-3.5" />T{event.turnNo} · {eventLabel(event.eventType)}</span>
                )) : <p>아직 기록된 이벤트가 없습니다.</p>}
              </div>
            </div>
          </aside>
        </section>

        <section className="arena-v2-hand-rail arena-v2-bottom-hand">
          <div className="arena-v2-hand-header">
            <div>
              <p className="arena-v2-kicker">{canMulligan ? 'MULLIGAN' : 'HAND'}</p>
              <h3>{canMulligan ? '시작 손패 교체' : '손패와 제출 대기 행동'}</h3>
              <span>{canMulligan ? `${mulliganIds.length} / 3 선택` : `덱 ${self?.deckCount ?? 0}장 · 무덤 ${self?.graveyardCardInstanceIds.length ?? 0}장`}</span>
            </div>
            <button type="button" className="arena-v2-secondary-button" onClick={() => { setActions([]); setSelection(null); }}>
              <Lock className="h-4 w-4" /> 선택 초기화
            </button>
          </div>
          <div className="arena-v2-card-row is-hand">
            {hand.length ? hand.map((instance) => {
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
      </div>
    </ArenaLayout>
  );
};
