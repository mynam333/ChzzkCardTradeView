export const arenaCosmeticTypes = [
  'emote',
  'card_frame',
  'name_flare',
  'hit_vfx',
  'summon_vfx',
  'ready_stamp',
  'nameplate',
  'ko_text'
] as const;

export type ArenaCosmeticType = (typeof arenaCosmeticTypes)[number];
export type ArenaLoadoutCosmeticType = Exclude<ArenaCosmeticType, 'emote'>;
export type ArenaCosmeticRarity = 'common' | 'rare' | 'epic' | 'legendary';

export const arenaLoadoutCosmeticTypes = arenaCosmeticTypes.filter(
  (type): type is ArenaLoadoutCosmeticType => type !== 'emote'
);

export const arenaCosmeticTypeLabels: Record<ArenaCosmeticType, string> = {
  emote: '이모트',
  card_frame: '카드 프레임',
  name_flare: '이름 연출',
  hit_vfx: '타격',
  summon_vfx: '소환',
  ready_stamp: '준비',
  nameplate: '네임플레이트',
  ko_text: 'KO'
};

export const arenaCosmeticTypeDescriptions: Record<ArenaCosmeticType, string> = {
  emote: '매치의 8분할 파이 메뉴에서 사용하는 감정 표현',
  card_frame: '전장 카드 외곽에 적용되는 프레임 연출',
  name_flare: '카드와 플레이어 이름에 적용되는 문자 연출',
  hit_vfx: '공격이 적중할 때 재생되는 시각 효과',
  summon_vfx: '카드를 필드에 배치할 때 재생되는 시각 효과',
  ready_stamp: '행동 제출 완료 상태에 적용되는 스탬프',
  nameplate: '매치 상단 플레이어 정보 영역의 외형',
  ko_text: '승부가 결정되는 순간 표시되는 마무리 문구'
};

export type ArenaCosmeticStyle = {
  schema_version?: number;
  emoji?: string;
  image_url?: string;
  rarity?: ArenaCosmeticRarity;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  label?: string;
  motion?: string;
  css?: string;
  [key: string]: unknown;
};

export const isArenaCosmeticType = (value: unknown): value is ArenaCosmeticType => (
  typeof value === 'string' && (arenaCosmeticTypes as readonly string[]).includes(value)
);

export const parseArenaCosmeticStyle = (value?: string | null): ArenaCosmeticStyle => {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as ArenaCosmeticStyle : {};
  } catch {
    return {};
  }
};

const safeColor = (value: unknown, fallback: string) => (
  typeof value === 'string' && /^(#[\da-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%+-]+\))$/i.test(value.trim())
    ? value.trim()
    : fallback
);

export const getArenaCosmeticRarity = (item?: { style_json?: string | null } | null): ArenaCosmeticRarity => {
  const rarity = parseArenaCosmeticStyle(item?.style_json).rarity;
  return rarity === 'common' || rarity === 'rare' || rarity === 'epic' || rarity === 'legendary' ? rarity : 'common';
};

export const getArenaCosmeticStyleVars = (
  item?: { style_json?: string | null } | null
): Record<'--ac-a' | '--ac-b' | '--ac-c', string> => {
  const style = parseArenaCosmeticStyle(item?.style_json);
  return {
    '--ac-a': safeColor(style.primary_color, '#f2556b'),
    '--ac-b': safeColor(style.secondary_color, '#17adc0'),
    '--ac-c': safeColor(style.accent_color, '#ffd166')
  };
};
