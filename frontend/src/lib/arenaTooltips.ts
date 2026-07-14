import {
  arenaCardBudgetByCost,
  arenaCardClassDefinitions,
  arenaCardStatLimitsByCost,
  getArenaCardKeywordDefinition,
  getArenaCardKeywordVariant,
  type ArenaCardKeywordSelection
} from '@/lib/arenaCardEditor';

export type ArenaTooltipTone = 'cyan' | 'coral' | 'green' | 'violet' | 'gold' | 'neutral';

export type ArenaTooltipData = {
  eyebrow: string;
  title: string;
  description: string;
  details?: Array<{ label: string; value: string }>;
  note?: string;
  tone?: ArenaTooltipTone;
};

const classAliases: Record<string, keyof typeof arenaCardClassDefinitions> = {
  charge: 'charge',
  attack: 'charge',
  guardian: 'guardian',
  guard: 'guardian',
  sniper: 'sniper',
  support: 'support',
  heal: 'support',
  trick: 'trick',
  control: 'trick',
  specter: 'specter',
  ultimate: 'specter',
  tech: 'tech',
  tempo: 'tech'
};

const classTones: Record<keyof typeof arenaCardClassDefinitions, ArenaTooltipTone> = {
  charge: 'coral',
  guardian: 'green',
  sniper: 'violet',
  support: 'green',
  trick: 'violet',
  specter: 'violet',
  tech: 'cyan'
};

export const arenaKeywordCategoryLabels = {
  defense: '방어 · 생존',
  offense: '공격 · 돌파',
  control: '제어 · 방해',
  support: '지원 · 자원',
  specter: '망령 · 전투불능'
} as const;

const keywordCategoryTones: Record<keyof typeof arenaKeywordCategoryLabels, ArenaTooltipTone> = {
  defense: 'green',
  offense: 'coral',
  control: 'violet',
  support: 'cyan',
  specter: 'violet'
};

const keywordRuleNotes: Record<string, string> = {
  taunt: '다른 라인의 공격에는 영향을 주지 않습니다.',
  shield: '보호막은 체력과 별도로 계산되며 전투가 끝나면 남은 수치가 제거됩니다.',
  damage_reduction: '보호막이 먼저 피해를 흡수한 뒤 실제 체력 피해가 생길 때만 횟수를 사용합니다.',
  counter: '반격 피해는 새로운 기본 공격으로 취급하지 않습니다.',
  lifesteal: '보호막만 깎았거나 플레이어에게 직접 피해를 준 경우에는 회복하지 않습니다.',
  revive: '2코스트 카드에는 넣을 수 없고, 원혼 2와 함께 사용할 수 없습니다.',
  pierce: '초과 피해는 후열 카드까지만 전달되며 상대 플레이어에게 이어지지 않습니다.',
  pursuit: '관통 또는 조준과 함께 선택하면 조합 추가 비용이 붙습니다.',
  direct_pressure: '1코스트 카드에는 넣을 수 없습니다. 2단계는 공격력 6 이상과 함께 저장할 수 없습니다.',
  backline_pressure: '상대 플레이어 직접 공격에는 적용되지 않습니다.',
  weakpoint: '아직 체력 피해를 받지 않은 카드에는 추가 피해가 없습니다.',
  aoe_damage: '침묵과 기절을 모두 함께 선택할 수 없습니다.',
  aim: '조준·기절 조합은 공격력을 4 이하로 구성해야 합니다.',
  silence: '침묵·기절·광역 피해 세 가지는 동시에 선택할 수 없습니다.',
  stun: '이번 공격 단계만 막고 다음 공격 단계에는 자동으로 해제됩니다.',
  push: '목적지인 후열 칸이 비어 있어야 이동합니다.',
  pull: '목적지인 전열 칸이 비어 있어야 이동합니다.',
  weaken: '공격력은 0 아래로 내려가지 않으며 전투 종료 시 감소분이 사라집니다.',
  battle_draw: '1코스트 카드와 묘지 회수에는 함께 넣을 수 없습니다.',
  emergency_heal: '누적 피해만 줄이며 카드의 최대 체력 자체는 올리지 않습니다.',
  guard_support: '같은 라인에 보호할 아군 카드가 있어야 의미가 있습니다.',
  attack_support: '같은 라인 아군의 첫 카드 피해에만 적용됩니다.',
  grave_buff: '묘지 카드 수를 참조하므로 초반보다 묘지가 쌓인 이후에 효율이 높습니다.',
  grave_recover: '1코스트 카드와 전투 드로우에는 넣을 수 없습니다. 조건에 맞는 카드가 없으면 회수하지 못합니다.',
  vengeance: '교체나 손패 초과 버림처럼 전투불능이 아닌 묘지 이동에는 발동하지 않습니다.',
  grudge: '1코스트 카드에는 넣을 수 없습니다. 직접 공격은 아니지만 체력을 0 이하로 만들면 패배시킬 수 있습니다.',
  remnant: '같은 라인에 생존한 아군 카드가 있어야 보호막을 부여합니다.'
};

export const getArenaClassTooltip = (cardClass?: string | null): ArenaTooltipData => {
  const rawClass = String(cardClass || '').trim();
  const key = classAliases[rawClass.toLowerCase()];
  if (!key) {
    return {
      eyebrow: '카드 클래스',
      title: rawClass || '클래스 정보 없음',
      description: '현재 시즌 클래스 사전에 등록되지 않은 이전 버전 카드입니다.',
      note: '카드 상세 정보 또는 운영자에게 현재 시즌 변환 상태를 확인해주세요.',
      tone: 'neutral'
    };
  }
  const definition = arenaCardClassDefinitions[key];
  return {
    eyebrow: '클래스 패시브',
    title: `${definition.label} · ${definition.playstyle}`,
    description: definition.description,
    details: [
      { label: '패시브', value: definition.passive },
      { label: '발동', value: definition.trigger },
      { label: '조건', value: definition.condition }
    ],
    note: definition.note,
    tone: classTones[key]
  };
};

export const getArenaKeywordTooltip = (selection: ArenaCardKeywordSelection | string): ArenaTooltipData => {
  const isDefinitionOverview = typeof selection === 'string';
  const normalized = typeof selection === 'string' ? { type: selection } : selection;
  const definition = getArenaCardKeywordDefinition(String(normalized.type || '').toLowerCase());
  if (!definition) {
    return {
      eyebrow: '카드 효과',
      title: String(normalized.type || '알 수 없는 효과'),
      description: '현재 규칙 사전에 등록되지 않은 이전 버전 효과입니다.',
      note: '카드 상세 정보 또는 운영자에게 현재 시즌 변환 상태를 확인해주세요.',
      tone: 'neutral'
    };
  }
  const variant = getArenaCardKeywordVariant(normalized);
  return {
    eyebrow: arenaKeywordCategoryLabels[definition.category],
    title: !isDefinitionOverview && variant && variant.label !== '기본' ? `${definition.label} · ${variant.label}` : definition.label,
    description: definition.description,
    details: [
      {
        label: isDefinitionOverview ? '선택 단계' : '편집 비용',
        value: isDefinitionOverview
          ? definition.variants.map((item) => `${item.label} · ${item.cost}`).join(' / ')
          : `${variant?.cost ?? 0}`
      },
      { label: '발동 시점', value: definition.timing },
      { label: '대상', value: definition.target },
      { label: '지속', value: definition.duration }
    ],
    note: keywordRuleNotes[definition.type],
    tone: keywordCategoryTones[definition.category]
  };
};

export const getArenaCostTooltip = (cost: number): ArenaTooltipData => {
  const safeCost = Math.min(9, Math.max(1, Math.trunc(cost)));
  const limits = arenaCardStatLimitsByCost[safeCost];
  return {
    eyebrow: '카드 제작 규칙',
    title: `${safeCost}코스트 카드`,
    description: `배치하거나 교체할 때 ${safeCost}코스트를 사용합니다. 편집 예산은 ${arenaCardBudgetByCost[safeCost]}입니다.`,
    details: [
      { label: '제작 예산', value: `${arenaCardBudgetByCost[safeCost]}` },
      { label: '공격력 상한', value: `${limits.attackMax}` },
      { label: '체력 상한', value: `${limits.healthMax}` }
    ],
    note: '카드 코스트와 편집 예산은 다른 값입니다. 능력치와 효과의 비용 합계가 편집 예산을 넘으면 저장할 수 없습니다.',
    tone: 'gold'
  };
};

export const getArenaStatTooltip = (stat: 'attack' | 'health', value?: number): ArenaTooltipData => stat === 'attack'
  ? {
      eyebrow: '카드 능력치',
      title: `공격력${value == null ? '' : ` ${value}`}`,
      description: '기본 공격이 카드에게 주는 피해의 기준입니다. 편집할 때 공격력 1마다 예산 3을 사용합니다.',
      details: [
        { label: '편집 비용', value: '1당 3' },
        { label: '직접 공격', value: '전열은 공격력, 후열은 공격력 -1' }
      ],
      note: '공격력 0 카드는 기본 공격은 하지만 피해를 주지 못해 “피해를 줬을 때” 효과도 발동하지 않습니다.',
      tone: 'coral'
    }
  : {
      eyebrow: '카드 능력치',
      title: `체력${value == null ? '' : ` ${value}`}`,
      description: '카드가 전투불능이 되기 전까지 버틸 수 있는 최대 체력입니다. 편집할 때 체력 1마다 예산 1을 사용합니다.',
      details: [
        { label: '편집 비용', value: '1당 1' },
        { label: '최솟값', value: '1' }
      ],
      note: '필드에서 받은 체력 피해는 전투가 끝나도 누적되며, 현재 체력이 0 이하가 되면 전투불능 처리됩니다.',
      tone: 'green'
    };

export const arenaCoreTooltips = {
  cardBudget: {
    eyebrow: '내 카드 편집', title: '편집 예산', description: '코스트별로 정해진 제작 포인트입니다. 공격력·체력·키워드·강한 조합의 비용을 모두 합산합니다.',
    details: [{ label: '공격력', value: '1당 3' }, { label: '체력', value: '1당 1' }, { label: '키워드', value: '선택 단계별 고정 비용' }],
    note: '합계가 예산 이하여야 저장할 수 있으며, 금지 조합은 예산이 남아도 저장할 수 없습니다.', tone: 'gold'
  },
  comboCost: {
    eyebrow: '밸런스 규칙', title: '조합 추가 비용', description: '서로 강한 능력치와 키워드를 함께 선택했을 때 기본 비용에 더해지는 밸런스 비용입니다.',
    note: '현재 선택에서 적용된 조합만 비용 계산 목록에 표시됩니다.', tone: 'violet'
  },
  playerHealth: {
    eyebrow: '승패 규칙', title: '플레이어 체력', description: '모든 모드는 30 체력으로 시작합니다. 상대 체력을 0 이하로 만들면 즉시 승리합니다.',
    note: '9턴 종료 시에는 남은 체력이 높은 쪽이 승리하고, 같으면 서든데스로 이어집니다.', tone: 'green'
  },
  turnCost: {
    eyebrow: '턴 자원', title: '사용 가능 코스트', description: '손패 카드를 배치·교체하거나 전술 이동할 때 쓰는 이번 턴의 자원입니다.',
    details: [{ label: '1턴', value: '1' }, { label: '증가', value: '매 턴 +1' }, { label: '상한', value: '9' }],
    note: '제출 전 행동의 총비용이 이번 턴 코스트를 넘으면 행동을 확정할 수 없습니다.', tone: 'gold'
  },
  turnTimer: {
    eyebrow: '턴 진행', title: '40초 행동 제한', description: '이 시간 안에 이동·배치·교체를 계획하고 행동을 제출해야 합니다.',
    note: '양쪽이 모두 먼저 제출하면 남은 시간을 기다리지 않고 전투 단계로 넘어갑니다.', tone: 'cyan'
  },
  hand: {
    eyebrow: '카드 영역', title: '손패', description: '현재 배치하거나 교체에 사용할 수 있는 카드입니다. 대전 시작 시 5장을 뽑습니다.',
    details: [{ label: '최대', value: '8장' }, { label: '기본 드로우', value: '2턴부터 턴마다 1장' }],
    note: '손패가 8장일 때 추가로 들어오는 카드는 규칙에 따라 버림 처리됩니다.', tone: 'cyan'
  },
  deck: {
    eyebrow: '카드 영역', title: '덱', description: '대전에 사용할 14~20장의 카드 묶음입니다. 같은 스트리머 카드는 한 덱에 한 장만 넣을 수 있습니다.',
    note: '덱이 비었을 때 드로우를 시도하면 카드를 뽑는 대신 피로 피해를 받습니다.', tone: 'cyan'
  },
  graveyard: {
    eyebrow: '카드 영역', title: '묘지', description: '전투불능, 교체, 손패 초과 버림 등으로 필드나 손패에서 벗어난 카드가 놓이는 영역입니다.',
    note: '“전투불능 시” 효과는 전투 중 체력이 0 이하가 된 경우에만 발동하며 일반 교체에는 발동하지 않습니다.', tone: 'violet'
  },
  fatigue: {
    eyebrow: '장기전 규칙', title: '다음 피로 피해', description: '덱이 빈 상태에서 드로우를 시도하면 플레이어가 받게 될 피해입니다. 드로우 실패가 반복될수록 증가합니다.',
    note: '피로 피해도 플레이어 체력을 0 이하로 만들 수 있습니다.', tone: 'coral'
  },
  move: {
    eyebrow: '턴 행동', title: '전술 이동', description: '이전 턴부터 필드에 있던 내 카드 한 장을 빈 칸으로 옮깁니다.',
    details: [{ label: '기본 비용', value: '1코스트' }, { label: '횟수', value: '턴마다 1회' }],
    note: '이번 턴에 새로 배치한 카드는 같은 턴에 이동할 수 없습니다.', tone: 'cyan'
  },
  place: {
    eyebrow: '턴 행동', title: '배치', description: '손패 카드를 내 필드의 빈 칸에 놓고 카드에 적힌 코스트를 사용합니다.',
    note: '상대 필드나 이미 카드가 있는 칸에는 일반 배치를 할 수 없습니다.', tone: 'green'
  },
  replace: {
    eyebrow: '턴 행동', title: '교체', description: '기존 필드 카드가 있는 칸에 손패의 새 카드를 놓고 새 카드 코스트를 사용합니다.',
    note: '기존 카드는 묘지로 가지만 전투불능 효과는 발동하지 않습니다.', tone: 'violet'
  },
  submit: {
    eyebrow: '턴 행동', title: '행동 제출', description: '현재 계획한 이동·배치·교체의 최종 상태를 확정합니다. 제출된 행동은 양쪽에 동시에 적용됩니다.',
    note: '제출 전에는 행동 목록에서 개별 행동을 취소하거나 선택을 초기화할 수 있습니다.', tone: 'coral'
  },
  frontLine: {
    eyebrow: '필드 위치', title: '전열', description: '각 라인에서 상대의 기본 공격을 먼저 받으며 후열보다 먼저 공격하는 위치입니다.',
    note: '전열 카드가 기본 공격으로 쓰러지면 남은 피해의 절반이 같은 라인 후열로 넘어갑니다. 관통이면 전부 넘어갑니다.', tone: 'coral'
  },
  backLine: {
    eyebrow: '필드 위치', title: '후열', description: '같은 라인의 전열 뒤에서 공격하는 위치입니다. 전열이 비어야 일반적으로 공격 대상이 됩니다.',
    note: '라인이 완전히 비어 플레이어를 직접 공격할 때 후열 피해는 공격력 -1이며 0보다 작아지지 않습니다.', tone: 'violet'
  },
  matchStatus: {
    eyebrow: '매치 정보', title: '대전 상태', description: '멀리건, 행동 계획, 전투 처리, 종료 중 현재 서버가 처리 중인 대전 단계를 나타냅니다.',
    note: '상태가 갱신되지 않으면 새로고침으로 서버의 최신 매치 정보를 다시 불러올 수 있습니다.', tone: 'cyan'
  },
  botMode: {
    eyebrow: '대전 모드', title: '연습전', description: '알고리즘 기반 봇을 상대로 실제 전투 규칙과 덱을 점검하는 모드입니다.',
    note: '연습전 결과는 시즌 MMR과 랭킹에 반영되지 않습니다.', tone: 'green'
  },
  quickMode: {
    eyebrow: '대전 모드', title: '빠른대전', description: 'MMR을 기준으로 상대를 찾는 1대1 온라인 대전입니다.',
    note: '경기 결과는 시즌 랭킹과 보상 기준에 반영됩니다.', tone: 'coral'
  },
  battleRoyaleMode: {
    eyebrow: '대전 모드', title: '8인전', description: '8명이 참가해 라운드마다 1대1 전투를 반복하고 마지막 생존자를 가리는 모드입니다.',
    note: '체력이 0 이하가 되면 탈락하며 패배한 플레이어는 다음 라운드 첫 전술 이동이 무료입니다.', tone: 'violet'
  },
  emoteWheel: {
    eyebrow: '커뮤니케이션', title: '이모트 휠', description: '장착한 최대 8개의 이모트를 원형 메뉴에서 빠르게 선택해 상대에게 보냅니다.',
    note: '상점에서 보유한 이모트만 슬롯에 장착할 수 있습니다.', tone: 'violet'
  },
  points: {
    eyebrow: '아레나 상점', title: '보유 포인트', description: '아레나 치장 상품을 구매할 때 사용하는 계정 포인트입니다.',
    note: '상품 가격과 구매 제한을 확인한 뒤 구매가 확정됩니다.', tone: 'gold'
  },
  refresh: {
    eyebrow: '화면 기능', title: '새로고침', description: '현재 페이지의 시즌, 카드, 덱 또는 매치 정보를 서버에서 다시 불러옵니다.',
    note: '저장하지 않은 편집 내용이 있는 화면에서는 초기화 여부를 먼저 확인하세요.', tone: 'cyan'
  }
} satisfies Record<string, ArenaTooltipData>;

export const getArenaBoardSlotTooltip = (lane: 'front' | 'back', index: number, owner: 'self' | 'opponent'): ArenaTooltipData => {
  const base = lane === 'front' ? arenaCoreTooltips.frontLine : arenaCoreTooltips.backLine;
  const column = ['왼쪽', '가운데', '오른쪽'][Math.max(0, Math.min(2, index))];
  return {
    ...base,
    title: `${owner === 'self' ? '내' : '상대'} ${lane === 'front' ? '전열' : '후열'} · ${column} 라인`,
    details: [{ label: '세로 라인', value: `${column} 라인` }, { label: '소유', value: owner === 'self' ? '나' : '상대' }]
  };
};
