import { createHash } from 'crypto';
import { Streamer } from '../repositories/interfaces';
import { getArenaAdminControlConfigSync } from './arenaAdminControlService';

export type ArenaClassId =
  | 'guardian'
  | 'duelist'
  | 'arcanist'
  | 'ranger'
  | 'trickster'
  | 'supporter'
  | 'breaker'
  | 'tempoist';

export type ArenaCardStatKey = 'hp' | 'attack' | 'defense' | 'speed' | 'focus';

export interface ArenaClassDefinition {
  id: ArenaClassId;
  name: string;
  role: 'frontline' | 'damage' | 'control' | 'support' | 'tempo';
  description: string;
}

export interface ArenaSkillDefinition {
  id: string;
  name: string;
  type: 'active' | 'passive' | 'ultimate';
  tags: string[];
  description: string;
}

export interface ArenaGeneratedCard {
  card_id: string;
  channel_id: string;
  name: string;
  image_url: string | null;
  flavor_text: string | null;
  arena_enabled: boolean;
  source: 'streamer';
  class: ArenaClassDefinition;
  stats: Record<ArenaCardStatKey, number>;
  skills: ArenaSkillDefinition[];
  tags: string[];
  template_id: string;
  ability_seed: string;
  config_source: 'deterministic_template' | 'streamer_config';
  policy: {
    combat_uses_market_data: false;
    combat_uses_live_data: false;
    combat_uses_follower_data: false;
    cosmetic_only_fields: string[];
  };
}

export interface ArenaCardGenerationOptions {
  arenaEnabled?: boolean;
  maskDisabled?: boolean;
  config?: ArenaCardConfig | null;
}

export type ArenaCombatStyleId = 'balanced' | 'aggressive' | 'guard' | 'tempo' | 'counter' | 'finisher';

export interface ArenaConfigOptionDefinition<T extends string = string> {
  id: T;
  name: string;
  description: string;
}

export interface ArenaCardConfig {
  class_id?: ArenaClassId;
  stat_focus?: ArenaCardStatKey;
  combat_style?: ArenaCombatStyleId;
  skill_ids?: string[];
  tag_ids?: string[];
  flavor_text?: string;
}

export interface ArenaCardConfigOptions {
  classes: ArenaClassDefinition[];
  stat_focuses: ArenaConfigOptionDefinition<ArenaCardStatKey>[];
  combat_styles: ArenaConfigOptionDefinition<ArenaCombatStyleId>[];
  skills_by_class: Record<ArenaClassId, ArenaSkillDefinition[]>;
  tag_options: string[];
  limits: {
    skill_ids: number;
    tag_ids: number;
    flavor_text_length: number;
  };
  balance_policy: {
    fixed_stat_budget: number;
    direct_numeric_stat_editing: false;
    combat_uses_external_value: false;
  };
}

export const ARENA_CLASSES: ArenaClassDefinition[] = [
  { id: 'guardian', name: '가디언', role: 'frontline', description: '전열에서 피해를 나누어 받고 라운드 후반까지 버티는 방어형 클래스' },
  { id: 'duelist', name: '듀얼리스트', role: 'damage', description: '단일 대상을 빠르게 압박해 5판 3선승 흐름을 흔드는 공격형 클래스' },
  { id: 'arcanist', name: '아르카니스트', role: 'control', description: '상태 이상과 집중 자원으로 전투 템포를 제어하는 기술형 클래스' },
  { id: 'ranger', name: '레인저', role: 'damage', description: '후열에서 안정적인 누적 피해를 만들고 표식을 활용하는 원거리 클래스' },
  { id: 'trickster', name: '트릭스터', role: 'tempo', description: '회피, 복제, 교란 효과로 예측을 어렵게 만드는 변수 창출 클래스' },
  { id: 'supporter', name: '서포터', role: 'support', description: '보호막, 회복, 버프를 통해 덱의 컨셉을 완성하는 지원 클래스' },
  { id: 'breaker', name: '브레이커', role: 'control', description: '보호막과 방어 태세를 깨고 전열 돌파를 담당하는 클래스' },
  { id: 'tempoist', name: '템포이스트', role: 'tempo', description: '행동 순서와 쿨다운을 조작해 짧은 전투의 주도권을 잡는 클래스' }
];

export const ARENA_STAT_FOCUSES: ArenaConfigOptionDefinition<ArenaCardStatKey>[] = [
  { id: 'hp', name: '생존력', description: '라운드를 오래 버티며 후반 플랜을 열어두는 방향' },
  { id: 'attack', name: '공격력', description: '짧은 교전에서 주도권을 잡는 방향' },
  { id: 'defense', name: '방어력', description: '전열 압박과 집중 공격을 받아내는 방향' },
  { id: 'speed', name: '속도', description: '먼저 행동하고 템포를 가져오는 방향' },
  { id: 'focus', name: '집중', description: '스킬 흐름과 변수 창출을 안정화하는 방향' }
];

export const ARENA_COMBAT_STYLES: ArenaConfigOptionDefinition<ArenaCombatStyleId>[] = [
  { id: 'balanced', name: '밸런스', description: '안정적인 평균값으로 어떤 덱에도 섞기 쉬운 성향' },
  { id: 'aggressive', name: '공세', description: '공격과 속도를 살려 초반 압박을 노리는 성향' },
  { id: 'guard', name: '수비', description: '체력과 방어를 살려 팀의 중심을 잡는 성향' },
  { id: 'tempo', name: '템포', description: '속도와 집중을 살려 라운드 흐름을 바꾸는 성향' },
  { id: 'counter', name: '역습', description: '방어 후 반격과 변수 대응을 노리는 성향' },
  { id: 'finisher', name: '마무리', description: '후반 결정력과 처치 관여를 노리는 성향' }
];

export const ARENA_SKILLS: ArenaSkillDefinition[] = [
  { id: 'aegis-pop', name: '방울 방패', type: 'active', tags: ['shield', 'frontline'], description: '가장 피해를 많이 받은 아군에게 짧은 보호막을 부여합니다.' },
  { id: 'soft-taunt', name: '말랑 도발', type: 'passive', tags: ['guard', 'redirect'], description: '첫 교전에서 자신이 받는 피해 일부를 줄이고 전열 대상 확률을 높입니다.' },
  { id: 'last-cookie', name: '마지막 쿠키', type: 'ultimate', tags: ['survive', 'heal'], description: '체력이 낮을 때 1회 회복하고 방어력을 잠시 올립니다.' },
  { id: 'ribbon-wall', name: '리본 장벽', type: 'active', tags: ['shield', 'team'], description: '전열 아군에게 작은 보호막을 나누어 부여합니다.' },
  { id: 'sturdy-promise', name: '든든한 약속', type: 'passive', tags: ['guard', 'late'], description: '라운드 후반에 방어 효율이 소폭 증가합니다.' },
  { id: 'neon-sting', name: '네온 찌르기', type: 'active', tags: ['burst', 'single'], description: '표식이 있는 적에게 추가 피해를 주는 빠른 공격입니다.' },
  { id: 'rivalry', name: '라이벌 선언', type: 'passive', tags: ['duel', 'focus'], description: '매 라운드 첫 공격 대상에게 집중 표식을 남깁니다.' },
  { id: 'clutch-cut', name: '클러치 컷', type: 'ultimate', tags: ['execute', 'burst'], description: '체력이 낮은 적에게 강한 마무리 피해를 줍니다.' },
  { id: 'pink-rush', name: '핑크 러시', type: 'active', tags: ['burst', 'tempo'], description: '짧은 시간 공격 템포를 끌어올립니다.' },
  { id: 'one-more-hit', name: '한 번 더', type: 'passive', tags: ['duel', 'chain'], description: '처치 관여 후 다음 공격의 피해가 소폭 증가합니다.' },
  { id: 'star-orbit', name: '별빛 궤도', type: 'active', tags: ['magic', 'area'], description: '무작위 적 둘에게 작은 마법 피해와 집중 감소를 적용합니다.' },
  { id: 'focus-lens', name: '집중 렌즈', type: 'passive', tags: ['focus', 'scale'], description: '스킬 사용 후 다음 기본 공격의 명중 안정성이 증가합니다.' },
  { id: 'quiet-comet', name: '고요한 혜성', type: 'ultimate', tags: ['magic', 'delay'], description: '짧은 지연 후 가장 약한 적에게 큰 마법 피해를 줍니다.' },
  { id: 'puzzle-spark', name: '퍼즐 스파크', type: 'active', tags: ['magic', 'control'], description: '적 하나의 행동 흐름을 짧게 늦춥니다.' },
  { id: 'mana-ribbon', name: '마나 리본', type: 'passive', tags: ['focus', 'resource'], description: '스킬 사용에 필요한 집중 흐름을 안정화합니다.' },
  { id: 'mint-arrow', name: '민트 화살', type: 'active', tags: ['ranged', 'mark'], description: '후열에서 적 하나를 공격하고 표식을 남깁니다.' },
  { id: 'steady-breath', name: '차분한 호흡', type: 'passive', tags: ['ranged', 'speed'], description: '라운드가 길어질수록 공격 속도가 소폭 증가합니다.' },
  { id: 'rain-shot', name: '소나기 사격', type: 'ultimate', tags: ['ranged', 'multi'], description: '여러 적에게 낮은 피해를 나누어 주고 표식 대상을 우선합니다.' },
  { id: 'sky-snipe', name: '하늘 저격', type: 'active', tags: ['ranged', 'backline'], description: '후열 대상을 우선 공격합니다.' },
  { id: 'calm-aim', name: '고요한 조준', type: 'passive', tags: ['ranged', 'crit'], description: '같은 대상을 오래 공격할수록 치명 확률이 소폭 증가합니다.' },
  { id: 'mirror-step', name: '거울 발걸음', type: 'active', tags: ['evade', 'trick'], description: '짧은 회피 상태가 되고 다음 공격 피해를 조금 올립니다.' },
  { id: 'confetti-fake', name: '종이꽃 페이크', type: 'passive', tags: ['decoy', 'tempo'], description: '첫 피격 시 일정 확률로 피해 일부를 무효화합니다.' },
  { id: 'shuffle-stage', name: '셔플 스테이지', type: 'ultimate', tags: ['disrupt', 'tempo'], description: '적의 행동 순서를 한 번 흔들고 아군의 속도를 보정합니다.' },
  { id: 'wink-escape', name: '윙크 회피', type: 'active', tags: ['evade', 'tempo'], description: '위험한 순간 짧게 피해를 줄입니다.' },
  { id: 'tiny-trap', name: '작은 함정', type: 'passive', tags: ['trick', 'control'], description: '첫 교전 대상의 템포를 낮출 확률이 있습니다.' },
  { id: 'bubble-tea', name: '버블티 충전', type: 'active', tags: ['heal', 'support'], description: '가장 체력이 낮은 아군을 회복하고 집중을 조금 올립니다.' },
  { id: 'team-chant', name: '응원 구호', type: 'passive', tags: ['buff', 'team'], description: '전투 시작 시 아군 전체의 방어 또는 속도 중 하나를 소폭 올립니다.' },
  { id: 'cozy-finale', name: '포근한 피날레', type: 'ultimate', tags: ['shield', 'team'], description: '아군 전체에게 짧은 보호막을 부여합니다.' },
  { id: 'snack-break', name: '간식 시간', type: 'active', tags: ['heal', 'resource'], description: '아군 하나를 회복하고 에너지 흐름을 조금 보정합니다.' },
  { id: 'warm-light', name: '따뜻한 조명', type: 'passive', tags: ['support', 'aura'], description: '후열 아군의 생존력을 소폭 올립니다.' },
  { id: 'crack-pop', name: '톡톡 균열', type: 'active', tags: ['break', 'armor'], description: '보호막 또는 방어 증가 효과가 있는 적에게 추가 피해를 줍니다.' },
  { id: 'guard-pierce', name: '가드 피어스', type: 'passive', tags: ['break', 'counter'], description: '방어형 대상에게 주는 피해가 소폭 증가합니다.' },
  { id: 'candy-hammer', name: '캔디 해머', type: 'ultimate', tags: ['stun', 'break'], description: '전열 적에게 큰 피해를 주고 짧게 행동을 늦춥니다.' },
  { id: 'armor-melt', name: '아머 멜트', type: 'active', tags: ['break', 'debuff'], description: '방어가 높은 대상의 방어 효율을 낮춥니다.' },
  { id: 'front-cracker', name: '전열 크래커', type: 'passive', tags: ['break', 'frontline'], description: '전열을 공격할 때 피해 편차가 줄어듭니다.' },
  { id: 'clock-hop', name: '시계 토끼뜀', type: 'active', tags: ['speed', 'cooldown'], description: '아군 하나의 다음 행동을 앞당깁니다.' },
  { id: 'tempo-pocket', name: '템포 주머니', type: 'passive', tags: ['tempo', 'resource'], description: '라운드 시작 시 집중을 추가로 확보할 확률이 있습니다.' },
  { id: 'rewind-cue', name: '리와인드 큐', type: 'ultimate', tags: ['cooldown', 'team'], description: '아군 주요 스킬의 재사용 대기 흐름을 한 번 보정합니다.' },
  { id: 'fast-count', name: '빠른 카운트', type: 'active', tags: ['speed', 'tempo'], description: '초반 행동 순서를 앞당깁니다.' },
  { id: 'beat-shift', name: '비트 전환', type: 'passive', tags: ['tempo', 'adapt'], description: '라운드 흐름에 따라 속도와 집중 중 하나를 보정합니다.' }
];

const CLASS_STAT_BIAS: Record<ArenaClassId, Partial<Record<ArenaCardStatKey, number>>> = {
  guardian: { hp: 12, defense: 12, speed: -8, attack: -4 },
  duelist: { attack: 14, speed: 8, defense: -8 },
  arcanist: { focus: 16, attack: 4, hp: -8 },
  ranger: { attack: 8, speed: 8, defense: -4 },
  trickster: { speed: 14, focus: 6, hp: -6 },
  supporter: { focus: 10, defense: 6, attack: -8 },
  breaker: { attack: 10, hp: 4, focus: -4 },
  tempoist: { speed: 12, focus: 10, defense: -6 }
};

export const SKILLS_BY_CLASS: Record<ArenaClassId, string[]> = {
  guardian: ['aegis-pop', 'soft-taunt', 'last-cookie', 'ribbon-wall', 'sturdy-promise'],
  duelist: ['neon-sting', 'rivalry', 'clutch-cut', 'pink-rush', 'one-more-hit'],
  arcanist: ['star-orbit', 'focus-lens', 'quiet-comet', 'puzzle-spark', 'mana-ribbon'],
  ranger: ['mint-arrow', 'steady-breath', 'rain-shot', 'sky-snipe', 'calm-aim'],
  trickster: ['mirror-step', 'confetti-fake', 'shuffle-stage', 'wink-escape', 'tiny-trap'],
  supporter: ['bubble-tea', 'team-chant', 'cozy-finale', 'snack-break', 'warm-light'],
  breaker: ['crack-pop', 'guard-pierce', 'candy-hammer', 'armor-melt', 'front-cracker'],
  tempoist: ['clock-hop', 'tempo-pocket', 'rewind-cue', 'fast-count', 'beat-shift']
};

const skillById = new Map(ARENA_SKILLS.map((skill) => [skill.id, skill]));
const classIdSet = new Set(ARENA_CLASSES.map((arenaClass) => arenaClass.id));
const statFocusSet = new Set(ARENA_STAT_FOCUSES.map((focus) => focus.id));
const combatStyleSet = new Set(ARENA_COMBAT_STYLES.map((style) => style.id));
const ALLOWED_CUSTOM_TAGS = [
  'anchor',
  'burst',
  'carry',
  'combo',
  'control',
  'counter',
  'cute',
  'defense',
  'finisher',
  'frontline',
  'heal',
  'magic',
  'mark',
  'ranged',
  'resource',
  'shield',
  'speed',
  'support',
  'tempo',
  'trick'
];
const CUSTOM_TAG_SET = new Set(ALLOWED_CUSTOM_TAGS);
const CONFIG_LIMITS = {
  skill_ids: 3,
  tag_ids: 4,
  flavor_text_length: 80
};

const hashHex = (input: string): string => createHash('sha256').update(input).digest('hex');
const hashInt = (seed: string, salt: string): number => parseInt(hashHex(`${seed}:${salt}`).slice(0, 8), 16);
const pick = <T>(items: T[], seed: string, salt: string): T => items[hashInt(seed, salt) % items.length];
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const pickDeterministicSubset = <T>(items: T[], seed: string, count: number): T[] =>
  [...items]
    .sort((a, b) => hashInt(seed, JSON.stringify(a)) - hashInt(seed, JSON.stringify(b)))
    .slice(0, count);

const buildStats = (seed: string, classId: ArenaClassId): Record<ArenaCardStatKey, number> => {
  const keys: ArenaCardStatKey[] = ['hp', 'attack', 'defense', 'speed', 'focus'];
  const raw = keys.map((key, index) => 42 + (hashInt(seed, `stat:${key}:${index}`) % 29));
  const sum = raw.reduce((total, value) => total + value, 0);
  const normalized = raw.map((value) => Math.round((value / sum) * 300));
  const diff = 300 - normalized.reduce((total, value) => total + value, 0);
  normalized[0] += diff;

  const bias = CLASS_STAT_BIAS[classId];
  return keys.reduce((stats, key, index) => {
    stats[key] = clamp(normalized[index] + (bias[key] ?? 0), 35, 85);
    return stats;
  }, {} as Record<ArenaCardStatKey, number>);
};

const normalizeId = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
};

const normalizeIdList = (value: unknown, maxCount: number): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const raw of value) {
    const id = normalizeId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= maxCount) break;
  }
  return ids;
};

export const normalizeArenaCardConfig = (raw: unknown, classFallback?: ArenaClassId): ArenaCardConfig | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const classId = normalizeId(source.class_id);
  const resolvedClassId = classId && classIdSet.has(classId as ArenaClassId)
    ? classId as ArenaClassId
    : classFallback;
  const statFocus = normalizeId(source.stat_focus || source.stat_profile_id);
  const combatStyle = normalizeId(source.combat_style);
  const activeSkillId = normalizeId(source.active_skill_id);
  const passiveSkillIds = normalizeIdList(source.passive_skill_ids, CONFIG_LIMITS.skill_ids);
  const explicitSkillIds = normalizeIdList(source.skill_ids, CONFIG_LIMITS.skill_ids);
  const incomingSkillIds = explicitSkillIds.length > 0
    ? explicitSkillIds
    : [activeSkillId, ...passiveSkillIds].filter((id): id is string => Boolean(id));
  const allowedSkillSet = resolvedClassId ? new Set(SKILLS_BY_CLASS[resolvedClassId]) : new Set(ARENA_SKILLS.map((skill) => skill.id));
  const skillIds = incomingSkillIds
    .filter((id) => allowedSkillSet.has(id))
    .slice(0, CONFIG_LIMITS.skill_ids);
  const tagIds = normalizeIdList(source.tag_ids || source.tags, CONFIG_LIMITS.tag_ids)
    .map((tag) => tag.toLowerCase().replace(/[^a-z0-9_-]/g, ''))
    .filter((tag) => CUSTOM_TAG_SET.has(tag))
    .slice(0, CONFIG_LIMITS.tag_ids);
  const flavorText = typeof source.flavor_text === 'string'
    ? source.flavor_text.trim().replace(/\s+/g, ' ').slice(0, CONFIG_LIMITS.flavor_text_length)
    : '';

  const config: ArenaCardConfig = {};
  if (resolvedClassId && classIdSet.has(resolvedClassId)) config.class_id = resolvedClassId;
  if (statFocus && statFocusSet.has(statFocus as ArenaCardStatKey)) config.stat_focus = statFocus as ArenaCardStatKey;
  if (combatStyle && combatStyleSet.has(combatStyle as ArenaCombatStyleId)) config.combat_style = combatStyle as ArenaCombatStyleId;
  if (skillIds.length > 0) config.skill_ids = skillIds;
  if (tagIds.length > 0) config.tag_ids = tagIds;
  if (flavorText) config.flavor_text = flavorText;

  return Object.keys(config).length > 0 ? config : null;
};

const rebalanceStats = (stats: Record<ArenaCardStatKey, number>): Record<ArenaCardStatKey, number> => {
  const keys: ArenaCardStatKey[] = ['hp', 'attack', 'defense', 'speed', 'focus'];
  const result = { ...stats };
  for (let guard = 0; guard < 40; guard += 1) {
    const total = keys.reduce((sum, key) => sum + result[key], 0);
    const diff = 300 - total;
    if (diff === 0) break;
    const ordered = [...keys].sort((a, b) => diff > 0 ? result[a] - result[b] : result[b] - result[a]);
    let changed = false;
    for (const key of ordered) {
      const next = clamp(result[key] + (diff > 0 ? 1 : -1), 35, 85);
      if (next === result[key]) continue;
      result[key] = next;
      changed = true;
      break;
    }
    if (!changed) break;
  }
  return result;
};

const applyConfiguredStatShape = (
  baseStats: Record<ArenaCardStatKey, number>,
  config: ArenaCardConfig | null
): Record<ArenaCardStatKey, number> => {
  const stats = { ...baseStats };
  const adjustments: Partial<Record<ArenaCardStatKey, number>> = {};

  if (config?.stat_focus) adjustments[config.stat_focus] = (adjustments[config.stat_focus] || 0) + 8;

  switch (config?.combat_style) {
    case 'aggressive':
      adjustments.attack = (adjustments.attack || 0) + 5;
      adjustments.speed = (adjustments.speed || 0) + 3;
      adjustments.defense = (adjustments.defense || 0) - 4;
      break;
    case 'guard':
      adjustments.hp = (adjustments.hp || 0) + 4;
      adjustments.defense = (adjustments.defense || 0) + 5;
      adjustments.speed = (adjustments.speed || 0) - 4;
      break;
    case 'tempo':
      adjustments.speed = (adjustments.speed || 0) + 5;
      adjustments.focus = (adjustments.focus || 0) + 4;
      adjustments.hp = (adjustments.hp || 0) - 4;
      break;
    case 'counter':
      adjustments.defense = (adjustments.defense || 0) + 4;
      adjustments.focus = (adjustments.focus || 0) + 3;
      adjustments.attack = (adjustments.attack || 0) - 3;
      break;
    case 'finisher':
      adjustments.attack = (adjustments.attack || 0) + 4;
      adjustments.focus = (adjustments.focus || 0) + 4;
      adjustments.hp = (adjustments.hp || 0) - 3;
      break;
    case 'balanced':
    default:
      break;
  }

  (Object.keys(adjustments) as ArenaCardStatKey[]).forEach((key) => {
    stats[key] = clamp(stats[key] + (adjustments[key] || 0), 35, 85);
  });

  return rebalanceStats(stats);
};

export const getArenaCardConfigOptions = (): ArenaCardConfigOptions => ({
  classes: ARENA_CLASSES,
  stat_focuses: ARENA_STAT_FOCUSES,
  combat_styles: ARENA_COMBAT_STYLES,
  skills_by_class: ARENA_CLASSES.reduce((map, arenaClass) => {
    const disabledSkills = new Set(getArenaAdminControlConfigSync().disabled_skill_ids);
    map[arenaClass.id] = SKILLS_BY_CLASS[arenaClass.id]
      .map((id) => skillById.get(id))
      .filter((skill): skill is ArenaSkillDefinition => Boolean(skill))
      .filter((skill) => !disabledSkills.has(skill.id));
    return map;
  }, {} as Record<ArenaClassId, ArenaSkillDefinition[]>),
  tag_options: ALLOWED_CUSTOM_TAGS,
  limits: CONFIG_LIMITS,
  balance_policy: {
    fixed_stat_budget: 300,
    direct_numeric_stat_editing: false,
    combat_uses_external_value: false
  }
});

const resolveArenaImageUrl = (streamer: Pick<Streamer, 'custom_images' | 'custom_image_url' | 'logo_url' | 'is_image_banned'>): string | null => {
  if (streamer.is_image_banned) return null;
  const customImages = Array.isArray(streamer.custom_images) ? streamer.custom_images.filter(Boolean) : [];
  return customImages.at(-1) || streamer.custom_image_url || streamer.logo_url || null;
};

export const generateArenaCardFromStreamer = (
  streamer: Streamer,
  options: ArenaCardGenerationOptions = {}
): ArenaGeneratedCard => {
  const seed = hashHex(`arena:v1:${streamer.channel_id}`);
  const configuredClass = options.config?.class_id
    ? ARENA_CLASSES.find((arenaClassOption) => arenaClassOption.id === options.config?.class_id)
    : null;
  const arenaClass = configuredClass || pick(ARENA_CLASSES, seed, 'class');
  const normalizedConfig = normalizeArenaCardConfig(options.config, arenaClass.id);
  const templateId = `${arenaClass.id}-${normalizedConfig ? 'configured' : 'auto'}-${seed.slice(0, 10)}`;
  const adminControl = getArenaAdminControlConfigSync();
  const disabledCards = new Set(adminControl.disabled_card_ids);
  const disabledSkills = new Set(adminControl.disabled_skill_ids);
  const cardId = `arena_streamer_${streamer.channel_id}`;
  const arenaEnabled = options.arenaEnabled !== false
    && !disabledCards.has(streamer.channel_id)
    && !disabledCards.has(cardId);
  const maskDisabled = !arenaEnabled && options.maskDisabled !== false;
  const skillPool = (SKILLS_BY_CLASS[arenaClass.id] || [])
    .map((id) => skillById.get(id))
    .filter((skill): skill is ArenaSkillDefinition => Boolean(skill))
    .filter((skill) => !disabledSkills.has(skill.id));
  const configuredSkillIds = normalizedConfig?.skill_ids || [];
  const configuredSkills = configuredSkillIds
    .map((id) => skillById.get(id))
    .filter((skill): skill is ArenaSkillDefinition => Boolean(skill))
    .filter((skill) => !disabledSkills.has(skill.id));
  const remainingSkills = skillPool.filter((skill) => !configuredSkillIds.includes(skill.id));
  const skills = [
    ...configuredSkills,
    ...pickDeterministicSubset(remainingSkills, `${seed}:skills:${normalizedConfig?.combat_style || 'auto'}`, Math.max(0, 3 - configuredSkills.length))
  ].slice(0, 3);
  const tags = Array.from(new Set([
    arenaClass.role,
    arenaClass.id,
    ...skills.flatMap((skill) => skill.tags),
    ...(normalizedConfig?.combat_style ? [normalizedConfig.combat_style] : []),
    ...(normalizedConfig?.tag_ids || [])
  ])).slice(0, 10);

  return {
    card_id: cardId,
    channel_id: streamer.channel_id,
    name: maskDisabled ? '비활성화된 카드' : streamer.name,
    image_url: maskDisabled ? null : resolveArenaImageUrl(streamer),
    flavor_text: normalizedConfig?.flavor_text || null,
    arena_enabled: arenaEnabled,
    source: 'streamer',
    class: arenaClass,
    stats: applyConfiguredStatShape(buildStats(seed, arenaClass.id), normalizedConfig),
    skills,
    tags,
    template_id: templateId,
    ability_seed: seed.slice(0, 16),
    config_source: normalizedConfig ? 'streamer_config' : 'deterministic_template',
    policy: {
      combat_uses_market_data: false,
      combat_uses_live_data: false,
      combat_uses_follower_data: false,
      cosmetic_only_fields: ['channel_id', 'name', 'logo_url', 'custom_image_url', 'custom_images', 'is_image_banned']
    }
  };
};

export const ARENA_FORBIDDEN_COMBAT_FIELDS = [
  'base_value',
  'prev_value',
  'value_1h_ago',
  'follower_count',
  'is_active',
  'last_broadcast_at',
  'point',
  'market_price',
  'chat_count',
  'donation',
  'ownership_count'
];





