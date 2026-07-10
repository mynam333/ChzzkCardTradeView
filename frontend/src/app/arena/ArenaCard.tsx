import React from 'react';
import {
  Check,
  Crown,
  Gauge,
  HeartPulse,
  Shield,
  Sparkles,
  Swords,
  Target,
  Zap,
  type LucideIcon
} from 'lucide-react';
import { API_BASE_URL } from '@/lib/api';
import {
  arenaCardClassDefinitions,
  getArenaCardKeywordDefinition,
  getArenaCardKeywordVariant,
  type ArenaCardKeywordSelection
} from '@/lib/arenaCardEditor';
import styles from './ArenaCard.module.css';

export type ArenaCardAccent = 'coral' | 'green' | 'violet' | 'cyan';

export type ArenaCardClassMeta = {
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  accent: ArenaCardAccent;
  hint: string;
  passive: string;
};

const canonicalClassByAlias: Record<string, keyof typeof arenaCardClassDefinitions> = {
  charge: 'charge',
  guardian: 'guardian',
  sniper: 'sniper',
  support: 'support',
  trick: 'trick',
  specter: 'specter',
  tech: 'tech',
  attack: 'charge',
  tempo: 'tech',
  guard: 'guardian',
  heal: 'support',
  control: 'trick',
  ultimate: 'specter'
};

const classVisuals: Record<keyof typeof arenaCardClassDefinitions, { icon: LucideIcon; accent: ArenaCardAccent }> = {
  charge: { icon: Swords, accent: 'coral' },
  guardian: { icon: Shield, accent: 'green' },
  sniper: { icon: Target, accent: 'violet' },
  support: { icon: Sparkles, accent: 'green' },
  trick: { icon: Zap, accent: 'violet' },
  specter: { icon: Crown, accent: 'violet' },
  tech: { icon: Gauge, accent: 'cyan' }
};

export const arenaCardClassMeta = Object.fromEntries(
  Object.entries(canonicalClassByAlias).map(([alias, canonical]) => {
    const definition = arenaCardClassDefinitions[canonical];
    const visual = classVisuals[canonical];
    return [alias, {
      label: definition.label,
      shortLabel: definition.label,
      icon: visual.icon,
      accent: visual.accent,
      hint: definition.description,
      passive: definition.passive
    } satisfies ArenaCardClassMeta];
  })
) as Record<string, ArenaCardClassMeta>;

const fallbackClassMeta = arenaCardClassMeta.tech;

const legacyKeywordLabels: Record<string, string> = {
  rush: '돌진',
  direct_pressure: '직격 압박',
  deathrattle: '유언',
  draw: '드로우',
  snipe: '조준',
  guard: '수호',
  burn: '화상',
  freeze: '빙결',
  stealth: '은신',
  drain: '흡혈',
  splash: '광역',
  cleave: '연격',
  boost: '강화',
  debuff: '약화',
  buff: '버프',
  summon: '소환',
  spirit: '원혼',
  haunt: '원혼',
  residue: '잔재',
  graveyard_recover: '묘지 회수',
  graveyardrecover: '묘지 회수',
  discard: '폐기',
  copy: '복제',
  discover: '발견'
};

const keywordTokenLabels: Record<string, string> = {
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

export type ArenaCardKeyword = string | ArenaCardKeywordSelection;

type ArenaCardKeywordDisplay = {
  key: string;
  type: string;
  label: string;
  icon: LucideIcon;
};

export const getArenaCardClassMeta = (cardClass?: string | null) => {
  const canonical = canonicalClassByAlias[String(cardClass || '').toLowerCase()] || 'tech';
  return arenaCardClassMeta[canonical] || fallbackClassMeta;
};

const formatUnknownKeyword = (raw: string) => raw
  .split(/[_\s-]+/)
  .filter(Boolean)
  .map((token) => keywordTokenLabels[token.toLowerCase()] || token)
  .join(' ');

export const formatArenaCardKeyword = (keyword?: string | null) => {
  const raw = String(keyword || '').trim();
  if (!raw || raw.toLowerCase() === 'preview') return '';
  const normalized = raw.toLowerCase();
  return getArenaCardKeywordDefinition(normalized)?.label
    || legacyKeywordLabels[normalized]
    || formatUnknownKeyword(raw);
};

const keywordIconFor = (type: string): LucideIcon => {
  if (['aim', 'weakpoint', 'backline_pressure', 'direct_pressure', 'pursuit'].includes(type)) return Target;
  if (['shield', 'guard_support', 'taunt', 'damage_reduction', 'counter'].includes(type)) return Shield;
  if (['emergency_heal', 'lifesteal', 'revive'].includes(type)) return HeartPulse;
  if (['pierce', 'aoe_damage', 'attack_support', 'vengeance', 'grudge'].includes(type)) return Swords;
  return Sparkles;
};

const formatKeywordDisplay = (keyword: ArenaCardKeyword, index: number): ArenaCardKeywordDisplay | null => {
  const selection = typeof keyword === 'string' ? { type: keyword } : keyword;
  const type = String(selection?.type || '').trim().toLowerCase();
  if (!type || type === 'preview') return null;
  const definition = getArenaCardKeywordDefinition(type);
  const variant = definition ? getArenaCardKeywordVariant(selection) : null;
  const baseLabel = definition?.label || formatArenaCardKeyword(type);
  let label = baseLabel;
  if (variant && variant.label !== '기본') {
    label = variant.label.includes(baseLabel) ? variant.label : `${baseLabel} · ${variant.label}`;
  }
  return {
    key: `${type}-${selection.value ?? selection.limit ?? index}`,
    type,
    label,
    icon: keywordIconFor(type)
  };
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

export const resolveArenaCardArtUrl = (value?: string | null) => {
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

export type ArenaCardProps = {
  displayName: string;
  cardClass?: string | null;
  cost: number;
  attack: number;
  health: number;
  keywords?: ArenaCardKeyword[];
  artAssetId?: string | null;
  selected?: boolean;
  compact?: boolean;
  pending?: boolean;
  damageTaken?: number;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  className?: string;
  style?: React.CSSProperties;
  disableTooltip?: boolean;
  combatDamage?: number;
  combatSequence?: number;
};

export const ArenaCard: React.FC<ArenaCardProps> = ({
  displayName,
  cardClass,
  cost,
  attack,
  health,
  keywords = [],
  artAssetId,
  selected,
  compact = false,
  pending = false,
  damageTaken = 0,
  onClick,
  className = '',
  style,
  disableTooltip = false,
  combatDamage,
  combatSequence
}) => {
  const meta = getArenaCardClassMeta(cardClass);
  const ClassIcon = meta.icon;
  const artUrl = resolveArenaCardArtUrl(artAssetId);
  const [failedArtUrl, setFailedArtUrl] = React.useState<string | null>(null);
  const showArt = Boolean(artUrl && failedArtUrl !== artUrl);
  const initial = displayName.trim().slice(0, 1) || 'A';
  const normalizedKeywords = keywords.flatMap((keyword, index) => {
    const formatted = formatKeywordDisplay(keyword, index);
    return formatted ? [formatted] : [];
  });
  const visibleKeywords = normalizedKeywords.slice(0, 2);
  const hiddenKeywordCount = Math.max(0, normalizedKeywords.length - visibleKeywords.length);
  const keywordSummary = normalizedKeywords.length
    ? normalizedKeywords.map((keyword) => keyword.label).join(', ')
    : '특수 효과 없음';
  const accessibleLabel = `${displayName}, ${meta.label} 클래스, 비용 ${cost}, 공격력 ${attack}, 체력 ${health}, 효과 ${keywordSummary}`;
  const tooltip = `${displayName}\n클래스: ${meta.label}\n비용: ${cost}\n효과: ${keywordSummary}${damageTaken > 0 ? `\n받은 피해: ${damageTaken}` : ''}\n공격력: ${attack}\n체력: ${health}`;
  const accentClass = styles[`accent${meta.accent[0].toUpperCase()}${meta.accent.slice(1)}`];
  const cardClassName = [
    styles.card,
    accentClass,
    'arena-v2-card',
    selected ? styles.selected : '',
    pending ? styles.pending : '',
    damageTaken > 0 ? styles.damaged : '',
    className
  ].filter(Boolean).join(' ');

  const content = (
    <>
      <span className={styles.shell} aria-hidden="true">
        <span className={styles.art}>
          {showArt ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={artUrl}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setFailedArtUrl(artUrl)}
            />
          ) : (
            <span className={styles.artFallback}>
              <span className={styles.artOrbit} />
              <b>{initial}</b>
              <small>{meta.label}</small>
            </span>
          )}
        </span>

        <span className={styles.topFrame}>
          <span className={styles.cost}>
            <small>COST</small>
            <b>{cost}</b>
          </span>
          <span className={styles.topBridge} />
          <span className={styles.role} title={`${meta.label} · ${meta.hint}`}>
            <ClassIcon />
            <b>{meta.shortLabel}</b>
          </span>
        </span>

        {damageTaken > 0 ? <span className={styles.damage}>피해 {damageTaken}</span> : null}

        <span className={styles.infoFrame}>
          <span className={styles.nameplate} title={displayName}>{displayName}</span>
          <span className={styles.keywords}>
            {visibleKeywords.length ? visibleKeywords.map((keyword, index) => {
              const KeywordIcon = keyword.icon;
              const isLastVisible = index === visibleKeywords.length - 1;
              return (
                <span className={styles.keywordRow} key={keyword.key} title={keyword.label}>
                  <KeywordIcon />
                  <b>{keyword.label}</b>
                  {isLastVisible && hiddenKeywordCount > 0 ? <em>+{hiddenKeywordCount}</em> : null}
                </span>
              );
            }) : (
              <span className={`${styles.keywordRow} ${styles.basicKeyword}`}>
                <Sparkles />
                <b>기본 카드</b>
              </span>
            )}
          </span>
          <span className={styles.footerFrame}>
            <span className={`${styles.stat} ${styles.attack}`}>
              <Swords />
              <span><small>공격</small><b>{attack}</b></span>
            </span>
            <span className={styles.brandMark}>
              <Sparkles />
              <small>CHIKAPO<br />ARENA</small>
            </span>
            <span className={`${styles.stat} ${styles.health}`}>
              <HeartPulse />
              <span><small>체력</small><b>{health}</b></span>
            </span>
          </span>
        </span>
      </span>

      {selected ? <span className={styles.selectedMark}><Check /></span> : null}
      {pending ? <span className={styles.stateOverlay}>처리 중</span> : null}
      {combatDamage ? <span className={styles.combatDamage}>-{combatDamage}</span> : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={cardClassName}
        style={style}
        onClick={onClick}
        disabled={pending}
        aria-pressed={selected}
        aria-busy={pending || undefined}
        aria-label={accessibleLabel}
        data-card-tooltip={disableTooltip ? undefined : tooltip}
        data-compact={compact || undefined}
        data-combat-seq={combatSequence}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={cardClassName}
      style={style}
      role="group"
      aria-label={accessibleLabel}
      data-card-tooltip={disableTooltip ? undefined : tooltip}
      data-compact={compact || undefined}
      data-combat-seq={combatSequence}
    >
      {content}
    </div>
  );
};
