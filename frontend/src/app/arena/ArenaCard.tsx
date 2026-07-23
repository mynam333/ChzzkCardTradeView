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
import { resolveArenaAssetUrl } from '@/lib/arenaAssets';
import {
  arenaCardClassDefinitions,
  getArenaCardKeywordDefinition,
  getArenaCardKeywordVariant,
  type ArenaCardKeywordSelection
} from '@/lib/arenaCardEditor';
import {
  getArenaClassTooltip,
  getArenaCostTooltip,
  getArenaKeywordTooltip,
  getArenaStatTooltip,
  type ArenaTooltipData
} from '@/lib/arenaTooltips';
import { ArenaTooltip } from './ArenaTooltip';
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
  direct_pressure: '직접 압박',
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
  selection: ArenaCardKeywordSelection;
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
    icon: keywordIconFor(type),
    selection
  };
};

export const resolveArenaCardArtUrl = resolveArenaAssetUrl;

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
  const hiddenKeywords = normalizedKeywords.slice(visibleKeywords.length);
  const hiddenKeywordCount = Math.max(0, normalizedKeywords.length - visibleKeywords.length);
  const keywordSummary = normalizedKeywords.length
    ? normalizedKeywords.map((keyword) => keyword.label).join(', ')
    : '특수 효과 없음';
  const accessibleLabel = `${displayName}, ${meta.label} 클래스, 비용 ${cost}, 공격력 ${attack}, 체력 ${health}, 효과 ${keywordSummary}`;
  const cardSummaryTooltip: ArenaTooltipData = {
    eyebrow: '아레나 카드',
    title: displayName,
    description: normalizedKeywords.length
      ? `이 카드의 효과는 ${keywordSummary}입니다. 효과 이름에 커서를 올리면 발동 시점과 대상을 확인할 수 있습니다.`
      : '별도 키워드 없이 능력치와 클래스 패시브로 전투하는 기본 카드입니다.',
    details: [
      { label: '클래스', value: meta.label },
      { label: '코스트', value: `${cost}` },
      { label: '공격 / 체력', value: `${attack} / ${health}` },
      ...(damageTaken > 0 ? [{ label: '누적 피해', value: `${damageTaken}` }] : [])
    ],
    note: `클래스 패시브 · ${meta.passive}`,
    tone: meta.accent
  };
  const hiddenKeywordTooltip: ArenaTooltipData = {
    eyebrow: '추가 카드 효과',
    title: `숨겨진 효과 ${hiddenKeywordCount}개`,
    description: hiddenKeywords.length
      ? `카드 공간에 표시되지 않은 ${hiddenKeywords.map((keyword) => keyword.label).join(', ')} 효과가 함께 적용됩니다.`
      : '추가로 숨겨진 효과가 없습니다.',
    details: hiddenKeywords.map((keyword) => ({
      label: keyword.label,
      value: getArenaKeywordTooltip(keyword.selection).description
    })),
    note: '카드 전체 효과는 이름 영역의 카드 상세 툴팁에서도 한 번에 확인할 수 있습니다.',
    tone: meta.accent
  };
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
        <ArenaTooltip data={cardSummaryTooltip} disabled={disableTooltip}>
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
        </ArenaTooltip>

        <span className={styles.topFrame}>
          <ArenaTooltip data={getArenaCostTooltip(cost)} disabled={disableTooltip}>
            <span className={styles.cost}>
              <small>COST</small>
              <b>{cost}</b>
            </span>
          </ArenaTooltip>
          <span className={styles.topBridge} />
          <ArenaTooltip data={getArenaClassTooltip(cardClass)} disabled={disableTooltip}>
            <span className={styles.role}>
              <ClassIcon />
              <b>{meta.shortLabel}</b>
            </span>
          </ArenaTooltip>
        </span>

        {damageTaken > 0 ? <span className={styles.damage}>피해 {damageTaken}</span> : null}

        <span className={styles.infoFrame}>
          <ArenaTooltip data={cardSummaryTooltip} disabled={disableTooltip}>
            <span className={styles.nameplate}>{displayName}</span>
          </ArenaTooltip>
          <span className={styles.keywords}>
            {visibleKeywords.length ? visibleKeywords.map((keyword, index) => {
              const KeywordIcon = keyword.icon;
              const isLastVisible = index === visibleKeywords.length - 1;
              return (
                <span className={styles.keywordRow} key={keyword.key}>
                  <ArenaTooltip data={getArenaKeywordTooltip(keyword.selection)} disabled={disableTooltip}>
                    <span className={styles.keywordMain}>
                      <KeywordIcon />
                      <b>{keyword.label}</b>
                    </span>
                  </ArenaTooltip>
                  {isLastVisible && hiddenKeywordCount > 0 ? (
                    <ArenaTooltip data={hiddenKeywordTooltip} disabled={disableTooltip}>
                      <em>+{hiddenKeywordCount}</em>
                    </ArenaTooltip>
                  ) : null}
                </span>
              );
            }) : (
              <ArenaTooltip data={{
                eyebrow: '카드 효과',
                title: '기본 카드',
                description: '별도 키워드 없이 공격력, 체력과 클래스 패시브만 적용되는 카드입니다.',
                note: `클래스 패시브 · ${meta.passive}`,
                tone: meta.accent
              }} disabled={disableTooltip}>
                <span className={`${styles.keywordRow} ${styles.basicKeyword}`}>
                  <span className={styles.keywordMain}><Sparkles /><b>기본 카드</b></span>
                </span>
              </ArenaTooltip>
            )}
          </span>
          <span className={styles.footerFrame}>
            <ArenaTooltip data={getArenaStatTooltip('attack', attack)} disabled={disableTooltip}>
              <span className={`${styles.stat} ${styles.attack}`}>
                <Swords />
                <span><small>공격</small><b>{attack}</b></span>
              </span>
            </ArenaTooltip>
            <span className={styles.brandMark}>
              <Sparkles />
              <small>CHIKAPO<br />ARENA</small>
            </span>
            <ArenaTooltip data={getArenaStatTooltip('health', health)} disabled={disableTooltip}>
              <span className={`${styles.stat} ${styles.health}`}>
                <HeartPulse />
                <span><small>체력</small><b>{health}</b></span>
              </span>
            </ArenaTooltip>
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
      data-compact={compact || undefined}
      data-combat-seq={combatSequence}
    >
      {content}
    </div>
  );
};
