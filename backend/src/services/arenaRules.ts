export const ARENA_MATCH_FORMAT = 'best_of_five' as const;
export const ARENA_ROUNDS_TO_WIN = 3 as const;
export const ARENA_MAX_ROUNDS_PER_MATCH = 5 as const;
export const ARENA_MAX_ROUND_TICKS = 180 as const;
export const ARENA_DECK_MIN_CARD_COUNT = 6 as const;
export const ARENA_DECK_MAX_CARD_COUNT = 10 as const;
export const ARENA_ROUND_MAX_DEPLOY_COUNT = 6 as const;
export const ARENA_ROUND_PLAN_MAX_COUNT = 5 as const;
export const ARENA_BOARD_ROWS = 2 as const;
export const ARENA_BOARD_COLS = 4 as const;

export type ArenaMatchFormat = typeof ARENA_MATCH_FORMAT;
export type ArenaRoundNo = 1 | 2 | 3 | 4 | 5;

export const ARENA_TARGET_CLIENT_PLAY_TIME_SECONDS = {
  min: 420,
  max: 720
} as const;

export const ARENA_TACTIC_CHIPS = [
  {
    id: 'none',
    name: '기본 전술',
    description: '추가 보정 없이 라운드 플랜과 카드 조합만 사용합니다.',
    modifiers: {}
  },
  {
    id: 'early_press',
    name: '초반 압박',
    description: '1라운드 공격 템포를 높이고 후반 방어 효율을 낮춥니다.',
    modifiers: { early_attack: 1.035, late_defense: 0.95 }
  },
  {
    id: 'backline_guard',
    name: '후열 보호',
    description: '후열 생존력을 높이고 전열 방어 효율을 조금 낮춥니다.',
    modifiers: { backline_hp: 1.025, frontline_defense: 0.985 }
  },
  {
    id: 'comeback_core',
    name: '역전 설계',
    description: '4~5라운드의 시작 에너지를 높입니다.',
    modifiers: { late_energy: 14 }
  },
  {
    id: 'skill_cycle',
    name: '스킬 순환',
    description: '스킬 비용을 낮추고 기본 공격력을 조금 낮춥니다.',
    modifiers: { skill_cost: 0.94, attack: 0.99 }
  },
  {
    id: 'anti_burst',
    name: '폭딜 대응',
    description: '치명 피해를 줄이는 대신 공격 템포가 조금 느려집니다.',
    modifiers: { crit_taken: 0.9 }
  }
] as const;

export type ArenaTacticChipId = typeof ARENA_TACTIC_CHIPS[number]['id'];

export const ARENA_BATTLEFIELD_RULES = [
  {
    id: 'narrow_front',
    name: '좁은 전선',
    description: '전열 방어 효율이 소폭 증가합니다.',
    modifiers: { frontline_defense: 1.05 }
  },
  {
    id: 'long_breath',
    name: '긴 호흡',
    description: '회복 효율이 낮아지고 생존력이 조금 올라갑니다.',
    modifiers: { healing: 0.94, hp: 1.03 }
  },
  {
    id: 'unstable_energy',
    name: '불안정 에너지',
    description: '시작 에너지가 높지만 스킬 비용도 조금 증가합니다.',
    modifiers: { start_energy: 10, skill_cost: 1.04 }
  },
  {
    id: 'thin_shield',
    name: '보호막 약화',
    description: '보호막 효율이 낮아지고 직접 피해가 조금 안정됩니다.',
    modifiers: { shield: 0.9, attack: 1.02 }
  }
] as const;

export type ArenaBattlefieldRuleId = typeof ARENA_BATTLEFIELD_RULES[number]['id'];
