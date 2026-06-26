export type ArenaRoundWinnerDto = 'player' | 'bot' | 'draw';
export type ArenaMatchResultDto = 'win' | 'loss' | 'draw';
export type ArenaMatchTypeDto = 'BOT_PRACTICE' | 'RANKED';

export interface ArenaNumericStatsDto {
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  focus: number;
}

export interface ArenaSkillSnapshotDto {
  id: string;
  name: string;
  type: string;
}

export interface ArenaRoundPlanSlotDto {
  card_id: string;
  channel_id?: string;
  row: number;
  col: number;
}

export interface ArenaRoundPlanDto {
  round_no: number;
  formation_id?: string;
  tactic_style?: string;
  focus_rule?: string;
  slots: ArenaRoundPlanSlotDto[];
}

export interface ArenaSnapshotCardDto {
  card_id: string;
  channel_id: string;
  name: string;
  image_url: string | null;
  class_id: string;
  class_name: string;
  stats?: ArenaNumericStatsDto;
  skills?: ArenaSkillSnapshotDto[];
}

export interface ArenaDeckSnapshotDto {
  deck_id: string;
  name: string;
  cards: ArenaSnapshotCardDto[];
  round_plans: ArenaRoundPlanDto[];
  strategy_chip_id?: string;
}

export interface ArenaBattlefieldRuleDto {
  id: string;
  name: string;
  description: string;
  modifiers?: Record<string, number>;
}

export interface ArenaTacticChipDto {
  id: string;
  name: string;
  description: string;
  modifiers?: Record<string, number>;
}

export interface ArenaRulesCatalogDto {
  version: string;
  classes?: unknown[];
  skills?: unknown[];
  tactic_chips: ArenaTacticChipDto[];
  battlefield_rules: ArenaBattlefieldRuleDto[];
  forbidden_combat_fields?: string[];
}

export interface ArenaRoundResultDto {
  round_no: number;
  winner_side: ArenaRoundWinnerDto;
  player_remaining_units?: number;
  bot_remaining_units?: number;
  player_total_damage?: number;
  bot_total_damage?: number;
}

export interface ArenaCompactMatchSummaryDto {
  progress_status?: 'in_progress' | 'completed';
  current_round_no?: number;
  rounds_to_win?: number;
  max_rounds?: number;
  abandon_policy?: {
    mode: 'auto_default_plan';
    committed_by?: 'player_a' | 'player_b';
    auto_commit?: boolean;
    default_plan_used_for_absent_side?: boolean;
  };
  pending_round_input?: {
    round_no: number;
    deadline_at: string;
    player_a?: unknown;
    player_b?: unknown;
  } | null;
  round_results?: ArenaRoundResultDto[];
  player_deck?: ArenaDeckSnapshotDto;
  bot_deck?: ArenaDeckSnapshotDto;
  opponent_deck?: ArenaDeckSnapshotDto;
  battlefield_rule?: ArenaBattlefieldRuleDto;
}

export interface ArenaMatchViewDto {
  id: string;
  result: ArenaMatchResultDto | null;
  match_type?: ArenaMatchTypeDto;
  round_count: number;
  player_a_round_wins: number;
  player_b_round_wins: number;
  player_b_id?: string | null;
  winner_user_id?: string | null;
  difficulty: string;
  created_at: string;
  summary?: ArenaCompactMatchSummaryDto;
}

export interface ArenaReplayEventDto {
  t: number;
  type: string;
  actor?: string;
  targets?: string[];
  value?: number;
  hp_before?: number;
  hp_after?: number;
  shield_before?: number;
  shield_after?: number;
  alive_after?: boolean;
  message?: string;
}

export interface ArenaReplayUnitStateDto {
  id: string;
  side: 'player' | 'bot';
  card_id: string;
  channel_id?: string;
  max_hp: number;
  start_hp?: number;
  final_hp: number;
  alive: boolean;
}

export interface ArenaReplayRoundDto {
  round_no: number;
  duration_ms: number;
  winner_side: ArenaRoundWinnerDto;
  replay_truncated?: boolean;
  original_event_count?: number;
  timeline_summary?: {
    first_event_t?: number;
    last_event_t?: number;
    omitted_event_count: number;
  };
  unit_states?: ArenaReplayUnitStateDto[];
  events: ArenaReplayEventDto[];
}

export interface ArenaReplayPayloadDto {
  match_id: string;
  match_format?: string;
  rounds_to_win?: number;
  replay_version?: number;
  replay_storage: 'compact_summary' | 'tick_events' | string;
  rounds: ArenaReplayRoundDto[];
}

export interface ArenaRecentMatchDto {
  id: string;
  result: ArenaMatchResultDto | null;
  match_type?: ArenaMatchTypeDto;
  round_count: number;
  player_a_round_wins: number;
  player_b_round_wins: number;
  player_b_id?: string | null;
  winner_user_id?: string | null;
  difficulty: string;
  created_at: string;
  summary?: ArenaCompactMatchSummaryDto;
}

export interface ArenaProfileDto {
  user_id: string;
  season_id: string;
  rating: number;
  rating_points: number;
  tier: string;
  rank: number | null;
  wins: number;
  losses: number;
  draws: number;
  sets_played: number;
}

export interface ArenaUserProfileDto extends ArenaProfileDto {
  win_rate: number;
  recent_matches: ArenaRecentMatchDto[];
}

export interface ArenaRankingItemDto extends ArenaProfileDto {
  rank: number;
}

export interface ArenaRankingsDto {
  season_id: string;
  source: 'rank_snapshot' | 'rating_rows_limited' | 'rank_snapshot_empty' | string;
  updated_at: string | null;
  items: ArenaRankingItemDto[];
}
