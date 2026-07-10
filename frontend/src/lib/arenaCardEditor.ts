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
  variants: ArenaCardKeywordVariant[];
};

export const arenaCardBudgetByCost: Record<number, number> = {
  1: 5,
  2: 8,
  3: 12,
  4: 16,
  5: 21,
  6: 27,
  7: 34,
  8: 42,
  9: 51
};

export const arenaCardStatLimitsByCost: Record<number, { attackMax: number; healthMax: number }> = {
  1: { attackMax: 1, healthMax: 4 },
  2: { attackMax: 2, healthMax: 6 },
  3: { attackMax: 3, healthMax: 8 },
  4: { attackMax: 4, healthMax: 10 },
  5: { attackMax: 5, healthMax: 12 },
  6: { attackMax: 6, healthMax: 14 },
  7: { attackMax: 7, healthMax: 16 },
  8: { attackMax: 8, healthMax: 18 },
  9: { attackMax: 9, healthMax: 20 }
};

export const arenaCardClassDefinitions = {
  charge: {
    label: '돌격',
    description: '전열을 빠르게 돌파하고 직접 피해로 압박합니다. 높은 공격력과 관통·추격 계열에 잘 어울립니다.',
    playstyle: '공격적인 전열 압박',
    passive: '전열에 배치되면 카드에게 주는 첫 번째 피해가 1 증가합니다.'
  },
  guardian: {
    label: '수호',
    description: '도발과 보호막으로 아군을 지키며 전열을 오래 유지합니다. 체력과 방어 효과의 효율이 좋습니다.',
    playstyle: '단단한 전열 유지',
    passive: '전열에 배치되면 처음 받는 체력 피해를 1 줄입니다. 보호막 피해에는 적용되지 않습니다.'
  },
  sniper: {
    label: '저격',
    description: '조준과 후열 압박으로 중요한 적을 먼저 노립니다. 공격력과 제어 효과 조합에 유의해야 합니다.',
    playstyle: '정밀한 후열 제거',
    passive: '후열에 배치되면 같은 열의 상대 후열 카드를 먼저 공격합니다. 후열이 비어 있으면 전열을 공격합니다.'
  },
  support: {
    label: '지원',
    description: '회복·보호·공격 보조로 같은 라인의 아군을 강화합니다. 팀 전체의 안정성을 높입니다.',
    playstyle: '회복과 전투 보조',
    passive: '같은 열의 아군이 처음 받는 피해 1을 대신 받습니다.'
  },
  trick: {
    label: '기만',
    description: '침묵·기절·밀치기 같은 제어로 상대의 배치를 흔듭니다. 강한 제어 조합에는 추가 비용이 붙습니다.',
    playstyle: '제어와 위치 교란',
    passive: '자신에게 처음 피해를 준 적 카드에게 약화 1을 부여해 공격력을 1 낮춥니다.'
  },
  specter: {
    label: '망령',
    description: '묘지와 아군 손실을 활용해 후반 영향력을 만듭니다. 부활·원혼 조합은 비용과 제한을 확인하세요.',
    playstyle: '묘지 활용과 후반 압박',
    passive: '전열에서 전투불능이 되면 관통이 없는 일반 공격의 초과 피해가 같은 열 후열로 전달되지 않습니다.'
  },
  tech: {
    label: '기술',
    description: '전투 드로우와 전술 지원으로 손패 순환을 돕습니다. 유연한 운영과 조합 설계에 적합합니다.',
    playstyle: '카드 순환과 유틸리티',
    passive: '전투마다 이 카드에 처음 적용될 적 키워드 효과 1개를 무효화합니다.'
  }
} as const;

const fixed = (label: string, cost: number, detail?: string): ArenaCardKeywordVariant[] => [{ label, cost, detail }];
const levels = (costs: number[], unit: string): ArenaCardKeywordVariant[] => costs.map((cost, index) => ({
  label: `${index + 1}${unit}`,
  value: index + 1,
  cost
}));

export const arenaCardKeywordDefinitions: ArenaCardKeywordDefinition[] = [
  { type: 'taunt', label: '도발', description: '같은 라인의 적 공격을 자신에게 끌어와 아군을 보호합니다.', variants: fixed('기본', 4) },
  { type: 'shield', label: '보호막', description: '전투 시작 시 지정한 수치만큼 피해를 먼저 흡수합니다.', variants: levels([1, 2, 3, 4, 5], ' 보호막') },
  { type: 'damage_reduction', label: '피해 감소', description: '받는 피해를 줄여 전열 유지력을 높입니다.', variants: [{ label: '1 감소', value: 1, cost: 4 }, { label: '2 감소', value: 2, cost: 7 }] },
  { type: 'counter', label: '반격', description: '공격받은 뒤 공격자에게 즉시 반격 피해를 줍니다.', variants: [{ label: '1 피해', value: 1, cost: 4 }, { label: '2 피해', value: 2, cost: 7 }] },
  { type: 'lifesteal', label: '흡혈', description: '실제 체력 피해를 주면 자신의 누적 피해를 회복합니다.', variants: [{ label: '1 회복', value: 1, cost: 6 }, { label: '2 회복', value: 2, cost: 10 }] },
  { type: 'revive', label: '부활', description: '처음 전투불능이 되었을 때 한 번 다시 전장에 복귀합니다.', variants: fixed('1회', 18) },
  { type: 'pierce', label: '관통', description: '보호막이나 방어 효과를 일부 무시하고 피해를 전달합니다.', variants: fixed('기본', 6) },
  { type: 'pursuit', label: '추격', description: '약해진 적을 우선 압박해 마무리 능력을 높입니다.', variants: [{ label: '1단계', value: 1, cost: 5 }, { label: '2단계', value: 2, cost: 9 }] },
  { type: 'direct_pressure', label: '직격 압박', description: '빈 라인을 통해 상대 플레이어에게 주는 직접 피해를 강화합니다.', variants: [{ label: '1단계', value: 1, cost: 7 }, { label: '2단계', value: 2, cost: 12 }] },
  { type: 'backline_pressure', label: '후열 압박', description: '상대 후열의 핵심 카드를 우선적으로 위협합니다.', variants: fixed('기본', 5) },
  { type: 'weakpoint', label: '약점 공격', description: '피해를 입거나 약화된 적을 공격할 때 효율이 높아집니다.', variants: fixed('기본', 5) },
  { type: 'aoe_damage', label: '광역 피해', description: '주 대상과 함께 주변 카드에도 피해를 줍니다.', variants: [{ label: '1 피해', value: 1, cost: 8 }, { label: '2 피해', value: 2, cost: 14 }] },
  { type: 'aim', label: '조준', description: '후열 또는 지정 우선순위의 적을 정밀하게 노립니다.', variants: fixed('기본', 8) },
  { type: 'silence', label: '침묵', description: '대상의 키워드 효과를 일시적으로 사용할 수 없게 만듭니다.', variants: fixed('기본', 8) },
  { type: 'stun', label: '기절', description: '대상의 다음 행동을 한 번 막습니다.', variants: fixed('1회', 10) },
  { type: 'push', label: '밀치기', description: '적을 같은 라인의 다른 위치로 밀어 배치를 흐트러뜨립니다.', variants: fixed('기본', 6) },
  { type: 'pull', label: '끌어오기', description: '후열의 적을 앞으로 끌어내 아군의 공격에 노출시킵니다.', variants: fixed('기본', 7) },
  { type: 'weaken', label: '약화', description: '대상의 공격 능력을 낮춰 아군이 받는 피해를 줄입니다.', variants: [{ label: '1단계', value: 1, cost: 5 }, { label: '2단계', value: 2, cost: 9 }] },
  { type: 'battle_draw', label: '전투 드로우', description: '전투 중 덱에서 카드 1장을 뽑습니다. 손패 상한은 그대로 적용됩니다.', variants: fixed('카드 1장', 6) },
  { type: 'emergency_heal', label: '응급 회복', description: '피해를 입은 아군의 누적 피해를 즉시 회복합니다.', variants: [{ label: '1 회복', value: 1, cost: 7 }, { label: '2 회복', value: 2, cost: 12 }] },
  { type: 'guard_support', label: '보호 지원', description: '같은 라인의 아군에게 보호막을 제공해 생존을 돕습니다.', variants: fixed('기본', 4) },
  { type: 'attack_support', label: '공격 지원', description: '같은 라인 아군의 첫 공격 피해를 높입니다.', variants: fixed('기본', 5) },
  { type: 'grave_buff', label: '묘지 강화', description: '묘지에 쌓인 카드 수를 활용해 전투 능력을 강화합니다.', variants: fixed('기본', 6) },
  {
    type: 'grave_recover',
    label: '묘지 회수',
    description: '묘지의 카드를 손패로 되돌립니다. 회수 범위가 넓을수록 비용이 커집니다.',
    variants: [
      { label: '2코스트 이하', limit: 'cost_2', cost: 8 },
      { label: '망령 클래스', limit: 'specter', cost: 9 },
      { label: '같은 클래스', limit: 'same_class', cost: 11 },
      { label: '4코스트 이하', limit: 'cost_4', cost: 12 },
      { label: '자신 이하 코스트', limit: 'self_cost', cost: 14 },
      { label: '제한 없음', limit: 'any', cost: 18 }
    ]
  },
  { type: 'vengeance', label: '복수', description: '아군이 전투불능이 된 뒤 반격 흐름을 만듭니다.', variants: [{ label: '1단계', value: 1, cost: 4 }, { label: '2단계', value: 2, cost: 7 }] },
  { type: 'grudge', label: '원혼', description: '아군 손실과 묘지를 이용해 강한 후반 압박을 만듭니다.', variants: [{ label: '1단계', value: 1, cost: 10 }, { label: '2단계', value: 2, cost: 18 }] },
  { type: 'remnant', label: '잔영', description: '카드가 사라진 뒤에도 일부 전투 영향이 남습니다.', variants: [{ label: '1단계', value: 1, cost: 5 }, { label: '2단계', value: 2, cost: 8 }] }
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
  add(has('direct_pressure') && form.attack >= 4, 'pressure_attack_4', '직격 압박 + 공격력 4 이상', 3);
  add(has('direct_pressure') && form.attack >= 6, 'pressure_attack_6', '직격 압박 + 공격력 6 이상', 4);
  add(has('direct_pressure') && has('backline_pressure'), 'pressure_backline', '직격 압박 + 후열 압박', 3);
  add(has('direct_pressure') && has('pierce'), 'pressure_pierce', '직격 압박 + 관통', 3);
  add(has('direct_pressure') && form.cardClass === 'charge', 'pressure_charge', '돌격 클래스 + 직격 압박', 2);
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
  add(has('revive') && has('vengeance'), 'revive_vengeance', '부활 + 복수', 6);
  add(has('revive') && has('grudge'), 'revive_grudge', '부활 + 원혼', 10);
  add(has('revive') && has('grave_recover'), 'revive_grave', '부활 + 묘지 회수', 10);
  add(form.cardClass === 'support' && has('vengeance'), 'support_vengeance', '지원 클래스 + 복수', 3);
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
  if (form.cost === 1 && has('direct_pressure')) messages.push('1코스트에서는 직격 압박을 선택할 수 없습니다. 코스트를 올리거나 키워드를 변경해주세요.');
  if (form.cost === 1 && has('grudge')) messages.push('1코스트에서는 원혼을 선택할 수 없습니다. 코스트를 올리거나 키워드를 변경해주세요.');
  if (form.cost === 1 && has('grave_recover')) messages.push('1코스트에서는 묘지 회수를 선택할 수 없습니다. 코스트를 올리거나 키워드를 변경해주세요.');
  if (form.cost === 1 && has('battle_draw')) messages.push('1코스트에서는 전투 드로우를 선택할 수 없습니다. 코스트를 2 이상으로 올려주세요.');
  if (form.cost === 2 && has('revive')) messages.push('2코스트에서는 부활을 선택할 수 없습니다. 코스트를 올리거나 키워드를 변경해주세요.');
  if (has('revive') && hasValue('grudge', 2)) messages.push('부활과 원혼 2단계는 함께 사용할 수 없습니다. 둘 중 하나를 변경해주세요.');
  if (has('aim') && has('stun') && form.attack >= 5) messages.push('조준·기절 조합에서는 공격력을 4 이하로 낮춰야 합니다.');
  if (has('silence') && has('stun') && has('aoe_damage')) messages.push('침묵·기절·광역 피해 세 가지는 동시에 선택할 수 없습니다.');
  if (has('grave_recover') && has('battle_draw')) messages.push('묘지 회수와 전투 드로우는 함께 사용할 수 없습니다. 둘 중 하나를 변경해주세요.');
  if (hasValue('direct_pressure', 2) && form.attack >= 6) messages.push('직격 압박 2단계에서는 공격력을 5 이하로 낮춰야 합니다.');
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
