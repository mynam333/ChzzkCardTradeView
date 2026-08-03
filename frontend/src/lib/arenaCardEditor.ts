export type ArenaCardKeywordSelection = {
  type: string;
  value?: number;
  limit?: string;
};

export type ArenaCardEditorForm = {
  cardClass: string;
  cost: number;
  attack: number;
  health: number;
  keywords: ArenaCardKeywordSelection[];
};

export type ArenaCardKeywordVariant = {
  label: string;
  cost: number;
  value?: number;
  limit?: string;
  detail?: string;
};

export type ArenaCardKeywordDefinition = {
  type: string;
  label: string;
  description: string;
  category: 'defense' | 'offense' | 'control' | 'support' | 'specter';
  timing: string;
  target: string;
  duration: string;
  variants: ArenaCardKeywordVariant[];
  availableForSelection?: boolean;
};

export const arenaCardBudgetByCost: Record<number, number> = {
  1: 6,
  2: 9,
  3: 14,
  4: 18,
  5: 24,
  6: 31,
  7: 39,
  8: 48,
  9: 59
};

export const arenaCardStatLimitsByCost: Record<number, { attackMax: number; healthMax: number }> = {
  1: { attackMax: 1, healthMax: 6 },
  2: { attackMax: 2, healthMax: 8 },
  3: { attackMax: 4, healthMax: 10 },
  4: { attackMax: 5, healthMax: 12 },
  5: { attackMax: 6, healthMax: 14 },
  6: { attackMax: 7, healthMax: 16 },
  7: { attackMax: 8, healthMax: 18 },
  8: { attackMax: 9, healthMax: 21 },
  9: { attackMax: 10, healthMax: 25 }
};

export const arenaCardClassDefinitions = {
  charge: {
    label: '돌격',
    description: '전열의 첫 기본 공격을 강화해 상대 카드를 빠르게 무너뜨리는 공격형 클래스입니다.',
    playstyle: '공격적인 전열 압박',
    passive: '전열에서 이번 전투 첫 기본 공격으로 카드에게 주는 피해가 1 증가합니다.',
    trigger: '전투마다 첫 기본 공격 1회',
    condition: '전열 배치 · 카드 대상 피해',
    note: '후열과 플레이어 직접 공격에는 적용되지 않습니다.'
  },
  guardian: {
    label: '수호',
    description: '전열에서 첫 체력 피해를 줄여 라인을 안정적으로 지키는 방어형 클래스입니다.',
    playstyle: '단단한 전열 유지',
    passive: '전열에서 이번 전투 처음 받는 체력 피해를 1 줄입니다.',
    trigger: '전투마다 첫 체력 피해 1회',
    condition: '전열 배치 · 보호막 적용 후 체력 피해 발생',
    note: '보호막이 피해를 모두 막았거나 후열에 있으면 발동하지 않습니다.'
  },
  sniper: {
    label: '저격',
    description: '후열에서 상대 후열을 정확히 타격할 때 첫 기본 공격을 강화하는 정밀 공격 클래스입니다.',
    playstyle: '정밀한 후열 제거',
    passive: '후열에서 상대 후열 카드에 주는 이번 전투 첫 기본 공격 피해가 1 증가합니다.',
    trigger: '전투마다 첫 후열 카드 기본 공격 1회',
    condition: '후열 배치 · 상대 후열 카드 대상 피해',
    note: '전열을 우회하지 않으며 플레이어 직접 공격에는 적용되지 않습니다. 전열을 무시하려면 조준 키워드가 필요합니다.'
  },
  support: {
    label: '지원',
    description: '같은 라인 아군의 첫 체력 피해 일부를 대신 받아 전투 지속력을 높이는 보조 클래스입니다.',
    playstyle: '회복과 전투 보조',
    passive: '같은 라인의 아군 카드가 이번 전투 처음 받는 체력 피해 중 1을 대신 받습니다.',
    trigger: '전투마다 아군의 첫 체력 피해 1회',
    condition: '같은 라인 · 지원 카드가 전투 가능 상태',
    note: '대신 받은 피해는 지원 카드의 보호막·피해 감소로 다시 줄이지 않으며, 이 피해로 전투불능이 될 수 있습니다.'
  },
  trick: {
    label: '기만',
    description: '첫 타격 대상의 공격력을 낮춰 상대의 다음 공격을 약화하는 교란 클래스입니다.',
    playstyle: '제어와 위치 교란',
    passive: '이번 전투 처음 피해를 준 같은 라인의 카드에게 약화 1을 부여합니다.',
    trigger: '전투마다 처음 카드 피해를 준 직후 1회',
    condition: '같은 라인의 카드 대상 피해',
    note: '플레이어 직접 공격에는 발동하지 않으며 약화는 전투 종료 시 사라집니다.'
  },
  specter: {
    label: '망령',
    description: '전열에서 쓰러질 때 일반 초과 피해를 차단해 후열을 보호하는 묘지 연계 클래스입니다.',
    playstyle: '묘지 활용과 후반 압박',
    passive: '전열에서 전투불능이 될 때 일반 초과 피해가 같은 라인 후열로 넘어가는 것을 막습니다.',
    trigger: '전열에서 전투불능 확정 시',
    condition: '기본 공격의 일반 초과 피해',
    note: '관통 피해, 후열 전투불능, 교체와 손패 초과 버림에는 적용되지 않습니다.'
  },
  tech: {
    label: '기술',
    description: '처음 들어오는 제어 키워드를 무효화해 핵심 역할을 안정적으로 수행하는 유틸리티 클래스입니다.',
    playstyle: '카드 순환과 유틸리티',
    passive: '이번 전투 처음 받는 키워드 효과 1개를 무효화합니다.',
    trigger: '전투마다 처음 받는 대상 키워드 1회',
    condition: '침묵 · 기절 · 약화 · 밀치기 · 끌어오기 등 제어 효과',
    note: '피해 자체와 관통·직접 압박·원혼처럼 이미 피해로 처리되는 효과는 막지 않습니다.'
  }
} as const;

const fixed = (label: string, cost: number, detail?: string): ArenaCardKeywordVariant[] => [{ label, cost, detail }];
const levels = (costs: number[], unit: string): ArenaCardKeywordVariant[] => costs.map((cost, index) => ({
  label: `${index + 1}${unit}`,
  value: index + 1,
  cost
}));

export const arenaCardKeywordDefinitions: ArenaCardKeywordDefinition[] = [
  { type: 'taunt', label: '도발', description: '공격 대상 결정 시 같은 라인의 적 공격 우선순위를 자신에게 끌어옵니다.', category: 'defense', timing: '공격 대상 결정', target: '같은 라인의 적 공격', duration: '이번 전투', variants: fixed('기본', 4) },
  { type: 'shield', label: '보호막', description: '전투 시작 시 보호막 X를 얻어 체력보다 먼저 피해를 흡수합니다. 남은 보호막은 전투 종료 시 사라집니다.', category: 'defense', timing: '전투 시작 · 피해 적용 전', target: '이 카드', duration: '이번 전투', variants: levels([1, 2, 3, 4, 5], ' 보호막') },
  { type: 'damage_reduction', label: '피해 감소', description: '보호막 적용 후 이 카드가 받는 체력 피해를 매번 1 줄입니다. 선택 단계에 따라 1회 또는 2회 발동합니다.', category: 'defense', timing: '체력 피해 적용 중', target: '이 카드', duration: '선택한 횟수만큼', variants: [{ label: '1회', value: 1, cost: 4 }, { label: '2회', value: 2, cost: 7 }] },
  { type: 'counter', label: '반격', description: '같은 라인의 카드에게 공격받아 피해가 적용된 뒤 그 공격자에게 X 피해를 줍니다.', category: 'defense', timing: '피해 적용 후', target: '같은 라인의 공격자', duration: '발동 즉시', variants: [{ label: '1 피해', value: 1, cost: 4 }, { label: '2 피해', value: 2, cost: 7 }] },
  { type: 'lifesteal', label: '흡혈', description: '카드에게 실제 체력 피해를 준 뒤 자신의 누적 피해를 X만큼 회복합니다. 피해를 주지 못하면 발동하지 않습니다.', category: 'defense', timing: '카드 체력 피해 적용 후', target: '이 카드', duration: '발동 즉시', variants: [{ label: '1 회복', value: 1, cost: 6 }, { label: '2 회복', value: 2, cost: 10 }] },
  { type: 'revive', label: '부활', description: '전투불능이 되는 대신 체력 1로 생존합니다. 한 전투에서 한 번만 발동합니다.', category: 'defense', timing: '전투불능 대체', target: '이 카드', duration: '전투마다 1회', variants: fixed('1회', 18) },
  { type: 'pierce', label: '관통', description: '기본 공격으로 전열을 쓰러뜨리면 남은 피해 전부를 같은 라인의 후열 카드까지 전달합니다. 플레이어에게는 넘어가지 않습니다.', category: 'offense', timing: '전열 전투불능 후', target: '같은 라인의 후열 카드', duration: '해당 공격', variants: fixed('기본', 6) },
  { type: 'pursuit', label: '추격', description: '후속 효과 규칙을 확정 중인 보류 키워드입니다. 기존 카드 표시는 유지하지만 신규 카드에는 선택할 수 없습니다.', category: 'offense', timing: '규칙 확정 전', target: '신규 선택 불가', duration: '규칙 확정 전', variants: [{ label: '1단계', value: 1, cost: 5 }, { label: '2단계', value: 2, cost: 9 }], availableForSelection: false },
  { type: 'direct_pressure', label: '직접 압박', description: '같은 라인의 상대 전열과 후열이 모두 비어 플레이어를 직접 공격할 때 피해가 X 증가합니다.', category: 'offense', timing: '플레이어 직접 공격 피해 전', target: '상대 플레이어', duration: '해당 직접 공격', variants: [{ label: '피해 +1', value: 1, cost: 7 }, { label: '피해 +2', value: 2, cost: 12 }] },
  { type: 'backline_pressure', label: '후열 압박', description: '상대 후열 카드를 공격할 때 그 카드에게 주는 피해가 1 증가합니다.', category: 'offense', timing: '후열 카드 공격 피해 전', target: '상대 후열 카드', duration: '해당 공격', variants: fixed('피해 +1', 5) },
  { type: 'weakpoint', label: '약점 공격', description: '이미 체력 피해를 받은 카드를 공격할 때 그 카드에게 주는 피해가 1 증가합니다.', category: 'offense', timing: '카드 공격 피해 전', target: '피해를 받은 카드', duration: '해당 공격', variants: fixed('피해 +1', 5) },
  { type: 'aoe_damage', label: '광역 피해', description: '기본 공격을 처리한 뒤 주 대상 외의 생존한 상대 필드 카드 모두에게 X 피해를 줍니다.', category: 'offense', timing: '기본 공격 직후', target: '주 대상 외의 상대 필드 카드 전체', duration: '기본 공격마다 1회', variants: [{ label: '1 피해', value: 1, cost: 8 }, { label: '2 피해', value: 2, cost: 14 }] },
  { type: 'aim', label: '조준', description: '공격 대상 결정 시 같은 라인의 상대 후열 카드를 우선 대상으로 선택합니다.', category: 'control', timing: '공격 대상 결정', target: '같은 라인의 상대 후열', duration: '해당 공격', variants: fixed('기본', 8) },
  { type: 'silence', label: '침묵', description: '같은 라인 대상의 키워드 효과를 이번 전투 동안 사용할 수 없게 합니다.', category: 'control', timing: '제어 효과 적용 시', target: '같은 라인의 상대 카드', duration: '이번 전투', variants: fixed('기본', 8) },
  { type: 'stun', label: '기절', description: '같은 라인 대상이 이번 공격 단계에서 행동하지 못하게 합니다.', category: 'control', timing: '공격 행동 전', target: '같은 라인의 상대 카드', duration: '이번 공격 단계', variants: fixed('1회', 10) },
  { type: 'push', label: '밀치기', description: '같은 라인의 상대 전열 카드를 후열로 밉니다. 후열 칸이 차 있으면 실패합니다.', category: 'control', timing: '위치 제어 적용 시', target: '같은 라인의 상대 전열', duration: '배치가 바뀔 때까지', variants: fixed('기본', 6) },
  { type: 'pull', label: '끌어오기', description: '같은 라인의 상대 후열 카드를 전열로 당깁니다. 전열 칸이 차 있으면 실패합니다.', category: 'control', timing: '위치 제어 적용 시', target: '같은 라인의 상대 후열', duration: '배치가 바뀔 때까지', variants: fixed('기본', 7) },
  { type: 'weaken', label: '약화', description: '같은 라인 대상의 공격력을 이번 전투 동안 X 낮춥니다. 전투 종료 시 원래 수치로 돌아옵니다.', category: 'control', timing: '피해 적용 후 또는 효과 적용 시', target: '같은 라인의 상대 카드', duration: '이번 전투', variants: [{ label: '공격력 -1', value: 1, cost: 5 }, { label: '공격력 -2', value: 2, cost: 9 }] },
  { type: 'battle_draw', label: '전투 드로우', description: '전투 시작 시 덱에서 카드 1장을 뽑습니다. 손패가 8장이면 뽑은 카드는 묘지로 이동하며, 덱이 비어 있어도 피로 피해는 받지 않습니다.', category: 'support', timing: '전투 시작', target: '내 덱과 손패', duration: '전투마다 1회', variants: fixed('카드 1장', 6) },
  { type: 'emergency_heal', label: '응급 회복', description: '전투 시작 시 누적 피해가 가장 큰 아군 필드 카드의 피해를 X 회복합니다. 동률이면 같은 라인 아군을 우선하며 최대 체력을 넘지 않습니다.', category: 'support', timing: '전투 시작', target: '누적 피해가 가장 큰 아군 필드 카드', duration: '전투마다 1회', variants: [{ label: '1 회복', value: 1, cost: 7 }, { label: '2 회복', value: 2, cost: 12 }] },
  { type: 'guard_support', label: '보호 지원', description: '전투 시작 시 같은 라인의 아군 카드 1장에게 보호막 1을 부여합니다.', category: 'support', timing: '전투 시작', target: '같은 라인의 아군 카드', duration: '이번 전투', variants: fixed('보호막 1', 4) },
  { type: 'attack_support', label: '공격 지원', description: '같은 라인 아군 카드가 이번 전투 처음 주는 카드 피해를 1 증가시킵니다.', category: 'support', timing: '전투 시작 · 아군 첫 피해 전', target: '같은 라인의 아군 카드', duration: '전투마다 1회', variants: fixed('피해 +1', 5) },
  { type: 'grave_buff', label: '묘지 강화', description: '강화 조건과 수치 규칙을 확정 중인 보류 키워드입니다. 기존 카드 표시는 유지하지만 신규 카드에는 선택할 수 없습니다.', category: 'support', timing: '규칙 확정 전', target: '신규 선택 불가', duration: '규칙 확정 전', variants: fixed('기본', 6), availableForSelection: false },
  {
    type: 'grave_recover',
    label: '묘지 회수',
    description: '선택한 조건에 맞는 묘지 카드 1장을 자동으로 골라 최대 체력 상태로 손패에 넣습니다.',
    category: 'support',
    timing: '전투불능 효과 처리 후',
    target: '조건에 맞는 내 묘지 카드 1장',
    duration: '발동 즉시',
    variants: [
      { label: '2코스트 이하', limit: 'cost_2', cost: 8 },
      { label: '망령 클래스', limit: 'specter', cost: 9 },
      { label: '같은 클래스', limit: 'same_class', cost: 11 },
      { label: '4코스트 이하', limit: 'cost_4', cost: 12 },
      { label: '자신 이하 코스트', limit: 'self_cost', cost: 14 },
      { label: '제한 없음', limit: 'any', cost: 18 }
    ]
  },
  { type: 'vengeance', label: '원한', description: '이 카드가 전투불능이 되어 묘지로 간 뒤 같은 라인의 가장 앞 적 카드에게 X 피해를 줍니다.', category: 'specter', timing: '전투불능 확정과 묘지 이동 후', target: '같은 라인의 가장 앞 적 카드', duration: '발동 즉시', variants: [{ label: '1 피해', value: 1, cost: 4 }, { label: '2 피해', value: 2, cost: 7 }] },
  { type: 'grudge', label: '원혼', description: '이 카드가 전투불능이 되어 묘지로 간 뒤 상대 플레이어에게 X 피해를 줍니다. 직접 공격으로 취급하지 않습니다.', category: 'specter', timing: '전투불능 확정과 묘지 이동 후', target: '상대 플레이어', duration: '발동 즉시', variants: [{ label: '1 피해', value: 1, cost: 10 }, { label: '2 피해', value: 2, cost: 18 }] },
  { type: 'remnant', label: '잔재', description: '이 카드가 전투불능이 되어 묘지로 간 뒤 같은 라인의 아군 카드 1장에게 보호막 X를 부여합니다.', category: 'specter', timing: '전투불능 확정과 묘지 이동 후', target: '같은 라인의 아군 카드 1장', duration: '해당 전투 종료까지', variants: [{ label: '보호막 1', value: 1, cost: 5 }, { label: '보호막 2', value: 2, cost: 8 }] }
];

const keywordDefinitionMap = new Map(arenaCardKeywordDefinitions.map((definition) => [definition.type, definition]));

export const getArenaCardKeywordDefinition = (type: string) => keywordDefinitionMap.get(type);

export const getArenaCardKeywordVariant = (selection: ArenaCardKeywordSelection) => {
  const definition = getArenaCardKeywordDefinition(selection.type);
  if (!definition) return null;
  return definition.variants.find((variant) => {
    if (variant.limit != null) return variant.limit === selection.limit;
    if (variant.value != null) return variant.value === selection.value;
    return true;
  }) || definition.variants[0] || null;
};

export const createArenaCardKeywordSelection = (type: string): ArenaCardKeywordSelection => {
  const variant = getArenaCardKeywordDefinition(type)?.variants[0];
  return {
    type,
    ...(variant?.value != null ? { value: variant.value } : {}),
    ...(variant?.limit ? { limit: variant.limit } : {})
  };
};

export const applyArenaCardKeywordVariant = (
  selection: ArenaCardKeywordSelection,
  variantIndex: number
): ArenaCardKeywordSelection => {
  const variant = getArenaCardKeywordDefinition(selection.type)?.variants[variantIndex];
  if (!variant) return selection;
  return {
    type: selection.type,
    ...(variant.value != null ? { value: variant.value } : {}),
    ...(variant.limit ? { limit: variant.limit } : {})
  };
};

export const normalizeArenaCardKeywords = (value: unknown): ArenaCardKeywordSelection[] => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).flatMap((item) => {
    const raw = typeof item === 'string' ? { type: item } : item;
    if (!raw || typeof raw !== 'object') return [];
    const candidate = raw as Record<string, unknown>;
    const type = String(candidate.type || '').trim().toLowerCase();
    const definition = getArenaCardKeywordDefinition(type);
    if (!definition) return [];
    const valueNumber = Number(candidate.value);
    const selection: ArenaCardKeywordSelection = {
      type,
      ...(Number.isInteger(valueNumber) ? { value: valueNumber } : {}),
      ...(typeof candidate.limit === 'string' && candidate.limit.trim() ? { limit: candidate.limit.trim() } : {})
    };
    const variant = getArenaCardKeywordVariant(selection);
    return [variant ? {
      type,
      ...(variant.value != null ? { value: variant.value } : {}),
      ...(variant.limit ? { limit: variant.limit } : {})
    } : createArenaCardKeywordSelection(type)];
  });
};

type BudgetLine = { code: string; label: string; cost: number };

const comboBudgetLines = (form: ArenaCardEditorForm): BudgetLine[] => {
  const has = (type: string) => form.keywords.some((keyword) => keyword.type === type);
  const hasShieldAtLeast3 = form.keywords.some((keyword) => keyword.type === 'shield' && Number(keyword.value || 0) >= 3);
  const lines: BudgetLine[] = [];
  const add = (condition: boolean, code: string, label: string, cost: number) => {
    if (condition) lines.push({ code, label, cost });
  };

  add(has('pierce') && form.attack >= 4, 'pierce_attack_4', '관통 + 공격력 4 이상', 2);
  add(has('pierce') && form.attack >= 6, 'pierce_attack_6', '관통 + 공격력 6 이상', 3);
  add(has('pierce') && has('lifesteal'), 'pierce_lifesteal', '관통 + 흡혈', 5);
  add(has('pierce') && has('pursuit'), 'pierce_pursuit', '관통 + 추격', 3);
  add(has('direct_pressure') && form.attack >= 4, 'pressure_attack_4', '직접 압박 + 공격력 4 이상', 3);
  add(has('direct_pressure') && form.attack >= 6, 'pressure_attack_6', '직접 압박 + 공격력 6 이상', 4);
  add(has('direct_pressure') && has('backline_pressure'), 'pressure_backline', '직접 압박 + 후열 압박', 3);
  add(has('direct_pressure') && has('pierce'), 'pressure_pierce', '직접 압박 + 관통', 3);
  add(has('direct_pressure') && form.cardClass === 'charge', 'pressure_charge', '돌격 클래스 + 직접 압박', 2);
  add(has('aim') && form.attack >= 3, 'aim_attack_3', '조준 + 공격력 3 이상', 2);
  add(has('aim') && form.attack >= 5, 'aim_attack_5', '조준 + 공격력 5 이상', 3);
  add(has('aim') && has('silence'), 'aim_silence', '조준 + 침묵', 4);
  add(has('aim') && has('stun'), 'aim_stun', '조준 + 기절', 5);
  add(has('aim') && has('weaken'), 'aim_weaken', '조준 + 약화', 2);
  add(has('aim') && has('lifesteal'), 'aim_lifesteal', '조준 + 흡혈', 3);
  add(has('aim') && has('pursuit'), 'aim_pursuit', '조준 + 추격', 3);
  add(has('silence') && has('stun'), 'silence_stun', '침묵 + 기절', 5);
  add(has('silence') && has('aoe_damage'), 'silence_aoe', '침묵 + 광역 피해', 5);
  add(has('stun') && has('aoe_damage'), 'stun_aoe', '기절 + 광역 피해', 6);
  add(has('taunt') && has('damage_reduction'), 'taunt_reduction', '도발 + 피해 감소', 3);
  add(has('taunt') && hasShieldAtLeast3, 'taunt_shield_3', '도발 + 보호막 3 이상', 2);
  add(has('taunt') && has('counter'), 'taunt_counter', '도발 + 반격', 2);
  add(has('taunt') && has('revive'), 'taunt_revive', '도발 + 부활', 8);
  add(has('taunt') && has('lifesteal'), 'taunt_lifesteal', '도발 + 흡혈', 3);
  add(form.cardClass === 'guardian' && has('revive'), 'guardian_revive', '수호 클래스 + 부활', 6);
  add(has('revive') && has('damage_reduction'), 'revive_reduction', '부활 + 피해 감소', 6);
  add(has('revive') && has('lifesteal'), 'revive_lifesteal', '부활 + 흡혈', 7);
  add(has('revive') && has('vengeance'), 'revive_vengeance', '부활 + 원한', 6);
  add(has('revive') && has('grudge'), 'revive_grudge', '부활 + 원혼', 10);
  add(has('revive') && has('grave_recover'), 'revive_grave', '부활 + 묘지 회수', 10);
  add(form.cardClass === 'support' && has('vengeance'), 'support_vengeance', '지원 클래스 + 원한', 3);
  add(form.cardClass === 'support' && has('grudge'), 'support_grudge', '지원 클래스 + 원혼', 5);
  add(form.cardClass === 'support' && has('revive'), 'support_revive', '지원 클래스 + 부활', 6);
  add(form.cardClass === 'support' && has('grave_recover'), 'support_grave', '지원 클래스 + 묘지 회수', 4);
  add(has('battle_draw') && has('grave_recover'), 'draw_grave', '전투 드로우 + 묘지 회수', 5);
  add(has('grave_recover') && has('grudge'), 'grave_grudge', '묘지 회수 + 원혼', 6);
  add(has('grudge') && form.cost <= 2, 'grudge_low_cost', '원혼 + 2코스트 이하', 4);
  return lines;
};

const forbiddenComboMessages = (form: ArenaCardEditorForm) => {
  const has = (type: string) => form.keywords.some((keyword) => keyword.type === type);
  const hasValue = (type: string, value: number) => form.keywords.some((keyword) => keyword.type === type && keyword.value === value);
  const messages: string[] = [];
  if (form.cost === 1 && has('direct_pressure')) messages.push('1코스트에서는 직접 압박을 선택할 수 없습니다. 코스트를 올리거나 키워드를 변경해주세요.');
  if (form.cost === 1 && has('grudge')) messages.push('1코스트에서는 원혼을 선택할 수 없습니다. 코스트를 올리거나 키워드를 변경해주세요.');
  if (form.cost === 1 && has('grave_recover')) messages.push('1코스트에서는 묘지 회수를 선택할 수 없습니다. 코스트를 올리거나 키워드를 변경해주세요.');
  if (form.cost === 1 && has('battle_draw')) messages.push('1코스트에서는 전투 드로우를 선택할 수 없습니다. 코스트를 2 이상으로 올려주세요.');
  if (form.cost === 2 && has('revive')) messages.push('2코스트에서는 부활을 선택할 수 없습니다. 코스트를 올리거나 키워드를 변경해주세요.');
  if (has('revive') && hasValue('grudge', 2)) messages.push('부활과 원혼 2단계는 함께 사용할 수 없습니다. 둘 중 하나를 변경해주세요.');
  if (has('aim') && has('stun') && form.attack >= 5) messages.push('조준·기절 조합에서는 공격력을 4 이하로 낮춰야 합니다.');
  if (has('silence') && has('stun') && has('aoe_damage')) messages.push('침묵·기절·광역 피해 세 가지는 동시에 선택할 수 없습니다.');
  if (has('grave_recover') && has('battle_draw')) messages.push('묘지 회수와 전투 드로우는 함께 사용할 수 없습니다. 둘 중 하나를 변경해주세요.');
  if (hasValue('direct_pressure', 2) && form.attack >= 6) messages.push('직접 압박 2단계에서는 공격력을 5 이하로 낮춰야 합니다.');
  return messages;
};

export const evaluateArenaCardEditor = (form: ArenaCardEditorForm) => {
  const budgetLimit = arenaCardBudgetByCost[form.cost] || 0;
  const statLimits = arenaCardStatLimitsByCost[form.cost] || { attackMax: 0, healthMax: 0 };
  const attackCost = Math.max(0, form.attack) * 3;
  const healthCost = Math.max(0, form.health);
  const keywordLines = form.keywords.map((selection, index) => {
    const definition = getArenaCardKeywordDefinition(selection.type);
    const variant = getArenaCardKeywordVariant(selection);
    return {
      code: `${selection.type}-${index}`,
      label: definition ? `${definition.label}${variant && variant.label !== '기본' ? ` · ${variant.label}` : ''}` : selection.type,
      cost: variant?.cost || 0
    };
  });
  const keywordCost = keywordLines.reduce((sum, line) => sum + line.cost, 0);
  const comboLines = comboBudgetLines(form);
  const comboCost = comboLines.reduce((sum, line) => sum + line.cost, 0);
  const totalCost = attackCost + healthCost + keywordCost + comboCost;
  const remaining = budgetLimit - totalCost;
  const errors = [
    ...(!Number.isInteger(form.cost) || form.cost < 1 || form.cost > 9 ? ['카드 코스트는 1부터 9까지 선택해주세요.'] : []),
    ...(!Number.isInteger(form.attack) || form.attack < 0 ? ['공격력은 0 이상의 정수여야 합니다.'] : []),
    ...(!Number.isInteger(form.health) || form.health < 1 ? ['체력은 1 이상의 정수여야 합니다.'] : []),
    ...(form.attack > statLimits.attackMax ? [`${form.cost}코스트 카드의 공격력은 최대 ${statLimits.attackMax}입니다. 공격력을 낮춰주세요.`] : []),
    ...(form.health > statLimits.healthMax ? [`${form.cost}코스트 카드의 체력은 최대 ${statLimits.healthMax}입니다. 체력을 낮춰주세요.`] : []),
    ...(new Set(form.keywords.map((keyword) => keyword.type)).size !== form.keywords.length ? ['같은 키워드는 한 번만 선택할 수 있습니다. 중복 키워드를 변경해주세요.'] : []),
    ...(form.keywords.some((keyword) => getArenaCardKeywordDefinition(keyword.type)?.availableForSelection === false)
      ? ['아직 전투 규칙이 확정되지 않은 보류 키워드는 새 카드에 저장할 수 없습니다. 다른 키워드를 선택해주세요.']
      : []),
    ...(form.keywords.length > 3 ? ['키워드는 최대 3개까지 선택할 수 있습니다.'] : []),
    ...forbiddenComboMessages(form),
    ...(remaining < 0 ? [`현재 예산을 ${Math.abs(remaining)}만큼 초과했습니다. 능력치나 키워드를 조정해주세요.`] : [])
  ];

  return {
    budgetLimit,
    statLimits,
    attackCost,
    healthCost,
    statCost: attackCost + healthCost,
    keywordLines,
    keywordCost,
    comboLines,
    comboCost,
    totalCost,
    remaining,
    usagePercent: budgetLimit > 0 ? Math.min(100, Math.max(0, (totalCost / budgetLimit) * 100)) : 0,
    errors,
    valid: errors.length === 0
  };
};
