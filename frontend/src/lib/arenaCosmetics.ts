export type ArenaCosmeticPresetType =
  | 'card_frame'
  | 'name_flare'
  | 'hit_vfx'
  | 'summon_vfx'
  | 'ready_stamp'
  | 'nameplate'
  | 'ko_text';

export type ArenaCosmeticRarity = 'rare' | 'epic' | 'legendary';

export type ArenaCosmeticPreset = {
  id: string;
  type: ArenaCosmeticPresetType;
  name: string;
  rarity: ArenaCosmeticRarity;
  priceHint: number;
  summary: string;
  className: string;
  styleVars: Record<string, string>;
};

export const arenaCosmeticTypeLabels: Record<ArenaCosmeticPresetType, string> = {
  card_frame: '카드 프레임',
  name_flare: '이름 플레어',
  hit_vfx: '타격 VFX',
  summon_vfx: '소환 VFX',
  ready_stamp: '준비 스탬프',
  nameplate: '네임플레이트',
  ko_text: 'KO 문구'
};

export const arenaCosmeticPresets: ArenaCosmeticPreset[] = [
  {
    id: 'frame-prism-core',
    type: 'card_frame',
    name: '프리즘 코어',
    rarity: 'legendary',
    priceHint: 48000,
    summary: '카드 외곽에 유리광, 네온 테두리, 사선 샤인이 순환합니다.',
    className: 'arena-cosmetic-preview-frame-prism',
    styleVars: { '--ac-a': '#67e8f9', '--ac-b': '#fb7185', '--ac-c': '#facc15' }
  },
  {
    id: 'name-aurora-script',
    type: 'name_flare',
    name: '오로라 서명',
    rarity: 'epic',
    priceHint: 26000,
    summary: '이름에 다층 그라데이션과 부드러운 잉크 광택이 흐릅니다.',
    className: 'arena-cosmetic-preview-name-aurora',
    styleVars: { '--ac-a': '#22d3ee', '--ac-b': '#f472b6', '--ac-c': '#a7f3d0' }
  },
  {
    id: 'hit-vfx-starbreaker',
    type: 'hit_vfx',
    name: '스타브레이커',
    rarity: 'legendary',
    priceHint: 52000,
    summary: '타격 순간 충격 링, 베기 궤적, 별 파편이 터집니다.',
    className: 'arena-cosmetic-preview-hit-starbreaker',
    styleVars: { '--ac-a': '#f97316', '--ac-b': '#f43f5e', '--ac-c': '#fde68a' }
  },
  {
    id: 'summon-vfx-circuit-gate',
    type: 'summon_vfx',
    name: '서킷 게이트',
    rarity: 'epic',
    priceHint: 34000,
    summary: '필드 위에 회전하는 회로 링과 수직 스캔 빔이 나타납니다.',
    className: 'arena-cosmetic-preview-summon-circuit',
    styleVars: { '--ac-a': '#38bdf8', '--ac-b': '#2dd4bf', '--ac-c': '#e0f2fe' }
  },
  {
    id: 'ready-stamp-royal-lock',
    type: 'ready_stamp',
    name: '로열 락인',
    rarity: 'rare',
    priceHint: 18000,
    summary: '턴 제출 시 금속 링과 READY 스탬프가 짧게 잠깁니다.',
    className: 'arena-cosmetic-preview-ready-royal',
    styleVars: { '--ac-a': '#fbbf24', '--ac-b': '#f97316', '--ac-c': '#fff7ed' }
  },
  {
    id: 'nameplate-obsidian-crown',
    type: 'nameplate',
    name: '옵시디언 크라운',
    rarity: 'legendary',
    priceHint: 45000,
    summary: '플레이어 이름 영역에 어두운 유리판, 왕관 광택, 하단 라이트가 붙습니다.',
    className: 'arena-cosmetic-preview-nameplate-obsidian',
    styleVars: { '--ac-a': '#0f172a', '--ac-b': '#38bdf8', '--ac-c': '#facc15' }
  },
  {
    id: 'ko-text-crimson-finish',
    type: 'ko_text',
    name: '크림슨 피니시',
    rarity: 'epic',
    priceHint: 30000,
    summary: '처치 순간 FINISH 텍스트가 충격파와 함께 절단되듯 등장합니다.',
    className: 'arena-cosmetic-preview-ko-crimson',
    styleVars: { '--ac-a': '#fb7185', '--ac-b': '#ef4444', '--ac-c': '#ffe4e6' }
  }
];

export const parseArenaCosmeticStyle = (value?: string | null): Record<string, any> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

